// DEF-243 / DEF-244 / DEF-245 / DEF-246 FIX-READY retest (qa, 2026-09-20).
// Independent re-measurement of the Phase-22 title-bar file group fixes.
// Canonical launcher only. Screenshots -> screenshots/def24*-*.png.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose, gotoStage } = require('../lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', '..', 'screenshots');
const SAMPLES = path.resolve(__dirname, '..', '..', 'assets', 'samples');

let electronApp = null;
let win = null;

function freshSample(name) {
  const dir = path.join(os.tmpdir(), 'tflex-def243-246');
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(
    dir,
    `${name.replace(/\.pdf$/i, '')}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.pdf`,
  );
  fs.copyFileSync(path.join(SAMPLES, name), target);
  return target;
}

async function launchAndOpenTemp() {
  electronApp = await launchApp();
  win = await electronApp.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  const p = freshSample('report.pdf');
  await electronApp.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
  await win.locator('[data-home-tool="open"]').first().click();
  await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 30000 });
  await win.waitForTimeout(1600);
  return p;
}

// Open another document through the relocated title-bar Open control.
async function openAnother(name) {
  const p = freshSample(name);
  const before = await win.evaluate(() => document.querySelectorAll('.tab[data-tab-id]').length);
  await electronApp.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
  await win.click('[data-toolbar-open]');
  await win.waitForFunction(
    (n) => document.querySelectorAll('.tab[data-tab-id]').length > n,
    before,
    { timeout: 30000 },
  );
  await win.waitForTimeout(1400);
  return p;
}

async function closeApp(tag) {
  await hardClose(electronApp, tag);
  electronApp = null;
  win = null;
}

async function setSize(w, h) {
  await electronApp.evaluate(({ BrowserWindow }, s) => {
    BrowserWindow.getAllWindows()[0].setSize(s.w, s.h);
  }, { w, h });
  await win.waitForTimeout(500);
}

async function statOf(p) {
  const s = fs.statSync(p);
  return { size: s.size, mtimeMs: Math.round(s.mtimeMs) };
}

async function dialogOpen() {
  return win.evaluate(() => document.querySelector('[data-save-as-dialog]') !== null);
}

