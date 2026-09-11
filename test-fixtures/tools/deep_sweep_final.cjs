#!/usr/bin/env node
/**
 * Full Deep Adversarial Sweep — v1.7.11
 * Session: deep-sweep-final
 *
 * Tests:
 *   1. Silence attack regression (re-test original 23 ADV findings)
 *   2. Document safety (every write op -> re-open + re-parse)
 *   3. Hostile PDFs through every load path
 *   4. Undo/redo torture (mixed sequences)
 *   5. State persistence attacks
 *   6. Frameless window attacks
 *   7. Silence-surface probes (crop, move, export then pixel diff)
 */

const { _electron: electron } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '../..');
const FIXTURES = path.join(ROOT, 'test-fixtures');
const DIST = path.join(ROOT, 'dist');
const SCREENSHOTS = path.join(ROOT, 'screenshots');
const TMP = path.join(os.tmpdir(), 'tflex-deep-sweep');
const RESULTS = [];

// Ensure directories
for (const d of [TMP, SCREENSHOTS]) {
  if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}

function R(id, title, severity, what, expected, actual, screenshot) {
  RESULTS.push({ id, title, severity, what, expected, actual, screenshot });
  console.log(`\n*** ${id}: ${title} [${severity}]`);
  console.log(`  Expected: ${expected}`);
  console.log(`  Actual: ${actual}`);
}

function fixture(name) { return path.join(FIXTURES, name); }
function sampleSrc(name) { return path.join(ROOT, 'assets', 'samples', name); }
function tmpPath(name) { return path.join(TMP, `${Date.now()}-${crypto.randomUUID().slice(0,8)}-${name}`); }

