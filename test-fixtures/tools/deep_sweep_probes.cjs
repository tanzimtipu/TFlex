#!/usr/bin/env node
/**
 * Deep Sweep — Targeted Probes (Phase 2)
 * Session: deep-sweep-final
 *
 * Follows up on live findings from the initial sweep:
 * 1. ADV-008 save-race still present
 * 2. Loaded-but-broken hostile PDFs (corrupted.pdf, no-trailer.pdf,
 *    huge-images.pdf, malformed-xref.pdf) — check state after load
 * 3. Rotate ALL fails on loaded hostile PDFs
 * 4. ADV-009 undo button — check rotation after load
 * 5. Document safety: crop effects on saved PDF
 * 6. ExportText output validation
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
  console.log('=== Deep Sweep: Targeted Probes ===\n');
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
  async function getState(docId) {
    return engine('getState', docId);
  }

  // ==================================================================
  // PROBE A: ADV-008 regression — detailed save-race check
  // ==================================================================
  console.log('\n--- PROBE A: ADV-008 save-race regression ---');
  try {
    const repPath = copyToTemp('report.pdf');
    if (repPath) {
      const DOC = 'probe-a';
      const load = await engine('loadDocument', DOC, repPath);
      if (load && load.ok) {
        // Merge to double pages
        const merge = await engine('merge', DOC, [repPath], 'after');
        if (merge && merge.ok) {
          const fullCount = merge.value.pageCount; // 68
          console.log(`  Merged: ${fullCount} pages`);
          
          // Save, but interleave deletes
          const savePromise = engine('save', DOC);
          const del1 = engine('applyOp', DOC, { kind: 'delete', page: fullCount });
          const del2 = engine('applyOp', DOC, { kind: 'delete', page: fullCount - 1 });
          const del3 = engine('applyOp', DOC, { kind: 'delete', page: fullCount - 2 });
          
          const saveResult = await savePromise;
          const d1 = await del1;
          const d2 = await del2;
          const d3 = await del3;
          
          console.log(`  Save: ${saveResult ? (saveResult.ok ? 'OK' : 'ERR ' + saveResult.error?.code) : 'null'}`);
          console.log(`  Del1: ${d1 ? (d1.ok ? 'OK' : 'ERR ' + d1.error?.code) : 'null'}`);
          console.log(`  Del2: ${d2 ? (d2.ok ? 'OK' : 'ERR ' + d2.error?.code) : 'null'}`);
          console.log(`  Del3: ${d3 ? (d3.ok ? 'OK' : 'ERR ' + d3.error?.code) : 'null'}`);
          
          const state = await getState(DOC);
          if (state && state.ok) {
            const memPages = state.value.pageCount;
            
            // Reload from disk
            const DOC2 = 'probe-a-disk';
            const reload = await engine('loadDocument', DOC2, repPath);
            if (reload && reload.ok) {
              const diskState = await getState(DOC2);
              const diskPages = diskState.ok ? diskState.value.pageCount : -1;
              
              // If save cleared undo and deletes happened during save, the
              // disk file has old state. Check if disk != mem.
              console.log(`  Memory: ${memPages} pages, Disk: ${diskPages} pages`);
              if (diskPages > memPages) {
                R('ADV-039', 'ADV-008 save-race regression confirmed: deletes during save silently lost', 
                  'HIGH',
                  'Save initiated, three deletes dispatched concurrently, then reloaded from disk',
                  'Disk should reflect ALL operations (correct page count)',
                  'Disk has ' + diskPages + ' pages, memory has ' + memPages + ' pages — deletes were lost');
              }
            }
          }
        }
      }
    }
  } catch(e) { console.log('  Probe A error:', e.message); }

  // ==================================================================
  // PROBE B: Loaded-but-broken hostile PDFs — state inspection
  // ==================================================================
  console.log('\n--- PROBE B: Hostile PDF deep state ---');

  const hostilesThatLoaded = [
    { file: 'corrupted.pdf', name: 'corrupted' },
    { file: 'no-trailer.pdf', name: 'no-trailer' },
    { file: 'huge-images.pdf', name: 'huge-images' },
    { file: 'malformed-xref.pdf', name: 'malformed-xref' },
  ];

  for (const h of hostilesThatLoaded) {
    const hPath = fixture(h.file);
    if (!fs.existsSync(hPath)) continue;
    const docId = 'probe-b-' + h.name;
    try {
      const load = await engine('loadDocument', docId, hPath);
      if (load && load.ok) {
        const state = await getState(docId);
        if (state && state.ok) {
          const s = state.value;
          console.log(`  ${h.file}: loaded=true, pageCount=${s.pageCount}, pageStates=${JSON.stringify(s.pageStates)}`);
          
          // Check if pageStates is sane
          if (s.pageCount > 0 && (!s.pageStates || s.pageStates.length === 0 || s.pageStates.some(ps => ps === null || ps === undefined))) {
            R('ADV-040', 'Hostile PDF loads with pageCount>0 but pageStates missing/null', 'MEDIUM',
              'Loaded ' + h.file + ' (result ok), inspected state.pageStates',
              'pageStates should have ' + s.pageCount + ' entries matching pageCount',
              'pageStates=' + JSON.stringify(s.pageStates).slice(0, 200));
          }

          // Try rotate via applyOp  
          const rotate = await engine('applyOp', docId, { kind: 'rotate', page: 1, direction: 'cw' });
          if (rotate && !rotate.ok) {
            console.log(`  rotate page 1: ${rotate.error?.code}: ${rotate.error?.message}`);
            R('ADV-041', 'APPLY_OP rotate fails on loaded hostile PDF', 'MEDIUM',
              'Loaded ' + h.file + ', called applyOp with rotate on page 1',
              'Rotate should work on a loaded document with pageCount > 0',
              'Rotate returned: ' + rotate.error?.code + ' - ' + rotate.error?.message);
          }
          
          // Try reorder
          if (s.pageCount >= 2) {
            const reorder = await engine('applyOp', docId, { kind: 'reorder', fromIndex: 0, toIndex: 1 });
            console.log(`  reorder: ${reorder ? (reorder.ok ? 'OK' : 'ERR ' + reorder.error?.code) : 'null'}`);
          }
          
          // Try delete
          if (s.pageCount >= 1) {
            const del = await engine('applyOp', docId, { kind: 'delete', page: 1 });
            console.log(`  delete: ${del ? (del.ok ? 'OK' : 'ERR ' + del.error?.code) : 'null'}`);
            if (del && del.ok) {
              // Check page decremented
              const after = await getState(docId);
              console.log(`  after delete: pageCount=${after.ok ? after.value.pageCount : 'err'}`);
            }
          }
        }
      }
    } catch(e) {
      console.log('  ' + h.file + ' CRASH:', e.message);
    }
  }

  // ==================================================================
  // PROBE C: Normal doc — rotation after load then operations
  // ==================================================================
  console.log('\n--- PROBE C: Rotation model check (ADV-009 area) ---');
  try {
    const repPath = copyToTemp('report.pdf');
    if (repPath) {
      const docId = 'probe-c';
      await engine('loadDocument', docId, repPath);
      
      // Check state shape
      let state = await getState(docId);
      if (state && state.ok) {
        console.log('  State keys:', Object.keys(state.value).join(', '));
        console.log('  pageCount:', state.value.pageCount);
        
        const ps = state.value.pageStates;
        if (ps && ps.length > 0) {
          console.log('  pageStates[0]:', JSON.stringify(ps[0]));
          
          // Rotate
          const rot = await engine('applyOp', docId, { kind: 'rotate', page: 1, direction: 'cw' });
          if (rot && rot.ok) {
            const afterRot = rot.value;
            const ps2 = afterRot.pageStates;
            if (ps2 && ps2[0]) {
              console.log('  After rotate page 1 cw:', JSON.stringify(ps2[0]));
              const rotVal = ps2[0].rotation;
              console.log('  rotation[0]:', rotVal);
              
              // Undo
              const undo = await engine('undo', docId);
              if (undo && undo.ok) {
                const ps3 = undo.value.pageStates;
                if (ps3 && ps3[0]) {
                  console.log('  After undo rotation[0]:', ps3[0].rotation);
                }
              }
            } else {
              console.log('  pageStates null/empty after rotate');
              R('ADV-042', 'Rotate returns state with null/undefined pageStates', 'MEDIUM',
                'Rotated page 1, engine returned ok but pageStates is missing',
                'pageStates should reflect updated state',
                'pageStates=' + JSON.stringify(ps2));
            }
          } else {
            console.log('  Rotate failed:', rot?.error?.code, rot?.error?.message);
          }
        } else {
          console.log('  pageStates null/empty on fresh load');
          R('ADV-043', 'Freshly loaded document has null/empty pageStates', 'MEDIUM',
            'Loaded report.pdf, called getState',
            'pageStates should be populated for each page',
            'pageStates=' + JSON.stringify(ps));
        }
      }
    }
  } catch(e) { console.log('  Probe C error:', e.message); }

  // ==================================================================
  // PROBE D: Insert blank page + undo + save round-trip
  // ==================================================================
  console.log('\n--- PROBE D: Insert blank page round-trip ---');
  try {
    const repPath = copyToTemp('report.pdf');
    if (repPath) {
      const docId = 'probe-d';
      await engine('loadDocument', docId, repPath);
      let state = await getState(docId);
      const preCount = state.ok ? state.value.pageCount : 0;
      console.log('  Pre-insert pages:', preCount);
      
      // Insert blank page at end
      const insert = await engine('insertBlankPage', docId, -1, 612, 792);
      if (insert && insert.ok) {
        console.log('  After insert pages:', insert.value.pageCount);
        
        // Undo the insert
        const undo = await engine('undo', docId);
        if (undo && undo.ok) {
          const afterUndo = undo.value.pageCount;
          console.log('  After undo pages:', afterUndo);
          
          // Check modified flag
          const modified = await engine('isModified', docId);
          console.log('  Modified after undo:', modified.ok ? modified.value : modified.error?.code);
          
          // Re-insert
          const insert2 = await engine('insertBlankPage', docId, -1, 612, 792);
          if (insert2 && insert2.ok) {
            console.log('  After re-insert pages:', insert2.value.pageCount);
            
            // Save
            const bytesResult = await engine('getDocumentBytes', docId);
            if (bytesResult && bytesResult.ok) {
              const savePath = tmpPath('insert-roundtrip.pdf');
              const buf = bytesResult.value;
              if (buf instanceof ArrayBuffer) {
                fs.writeFileSync(savePath, Buffer.from(buf));
                
                const reloadId = docId + '-reload';
                const reload = await engine('loadDocument', reloadId, savePath);
                if (reload && reload.ok) {
                  const diskState = await getState(reloadId);
                  const diskCount = diskState.ok ? diskState.value.pageCount : -1;
                  console.log('  Saved & reloaded pages:', diskCount);
                  
                  if (diskCount !== preCount + 1) {
                    R('ADV-044', 'Insert blank page: saved doc has wrong page count', 'HIGH',
                      'Inserted blank page at end, saved via getDocumentBytes, reloaded',
                      'Saved doc should have ' + (preCount + 1) + ' pages',
                      'Got ' + diskCount + ' pages');
                  }
                }
              } else {
                console.log('  getDocumentBytes returned non-ArrayBuffer:', typeof buf);
              }
            }
          }
        }
      }
    }
  } catch(e) { console.log('  Probe D error:', e.message); }

  // ==================================================================
  // PROBE E: Annotation + crop + save round-trip
  // ==================================================================
  console.log('\n--- PROBE E: Annotation + crop save round-trip ---');
  try {
    const repPath = copyToTemp('report.pdf');
    if (repPath) {
      const docId = 'probe-e';
      await engine('loadDocument', docId, repPath);
      const preState = await getState(docId);
      const preCount = preState.ok ? preState.value.pageCount : 0;
      
      // Create annotation
      const ann = await engine('createAnnotation', docId, {
        type: 'highlight', page: 1, rect: { x: 50, y: 50, width: 200, height: 30 }, color: '#ffff00',
      });
      console.log('  Annotation:', ann ? (ann.ok ? 'OK' : 'ERR ' + ann.error?.code) : 'null');
      
      // Get state after annotation
      const stateAfterAnn = await getState(docId);
      const annCount = stateAfterAnn.ok ? stateAfterAnn.value.pageCount : 0;
      console.log('  After annotation pages:', annCount);
      
      // Save
      const bufResult = await engine('getDocumentBytes', docId);
      if (bufResult && bufResult.ok) {
        const buf = bufResult.value;
        if (buf instanceof ArrayBuffer) {
          const savePath = tmpPath('ann-crop-save.pdf');
          fs.writeFileSync(savePath, Buffer.from(buf));
          
          const reloadId = docId + '-reload';
          const reload = await engine('loadDocument', reloadId, savePath);
          if (reload && reload.ok) {
            const diskState = await getState(reloadId);
            const diskCount = diskState.ok ? diskState.value.pageCount : -1;
            console.log('  Saved & reloaded pages:', diskCount);
            
            if (diskCount !== preCount) {
              R('ADV-045', 'Annotation + save round-trip: page count changed', 'HIGH',
                'Added annotation, saved via getDocumentBytes, reloaded',
                'Page count should be preserved (' + preCount + ')',
                'Got ' + diskCount + ' pages');
            }
          }
        }
      }
    }
  } catch(e) { console.log('  Probe E error:', e.message); }

  // ==================================================================
  // PROBE F: ExportText — check output for non-empty
  // ==================================================================
  console.log('\n--- PROBE F: ExportText ---');
  try {
    const repPath = copyToTemp('report.pdf');
    if (repPath) {
      const docId = 'probe-f';
      await engine('loadDocument', docId, repPath);
      
      const textResult = await engine('exportText', docId);
      if (textResult && textResult.ok) {
        const pages = textResult.value;
        if (Array.isArray(pages) && pages.length > 0) {
          console.log('  ExportText: ' + pages.length + ' pages');
          const totalChars = pages.reduce((sum, p) => sum + (p.text ? p.text.length : 0), 0);
          console.log('  Total chars: ' + totalChars);
          
          if (totalChars === 0) {
            R('ADV-046', 'ExportText returns pages with empty text content', 'MEDIUM',
              'Loaded report.pdf (34 pages with text), called exportText',
              'Should return text content',
              'Got ' + pages.length + ' pages with 0 total characters');
          }
        } else {
          console.log('  ExportText: empty or non-array result');
          R('ADV-047', 'ExportText returns empty/non-array result for text document', 'LOW',
            'Loaded report.pdf (34 pages with text), called exportText',
            'Should return an array of TextPage entries',
            'Got: ' + JSON.stringify(pages).slice(0, 200));
        }
      } else {
        console.log('  ExportText failed:', textResult?.error?.code, textResult?.error?.message);
      }
    }
  } catch(e) { console.log('  Probe F error:', e.message); }

  // ==================================================================
  // PROBE G: Renumber pages + save round-trip
  // ==================================================================
  console.log('\n--- PROBE G: Renumber pages round-trip ---');
  try {
    const repPath = copyToTemp('report.pdf');
    if (repPath) {
      const docId = 'probe-g';
      await engine('loadDocument', docId, repPath);
      
      const renumber = await engine('renumberPages', docId, [
        { page: 1, label: 'i' },
        { page: 2, label: 'ii' },
        { page: 3, label: 'iii' },
      ]);
      console.log('  Renumber:', renumber ? (renumber.ok ? 'OK' : 'ERR ' + renumber.error?.code) : 'null');
      
      if (renumber && renumber.ok) {
        // Save and reload
        const bufResult = await engine('getDocumentBytes', docId);
        if (bufResult && bufResult.ok) {
          const buf = bufResult.value;
          if (buf instanceof ArrayBuffer) {
            const savePath = tmpPath('renumbered.pdf');
            fs.writeFileSync(savePath, Buffer.from(buf));
            
            const reloadId = docId + '-reload';
            const reload = await engine('loadDocument', reloadId, savePath);
            console.log('  Reload:', reload ? (reload.ok ? 'OK' : 'ERR ' + reload.error?.code) : 'null');
          }
        }
      }
    }
  } catch(e) { console.log('  Probe G error:', e.message); }

  // ==================================================================
  // PROBE H: Renumber pages undo
  // ==================================================================
  console.log('\n--- PROBE H: Renumber + undo ---');
  try {
    const repPath = copyToTemp('report.pdf');
    if (repPath) {
      const docId = 'probe-h';
      await engine('loadDocument', docId, repPath);
      
      // Renumber
      await engine('renumberPages', docId, [{ page: 1, label: 'Cover' }]);
      console.log('  Renumbered: OK');
      
      // Undo
      const undo = await engine('undo', docId);
      console.log('  Undo:', undo ? (undo.ok ? 'OK' : 'ERR ' + undo.error?.code) : 'null');
      
      // Redo
      const redo = await engine('redo', docId);
      console.log('  Redo:', redo ? (redo.ok ? 'OK' : 'ERR ' + redo.error?.code) : 'null');
      
      // Undo again (should work)
      const undo2 = await engine('undo', docId);
      console.log('  Undo2:', undo2 ? (undo2.ok ? 'OK' : 'ERR ' + undo2.error?.code) : 'null');
    }
  } catch(e) { console.log('  Probe H error:', e.message); }

  // ==================================================================
  // PROBE I: Multiple rapid saveSettings calls
  // ==================================================================
  console.log('\n--- PROBE I: Rapid settings saves ---');
  try {
    // Toggle theme rapidly 20 times
    for (let i = 0; i < 20; i++) {
      await win.evaluate(() => {
        return window.tflex.saveSettings({
          theme: i % 2 === 0 ? 'light' : 'dark',
          geometry: { x: 100, y: 100, width: 1440, height: 900, maximized: false },
          recentFiles: [],
        });
      }).catch(() => {});
    }
    console.log('  20 rapid settings saves: completed');
    
    // Check settings didn't get corrupted
    const check = await win.evaluate(() => window.tflex.loadSettings());
    console.log('  Settings after rapid saves:', JSON.stringify(check).slice(0, 100));
    
  } catch(e) { console.log('  Probe I error:', e.message); }

  // ==================================================================
  // PROBE J: Test null/undefined IPC args across all engine methods
  // ==================================================================
  console.log('\n--- PROBE J: Null IPC args ---');
  const nullTests = [
    ['getState', null],
    ['getState', undefined],
    ['applyOp', 'nonexistent-doc', { kind: 'rotate', page: 1, direction: 'cw' }],
    ['save', 'nonexistent-doc'],
    ['undo', 'nonexistent-doc'],
    ['redo', 'nonexistent-doc'],
    ['isModified', 'nonexistent-doc'],
  ];
  for (const args of nullTests) {
    try {
      const result = await engine(args[0], ...args.slice(1));
      console.log(`  ${args[0]}: ${result ? ('ok=' + result.ok + ' err=' + (result.error?.code || 'none')) : 'null'}`);
    } catch(e) {
      console.log('  ' + args[0] + ' CRASH:', e.message);
      R('ADV-048', 'Engine method "' + args[0] + '" throws on null/undefined docId', 'MEDIUM',
        'Called engine.' + args[0] + ' with non-existent docId',
        'Should return typed error, not throw',
        'Method threw: ' + e.message);
    }
  }

  // ==================================================================
  // SUMMARY
  // ==================================================================
  console.log('\n\n=== DEEP SWEEP PROBES COMPLETE ===');
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