test.describe('DEF-243..246 FIX-READY retest', () => {
  test.afterEach(async () => {
    if (electronApp) await closeApp('def243-246');
  });

  test('DEF-243a: Ctrl+S saves IN PLACE (source mtime changes)', async () => {
    test.setTimeout(240000);
    const src = await launchAndOpenTemp();
    const before = await statOf(src);
    await gotoStage(win, 1);
    await win.click('.tab-pane[aria-hidden="false"] [data-dock-verb="rotate"]');
    await win.waitForTimeout(1200);
    await win.keyboard.press('Control+s');
    await win.waitForTimeout(2000);
    const after = await statOf(src);
    const st = await win.evaluate(() => {
      const s = document.querySelector('[data-toolbar-save]');
      return { saveDisabled: s.disabled, title: s.getAttribute('title') };
    });
    console.log('[def243|ctrl-s]', JSON.stringify({ before, after, st }));
    expect(after.mtimeMs, 'Ctrl+S wrote the source in place').not.toBe(before.mtimeMs);
    expect(after.size, 'source is still a valid-size PDF').toBeGreaterThan(0);
    expect(st.saveDisabled, 'after Ctrl+S the document is clean').toBe(true);
    expect(fs.existsSync(src), 'source still exists').toBe(true);
  });

  test('DEF-243b: Ctrl+Shift+S opens Save As, source byte/mtime-identical, copy written', async () => {
    test.setTimeout(240000);
    const src = await launchAndOpenTemp();
    await gotoStage(win, 1);
    await win.click('.tab-pane[aria-hidden="false"] [data-dock-verb="rotate"]');
    await win.waitForTimeout(1200);
    const before = await statOf(src);
    const copyPath = path.join(os.tmpdir(), `tflex-def243-copy-${Date.now()}.pdf`);
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, copyPath);
    await win.keyboard.press('Control+Shift+S');
    await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
    await win.screenshot({ path: path.join(SHOTS, 'def243-saveas-dialog.png') });
    await win.click('[data-save-as-confirm]');
    await win.waitForFunction(() => !document.querySelector('[data-save-as-dialog]'), undefined, { timeout: 15000 });
    await win.waitForTimeout(1500);
    const after = await statOf(src);
    const copy = fs.existsSync(copyPath) ? await statOf(copyPath) : null;
    console.log('[def243|ctrl-shift-s]', JSON.stringify({ before, after, copy }));
    expect(after.mtimeMs, 'Ctrl+Shift+S left the source mtime untouched').toBe(before.mtimeMs);
    expect(after.size, 'Ctrl+Shift+S left the source size untouched').toBe(before.size);
    expect(copy, 'Ctrl+Shift+S wrote the copy').not.toBeNull();
    expect(copy.size, 'copy is a non-empty PDF').toBeGreaterThan(0);
  });

  test('DEF-244: 640/820/1440 tab-area width, first-tab title visibility, control reachability', async () => {
    test.setTimeout(240000);
    await launchAndOpenTemp();
    for (const width of [640, 820, 1440]) {
      await setSize(width, 800);
      const m = await win.evaluate(() => {
        const tabArea = document.querySelector('.tab-area');
        const tabList = document.querySelector('.tab-list');
        tabList.scrollLeft = 0;
        const firstTab = document.querySelector('.tab[data-tab-id]');
        const title = firstTab ? firstTab.querySelector('.tab-title') : null;
        const lr = tabList.getBoundingClientRect();
        const tr = title ? title.getBoundingClientRect() : null;
        const visibleTitleW = tr
          ? Math.max(0, Math.min(tr.right, lr.right) - Math.max(tr.left, lr.left))
          : 0;
        const hit = (sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const b = el.getBoundingClientRect();
          const top = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
          return { resolvesToSelf: top === el || el.contains(top) };
        };
        return {
          innerW: window.innerWidth,
          tabAreaW: tabArea.clientWidth,
          tabListClientW: tabList.clientWidth,
          tabListScrollW: tabList.scrollWidth,
          listRect: { left: Math.round(lr.left), right: Math.round(lr.right) },
          firstTabRect: firstTab
            ? { left: Math.round(firstTab.getBoundingClientRect().left), right: Math.round(firstTab.getBoundingClientRect().right), w: Math.round(firstTab.getBoundingClientRect().width) }
            : null,
          titleW: tr ? Math.round(tr.width) : null,
          visibleTitleW: Math.round(visibleTitleW),
          open: hit('[data-toolbar-open]'),
          save: hit('[data-toolbar-save]'),
          saveAs: hit('[data-toolbar-save-as]'),
        };
      });
      console.log(`[def244|${width}]`, JSON.stringify(m));
      expect(m.tabAreaW, `${width}: tab-area has real width`).toBeGreaterThan(8);
      expect(m.visibleTitleW, `${width}: first tab title visible`).toBeGreaterThan(0);
      expect(m.open && m.open.resolvesToSelf, `${width}: Open reachable`).toBe(true);
      expect(m.save && m.save.resolvesToSelf, `${width}: Save reachable`).toBe(true);
      expect(m.saveAs && m.saveAs.resolvesToSelf, `${width}: Save As reachable`).toBe(true);
      if (width === 640) {
        await win.screenshot({ path: path.join(SHOTS, 'def244-640.png') });
      }
    }
  });

  test('DEF-245: active tab scrolled into view (2 and 6 tabs at 640/900/1440)', async () => {
    test.setTimeout(600000);
    const clickTabVisibly = async (index) => {
      const list = await win.locator('.tab-list').boundingBox();
      const tab = await win.locator('.tab[data-tab-id]').nth(index).boundingBox();
      const y = tab.y + tab.height / 2;
      const x = Math.max(tab.x, list.x) + 12;
      await win.mouse.click(x, y);
    };
    const measure = async (label) => {
      const m = await win.evaluate(() => {
        const tabList = document.querySelector('.tab-list');
        const active = document.querySelector('.tab.tab-active');
        const title = active ? active.querySelector('.tab-title') : null;
        const lr = tabList.getBoundingClientRect();
        const ar = active ? active.getBoundingClientRect() : null;
        const tr = title ? title.getBoundingClientRect() : null;
        const vis = (r) => (r ? Math.max(0, Math.min(r.right, lr.right) - Math.max(r.left, lr.left)) : 0);
        return {
          activeTitle: title ? title.textContent : null,
          scrollLeft: Math.round(tabList.scrollLeft),
          clientW: tabList.clientWidth,
          scrollW: tabList.scrollWidth,
          listRect: { left: Math.round(lr.left), right: Math.round(lr.right) },
          activeRect: ar ? { left: Math.round(ar.left), right: Math.round(ar.right), w: Math.round(ar.width) } : null,
          visibleActiveW: Math.round(vis(ar)),
          visibleTitleW: Math.round(vis(tr)),
          startVisible: ar ? ar.left >= lr.left - 1 : false,
          fullVisible: ar ? ar.left >= lr.left - 1 && ar.right <= lr.right + 1 : false,
        };
      });
      console.log(`[def245|${label}]`, JSON.stringify(m));
      return m;
    };

    for (const width of [640, 900, 1440]) {
      // Fresh app per width so the tab count is exact.
      await launchAndOpenTemp();
      await setSize(width, 800);
      await openAnother('report.pdf'); // second tab, now active
      const two = await measure(`${width}-2tab-open-active`);
      expect(two.activeTitle, `${width}: second tab active`).toContain('report');
      if (width === 640) {
        expect(two.startVisible, `${width}: open active start visible`).toBe(true);
        expect(two.visibleTitleW, `${width}: open active title visible`).toBeGreaterThan(0);
      } else {
        expect(two.fullVisible, `${width}: open active fully visible`).toBe(true);
      }

      // Switch to the first tab: scroll it into view (as a user must at the
      // minimum width), then click its visible portion so the pointer does
      // not auto-scroll the strip.
      await win.evaluate(() => { document.querySelector('.tab-list').scrollLeft = 0; });
      await win.waitForTimeout(400);
      await clickTabVisibly(0);
      await win.waitForTimeout(900);
      const back = await measure(`${width}-switch-first`);
      expect(back.activeTitle, `${width}: first tab active after switch`).toContain('report');
      if (width === 640) {
        expect(back.startVisible, `${width}: switch start visible`).toBe(true);
        expect(back.visibleTitleW, `${width}: switch title visible`).toBeGreaterThan(0);
      } else {
        expect(back.fullVisible, `${width}: switch first fully visible`).toBe(true);
      }

      // Grow to six tabs; the newest is active.
      for (let i = 0; i < 4; i += 1) await openAnother('report.pdf');
      const six = await measure(`${width}-6tab-open-active`);
      if (width === 640) {
        expect(six.startVisible, `${width}: 6-tab open start visible`).toBe(true);
        expect(six.visibleTitleW, `${width}: 6-tab open title visible`).toBeGreaterThan(0);
      } else {
        expect(six.fullVisible, `${width}: 6-tab open fully visible`).toBe(true);
      }

      // Close the active (6th) tab: the newly active tab must be scrolled in.
      await win.locator('.tab.tab-active .tab-close').click();
      await win.waitForTimeout(1100);
      const closed = await measure(`${width}-after-close`);
      // The dispatch's 640 "start + title" acceptance is scoped to open/switch;
      // after a close the active tab must still be visible (the `.nearest`
      // scroll aligns a tab that lies to the left by its trailing edge).
      expect(closed.visibleActiveW, `${width}: after close active tab visible`).toBeGreaterThan(0);
      if (width !== 640) {
        expect(closed.fullVisible, `${width}: after close fully visible`).toBe(true);
      }
      if (width === 640) {
        await win.screenshot({ path: path.join(SHOTS, 'def245-active-tab-visible.png') });
      }
      await closeApp('def245');
    }
  });

  // ---------------------------------------------------------------------
  // DEF-246 — Save As reachability must agree across the button, the native
  // menu and Ctrl+Shift+S in every document state.
  // ---------------------------------------------------------------------
  test('DEF-246a: welcome / clean-on-disk / modified — four routes agree', async () => {
    test.setTimeout(300000);
    electronApp = await launchApp();
    win = await electronApp.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.waitForTimeout(600);

    const btnState = () => win.evaluate(() => {
      const s = document.querySelector('[data-toolbar-save]');
      const a = document.querySelector('[data-toolbar-save-as]');
      return {
        saveDisabled: s.disabled,
        saveTitle: s.getAttribute('title'),
        saveClass: s.className,
        saveAsDisabled: a.disabled,
        saveAsTitle: a.getAttribute('title'),
      };
    });
    const menuState = () => electronApp.evaluate(({ Menu }) => {
      const m = Menu.getApplicationMenu();
      return {
        menuSaveAs: m.getMenuItemById('menu.saveAs').enabled,
        menuSave: m.getMenuItemById('menu.save').enabled,
      };
    });
    const closeDialogIfOpen = async () => {
      if (await dialogOpen()) {
        await win.click('[data-save-as-dialog] .btn-secondary');
        await win.waitForTimeout(500);
      }
    };
    const ctrlShiftS = async () => {
      await win.keyboard.press('Control+Shift+S');
      await win.waitForTimeout(900);
      const opened = await dialogOpen();
      await closeDialogIfOpen();
      return opened;
    };
    const menuRoute = async () => {
      const ms = await menuState();
      if (!ms.menuSaveAs) return { enabled: false, opened: false };
      await electronApp.evaluate(({ Menu }) => {
        Menu.getApplicationMenu().getMenuItemById('menu.saveAs').click();
      });
      await win.waitForTimeout(900);
      const opened = await dialogOpen();
      await closeDialogIfOpen();
      return { enabled: true, opened };
    };
    const row = async (label) => {
      const b = await btnState();
      const m = await menuState();
      const out = {
        saveDisabled: b.saveDisabled,
        saveTitle: b.saveTitle,
        saveAsDisabled: b.saveAsDisabled,
        saveAsTitle: b.saveAsTitle,
        menuSaveAs: m.menuSaveAs,
        menuSave: m.menuSave,
        ctrlShiftS: await ctrlShiftS(),
        menuRoute: await menuRoute(),
      };
      console.log(`[def246|${label}]`, JSON.stringify(out));
      return out;
    };

    const welcome = await row('welcome');
    expect(welcome.saveAsDisabled, 'welcome: Save As disabled').toBe(true);
    expect(welcome.menuSaveAs, 'welcome: menu Save As disabled').toBe(false);
    expect(welcome.ctrlShiftS, 'welcome: Ctrl+Shift+S opens nothing').toBe(false);

    const tempPath = freshSample('report.pdf');
    await electronApp.evaluate(async ({ dialog }, fp) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
    }, tempPath);
    await win.locator('[data-home-tool="open"]').first().click();
    await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 30000 });
    await win.waitForTimeout(1600);
    const clean = await row('clean-on-disk');
    expect(clean.saveDisabled, 'clean: Save disabled').toBe(true);
    expect(clean.saveAsDisabled, 'clean: Save As enabled').toBe(false);
    expect(clean.menuSaveAs, 'clean: menu Save As enabled').toBe(true);
    expect(clean.ctrlShiftS, 'clean: Ctrl+Shift+S opens Save As').toBe(true);
    expect(clean.menuRoute.opened, 'clean: menu route opens Save As').toBe(true);

    await gotoStage(win, 1);
    await win.click('.tab-pane[aria-hidden="false"] [data-dock-verb="rotate"]');
    await win.waitForTimeout(1300);
    const modified = await row('modified');
    expect(modified.saveDisabled, 'modified: Save enabled').toBe(false);
    expect(modified.saveAsDisabled, 'modified: Save As enabled').toBe(false);
    expect(modified.menuSaveAs, 'modified: menu Save As enabled').toBe(true);
    expect(modified.ctrlShiftS, 'modified: Ctrl+Shift+S opens Save As').toBe(true);
    expect(modified.menuRoute.opened, 'modified: menu route opens Save As').toBe(true);
  });

  test('DEF-246b: read-only clean / modified — four routes agree', async () => {
    test.setTimeout(300000);
    electronApp = await launchApp();
    win = await electronApp.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.locator('.sample-card:has-text("report.pdf")').first().click();
    await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 30000 });
    await win.waitForTimeout(1600);

    const btnState = () => win.evaluate(() => {
      const s = document.querySelector('[data-toolbar-save]');
      const a = document.querySelector('[data-toolbar-save-as]');
      return {
        saveDisabled: s.disabled,
        saveTitle: s.getAttribute('title'),
        saveClass: s.className,
        saveAsDisabled: a.disabled,
      };
    });
    const menuState = () => electronApp.evaluate(({ Menu }) => {
      const m = Menu.getApplicationMenu();
      return { menuSaveAs: m.getMenuItemById('menu.saveAs').enabled };
    });
    const closeDialogIfOpen = async () => {
      if (await dialogOpen()) {
        await win.click('[data-save-as-dialog] .btn-secondary');
        await win.waitForTimeout(500);
      }
    };
    const row = async (label) => {
      const b = await btnState();
      const m = await menuState();
      await win.keyboard.press('Control+Shift+S');
      await win.waitForTimeout(900);
      const ctrlOpened = await dialogOpen();
      await closeDialogIfOpen();
      let menuOpened = false;
      if (m.menuSaveAs) {
        await electronApp.evaluate(({ Menu }) => {
          Menu.getApplicationMenu().getMenuItemById('menu.saveAs').click();
        });
        await win.waitForTimeout(900);
        menuOpened = await dialogOpen();
        await closeDialogIfOpen();
      }
      const out = {
        saveDisabled: b.saveDisabled,
        saveTitle: b.saveTitle,
        saveClass: b.saveClass,
        saveAsDisabled: b.saveAsDisabled,
        menuSaveAs: m.menuSaveAs,
        ctrlShiftS: ctrlOpened,
        menuRoute: menuOpened,
      };
      console.log(`[def246|${label}]`, JSON.stringify(out));
      return out;
    };

    const clean = await row('readonly-clean');
    expect(clean.saveDisabled, 'read-only clean: Save disabled').toBe(true);
    expect(clean.saveClass, 'read-only clean: success tint (nothing to save)').toContain('titlebar-file-btn-clean');
    expect(clean.saveAsDisabled, 'read-only clean: Save As enabled').toBe(false);
    expect(clean.menuSaveAs, 'read-only clean: menu Save As enabled').toBe(true);
    expect(clean.ctrlShiftS, 'read-only clean: Ctrl+Shift+S opens Save As').toBe(true);
    expect(clean.menuRoute, 'read-only clean: menu route opens Save As').toBe(true);

    await gotoStage(win, 1);
    await win.click('.tab-pane[aria-hidden="false"] [data-dock-verb="rotate"]');
    await win.waitForTimeout(1300);
    const modified = await row('readonly-modified');
    expect(modified.saveDisabled, 'read-only modified: Save disabled').toBe(true);
    expect(modified.saveClass, 'read-only modified: warning tint').toContain('titlebar-file-btn-readonly');
    expect(modified.saveAsDisabled, 'read-only modified: Save As enabled').toBe(false);
    expect(modified.menuSaveAs, 'read-only modified: menu Save As enabled').toBe(true);
    expect(modified.ctrlShiftS, 'read-only modified: Ctrl+Shift+S opens Save As').toBe(true);
    expect(modified.menuRoute, 'read-only modified: menu route opens Save As').toBe(true);
  });
});
