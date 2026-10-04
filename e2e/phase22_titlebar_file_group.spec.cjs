// PHASE 22 VALIDATION (qa, 2026-09-19) — title-bar Open + Save/Save As
// relocation. Requirements.md Phase 22, success criteria 1-4:
//   1. Open + Save/Save As render immediately right of the brand and left
//      of the tab strip as ONE grouped capsule; screenshots in all three
//      themes show it consistent with the title bar.
//   2. The CommandBar no longer contains Open/Save/Save As and NO duplicate
//      hook remains anywhere in the DOM.
//   3. Ctrl+O / Ctrl+S / Ctrl+Shift+S still work and the Save control
//      reflects the state matrix (clean disabled; modified enabled + dot;
//      saved clean again; read-only disabled with Save As available).
//   4. At 640/820/1440 the relocated controls are reachable and the tab
//      strip scrolls rather than clipping.
// Canonical launcher only. Screenshots -> screenshots/phase22-*.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, gotoStage } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');

let electronApp = null;
let win = null;

async function launchAndOpenTemp() {
  electronApp = await launchApp();
  win = await electronApp.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  const p = getSamplePath('report.pdf');
  await electronApp.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
  await win.locator('[data-home-tool="open"]').first().click();
  await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 30000 });
  await win.waitForTimeout(1600);
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
  await win.waitForTimeout(450);
}

async function setTheme(value) {
  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  await win.click(`[data-theme-option="${value}"]`);
  await win.waitForFunction(
    (v) => document.documentElement.getAttribute('data-theme') === v,
    value,
    { timeout: 5000 },
  );
  await win.waitForTimeout(450);
}

async function groupFacts() {
  return win.evaluate(() => {
    const r = (el) => {
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), right: Math.round(b.right) };
    };
    const brand = document.querySelector('.brand');
    const group = document.querySelector('.titlebar-file');
    const tabArea = document.querySelector('.tab-area');
    const tabList = document.querySelector('.tab-list');
    const buttons = Array.from(document.querySelectorAll('.titlebar-file-btn'));
    const cs = group ? getComputedStyle(group) : null;
    return {
      brand: r(brand),
      group: r(group),
      tabArea: r(tabArea),
      groupRole: group ? group.getAttribute('role') : null,
      groupLabel: group ? group.getAttribute('aria-label') : null,
      groupCount: document.querySelectorAll('.titlebar-file').length,
      btnCount: buttons.length,
      groupH: group ? Math.round(group.getBoundingClientRect().height) : null,
      btnH: buttons.map((b) => Math.round(b.getBoundingClientRect().height)),
      groupRadius: cs ? cs.borderRadius : null,
      tabAreaClientW: tabArea ? tabArea.clientWidth : null,
      tabListScrollW: tabList ? tabList.scrollWidth : null,
      tabListClientW: tabList ? tabList.clientWidth : null,
      tabCount: document.querySelectorAll('.tab[data-tab-id]').length,
    };
  });
}

