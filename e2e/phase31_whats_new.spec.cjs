// Phase 31 — "What's New" in the About dialog (focused verification).
//
// Entry point: Help -> About TFlex. Electron's native menu cannot be clicked
// through CDP, so the spec sends the REAL `menu:action` payload
// `{ action: 'about' }` from the main process — exactly what src/main/menu.ts
// emits on Help -> About TFlex.
//
// Offline establishment: this dev build is UNPACKAGED, so electron-updater
// skips the startup check entirely (no feed contact), the update state stays at
// its initial idle 'checking' value, and the spec's request listener asserts no
// github/api request is made. The notes still render, and the first highlight
// line is asserted to be a literal in the built renderer bundle — together
// proving the notes are bundle-served, not fetched.
//
// DEF-308 / DEF-309 — the belt-and-braces Chromium DNS block
// (`--host-resolver-rules=MAP * 127.0.0.1` passed through launchApp) is back.
// DEF-308 removed it because ANY non-empty `extraArgs` wedged this dev app
// before it created a BrowserWindow; DEF-309 diagnosed that as a harness bug
// in launch.cjs (extraArgs were placed BEFORE the app path, so the main
// process's OS-file-argument parser mistook the app directory for a document
// and blocked in a modal error box) and fixed it. With the harness fixed the
// switch is applied again, so the offline proof is by construction as well as
// by the unpackaged-updater skip asserted below.
const { test, expect } = require('@playwright/test');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');
const fs = require('node:fs');
const path = require('node:path');

// Chromium DNS block: every hostname resolves to loopback, so any accidental
// feed contact would fail rather than reach GitHub.
const BLOCK_NET = '--host-resolver-rules=MAP * 127.0.0.1';

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const RUNNING_VERSION = String(pkg.version);

const IPC = { menuAction: 'menu:action', updateStatusChanged: 'update:statusChanged' };

