// Adversarial Phase-59 UI probe. Drives the RUNNING app through Playwright's
// Electron driver for the Phase-59 UI items: tab drag/selection/overflow,
// protection notice, dock pen, command palette, preferences, zoom-on-open.
// Standalone harness (NOT an e2e spec). Prints structured JSON per scenario.
//
// Run: node test-fixtures/adv-p59-ui.cjs [scenario]
const REPO = 'C:\\Users\\tanzi\\OneDrive\\App Development\\TFlex';
const { launchApp } = require(REPO + '\\e2e\\lib\\launch.cjs');
const { openSamplePath } = require(REPO + '\\e2e\\lib\\helpers.cjs');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const TMP = path.join(os.tmpdir(), 'adv-p59-ui-' + Date.now());
fs.mkdirSync(TMP, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const out = async (win, obj) => win.evaluate((o) => o, obj).catch(() => null);

function freshUserData(tag) {
  const d = path.join(TMP, `ud-${tag}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}
function copySample(name, tag) {
  const src = path.join(REPO, 'assets', 'samples', name);
  const dst = path.join(TMP, `${tag}-${Date.now()}-${name}`);
  fs.copyFileSync(src, dst);
  return dst;
}

async function openPath(app, win, p) {
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
  const welcome = await win.locator('button:has-text("Open PDF")').count();
  if (welcome > 0) {
    await win.locator('button:has-text("Open PDF")').first().click({ timeout: 15000 });
  } else {
    await win.locator('[data-toolbar-open]').first().click({ timeout: 15000 });
  }
  await win.waitForSelector('.workspace', { timeout: 30000 }).catch(() => {});
}

async function setWindowSize(app, w, h) {
  await app.evaluate(({ BrowserWindow }, { w, h }) => {
    const win = BrowserWindow.getAllWindows().find((x) => x.isVisible()) || BrowserWindow.getAllWindows()[0];
    if (win) { win.unmaximize(); win.setSize(w, h); }
  }, { w, h });
}

async function tabOrder(win) {
  return win.evaluate(() => Array.from(document.querySelectorAll('[data-tab-id]')).map((e) => e.getAttribute('data-tab-id')));
}

// --- geometry helpers ------------------------------------------------------
async function boxOf(win, sel) {
  const el = win.locator(sel).first();
  if ((await el.count()) === 0) return null;
  return el.boundingBox();
}
async function inside(win, innerSel, outerSel) {
  return win.evaluate(([i, o]) => {
    const is = document.querySelector(i);
    const os = document.querySelector(o);
    if (!is || !os) return { ok: false, reason: 'missing' };
    const a = is.getBoundingClientRect();
    const b = os.getBoundingClientRect();
    return {
      ok: a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5,
      inner: { left: a.left, right: a.right, top: a.top, bottom: a.bottom, w: a.width, h: a.height },
      outer: { left: b.left, right: b.right, top: b.top, bottom: b.bottom, w: b.width, h: b.height },
    };
  }, [innerSel, outerSel]);
}

async function main() {
  const scenario = process.argv[2] || 'all';
  const results = {};
  const run = (s) => scenario === 'all' || scenario === s;
  const R = (k, o) => { results[k] = o; console.log('### ' + k + ' ' + JSON.stringify(o)); };

  // ============ TAB SELECTION + DRAG =======================================
  if (run('u1') || run('u2') || run('u3') || run('u4')) {
    const app = await launchApp([], freshUserData('tabs'));
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    // 3 distinct docs
    const p1 = copySample('report.pdf', 'a');
    const p2 = copySample('report.pdf', 'b');
    const p3 = copySample('report.pdf', 'c');
    await openPath(app, win, p1);
    await win.waitForSelector('[data-tab-id]', { timeout: 30000 });
    await openPath(app, win, p2);
    await openPath(app, win, p3);
    await win.waitForTimeout(600);

    // U1: selection
    if (run('u1')) {
      const title = win.locator('[data-tab-id] .tab-title').nth(1);
      const tb = await title.boundingBox();
      const userSelect = await win.evaluate(() => getComputedStyle(document.querySelector('[data-tab-id] .tab-title')).userSelect);
      await win.mouse.move(tb.x + 4, tb.y + tb.height / 2);
      await win.mouse.down();
      await win.mouse.move(tb.x + tb.width - 4, tb.y + tb.height / 2, { steps: 10 });
      await win.mouse.up();
      const dragSel = await win.evaluate(() => window.getSelection().toString());
      await win.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 2, { clickCount: 3 });
      const tripleSel = await win.evaluate(() => window.getSelection().toString());
      const tabSelectable = await win.evaluate(() => {
        const t = document.querySelector('[data-tab-id]');
        return getComputedStyle(t).userSelect;
      });
      R('u1', { userSelect, dragSel, tripleSel, tabSelectable });
    }

    // U2: reorder from title
    if (run('u2')) {
      const before = await tabOrder(win);
      const tabs = win.locator('[data-tab-id]');
      const t2 = await tabs.nth(2).boundingBox();
      const t0 = await tabs.nth(0).boundingBox();
      const title2 = win.locator('[data-tab-id] .tab-title').nth(2);
      const tb = await title2.boundingBox();
      await win.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
      await win.mouse.down();
      await win.mouse.move(t0.x + 4, t0.y + t0.height / 2, { steps: 15 });
      await win.mouse.up();
      await win.waitForTimeout(400);
      const after = await tabOrder(win);
      R('u2', { before, after, changed: JSON.stringify(before) !== JSON.stringify(after) });
    }

    // U3: reorder from chip and padding
    if (run('u3')) {
      const before = await tabOrder(win);
      // chip of last tab -> before first
      const chip = win.locator('[data-tab-id] .tab-colour-chip').last();
      const cb = await chip.boundingBox();
      const t0 = await win.locator('[data-tab-id]').nth(0).boundingBox();
      await win.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
      await win.mouse.down();
      await win.mouse.move(t0.x + 2, t0.y + t0.height / 2, { steps: 15 });
      await win.mouse.up();
      await win.waitForTimeout(400);
      const afterChip = await tabOrder(win);
      // padding: click near tab's far-left inside but left of chip? Use 2px inside tab left edge, below title? tab height small. Use tab's right padding before close.
      const tab1 = await win.locator('[data-tab-id]').nth(1).boundingBox();
      const closeBox = await win.locator('[data-tab-id]').nth(1).locator('.tab-close').boundingBox();
      const padX = closeBox ? closeBox.x - 3 : tab1.x + tab1.width - 4;
      await win.mouse.move(padX, tab1.y + tab1.height - 3);
      await win.mouse.down();
      await win.mouse.move(t0.x + 2, t0.y + t0.height / 2, { steps: 15 });
      await win.mouse.up();
      await win.waitForTimeout(400);
      const afterPad = await tabOrder(win);
      R('u3', { before, afterChip, afterPad, chipChanged: JSON.stringify(before) !== JSON.stringify(afterChip), padChanged: JSON.stringify(afterChip) !== JSON.stringify(afterPad) });
    }

    // U4: tear out from title
    if (run('u4')) {
      const before = await tabOrder(win);
      const title1 = win.locator('[data-tab-id] .tab-title').nth(1);
      const tb = await title1.boundingBox();
      const strip = await win.locator('.tab-list').boundingBox();
      const secondP = app.waitForEvent('window', { timeout: 15000 }).catch(() => null);
      await win.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2);
      await win.mouse.down();
      await win.mouse.move(tb.x + tb.width / 2 + 4, strip.y + strip.height + 30, { steps: 8 });
      await win.mouse.move(tb.x + tb.width / 2 + 6, strip.y + strip.height + 90, { steps: 8 });
      await win.mouse.up();
      const second = await secondP;
      await sleep(1500);
      const after = await tabOrder(win).catch(() => []);
      R('u4', { before, after, newWindow: second !== null, newTabs: second ? await second.evaluate(() => document.querySelectorAll('[data-tab-id]').length).catch(() => -1) : null });
      if (second) await second.close().catch(() => {});
    }
    await app.close().catch(() => {});
  }

  // ============ TAB OVERFLOW ===============================================
  if (run('u5')) {
    const app = await launchApp([], freshUserData('overflow'));
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    const first = copySample('report.pdf', 'o0');
    await openPath(app, win, first);
    await win.waitForSelector('[data-tab-id]', { timeout: 30000 });
    const N = Number(process.env.ADV_TABS || 32);
    for (let i = 1; i < N; i++) {
      const plus = win.locator('[data-new-tab]');
      if ((await plus.count()) === 0) break;
      await plus.first().click({ timeout: 5000 }).catch(() => {});
      await win.waitForTimeout(40);
    }
    await win.waitForTimeout(1200);
    const measure = async () => win.evaluate(() => {
      const list = document.querySelector('.tab-list');
      const tabs = Array.from(document.querySelectorAll('[data-tab-id]'));
      const active = document.querySelector('[data-tab-id][aria-selected="true"]');
      const lr = list.getBoundingClientRect();
      const ar = active ? active.getBoundingClientRect() : null;
      const lis = Array.from(list.querySelectorAll('li'));
      const overlaps = lis.map((li) => li.style.getPropertyValue('--tf-tab-overlap') || '');
      const widths = tabs.map((t) => Math.round(t.getBoundingClientRect().width));
      // is the ACTIVE tab's close button reachable (fully visible in viewport)?
      const close = active ? active.querySelector('.tab-close') : null;
      const cr = close ? close.getBoundingClientRect() : null;
      return {
        count: tabs.length,
        listWidth: Math.round(lr.width),
        listScrollWidth: list.scrollWidth,
        widths: { min: Math.min(...widths), max: Math.max(...widths), first: widths[0] },
        overlapsNonZero: overlaps.filter((o) => o !== '' && o !== '0px').length,
        activeId: active ? active.getAttribute('data-tab-id') : null,
        activeVisible: ar ? ar.left >= lr.left - 1 && ar.right <= lr.right + 1 : false,
        activeInViewport: ar ? ar.left >= 0 && ar.right <= window.innerWidth : false,
        closeReachable: cr ? cr.left >= 0 && cr.right <= window.innerWidth && cr.width > 0 && cr.height > 0 : false,
        rowCount: new Set(tabs.map((t) => Math.round(t.getBoundingClientRect().top))).size,
      };
    });
    const atDefault = await measure();
    await win.screenshot({ path: path.join(REPO, 'screenshots', 'adv-p59-tabs-default.png') }).catch(() => {});
    // resize to minimum width
    await setWindowSize(app, 640, 720);
    await win.waitForTimeout(800);
    const atMin = await measure();
    await win.screenshot({ path: path.join(REPO, 'screenshots', 'adv-p59-tabs-min.png') }).catch(() => {});
    const minGeom = await win.evaluate(() => {
      const area = document.querySelector('.tab-area');
      const list = document.querySelector('.tab-list');
      const active = document.querySelector('[data-tab-id][aria-selected="true"]');
      const pick = (e) => { if (!e) return null; const r = e.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), display: getComputedStyle(e).display, overflow: getComputedStyle(e).overflow }; };
      return { win: window.innerWidth, area: pick(area), list: pick(list), listClientW: list ? list.clientWidth : null, active: pick(active) };
    });
    await setWindowSize(app, 1400, 900);
    await win.waitForTimeout(800);
    const atMax = await measure();
    await win.screenshot({ path: path.join(REPO, 'screenshots', 'adv-p59-tabs-1400.png') }).catch(() => {});
    // click active tab's close button to prove reachable
    let closeClicked = null;
    try {
      const activeId = atMin.activeId;
      await win.locator(`[data-tab-id="${activeId}"] .tab-close`).click({ timeout: 3000 });
      await win.waitForTimeout(400);
      closeClicked = (await win.evaluate(() => document.querySelectorAll('[data-tab-id]').length));
    } catch (e) { closeClicked = 'ERR:' + String(e.message).split('\n')[0]; }
    R('u5', { atDefault, atMin, atMax, minGeom, closeClicked });
    await app.close().catch(() => {});
  }

  // ============ PROTECTION NOTICE ==========================================
  if (run('u6')) {
    const app = await launchApp([], freshUserData('prot'));
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    const p = path.join(REPO, 'test-fixtures', 'adv-p59', 'encrypted-owner.pdf');
    await openPath(app, win, p);
    await win.waitForSelector('.workspace', { timeout: 30000 });
    const hasNotice = await win.waitForSelector('[data-protection-notice]', { timeout: 15000 }).then(() => true).catch(() => false);
    const state0 = await win.evaluate(() => {
      const r = document.querySelector('.protection-notice-region');
      const icon = document.querySelector('[data-protection-icon]');
      return {
        notice: !!document.querySelector('[data-protection-notice]'),
        regionState: r ? r.getAttribute('data-protection-notice-state') : null,
        icon: !!icon,
        perms: (document.querySelector('[data-protection-permissions]') || {}).textContent || null,
      };
    });
    // rapid expand/collapse
    let rapidErr = null;
    const states = [];
    try {
      for (let i = 0; i < 8; i++) {
        const st = await win.evaluate(() => document.querySelector('.protection-notice-region')?.getAttribute('data-protection-notice-state'));
        states.push(st);
        const icon = win.locator('[data-protection-icon]');
        const col = win.locator('[data-protection-collapse]');
        if (await icon.count() && await icon.isVisible()) {
          await icon.click({ timeout: 1500, force: true });
        } else if (await col.count() && await col.isVisible()) {
          await col.click({ timeout: 1500, force: true });
        } else {
          states.push('no-control');
          break;
        }
        await win.waitForTimeout(120);
      }
    } catch (e) { rapidErr = String(e.message).split('\n')[0]; }
    const stateAfterRapid = await win.evaluate(() => ({
      region: document.querySelector('.protection-notice-region')?.getAttribute('data-protection-notice-state'),
      hasIcon: !!document.querySelector('[data-protection-icon]'),
      hasCollapse: !!document.querySelector('[data-protection-collapse]'),
      noticePresent: !!document.querySelector('[data-protection-notice]'),
    }));
    // wait for auto-collapse (10s) from a fresh expand
    await win.evaluate(() => { const i = document.querySelector('[data-protection-icon]'); i && i.click(); });
    await win.waitForTimeout(500);
    const before10 = await win.evaluate(() => document.querySelector('.protection-notice-region')?.getAttribute('data-protection-notice-state'));
    await win.waitForTimeout(10500);
    const after10 = await win.evaluate(() => document.querySelector('.protection-notice-region')?.getAttribute('data-protection-notice-state'));
    // collapsed icon reachable
    const iconReach = await win.evaluate(() => {
      const i = document.querySelector('[data-protection-icon]');
      if (!i) return { ok: false };
      const r = i.getBoundingClientRect();
      return { ok: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, box: { l: r.left, t: r.top, w: r.width, h: r.height } };
    });
    // resize while collapsed to min
    await setWindowSize(app, 640, 720);
    await win.waitForTimeout(600);
    const iconReachMin = await win.evaluate(() => {
      const i = document.querySelector('[data-protection-icon]');
      if (!i) return { ok: false };
      const r = i.getBoundingClientRect();
      return { ok: r.left >= 0 && r.top >= 0 && r.right <= innerWidth && r.bottom <= innerHeight, box: { l: r.left, t: r.top, w: r.width, h: r.height } };
    });
    // reopen a second protected document: should the notice reset to expanded?
    const p2 = path.join(TMP, 'encrypted-owner-2.pdf');
    fs.copyFileSync(path.join(REPO, 'test-fixtures', 'adv-p59', 'encrypted-owner.pdf'), p2);
    await openPath(app, win, p2);
    await win.waitForSelector('.workspace', { timeout: 30000 });
    await win.waitForTimeout(800);
    const reopenState = await win.evaluate(() => ({
      region: document.querySelector('.protection-notice-region')?.getAttribute('data-protection-notice-state'),
      notice: !!document.querySelector('[data-protection-notice]'),
    }));
    R('u6', { hasNotice, state0, rapidErr, states, stateAfterRapid, before10, after10, iconReach, iconReachMin, reopenState });
    await app.close().catch(() => {});
  }

  // ============ DOCK PEN ===================================================
  if (run('u7')) {
    const app = await launchApp([], freshUserData('dock'));
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await openPath(app, win, copySample('report.pdf', 'd'));
    await win.waitForSelector('.workspace', { timeout: 30000 });
    await win.waitForTimeout(800);
    const penAt = async () => inside(win, '[data-dock-edit-toggle]', '[data-action-dock]');
    const normal = await penAt();
    const dockBox = await boxOf(win, '[data-action-dock]');
    // min width
    await setWindowSize(app, 640, 720);
    await win.waitForTimeout(700);
    const min = await penAt();
    // multi mode
    await setWindowSize(app, 1400, 900);
    await win.waitForTimeout(500);
    await win.locator('[data-header-multi-mode]').click({ timeout: 5000 }).catch(() => {});
    await win.waitForTimeout(900);
    const multiActive = await win.evaluate(() => document.querySelector('[data-header-multi-mode]')?.getAttribute('data-multi-mode-active'));
    const multi = await penAt();
    const dockCountMulti = await win.evaluate(() => document.querySelectorAll('[data-action-dock]').length);
    R('u7', { normal, dockBox, min, multiActive, multi, dockCountMulti });
    await app.close().catch(() => {});
  }

  // ============ COMMAND PALETTE ============================================
  if (run('u8')) {
    const app = await launchApp([], freshUserData('palette'));
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    const readRows = () => win.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('[data-palette-row="tool"]'));
      return rows.map((r) => ({
        id: r.getAttribute('data-palette-tool-id'),
        disabled: r.getAttribute('data-palette-disabled'),
        reason: r.getAttribute('title'),
        label: (r.querySelector('.command-palette-row-label') || {}).textContent,
      }));
    });
    // no document
    await win.keyboard.press('Control+k');
    await win.waitForTimeout(400);
    const noDoc = await win.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('[data-palette-row="tool"]'));
      const find = (id) => rows.find((r) => r.getAttribute('data-palette-tool-id') === id);
      return {
        open: !!document.querySelector('[data-command-palette]'),
        count: rows.length,
        thumbs: find('pageThumbnails') ? { disabled: find('pageThumbnails').getAttribute('data-palette-disabled'), reason: find('pageThumbnails').getAttribute('title') } : null,
        outline: find('outlinePanel') ? { disabled: find('outlinePanel').getAttribute('data-palette-disabled'), reason: find('outlinePanel').getAttribute('title') } : null,
      };
    });
    await win.keyboard.press('Escape');
    await win.waitForTimeout(200);
    // with document
    await openPath(app, win, copySample('report.pdf', 'p'));
    await win.waitForSelector('.workspace', { timeout: 30000 });
    // report.pdf has no outline? ensure pages panel / rail present
    await win.keyboard.press('Control+k');
    await win.waitForTimeout(400);
    const withDoc = await win.evaluate(() => {
      const rows = Array.from(document.querySelectorAll('[data-palette-row="tool"]'));
      const find = (id) => rows.find((r) => r.getAttribute('data-palette-tool-id') === id);
      return {
        count: rows.length,
        thumbs: find('pageThumbnails') ? { disabled: find('pageThumbnails').getAttribute('data-palette-disabled'), reason: find('pageThumbnails').getAttribute('title') } : null,
        outline: find('outlinePanel') ? { disabled: find('outlinePanel').getAttribute('data-palette-disabled'), reason: find('outlinePanel').getAttribute('title') } : null,
        deadRows: rows.filter((r) => r.getAttribute('data-palette-disabled') === 'true').map((r) => ({ id: r.getAttribute('data-palette-tool-id'), reason: r.getAttribute('title') })).length,
        disabledIds: rows.filter((r) => r.getAttribute('data-palette-disabled') === 'true').map((r) => r.getAttribute('data-palette-tool-id')),
      };
    });
    // run Bookmarks (outline) on a doc with no outline
    let runOutline = null;
    try {
      await win.locator('[data-palette-row="tool"][data-palette-tool-id="outlinePanel"]').click({ timeout: 3000 });
      await win.waitForTimeout(500);
      runOutline = await win.evaluate(() => ({
        outlineOpen: document.querySelector('[data-context-panel-outline]')?.getAttribute('data-outline-open'),
        paletteOpen: !!document.querySelector('[data-command-palette]'),
      }));
    } catch (e) { runOutline = 'ERR:' + String(e.message).split('\n')[0]; }
    // run Page thumbnails
    let runThumbs = null;
    try {
      await win.keyboard.press('Control+k');
      await win.waitForTimeout(300);
      await win.locator('[data-palette-row="tool"][data-palette-tool-id="pageThumbnails"]').click({ timeout: 3000 });
      await win.waitForTimeout(500);
      runThumbs = await win.evaluate(() => ({
        outlineOpen: document.querySelector('[data-context-panel-outline]')?.getAttribute('data-outline-open'),
      }));
    } catch (e) { runThumbs = 'ERR:' + String(e.message).split('\n')[0]; }
    R('u8', { noDoc, withDoc, runOutline, runThumbs });
    await app.close().catch(() => {});
  }

  // ============ PREFERENCES ================================================
  if (run('u9')) {
    const app = await launchApp([], freshUserData('prefs'));
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    await win.locator('[data-open-preferences]').click({ timeout: 5000 });
    await win.waitForSelector('[data-prefs-dialog]', { timeout: 10000 });
    const cats = await win.evaluate(() => Array.from(document.querySelectorAll('[data-prefs-category]')).map((b) => b.getAttribute('data-prefs-category')));
    // rapid category switching
    let rapidErr = null;
    try {
      for (let i = 0; i < 10; i++) {
        const c = cats[i % cats.length];
        await win.locator(`[data-prefs-category="${c}"]`).click();
      }
    } catch (e) { rapidErr = String(e.message).split('\n')[0]; }
    // activate a non-default category and resize to min
    await win.locator('[data-prefs-category="storage"]').click().catch(() => {});
    await win.waitForTimeout(300);
    await setWindowSize(app, 640, 720);
    await win.waitForTimeout(600);
    const layout = await win.evaluate(() => {
      const dlg = document.querySelector('[data-prefs-dialog]');
      const panel = document.querySelector('[data-prefs-panel][data-active="true"]');
      if (!dlg || !panel) return { ok: false };
      const dr = dlg.getBoundingClientRect();
      const controls = Array.from(panel.querySelectorAll('input,select,button,textarea')).map((c) => {
        const r = c.getBoundingClientRect();
        return { tag: c.tagName, visible: r.width > 0 && r.height > 0 && r.left >= -0.5 && r.top >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5 };
      });
      // label/control overlap check
      const labels = Array.from(panel.querySelectorAll('label')).map((l) => l.getBoundingClientRect());
      const overlap = controls.filter((c) => c.visible === false).length;
      return { ok: true, activeCat: panel.getAttribute('data-prefs-panel'), dialogW: dr.width, controls: controls.length, unreachable: overlap, panelOutside: dr.left < 0 || dr.right > innerWidth };
    });
    R('u9', { cats, rapidErr, layout });
    await app.close().catch(() => {});
  }

  // ============ ZOOM ON OPEN ==============================================
  if (run('u10')) {
    const app = await launchApp([], freshUserData('zoom'));
    const win = await app.firstWindow();
    await win.waitForSelector('.sample-card', { timeout: 30000 });
    const zoomState = () => win.evaluate(() => ({
      percent: (document.querySelector('.zoom-percent') || {}).textContent,
      fitPage: document.querySelector('[aria-label="Fit page"]')?.getAttribute('aria-pressed'),
      fitWidth: document.querySelector('[aria-label="Fit width"]')?.getAttribute('aria-pressed'),
      pageTotal: (document.querySelector('.page-total') || {}).textContent,
      activeTitle: (document.querySelector('[data-tab-id][aria-selected="true"] .tab-title') || {}).textContent,
      tabs: Array.from(document.querySelectorAll('[data-tab-id] .tab-title')).map((e) => e.textContent.trim()),
    }));
    await openPath(app, win, copySample('report.pdf', 'z1'));
    await win.waitForSelector('.workspace', { timeout: 30000 });
    await win.waitForTimeout(800);
    const first = await zoomState();
    // zoom in deliberately
    await win.locator('[aria-label="Zoom in"]').click();
    await win.locator('[aria-label="Zoom in"]').click();
    await win.waitForTimeout(400);
    const zoomed = await zoomState();
    // switch layout mode 2-up if control exists
    const layoutBtns = await win.evaluate(() => Array.from(document.querySelectorAll('[aria-label^="Layout"], [data-layout-mode]')).map((b) => ({ label: b.getAttribute('aria-label'), data: b.getAttribute('data-layout-mode') })));
    // open a second, larger doc (long.pdf) while first was zoomed
    await openPath(app, win, copySample('long.pdf', 'z2'));
    await win.waitForSelector('.workspace', { timeout: 30000 });
    // wait for the new document to actually render its page count
    let secondWaited = false;
    for (let i = 0; i < 30; i++) {
      const t = await win.evaluate(() => (document.querySelector('.page-total') || {}).textContent);
      if (t && t.includes('520')) { secondWaited = true; break; }
      await win.waitForTimeout(500);
    }
    await win.waitForTimeout(400);
    const second = await zoomState();
    // third open (small multi-page doc) and a fourth
    await openPath(app, win, copySample('scanned.pdf', 'z3'));
    let thirdWaited = false;
    for (let i = 0; i < 30; i++) {
      const t = await win.evaluate(() => (document.querySelector('.page-total') || {}).textContent);
      if (t && t.includes('6')) { thirdWaited = true; break; }
      await win.waitForTimeout(500);
    }
    await win.waitForTimeout(400);
    const third = await zoomState();
    R('u10', { first, zoomed, layoutBtns, second, secondWaited, third, thirdWaited });
    await app.close().catch(() => {});
  }

  fs.writeFileSync(path.join(REPO, 'adv_p59_ui_results.json'), JSON.stringify(results, null, 2));
  console.log('### DONE');
}

main().catch((e) => { console.error('FATAL', e); process.exit(1); });
