// TFL-1190 — QA independent FIX-READY re-verification of TFL-1189's fix for
// DEF-628 (Toggle Theme coherence), DEF-629 (strict range tokens) and DEF-630
// (span endpoints name both ends). Drives the REAL Electron app through the
// canonical launchApp helper. No src/ or test/ file is touched.
delete process.env.ELECTRON_RUN_AS_NODE;

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const {
  hardClose,
  openPreferences,
  runTool,
  toggleThemeViaAppMenu,
} = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (n) => path.join(SHOTS, n);

const MALFORMED_WORDING = 'Enter pages like 1-3 or 2,4.';
const EMPTY_WORDING = 'Enter at least one page (e.g. 1-3).';

let app = null;
let win = null;
test.setTimeout(300000);

function freshDir(tag) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `tfl1190-${tag}-`));
}

function readSettings(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_) {
    return null;
  }
}

async function openReport() {
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(800);
}

function readRangeField() {
  return win.evaluate(() => {
    const s = document.querySelector('#split-range-status');
    const inp = document.querySelector('#split-page-range');
    const btn = document.querySelector('[data-dialog-action="confirm"]');
    return {
      state: s === null ? null : s.getAttribute('data-range-state'),
      text: s === null ? null : (s.textContent || '').trim(),
      value: inp === null ? null : inp.value,
      invalid: inp === null ? null : inp.getAttribute('aria-invalid'),
      disabled: btn === null ? null : btn.disabled,
    };
  });
}

async function pollDisk(settingsPath, pred, ms = 5000) {
  let parsed = null;
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    parsed = readSettings(settingsPath);
    if (parsed && pred(parsed)) return parsed;
    await win.waitForTimeout(80);
  }
  return parsed;
}

test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl1190');
  app = null;
  win = null;
});

// ---------------------------------------------------------------------------
// DEF-628 — View > Toggle Theme keeps theme/themeDefault coherent (live).
// ---------------------------------------------------------------------------
test('DEF-628: Toggle Theme moves theme and themeDefault together; prefs agree', async () => {
  const dir = freshDir('def628');
  const settingsPath = path.join(dir, 'settings.json');

  app = await launchApp([], dir);
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });

  const snaps = [];
  for (let i = 0; i < 3; i += 1) {
    await toggleThemeViaAppMenu(win);
    const disk = await pollDisk(settingsPath, (p) => p.theme && p.theme === p.themeDefault);
    const live = await win.evaluate(() => document.documentElement.dataset.theme);
    snaps.push({ toggle: i + 1, live, diskTheme: disk.theme, diskDefault: disk.themeDefault });
    expect(disk.themeDefault, `toggle#${i + 1} disk theme===themeDefault`).toBe(disk.theme);
    expect(live, `toggle#${i + 1} live data-theme matches disk theme`).toBe(disk.theme);
  }
  console.log(`[tfl1190] DEF-628 snaps=${JSON.stringify(snaps)}`);
  const distinct = new Set(snaps.map((s) => s.live));
  expect(distinct.size, 'DEF-628 the cycle advances through distinct themes').toBe(3);
  await win.screenshot({ path: shot('tfl1190_def628_toggle.png') });

  const shell = await win.evaluate(() => document.documentElement.dataset.theme);
  await openPreferences(win);
  await win.waitForTimeout(300);
  const dropdown = await win.locator('[data-prefs-theme-default]').inputValue();
  console.log(`[tfl1190] DEF-628 shell=${shell} prefsThemeDefault=${dropdown}`);
  expect(dropdown, 'DEF-628 Preferences Theme default reads the shell theme').toBe(shell);
  await win.screenshot({ path: shot('tfl1190_def628_prefs.png') });

  const target = shell === 'dark' ? 'light' : 'dark';
  await win.selectOption('[data-prefs-theme-default]', target);
  await expect
    .poll(() => win.evaluate(() => document.documentElement.dataset.theme), { timeout: 5000 })
    .toBe(target);
  const disk2 = await pollDisk(settingsPath, (p) => p.theme === target && p.themeDefault === target);
  expect(disk2.theme, 'DEF-628 dropdown pick persists theme').toBe(target);
  expect(disk2.themeDefault, 'DEF-628 dropdown pick persists themeDefault').toBe(target);
});

