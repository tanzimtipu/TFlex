// PILOT 1 step 1 - bug-hunt: welcome screen and About dialog.
// Charter: both themes (dark, light) x two window sizes (small, maximized);
// tour every actionable element on both surfaces; boundary/recovery open-close-
// reopen and rapid repeat; before/after screenshots. QA evidence only.
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');
const path = require('node:path');
const fs = require('node:fs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
const IPC = { menuAction: 'menu:action' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function shotPath(name) {
  return path.join(SHOTS, `pilot1_${name}.png`);
}

async function openAbout(app, win) {
  await app.evaluate(({ BrowserWindow }, channel) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) w.webContents.send(channel, { action: 'about' });
  }, IPC.menuAction);
  await win.waitForSelector('[data-about-dialog]:visible', { timeout: 15000 });
}

async function closeAbout(win) {
  await win.click('.sheet-about .sheet-close');
  await win.waitForSelector('[data-about-dialog]', { state: 'detached', timeout: 8000 });
}

async function setTheme(win, theme) {
  const cur = await win.evaluate(() => document.documentElement.getAttribute('data-theme'));
  if (cur === theme) return;
  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  await win.click(`[data-theme-option="${theme}"]`);
  await win.waitForFunction(
    (t) => document.documentElement.getAttribute('data-theme') === t,
    theme,
    { timeout: 8000 },
  );
}

async function setSmall(app) {
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) {
      if (w.isMaximized()) w.unmaximize();
      w.setSize(900, 680);
    }
  });
  await sleep(500);
}

async function setMax(app) {
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) w.maximize();
  });
  await sleep(700);
}

// Geometry probe: element rect + clipping signals for containment checks.
async function rect(win, sel) {
  return win.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      x: Math.round(r.x), y: Math.round(r.y),
      w: Math.round(r.width), h: Math.round(r.height),
      right: Math.round(r.right), bottom: Math.round(r.bottom),
      scrollW: el.scrollWidth, clientW: el.clientWidth,
      scrollH: el.scrollHeight, clientH: el.clientHeight,
      overflowX: cs.overflowX, overflowY: cs.overflowY,
      visible: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none',
    };
  }, sel);
}

let app;
let win;
let pageErrors;

test.beforeEach(async () => {
  app = await launchApp([]);
  win = await app.firstWindow();
  pageErrors = [];
  win.on('pageerror', (e) => pageErrors.push(e.message));
  await win.waitForSelector('.sample-card', { timeout: 30000 });
});

test.afterEach(async () => {
  if (app) await hardClose(app);
});

const MATRIX = [
  { theme: 'dark', size: 'small' },
  { theme: 'dark', size: 'max' },
  { theme: 'light', size: 'small' },
  { theme: 'light', size: 'max' },
];

