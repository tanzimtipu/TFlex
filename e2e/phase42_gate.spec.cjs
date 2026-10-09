// Phase 42 gate (qa) — the two operator items encoded by REQUIREMENTS.md's six
// success criteria:
//   1. every registry entry has a DISTINCT icon (zero duplicate groups);
//   2. the fixed duplicates render at the standard glyph size and read correctly;
//   3. watermark lives in exactly ONE stage's dock (REVIEW), absent from EDIT;
//   4. the watermark capability is not lost — it RUNS from the Ctrl+K palette;
//   5. no other tool moved (the per-stage dock sets are unchanged);
//   6. no regression (verify:full + the phase suites) — run separately.
//
// Launches only through the canonical e2e/lib/launch.cjs launchApp helper, with
// a COPY of the operator's real settings.json (dockPins: ["watermark"]) so the
// stale-pin leak is reproduced without writing to the operator's profile.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const EDIT_SHOT = path.join(SHOTS, 'phase42-edit-dock.png');
const REVIEW_SHOT = path.join(SHOTS, 'phase42-review-dock.png');
const REAL_SETTINGS = path.join(process.env.APPDATA, 'tflex', 'settings.json');

let app = null;
let win = null;
let userDataDir = null;

test.beforeEach(async () => {
  userDataDir = path.join(os.tmpdir(), `tflex-e2e-p42-${Date.now()}`);
  fs.mkdirSync(userDataDir, { recursive: true });
  const real = JSON.parse(fs.readFileSync(REAL_SETTINGS, 'utf8'));
  // Keep the operator's dockPins verbatim; pin the geometry on-screen so the
  // screenshots are stable (the real geometry targets a second monitor).
  real.geometry = { x: 0, y: 0, width: 1440, height: 900, maximized: false };
  fs.writeFileSync(path.join(userDataDir, 'settings.json'), JSON.stringify(real, null, 2));
  app = await launchApp([], userDataDir);
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'p42-gate');
  app = null;
  win = null;
});
test.setTimeout(300000);

async function openSample(name = 'report.pdf') {
  await win.locator('.sample-card').filter({ hasText: name }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);
}

async function setStage(n) {
  await win.evaluate(() => {
    const el = document.activeElement;
    if (el !== null && typeof el.blur === 'function') el.blur();
  });
  await win.keyboard.press(`Control+${n}`);
  await win.waitForTimeout(350);
}

// The rendered dock = inline verbs + the `...` overflow lane + the pinned
// verbs after the divider. Pins are reported separately so the one-home rule
// can be read directly.
async function collectDock() {
  const inline = await win.$$eval('[data-action-dock] [data-dock-verb]:not([data-dock-pin])', (els) =>
    els.map((e) => e.getAttribute('data-dock-verb')));
  const pins = await win.$$eval('[data-action-dock] [data-dock-pin]', (els) =>
    els.map((e) => e.getAttribute('data-dock-pin')));
  let overflow = [];
  if ((await win.locator('[data-dock-overflow]').count()) > 0) {
    await win.locator('[data-dock-overflow]').first().click();
    await win.waitForSelector('[data-dock-overflow-menu]', { state: 'visible', timeout: 8000 });
    overflow = await win.$$eval('[data-dock-overflow-item]', (els) =>
      els.map((e) => e.getAttribute('data-dock-overflow-item')));
    await win.keyboard.press('Escape');
    await win.waitForTimeout(200);
  }
  return { inline, overflow, pins, all: [...inline, ...overflow, ...pins] };
}

