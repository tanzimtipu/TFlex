// TFL-1569 focused verification (qa) - top-bar Find icon toggle (A) and
// search/replace input alignment (B).
//
// HARNESS: canonical launchApp (e2e/lib/launch.cjs) + the current native-open
// helper (openSamplePath) for the sample document, and a self-built text
// fixture for the Find/Replace no-regression pass (so the assertions never
// depend on the sample's text layer).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { PDFDocument, StandardFonts, rgb } = require('@cantoo/pdf-lib');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { openSamplePath, hardClose } = require('./lib/helpers.cjs');

// The Paperclip/kimi runtime exports ELECTRON_RUN_AS_NODE=1 for its own Node
// shim; launchApp spreads process.env, so Electron would exit immediately.
delete process.env.ELECTRON_RUN_AS_NODE;

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
const TMP = path.join(os.tmpdir(), 'tfl1569');
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });
const shot = (n) => path.join(SHOTS, n);
const FIXTURE = path.join(TMP, 'tfl1569-find.pdf');

const FIND = '[data-header-find]';
const BAR = '.search-bar';

async function buildFixture() {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([612, 792]);
  p1.drawText('SECRET', { x: 72, y: 700, size: 24, font, color: rgb(0, 0, 0) });
  p1.drawText('SECRET', { x: 72, y: 620, size: 24, font, color: rgb(0, 0, 0) });
  fs.writeFileSync(FIXTURE, await doc.save());
}

let app = null;
let win = null;

test.beforeAll(async () => {
  await buildFixture();
});

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl1569');
  app = null;
  win = null;
});

test.setTimeout(180000);

const findPressed = () => win.locator(FIND).getAttribute('aria-pressed');
const activeAria = () =>
  win.evaluate(() => (document.activeElement && document.activeElement.getAttribute('aria-label')) || null);

async function openSampleDoc() {
  await openSamplePath(win, app, getSamplePath('report.pdf'));
  await expect(win.locator(FIND)).toBeVisible({ timeout: 10000 });
}

async function openFixtureDoc() {
  await openSamplePath(win, app, FIXTURE);
  await expect(win.locator(FIND)).toBeVisible({ timeout: 10000 });
}

// ---------------------------------------------------------------------------
// A - the top-bar Find icon toggles the Find & Replace bar; aria-pressed
// tracks the live open state; the search field is focused on open; the toggle
// is a real keyboard-reachable button.
// ---------------------------------------------------------------------------
test('TFL1569-A: Find icon toggles the bar, aria-pressed tracks state, field focused, keyboard reachable', async () => {
  await openSampleDoc();

  // Closed initially: no bar, aria-pressed="false".
  await expect(win.locator(BAR)).toHaveCount(0);
  expect(await findPressed()).toBe('false');

  // The toggle is a real, keyboard-reachable button with an accessible name.
  expect(await win.locator(FIND).evaluate((el) => el.tagName)).toBe('BUTTON');
  expect(await win.locator(FIND).getAttribute('aria-label')).toBeTruthy();
  await win.locator(FIND).focus();
  expect(await win.evaluate(() => document.activeElement === document.querySelector('[data-header-find]'))).toBe(true);

  // Real click opens the bar; the icon reflects open via aria-pressed="true"
  // and the search field takes focus.
  await win.locator(FIND).click();
  await win.waitForSelector(BAR, { timeout: 8000 });
  await expect.poll(findPressed).toBe('true');
  await expect.poll(activeAria).toBe('Search query');
  await win.screenshot({ path: shot('tfl1569_find_toggle.png') });

  // Real click closes it; aria-pressed returns to "false".
  await win.locator(FIND).click();
  await win.waitForSelector(BAR, { state: 'detached', timeout: 8000 });
  await expect.poll(findPressed).toBe('false');

  // Keyboard activation (Enter on the focused button) opens it again.
  await win.locator(FIND).focus();
  await win.keyboard.press('Enter');
  await win.waitForSelector(BAR, { timeout: 8000 });
  await expect.poll(findPressed).toBe('true');
  await win.locator(FIND).click();
  await win.waitForSelector(BAR, { state: 'detached', timeout: 8000 });
});

