// Phase 40 post-gate (qa) — consolidated independent verification of DEF-351..356.
//
// This is the ONE surviving verify spec for the six post-gate defects. It
// replaces the three near-duplicate specs (phase40_def351_353_verify,
// phase40_def351_355_verify and the earlier phase40_def351_356_verify) whose
// DEF-353/354/355/356 tests had been mislabelled as palette-tag checks.
//
// Every launch goes through the canonical launchApp helper. The raw
// [P40-DEFnnn ...] lines printed here are the evidence; the assertions are the
// verdicts. DEF-351/352/353 drive the real UI (clicks, typing, pin toggles);
// DEF-354/355 re-measure contrast with the adversary's exact WCAG helper;
// DEF-356 opens a real on-disk copy and checks the file bytes on Ctrl+S.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const crypto = require('node:crypto');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, openDockVerb } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const THEMES = ['light', 'dark', 'frosted'];

let app = null;
let win = null;
test.setTimeout(300000);

test.afterEach(async () => {
  if (app) await hardClose(app, 'p40-def');
  app = null;
  win = null;
});

async function boot(userDataDir = null) {
  app = await launchApp([], userDataDir);
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  return win;
}

async function openSample(name) {
  await win.locator('.sample-card').filter({ hasText: name }).first().click();
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);
}

function sha256(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}
function mtimeMs(p) {
  return fs.statSync(p).mtimeMs;
}

async function setTheme(theme) {
  await win.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await win.waitForTimeout(350);
}

