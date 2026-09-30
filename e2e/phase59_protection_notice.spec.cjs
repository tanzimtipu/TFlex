// Phase 59 (item 2) — the document-protection notice redesign.
//
// The assigned behaviour:
//   - the notice renders as a ROUNDED box with an ENTRANCE animation;
//   - after ~10 s it collapses on its own into a small "i" (info) icon pinned
//     at the canvas's TOP-LEFT;
//   - clicking the "i" re-expands the box; the expanded box carries a collapse
//     control that collapses it again;
//   - the collapsed icon never overlaps the page.
//
// Launches only through the canonical launchApp helper. The encrypted fixture
// is synthetic (e2e/lib/p52_crypto.cjs), never an operator document.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');
const { makeEncryptedFixture } = require('./lib/p52_crypto.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');

let app = null;
let win = null;

test.setTimeout(300000);

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'p59-protect');
  app = null;
  win = null;
});

async function stubOpen(filePath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, filePath);
}

async function openProtected() {
  const fixture = await makeEncryptedFixture({
    name: 'p59-protect.pdf',
    algorithm: 'AES-256',
    userPassword: 'P59-Protect!',
  });
  await stubOpen(fixture);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForSelector('[data-password-prompt]', { timeout: 20000 });
  await win.locator('[data-password-input]').fill('P59-Protect!');
  await win.locator('[data-password-submit]').click();
  await win.waitForSelector('[data-password-prompt]', { state: 'detached', timeout: 30000 });
  await win.waitForSelector('[data-protection-notice]', { timeout: 15000 });
}

// The page box the collapsed icon must not overlap.
async function pageRect() {
  return win.evaluate(() => {
    const el = document.querySelector('.pdf-page') ?? document.querySelector('.page-slot');
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  });
}

