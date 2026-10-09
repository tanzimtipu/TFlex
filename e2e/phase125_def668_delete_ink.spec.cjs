// Phase 125 chunk G (TFL-1495) - DEF-668 focused evidence capture.
// Places a note annotation, opens the Annotations panel, and captures the
// per-row delete control (`.ann-panel-row-delete`) at REST in light and dark.
// Also records the computed ink of the delete icon and of the row label so the
// "not ghosted / stays lighter than the row label ink" judgement is measurable.

const path = require('node:path');
const fs = require('node:fs');
const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { setTheme, openSamplePath, armAnnotationTool, gotoStage, hardClose } = require('./lib/helpers.cjs');

const OUT = path.resolve(__dirname, '..', 'screenshots', 'phase125');
fs.mkdirSync(OUT, { recursive: true });

function lum(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function parseRGB(s) {
  const m = s.match(/(\d+),\s*(\d+),\s*(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function contrast(a, b) {
  const l1 = lum(a);
  const l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

test('Phase 125 / DEF-668: annotation-panel delete icon at rest in light and dark', async () => {
  test.setTimeout(180000);
  const app = await launchApp();
  try {
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });

    await openSamplePath(win, app, getSamplePath('report.pdf'));

    // Place a rect annotation so the panel has a row to render.
    await armAnnotationTool(win, 'rect');
    const slot = win.locator('.page-slot[data-page="1"]').first();
    await slot.waitFor({ timeout: 10000 });
    const box = await slot.boundingBox();
    await win.mouse.move(box.x + box.width * 0.3, box.y + 200);
    await win.mouse.down();
    await win.mouse.move(box.x + box.width * 0.6, box.y + 320, { steps: 8 });
    await win.mouse.up();
    await win.waitForTimeout(900);

    // Open the REVIEW stage (Control+3) which hosts the Annotations panel.
    await gotoStage(win, 3);
    await win.waitForSelector('[data-annotation-panel]', { state: 'attached', timeout: 10000 });
    await win.waitForTimeout(800);

    const rowCount = await win.locator('[data-annotation-row]').count();
    console.log(`[DEF-668] annotation rows=${rowCount}`);
    await win.locator('[data-annotation-panel]').screenshot({ path: path.join(OUT, 'def668-panel-probe.png') }).catch(() => {});

    const legacyClassCount = await win.locator('.ann-panel-row-delete').count();
    console.log(`[DEF-668] .ann-panel-row-delete elements in DOM=${legacyClassCount}`);
    expect(rowCount, 'panel must list a row').toBeGreaterThan(0);

    const report = [];
    for (const theme of ['light', 'dark']) {
      await setTheme(win, theme);
      await expect
        .poll(() => win.evaluate(() => document.documentElement.getAttribute('data-theme')))
        .toBe(theme);
      await win.waitForTimeout(400);

      const row = win.locator('[data-annotation-row]').first();
      const realDelete = row.locator('button[aria-label^="Delete"]').first();
      await row.screenshot({ path: path.join(OUT, `def668-ann-row-${theme}.png`) });
      await realDelete.screenshot({ path: path.join(OUT, `def668-delete-${theme}.png`) });

      const measured = await win.evaluate(() => {
        const rowEl = document.querySelector('[data-annotation-row]');
        const delBtn = rowEl ? rowEl.querySelector('button[aria-label^="Delete"]') : null;
        const kind = rowEl ? rowEl.querySelector('[data-ann-kind]') : null;
        const legacy = document.querySelector('.ann-panel-row-delete');
        const bg = rowEl ? getComputedStyle(rowEl).backgroundColor : null;
        const bgOpaque = bg && !/rgba\(0,\s*0,\s*0,\s*0\)/.test(bg) ? bg : null;
        return {
          deleteInk: delBtn ? getComputedStyle(delBtn).color : null,
          deleteClass: delBtn ? delBtn.className : null,
          labelInk: kind ? getComputedStyle(kind).color : null,
          legacyInk: legacy ? getComputedStyle(legacy).color : null,
          rowBg: bgOpaque || getComputedStyle(document.body).backgroundColor,
        };
      });

      const del = parseRGB(measured.deleteInk);
      const lab = parseRGB(measured.labelInk);
      const bg = parseRGB(measured.rowBg);
      report.push({
        theme,
        deleteInk: measured.deleteInk,
        deleteClass: measured.deleteClass,
        labelInk: measured.labelInk,
        legacyInk: measured.legacyInk,
        rowBg: measured.rowBg,
        deleteLum: del ? lum(del).toFixed(4) : null,
        labelLum: lab ? lum(lab).toFixed(4) : null,
        deleteVsBg: del && bg ? contrast(del, bg).toFixed(2) : null,
        deleteVsLabel: del && lab ? contrast(del, lab).toFixed(2) : null,
        lighterThanLabel: del && lab ? lum(del) > lum(lab) : null,
      });
    }

    fs.writeFileSync(
      path.join(OUT, 'def668-delete-ink.json'),
      JSON.stringify(report, null, 2),
    );
    console.log('[DEF-668] delete-ink report:', JSON.stringify(report));
  } finally {
    await hardClose(app, 'phase125-def668-delete-ink');
  }
});
