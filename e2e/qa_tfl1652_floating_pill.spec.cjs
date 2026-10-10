// TFL-1652 QA — Chrome-style floating-pill tab bar (pixel spec).
//
// Step 4 of the issue: QA repeats the side-by-side check with SPECIFIC
// MEASUREMENTS from the running Electron app (not from the author's word).
// The sheet is the contract; this spec reads the rendered geometry + computed
// colours of the REAL pills and prints them, then asserts the exact numbers.
//
// Launches only through the canonical launchApp helper.
const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { openSamplePath, hardClose, shot, setTheme } = require('./lib/helpers.cjs');

// Normalise a computed rgb()/rgba() string to an uppercase hex (or 'transparent').
function hex(rgb) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(rgb);
  if (!m) return rgb;
  const [, r, g, b, a] = m;
  if (a !== undefined && parseFloat(a) === 0) return 'transparent';
  return '#' + [r, g, b].map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase();
}

let app = null;
let win = null;

test.setTimeout(300000);

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.emulateMedia({ reducedMotion: 'reduce' });
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl1652-pill');
  app = null;
  win = null;
});

// One tab's rendered geometry + computed style, plus its strip context.
test('TFL-1652 floating-pill tab bar measured against the pixel spec', async () => {
  await setTheme(win, 'dark');

  // 4 real documents -> report.pdf / long.pdf / form.pdf / scanned.pdf
  for (const name of ['report.pdf', 'long.pdf', 'form.pdf', 'scanned.pdf']) {
    await openSamplePath(win, app, getSamplePath(name));
  }
  await win.waitForFunction(() => document.querySelectorAll('[data-tab-id]').length >= 4, null, { timeout: 30000 });
  await win.waitForTimeout(800);

  const chromeStyle = await win.evaluate(() => document.querySelector('.tab-area').getAttribute('data-tab-style'));
  expect(chromeStyle, 'the default tab style is chrome').toBe('chrome');

  const strip = await win.evaluate(() => {
    const rail = document.querySelector('.document-rail');
    const list = document.querySelector('.tab-list');
    const lr = list.getBoundingClientRect();
    const rr = rail.getBoundingClientRect();
    const newTab = document.querySelector('[data-new-tab]');
    const nr = newTab.getBoundingClientRect();
    return {
      railH: +rr.height.toFixed(1),
      railBg: getComputedStyle(rail).backgroundColor,
      listH: +lr.height.toFixed(1),
      listTop: +lr.top.toFixed(1),
      listBottom: +lr.bottom.toFixed(1),
      newTab: { w: +nr.width.toFixed(1), h: +nr.height.toFixed(1), radius: getComputedStyle(newTab).borderRadius },
    };
  });

  const measured = await win.evaluate(() => {
    const listRect = document.querySelector('.tab-list').getBoundingClientRect();
    const read = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const fav = el.querySelector('.tab-favicon');
      const cl = el.querySelector('.tab-close');
      const title = el.querySelector('.tab-title-text');
      const fr = fav ? fav.getBoundingClientRect() : null;
      const cr = cl ? cl.getBoundingClientRect() : null;
      return {
        id: el.getAttribute('data-tab-id'),
        active: el.getAttribute('aria-selected') === 'true',
        width: +r.width.toFixed(1), height: +r.height.toFixed(1),
        gapTop: +(r.top - listRect.top).toFixed(1), gapBottom: +(listRect.bottom - r.bottom).toFixed(1),
        radius: cs.borderRadius, bg: cs.backgroundColor, color: cs.color,
        fontSize: cs.fontSize, fontWeight: cs.fontWeight,
        padLeft: cs.paddingLeft, padRight: cs.paddingRight,
        favicon: fr ? { w: +fr.width.toFixed(1), h: +fr.height.toFixed(1) } : null,
        close: cr ? { w: +cr.width.toFixed(1), h: +cr.height.toFixed(1), opacity: getComputedStyle(cl).opacity } : null,
        titleColor: title ? getComputedStyle(title).color : null,
      };
    };
    return Array.from(document.querySelectorAll('[data-tab-id]')).map(read);
  });

  const sep = await win.evaluate(() => {
    const li = document.querySelectorAll('.tab-list > li[data-animated-tab]')[1];
    if (!li) return null;
    const s = getComputedStyle(li, '::before');
    return { content: s.content, bg: s.backgroundColor, width: s.width, top: s.top, bottom: s.bottom };
  });

  console.log('[TFL-1652 strip] ' + JSON.stringify(strip));
  console.log('[TFL-1652 sep] ' + JSON.stringify(sep));
  for (const t of measured) console.log('[TFL-1652 tab] ' + JSON.stringify(t));
  await shot(win, 'tfl1652-qa-measured-dark.png');

  // ---- Assertions against the pixel spec ----
  expect(strip.railH, 'strip row is 56px (7 + 42 + 7)').toBeCloseTo(56, 0);
  expect(strip.listH, 'tab-list row is 56px').toBeCloseTo(56, 0);
  expect(strip.railBg, 'strip background #1F2020').toBe('rgb(31, 32, 32)');
  expect(strip.newTab.w, 'new-tab + is a 28px circle').toBeCloseTo(28, 0);
  expect(strip.newTab.h, 'new-tab + is a 28px circle').toBeCloseTo(28, 0);
  expect(strip.newTab.radius, 'new-tab + is circular').toBe('50%');

  expect(sep, 'separator data-read').not.toBeNull();
  expect(sep.content, 'separator ::before is drawn').not.toBe('none');
  expect(sep.bg, 'separator colour #494A4A').toBe('rgb(73, 74, 74)');
  expect(sep.top).toBe('0px');
  expect(sep.bottom).toBe('0px');

  expect(measured.length, 'four pills rendered').toBe(4);
  expect(measured.filter((t) => t.active).length, 'exactly one active pill').toBe(1);
  const active = measured.find((t) => t.active);
  const inactive = measured.filter((t) => !t.active);

  for (const t of measured) {
    expect(t.height, `pill ${t.id} height 42px`).toBeCloseTo(42, 0);
    expect(t.radius, `pill ${t.id} radius 12px on all corners`).toBe('12px');
    expect(t.gapTop, `pill ${t.id} 7px top gap`).toBeCloseTo(7, 0);
    expect(t.gapBottom, `pill ${t.id} 7px bottom gap`).toBeCloseTo(7, 0);
    expect(t.width, `pill ${t.id} >= 120px floor`).toBeGreaterThanOrEqual(119.5);
    expect(t.width, `pill ${t.id} <= 360px ceiling`).toBeLessThanOrEqual(360.5);
    expect(t.padLeft, `pill ${t.id} 14px left inset`).toBe('14px');
    expect(t.padRight, `pill ${t.id} 12px right inset`).toBe('12px');
    expect(t.fontSize, `pill ${t.id} title 13px`).toBe('13px');
    expect(t.fontWeight, `pill ${t.id} title weight 500`).toBe('500');
    expect(t.favicon, `pill ${t.id} favicon present`).not.toBeNull();
    expect(t.favicon.w, `pill ${t.id} favicon 16px`).toBeCloseTo(16, 0);
    expect(t.favicon.h, `pill ${t.id} favicon 16px`).toBeCloseTo(16, 0);
    expect(t.close, `pill ${t.id} close present`).not.toBeNull();
    expect(t.close.w, `pill ${t.id} close 16px hit area`).toBeCloseTo(16, 0);
    expect(t.close.h, `pill ${t.id} close 16px hit area`).toBeCloseTo(16, 0);
    expect(Number(t.close.opacity), `pill ${t.id} close persistently visible (opacity 1)`).toBe(1);
  }

  for (const t of inactive) {
    expect(hex(t.bg), `inactive pill ${t.id} background transparent`).toBe('transparent');
    expect(hex(t.titleColor), `inactive pill ${t.id} title #B9BBBE`).toBe('#B9BBBE');
  }
  expect(hex(active.bg), 'active pill background #1A4974').toBe('#1A4974');
  expect(hex(active.titleColor), 'active pill title #FFFFFF').toBe('#FFFFFF');
  const activeCloseColor = await win.evaluate(() => {
    const el = document.querySelector('[data-tab-id][aria-selected="true"] .tab-close');
    return getComputedStyle(el).color;
  });
  expect(activeCloseColor, 'active pill close is white').toBe('rgb(255, 255, 255)');
});

