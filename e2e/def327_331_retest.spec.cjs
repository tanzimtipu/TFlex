// DEF-327..331 retest (qa) -- the five Phase-36 adversary findings accepted from
// ADV-078..082. Each test reproduces the ADV entry's steps against the rebuilt
// dev bundle and asserts the fixed observable result. Launches only through the
// canonical launchApp helper. Captures ONE screenshot:
// screenshots/phase36-def330-default.png (the DEF-330 default-window dock).
//
// ASCII only: the degree sign is written as the JS escape \u00b0.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose, gotoStage } = require('./lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const REPORT = path.join(ROOT, 'test-fixtures', 'report.pdf');
const SCANNED = path.join(ROOT, 'test-fixtures', 'scanned.pdf');
const SHOTS = path.join(ROOT, 'screenshots');
const STAGE_NAMES = ['pages', 'edit', 'review', 'deliver'];

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp(['--disable-gpu', '--no-sandbox']);
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'def327-331-retest');
  app = null;
  win = null;
});
test.setTimeout(300000);

async function openFile(p) {
  await app.evaluate(async ({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
  }, p);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1200);
}

async function loadSettings() {
  const r = await win.evaluate(() => window.tflex.loadSettings());
  return r && r.ok ? r.value : null;
}
async function saveSettings(patch) {
  const s = await loadSettings();
  await win.evaluate((v) => window.tflex.saveSettings(v), { ...s, ...patch });
  await win.waitForTimeout(400);
}
async function waitForSettings(pred, label, timeout = 6000) {
  const t0 = Date.now();
  let s = null;
  while (Date.now() - t0 < timeout) {
    s = await loadSettings();
    if (s !== null && pred(s)) return s;
    await win.waitForTimeout(200);
  }
  console.log(`[waitForSettings:${label}] last=${JSON.stringify(s)}`);
  return s;
}

async function openPalette() {
  await win.evaluate(() => {
    const el = document.activeElement;
    if (el instanceof HTMLElement) el.blur();
  });
  await win.keyboard.press('Control+k');
  await win.waitForSelector('[data-command-palette]', { timeout: 8000 });
  await win.waitForTimeout(200);
}
async function closePalette() {
  if ((await win.locator('[data-command-palette]').count()) > 0) {
    await win.keyboard.press('Escape');
    await win.waitForSelector('[data-command-palette]', { state: 'detached', timeout: 8000 });
  }
}
async function paletteRowInfo(id) {
  const row = win.locator(`[data-palette-tool-id="${id}"]`).first();
  const found = (await row.count()) > 0;
  const info = { id, found };
  if (found) {
    info.disabled = await row.getAttribute('data-palette-disabled');
    info.title = await row.getAttribute('title');
    info.text = ((await row.textContent()) || '').trim().replace(/\s+/g, ' ').slice(0, 90);
  }
  return info;
}

async function dockState(stageNum) {
  await gotoStage(win, stageNum);
  await win.waitForTimeout(500);
  return win.evaluate(() => {
    const dock = document.querySelector('[data-action-dock]');
    if (dock === null) return null;
    const r = (el) => (el ? el.getBoundingClientRect().toJSON() : null);
    const page = document.querySelector('[data-page-pill]');
    const zoom = document.querySelector('[data-zoom-pill]');
    const dr = r(dock);
    const pr = r(page);
    const zr = r(zoom);
    const host = dock.parentElement ? r(dock.parentElement) : null;
    const verbs = [...dock.querySelectorAll('[data-dock-verb]')].map((e) => {
      const rr = e.getBoundingClientRect();
      return { id: e.getAttribute('data-dock-verb'), left: Math.round(rr.left), right: Math.round(rr.right), top: Math.round(rr.top), w: Math.round(rr.width) };
    });
    const groupRect = r(dock.querySelector('.action-dock-group'));
    const labelWidths = [...dock.querySelectorAll('.action-dock-label')].map((e) => ({ t: e.textContent, w: Math.round(e.getBoundingClientRect().width) }));
    return {
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      hostWidth: host ? Math.round(host.width) : null,
      hostLeft: host ? Math.round(host.left) : null,
      iconOnly: dock.getAttribute('data-dock-icon-only'),
      lift: dock.getAttribute('data-dock-lift'),
      compact: dock.getAttribute('data-dock-compact'),
      band: Number(dock.getAttribute('data-dock-band')),
      freeBand: dock.getAttribute('data-dock-free-band'),
      shift: Number(dock.getAttribute('data-dock-shift')),
      maxWidth: dock.style.maxWidth,
      labels: [...dock.querySelectorAll('.action-dock-label')].map((e) => e.textContent),
      labelWidths,
      groupWidth: groupRect ? Math.round(groupRect.width) : null,
      verbRows: [...new Set(verbs.map((v) => v.top))].length,
      verbs,
      overflow: dock.querySelectorAll('[data-dock-overflow]').length,
      dockWidth: dr ? Math.round(dr.width) : null,
      dockHeight: dr ? Math.round(dr.height) : null,
      dockLeft: dr ? Math.round(dr.left) : null,
      dockRight: dr ? Math.round(dr.right) : null,
      pageRight: pr ? Math.round(pr.right) : null,
      zoomLeft: zr ? Math.round(zr.left) : null,
      clearPage: pr && dr ? Math.round(dr.left - pr.right) : null,
      clearZoom: zr && dr ? Math.round(zr.left - dr.right) : null,
    };
  });
}

