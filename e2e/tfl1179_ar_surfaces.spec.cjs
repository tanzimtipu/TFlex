// TFL-1179 (re-audit of AR-01..AR-09) — QA live reproduction, surfaces group.
// AR-05 Home/sample identity, AR-06 idle legibility + measured contrast,
// AR-07 range-validation specificity, AR-08 theme coherence, AR-09 Animations
// wording. Drives the REAL Electron app via the canonical launchApp helper.
delete process.env.ELECTRON_RUN_AS_NODE;

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (n) => path.join(SHOTS, n);

let app = null;
let win = null;
test.setTimeout(300000);

async function openSample(name = 'report.pdf') {
  await win.locator('.sample-card').filter({ hasText: name }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1000);
}

// ---------------------------------------------------------------------------
// AR-05 — bundled sample identity on Home / Recents.
// ---------------------------------------------------------------------------
test('AR-05: a bundled sample recent resolves through the sample provider and opens; card opens a working copy', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfl1179-ar05-'));
  const now = new Date().toISOString();
  fs.writeFileSync(
    path.join(dir, 'settings.json'),
    JSON.stringify({
      recentFiles: [
        { path: 'samples/report.pdf', name: 'report.pdf', openedAt: now },
      ],
    }),
  );
  app = await launchApp([], dir);
  win = await app.firstWindow();
  await win.waitForSelector('.welcome', { timeout: 30000 });
  await win.waitForSelector('[data-recent-row]', { timeout: 15000 }).catch(() => {});

  const rows = await win.evaluate(() =>
    Array.from(document.querySelectorAll('[data-recent-row]')).map((r) => ({
      missing: r.getAttribute('data-recent-missing'),
      path: r.getAttribute('title'),
      text: (r.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80),
    })),
  );
  console.log(`[tfl1179] AR-05 seeded-sample recent rows=${JSON.stringify(rows)}`);
  await win.screenshot({ path: shot('tfl1179_ar05_recent_sample.png') });

  const sampleRow = rows.find((r) => (r.path || '').includes('samples/'));
  expect.soft(sampleRow, 'AR-05 the seeded sample recent row renders').toBeTruthy();
  if (sampleRow) {
    expect.soft(sampleRow.missing, 'AR-05 bundled sample is NOT marked Missing').toBe('false');
  }

  // The DEF-429 reopen route: clicking the sample recent must open a working copy.
  const openBtn = win.locator('[data-recent-row] [data-recent-action="open"]').first();
  if ((await openBtn.count()) > 0) {
    await openBtn.click();
    await win.waitForSelector('.pdf-page canvas', { timeout: 15000 }).catch(() => {});
    await win.waitForTimeout(800);
    const reopened = await win.evaluate(() => {
      try { const d = window.tflexDiagnostics(); return { pageCount: d.pageCount, currentPage: d.currentPage }; }
      catch (e) { return null; }
    });
    console.log(`[tfl1179] AR-05 sample-recent reopen diag=${JSON.stringify(reopened)}`);
    expect.soft(reopened !== null && reopened.pageCount, 'AR-05 the sample recent reopens through the sample provider').toBe(34);
  }

  // The report card still opens a working copy through the sample provider.
  await win.locator('[data-new-tab]').first().click();
  await win.waitForSelector('.welcome', { timeout: 10000 });
  await openSample('report.pdf');
  const diag = await win.evaluate(() => {
    const d = window.tflexDiagnostics();
    return { pageCount: d.pageCount, currentPage: d.currentPage };
  });
  console.log(`[tfl1179] AR-05 sample card opened diag=${JSON.stringify(diag)}`);
  expect.soft(diag.pageCount, 'AR-05 report.pdf card opens a real 34-page document').toBe(34);
  await win.screenshot({ path: shot('tfl1179_ar05_card_open.png') });
});

