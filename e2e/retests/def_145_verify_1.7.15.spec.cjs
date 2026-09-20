// QA verification (installed v1.7.15) — DEF-145.
//
// Drag a COMMITTED Add-box text box. EXPECTED (the fix): the box surface AND its
// text travel together to the new position with NO stale text copy left at the
// ORIGINAL position while the mouse is held (not just after release).
// Launch only via e2e/lib/launch.cjs against the DEV build (historically: the packaged installed exe).

const { test, expect } = require('@playwright/test');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');
const path = require('node:path');
const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');

test.setTimeout(300000);

let electronApp = null;
let win = null;
let pageErrors = [];

test.beforeEach(async () => {
  electronApp = await launchApp([]);
  win = await electronApp.firstWindow();
  await win.waitForSelector('.welcome, .workspace', { timeout: 30000 });
  pageErrors = [];
  win.on('pageerror', (err) => {
    const m = err && err.message ? err.message : String(err);
    pageErrors.push(m);
    process.stdout.write(`[PAGEERROR] ${m}\n`);
  });
  await win.waitForTimeout(700);
});

test.afterEach(async () => {
  await hardClose(electronApp);
  electronApp = null;
  win = null;
  pageErrors = [];
});

async function shot(name) {
  const p = path.join(SHOTS, name);
  await win.screenshot({ path: p });
  console.log(`[SHOT] ${name}`);
  return p;
}

async function openSampleFromCard(name) {
  await win.locator(`.sample-card:has-text("${name}")`).first().click();
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForTimeout(2200);
}

async function boxSnapshot(label) {
  const out = await win.evaluate(() => {
    const boxes = Array.from(document.querySelectorAll('[data-edit-box-id]'));
    const mirrors = Array.from(document.querySelectorAll('[data-edit-box-text-mirror]'));
    const rect = (b) => { const r = b.getBoundingClientRect(); return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }; };
    return {
      boxCount: boxes.length,
      boxRects: boxes.map(rect),
      mirrorCount: mirrors.length,
      mirrorTexts: mirrors.map((m) => (m.textContent || '').trim().slice(0, 40)),
      mirrorRects: mirrors.map(rect),
    };
  });
  console.log(`[BOX|${label}] ${JSON.stringify(out)}`);
  return out;
}