// ---------------------------------------------------------------------------
// DEF-327 -- the palette's enabled no-ops (ADV-078)
// ---------------------------------------------------------------------------
test('DEF-327 palette gates the no-op rows with the dock copy', async () => {
  await openFile(REPORT);

  // Edit mode OFF (the edit-layer tools' live precondition).
  await gotoStage(win, 2);
  const editModePressed = await win.locator('[data-dock-verb="editMode"]').first().getAttribute('aria-pressed');
  if (editModePressed === 'true') {
    await win.locator('[data-dock-verb="editMode"]').first().click();
    await win.waitForTimeout(500);
  }
  const editModeAfter = await win.locator('[data-dock-verb="editMode"]').first().getAttribute('aria-pressed');
  console.log(`[DEF-327] editMode aria-pressed ${editModePressed} -> ${editModeAfter}`);

  const cases = [
    { id: 'undo', reason: 'Nothing to undo' },
    { id: 'redo', reason: 'Nothing to redo' },
    { id: 'editText', reason: 'Turn on Edit content first' },
    { id: 'editTextBox', reason: 'Turn on Edit content first' },
    { id: 'editImage', reason: 'Turn on Edit content first' },
    { id: 'paneOpen', reason: 'Turn on Multi Mode first' },
    { id: 'paneClear', reason: 'Turn on Multi Mode first' },
  ];
  await openPalette();
  for (const c of cases) {
    const info = await paletteRowInfo(c.id);
    console.log(`[DEF-327] row ${c.id}: ${JSON.stringify(info)}`);
    expect(info.found, `${c.id} row present`).toBe(true);
    expect(info.disabled, `${c.id} disabled`).toBe('true');
    expect(info.title, `${c.id} reason copy`).toBe(c.reason);
  }

  // Clicking a disabled row is inert: no dialog, no state change, palette stays.
  // The row is `aria-disabled` with no click handler, so Playwright's own click
  // refuses it; dispatch the DOM click to prove the row is inert by construction.
  await win.locator('[data-palette-tool-id="undo"]').first().evaluate((el) => el.click());
  await win.waitForTimeout(400);
  const paletteStillOpen = (await win.locator('[data-command-palette]').count()) > 0;
  const modalAfter = await win.locator('.modal-backdrop, .sheet-backdrop').count();
  console.log(`[DEF-327] disabled-row click -> paletteOpen=${paletteStillOpen} modals=${modalAfter}`);
  expect(paletteStillOpen).toBe(true);
  expect(modalAfter).toBe(0);

  // A runnable row still runs.
  await closePalette();
  await openPalette();
  await win.fill('[data-command-palette-input]', 'deliver');
  await win.waitForTimeout(250);
  const deliverRow = win.locator('[data-palette-tool-id="stageDeliver"]').first();
  expect(await deliverRow.getAttribute('data-palette-disabled'), 'stageDeliver runnable').toBe('false');
  await win.keyboard.press('Enter');
  await win.waitForTimeout(500);
  const stageAfter = await win.locator('[data-context-panel]').getAttribute('data-context-panel-stage');
  console.log(`[DEF-327] runnable row stageDeliver -> context-panel-stage=${stageAfter}`);
  expect(stageAfter).toBe('deliver');
});