for (const { theme, size } of MATRIX) {
  test(`welcome+about ${theme}/${size}`, async () => {
    await setTheme(win, theme);
    if (size === 'small') await setSmall(app); else await setMax(app);

    const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
    await win.screenshot({ path: shotPath(`welcome_${theme}_${size}_before`), fullPage: false });

    // Welcome containment / tour probes.
    const info = await win.evaluate(() => {
      const w = document.querySelector('.welcome');
      const row = document.querySelector('[data-home-tools]');
      const cards = Array.from(document.querySelectorAll('.sample-card'));
      const sampleGrid = document.querySelector('.samples-grid');
      const hero = document.querySelector('.welcome-hero');
      const gr = sampleGrid ? sampleGrid.getBoundingClientRect() : null;
      return {
        title: document.querySelector('.welcome-title')?.textContent || null,
        homeTools: Array.from(document.querySelectorAll('[data-home-tool]')).map((b) => b.getAttribute('data-home-tool')),
        editToggle: !!document.querySelector('[data-home-edit-toggle]'),
        recentRows: document.querySelectorAll('.recent-row').length,
        recentEmpty: !!document.querySelector('.recent-empty'),
        sampleCards: cards.length,
        welcomeRect: w ? { h: Math.round(w.getBoundingClientRect().height), sh: w.scrollHeight } : null,
        heroRect: hero ? { y: Math.round(hero.getBoundingClientRect().y), h: Math.round(hero.getBoundingClientRect().height) } : null,
        rowRect: row ? { y: Math.round(row.getBoundingClientRect().y), h: Math.round(row.getBoundingClientRect().height), w: Math.round(row.getBoundingClientRect().width) } : null,
        gridRect: gr ? { y: Math.round(gr.y), h: Math.round(gr.height) } : null,
      };
    });

    // Tour edit mode: pen -> minus badges -> plus picker -> add an item.
    const tour = { rows: [], pickerItems: [], afterRemove: null, afterAdd: null };
    await win.click('[data-home-edit-toggle]');
    await sleep(350);
    tour.rows = await win.locator('[data-home-tool]').evaluateAll((els) => els.map((e) => e.getAttribute('data-home-tool')));
    tour.minusBadges = await win.locator('[data-home-minus]').count();
    await win.screenshot({ path: shotPath(`welcome_${theme}_${size}_editmode`) });

    const plus = win.locator('[data-home-plus]');
    if (await plus.count()) {
      await plus.click();
      await win.waitForSelector('[data-home-picker]', { timeout: 5000 }).catch(() => {});
      await sleep(250);
      tour.pickerItems = await win.locator('[data-home-picker-item]').evaluateAll((els) => els.map((e) => e.getAttribute('data-home-picker-item')));
      await win.screenshot({ path: shotPath(`welcome_${theme}_${size}_picker`) });
      if (tour.pickerItems.length) {
        await win.click(`[data-home-picker-item="${tour.pickerItems[0]}"]`);
        await sleep(300);
        tour.afterAdd = await win.locator('[data-home-tool]').evaluateAll((els) => els.map((e) => e.getAttribute('data-home-tool')));
      }
    }
    // Remove the last removable tile if any, verify it disappears.
    const minusCount = await win.locator('[data-home-minus]').count();
    if (minusCount > 0) {
      const firstMinus = win.locator('[data-home-minus]').first();
      const id = await firstMinus.getAttribute('data-home-minus');
      await firstMinus.click();
      await sleep(300);
      tour.afterRemove = {
        id,
        present: await win.locator(`[data-home-tool="${id}"]`).count(),
      };
    }
    // Exit edit mode with Escape.
    await win.keyboard.press('Escape');
    await sleep(250);
    await win.screenshot({ path: shotPath(`welcome_${theme}_${size}_after`) });

    // About: open, capture, tour, close.
    await openAbout(app, win);
    await sleep(400);
    await win.screenshot({ path: shotPath(`about_${theme}_${size}_before`) });
    const about = await win.evaluate(() => {
      const sheet = document.querySelector('[data-about-dialog]');
      const r = sheet.getBoundingClientRect();
      return {
        vw: window.innerWidth, vh: window.innerHeight,
        sheet: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), bottom: Math.round(r.bottom) },
        sheetScrollH: sheet.scrollHeight, sheetClientH: sheet.clientHeight,
        version: document.querySelector('[data-about-version]')?.textContent || null,
        updateKind: document.querySelector('[data-about-update]')?.getAttribute('data-about-update-kind') || null,
        updateText: document.querySelector('[data-about-update]')?.textContent || null,
        whatsNew: !!document.querySelector('[data-whats-new]'),
        checkBtn: !!document.querySelector('[data-about-check-update]'),
        pathLinks: document.querySelectorAll('.about-row-value-link').length,
        closeBtn: !!document.querySelector('.sheet-about .sheet-close'),
        themeAttr: document.documentElement.getAttribute('data-theme'),
      };
    });
    await closeAbout(win);
    await sleep(300);
    await win.screenshot({ path: shotPath(`about_${theme}_${size}_after_close`) });

    // eslint-disable-next-line no-console
    console.log('PILOT1_PROBE ' + JSON.stringify({ theme, size, vp, info, tour, about, pageErrors }));
    expect(pageErrors).toEqual([]);
  });
}

