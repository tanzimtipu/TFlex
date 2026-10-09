// TFL-1073 — Phase 111 (Document Navigator) FOCUSED QA spec.
//
// The phase retired the old navigator hooks on purpose:
//   - `[data-outline-toggle]` / `data-outline-open` (chunk A: the Outline is a
//     full-height VIEW selected by `[data-context-panel-view-tab]`, not a
//     collapsible section);
//   - `[data-thumb-verbs]` / `[data-thumb-verb]` (chunk B: the over-preview
//     hover verbs were replaced by the card footer's 32px `[data-thumb-more]`);
//   - `[data-context-panel-combine]` in the header (chunk B moved Combine and
//     Remove blank pages into the labelled `[data-context-panel-more]` menu,
//     which Phase 124 retired for direct header icon buttons).
//
// The legacy specs in the focused e2e set still click those retired hooks, so
// this spec replaces their coverage for the NEW controls (brief: "add a small
// focused spec for the new controls instead of deleting coverage").
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { PDFDocument, PDFName, PDFString, PDFNumber } = require('@cantoo/pdf-lib');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, openSamplePath } = require('./lib/helpers.cjs');

delete process.env.ELECTRON_RUN_AS_NODE;

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
const TMP = path.join(os.tmpdir(), 'tfl1073-navigator');
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });
const OUTLINE_FIXTURE = path.join(TMP, 'tfl1073-outline.pdf');
const PANEL = '[data-context-panel="pages"]';

let app = null;
let win = null;
test.setTimeout(300000);

async function buildOutlinePdf(file) {
  const doc = await PDFDocument.create();
  const pages = [];
  for (let i = 0; i < 3; i += 1) pages.push(doc.addPage([612, 792]));
  const ctx = doc.context;
  const root = ctx.obj({ Type: 'Outlines' });
  const rootRef = ctx.register(root);
  const specs = [
    { title: 'Chapter One', page: 1 },
    { title: 'Chapter Two', page: 2 },
    { title: 'Chapter Three', page: 3 },
  ];
  let firstRef = null;
  let prevRef = null;
  let lastRef = null;
  for (const spec of specs) {
    const item = ctx.obj({ Title: PDFString.of(spec.title), Parent: rootRef });
    const itemRef = ctx.register(item);
    item.set(PDFName.of('Dest'), ctx.obj([pages[spec.page - 1].ref, 'Fit']));
    if (firstRef === null) firstRef = itemRef;
    if (prevRef !== null) {
      ctx.lookup(prevRef).set(PDFName.of('Next'), itemRef);
      item.set(PDFName.of('Prev'), prevRef);
    }
    prevRef = itemRef;
    lastRef = itemRef;
  }
  root.set(PDFName.of('First'), firstRef);
  root.set(PDFName.of('Last'), lastRef);
  root.set(PDFName.of('Count'), PDFNumber.of(specs.length));
  doc.catalog.set(PDFName.of('Outlines'), rootRef);
  fs.writeFileSync(file, await doc.save());
  return file;
}

test.beforeAll(async () => {
  await buildOutlinePdf(OUTLINE_FIXTURE);
});

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl1073-navigator');
  app = null;
  win = null;
});

async function openFixture(filePath) {
  // Phase 118 contract: the generic Open enqueues into Intake; the shared helper
  // stubs the native picker, clicks the real Open control and finishes the
  // Intake dispatch. The old stub+[data-toolbar-open]+wait-.workspace pattern
  // predates Intake and no longer opens a document.
  await openSamplePath(win, app, filePath);
  await win.waitForSelector(`${PANEL} .thumb-item`, { timeout: 30000 });
  await win.waitForTimeout(1500);
}

async function setTheme(theme) {
  await win.click('[data-stage-rail-gear]');
  await win.waitForSelector('[data-prefs-dialog]', { timeout: 10000 });
  await win.selectOption('[data-prefs-theme-default]', theme);
  await win.waitForFunction(
    (w) => document.documentElement.getAttribute('data-theme') === w,
    theme,
    { timeout: 10000 },
  );
  await win.click('button[aria-label="Close preferences"]');
  await win.waitForSelector('[data-prefs-dialog]', { state: 'detached', timeout: 10000 });
  await win.waitForTimeout(500);
}

async function engine() {
  return win.evaluate(() => {
    const d = window.tflexDiagnostics();
    return { pageCount: d.pageCount, currentPage: d.currentPage };
  });
}

async function shot(name) {
  const file = path.join(SHOTS, `${name}.png`);
  await win.screenshot({ path: file });
  return file;
}

// --- TF1073-A: navigator view selector (chunk A) ---------------------------