// ---------------------------------------------------------------------------
// DEF-327 (pinned) -- a pinned gated command is not a dead pin: disabled until
// its condition is met, then it runs.
// ---------------------------------------------------------------------------
test('DEF-327 pinned gated undo runs once its condition is met', async () => {
  await openFile(SCANNED);
  await saveSettings({ toolUsage: {}, dockPins: ['undo'] });
  const pinned = await waitForSettings((s) => Array.isArray(s.dockPins) && s.dockPins.includes('undo'), 'pin-undo');
  console.log(`[DEF-327] dockPins=${JSON.stringify(pinned && pinned.dockPins)}`);
  await gotoStage(win, 1);
  const pin = win.locator('[data-dock-pin="undo"]').first();
  const pageCls = async () => (await win.locator('.pdf-page[data-page="1"]').first().getAttribute('class')) || '';
  expect(await pin.count(), 'pinned undo rendered in the dock').toBe(1);
  const before = { disabled: await pin.isDisabled(), title: await pin.getAttribute('title') };
  const clsBefore = await pageCls();
  console.log(`[DEF-327] pinned undo before change: disabled=${before.disabled} title=${JSON.stringify(before.title)} page1="${clsBefore}"`);
  expect(before.disabled, 'pinned undo disabled on an empty stack').toBe(true);

  // Make an undoable change: rotate page 1 (no-outline fixture).
  const thumb = win.locator('[data-context-panel="pages"] .thumb-item[data-page="1"]').first();
  await thumb.hover();
  await win.waitForTimeout(250);
  await win.locator('[data-context-panel="pages"] .thumb-item[data-page="1"] [data-thumb-verb="rotate-cw"]').click();
  await expect.poll(pageCls, { timeout: 15000 }).toContain('pdf-page-rot-90');
  await win.waitForTimeout(400);
  const enabledNow = !(await pin.isDisabled());
  console.log(`[DEF-327] after rotate: pinned undo enabled=${enabledNow} page1="${await pageCls()}"`);
  expect(enabledNow, 'pinned undo enabled once the stack is non-empty').toBe(true);

  await pin.click();
  await expect.poll(pageCls, { timeout: 15000 }).not.toContain('pdf-page-rot-90');
  console.log(`[DEF-327] pinned undo click -> page1="${await pageCls()}"`);
  expect(await pageCls(), 'the pinned undo actually undid the rotation').not.toContain('pdf-page-rot-90');
});

// ---------------------------------------------------------------------------
// DEF-328 -- the EDIT panel's "Review suspects" button (ADV-079)
// ---------------------------------------------------------------------------
test('DEF-328 EDIT panel suspects gated on an OCR run', async () => {
  await openFile(REPORT);
  await gotoStage(win, 2);

  const suspects = win.locator('[data-context-panel-action="suspects"]').first();
  const before = { disabled: await suspects.isDisabled(), title: await suspects.getAttribute('title') };
  console.log(`[DEF-328] before OCR: ${JSON.stringify(before)}`);
  expect(before.disabled, 'suspects disabled before any OCR run').toBe(true);
  expect(before.title, 'same copy as the palette row').toBe('Run Recognize text first');

  // Real run: palette recognizeText -> OCR dialog -> confirm current page.
  await openPalette();
  await win.fill('[data-command-palette-input]', 'recognize');
  await win.waitForTimeout(250);
  await win.locator('[data-palette-tool-id="recognizeText"]').first().click();
  await win.waitForSelector('[data-ocr-confirm]', { timeout: 10000 });
  await win.click('[data-ocr-scope="currentPage"]');
  await win.waitForTimeout(150);
  await win.click('[data-ocr-confirm]');
  await win.waitForSelector('[data-ocr-suspects-panel]', { timeout: 240000 });
  const summary = (await win.locator('.ocr-suspects-summary').textContent().catch(() => '')) || '';
  console.log(`[DEF-328] OCR completed; suspects summary=${JSON.stringify(summary.trim())}`);

  // Close the auto-opened panel, then the EDIT entry must be enabled and open it.
  await win.click('.ocr-suspects-close');
  await win.waitForFunction(() => document.querySelector('[data-ocr-suspects-panel]') === null, null, { timeout: 5000 });

  await gotoStage(win, 2);
  const after = { disabled: await suspects.isDisabled(), title: await suspects.getAttribute('title') };
  console.log(`[DEF-328] after OCR: ${JSON.stringify(after)}`);
  expect(after.disabled, 'suspects enabled after a completed run').toBe(false);
  expect(after.title, 'no refusal copy once enabled').toBeNull();

  await suspects.click();
  await win.waitForSelector('[data-ocr-suspects-panel]', { timeout: 15000 });
  console.log('[DEF-328] EDIT suspects click reopened [data-ocr-suspects-panel]');
});

