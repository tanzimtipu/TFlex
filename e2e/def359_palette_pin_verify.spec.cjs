// DEF-359 verification (qa) — the palette's pin marker is scoped to the stage's
// dock. With the operator's real dockPins:["watermark"], a stage-native pin must
// read "pinned-elsewhere" (naming REVIEW) in PAGES/EDIT/DELIVER, "pinned" in
// REVIEW, and the palette must AGREE with the dock's visible contents in every
// stage. Unpin/re-pin from a foreign stage must name the dock the action touched
// and make a real persisted state change (no phantom message).
//
// Launches only through the canonical e2e/lib/launch.cjs launchApp helper, with
// a COPY of the operator's real settings.json so the stale-pin case is
// reproduced without writing to the operator's profile.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const REAL_SETTINGS = path.join(process.env.APPDATA, 'tflex', 'settings.json');

let app = null;
let win = null;
let userDataDir = null;

test.beforeEach(async () => {
  userDataDir = path.join(os.tmpdir(), `tflex-e2e-def359-${Date.now()}`);
  fs.mkdirSync(userDataDir, { recursive: true });
  const real = JSON.parse(fs.readFileSync(REAL_SETTINGS, 'utf8'));
  real.geometry = { x: 0, y: 0, width: 1440, height: 900, maximized: false };
  real.dockPins = ['watermark'];
  real.dockUnpinned = [];
  fs.writeFileSync(path.join(userDataDir, 'settings.json'), JSON.stringify(real, null, 2));
  app = await launchApp([], userDataDir);
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'def359');
  app = null;
  win = null;
});
test.setTimeout(300000);

async function openSample(name = 'report.pdf') {
  await win.locator('.sample-card').filter({ hasText: name }).first().click();
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
async function openPalette() {
  await win.evaluate(() => {
    const el = document.activeElement;
    if (el !== null && typeof el.blur === 'function') el.blur();
  });
  await win.keyboard.press('Control+k');
  await win.waitForSelector('[data-command-palette-input]', { state: 'visible', timeout: 8000 });
  await win.waitForTimeout(300);
}
async function readWatermarkRow() {
  return win.evaluate(() => {
    const r = document.querySelector('[data-palette-tool-id="watermark"]');
    if (!r) return null;
    const btn = r.querySelector('[data-palette-pin-toggle]');
    return {
      pinned: r.getAttribute('data-palette-pinned'),
      pinState: btn ? btn.getAttribute('data-palette-pin-state') : null,
      pinStage: r.getAttribute('data-palette-pin-stage'),
      ariaLabel: btn ? btn.getAttribute('aria-label') : null,
    };
  });
}
// Read the PERSISTED dockPins from disk (settings.load reads the file), polling
// so the queued save has landed.
async function persistedPins() {
  for (let i = 0; i < 20; i += 1) {
    const res = await win.evaluate(async () => {
      const r = await window.tflex.loadSettings();
      return r && r.ok ? r.value.dockPins : null;
    });
    if (res !== null) return res;
    await win.waitForTimeout(150);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Per-stage marker + dock agreement.
// ---------------------------------------------------------------------------
test('DEF-359 per-stage palette pin marker agrees with the dock', async () => {
  await openSample();
  const report = {};
  for (const [n, stage] of [[1, 'pages'], [2, 'edit'], [3, 'review'], [4, 'deliver']]) {
    await setStage(n);
    const dock = await collectDock();
    await openPalette();
    const row = await readWatermarkRow();
    await win.keyboard.press('Escape');
    await win.waitForTimeout(250);
    const dockHas = dock.all.includes('watermark');
    report[stage] = { dockHas, row };
    console.log(`[DEF-359] ${stage}: dockHasWatermark=${dockHas} row=${JSON.stringify(row)}`);
    // Agreement: the palette claims "pinned" iff the visible dock holds it.
    expect(row.pinned === 'true', `${stage}: palette pinned agrees with the dock`).toBe(dockHas);
    if (stage === 'review') {
      expect(row.pinState, 'REVIEW reads pinned').toBe('pinned');
      expect(row.pinStage, 'REVIEW has no foreign home').toBeNull();
      expect(row.ariaLabel, 'REVIEW unpin copy names the dock').toBe('Unpin Watermark from the dock');
    } else {
      expect(row.pinned, `${stage}: palette does NOT claim the dock holds it`).toBe('false');
      expect(row.pinState, `${stage}: reads pinned-elsewhere`).toBe('pinned-elsewhere');
      expect(row.pinStage, `${stage}: names REVIEW as home`).toBe('review');
      expect(row.ariaLabel, `${stage}: copy names the Review dock`).toBe('Unpin Watermark from the Review dock');
    }
  }
  const holders = Object.entries(report).filter(([, v]) => v.dockHas).map(([s]) => s);
  console.log(`[DEF-359] watermark dock holders=${JSON.stringify(holders)}`);
  expect(holders, 'watermark renders in exactly REVIEW').toEqual(['review']);
});

// ---------------------------------------------------------------------------
// Unpin / re-pin from a foreign stage: notice names the dock, real state change.
// ---------------------------------------------------------------------------
test('DEF-359 unpin/re-pin from a foreign stage names the dock and changes real state', async () => {
  await openSample();
  await setStage(2); // EDIT — a foreign stage for watermark
  const before = await persistedPins();
  console.log(`[DEF-359] persisted dockPins before=${JSON.stringify(before)}`);
  expect(before, 'seeded operator pin is present').toContain('watermark');

  await openPalette();
  await win.fill('[data-command-palette-input]', 'watermark');
  await win.waitForTimeout(350);
  const rowBefore = await readWatermarkRow();
  console.log(`[DEF-359] EDIT row before=${JSON.stringify(rowBefore)}`);
  expect(rowBefore.pinState, 'EDIT row reads pinned-elsewhere').toBe('pinned-elsewhere');

  // Unpin.
  await win.locator('[data-palette-tool-id="watermark"] [data-palette-pin-toggle]').first().click();
  await win.waitForTimeout(500);
  const noticeUnpin = await win.locator('[data-command-palette-notice]').first().textContent().catch(() => null);
  const rowAfterUnpin = await readWatermarkRow();
  const pinsAfterUnpin = await persistedPins();
  console.log(`[DEF-359] unpin notice=${JSON.stringify(noticeUnpin)} row=${JSON.stringify(rowAfterUnpin)} persisted=${JSON.stringify(pinsAfterUnpin)}`);
  expect(noticeUnpin, 'unpin notice names the Review dock').toBe('Unpinned Watermark from the Review dock');
  expect(rowAfterUnpin.pinState, 'row flips to unpinned').toBe('unpinned');
  expect(pinsAfterUnpin, 'the pin was really removed').not.toContain('watermark');

  // Re-pin.
  await win.locator('[data-palette-tool-id="watermark"] [data-palette-pin-toggle]').first().click();
  await win.waitForTimeout(500);
  const noticePin = await win.locator('[data-command-palette-notice]').first().textContent().catch(() => null);
  const rowAfterPin = await readWatermarkRow();
  const pinsAfterPin = await persistedPins();
  console.log(`[DEF-359] re-pin notice=${JSON.stringify(noticePin)} row=${JSON.stringify(rowAfterPin)} persisted=${JSON.stringify(pinsAfterPin)}`);
  expect(noticePin, 're-pin notice names the Review dock').toBe('Pinned Watermark to the Review dock');
  expect(rowAfterPin.pinState, 'row returns to pinned-elsewhere').toBe('pinned-elsewhere');
  expect(pinsAfterPin, 'the pin was really restored').toContain('watermark');
});