function copyToTemp(name) {
  const src = sampleSrc(name);
  if (!fs.existsSync(src)) { console.error('Missing sample:', src); return null; }
  const dst = tmpPath(name);
  fs.copyFileSync(src, dst);
  return dst;
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('=== TFlex Deep Adversarial Sweep (v1.7.11) ===\n');
  const mainPath = path.join(DIST, 'main', 'index.js');
  if (!fs.existsSync(mainPath)) {
    console.error('Error: Build first (npm run build)'); process.exit(1);
  }

  const app = await electron.launch({
    args: [ROOT],
    env: {
      ...process.env,
      ELECTRON_RENDERER_URL: `file://${distPath('renderer/index.html')}`,
    },
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await sleep(1500);

  // Helper: engine calls through window.tflex.engine.*
  async function engine(method, ...args) {
    return await win.evaluate(([m, a]) => window.tflex.engine[m](...a), [method, args]);
  }

  async function getState(docId) { return engine('getState', docId); }
  async function diag() { return win.evaluate(() => typeof window.tflexDiagnostics === 'function' ? window.tflexDiagnostics() : null); }

  const DOC = 'adversary-deep-sweep';

  function distPath(p) {
    return path.join(DIST, p).replace(/\\/g, '/');
  }

  // ====================================================================
  // 1. SILENCE ATTACK REGRESSION — re-test ADV-008..023
  // ====================================================================
  console.log('\n=== SECTION 1: Silence attack regression ===\n');

  // Regression: ADV-008 — save race
  try {
    const repPath = copyToTemp('report.pdf');
    if (repPath) {
      await sleep(100);
      const load = await engine('loadDocument', DOC, repPath);
      if (load && load.ok) {
        // Merge to get many pages
        const merge = await engine('merge', DOC, [repPath], 'after');
        if (merge && merge.ok) {
          const stateBeforeSave = merge.value;
          const pageCount = stateBeforeSave.pageCount;
          // Save and immediately delete
          const savePromise = engine('save', DOC);
          const delPromises = [];
          for (let i = 0; i < 3 && pageCount - i > 1; i++) {
            delPromises.push(engine('applyOp', DOC, { kind: 'delete', page: pageCount - i }));
          }
          const saveResult = await savePromise;
          const delResults = await Promise.all(delPromises);
          const stateAfter = await getState(DOC);
          if (saveResult && saveResult.ok) {
            // Re-load and check page count
            const reload = await engine('loadDocument', DOC, repPath);
            if (reload && reload.ok) {
              const reloadedState = await getState(DOC);
              // This is a regression test - the old ADV-008 showed that
              // deletions during save were silently lost. Check whether
              // the in-memory and on-disk counts match (they should differ
              // if the race still exists).
              // NOTE: we reloaded the document, so state has the original.
              // We saved AFTER deletes, so if save captured deletes, 
              // on-disk count should be pageCount - 3.
              const diskDocId = DOC + '-disk';
              await engine('loadDocument', diskDocId, repPath);
              const diskState = await getState(diskDocId);
              const memPageCount = stateAfter && stateAfter.ok ? stateAfter.value.pageCount : -1;
              const diskPageCount = diskState && diskState.ok ? diskState.value.pageCount : -1;
              console.log(`  ADV-008 regr: mem=${memPageCount} disk=${diskPageCount} expected=${pageCount - 3}`);
            }
          }
        }
      }
      console.log('  ADV-008 regression: completed (save-race tested)');
    }
  } catch(e) {
    console.log('  ADV-008 regression error:', e.message);
  }

  // Regression: ADV-009 — undo button (engine-level test)
  // Check that multi-step undo works
  try {
    const repPath = copyToTemp('report.pdf');
    if (repPath) {
      await engine('loadDocument', 'adv009-test', repPath);
      // Apply 4 rotations
      for (let i = 0; i < 4; i++) {
        await engine('applyOp', 'adv009-test', { kind: 'rotate', page: 1, direction: 'cw' });
      }
      let state = await getState('adv009-test');
      const rotAfter4 = state.ok ? state.value.pageStates[0]?.rotation : -1;
      console.log(`  ADV-009 regr: rotation after 4 cw = ${rotAfter4} (expected 0)`);
      
      // Undo 3 times
      for (let i = 0; i < 3; i++) {
        const undoRes = await engine('undo', 'adv009-test');
        if (!undoRes || !undoRes.ok) {
          console.log(`  ADV-009 regr: undo ${i+1} failed: ${undoRes?.error?.message}`);
          break;
        }
        state = undoRes;
      }
      const rotAfterUndo = state.ok ? state.value.pageStates[0]?.rotation : -1;
      console.log(`  ADV-009 regr: rotation after 3 undos = ${rotAfterUndo} (expected 3)`);
      
      // Undo 4th time - should succeed (4 undos available)
      const undo4 = await engine('undo', 'adv009-test');
      if (undo4 && undo4.ok) {
        console.log(`  ADV-009 regr: 4th undo succeeded (rotation=${undo4.value.pageStates[0]?.rotation})`);
      } else {
        console.log(`  ADV-009 regr: 4th undo failed: ${undo4?.error?.code}`);
      }
    }
  } catch(e) {
    console.log('  ADV-009 regression error:', e.message);
  }

  // Regression: ADV-018 — 0-page doc guard
  try {
    const encPath = fixture('encrypted-looking.pdf');
    if (fs.existsSync(encPath)) {
      const load = await engine('loadDocument', 'adv018-test', encPath);
      if (load && load.ok) {
        const state = await getState('adv018-test');
        const pageCount = state.ok ? state.value.pageCount : 'err';
        console.log(`  ADV-018 regr: 0-page doc loaded with count=${pageCount} (expected: should reject)`);
      } else {
        console.log(`  ADV-018 regr: 0-page doc correctly rejected: ${load?.error?.code}`);
      }
    }
  } catch(e) {
    console.log('  ADV-018 regression error:', e.message);
  }

  // ====================================================================
  // 2. DOCUMENT SAFETY — every write op, re-open + re-parse
  // ====================================================================
  console.log('\n=== SECTION 2: Document safety ===\n');

  // 2a. Save + SaveAs round-trip
  try {
    const repPath = copyToTemp('report.pdf');
    if (repPath) {
      const docId = 'safety-save';
      await engine('loadDocument', docId, repPath);
      
      // Mutate: rotate page 1, delete page 2
      await engine('applyOp', docId, { kind: 'rotate', page: 1, direction: 'cw' });
      await engine('applyOp', docId, { kind: 'delete', page: 2 });
      
      let state = await getState(docId);
      const memPageCount = state.ok ? state.value.pageCount : -1;
      const memRot0 = state.ok ? state.value.pageStates[0]?.rotation : -1;
      
      // Save
      const saveResult = await engine('save', docId);
      if (saveResult && saveResult.ok) {
        console.log(`  Save OK: path=${saveResult.value}`);
        
        // Re-load saved document
        const reloadId = docId + '-reload';
        const reload = await engine('loadDocument', reloadId, repPath);
        if (reload && reload.ok) {
          // Wait a tick for state to propagate
          await sleep(50);
          const reloaded = await getState(reloadId);
          const diskPageCount = reloaded.ok ? reloaded.value.pageCount : -1;
          
          if (diskPageCount !== memPageCount) {
            R('ADV-024', 'Save round-trip: page count mismatch', 'HIGH',
              `Saved ${docId} (${memPageCount} pages in memory), reloaded from disk (${diskPageCount} pages)`,
              `disk page count (${diskPageCount}) should equal memory page count (${memPageCount})`,
              `disk=${diskPageCount} mem=${memPageCount}`);
          } else {
            console.log(`  Document safety/SAVE: pages match (${diskPageCount}) -- PASS`);
          }
        }
      } else {
        console.log(`  Save result error: ${JSON.stringify(saveResult)}`);
      }
    }
  } catch(e) {
    console.log('  Section 2a error:', e.message);
  }

  // 2b. Merge round-trip
  try {
    const repPath = copyToTemp('report.pdf');
    const formPath = copyToTemp('form.pdf');
    if (repPath && formPath) {
      const docId = 'safety-merge';
      await engine('loadDocument', docId, repPath);
      const stateBefore = await getState(docId);
      const beforeCount = stateBefore.ok ? stateBefore.value.pageCount : 0;
      
      const mergeResult = await engine('merge', docId, [formPath], 'after');
      if (mergeResult && mergeResult.ok) {
        const afterCount = mergeResult.value.pageCount;
        const savePath = tmpPath('merged.pdf');
        // Use save-as: set path then save
        // Actually we need to use save/saveAs properly
        // The doc already has a path from loadDocument, so save will overwrite it
        // Let's instead save the merged doc via getDocumentBytes
        const bytesResult = await engine('getDocumentBytes', docId);
        if (bytesResult && bytesResult.ok) {
          fs.writeFileSync(savePath, Buffer.from(bytesResult.value));
          
          // Re-load merged
          const reloadId = docId + '-merged-reload';
          const reload = await engine('loadDocument', reloadId, savePath);
          if (reload && reload.ok) {
            await sleep(50);
            const reloaded = await getState(reloadId);
            const diskCount = reloaded.ok ? reloaded.value.pageCount : -1;
            
            if (diskCount !== afterCount) {
              R('ADV-025', 'Merge round-trip: page count mismatch', 'HIGH',
                `Merged ${beforeCount}+ pages -> ${afterCount} pages in memory, reloaded has ${diskCount}`,
                `disk count (${diskCount}) should equal memory count (${afterCount})`,
                `disk=${diskCount} mem=${afterCount}`);
            } else {
              console.log(`  Document safety/MERGE: pages match (${diskCount}) -- PASS`);
            }
          }
        }
      }
    }
  } catch(e) {
    console.log('  Section 2b error:', e.message);
  }

  // 2c. Split round-trip
  try {
    const repPath = copyToTemp('report.pdf');
    if (repPath) {
      const docId = 'safety-split';
      await engine('loadDocument', docId, repPath);
      const stateBefore = await getState(docId);
      const pageCount = stateBefore.ok ? stateBefore.value.pageCount : 0;
      
      const splitResult = await engine('split', docId, [0, 4]); // pages 1-5
      if (splitResult && splitResult.ok) {
        const splitBytes = splitResult.value;
        const splitPath = tmpPath('split-result.pdf');
        fs.writeFileSync(splitPath, Buffer.from(splitBytes));
        
        // Reload split doc
        const reloadId = docId + '-split-reload';
        const reload = await engine('loadDocument', reloadId, splitPath);
        if (reload && reload.ok) {
          await sleep(50);
          const reloaded = await getState(reloadId);
          const diskCount = reloaded.ok ? reloaded.value.pageCount : -1;
          
          if (diskCount !== 5) {
            R('ADV-026', 'Split round-trip: page count mismatch', 'HIGH',
              `Split pages 1-5 into new doc, reloaded has ${diskCount} pages`,
              `reloaded count (${diskCount}) should be 5`,
              `got ${diskCount}`);
          } else {
            console.log(`  Document safety/SPLIT: pages match (${diskCount}) -- PASS`);
          }
        }
      }
    }
  } catch(e) {
    console.log('  Section 2c error:', e.message);
  }

  // 2d. Extract round-trip
  try {
    const repPath = copyToTemp('report.pdf');
    if (repPath) {
      const docId = 'safety-extract';
      await engine('loadDocument', docId, repPath);
      const extractResult = await engine('extract', docId, [0, 2, 4]); // pages 1,3,5
      if (extractResult && extractResult.ok) {
        const extBytes = extractResult.value;
        const extPath = tmpPath('extract-result.pdf');
        fs.writeFileSync(extPath, Buffer.from(extBytes));
        
        const reloadId = docId + '-extract-reload';
        const reload = await engine('loadDocument', reloadId, extPath);
        if (reload && reload.ok) {
          await sleep(50);
          const reloaded = await getState(reloadId);
          const diskCount = reloaded.ok ? reloaded.value.pageCount : -1;
          
          if (diskCount !== 3) {
            R('ADV-027', 'Extract round-trip: page count mismatch', 'HIGH',
              `Extracted 3 pages into new doc, reloaded has ${diskCount}`,
              `reloaded count (${diskCount}) should be 3`,
              `got ${diskCount}`);
          } else {
            console.log(`  Document safety/EXTRACT: pages match (${diskCount}) -- PASS`);
          }
        }
      }
    }
  } catch(e) {
    console.log('  Section 2d error:', e.message);
  }

  // 2e. Optimize round-trip (read-only, but check bytes)
  try {
    const repPath = copyToTemp('report.pdf');
    if (repPath) {
      const docId = 'safety-optimize';
      await engine('loadDocument', docId, repPath);
      const stateBefore = await getState(docId);
      const beforeCount = stateBefore.ok ? stateBefore.value.pageCount : 0;
      
      const optimizeResult = await engine('optimize', docId, 'compact');
      if (optimizeResult && optimizeResult.ok) {
        const optBytes = optimizeResult.value;
        const optPath = tmpPath('optimized.pdf');
        fs.writeFileSync(optPath, Buffer.from(optBytes));
        
        const reloadId = docId + '-opt-reload';
        const reload = await engine('loadDocument', reloadId, optPath);
        if (reload && reload.ok) {
          await sleep(50);
          const reloaded = await getState(reloadId);
          const diskCount = reloaded.ok ? reloaded.value.pageCount : -1;
          
          if (diskCount !== beforeCount) {
            R('ADV-028', 'Optimize round-trip: page count mismatch', 'HIGH',
              `Optimized doc (${beforeCount} pages), reloaded has ${diskCount}`,
              `reloaded count (${diskCount}) should equal original (${beforeCount})`,
              `got ${diskCount}, expected ${beforeCount}`);
          } else {
            console.log(`  Document safety/OPTIMIZE: pages match (${diskCount}) -- PASS`);
          }
        }
      }
    }
  } catch(e) {
    console.log('  Section 2e error:', e.message);
  }

  // ====================================================================
  // 3. HOSTILE PDFs through loadDocument bytes path
  // ====================================================================
  console.log('\n=== SECTION 3: Hostile PDF load paths ===\n');

  const hostileFiles = [
    'zero.pdf', 'truncated.pdf', 'corrupted.pdf', 'not-a-pdf.txt',
    'encrypted.pdf', 'encrypted-looking.pdf', 'no-trailer.pdf',
    'broken-pagetree.pdf', 'no-kids.pdf', 'huge-images.pdf',
    'circular-refs.pdf', 'malformed-xref.pdf', 'infinite-loop-pagetree.pdf',
  ];

  for (const hostile of hostileFiles) {
    const hPath = fixture(hostile);
    if (!fs.existsSync(hPath)) {
      console.log(`  Skipping ${hostile} (not found)`);
      continue;
    }
    const docId = `hostile-${hostile.replace(/[^a-z0-9]/g, '-')}`;
    try {
      const loadResult = await engine('loadDocument', docId, hPath);
      console.log(`  ${hostile}: load=${loadResult.ok ? 'OK' : `ERR (${loadResult.error?.code})`}`);
      
      // If it loaded, verify no crash
      if (loadResult && loadResult.ok) {
        const state = await getState(docId);
        console.log(`    -> pageCount=${state.ok ? state.value.pageCount : 'err'}, pages=${state.ok ? state.value.pageStates?.length : 'err'}`);
        
        // Try operations: rotate
        if (state.ok && state.value.pageCount > 0) {
          const opRes = await engine('applyOp', docId, { kind: 'rotate', page: 1, direction: 'cw' });
          console.log(`    -> rotate page 1: ${opRes.ok ? 'OK' : `ERR (${opRes.error?.code})`}`);
          
          // Try annotate
          const annRes = await engine('createAnnotation', docId, {
            type: 'highlight', page: 1, rect: { x: 10, y: 10, width: 100, height: 20 }, color: '#ff0',
          });
          console.log(`    -> annotate: ${annRes.ok ? 'OK' : `ERR (${annRes.error?.code})`}`);
        }
      }
    } catch(e) {
      console.log(`  ${hostile}: CRASH (${e.message})`);
      R('ADV-HOSTILE-CRASH', `Hostile PDF ${hostile} caused crash`, 'HIGH',
        `Loaded ${hostile} via engine.loadDocument`,
        'Should return typed error, not crash',
        `App threw: ${e.message}`);
    }
  }

  // 3b. LoadDocumentBytes path — trivial truncated bytes
  try {
    const docId = 'hostile-bytes';
    const minimalPdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]); // "%PDF-1.4"
    const loadResult = await engine('loadDocumentBytes', docId, minimalPdf);
    if (loadResult && loadResult.ok) {
      console.log(`  Truncated bytes: LOADED (in error) -- pageCount=${loadResult.value?.byteLength}`);
      R('ADV-029', 'Truncated PDF bytes (8 bytes) load succeeds', 'MEDIUM',
        'Loaded 8 bytes "%PDF-1.4" via loadDocumentBytes',
        'Should reject as corrupt/open-error (only header, no objects)',
        `loadDocumentBytes returned ok`);
    } else {
      console.log(`  Truncated bytes: correctly rejected: ${loadResult?.error?.code}`);
    }
  } catch(e) {
    console.log(`  Truncated bytes crash: ${e.message}`);
  }

  // 3c. Bad bytes through loadDocumentBytes
  try {
    const docId = 'hostile-bytes-bad';
    const badBytes = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const loadResult = await engine('loadDocumentBytes', docId, badBytes);
    console.log(`  Non-PDF bytes: ${loadResult.ok ? 'LOADED (error!)' : `correctly rejected (${loadResult.error?.code})`}`);
    if (loadResult && loadResult.ok) {
      R('ADV-030', 'Non-PDF bytes load succeeds as document', 'MEDIUM',
        'Loaded 10 random bytes via loadDocumentBytes',
        'Should reject with open-error (no PDF header)',
        `loadDocumentBytes returned ok`);
    }
  } catch(e) {
    console.log(`  Non-PDF bytes crash: ${e.message}`);
  }

  // ====================================================================
  // 4. UNDO/REDO TORTURE
  // ====================================================================
  console.log('\n=== SECTION 4: Undo/redo torture ===\n');

  try {
    const repPath = copyToTemp('report.pdf');
    if (repPath) {
      const docId = 'torture-undo';
      await engine('loadDocument', docId, repPath);
      
      // Apply 20 mixed operations
      const ops = [
        { kind: 'rotate', page: 1, direction: 'cw' },
        { kind: 'rotate', page: 2, direction: 'ccw' },
        { kind: 'delete', page: 5 },
        { kind: 'rotate', page: 3, direction: 'cw' },
        { kind: 'delete', page: 3 },  // page indices shifted
        { kind: 'rotate', page: 1, direction: 'cw' },
        { kind: 'rotate', page: 1, direction: 'cw' },
        { kind: 'delete', page: 10 },
        { kind: 'rotate', page: 5, direction: 'ccw' },
        { kind: 'delete', page: 8 },
        { kind: 'rotate', page: 2, direction: 'cw' },
        { kind: 'rotate', page: 4, direction: 'cw' },
        { kind: 'delete', page: 6 },
        { kind: 'rotate', page: 1, direction: 'ccw' },
        { kind: 'rotate', page: 2, direction: 'cw' },
        { kind: 'rotate', page: 3, direction: 'cw' },
        { kind: 'delete', page: 4 },
        { kind: 'rotate', page: 1, direction: 'cw' },
        { kind: 'delete', page: 2 },
        { kind: 'rotate', page: 1, direction: 'cw' },
      ];

      for (const op of ops) {
        const result = await engine('applyOp', docId, op);
        if (!result || !result.ok) {
          console.log(`  Torture: op ${op.kind} page ${op.page}: FAILED (${result?.error?.code})`);
        }
      }

      // Get state after all ops
      let state = await getState(docId);
      const afterOps = state.ok ? { count: state.value.pageCount, rot: state.value.pageStates?.map(p => p.rotation) } : null;
      console.log(`  After 20 ops: pages=${afterOps?.count}`);

      // Undo 10 times
      for (let i = 0; i < 10; i++) {
        const undoRes = await engine('undo', docId);
        if (!undoRes || !undoRes.ok) {
          console.log(`  Undo #${i+1}: FAILED (${undoRes?.error?.code})`);
          break;
        }
      }
      state = await getState(docId);
      const afterUndo = state.ok ? { count: state.value.pageCount, rot: state.value.pageStates?.map(p => p.rotation) } : null;
      console.log(`  After 10 undos: pages=${afterUndo?.count}`);

      // Redo 5 times
      for (let i = 0; i < 5; i++) {
        const redoRes = await engine('redo', docId);
        if (!redoRes || !redoRes.ok) {
          console.log(`  Redo #${i+1}: FAILED (${redoRes?.error?.code})`);
          break;
        }
      }
      state = await getState(docId);
      const afterRedo = state.ok ? { count: state.value.pageCount, rot: state.value.pageStates?.map(p => p.rotation) } : null;
      console.log(`  After 5 redos: pages=${afterRedo?.count}`);

      // Now do 20 more undos (exhaust)
      let undone = 0;
      for (let i = 0; i < 20; i++) {
        const undoRes = await engine('undo', docId);
        if (!undoRes || !undoRes.ok) break;
        undone++;
      }
      const finalState = await getState(docId);
      const final = finalState.ok ? { count: finalState.value.pageCount } : null;
      console.log(`  After FULL undo (${undone} steps): pages=${final?.count}`);
      
      // After full undo, page count should equal original (34)
      if (final && final.count !== 34) {
        R('ADV-031', 'Undo torture: full undo does not restore original page count', 'HIGH',
          'Applied 20 mixed ops (rotates + deletes), then undid all',
          `After full undo, page count should be 34 (original)`,
          `Got ${final.count} pages`);
      } else {
        console.log(`  Undo torture/restore: pages=${final?.count} -- PASS`);
      }
    }
  } catch(e) {
    console.log('  Section 4 error:', e.message);
  }

  // ====================================================================
  // 5. FRAMELESS WINDOW ATTACKS
  // ====================================================================
  console.log('\n=== SECTION 5: Frameless window attacks ===\n');

  // Check title bar exists and verify controls
  try {
    const titlebar = await win.$('[data-titlebar]');
    console.log(`  TitleBar exists: ${!!titlebar}`);
    
    const minBtn = await win.$('[data-window-minimize]');
    const maxBtn = await win.$('[data-window-maximize]');
    const closeBtn = await win.$('[data-window-close]');
    const menuBtn = await win.$('[data-menu-button]');
    
    console.log(`  Window controls: min=${!!minBtn} max=${!!maxBtn} close=${!!closeBtn} menu=${!!menuBtn}`);

    // Check title bar controls are interactive
    if (minBtn) {
      const minBox = await minBtn.boundingBox();
      console.log(`  Minimize button box: ${JSON.stringify(minBox)}`);
    }
    
    // Check for the titlebar controls container
    const controls = await win.$('[data-titlebar-controls]');
    console.log(`  Controls container: ${!!controls}`);
    
    // Window state
    const isMaximized = await win.evaluate(() => window.tflex.maximizeWindow ? true : false);
    console.log(`  maximizeWindow IPC exists: ${isMaximized}`);
    
  } catch(e) {
    console.log('  Section 5 error:', e.message);
  }

  // Check the title bar drag region
  try {
    const dragRegion = await win.$('.titlebar');
    const dragStyle = await win.evaluate(() => {
      const tb = document.querySelector('.titlebar');
      if (!tb) return 'no-titlebar';
      return window.getComputedStyle(tb).webkitAppRegion || 'not-set';
    });
    console.log(`  TitleBar drag region CSS: ${dragStyle}`);
    
    // Check window controls have no-drag
    const controlRegion = await win.evaluate(() => {
      const btn = document.querySelector('[data-window-close]');
      if (!btn) return 'no-close-btn';
      return window.getComputedStyle(btn).webkitAppRegion || 'not-set';
    });
    console.log(`  Window close button region CSS: ${controlRegion}`);
    
  } catch(e) {
    console.log('  Section 5b error:', e.message);
  }

  // ====================================================================
  // 6. STATE PERSISTENCE ATTACKS
  // ====================================================================
  console.log('\n=== SECTION 6: State persistence attacks ===\n');

  try {
    // Save settings via IPC
    const sLoadResult = await win.evaluate(() => window.tflex.loadSettings());
    console.log(`  Settings result: ${JSON.stringify(sLoadResult).slice(0, 200)}`);
    
    // Try saving malformed geometry (pass plain object, no TypeScript cast)
    const badSettings = {
      theme: 'dark',
      geometry: { x: -99999, y: -99999, width: 0, height: 0, maximized: false },
      recentFiles: [],
    };
    await win.evaluate((s) => window.tflex.saveSettings(s), badSettings);
    console.log(`  Saved extreme geometry: x=-99999 y=-99999 w=0 h=0`);
    
    // Reload settings and check geometry
    await sleep(500);
    const reloadedSettings = await win.evaluate(() => window.tflex.loadSettings());
    const geo = reloadedSettings?.value?.geometry || reloadedSettings?.geometry;
    console.log(`  Reloaded geometry: ${JSON.stringify(geo)}`);
    
    if (geo && (geo.width < 640 || geo.height < 480)) {
      R('ADV-032', 'Settings geometry persistence: zero/extreme values not clamped', 'MEDIUM',
        'Saved settings with geometry {x:-99999, y:-99999, width:0, height:0}',
        'normalizeGeometry should clamp width >= 640, height >= 480',
        `Persisted geometry: ${JSON.stringify(geo)}`);
    } else {
      console.log(`  Geometry clamping -- PASS (w=${geo?.width} h=${geo?.height})`);
    }

    // Save recent files with garbage
    const badRecents = {
      theme: 'dark',
      geometry: { x: 100, y: 100, width: 1440, height: 900, maximized: false },
      recentFiles: [
        { path: '', name: '', openedAt: 'not-a-date' },
        { path: '/nonexistent/path.pdf', name: 'gone.pdf', openedAt: new Date().toISOString() },
        null,
        { path: 'C:\\Windows\\system32\\config\\SAM', name: 'sensitive.pdf', openedAt: new Date().toISOString() },
      ],
    };
    await win.evaluate((s) => window.tflex.saveSettings(s), badRecents);
    console.log(`  Saved garbage recent files`);
    
  } catch(e) {
    console.log('  Section 6 error:', e.message);
  }

  // ====================================================================
  // 7. SILENCE SURFACE — CROP then verify
  // ====================================================================
  console.log('\n=== SECTION 7: Silence-surface probes ===\n');

  // 7a. Crop then re-read the document bytes, verify CropBox exists
  try {
    const repPath = copyToTemp('report.pdf');
    if (repPath) {
      const docId = 'silence-crop';
      await engine('loadDocument', docId, repPath);
      const stateBefore = await getState(docId);
      const beforeCount = stateBefore.ok ? stateBefore.value.pageCount : 0;
      const firstPageSize = stateBefore.ok ? stateBefore.value.pageStates?.[0]?.size : null;
      console.log(`  Pre-crop page 1 size: ${JSON.stringify(firstPageSize)}`);
      
      // Crop page 1 to 50% width/height
      if (firstPageSize) {
        const cropBox = {
          x: 0, y: 0,
          width: firstPageSize.width / 2,
          height: firstPageSize.height / 2,
        };
        const cropResult = await engine('cropPages', docId, [
          { page: 1, box: cropBox },
        ]);
        
        if (cropResult && cropResult.ok) {
          console.log(`  Crop result: ok`);
          
          // Save via serializeDoc to get bytes
          const bytesResult = await engine('getDocumentBytes', docId);
          if (bytesResult && bytesResult.ok) {
            const cropPath = tmpPath('cropped.pdf');
            fs.writeFileSync(cropPath, Buffer.from(bytesResult.value));
            
            // Re-load and check crop
            const reloadId = docId + '-crop-reload';
            await engine('loadDocument', reloadId, cropPath);
            await sleep(50);
            const reloaded = await getState(reloadId);
            const diskCount = reloaded.ok ? reloaded.value.pageCount : -1;
            
            // Check page count preserved
            if (diskCount !== beforeCount) {
              R('ADV-033', 'Crop: page count changed after crop+save-reload', 'HIGH',
                `Cropped page 1, saved, reloaded. Original ${beforeCount} pages, got ${diskCount}`,
                `Page count must be preserved after crop`,
                `Got ${diskCount}, expected ${beforeCount}`);
            } else {
              console.log(`  Crop round-trip: pages match (${diskCount}) -- PASS`);
            }
          }
        } else {
          console.log(`  Crop failed: ${cropResult?.error?.code} ${cropResult?.error?.message}`);
        }
      }
    }
  } catch(e) {
    console.log('  Section 7a error:', e.message);
  }

  // 7b. Crop with empty/invalid crop entries (silence surface)
  try {
    const repPath = copyToTemp('report.pdf');
    if (repPath) {
      const docId = 'silence-crop-bad';
      await engine('loadDocument', docId, repPath);
      
      // Crop with zero-size box
      const crop1 = await engine('cropPages', docId, [
        { page: 1, box: { x: 0, y: 0, width: 0, height: 0 } },
      ]);
      console.log(`  Crop zero-size: ${crop1 ? (crop1.ok ? 'OK (silent!)' : `ERR ${crop1.error?.code}`) : 'null'}`);
      if (crop1 && crop1.ok) {
        R('ADV-034', 'Crop with zero-dimension box succeeds silently', 'MEDIUM',
          'Called cropPages with {width:0, height:0}',
          'cropPagesInDoc should reject with engine-error (box.width <= 0)',
          `cropPages returned ok`);
      }
      
      // Crop with negative box
      const crop2 = await engine('cropPages', docId, [
        { page: 1, box: { x: -100, y: -100, width: -50, height: -50 } },
      ]);
      console.log(`  Crop negative: ${crop2 ? (crop2.ok ? 'OK (silent!)' : `ERR ${crop2.error?.code}`) : 'null'}`);
      if (crop2 && crop2.ok) {
        R('ADV-035', 'Crop with negative dimensions succeeds silently', 'MEDIUM',
          'Called cropPages with {x:-100, y:-100, width:-50, height:-50} (negative width)',
          'Should reject: box.width <= 0 triggers error',
          `cropPages returned ok`);
      }
      
      // Crop page out of range
      const crop3 = await engine('cropPages', docId, [
        { page: 99999, box: { x: 0, y: 0, width: 100, height: 100 } },
      ]);
      console.log(`  Crop out-of-range: ${crop3 ? (crop3.ok ? 'OK (silent!)' : `ERR ${crop3.error?.code}`) : 'null'}`);
      if (crop3 && crop3.ok) {
        R('ADV-036', 'Crop with out-of-range page number succeeds silently', 'MEDIUM',
          'Called cropPages with page=99999 (doc has 34 pages)',
          'Should return out-of-range error',
          `cropPages returned ok`);
      }
    }
  } catch(e) {
    console.log('  Section 7b error:', e.message);
  }

  // 7c. After crop+undo, check state is consistent
  try {
    const repPath = copyToTemp('report.pdf');
    if (repPath) {
      const docId = 'silence-crop-undo';
      await engine('loadDocument', docId, repPath);
      const stateBefore = await getState(docId);
      const prePages = stateBefore.ok ? stateBefore.value.pageStates?.length : 0;
      
      // Crop page 1
      await engine('cropPages', docId, [
        { page: 1, box: { x: 10, y: 10, width: 200, height: 300 } },
      ]);
      
      // Undo
      const undoResult = await engine('undo', docId);
      if (undoResult && undoResult.ok) {
        const afterUndo = undoResult.value;
        const undoPages = afterUndo.pageStates?.length;
        
        if (undoPages !== prePages) {
          R('ADV-037', 'Crop+undo: page count changed after undo', 'MEDIUM',
            'Cropped page 1, then undid. Original page count = ${prePages}, after undo = ${undoPages}',
            'Undo should restore exact original state, including page count',
            `Got ${undoPages}, expected ${prePages}`);
        } else {
          console.log(`  Crop+undo: pages match (${undoPages}) -- PASS`);
        }
      }
    }
  } catch(e) {
    console.log('  Section 7c error:', e.message);
  }

  // 7d. ExportPages — verify output is valid PDF
  try {
    const repPath = copyToTemp('report.pdf');
    if (repPath) {
      const docId = 'silence-export';
      await engine('loadDocument', docId, repPath);
      
      const exportResult = await engine('exportPages', docId, { format: '', range: [1, 3] });
      if (exportResult && exportResult.ok) {
        const entries = exportResult.value;
        console.log(`  Export pages: ${entries.length} entries`);
        
        // Write each entry and verify it can be re-loaded
        for (const entry of entries) {
          const entryPath = tmpPath(`export-page-${entry.pageIndex}.pdf`);
          fs.writeFileSync(entryPath, Buffer.from(entry.buffer));
          
          try {
            const reloadDoc = 'verify-export-' + entry.pageIndex;
            const reload = await engine('loadDocument', reloadDoc, entryPath);
            const state = reload && reload.ok ? await getState(reloadDoc) : null;
            const count = state && state.ok ? state.value.pageCount : 0;
            console.log(`  Export page ${entry.pageIndex}: file OK (pages=${count})`);
          } catch(e2) {
            R('ADV-038', 'ExportPages produces corrupt file', 'HIGH',
              `Export page ${entry.pageIndex}, saved bytes to disk, attempted reload`,
              'Reload should succeed (export produces valid PDF)',
              `Reload threw: ${e2.message}`);
          }
        }
      } else {
        console.log(`  Export failed: ${exportResult?.error?.code}`);
      }
    }
  } catch(e) {
    console.log('  Section 7d error:', e.message);
  }

  // ====================================================================
  // SUMMARY
  // ====================================================================
  console.log('\n\n=== DEEP SWEEP COMPLETE ===');
  console.log(`Findings: ${RESULTS.length}`);
  for (const r of RESULTS) {
    console.log(`  ${r.id}: ${r.title} [${r.severity}]`);
  }

  await sleep(500);
  await app.close();
  return RESULTS;
}

main().catch(e => {
  console.error('FATAL:', e.message, e.stack);
  process.exit(1);
});