// Adversarial Phase-61 (TFL-67) diff-pass probe: tab tear-out presentation.
//
// Standalone harness (NOT an e2e spec). Launches the dev build through the
// canonical e2e/lib/launch.cjs helper only. Attacks the Phase 61 diff:
//   - AppHeader .tab-area data-tab-tearout hook
//   - styles.css .tab-area/.tab-list[data-tab-tearout=true] { overflow: visible }
//   - styles.css .tab-list[data-tab-tearout=true] .tab[data-tab-dragging=true] { opacity:.6 }
//
// Run: node test-fixtures/adv-p61/probe.cjs [spill|cancel|opacity|hittest|detach|all]
const REPO = 'C:\\Users\\tanzi\\OneDrive\\App Development\\TFlex';
const { launchApp, getSamplePath } = require(REPO + '\\e2e\\lib\\launch.cjs');
const { hardClose, openSamplePath } = require(REPO + '\\e2e\\lib\\helpers.cjs');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const OUT_DIR = path.join(REPO, 'test-fixtures', 'adv-p61');
const SHOTS = path.join(REPO, 'screenshots');
const TMP = path.join(os.tmpdir(), 'adv-p61-' + Date.now());
fs.mkdirSync(TMP, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const R = (obj) => console.log('### ' + JSON.stringify(obj));

function freshUserData(tag) {
  const d = path.join(TMP, `ud-${tag}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

async function setWindowSize(app, w, h) {
  await app.evaluate(({ BrowserWindow }, { w, h }) => {
    const win = BrowserWindow.getAllWindows().find((x) => x.isVisible()) || BrowserWindow.getAllWindows()[0];
    if (win) { win.unmaximize(); win.setSize(w, h); }
  }, { w, h });
}

async function openPathDialog(app, win, filePath) {
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, filePath);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForTimeout(900);
}

async function openThreePlusEmpties(app, win, empties) {
  await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForSelector('[data-tab-id]', { timeout: 30000 });
  await win.waitForTimeout(800);
  await openPathDialog(app, win, getSamplePath('long.pdf'));
  await openPathDialog(app, win, getSamplePath('form.pdf'));
  await win.waitForTimeout(400);
  for (let i = 0; i < empties; i += 1) {
    const plus = win.locator('[data-new-tab]');
    if ((await plus.count()) === 0) break;
    await plus.first().click({ timeout: 5000 }).catch(() => {});
    await win.waitForTimeout(60);
  }
  await win.waitForTimeout(700);
}

// Full strip state + per-tab box + overflow + scroll.
async function stripSnapshot(win) {
  return win.evaluate(() => {
    const area = document.querySelector('.tab-area');
    const list = document.querySelector('.tab-list');
    const hdr = document.querySelector('.app-header');
    const main = document.querySelector('.app-main');
    const cs = (e) => (e ? getComputedStyle(e) : null);
    const rect = (e) => {
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { l: +r.left.toFixed(2), t: +r.top.toFixed(2), r: +r.right.toFixed(2), b: +r.bottom.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) };
    };
    const listCs = cs(list);
    const tabs = Array.from(document.querySelectorAll('[data-tab-id]')).map((t) => {
      const r = t.getBoundingClientRect();
      const tcs = getComputedStyle(t);
      return {
        id: t.getAttribute('data-tab-id'),
        active: t.getAttribute('aria-selected') === 'true',
        dragging: t.getAttribute('data-tab-dragging'),
        reflow: t.getAttribute('data-tab-reflow'),
        box: { l: +r.left.toFixed(2), t: +r.top.toFixed(2), r: +r.right.toFixed(2), b: +r.bottom.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) },
        opacity: +tcs.opacity,
        transform: tcs.transform,
      };
    });
    const areaRect = rect(area);
    const hdrRect = rect(hdr);
    // a tab spills if it paints outside the header's right edge or below its bottom
    const spillRight = hdrRect ? tabs.filter((t) => t.box.r > hdrRect.r + 0.5) : [];
    const spillBelow = hdrRect ? tabs.filter((t) => t.box.b > hdrRect.b + 0.5) : [];
    return {
      area: areaRect,
      hdr: hdrRect,
      main: rect(main),
      areaTearOut: area ? area.getAttribute('data-tab-tearout') : null,
      listTearOut: list ? list.getAttribute('data-tab-tearout') : null,
      areaOverflowX: cs(area) ? cs(area).overflowX : null,
      areaOverflowY: cs(area) ? cs(area).overflowY : null,
      listOverflowX: listCs ? listCs.overflowX : null,
      listOverflowY: listCs ? listCs.overflowY : null,
      listScrollLeft: list ? list.scrollLeft : null,
      listScrollWidth: list ? list.scrollWidth : null,
      listClientWidth: list ? list.clientWidth : null,
      listScrollbarThickness: list ? list.offsetHeight - list.clientHeight : null,
      areaScrollbarThickness: area ? area.offsetHeight - area.clientHeight : null,
      tabCount: tabs.length,
      tabs,
      spillRightCount: spillRight.length,
      spillRightIds: spillRight.map((t) => t.id),
      spillBelowCount: spillBelow.length,
      spillBelowIds: spillBelow.map((t) => t.id),
    };
  });
}

// Drag a tab (by id) from its colour chip down below the strip, sampling the
// snapshot at each waypoint. Returns the samples plus the start coords.
async function dragBelow(win, tabId, opts = {}) {
  const chip = win.locator(`[data-tab-id="${tabId}"] .tab-colour-chip`);
  const cb = await chip.boundingBox();
  const hdr = await win.locator('.app-header').boundingBox();
  if (!cb || !hdr) return { error: 'no chip/header' };
  const sx = cb.x + cb.width / 2;
  const sy = cb.y + cb.height / 2;
  const below = hdr.y + hdr.height + 60 + (opts.extraY || 0);
  await win.mouse.move(sx, sy);
  await win.mouse.down();
  await win.mouse.move(sx, sy + 12, { steps: 4 }); // arm past 6px
  await win.waitForTimeout(60);
  const armed = await stripSnapshot(win);
  await win.mouse.move(sx + (opts.dx || 0), below, { steps: 10 });
  await win.waitForTimeout(120);
  const tearing = await stripSnapshot(win);
  return { sx, sy, below, armed, tearing };
}

async function run() {
  const scenario = process.argv[2] || 'all';
  const runS = (s) => scenario === 'all' || scenario === s;
  const results = {};

  // ================= H1: STRIP OVERFLOW SPILL (many tabs, scrolled) ======
  if (runS('spill')) {
    let app = null;
    try {
      app = await launchApp([], freshUserData('spill'));
      const win = await app.firstWindow();
      await win.waitForSelector('.sample-card', { timeout: 30000 });
      await openThreePlusEmpties(app, win, 28);
      await win.waitForTimeout(900);

      // Push the strip's scroll to its maximum so scrollLeft is non-zero at the
      // moment the tear-out drag arms, then pick the rightmost non-active tab
      // that is still fully inside the visible strip.
      const scrolled = await win.evaluate(() => {
        const list = document.querySelector('.tab-list');
        const area = document.querySelector('.tab-area');
        list.scrollLeft = list.scrollWidth;
        const ar = area.getBoundingClientRect();
        const tabs = Array.from(document.querySelectorAll('[data-tab-id]'));
        const vis = tabs.filter((t) => t.getAttribute('aria-selected') !== 'true').map((t) => ({ id: t.getAttribute('data-tab-id'), box: t.getBoundingClientRect() })).filter((t) => t.box.left > ar.left + 4 && t.box.right < ar.right - 4);
        return { scrollLeft: list.scrollLeft, scrollWidth: list.scrollWidth, clientWidth: list.clientWidth, visCount: vis.length, chosen: vis.length ? vis[vis.length - 1].id : null, area: { l: ar.left, r: ar.right, w: ar.width } };
      });
      await win.waitForTimeout(300);
      const pre = await stripSnapshot(win);
      await win.screenshot({ path: path.join(SHOTS, 'adv-p61-spill-rest.png') });
      const area = pre.area;
      const visible = pre.tabs.filter((t) => !t.active && t.box.l > area.l + 4 && t.box.r < area.r - 4);
      const target = visible.length ? visible[visible.length - 1] : pre.tabs.find((t) => !t.active && t.box.r < area.r) || pre.tabs[0];
      const drag = await dragBelow(win, target.id);
      await win.screenshot({ path: path.join(SHOTS, 'adv-p61-spill-tearing.png') });
      R({
        scenario: 'spill',
        targetId: target.id,
        scrolled,
        pre: { areaTearOut: pre.areaTearOut, listOverflowX: pre.listOverflowX, listScrollLeft: pre.listScrollLeft, listScrollWidth: pre.listScrollWidth, listClientWidth: pre.listClientWidth, listScrollbarThickness: pre.listScrollbarThickness, areaScrollbarThickness: pre.areaScrollbarThickness, spillRightCount: pre.spillRightCount, spillBelowCount: pre.spillBelowCount, firstTab: pre.tabs[0] ? { t: pre.tabs[0].box.t, b: pre.tabs[0].box.b } : null },
        armed: drag.armed ? { areaTearOut: drag.armed.areaTearOut, listTearOut: drag.armed.listTearOut, listOverflowX: drag.armed.listOverflowX, listScrollLeft: drag.armed.listScrollLeft, spillRightCount: drag.armed.spillRightCount, spillRightIds: drag.armed.spillRightIds, spillBelowCount: drag.armed.spillBelowCount } : null,
        tearing: drag.tearing ? { areaTearOut: drag.tearing.areaTearOut, listTearOut: drag.tearing.listTearOut, areaOverflowX: drag.tearing.areaOverflowX, areaOverflowY: drag.tearing.areaOverflowY, listOverflowX: drag.tearing.listOverflowX, listOverflowY: drag.tearing.listOverflowY, listScrollLeft: drag.tearing.listScrollLeft, listClientWidth: drag.tearing.listClientWidth, listScrollWidth: drag.tearing.listScrollWidth, listScrollbarThickness: drag.tearing.listScrollbarThickness, areaScrollbarThickness: drag.tearing.areaScrollbarThickness, spillRightCount: drag.tearing.spillRightCount, spillRightIds: drag.tearing.spillRightIds, spillBelowCount: drag.tearing.spillBelowCount, spillBelowIds: drag.tearing.spillBelowIds, hdr: drag.tearing.hdr, area: drag.tearing.area } : null,
        // did the dragged tab's own base layout shift when overflow released?
        draggedArmed: drag.armed ? drag.armed.tabs.find((t) => t.id === target.id) : null,
        draggedTearing: drag.tearing ? drag.tearing.tabs.find((t) => t.id === target.id) : null,
        preTabs: pre.tabs.map((t) => ({ id: t.id, l: t.box.l, r: t.box.r, t: t.box.t, b: t.box.b })),
        tearingTabs: drag.tearing ? drag.tearing.tabs.map((t) => ({ id: t.id, l: t.box.l, r: t.box.r, t: t.box.t, b: t.box.b, dragging: t.dragging })) : null,
        start: drag.sx, below: drag.below,
      });
      // back inside and release (no detach, origin keeps all tabs)
      await win.mouse.move(drag.sx, drag.sy, { steps: 10 });
      await win.waitForTimeout(200);
      await win.mouse.up();
      await win.waitForTimeout(300);
      const post = await stripSnapshot(win);
      R({ scenario: 'spill', post: { areaTearOut: post.areaTearOut, listTearOut: post.listTearOut, listOverflowX: post.listOverflowX, listScrollLeft: post.listScrollLeft, spillRightCount: post.spillRightCount, spillBelowCount: post.spillBelowCount } });
      results.spill = 'done';
    } catch (e) {
      R({ scenario: 'spill', error: String((e && e.stack) || e) });
      results.spill = 'error';
    } finally { await hardClose(app, 'spill').catch(() => {}); }
  }

  // ================= H2: STUCK TEAR-OUT (pointercancel / blur) ==========
  if (runS('cancel')) {
    let app = null;
    try {
      app = await launchApp([], freshUserData('cancel'));
      const win = await app.firstWindow();
      await win.waitForSelector('.sample-card', { timeout: 30000 });
      await openThreePlusEmpties(app, win, 0);
      await win.waitForTimeout(700);
      const pre = await stripSnapshot(win);
      const target = pre.tabs.find((t) => !t.active) || pre.tabs[0];
      const drag = await dragBelow(win, target.id);
      const beforeCancel = drag.tearing;
      // Dispatch a pointercancel on window (the handler AppHeader subscribes to).
      await win.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true, cancelable: true })));
      await win.waitForTimeout(300);
      const afterCancel = await stripSnapshot(win);
      // release the physical button; should be inert
      await win.mouse.up();
      await win.waitForTimeout(300);
      const afterUp = await stripSnapshot(win);
      // Now test window blur mid-drag path too.
      const drag2 = await dragBelow(win, target.id);
      await win.evaluate(() => window.dispatchEvent(new Event('blur')));
      await win.waitForTimeout(300);
      const afterBlur = await stripSnapshot(win);
      await win.mouse.move(drag2.sx, drag2.sy, { steps: 6 });
      await win.mouse.up();
      await win.waitForTimeout(300);
      const afterBlurUp = await stripSnapshot(win);
      R({
        scenario: 'cancel',
        targetId: target.id,
        beforeCancel: beforeCancel ? { areaTearOut: beforeCancel.areaTearOut, listTearOut: beforeCancel.listTearOut, listOverflowX: beforeCancel.listOverflowX, draggingId: (beforeCancel.tabs.find((t) => t.dragging === 'true') || {}).id } : null,
        afterCancel: { areaTearOut: afterCancel.areaTearOut, listTearOut: afterCancel.listTearOut, listOverflowX: afterCancel.listOverflowX, draggingId: (afterCancel.tabs.find((t) => t.dragging === 'true') || {}).id },
        afterUp: { areaTearOut: afterUp.areaTearOut, listTearOut: afterUp.listTearOut },
        afterBlur: { areaTearOut: afterBlur.areaTearOut, listTearOut: afterBlur.listTearOut, listOverflowX: afterBlur.listOverflowX, draggingId: (afterBlur.tabs.find((t) => t.dragging === 'true') || {}).id },
        afterBlurUp: { areaTearOut: afterBlurUp.areaTearOut, listTearOut: afterBlurUp.listTearOut, listOverflowX: afterBlurUp.listOverflowX, draggingId: (afterBlurUp.tabs.find((t) => t.dragging === 'true') || {}).id },
      });
      results.cancel = 'done';
    } catch (e) {
      R({ scenario: 'cancel', error: String((e && e.stack) || e) });
      results.cancel = 'error';
    } finally { await hardClose(app, 'cancel').catch(() => {}); }
  }

  // ================= H3: OPACITY LEAK ==================================
  if (runS('opacity')) {
    let app = null;
    try {
      app = await launchApp([], freshUserData('opacity'));
      const win = await app.firstWindow();
      await win.waitForSelector('.sample-card', { timeout: 30000 });
      await openThreePlusEmpties(app, win, 0);
      await win.waitForTimeout(700);
      const pre = await stripSnapshot(win);
      const target = pre.tabs.find((t) => !t.active) || pre.tabs[0];
      const drag = await dragBelow(win, target.id);
      const tear = drag.tearing;
      const opacities = await win.evaluate((id) => {
        const t = document.querySelector(`[data-tab-id="${id}"]`);
        const info = (el) => (el ? { op: +getComputedStyle(el).opacity, tag: el.tagName, cls: el.className } : null);
        return {
          draggedTab: info(t),
          closeBtn: info(t ? t.querySelector('.tab-close') : null),
          chip: info(t ? t.querySelector('.tab-colour-chip') : null),
          dot: info(t ? t.querySelector('.tab-modified-dot') : null),
          parentLi: info(t ? t.closest('[data-animated-tab]') : null),
          neighbours: Array.from(document.querySelectorAll('[data-tab-id]')).filter((x) => x !== t).map((x) => ({ id: x.getAttribute('data-tab-id'), op: +getComputedStyle(x).opacity })),
        };
      }, target.id);
      R({ scenario: 'opacity', targetId: target.id, tearOut: tear ? tear.areaTearOut : null, opacities });
      await win.mouse.move(drag.sx, drag.sy, { steps: 8 });
      await win.mouse.up();
      await win.waitForTimeout(200);
      results.opacity = 'done';
    } catch (e) {
      R({ scenario: 'opacity', error: String((e && e.stack) || e) });
      results.opacity = 'error';
    } finally { await hardClose(app, 'opacity').catch(() => {}); }
  }

  // ================= H4: HIT-TEST / SELECTION ==========================
  if (runS('hittest')) {
    let app = null;
    try {
      app = await launchApp([], freshUserData('hittest'));
      const win = await app.firstWindow();
      await win.waitForSelector('.sample-card', { timeout: 30000 });
      await openThreePlusEmpties(app, win, 0);
      await win.waitForTimeout(700);
      const pre = await stripSnapshot(win);
      const target = pre.tabs.find((t) => !t.active) || pre.tabs[0];
      const drag = await dragBelow(win, target.id);
      const hdr = drag.tearing ? drag.tearing.hdr : null;
      const px = drag.sx;
      const py = drag.below;
      const hitDuring = await win.evaluate(([x, y]) => {
        const el = document.elementFromPoint(x, y);
        if (!el) return 'none';
        const tab = el.closest('[data-tab-id]');
        return { tag: el.tagName, cls: String(el.className), tabId: tab ? tab.getAttribute('data-tab-id') : null };
      }, [px, py]);
      // Release INSIDE (so no detach), then probe the same below-strip point.
      await win.mouse.move(drag.sx, drag.sy, { steps: 8 });
      await win.waitForTimeout(200);
      await win.mouse.up();
      await win.waitForTimeout(400);
      const hitAfter = await win.evaluate(([x, y]) => {
        const el = document.elementFromPoint(x, y);
        if (!el) return 'none';
        const tab = el.closest('[data-tab-id]');
        return { tag: el.tagName, cls: String(el.className), tabId: tab ? tab.getAttribute('data-tab-id') : null };
      }, [px, py]);
      const post = await stripSnapshot(win);
      R({
        scenario: 'hittest',
        targetId: target.id,
        point: [px, py],
        stripBottom: hdr ? hdr.b : null,
        hitDuring,
        hitAfter,
        post: { areaTearOut: post.areaTearOut, listTearOut: post.listTearOut, listOverflowX: post.listOverflowX, spillBelowCount: post.spillBelowCount },
      });
      results.hittest = 'done';
    } catch (e) {
      R({ scenario: 'hittest', error: String((e && e.stack) || e) });
      results.hittest = 'error';
    } finally { await hardClose(app, 'hittest').catch(() => {}); }
  }

  // ================= H5: DETACH MOVE INTEGRITY + DRAG-BACK =============
  if (runS('detach')) {
    let app = null;
    try {
      app = await launchApp([], freshUserData('detach'));
      const origin = await app.firstWindow();
      await origin.waitForSelector('.sample-card', { timeout: 30000 });
      await openThreePlusEmpties(app, origin, 0);
      await origin.waitForTimeout(700);
      const before = await stripSnapshot(origin);
      const target = before.tabs.find((t) => !t.active) || before.tabs[0];
      const secondP = app.waitForEvent('window', { timeout: 20000 }).catch(() => null);
      const chip = origin.locator(`[data-tab-id="${target.id}"] .tab-colour-chip`);
      const cb = await chip.boundingBox();
      const hdr = await origin.locator('.app-header').boundingBox();
      const sx = cb.x + cb.width / 2;
      const sy = cb.y + cb.height / 2;
      await origin.mouse.move(sx, sy);
      await origin.mouse.down();
      await origin.mouse.move(sx, sy + 12, { steps: 4 });
      await origin.mouse.move(sx, hdr.y + hdr.height + 80, { steps: 12 });
      await origin.mouse.up();
      const second = await secondP;
      let adopted = null;
      if (second) {
        await second.waitForLoadState('domcontentloaded').catch(() => {});
        await second.waitForSelector('[data-tab-id]', { timeout: 20000 }).catch(() => {});
        await second.waitForTimeout(1500);
        adopted = await second.evaluate(() => ({
          tabCount: document.querySelectorAll('[data-tab-id]').length,
          workspace: !!document.querySelector('.workspace'),
          welcome: !!document.querySelector('.sample-card'),
          diag: typeof window.tflexDiagnostics === 'function' ? window.tflexDiagnostics() : null,
        })).catch((e) => ({ err: String(e.message) }));
      }
      await origin.waitForTimeout(1500);
      const after = await stripSnapshot(origin);
      R({
        scenario: 'detach',
        targetId: target.id,
        beforeCount: before.tabCount,
        originCountAfter: after.tabCount,
        originHasTarget: after.tabs.some((t) => t.id === target.id),
        originTearOutStuck: { areaTearOut: after.areaTearOut, listTearOut: after.listTearOut, listOverflowX: after.listOverflowX },
        secondOpened: !!second,
        adopted,
        windows: app.windows().filter((w) => !w.isClosed()).length,
      });
      // drag-back re-adopt: tear the tab out of the detached window back to origin
      if (second && !second.isClosed()) {
        const s2 = await stripSnapshot(second);
        const t2 = s2.tabs[0];
        if (t2) {
          const chip2 = second.locator(`[data-tab-id="${t2.id}"] .tab-colour-chip`);
          const cb2 = await chip2.boundingBox();
          const hdr2 = await second.locator('.app-header').boundingBox();
          if (cb2 && hdr2) {
            await second.mouse.move(cb2.x + cb2.width / 2, cb2.y + cb2.height / 2);
            await second.mouse.down();
            await second.mouse.move(cb2.x + cb2.width / 2, cb2.y + cb2.height / 2 + 12, { steps: 4 });
            await second.mouse.move(cb2.x + cb2.width / 2, hdr2.y + hdr2.height + 80, { steps: 12 });
            await second.mouse.up();
            await sleep(2500);
          }
        }
        const originBack = await stripSnapshot(origin);
        R({ scenario: 'detach', dragBack: { secondClosed: second.isClosed(), originCount: originBack.tabCount, originHasTarget: originBack.tabs.some((t) => t.id === target.id), windows: app.windows().filter((w) => !w.isClosed()).length } });
      }
      results.detach = 'done';
    } catch (e) {
      R({ scenario: 'detach', error: String((e && e.stack) || e) });
      results.detach = 'error';
    } finally { await hardClose(app, 'detach').catch(() => {}); }
  }

  fs.writeFileSync(path.join(OUT_DIR, 'results.json'), JSON.stringify(results, null, 2));
  console.log('### DONE');
}

run().catch((e) => { console.error('FATAL', e); process.exit(1); });