function overlaps(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

// Normalize a Playwright boundingBox (x/y/width/height) to a left/top/right/bottom
// rect so it can be compared with `overlaps` and `pageRect()`.
function boxOf(r) {
  if (r === null) return null;
  return { x: r.x, y: r.y, width: r.width, height: r.height, left: r.x, top: r.y, right: r.x + r.width, bottom: r.y + r.height };
}

test('protection notice: rounded + animated, auto-collapses to the "i" after ~10s, re-expands, never overlaps the page', async () => {
  await openProtected();
  await win.waitForTimeout(400);

  // 1. Rounded box with an entrance animation.
  const box = await win.evaluate(() => {
    const el = document.querySelector('[data-protection-notice]');
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      borderRadius: cs.borderTopLeftRadius,
      animationName: cs.animationName,
      animationDuration: cs.animationDuration,
      width: r.width,
      height: r.height,
    };
  });
  console.log(`[P59-protect] box=${JSON.stringify(box)}`);
  expect(parseFloat(box.borderRadius), `rounded box (radius ${box.borderRadius})`).toBeGreaterThan(0);
  expect(box.animationName, 'entrance animation is the notice-in keyframe').toContain('protection-notice-in');
  expect(parseFloat(box.animationDuration), 'entrance animation has a non-zero duration').toBeGreaterThan(0);
  expect(box.width, 'the box is a real visible box').toBeGreaterThan(100);
  await win.screenshot({ path: path.join(SHOTS, 'p59-protection-expanded.png') });

  // 2. The expanded box carries a collapse control.
  expect(await win.locator('[data-protection-collapse]').count(), 'expanded box has a collapse control').toBe(1);

  // 3. It collapses on its own after ~10 s into the "i" icon.
  const t0 = Date.now();
  await win.waitForSelector('[data-protection-icon]', { timeout: 20000 });
  const elapsed = Date.now() - t0;
  const collapsed = await win.evaluate(() => ({
    notice: document.querySelector('[data-protection-notice]') !== null,
    state: document.querySelector('[data-protection-notice-state]')?.getAttribute('data-protection-notice-state') ?? null,
  }));
  console.log(`[P59-protect] auto-collapse after ${elapsed}ms state=${collapsed.state} noticePresent=${collapsed.notice}`);
  expect(collapsed.notice, 'the box is gone once collapsed').toBe(false);
  expect(collapsed.state, 'the region reports the collapsed state').toBe('collapsed');
  expect(elapsed, `auto-collapse dwell ~10s (measured ${elapsed}ms)`).toBeGreaterThanOrEqual(8000);
  expect(elapsed, `auto-collapse dwell ~10s (measured ${elapsed}ms)`).toBeLessThanOrEqual(14000);

  // 4. The collapsed icon sits at the canvas's top-left and does not overlap the page.
  const icon = await win.locator('[data-protection-icon]').boundingBox();
  const page = await pageRect();
  // The canvas is the page scroller, not `.document-column` (which spans the whole
  // stage from x=64, over the LEFT ContextPanel). Using `.document-column` as the
  // basis let the original DEF-435 bug pass: an icon over the left panel was still
  // "in the left half" of a column that starts under that panel.
  const canvas = await win.locator('.document-scroller').boundingBox();
  const combine = await win.locator('[data-context-panel-combine]').boundingBox();
  const iconBox = boxOf(icon);
  const combineBox = boxOf(combine);
  const iconHit = await win.evaluate(() => {
    const el = document.querySelector('[data-protection-icon]');
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      resolves: top === el || el.contains(top),
      top: top ? `${top.tagName}.${String(top.className)}` : 'none',
      opacity: cs.opacity,
      visibility: cs.visibility,
      zIndex: cs.zIndex,
      rect: { left: r.left, top: r.top, width: r.width, height: r.height },
    };
  });
  console.log(`[P59-protect] icon=${JSON.stringify(icon)} page=${JSON.stringify(page)} canvas=${JSON.stringify(canvas)} combine=${JSON.stringify(combine)} iconHit=${JSON.stringify(iconHit)}`);
  expect(icon, 'the collapsed "i" is visible').not.toBeNull();
  expect(page, 'a page is rendered').not.toBeNull();
  // Top-left of the canvas: the icon starts at or right of the page scroller's left
  // edge (right of the left panel) and in the canvas's top half.
  expect(icon.x, 'icon is at/right of the canvas left edge').toBeGreaterThanOrEqual(canvas.x);
  expect(icon.x, 'icon is in the left half of the canvas').toBeLessThan(canvas.x + canvas.width / 2);
  expect(icon.y, 'icon is in the top half of the canvas').toBeLessThan(canvas.y + canvas.height / 2);
  expect(overlaps(iconBox, page), `collapsed icon overlaps the page (icon=${JSON.stringify(iconBox)} page=${JSON.stringify(page)})`).toBe(false);
  // The icon must cover no control: the left panel's Combine control must not overlap it.
  expect(combineBox, 'the left panel Combine control exists').not.toBeNull();
  expect(overlaps(iconBox, combineBox), `collapsed icon overlaps the Combine control (icon=${JSON.stringify(iconBox)} combine=${JSON.stringify(combineBox)})`).toBe(false);
  // The icon must be reachable (not occluded by the left panel / page chrome).
  expect(iconHit, 'the collapsed icon hit-test resolves').not.toBeNull();
  expect(iconHit.resolves, `the collapsed icon is occluded by ${iconHit.top}`).toBe(true);
  await win.screenshot({ path: path.join(SHOTS, 'p59-protection-collapsed-icon.png') });
  await win.screenshot({ path: path.join(SHOTS, 'tfl46-icon-fixed.png') });
  await win.screenshot({
    path: path.join(SHOTS, 'p59-protection-icon-clip.png'),
    clip: { x: Math.max(0, icon.x - 30), y: Math.max(0, icon.y - 30), width: 160, height: 120 },
  });

  // 5. Clicking the "i" re-expands the box.
  await win.locator('[data-protection-icon]').click();
  await win.waitForSelector('[data-protection-notice]', { timeout: 8000 });
  await win.waitForTimeout(400);
  const reexpanded = await win.evaluate(() => ({
    notice: document.querySelector('[data-protection-notice]') !== null,
    icon: document.querySelector('[data-protection-icon]') !== null,
    state: document.querySelector('[data-protection-notice-state]')?.getAttribute('data-protection-notice-state') ?? null,
  }));
  console.log(`[P59-protect] re-expanded=${JSON.stringify(reexpanded)}`);
  expect(reexpanded.notice, 'clicking the "i" re-expands the box').toBe(true);
  expect(reexpanded.icon, 'the "i" is gone while expanded').toBe(false);
  expect(reexpanded.state, 'the region reports the expanded state').toBe('expanded');
  await win.screenshot({ path: path.join(SHOTS, 'p59-protection-reexpanded.png') });

  // 6. The collapse control collapses it again on demand.
  await win.locator('[data-protection-collapse]').click();
  await win.waitForSelector('[data-protection-icon]', { timeout: 8000 });
  await win.waitForTimeout(300);
  expect(await win.locator('[data-protection-notice]').count(), 'the collapse control collapsed the box').toBe(0);
  expect(await win.locator('[data-protection-icon]').count(), 'the "i" is back').toBe(1);
});
