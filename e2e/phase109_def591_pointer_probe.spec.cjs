// TFL-933 (Phase 109 / Viewing Controls) - independent, rendered probe for
// DEF-588 (<=419px More reveal) and DEF-591 (More trigger pointer-reachable).
// Unlike the P109-14 retest, this probe settles the menu before hit-testing so
// a mid-animation measurement cannot masquerade as a product failure.
// Launches only through the canonical e2e/lib/launch.cjs launchApp helper.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const OUT = path.resolve(__dirname, '..', 'test-fixtures', 'phase109-qa');
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

let app = null;
let win = null;
test.setTimeout(420000);

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(250);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'p109-def591-probe');
  app = null;
  win = null;
});

test('P109-PROBE DEF-588/DEF-591: <=419px More trigger is pointer-reachable and its menu rows are hit-testable', async () => {
  await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);

  await app.evaluate(({ BrowserWindow }) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (bw) { try { bw.unmaximize(); } catch (_) { /* already normal */ } bw.setSize(640, 480); }
  });
  await win.waitForFunction((want) => Math.abs(window.innerWidth - want) <= 40, 640, { timeout: 8000 }).catch(() => {});
  await win.waitForTimeout(600);
  await app.evaluate(({ BrowserWindow }) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (bw) bw.webContents.setZoomFactor(1.5);
  });
  await win.waitForTimeout(900);

  const tier = await win.evaluate(() => {
    const strip = document.querySelector('[data-view-strip]');
    const toggle = document.querySelector('[data-view-strip-more-toggle]');
    const cs = (sel) => { const el = document.querySelector(sel); return el === null ? 'missing' : getComputedStyle(el).display; };
    const sr = strip.getBoundingClientRect();
    const tr = toggle.getBoundingClientRect();
    const x = Math.round(tr.left + tr.width / 2);
    const y = Math.round(tr.top + tr.height / 2);
    const top = document.elementFromPoint(x, y);
    return {
      inlineSize: Math.round(sr.width),
      stripRight: Math.round(sr.right),
      toggleRight: Math.round(tr.right),
      toggleBox: [Math.round(tr.x), Math.round(tr.y), Math.round(tr.width), Math.round(tr.height)],
      stripBox: [Math.round(sr.x), Math.round(sr.y), Math.round(sr.width), Math.round(sr.height)],
      hitIsToggle: top === toggle || toggle.contains(top),
      topElement: top ? `${top.tagName.toLowerCase()}.${String(top.className).slice(0, 60)}` : null,
      more: cs('.view-strip-more'), layout: cs('.view-strip-layout'), book: cs('.view-strip-book'),
    };
  });
  console.log(`[PROBE] tier=${JSON.stringify(tier)}`);
  fs.writeFileSync(path.join(OUT, 'tfl933_probe_tier.json'), JSON.stringify(tier, null, 2));

  expect(tier.inlineSize, 'footer inline-size <= 419px at 640x480@150%').toBeLessThanOrEqual(419);
  expect(tier.layout, 'overflow tier hides the inline layout group').toBe('none');
  expect(tier.book, 'overflow tier hides the inline Book View entry').toBe('none');
  expect(tier.more, 'overflow tier reveals the More host').not.toBe('none');
  expect(tier.stripRight, 'the trigger sits INSIDE the footer (strip right >= toggle right)').toBeGreaterThanOrEqual(tier.toggleRight);
  expect(tier.hitIsToggle, `elementFromPoint at the trigger centre resolves to the trigger, not the inspector (top=${tier.topElement})`).toBe(true);

  // A REAL, un-forced pointer click must open the menu.
  const toggle = win.locator('[data-view-strip-more-toggle]').first();
  await toggle.click({ timeout: 8000 });
  await win.waitForSelector('[data-view-strip-more-menu]', { state: 'visible', timeout: 8000 });
  await win.waitForTimeout(700); // let any open animation/positioning settle

  const rows = await win.evaluate(() => {
    const hit = (el) => {
      const r = el.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2);
      const y = Math.round(r.top + r.height / 2);
      const t = document.elementFromPoint(x, y);
      return {
        w: Math.round(r.width), h: Math.round(r.height),
        hit: t === el || el.contains(t),
        top: t ? `${t.tagName.toLowerCase()}.${String(t.className).slice(0, 50)}` : null,
      };
    };
    const opts = [...document.querySelectorAll('[data-view-strip-more-menu] [data-page-layout-option]')]
      .map((o) => ({ mode: o.getAttribute('data-page-layout-option'), ...hit(o) }));
    const bookEl = document.querySelector('[data-view-strip-more-menu] [data-book-view-open]');
    return { pointerOpened: !!document.querySelector('[data-view-strip-more-menu]'), options: opts, book: bookEl ? hit(bookEl) : null };
  });
  console.log(`[PROBE] pointerRows=${JSON.stringify(rows)}`);
  fs.writeFileSync(path.join(OUT, 'tfl933_probe_pointer_rows.json'), JSON.stringify(rows, null, 2));

  await win.screenshot({ path: path.join(SHOTS, 'phase109-qa-def591-pointer-open-640x480.png') });

  expect(rows.pointerOpened, 'a real pointer click opens the More menu').toBe(true);
  expect(rows.options.map((o) => o.mode).sort(), 'the menu exposes one/two/four').toEqual(['four', 'one', 'two']);
  for (const o of rows.options) {
    expect(o.w > 0 && o.h > 0, `layout option ${o.mode} has a non-zero box`).toBe(true);
    expect(o.hit, `layout option ${o.mode} is pointer-hit-testable (top=${o.top})`).toBe(true);
  }
  expect(rows.book, 'the Book View entry is present').not.toBeNull();
  expect(rows.book.hit, `Book View is pointer-hit-testable (top=${rows.book && rows.book.top})`).toBe(true);

  // Keyboard remains an independent route.
  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);
  await toggle.focus();
  await win.keyboard.press('Enter');
  await win.waitForSelector('[data-view-strip-more-menu]', { state: 'visible', timeout: 8000 });
  await win.waitForTimeout(400);
  const kbFocus = await win.evaluate(() => {
    const el = document.activeElement;
    return el ? { role: el.getAttribute('role'), label: el.getAttribute('aria-label') } : null;
  });
  console.log(`[PROBE] keyboardFocusOnOpen=${JSON.stringify(kbFocus)}`);
  expect(kbFocus && kbFocus.role, 'keyboard focus reaches a menu row').toBe('menuitem');
});