// The adversary's exact WCAG helper (ADV-094/095), reused so the re-measurement
// uses the same method that produced the original numbers.
const SAMPLE_ONE = ({ sel }) => {
  function parse(css) {
    const m = css.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x.trim()));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function lum(c) {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  function ratio(fg, bg) {
    const l1 = lum(fg), l2 = lum(bg);
    const hi = Math.max(l1, l2), lo = Math.min(l1, l2);
    return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
  }
  function effBg(el) {
    let n = el;
    while (n) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.01) {
        if (c.a >= 0.999) return c;
        let parent = effBg(n.parentElement);
        if (!parent) parent = { r: 255, g: 255, b: 255, a: 1 };
        return { r: c.r * c.a + parent.r * (1 - c.a), g: c.g * c.a + parent.g * (1 - c.a), b: c.b * c.a + parent.b * (1 - c.a), a: 1 };
      }
      n = n.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  }
  const el = document.querySelector(sel);
  if (!el) return null;
  const cs = getComputedStyle(el);
  const fg = parse(cs.color);
  const bg = effBg(el);
  if (!fg) return null;
  const fga = fg.a < 1 ? { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 } : fg;
  return { sel, ratio: ratio(fga, bg), color: cs.color, bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`, cls: el.className };
};

const PAGE_STATE = () => {
  const input = document.querySelector('[data-page-pill] .page-input');
  const diag = (() => { try { return window.tflexDiagnostics(); } catch (_) { return {}; } })();
  return {
    value: input ? input.value : null,
    ss: input ? input.selectionStart : null,
    se: input ? input.selectionEnd : null,
    currentPage: diag.currentPage ?? null,
  };
};

async function paletteOpen() {
  if ((await win.locator('[data-command-palette]').count()) === 0) {
    await win.locator('[data-header-tool-search]').first().click();
    await win.waitForSelector('[data-command-palette]', { timeout: 8000 });
  }
  await win.waitForTimeout(350);
}
async function paletteSearch(q) {
  await paletteOpen();
  await win.locator('[data-command-palette-input]').fill(q);
  await win.waitForTimeout(400);
}
async function paletteClose() {
  await win.keyboard.press('Escape');
  await win.waitForTimeout(300);
}
async function pinToggle(id) {
  const row = win.locator(`[data-palette-tool-id="${id}"]`).first();
  await row.locator('[data-palette-pin-toggle]').click();
  await win.waitForTimeout(650);
  return win.evaluate(() => {
    const n = document.querySelector('[data-command-palette-notice]');
    return n ? n.textContent.trim() : null;
  });
}
async function paletteRowState(id) {
  return win.evaluate((tid) => {
    const row = document.querySelector(`[data-palette-tool-id="${tid}"]`);
    const dock = Array.from(document.querySelectorAll('[data-dock-verb]')).map((v) => v.getAttribute('data-dock-verb'));
    return {
      pinned: row ? row.getAttribute('data-palette-pinned') : null,
      pinState: row && row.querySelector('[data-palette-pin-toggle]') ? row.querySelector('[data-palette-pin-toggle]').getAttribute('data-palette-pin-state') : null,
      inDock: dock.includes(tid),
      dockCount: dock.length,
    };
  }, id);
}
async function dockIds() {
  return win.evaluate(() => Array.from(document.querySelectorAll('[data-dock-verb]')).map((v) => v.getAttribute('data-dock-verb')));
}
async function loadSettings() {
  const res = await win.evaluate(() => window.tflex.loadSettings());
  return res && res.ok ? res.value : null;
}

// ---------------------------------------------------------------------------
// DEF-351 — the page pill's range readout must REPLACE on type, never append.
// ---------------------------------------------------------------------------
test('DEF-351 page pill replaces on type in TWO/FOUR (1-2 + 4 -> row 3-4; 3 + 6 -> row 5-6)', async () => {
  await boot();
  await openSample('report.pdf');
  await win.locator('[data-page-layout-option="two"]').click();
  await win.waitForTimeout(1400);

  const resting = await win.evaluate(PAGE_STATE);
  console.log(`[P40-DEF351 two resting] ${JSON.stringify(resting)}`);
  expect(resting.value, 'TWO resting readout is the row range 1-2').toBe('1-2');

  // Sequence A: click the pill, type 4 -> must REPLACE (never 14), jump to row 3-4.
  const input = win.locator('[data-page-pill] .page-input').first();
  await input.click();
  await win.waitForTimeout(200);
  const afterClick = await win.evaluate(PAGE_STATE);
  console.log(`[P40-DEF351 after click] ${JSON.stringify(afterClick)}`);
  expect(afterClick.value, 'focus swaps the range to the numeric page').toBe('1');
  expect(afterClick.ss, 'selection starts at 0').toBe(0);
  expect(afterClick.se, 'the numeric page is fully selected').toBe(afterClick.value.length);
  await win.keyboard.type('4');
  await win.waitForTimeout(200);
  const afterType = await win.evaluate(PAGE_STATE);
  console.log(`[P40-DEF351 after type 4] ${JSON.stringify(afterType)}`);
  expect(afterType.value, 'typing 4 REPLACES the selected page, never appends to 14').toBe('4');
  await win.keyboard.press('Enter');
  await win.waitForTimeout(1500);
  const jumped = await win.evaluate(PAGE_STATE);
  console.log(`[P40-DEF351 after Enter] ${JSON.stringify(jumped)}`);
  expect(jumped.value, 'the readout names the row beginning at 4').toBe('3-4');
  expect(jumped.currentPage, 'never page 14').not.toBe(14);
  await win.screenshot({ path: path.join(SHOTS, 'def-351-page-pill-jump.png') });

  // Sequence B: the ADV "3 + 6" case. Blur first so the next click re-runs the
  // onFocus swap (an already-focused input would not fire onFocus again; the
  // click then selects the whole range, which still replaces correctly).
  await win.evaluate(() => { const a = document.activeElement; if (a && a.blur) a.blur(); });
  await win.waitForTimeout(250);
  await input.click();
  await win.waitForTimeout(200);
  const bClick = await win.evaluate(PAGE_STATE);
  console.log(`[P40-DEF351 B after click] ${JSON.stringify(bClick)}`);
  expect(bClick.value, 'B: focus swaps to the row first page 3').toBe('3');
  expect(bClick.ss, 'B: the numeric page is selected from the start').toBe(0);
  expect(bClick.se, 'B: the whole numeric page is selected').toBe(1);
  await win.keyboard.type('6');
  await win.waitForTimeout(200);
  const bType = await win.evaluate(PAGE_STATE);
  console.log(`[P40-DEF351 B after type 6] ${JSON.stringify(bType)}`);
  expect(bType.value, 'B: typing 6 REPLACES, never 63').toBe('6');
  await win.keyboard.press('Enter');
  await win.waitForTimeout(1500);
  const bJump = await win.evaluate(PAGE_STATE);
  console.log(`[P40-DEF351 B after Enter] ${JSON.stringify(bJump)}`);
  expect(bJump.value, 'B: the jump landed on the row beginning at 6 (5-6), not refused').toBe('5-6');
  expect(bJump.currentPage, 'B: never a two-digit 63/14').not.toBe(63);

  // FOUR layout: the same replace-on-type contract.
  await win.locator('[data-page-layout-option="four"]').click();
  await win.waitForTimeout(1400);
  await input.click();
  await win.waitForTimeout(200);
  await win.keyboard.type('4');
  await win.waitForTimeout(200);
  const fourType = await win.evaluate(PAGE_STATE);
  console.log(`[P40-DEF351 four after type 4] ${JSON.stringify(fourType)}`);
  expect(fourType.value, 'FOUR: typing 4 replaces').toBe('4');
  await win.keyboard.press('Enter');
  await win.waitForTimeout(1500);
  const fourJump = await win.evaluate(PAGE_STATE);
  console.log(`[P40-DEF351 four after Enter] ${JSON.stringify(fourJump)}`);
  expect(fourJump.value, 'FOUR: the jump landed on the row beginning at 4').toBe('3-4');
});

// ---------------------------------------------------------------------------
// DEF-352 — restoring a removed stage-default with FOUR explicit pins.
// ---------------------------------------------------------------------------
test('DEF-352 a removed stage-default restores from the palette at the 4-pin cap', async () => {
  const userData = path.join(os.tmpdir(), `tflex-p40-def352-${Date.now()}`);
  fs.mkdirSync(userData, { recursive: true });
  await boot(userData);
  await openSample('report.pdf');

  // 1. Un-pin the PAGES stage default `merge` from the palette.
  await paletteSearch('merge');
  const mergeBefore = await paletteRowState('merge');
  console.log(`[P40-DEF352 merge before] ${JSON.stringify(mergeBefore)}`);
  expect(mergeBefore.pinned, 'merge starts pinned (a PAGES default)').toBe('true');
  const unpinNotice = await pinToggle('merge');
  await paletteClose();
  const dockAfterUnpin = await dockIds();
  console.log(`[P40-DEF352 unpin] notice=${JSON.stringify(unpinNotice)} dockHasMerge=${dockAfterUnpin.includes('merge')} dockCount=${dockAfterUnpin.length}`);
  expect(dockAfterUnpin, 'un-pinning merge drops it from the dock').not.toContain('merge');

  // 2. Fill the explicit-pin cap with four cross-stage tools.
  for (const id of ['annotate', 'sign', 'stamp', 'watermark']) {
    await paletteSearch(id);
    const notice = await pinToggle(id);
    console.log(`[P40-DEF352 pin ${id}] notice=${JSON.stringify(notice)}`);
    await paletteClose();
  }
  const s1 = await loadSettings();
  console.log(`[P40-DEF352 four pins] dockPins=${JSON.stringify(s1 && s1.dockPins)}`);
  expect((s1 && s1.dockPins) || [], 'four explicit pins are stored').toHaveLength(4);

  // 3. Restore merge: a stage-default restore needs no pin slot.
  await paletteSearch('merge');
  const beforeRestore = await paletteRowState('merge');
  const restoreNotice = await pinToggle('merge');
  const afterRestore = await paletteRowState('merge');
  await paletteClose();
  const s2 = await loadSettings();
  const dockAfterRestore = await dockIds();
  console.log(`[P40-DEF352 restore] before=${JSON.stringify(beforeRestore)} notice=${JSON.stringify(restoreNotice)} after=${JSON.stringify(afterRestore)}`);
  console.log(`[P40-DEF352 dock contents] ${JSON.stringify(dockAfterRestore)}`);
  console.log(`[P40-DEF352 settings] dockPins=${JSON.stringify(s2 && s2.dockPins)} dockUnpinned=${JSON.stringify(s2 && s2.dockUnpinned)}`);
  expect(restoreNotice, 'no false "Dock is full" refusal').not.toContain('Dock is full');
  expect(afterRestore.pinned, 'the palette now shows merge pinned').toBe('true');
  expect(dockAfterRestore, 'merge is back in the dock').toContain('merge');
  expect((s2 && s2.dockPins) || [], 'the restore wrote no new explicit pin').toHaveLength(4);
  expect((s2 && s2.dockUnpinned) || [], 'merge left dockUnpinned').not.toContain('merge');
});

// ---------------------------------------------------------------------------
// DEF-353 — hostile settings: an id present in BOTH dockPins and dockUnpinned.
// ---------------------------------------------------------------------------
const HOSTILE_SETTINGS = JSON.stringify({
  theme: 'dark',
  dockPins: ['__nope__', 'rotate', 'rotate', 'delete', 'delete', 'annotate', 'sign', 'watermark', 'merge'],
  dockUnpinned: ['merge', 'merge', '__bogus__', 'not-real-tool', 'delete'],
  recentFiles: [{ path: 'C:\\does\\not\\exist.pdf', name: 'ghost.pdf' }],
});

async function paletteVsDock() {
  await paletteOpen();
  await win.waitForTimeout(400);
  return win.evaluate(() => {
    const rows = Array.from(document.querySelectorAll('[data-palette-row="tool"]')).map((r) => ({
      id: r.getAttribute('data-palette-tool-id'),
      pinned: r.getAttribute('data-palette-pinned'),
    }));
    const dock = Array.from(document.querySelectorAll('[data-dock-verb]')).map((v) => v.getAttribute('data-dock-verb'));
    return {
      disagree: rows.filter((r) => (r.pinned === 'true') !== dock.includes(r.id)).map((r) => r.id),
      deleteRow: rows.find((r) => r.id === 'delete') || null,
      dockHasDelete: dock.includes('delete'),
      dock,
    };
  });
}

test('DEF-353 hostile settings (id in both lists) keep palette and dock in agreement across restart', async () => {
  const userData = path.join(os.tmpdir(), `tflex-p40-def353-${Date.now()}`);
  fs.mkdirSync(userData, { recursive: true });
  fs.writeFileSync(path.join(userData, 'settings.json'), HOSTILE_SETTINGS, 'utf8');

  await boot(userData);
  await openSample('report.pdf');
  const first = await paletteVsDock();
  console.log(`[P40-DEF353 launch1] disagree=${JSON.stringify(first.disagree)} deleteRow=${JSON.stringify(first.deleteRow)} dockHasDelete=${first.dockHasDelete} dock=${JSON.stringify(first.dock)}`);
  expect(first.disagree, 'launch 1: palette membership matches the dock for every tool').toEqual([]);
  expect(first.deleteRow && first.deleteRow.pinned, 'the disputed id reads unpinned in the palette').toBe('false');
  expect(first.dockHasDelete, 'the disputed id is not rendered by the dock (un-pin wins)').toBe(false);
  await hardClose(app, 'p40-def353a');
  app = null;
  win = null;

  // Restart with the SAME hand-written profile.
  await boot(userData);
  await openSample('report.pdf');
  const second = await paletteVsDock();
  console.log(`[P40-DEF353 launch2] disagree=${JSON.stringify(second.disagree)} deleteRow=${JSON.stringify(second.deleteRow)} dockHasDelete=${second.dockHasDelete} dock=${JSON.stringify(second.dock)}`);
  expect(second.disagree, 'launch 2 (restart): palette membership still matches the dock').toEqual([]);
  expect(second.deleteRow && second.deleteRow.pinned, 'restart: the disputed id still reads unpinned').toBe('false');
  expect(second.dockHasDelete, 'restart: the disputed id is still not rendered by the dock').toBe(false);
});

// ---------------------------------------------------------------------------
// DEF-354 — the palette's "Recent"/"Global" tags must clear 4.5:1.
// ---------------------------------------------------------------------------
const MEASURE_TAGS = () => {
  function parse(css) {
    const m = css.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x.trim()));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  function lum(c) {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }
  function ratio(a, b) {
    const l1 = lum(a), l2 = lum(b);
    return Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100;
  }
  function effBg(el) {
    let n = el;
    while (n) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.01) {
        if (c.a >= 0.999) return c;
        const p = effBg(n.parentElement) || { r: 255, g: 255, b: 255, a: 1 };
        return { r: c.r * c.a + p.r * (1 - c.a), g: c.g * c.a + p.g * (1 - c.a), b: c.b * c.a + p.b * (1 - c.a), a: 1 };
      }
      n = n.parentElement;
    }
    return { r: 255, g: 255, b: 255, a: 1 };
  }
  const out = [];
  for (const tag of document.querySelectorAll('.command-palette-tag')) {
    const cs = getComputedStyle(tag);
    const fg = parse(cs.color);
    if (!fg) continue;
    const bg = effBg(tag);
    const fga = fg.a < 1 ? { r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 } : fg;
    out.push({
      stage: tag.getAttribute('data-stage'),
      text: (tag.textContent || '').trim(),
      ratio: ratio(fga, bg),
      color: cs.color,
      bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`,
    });
  }
  return out;
};

