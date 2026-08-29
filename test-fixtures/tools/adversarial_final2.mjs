/**
 * Adversarial Final Pass — Part 2: Deep investigation of specific findings.
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
  // FINDING 1: Place signature on 0-page doc succeeds
  // ===================================================================
  console.log('=== Finding: Place signature on 0-page doc ===');
  {
    const docId = 'zero-sig';
    await engine('loadDocument', docId, path.join(ROOT, 'test-fixtures', 'encrypted-looking.pdf'));
    const state = await engine('getState', docId);
    console.log('Page count: ' + state.value.pageCount);

    const tinyPng = new Uint8Array([
      0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A,0x00,0x00,0x00,0x0D,0x49,0x48,0x44,0x52,
      0x00,0x00,0x00,0x01,0x00,0x00,0x00,0x01,0x08,0x02,0x00,0x00,0x00,0x90,0x77,0x53,
      0xDE,0x00,0x00,0x00,0x0C,0x49,0x44,0x41,0x54,0x08,0xD7,0x63,0x60,0x60,0x00,0x00,
      0x00,0x04,0x00,0x01,0x27,0x34,0x27,0x2C,0x00,0x00,0x00,0x00,0x49,0x45,0x4E,0x44,
      0xAE,0x42,0x60,0x82
    ]);
    const sigResult = await engine('placeSignature', docId, {
      id: 'sig-on-zero', signatureId: 's1', page: 1,
      rect: { x: 0, y: 0, width: 10, height: 10 },
      pngBytes: tinyPng
    });
    console.log('Place signature (page=1 in 0-page doc): ok=' + sigResult.ok);
    if (sigResult.ok) {
      const stateWithSig = sigResult.value;
      const placements = stateWithSig.placedSignatures;
      console.log('  placedSignatures count: ' + (placements ? placements.length : 'undefined'));
      console.log('  ** Finding: Signature placed on non-existent page 1 in a 0-page document');
    }
  }

  // ===================================================================
  // FINDING 2: Flatten undo does not restore form fields
  // ===================================================================
  console.log('\n=== Finding: Flatten undo form field destruction ===');
  {
    const docId = 'flatten-undo-test';
    await engine('loadDocument', docId, path.join(ROOT, 'test-fixtures', 'form.pdf'));

    // Fill a field
    await engine('fillFormField', docId, { id: 'form-0-applicant_name', value: 'Alice' });

    const fieldsBefore = await engine('getFormFields', docId);
    console.log('Fields before flatten: ' + fieldsBefore.value.length);

    // Flatten
    const flatten = await engine('flattenForms', docId);
    console.log('Flatten: ok=' + flatten.ok);

    // After flatten
    const fieldsAfter = await engine('getFormFields', docId);
    console.log('Fields after flatten: ' + fieldsAfter.value.length);

    // Undo the flatten
    const undo1 = await engine('undo', docId);
    console.log('Undo 1 (flatten): ok=' + undo1.ok);
    const fieldsAfterUndo1 = await engine('getFormFields', docId);
    console.log('Fields after undo 1: ' + fieldsAfterUndo1.value.length);

    // Undo the fill
    const undo2 = await engine('undo', docId);
    console.log('Undo 2 (fill): ok=' + undo2.ok);
    const fieldsAfterUndo2 = await engine('getFormFields', docId);
    console.log('Fields after undo 2: ' + fieldsAfterUndo2.value.length);

    if (fieldsAfterUndo2.value.length < 8) {
      console.log('  ** Finding: Flatten undo permanently destroyed form fields!');
    }
  }

  // ===================================================================
  // FINDING 3: Merge report.pdf with itself multiple times
  // ===================================================================
  console.log('\n=== Finding: Repeated self-merge ===');
  {
    const docId = 'self-merge';
    const reportPath = path.join(ROOT, 'test-fixtures', 'report.pdf');
    await engine('loadDocument', docId, reportPath);
    let state = await engine('getState', docId);
    console.log('Initial: ' + state.value.pageCount + ' pages');

    // Merge the same file 5 times
    for (let i = 0; i < 5; i++) {
      const result = await engine('merge', docId, [reportPath], 'after');
      if (result.ok) {
        console.log('  Merge ' + (i+1) + ': ' + result.value.pageCount + ' pages');
      } else {
        console.log('  Merge ' + (i+1) + ' failed: ' + result.error.code);
        break;
      }
    }
  }

  // ===================================================================
  // FINDING 4: Fill form then split preserves fields?
  // ===================================================================
  console.log('\n=== Finding: Split form with filled values ===');
  {
    const docId = 'split-form';
    await engine('loadDocument', docId, path.join(ROOT, 'test-fixtures', 'form.pdf'));

    // Fill fields
    await engine('fillFormField', docId, { id: 'form-0-applicant_name', value: 'Bob' });
    await engine('fillFormField', docId, { id: 'form-0-applicant_address', value: '123 Main St' });

    const fillState = await engine('getState', docId);
    // The form page is page 1. Split page 1 out
    const splitResult = await engine('split', docId, [0, 0]);
    if (splitResult.ok) {
      console.log('Split page 1 from form: ok, split doc has bytes');
      const stateAfter = await engine('getState', docId);
      console.log('Source after split: ' + stateAfter.value.pageCount + ' pages');
      console.log('Source modified: ' + stateAfter.value.modified);
      // The source should have 0 pages (only 1 page in form.pdf)
      if (stateAfter.value.pageCount === 0) {
        console.log('  ** Defect: source after split has 0 pages');
      }
    } else {
      console.log('Split error: ' + splitResult.error.code + ' - ' + splitResult.error.message);
    }
  }

  // ===================================================================
  // FINDING 5: ApplyOp after engine-load replace resource use
  // ===================================================================
  console.log('\n=== Finding: Multiple load cycles ===');
  {
    for (let cycle = 0; cycle < 10; cycle++) {
      const docId = 'cycle-' + cycle;
      await engine('loadDocument', docId, path.join(ROOT, 'test-fixtures', 'report.pdf'));
      const state = await engine('getState', docId);
      if (!state.ok || state.value.pageCount !== 34) {
        console.log('Cycle ' + cycle + ': pageCount=' + (state.ok ? state.value.pageCount : 'ERROR'));
      }
    }
    console.log('10 load/unload cycles completed without error');
  }

  // ===================================================================
  // FINDING 6: Rename same docId (reload into same ID)
  // ===================================================================
  console.log('\n=== Finding: Replace doc in same docId ===');
  {
    const docId = 'reused';
    await engine('loadDocument', docId, path.join(ROOT, 'test-fixtures', 'report.pdf'));
    let state = await engine('getState', docId);
    console.log('Initial: ' + state.value.pageCount + ' pages');
    
    // Apply some ops
    await engine('applyOp', docId, { kind: 'rotate-cw', page: 0 });
    await engine('applyOp', docId, { kind: 'delete', page: 0 });
    state = await engine('getState', docId);
    console.log('After mods: ' + state.value.pageCount + ' pages');
    
    // Now load a completely different doc into the same docId
    await engine('loadDocument', docId, path.join(ROOT, 'test-fixtures', 'form.pdf'));
    state = await engine('getState', docId);
    console.log('After reload with form.pdf: ' + state.value.pageCount + ' pages, modified=' + state.value.modified);
    
    // Undo should be empty (new document)
    const undoResult = await engine('undo', docId);
    console.log('Undo after reload: ok=' + undoResult.ok + ', err=' + (undoResult.error ? undoResult.error.code : 'none'));
    if (undoResult.ok) {
      console.log('  ** Finding: Undo after doc reload returned ok (should be nothing-to-undo)');
    }
  }

  await app.close();
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