test('TF1073-A view selector shows real counts and switches the full-height views', async () => {
  await openFixture(OUTLINE_FIXTURE);
  await expect(win.locator('[data-context-panel-view-tabs]')).toHaveCount(1);
  const pagesTab = win.locator('[data-context-panel-view-tab="pages"]');
  const outlineTab = win.locator('[data-context-panel-view-tab="outline"]');
  const eng = await engine();
  await expect(pagesTab).toHaveText(new RegExp(`Pages\\s*\u00B7\\s*${eng.pageCount}`));
  await expect(outlineTab).toHaveText(/Outline\s*\u00B7\s*3/);

  await expect(win.locator('[data-context-panel-view="pages"]')).toHaveCount(1);
  await expect(win.locator('[data-context-panel-view="outline"]')).toHaveCount(0);

  await outlineTab.click();
  await expect(win.locator('[data-context-panel-view="outline"]')).toHaveCount(1);
  await expect(win.locator('[data-context-panel-view="pages"]')).toHaveCount(0);
  await expect(win.locator('[data-outline-row]')).toHaveCount(3);
  await expect(win.locator('[data-outline-more]')).toHaveCount(3);
  await expect(win.locator('[data-outline-page]')).toHaveCount(3);
  await expect(win.locator('[data-outline-add]')).toHaveCount(1);

  await pagesTab.click();
  await expect(win.locator('[data-context-panel-view="pages"]')).toHaveCount(1);
});

// --- TF1073-B: page-card footer + More menus (chunk B) ---------------------

test('TF1073-B card checkbox never navigates; card and panel More menus are real', async () => {
  await openFixture(OUTLINE_FIXTURE);
  const eng0 = await engine();
  await expect(win.locator('[data-thumb-checkbox]')).toHaveCount(eng0.pageCount);
  await expect(win.locator('[data-thumb-more]')).toHaveCount(eng0.pageCount);
  await expect(win.locator('.thumb-item[data-page="1"] [data-thumb-current-marker]')).toHaveCount(1);
  await expect(win.locator('.thumb-item[data-page="1"] [data-thumb-viewing]')).toHaveCount(1);

  // The current page must be DISTINCT from the selected set (ruling 4): page 1
  // is current, nothing is selected, so its card must not carry the selected
  // tint and its checkbox must be unchecked.
  await expect(win.locator('[data-context-panel-selection]')).toHaveCount(0);
  await expect(win.locator('.thumb-item[data-page="1"]')).not.toHaveClass(/thumb-selected/);
  expect(await win.locator('.thumb-item[data-page="1"] [data-thumb-checkbox]').isChecked()).toBe(false);

  await win.locator('.thumb-item[data-page="2"] [data-thumb-checkbox]').check();
  await expect(win.locator('[data-context-panel-selection]')).toHaveCount(1);
  await expect(win.locator('[data-context-panel-selection-count]')).toContainText('1 selected');
  await expect(win.locator('[data-context-panel-selection-live]')).toHaveText('1 selected');
  expect((await engine()).currentPage).toBe(eng0.currentPage);

  await win.locator('[data-context-panel-selection-clear]').click();
  await expect(win.locator('[data-context-panel-selection]')).toHaveCount(0);
  expect((await engine()).currentPage).toBe(eng0.currentPage);

  await win.locator('[data-thumb-more]').first().click();
  const cardMenu = win.locator('[data-page-menu="card"]');
  await expect(cardMenu).toHaveCount(1);
  await expect(cardMenu).toContainText('Rotate CW');
  await expect(cardMenu).toContainText('Extract this page');
  await expect(cardMenu).toContainText('Delete this page');
  await win.keyboard.press('Escape');
  await expect(cardMenu).toHaveCount(0);

  // Phase 124 — the header More menu is retired; the three tools are direct
  // icon buttons in the panel header.
  await expect(win.locator('[data-context-panel-more]')).toHaveCount(0);
  await expect(win.locator('[data-context-panel-more-menu]')).toHaveCount(0);
  const panelHeader = win.locator('[data-context-panel="pages"]');
  await expect(panelHeader.locator('[data-context-panel-layout-split]')).toHaveCount(1);
  await expect(panelHeader.locator('[data-context-panel-combine]')).toHaveCount(1);
  await expect(panelHeader.locator('[data-blank-scan-open]')).toHaveCount(1);
});

// --- TF1073-C: outline rows + More menu (chunk C) --------------------------

