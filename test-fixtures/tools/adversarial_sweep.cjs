const { _electron: electron } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { pathToFileURL } = require('node:url');

/** Evaluate a function inside the Electron renderer with a serializable arg. */
async function evalIn(win, fn, arg) {
    try {
        return await win.evaluate(fn, arg !== undefined ? arg : undefined);
    } catch (e) {
        return `[EVAL ERROR] ${e.message}`;
    }
}

async function main() {
    const projectRoot = path.resolve(__dirname, '..', '..');
    console.log('=== TFlex Adversarial Full Sweep ===\n');
    console.log(`Project root: ${projectRoot}`);

    const mainPath = path.join(projectRoot, 'dist', 'main', 'index.js');
    if (!fs.existsSync(mainPath)) {
        console.error('Build not found - run npm.cmd run build first');
        process.exit(1);
    }

    const tempDir = path.join(os.tmpdir(), `tflex-adv-sweep-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const args = [projectRoot, `--user-data-dir=${tempDir}`];
    const electronApp = await electron.launch({
        args,
        env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
    });

    // Wait for and attach to the first window
    const win = await electronApp.firstWindow();
    console.log(`Window: "${await win.title()}"`);

    let consoleErrors = [];
    win.on('console', (msg) => {
        const t = msg.text();
        if (t.toLowerCase().includes('error') || t.toLowerCase().includes('exception') || t.toLowerCase().includes('unhandled')) {
            console.log(`  [CONSOLE] ${t.slice(0, 250)}`);
            consoleErrors.push(t.slice(0, 250));
        }
    });
    win.on('pageerror', (err) => {
        console.log(`  [PAGE-ERROR] ${err.message}`);
        consoleErrors.push(`pageerror: ${err.message}`);
    });

    // Wait for the welcome screen
    await win.waitForLoadState('networkidle');
    await new Promise(r => setTimeout(r, 3000));

    const hasEngine = await evalIn(win, () => typeof window.tflex?.engine !== 'undefined');
    console.log(`Engine exposed: ${hasEngine}`);
    const hasTflex = await evalIn(win, () => typeof window.tflex !== 'undefined');
    console.log(`window.tflex: ${hasTflex}`);

    // ==================================================
    // 1. HOSTILE PDF LOADING
    // ==================================================
    console.log('\n=== 1. HOSTILE PDF LOADING ===');

    // Use the app.openFileDialog + loadPdf path (the real user-path)
    // First, override open dialog to return our file
    const hostilePaths = [
        'corrupted.pdf', 'truncated.pdf', 'zero.pdf', 'not-a-pdf.txt',
        'encrypted.pdf', 'encrypted-looking.pdf', 'encrypted-malformed.pdf',
        'no-trailer.pdf', 'broken-pagetree.pdf', 'no-kids.pdf',
        'circular-refs.pdf', 'malformed-xref.pdf', 'infinite-loop-pagetree.pdf',
        'xref-attack.pdf', 'huge-annotations.pdf', 'unicode-attack.pdf',
    ].filter(p => fs.existsSync(path.join(projectRoot, 'test-fixtures', p)));

    for (const fp of hostilePaths) {
        const absPath = path.join(projectRoot, 'test-fixtures', fp);
        console.log(`\n  Load: ${fp}`);
        
        // Use the loadPdf API directly to test each file
        const r = await evalIn(win, (p) => {
            try { return window.tflex.loadPdf(p); }
            catch(e) { return { _error: e.message }; }
        }, absPath);
        const snippet = JSON.stringify(r);
        console.log(`    -> ${snippet.slice(0, 250)}`);

        // Check window is still alive
        const alive = await evalIn(win, () => document.readyState);
        if (typeof alive !== 'string') {
            console.log('  [CRASH] Window appears dead');
            break;
        }
    }

    // ==================================================
    // 2. ENGINE ATTACKS
    // ==================================================
    console.log('\n=== 2. ENGINE ATTACKS ===');

    if (hasEngine) {
        // 2a - Path traversal via engine
        console.log('\n--- 2a. Path traversal ---');
        const traversal = await evalIn(win, () =>
            window.tflex.engine.loadDocument('traversal-test', '../../../../Windows/System32/calc.exe'));
        console.log(`  Traversal: ${JSON.stringify(traversal).slice(0, 200)}`);

        // 2b - Unicode path
        console.log('\n--- 2b. Unicode path ---');
        const uniName = '\u{1F600}\u{1F601}\u{1F602}-\u043F\u0440\u0438\u0432\u0435\u0442.pdf';
        const unicodePath = path.join(tempDir, uniName);
        const src = path.join(projectRoot, 'test-fixtures', 'report.pdf');
        if (fs.existsSync(src)) {
            try { fs.copyFileSync(src, unicodePath); } catch (e) { console.log(`  Copy failed: ${e.message}`); }
        }
        const uniResult = await evalIn(win, (p) =>
            window.tflex.engine.loadDocument('unicode-doc', p), unicodePath);
        console.log(`  Unicode load: ${JSON.stringify(uniResult).slice(0, 200)}`);

        // 2c - Null bytes / special path
        console.log('\n--- 2c. Null byte path ---');
        const nullResult = await evalIn(win, () =>
            window.tflex.engine.loadDocument('null-doc', 'C:\\test\x00.pdf'));
        console.log(`  Null path: ${JSON.stringify(nullResult).slice(0, 200)}`);

        // 2d - Load valid doc
        const reportPath = path.join(projectRoot, 'test-fixtures', 'report.pdf');
        const loadR = await evalIn(win, (p) => window.tflex.engine.loadDocument('stress-doc', p), reportPath);
        console.log(`\n--- 2d. Loaded report: ok=${loadR?.ok}`);

        if (loadR && loadR.ok) {
            // 2e - Rapid rotate x100
            console.log('\n--- 2e. Rapid rotate x100 ---');
            let ok = 0, fail = 0;
            for (let i = 0; i < 100; i++) {
                const r = await evalIn(win, () => window.tflex.engine.applyOp('stress-doc', { kind: 'rotate-cw', page: 1 }));
                if (r && r.ok) ok++;
                else if (r && !r.ok) fail++;
            }
            console.log(`  ${ok} ok, ${fail} fail`);

            // 2f - Undo exhaustion
            console.log('\n--- 2f. Undo exhaustion ---');
            let undone = 0;
            for (let i = 0; i < 200; i++) {
                const r = await evalIn(win, () => window.tflex.engine.undo('stress-doc'));
                if (!r || r.error === 'nothing-to-undo') break;
                if (r.ok) undone++;
            }
            console.log(`  Undone ${undone} steps`);

            // 2g - 20 concurrent ops
            console.log('\n--- 2g. 20 concurrent ops ---');
            const batch = [];
            for (let i = 0; i < 20; i++) {
                batch.push(evalIn(win, () => window.tflex.engine.applyOp('stress-doc', { kind: 'rotate-cw', page: 1 })));
            }
            const batchR = await Promise.all(batch);
            const bOk = batchR.filter(r => r && r.ok).length;
            const bFail = batchR.filter(r => r && !r.ok).length;
            console.log(`  ${bOk} ok, ${bFail} fail`);
        }

        // 2h - Huge annotations stress
        console.log('\n--- 2h. Huge annotations stress ---');
        const hugePath = path.join(projectRoot, 'test-fixtures', 'huge-annotations.pdf');
        if (fs.existsSync(hugePath)) {
            const hugeLoad = await evalIn(win, (p) => window.tflex.engine.loadDocument('huge-doc', p), hugePath);
            console.log(`  Load huge: ok=${hugeLoad?.ok}`);

            if (hugeLoad && hugeLoad.ok) {
                console.log('  Adding 200 annotations...');
                let annOk = 0;
                for (let i = 0; i < 200; i++) {
                    const r = await evalIn(win, (idx) => window.tflex.engine.createAnnotation('huge-doc', {
                        id: `mass-${idx}`,
                        page: 1,
                        kind: 'highlight',
                        color: 'yellow',
                        rects: [{ x: 10 + Math.random() * 400, y: 100 + Math.random() * 400, width: 20, height: 6 }],
                    }), i);
                    if (r && r.ok) annOk++;
                }
                console.log(`  Added ${annOk}/200 annotations`);
            }
        }
    }

    // ==================================================
    // 3. ANNOTATION INVALID INPUTS
    // ==================================================
    console.log('\n=== 3. ANNOTATION INVALID INPUTS ===');

    if (hasEngine) {
        const formPath = path.join(projectRoot, 'test-fixtures', 'form.pdf');
        const fLoad = await evalIn(win, (p) => window.tflex.engine.loadDocument('ann-test-doc', p), formPath);
        console.log(`  Load form.pdf: ok=${fLoad?.ok}`);

        if (fLoad && fLoad.ok) {
            const invalidAnns = [
                { id: 'inv-0', page: 9999, kind: 'rect', color: 'red', rects: [{ x: 0, y: 0, width: 10, height: 10 }] },
                { id: 'inv-1', page: -1, kind: 'rect', color: 'red', rects: [{ x: 0, y: 0, width: 10, height: 10 }] },
                { id: 'inv-2', page: 1, kind: 'rect', color: 'red', rects: [] },
                { id: 'inv-3', page: 1, kind: 'rect', color: 'red', rects: [{ x: -10000, y: -10000, width: 0, height: 0 }] },
                { id: 'inv-4', page: 1, kind: 'rect', color: 'red', rects: [{ x: 0, y: 0, width: 99999, height: 99999 }] },
                { id: 'inv-5', page: 1, kind: 'highlight', color: 'nonexistent!@#$', rects: [{ x: 0, y: 0, width: 10, height: 10 }] },
                { id: 'inv-6', page: 1, kind: 'ink', color: 'red', rects: [{ x: 0, y: 0, width: 10, height: 10 }], points: [] },
                { id: 'inv-7', page: 1, kind: 'note', color: 'red', rects: [{ x: 0, y: 0, width: 10, height: 10 }], content: null },
            ];

            for (const ann of invalidAnns) {
                const r = await evalIn(win, (a) => window.tflex.engine.createAnnotation('ann-test-doc', a), ann);
                console.log(`  ${ann.id} -> ${JSON.stringify(r).slice(0, 120)}`);
            }
        }
    }

    // ==================================================
    // 4. SETTINGS / STATE ATTACKS
    // ==================================================
    console.log('\n=== 4. SETTINGS / STATE ATTACKS ===');

    console.log('\n--- 4a. Corrupted settings ---');
    const badSettings = await evalIn(win, () => {
        try {
            return window.tflex.saveSettings({
                theme: 'nonexistent',
                recentsCap: 99999,
                geometry: { x: 'NaN', y: undefined, width: -9999, height: Infinity, maximized: 'maybe' },
                recentFiles: [{ path: null, name: undefined, openedAt: '' }],
            });
        } catch (e) {
            return { _error: e.message };
        }
    });
    console.log(`  Bad settings save: ${JSON.stringify(badSettings).slice(0, 150)}`);

    const settingsLoad = await evalIn(win, () => window.tflex.loadSettings());
    console.log(`  Reloaded: theme=${settingsLoad?.theme}, geo=${JSON.stringify(settingsLoad?.geometry).slice(0, 100)}`);

    // ==================================================
    // 5. RAPID LOAD CYCLES
    // ==================================================
    console.log('\n=== 5. RAPID LOAD CYCLES ===');

    if (hasEngine) {
        const reportPath = path.join(projectRoot, 'test-fixtures', 'report.pdf');
        console.log('  50 rapid loadDocument cycles...');
        let loadOk = 0;
        for (let i = 0; i < 50; i++) {
            const r = await evalIn(win, (args) => window.tflex.engine.loadDocument(args.docId, args.path),
                { docId: `cycle-${i}`, path: reportPath });
            if (r && r.ok) loadOk++;
            if (i % 10 === 9) console.log(`    ${i+1}/50`);
        }
        console.log(`  ${loadOk} ok`);
    }

    // ==================================================
    // 6. SAVE + OP RACE
    // ==================================================
    console.log('\n=== 6. SAVE + OP RACE ===');

    if (hasEngine) {
        const reportPath = path.join(projectRoot, 'test-fixtures', 'report.pdf');
        const raceLoad = await evalIn(win, (p) => window.tflex.engine.loadDocument('race-doc', p), reportPath);
        console.log(`  Load for race: ok=${raceLoad?.ok}`);

        if (raceLoad && raceLoad.ok) {
            for (let attempt = 0; attempt < 5; attempt++) {
                await evalIn(win, () => window.tflex.engine.applyOp('race-doc', { kind: 'rotate-cw', page: 1 }));

                const saveP = evalIn(win, () => window.tflex.engine.save('race-doc'));
                const delP = evalIn(win, () => window.tflex.engine.applyOp('race-doc', { kind: 'delete', page: 34 }));

                const [saveR, delR] = await Promise.allSettled([saveP, delP]);
                const state = await evalIn(win, () => window.tflex.engine.getState('race-doc'));
                console.log(`  Race ${attempt+1}: save=${saveR.status} del=${delR.status} pages=${state?.pageCount} mod=${state?.modified}`);
            }
        }
    }

    // ==================================================
    // 7. NETWORK / SECURITY AUDIT
    // ==================================================
    console.log('\n=== 7. NETWORK / SECURITY AUDIT ===');

    const csp = await evalIn(win, () => {
        const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
        return meta ? meta.getAttribute('content') : 'NOT FOUND';
    });
    console.log(`  CSP: ${csp}`);

    const netInfo = await evalIn(win, () => ({
        host: location.host,
        protocol: location.protocol,
    }));
    console.log(`  Net: ${JSON.stringify(netInfo)}`);

    // ==================================================
    // Summary
    // ==================================================
    console.log('\n=== SUMMARY ===');
    console.log(`Console errors: ${consoleErrors.length}`);
    consoleErrors.slice(0, 10).forEach(e => console.log(`  - ${e}`));

    console.log('\n=== CLEANUP ===');
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e) {}
    await electronApp.close();
    console.log('=== SWEEP COMPLETE ===');
}

main().catch(err => {
    console.error('FATAL:', err.message);
    if (err.stack) console.error(err.stack.slice(0, 500));
    process.exit(1);
});