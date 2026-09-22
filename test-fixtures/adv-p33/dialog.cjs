// ADV phase-33: movable print dialog attack sequences.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose, openSamplePath } = require('../../e2e/lib/helpers.cjs');
const { REPORT } = require('../../e2e/lib/p33_common.cjs');
const P = require('../../e2e/lib/p33_print.cjs');

const SHOTS = 'C:/Users/tanzi/OneDrive/App Development/TFlex/screenshots';
const OUT = path.join(os.tmpdir(), 'adv-p33');
const findings = [];
const note = (s) => { console.log(`[adv-dialog] ${s}`); };

async function openDialog(win) {
  await P.openDialog(win);
  await win.waitForTimeout(450); // enter motion
}
async function shell(win) {
  return win.evaluate(() => {
    const el = document.querySelector('[data-print-dialog-shell]');
    const dlg = document.querySelector('.print-dialog');
    const b = dlg.getBoundingClientRect();
    return {
      x: Number.parseFloat(el.getAttribute('data-drag-x') || '0'),
      y: Number.parseFloat(el.getAttribute('data-drag-y') || '0'),
      rect: { left: Math.round(b.left), top: Math.round(b.top), right: Math.round(b.right), bottom: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) },
      vw: window.innerWidth,
      vh: window.innerHeight,
    };
  });
}
async function headerBox(win) {
  const b = await win.locator('[data-print-drag-handle]').boundingBox();
  return b;
}
async function dragFrom(win, from, dx, dy, steps = 12) {
  await win.mouse.move(from.x, from.y);
  await win.mouse.down();
  await win.mouse.move(from.x + dx, from.y + dy, { steps });
  await win.mouse.up();
  await win.waitForTimeout(120);
}
function inside(s, tol = 2) {
  return s.rect.left >= -tol && s.rect.top >= -tol && s.rect.right <= s.vw + tol && s.rect.bottom <= s.vh + tol;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openSamplePath(win, app, REPORT);
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForTimeout(500);

    // ---------------- clamp at every extreme, repeatedly -------------------
    const dirs = [[-4000, -3000], [4000, -3000], [-4000, 3000], [4000, 3000], [0, -4000], [0, 4000], [-4000, 0], [4000, 0]];
    for (const [dx, dy] of dirs) {
      await openDialog(win);
      const hb = await headerBox(win);
      const start = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 };
      let last = null;
      for (let i = 0; i < 3; i += 1) {
        await dragFrom(win, start, dx, dy);
        last = await shell(win);
      }
      const ok = inside(last);
      note(`extreme ${dx},${dy}: offset=(${last.x},${last.y}) rect=${JSON.stringify(last.rect)} vw=${last.vw} vh=${last.vh} inside=${ok}`);
      if (!ok) findings.push(`drag ${dx},${dy} left dialog out of viewport: rect=${JSON.stringify(last.rect)} vp=${last.vw}x${last.vh}`);
      await win.screenshot({ path: path.join(SHOTS, `adv-p33-drag-extreme-${dx}_${dy}.png`) });
      await P.closeDialog(win);
    }

    // ---------------- start on close button: must not move ----------------
    await openDialog(win);
    let cb = await win.locator('.modal-close').boundingBox();
    await win.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
    await win.mouse.down();
    await win.mouse.move(cb.x + 220, cb.y + 180, { steps: 8 });
    const midClose = await shell(win);
    await win.mouse.up();
    await win.waitForTimeout(200);
    const afterClose = await shell(win);
    const stillOpen = await win.locator('[data-print-dialog-shell]').count();
    note(`start-on-close: midDrag offset=(${midClose.x},${midClose.y}) after offset=(${afterClose.x},${afterClose.y}) shellCount=${stillOpen}`);
    if (Math.abs(midClose.x) > 1 || Math.abs(midClose.y) > 1) findings.push(`pointerdown on close button started a move (offset ${midClose.x},${midClose.y})`);
    if (stillOpen === 0) note('close button click fired and closed the dialog (expected control behaviour)');
    if (stillOpen > 0) { await P.closeDialog(win); }

    // ---------------- start on a control: must not move --------------------
    await openDialog(win);
    const copies = await win.locator('[data-print-copies]').boundingBox();
    await win.mouse.move(copies.x + copies.width / 2, copies.y + copies.height / 2);
    await win.mouse.down();
    await win.mouse.move(copies.x + 260, copies.y + 160, { steps: 8 });
    const midCtl = await shell(win);
    await win.mouse.up();
    await win.waitForTimeout(150);
    note(`start-on-copies: midDrag offset=(${midCtl.x},${midCtl.y})`);
    if (Math.abs(midCtl.x) > 1 || Math.abs(midCtl.y) > 1) findings.push(`pointerdown on the Copies input started a move (offset ${midCtl.x},${midCtl.y})`);
    await P.closeDialog(win);

    // ---------------- drag with a control FOCUSED --------------------------
    await openDialog(win);
    await win.locator('[data-print-copies]').focus();
    let hb = await headerBox(win);
    await dragFrom(win, { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 }, 120, 90);
    const focusedDrag = await shell(win);
    note(`drag-with-focused-control: offset=(${focusedDrag.x},${focusedDrag.y})`);
    if (focusedDrag.x === 0 && focusedDrag.y === 0) findings.push('dragging with a control focused did not move the dialog (silent no-op)');
    await P.closeDialog(win);

    // ---------------- drag while preview raster in flight ------------------
    await openDialog(win);
    // change range to force a new preview raster, then immediately drag
    await win.click('[data-print-range-custom]');
    await win.fill('[data-print-range-input]', '1-3');
    hb = await headerBox(win);
    await win.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await win.mouse.down();
    await win.mouse.move(hb.x + 90, hb.y + 40, { steps: 6 });
    await win.mouse.move(hb.x + 160, hb.y + 60, { steps: 6 });
    await win.mouse.up();
    const inFlight = await shell(win);
    note(`drag-during-raster: offset=(${inFlight.x},${inFlight.y}) rect=${JSON.stringify(inFlight.rect)}`);
    if (Math.abs(inFlight.x) < 50) findings.push(`drag during preview raster did not move as expected (offset ${inFlight.x})`);
    await P.closeDialog(win);

    // ---------------- rapid drag-release-drag ------------------------------
    await openDialog(win);
    hb = await headerBox(win);
    const anchor = { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 };
    for (let i = 0; i < 12; i += 1) {
      await win.mouse.move(anchor.x, anchor.y);
      await win.mouse.down();
      await win.mouse.move(anchor.x + ((i % 3) - 1) * 120, anchor.y + ((i % 5) - 2) * 40, { steps: 3 });
      await win.mouse.up();
    }
    await win.waitForTimeout(200);
    const rapid = await shell(win);
    note(`rapid-drag-release-drag: offset=(${rapid.x},${rapid.y}) inside=${inside(rapid)}`);
    if (!inside(rapid)) findings.push(`rapid drags left the dialog out of viewport: ${JSON.stringify(rapid.rect)}`);

    // ---------------- controls work after a move + configured print --------
    // Move it, then switch N-up and assert the preview grid changed.
    hb = await headerBox(win);
    await dragFrom(win, { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 }, 140, -90);
    await win.selectOption('[data-print-nup]', '4');
    await win.waitForTimeout(400);
    const grid = await win.evaluate(() => {
      const s = document.querySelector('[data-print-preview-sheet]');
      const cs = getComputedStyle(s);
      return { cols: cs.gridTemplateColumns.trim().split(/\s+/).filter(Boolean).length, rows: cs.gridTemplateRows.trim().split(/\s+/).filter(Boolean).length };
    });
    note(`after-move nup=4 preview grid=${grid.cols}x${grid.rows}`);
    if (grid.cols !== 2 || grid.rows !== 2) findings.push(`after moving the dialog, switching to 4-up did not re-layout the preview (got ${grid.cols}x${grid.rows})`);
    await win.screenshot({ path: path.join(SHOTS, 'adv-p33-dialog-moved.png') });
    await P.closeDialog(win);

    // ---------------- reopen returns to centre -----------------------------
    const centreFirst = await (async () => {
      await openDialog(win);
      return shell(win);
    })();
    await P.closeDialog(win);
    await openDialog(win);
    const reopened = await shell(win);
    note(`reopen: first open rect=${JSON.stringify(centreFirst.rect)} reopened offset=(${reopened.x},${reopened.y}) rect=${JSON.stringify(reopened.rect)}`);
    if (reopened.x !== 0 || reopened.y !== 0) findings.push(`reopened dialog not re-centred (offset ${reopened.x},${reopened.y})`);
    await P.closeDialog(win);

    // ---------------- resize after a move ----------------------------------
    await openDialog(win);
    hb = await headerBox(win);
    await dragFrom(win, { x: hb.x + hb.width / 2, y: hb.y + hb.height / 2 }, 5000, 5000); // clamp to bottom-right
    const beforeResize = await shell(win);
    note(`before resize (bottom-right): rect=${JSON.stringify(beforeResize.rect)} vp=${beforeResize.vw}x${beforeResize.vh}`);
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      const b = w.getBounds();
      w.setBounds({ x: b.x, y: b.y, width: 900, height: 620 });
    });
    await win.waitForTimeout(700);
    const afterShrink = await shell(win);
    note(`after shrink to ~900x620: rect=${JSON.stringify(afterShrink.rect)} vp=${afterShrink.vw}x${afterShrink.vh} inside=${inside(afterShrink)}`);
    await win.screenshot({ path: path.join(SHOTS, 'adv-p33-dialog-resize.png') });
    if (!inside(afterShrink)) {
      findings.push(`after moving the dialog to the bottom-right and shrinking the window, the dialog is outside the viewport: rect=${JSON.stringify(afterShrink.rect)} vp=${afterShrink.vw}x${afterShrink.vh}`);
    }
    // Can we still reach the header to drag it back?
    const hbAfter = await headerBox(win);
    const reachable = hbAfter && hbAfter.y >= 0 && hbAfter.y < afterShrink.vh && hbAfter.x >= 0 && hbAfter.x < afterShrink.vw;
    note(`header after shrink: ${JSON.stringify(hbAfter)} reachable=${reachable}`);
    if (!reachable) findings.push(`after shrinking the window the dialog header is off-screen (${JSON.stringify(hbAfter)}); panel cannot be dragged back`);
    await P.closeDialog(win);

    note(`FINDINGS=${findings.length}`);
    for (const f of findings) note(`  FINDING ${f}`);
    fs.writeFileSync(path.join(OUT, 'dialog-result.json'), JSON.stringify(findings, null, 2));
  } catch (e) {
    note(`HARNESS ERROR: ${e && e.stack ? e.stack : e}`);
    fs.writeFileSync(path.join(OUT, 'dialog-result.json'), JSON.stringify({ error: String(e) }, null, 2));
  } finally {
    await hardClose(app, 'adv-dialog');
  }
  note('DONE');
})().catch((e) => { console.error(e); process.exit(1); });