test('TF1073-C outline rows keep metrics, row More menu and header Add', async () => {
  await openFixture(OUTLINE_FIXTURE);
  await win.locator('[data-context-panel-view-tab="outline"]').click();
  await expect(win.locator('[data-outline-row]')).toHaveCount(3);
  // Let the view's entrance motion (a brief scale) settle before measuring.
  await win.waitForTimeout(600);

  const h = await win.locator('[data-outline-row]').first().evaluate((el) => el.getBoundingClientRect().height);
  expect(h).toBeGreaterThanOrEqual(43);
  expect(h).toBeLessThanOrEqual(53);
  const w = await win.locator('[data-outline-page]').first().evaluate((el) => el.getBoundingClientRect().width);
  expect(Math.round(w)).toBe(32);

  await win.locator('[data-outline-more]').first().click();
  const menu = win.locator('[data-outline-menu="true"]');
  await expect(menu).toHaveCount(1);
  for (const sel of [
    '[data-outline-rename]',
    '[data-outline-retarget-open]',
    '[data-outline-add]',
    '[data-outline-indent]',
    '[data-outline-outdent]',
    '[data-outline-delete]',
  ]) {
    await expect(menu.locator(sel)).toHaveCount(1);
  }
  await win.keyboard.press('Escape');
});

// --- TF1073-D: Split Navigator (chunk D1) ----------------------------------

test('TF1073-D split layout mounts both views with a keyboard-resizable divider', async () => {
  await openFixture(OUTLINE_FIXTURE);
  await win.locator('[data-context-panel-layout-split]').click();

  const divider = win.locator('[data-context-panel-split-divider]');
  await expect(divider).toHaveCount(1);
  await expect(divider).toHaveAttribute('role', 'separator');
  await expect(divider).toHaveAttribute('aria-orientation', 'horizontal');
  await expect(win.locator('[data-context-panel-view="pages"]')).toHaveCount(1);
  await expect(win.locator('[data-context-panel-view="outline"]')).toHaveCount(1);

  const before = await win.locator('[data-context-panel-split-section="pages"]').evaluate((el) => el.getBoundingClientRect().height);
  await divider.focus();
  await win.keyboard.press('ArrowUp');
  await win.waitForTimeout(400);
  const after = await win.locator('[data-context-panel-split-section="pages"]').evaluate((el) => el.getBoundingClientRect().height);
  expect(after).toBeGreaterThan(before);
  expect(Number(await divider.getAttribute('aria-valuenow'))).toBeGreaterThan(60);
});

// --- TF1073-E: visual verdict screenshots ----------------------------------

test('TF1073-E captures the navigator in light/dark/narrow/split', async () => {
  await openFixture(OUTLINE_FIXTURE);

  await setTheme('light');
  await shot('tfl1073-pages-light');
  await setTheme('dark');
  await shot('tfl1073-pages-dark');

  const leftHandle = win.locator('[data-panel-resize="left"]');
  await leftHandle.focus();
  await win.keyboard.press('Home');
  await win.waitForTimeout(400);
  await shot('tfl1073-pages-narrow-dark');

  await win.locator('[data-context-panel-view-tab="outline"]').click();
  await setTheme('light');
  await shot('tfl1073-outline-light');
  await setTheme('dark');
  await shot('tfl1073-outline-dark');

  await win.locator('[data-context-panel-layout-split]').click();
  await expect(win.locator('[data-context-panel-split-divider]')).toHaveCount(1);
  await setTheme('light');
  await shot('tfl1073-split-light');
  await setTheme('dark');
  await shot('tfl1073-split-dark');
});

// --- TF1073-F: navigator contrast ratios (measurement) ---------------------

test('TF1073-F navigator light/dark contrast ratios', async () => {
  await openFixture(OUTLINE_FIXTURE);
  const measure = async () => win.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    const toRgba = (c) => {
      const s = c.trim();
      if (s.startsWith('#')) {
        let h = s.slice(1);
        if (h.length === 3) h = h.split('').map((x) => x + x).join('');
        const r = parseInt(h.slice(0, 2), 16);
        const g = parseInt(h.slice(2, 4), 16);
        const b = parseInt(h.slice(4, 6), 16);
        const a = h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
        return [r, g, b, a];
      }
      const m = s.match(/[\d.]+/g);
      if (!m) return null;
      return [Number(m[0]), Number(m[1]), Number(m[2]), m[3] === undefined ? 1 : Number(m[3])];
    };
    const over = (fg, bg) => {
      const a = fg[3];
      return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a), 1];
    };
    const lum = (c) => {
      const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
      const f = (x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a, b) => {
      const ra = toRgba(a); const rb = toRgba(b);
      if (ra === null || rb === null) return null;
      const la = lum(ra); const lb = lum(rb);
      const hi = Math.max(la, lb); const lo = Math.min(la, lb);
      return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
    };
    const bgRail = toRgba(v('--bg-rail'));
    const selFill = over(toRgba(v('--select-fill')), bgRail);
    return {
      body: ratio(v('--fg-strong'), v('--bg-rail')),
      helper: ratio(v('--fg-muted'), v('--bg-rail')),
      selected: (() => {
        const g = toRgba(v('--select-glyph'));
        const hi = Math.max(g ? lum(g) : 0, lum(selFill)); const lo = Math.min(g ? lum(g) : 0, lum(selFill));
        return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
      })(),
      raw: { fgStrong: v('--fg-strong'), fgMuted: v('--fg-muted'), bgRail: v('--bg-rail'), selectFill: v('--select-fill'), selectGlyph: v('--select-glyph') },
    };
  });
  await setTheme('light');
  const light = await measure();
  console.log('[TF1073-F] light ' + JSON.stringify(light));
  await setTheme('dark');
  const dark = await measure();
  console.log('[TF1073-F] dark ' + JSON.stringify(dark));
  expect(light.body).not.toBeNull();
  expect(dark.body).not.toBeNull();
});

