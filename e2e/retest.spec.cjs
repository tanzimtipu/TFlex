const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');
const path = require('path');
const fs = require('fs');

test.describe('QA Retest', () => {
  let electronApp;
  let window;
  let startTime;

  test.beforeAll(async () => {
    startTime = Date.now();
    electronApp = await launchApp();
    window = await electronApp.firstWindow();
  });

  test.afterAll(async () => {
    await electronApp.close();
  });

  test('DEF-001: Mojibake in sample cards', async () => {
    await window.waitForSelector('.sample-card', { timeout: 15000 });
    const subtitles = await window.$$eval('.sample-card-subtitle', els => els.map(el => el.textContent));
    for (const subtitle of subtitles) {
      expect(subtitle).not.toContain('Â·');
    }
    await window.screenshot({ path: 'screenshots/def-001-verify.png' });
  });

  test('DEF-002: Thumbnails render bitmaps', async () => {
    await window.click('.sample-card:has-text("report.pdf")');
    await window.waitForSelector('.workspace', { timeout: 15000 });
    
    // Wait for thumbnails to render
    await window.waitForTimeout(3000);
    const thumbCanvases = await window.$$eval('.thumbnail-rail canvas', els => els.map(el => ({
      width: el.width,
      height: el.height,
      visible: el.offsetWidth > 0
    })));
    
    expect(thumbCanvases.length).toBeGreaterThan(0);
    for (const thumb of thumbCanvases) {
      expect(thumb.width).toBeGreaterThan(0);
      expect(thumb.height).toBeGreaterThan(0);
    }
    await window.screenshot({ path: 'screenshots/def-002-verify.png' });
  });

  test('Full E2E: Search, Theme, Outline', async () => {
    // Search
    await window.click('button[title*="Find in document"]');
    await window.fill('.search-input', 'orchestration');
    await window.waitForTimeout(2000);
    const diagSearch = await window.evaluate(() => window.tflexDiagnostics());
    expect(diagSearch.searchHits).toBeGreaterThan(0);
    await window.screenshot({ path: 'screenshots/e2e-search-verify.png' });

    // Theme
    const themeBefore = diagSearch.theme;
    await window.click('.theme-toggle');
    await window.waitForTimeout(500);
    const diagTheme = await window.evaluate(() => window.tflexDiagnostics());
    expect(diagTheme.theme).not.toBe(themeBefore);
    await window.screenshot({ path: 'screenshots/e2e-theme-verify.png' });

    // Outline
    const outlineItems = await window.$$eval('.outline-item', els => els.length);
    expect(outlineItems).toBeGreaterThan(0);
  });

  test('DEF-003: Performance (long.pdf)', async () => {
    await window.click('.tab-close');
    await window.waitForSelector('.sample-card');
    
    const longStart = Date.now();
    await window.click('.sample-card:has-text("long.pdf")');
    
    // Wait for page count to reach 520
    let longTime = -1;
    for (let i = 0; i < 50; i++) {
        const diag = await window.evaluate(() => window.tflexDiagnostics());
        if (diag.pageCount >= 520) {
            longTime = Date.now() - longStart;
            break;
        }
        await window.waitForTimeout(200);
    }
    
    console.log(`Long PDF open time: ${longTime}ms`);
    expect(longTime).toBeGreaterThan(0);
    expect(longTime).toBeLessThan(3000);
    await window.screenshot({ path: 'screenshots/def-003-verify.png' });

    // Record metrics
    const coldStart = Date.now() - startTime; // This is a bit late but gives an upper bound
    const metrics = await electronApp.evaluate(({ app }) => {
        const m = app.getAppMetrics();
        return m.reduce((a, b) => a + (b.memory.workingSetSize || 0), 0);
    });
    const memMB = Math.round(metrics / 1024);

    const perfContent = `# Performance Results

| Metric | Target | Result | Status |
| --- | --- | --- | --- |
| Cold start to interactive | < 3000ms | ${coldStart}ms | ${coldStart < 3000 ? 'PASS' : 'FAIL'} |
| Open long.pdf (520 pages) | < 3000ms | ${longTime}ms | ${longTime < 3000 ? 'PASS' : 'FAIL'} |
| Idle memory (1 document) | < 400MB | ${memMB}MB | ${memMB < 400 ? 'PASS' : 'FAIL'} |

*Method: Measurements taken via Playwright E2E retest script on production build.*
`;
    fs.writeFileSync(path.resolve(__dirname, '../PERFORMANCE.md'), perfContent);
  });
});
