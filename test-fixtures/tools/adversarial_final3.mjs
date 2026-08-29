/**
 * Adversarial Final Pass — Part 3: Save corruption and dialog block check
 */

import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const app = await electron.launch({
    args: [ROOT],
    env: { ...process.env, ELECTRON_RENDERER_URL: pathToFileURL(path.join(ROOT, 'dist', 'renderer', 'index.html')).href },
  });
  const win = await app.firstWindow();
  await sleep(1500);

  async function engine(method, ...args) {
    return await win.evaluate(([m, a]) => window.tflex.engine[m](...a), [method, args]);
  }

  // ===================================================================
  // TEST: save() on fixture file — does it corrupt the original?
  // ===================================================================
  console.log('=== Test: save() overwrites source fixture ===');
  {
    // Create a copy to test with
    const tmpDir = path.join(os.tmpdir(), 'tflex-adv-corrupt-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    
    // Copy report.pdf to our working copy
    const workingPath = path.join(tmpDir, 'report-work.pdf');
    const originalBytes = fs.readFileSync(path.join(ROOT, 'test-fixtures', 'report.pdf'));
    fs.writeFileSync(workingPath, originalBytes);
    
    const originalSize = fs.statSync(workingPath).size;
    console.log('Original file size: ' + originalSize + ' bytes');
    
    const docId = 'corrupt-test';
    await engine('loadDocument', docId, workingPath);
    
    // Delete a page
    await engine('applyOp', docId, { kind: 'delete', page: 0 });
    let state = await engine('getState', docId);
    console.log('After delete: ' + state.value.pageCount + ' pages');
    
    // Save overwrites the source
    const saveResult = await engine('save', docId);
    console.log('Save result: ok=' + saveResult.ok + ', value=' + (saveResult.ok ? saveResult.value : saveResult.error.code));
    
    // Check the file was modified
    const savedSize = fs.statSync(workingPath).size;
    console.log('Saved file size: ' + savedSize + ' bytes');
    console.log('File changed: ' + (originalSize !== savedSize));
    
    // Reload and check page count
    const reloadId = 'verify-saved';
    await engine('loadDocument', reloadId, workingPath);
    const reloadState = await engine('getState', reloadId);
    console.log('Reloaded page count: ' + reloadState.value.pageCount);
    
    if (reloadState.value.pageCount !== 33) {
      console.log('  ** Finding: save() produced incorrect page count on reload');
    }
    
    // Clean up
    fs.unlinkSync(workingPath);
  }

  // ===================================================================
  // TEST: Merge form.pdf into report.pdf — check form fields survive
  // ===================================================================
  console.log('\n=== Test: Merge form.pdf preserves form fields in result ===');
  {
    const docId = 'merge-form-into-report';
    await engine('loadDocument', docId, path.join(ROOT, 'test-fixtures', 'report.pdf'));
    
    const mergeResult = await engine('merge', docId, [path.join(ROOT, 'test-fixtures', 'form.pdf')], 'after');
    if (mergeResult.ok) {
      console.log('Merged: ' + mergeResult.value.pageCount + ' pages');
      
      // Check if form fields are present
      const fields = await engine('getFormFields', docId);
      console.log('Form fields after merge: ' + fields.value.length);
      if (fields.value.length === 0) {
        console.log('  ** Finding: Form fields lost when merging form.pdf into report.pdf');
      }
    } else {
      console.log('Merge error: ' + mergeResult.error.code);
    }
  }

  // ===================================================================
  // TEST: Save mods to hosted file using save on a temp copy
  // ===================================================================
  console.log('\n=== Test: Full round-trip with form fill and save ===');
  {
    const tmpDir = path.join(os.tmpdir(), 'tflex-adv-roundtrip-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    
    const workingPath = path.join(tmpDir, 'form-work.pdf');
    fs.copyFileSync(path.join(ROOT, 'test-fixtures', 'form.pdf'), workingPath);
    
    const docId = 'roundtrip-form';
    await engine('loadDocument', docId, workingPath);
    
    // Fill fields
    await engine('fillFormField', docId, { id: 'form-0-applicant_name', value: 'Roundtrip Test' });
    await engine('fillFormField', docId, { id: 'form-0-terms_agreed', value: 'true' });
    await engine('fillFormField', docId, { id: 'form-0-experience_level', value: 'Senior' });
    await engine('fillFormField', docId, { id: 'form-0-department', value: 'Support' });
    
    let state = await engine('getState', docId);
    console.log('Before save: modified=' + state.value.modified);
    
    // Save
    const saveResult = await engine('save', docId);
    console.log('Save: ok=' + saveResult.ok);
    
    // Reload
    const reloadId = 'reload-form';
    await engine('loadDocument', reloadId, workingPath);
    const reloadFields = await engine('getFormFields', reloadId);
    console.log('Reloaded fields: ' + reloadFields.value.length);
    
    // Check values survived
    const nameField = reloadFields.value.find(f => f.name === 'applicant_name');
    const termsField = reloadFields.value.find(f => f.name === 'terms_agreed');
    const expField = reloadFields.value.find(f => f.name === 'experience_level');
    const deptField = reloadFields.value.find(f => f.name === 'department');
    
    console.log('  applicant_name: ' + (nameField ? nameField.value : 'MISSING'));
    console.log('  terms_agreed: ' + (termsField ? termsField.value : 'MISSING'));
    console.log('  experience_level: ' + (expField ? JSON.stringify(expField.value) : 'MISSING'));
    console.log('  department: ' + (deptField ? deptField.value : 'MISSING'));
    
    if (nameField && nameField.value !== 'Roundtrip Test') {
      console.log('  ** Finding: Form field values lost on save/reload!');
    }
    
    // Clean up
    fs.unlinkSync(workingPath);
  }

  // ===================================================================
  // TEST: SaveWithAnns roundtrip
  // ===================================================================
  console.log('\n=== Test: Annotation save round-trip ===');
  {
    const tmpDir = path.join(os.tmpdir(), 'tflex-adv-ann-roundtrip-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    
    const workingPath = path.join(tmpDir, 'report-ann.pdf');
    fs.copyFileSync(path.join(ROOT, 'test-fixtures', 'report.pdf'), workingPath);
    
    const docId = 'ann-roundtrip';
    await engine('loadDocument', docId, workingPath);
    
    // Create annotations
    await engine('createAnnotation', docId, {
      id: 'rt-highlight', kind: 'highlight', page: 1,
      rects: [{ x: 100, y: 700, width: 200, height: 20 }], color: 'yellow'
    });
    await engine('createAnnotation', docId, {
      id: 'rt-note', kind: 'note', page: 2,
      at: { x: 300, y: 500 }, color: 'blue', content: 'Roundtrip note'
    });
    
    let state = await engine('getState', docId);
    console.log('Before save: annotations count=' + (state.value.annotations ? state.value.annotations.length : 0));
    
    // Save
    await engine('save', docId);
    
    // Reload and check annotations
    const reloadId = 'reload-ann';
    await engine('loadDocument', reloadId, workingPath);
    const reloadState = await engine('getState', reloadId);
    const annotCount = reloadState.value.annotations ? reloadState.value.annotations.length : 0;
    console.log('After reload: annotations=' + annotCount);
    
    if (annotCount === 0) {
      console.log('  ** Finding: Annotations lost on save/reload cycle!');
    }
    
    // Clean up
    fs.unlinkSync(workingPath);
  }

  // ===================================================================
  // TEST: End-to-end signature save round-trip
  // ===================================================================
  console.log('\n=== Test: Signature save round-trip ===');
  {
    const tmpDir = path.join(os.tmpdir(), 'tflex-adv-sig-roundtrip-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    
    const workingPath = path.join(tmpDir, 'report-sig.pdf');
    fs.copyFileSync(path.join(ROOT, 'test-fixtures', 'report.pdf'), workingPath);
    
    const docId = 'sig-roundtrip';
    await engine('loadDocument', docId, workingPath);
    
    const tinyPng = new Uint8Array([
      0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,0x00,0x00,0x00,0x0D,0x49,0x48,0x44,0x52,
      0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x01,0x08,0x02,0x00,0x00,0x00,0x90,0x77,0x53,
      0xDE,0x00,0x00,0x00,0x0C,0x49,0x44,0x41,0x54,0x08,0xD7,0x63,0x60,0x60,0x00,0x00,
      0x00,0x04,0x00,0x01,0x27,0x34,0x27,0x2C,0x00,0x00,0x00,0x00,0x49,0x45,0x4E,0x44,
      0xAE,0x42,0x60,0x82
    ]);
    
    await engine('placeSignature', docId, {
      id: 'roundtrip-sig', signatureId: 'saved-test-sig', page: 1,
      rect: { x: 100, y: 700, width: 150, height: 50 }, pngBytes: tinyPng
    });
    
    // Save
    await engine('save', docId);
    
    // Reload
    const reloadId = 'reload-sig';
    await engine('loadDocument', reloadId, workingPath);
    const reloadState = await engine('getState', reloadId);
    const sigs = reloadState.value.placedSignatures;
    console.log('After reload: placedSignatures=' + (sigs ? sigs.length : 0));
    
    if (!sigs || sigs.length === 0) {
      console.log('  ** Finding: Signature placements lost on save/reload cycle!');
    }
    
    // Clean up
    fs.unlinkSync(workingPath);
  }

  await app.close();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
