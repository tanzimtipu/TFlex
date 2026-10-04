// TFL-524 chunk A (DEF-534) — colorful tab TOP-EDGE alignment.
//
// The default `colorful` tab style must lay every document tab (active and
// inactive) from ONE shared TOP edge at the top of the tab strip, with the
// ACTIVE tab filling the strip's full height so its fill is flush with the
// canvas top (bottom gap <= 1px). Inactive tabs stay the 26px chips with four
// rounded corners, hanging from the shared top edge with their recess at the
// bottom. The `standard` style is unchanged.
//
// Measured contract (all against real rendered geometry through launchApp):
//   - Math.abs(activeTop - inactiveTop) <= 0.5
//   - activeBottom >= inactiveBottom and appMainTop - activeBottom <= 1
//   - inactive height ~26px and its recess (activeBottom - inactiveBottom) > 0
//   - active-first / active-last re-measure with the same shared top edge
//   - single tab: top aligned, bottom flush
//   - multi + overflow at 1280 and at the 640px minimum: tops equal, active flush
//   - screenshots of the strip in light and dark
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const os = require('node:os');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');
const { switchTheme } = require('./lib/p33_common.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');

test.setTimeout(300000);

function userData(tag) {
  return path.join(os.tmpdir(), `tflex-tfl524-${tag}-${Date.now()}`);
}

async function openBundledSample(app, win, sampleName) {
  const p = getSamplePath(sampleName);
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForTimeout(1400);
}

async function setSize(app, w, h) {
  await app.evaluate(({ BrowserWindow }, s) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (!bw) return;
    bw.unmaximize();
    bw.setSize(s.w, s.h);
  }, { w, h });
  await new Promise((r) => setTimeout(r, 450));
}

// Measure the real tab geometry: the inner `.tab` boxes (they carry
// data-tab-id + aria-selected), the strip and the canvas top.
async function measure(win) {
  return win.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll('[data-tab-id]'));
    const area = document.querySelector('.tab-area');
    const main = document.querySelector('.app-main');
    const rect = (el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, height: r.height, left: r.left, width: r.width };
    };
    const active = tabs.find((t) => t.getAttribute('aria-selected') === 'true') || null;
    const inactive = tabs.find((t) => t.getAttribute('aria-selected') === 'false') || null;
    return {
      count: tabs.length,
      style: area ? area.getAttribute('data-tab-style') : null,
      active: active ? rect(active) : null,
      inactive: inactive ? rect(inactive) : null,
      area: area ? rect(area) : null,
      mainTop: main ? main.getBoundingClientRect().top : null,
    };
  });
}

// The shared alignment contract. `label` names the scenario in failures.
function assertAligned(m, label) {
  expect(m.count, `${label}: tabs are present`).toBeGreaterThan(0);
  expect(m.active, `${label}: an active tab exists`).toBeTruthy();
  const a = m.active;
  if (m.inactive) {
    expect(
      Math.abs(a.top - m.inactive.top),
      `${label}: active/inactive share one top edge (${a.top} vs ${m.inactive.top})`,
    ).toBeLessThanOrEqual(0.5);
    expect(
      a.bottom,
      `${label}: active foot reaches at/below the inactive chip foot`,
    ).toBeGreaterThanOrEqual(m.inactive.bottom);
    const recess = a.bottom - m.inactive.bottom;
    expect(recess, `${label}: inactive chip recessed above the foot (got ${recess})`).toBeGreaterThan(0);
    expect(m.inactive.height, `${label}: inactive chip ~26px`).toBeGreaterThanOrEqual(25.5);
    expect(m.inactive.height, `${label}: inactive chip ~26px`).toBeLessThanOrEqual(26.5);
  }
  const gap = m.mainTop - a.bottom;
  expect(gap, `${label}: active fill flush with the canvas (gap ${gap})`).toBeLessThanOrEqual(1);
  expect(gap, `${label}: active fill does not cross the canvas (gap ${gap})`).toBeGreaterThanOrEqual(-1);
}

// The colorful style is the default; assert it once per launch.
async function assertColorful(win) {
  expect(await win.locator('.tab-area').getAttribute('data-tab-style')).toBe('colorful');
}

