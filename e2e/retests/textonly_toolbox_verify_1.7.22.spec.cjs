// v1.7.22 — floating-toolbox action buttons must be TEXT-ONLY (Cancel /
// Delete / Confirm), with NO X / Check / tick icons, and consistent across
// every floating toolbox. This spec drives the INSTALLED v1.7.22 binary and
// asserts, for each toolbox, that the action buttons render exactly one text
// label (no <svg>, no nested <span>) and carry the shared `.toolbox-action-btn`
// style. It also pins the Edit/Add box commit button regression: it used to
// render BOTH a <Check> icon AND a conditional <span>Confirm</span> that
// overlapped after the toolbox was dragged. It must now render exactly one
// text node ("Apply" before a drag, "Confirm" after).
//
// Toolboxes covered: Edit box editor, Add box editor, signature pending bar,
// note editor, textbox editor, callout editor, color palette.

const { test, expect } = require('@playwright/test');
const { launchInstalled, openSample, shot, hardClose } = require('../lib/helpers.cjs');

let electronApp = null;
let win = null;
let pageErrors = [];

test.beforeEach(async () => {
  ({ electronApp, window: win } = await launchInstalled());
  pageErrors = [];
  win.on('pageerror', (err) => {
    const m = err && err.message ? err.message : String(err);
    pageErrors.push(m);
    process.stdout.write(`[PAGEERROR] ${m}\n`);
  });
  await win.waitForTimeout(400);
});

test.afterEach(async () => {
  if (electronApp) await hardClose(electronApp);
  electronApp = null; win = null; pageErrors = [];
});

test.setTimeout(300000);