// ---------------------------------------------------------------------------
// DEF-329 -- the Inspector's Rotation value (ADV-080)
// ---------------------------------------------------------------------------
test('DEF-329 Inspector Rotation shows the real degrees', async () => {
  await openFile(SCANNED);
  await gotoStage(win, 1);

  const rotationValue = async () => ((await win.locator('[data-inspector-value="rotation"]').first().textContent()) || '').trim();
  const pageClass = async (n) => (await win.locator(`.pdf-page[data-page="${n}"]`).first().getAttribute('class')) || '';

  const before = { text: await rotationValue(), cls: await pageClass(1) };
  console.log(`[DEF-329] before: rotation=${JSON.stringify(before.text)} page1="${before.cls}"`);
  expect(before.text).toBe('0\u00b0');

  const thumbSel = '[data-context-panel="pages"] .thumb-item[data-page="1"]';
  await win.locator(thumbSel).first().hover();
  await win.waitForTimeout(250);
  await win.locator(`${thumbSel} [data-thumb-verb="rotate-cw"]`).click();

  await expect.poll(rotationValue, { timeout: 15000 }).toBe('90\u00b0');
  await expect.poll(async () => pageClass(1), { timeout: 15000 }).toContain('pdf-page-rot-90');
  console.log(`[DEF-329] after Rotate CW: rotation=${JSON.stringify(await rotationValue())} page1="${await pageClass(1)}"`);

  // A second rotation -> 180.
  await win.locator(`${thumbSel} [data-thumb-verb="rotate-cw"]`).click();
  await expect.poll(rotationValue, { timeout: 15000 }).toBe('180\u00b0');
  console.log(`[DEF-329] after second Rotate CW: rotation=${JSON.stringify(await rotationValue())}`);
});

// ---------------------------------------------------------------------------
// DEF-330 -- the default window's dock (ADV-081)
// ---------------------------------------------------------------------------
test('DEF-330 four stages render LABELLED one-row at the default window; narrow widths unchanged', async () => {
  await openFile(REPORT);
  await win.waitForTimeout(600);

  const setSize = async (w, h) => {
    await app.evaluate(async ({ BrowserWindow }, size) => {
      const target = BrowserWindow.getAllWindows()[0];
      if (target) target.setContentSize(size.w, size.h);
    }, { w, h });
    await win.waitForTimeout(700);
  };

  let probe = await dockState(1);
  console.log(`[DEF-330] default window inner=${probe.innerWidth}x${probe.innerHeight} hostWidth=${probe.hostWidth}`);
  if (probe.hostWidth === null || probe.hostWidth < 880 || probe.hostWidth > 945) {
    await setSize(1440, 900);
    probe = await dockState(1);
    console.log(`[DEF-330] forced 1440x900 -> inner=${probe.innerWidth}x${probe.innerHeight} hostWidth=${probe.hostWidth}`);
  }

  const results = {};
  for (let n = 1; n <= 4; n += 1) {
    const s = await dockState(n);
    results[STAGE_NAMES[n - 1]] = s;
    console.log(`[DEF-330] ${STAGE_NAMES[n - 1]}: ${JSON.stringify(s)}`);
  }

  // Capture the evidence FIRST (DELIVER at the default window), before asserting,
  // so a red run still carries its own screenshot: the developer flagged ~2px of
  // band headroom; LOOK at whether DELIVER is cramped / touches a pill.
  await gotoStage(win, 4);
  await win.waitForTimeout(500);
  const shotPath = path.join(SHOTS, 'phase36-def330-default.png');
  await win.screenshot({ path: shotPath });
  console.log(`[DEF-330] captured ${shotPath} (deliver dock ${results.deliver.dockWidth}px in band ${results.deliver.band}px; freeBand=${results.deliver.freeBand} clearPage=${results.deliver.clearPage} clearZoom=${results.deliver.clearZoom})`);

  for (const name of STAGE_NAMES) {
    const s = results[name];
    expect(s.iconOnly, `${name} labelled at the default window`).toBe('false');
    expect(s.labels.length, `${name} verb labels`).toBeGreaterThan(0);
    expect(s.dockHeight, `${name} single row`).toBeLessThan(60);
    expect(s.verbRows, `${name} verbs on one row`).toBe(1);
    expect(s.dockWidth, `${name} within the free band`).toBeLessThanOrEqual(s.band + 1);
    expect(s.clearPage, `${name} clears the page pill`).toBeGreaterThan(0);
    expect(s.clearZoom, `${name} clears the zoom pill`).toBeGreaterThan(0);
  }
  expect(results.deliver.labels.length, 'DELIVER keeps all five labels').toBe(5);
});

