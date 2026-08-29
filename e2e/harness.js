import '../dist/main/index.js';
import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const screenshotsDir = path.resolve(__dirname, '../screenshots');

if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

// Start time for cold start measurement.
const startTime = Date.now();

async function runTests() {
  console.log('--- E2E START ---');
  try {
    let win = null;
    // Wait for the window to be created and finish loading.
    for (let i = 0; i < 200; i++) {
        win = BrowserWindow.getAllWindows()[0];
        if (win && win.webContents && !win.webContents.isLoading()) break;
        await new Promise(r => setTimeout(r, 50));
    }
    if (!win) throw new Error('No window');

    const exec = (code) => win.webContents.executeJavaScript(code);
    
    // Check diagnostics
    const getDiag = async () => {
        const has = await exec('typeof window.tflexDiagnostics === "function"').catch(() => false);
        if (!has) return null;
        return await exec('window.tflexDiagnostics()').catch(() => null);
    };

    // Poll for diagnostics to be ready and samples to be loaded (interactive)
    let diag1 = null;
    for (let i = 0; i < 200; i++) {
        diag1 = await getDiag();
        if (diag1 && diag1.sampleCount > 0) break;
        await new Promise(r => setTimeout(r, 50));
    }
    const coldStart = Date.now() - startTime;
    console.log(`Cold start: ${coldStart}ms, Samples in diag: ${diag1?.sampleCount}`);

    const screenshot = async (name) => {
        const img = await win.capturePage();
        fs.writeFileSync(path.join(screenshotsDir, name), img.toPNG());
        console.log(`Saved ${name}`);
    };

    await screenshot('e2e-welcome.png');

    // 1. Phase 1: Assert welcome screen lists 4 samples
    const samplePass = diag1.sampleCount === 4;
    console.log(`Welcome Samples (4): ${samplePass ? 'PASS' : 'FAIL'}`);

    // 2. DEF-002: open report.pdf
    console.log('Opening report.pdf...');
    await exec(`
      (function() {
        const card = Array.from(document.querySelectorAll('.sample-card')).find(c => c.textContent.includes('report.pdf'));
        if (card) card.click();
      })()
    `);
    
    // Wait for document to open (pageCount > 0)
    let diag2 = null;
    for (let i = 0; i < 200; i++) {
        diag2 = await getDiag();
        if (diag2 && diag2.pageCount === 34) break;
        await new Promise(r => setTimeout(r, 50));
    }
    
    // Verify thumbnails (DEF-002)
    // Give a small buffer for thumbnail rendering but poll for content
    let def002Status = 'OPEN';
    for (let i = 0; i < 20; i++) {
        const thumbs = await exec(`
          (function() {
            const canvases = Array.from(document.querySelectorAll('.thumbnail-rail canvas'));
            if (canvases.length === 0) return [];
            return canvases.map(c => {
                const ctx = c.getContext('2d');
                const data = ctx.getImageData(0, 0, Math.min(c.width, 10), Math.min(c.height, 10)).data;
                let hasContent = false;
                for (let j = 0; j < data.length; j++) {
                    if (data[j] !== 0) { hasContent = true; break; }
                }
                return { hasContent };
            });
          })()
        `);
        if (thumbs.length > 0 && thumbs.every(t => t.hasContent)) {
            def002Status = 'CLOSED';
            break;
        }
        await new Promise(r => setTimeout(r, 200));
    }
    console.log(`DEF-002 Retest: ${def002Status}`);
    await screenshot('e2e-report-open.png');

    // 3. Search (Phase 1)
    console.log('Searching "orchestration"...');
    await exec(`document.querySelector('button[title*="Find in document"]')?.click()`);
    await new Promise(r => setTimeout(r, 500));
    await exec(`
      (function() {
        const input = document.querySelector('.search-input');
        if (input) {
          input.value = 'orchestration';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      })()
    `);
    
    // Wait for search hits
    let diag3 = null;
    for (let i = 0; i < 100; i++) {
        diag3 = await getDiag();
        if (diag3 && diag3.searchHits > 0) break;
        await new Promise(r => setTimeout(r, 100));
    }
    const searchPass = diag3?.searchHits === 8;
    console.log(`Search "orchestration" (8): ${searchPass ? 'PASS' : 'FAIL'} (${diag3?.searchHits} hits)`);
    await screenshot('e2e-search.png');

    // 4. Theme (Phase 1)
    console.log('Theme toggle...');
    const themeBefore = diag3.theme;
    await exec(`document.querySelector('.theme-toggle')?.click()`);
    await new Promise(r => setTimeout(r, 500));
    const diag4 = await getDiag();
    const themePass = diag4.theme !== themeBefore;
    console.log(`Theme Toggle: ${themePass ? 'PASS' : 'FAIL'} (${themeBefore} -> ${diag4.theme})`);
    await screenshot('e2e-theme.png');

    // 5. Outline (Phase 1)
    console.log('Checking outline...');
    await exec(`document.querySelector('button[title="Bookmarks"]')?.click()`);
    await new Promise(r => setTimeout(r, 1000));
    const outlineCount = await exec(`document.querySelectorAll('.outline-item').length`);
    const outlinePass = outlineCount === 8;
    console.log(`Outline (8): ${outlinePass ? 'PASS' : 'FAIL'} (${outlineCount} items)`);

    // 6. DEF-003: Performance (long.pdf)
    console.log('Opening long.pdf...');
    // Close current tab
    await exec(`document.querySelector('.tab-close')?.click()`);
    await new Promise(r => setTimeout(r, 500));
    
    const longStart = Date.now();
    await exec(`
      (function() {
        const card = Array.from(document.querySelectorAll('.sample-card')).find(c => c.textContent.includes('long.pdf'));
        if (card) card.click();
      })()
    `);
    
    let def003Loaded = false;
    for (let i = 0; i < 200; i++) {
        const d = await getDiag();
        if (d && d.pageCount === 520) {
            def003Loaded = true;
            break;
        }
        await new Promise(r => setTimeout(r, 20));
    }
    const longTime = Date.now() - longStart;
    
    // Verify page slots mount bitmaps
    const mountingCheck = await exec(`
        (function() {
            const slots = document.querySelectorAll('.page-slot');
            const mounted = Array.from(slots).filter(s => s.querySelector('canvas'));
            return { totalSlots: slots.length, mountedCanvases: mounted.length };
        })()
    `);
    
    const def003Status = (def003Loaded && longTime < 3000 && mountingCheck.mountedCanvases > 0) ? 'CLOSED' : 'OPEN';
    console.log(`DEF-003 Retest: ${def003Status} (${longTime}ms, pageCount=520, mounted=${mountingCheck.mountedCanvases})`);
    await screenshot('e2e-long-pdf.png');

    // Final Performance Metrics
    const metrics = app.getAppMetrics();
    const mem = Math.round(metrics.reduce((a, m) => a + (m.memory.workingSetSize || 0), 0) / 1024);

    const perfContent = `# Performance Results

| Metric | Target | Result | Status |
| --- | --- | --- | --- |
| Cold start to interactive | < 3000ms | ${coldStart}ms | ${coldStart < 3000 ? 'PASS' : 'FAIL'} |
| Open long.pdf (520 pages) | < 3000ms | ${longTime}ms | ${longTime < 3000 ? 'PASS' : 'FAIL'} |
| Idle memory (1 document) | < 400MB | ${mem}MB | ${mem < 400 ? 'PASS' : 'FAIL'} |

*Method: Measurements taken via \`e2e/harness.js\` injected into the production-built Electron app.*
`;
    fs.writeFileSync(path.resolve(__dirname, '../PERFORMANCE.md'), perfContent);
    console.log('PERFORMANCE.md updated');

    console.log('\n--- PHASE 1 E2E RESULTS ---');
    console.log(`Welcome Samples (4): ${samplePass ? 'PASS' : 'FAIL'}`);
    console.log(`Search "orchestration" (8): ${searchPass ? 'PASS' : 'FAIL'}`);
    console.log(`Theme Toggle: ${themePass ? 'PASS' : 'FAIL'}`);
    console.log(`Outline (8): ${outlinePass ? 'PASS' : 'FAIL'}`);
    console.log(`DEF-002 (Thumbnails): ${def002Status}`);
    console.log(`DEF-003 (Long PDF Performance): ${def003Status}`);

  } catch (err) {
    console.error('TESTS FAILED:', err.stack);
  } finally {
    console.log('--- E2E END ---');
    app.quit();
  }
}

if (app.isReady()) runTests(); else app.on('ready', runTests);