// --- TF1073-G: implemented navigator element contrast ----------------------

test('TF1073-G measures the implemented navigator element contrast', async () => {
  await openFixture(OUTLINE_FIXTURE);
  const measure = () => win.evaluate(() => {
    const toRgba = (c) => {
      const s = (c || '').trim();
      if (s.startsWith('#')) {
        let h = s.slice(1);
        if (h.length === 3) h = h.split('').map((x) => x + x).join('');
        return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length >= 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
      }
      const m = s.match(/[\d.]+/g);
      if (!m) return null;
      return [Number(m[0]), Number(m[1]), Number(m[2]), m[3] === undefined ? 1 : Number(m[3])];
    };
    const over = (fg, bg) => [fg[0] * fg[3] + bg[0] * (1 - fg[3]), fg[1] * fg[3] + bg[1] * (1 - fg[3]), fg[2] * fg[3] + bg[2] * (1 - fg[3]), 1];
    const lum = (c) => {
      const f = (x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
      return 0.2126 * f(c[0] / 255) + 0.7152 * f(c[1] / 255) + 0.0722 * f(c[2] / 255);
    };
    const ratio = (a, b) => {
      if (!a || !b) return null;
      const hi = Math.max(lum(a), lum(b)); const lo = Math.min(lum(a), lum(b));
      return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
    };
    const effBg = (el) => {
      let n = el;
      while (n) {
        const c = toRgba(getComputedStyle(n).backgroundColor);
        if (c && c[3] > 0.01) return c;
        n = n.parentElement;
      }
      return [255, 255, 255, 1];
    };
    const q = (sel) => document.querySelector(sel);
    const cs = (sel) => (q(sel) ? getComputedStyle(q(sel)) : null);
    const link = cs('[data-outline-row] .outline-link');
    const page = cs('[data-outline-page]');
    const selCard = q('.thumb-selected');
    const selLabel = cs('.thumb-selected .thumb-label');
    return {
      body: link ? ratio(toRgba(link.color), effBg(q('[data-outline-row] .outline-link'))) : null,
      helper: page ? ratio(toRgba(page.color), effBg(q('[data-outline-page]'))) : null,
      selected: selCard ? ratio(toRgba(selLabel.color), over(toRgba(getComputedStyle(selCard).backgroundColor), effBg(selCard.parentElement))) : null,
    };
  });

  await setTheme('light');
  await win.locator('[data-context-panel-view-tab="outline"]').click();
  await expect(win.locator('[data-outline-row]')).toHaveCount(3);
  await win.waitForTimeout(500);
  const lightBody = await measure();
  await win.locator('[data-context-panel-view-tab="pages"]').click();
  await win.locator('.thumb-item[data-page="2"] [data-thumb-checkbox]').check();
  await win.waitForTimeout(300);
  const lightSel = await measure();
  console.log('[TF1073-G] light body/helper ' + JSON.stringify(lightBody) + ' selected ' + JSON.stringify(lightSel.selected));

  await setTheme('dark');
  await win.locator('[data-context-panel-view-tab="outline"]').click();
  await win.waitForTimeout(500);
  const darkBody = await measure();
  await win.locator('[data-context-panel-view-tab="pages"]').click();
  await win.waitForTimeout(300);
  const darkSel = await measure();
  console.log('[TF1073-G] dark body/helper ' + JSON.stringify(darkBody) + ' selected ' + JSON.stringify(darkSel.selected));

  expect(lightBody.body).not.toBeNull();
  expect(darkBody.body).not.toBeNull();
});
