// ADV phase-33: characterise the rapid shared-toolbar arm/disarm -> first draw
// being swallowed. Trials vary the rapid count and the settle time.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');
const C = require('../../e2e/lib/p33_common.cjs');

const OUT = path.join(os.tmpdir(), 'adv-p33');
const note = (s) => console.log(`[adv-rapid] ${s}`);
const rows = [];

async function state(win) {
  return win.evaluate(() => {
    const d = window.tflexDiagnostics();
    const btn = document.querySelector('[data-ann-tools-visible] button[data-tool="ink"]');
    return { activeTool: d.activeTool ?? null, pressed: btn ? btn.getAttribute('aria-pressed') === 'true' : null };
  });
}
function inkBtn(win) { return win.locator('[data-ann-tools-visible] button[data-tool="ink"]').first(); }
async function anns(win) { return win.evaluate(() => (window.tflexDiagnostics().engineState || {}).annotations?.length ?? 0); }
async function draw(win, pane = 'A') {
  const page = win.locator(`.tab-pane[data-pane="${pane}"] .pdf-page`).first();
  await page.scrollIntoViewIfNeeded().catch(() => {});
  const box = await page.boundingBox();
  const vp = await win.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  const x = Math.max(30, Math.min(box.x + box.width * 0.32, vp.w - 220));
  const y = Math.max(120, Math.min(box.y + box.height * 0.3, vp.h - 160));
  await win.mouse.move(x, y); await win.mouse.down();
  await win.mouse.move(x + 100, y + 55, { steps: 8 }); await win.mouse.up();
  await win.waitForTimeout(1200);
}
async function ensureDisarmed(win) {
  let s = await state(win);
  if (s.pressed) { await inkBtn(win).click(); await win.waitForTimeout(400); s = await state(win); }
  if (s.activeTool === 'ink') { await win.keyboard.press('Escape'); await win.waitForTimeout(400); s = await state(win); }
  return s;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await C.twoPaneSetup(app, win);
    await C.focusPaneByPage(win, 'A');
    await ensureDisarmed(win);

    const trials = [
      { n: 2, settle: 400 },
      { n: 4, settle: 400 },
      { n: 8, settle: 800 },
      { n: 12, settle: 400 },
      { n: 12, settle: 2500 },
      { n: 20, settle: 2500 },
      { n: 6, settle: 400 },
      { n: 6, settle: 400 },
    ];
    for (const t of trials) {
      await ensureDisarmed(win);
      for (let i = 0; i < t.n; i += 1) {
        await inkBtn(win).click();
        await win.waitForTimeout(25);
      }
      await win.waitForTimeout(300);
      const rapidState = await state(win);
      if (!rapidState.pressed) { await inkBtn(win).click(); }
      await win.waitForTimeout(t.settle);
      const armed = await state(win);
      const before = await anns(win);
      await draw(win, 'A');
      const after1 = await anns(win);
      await draw(win, 'A');
      const after2 = await anns(win);
      const row = { n: t.n, settle: t.settle, rapidState, armed, before, after1, after2, d1: after1 - before, d2: after2 - after1 };
      rows.push(row);
      note(`trial n=${t.n} settle=${t.settle}: rapid=${JSON.stringify(rapidState)} armed=${JSON.stringify(armed)} before=${before} after1=${after1} after2=${after2} d1=${row.d1} d2=${row.d2}`);
    }
    const bad = rows.filter((r) => r.armed.pressed === true && r.armed.activeTool === 'ink' && r.d1 === 0);
    note(`SWALLOWED_FIRST_DRAW=${bad.length}/${rows.length}`);
    fs.writeFileSync(path.join(OUT, 'rapid-rows.json'), JSON.stringify(rows, null, 2));
  } catch (e) {
    note(`HARNESS ERROR: ${e && e.stack ? e.stack : e}`);
    fs.writeFileSync(path.join(OUT, 'rapid-rows.json'), JSON.stringify({ error: String(e) }, null, 2));
  } finally {
    await hardClose(app, 'adv-rapid');
  }
  note('DONE');
})().catch((e) => { console.error(e); process.exit(1); });