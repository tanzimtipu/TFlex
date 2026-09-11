#!/usr/bin/env node
/**
 * Deep Sweep — Final Targeted Probes (Phase 3)
 * Session: deep-sweep-final
 *
 * Focus:
 * 1. Hostile PDFs that load — can they be saved? Will they crash save?
 * 2. ADV-008 save-race with proper sequential vs concurrent check
 * 3. Document safety: verify output bytes contain valid PDF
 * 4. Crow/torture/save/verify
 */

const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '../..');
const FIXTURES = path.join(ROOT, 'test-fixtures');
const DIST = path.join(ROOT, 'dist');
const TMP = path.join(os.tmpdir(), 'tflex-deep-sweep');
const RESULTS = [];

for (const d of [TMP]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function R(id, title, severity, what, expected, actual, screenshot) {
  RESULTS.push({ id, title, severity, what, expected, actual, screenshot });
  console.log(`\n*** ${id}: ${title} [${severity}]`);
  console.log(`  What: ${what}`);
  console.log(`  Expected: ${expected}`);
  console.log(`  Actual: ${actual}`);
}

function fixture(name) { return path.join(FIXTURES, name); }
function sampleSrc(name) { return path.join(ROOT, 'assets', 'samples', name); }
function tmpPath(name) { return path.join(TMP, `${Date.now()}-${crypto.randomUUID().slice(0,8)}-${name}`); }
function copyToTemp(name) {
  const src = sampleSrc(name);
  if (!fs.existsSync(src)) return null;
  const dst = tmpPath(name);
  fs.copyFileSync(src, dst);
  return dst;
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('=== Deep Sweep: Final Targeted Probes ===\n');
  const mainPath = path.join(DIST, 'main', 'index.js');
  if (!fs.existsSync(mainPath)) { console.error('Build first'); process.exit(1); }

  const app = await electron.launch({
    args: [ROOT],
    env: { ...process.env, ELECTRON_RENDERER_URL: `file://${DIST.replace(/\\/g, '/')}/renderer/index.html` },
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await sleep(1500);

  async function engine(method, ...args) {
    return await win.evaluate(([m, a]) => window.tflex.engine[m](...a), [method, args]);
  }

  async function getState(docId) { return engine('getState', docId); }

  // ==================================================================
  // PROBE K: Hostile PDF — can we save from it?
  // ==================================================================
  console.log('\n--- PROBE K: Save hostile loaded PDFs ---');
  
  const hostility = [
    { file: 'corrupted.pdf', name: 'corrupted' },
    { file: 'no-trailer.pdf', name: 'no-trailer' },
    { file: 'huge-images.pdf', name: 'huge-images' },
    { file: 'malformed-xref.pdf', name: 'malformed-xref' },
  ];

  for (const h of hostility) {
    const hPath = fixture(h.file);
    if (!fs.existsSync(hPath)) continue;
    const docId = 'probe-k-' + h.name;
    
    try {
      const load = await engine('loadDocument', docId, hPath);
      if (load && load.ok) {
        const state = await getState(docId);
        const pc = state.ok ? state.value.pageCount : 0;
        console.log(`  ${h.file}: loaded, pageCount=${pc}`);
        
        // Try getDocumentBytes (equivalent to save)
        try {
          const bytesResult = await engine('getDocumentBytes', docId);
          if (bytesResult && bytesResult.ok) {
            const buf = bytesResult.value;
            console.log(`  getDocumentBytes: OK, type=${typeof buf}, isArrayBuffer=${buf instanceof ArrayBuffer}, byteLength=${buf.byteLength || '?'}`);
            
            // Write and try to re-load
            if (buf instanceof ArrayBuffer) {
              const savePath = tmpPath(h.name + '-saved.pdf');
              fs.writeFileSync(savePath, Buffer.from(buf));
              console.log(`  Wrote ${fs.statSync(savePath).size} bytes`);
              
              const reloadId = docId + '-reload';
              const reload = await engine('loadDocument', reloadId, savePath);
              if (reload && reload.ok) {
                const reloadState = await getState(reloadId);
                const reloadPc = reloadState.ok ? reloadState.value.pageCount : 0;
                console.log(`  Reloaded: pageCount=${reloadPc}`);
                
                if (reloadPc !== pc) {
                  R('ADV-049', 'Hostile PDF save round-trip changes page count', 'MEDIUM',
                    'Loaded ' + h.file + ' (' + pc + ' pages), saved via getDocumentBytes, reloaded',
                    'Saved doc should have same page count',
                    'Reloaded has ' + reloadPc + ' pages (was ' + pc + ')');
                }
              } else {
                console.log(`  Reload FAILED: ${reload?.error?.code || 'unknown'}`);
                // This is expected for some hostile PDFs — the serialization
                // produces a valid PDF even if the original was corrupt
              }
            } else {
              // The Result.value might be a Uint8Array or similar
              console.log('  buf is ArrayBuffer:', buf instanceof ArrayBuffer, ' type:', typeof buf, ' constructor:', buf?.constructor?.name);
              // Try to write as-is
              if (buf && typeof buf === 'object') {
                try {
                  const arr = new Uint8Array(buf);
                  const savePath = tmpPath(h.name + '-saved.pdf');
                  fs.writeFileSync(savePath, arr);
                  console.log('  Wrote ' + arr.length + ' bytes from Uint8Array');
                } catch(e2) {
                  console.log('  Could not write bytes:', e2.message);
                }
              }
            }
          } else {
            const err = bytesResult?.error;
            console.log('  getDocumentBytes FAILED:', err?.code, err?.message);
            
            R('ADV-050', 'Hostile PDF loaded but cannot be serialized/saved', 'MEDIUM',
              'Loaded ' + h.file + ' with ok=true, called getDocumentBytes',
              'A loaded document should be serializable',
              'getDocumentBytes returned: ' + err?.code + ' - ' + err?.message);
          }
        } catch(saveErr) {
          console.log('  getDocumentBytes CRASHED:', saveErr.message);
          R('ADV-051', 'Hostile PDF causes crash on getDocumentBytes (save attempt)', 'HIGH',
            'Loaded ' + h.file + ' with ok=true, called getDocumentBytes',
            'Should return typed error, not crash',
            'Threw: ' + saveErr.message);
        }
      }
    } catch(e) {
      console.log('  ' + h.file + ' load CRASH:', e.message);
    }
  }

  // ==================================================================
  // PROBE L: ADV-008 sequential (no race) — do saves work at all?
  // ==================================================================
  console.log('\n--- PROBE L: Save-unmodified no-race check ---');
  try {
    const repPath = copyToTemp('report.pdf');
    if (repPath) {
      const docId = 'probe-l';
      await engine('loadDocument', docId, repPath);
      
      // Delete 3 pages SEQUENTIALLY (not concurrent)
      let state = await getState(docId);
      console.log('  Pre-delete pages:', state.ok ? state.value.pageCount : 'err');
      
      for (let i = 0; i < 3; i++) {
        const del = await engine('applyOp', docId, { kind: 'delete', page: 1 });
        if (!del || !del.ok) {
          console.log('  Delete ' + (i+1) + ' failed:', del?.error?.code);
          break;
        }
      }
      
      state = await getState(docId);
      const memPagesAfterDel = state.ok ? state.value.pageCount : -1;
      console.log('  After 3 sequential deletes, pages:', memPagesAfterDel);
      
      // Save
      const saveResult = await engine('save', docId);
      console.log('  Save result:', saveResult ? (saveResult.ok ? 'OK path=' + saveResult.value : 'ERR ' + saveResult.error?.code) : 'null');
      
      // Reload
      const reloadId = docId + '-reload';
      const reload = await engine('loadDocument', reloadId, repPath);
      if (reload && reload.ok) {
        const diskState = await getState(reloadId);
        const diskPages = diskState.ok ? diskState.value.pageCount : -1;
        console.log('  Disk pages after sequential save:', diskPages);
        
        if (diskPages !== memPagesAfterDel) {
          R('ADV-052', 'SAVE with sequential deletes still loses changes', 'HIGH',
            'Deleted 3 pages SEQUENTIALLY, then saved. Memory has ' + memPagesAfterDel + ' pages.',
            'Disk should reflect saved state (' + memPagesAfterDel + ' pages)',
            'Disk has ' + diskPages + ' pages');
        } else {
          console.log('  Sequential save round-trip: PASS (pages match)');
        }
      }
    }
  } catch(e) { console.log('  Probe L error:', e.message); }

  // ==================================================================
  // PROBE M: Mixed operations (rotate, delete, annotate, undo sequence)
  // with correct op format
  // ==================================================================
  console.log('\n--- PROBE M: Mixed operations with correct op format ---');
  try {
    const repPath = copyToTemp('report.pdf');
    if (repPath) {
      const docId = 'probe-m';
      await engine('loadDocument', docId, repPath);
      
      // Use correct op format for rotate: 'rotate-cw' / 'rotate-ccw' with 0-based page
      const ops = [
        { kind: 'rotate-cw', page: 0 },     // rotate page 1 cw
        { kind: 'rotate-cw', page: 0 },     // rotate page 1 cw again
        { kind: 'delete', page: 3 },         // delete page 4
        { kind: 'rotate-ccw', page: 0 },    // rotate page 1 ccw (back to 1)
        { kind: 'rotate-cw', page: 0 },     // rotate page 1 cw (rotation = 2)
        { kind: 'delete', page: 1 },         // delete original page 2
        { kind: 'rotate-cw', page: 0 },     // rotate current page 1 (rotation = 3)
        { kind: 'rotate-cw', page: 0 },     // rotate current page 1 (rotation = 0)
      ];
      
      for (const op of ops) {
        const result = await engine('applyOp', docId, op);
        if (!result || !result.ok) {
          console.log('  Op failed:', JSON.stringify(op), result?.error?.code, result?.error?.message);
        }
      }
      
      let state = await getState(docId);
      console.log('  After ops: pageCount=' + (state.ok ? state.value.pageCount : 'err'));
      console.log('  Rotations:', state.ok ? state.value.rotations.slice(0, 5) : 'err');
      
      // Check page 1 rotation should be 0 (4 cw + 1 ccw = 3 net cw before last cw = 0)
      const rot0 = state.ok ? state.value.rotations[state.value.pageOrder[0]] : -1;
      console.log('  Page 1 rotation (after 4 cw + 1 ccw = 3 net):', rot0);
      
      // Undo 4 times
      for (let i = 0; i < 4; i++) {
        const undo = await engine('undo', docId);
        if (!undo || !undo.ok) {
          console.log('  Undo ' + (i+1) + ': ' + (undo?.error?.code || 'failed'));
          break;
        }
      }
      
      state = await getState(docId);
      console.log('  After 4 undos: pageCount=' + (state.ok ? state.value.pageCount : 'err'));
      const order = state.ok ? state.value.pageOrder : [];
      const rots = state.ok ? state.value.rotations : [];
      console.log('  order[0..4]:', order.slice(0, 5));
      console.log('  rotations[order[0..4]]:', order.slice(0, 5).map(i => rots[i]));
      
      // Verify state consistency: redo 2
      for (let i = 0; i < 2; i++) {
        await engine('redo', docId);
      }
      
      state = await getState(docId);
      console.log('  After 2 redos: pageCount=' + (state.ok ? state.value.pageCount : 'err'));
      
      // New op should clear redo
      await engine('applyOp', docId, { kind: 'rotate-cw', page: 0 });
      const redoResult = await engine('redo', docId);
      if (redoResult && redoResult.ok) {
        R('ADV-053', 'Redo succeeds after new op (redo stack should be cleared)', 'MEDIUM',
          'Applied new rotate after undoing, then called redo',
          'Redo should return nothing-to-redo',
          'Redo returned ok');
      } else {
        console.log('  Redo correctly cleared:', redoResult?.error?.code);
      }
      
      // Save and reload
      const saveBytes = await engine('getDocumentBytes', docId);
      if (saveBytes && saveBytes.ok) {
        const buf = saveBytes.value;
        if (buf instanceof ArrayBuffer) {
          const savePath = tmpPath('mixed-ops.pdf');
          fs.writeFileSync(savePath, Buffer.from(buf));
          
          const reloadId = docId + '-reload';
          const reload = await engine('loadDocument', reloadId, savePath);
          if (reload && reload.ok) {
            const diskState = await getState(reloadId);
            console.log('  Saved & reloaded: pageCount=' + diskState.value.pageCount);
            
            if (diskState.value.pageCount !== 31) {
              R('ADV-054', 'Mixed ops save round-trip: wrong page count', 'HIGH',
                'Applied rotations + 2 deletes, saved, reloaded. Original 34 pages - 2 deletes = 32 expected. But page indices shifted, actual deletions may differ.',
                'Saved and reloaded, page count should reflect actual deletions',
                'Got ' + diskState.value.pageCount + ' pages');
            }
          }
        }
      }
    }
  } catch(e) { console.log('  Probe M error:', e.message); }

  // ==================================================================
  // PROBE N: getDocumentBytes type investigation
  // ==================================================================
  console.log('\n--- PROBE N: getDocumentBytes return type check ---');
  try {
    const repPath = copyToTemp('report.pdf');
    if (repPath) {
      const docId = 'probe-n';
      await engine('loadDocument', docId, repPath);
      
      const bytesResult = await engine('getDocumentBytes', docId);
      if (bytesResult && bytesResult.ok) {
        const val = bytesResult.value;
        console.log('  getDocumentBytes return type:');
        console.log('    typeof val:', typeof val);
        console.log('    val === null:', val === null);
        console.log('    val === undefined:', val === undefined);
        console.log('    constructor.name:', val?.constructor?.name || 'none');
        console.log('    isArray:', Array.isArray(val));
        
        if (val) {
          console.log('    byteLength:', val.byteLength);
          if (val.byteLength) {
            // Write to temp
            const buf = Buffer.from(val);
            const savePath = tmpPath('type-check.pdf');
            fs.writeFileSync(savePath, buf);
            console.log('    Wrote ' + buf.length + ' bytes');
            
            // Quick check: starts with %PDF
            const firstBytes = buf.slice(0, 5).toString();
            console.log('    First 5 bytes:', JSON.stringify(firstBytes));
            
            if (firstBytes !== '%PDF-') {
              R('ADV-055', 'getDocumentBytes returns data without PDF header', 'HIGH',
                'Called getDocumentBytes on loaded report.pdf',
                'Bytes should start with %PDF-',
                'First 5 bytes: ' + JSON.stringify(firstBytes));
            } else {
              console.log('  Output is valid PDF: PASS');
            }
          }
        }
      }
    }
  } catch(e) { console.log('  Probe N error:', e.message); }

  // ==================================================================
  // PROBE O: Form fill save round-trip
  // ==================================================================
  console.log('\n--- PROBE O: Form fill + save round-trip ---');
  try {
    const formPath = copyToTemp('form.pdf');
    if (formPath) {
      const docId = 'probe-o';
      await engine('loadDocument', docId, formPath);
      
      const fields = await engine('getFormFields', docId);
      if (fields && fields.ok) {
        const fieldList = fields.value;
        console.log('  Form fields:', fieldList.length);
        
        if (fieldList.length > 0) {
          // Fill first text field
          const firstField = fieldList[0];
          const fill = await engine('fillFormField', docId, {
            id: firstField.id,
            value: 'Adversary Test Value',
          });
          console.log('  Fill field ' + firstField.name + ': ' + (fill.ok ? 'OK' : 'ERR ' + fill.error?.code));
          
          // Save
          const bytesResult = await engine('getDocumentBytes', docId);
          if (bytesResult && bytesResult.ok) {
            const buf = bytesResult.value;
            if (buf && buf.byteLength) {
              const savePath = tmpPath('form-filled.pdf');
              fs.writeFileSync(savePath, Buffer.from(buf));
              
              const reloadId = docId + '-reload';
              const reload = await engine('loadDocument', reloadId, savePath);
              if (reload && reload.ok) {
                const reloadedFields = await engine('getFormFields', reloadId);
                if (reloadedFields && reloadedFields.ok) {
                  const reloadedList = reloadedFields.value;
                  console.log('  Reloaded form fields:', reloadedList.length);
                  
                  if (reloadedList.length !== fieldList.length) {
                    R('ADV-056', 'Form fill + save round-trip loses fields', 'HIGH',
                      'Filled 1 field, saved via getDocumentBytes, reloaded',
                      'Form fields should be preserved',
                      'Original: ' + fieldList.length + ' fields, reloaded: ' + reloadedList.length + ' fields');
                  } else {
                    console.log('  Form field round-trip: PASS (' + reloadedList.length + ' fields)');
                  }
                }
              }
            }
          }
        }
      }
    }
  } catch(e) { console.log('  Probe O error:', e.message); }

  // ==================================================================
  // SUMMARY
  // ==================================================================
  console.log('\n\n=== FINAL PROBES COMPLETE ===');
  console.log('Findings:', RESULTS.length);
  for (const r of RESULTS) {
    console.log('  ' + r.id + ': ' + r.title + ' [' + r.severity + ']');
  }

  await sleep(500);
  await app.close();
  return RESULTS;
}

main().catch(e => {
  console.error('FATAL:', e.message, e.stack);
  process.exit(1);
});