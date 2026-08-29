#!/usr/bin/env node
/**
 * Adversarial Final Pass — exercises EVERY feature against hostile sequences.
 *
 * Session: final
 * Runs against the production Electron build via Playwright.
 */

import { _electron as electron } from 'playwright';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const FIXTURES = path.join(ROOT, 'test-fixtures');
const SCREENSHOTS = path.join(ROOT, 'screenshots');
const HOSTILE_FIXTURES = [
  'zero.pdf', 'truncated.pdf', 'corrupted.pdf', 'not-a-pdf.txt',
  'encrypted.pdf', 'encrypted-looking.pdf', 'no-trailer.pdf',
  'broken-pagetree.pdf', 'no-kids.pdf', 'huge-images.pdf',
  'circular-refs.pdf', 'malformed-xref.pdf', 'infinite-loop-pagetree.pdf',
];

// Ensure screenshot dir
if (!fs.existsSync(SCREENSHOTS)) fs.mkdirSync(SCREENSHOTS, { recursive: true });

// Track findings
const findings = [];

function record(id, title, what, expected, actual, severity, screenshotName = null) {
  finding = {
    id, title, what, expected, actual, severity, screenshot: screenshotName
  };
  findings.push(finding);
  console.log(`\n*** FINDING ${id}: ${title} [${severity}]`);
  console.log(`  What: ${what}`);
  console.log(`  Expected: ${expected}`);
  console.log(`  Actual: ${actual}`);
}

let finding = null;

function getSamplePath(name) {
  const src = path.join(ROOT, 'assets', 'samples', name);
  const tmp = path.join(os.tmpdir(), 'tflex-adv-final', `${Date.now()}-${name}`);
  if (!fs.existsSync(path.dirname(tmp))) fs.mkdirSync(path.dirname(tmp), { recursive: true });
  fs.copyFileSync(src, tmp);
  return tmp;
}

