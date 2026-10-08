// TFL-1293 (Phase 114) — DEF-646 blast-radius + scope check, and the DEF-641
// footer full/compact evidence.
//
// The TFL-1290 fix scopes the Preferences sheet body with
// `.sheet-body-prefs:has(> .settings-studio-shell)`. This spec proves that rule
// (a) is confined to the Preferences sheet that actually hosts the shell and
// (b) touches nothing on Home or a document surface, and captures the Studio at
// full and compact width with the persistence footer visible.
//
// Launches only through the canonical `launchApp` helper. Read-only: writes only
// under screenshots/phase114.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots', 'phase114');
fs.mkdirSync(SHOTS, { recursive: true });
const shot = (n) => path.join(SHOTS, n);

let app = null;
let win = null;
test.setTimeout(180000);

async function launch(ud = null) {
  app = await launchApp([], ud);
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
}
async function close(label) {
  if (app) await hardClose(app, label);
  app = null;
  win = null;
}
async function openViaCtrlComma() {
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.webContents.sendInputEvent({ type: 'keyDown', keyCode: ',', modifiers: ['control'] });
    w.webContents.sendInputEvent({ type: 'keyUp', keyCode: ',', modifiers: ['control'] });
  });
  await win.waitForSelector('[data-prefs-dialog]', { timeout: 10000 });
  await win.waitForTimeout(300);
}

test.beforeEach(async () => {
  await launch();
});
test.afterEach(async () => {
  await close('tfl1293');
});

test('S1 scope: the `.sheet-body-prefs:has` rule is confined to the Studio sheet; Home and a document surface are untouched', async () => {
  // Home (zero documents): no Preferences sheet body is mounted, and the main
  // app area has a real, non-collapsed height.
  const home = await win.evaluate(() => ({
    prefsBodies: document.querySelectorAll('.sheet-body-prefs').length,
    shells: document.querySelectorAll('.settings-studio-shell').length,
    welcome: (() => { const e = document.querySelector('.welcome'); if (!e) return null; const b = e.getBoundingClientRect(); return { h: Math.round(b.height) }; })(),
  }));
  console.log('[tfl1293-s1] home =', JSON.stringify(home));
  expect(home.prefsBodies, 'no Studio sheet body on Home').toBe(0);
  expect(home.shells, 'no Studio shell on Home').toBe(0);
  expect(home.welcome && home.welcome.h, 'Home welcome pane has non-zero height').toBeGreaterThan(0);

  // Open a real document surface.
  await win.locator('.sample-card').first().click();
  await win.waitForSelector('[data-stage-rail]', { timeout: 30000 });
  await win.waitForTimeout(500);
  const doc = await win.evaluate(() => ({
    prefsBodies: document.querySelectorAll('.sheet-body-prefs').length,
    shells: document.querySelectorAll('.settings-studio-shell').length,
    workspace: (() => { const e = document.querySelector('.workspace'); if (!e) return null; const b = e.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height) }; })(),
  }));
  console.log('[tfl1293-s1] document =', JSON.stringify(doc));
  expect(doc.prefsBodies, 'no Studio sheet body on a document surface').toBe(0);
  expect(doc.shells, 'no Studio shell on a document surface').toBe(0);
  expect(doc.workspace && doc.workspace.h, 'workspace has non-zero height').toBeGreaterThan(0);

  // Open the Studio: exactly one sheet body, it is a flex column because the
  // shell is its direct child, and the Studio has a real height.
  await openViaCtrlComma();
  const studio = await win.evaluate(() => {
    const bodies = [...document.querySelectorAll('.sheet-body-prefs')];
    const body = bodies[0];
    const shell = body && body.querySelector(':scope > .settings-studio-shell');
    const st = document.querySelector('.settings-studio');
    return {
      bodies: bodies.length,
      display: body ? getComputedStyle(body).display : null,
      hasDirectShell: !!shell,
      studioH: st ? Math.round(st.getBoundingClientRect().height) : null,
    };
  });
  console.log('[tfl1293-s1] studio =', JSON.stringify(studio));
  expect(studio.bodies, 'exactly one Studio sheet body').toBe(1);
  expect(studio.display, 'the Studio sheet body is a flex column (definite height chain)').toBe('flex');
  expect(studio.hasDirectShell, 'the shell is a direct child of the scoped sheet body').toBe(true);
  expect(studio.studioH, 'Studio height is non-zero').toBeGreaterThan(0);
});