test('about boundary/recovery: open close reopen + rapid repeat', async () => {
  await setTheme(win, 'dark');
  await openAbout(app, win);
  await closeAbout(win);
  await openAbout(app, win);
  const v2 = await win.locator('[data-about-version]').count();
  const visible2 = await win.locator('[data-about-dialog]:visible').count();
  await closeAbout(win);
  await sleep(200);

  // Rapid repeat: 6 open/close cycles as fast as the app allows.
  const rapidErrors = [];
  for (let i = 0; i < 6; i++) {
    try {
      await openAbout(app, win);
      await closeAbout(win);
    } catch (e) {
      rapidErrors.push(`cycle ${i}: ${e.message}`);
    }
  }
  // Final state must be clean: no leftover dialog, welcome interactive.
  const leftover = await win.locator('[data-about-dialog]').count();
  const welcomeVisible = await win.locator('.welcome').isVisible();
  await win.screenshot({ path: shotPath('about_rapid_recovery_final') });

  // Double-open (press About twice without closing) must stay a single sheet.
  await openAbout(app, win);
  await openAbout(app, win);
  const sheets = await win.locator('[data-about-dialog]').count();
  await win.screenshot({ path: shotPath('about_double_open') });
  await closeAbout(win);

  // eslint-disable-next-line no-console
  console.log('PILOT1_BOUNDARY ' + JSON.stringify({ v2, visible2, rapidErrors, leftover, welcomeVisible, sheets, pageErrors }));
  expect(v2).toBe(1);
  expect(visible2).toBe(1);
  expect(rapidErrors).toEqual([]);
  expect(leftover).toBe(0);
  expect(sheets).toBe(1);
  expect(pageErrors).toEqual([]);
});

test('about recovery: backdrop click and Escape close it', async () => {
  await openAbout(app, win);
  // Click a point on the backdrop that is clearly outside the centered sheet.
  await win.evaluate(() => {
    const sheet = document.querySelector('[data-about-dialog]').getBoundingClientRect();
    const bd = document.querySelector('.sheet-backdrop').getBoundingClientRect();
    const x = Math.max(bd.left + 4, sheet.left - 40);
    const y = Math.min(bd.bottom - 4, sheet.bottom + 20);
    return { x, y };
  });
  await win.mouse.click(30, 400);
  await sleep(700);
  const afterBackdrop = await win.locator('[data-about-dialog]').count();
  await win.screenshot({ path: shotPath('about_backdrop_close') });

  await openAbout(app, win);
  await win.keyboard.press('Escape');
  await sleep(700);
  const afterEscape = await win.locator('[data-about-dialog]').count();
  await win.screenshot({ path: shotPath('about_escape') });

  // eslint-disable-next-line no-console
  console.log('PILOT1_RECOVERY ' + JSON.stringify({ afterBackdrop, afterEscape, pageErrors }));
  expect(pageErrors).toEqual([]);
});

test('welcome edit-mode minus badge overlap geometry', async () => {
  const results = [];
  for (const theme of ['dark', 'light']) {
    await setTheme(win, theme);
    for (const size of ['small', 'max']) {
      if (size === 'small') await setSmall(app); else await setMax(app);
      const on = await win.locator('[data-home-edit-toggle]').getAttribute('aria-pressed');
      if (on !== 'true') await win.click('[data-home-edit-toggle]');
      await sleep(300);
      const geo = await win.evaluate(() => {
        const out = [];
        for (const b of document.querySelectorAll('.home-tool')) {
          const badge = b.querySelector('.home-tool-minus');
          if (!badge) continue;
          let lbl = null;
          for (const n of b.childNodes) {
            if (n.nodeType === 3 && n.textContent.trim()) {
              const r = document.createRange();
              r.selectNodeContents(n);
              const rr = r.getBoundingClientRect();
              lbl = lbl === null ? { left: rr.left, top: rr.top, right: rr.right, bottom: rr.bottom }
                : { left: Math.min(lbl.left, rr.left), top: Math.min(lbl.top, rr.top), right: Math.max(lbl.right, rr.right), bottom: Math.max(lbl.bottom, rr.bottom) };
            }
          }
          const br = badge.getBoundingClientRect();
          const overlap = lbl !== null && !(br.right < lbl.left || br.left > lbl.right || br.bottom < lbl.top || br.top > lbl.bottom);
          const pad = lbl !== null ? Math.round(br.left - lbl.right) : null;
          out.push({
            id: b.getAttribute('data-home-tool'),
            labelRight: lbl ? Math.round(lbl.right) : null,
            labelBottom: lbl ? Math.round(lbl.bottom) : null,
            badgeLeft: Math.round(br.left), badgeTop: Math.round(br.top),
            badgeRight: Math.round(br.right), badgeBottom: Math.round(br.bottom),
            overlap, gapBadgeToLabelRight: pad,
          });
        }
        return out;
      });
      results.push({ theme, size, geo });
      await win.screenshot({ path: shotPath(`welcome_${theme}_${size}_badgezoom`) });
    }
  }
  // eslint-disable-next-line no-console
  console.log('PILOT1_BADGE ' + JSON.stringify(results));
});

