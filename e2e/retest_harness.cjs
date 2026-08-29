const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const startTime = Date.now();

async function runTests() {
  console.log('--- QA RETEST START ---');
  try {
    let win = null;
    // Wait for the window to be created by the app
    for (let i = 0; i < 100; i++) {
      win = BrowserWindow.getAllWindows()[0];
      if (win && win.webContents && !win.webContents.isLoading()) break;
      await new Promise(r => setTimeout(r, 200));
    }
    
    if (!win) {
      console.error('No window found');
      app.quit();
      return;
    }

    const exec = (code) => win.webContents.executeJavaScript(code);
    
    // Wait for React
    await new Promise(r => setTimeout(r, 3000));
    const coldStart = Date.now() - startTime;

    const getDiag = async () => {
        return await exec('window.tflexDiagnostics()').catch(() => ({}));
    };

    // 1. DEF-001 (mojibake)
    const subtitles = await exec(`
      Array.from(document.querySelectorAll('.sample-card-subtitle'))
        .map(el => el.textContent)
    `);
    const hasMojibake = subtitles.some(s => s.includes('Â·'));
    console.log(`DEF-001 (Mojibake): ${hasMojibake ? 'FAILED' : 'PASSED'}`);
    const img1 = await win.capturePage();
    fs.writeFileSync('screenshots/def-001-verify.png', img1.toPNG());

    // 2. DEF-002 (thumbnails)
    await exec(`Array.from(document.querySelectorAll('.sample-card')).find(c => c.textContent.includes('report.pdf'))?.click()`);
    await new Promise(r => setTimeout(r, 4000));
    
    const thumbCanvases = await exec(`
      Array.from(document.querySelectorAll('.thumbnail-rail canvas')).map(c => ({
        width: c.width,
        height: c.height
      }))
    `);
    const thumbsOk = thumbCanvases.length > 0 && thumbCanvases.every(t => t.width > 0);
    console.log(`DEF-002 (Thumbnails): ${thumbsOk ? 'PASSED' : 'FAILED'} (${thumbCanvases.length} thumbs)`);
    const img2 = await win.capturePage();
    fs.writeFileSync('screenshots/def-002-verify.png', img2.toPNG());

    // 3. E2E: Search
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
    await new Promise(r => setTimeout(r, 2000));
    const diagSearch = await getDiag();
    console.log(`E2E Search hits: ${diagSearch.searchHits}`);

    // 4. E2E: Theme
    const themeBefore = diagSearch.theme;
    await exec(`document.querySelector('.theme-toggle')?.click()`);
    await new Promise(r => setTimeout(r, 1000));
    const themeAfter = (await getDiag()).theme;
    console.log(`E2E Theme: ${themeBefore} -> ${themeAfter}`);

    // 5. E2E: Outline
    const outlineCount = await exec(`document.querySelectorAll('.outline-item').length`);
    console.log(`E2E Outline items: ${outlineCount}`);

    // 6. DEF-003: Performance (long.pdf)
    await exec(`document.querySelector('.tab-close')?.click()`);
    await new Promise(r => setTimeout(r, 1000));
    
    const longStart = Date.now();
    await exec(`Array.from(document.querySelectorAll('.sample-card')).find(c => c.textContent.includes('long.pdf'))?.click()`);
    
    let longTime = -1;
    for (let i = 0; i < 100; i++) {
      const d = await getDiag();
      if (d.pageCount >= 520) {
        longTime = Date.now() - longStart;
        break;
      }
      await new Promise(r => setTimeout(r, 200));
    }
    console.log(`DEF-003 (Long PDF): ${longTime}ms`);
    const img3 = await win.capturePage();
    fs.writeFileSync('screenshots/def-003-verify.png', img3.toPNG());

    // Metrics
    const metrics = app.getAppMetrics();
    const mem = Math.round(metrics.reduce((a, m) => a + (m.memory.workingSetSize || 0), 0) / 1024);

    const perfContent = `# Performance Results

| Metric | Target | Result | Status |
| --- | --- | --- | --- |
| Cold start to interactive | < 3000ms | ${coldStart}ms | ${coldStart < 3000 ? 'PASS' : 'FAIL'} |
| Open long.pdf (520 pages) | < 3000ms | ${longTime}ms | ${longTime < 3000 ? 'PASS' : 'FAIL'} |
| Idle memory (1 document) | < 400MB | ${mem}MB | ${mem < 400 ? 'PASS' : 'FAIL'} |

*Method: Measurements taken via Electron injection (harness).*
`;
    fs.writeFileSync('PERFORMANCE.md', perfContent);
    console.log('PERFORMANCE.md updated');

    console.log('\n--- DISPOSITION ---');
    console.log(`DEF-001: ${hasMojibake ? 'OPEN' : 'CLOSED'}`);
    console.log(`DEF-002: ${thumbsOk ? 'CLOSED' : 'OPEN'}`);
    console.log(`DEF-003: ${longTime < 3000 && longTime > 0 ? 'CLOSED' : 'OPEN'}`);

  } catch (err) {
    console.error('Error during retest:', err);
  } finally {
    console.log('--- QA RETEST FINISHED ---');
    app.quit();
  }
}

if (app.isReady()) runTests(); else app.on('ready', runTests);
