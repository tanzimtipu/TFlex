// Phase 63 (TFL-47 / TFL-95) — RENDERED computed-style probe for the dock edit
// pen colour.
//
// Phase 103 (TFL-836) SUPERSEDED the Phase 63 oracle: the pen is an ICON and
// rides the shared icon ink ladder, so it rests graphite (`--tf-icon-rest`) and
// turns the one accent violet (`--tf-icon-active`) only while armed
// (`aria-pressed='true'`). This spec probes that ladder in each theme
// (light / dark / frosted), parking the pointer away from the control before
// each read so the hover lift (`--fg-strong`) cannot mask the rest / active ink.
//
// Launched ONCE through the canonical launchApp helper. The theme is switched by
// setting `data-theme` on documentElement (light = :root / "light", dark =
// "dark", frosted = "frosted"); after each switch the theme transition is given
// time to settle before the rendered style is read. Both sides are normalised to
// one form (rgba via a 1x1 canvas fill) before comparison.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const USER_DATA = path.join(os.tmpdir(), `tflex-p63-dockedit-${Date.now()}`);
const THEMES = ['light', 'dark', 'frosted'];

test.setTimeout(180000);

async function openReport(win) {
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('[data-action-dock]', { timeout: 30000 });
  await win.waitForFunction(() => document.querySelector('[data-dock-edit-toggle]') !== null, null, { timeout: 30000 });
  await win.waitForTimeout(800);
}

// Set the theme attribute and wait for the transition to settle.
async function setTheme(win, t) {
  await win.evaluate((theme) => document.documentElement.setAttribute('data-theme', theme), t);
  await win.waitForFunction((theme) => document.documentElement.getAttribute('data-theme') === theme, t, { timeout: 10000 });
  await win.waitForTimeout(600);
}

// Read the rendered pen colour plus the theme's rest / active icon ink and the
// neutral token, all normalised to the same rgba form via a 1x1 canvas fill.
async function probe(win) {
  return win.evaluate(() => {
    const norm = (value) => {
      const c = document.createElement('canvas');
      c.width = 1;
      c.height = 1;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, 1, 1);
      ctx.fillStyle = String(value).trim();
      ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data).join(',');
    };
    const pen = document.querySelector('[data-dock-edit-toggle]');
    if (pen === null) return null;
    const root = getComputedStyle(document.documentElement);
    const results = {};
    results.theme = document.documentElement.getAttribute('data-theme');
    results.penColor = norm(getComputedStyle(pen).color);
    results.iconRest = norm(root.getPropertyValue('--tf-icon-rest'));
    results.iconActive = norm(root.getPropertyValue('--tf-icon-active'));
    results.neutral = norm(root.getPropertyValue('--sem-neutral'));
    results.pressed = pen.getAttribute('aria-pressed');
    results.raw = {
      penColor: getComputedStyle(pen).color,
      iconRest: root.getPropertyValue('--tf-icon-rest'),
      iconActive: root.getPropertyValue('--tf-icon-active'),
      neutral: root.getPropertyValue('--sem-neutral'),
    };
    return results;
  });
}

test('dock edit pen rides the icon ink ladder: graphite at rest, violet armed, in every theme', async () => {
  const app = await launchApp([], USER_DATA);
  const win = await app.firstWindow();
  await openReport(win);

  for (const t of THEMES) {
    await setTheme(win, t);

    // REST — park the pointer away so the hover lift cannot mask the rest ink.
    await win.mouse.move(0, 0);
    await win.waitForTimeout(600);
    const rest = await probe(win);
    console.log(`[P63-pen] theme=${t} rest=${JSON.stringify(rest)}`);
    expect(rest, `the pen is rendered in theme ${t}`).not.toBeNull();
    expect(rest.pressed, `theme ${t}: pen is unarmed at rest`).toBe('false');
    expect(rest.penColor, `theme ${t}: pen rests in --tf-icon-rest (pen=${rest.raw.penColor} token=${rest.raw.iconRest})`).toBe(rest.iconRest);
    expect(rest.penColor, `theme ${t}: pen rest ink differs from --sem-neutral (pen=${rest.raw.penColor} neutral=${rest.raw.neutral})`).not.toBe(rest.neutral);
    await win.locator('[data-action-dock]').screenshot({ path: path.join(SHOTS, `p63-dock-edit-pen-${t}.png`) });

    // ACTIVE — arm edit mode, then park the pointer away again so the pressed
    // rule (`--tf-icon-active`) is what we read, not the hover lift.
    await win.locator('[data-dock-edit-toggle]').click();
    await win.waitForFunction(() => document.querySelector('[data-dock-edit-toggle]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 5000 });
    await win.mouse.move(0, 0);
    // The pen's colour rides a ~200ms transition (--motion-duration-fast), so
    // let it settle before reading the armed ink.
    await win.waitForTimeout(600);
    const armed = await probe(win);
    console.log(`[P63-pen] theme=${t} active=${JSON.stringify(armed)}`);
    expect(armed.pressed, `theme ${t}: pen is armed`).toBe('true');
    expect(armed.penColor, `theme ${t}: armed pen uses --tf-icon-active (pen=${armed.raw.penColor} token=${armed.raw.iconActive})`).toBe(armed.iconActive);
    expect(armed.penColor, `theme ${t}: armed pen ink differs from rest (active=${armed.raw.penColor} rest=${armed.raw.iconRest})`).not.toBe(armed.iconRest);
    await win.locator('[data-action-dock]').screenshot({ path: path.join(SHOTS, `p63-dock-edit-pen-${t}-active.png`) });

    // Reset to rest for the next theme.
    await win.locator('[data-dock-edit-toggle]').click();
    await win.waitForFunction(() => document.querySelector('[data-dock-edit-toggle]')?.getAttribute('aria-pressed') === 'false', null, { timeout: 5000 });
    await win.mouse.move(0, 0);
    await win.waitForTimeout(600);
  }

  await hardClose(app, 'p63-dock-edit');
});