// The registry's dock sets (DOCK_STAGE_IDS) — the unchanged contract.
// Re-baselined (TFL-1489) to the shipped `DOCK_STAGE_IDS` in
// src/renderer/state/toolsRegistry.ts: later phases (37, 104) added the review
// form/engineering verbs and the xlsx/pptx/encrypt deliver verbs, so the
// phase-42-era lists were stale. The rendered dock still equals the registry
// set exactly; only this expectation moved.
const EXPECTED = {
  pages: ['rotate', 'extract', 'insertPages', 'replacePages', 'split', 'delete', 'merge', 'cropPages'],
  edit: ['editToolOff', 'editText', 'editImage', 'editTextBox', 'recognizeText', 'batchOcr', 'ocrSuspects'],
  review: [
    'annotate', 'sign', 'stamp', 'flatten', 'watermark', 'bates', 'exportComments',
    'importComments', 'fillFromCsv', 'exportFormData', 'importFormData',
    'validateDocument', 'sanitize', 'engineeringLayers', 'documentInfo',
  ],
  deliver: ['optimize', 'audit', 'exportPages', 'exportText', 'exportDocx', 'exportXlsx', 'exportPptx', 'createFromImages', 'encrypt'],
};

// ---------------------------------------------------------------------------
// Criterion 3 + 5 — one home for watermark; every other stage set unchanged.
// The operator's real settings carry dockPins: ["watermark"]; under the new
// rule a stage-native pin surfaces only in its own stage (REVIEW), so it must
// be ABSENT from the EDIT dock and present exactly once across the four stages.
// ---------------------------------------------------------------------------
test('P42-1 one home: watermark in exactly REVIEW, absent from EDIT; stage sets unchanged', async () => {
  await openSample();
  const seen = {};
  for (const [n, stage] of [[1, 'pages'], [2, 'edit'], [3, 'review'], [4, 'deliver']]) {
    await setStage(n);
    const d = await collectDock();
    seen[stage] = d;
    console.log(`[P42-1] ${stage}: inline=${JSON.stringify(d.inline)} overflow=${JSON.stringify(d.overflow)} pins=${JSON.stringify(d.pins)}`);
  }

  // Watermark appears in exactly ONE stage's dock, and that stage is REVIEW.
  const holders = Object.entries(seen).filter(([, d]) => d.all.includes('watermark')).map(([s]) => s);
  console.log(`[P42-1] watermark holders=${JSON.stringify(holders)}`);
  expect(holders, 'watermark renders in exactly one stage').toEqual(['review']);
  expect(seen.edit.all, 'watermark is ABSENT from the EDIT dock').not.toContain('watermark');
  expect(seen.pages.all, 'watermark is ABSENT from the PAGES dock').not.toContain('watermark');
  expect(seen.deliver.all, 'watermark is ABSENT from the DELIVER dock').not.toContain('watermark');

  // Criterion 5 — every other stage's dock set is unchanged (the registry's
  // DOCK_STAGE_IDS). The stale pin is deduped against REVIEW's own default set,
  // so REVIEW still renders watermark exactly once (no second copy).
  for (const stage of ['pages', 'edit', 'review', 'deliver']) {
    const rendered = [...seen[stage].inline, ...seen[stage].overflow].sort();
    console.log(`[P42-1] ${stage} rendered=${JSON.stringify(rendered)}`);
    expect(rendered, `${stage} dock set = the registry's DOCK_STAGE_IDS`).toEqual([...EXPECTED[stage]].sort());
    expect(seen[stage].pins, `${stage} renders no stray pin`).toEqual([]);
  }
  const reviewWatermarks = seen.review.all.filter((id) => id === 'watermark').length;
  expect(reviewWatermarks, 'watermark renders exactly once in REVIEW (pin deduped)').toBe(1);
});