// ---------------------------------------------------------------------------
// B - with the replace row open, both `.search-input` boxes share the same
// height and the same left/right edges (pixel-consistent), and the row is
// driven by the promoted `.search-replace-row` flex rule (no inline styles).
// ---------------------------------------------------------------------------
test('TFL1569-B: search and replace inputs are pixel-consistent (height, left/right edges)', async () => {
  await openSampleDoc();
  await win.locator(FIND).click();
  await win.waitForSelector(BAR, { timeout: 8000 });
  await win.locator('[data-search-replace-toggle]').click();
  await win.waitForSelector('[data-search-replace-input]', { timeout: 8000 });

  const boxes = await win.evaluate(() => {
    const rows = [...document.querySelectorAll('.search-bar .search-input')];
    return rows.map((el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return {
        hasClass: el.classList.contains('search-input'),
        height: r.height,
        left: r.left,
        right: r.right,
        width: r.width,
        cssHeight: cs.height,
        inlineStyle: el.getAttribute('style'),
      };
    });
  });
  expect(boxes.length).toBe(2);
  const [findBox, replaceBox] = boxes;
  expect(findBox.hasClass && replaceBox.hasClass).toBe(true);
  expect(Math.abs(findBox.height - replaceBox.height)).toBeLessThanOrEqual(1);
  expect(Math.abs(findBox.left - replaceBox.left)).toBeLessThanOrEqual(1);
  expect(Math.abs(findBox.right - replaceBox.right)).toBeLessThanOrEqual(1);
  expect(Math.abs(findBox.width - replaceBox.width)).toBeLessThanOrEqual(1);
  expect(findBox.inlineStyle).toBeNull();
  expect(replaceBox.inlineStyle).toBeNull();

  // The replace row is the promoted CSS flex rule (SearchBar.tsx inline styles
  // were removed).
  const row = win.locator('.search-replace-row');
  expect(await row.count()).toBe(1);
  expect(await row.evaluate((el) => getComputedStyle(el).display)).toBe('flex');
  expect(await row.evaluate((el) => getComputedStyle(el).flexBasis)).toBe('100%');
  await win.screenshot({ path: shot('tfl1569_replace_aligned.png') });
});

// ---------------------------------------------------------------------------
// No-regression pass (parent success criteria) - typing searches, prev/next
// navigation, the "No results" state, replace-one, and the close (X) button.
// Driven on the self-built two-hit fixture so it never depends on a sample's
// text layer.
// ---------------------------------------------------------------------------
test('TFL1569-REGRESSION: typing, nav, No results, replace-one and X close still work', async () => {
  await openFixtureDoc();
  await win.locator(FIND).click();
  await win.waitForSelector(BAR, { timeout: 8000 });
  const status = win.locator('.search-status').first();

  // Typing searches; status + highlight follow.
  await win.locator('[aria-label="Search query"]').fill('SECRET');
  await win.waitForFunction(() => window.tflexDiagnostics().searchHits === 2, undefined, { timeout: 30000 });
  await expect(status).toContainText('1 of 2');
  expect(await win.locator('.search-hit').count()).toBeGreaterThan(0);

  // Enter advances to the next hit.
  await win.keyboard.press('Enter');
  await win.waitForTimeout(500);
  await expect(status).toContainText('2 of 2');

  // Replace-one works through the real control.
  await win.locator('[data-search-replace-toggle]').click();
  await win.waitForSelector('[data-search-replace-input]', { timeout: 8000 });
  await win.locator('[data-search-replace-input]').fill('PUBLIC');
  await win.locator('[data-search-replace-one]').click();
  await win.waitForFunction(
    () => {
      const el = document.querySelector('[data-search-replace-report]');
      return el !== null && /1 replaced/.test(el.textContent || '');
    },
    undefined,
    { timeout: 30000 },
  );

  // "No results" state for a term that cannot match.
  await win.locator('[aria-label="Search query"]').fill('zzzzqqq');
  await expect(status).toContainText('No results', { timeout: 30000 });

  // Close (X) button dismisses the bar.
  await win.locator('[aria-label="Close search"]').click();
  await win.waitForSelector(BAR, { state: 'detached', timeout: 8000 });
  await expect.poll(findPressed).toBe('false');
});