test('DEF-354 palette Recent/Global tags clear 4.5:1 in all three themes', async () => {
  await boot();
  await openSample('report.pdf');
  await paletteOpen();

  const rows = [];
  for (const theme of THEMES) {
    await setTheme(theme);
    const measured = await win.evaluate(MEASURE_TAGS);
    for (const m of measured) {
      console.log(`[P40-DEF354 ${theme}] stage=${m.stage} text=${JSON.stringify(m.text)} color=${m.color} bg=${m.bg} ratio=${m.ratio}`);
    }
    rows.push({ theme, measured });
    if (theme === 'dark') await win.screenshot({ path: path.join(SHOTS, 'def-354-palette-tags-dark.png') });
  }
  await paletteClose();

  const recent = rows.flatMap((r) => r.measured.filter((m) => m.stage === 'recent'));
  const global = rows.flatMap((r) => r.measured.filter((m) => m.stage === 'global'));
  expect(recent.length, 'at least one Recent tag was measured per theme').toBeGreaterThanOrEqual(THEMES.length);
  expect(global.length, 'at least one Global tag was measured per theme').toBeGreaterThanOrEqual(THEMES.length);
  for (const { theme, measured } of rows) {
    expect(measured.some((m) => m.stage === 'recent'), `${theme}: a Recent tag is present`).toBe(true);
    expect(measured.some((m) => m.stage === 'global'), `${theme}: a Global tag is present`).toBe(true);
  }
  const failures = [];
  for (const { theme, measured } of rows) {
    for (const m of measured) {
      if (m.ratio < 4.5) failures.push(`${theme} "${m.text}"(${m.stage}) ${m.ratio}:1 (${m.color} on ${m.bg})`);
    }
  }
  expect(failures, `tags below 4.5:1: ${failures.join(' | ')}`).toEqual([]);
});