function badHooks() {
  return pageErrors.filter((m) => /#310|Rules of Hooks|#520|Invalid page request|NaN/.test(m));
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function slotBox(pageNum) {
  const slot = win.locator(`.page-slot[data-page="${pageNum}"]`).first();
  await slot.waitFor({ timeout: 15000 });
  return slot.boundingBox();
}

// Inspect a button: return its visible text, whether it contains any svg /
// span (an icon or nested label), and its class list.
async function buttonInfo(selector) {
  return win.evaluate((sel) => {
    const b = document.querySelector(sel);
    if (!b) return null;
    return {
      text: b.textContent,
      hasSvg: b.querySelectorAll('svg').length > 0,
      hasSpan: b.querySelectorAll('span').length > 0,
      hasCheckIcon: b.querySelectorAll('[data-lucide="check"], .lucide-check, svg').length > 0,
      classes: Array.from(b.classList),
    };
  }, selector);
}

// Assert a button is TEXT-ONLY: exactly the given label, no svg, no span.
async function expectTextOnly(selector, label) {
  const info = await buttonInfo(selector);
  expect(info, `${selector} must exist`).not.toBeNull();
  expect(info.text, `${selector} must render exactly the label "${label}"`).toBe(label);
  expect(info.hasSvg, `${selector} must NOT contain an svg icon`).toBe(false);
  expect(info.hasSpan, `${selector} must NOT contain a nested span`).toBe(false);
  console.log(`[TEXT-ONLY] ${selector} -> "${info.text}" (svg=${info.hasSvg} span=${info.hasSpan})`);
  return info;
}

// ---------------------------------------------------------------------------
// Edit / Add box editor
// ---------------------------------------------------------------------------

test('v1.7.22 Edit/Add box editor: action buttons text-only, no tick-icon overlap on commit', async () => {
  await openSample(win, electronApp, 'report.pdf');
  const box = await slotBox(1);

  // Enter Edit mode -> Add box tool.
  await win.click('[data-toolbar-edit-toggle]');
  await win.waitForSelector('[data-edit-toolbar]', { timeout: 10000 });
  await win.click('[data-edit-tool="box"]');
  await win.waitForTimeout(400);

  // Drag a NEW (uncommitted) box on the page -> the inline editor opens.
  await win.mouse.move(box.x + 200, box.y + 200);
  await win.mouse.down();
  await win.mouse.move(box.x + 360, box.y + 280, { steps: 8 });
  await win.mouse.up();
  await win.waitForSelector('[data-edit-editor="box"]', { timeout: 10000 });
  await win.waitForTimeout(500);

  // Type text into the box so the commit actually places a persistent box.
  await win.fill('[data-edit-textarea]', 'MOVE TEST 88');
  await win.waitForTimeout(300);

  // --- ADD BOX editor (fresh, uncommitted) ---
  await expectTextOnly('.edit-inline-btn-cancel', 'Cancel');
  await expectTextOnly('.edit-inline-btn-commit', 'Apply');
  // A freshly-dragged (uncommitted) box has nothing to delete -> NO Delete button.
  const deleteCount = await win.locator('.edit-inline-btn-delete').count();
  expect(deleteCount, 'uncommitted box editor must NOT show a Delete button').toBe(0);
  // Commit control must render exactly one text node (no icon+span overlap).
  const commit = await buttonInfo('.edit-inline-btn-commit');
  expect(commit.text, 'fresh commit label must be exactly "Apply"').toBe('Apply');
  expect(commit.hasSvg, 'fresh commit button must have no svg').toBe(false);
  expect(commit.hasSpan, 'fresh commit button must have no span').toBe(false);
  expect(commit.classes.includes('toolbox-action-btn'), 'commit must use shared toolbox-action-btn').toBe(true);
  await shot('textonly-1722-addbox-fresh.png');

  // Commit the box (Apply).
  await win.click('.edit-inline-btn-commit');
  await win.waitForTimeout(1200);

  // The committed box surface must now exist.
  const boxSurface = win.locator('.edit-box[data-edit-box-id]').first();
  await boxSurface.waitFor({ timeout: 10000 });

  // Re-open the COMMITTED box -> EDIT box editor (now has a Delete button).
  const bs = await boxSurface.boundingBox();
  expect(bs, 'committed box surface must have a bounding box').toBeTruthy();
  await win.mouse.click(bs.x + bs.width / 2, bs.y + bs.height / 2);
  await win.waitForSelector('[data-edit-editor="edit"]', { timeout: 10000 });
  await win.waitForTimeout(500);

  // --- EDIT box editor (committed) ---
  await expectTextOnly('.edit-inline-btn-cancel', 'Cancel');
  await expectTextOnly('.edit-inline-btn-delete', 'Delete');
  await expectTextOnly('.edit-inline-btn-commit', 'Apply');

  // --- The overlap regression: drag the toolbox +200/+120 ---
  const bar = await win.evaluate(() => {
    const e = document.querySelector('.edit-inline-editor');
    const b = e && e.querySelector('[data-edit-drag-handle]');
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  expect(bar, 'editor drag handle must exist').toBeTruthy();
  const gx = bar.x + 5;
  const gy = bar.y + 5;
  await win.mouse.move(gx, gy);
  await win.mouse.down();
  await win.mouse.move(gx + 200, gy + 120, { steps: 12 });
  await win.mouse.up();
  await win.waitForTimeout(600);

  // After the toolbox moved, the commit control must switch to "Confirm" as
  // ONE text node — no <Check> icon, no <span>Confirm</span> overlapping.
  await expectTextOnly('.edit-inline-btn-commit', 'Confirm');
  const confirm = await buttonInfo('.edit-inline-btn-commit');
  expect(confirm.classes.includes('toolbox-action-btn--confirm'), 'Confirm uses the confirm variant').toBe(true);
  expect(confirm.hasCheckIcon, 'Confirm must have NO check/tick icon').toBe(false);
  const commitChildren = await win.evaluate(() => {
    const b = document.querySelector('.edit-inline-btn-commit');
    return b ? b.children.length : -1;
  });
  expect(commitChildren, 'commit button must contain exactly zero child elements (one text node)').toBe(0);
  await shot('textonly-1722-editbox-dragged-confirm.png');

  expect(badHooks(), 'no React/runtime hook errors during edit box flows').toHaveLength(0);
  console.log('[PASS] Edit/Add box editor action buttons are text-only; no tick-icon overlap on commit');
});

// ---------------------------------------------------------------------------
// Signature pending bar
// ---------------------------------------------------------------------------

test('v1.7.22 signature pending bar: text-only Confirm / Cancel / Delete', async () => {
  await openSample(win, electronApp, 'report.pdf');
  const box = await slotBox(1);

  await win.click('button[aria-label="Sign tool"]');
  await win.waitForSelector('.sig-manager', { timeout: 15000 });
  await win.click('.sig-tab:has-text("Type")');
  await win.fill('input[aria-label="Type your signature"]', 'QA Sign');
  await win.click('.sig-manager button:text-is("Save")');
  await win.waitForTimeout(400);
  await win.click('.sig-saved-pick');
  await win.waitForTimeout(400);

  // Place the signature on the page -> the pending action bar appears.
  await win.mouse.click(box.x + 400, box.y + 400);
  await win.waitForSelector('[data-sig-action-bar]', { timeout: 10000 });
  await win.waitForTimeout(400);

  await expectTextOnly('[data-sig-action="confirm"]', 'Confirm');
  await expectTextOnly('[data-sig-action="cancel"]', 'Cancel');
  await expectTextOnly('[data-sig-action="delete"]', 'Delete');

  // No icon anywhere in the bar.
  const svgCount = await win.locator('[data-sig-action-bar] svg').count();
  const spanCount = await win.locator('[data-sig-action-bar] span').count();
  expect(svgCount, 'sig bar must contain no svg').toBe(0);
  expect(spanCount, 'sig bar must contain no span').toBe(0);
  await shot('textonly-1722-signature-pending-bar.png');

  expect(badHooks(), 'no React/runtime hook errors during signature bar').toHaveLength(0);
  console.log('[PASS] Signature pending bar action buttons are text-only');
});

// ---------------------------------------------------------------------------
// Note editor
// ---------------------------------------------------------------------------

test('v1.7.22 note editor: text-only Confirm / Cancel / Delete', async () => {
  await openSample(win, electronApp, 'report.pdf');
  const box = await slotBox(1);

  await win.click('.ann-toolbar button[data-tool="note"]');
  await win.waitForTimeout(300);
  await win.mouse.click(box.x + 300, box.y + 420);
  await win.waitForSelector('[data-annotation-editor="note"]', { timeout: 10000 });
  await win.waitForTimeout(400);

  await expectTextOnly('[data-annotation-action="note-confirm"]', 'Confirm');
  await expectTextOnly('[data-annotation-action="note-cancel"]', 'Cancel');
  await expectTextOnly('[data-annotation-action="note-delete"]', 'Delete');
  await shot('textonly-1722-note-editor.png');

  expect(badHooks(), 'no React/runtime hook errors during note editor').toHaveLength(0);
  console.log('[PASS] Note editor action buttons are text-only');
});

// ---------------------------------------------------------------------------
// Textbox editor
// ---------------------------------------------------------------------------

test('v1.7.22 textbox editor: text-only Confirm / Cancel / Delete', async () => {
  await openSample(win, electronApp, 'report.pdf');
  const box = await slotBox(1);

  await win.click('.ann-toolbar button[data-tool="textbox"]');
  await win.waitForTimeout(300);
  await win.mouse.click(box.x + 200, box.y + 200);
  await win.waitForSelector('[data-annotation-editor="textbox"]', { timeout: 10000 });
  await win.waitForTimeout(400);

  await expectTextOnly('[data-annotation-action="textbox-confirm"]', 'Confirm');
  await expectTextOnly('[data-annotation-action="textbox-cancel"]', 'Cancel');
  await expectTextOnly('[data-annotation-action="textbox-delete"]', 'Delete');
  await shot('textonly-1722-textbox-editor.png');

  expect(badHooks(), 'no React/runtime hook errors during textbox editor').toHaveLength(0);
  console.log('[PASS] Textbox editor action buttons are text-only');
});

// ---------------------------------------------------------------------------
// Callout editor
// ---------------------------------------------------------------------------

test('v1.7.22 callout editor: text-only Confirm / Cancel / Delete', async () => {
  await openSample(win, electronApp, 'report.pdf');
  const box = await slotBox(1);

  await win.click('.ann-toolbar button[data-tool="callout"]');
  await win.waitForTimeout(300);
  await win.mouse.move(box.x + 300, box.y + 320);
  await win.mouse.down();
  await win.mouse.move(box.x + 430, box.y + 400, { steps: 6 });
  await win.mouse.up();
  await win.waitForSelector('[data-annotation-editor="callout"]', { timeout: 10000 });
  await win.waitForTimeout(400);

  await expectTextOnly('[data-annotation-action="callout-confirm"]', 'Confirm');
  await expectTextOnly('[data-annotation-action="callout-cancel"]', 'Cancel');
  await expectTextOnly('[data-annotation-action="callout-delete"]', 'Delete');
  await shot('textonly-1722-callout-editor.png');

  expect(badHooks(), 'no React/runtime hook errors during callout editor').toHaveLength(0);
  console.log('[PASS] Callout editor action buttons are text-only');
});

// ---------------------------------------------------------------------------
// Color palette
// ---------------------------------------------------------------------------

test('v1.7.22 color palette: saved-color Delete button is text-only', async () => {
  await openSample(win, electronApp, 'report.pdf');

  // Arm a markup tool so the color row shows.
  await win.click('.ann-toolbar button[data-tool="highlight"]');
  await win.waitForSelector('[data-color-current]', { timeout: 10000 });
  await win.click('[data-color-current]');
  await win.waitForSelector('[data-color-popover]', { timeout: 10000 });
  await win.waitForTimeout(400);

  // Add a custom color so the "Your colors" section has a swatch with a Delete button.
  await win.fill('[data-palette-hex-input]', '#123456');
  await win.keyboard.press('Enter');
  await win.waitForTimeout(300);
  const addBtn = win.locator('.color-palette-add');
  if (await addBtn.count()) {
    await addBtn.click();
    await win.waitForTimeout(400);
  }

  const removeBtn = win.locator('.color-swatch-remove').first();
  const removeCount = await removeBtn.count();
  console.log(`[PALETTE] color-swatch-remove count=${removeCount}`);
  expect(removeCount, 'a saved-color Delete button must exist after adding a custom color').toBeGreaterThan(0);

  await expectTextOnly('.color-swatch-remove', 'Delete');
  const removeInfo = await buttonInfo('.color-swatch-remove');
  expect(removeInfo.hasSvg, 'palette Delete must have no svg').toBe(false);
  expect(removeInfo.hasSpan, 'palette Delete must have no span').toBe(false);
  await shot('textonly-1722-color-palette.png');

  expect(badHooks(), 'no React/runtime hook errors during color palette').toHaveLength(0);
  console.log('[PASS] Color palette Delete button is text-only');
});