test('S2 DEF-641 footer: visible and non-scrolling at full and compact width; body scrolls internally', async () => {
  await openViaCtrlComma();
  // The status footer sits on the sheet's pinned footer row, below the scrolling
  // body, and is on screen.
  const full = await win.evaluate(() => {
    const p = document.querySelector('[data-prefs-persist-status]');
    const sheet = document.querySelector('.sheet-prefs');
    const body = document.querySelector('.settings-studio-body');
    const shell = document.querySelector('.settings-studio-shell');
    const pr = p ? p.getBoundingClientRect() : null;
    const sr = sheet ? sheet.getBoundingClientRect() : null;
    const br = body ? body.getBoundingClientRect() : null;
    return {
      text: p ? p.textContent.trim() : null,
      visible: pr ? pr.width > 0 && pr.height > 0 : false,
      inViewport: pr ? pr.bottom <= window.innerHeight + 1 && pr.top >= 0 : false,
      pinnedBelowBody: pr && br ? pr.top >= br.bottom - 1 : false,
      insideSheetBottom: pr && sr ? pr.bottom <= sr.bottom + 1 : false,
      shellDirect: shell && body ? shell.contains(p) && !body.contains(p) : false,
      bodyOverflow: body ? getComputedStyle(body).overflowY : null,
    };
  });
  console.log('[tfl1293-s2] full =', JSON.stringify(full));
  expect(full.text, 'at-rest success text').toBe('All changes saved.');
  expect(full.visible, 'footer visible').toBe(true);
  expect(full.inViewport, 'footer in the viewport at full size').toBe(true);
  expect(full.pinnedBelowBody, 'footer sits below the scrolling body').toBe(true);
  expect(full.insideSheetBottom, 'footer is inside the sheet bottom').toBe(true);
  expect(full.shellDirect, 'footer is on the shell, not inside the scrolling body').toBe(true);
  expect(full.bodyOverflow, 'body scrolls internally').toBe('auto');
  await win.screenshot({ path: shot('studio-full-footer.png') });

  // Compact width (520px): footer stays visible and pinned.
  const bounds = await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w.isMaximized()) { w.unmaximize(); await new Promise((r) => setTimeout(r, 600)); }
    w.setMinimumSize(120, 120);
    w.setSize(520, 700);
    await new Promise((r) => setTimeout(r, 800));
    return w.getBounds();
  });
  await win.waitForTimeout(400);
  console.log('[tfl1293-s2] compact bounds =', JSON.stringify(bounds));
  const compact = await win.evaluate(() => {
    const p = document.querySelector('[data-prefs-persist-status]');
    const body = document.querySelector('.settings-studio-body');
    const pr = p ? p.getBoundingClientRect() : null;
    const br = body ? body.getBoundingClientRect() : null;
    return {
      innerWidth: window.innerWidth,
      visible: pr ? pr.width > 0 && pr.height > 0 : false,
      inViewport: pr ? pr.bottom <= window.innerHeight + 1 && pr.top >= 0 : false,
      pinnedBelowBody: pr && br ? pr.top >= br.bottom - 1 : false,
      scrollW: document.documentElement.scrollWidth,
      clientW: document.documentElement.clientWidth,
    };
  });
  console.log('[tfl1293-s2] compact =', JSON.stringify(compact));
  expect(compact.innerWidth, 'compact CSS viewport reached').toBeLessThanOrEqual(720);
  expect(compact.visible, 'footer visible at compact width').toBe(true);
  expect(compact.inViewport, 'footer in the viewport at compact width').toBe(true);
  expect(compact.pinnedBelowBody, 'footer pinned below the body at compact width').toBe(true);
  expect(compact.scrollW, 'no horizontal overflow at compact width').toBeLessThanOrEqual(compact.clientW + 1);
  await win.screenshot({ path: shot('studio-compact-footer.png') });
});
