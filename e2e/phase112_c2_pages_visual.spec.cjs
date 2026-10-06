// Phase 112 (TFL-854, chunk C2) focused verification — the Pages Context Pair
// on the shared panel primitives. Launches ONLY through the canonical
// launchApp helper. Proves, in the REAL app:
//   * item 5 — the preferred 52px header does not clip or shift the Pages
//     panel content (body stays inside the panel, thumbs start below the
//     header, the outline stays inside its bounded section, no overlap);
//   * item 2 — a real multi-select renders the shared PanelSection summary;
//   * item 3/4 — the Inspector header names the scope and the Size row shows
//     a REAL dimension for a normally-opened document (never "0", never A4).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const PANEL = '[data-context-panel="pages"]';

let app = null;
let win = null;
test.setTimeout(300000);

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'p112c2-pages-visual');
  app = null;
  win = null;
});

async function openDoc(name) {
  await win.locator('.sample-card').filter({ hasText: name }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector(`${PANEL} .thumb-item`, { timeout: 30000 });
  await win.waitForTimeout(1500);
}

test('P112C2-1 the 52px header does not clip or shift Pages panel content', async () => {
  await openDoc('report.pdf');

  const m = await win.evaluate((panel) => {
    const rr = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { y: Math.round(b.y), h: Math.round(b.height), bottom: Math.round(b.bottom), w: Math.round(b.width) };
    };
    const root = document.querySelector(panel);
    const header = root.querySelector('[data-tf-panel-header]');
    const body = root.querySelector('.glass-sidebar-body');
    const thumbs = root.querySelector('.context-panel-thumbs');
    const firstThumb = root.querySelector('.thumb-item[data-page="1"]');
    const outline = root.querySelector('.context-panel-outline');
    const outlineBody = root.querySelector('.context-panel-outline-body');
    const links = [...root.querySelectorAll('.outline-link')].map(rr);
    const bodyR = rr(outlineBody);
    return {
      panelRoot: rr(root),
      header: rr(header),
      headerPref: header ? header.getAttribute('data-tf-panel-header') : null,
      body: rr(body),
      thumbs: rr(thumbs),
      firstThumb: rr(firstThumb),
      outline: rr(outline),
      outlineBody: bodyR,
      linkCount: links.length,
      linksInsideOutline: bodyR ? links.every((l) => l.y >= bodyR.y - 1 && l.bottom <= bodyR.bottom + 1) : null,
      outlineOverlapsThumbs: links.length && rr(thumbs) ? links.some((l) => l.y < rr(thumbs).bottom && l.bottom > rr(thumbs).y) : false,
    };
  }, PANEL);

  console.log(`[P112C2] geometry: ${JSON.stringify(m)}`);

  // The preferred header is the 52px token, not the 44px legacy default.
  expect(m.headerPref, 'the Pages header opts into the preferred height').toBe('preferred');
  expect(m.header.h, 'the preferred header is the 52px token').toBeGreaterThanOrEqual(52);
  expect(m.header.h, 'the preferred header is not overstated').toBeLessThanOrEqual(56);
  // No clipping: the body sits below the header and inside the panel root.
  expect(m.body.y, 'the body starts at/under the header').toBeGreaterThanOrEqual(m.header.bottom - 1);
  expect(m.body.bottom, 'the body does not spill past the panel bottom').toBeLessThanOrEqual(m.panelRoot.bottom + 1);
  // No shift/clip of content: the first thumb starts below the body top (not
  // under the header) and the outline stays inside its bounded section.
  expect(m.firstThumb.y, 'the first thumb is below the header').toBeGreaterThanOrEqual(m.header.bottom - 1);
  expect(m.linkCount, 'report.pdf renders outline links').toBeGreaterThan(0);
  expect(m.linksInsideOutline, 'the outline tree stays inside its section (DEF-310)').toBe(true);
  expect(m.outlineOverlapsThumbs, 'the outline never overlaps the thumbnail stack').toBe(false);

  await win.screenshot({ path: path.join(SHOTS, 'phase112-c2-pages-panel.png') });
  console.log(`[P112C2] screenshot: ${path.join(SHOTS, 'phase112-c2-pages-panel.png')}`);
});

test('P112C2-2 real multi-select renders the shared summary and the inspector scope/real Size', async () => {
  await openDoc('report.pdf');

  // Single-page default: the Inspector names the page and shows the REAL Size
  // (TFL-966) without the Crop dialog ever opening.
  const singleScope = await win.locator('[data-inspector] .glass-sidebar-title').textContent();
  const singleSize = await win.locator('[data-inspector] [data-inspector-row="size"]').textContent();
  console.log(`[P112C2] single scope="${singleScope}" size="${singleSize}"`);
  expect(singleScope).toMatch(/Page \d+/);
  expect(singleSize).toMatch(/\d+ x \d+ pt/);
  expect(singleSize, 'unknown is never a bare 0').not.toMatch(/(^|\D)0(\D|$)/);

  // Multi-select: plain click page 2, Ctrl extends to page 3.
  await win.locator(`${PANEL} .thumb-item[data-page="2"]`).click();
  await win.waitForTimeout(1200);
  await win.locator(`${PANEL} .thumb-item[data-page="3"]`).click({ modifiers: ['Control'] });
  await win.waitForTimeout(600);

  const sel = win.locator('[data-context-panel-selection]');
  await expect(sel).toHaveCount(1);
  await expect(sel).toHaveClass(/tf-panel-section/);
  const selText = await sel.innerText();
  console.log(`[P112C2] selection summary: ${JSON.stringify(selText)}`);
  expect(selText).toContain('2 selected');

  await expect.poll(async () => win.locator('[data-inspector] .glass-sidebar-title').textContent(), { timeout: 10000 })
    .toBe('Inspector \u00b7 2 pages selected');

  await win.screenshot({ path: path.join(SHOTS, 'phase112-c2-pages-multiselect.png') });
  console.log(`[P112C2] screenshot: ${path.join(SHOTS, 'phase112-c2-pages-multiselect.png')}`);
});