// ---------------------------------------------------------------------------
// DEF-355 — pressed Open label (>=4.5) and dark active page-layout icon (>=3).
// ---------------------------------------------------------------------------
test('DEF-355 pressed Open label >=4.5 and dark active page-layout icon >=3', async () => {
  await boot();
  await openSample('report.pdf');

  const rows = [];
  for (const theme of THEMES) {
    await setTheme(theme);
    // Active page-layout option: its ICON colour is the svg's inherited colour.
    const layoutIcon = await win.evaluate(SAMPLE_ONE, { sel: '[data-page-layout-option][aria-pressed="true"] svg' });
    // Pressed Open: hold the mouse down over the button, measure, release away.
    const box = await win.locator('[data-toolbar-open]').first().boundingBox();
    expect(box, 'the Open control has a box').not.toBeNull();
    await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await win.mouse.down();
    await win.waitForTimeout(180);
    const pressedOpen = await win.evaluate(SAMPLE_ONE, { sel: '[data-toolbar-open]' });
    await win.mouse.move(2, 2);
    await win.mouse.up();
    await win.waitForTimeout(150);
    console.log(`[P40-DEF355 ${theme}] pressedOpen=${JSON.stringify(pressedOpen)} activeLayoutIcon=${JSON.stringify(layoutIcon)}`);
    rows.push({ theme, pressedOpen, layoutIcon });
    if (theme === 'dark') await win.screenshot({ path: path.join(SHOTS, 'def-355-open-layout-dark.png') });
  }

  for (const { theme, pressedOpen, layoutIcon } of rows) {
    expect(pressedOpen && pressedOpen.ratio, `${theme}: pressed Open label >= 4.5:1`).toBeGreaterThanOrEqual(4.5);
    expect(layoutIcon && layoutIcon.ratio, `${theme}: active page-layout icon >= 3:1`).toBeGreaterThanOrEqual(3);
  }
});