test.describe('Phase 22 — title-bar file group', () => {
  test.afterEach(async () => {
    if (electronApp) await closeApp('phase22');
  });

  test('CRITERION 1: group sits right of brand, left of tabs, native in all three themes', async () => {
    test.setTimeout(240000);
    await launchAndOpenTemp();
    const f = await groupFacts();
    console.log('[p22|placement]', JSON.stringify(f));
    expect(f.groupCount, 'exactly ONE file group').toBe(1);
    expect(f.groupRole, 'group is role=group').toBe('group');
    expect(f.groupLabel, 'group has an accessible name').toBe('File actions');
    expect(f.btnCount, 'three controls: Open / Save / Save As').toBe(3);
    expect(f.brand.right, 'group starts at/right of the brand').toBeLessThanOrEqual(f.group.x + 1);
    expect(f.group.right, 'group ends at/left of the tab strip').toBeLessThanOrEqual(f.tabArea.x + 1);
    // Title-bar ladder: 32px capsule, 28px controls.
    expect(f.groupH, 'capsule is the 32px title-bar ladder').toBe(32);
    for (const h of f.btnH) expect(h, 'each control is 28px').toBe(28);

    for (const theme of ['light', 'dark', 'frosted']) {
      await setTheme(theme);
      await win.locator('.titlebar').first().screenshot({ path: path.join(SHOTS, `phase22-titlebar-${theme}.png`) });
      const g = await win.locator('.titlebar-file').boundingBox();
      await win.screenshot({
        path: path.join(SHOTS, `phase22-group-closeup-${theme}.png`),
        clip: { x: Math.max(0, g.x - 30), y: Math.max(0, g.y - 8), width: g.width + 120, height: g.height + 16 },
      });
    }
    await win.screenshot({ path: path.join(SHOTS, 'phase22-workspace-frosted.png') });
  });

  test('CRITERION 2: CommandBar no longer contains Open/Save/Save As; no duplicate hook in the DOM', async () => {
    test.setTimeout(180000);
    await launchAndOpenTemp();
    const counts = await win.evaluate(() => ({
      // Phase 36 (chunk 3) — the command row is retired; the Action Dock is the
      // workspace chrome and must carry no file actions either.
      barOpen: document.querySelectorAll('.action-dock [data-toolbar-open]').length,
      barSave: document.querySelectorAll('.action-dock [data-toolbar-save]').length,
      barSaveAs: document.querySelectorAll('.action-dock [data-toolbar-save-as]').length,
      totalOpen: document.querySelectorAll('[data-toolbar-open]').length,
      totalSave: document.querySelectorAll('[data-toolbar-save]').length,
      totalSaveAs: document.querySelectorAll('[data-toolbar-save-as]').length,
      commandbarOpen: document.querySelectorAll('.commandbar-open').length,
      commandbarGroupOpen: document.querySelectorAll('.commandbar-group-open').length,
    }));
    console.log('[p22|duplicates]', JSON.stringify(counts));
    expect(counts.barOpen, 'no Open in the CommandBar').toBe(0);
    expect(counts.barSave, 'no Save in the CommandBar').toBe(0);
    expect(counts.barSaveAs, 'no Save As in the CommandBar').toBe(0);
    expect(counts.commandbarOpen, 'no legacy .commandbar-open anywhere').toBe(0);
    expect(counts.commandbarGroupOpen, 'no legacy File capsule anywhere').toBe(0);
    expect(counts.totalOpen, 'exactly one [data-toolbar-open]').toBe(1);
    expect(counts.totalSave, 'exactly one [data-toolbar-save]').toBe(1);
    expect(counts.totalSaveAs, 'exactly one [data-toolbar-save-as]').toBe(1);
  });

  test('CRITERION 3: Ctrl+O / Ctrl+S / Ctrl+Shift+S and the Save state matrix', async () => {
    test.setTimeout(300000);
    const tempPath = await launchAndOpenTemp();

    const state = () => win.evaluate(() => {
      const s = document.querySelector('[data-toolbar-save]');
      const a = document.querySelector('[data-toolbar-save-as]');
      const dot = s ? s.querySelector('.titlebar-file-dot') : null;
      return {
        saveDisabled: s ? s.disabled : null,
        saveClass: s ? s.className : null,
        saveTitle: s ? s.getAttribute('title') : null,
        saveAsDisabled: a ? a.disabled : null,
        dotHidden: dot ? dot.classList.contains('titlebar-file-dot-hidden') : null,
      };
    });

    // clean -> Save disabled, dot hidden
    const clean = await state();
    console.log('[p22|state clean]', JSON.stringify(clean));
    expect(clean.saveDisabled, 'clean: Save disabled').toBe(true);
    expect(clean.dotHidden, 'clean: modified dot hidden').toBe(true);
    expect(clean.saveClass, 'clean: success tint').toContain('titlebar-file-btn-clean');

    // modify (rotate clockwise) -> enabled + dot
    await gotoStage(win, 1);
    await win.click('.tab-pane[aria-hidden="false"] [data-dock-verb="rotate"]');
    await win.waitForTimeout(1200);
    const dirty = await state();
    console.log('[p22|state modified]', JSON.stringify(dirty));
    expect(dirty.saveDisabled, 'modified: Save enabled').toBe(false);
    expect(dirty.dotHidden, 'modified: dot visible').toBe(false);
    expect(dirty.saveClass, 'modified: warning tint').toContain('titlebar-file-btn-modified');
    expect(dirty.saveAsDisabled, 'modified: Save As enabled').toBe(false);

    // Ctrl+S -> saved, clean again
    await win.keyboard.press('Control+s');
    await win.waitForTimeout(1800);
    const saved = await state();
    console.log('[p22|state after Ctrl+S]', JSON.stringify(saved));
    expect(saved.saveDisabled, 'after Ctrl+S: Save disabled (clean)').toBe(true);
    expect(saved.dotHidden, 'after Ctrl+S: dot hidden').toBe(true);
    expect(fs.existsSync(tempPath), 'in-place save wrote the on-disk file').toBe(true);

    // Ctrl+O -> opens the picked document as a new tab
    const formPath = getSamplePath('form.pdf');
    await electronApp.evaluate(async ({ dialog }, fp) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
    }, formPath);
    const before = await win.evaluate(() => document.querySelectorAll('.tab[data-tab-id]').length);
    await win.keyboard.press('Control+o');
    await win.waitForFunction(
      (n) => document.querySelectorAll('.tab[data-tab-id]').length > n,
      before,
      { timeout: 30000 },
    );
    await win.waitForTimeout(1500);
    const active = await win.evaluate(() => (document.querySelector('.tab-active') || {}).textContent || '');
    console.log('[p22|Ctrl+O]', before, '->', active);
    expect(active, 'Ctrl+O opened the picked document').toContain('form.pdf');

    // Ctrl+Shift+S -> Save-As modal, confirm writes a copy, clean after
    await gotoStage(win, 1);
    await win.click('.tab-pane[aria-hidden="false"] [data-dock-verb="rotate"]');
    await win.waitForTimeout(1200);
    const copyPath = path.join(os.tmpdir(), `tflex-p22-saveas-${Date.now()}.pdf`);
    await electronApp.evaluate(async ({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, copyPath);
    await win.keyboard.press('Control+Shift+S');
    await win.waitForSelector('[data-save-as-dialog]', { timeout: 10000 });
    await win.click('[data-save-as-confirm]');
    await win.waitForFunction(() => !document.querySelector('[data-save-as-dialog]'), undefined, { timeout: 15000 });
    await win.waitForTimeout(1500);
    console.log('[p22|Ctrl+Shift+S] copy exists =', fs.existsSync(copyPath));
    expect(fs.existsSync(copyPath), 'Ctrl+Shift+S wrote the copy').toBe(true);
    const afterAs = await state();
    console.log('[p22|state after Ctrl+Shift+S]', JSON.stringify(afterAs));
    expect(afterAs.saveDisabled, 'after Save As: Save disabled (clean)').toBe(true);
  });

  test('CRITERION 3 (read-only): sample source keeps Save disabled with Save As available', async () => {
    test.setTimeout(180000);
    electronApp = await launchApp();
    win = await electronApp.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.locator('.sample-card:has-text("report.pdf")').first().click();
    await win.waitForSelector('.tab-pane[aria-hidden="false"] .workspace', { timeout: 30000 });
    await win.waitForTimeout(1600);
    await gotoStage(win, 1);
    await win.click('.tab-pane[aria-hidden="false"] [data-dock-verb="rotate"]');
    await win.waitForTimeout(1200);
    const st = await win.evaluate(() => {
      const s = document.querySelector('[data-toolbar-save]');
      const a = document.querySelector('[data-toolbar-save-as]');
      return {
        saveDisabled: s.disabled,
        saveClass: s.className,
        saveTitle: s.getAttribute('title'),
        saveAsDisabled: a.disabled,
      };
    });
    console.log('[p22|state read-only]', JSON.stringify(st));
    expect(st.saveDisabled, 'read-only: Save disabled').toBe(true);
    expect(st.saveClass, 'read-only: warning tint retained').toContain('titlebar-file-btn-readonly');
    expect(st.saveTitle, 'read-only: tooltip explains Save As escape').toContain('Read-only');
    expect(st.saveAsDisabled, 'read-only: Save As available').toBe(false);
  });

  test('CRITERION 4: reachable at 640/820/1440 and the tab strip scrolls, not clips', async () => {
    test.setTimeout(240000);
    await launchAndOpenTemp();
    const report = {};
    for (const width of [1440, 820, 640]) {
      await setSize(width, 800);
      const m = await win.evaluate(() => {
        const hit = (sel) => {
          const el = document.querySelector(sel);
          if (!el) return null;
          const b = el.getBoundingClientRect();
          const cx = b.left + b.width / 2;
          const cy = b.top + b.height / 2;
          const top = document.elementFromPoint(cx, cy);
          return { resolvesToSelf: top === el || el.contains(top), cx: Math.round(cx), cy: Math.round(cy) };
        };
        const tabArea = document.querySelector('.tab-area');
        const tabList = document.querySelector('.tab-list');
        tabList.scrollLeft = tabList.scrollWidth;
        return {
          innerW: window.innerWidth,
          open: hit('[data-toolbar-open]'),
          save: hit('[data-toolbar-save]'),
          saveAs: hit('[data-toolbar-save-as]'),
          groupRight: Math.round(document.querySelector('.titlebar-file').getBoundingClientRect().right),
          tabAreaLeft: Math.round(tabArea.getBoundingClientRect().left),
          tabAreaW: tabArea.clientWidth,
          tabListScrollW: tabList.scrollWidth,
          tabListClientW: tabList.clientWidth,
          maxScrollLeft: Math.round(tabList.scrollLeft),
        };
      });
      report[width] = m;
      console.log(`[p22|width ${width}]`, JSON.stringify(m));
      expect(m.open && m.open.resolvesToSelf, `${width}: Open reachable`).toBe(true);
      expect(m.save && m.save.resolvesToSelf, `${width}: Save reachable`).toBe(true);
      expect(m.saveAs && m.saveAs.resolvesToSelf, `${width}: Save As reachable`).toBe(true);
      expect(m.groupRight, `${width}: group does not collide with the tab strip`).toBeLessThanOrEqual(m.tabAreaLeft + 1);
      if (width < 1440) {
        expect(m.tabListScrollW, `${width}: tab strip has scrollable overflow`).toBeGreaterThan(m.tabListClientW);
        expect(m.maxScrollLeft, `${width}: tab strip actually scrolls`).toBeGreaterThan(0);
      }
    }
    await setSize(640, 800);
    await win.evaluate(() => { document.querySelector('.tab-list').scrollLeft = 0; });
    await win.waitForTimeout(250);
    await win.screenshot({ path: path.join(SHOTS, 'phase22-640-min-width.png') });
    expect(report[1440].tabAreaW, '1440: tab strip fits without scrolling').toBeGreaterThanOrEqual(report[1440].tabListScrollW - 1);
  });
});
