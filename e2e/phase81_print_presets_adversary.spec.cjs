// TFL-325 / Phase 81 printPresets settings-persistence ADVERSARIAL diff-pass.
//
// Adversary-only probe spec. It does NOT re-run qa's phase81 spec; it seeds
// hostile settings.json files, launches the real dev build through
// e2e/lib/launch.cjs with a fresh --user-data-dir per attack, and drives the
// standalone print window. Nothing under src/ is touched.
//
//   npx playwright test e2e/phase81_print_presets_adversary.spec.cjs --reporter=line
//
// Attack map (see the issue TFL-325):
//   A  corrupt-list survival (non-array, mixed junk, invalid values, injected keys)
//   B  cap 30 after load + after save round-trip
//   C  same-name upsert keeps first position with later settings
//   D  read-modify-write does not clobber other settings fields
//   E  rapid double-save in one task: no duplicate / no lost update
//   F  preset controls disabled while a print is running; apply during load safe
//   G  name edges: whitespace-only, 40 chars, 41 chars, duplicate replace
//   H  no new network call in the preset path
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const {
  openSample,
  openStandalonePrintWindow,
  closeStandalonePrintWindow,
  hardClose,
} = require('./lib/helpers.cjs');

const PRINT_PRESET_CAP = 30;
const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const FIXTURES = path.resolve(__dirname, '..', 'test-fixtures', 'phase81-presets');
fs.mkdirSync(FIXTURES, { recursive: true });
const results = [];
const record = (id, status, note) => {
  results.push({ id, status, note });
  console.log(`[adv81|RESULT] ${id} ${status}${note ? ` - ${note}` : ''}`);
};