// ---------------------------------------------------------------------------
// AR-06 — settled idle legibility + MEASURED composited contrast.
// ---------------------------------------------------------------------------
test('AR-06: settled idle enabled dock verbs are legible and distinct from disabled; composited contrast measured', async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await openSample('report.pdf');

  const box = await win.locator('.pdf-page').first().boundingBox();
  if (box) {
    await win.mouse.move(Math.round(box.x + box.width / 2), Math.round(box.y + box.height / 2));
  }
  await win.waitForTimeout(3900);

  const dock = await win.evaluate((rootSel) => {
    const root = document.querySelector(rootSel);
    if (root === null) return null;
    const parse = (s) => {
      const m = String(s).match(/rgba?\(([^)]+)\)/);
      if (m === null) return null;
      const p = m[1].split(',').map((x) => parseFloat(x.trim()));
      return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] };
    };
    const mix = (fg, bg, a) => ({
      r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1,
    });
    const ch = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
    const lum = (c) => 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
    const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
    const bg0 = parse(getComputedStyle(root).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
    let bg = bg0;
    if (bg.a < 1) {
      const page = parse(getComputedStyle(document.body).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
      bg = mix(bg, page, bg.a);
    }
    const verbs = Array.from(root.querySelectorAll('[data-dock-verb]')).map((ctl) => {
      const disabled = ctl.hasAttribute('disabled') || ctl.getAttribute('aria-disabled') === 'true';
      let eff = 1, el = ctl;
      while (el !== null) { eff *= parseFloat(getComputedStyle(el).opacity) || 0; if (el === root) break; el = el.parentElement; }
      const ink = parse(getComputedStyle(ctl).color) || { r: 0, g: 0, b: 0, a: 1 };
      const comp = mix(ink, bg, Math.max(0, Math.min(1, ink.a * eff)));
      return {
        label: (ctl.getAttribute('aria-label') || ctl.textContent || '').trim(),
        disabled, effectiveOpacity: Number(eff.toFixed(3)), ratio: Number(ratio(comp, bg).toFixed(2)),
        color: getComputedStyle(ctl).color,
      };
    });
    return { idle: root.getAttribute('data-dock-idle'), rootOpacity: parseFloat(getComputedStyle(root).opacity), bg: getComputedStyle(root).backgroundColor, verbs };
  }, '[data-action-dock]');

  console.log(`[tfl1179] AR-06 dock idle=${dock.idle} rootOpacity=${dock.rootOpacity} bg=${dock.bg} verbs=${JSON.stringify(dock.verbs)}`);
  await win.screenshot({ path: shot('tfl1179_ar06_dock_idle.png') });

  const enabled = dock.verbs.filter((v) => !v.disabled);
  const disabled = dock.verbs.filter((v) => v.disabled);
  console.log(`[tfl1179] AR-06 enabled=${enabled.length} disabled=${disabled.length}`);
  expect.soft(enabled.length, 'AR-06 the dock exposes enabled verbs').toBeGreaterThanOrEqual(3);
  for (const v of enabled) {
    expect.soft(v.ratio, `AR-06 enabled "${v.label}" composited contrast >= 4.5:1`).toBeGreaterThanOrEqual(4.5);
    expect.soft(v.effectiveOpacity, `AR-06 enabled "${v.label}" full opacity when idle`).toBeGreaterThanOrEqual(0.99);
  }
  if (disabled.length > 0) {
    const worstEnabled = Math.min(...enabled.map((v) => v.ratio));
    const bestDisabled = Math.max(...disabled.map((v) => v.ratio));
    console.log(`[tfl1179] AR-06 worstEnabledRatio=${worstEnabled} bestDisabledRatio=${bestDisabled}`);
    expect.soft(worstEnabled, 'AR-06 enabled controls are distinct from (clearer than) disabled ones').toBeGreaterThanOrEqual(bestDisabled);
  }
});

// ---------------------------------------------------------------------------
// AR-07 — Extract dialog range validation specificity.
// ---------------------------------------------------------------------------
test('AR-07: the Extract dialog range field names the real reason and the bound', async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await openSample('report.pdf');

  await win.locator('[data-icon="split"]').first().click({ timeout: 4000 }).catch(async () => {
    // The split verb lives behind the tool search in the overhauled chrome.
    await win.keyboard.press('Control+k');
    await win.waitForSelector('[data-command-palette-input]', { timeout: 8000 });
    await win.fill('[data-command-palette-input]', 'extract');
    await win.waitForTimeout(400);
    const row = win.locator('[data-palette-row="tool"][data-palette-tool-id="extract"]');
    if ((await row.count()) > 0) await row.first().click();
    else await win.locator('[data-palette-row="tool"][data-palette-tool-id="split"]').first().click();
  });
  await win.waitForSelector('#split-page-range', { timeout: 8000 });
  await win.waitForTimeout(300);

  const cases = ['999', '0', '1-999', 'abc', '9-2', '1-3,999', '1-3'];
  const results = [];
  for (const v of cases) {
    await win.fill('#split-page-range', v);
    await win.waitForTimeout(220);
    const r = await win.evaluate(() => {
      const s = document.querySelector('#split-range-status');
      const inp = document.querySelector('#split-page-range');
      const btn = document.querySelector('[data-dialog-action="confirm"]');
      return {
        text: s === null ? null : (s.textContent || '').trim(),
        state: s === null ? null : s.getAttribute('data-range-state'),
        value: inp === null ? null : inp.value,
        disabled: btn === null ? null : btn.disabled,
      };
    });
    results.push({ input: v, ...r });
    if (v === '999') {
      await win.screenshot({ path: shot('tfl1179_ar07_extract_999.png') });
    }
  }
  console.log(`[tfl1179] AR-07 results=${JSON.stringify(results)}`);
  await win.screenshot({ path: shot('tfl1179_ar07_extract_valid.png') });

  const c999 = results.find((r) => r.input === '999');
  expect.soft(c999.state, 'AR-07 999 classified out-of-bounds').toBe('out-of-bounds');
  expect.soft(c999.text, 'AR-07 999 message names the allowed range 1-34').toContain('34');
  expect.soft(c999.text, 'AR-07 999 message names the invalid token').toContain('999');
  expect.soft(c999.value, 'AR-07 999 input preserved').toBe('999');
  expect.soft(c999.disabled, 'AR-07 Extract disabled for 999').toBe(true);

  const valid = results.find((r) => r.input === '1-3');
  expect.soft(valid.disabled, 'AR-07 a valid range enables Extract').toBe(false);
});

