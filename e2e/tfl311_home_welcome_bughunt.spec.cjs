// TFL-311 — QA evidence + bounded bug-hunt for the Home / Welcome sweep (TFL-310).
// Captures the required screenshot set under screenshots/bug-sweep-2026-10-02/
// and probes the visual + non-visual bug-hunt axes. Evidence only; no fixes.
const { test, expect } = require('@playwright/test');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');
const path = require('node:path');
const fs = require('node:fs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots', 'bug-sweep-2026-10-02');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function setTheme(win, theme) {
  const cur = await win.evaluate(() => document.documentElement.getAttribute('data-theme'));
  if (cur === theme) return;
  await win.click('[data-theme-toggle]', { force: true });
  await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  await sleep(350);
  await win.click(`[data-theme-option="${theme}"]`, { force: true });
  await win.waitForFunction(
    (t) => document.documentElement.getAttribute('data-theme') === t,
    theme,
    { timeout: 8000 },
  );
  await sleep(200);
  await win.waitForSelector('.theme-toggle-popover', { state: 'detached', timeout: 1500 }).catch(() => {});
  if (await win.locator('.theme-toggle-popover').count()) {
    await win.keyboard.press('Escape');
    await win.waitForSelector('.theme-toggle-popover', { state: 'detached', timeout: 5000 }).catch(() => {});
  }
  await sleep(250);
}

async function setSize(app, w, h) {
  await app.evaluate(({ BrowserWindow }, s) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    win.setSize(s.w, s.h);
  }, { w, h });
  await sleep(500);
}

test('A: hero + tool row (frosted/light/dark), samples grid, 640px minimum', async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const app = await launchApp([]);
  try {
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await sleep(400);

    for (const theme of ['frosted', 'light', 'dark']) {
      await setTheme(win, theme);
      await win.screenshot({ path: path.join(SHOTS, `home-hero-toolrow-${theme}.png`) });
    }
    await setTheme(win, 'dark');
    await win.screenshot({ path: path.join(SHOTS, 'home-samples-grid-dark.png') });

    const wide = await win.evaluate(() => {
      const row = document.querySelector('[data-home-tools]').getBoundingClientRect();
      const grid = document.querySelector('.samples-grid').getBoundingClientRect();
      return { vw: window.innerWidth, rowW: Math.round(row.width), rowH: Math.round(row.height), gridW: Math.round(grid.width) };
    });

    await setSize(app, 640, 720);
    const at640 = await win.evaluate(() => {
      const vw = window.innerWidth;
      const pen = document.querySelector('[data-home-edit-toggle]').getBoundingClientRect();
      const row = document.querySelector('[data-home-tools]');
      const rr = row.getBoundingClientRect();
      return {
        vw,
        penLeft: Math.round(pen.left), penRight: Math.round(pen.right), penBottom: Math.round(pen.bottom),
        rowLeft: Math.round(rr.left), rowRight: Math.round(rr.right), rowH: Math.round(rr.height),
        rowScrollW: row.scrollWidth, rowClientW: row.clientWidth,
        penInsideRow: pen.right <= rr.right + 0.5 && pen.left >= rr.left - 0.5,
        noHorizOverflow: row.scrollWidth <= row.clientWidth + 1,
      };
    });
    await win.screenshot({ path: path.join(SHOTS, 'home-hero-toolrow-640.png') });

    // eslint-disable-next-line no-console
    console.log('TFL311_A ' + JSON.stringify({ wide, at640 }));
    expect(at640.penInsideRow, 'pen stays inside the (wrapped) row at 640px').toBe(true);
    expect(at640.noHorizOverflow, 'tool row must not overflow horizontally at 640px').toBe(true);
    expect(at640.rowH, 'row wraps to a second line at 640px').toBeGreaterThan(50);
  } finally {
    await hardClose(app, 'tfl311-A');
  }
});

