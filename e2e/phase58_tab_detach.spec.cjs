// Phase 58 (chunk 6) - tab tear-out to a NEW app window, then drag-back.
//
// The one assigned behaviour:
//   - dragging a document tab OUT of the tab bar (downward, below the strip)
//     and releasing moves its document into a NEW app window (`#detached`) and
//     removes it from the origin window (moved, not copied);
//   - dragging that tab out of the DETACHED window's strip returns it to the
//     origin window and the detached window closes.
//
// Launches only through the canonical launchApp helper.
//
// GESTURE NOTE (DEF-412): the arm threshold now measures TOTAL movement
// (`Math.hypot(dx, dy) <= 6`), so the acceptance gesture is a PURELY DOWNWARD
// drag - no sideways nudge. The spec presses the tab's `.tab-colour-chip`,
// moves straight down to `stripRect.bottom + 60` and releases; a failure can no
// longer be masked by a horizontal pre-move arming a gesture that the real
// tear-out path would never arm.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');

let app = null;

test.beforeEach(async () => {
  app = await launchApp();
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'p58-detach');
  app = null;
});
test.setTimeout(300000);

async function tabCount(page) {
  return page.locator('[data-tab-id]').count();
}

async function tabTitles(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-tab-id]')).map((el) => {
      const t = el.querySelector('.tab-title');
      return (t === null ? el.textContent : t.textContent).replace(/\s+/g, ' ').trim();
    }));
}

// The strip's geometry plus the live gesture attributes. `reorder` missing
// means AppHeader never even attached its drag handler (its `reorderEnabled`
// gate), so no tear-out can start; `dragging`/`tearout` are set mid-gesture.
async function stripState(page) {
  return page.evaluate(() => {
    const list = document.querySelector('.tab-list');
    if (list === null) return null;
    const r = list.getBoundingClientRect();
    return {
      left: Math.round(r.left),
      right: Math.round(r.right),
      top: Math.round(r.top),
      bottom: Math.round(r.bottom),
      height: Math.round(r.height),
      reorder: list.getAttribute('data-reorder'),
      tearout: list.getAttribute('data-tab-tearout'),
      dragging: list.getAttribute('data-dragging-tab'),
      reorderingClass: document.body.classList.contains('tab-reordering'),
    };
  });
}

// Perform one tear-out gesture on the first tab of `page`.
async function tearOutTab(page) {
  const chip = page.locator('[data-tab-id] .tab-colour-chip').first();
  const chipBox = await chip.boundingBox();
  const strip = await page.locator('.tab-list').boundingBox();
  const startX = chipBox.x + chipBox.width / 2;
  const startY = chipBox.y + chipBox.height / 2;
  const targetY = strip.y + strip.height + 60;
  const desc =
    `chipCenter=(${startX.toFixed(1)},${startY.toFixed(1)}) ` +
    `stripBottom=${(strip.y + strip.height).toFixed(1)} targetY=${targetY.toFixed(1)}`;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY + 10, { steps: 4 }); // cross the 6px total-movement arm threshold, straight down
  const armed = await stripState(page);
  await page.mouse.move(startX, targetY, { steps: 12 }); // straight down, below the strip
  const midway = await stripState(page);
  await page.mouse.up();
  try {
    await page.waitForTimeout(500);
  } catch {
    // A successful drag-back closes the detached window synchronously, so the
    // page is already gone by the time we settle. That close is the expected
    // outcome and is asserted by the caller; the settle wait is best-effort.
  }
  return { desc, armed, midway };
}

test('tear-out moves the tab into a new #detached window and the drag-back returns it', async () => {
  const origin = await app.firstWindow();
  await origin.waitForSelector('.sample-card', { timeout: 30000 });
  await origin.waitForTimeout(300);

  // 1. Open ONE bundled sample -> a single tab in the strip.
  const sample = getSamplePath('report.pdf');
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, sample);
  await origin.locator('[data-toolbar-open]').first().click();
  await origin.waitForSelector('.workspace', { timeout: 30000 });
  await expect(origin.locator('[data-tab-id]')).toHaveCount(1, { timeout: 30000 });
  await origin.waitForTimeout(700);

  const title = (await tabTitles(origin))[0];
  const before = await tabCount(origin);
  const preStrip = await stripState(origin);
  console.log(
    `[P58-detach] step1 origin tabs=${before} title=${JSON.stringify(title)} strip=${JSON.stringify(preStrip)}`,
  );

  // 2. Tear the tab out (armed before the gesture).
  const secondP = app.waitForEvent('window', { timeout: 20000 }).catch(() => null);
  const gesture = await tearOutTab(origin);
  console.log(`[P58-detach] gesture ${gesture.desc}`);
  console.log(`[P58-detach] armed=${JSON.stringify(gesture.armed)}`);
  console.log(`[P58-detach] midway=${JSON.stringify(gesture.midway)}`);
  const second = await secondP;
  console.log(`[P58-detach] windows after gesture=${app.windows().length}`);

  // 3. A new window must open, carrying the #detached hash and the document.
  expect(
    second,
    `tear-out gesture did not open a new window; origin strip=${JSON.stringify(preStrip)}`,
  ).not.toBeNull();
  await second.waitForLoadState('domcontentloaded');
  const secondUrl = second.url();
  console.log(`[P58-detach] new window url=${secondUrl}`);
  expect(secondUrl, 'new window URL carries the #detached hash').toContain('#detached');

  await second.waitForSelector('[data-tab-id]', { timeout: 30000 });
  await second.waitForTimeout(900);
  const newTitles = await tabTitles(second);
  console.log(`[P58-detach] new window tabs=${JSON.stringify(newTitles)}`);
  expect(newTitles, 'detached window shows the moved document').toContain(title);
  await second.screenshot({ path: path.join(SHOTS, 'p58-detach-new-window.png') });

  // The origin dropped by exactly one: the document MOVED, not copied.
  await expect(origin.locator('[data-tab-id]')).toHaveCount(before - 1, { timeout: 20000 });
  console.log(`[P58-detach] origin tabs after ack=${await tabCount(origin)}`);
  // Origin AFTER the detach: the document is gone from here (moved, not copied).
  await origin.screenshot({ path: path.join(SHOTS, 'p58-detach-origin.png') });

  // 4. Tear the tab OUT of the detached window -> return + close.
  const closeP = second.waitForEvent('close', { timeout: 30000 }).catch(() => null);
  const gesture2 = await tearOutTab(second);
  console.log(`[P58-detach] return gesture ${gesture2.desc}`);
  console.log(`[P58-detach] return armed=${JSON.stringify(gesture2.armed)} midway=${JSON.stringify(gesture2.midway)}`);
  const closed = await closeP;
  console.log(`[P58-detach] detached closed event=${closed ? 'yes' : 'no'} windows=${app.windows().length}`);

  // Origin returns to exactly one tab showing the document.
  await expect(origin.locator('[data-tab-id]')).toHaveCount(1, { timeout: 30000 });
  const returnedTitles = await tabTitles(origin);
  console.log(`[P58-detach] origin tabs after return=${JSON.stringify(returnedTitles)}`);
  expect(returnedTitles, 'origin re-adopts the returned document').toContain(title);
  await origin.screenshot({ path: path.join(SHOTS, 'p58-detach-returned.png') });

  // The detached window is gone.
  const survivors = app.windows().filter((w) => !w.isClosed());
  console.log(`[P58-detach] surviving windows=${survivors.length}`);
  expect(survivors.length, 'detached window closed after the return').toBe(1);
});
