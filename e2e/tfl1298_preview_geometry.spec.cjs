// TFL-1298 acceptance case (from the TFL-1258 report): the PRINT PREVIEW must
// reflect the real page geometry for rotated / cropped / mixed-media pages.
//
// This is the focused e2e the brief asks for. It drives the SHIPPED standalone
// print window only through the canonical launch + openSamplePath helpers and
// asserts, per page, that the preview's rendered raster and its landscape flag
// agree with the page's DISPLAYED geometry (CropBox combined with /Rotate,
// exactly what pdf.js renders). The oracle is computed from the fixture with
// pdf-lib, so it is not hardcoded.
//
// Fixture: test-fixtures/tfl1298-geometry.pdf (4 pages):
//   1 portrait Letter, 2 landscape Letter, 3 portrait rotated 90, 4 cropped A4.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { openSamplePath, hardClose, openStandalonePrintWindow } = require('./lib/helpers.cjs');

const FIXTURE = path.resolve(__dirname, '..', 'test-fixtures', 'tfl1298-geometry.pdf');
const SHOT = path.resolve(__dirname, '..', 'screenshots', 'tfl1298-preview-geometry.png');
const DARK_SHOT = path.resolve(__dirname, '..', 'screenshots', 'tfl1298-preview-dark.png');
const MIDDOT = '\u00b7';

// Displayed geometry per page: CropBox with /Rotate applied (pdf.js renders the
// crop box, rotated). Returns { landscape, ratio }.
async function displayedGeometry() {
  const { PDFDocument } = require('@cantoo/pdf-lib');
  const doc = await PDFDocument.load(fs.readFileSync(FIXTURE), { ignoreEncryption: true });
  return doc.getPages().map((page) => {
    const cb = page.getCropBox();
    const rot = ((page.getRotation().angle % 360) + 360) % 360;
    let w = cb.width;
    let h = cb.height;
    if (rot === 90 || rot === 270) {
      [w, h] = [h, w];
    }
    return { landscape: w > h, ratio: w / h };
  });
}

async function showPage(printPage, n) {
  await printPage.click('[data-print-range-custom]');
  await printPage.fill('[data-print-range-input]', `${n}-${n}`);
  await printPage.waitForSelector(`[data-print-preview-cell] img[alt="Page ${n}"]`, { timeout: 20000 });
  await printPage.waitForFunction(
    (alt) => {
      const img = document.querySelector(`[data-print-preview-cell] img[alt="${alt}"]`);
      return img !== null && img.naturalWidth > 0 && img.naturalHeight > 0;
    },
    `Page ${n}`,
    { timeout: 20000 },
  );
}

test('Phase 120 preview reflects rotated / cropped / mixed-media page geometry', async () => {
  test.setTimeout(180000);
  const expected = await displayedGeometry();
  expect(expected.length, 'fixture has 4 pages').toBe(4);
  // Sanity: the fixture really mixes orientations and includes a rotated page.
  expect(expected.filter((p) => p.landscape).length, 'fixture mixes orientations').toBe(2);

  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSamplePath(win, app, FIXTURE);
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(600);
    const pageCount = await win.evaluate(() => window.tflexDiagnostics().pageCount);
    console.log(`[TFL1298] fixture pages=${pageCount}`);
    expect(pageCount, 'fixture imports all 4 pages').toBe(4);

    const printPage = await openStandalonePrintWindow(app, win);

    const observed = [];
    for (let n = 1; n <= 4; n += 1) {
      await showPage(printPage, n);
      await printPage.waitForTimeout(250);
      const flag = await printPage.getAttribute('[data-print-preview-sheet]', 'data-landscape');
      const dims = await printPage.evaluate((alt) => {
        const img = document.querySelector(`[data-print-preview-cell] img[alt="${alt}"]`);
        return { w: img.naturalWidth, h: img.naturalHeight };
      }, `Page ${n}`);
      const ratio = dims.w / dims.h;
      observed.push({ page: n, flag, w: dims.w, h: dims.h, ratio });
      console.log(
        `[TFL1298] page ${n} landscapeFlag=${flag} raster=${dims.w}x${dims.h} ` +
          `ratio=${ratio.toFixed(3)} expectedLandscape=${expected[n - 1].landscape} ` +
          `expectedRatio=${expected[n - 1].ratio.toFixed(3)}`,
      );

      // The preview's landscape flag and the raster aspect must both agree with
      // the page's displayed geometry.
      expect(flag, `page ${n} preview landscape flag`).toBe(String(expected[n - 1].landscape));
      expect(dims.w > dims.h, `page ${n} raster is ${expected[n - 1].landscape ? 'landscape' : 'portrait'}`).toBe(
        expected[n - 1].landscape,
      );
      expect(Math.abs(ratio - expected[n - 1].ratio), `page ${n} raster aspect matches page geometry`).toBeLessThan(
        0.06,
      );
      expect((await printPage.textContent('[data-print-preview-meta]')).trim()).toBe(`1 page ${MIDDOT} 1 sheet`);
    }

    // Rotation is genuinely reflected: the rotated page 3 (portrait MediaBox)
    // previews landscape, while the same-size unrotated page 1 previews portrait.
    expect(observed[2].ratio, 'rotated page 3 previews landscape').toBeGreaterThan(1);
    expect(observed[0].ratio, 'unrotated page 1 previews portrait').toBeLessThan(1);

    // Crop is reflected: page 4's raster matches the CropBox aspect, not the
    // full A4 MediaBox aspect.
    const cropRatio = 515 / 762;
    const mediaRatio = 595.28 / 841.89;
    expect(Math.abs(observed[3].ratio - cropRatio), 'page 4 raster matches the CropBox aspect').toBeLessThan(
      Math.abs(observed[3].ratio - mediaRatio),
    );

    await printPage.locator('[data-print-preview]').screenshot({ path: SHOT });
    console.log(`[TFL1298] screenshot ${SHOT}`);

    // DEF-649 evidence: in the dark theme the page-bearing cell must stay
    // paper-white so a `object-fit: contain` raster never letterboxes against a
    // near-black stage colour.
    await showPage(printPage, 1);
    await printPage.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
    await printPage.waitForTimeout(300);
    const cellBg = await printPage.evaluate(() => {
      const cell = document.querySelector('[data-print-preview-cell]');
      return getComputedStyle(cell).backgroundColor;
    });
    console.log(`[TFL1298] DEF-649 dark preview-cell background=${cellBg}`);
    expect(cellBg, 'DEF-649: preview cell is paper-white in dark theme').toBe('rgb(255, 255, 255)');
    await printPage.screenshot({ path: DARK_SHOT });
    console.log(`[TFL1298] screenshot ${DARK_SHOT}`);
  } finally {
    await hardClose(app, 'tfl1298-geom');
  }
});