test('B: edit mode, jiggle, picker clamp, Escape ordering, reduced motion', async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const app = await launchApp([]);
  try {
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await sleep(400);
    await setTheme(win, 'dark');

    await win.click('[data-home-edit-toggle]');
    await sleep(400);
    await win.screenshot({ path: path.join(SHOTS, 'home-editmode-armed-dark.png') });

    const jig = await win.evaluate(() => {
      const icons = Array.from(document.querySelectorAll('.home-tool-icon'));
      return {
        count: icons.length,
        names: icons.map((e) => getComputedStyle(e).animationName),
        delays: icons.map((e) => getComputedStyle(e).animationDelay),
      };
    });

    // Reduced-motion: the jiggle must be removed outright.
    await win.emulateMedia({ reducedMotion: 'reduce' });
    await sleep(150);
    const rm = await win.evaluate(() => getComputedStyle(document.querySelector('.home-tool-icon')).animationName);
    await win.emulateMedia({ reducedMotion: 'no-preference' });
    await sleep(150);

    // Picker open + viewport clamp (wide).
    await win.click('[data-home-plus]');
    await win.waitForSelector('[data-home-picker-item]', { timeout: 8000 });
    await sleep(300);
    await win.screenshot({ path: path.join(SHOTS, 'home-plus-picker-open-dark.png') });
    const clampWide = await win.evaluate(() => {
      const p = document.querySelector('[data-home-picker]').getBoundingClientRect();
      return { vw: window.innerWidth, vh: window.innerHeight, x: Math.round(p.x), right: Math.round(p.right), bottom: Math.round(p.bottom), items: document.querySelectorAll('[data-home-picker-item]').length };
    });

    // Resize while the picker is open: DEF-473 requires the portal to re-anchor
    // to the plus and re-clamp into the shrinking viewport (no spill).
    await setSize(app, 640, 720);
    await sleep(300);
    const resizeSpill = await win.evaluate(() => {
      const p = document.querySelector('[data-home-picker]');
      if (!p) return null;
      const r = p.getBoundingClientRect();
      const plus = document.querySelector('[data-home-plus]');
      const pr = plus ? plus.getBoundingClientRect() : null;
      return { vw: window.innerWidth, vh: window.innerHeight, x: Math.round(r.x), right: Math.round(r.right), bottom: Math.round(r.bottom), plusX: pr ? Math.round(pr.x) : null, plusRight: pr ? Math.round(pr.right) : null };
    });
    await win.screenshot({ path: path.join(SHOTS, 'home-plus-picker-640-resize.png') });

    // Fresh clamp: close, then reopen at the 640px minimum.
    await win.keyboard.press('Escape');
    await sleep(250);
    await win.click('[data-home-plus]');
    await win.waitForSelector('[data-home-picker-item]', { timeout: 8000 });
    await sleep(300);
    const clamp640 = await win.evaluate(() => {
      const p = document.querySelector('[data-home-picker]');
      if (!p) return null;
      const r = p.getBoundingClientRect();
      return { vw: window.innerWidth, vh: window.innerHeight, x: Math.round(r.x), right: Math.round(r.right), bottom: Math.round(r.bottom) };
    });
    await win.screenshot({ path: path.join(SHOTS, 'home-plus-picker-640.png') });

    // Escape ordering: picker first, edit second.
    await win.keyboard.press('Escape');
    await sleep(200);
    const afterFirst = await win.evaluate(() => ({
      picker: !!document.querySelector('[data-home-picker]'),
      edit: document.querySelector('[data-home-tools]').getAttribute('data-home-edit'),
    }));
    await win.keyboard.press('Escape');
    await sleep(200);
    const afterSecond = await win.evaluate(() => document.querySelector('[data-home-tools]').getAttribute('data-home-edit'));

    // Outside pointerdown dismissal.
    await setSize(app, 1280, 800);
    await win.click('[data-home-edit-toggle]');
    await sleep(200);
    await win.click('[data-home-plus]');
    await win.waitForSelector('[data-home-picker]', { timeout: 5000 });
    await win.locator('.welcome-title').click();
    await sleep(300);
    const afterOutside = await win.evaluate(() => ({
      picker: !!document.querySelector('[data-home-picker]'),
      edit: document.querySelector('[data-home-tools]').getAttribute('data-home-edit'),
    }));

    // eslint-disable-next-line no-console
    console.log('TFL311_B ' + JSON.stringify({ jig, rm, clampWide, resizeSpill, clamp640, afterFirst, afterSecond, afterOutside }));
    expect(jig.names.every((n) => n.includes('tf-anim-jiggle'))).toBe(true);
    expect(new Set(jig.delays).size).toBeGreaterThan(1);
    expect(rm, 'reduced motion removes the jiggle').toBe('none');
    expect(clampWide.items).toBe(5);
    expect(clampWide.x).toBeGreaterThanOrEqual(0);
    expect(clampWide.right).toBeLessThanOrEqual(clampWide.vw + 1);
    expect(clampWide.bottom).toBeLessThanOrEqual(clampWide.vh + 1);
    // DEF-473: the picker must re-clamp on resize while open (previously spilled
    // 30px past the right edge and detached from the plus).
    expect(resizeSpill, 'picker stays mounted through the resize').not.toBeNull();
    expect(resizeSpill.right, 'picker right edge re-clamped inside viewport after resize').toBeLessThanOrEqual(resizeSpill.vw + 1);
    expect(resizeSpill.x, 'picker left edge inside viewport after resize').toBeGreaterThanOrEqual(0);
    expect(resizeSpill.bottom, 'picker bottom edge inside viewport after resize').toBeLessThanOrEqual(resizeSpill.vh + 1);
    if (clamp640) {
      expect(clamp640.x).toBeGreaterThanOrEqual(0);
      expect(clamp640.right).toBeLessThanOrEqual(clamp640.vw + 1);
      expect(clamp640.bottom).toBeLessThanOrEqual(clamp640.vh + 1);
    }
    expect(afterFirst.picker).toBe(false);
    expect(afterFirst.edit).toBe('true');
    expect(afterSecond).toBe('false');
    expect(afterOutside.picker).toBe(false);
    expect(afterOutside.edit).toBe('true');
  } finally {
    await hardClose(app, 'tfl311-B');
  }
});

