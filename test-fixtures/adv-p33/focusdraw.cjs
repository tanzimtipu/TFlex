// ADV phase-33: does the FIRST gesture that focuses a pane swallow an armed
// annotation tool (focus-change during the drawing pointerdown)? Plus a real
// zoomed-out gutter pixel sample.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { PNG } = require('pngjs');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');
const C = require('../../e2e/lib/p33_common.cjs');

const SHOTS = 'C:/Users/tanzi/OneDrive/App Development/TFlex/screenshots';
const OUT = path.join(os.tmpdir(), 'adv-p33');
const note = (s) => console.log(`[adv-focus] ${s}`);
const findings = [];
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
  return state(win);
}
async function drawAt(win, pane, fx, fy, dx = 110, dy = 60) {
  const page = win.locator(`.tab-pane[data-pane="${pane}"] .pdf-page`).first();
  await page.scrollIntoViewIfNeeded().catch(() => {});
  const box = await page.boundingBox();
  const vp = await win.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  const x = Math.max(30, Math.min(box.x + box.width * fx, vp.w - 220));
  const y = Math.max(140, Math.min(box.y + box.height * fy, vp.h - 160));
  await win.mouse.move(x, y); await win.mouse.down();
  await win.mouse.move(x + dx, y + dy, { steps: 8 }); await win.mouse.up();
  await win.waitForTimeout(900);
}
async function focusedPane(win) {
  return win.evaluate(() => {
    const a = document.querySelector('.tab-pane[data-pane="A"]');
    const b = document.querySelector('.tab-pane[data-pane="B"]');
    return { A: a ? a.getAttribute('data-pane-focused') : null, B: b ? b.getAttribute('data-pane-focused') : null };
  });
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await C.twoPaneSetup(app, win); // A = report, B = long

    // ---- Case 3 control: focus A explicitly, arm, draw -> 1 --------------
    await C.focusPaneByPage(win, 'A');
    await arm(win);
    let before = await anns(win);
    await drawAt(win, 'A', 0.3, 0.3, 100, 50);
    let after = await anns(win);
    note(`control (A pre-focused, 2 panes filled): ${before} -> ${after} focus=${JSON.stringify(await focusedPane(win))}`);
    if (after !== before + 1) findings.push(`control draw in pre-focused pane A did not place: ${before} -> ${after}`);

    // ---- Case 1: focus B (so A is NOT focused), arm, then draw in A ------
    // This gesture both focuses A and should place the stroke.
    await C.focusPaneByPage(win, 'B');
    const st = await arm(win);
    const fpBefore = await focusedPane(win);
    before = await anns(win);
    await drawAt(win, 'A', 0.35, 0.3, 100, 50);
    after = await anns(win);
    const fpAfter = await focusedPane(win);
    note(`focus-change gesture: armed=${JSON.stringify(st)} focusBefore=${JSON.stringify(fpBefore)} focusAfter=${JSON.stringify(fpAfter)} ${before} -> ${after}`);
    if (after !== before + 1) findings.push(`first gesture in an unfocused pane (focus-change during pointerdown) swallowed the armed ink stroke: ${before} -> ${after}`);

    // ---- Case 2: repeat a normal draw in A (already focused) -------------
    before = after;
    await drawAt(win, 'A', 0.55, 0.55, -100, -50);
    after = await anns(win);
    note(`subsequent draw in already-focused A: ${before} -> ${after}`);
    if (after !== before + 1) findings.push(`a draw in an already-focused pane A did not place: ${before} -> ${after}`);

    // ---- Case 4: clear pane B (empty), focus B, arm, draw in A ----------
    await win.locator('.tab-pane[data-pane="B"] [data-pane-clear]').first().click().catch(() => {});
    await win.waitForTimeout(900);
    const emptyB = await win.locator('.tab-pane[data-pane="B"][data-pane-empty]').count();
    note(`pane B emptied (count=${emptyB})`);
    // focus the empty pane B, then arm and draw into A
    await C.focusPaneByPage(win, 'B').catch(() => {});
    await arm(win);
    before = await anns(win);
    await drawAt(win, 'A', 0.35, 0.3, 100, 50);
    after = await anns(win);
    note(`empty-B: focus B then draw A: ${before} -> ${after} focus=${JSON.stringify(await focusedPane(win))}`);
    if (after !== before + 1) findings.push(`with pane B empty, a draw into pane A after focusing B did not place: ${before} -> ${after}`);

    // ---- real gutter sample at zoom 25% ----------------------------------
    await C.focusPaneByPage(win, 'A');
    for (let i = 0; i < 12; i += 1) {
      const btn = win.locator('[data-shared-toolbar] button[aria-label="Zoom out"]').first();
      if ((await btn.count()) === 0) break;
      await btn.click().catch(() => {});
      await win.waitForTimeout(120);
    }
    await win.waitForTimeout(900);
    for (const theme of ['light', 'dark', 'frosted']) {
      await C.switchTheme(win, theme);
      await win.waitForTimeout(700);
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
      const buf = await win.screenshot({ path: shotPath(`gutter3-${theme}`) });
      const png = PNG.sync.read(buf);
      let sx = null; let sy = null;
      if (info.pageRect && info.pageRect.left > info.rect.left + 10) {
        sx = Math.round((info.rect.left + info.pageRect.left) / 2);
        sy = Math.round((info.rect.top + info.rect.bottom) / 2);
      } else if (info.pageRect && info.pageRect.top > info.rect.top + 10) {
        sx = Math.round((info.rect.left + info.rect.right) / 2);
        sy = Math.round((info.rect.top + info.pageRect.top) / 2);
      }
      if (sx === null) { note(`gutter3 ${theme}: no gutter found (page fills the pane)`); continue; }
      const idx = (png.width * sy + sx) << 2;
      const px = { x: sx, y: sy, r: png.data[idx], g: png.data[idx + 1], b: png.data[idx + 2], a: png.data[idx + 3] };
      note(`gutter3 ${theme}: scrollerBg=${info.scrollerBg} gutter=${info.pageRect.left - info.rect.left}px sample=${JSON.stringify(px)}`);
      if (px.a < 255) findings.push(`theme ${theme}: real gutter pixel alpha ${px.a} < 255 at ${JSON.stringify(px)}`);
    }

    note(`FINDINGS=${findings.length}`);
    for (const f of findings) note(`  FINDING ${f}`);
    fs.writeFileSync(path.join(OUT, 'focus-result.json'), JSON.stringify(findings, null, 2));
  } catch (e) {
    note(`HARNESS ERROR: ${e && e.stack ? e.stack : e}`);
    fs.writeFileSync(path.join(OUT, 'focus-result.json'), JSON.stringify({ error: String(e) }, null, 2));
  } finally {
    await hardClose(app, 'adv-focus');
  }
  note('DONE');
})().catch((e) => { console.error(e); process.exit(1); });