// ---------------------------------------------------------------------------
// Criterion 2 — the fixed icons render at the standard glyph size (20px) and
// read correctly. Screenshots the EDIT and REVIEW docks for the operator.
// ---------------------------------------------------------------------------
test('P42-2 fixed icons: standard 20px glyphs; EDIT + REVIEW dock screenshots', async () => {
  await openSample();

  const glyph = async (id) => {
    const svg = win.locator(`[data-dock-verb="${id}"] svg`).first();
    await svg.waitFor({ state: 'visible', timeout: 8000 });
    return svg.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    });
  };

  // EDIT dock — editText (Type) and editTextBox (SquarePlus) are the changed
  // entries here; editImage (Image) is the unchanged control.
  await setStage(2);
  const editText = await glyph('editText');
  const editTextBox = await glyph('editTextBox');
  const editImage = await glyph('editImage');
  console.log(`[P42-2] EDIT glyphs editText=${JSON.stringify(editText)} editTextBox=${JSON.stringify(editTextBox)} editImage=${JSON.stringify(editImage)}`);
  expect(editText, 'editText glyph is the standard 20px').toEqual({ w: 20, h: 20 });
  expect(editTextBox, 'editTextBox glyph is the standard 20px').toEqual({ w: 20, h: 20 });
  expect(editImage, 'the unchanged control is also 20px (the standard)').toEqual({ w: 20, h: 20 });
  await win.screenshot({ path: EDIT_SHOT });
  console.log(`[p42] screenshot: ${EDIT_SHOT}`);

  // Re-baselined (TFL-1489). The reviewer "changed entries" watermark,
  // exportComments and importComments are non-primary under the Phase 104
  // responsive curation, so they now render in the dock's More overflow rather
  // than as inline 20px tiles. The inline review tiles (annotate, sign, stamp,
  // bates) still carry the standard 20px glyph; the overflow rows use the
  // shared menu's md icon, so `flatten` (a long-standing non-primary review
  // verb) is measured as the control and the three changed ids must match it.
  await setStage(3);
  const sign = await glyph('sign');
  const annotate = await glyph('annotate');
  console.log(`[P42-2] REVIEW tile glyphs annotate=${JSON.stringify(annotate)} sign=${JSON.stringify(sign)}`);
  for (const [id, g] of [['annotate', annotate], ['sign', sign]]) {
    expect(g, `${id} glyph is the standard 20px`).toEqual({ w: 20, h: 20 });
  }

  const overflowGlyph = async (id) => {
    const svg = win.locator(`[data-dock-overflow-item="${id}"] svg`).first();
    await svg.waitFor({ state: 'visible', timeout: 8000 });
    return svg.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height) };
    });
  };
  await win.locator('[data-dock-overflow]').first().click();
  await win.waitForSelector('[data-dock-overflow-menu]', { state: 'visible', timeout: 8000 });
  const control = await overflowGlyph('flatten');
  const overflowChanged = {};
  for (const id of ['watermark', 'exportComments', 'importComments']) {
    overflowChanged[id] = await overflowGlyph(id);
  }
  console.log(`[P42-2] REVIEW overflow control flatten=${JSON.stringify(control)} changed=${JSON.stringify(overflowChanged)}`);
  for (const [id, g] of Object.entries(overflowChanged)) {
    expect(g, `overflow ${id} uses the standard menu glyph`).toEqual(control);
  }
  await win.keyboard.press('Escape');
  await win.waitForTimeout(200);
  await win.screenshot({ path: REVIEW_SHOT });
  console.log(`[p42] screenshot: ${REVIEW_SHOT}`);
});

// ---------------------------------------------------------------------------
// Criterion 4 — the watermark capability is not lost: it RUNS from the Ctrl+K
// palette (a live run, not a registry read).
// ---------------------------------------------------------------------------
test('P42-3 watermark runs from the Ctrl+K palette (dialog opens)', async () => {
  await openSample();
  await win.evaluate(() => {
    const el = document.activeElement;
    if (el instanceof HTMLElement) el.blur();
  });
  await win.keyboard.press('Control+k');
  await win.waitForSelector('[data-command-palette-input]', { state: 'visible', timeout: 8000 });
  await win.fill('[data-command-palette-input]', 'watermark');
  await win.waitForTimeout(350);
  const row = win.locator('[data-palette-tool-id="watermark"]').first();
  await expect(row, 'the palette lists the watermark tool').toBeVisible();
  await row.click();
  await win.waitForSelector('[data-watermark-dialog]', { state: 'visible', timeout: 8000 });
  const count = await win.locator('[data-watermark-dialog]').count();
  console.log(`[P42-3] watermark dialog opened from the palette (count=${count})`);
  expect(count, 'exactly one watermark dialog opened').toBe(1);
});
