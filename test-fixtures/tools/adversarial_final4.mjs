/**
 * Adversarial Final Pass — Part 4: Additional targeted tests
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
  // TEST: Merge form fields issue - merge form.pdf into report.pdf
  // ===================================================================
  console.log('=== Merge: form fields preservation ===');
  {
    const docId = 'merge-field-test';
    await engine('loadDocument', docId, path.join(ROOT, 'test-fixtures', 'report.pdf'));
    
    // Check fields before merge
    const fieldsBefore = await engine('getFormFields', docId);
    console.log('Fields in report.pdf: ' + fieldsBefore.value.length);
    
    // Merge form.pdf
    await engine('merge', docId, [path.join(ROOT, 'test-fixtures', 'form.pdf')], 'after');
    
    // Check fields after merge
    const fieldsAfter = await engine('getFormFields', docId);
    console.log('Fields after merge: ' + fieldsAfter.value.length);
    
    // The merged document should have form fields from form.pdf
    if (fieldsAfter.value.length === 0) {
      console.log('  ** Finding: Form fields lost during merge into report.pdf');
    }
    
    // Try save on the merged doc
    const tmpDir = path.join(os.tmpdir(), 'tflex-adv-merge-form-' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    const copyPath = path.join(tmpDir, 'merged-output.pdf');
    fs.copyFileSync(path.join(ROOT, 'test-fixtures', 'report.pdf'), copyPath);
    
    // Actually we need to reload from copy to save. Let's just check state.
    console.log('  State: pageCount=' + fieldsAfter.value.length + ', the engine has ' + 
      (docId ? 'the merged doc' : 'no doc'));
  }
  
  // ===================================================================
  // TEST: Duplicate signatures on same page
  // ===================================================================
  console.log('\n=== Multiple signatures on same page ===');
  {
    const docId = 'multi-sig';
    await engine('loadDocument', docId, path.join(ROOT, 'test-fixtures', 'report.pdf'));
    
    const tinyPng = new Uint8Array([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,
      0x00,0x00,0x00,0x0D,0x49,0x48,0x44,0x52,0x00,0x00,0x00,0x01,0x00,0x00,
      0x00,0x01,0x08,0x02,0x00,0x00,0x00,0x90,0x77,0x53,0xDE,0x00,0x00,0x00,
      0x0C,0x49,0x44,0x41,0x54,0x08,0xD7,0x63,0x60,0x60,0x00,0x00,0x00,0x04,
      0x00,0x01,0x27,0x34,0x27,0x2C,0x00,0x00,0x00,0x00,0x49,0x45,0x4E,0x44,
      0xAE,0x42,0x60,0x82]);
    
    // Place 5 signatures
    for (let i = 0; i < 5; i++) {
      const r = await engine('placeSignature', docId, {
        id: 'sig-' + i, signatureId: 'src-' + i, page: 1,
        rect: { x: 50 + i * 30, y: 700 - i * 20, width: 100, height: 40 },
        pngBytes: tinyPng
      });
      if (!r.ok) {
        console.log('  Place sig ' + i + ' failed: ' + r.error.code);
        break;
      }
    }
    
    const state = await engine('getState', docId);
    console.log('Placed signatures: ' + state.value.placedSignatures.length);
    
    // Delete one
    await engine('deleteSignature', docId, 'sig-2');
    const state2 = await engine('getState', docId);
    console.log('After delete sig-2: ' + state2.value.placedSignatures.length);
    
    // Undo
    await engine('undo', docId);
    const state3 = await engine('getState', docId);
    console.log('After undo: ' + state3.value.placedSignatures.length);
    
    if (state3.value.placedSignatures.length !== 5) {
      console.log('  ** Finding: Undo did not properly restore signature deletion');
    }
  }

  // ===================================================================
  // TEST: Fill form field after page reorder
  // ===================================================================
  console.log('\n=== Fill form after reorder ===');
  {
    const docId = 'reorder-form';
    await engine('loadDocument', docId, path.join(ROOT, 'test-fixtures', 'form.pdf'));
    
    // The form has all fields on page 1. Since there's only 1 page, reorder doesn't make sense.
    // Let's merge first to have more pages
    await engine('merge', docId, [path.join(ROOT, 'test-fixtures', 'report.pdf')], 'before');
    let fields = await engine('getFormFields', docId);
    console.log('Fields after merge: ' + fields.value.length);
    
    // Fill form fields (they should be on page 34 now - the last page)
    if (fields.value.length > 0) {
      // Find the first field's page
      const field = fields.value[0];
      console.log('First field "' + field.name + '" is on page ' + field.page);
      
      // Fill it
      const fillResult = await engine('fillFormField', docId, { id: field.id, value: 'After Reorder Test' });
      console.log('Fill after reorder: ok=' + fillResult.ok);
      
      // Delete the page the form is on (page 34)
      await engine('applyOp', docId, { kind: 'delete', page: 34 });
      fields = await engine('getFormFields', docId);
      console.log('Fields after page 34 deleted: ' + fields.value.length);
      if (fields.value.length > 0) {
        console.log('  ** Finding: Form fields on page 34 still present after deleting page 34!');
      }
    }
  }

  // ===================================================================
  // TEST: Rapid annotation create/delete cycle
  // ===================================================================
  console.log('\n=== Rapid annotation create/delete stress ===');
  {
    const docId = 'rapid-ann';
    await engine('loadDocument', docId, path.join(ROOT, 'test-fixtures', 'report.pdf'));
    
    // Create and immediately delete 50 annotations
    for (let i = 0; i < 20; i++) {
      const createResult = await engine('createAnnotation', docId, {
        id: 'rapid-' + i, kind: 'highlight', page: 1,
        rects: [{ x: i * 10, y: 700, width: 50, height: 20 }], color: 'yellow'
      });
      if (createResult.ok) {
        const anns = createResult.value.annotations;
        if (anns && anns.length > 0) {
          const annId = anns[anns.length - 1].id;
          await engine('deleteAnnotation', docId, annId);
        }
      }
    }
    
    const finalState = await engine('getState', docId);
    console.log('After 20 create/delete cycles: annotations=' + 
      (finalState.value.annotations ? finalState.value.annotations.length : 0));
    
    // Undo should restore all of them
    let undoneCount = 0;
    for (let i = 0; i < 25; i++) {
      const r = await engine('undo', docId);
      if (r.ok) undoneCount++;
      else break;
    }
    console.log('Undos performed: ' + undoneCount);
    const afterUndo = await engine('getState', docId);
    console.log('Annotations after undo: ' + 
      (afterUndo.value.annotations ? afterUndo.value.annotations.length : 0));
    
    if (undoneCount !== 40) {
      console.log('  Note: Expected 40 undos (20 creates + 20 deletes), got ' + undoneCount);
    }
  }

  // ===================================================================
  // TEST: Zero-byte PDF via loadDocumentBytes
  // ===================================================================
  console.log('\n=== Zero-byte load ===');
  {
    try {
      const result = await engine('loadDocumentBytes', 'zero-bytes', new Uint8Array(0));
      console.log('Zero bytes: ok=' + result.ok + ', err=' + (result.error ? result.error.code : 'none'));
      if (result.ok) {
        console.log('  ** Finding: Zero-byte buffer loaded successfully as PDF!');
        const state = await engine('getState', 'zero-bytes');
        console.log('  pageCount=' + (state.ok ? state.value.pageCount : 'N/A'));
      }
    } catch (err) {
      console.log('Zero bytes CRASH: ' + String(err).substring(0, 200));
    }
  }
  
  // ===================================================================
  // TEST: Null/undefined IPC args
  // ===================================================================
  console.log('\n=== Null/undefined IPC args ===');
  {
    try {
      const r = await win.evaluate(() => window.tflex.engine.applyOp('non-existent-id', null));
      console.log('applyOp null: ' + JSON.stringify(r));
    } catch (err) {
      console.log('applyOp null CRASH: ' + String(err).substring(0, 200));
    }
    
    try {
      const r = await win.evaluate(() => window.tflex.engine.getState(undefined));
      console.log('getState undefined: ' + JSON.stringify(r));
    } catch (err) {
      console.log('getState undefined CRASH: ' + String(err).substring(0, 200));
    }
    
    try {
      const r = await win.evaluate(() => window.tflex.engine.loadDocument('', ''));
      console.log('loadDocument empty paths: ' + JSON.stringify(r));
    } catch (err) {
      console.log('loadDocument empty paths CRASH: ' + String(err).substring(0, 200));
    }
  }

  await app.close();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
