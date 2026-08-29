const { launchApp } = require('./lib/launch.cjs');
const path = require('path');
const fs = require('fs');

(async () => {
  console.log('--- Starting Phase 1 E2E + Retest ---');
  const startTime = Date.now();

  const electronApp = await launchApp();

  const window = await electronApp.firstWindow();
  
  // Poll for diagnostics and samples
  let diag1 = null;
  for (let i = 0; i < 200; i++) {
    diag1 = await window.evaluate(() => typeof window.tflexDiagnostics === 'function' ? window.tflexDiagnostics() : null);
    if (diag1 && diag1.sampleCount > 0) break;
    await new Promise(r => setTimeout(r, 50));
  }
  const coldStart = Date.now() - startTime;
  console.log(`Cold start: ${coldStart}ms`);

  // 1. Welcome Samples (Phase 1)
  const samplePass = diag1 && diag1.sampleCount === 4;
  console.log(`Welcome Samples (4): ${samplePass ? 'PASS' : 'FAIL'} (${diag1?.sampleCount} found)`);
  await window.screenshot({ path: 'screenshots/e2e-welcome.png' });

  // 2. DEF-002: report.pdf + thumbnails
  console.log('Opening report.pdf...');
  await window.click('.sample-card:has-text("report.pdf")');
  
  // Wait for document
  let diag2 = null;
  for (let i = 0; i < 200; i++) {
    diag2 = await window.evaluate(() => window.tflexDiagnostics());
    if (diag2 && diag2.pageCount === 34) break;
    await new Promise(r => setTimeout(r, 50));
  }
  
  // Verify thumbnails
  let def002Status = 'OPEN';
  for (let i = 0; i < 20; i++) {
    const thumbs = await window.evaluate(() => {
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
    });
    if (thumbs.length > 0 && thumbs.every(t => t.hasContent)) {
        def002Status = 'CLOSED';
        break;
    }
    await new Promise(r => setTimeout(r, 200));
  }
  console.log(`DEF-002 Disposition: ${def002Status}`);
  await window.screenshot({ path: 'screenshots/e2e-report-open.png' });

  // 3. Search "orchestration" (Phase 1)
  console.log('Searching "orchestration"...');
  await window.click('button[title*="Find in document"]');
  await window.fill('.search-input', 'orchestration');
  
  let diag3 = null;
  for (let i = 0; i < 100; i++) {
    diag3 = await window.evaluate(() => window.tflexDiagnostics());
    if (diag3 && diag3.searchHits === 8) break;
    await new Promise(r => setTimeout(r, 100));
  }
  const searchPass = diag3?.searchHits === 8;
  console.log(`Search "orchestration" (8): ${searchPass ? 'PASS' : 'FAIL'} (${diag3?.searchHits} hits)`);
  await window.screenshot({ path: 'screenshots/e2e-search.png' });

  // 4. Theme Toggle (Phase 1)
  const themeBefore = diag3.theme;
  await window.click('.theme-toggle');
  await new Promise(r => setTimeout(r, 500));
  const diag4 = await window.evaluate(() => window.tflexDiagnostics());
  const themePass = diag4.theme !== themeBefore;
  console.log(`Theme Toggle: ${themePass ? 'PASS' : 'FAIL'} (${themeBefore} -> ${diag4.theme})`);
  await window.screenshot({ path: 'screenshots/e2e-theme.png' });

  // 5. Outline (Phase 1)
  await window.click('button[title="Bookmarks"]');
  await new Promise(r => setTimeout(r, 1000));
  const outlineCount = await window.$$eval('.outline-item', els => els.length);
  const outlinePass = outlineCount === 8;
  console.log(`Outline (8): ${outlinePass ? 'PASS' : 'FAIL'} (${outlineCount} items)`);

  // 6. DEF-003: long.pdf
  console.log('Testing long.pdf...');
  await window.click('.tab-close');
  await new Promise(r => setTimeout(r, 500));
  
  const longStart = Date.now();
  await window.click('.sample-card:has-text("long.pdf")');
  
  let def003Loaded = false;
  for (let i = 0; i < 200; i++) {
    const d = await window.evaluate(() => window.tflexDiagnostics());
    if (d && d.pageCount === 520) {
        def003Loaded = true;
        break;
    }
    await new Promise(r => setTimeout(r, 20));
  }
  const longTime = Date.now() - longStart;
  
  const mountingCheck = await window.evaluate(() => {
    const slots = document.querySelectorAll('.page-slot');
    const mounted = Array.from(slots).filter(s => s.querySelector('canvas'));
    return { totalSlots: slots.length, mountedCanvases: mounted.length };
  });
  
  const def003Status = (def003Loaded && longTime < 3000 && mountingCheck.mountedCanvases > 0) ? 'CLOSED' : 'OPEN';
  console.log(`DEF-003 Disposition: ${def003Status} (${longTime}ms, pageCount=520, mounted=${mountingCheck.mountedCanvases})`);
  await window.screenshot({ path: 'screenshots/e2e-long-pdf.png' });

  // --- RETEST 009-013 ---
  console.log('\n--- RETESTING DEF-009..013 ---');
  
  // DEF-009: Concurrent delete during save
  console.log('Retesting DEF-009...');
  await window.click('.tab-close');
  await window.click('.sample-card:has-text("report.pdf")');
  await window.waitForSelector('.workspace', { timeout: 5000 });
  
  const diag9 = await window.evaluate(async () => {
      const d = window.tflexDiagnostics();
      const id = d.activeTabId;
      window.tflex.engine.save(id);
      window.tflex.engine.applyOp(id, { kind: 'delete', page: 0 });
      window.tflex.engine.applyOp(id, { kind: 'delete', page: 0 });
      window.tflex.engine.applyOp(id, { kind: 'delete', page: 0 });
      await new Promise(r => setTimeout(r, 2000));
      return window.tflexDiagnostics();
  });
  const def009Passed = diag9.pageCount === 31 && diag9.modified === true;
  console.log(`DEF-009: ${def009Passed ? 'PASSED' : 'FAILED'} (pages=${diag9.pageCount}, modified=${diag9.modified})`);

  // DEF-010: Undo button
  console.log('Retesting DEF-010...');
  await window.click('.tab-close');
  await window.click('.sample-card:has-text("report.pdf")');
  await window.waitForSelector('.workspace', { timeout: 5000 });
  
  for (let i = 0; i < 4; i++) {
      await window.click('button[title="Rotate clockwise"]');
      await new Promise(r => setTimeout(r, 100));
  }
  
  const undoBtn = window.locator('button[title="Undo last change"]');
  let allEnabled = true;
  for (let i = 0; i < 3; i++) {
      if (await undoBtn.isDisabled()) { allEnabled = false; break; }
      await undoBtn.click();
      await new Promise(r => setTimeout(r, 200));
  }
  const finalDisabled = await undoBtn.isDisabled();
  const def010Passed = allEnabled && !finalDisabled;
  console.log(`DEF-010: ${def010Passed ? 'PASSED' : 'FAILED'}`);

  // DEF-011: Save-As error
  console.log('Retesting DEF-011...');
  await window.evaluate(async () => {
      const d = window.tflexDiagnostics();
      window.tflex.engine.saveAs(d.activeTabId, 'C:/Windows/System32/tflex_fail.pdf').catch(() => {});
  });
  await new Promise(r => setTimeout(r, 1000));
  const toast11 = await window.locator('.toast', { hasText: 'Could not write file' }).isVisible();
  console.log(`DEF-011: ${toast11 ? 'PASSED' : 'FAILED'}`);

  // DEF-012: Split-all guard
  console.log('Retesting DEF-012...');
  await window.evaluate(async () => {
      const d = window.tflexDiagnostics();
      window.tflex.engine.split(d.activeTabId, [0, 33]).catch(() => {});
  });
  await new Promise(r => setTimeout(r, 1000));
  const toast12 = await window.locator('.toast', { hasText: 'range' }).isVisible();
  console.log(`DEF-012: ${toast12 ? 'PASSED' : 'FAILED'}`);

  // DEF-013: Corrupt bytes
  console.log('Retesting DEF-013...');
  await window.evaluate(async () => {
      const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34]);
      window.tflex.engine.loadDocumentBytes('junk', bytes).catch(() => {});
  });
  await new Promise(r => setTimeout(r, 1000));
  const toast13 = await window.locator('.toast').isVisible();
  const toastText13 = await window.locator('.toast').innerText().catch(() => '');
  const def013Passed = toast13 && !toastText13.includes('TypeError');
  console.log(`DEF-013: ${def013Passed ? 'PASSED' : 'FAILED'} (toast="${toastText13}")`);

  // Performance Metrics

  const mem = await electronApp.evaluate(({ app }) => {
    const m = app.getAppMetrics();
    return Math.round(m.reduce((acc, val) => acc + (val.memory.workingSetSize || 0), 0) / 1024);
  });
  
  const perfContent = `# Performance Results

| Metric | Target | Result | Status |
| --- | --- | --- | --- |
| Cold start to interactive | < 3000ms | ${coldStart}ms | ${coldStart < 3000 ? 'PASS' : 'FAIL'} |
| Open long.pdf (520 pages) | < 3000ms | ${longTime}ms | ${longTime < 3000 ? 'PASS' : 'FAIL'} |
| Idle memory (1 document) | < 400MB | ${mem}MB | ${mem < 400 ? 'PASS' : 'FAIL'} |

*Method: Measurements taken via Playwright Electron harness.*
`;
  fs.writeFileSync(path.resolve(__dirname, '../PERFORMANCE.md'), perfContent);
  console.log('PERFORMANCE.md updated');

  await electronApp.close();
  console.log('--- Phase 1 E2E + Retest Finished ---');
})();