// ---------------------------------------------------------------------------
// DEF-629 — malformed tokens are syntax errors; valid tokens stay valid.
// ---------------------------------------------------------------------------
test('DEF-629: trailing-garbage tokens are malformed, gate disabled, input kept', async () => {
  app = await launchApp([], freshDir('def629'));
  win = await app.firstWindow();
  await openReport();
  await runTool(win, 'extract');
  await win.waitForSelector('#split-page-range', { timeout: 10000 });
  await win.waitForTimeout(300);

  const rows = [];
  const malformed = ['1abc', '2-3x', '1.9', '12px'];
  for (const v of malformed) {
    await win.fill('#split-page-range', v);
    await win.waitForTimeout(200);
    const r = await readRangeField();
    rows.push({ input: v, ...r });
    expect(r.state, `DEF-629 "${v}" classified malformed`).toBe('malformed');
    expect(r.value, `DEF-629 "${v}" input preserved`).toBe(v);
    expect(r.invalid, `DEF-629 "${v}" aria-invalid`).toBe('true');
    expect(r.text, `DEF-629 "${v}" wording unchanged`).toBe(MALFORMED_WORDING);
    expect(r.disabled, `DEF-629 "${v}" Extract disabled`).toBe(true);
  }

  const valid = [
    { input: '1,3,5-7', selected: 5 },
    { input: '007', selected: 1 },
    { input: ' 10 - 12 ', selected: 3 },
  ];
  for (const c of valid) {
    await win.fill('#split-page-range', c.input);
    await win.waitForTimeout(200);
    const r = await readRangeField();
    rows.push({ input: c.input, ...r });
    expect(r.state, `DEF-629 "${c.input}" classified valid`).toBe('valid');
    expect(r.disabled, `DEF-629 "${c.input}" Extract enabled`).toBe(false);
    expect(r.text, `DEF-629 "${c.input}" shows selected count`).toBe(
      `${c.selected} page${c.selected === 1 ? '' : 's'} selected`,
    );
  }

  await win.fill('#split-page-range', '');
  await win.waitForTimeout(200);
  const empty = await readRangeField();
  rows.push({ input: '<empty>', ...empty });
  expect(empty.state, 'DEF-629 empty state').toBe('empty');
  expect(empty.text, 'DEF-629 empty wording unchanged').toBe(EMPTY_WORDING);
  expect(empty.disabled, 'DEF-629 empty gate disabled').toBe(true);

  console.log(`[tfl1190] DEF-629 rows=${JSON.stringify(rows)}`);
  await win.screenshot({ path: shot('tfl1190_def629_malformed.png') });
});

// ---------------------------------------------------------------------------
// DEF-630 — out-of-bounds spans name BOTH endpoints.
// ---------------------------------------------------------------------------
test('DEF-630: wholly-above-range spans name both ends, in-bounds end stays unnamed', async () => {
  app = await launchApp([], freshDir('def630'));
  win = await app.firstWindow();
  await openReport();
  await runTool(win, 'extract');
  await win.waitForSelector('#split-page-range', { timeout: 10000 });
  await win.waitForTimeout(300);

  const cases = [
    { input: '50-60', message: "Pages 50, 60 are outside the document's 1-34 pages." },
    { input: '35-40', message: "Pages 35, 40 are outside the document's 1-34 pages." },
    { input: '1-999', message: "Page 999 is outside the document's 1-34 pages." },
  ];
  for (const c of cases) {
    await win.fill('#split-page-range', c.input);
    await win.waitForTimeout(200);
    const r = await readRangeField();
    console.log(`[tfl1190] DEF-630 "${c.input}" -> "${r.text}" (state=${r.state} disabled=${r.disabled})`);
    expect(r.state, `DEF-630 "${c.input}" out-of-bounds`).toBe('out-of-bounds');
    expect(r.text, `DEF-630 "${c.input}" message`).toBe(c.message);
    expect(r.disabled, `DEF-630 "${c.input}" Extract disabled`).toBe(true);
  }
  await win.screenshot({ path: shot('tfl1190_def630_span.png') });
});

// ---------------------------------------------------------------------------
// Blast radius — the nearest interacting sibling classifier call site
// (Delete pages) still gates out-of-bounds ranges.
// ---------------------------------------------------------------------------
test('Blast radius: Delete pages dialog still gates out-of-bounds ranges', async () => {
  app = await launchApp([], freshDir('blast'));
  win = await app.firstWindow();
  await openReport();
  await runTool(win, 'delete');
  await win.waitForSelector('[data-delete-pages-dialog]', { timeout: 10000 });
  await win.locator('[data-delete-mode="range"]').first().click();
  await win.waitForSelector('[data-delete-range]', { timeout: 8000 });

  const readDelete = () => win.evaluate(() => {
    const inp = document.querySelector('[data-delete-range]');
    const btn = document.querySelector('[data-delete-confirm]');
    const err = document.querySelector('[data-delete-range-error]');
    return {
      value: inp === null ? null : inp.value,
      disabled: btn === null ? null : btn.disabled,
      error: err === null ? null : (err.textContent || '').trim(),
    };
  });

  const cases = [
    { input: '50-60', disabled: true },
    { input: '1-999', disabled: true },
    { input: '2-5', disabled: false },
  ];
  const rows = [];
  for (const c of cases) {
    await win.fill('[data-delete-range]', c.input);
    await win.waitForTimeout(200);
    const r = await readDelete();
    rows.push({ input: c.input, ...r });
    expect(r.value, `blast "${c.input}" input preserved`).toBe(c.input);
    expect(r.disabled, `blast "${c.input}" Delete gating`).toBe(c.disabled);
  }
  console.log(`[tfl1190] blast-radius Delete rows=${JSON.stringify(rows)}`);
  await win.screenshot({ path: shot('tfl1190_blast_delete.png') });
});
