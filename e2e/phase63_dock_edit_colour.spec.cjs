// Phase 63 (TFL-47 / TFL-95) — RENDERED computed-style probe for the dock EDIT
// affordance ink.
//
// Phase 104 (chunk 1) RETIRED the dock edit pen (`[data-dock-edit-toggle]`):
// dock EDIT mode is now armed through the More popover's Customize dock item,
// and the labelled Tools utility (`[data-dock-tools]`) occupies the pen's row
// slot. Phase 103's rule still holds: the trailing utility is an ICON and rides
// the shared icon ink ladder, so the Tools glyph rests graphite
// (`--tf-icon-rest`) and never the accent; colour is reserved for STATE, so the
// Customize entry stays the canonical menu ink and does not wear the accent at
// rest or while armed. This spec probes both in each theme (light / dark /
// frosted), parking the pointer away before each read so the hover lift cannot
// mask the rest ink.
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
  await win.waitForFunction(() => document.querySelector('[data-dock-tools]') !== null, null, { timeout: 30000 });
  await win.waitForTimeout(800);
}

async function setTheme(win, t) {
  await win.evaluate((theme) => document.documentElement.setAttribute('data-theme', theme), t);
  await win.waitForFunction((theme) => document.documentElement.getAttribute('data-theme') === theme, t, { timeout: 10000 });
  await win.waitForTimeout(600);
}

async function openMore(win) {
  await win.locator('[data-dock-overflow]').first().click();
  await win.waitForSelector('[data-dock-overflow-menu]', { state: 'visible', timeout: 8000 });
  await win.waitForTimeout(150);
}

// Normalise any colour form to one rgba string via a 1x1 canvas fill.
const NORM = `(value) => {
  const c = document.createElement('canvas');
  c.width = 1; c.height = 1;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, 1, 1);
  ctx.fillStyle = String(value).trim(); ctx.fillRect(0, 0, 1, 1);
  return Array.from(ctx.getImageData(0, 0, 1, 1).data).join(',');
}`;

// The rendered Tools glyph ink plus the theme's icon tokens.
async function probeTools(win) {
  return win.evaluate(`(() => {
    const norm = ${NORM};
    const tools = document.querySelector('[data-dock-tools]');
    if (tools === null) return null;
    const root = getComputedStyle(document.documentElement);
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      toolsColor: norm(getComputedStyle(tools).color),
      iconRest: norm(root.getPropertyValue('--tf-icon-rest')),
      iconActive: norm(root.getPropertyValue('--tf-icon-active')),
      rawTools: getComputedStyle(tools).color,
      rawRest: root.getPropertyValue('--tf-icon-rest'),
    };
  })()`);
}

// The Customize dock entry's ink and armed state.
async function probeCustomize(win) {
  return win.evaluate(`(() => {
    const norm = ${NORM};
    const el = document.querySelector('[data-dock-menu-item="customize"]');
    if (el === null) return null;
    const root = getComputedStyle(document.documentElement);
    return {
      pressed: el.getAttribute('aria-pressed'),
      customizeColor: norm(getComputedStyle(el).color),
      iconActive: norm(root.getPropertyValue('--tf-icon-active')),
      raw: getComputedStyle(el).color,
    };
  })()`);
}

test('dock edit affordance ink: Tools rests graphite, Customize stays canonical, in every theme', async () => {
  const app = await launchApp([], USER_DATA);
  const win = await app.firstWindow();
  await openReport(win);

  for (const t of THEMES) {
    await setTheme(win, t);

    // REST — the Tools utility is an icon and rides --tf-icon-rest.
    await win.mouse.move(0, 0);
    await win.waitForTimeout(600);
    const tools = await probeTools(win);
    console.log(`[P63-dock] theme=${t} tools=${JSON.stringify(tools)}`);
    expect(tools, `the Tools utility is rendered in theme ${t}`).not.toBeNull();
    expect(tools.toolsColor, `theme ${t}: Tools rests in --tf-icon-rest (tools=${tools.rawTools} token=${tools.rawRest})`).toBe(tools.iconRest);
    expect(tools.toolsColor, `theme ${t}: resting utility ink is not the accent (tools=${tools.rawTools})`).not.toBe(tools.iconActive);
    await win.locator('[data-action-dock]').screenshot({ path: path.join(SHOTS, `p63-dock-edit-tools-${t}.png`) });

    // REST — the Customize entry is reachable, unarmed, and canonical: colour is
    // reserved for state, so this trigger does not wear the accent at rest.
    await openMore(win);
    await win.mouse.move(0, 0);
    await win.waitForTimeout(300);
    const rest = await probeCustomize(win);
    console.log(`[P63-dock] theme=${t} customize-rest=${JSON.stringify(rest)}`);
    expect(rest, `the Customize entry is rendered in theme ${t}`).not.toBeNull();
    expect(rest.pressed, `theme ${t}: Customize is unarmed at rest`).toBe('false');
    expect(rest.customizeColor, `theme ${t}: Customize rest ink is not the accent (${rest.raw})`).not.toBe(rest.iconActive);

    // ARM — Customize toggles the EXISTING dock EDIT mode; the entry reports the
    // armed state through aria-pressed and keeps its canonical ink.
    await win.locator('[data-dock-menu-item="customize"]').click();
    await win.waitForFunction(
      () => document.querySelector('[data-action-dock]')?.getAttribute('data-dock-edit') === 'true',
      null, { timeout: 5000 },
    );
    await openMore(win);
    await win.mouse.move(0, 0);
    await win.waitForTimeout(300);
    const armed = await probeCustomize(win);
    console.log(`[P63-dock] theme=${t} customize-armed=${JSON.stringify(armed)}`);
    expect(armed.pressed, `theme ${t}: Customize reports armed`).toBe('true');
    expect(armed.customizeColor, `theme ${t}: Customize stays canonical when armed (${armed.raw})`).toBe(rest.customizeColor);
    await win.locator('[data-action-dock]').screenshot({ path: path.join(SHOTS, `p63-dock-edit-customize-${t}-armed.png`) });

    // Reset to rest for the next theme.
    await win.locator('[data-dock-menu-item="customize"]').click();
    await win.waitForFunction(
      () => document.querySelector('[data-action-dock]')?.getAttribute('data-dock-edit') === 'false',
      null, { timeout: 5000 },
    );
    await win.keyboard.press('Escape');
    await win.waitForTimeout(500);
  }

  await hardClose(app, 'p63-dock-edit');
});