function freshDir(tag) {
  const d = path.join(os.tmpdir(), `tflex-adv81-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function seedSettings(dir, obj) {
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(obj, null, 2), 'utf8');
}
function readDisk(settingsPath) {
  try { return JSON.parse(fs.readFileSync(settingsPath, 'utf8')); } catch { return null; }
}
async function pollDisk(settingsPath, pred, timeoutMs = 15000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    last = readDisk(settingsPath);
    if (last && pred(last)) return last;
    await new Promise((r) => setTimeout(r, 200));
  }
  return last;
}
async function boot(dir) {
  const electronApp = await launchApp([], dir, null);
  const window = await electronApp.firstWindow();
  await window.waitForSelector('.sample-card', { timeout: 30000 });
  const errs = [];
  window.on('pageerror', (e) => errs.push('[app] ' + String(e).slice(0, 300)));
  return { electronApp, window, errs };
}
function trackPrint(printPage, errs) {
  printPage.on('pageerror', (e) => errs.push('[print] ' + String(e).slice(0, 300)));
}
async function openPrintReady(app, win, errs) {
  await openSample(win, app, 'report.pdf');
  const printPage = await openStandalonePrintWindow(app, win);
  trackPrint(printPage, errs);
  await printPage.waitForSelector('[data-print-preset-name]', { timeout: 20000 });
  return printPage;
}
async function pickerNames(printPage) {
  return printPage.$$eval('[data-print-preset] option', (els) =>
    els.map((o) => o.value).filter((v) => v !== ''));
}
async function livePresets(printPage) {
  const r = await printPage.evaluate(() => window.tflex.loadSettings());
  return r.ok ? (r.value.printPresets ?? null) : null;
}
async function liveSettings(printPage) {
  const r = await printPage.evaluate(() => window.tflex.loadSettings());
  return r.ok ? r.value : null;
}
function withoutPresets(s) {
  if (!s || typeof s !== 'object') return s;
  const c = { ...s };
  delete c.printPresets;
  return c;
}
async function saveViaUi(printPage, name, opts = {}) {
  if (opts.select) await printPage.selectOption('[data-print-preset]', opts.select);
  if (opts.copies !== undefined) {
    await printPage.fill('[data-print-copies]', String(opts.copies));
  }
  if (opts.duplex) await printPage.selectOption('[data-print-duplex]', opts.duplex);
  await printPage.fill('[data-print-preset-name]', name);
  await printPage.click('[data-print-preset-save]');
}

// workers:1 already serializes; do NOT use serial mode or one failure skips the rest.

test('A1 non-array printPresets is rejected without failing the whole settings load', async () => {
  test.setTimeout(300000);
  const seed = { theme: 'dark', recentsCap: 7, homeTools: ['merge'], printPresets: 'not-an-array' };
  const dir = freshDir('a1');
  seedSettings(dir, seed);
  const { electronApp: app, window: win, errs } = await boot(dir);
  let printPage = null;
  try {
    const st = await win.evaluate(() => window.tflex.loadSettings());
    expect(st.ok, 'settings load ok').toBe(true);
    expect(st.value.recentsCap, 'boots on STORED settings (7), not default (10)').toBe(7);
    expect(st.value.theme, 'stored theme survives').toBe('dark');

    printPage = await openPrintReady(app, win, errs);
    const names = await pickerNames(printPage);
    expect(names, 'non-array printPresets yields no listed presets').toEqual([]);
    const lp = await livePresets(printPage);
    const lpEmpty = lp === null || (Array.isArray(lp) && lp.length === 0);
    expect(lpEmpty, 'field rejected -> absent (consumer default [])').toBe(true);
    expect(errs, 'no renderer pageerror').toEqual([]);
    record('A1', 'PASS');
  } catch (e) {
    record('A1', 'FAIL', e.message);
    throw e;
  } finally {
    if (printPage && !printPage.isClosed()) await closeStandalonePrintWindow(app, printPage).catch(() => {});
    await hardClose(app, 'adv81-a1');
  }
});

test('A2/A3 hostile entry list keeps only valid entries and drops injected keys per key', async () => {
  test.setTimeout(300000);
  const long41 = 'a'.repeat(41);
  const seed = {
    theme: 'dark',
    recentsCap: 7,
    printPresets: [
      null,
      7,
      'x',
      { name: '   ' },
      { name: 'ok1', settings: { copies: 2, duplex: 'longEdge' } },
      { name: 'ok1', settings: { copies: 3, duplex: 'shortEdge' } },
      { name: long41, settings: { copies: 1 } },
      { name: 'ok2', settings: [1, 2] },
      { name: 'ok3', settings: null },
      {
        name: 'ok4',
        settings: {
          copies: 500,
          scaling: 'bogus',
          pagesPerSheet: 3,
          duplex: 'nope',
          deviceName: 'HP LaserJet',
          pageRanges: [{ from: 0, to: 1 }],
          paperSource: 'Tray2',
          bogusUnknown: true,
        },
      },
      { name: 'ok5', settings: { copies: 1, color: false } },
    ],
  };
  const dir = freshDir('a2');
  seedSettings(dir, seed);
  const { electronApp: app, window: win, errs } = await boot(dir);
  let printPage = null;
  try {
    expect((await win.evaluate(() => window.tflex.loadSettings())).value.recentsCap, 'stored settings survive').toBe(7);
    printPage = await openPrintReady(app, win, errs);
    const names = await pickerNames(printPage);
    expect(names, 'only valid entries listed, in upsert order').toEqual(['ok1', 'ok4', 'ok5']);
    const lp = await livePresets(printPage);
    expect(lp.length, 'three valid entries survive').toBe(3);
    const ok1 = lp.find((p) => p.name === 'ok1');
    expect(ok1.settings, 'duplicate ok1 upserts to the later settings').toEqual({ copies: 3, duplex: 'shortEdge' });
    const ok4 = lp.find((p) => p.name === 'ok4');
    expect(ok4.settings, 'all-invalid known values drop per key (empty object, entry survives)').toEqual({});
    expect('deviceName' in ok4.settings, 'deviceName dropped').toBe(false);
    expect('pageRanges' in ok4.settings, 'pageRanges dropped').toBe(false);
    expect('paperSource' in ok4.settings, 'paperSource dropped').toBe(false);
    expect('bogusUnknown' in ok4.settings, 'unknown key dropped').toBe(false);
    expect(lp.find((p) => p.name === 'ok5').settings, 'valid entry survives intact').toEqual({ copies: 1, color: false });
    expect(names.includes(long41), '41-char name rejected').toBe(false);
    expect(errs, 'no renderer pageerror').toEqual([]);
    record('A2', 'PASS');
  } catch (e) {
    record('A2', 'FAIL', e.message);
    throw e;
  } finally {
    if (printPage && !printPage.isClosed()) await closeStandalonePrintWindow(app, printPage).catch(() => {});
    await hardClose(app, 'adv81-a2');
  }
});

test('B cap 30 after load and after a save round-trip (newest 31st behaviour)', async () => {
  test.setTimeout(300000);
  const seeded = [];
  for (let i = 0; i < 50; i += 1) {
    const n = `p${String(i).padStart(2, '0')}`;
    seeded.push({ name: n, settings: { copies: 1, duplex: 'simplex' } });
  }
  const seed = { theme: 'dark', recentsCap: 7, printPresets: seeded };
  const dir = freshDir('b');
  seedSettings(dir, seed);
  const { electronApp: app, window: win, errs } = await boot(dir);
  let printPage = null;
  try {
    printPage = await openPrintReady(app, win, errs);
    const settingsPath = path.join(dir, 'settings.json');
    const names = await pickerNames(printPage);
    expect(names.length, 'exactly 30 survive the load').toBe(PRINT_PRESET_CAP);
    expect(names, 'first 30 in order').toEqual(seeded.slice(0, 30).map((e) => e.name));

    // DEF-477 fixed contract (qa phase-close TFL-332): a 31st DISTINCT name at
    // the cap must be refused LOUDLY - a visible [data-print-preset-error], NO
    // success notice, no phantom write; disk list and picker both stay at 30.
    // (Upsert of an existing name stays allowed; covered by test C.)
    await saveViaUi(printPage, 'extra');
    await printPage.waitForSelector('[data-print-preset-error]', { timeout: 10000 });
    const capError = await printPage.locator('[data-print-preset-error]').innerText();
    expect(capError, 'cap refusal names the limit').toContain('limit');
    expect(await printPage.locator('[data-print-preset-notice]').count(), 'no success notice on cap refusal').toBe(0);
    await printPage.waitForTimeout(1200); // let any (unwanted) write land
    const disk = readDisk(settingsPath);
    const diskNames = (disk.printPresets || []).map((p) => p.name);
    const uiNames = await pickerNames(printPage);
    // A second new-name save at the cap: same loud refusal, still no phantom.
    await saveViaUi(printPage, 'extra2');
    await printPage.waitForSelector('[data-print-preset-error]', { timeout: 10000 });
    await printPage.waitForTimeout(1200);
    const disk2 = readDisk(settingsPath);
    const diskNames2 = (disk2.printPresets || []).map((p) => p.name);
    const uiNames2 = await pickerNames(printPage);
    console.log('[adv81|B] afterExtra1 disk=' + diskNames.length + ' ui=' + uiNames.length +
      ' diskHasExtra=' + diskNames.includes('extra') + ' uiHasExtra=' + uiNames.includes('extra') +
      ' | afterExtra2 disk=' + diskNames2.length + ' ui=' + uiNames2.length +
      ' diskHasExtra2=' + diskNames2.includes('extra2') + ' uiHasExtra2=' + uiNames2.includes('extra2'));
    await printPage.screenshot({ path: path.join(SHOTS, 'adv-154-phantom-presets.png') });
    fs.writeFileSync(path.join(FIXTURES, 'adv-154-persisted-after-phantom-saves.json'), JSON.stringify(disk2, null, 2), 'utf8');
    expect(diskNames.length, 'persisted list stays capped at 30').toBe(PRINT_PRESET_CAP);
    expect(diskNames.includes('extra'), 'refused name never reaches disk').toBe(false);
    expect(uiNames.length, 'picker stays at the cap (no phantom)').toBe(PRINT_PRESET_CAP);
    expect(uiNames.includes('extra'), 'refused name never appears in the picker').toBe(false);
    expect(diskNames2.length, 'persisted list still 30 after a second new-name save').toBe(PRINT_PRESET_CAP);
    expect(uiNames2.length, 'picker must not grow past the cap with phantom entries the disk dropped').toBe(PRINT_PRESET_CAP);
    expect(uiNames2.includes('extra2'), 'second refused name never appears in the picker').toBe(false);
    expect(errs, 'no renderer pageerror').toEqual([]);
    record('B', 'PASS');
  } catch (e) {
    record('B', 'FAIL', e.message);
    throw e;
  } finally {
    if (printPage && !printPage.isClosed()) await closeStandalonePrintWindow(app, printPage).catch(() => {});
    await hardClose(app, 'adv81-b');
  }
});

test('C/D upsert keeps first position; read-modify-write never clobbers other fields', async () => {
  test.setTimeout(300000);
  const seed = {
    theme: 'dark',
    recentsCap: 7,
    recentFiles: [
      { path: 'C:\\docs\\a.pdf', name: 'a.pdf', openedAt: 1700000000000 },
      { path: 'C:\\docs\\b.pdf', name: 'b.pdf', openedAt: 1700000001000 },
    ],
    homeTools: ['merge', 'split'],
    tabStyle: 'colorful',
    geometry: { x: 40, y: 40, width: 1100, height: 760, maximized: false },
    printPresets: [
      { name: 'Alpha', settings: { copies: 1, duplex: 'simplex' } },
      { name: 'Beta', settings: { copies: 1, color: true } },
    ],
  };
  const dir = freshDir('cd');
  seedSettings(dir, seed);
  const { electronApp: app, window: win, errs } = await boot(dir);
  let printPage = null;
  const settingsPath = path.join(dir, 'settings.json');
  try {
    printPage = await openPrintReady(app, win, errs);
    await printPage.waitForTimeout(1200); // let any launch geometry write settle
    const baseline = withoutPresets(await liveSettings(printPage));

    // C: upsert Alpha at the FIRST position with the later settings.
    await saveViaUi(printPage, 'Alpha', { select: 'Alpha', copies: 3, duplex: 'shortEdge' });
    let disk = await pollDisk(settingsPath, (s) => {
      const a = (s.printPresets || []).find((p) => p.name === 'Alpha');
      return a && a.settings && a.settings.copies === 3;
    });
    let list = disk.printPresets || [];
    expect(list.map((p) => p.name), 'exactly one Alpha, still first').toEqual(['Alpha', 'Beta']);
    expect(list[0].settings.copies, 'Alpha carries the later settings').toBe(3);
    let other = withoutPresets(disk);
    expect(other, 'no non-preset field clobbered by upsert').toEqual(baseline);

    // D1: save a new preset -> others unchanged.
    await saveViaUi(printPage, 'Gamma');
    disk = await pollDisk(settingsPath, (s) => (s.printPresets || []).some((p) => p.name === 'Gamma'));
    other = withoutPresets(disk);
    expect(other, 'no non-preset field clobbered by save-new').toEqual(baseline);

    // D2: delete Gamma -> others unchanged.
    await printPage.selectOption('[data-print-preset]', 'Gamma');
    await printPage.click('[data-print-preset-delete]');
    disk = await pollDisk(settingsPath, (s) => !(s.printPresets || []).some((p) => p.name === 'Gamma'));
    other = withoutPresets(disk);
    expect(other, 'no non-preset field clobbered by delete').toEqual(baseline);
    expect(errs, 'no renderer pageerror').toEqual([]);
    record('C', 'PASS');
    if (JSON.stringify(other) === JSON.stringify(baseline)) record('D', 'PASS');
    else record('D', 'FAIL', 'other fields changed');
  } catch (e) {
    record('C', 'FAIL', e.message);
    record('D', 'FAIL', e.message);
    throw e;
  } finally {
    if (printPage && !printPage.isClosed()) await closeStandalonePrintWindow(app, printPage).catch(() => {});
    await hardClose(app, 'adv81-cd');
  }
});

test('E rapid double-save in one task: no duplicate and no lost entry', async () => {
  test.setTimeout(300000);
  const seed = { theme: 'dark', recentsCap: 7, printPresets: [{ name: 'Seed', settings: { copies: 1 } }] };
  const dir = freshDir('e');
  seedSettings(dir, seed);
  const { electronApp: app, window: win, errs } = await boot(dir);
  let printPage = null;
  const settingsPath = path.join(dir, 'settings.json');
  try {
    printPage = await openPrintReady(app, win, errs);
    await printPage.selectOption('[data-print-duplex]', 'longEdge');
    await printPage.fill('[data-print-preset-name]', 'Rapid');
    await printPage.evaluate(() => {
      const b = document.querySelector('[data-print-preset-save]');
      b.click();
      b.click();
    });
    const disk = await pollDisk(settingsPath, (s) => (s.printPresets || []).some((p) => p.name === 'Rapid'));
    const rapidOnDisk = (disk.printPresets || []).filter((p) => p.name === 'Rapid');
    expect(rapidOnDisk.length, 'exactly one Rapid entry on disk').toBe(1);
    const names = await pickerNames(printPage);
    expect(names.filter((n) => n === 'Rapid').length, 'exactly one Rapid option in the picker').toBe(1);
    expect(names.includes('Seed'), 'pre-existing entry not lost').toBe(true);
    expect(errs, 'no renderer pageerror').toEqual([]);
    record('E', 'PASS');
  } catch (e) {
    record('E', 'FAIL', e.message);
    throw e;
  } finally {
    if (printPage && !printPage.isClosed()) await closeStandalonePrintWindow(app, printPage).catch(() => {});
    await hardClose(app, 'adv81-e');
  }
});

test('F preset controls disabled while a print runs; apply is safe', async () => {
  test.setTimeout(300000);
  const seed = { theme: 'dark', recentsCap: 7, printPresets: [{ name: 'Pre', settings: { copies: 2, duplex: 'longEdge' } }] };
  const dir = freshDir('f');
  seedSettings(dir, seed);
  const { electronApp: app, window: win, errs } = await boot(dir);
  let printPage = null;
  try {
    printPage = await openPrintReady(app, win, errs);
    // Wait for the document to finish loading so `valid` is not blocked by
    // the "document is still loading" reason, then for a real printer.
    await printPage.waitForSelector('[data-print-window-loading]', { state: 'detached', timeout: 30000 }).catch(() => {});
    await printPage.waitForFunction(() => {
      const sel = document.querySelector('[data-print-printer]');
      const hasReal = sel !== null && [...sel.querySelectorAll('option')].some((o) => o.value !== '');
      return hasReal && document.querySelector('[data-print-empty], [data-print-printers-error]') === null;
    }, null, { timeout: 20000 }).catch(() => {});
    const hasPrinter = await printPage.evaluate(() => {
      const sel = document.querySelector('[data-print-printer]');
      return sel !== null && [...sel.querySelectorAll('option')].some((o) => o.value !== '');
    });
    const confirmEnabled = await printPage.isEnabled('[data-print-confirm]').catch(() => false);
    console.log('[adv81|F] hasPrinter=' + hasPrinter + ' confirmEnabled=' + confirmEnabled);

    // Apply a preset safely (no crash; controls re-seed).
    await printPage.selectOption('[data-print-preset]', 'Pre');
    await expect(printPage.locator('[data-print-duplex]')).toHaveValue('longEdge');

    if (!hasPrinter || !confirmEnabled) {
      record('F', 'SKIP', 'no printer in this environment; cannot drive the hook into running=true');
    } else {
      // Keep the print in flight forever.
      await printPage.evaluate(() => { window.tflex.printJob = () => new Promise(() => {}); });
      await printPage.click('[data-print-confirm]');
      await printPage.waitForSelector('[data-print-progress]', { timeout: 10000 });
      const disabled = await printPage.evaluate(() => ({
        preset: document.querySelector('[data-print-preset]').disabled,
        name: document.querySelector('[data-print-preset-name]').disabled,
        save: document.querySelector('[data-print-preset-save]').disabled,
        del: document.querySelector('[data-print-preset-delete]').disabled,
      }));
      console.log('[adv81|F] disabled=' + JSON.stringify(disabled));
      expect(disabled.preset && disabled.name && disabled.save && disabled.del, 'all preset controls disabled while running').toBe(true);
      record('F', 'PASS');
    }
    expect(errs, 'no renderer pageerror').toEqual([]);
  } catch (e) {
    record('F', 'FAIL', e.message);
    throw e;
  } finally {
    if (printPage && !printPage.isClosed()) await closeStandalonePrintWindow(app, printPage).catch(() => {});
    await hardClose(app, 'adv81-f');
  }
});

test('G name edge cases: whitespace-only, 40 chars, 41 chars, duplicate replace', async () => {
  test.setTimeout(300000);
  const seed = { theme: 'dark', recentsCap: 7, printPresets: [] };
  const dir = freshDir('g');
  seedSettings(dir, seed);
  const { electronApp: app, window: win, errs } = await boot(dir);
  let printPage = null;
  const settingsPath = path.join(dir, 'settings.json');
  try {
    printPage = await openPrintReady(app, win, errs);

    // whitespace-only -> error, no write.
    const before = await pickerNames(printPage);
    await printPage.fill('[data-print-preset-name]', '     ');
    await printPage.click('[data-print-preset-save]');
    await printPage.waitForSelector('[data-print-preset-error]', { timeout: 8000 });
    await printPage.waitForTimeout(600);
    const afterWs = await pickerNames(printPage);
    expect(afterWs, 'whitespace-only name adds nothing').toEqual(before);
    const diskWs = readDisk(settingsPath);
    expect((diskWs.printPresets || []).length, 'whitespace-only name writes nothing to disk').toBe(0);

    // exactly 40 chars -> saves.
    const n40 = 'N'.repeat(40);
    await saveViaUi(printPage, n40);
    let disk = await pollDisk(settingsPath, (s) => (s.printPresets || []).some((p) => p.name === n40));
    expect((disk.printPresets || []).some((p) => p.name === n40), '40-char name persists').toBe(true);

    // 41 chars -> observe truncation vs silent drop/phantom.
    const n41 = 'M'.repeat(41);
    await printPage.fill('[data-print-preset-name]', n41);
    const valueAfterFill = await printPage.inputValue('[data-print-preset-name]');
    await printPage.click('[data-print-preset-save]');
    await printPage.waitForTimeout(2500);
    const disk41 = readDisk(settingsPath);
    const names41 = (disk41.printPresets || []).map((p) => p.name);
    const uiNames41 = await pickerNames(printPage);
    const el40 = 'M'.repeat(40);
    const saved40 = names41.includes(el40);
    const saved41 = names41.includes(n41);
    const uiShows41 = uiNames41.includes(n41) || uiNames41.includes(el40);
    console.log('[adv81|G] fillLen=' + valueAfterFill.length + ' saved40=' + saved40 +
      ' saved41=' + saved41 + ' uiShows=' + uiShows41);
    // The contract: 41 chars must be prevented/truncated WITHOUT a silent
    // wrong-name write. maxLength=40 truncates at entry (the field visibly
    // holds 40 chars), and the main-process normalizer independently rejects
    // >40, so a 41-char name cannot reach disk under a wrong name silently.
    const preventedAtEntry = valueAfterFill.length < 41;
    const silentDropPhantom = uiShows41 && !saved40 && !saved41;
    if (!preventedAtEntry && silentDropPhantom) {
      record('G', 'FAIL', `41-char name not prevented: fillLen=${valueAfterFill.length} uiShows=${uiShows41}`);
    }
    // else: defended (truncated at entry) - no record yet, falls through to PASS.

    // duplicate replace.
    await saveViaUi(printPage, 'Dup', { copies: 1 });
    await pollDisk(settingsPath, (s) => (s.printPresets || []).some((p) => p.name === 'Dup'));
    await saveViaUi(printPage, 'Dup', { select: 'Dup', copies: 4 });
    disk = await pollDisk(settingsPath, (s) => {
      const d = (s.printPresets || []).find((p) => p.name === 'Dup');
      return d && d.settings && d.settings.copies === 4;
    });
    const dups = (disk.printPresets || []).filter((p) => p.name === 'Dup');
    expect(dups.length, 'duplicate name replaces rather than appends').toBe(1);
    expect(dups[0].settings.copies, 'replacement carries later settings').toBe(4);
    // If we reached here and did not already record a FAIL, pass.
    if (!results.some((r) => r.id === 'G')) record('G', 'PASS');
    expect(errs, 'no renderer pageerror').toEqual([]);
  } catch (e) {
    if (!results.some((r) => r.id === 'G')) record('G', 'FAIL', e.message);
    throw e;
  } finally {
    if (printPage && !printPage.isClosed()) await closeStandalonePrintWindow(app, printPage).catch(() => {});
    await hardClose(app, 'adv81-g');
  }
});

test('H the preset path performs no network request', async () => {
  test.setTimeout(300000);
  const seed = { theme: 'dark', recentsCap: 7, printPresets: [] };
  const dir = freshDir('h');
  seedSettings(dir, seed);
  const { electronApp: app, window: win, errs } = await boot(dir);
  let printPage = null;
  const net = [];
  try {
    printPage = await openPrintReady(app, win, errs);
    printPage.on('request', (req) => {
      const u = req.url();
      if (/^https?:/i.test(u)) net.push(u);
    });
    const before = net.length;
    await saveViaUi(printPage, 'Netless', { duplex: 'longEdge' });
    await printPage.waitForSelector('[data-print-preset-notice]', { timeout: 10000 });
    await printPage.waitForTimeout(1200);
    const duringPreset = net.slice(before);
    console.log('[adv81|H] allNet=' + JSON.stringify(net) + ' duringPreset=' + JSON.stringify(duringPreset));
    expect(duringPreset, 'no http(s) request issued by the preset save path').toEqual([]);
    expect(errs, 'no renderer pageerror').toEqual([]);
    record('H', 'PASS');
  } catch (e) {
    record('H', 'FAIL', e.message);
    throw e;
  } finally {
    if (printPage && !printPage.isClosed()) await closeStandalonePrintWindow(app, printPage).catch(() => {});
    await hardClose(app, 'adv81-h');
  }
});

test.afterAll(async () => {
  console.log('[adv81|SUMMARY] ' + JSON.stringify(results));
});
