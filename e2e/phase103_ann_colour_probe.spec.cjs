// Phase 103 phase-close QA probe (TFL-840) - resting icon ink across surfaces.
// Verifies criterion 3 ("resting icons graphite app-wide; green only for real
// success") on a surface the batch screenshots do not capture: the annotation
// flyout tool row (`.ann-tool-btn[data-tool=...]`), plus dock verbs and the dock
// picker as controls. Prints computed colours as JSON and captures light + dark
// screenshots, each theme from a fresh launch (arming a tool keeps the flyout
// open, so cross-theme reuse would toggle it closed). qa-owned; read-only.
const { test } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const OUT = path.resolve(__dirname, '..', 'screenshots', 'phase103-qa');
fs.mkdirSync(OUT, { recursive: true });
test.setTimeout(240000);

async function openReport(win) {
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('[data-action-dock]', { timeout: 30000 });
  await win.waitForTimeout(900);
}

function colour(win, sel) {
  return win.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const svg = el.tagName.toLowerCase() === 'svg' ? el : el.querySelector('svg');
    const cs = getComputedStyle(el);
    const ss = svg ? getComputedStyle(svg) : null;
    return {
      sel: s,
      found: true,
      buttonColor: cs.color,
      svgStroke: ss ? ss.stroke : null,
      svgWidth: ss ? ss.width : null,
    };
  }, sel);
}

async function setTheme(win, theme) {
  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  await win.click(`[data-theme-option="${theme}"]`);
  await win.waitForFunction((w) => document.documentElement.getAttribute('data-theme') === w, theme);
  await win.waitForTimeout(600);
}

async function openAnnotate(win) {
  await win.click('[data-dock-verb="annotate"]');
  await win.waitForSelector('.ann-tool-btn', { timeout: 8000 });
  await win.waitForTimeout(400);
}

async function probeTheme(theme) {
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await openReport(win);
    await win.click('[data-stage="review"]');
    await win.waitForFunction(
      () => document.querySelector('[data-stage-rail]')?.getAttribute('data-active-stage') === 'review',
      null,
      { timeout: 8000 },
    );
    await win.waitForTimeout(500);
    if (theme === 'dark') await setTheme(win, 'dark');

    const dockVerb = {
      annotate: await colour(win, '[data-dock-verb="annotate"]'),
      sign: await colour(win, '[data-dock-verb="sign"]'),
    };

    await openAnnotate(win);
    const resting = {
      annRect: await colour(win, '.ann-tool-btn[data-tool="rect"]'),
      annSelect: await colour(win, '.ann-tool-btn[data-tool="select"]'),
      annHighlight: await colour(win, '.ann-tool-btn[data-tool="highlight"]'),
    };
    await win.screenshot({ path: path.join(OUT, `probe-ann-flyout-${theme}.png`) });
    const flyout = win.locator('[data-annotation-flyout]').first();
    if ((await flyout.count()) > 0) {
      await flyout.screenshot({ path: path.join(OUT, `probe-ann-flyout-crop-${theme}.png`) });
    }

    await win.click('.ann-tool-btn[data-tool="rect"]');
    await win.waitForTimeout(400);
    const armed = await colour(win, '.ann-tool-btn[data-tool="rect"]');
    await win.screenshot({ path: path.join(OUT, `probe-ann-tool-armed-${theme}.png`) });
    if ((await flyout.count()) > 0) {
      await flyout.screenshot({ path: path.join(OUT, `probe-ann-tool-armed-crop-${theme}.png`) });
    }

    return { theme, dockVerb, resting, armed };
  } finally {
    await hardClose(app, `p103-probe-${theme}`);
  }
}

test('Phase 103 probe: resting icon ink across surfaces', async () => {
  const light = await probeTheme('light');
  const dark = await probeTheme('dark');

  const out = { light, dark };
  out.annRect = light.resting.annRect;
  out.annSelect = light.resting.annSelect;
  out.annHighlight = light.resting.annHighlight;
  console.log('P103_PROBE ' + JSON.stringify(out));
  fs.writeFileSync(path.join(OUT, 'probe-resting-ink.json'), JSON.stringify(out, null, 2));
});
