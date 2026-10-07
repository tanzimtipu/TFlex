// Phase 59 (item 5 / DEF-419) — the Outline panel's bottom is FLUSH with the
// panel's bottom edge when expanded.
//
// The assigned behaviour (Phase 59 item 5 / success criterion 5):
//   - with a SHORT outline the section HUGS its content, so the last outline
//     row's bottom edge sits on the panel/section bottom line (measured gap 0,
//     no dead space under it);
//   - with an OVERFLOWING outline the list scrolls INSIDE the section and the
//     last VISIBLE row (scrolled to the bottom) still meets the bottom edge.
//
// Launches only through the canonical launchApp helper. The overflowing
// fixture is synthetic (built in-spec with @cantoo/pdf-lib), never an operator
// document.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');
const { PDFDocument, PDFName, PDFString, PDFNumber } = require('@cantoo/pdf-lib');

// The Paperclip harness exports ELECTRON_RUN_AS_NODE=1; launchApp spreads
// process.env into the Electron child, which then exits as plain Node before any
// window is observable. Drop it before any launch.
delete process.env.ELECTRON_RUN_AS_NODE;

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
  if (app) await hardClose(app, 'p59-outline');
  app = null;
  win = null;
});

async function openPath(filePath) {
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, filePath);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1400);
}

async function openReport() {
  await openPath(getSamplePath('report.pdf'));
}

/** Build a one-page PDF carrying `count` top-level outline entries, so the
 *  outline tree overflows the section's 40% cap and must scroll inside it. */
async function buildOutlinePdf(file, count) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([612, 792]);
  const ctx = doc.context;
  const root = ctx.obj({ Type: 'Outlines' });
  const rootRef = ctx.register(root);
  let firstRef = null;
  let prevRef = null;
  for (let i = 0; i < count; i += 1) {
    const item = ctx.obj({ Title: PDFString.of(`Bookmark ${i + 1}`), Parent: rootRef });
    const itemRef = ctx.register(item);
    item.set(PDFName.of('Dest'), ctx.obj([page.ref, 'Fit']));
    if (firstRef === null) firstRef = itemRef;
    if (prevRef !== null) {
      ctx.lookup(prevRef).set(PDFName.of('Next'), itemRef);
      item.set(PDFName.of('Prev'), prevRef);
    }
    prevRef = itemRef;
  }
  root.set(PDFName.of('First'), firstRef);
  root.set(PDFName.of('Last'), prevRef);
  root.set(PDFName.of('Count'), PDFNumber.of(count));
  doc.catalog.set(PDFName.of('Outlines'), rootRef);
  fs.writeFileSync(file, await doc.save());
  return file;
}

async function ensureOutlineExpanded() {
  // Phase 111 (chunk A) retired the collapsible Outline section: the Outline is
  // now a full-height navigator VIEW selected by the view tab. Selecting it is
  // the live disclosure action; the section is readable via its live view hook.
  const view = win.locator('[data-context-panel-view="outline"]');
  if ((await view.count()) === 0) {
    await win.locator('[data-context-panel-view-tab="outline"]').click();
    await win.waitForTimeout(600);
  }
  await expect(view).toHaveCount(1);
}

async function measure() {
  return win.evaluate(() => {
    const panel = document.querySelector('[data-context-panel]');
    const section = document.querySelector('[data-context-panel-outline]');
    const outlinePanel = document.querySelector('.outline-panel');
    const rows = Array.from(document.querySelectorAll('.outline-row'));
    const last = rows[rows.length - 1] ?? null;
    const pr = panel.getBoundingClientRect();
    const sr = section.getBoundingClientRect();
    const or = outlinePanel ? outlinePanel.getBoundingClientRect() : null;
    const lr = last ? last.getBoundingClientRect() : null;
    return {
      panelBottom: Math.round(pr.bottom),
      sectionBottom: Math.round(sr.bottom),
      sectionHeight: Math.round(sr.height),
      outlinePanelBottom: or ? Math.round(or.bottom) : null,
      outlinePanelGap: or ? +(pr.bottom - or.bottom).toFixed(2) : null,
      lastRowBottom: lr ? Math.round(lr.bottom) : null,
      lastRowGap: lr ? +(pr.bottom - lr.bottom).toFixed(2) : null,
      lastRowGapToSection: lr ? +(sr.bottom - lr.bottom).toFixed(2) : null,
      rowCount: rows.length,
      scrollTop: outlinePanel ? Math.round(outlinePanel.scrollTop) : null,
      scrollHeight: outlinePanel ? Math.round(outlinePanel.scrollHeight) : null,
      clientHeight: outlinePanel ? Math.round(outlinePanel.clientHeight) : null,
    };
  });
}