test('two tabs share one aligned top edge; the active tab fills flush to the canvas', async () => {
  const app = await launchApp([], userData('two'));
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);

  await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1200);
  await openBundledSample(app, win, 'long.pdf');
  await expect(win.locator('[data-tab-id]')).toHaveCount(2, { timeout: 30000 });
  await assertColorful(win);

  const m = await measure(win);
  console.log(`[TFL524] two-tabs measure=${JSON.stringify(m)}`);
  assertAligned(m, 'two tabs');

  // Screenshots: the strip in light and dark (plus full-window context).
  await switchTheme(win, 'light');
  await win.waitForTimeout(500);
  await win.screenshot({ path: path.join(SHOTS, 'tfl524-tab-align-light.png') });
  await win.locator('.tab-area').screenshot({ path: path.join(SHOTS, 'tfl524-tab-strip-light.png') });
  await switchTheme(win, 'dark');
  await win.waitForTimeout(500);
  await win.screenshot({ path: path.join(SHOTS, 'tfl524-tab-align-dark.png') });
  await win.locator('.tab-area').screenshot({ path: path.join(SHOTS, 'tfl524-tab-strip-dark.png') });

  await hardClose(app, 'tfl524-two');
});

test('active-first and active-last keep the shared top edge', async () => {
  const app = await launchApp([], userData('order'));
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);

  await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1200);
  await openBundledSample(app, win, 'long.pdf');
  await expect(win.locator('[data-tab-id]')).toHaveCount(2, { timeout: 30000 });

  // Activate the FIRST tab.
  await win.locator('[data-tab-id]').first().click();
  await win.waitForTimeout(500);
  let m = await measure(win);
  console.log(`[TFL524] active-first measure=${JSON.stringify(m)}`);
  assertAligned(m, 'active-first');
  expect(m.active.left, 'first tab is active').toBeLessThanOrEqual(m.inactive.left);

  // Activate the LAST tab.
  await win.locator('[data-tab-id]').last().click();
  await win.waitForTimeout(500);
  m = await measure(win);
  console.log(`[TFL524] active-last measure=${JSON.stringify(m)}`);
  assertAligned(m, 'active-last');
  expect(m.active.left, 'last tab is active').toBeGreaterThanOrEqual(m.inactive.left);

  await hardClose(app, 'tfl524-order');
});

test('single tab is top aligned and flush to the canvas', async () => {
  const app = await launchApp([], userData('single'));
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);

  await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1200);
  await expect(win.locator('[data-tab-id]')).toHaveCount(1, { timeout: 30000 });

  const m = await measure(win);
  console.log(`[TFL524] single measure=${JSON.stringify(m)}`);
  assertAligned(m, 'single tab');
  expect(
    Math.abs(m.active.top - m.area.top),
    `single tab top sits at the strip top (${m.active.top} vs ${m.area.top})`,
  ).toBeLessThanOrEqual(1);

  await hardClose(app, 'tfl524-single');
});

test('multi + overflow at 1280 and at the 640px minimum keep tops equal and the active flush', async () => {
  const app = await launchApp([], userData('overflow'));
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);

  await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1200);

  // Open 10+ tabs via the strip's own "+" control (the real user path).
  for (let i = 0; i < 10; i += 1) {
    const plus = win.locator('[data-new-tab]');
    if ((await plus.count()) === 0) break;
    await plus.first().click({ timeout: 5000 });
    await win.waitForTimeout(350);
  }
  const count = await win.locator('[data-tab-id]').count();
  console.log(`[TFL524] overflow tab count=${count}`);
  expect(count, '10+ tabs are open').toBeGreaterThanOrEqual(10);

  await setSize(app, 1280, 800);
  let m = await measure(win);
  console.log(`[TFL524] overflow@1280 measure=${JSON.stringify(m)}`);
  assertAligned(m, 'overflow@1280');

  await setSize(app, 640, 800);
  m = await measure(win);
  console.log(`[TFL524] overflow@640 measure=${JSON.stringify(m)}`);
  assertAligned(m, 'overflow@640');
  await win.locator('.tab-area').screenshot({ path: path.join(SHOTS, 'tfl524-tab-strip-overflow-640.png') });

  await hardClose(app, 'tfl524-overflow');
});