test('DEF-145: dragging a committed textbox -> box + text travel together, no stale copy at origin', async () => {
  await openSampleFromCard('report.pdf');

  // Edit mode -> Add box tool -> place a box with text, commit via Ctrl+Enter.
  await win.click('[data-toolbar-edit-toggle]');
  await win.waitForSelector('[data-edit-toolbar]', { timeout: 10000 });
  await win.waitForTimeout(400);
  await win.click('[data-edit-tool="box"]');
  await win.waitForTimeout(400);

  const slot1 = win.locator('.page-slot[data-page="1"]').first();
  await slot1.waitFor({ timeout: 15000 });
  const slotRect = await slot1.boundingBox();
  const px = slotRect.x + slotRect.width * 0.30;
  const py = slotRect.y + 230;
  await win.mouse.move(px, py);
  await win.mouse.down();
  await win.mouse.move(px + 140, py + 90, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(800);

  // Phase 26 — the inline editor is retired; the panel Text field is the
  // editor and the session commits on blur.
  const ta = win.locator('[data-txt-text]').first();
  await ta.waitFor({ timeout: 10000 });
  await ta.fill('STALE CHECK BOX');
  await win.waitForTimeout(300);
  await ta.blur();
  await win.waitForTimeout(800);

  const committed = await boxSnapshot('COMMITTED');
  expect(committed.boxCount, 'a committed box must exist').toBeGreaterThanOrEqual(1);
  expect(committed.mirrorTexts.join('|'), 'committed box must hold the full text').toContain('STALE CHECK BOX');

  // Re-arm the box tool so the committed box is draggable.
  await win.click('[data-edit-tool="box"]');
  await win.waitForTimeout(400);

  // Drag the committed box +180/+120 and HOLD; sample mid-drag (before release).
  const boxBefore = committed.boxRects[0];
  const grabX = boxBefore.x + boxBefore.w / 2;
  const grabY = boxBefore.y + boxBefore.h / 2;
  await win.mouse.move(grabX, grabY);
  await win.mouse.down();
  await win.mouse.move(grabX + 180, grabY + 120, { steps: 12 });
  await win.waitForTimeout(300);

  const midDrag = await boxSnapshot('MID-DRAG');
  await shot('def-145-1715-middrag.png');

  await win.mouse.up();
  await win.waitForTimeout(600);
  const afterDrag = await boxSnapshot('AFTER-DRAG');
  await shot('def-145-1715-after-drag.png');

  // --- Diagnostic ---
  const oldRect = committed.boxRects[0];
  const midRect = midDrag.boxRects[0];
  const mirrorMid = midDrag.mirrorRects[0];
  const mirrorOld = committed.mirrorRects[0];
  console.log(`[145] boxRect before=${JSON.stringify(oldRect)} mid=${JSON.stringify(midRect)}`);
  console.log(`[145] mirrorRect before=${JSON.stringify(mirrorOld)} mid=${JSON.stringify(mirrorMid)}`);
  const boxDx = midRect ? Math.round(midRect.x - oldRect.x) : 'n/a';
  const boxDy = midRect ? Math.round(midRect.y - oldRect.y) : 'n/a';
  const mirrorDx = mirrorMid ? Math.round(mirrorMid.x - mirrorOld.x) : 'n/a';
  const mirrorDy = mirrorMid ? Math.round(mirrorMid.y - mirrorOld.y) : 'n/a';
  console.log(`[145] box moved mid-drag by dx=${boxDx} dy=${boxDy}; mirror moved by dx=${mirrorDx} dy=${mirrorDy} (drag was +180/+120)`);

  // --- Verdict ---
  // The box surface must move with the drag (not stuck at origin)...
  const boxMoved = midRect && Math.abs(midRect.x - oldRect.x) > 20 && Math.abs(midRect.y - oldRect.y) > 20;
  // ...and the text mirror must travel WITH the box (no stale-at-origin).
  const mirrorTravels = mirrorMid && Math.abs(mirrorMid.x - mirrorOld.x) > 20 && Math.abs(mirrorMid.y - mirrorOld.y) > 20 &&
    Math.abs(mirrorMid.x - midRect.x) < 3 && Math.abs(mirrorMid.y - midRect.y) < 3;
  // There must be only ONE live text mirror (no second/stale copy at the origin),
  // and it must NOT be sitting back at the original box location.
  const singleTextCopy = midDrag.mirrorCount === committed.mirrorCount && committed.mirrorCount === 1;
  const noStaleAtOrigin = mirrorMid && Math.abs(mirrorMid.x - mirrorOld.x) > 20 && Math.abs(mirrorMid.y - mirrorOld.y) > 20;
  const pass = boxMoved && mirrorTravels && singleTextCopy && noStaleAtOrigin;
  console.log(`[145|VERDICT] boxMoved=${boxMoved} mirrorTravelsWithBox=${mirrorTravels} singleTextCopy=${singleTextCopy} noStaleAtOrigin=${noStaleAtOrigin}`);
  console.log(`[145|VERDICT] RESULT=${pass ? 'PASS' : 'FAIL'} (note: [data-edit-box-id] may also match the Edit/Delete action bar, hence boxCount can be >1)`);
  expect(pass, `DEF-145 ${pass ? 'PASS' : 'FAIL'} — box+text must travel together with no stale copy at origin`).toBe(true);

  const bad = pageErrors.filter((m) => /Invalid page request|degreeAngle|NaN|#310|Rules of Hooks|#520/.test(m));
  console.log(`[145] pageErrors=${JSON.stringify(pageErrors)}`);
  expect(bad, 'no unhandled page-request / React-hook / NaN errors').toHaveLength(0);
});