function tempPath(name) {
  const tmp = path.join(os.tmpdir(), 'tflex-adv-final', `${Date.now()}-${name}`);
  if (!fs.existsSync(path.dirname(tmp))) fs.mkdirSync(path.dirname(tmp), { recursive: true });
  return tmp;
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const mainPath = path.join(ROOT, 'dist', 'main', 'index.js');
  if (!fs.existsSync(mainPath)) {
    console.error('Build first: npm run build');
    process.exit(1);
  }

  console.log('=== Launching TFlex for adversarial final pass ===\n');

  const app = await electron.launch({
    args: [ROOT],
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: pathToFileURL(
        path.join(ROOT, 'dist', 'renderer', 'index.html')
      ).href,
    },
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await sleep(1000);

  // Helper to get engine API
  async function engine(method, ...args) {
    return await win.evaluate(([m, a]) => {
      return window.tflex.engine[m](...a);
    }, [method, args]);
  }

  async function getState(docId) {
    return await engine('getState', docId);
  }

  async function getDiag() {
    return await win.evaluate(() => {
      if (typeof window.tflexDiagnostics === 'function') return window.tflexDiagnostics();
      return null;
    });
  }

  async function screenshot(name) {
    await win.screenshot({ path: path.join(SCREENSHOTS, name) });
  }

  // ===========================================================================
  // TEST 1: Load ALL hostile PDFs and verify none crash the app
  // ===========================================================================
  console.log('\n--- Test 1: Load hostile PDFs ---');
  
  // First check if fixtrues exist
  const fixturePaths = {};
  for (const name of HOSTILE_FIXTURES) {
    const fp = path.join(FIXTURES, name);
    if (fs.existsSync(fp)) {
      fixturePaths[name] = fp;
    } else {
      console.log(`  SKIP: ${name} not found`);
    }
  }

  for (const [name, fp] of Object.entries(fixturePaths)) {
    const docId = `hostile-${name.replace(/\./g, '-')}`;
    try {
      const result = await engine('loadDocument', docId, fp);
      const state = result.ok ? await getState(docId) : null;
      console.log(`  ${name}: ok=${result.ok}, state=${state ? state.pageCount : 'N/A'}`);
      if (!result.ok) {
        // Expected failure for corrupt files - this is fine
        console.log(`    -> Error: ${result.error.code}`);
      }
    } catch (err) {
      // UNHANDLED error = finding!
      const errStr = String(err);
      console.log(`  ${name}: CRASH/UNHANDLED: ${errStr.substring(0, 200)}`);
      await screenshot('adv-crash-' + name.replace(/\./g, '-') + '.png');
      record(
        `ADV-0${13 + Object.keys(fixturePaths).indexOf(name)}`.substring(0,7),
        `Hostile PDF "${name}" causes unhandled error/crash`,
        `Load "${name}" via engine.loadDocument`,
        'Engine should return a typed Result error (or succeed for valid-ish files)',
        `Unhandled error: ${errStr.substring(0, 200)}`,
        'MEDIUM',
        `adv-crash-${name.replace(/\./g, '-')}.png`
      );
    }
  }

  // ===========================================================================
  // TEST 2: Annotation lifecycle — create all types, edit, delete, undo, redo
  // ===========================================================================
  console.log('\n--- Test 2: Annotation lifecycle ---');
  const annDocId = 'ann-test';
  const annDocPath = getSamplePath('report.pdf');
  let annResult = await engine('loadDocument', annDocId, annDocPath);
  if (annResult.ok) {
    const annTypes = [
      { kind: 'highlight', page: 1, rects: [{ x: 100, y: 700, width: 200, height: 20 }], color: 'yellow' },
      { kind: 'underline', page: 1, rects: [{ x: 100, y: 680, width: 150, height: 20 }], color: 'green' },
      { kind: 'strikeout', page: 1, rects: [{ x: 100, y: 660, width: 180, height: 20 }], color: 'red' },
      { kind: 'note', page: 2, at: { x: 300, y: 500 }, color: 'blue', content: 'Test note content' },
      { kind: 'ink', page: 2, points: [{ x: 100, y: 400 }, { x: 150, y: 450 }, { x: 200, y: 420 }], color: 'purple', width: 2 },
      { kind: 'rect', page: 3, rects: [{ x: 200, y: 600, width: 100, height: 80 }], color: 'orange' },
      { kind: 'ellipse', page: 3, rects: [{ x: 200, y: 500, width: 80, height: 60 }], color: 'cyan' },
      { kind: 'arrow', page: 3, from: { x: 100, y: 400 }, to: { x: 300, y: 350 }, color: 'magenta', lineEnds: ['OpenArrow', 'None'] },
      { kind: 'text-box', page: 4, rects: [{ x: 100, y: 700, width: 200, height: 50 }], color: 'yellow', content: 'TextBox text' },
    ];

    // Create all annotation types
    const createdIds = [];
    for (const ann of annTypes) {
      try {
        const result = await engine('createAnnotation', annDocId, { id: `ann-${Date.now()}-${Math.random()}`, ...ann });
        if (result.ok) {
          const state = result.value;
          const flat = state.annotations || [];
          createdIds.push(flat[flat.length - 1].id);
        }
      } catch (err) {
        console.log(`  Create ${ann.kind}: CRASH: ${String(err).substring(0, 100)}`);
        await screenshot('adv-ann-create-' + ann.kind + '.png');
        record(
          `ADV-02${annTypes.indexOf(ann)}`,
          `Creating annotation type "${ann.kind}" throws unhandled error`,
          `engine.createAnnotation with kind=${ann.kind}`,
          'Typed Result with proper error or success',
          `Unhandled error: ${String(err).substring(0, 100)}`,
          'MEDIUM',
          `adv-ann-create-${ann.kind}.png`
        );
      }
    }

    // Edit the first annotation
    if (createdIds.length > 0) {
      try {
        const editResult = await engine('editAnnotation', annDocId, createdIds[0], { color: 'red', content: 'Edited content' });
        if (editResult.ok) {
          console.log(`  Edit annotation: OK`);
        }
      } catch (err) {
        console.log(`  Edit annotation: CRASH: ${String(err).substring(0, 100)}`);
      }
    }

    // Delete annotation
    if (createdIds.length > 0) {
      try {
        const delResult = await engine('deleteAnnotation', annDocId, createdIds[0]);
        if (delResult.ok) {
          console.log(`  Delete annotation: OK`);
        }
      } catch (err) {
        console.log(`  Delete annotation: CRASH: ${String(err).substring(0, 100)}`);
      }

      // Delete same annotation again — should return not-found
      try {
        const delResult2 = await engine('deleteAnnotation', annDocId, createdIds[0]);
        if (delResult2.ok) {
          console.log(`  Delete already-deleted annotation: ok=true (should be not-found!)`);
          await screenshot('adv-ann-delete-twice.png');
          record(
            'ADV-018',
            'Deleting same annotation twice returns ok instead of not-found',
            'Call engine.deleteAnnotation twice with same ID',
            'Second call should return {ok:false, error:{code:"not-found"}}',
            'Both calls return ok=true',
            'MEDIUM',
            'adv-ann-delete-twice.png'
          );
        }
      } catch (err) {
        console.log(`  Double-delete annotation: CRASH: ${String(err).substring(0, 100)}`);
      }
    }

    // Undo annotation operations
    try {
      const preUndo = await getState(annDocId);
      let undoOk = false;
      for (let i = 0; i < 5; i++) {
        const u = await engine('undo', annDocId);
        if (u.ok) undoOk = true;
        else break;
      }
      console.log(`  Undo annotations: ${undoOk ? 'worked' : 'nothing to undo'}`);
    } catch (err) {
      console.log(`  Undo annotations: CRASH: ${String(err).substring(0, 100)}`);
    }
  }

  // ===========================================================================
  // TEST 3: Form field interactions — fill, flatten, save
  // ===========================================================================
  console.log('\n--- Test 3: Form field lifecycle ---');
  const formDocId = 'form-test';
  const formDocPath = getSamplePath('form.pdf');
  let formResult = await engine('loadDocument', formDocId, formDocPath);
  if (formResult.ok) {
    // Get form fields
    try {
      const fieldsResult = await engine('getFormFields', formDocId);
      if (fieldsResult.ok) {
        const fields = fieldsResult.value;
        console.log(`  Form fields: ${fields.length}`);
        
        // Fill all text fields
        for (const field of fields) {
          if (field.kind === 'text') {
            try {
              const fillResult = await engine('fillFormField', formDocId, { id: field.id, value: 'Adversarial Test' });
              if (fillResult.ok) {
                console.log(`  Fill "${field.name}": OK`);
              }
            } catch (err) {
              console.log(`  Fill "${field.name}": CRASH: ${String(err).substring(0, 100)}`);
            }
          }
        }

        // Flatten forms
        try {
          const flatResult = await engine('flattenForms', formDocId);
          if (flatResult.ok) {
            const stateAfter = flatResult.value;
            console.log(`  Flatten forms: OK, modified=${stateAfter.modified}`);
            
            // After flatten, getFormFields should return empty list
            const fieldsAfter = await engine('getFormFields', formDocId);
            if (fieldsAfter.ok && fieldsAfter.value.length > 0) {
              console.log(`  Flatten: fields still present (${fieldsAfter.value.length}) after flatten!`);
              await screenshot('adv-flatten-fields-persist.png');
              record(
                'ADV-019',
                'Form fields persist after flattenForms',
                'Call flattenForms on form.pdf, then getFormFields',
                'getFormFields should return empty array after flatten',
                `${fieldsAfter.value.length} fields still present after flatten`,
                'HIGH',
                'adv-flatten-fields-persist.png'
              );
            }
          }
        } catch (err) {
          console.log(`  Flatten forms: CRASH: ${String(err).substring(0, 100)}`);
          await screenshot('adv-flatten-crash.png');
          record(
            'ADV-020',
            'flattenForms throws unhandled error',
            'Call engine.flattenForms on form.pdf',
            'Typed Result success or error',
            `Unhandled error: ${String(err).substring(0, 100)}`,
            'HIGH',
            'adv-flatten-crash.png'
          );
        }

        // Undo after flatten
        try {
          const undoAfterFlatten = await engine('undo', formDocId);
          console.log(`  Undo after flatten: ${undoAfterFlatten.ok ? 'OK' : undoAfterFlatten.error?.code}`);
        } catch (err) {
          console.log(`  Undo after flatten: CRASH: ${String(err).substring(0, 100)}`);
        }
      }
    } catch (err) {
      console.log(`  getFormFields: CRASH: ${String(err).substring(0, 100)}`);
      await screenshot('adv-formfields-crash.png');
      record(
        'ADV-021',
        'getFormFields throws unhandled error on form.pdf',
        'Call engine.getFormFields on form.pdf',
        'Typed Result with FormField[]',
        `Unhandled error: ${String(err).substring(0, 100)}`,
        'HIGH',
        'adv-formfields-crash.png'
      );
    }
  }

  // ===========================================================================
  // TEST 4: Signature lifecycle — place, move, delete, reuse, undo
  // ===========================================================================
  console.log('\n--- Test 4: Signature lifecycle ---');
  const sigDocId = 'sig-test';
  const sigDocPath = getSamplePath('report.pdf');
  let sigResult = await engine('loadDocument', sigDocId, sigDocPath);
  if (sigResult.ok) {
    // Create a fake PNG to use as signature (tiny 1x1 pixel)
    const tinyPng = Buffer.from([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG header
      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, // IHDR
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
      0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41, // IDAT
      0x54, 0x08, 0xD7, 0x63, 0x60, 0x60, 0x00, 0x00,
      0x00, 0x04, 0x00, 0x01, 0x27, 0x34, 0x27, 0x2C,
      0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E, 0x44, // IEND
      0xAE, 0x42, 0x60, 0x82
    ]);

    // Place a signature
    try {
      const placeResult = await engine('placeSignature', sigDocId, {
        id: 'sig-1',
        signatureId: 'saved-sig-1',
        page: 1,
        rect: { x: 100, y: 700, width: 150, height: 50 },
        pngBytes: new Uint8Array(tinyPng),
      });
      if (placeResult.ok) {
        console.log(`  Place signature: OK`);
        const stateWithSig = placeResult.value;
        if (!stateWithSig.placedSignatures || stateWithSig.placedSignatures.length === 0) {
          await screenshot('adv-signature-not-in-state.png');
          record(
            'ADV-022',
            'Placed signature not reflected in engine state',
            'engine.placeSignature returns ok, but state has no placedSignatures',
            'State should include the placed signature in the placedSignatures array',
            'placedSignatures is empty/missing in returned state',
            'MEDIUM',
            'adv-signature-not-in-state.png'
          );
        }
      }
    } catch (err) {
      console.log(`  Place signature: CRASH: ${String(err).substring(0, 100)}`);
      await screenshot('adv-sig-place-crash.png');
      record(
        'ADV-023',
        'placeSignature throws unhandled error',
        'Call engine.placeSignature with valid parameters',
        'Typed Result success',
        `Unhandled error: ${String(err).substring(0, 100)}`,
        'HIGH',
        'adv-sig-place-crash.png'
      );
    }

    // Move the signature
    try {
      const moveResult = await engine('moveSignature', sigDocId, {
        id: 'sig-1',
        page: 2,
        rect: { x: 200, y: 600, width: 100, height: 40 },
      });
      console.log(`  Move signature: ${moveResult.ok ? 'OK' : moveResult.error?.code}`);
    } catch (err) {
      console.log(`  Move signature: CRASH: ${String(err).substring(0, 100)}`);
    }

    // Move non-existent sig
    try {
      const moveBad = await engine('moveSignature', sigDocId, {
        id: 'nonexistent-sig',
        page: 1,
        rect: { x: 0, y: 0, width: 10, height: 10 },
      });
      if (moveBad.ok) {
        console.log(`  Move non-existent signature: ok=true (should be not-found!)`);
        await screenshot('adv-sig-move-nonexistent.png');
        record(
          'ADV-024',
          'Moving a non-existent signature returns ok instead of not-found',
          'engine.moveSignature with non-existent id',
          'Result with error code "not-found"',
          'ok=true returned',
          'LOW',
          'adv-sig-move-nonexistent.png'
        );
      } else {
        console.log(`  Move non-existent signature: ${moveBad.error?.code} (correct)`);
      }
    } catch (err) {
      console.log(`  Move non-existent signature: CRASH: ${String(err).substring(0, 100)}`);
    }

    // Delete the signature
    try {
      const delSigResult = await engine('deleteSignature', sigDocId, 'sig-1');
      console.log(`  Delete signature: ${delSigResult.ok ? 'OK' : delSigResult.error?.code}`);
    } catch (err) {
      console.log(`  Delete signature: CRASH: ${String(err).substring(0, 100)}`);
    }

    // Delete non-existent sig
    try {
      const delBad = await engine('deleteSignature', sigDocId, 'nonexistent');
      if (delBad.ok) {
        console.log(`  Delete non-existent signature: ok=true (should be not-found!)`);
        await screenshot('adv-sig-delete-nonexistent.png');
        record(
          'ADV-025',
          'Deleting a non-existent signature returns ok instead of not-found',
          'engine.deleteSignature with non-existent id',
          'Result with error code "not-found"',
          'ok=true returned',
          'LOW',
          'adv-sig-delete-nonexistent.png'
        );
      } else {
        console.log(`  Delete non-existent signature: ${delBad.error?.code} (correct)`);
      }
    } catch (err) {
      console.log(`  Delete non-existent signature: CRASH: ${String(err).substring(0, 100)}`);
    }
  }

  // ===========================================================================
  // TEST 5: Merge a hostile/damaged file
  // ===========================================================================
  console.log('\n--- Test 5: Merge with hostile PDF ---');
  const mergeDocId = 'merge-test';
  const mergeDocPath = getSamplePath('report.pdf');
  let mergeResult = await engine('loadDocument', mergeDocId, mergeDocPath);
  if (mergeResult.ok) {
    for (const [name, fp] of Object.entries(fixturePaths)) {
      if (name === 'zero.pdf' || name === 'not-a-pdf.txt') {
        console.log(`  Merge with ${name}: testing...`);
        try {
          const result = await engine('merge', mergeDocId, [fp], 'after');
          console.log(`  Merge ${name}: ok=${result.ok}, err=${result.error?.code || 'none'}`);
        } catch (err) {
          const errStr = String(err);
          console.log(`  Merge ${name}: CRASH: ${errStr.substring(0, 100)}`);
          await screenshot('adv-merge-' + name.replace(/\./g, '-') + '.png');
          record(
            'ADV-026',
            `Merge with hostile PDF "${name}" causes unhandled error/crash`,
            `engine.merge with ${name}`,
            'Typed Result error (engine-error or similar)',
            `Unhandled error: ${errStr.substring(0, 100)}`,
            'MEDIUM',
            `adv-merge-${name.replace(/\./g, '-')}.png`
          );
        }
      }
    }
  }

  // ===========================================================================
  // TEST 6: Save to locked/read-only destination
  // ===========================================================================
  console.log('\n--- Test 6: Save to locked destination ---');
  const saveDocId = 'save-test';
  const saveDocPath = getSamplePath('report.pdf');
  let saveResult = await engine('loadDocument', saveDocId, saveDocPath);
  if (saveResult.ok) {
    // Make a quick modification
    await engine('applyOp', saveDocId, { kind: 'rotate-cw', page: 0 });

    // Create a read-only directory
    const readonlyDir = tempPath('readonly-test');
    fs.mkdirSync(readonlyDir, { recursive: true });
    const readonlyFile = path.join(readonlyDir, 'output.pdf');
    fs.writeFileSync(readonlyFile, new Uint8Array([0]));
    fs.chmodSync(readonlyFile, 0o444);

    try {
      const saveAsResult = await engine('saveAs', saveDocId, readonlyFile);
      console.log(`  SaveAs to read-only: ok=${saveAsResult.ok}, err=${saveAsResult.error?.code || 'none'}`);
      if (saveAsResult.ok) {
        await screenshot('adv-saveas-readonly-ok.png');
        record(
          'ADV-027',
          'SaveAs to a read-only destination returns ok instead of write-error',
          'engine.saveAs to a file with read-only permissions',
          'Result with error code "write-error"',
          'ok=true returned despite read-only destination',
          'HIGH',
          'adv-saveas-readonly-ok.png'
        );
      } else {
        console.log(`  -> Correctly rejected with: ${saveAsResult.error?.code}`);
      }
    } catch (err) {
      console.log(`  SaveAs read-only: CRASH: ${String(err).substring(0, 100)}`);
    }
  }

  // ===========================================================================
  // TEST 7: Rapid operations sequence (race surface)
  // ===========================================================================
  console.log('\n--- Test 7: Rapid operations (race condition stress) ---');
  const raceDocId = 'race-test';
  const raceDocPath = getSamplePath('long.pdf');
  let raceResult = await engine('loadDocument', raceDocId, raceDocPath);
  if (raceResult.ok) {
    // Fire 10 operations concurrently without awaiting each
    const ops = [];
    for (let i = 0; i < 10; i++) {
      ops.push(engine('applyOp', raceDocId, { kind: 'rotate-cw', page: i }));
    }
    try {
      const results = await Promise.all(ops);
      const okCount = results.filter(r => r.ok).length;
      const errCount = results.filter(r => !r.ok).length;
      console.log(`  Rapid 10 rotate: ${okCount} ok, ${errCount} errors`);
      
      const finalState = await getState(raceDocId);
      console.log(`  Final pageCount: ${finalState.pageCount}`);

      if (finalState.pageCount !== 520) {
        await screenshot('adv-race-pagecount-changed.png');
        record(
          'ADV-028',
          'Rapid concurrent operations cause page count corruption',
          'Fire 10 applyOp calls concurrently without await, then check page count',
          'pageCount should remain 520 (rotations should not change page count)',
          `pageCount is ${finalState.pageCount} (expected 520)`,
          'MEDIUM',
          'adv-race-pagecount-changed.png'
        );
      }
    } catch (err) {
      console.log(`  Rapid ops: CRASH: ${String(err).substring(0, 100)}`);
    }
  }

  // ===========================================================================
  // TEST 8: Split + Extract with edge cases
  // ===========================================================================
  console.log('\n--- Test 8: Split/Extract edge cases ---');
  const splitDocId = 'split-test';
  const splitDocPath = getSamplePath('report.pdf');
  let splitResult = await engine('loadDocument', splitDocId, splitDocPath);
  if (splitResult.ok) {
    // Try split on a single page at the start (should fail with 0-page removal)
    try {
      const splitSingle = await engine('split', splitDocId, [0, 0]);
      console.log(`  Split single page [0,0]: ok=${splitSingle.ok}, err=${splitSingle.error?.code || 'none'}`);
      if (splitSingle.ok) {
        // If it succeeded, we may have gone from 34 to 33 pages, the split doc has 1 page
        const stateAfter = await getState(splitDocId);
        if (stateAfter.pageCount === 0) {
          console.log('  -> Source is now 0 pages!');
          await screenshot('adv-split-single.png');
        }
      }
    } catch (err) {
      console.log(`  Split [0,0]: CRASH: ${String(err).substring(0, 100)}`);
    }

    // Try extract with empty page list
    try {
      const extractEmpty = await engine('extract', splitDocId, []);
      console.log(`  Extract empty pages: ok=${extractEmpty.ok}, err=${extractEmpty.error?.code || 'none'}`);
      if (extractEmpty.ok) {
        // An empty extract returns bytes of... what? Should be empty PDF?
        await screenshot('adv-extract-empty.png');
        record(
          'ADV-029',
          'Extract with empty page list returns ok instead of error',
          'engine.extract with empty pages array',
          'Result with error code (empty-range or similar)',
          'ok=true returned an empty/new PDF',
          'LOW',
          'adv-extract-empty.png'
        );
      }
    } catch (err) {
      console.log(`  Extract empty: CRASH: ${String(err).substring(0, 100)}`);
    }
  }

  // ===========================================================================
  // TEST 9: Document ops after one document is closed/replaced
  // ===========================================================================
  console.log('\n--- Test 9: Operations on stale docId ---');
  const staleDocId = 'stale-test';
  const stalePath = getSamplePath('report.pdf');
  await engine('loadDocument', staleDocId, stalePath);
  // Reload a new doc into the same docId (replaces)
  await engine('loadDocument', staleDocId, getSamplePath('long.pdf'));
  // Now try ops on the old docId
  try {
    const opResult = await engine('applyOp', staleDocId, { kind: 'rotate-cw', page: 0 });
    console.log(`  Op on replaced docId: ok=${opResult.ok}, err=${opResult.error?.code || 'none'}`);
  } catch (err) {
    console.log(`  Op on replaced docId: CRASH: ${String(err).substring(0, 100)}`);
  }
  try {
    const annResult = await engine('createAnnotation', staleDocId, { id: 'stale-ann', kind: 'highlight', page: 1, rects: [{ x: 0, y: 0, width: 10, height: 10 }], color: 'yellow' });
    console.log(`  Annotation on replaced docId: ok=${annResult.ok}, err=${annResult.error?.code || 'none'}`);
  } catch (err) {
    console.log(`  Annotation on replaced docId: CRASH: ${String(err).substring(0, 100)}`);
  }

  // ===========================================================================
  // TEST 10: Fill form with invalid field IDs
  // ===========================================================================
  console.log('\n--- Test 10: Invalid form field fills ---');
  const badFormDocId = 'bad-form-test';
  const badFormPath = getSamplePath('form.pdf');
  await engine('loadDocument', badFormDocId, badFormPath);

  // Fill with non-existent field ID
  try {
    const badFill = await engine('fillFormField', badFormDocId, { id: 'nonexistent-field-id', value: 'test' });
    console.log(`  Fill non-existent field: ok=${badFill.ok}, err=${badFill.error?.code || 'none'}`);
    if (badFill.ok) {
      // The engine should have thrown or returned an error — if it returned ok but did nothing, 
      // that's a silent failure
      console.log('  -> SILENT SUCCESS: filled a field that does not exist!');
      await screenshot('adv-fill-nonexistent.png');
      record(
        'ADV-030',
        'Filling a non-existent form field returns ok instead of error',
        'engine.fillFormField with id that does not exist',
        'Result with error code "not-found" or similar',
        'ok=true returned despite non-existent field ID',
        'MEDIUM',
        'adv-fill-nonexistent.png'
      );
    }
  } catch (err) {
    console.log(`  Fill non-existent: CRASH: ${String(err).substring(0, 100)}`);
  }

  // Fill with invalid value type
  try {
    const badValFill = await engine('fillFormField', badFormDocId, { id: 'form-0-applicant_name', value: '' });
    console.log(`  Fill empty string: ok=${badValFill.ok}, err=${badValFill.error?.code || 'none'}`);
  } catch (err) {
    console.log(`  Fill empty string: CRASH: ${String(err).substring(0, 100)}`);
  }

  // ===========================================================================
  // TEST 11: Hostile PDFs through loadDocumentBytes
  // ===========================================================================
  console.log('\n--- Test 11: Load hostile PDF bytes ---');
  for (const [name, fp] of Object.entries(fixturePaths)) {
    if (name === 'huge-images.pdf') continue; // skip large file for bytes test
    const buffer = fs.readFileSync(fp);
    const bytes = new Uint8Array(buffer);
    const bytesDocId = `bytes-${name.replace(/\./g, '-')}`;
    try {
      const result = await engine('loadDocumentBytes', bytesDocId, bytes);
      console.log(`  Bytes ${name}: ok=${result.ok}, err=${result.error?.code || 'none'}`);
      if (!result.ok) {
        console.log(`    -> Error: ${result.error.code}: ${result.error.message}`);
      }
    } catch (err) {
      const errStr = String(err);
      console.log(`  Bytes ${name}: CRASH: ${errStr.substring(0, 200)}`);
      await screenshot('adv-bytes-crash-' + name.replace(/\./g, '-') + '.png');
      record(
        'ADV-031',
        `Loading hostile PDF "${name}" via loadDocumentBytes causes unhandled crash`,
        `engine.loadDocumentBytes with contents of ${name}`,
        'Typed Result error (open-error)',
        `Unhandled error: ${errStr.substring(0, 200)}`,
        'MEDIUM',
        `adv-bytes-crash-${name.replace(/\./g, '-')}.png`
      );
    }
  }

  // ===========================================================================
  // TEST 12: Save after all hostile operations
  // ===========================================================================
  console.log('\n--- Test 12: SaveAs after hostile operations ---');
  if (annResult && annResult.ok) {
    const outputPath = tempPath('adv-output-annotations.pdf');
    try {
      const saveResult = await engine('saveAs', annDocId, outputPath);
      if (saveResult.ok) {
        // Verify the saved file exists and can be reloaded
        const reloaded = await engine('loadDocument', 'reload-check', outputPath);
        if (reloaded.ok) {
          const state = await getState('reload-check');
          console.log(`  SaveAs annotations: OK, reopening: pageCount=${state.pageCount}`);
        }
      }
    } catch (err) {
      console.log(`  SaveAs annotations: CRASH: ${String(err).substring(0, 100)}`);
    }
  }

  if (formResult && formResult.ok) {
    const outputPath = tempPath('adv-output-form.pdf');
    try {
      const saveResult = await engine('saveAs', badFormDocId, outputPath);
      if (saveResult.ok) {
        const reloaded = await engine('loadDocument', 'reload-form', outputPath);
        if (reloaded.ok) {
          const state = await getState('reload-form');
          console.log(`  SaveAs form: OK, reopening: pageCount=${state.pageCount}`);
        }
      }
    } catch (err) {
      console.log(`  SaveAs form: CRASH: ${String(err).substring(0, 100)}`);
    }
  }

  // ===========================================================================
  // SUMMARY
  // ===========================================================================
  console.log('\n\n=========================================');
  console.log(`ADVERSARIAL FINAL PASS COMPLETE`);
  console.log(`Findings: ${findings.length}`);
  for (const f of findings) {
    console.log(`  ${f.id}: ${f.title} [${f.severity}]`);
    console.log(`    ${f.what.substring(0, 80)}`);
  }
  console.log('=========================================');

  // Write findings to a file for easy review
  const reportPath = path.join(ROOT, 'screenshots', 'final-pass-findings.json');
  fs.writeFileSync(reportPath, JSON.stringify(findings, null, 2));
  console.log(`\nDetailed report written to: ${reportPath}`);

  await app.close();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
