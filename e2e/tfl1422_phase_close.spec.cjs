// TFL-1478 — TFL-1422 phase-close QA (TFL-1465, renderer-only).
//
// Verifies the four phase success criteria against the RUNNING app:
//   SC1 uniform inset: card border-to-preview gap is ~7px on all four sides.
//   SC2 tick + three-dots: [data-thumb-overlay] is an absolute bar flush to the
//       preview bottom and a SIBLING of .thumb-page (the preview button holds no
//       interactive control); checkbox left, More right.
//   SC3 eye icon: [data-thumb-viewing] renders an SVG with aria-label/title
//       "Currently viewing" and NO "Viewing" text node.
//   SC4 selection/preview unchanged: checkbox toggles the set without navigating;
//       the preview button navigates; current (neutral) != selected (tinted).
// QA-owned. Also emits TFL-1422 light/dark/frosted pane screenshots.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { openSamplePath, hardClose, ensurePanelExpanded, setTheme } = require('./lib/helpers.cjs');

delete process.env.ELECTRON_RUN_AS_NODE;

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const PANEL = '[data-context-panel="pages"]';

let app = null;
let win = null;
test.setTimeout(300000);

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
  await openSamplePath(win, app, getSamplePath('report.pdf'));
  await ensurePanelExpanded(win);
  await win.waitForSelector(`${PANEL} .thumb-item.thumb-card`, { timeout: 30000 });
  await win.waitForSelector(`${PANEL} .thumb-item[data-page="2"]`, { timeout: 30000 });
  await win.waitForTimeout(800);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl1422');
  app = null;
  win = null;
});

const currentPage = () => win.evaluate(() => window.tflexDiagnostics().currentPage);

async function measureCard() {
  return win.evaluate((p) => {
    const panel = document.querySelector(p);
    const card = panel.querySelector('.thumb-item');
    const wrap = card.querySelector('.thumb-canvas-wrap');
    const page = card.querySelector('.thumb-page');
    const overlay = card.querySelector('[data-thumb-overlay]');
    const cb = card.getBoundingClientRect();
    const wb = wrap.getBoundingClientRect();
    const ob = overlay ? overlay.getBoundingClientRect() : null;
    const r = (n) => Math.round(n * 100) / 100;
    const viewingEl = card.querySelector('[data-thumb-viewing]');
    return {
      classes: card.className,
      hasThumbCard: card.classList.contains('thumb-card'),
      gaps: { left: r(wb.left - cb.left), right: r(cb.right - wb.right), top: r(wb.top - cb.top), bottom: r(cb.bottom - wb.bottom) },
      cardWidth: r(cb.width),
      wrapWidth: r(wb.width),
      overlay: overlay ? {
        pageHasControl: page.querySelector('input,button,select,textarea,a[href],[role="button"]') !== null,
        insidePage: page.contains(overlay),
        siblingOfPage: overlay.parentElement === page.parentElement,
        firstIsCheckbox: overlay.firstElementChild ? overlay.firstElementChild.hasAttribute('data-thumb-checkbox') : false,
        lastIsMore: overlay.lastElementChild ? overlay.lastElementChild.hasAttribute('data-thumb-more') : false,
        leftDelta: r(ob.left - wb.left),
        rightDelta: r(wb.right - ob.right),
        bottomDelta: r(wb.bottom - ob.bottom),
      } : null,
      viewing: viewingEl ? {
        hasSvg: !!viewingEl.querySelector('svg'),
        text: (viewingEl.textContent || '').trim(),
        ariaLabel: viewingEl.getAttribute('aria-label'),
        title: viewingEl.getAttribute('title'),
      } : null,
    };
  }, PANEL);
}

test('TFL1422 SC1 uniform 7px inset in light/dark (+ frosted screenshots)', async () => {
  for (const theme of ['light', 'dark', 'frosted']) {
    await setTheme(win, theme);
    const m = await measureCard();
    console.log(`[TFL1422-SC1] ${theme} gaps=${JSON.stringify(m.gaps)} cardW=${m.cardWidth} wrapW=${m.wrapWidth} card=${m.hasThumbCard}`);
    expect(m.hasThumbCard, `${theme}: card carries .thumb-card`).toBe(true);
    for (const side of ['left', 'right', 'top', 'bottom']) {
      expect(Math.abs(m.gaps[side] - 7), `${theme}: ${side} border-to-preview gap ${m.gaps[side]}px ~= 7px`).toBeLessThanOrEqual(1);
    }
    await win.locator(PANEL).screenshot({ path: path.join(SHOTS, `TFL-1422-page-thumbnails-${theme}.png`) });
  }
});