test('welcome actionable-element tour', async () => {
  // Stub the native Open PDF dialog so the click resolves without an OS modal.
  await app.evaluate(({ ipcMain }) => {
    try { ipcMain.removeHandler('dialog:openFile'); } catch (e) { /* ignore */ }
    ipcMain.handle('dialog:openFile', () => null);
  });

  const homeBtns = await win.locator('[data-home-tool]').count();
  // Open PDF (fixed tile) - dialog stub returns null.
  await win.click('[data-home-tool="open"]');
  await sleep(400);
  const afterOpen = await win.locator('.welcome').count();

  // Create PDF from images opens its own dialog directly (no native picker).
  await win.click('[data-home-tool="createFromImages"]');
  await win.waitForSelector('[data-create-from-images-dialog]', { timeout: 8000 });
  await win.screenshot({ path: shotPath('welcome_create_images_dialog') });
  await win.keyboard.press('Escape');
  await sleep(500);
  const createClosed = await win.locator('[data-create-from-images-dialog]').count();

  // Merge PDFs opens the merge flow.
  await win.click('[data-home-tool="merge"]');
  await sleep(1200);
  const mergeOpen = await win.locator('.merge-dialog, [data-merge-confirm]').count();
  await win.screenshot({ path: shotPath('welcome_merge_dialog') });
  if (mergeOpen > 0) {
    await win.keyboard.press('Escape');
    await sleep(500);
    const mc = win.locator('.merge-dialog .modal-close');
    if (await mc.count()) await mc.click({ timeout: 3000 }).catch(() => {});
    await sleep(400);
  }
  const afterCreateMerge = await win.locator('.welcome').count();

  // Recent: open the first row, then return home via Ctrl+W.
  const recentBefore = await win.locator('.recent-row').count();
  await win.click('.recent-row .recent-row-open');
  await sleep(2500);
  const workspaceOpen = await win.locator('.welcome').count() === 0;
  await win.screenshot({ path: shotPath('welcome_recent_open_doc') });
  await win.keyboard.press('Control+w');
  await sleep(1200);
  const backHome = await win.locator('.welcome').count();

  // Recent remove: count drops by one.
  await win.waitForSelector('.recent-row', { timeout: 8000 }).catch(() => {});
  const beforeRemove = await win.locator('.recent-row').count();
  if (beforeRemove > 0) {
    await win.click('.recent-row .recent-row-remove');
    await sleep(400);
  }
  const afterRemove = await win.locator('.recent-row').count();

  // Sample card: open one.
  await win.click('.sample-card');
  await sleep(2500);
  const sampleOpened = await win.locator('.welcome').count() === 0;
  await win.screenshot({ path: shotPath('welcome_sample_open_doc') });

  // eslint-disable-next-line no-console
  console.log('PILOT1_TOUR ' + JSON.stringify({ homeBtns, afterOpen, createClosed, mergeOpen, afterCreateMerge, recentBefore, workspaceOpen, backHome, beforeRemove, afterRemove, sampleOpened, pageErrors }));
  expect(pageErrors).toEqual([]);
  expect(homeBtns).toBe(3);
  expect(afterOpen).toBe(1);
  expect(afterCreateMerge).toBe(1);
  expect(createClosed).toBe(0);
  expect(afterRemove).toBe(beforeRemove - 1);
  expect(sampleOpened).toBe(true);
});