// ---------------------------------------------------------------------------
// AR-08 + AR-09 — Preferences theme coherence/persistence and Animations wording.
// ---------------------------------------------------------------------------
test('AR-08 + AR-09: Dark applies and persists across relaunch; Animations polarity wording', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tfl1179-ar08-'));
  app = await launchApp([], dir);
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await openSample('report.pdf');

  await win.locator('[data-stage-rail-gear]').first().click();
  await win.waitForSelector('[data-prefs-dialog]', { timeout: 8000 });
  await win.waitForTimeout(400);

  // AR-09 — exact label and helper strings plus the live checked state.
  const anim = await win.evaluate(() => {
    const cb = document.querySelector('#prefs-animations');
    const row = cb === null ? null : cb.closest('.prefs-row');
    const hint = row === null ? null : row.querySelector('.prefs-hint');
    const label = row === null ? null : row.querySelector('.prefs-row-label');
    return {
      checked: cb === null ? null : cb.checked,
      label: label === null ? null : (label.textContent || '').trim(),
      hint: hint === null ? null : (hint.textContent || '').trim(),
    };
  });
  console.log(`[tfl1179] AR-09 animations=${JSON.stringify(anim)}`);
  await win.screenshot({ path: shot('tfl1179_ar09_animations_row.png') });

  // AR-08 — read the theme-default value, select Dark, confirm applied + dark shell.
  const initial = await win.locator('[data-prefs-theme-default]').inputValue();
  await win.selectOption('[data-prefs-theme-default]', 'dark');
  await win.waitForTimeout(700);
  const applied = await win.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    htmlBg: getComputedStyle(document.documentElement).backgroundColor,
    bodyBg: getComputedStyle(document.body).backgroundColor,
  }));
  console.log(`[tfl1179] AR-08 initial=${initial} applied=${JSON.stringify(applied)}`);
  const settingsPath = path.join(dir, 'settings.json');
  const onDisk = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath, 'utf8') : null;
  let parsed = null;
  try { parsed = onDisk === null ? null : JSON.parse(onDisk); } catch (_) { parsed = null; }
  console.log(`[tfl1179] AR-08 settings(onDisk theme=${parsed && parsed.theme} themeDefault=${parsed && parsed.themeDefault})`);
  await win.screenshot({ path: shot('tfl1179_ar08_prefs_dark.png') });
  expect.soft(applied.theme, 'AR-08 selecting Dark applies the dark theme immediately').toBe('dark');

  await hardClose(app, 'tfl1179-ar08');
  app = null;
  await new Promise((r) => setTimeout(r, 3000));

  // Relaunch the SAME profile: the theme must persist.
  app = await launchApp([], dir);
  win = await app.firstWindow();
  await win.waitForSelector('.welcome', { timeout: 30000 });
  const bootRecents = await win.locator('[data-recent-row]').count();
  const boot = await win.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    bodyBg: getComputedStyle(document.body).backgroundColor,
  }));
  const onDisk2 = fs.existsSync(settingsPath) ? fs.readFileSync(settingsPath, 'utf8') : null;
  let parsed2 = null;
  try { parsed2 = onDisk2 === null ? null : JSON.parse(onDisk2); } catch (_) { parsed2 = null; }
  console.log(`[tfl1179] AR-08 relaunch boot=${JSON.stringify(boot)} bootRecentRows=${bootRecents} settings(onDisk theme=${parsed2 && parsed2.theme} themeDefault=${parsed2 && parsed2.themeDefault})`);
  await win.screenshot({ path: shot('tfl1179_ar08_relaunch_dark.png') });
  expect.soft(bootRecents, 'AR-08 relaunch used the isolated profile (0 seeded recents)').toBe(0);
  expect.soft(boot.theme, 'AR-08 the selected Dark theme persists after relaunch').toBe('dark');
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl1179-surf');
  app = null;
  win = null;
});