test('DEF-330 narrow-width behaviour unchanged: icon-only at 900/760/640', async () => {
  await openFile(REPORT);
  await win.waitForTimeout(600);
  const setSize = async (w, h) => {
    await app.evaluate(async ({ BrowserWindow }, size) => {
      const target = BrowserWindow.getAllWindows()[0];
      if (target) target.setContentSize(size.w, size.h);
    }, { w, h });
    await win.waitForTimeout(700);
  };
  for (const w of [900, 760, 640]) {
    await setSize(w, 800);
    for (let n = 1; n <= 4; n += 1) {
      const s = await dockState(n);
      console.log(`[DEF-330-narrow] w=${w} ${STAGE_NAMES[n - 1]}: ${JSON.stringify({ innerWidth: s.innerWidth, hostWidth: s.hostWidth, iconOnly: s.iconOnly, labels: s.labels.length, lift: s.lift, compact: s.compact, overflow: s.overflow })}`);
      expect(s.iconOnly, `w=${w} ${STAGE_NAMES[n - 1]} icon-only`).toBe('true');
      expect(s.labels.length, `w=${w} ${STAGE_NAMES[n - 1]} no labels`).toBe(0);
    }
  }
});

// ---------------------------------------------------------------------------
// DEF-331 -- Escape over a dialog (ADV-082)
// ---------------------------------------------------------------------------
test('DEF-331 the first Escape closes the palette, not the dialog beneath it', async () => {
  await openFile(REPORT);
  await gotoStage(win, 3);

  await win.locator('[data-dock-verb="stamp"]').first().click();
  await win.waitForSelector('[data-stamp-dialog], .modal-backdrop', { timeout: 10000 });
  await win.waitForTimeout(400);
  const dialogOpen = await win.locator('[data-stamp-dialog], .modal-backdrop').count();
  console.log(`[DEF-331] stamp dialog open=${dialogOpen}`);

  await win.keyboard.press('Control+k');
  await win.waitForSelector('[data-command-palette]', { timeout: 8000 });
  await win.waitForTimeout(300);
  const stacked = {
    palette: (await win.locator('[data-command-palette]').count()) > 0,
    dialog: (await win.locator('[data-stamp-dialog], .modal-backdrop').count()) > 0,
  };
  console.log(`[DEF-331] palette over dialog: ${JSON.stringify(stacked)}`);
  expect(stacked.palette).toBe(true);
  expect(stacked.dialog).toBe(true);

  await win.keyboard.press('Escape');
  await win.waitForTimeout(500);
  const afterFirst = {
    palette: (await win.locator('[data-command-palette]').count()) > 0,
    dialog: (await win.locator('[data-stamp-dialog], .modal-backdrop').count()) > 0,
  };
  console.log(`[DEF-331] after first Escape: ${JSON.stringify(afterFirst)}`);
  expect(afterFirst.palette, 'the TOP-most surface (palette) closed first').toBe(false);
  expect(afterFirst.dialog, 'the dialog underneath survives the first Escape').toBe(true);

  await win.keyboard.press('Escape');
  await win.waitForTimeout(500);
  const afterSecond = {
    palette: (await win.locator('[data-command-palette]').count()) > 0,
    dialog: (await win.locator('[data-stamp-dialog], .modal-backdrop').count()) > 0,
  };
  console.log(`[DEF-331] after second Escape: ${JSON.stringify(afterSecond)}`);
  expect(afterSecond.palette).toBe(false);
  expect(afterSecond.dialog, 'the second Escape reaches the dialog').toBe(false);
});