test('TFL1422 SC2 overlay is preview-flush sibling; SC3 eye glyph; SC4 states', async () => {
  await setTheme(win, 'light');
  // page 2 selected while page 1 stays current, so both states coexist.
  await win.locator(`${PANEL} .thumb-item[data-page="2"] [data-thumb-checkbox]`).check();
  await win.waitForTimeout(400);
  const m = await measureCard();

  // SC2 — overlay bar.
  expect(m.overlay, 'overlay present').not.toBeNull();
  expect(m.overlay.insidePage, 'overlay is NOT inside .thumb-page').toBe(false);
  expect(m.overlay.siblingOfPage, 'overlay is a SIBLING of .thumb-page').toBe(true);
  expect(m.overlay.pageHasControl, '.thumb-page holds no interactive control').toBe(false);
  expect(m.overlay.firstIsCheckbox, 'checkbox is the overlay-left control').toBe(true);
  expect(m.overlay.lastIsMore, 'More is the overlay-right control').toBe(true);
  expect(Math.abs(m.overlay.bottomDelta), `overlay bottom flush to preview (${m.overlay.bottomDelta})`).toBeLessThanOrEqual(1);
  expect(Math.abs(m.overlay.leftDelta), `overlay left flush to preview (${m.overlay.leftDelta})`).toBeLessThanOrEqual(1);
  expect(Math.abs(m.overlay.rightDelta), `overlay right flush to preview (${m.overlay.rightDelta})`).toBeLessThanOrEqual(1);

  // SC3 — eye glyph replaces the "Viewing" text.
  expect(m.viewing, 'viewing indicator present on current card').not.toBeNull();
  expect(m.viewing.hasSvg, 'viewing renders an SVG (Eye)').toBe(true);
  expect(m.viewing.text, 'no "Viewing" text node remains').toBe('');
  expect(m.viewing.ariaLabel).toBe('Currently viewing');
  expect(m.viewing.title).toBe('Currently viewing');

  // SC4 — current neutral vs selected tinted (clear hover so no --bg-hover wash
  // contaminates the resting background read).
  await win.mouse.move(2, 2);
  await win.waitForTimeout(200);
  await expect(win.locator(`${PANEL} .thumb-item[data-page="1"]`)).toHaveClass(/thumb-current/);
  await expect(win.locator(`${PANEL} .thumb-item[data-page="1"]`)).not.toHaveClass(/thumb-selected/);
  await expect(win.locator(`${PANEL} .thumb-item[data-page="2"]`)).toHaveClass(/thumb-selected/);
  const bg = await win.evaluate((p) => ({
    cur: getComputedStyle(document.querySelector(`${p} .thumb-item[data-page="1"]`)).backgroundColor,
    sel: getComputedStyle(document.querySelector(`${p} .thumb-item[data-page="2"]`)).backgroundColor,
  }), PANEL);
  expect(bg.cur, 'current card paints no wash').toBe('rgba(0, 0, 0, 0)');
  expect(bg.sel, 'selected card paints the select tint').not.toBe('rgba(0, 0, 0, 0)');

  // SC4 — the preview button navigates.
  await win.locator(`${PANEL} .thumb-item[data-page="2"] .thumb-page`).click();
  await expect.poll(currentPage, { timeout: 8000 }).toBe(2);
});

test('TFL1422 SC4 checkbox toggles selection without navigating', async () => {
  expect(await currentPage()).toBe(1);
  await win.locator(`${PANEL} .thumb-item[data-page="2"] [data-thumb-checkbox]`).check();
  await win.waitForTimeout(400);
  expect(await currentPage(), 'checking page 2 does not navigate').toBe(1);
  await expect(win.locator('[data-context-panel-selection-count]')).toContainText('1 selected');
  await win.locator(`${PANEL} .thumb-item[data-page="2"] [data-thumb-checkbox]`).uncheck();
  await win.waitForTimeout(400);
  expect(await currentPage(), 'unchecking does not navigate').toBe(1);
});