// ---------------------------------------------------------------------------
// DEF-356 — Ctrl+S on a CLEAN on-disk document must not rewrite the file.
// ---------------------------------------------------------------------------
test('DEF-356 Ctrl+S on a CLEAN on-disk document is a no-op; a modified document still saves', async () => {
  const tempPath = getSamplePath('report.pdf');
  await boot();
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, tempPath);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);

  const cleanState = await win.evaluate(() => {
    const s = document.querySelector('[data-toolbar-save]');
    return { saveDisabled: s ? s.disabled : null };
  });
  const sha0 = sha256(tempPath);
  const mt0 = mtimeMs(tempPath);
  const size0 = fs.statSync(tempPath).size;
  console.log(`[P40-DEF356 clean before] saveDisabled=${cleanState.saveDisabled} sha=${sha0.slice(0, 16)} mtime=${mt0} size=${size0}`);
  expect(cleanState.saveDisabled, 'the toolbar Save is disabled on the clean on-disk doc').toBe(true);

  await win.keyboard.press('Control+s');
  await win.waitForTimeout(1800);
  const sha1 = sha256(tempPath);
  const mt1 = mtimeMs(tempPath);
  const size1 = fs.statSync(tempPath).size;
  console.log(`[P40-DEF356 clean after Ctrl+S] sha=${sha1.slice(0, 16)} mtime=${mt1} size=${size1} shaChanged=${sha1 !== sha0} mtimeChanged=${mt1 !== mt0}`);
  expect(sha1, 'Ctrl+S on a CLEAN document did not rewrite the file').toBe(sha0);
  expect(mt1, 'the file mtime is unchanged (no save occurred)').toBe(mt0);
  expect(size1, 'the file size is unchanged').toBe(size0);

  // Control: modify the document, then Ctrl+S must save normally.
  await openDockVerb(win, 1, 'rotate');
  await win.waitForTimeout(1400);
  const dirty = await win.evaluate(() => {
    const s = document.querySelector('[data-toolbar-save]');
    return { saveDisabled: s ? s.disabled : null };
  });
  console.log(`[P40-DEF356 modified] saveDisabled=${dirty.saveDisabled}`);
  expect(dirty.saveDisabled, 'the toolbar Save is enabled once modified').toBe(false);

  await win.keyboard.press('Control+s');
  await win.waitForTimeout(2000);
  const sha2 = sha256(tempPath);
  const afterSave = await win.evaluate(() => {
    const s = document.querySelector('[data-toolbar-save]');
    return { saveDisabled: s ? s.disabled : null };
  });
  console.log(`[P40-DEF356 modified after Ctrl+S] sha=${sha2.slice(0, 16)} shaChanged=${sha2 !== sha1} saveDisabled=${afterSave.saveDisabled}`);
  expect(sha2, 'Ctrl+S on a MODIFIED document rewrote the file (the save path works)').not.toBe(sha1);
  expect(afterSave.saveDisabled, 'after the save the document is clean again').toBe(true);
});