test('SHORT outline: the outline view is flush with the panel bottom (gap 0)', async () => {
  await openReport();
  await ensureOutlineExpanded();

  const linkCount = await win.locator('.outline-link').count();
  console.log(`[P59-outline-short] outline links=${linkCount}`);
  expect(linkCount, 'report.pdf has outline rows').toBeGreaterThan(0);

  const m = await measure();
  console.log(`[P59-outline-short] ${JSON.stringify(m)}`);
  await win.screenshot({ path: path.join(SHOTS, 'p59-outline-flush-short.png') });

  // Phase 111 (chunk A) superseded the Phase-59 content-hugging 40% section:
  // the Outline is now a FULL-HEIGHT navigator view. The retained contract is
  // that the outline scroll region is flush with the panel's bottom edge (no
  // gap between the view and the panel), and the rows stay inside that region
  // (never clipped). A short list legitimately leaves empty scroll space below
  // it in a full-height view; only the OVERFLOWING case can put the last row
  // flush (asserted in the next test).
  expect(Math.abs(m.outlinePanelGap), `outline panel bottom flush with panel bottom (gap ${m.outlinePanelGap}px)`).toBeLessThanOrEqual(1);
  expect(m.sectionBottom, 'outline view bottom is the panel bottom').toBeLessThanOrEqual(m.panelBottom + 1);
  expect(m.lastRowBottom, 'last outline row is inside the scroll region').toBeLessThanOrEqual(m.panelBottom + 1);
});

test('OVERFLOWING outline: the list scrolls inside the section and the last VISIBLE row meets the bottom edge', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tflex-p59-outline-'));
  const fixture = await buildOutlinePdf(path.join(tmp, 'long-outline.pdf'), 40);
  await openPath(fixture);
  await ensureOutlineExpanded();

  const linkCount = await win.locator('.outline-link').count();
  console.log(`[P59-outline-overflow] outline links=${linkCount}`);
  expect(linkCount, 'the synthetic fixture has 40 outline rows').toBe(40);

  // The list genuinely overflows: its scroll height exceeds its client height.
  const before = await measure();
  console.log(`[P59-outline-overflow] before-scroll ${JSON.stringify(before)}`);
  expect(before.scrollHeight, `outline scrolls inside the section (scrollHeight ${before.scrollHeight} > clientHeight ${before.clientHeight})`).toBeGreaterThan(before.clientHeight + 1);

  // Scroll the outline scroller to its bottom so the LAST row is the visible
  // bottom row.
  await win.evaluate(() => {
    const panel = document.querySelector('.outline-panel');
    if (panel) panel.scrollTop = panel.scrollHeight;
  });
  await win.waitForTimeout(400);

  const m = await measure();
  console.log(`[P59-outline-overflow] ${JSON.stringify(m)}`);
  await win.screenshot({ path: path.join(SHOTS, 'p59-outline-flush-overflow.png') });

  // Scrolled to the bottom: the last VISIBLE row's bottom edge meets the
  // panel/section bottom (gap 0).
  expect(Math.abs(m.lastRowGap), `last visible outline row bottom flush with panel bottom (gap ${m.lastRowGap}px)`).toBeLessThanOrEqual(1);
  expect(Math.abs(m.lastRowGapToSection), `last visible outline row bottom flush with section bottom (gap ${m.lastRowGapToSection}px)`).toBeLessThanOrEqual(1);
  // The section stays bounded (the 40% cap) and the scroller is inside it.
  expect(m.sectionBottom, 'section bottom is the panel bottom').toBeLessThanOrEqual(m.panelBottom + 1);
  expect(m.outlinePanelBottom, 'outline scroller bottom is inside the section').toBeLessThanOrEqual(m.sectionBottom + 1);
});