test.describe("Phase 31 - About What's New", () => {
  let app;
  let win;
  let pageErrors;
  let consoleErrors;

  test.beforeEach(async () => {
    app = await launchApp([BLOCK_NET]);
    win = await app.firstWindow();
    pageErrors = [];
    consoleErrors = [];
    win.on('pageerror', (e) => pageErrors.push(e.message));
    win.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
    await win.waitForSelector('.sample-card', { timeout: 30000 });
  });

  test.afterEach(async () => {
    if (app) await hardClose(app);
  });

  test('bundled notes render, sheet is contained, incoming notes are plain text', async () => {
    // Help -> About TFlex (real main-process menu action payload).
    await app.evaluate(({ BrowserWindow }, channel) => {
      const w = BrowserWindow.getAllWindows()[0];
      if (w) w.webContents.send(channel, { action: 'about' });
    }, IPC.menuAction);
    await win.waitForSelector('[data-about-dialog]:visible', { timeout: 15000 });

    // 1. Running version's bundled entry.
    await expect(win.locator('[data-whats-new]')).toBeVisible();
    const versionLabel = (await win.locator('[data-whats-new-version]').innerText()).trim();
    expect(versionLabel).toContain(RUNNING_VERSION);
    const highlights = win.locator('[data-whats-new-highlight]');
    const count = await highlights.count();
    expect(count).toBeGreaterThanOrEqual(1);
    const texts = await highlights.allInnerTexts();
    for (const t of texts) expect(t.trim().length).toBeGreaterThan(0);
    const firstHighlight = texts[0].trim();

    // Bundle origin: the rendered line is a literal in the built renderer JS.
    const assetsDir = path.join(ROOT, 'dist', 'renderer', 'assets');
    const bundle = fs.readdirSync(assetsDir)
      .filter((f) => f.endsWith('.js'))
      .map((f) => fs.readFileSync(path.join(assetsDir, f), 'utf8'))
      .join('\n');
    expect(bundle).toContain(firstHighlight);

    // 2. Offline. This dev build is UNPACKAGED, so electron-updater skips the
    //    startup check entirely (AppUpdater.js:278-280: "Skip checkForUpdates
    //    because application is not packed and dev update config is not
    //    forced") — no feed contact is made and the state stays at its initial
    //    'checking' (idle) value. So no update info was obtained from the
    //    network, yet the bundled notes above rendered. The launch also carries
    //    the Chromium DNS block (BLOCK_NET), so any accidental feed contact
    //    would fail to resolve rather than reach GitHub.
    const feedRequests = [];
    win.on('request', (r) => {
      if (/github|tflex-releases|api\./i.test(r.url())) feedRequests.push(r.url());
    });
    await expect(win.locator('[data-about-update]')).toBeVisible({ timeout: 15000 });
    await win.waitForTimeout(3000);
    const kind = await win.locator('[data-about-update]').getAttribute('data-about-update-kind');
    const updateText = (await win.locator('[data-about-update]').innerText()).trim();
    expect(kind).toBe('checking'); // idle: never became available/downloaded
    expect(updateText).toMatch(/Checking for updates/);
    expect(feedRequests).toEqual([]);

    // 3. Containment at the default 1440x900 + existing rows intact.
    await expect(win.locator('[data-about-version]')).toBeVisible();
    const geo = await win.evaluate(() => {
      const sheet = document.querySelector('[data-about-dialog]');
      const body = document.querySelector('.sheet-about .sheet-body');
      const r = sheet.getBoundingClientRect();
      return {
        innerW: window.innerWidth,
        innerH: window.innerHeight,
        sheetScroll: sheet.scrollHeight,
        sheetClient: sheet.clientHeight,
        top: r.top,
        bottom: r.bottom,
        bodyScroll: body ? body.scrollHeight : -1,
        bodyClient: body ? body.clientHeight : -1,
        bodyOverflowY: body ? getComputedStyle(body).overflowY : null,
      };
    });
    expect(geo.innerH).toBeGreaterThan(800);
    expect(geo.sheetScroll).toBeLessThanOrEqual(geo.sheetClient + 1);
    expect(geo.bottom).toBeLessThanOrEqual(geo.innerH + 1);
    expect(geo.top).toBeGreaterThanOrEqual(-1);
    expect(geo.bodyOverflowY).toBe('auto');

    // 4. Incoming update notes over the real status channel (main -> renderer).
    const INCOMING = {
      kind: 'available',
      version: '99.0.0-test',
      notes: ['Test note one', '<b>bold</b> markup line'],
    };
    await app.evaluate(({ BrowserWindow }, { channel, state }) => {
      BrowserWindow.getAllWindows()[0].webContents.send(channel, state);
    }, { channel: IPC.updateStatusChanged, state: INCOMING });

    await expect(win.locator('[data-whats-new-incoming]')).toBeVisible({ timeout: 10000 });
    await expect(win.locator('[data-whats-new-incoming-version]')).toContainText('99.0.0-test');
    const inc = win.locator('[data-whats-new-incoming-highlight]');
    await expect(inc).toHaveCount(2);
    await expect(inc.nth(0)).toHaveText('Test note one');
    await expect(inc.nth(1)).toHaveText('<b>bold</b> markup line');
    const injectedMarkup = await win.evaluate(
      () => document.querySelector('[data-whats-new-incoming] b') !== null,
    );
    expect(injectedMarkup).toBe(false);
    await expect(win.locator('[data-about-update]')).toContainText('99.0.0-test');

    // Containment holds with the incoming block added.
    const geo2 = await win.evaluate(() => {
      const sheet = document.querySelector('[data-about-dialog]');
      const r = sheet.getBoundingClientRect();
      return { sheetScroll: sheet.scrollHeight, sheetClient: sheet.clientHeight, bottom: r.bottom, innerH: window.innerHeight };
    });
    expect(geo2.sheetScroll).toBeLessThanOrEqual(geo2.sheetClient + 1);
    expect(geo2.bottom).toBeLessThanOrEqual(geo2.innerH + 1);

    // The injected `available` state also opens the app-level UpdatePromptDialog
    // (by design). Dismiss it so the release-evidence screenshot shows the About
    // sheet's What's New cleanly; the incoming block stays (state is unchanged).
    const prompt = win.locator('[data-update-prompt], .sheet-update-prompt').first();
    let promptAppeared = false;
    if (await prompt.isVisible().catch(() => false)) {
      promptAppeared = true;
      await win
        .locator('[data-update-prompt-cancel], [data-update-prompt-later], [data-update-prompt-close]')
        .first()
        .click()
        .catch(() => {});
      await prompt.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    }
    await expect(win.locator('[data-whats-new-incoming]')).toBeVisible();

    // 5. Release-evidence screenshot (body scrolled to top).
    await win.evaluate(() => {
      const b = document.querySelector('.sheet-about .sheet-body');
      if (b) b.scrollTop = 0;
    });
    await win.waitForTimeout(250);
    await win.screenshot({ path: path.join(ROOT, 'screenshots', 'phase31-whats-new.png') });

    // 6. Console errors / unhandled rejections.
    console.log(`[phase31] running=${RUNNING_VERSION} versionLabel="${versionLabel}" highlights=${count} updateKind=${kind} updateText="${updateText}"`);
    console.log(`[phase31] geo=${JSON.stringify(geo)} geo2=${JSON.stringify(geo2)}`);
    console.log(`[phase31] pageErrors=${JSON.stringify(pageErrors)}`);
    console.log(`[phase31] consoleErrors=${JSON.stringify(consoleErrors)}`);
    console.log(`[phase31] updatePromptAppearedOnInjectedAvailable=${promptAppeared}`);
    expect(pageErrors).toEqual([]);
  });
});
