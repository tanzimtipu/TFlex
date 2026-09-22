// ADV phase-33: decisive probe — does clearing the other pane break annotation
// placement in the remaining pane? And is the focusing gesture itself safe?
// Counts are always read with the SAME pane focused.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');
const C = require('../../e2e/lib/p33_common.cjs');

const OUT = path.join(os.tmpdir(), 'adv-p33');
const note = (s) => console.log(`[adv-clean] ${s}`);
const findings = [];

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
  let s = await state(win);
  if (!s.pressed) { await inkBtn(win).click(); await win.waitForTimeout(400); s = await state(win); }
  return s;
}
async function focusA(win) { await C.focusPaneByPage(win, 'A'); }
async function drawA(win, fx, fy, dx = 100, dy = 50) {
  const page = win.locator('.tab-pane[data-pane="A"] .pdf-page').first();
  await page.scrollIntoViewIfNeeded().catch(() => {});
  const box = await page.boundingBox();
  const vp = await win.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  const x = Math.max(30, Math.min(box.x + box.width * fx, vp.w - 220));
  const y = Math.max(140, Math.min(box.y + box.height * fy, vp.h - 160));
  await win.mouse.move(x, y); await win.mouse.down();
  await win.mouse.move(x + dx, y + dy, { steps: 8 }); await win.mouse.up();
  await win.waitForTimeout(900);
}
async function countA(win) { await focusA(win); return anns(win); }

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await C.twoPaneSetup(app, win);

    // 1) baseline: focus A, arm, draw -> 1
    await focusA(win);
    let st = await arm(win);
    let n = await countA(win);
    await drawA(win, 0.3, 0.3);
    let n1 = await countA(win);
    note(`baseline: armed=${JSON.stringify(st)} ${n} -> ${n1}`);
    if (n1 !== n + 1) findings.push(`baseline placement failed: ${n} -> ${n1}`);

    // 2) focus-change gesture: A focused -> read -> focus B -> arm -> draw A
    await focusA(win);
    const before = await countA(win);      // A focused, real A count
    await C.focusPaneByPage(win, 'B');     // now B focused
    st = await arm(win);
    await drawA(win, 0.4, 0.35);           // this gesture also focuses A
    const after = await countA(win);
    note(`focus-change gesture: before(A)=${before} armed=${JSON.stringify(st)} after(A)=${after}`);
    if (after !== before + 1) findings.push(`a stroke drawn in the unfocused pane (focus-change during pointerdown) did not place: ${before} -> ${after}`);

    // 3) clear pane B, then place in A again
    await win.locator('.tab-pane[data-pane="B"] [data-pane-clear]').first().click().catch(() => {});
    await win.waitForTimeout(1000);
    const emptyB = await win.locator('.tab-pane[data-pane="B"][data-pane-empty]').count();
    await focusA(win);
    st = await arm(win);
    const b2 = await countA(win);
    await drawA(win, 0.5, 0.45);
    const a2 = await countA(win);
    note(`after clearing B (emptyB=${emptyB}): armed=${JSON.stringify(st)} ${b2} -> ${a2}`);
    if (a2 !== b2 + 1) findings.push(`after clearing the other pane, a stroke in the remaining pane did not place: ${b2} -> ${a2}`);

    // 4) second consecutive stroke in A (already focused)
    await focusA(win);
    const b3 = await countA(win);
    await drawA(win, 0.6, 0.5, -100, -50);
    const a3 = await countA(win);
    note(`second consecutive stroke: ${b3} -> ${a3}`);
    if (a3 !== b3 + 1) findings.push(`second consecutive stroke in A did not place: ${b3} -> ${a3}`);

    note(`FINDINGS=${findings.length}`);
    for (const f of findings) note(`  FINDING ${f}`);
    fs.writeFileSync(path.join(OUT, 'clean-result.json'), JSON.stringify(findings, null, 2));
  } catch (e) {
    note(`HARNESS ERROR: ${e && e.stack ? e.stack : e}`);
    fs.writeFileSync(path.join(OUT, 'clean-result.json'), JSON.stringify({ error: String(e) }, null, 2));
  } finally {
    await hardClose(app, 'adv-clean');
  }
  note('DONE');
})().catch((e) => { console.error(e); process.exit(1); });