test('C: recent long path truncation + samples loading ring probe', async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const app = await launchApp([]);
  try {
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await sleep(300);
    await setTheme(win, 'dark');

    // Seed a genuinely long recent path by opening a temp copy of a sample.
    const seeded = getSamplePath('form.pdf');
    await app.evaluate(async ({ dialog }, p) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
    }, seeded);
    await win.locator('button:has-text("Open PDF")').first().click();
    await win.waitForSelector('.workspace', { timeout: 30000 });
    await win.keyboard.press('Control+w');
    await win.waitForSelector('.welcome', { timeout: 8000 });
    await sleep(600);
    fs.unlinkSync(seeded);
    await setSize(app, 1280, 800);
    await win.screenshot({ path: path.join(SHOTS, 'home-recent-longpath.png') });

    const recent = await win.evaluate(() => {
      const row = Array.from(document.querySelectorAll('.recent-row'))
        .find((r) => (r.getAttribute('title') || '').includes('tflex-e2e-samples'));
      if (!row) return null;
      const pathEl = row.querySelector('.doc-path');
      const nameEl = row.querySelector('.doc-name');
      const rm = row.querySelector('.recent-row-remove');
      const rr = rm.getBoundingClientRect();
      return {
        name: nameEl.textContent,
        dir: pathEl.textContent,
        truncated: pathEl.scrollWidth > pathEl.clientWidth,
        removeVisible: rr.width > 0 && rr.right <= window.innerWidth,
      };
    });

    // Loading ring: stub the samples IPC to never resolve, then reload.
    await app.evaluate(({ ipcMain }) => {
      try { ipcMain.removeHandler('samples:list'); } catch (e) { /* ignore */ }
      ipcMain.handle('samples:list', () => new Promise(() => {}));
    });
    await win.reload();
    await win.waitForSelector('.samples-empty', { timeout: 15000 });
    await sleep(300);
    const loading = await win.evaluate(() => {
      const el = document.querySelector('.samples-empty .brand-loader');
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        text: document.querySelector('.samples-empty').textContent,
        animationName: cs.animationName,
        animationDuration: cs.animationDuration,
        hasSpinClass: el.classList.contains('update-indicator-spin'),
      };
    });
    await win.screenshot({ path: path.join(SHOTS, 'home-samples-loading.png') });

    // eslint-disable-next-line no-console
    console.log('TFL311_C ' + JSON.stringify({ recent, loading }));
    expect(recent).not.toBeNull();
    expect(recent.truncated, 'long recent path truncates with ellipsis').toBe(true);
    expect(recent.removeVisible, 'recent remove button stays in viewport').toBe(true);
    // DEF-472: the samples loading ring must animate (previously animationName:"none").
    expect(loading, 'samples loading ring is present').not.toBeNull();
    expect(loading.animationName, 'samples loading ring animates').not.toBe('none');
    expect(loading.hasSpinClass, 'samples loading ring carries the spin class').toBe(true);
  } finally {
    await hardClose(app, 'tfl311-C');
  }
});
