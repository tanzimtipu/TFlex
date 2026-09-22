// ADV phase-33: is the "second consecutive stroke adds nothing" a Multi Mode
// regression or app-wide behaviour? Also a real gutter pixel sample.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { PNG } = require('pngjs');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose, openSamplePath } = require('../../e2e/lib/helpers.cjs');
const C = require('../../e2e/lib/p33_common.cjs');

const SHOTS = 'C:/Users/tanzi/OneDrive/App Development/TFlex/screenshots';
const OUT = path.join(os.tmpdir(), 'adv-p33');
const note = (s) => console.log(`[adv-extra] ${s}`);
const shotPath = (n) => path.join(SHOTS, `adv-p33-${n}.png`);

async function state(win) {
  return win.evaluate(() => {
    const d = window.tflexDiagnostics();
    const btn = document.querySelector('[data-ann-tools-visible] button[data-tool="ink"]');
    return { activeTool: d.activeTool ?? null, pressed: btn ? btn.getAttribute('aria-pressed') === 'true' : null };
  });
}
async function anns(win) { return win.evaluate(() => (window.tflexDiagnostics().engineState || {}).annotations?.length ?? 0); }
function inkBtn(win) { return win.locator('[data-ann-tools-visible] button[data-tool="ink"]').first(); }
async function arm(win) {
  const s = await state(win);
  if (!s.pressed) { await inkBtn(win).click(); await win.waitForTimeout(350); }
}
async function drawAt(win, pane, fx, fy, dx = 110, dy = 60) {
  const page = win.locator(pane === 'single' ? '.pdf-page' : `.tab-pane[data-pane="${pane}"] .pdf-page`).first();
  await page.scrollIntoViewIfNeeded().catch(() => {});
  const box = await page.boundingBox();
  const vp = await win.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  const x = Math.max(30, Math.min(box.x + box.width * fx, vp.w - 220));
  const y = Math.max(140, Math.min(box.y + box.height * fy, vp.h - 160));
  await win.mouse.move(x, y); await win.mouse.down();
  await win.mouse.move(x + dx, y + dy, { steps: 8 }); await win.mouse.up();
  await win.waitForTimeout(900);
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });

    // ---------------- single mode: two consecutive strokes ----------------
    await openSamplePath(win, app, C.REPORT);
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(500);
    await arm(win);
    let s0 = await state(win);
    let n0 = await anns(win);
    await drawAt(win, 'single', 0.3, 0.25, 110, 60);
    let s1 = await state(win); let n1 = await anns(win);
    await drawAt(win, 'single', 0.55, 0.55, -110, -60);
    let s2 = await state(win); let n2 = await anns(win);
    note(`SINGLE: armed=${JSON.stringify(s0)} n0=${n0}; after stroke1 state=${JSON.stringify(s1)} n1=${n1}; after stroke2 state=${JSON.stringify(s2)} n2=${n2}`);

    // ---------------- multi mode: same test -------------------------------
    // The single document seeds pane A; pane B stays empty (enough to compare
    // the stroke behaviour in the shared-bar path).
    await win.locator('.tab[data-tab-id]').first().click().catch(() => {});
    await win.waitForTimeout(200);
    await win.locator('[data-toolbar-multi-mode]').first().click();
    await win.waitForTimeout(700);
    await C.focusPaneByPage(win, 'A');
    await arm(win);
    const m0 = await state(win); const mn0 = await anns(win);
    await drawAt(win, 'A', 0.3, 0.25, 110, 60);
    const m1 = await state(win); const mn1 = await anns(win);
    await drawAt(win, 'A', 0.55, 0.55, -110, -60);
    const m2 = await state(win); const mn2 = await anns(win);
    note(`MULTI: armed=${JSON.stringify(m0)} n0=${mn0}; after stroke1 state=${JSON.stringify(m1)} n1=${mn1}; after stroke2 state=${JSON.stringify(m2)} n2=${mn2}`);

    // ---------------- real gutter sample at Fit page ----------------------
    for (const theme of ['light', 'dark', 'frosted']) {
      await C.switchTheme(win, theme);
      await win.waitForTimeout(400);
    }
    await C.switchTheme(win, 'frosted');
    await win.waitForTimeout(400);
    await win.locator('[data-shared-toolbar] button[aria-label="Fit page"]').first().click();
    await win.waitForTimeout(900);
    for (const theme of ['light', 'dark', 'frosted']) {
      await C.switchTheme(win, theme);
      await win.waitForTimeout(600);
      const info = await win.evaluate(() => {
        const sc = document.querySelector('.tab-pane[data-pane="A"] .document-scroller');
        const b = sc.getBoundingClientRect();
        const pg = sc.querySelector('.pdf-page');
        const pb = pg ? pg.getBoundingClientRect() : null;
        return {
          theme: document.documentElement.getAttribute('data-theme'),
          rect: { left: b.left, top: b.top, right: b.right, bottom: b.bottom },
          pageRect: pb ? { left: pb.left, top: pb.top, right: pb.right, bottom: pb.bottom } : null,
          scrollerBg: getComputedStyle(sc).backgroundColor,
        };
      });
      const buf = await win.screenshot({ path: shotPath(`gutter2-${theme}`) });
      const png = PNG.sync.read(buf);
      let sx, sy;
      if (info.pageRect && info.pageRect.left > info.rect.left + 12) {
        sx = Math.round((info.rect.left + info.pageRect.left) / 2);
        sy = Math.round((info.rect.top + info.rect.bottom) / 2);
      } else {
        sx = Math.round((info.rect.left + info.rect.right) / 2);
        sy = Math.round((info.rect.top + (info.pageRect ? Math.min(info.pageRect.top, info.rect.bottom) : info.rect.top + 30)) / 2);
      }
      const idx = (png.width * sy + sx) << 2;
      const px = { x: sx, y: sy, r: png.data[idx], g: png.data[idx + 1], b: png.data[idx + 2], a: png.data[idx + 3] };
      note(`gutter2 ${theme}: scrollerBg=${info.scrollerBg} leftGutter=${info.pageRect ? info.pageRect.left - info.rect.left : 'n/a'} sample=${JSON.stringify(px)}`);
    }
  } catch (e) {
    note(`HARNESS ERROR: ${e && e.stack ? e.stack : e}`);
  } finally {
    await hardClose(app, 'adv-extra');
  }
  note('DONE');
})().catch((e) => { console.error(e); process.exit(1); });