const { _electron: electron } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

async function evalIn(win, fn, arg) {
    try {
        return await win.evaluate(fn, arg !== undefined ? arg : undefined);
    } catch (e) {
        return `[EVAL ERROR] ${e.message}`;
    }
}

async function main() {
    const projectRoot = path.resolve(__dirname, '..', '..');
    const tempDir = path.join(os.tmpdir(), `tflex-adv-probe-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    // Create a temp copy of small.pdf for save testing
    const tempPdf = path.join(tempDir, 'test.pdf');
    fs.copyFileSync(path.join(projectRoot, 'test-fixtures', 'report.pdf'), tempPdf);
    // Make it read-only
    try { fs.chmodSync(tempPdf, 0o444); } catch (e) {}

    console.log('=== Targeted adversarial probes ===\n');

    const electronApp = await electron.launch({
        args: [projectRoot, `--user-data-dir=${tempDir}`],
        env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
    });
    const win = await electronApp.firstWindow();
    await win.waitForLoadState('networkidle');
    await new Promise(r => setTimeout(r, 2000));

    const hasEngine = await evalIn(win, () => typeof window.tflex?.engine !== 'undefined');
    console.log(`Engine: ${hasEngine}\n`);

    // ========================================================
    // PROBE 1: Annotation validation gaps
    // ========================================================
    console.log('=== PROBE 1: Annotation validation gaps ===');

    const fLoad = await evalIn(win, (p) =>
        window.tflex.engine.loadDocument('probe-ann-doc', p),
        path.join(projectRoot, 'test-fixtures', 'form.pdf'));
    console.log(`  Load doc: ok=${fLoad?.ok}`);

    if (fLoad?.ok) {
        // Test edge cases that pass validation but create semantically broken annotations
        const edgeCases = [
            { label: 'empty rects[]', ann: { id: 'e1', page: 1, kind: 'rect', color: 'red', rects: [] }},
            { label: 'null rects', ann: { id: 'e2', page: 1, kind: 'rect', color: 'red', rects: null }},
            { label: 'undefined rects', ann: { id: 'e3', page: 1, kind: 'rect', color: 'red' }},
            { label: 'zero-size rect', ann: { id: 'e4', page: 1, kind: 'rect', color: 'red', rects: [{ x: 0, y: 0, width: 0, height: 0 }] }},
            { label: 'negative coords', ann: { id: 'e5', page: 1, kind: 'rect', color: 'red', rects: [{ x: -100, y: -100, width: 50, height: 50 }] }},
            { label: 'huge rect', ann: { id: 'e6', page: 1, kind: 'rect', color: 'red', rects: [{ x: 0, y: 0, width: 99999, height: 99999 }] }},
            { label: 'invalid color string', ann: { id: 'e7', page: 1, kind: 'highlight', color: 'nonexistent!@#$%^&*()', rects: [{ x: 10, y: 10, width: 50, height: 10 }] }},
            { label: 'null color', ann: { id: 'e8', page: 1, kind: 'highlight', color: null, rects: [{ x: 10, y: 10, width: 50, height: 10 }] }},
            { label: 'empty ink points', ann: { id: 'e9', page: 1, kind: 'ink', color: 'red', rects: [{ x: 0, y: 0, width: 10, height: 10 }], points: [] }},
            { label: 'null ink points', ann: { id: 'e10', page: 1, kind: 'ink', color: 'red', rects: [{ x: 0, y: 0, width: 10, height: 10 }], points: null }},
            { label: 'note null content', ann: { id: 'e11', page: 1, kind: 'note', color: 'yellow', rects: [{ x: 0, y: 0, width: 20, height: 20 }], content: null }},
            { label: 'note empty content', ann: { id: 'e12', page: 1, kind: 'note', color: 'yellow', rects: [{ x: 0, y: 0, width: 20, height: 20 }], content: '' }},
            { label: 'invalid page=0', ann: { id: 'e13', page: 0, kind: 'rect', color: 'red', rects: [{ x: 0, y: 0, width: 10, height: 10 }] }},
            { label: 'NaN rect values', ann: { id: 'e14', page: 1, kind: 'rect', color: 'red', rects: [{ x: NaN, y: NaN, width: NaN, height: NaN }] }},
            { label: 'Infinity rect', ann: { id: 'e15', page: 1, kind: 'rect', color: 'red', rects: [{ x: Infinity, y: -Infinity, width: Infinity, height: Infinity }] }},
        ];

        for (const { label, ann } of edgeCases) {
            const r = await evalIn(win, (a) => window.tflex.engine.createAnnotation('probe-ann-doc', a), ann);
            const ok = r?.ok === true;
            console.log(`  ${label}: ${ok ? 'ACCEPTED' : 'REJECTED'} (${JSON.stringify(r).slice(0, 150)})`);
        }
    }

    // ========================================================
    // PROBE 2: Save to read-only file
    // ========================================================
    console.log('\n=== PROBE 2: Save to read-only file ===');

    const reportPath = path.join(projectRoot, 'test-fixtures', 'report.pdf');
    const saveLoad = await evalIn(win, (p) =>
        window.tflex.engine.loadDocument('save-test-doc', p), reportPath);
    console.log(`  Load: ok=${saveLoad?.ok}`);

    if (saveLoad?.ok) {
        // Modify doc
        await evalIn(win, () =>
            window.tflex.engine.applyOp('save-test-doc', { kind: 'rotate-cw', page: 1 }));

        // The saved path is the temp read-only copy
        // Note: engine.loadDocument stores the path internally for save
        console.log('  (saveAs to a directory without write permission would need dialog mocking)');
        
        // Try save on a loadDocument-bytes doc (which has no path)
        console.log('  Try save on bytes-loaded doc (no backing file):');
        const bytesLoad = await evalIn(win, () => {
            // Load report bytes from memory
            return window.tflex.engine.loadDocumentBytes('bytes-doc',
                new Uint8Array([37, 80, 68, 70, 45, 49, 46, 52])); // %PDF-1.4 header only
        });
        console.log(`  Bytes load (truncated): ${JSON.stringify(bytesLoad).slice(0, 150)}`);
    }

    // ========================================================
    // PROBE 3: Settings state attacks
    // ========================================================
    console.log('\n=== PROBE 3: Settings state attacks ===');

    // Save and load settings with edge case values
    const edgeSettings = [
        { label: 'null theme', s: { theme: null } },
        { label: 'NaN recentsCap', s: { recentsCap: 'string instead of number' } },
        { label: 'negative recentsCap', s: { recentsCap: -1 } },
        { label: 'zero recentsCap', s: { recentsCap: 0 } },
        { label: 'huge recentsCap', s: { recentsCap: 999999 } },
        { label: 'XSS in recent file name', s: { recentFiles: [{ path: '/tmp/test.pdf', name: '<script>alert(1)</script>', openedAt: '2024-01-01' }] } },
        { label: 'command injection name', s: { recentFiles: [{ path: '/tmp/test.pdf', name: '$(cat /etc/passwd)', openedAt: '2024-01-01' }] } },
    ];

    for (const { label, s } of edgeSettings) {
        const saveR = await evalIn(win, (ss) => {
            try {
                window.tflex.saveSettings(ss);
                return 'saved';
            } catch (e) {
                return { _error: e.message };
            }
        }, s);
        console.log(`  ${label}: ${JSON.stringify(saveR).slice(0, 150)}`);
    }

    // Check the settings are still readable
    const settings = await evalIn(win, () => window.tflex.loadSettings());
    console.log(`  Current settings valid: ${!!settings?.theme}`);

    // ========================================================
    // PROBE 4: State corruption via rapid settings + engine ops
    // ========================================================
    console.log('\n=== PROBE 4: State corruption via parallel ops ===');

    // Fire saveSettings and engine op simultaneously (simulate user toggling theme while editing)
    const reportPath2 = path.join(projectRoot, 'test-fixtures', 'report.pdf');
    const pLoad = await evalIn(win, (p) =>
        window.tflex.engine.loadDocument('parallel-test-doc', p), reportPath2);
    console.log(`  Load: ok=${pLoad?.ok}`);

    if (pLoad?.ok) {
        for (let i = 0; i < 10; i++) {
            const saveP = evalIn(win, (t) => {
                try { window.tflex.saveSettings({ theme: t }); return 'ok'; }
                catch (e) { return { _error: e.message }; }
            }, i % 2 === 0 ? 'light' : 'dark');

            const opP = evalIn(win, () =>
                window.tflex.engine.applyOp('parallel-test-doc', { kind: 'rotate-cw', page: 1 }));

            const results = await Promise.allSettled([saveP, opP]);
            console.log(`  Parallel ${i}: settings=${results[0].status} engine=${results[1].status}`);
        }
    }

    // ========================================================
    // PROBE 5: Unicode metadata roundtrip
    // ========================================================
    console.log('\n=== PROBE 5: Unicode metadata attack ===');

    const uniLoad = await evalIn(win, (p) =>
        window.tflex.engine.loadDocument('unicode-ann-doc', p),
        path.join(projectRoot, 'test-fixtures', 'unicode-attack.pdf'));
    console.log(`  Unicode PDF load: ok=${uniLoad?.ok}`);

    if (uniLoad?.ok) {
        const uniState = await evalIn(win, () =>
            window.tflex.engine.getState('unicode-ann-doc'));
        console.log(`  State: pageCount=${uniState?.pageCount}, modified=${uniState?.modified}`);
        
        // Try saving and reloading
        const saveResult = await evalIn(win, () =>
            window.tflex.engine.save('unicode-ann-doc'));
        console.log(`  Save unicode doc: ${JSON.stringify(saveResult).slice(0, 150)}`);
    }

    // ========================================================
    // PROBE 6: Engine with non-existent docId
    // ========================================================
    console.log('\n=== PROBE 6: Non-existent docId ops ===');

    const badDocOps = ['applyOp', 'undo', 'redo', 'save', 'getState'];
    for (const op of badDocOps) {
        const r = await evalIn(win, (o) => {
            const eng = window.tflex.engine;
            if (o === 'applyOp') return eng.applyOp('NO_SUCH_DOC', { kind: 'rotate-cw', page: 1 });
            if (o === 'undo') return eng.undo('NO_SUCH_DOC');
            if (o === 'redo') return eng.redo('NO_SUCH_DOC');
            if (o === 'save') return eng.save('NO_SUCH_DOC');
            if (o === 'getState') return eng.getState('NO_SUCH_DOC');
            return null;
        }, op);
        console.log(`  ${op}(NONEXISTENT): ${JSON.stringify(r).slice(0, 150)}`);
    }

    // ========================================================
    // PROBE 7: Annotation on hostile loaded doc
    // ========================================================
    console.log('\n=== PROBE 7: Annotation on hostile-loaded doc ===');

    const hostilePaths = ['circular-refs.pdf', 'infinite-loop-pagetree.pdf', 'malformed-xref.pdf'];
    for (const hp of hostilePaths) {
        const absPath = path.join(projectRoot, 'test-fixtures', hp);
        if (!fs.existsSync(absPath)) continue;
        
        const hLoad = await evalIn(win, (p) => {
            return window.tflex.engine.loadDocument(`hostile-${hp}`, p);
        }, absPath);
        console.log(`  ${hp}: load ok=${hLoad?.ok}`);
        
        if (hLoad?.ok) {
            // Try to get page count
            const hState = await evalIn(win, () =>
                window.tflex.engine.getState(`hostile-${hp}`));
            console.log(`    pages=${hState?.pageCount}`);
            
            if (hState?.pageCount > 0) {
                // Try annotation
                const annR = await evalIn(win, () =>
                    window.tflex.engine.createAnnotation(`hostile-${hp}`, {
                        id: `hl-${hp}`,
                        page: 1,
                        kind: 'highlight',
                        color: 'yellow',
                        rects: [{ x: 10, y: 10, width: 50, height: 10 }],
                    }));
                console.log(`    annotate: ${JSON.stringify(annR).slice(0, 100)}`);
            }
        }
    }

    // ========================================================
    // PROBE 8: Memory / large ops stress
    // ========================================================
    console.log('\n=== PROBE 8: Stress with huge annotations PDF ===');

    const hugePath = path.join(projectRoot, 'test-fixtures', 'huge-annotations.pdf');
    if (fs.existsSync(hugePath)) {
        const hugeLoad = await evalIn(win, (p) =>
            window.tflex.engine.loadDocument('huge-stress-doc', p), hugePath);
        console.log(`  Load huge (5000 anns): ok=${hugeLoad?.ok}`);

        if (hugeLoad?.ok) {
            const hState = await evalIn(win, () =>
                window.tflex.engine.getState('huge-stress-doc'));
            console.log(`  pages=${hState?.pageCount} modified=${hState?.modified}`);

            // Try to save the doc with 5000 annotations
            const saveR = await evalIn(win, () =>
                window.tflex.engine.save('huge-stress-doc'));
            console.log(`  Save result: ${JSON.stringify(saveR).slice(0, 150)}`);

            // Try rotating it
            const rotR = await evalIn(win, () =>
                window.tflex.engine.applyOp('huge-stress-doc', { kind: 'rotate-cw', page: 1 }));
            console.log(`  Rotate: ${JSON.stringify(rotR).slice(0, 100)}`);
        }
    }

    // ========================================================
    // SUMMARY
    // ========================================================
    console.log('\n=== PROBE SUMMARY ===');
    console.log('Done. Check output for findings.');

    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {}
    await electronApp.close();
    console.log('Done.');
}

main().catch(err => {
    console.error('FATAL:', err.message);
    process.exit(1);
});