test('TFL-1652 hover pill is #3C3C3C and the close gesture behaviour holds', async () => {
  await setTheme(win, 'dark');
  for (const name of ['report.pdf', 'long.pdf', 'scanned.pdf']) {
    await openSamplePath(win, app, getSamplePath(name));
  }
  await win.waitForFunction(() => document.querySelectorAll('[data-tab-id]').length >= 3, null, { timeout: 30000 });
  await win.waitForTimeout(600);

  // Hover an inactive pill.
  const firstInactive = win.locator('[data-tab-id][aria-selected="false"]').first();
  await firstInactive.hover();
  await win.waitForTimeout(250);
  const hoverBg = await firstInactive.evaluate((el) => getComputedStyle(el).backgroundColor);
  const hoverInk = await firstInactive.evaluate((el) => getComputedStyle(el.querySelector('.tab-title-text')).color);
  console.log(`[TFL-1652 hover] bg=${hoverBg} ink=${hoverInk}`);
  await shot(win, 'tfl1652-qa-hover.png');
  expect(hoverBg, 'hover pill background #3C3C3C').toBe('rgb(60, 60, 60)');
  expect(hoverInk, 'hover pill title #E8EAED').toBe('rgb(232, 234, 237)');

  // Click an inactive pill -> it becomes active (spec behaviour).
  const targetId = await firstInactive.getAttribute('data-tab-id');
  await firstInactive.click();
  await win.waitForTimeout(400);
  const nowActive = await win.evaluate(() =>
    document.querySelector('[data-tab-id][aria-selected="true"]').getAttribute('data-tab-id'));
  expect(nowActive, 'clicking a pill activates that document').toBe(targetId);

  // Middle-click a pill -> it closes (spec behaviour).
  const countBefore = await win.locator('[data-tab-id]').count();
  const midId = await win.evaluate(() => {
    const all = Array.from(document.querySelectorAll('[data-tab-id]'));
    const t = all.find((el) => el.getAttribute('aria-selected') === 'false') || all[0];
    return t.getAttribute('data-tab-id');
  });
  const box = await win.locator(`[data-tab-id="${midId}"]`).boundingBox();
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await win.mouse.down({ button: 'middle' });
  await win.mouse.up({ button: 'middle' });
  await win.waitForFunction((n) => document.querySelectorAll('[data-tab-id]').length === n - 1, countBefore, { timeout: 8000 });
  const stillThere = await win.locator(`[data-tab-id="${midId}"]`).count();
  expect(stillThere, 'middle-click closed the pill').toBe(0);
});