test('about actionable-element tour (check-update + path links)', async () => {
  // Record openPath IPC at the main process so path links do not launch Explorer.
  await app.evaluate(({ ipcMain }) => {
    globalThis.__openPathCalls = [];
    try { ipcMain.removeHandler('app:openPath'); } catch (e) { /* ignore */ }
    ipcMain.handle('app:openPath', (_e, p) => {
      globalThis.__openPathCalls.push(p);
      return null;
    });
  });
  await openAbout(app, win);
  await sleep(400);

  // Path link buttons.
  const links = win.locator('.about-row-value-link');
  const n = await links.count();
  for (let i = 0; i < n; i++) await links.nth(i).click();
  await sleep(400);
  const openedPaths = await app.evaluate(() => globalThis.__openPathCalls || []);

  // Check for Updates.
  await win.click('[data-about-check-update]');
  await sleep(2500);
  const promptOpen = await win.locator('[data-update-prompt], .sheet-update-prompt').count();
  await win.screenshot({ path: shotPath('about_check_update') });
  if (promptOpen > 0) {
    // Dismiss the prompt (Escape then its close button).
    await win.keyboard.press('Escape');
    await sleep(500);
    const still = await win.locator('[data-update-prompt], .sheet-update-prompt').count();
    if (still > 0) {
      const btn = win.locator('[data-update-prompt] button, .sheet-update-prompt button').last();
      if (await btn.count()) await btn.click({ timeout: 3000 }).catch(() => {});
    }
  }
  const aboutStillOpen = await win.locator('[data-about-dialog]').count();

  // eslint-disable-next-line no-console
  console.log('PILOT1_ABOUTTOUR ' + JSON.stringify({ pathLinks: n, openedPaths, promptOpen, aboutStillOpen, pageErrors }));
  expect(pageErrors).toEqual([]);
  expect(n).toBe(3);
  expect(openedPaths.length).toBe(3);
  expect(openedPaths.every((p) => typeof p === 'string' && p.length > 0)).toBe(true);
});

test('welcome recent row click on a missing file', async () => {
  const recents = await win.locator('.recent-row').evaluateAll((rows) =>
    rows.map((r) => ({
      title: r.getAttribute('title'),
      name: r.querySelector('.doc-name')?.textContent || null,
    })),
  );
  const exists = {};
  for (const r of recents) {
    try { exists[r.title] = fs.existsSync(r.title); } catch (e) { exists[r.title] = 'err'; }
  }
  const missing = recents.find((r) => exists[r.title] === false);
  let toast = null;
  let welcome = null;
  let clickedName = null;
  if (missing) {
    clickedName = missing.name;
    const row = win.locator(`.recent-row[title="${missing.title.replace(/\\/g, '\\\\')}"] .recent-row-open`);
    const target = (await row.count()) ? row : win.locator('.recent-row .recent-row-open').first();
    // click the row whose title matches; fall back handled above
    await win.locator('.recent-row').filter({ hasText: missing.name }).first().locator('.recent-row-open').click();
    await sleep(1800);
    toast = await win.locator('.toast').allInnerTexts().catch(() => []);
    welcome = await win.locator('.welcome').count();
    await win.screenshot({ path: shotPath('welcome_missing_recent_click') });
  }
  // eslint-disable-next-line no-console
  console.log('PILOT1_MISSINGRECENT ' + JSON.stringify({ exists, missingTitle: missing ? missing.title : null, clickedName, toast, welcome, pageErrors }));
  expect(pageErrors).toEqual([]);
});

test('welcome sample recent row reopens the sample', async () => {
  // Open a sample card, return home, then click the Recent row it created.
  const sampleName = await win.locator('.sample-card .sample-name').first().innerText();
  await win.click('.sample-card');
  await sleep(2500);
  await win.keyboard.press('Control+w');
  await win.waitForSelector('.welcome', { timeout: 8000 });
  await sleep(600);

  const titles = await win.locator('.recent-row').evaluateAll((rows) =>
    rows.map((r) => r.getAttribute('title')),
  );
  const sampleTitle = titles.find((t) => t && t.startsWith('samples/'));
  let toast = null;
  let welcome = null;
  let reopened = null;
  if (sampleTitle) {
    await win.locator('.recent-row').filter({ hasText: sampleName }).first().locator('.recent-row-open').click();
    await sleep(2000);
    toast = await win.locator('.toast').allInnerTexts().catch(() => []);
    welcome = await win.locator('.welcome').count();
    reopened = welcome === 0;
    await win.screenshot({ path: shotPath('welcome_sample_recent_click') });
  }
  // eslint-disable-next-line no-console
  console.log('PILOT1_SAMPLERECENT ' + JSON.stringify({ sampleName, sampleTitle, toast, welcome, reopened, pageErrors }));
  expect(sampleTitle).toBeTruthy();
  expect(reopened).toBe(true);
  expect((toast || []).filter((t) => /Could not open file/i.test(t))).toEqual([]);
  expect(pageErrors).toEqual([]);
});
