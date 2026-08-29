const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Helper to copy samples for DEF-026
function getSampleCopy(name) {
    const src = path.join(app.getAppPath(), 'assets', 'samples', name);
    const dest = path.join(os.tmpdir(), `tflex-batch2-${Date.now()}-${name}`);
    fs.copyFileSync(src, dest);
    return dest;
}

// Mock tflexDiagnostics if not present, but it should be.
// We'll use executeJavaScript to interact with the renderer.

const screenshotsDir = path.resolve(__dirname, '../screenshots');
if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
}

async function runTests() {
    console.log('--- QA BATCH 2 RETEST START ---');
    try {
        let win = null;
        for (let i = 0; i < 200; i++) {
            win = BrowserWindow.getAllWindows()[0];
            if (win && win.webContents && !win.webContents.isLoading()) break;
            await new Promise(r => setTimeout(r, 100));
        }
        if (!win) throw new Error('No window');

        const exec = (code) => win.webContents.executeJavaScript(code);
        const getDiag = () => exec('window.tflexDiagnostics()');
        const screenshot = async (name) => {
            const img = await win.capturePage();
            fs.writeFileSync(path.join(screenshotsDir, name), img.toPNG());
        };

        // Wait for React to settle
        await new Promise(r => setTimeout(r, 2000));

        // --- DEF-009: Concurrent delete during save ---
        console.log('Retesting DEF-009 (using temp copy)...');
        const reportPath9 = getSampleCopy('report.pdf');
        
        // Mock open dialog in the main process
        const originalShowOpen = require('electron').dialog.showOpenDialog;
        require('electron').dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [reportPath9] });
        
        await exec(`document.querySelector('button:has-text("Open PDF")')?.click()`);

        // Wait for open
        for (let i = 0; i < 100; i++) {
            const d = await getDiag();
            if (d && d.pageCount === 34) break;
            await new Promise(r => setTimeout(r, 100));
        }
        
        // Restore dialog
        require('electron').dialog.showOpenDialog = originalShowOpen;

        const diag9 = await getDiag();
        const docId9 = diag9.activeTabId;

        await exec(`
            (async function() {
                const id = "${docId9}";
                window.tflex.engine.save(id);
                window.tflex.engine.applyOp(id, { kind: 'delete', page: 0 });
                window.tflex.engine.applyOp(id, { kind: 'delete', page: 0 });
                window.tflex.engine.applyOp(id, { kind: 'delete', page: 0 });
            })()
        `);
        await new Promise(r => setTimeout(r, 2000));
        const finalDiag9 = await getDiag();
        const def009Passed = finalDiag9.pageCount === 31 && finalDiag9.modified === true;
        console.log(`DEF-009 (Save Race): ${def009Passed ? 'PASSED' : 'FAILED'} (pages=${finalDiag9.pageCount}, modified=${finalDiag9.modified})`);
        await screenshot('def-009-verify.png');
        await exec(`document.querySelector('.tab-close')?.click()`);
        await new Promise(r => setTimeout(r, 500));

        // --- DEF-010: Rail undo multi-step ---
        console.log('Retesting DEF-010...');
        await exec(`
            (function() {
                const card = Array.from(document.querySelectorAll('.sample-card')).find(c => c.textContent.includes('report.pdf'));
                if (card) card.click();
            })()
        `);
        await new Promise(r => setTimeout(r, 1000));
        for (let i = 0; i < 4; i++) {
            await exec(`document.querySelector('button[title="Rotate clockwise"]')?.click()`);
            await new Promise(r => setTimeout(r, 100));
        }
        
        const undoBtnSelector = 'button[title="Undo last change"]';
        let def010Passed = true;
        for (let i = 0; i < 3; i++) {
            const disabled = await exec(`document.querySelector('${undoBtnSelector}')?.disabled`);
            if (disabled) { def010Passed = false; break; }
            await exec(`document.querySelector('${undoBtnSelector}')?.click()`);
            await new Promise(r => setTimeout(r, 200));
        }
        const finalDisabled = await exec(`document.querySelector('${undoBtnSelector}')?.disabled`);
        if (finalDisabled) def010Passed = false;
        
        console.log(`DEF-010 (Undo Button): ${def010Passed ? 'PASSED' : 'FAILED'}`);
        await screenshot('def-010-verify.png');
        await exec(`document.querySelector('.tab-close')?.click()`);
        await new Promise(r => setTimeout(r, 500));

        // --- DEF-011: Save-As to locked destination ---
        console.log('Retesting DEF-011...');
        await exec(`
            (function() {
                const card = Array.from(document.querySelectorAll('.sample-card')).find(c => c.textContent.includes('report.pdf'));
                if (card) card.click();
            })()
        `);
        await new Promise(r => setTimeout(r, 1000));
        await exec(`document.querySelector('button[title="Rotate clockwise"]')?.click()`);
        
        // Trigger saveAs to a failing path
        await exec(`
            (async function() {
                const diag = window.tflexDiagnostics();
                await window.tflex.engine.saveAs(diag.activeTabId, 'C:/Windows/System32/tflex_should_fail.pdf').catch(e => {});
            })()
        `);
        
        await new Promise(r => setTimeout(r, 1000));
        const toastText11 = await exec(`document.querySelector('.toast')?.textContent || ''`);
        const def011Passed = toastText11.includes('Could not write file');
        console.log(`DEF-011 (Save-As Error): ${def011Passed ? 'PASSED' : 'FAILED'} (toast="${toastText11}")`);
        await screenshot('def-011-verify.png');
        await exec(`document.querySelector('.tab-close')?.click()`);

        // --- DEF-012: Split-all rejected ---
        console.log('Retesting DEF-012...');
        await exec(`
            (function() {
                const card = Array.from(document.querySelectorAll('.sample-card')).find(c => c.textContent.includes('report.pdf'));
                if (card) card.click();
            })()
        `);
        await new Promise(r => setTimeout(r, 1000));
        await exec(`
            (async function() {
                const diag = window.tflexDiagnostics();
                await window.tflex.engine.split(diag.activeTabId, '1-34', 'split');
            })()
        `);
        await new Promise(r => setTimeout(r, 1000));
        const toastText12 = await exec(`document.querySelector('.toast')?.textContent || ''`);
        const def012Passed = toastText12.toLowerCase().includes('range');
        console.log(`DEF-012 (Split-All Guard): ${def012Passed ? 'PASSED' : 'FAILED'} (toast="${toastText12}")`);
        await screenshot('def-012-verify.png');
        await exec(`document.querySelector('.tab-close')?.click()`);

        // --- DEF-013: Corrupt PDF open ---
        console.log('Retesting DEF-013...');
        await exec(`
            (async function() {
                const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
                await window.tflex.engine.loadDocumentBytes('junk-doc', bytes).catch(e => {});
            })()
        `);
        await new Promise(r => setTimeout(r, 1000));
        const toastText13 = await exec(`document.querySelector('.toast')?.textContent || ''`);
        // Expected typed error toast. 
        const def013Passed = toastText13.length > 0 && !toastText13.includes('TypeError');
        console.log(`DEF-013 (Corrupt PDF): ${def013Passed ? 'PASSED' : 'FAILED'} (toast="${toastText13}")`);
        await screenshot('def-013-verify.png');

        // --- Regression P1 & P2 ---
        console.log('Running P1/P2 Regression...');
        // (Summarized steps here)
        const samplesCount = await exec(`document.querySelectorAll('.sample-card').length`);
        console.log(`P1: Samples Count (4): ${samplesCount === 4 ? 'PASS' : 'FAIL'}`);
        
        await exec(`document.querySelector('.theme-toggle')?.click()`);
        await new Promise(r => setTimeout(r, 300));
        const theme = await exec(`window.tflexDiagnostics().theme`);
        console.log(`P1: Theme toggle works: ${theme !== diag9.theme ? 'PASS' : 'FAIL'}`);

        console.log('\n--- FINAL DISPOSITIONS ---');
        console.log(`DEF-009: ${def009Passed ? 'CLOSED' : 'OPEN'}`);
        console.log(`DEF-010: ${def010Passed ? 'CLOSED' : 'OPEN'}`);
        console.log(`DEF-011: ${def011Passed ? 'CLOSED' : 'OPEN'}`);
        console.log(`DEF-012: ${def012Passed ? 'CLOSED' : 'OPEN'}`);
        console.log(`DEF-013: ${def013Passed ? 'CLOSED' : 'OPEN'}`);

    } catch (e) {
        console.error('Test error:', e);
    } finally {
        console.log('--- QA BATCH 2 RETEST FINISHED ---');
        app.quit();
    }
}

app.on('ready', () => {
    setTimeout(runTests, 1000);
});
