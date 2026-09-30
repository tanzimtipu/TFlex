// Adversarial Phase-60 (TFL-71) diff-pass probe: live tab drag direct manipulation.
//
// Standalone harness (NOT an e2e spec). Launches the dev build ONLY through the
// canonical e2e/lib/launch.cjs helper. Attacks the Phase 60 working-tree diff:
//   - AppHeader: dragOffset / dragWidth / dragRect, arm-time measurement, reflowFor()
//   - AnimatedTab: dragging/dragOffset/reflowPx, dragStyle, data-tab-* hooks
//   - styles.css: .tab[data-tab-dragging] raise / reflow transform rule
//
// Run: node test-fixtures/adv-p60/probe.cjs [follow|reflow|jitter|squeeze|single|commit|all]
const REPO = 'C:\\Users\\tanzi\\OneDrive\\App Development\\TFlex';
const { launchApp, getSamplePath } = require(REPO + '\\e2e\\lib\\launch.cjs');
const { hardClose } = require(REPO + '\\e2e\\lib\\helpers.cjs');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const OUT_DIR = path.join(REPO, 'test-fixtures', 'adv-p60');
const SHOTS = path.join(REPO, 'screenshots');
const TMP = path.join(os.tmpdir(), 'adv-p60-' + Date.now());
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(SHOTS, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

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
    await win.waitForTimeout(55);
  }
  await win.waitForTimeout(900);
}

// Strip state: header/area/list boxes, per-tab box+reflow, drag slot.
async function snapshot(win) {
  return win.evaluate(() => {
    const header = document.querySelector('.app-header');
    const area = document.querySelector('.tab-area');
    const list = document.querySelector('.tab-list');
    const rect = (e) => {
      if (!e) return null;
      const r = e.getBoundingClientRect();
      return { l: +r.left.toFixed(2), t: +r.top.toFixed(2), r: +r.right.toFixed(2), b: +r.bottom.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) };
    };
    const tabs = Array.from(document.querySelectorAll('[data-tab-id]')).map((t) => {
      const r = t.getBoundingClientRect();
      const cs = getComputedStyle(t);
      const chip = t.querySelector('.tab-colour-chip');
      const cr = chip ? chip.getBoundingClientRect() : null;
      return {
        id: t.getAttribute('data-tab-id'),
        active: t.getAttribute('aria-selected') === 'true',
        dragging: t.getAttribute('data-tab-dragging'),
        dragX: t.getAttribute('data-tab-drag-x'),
        dragY: t.getAttribute('data-tab-drag-y'),
        reflow: t.getAttribute('data-tab-reflow'),
        box: { l: +r.left.toFixed(2), t: +r.top.toFixed(2), r: +r.right.toFixed(2), b: +r.bottom.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) },
        transform: cs.transform,
        chipCx: cr ? +(cr.left + cr.width / 2).toFixed(2) : null,
        chipCy: cr ? +(cr.top + cr.height / 2).toFixed(2) : null,
      };
    });
    return {
      header: rect(header),
      area: rect(area),
      list: rect(list),
      listOverflowX: list ? getComputedStyle(list).overflowX : null,
      listScrollLeft: list ? list.scrollLeft : null,
      listScrollWidth: list ? list.scrollWidth : null,
      listClientWidth: list ? list.clientWidth : null,
      listScrollbar: list ? list.offsetHeight - list.clientHeight : null,
      drop: list ? list.getAttribute('data-tab-drop') : null,
      draggingAttr: list ? list.getAttribute('data-dragging-tab') : null,
      tabCount: tabs.length,
      tabs,
    };
  });
}

function tabOf(snap, id) { return snap.tabs.find((t) => t.id === id) || null; }
function orderOf(snap) { return snap.tabs.map((t) => t.id); }

// The visual gap implied by the current reflow: the tab immediately to the
// right of the shift group and the one immediately to the left of the group
// (by rendered box). Returns {left, right, gapPx, slotIndex}.
function gapGeometry(snap) {
  const nonDragged = snap.tabs.filter((t) => t.dragging !== 'true');
  const shifted = nonDragged.filter((t) => t.reflow !== null && t.reflow !== '0');
  if (shifted.length === 0) return { gapPx: null, reason: 'no shifted tab' };
  const dir = Number(shifted[0].reflow) < 0 ? 'left' : 'right';
  const minL = Math.min(...shifted.map((t) => t.box.l));
  const maxR = Math.max(...shifted.map((t) => t.box.r));
  const unshifted = nonDragged.filter((t) => !(t.reflow !== null && t.reflow !== '0'));
  if (dir === 'left') {
    const right = unshifted.filter((t) => t.box.l >= maxR - 1).sort((a, b) => a.box.l - b.box.l)[0] || null;
    return {
      direction: dir,
      gapPx: right ? +(right.box.l - maxR).toFixed(2) : null,
      leftEdgeTab: shifted.find((t) => Math.abs(t.box.r - maxR) < 0.01)?.id ?? null,
      rightTab: right ? { id: right.id, l: right.box.l, reflow: right.reflow } : null,
      shiftedIds: shifted.map((t) => t.id),
      groupMinL: minL, groupMaxR: maxR,
    };
  }
  const left = unshifted.filter((t) => t.box.r <= minL + 1).sort((a, b) => b.box.r - a.box.r)[0] || null;
  return {
    direction: dir,
    gapPx: left ? +(minL - left.box.r).toFixed(2) : null,
    rightEdgeTab: shifted.find((t) => Math.abs(t.box.l - minL) < 0.01)?.id ?? null,
    leftTab: left ? { id: left.id, r: left.box.r, reflow: left.reflow } : null,
    shiftedIds: shifted.map((t) => t.id),
    groupMinL: minL, groupMaxR: maxR,
  };
}

// Cross the midpoint of the k-th "other" tab (0-based) and hold there, then
// return the live reflow geometry + computed transition for one tab.
async function reflowProbe(win, targetId, otherIdx, destXOverride) {
  const snap0 = await snapshot(win);
  const target = tabOf(snap0, targetId);
  const others = snap0.tabs.filter((t) => t.id !== targetId);
  const other = others[Math.min(otherIdx, others.length - 1)];
  if (!other) return { error: 'no other' };
  const boundary = (other.box.l + other.box.r) / 2;
  const destX = destXOverride !== undefined ? destXOverride : boundary + 30;
  await win.mouse.move(target.chipCx, target.chipCy);
  await win.mouse.down();
  await win.mouse.move(target.chipCx + 10, target.chipCy, { steps: 3 });
  await win.waitForTimeout(70);
  await win.mouse.move(destX, target.chipCy, { steps: 8 });
  await win.waitForTimeout(350);
  const during = await snapshot(win);
  const trans = await win.evaluate(() => {
    const el = document.querySelector('[data-tab-reflow]');
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { property: cs.transitionProperty, duration: cs.transitionDuration, transform: cs.transform };
  });
  await win.mouse.move(target.chipCx, target.chipCy, { steps: 10 });
  await win.waitForTimeout(100);
  await win.mouse.up();
  await win.waitForTimeout(300);
  return {
    boundary: +boundary.toFixed(2), drop: during.drop, gap: gapGeometry(during), transition: trans,
    targetId, sitting: target.box,
    tabs: during.tabs.map((t) => ({ id: t.id, r: t.reflow, drag: t.dragging, l: t.box.l, tr: t.transform })),
  };
}

// Drag by colour chip through a list of pointer X (same Y) sampling each.
// Returns { startX, y, resting, samples, released }.
async function dragThrough(win, tabId, ys, positions, release) {
  const snap0 = await snapshot(win);
  const chip = tabOf(snap0, tabId);
  if (!chip || chip.chipCx === null) return { error: 'no chip', snap0 };
  const startX = chip.chipCx;
  const startY = chip.chipCy;
  await win.mouse.move(startX, startY);
  await win.mouse.down();
  await win.mouse.move(startX + 1, startY, { steps: 1 });
  await win.mouse.move(startX + 10, startY, { steps: 3 }); // arm past 6px
  await win.waitForTimeout(70);
  const samples = [];
  for (const p of positions) {
    await win.mouse.move(p.x, p.y, { steps: 6 });
    await win.waitForTimeout(85);
    const s = await snapshot(win);
    samples.push({
      pointerX: +p.x.toFixed(2),
      pointerY: +p.y.toFixed(2),
      dx: +(p.x - startX).toFixed(2),
      dy: +(p.y - startY).toFixed(2),
      drop: s.drop,
      liveDragging: (s.tabs.find((t) => t.dragging === 'true') || {}).id ?? null,
      dragged: tabOf(s, tabId),
      gap: gapGeometry(s),
      reflowAttrs: s.tabs.filter((t) => t.reflow !== null).map((t) => ({ id: t.id, r: t.reflow })),
    });
  }
  let released = null;
  if (release) {
    const last = positions[positions.length - 1];
    await win.mouse.move(last.x, last.y, { steps: 4 });
    await win.waitForTimeout(80);
    await win.mouse.up();
    await win.waitForTimeout(400);
    released = await snapshot(win);
  }
  return { startX, startY, resting: chip, samples, released };
}

async function run() {
  const scenario = process.argv[2] || 'all';
  const runS = (s) => scenario === 'all' || scenario === s;
  const results = {};

  // ============ FOLLOW: live follow + clipping at strip edges + themes + size ====
  if (runS('follow')) {
    let app = null;
    try {
      app = await launchApp([], freshUserData('follow'));
      const win = await app.firstWindow();
      await win.waitForSelector('.sample-card', { timeout: 30000 });
      await openThreePlusEmpties(app, win, 0);
      await win.waitForTimeout(700);
      const snap0 = await snapshot(win);
      const order = orderOf(snap0);
      const active = snap0.tabs.find((t) => t.active);
      const target = snap0.tabs.find((t) => !t.active) || snap0.tabs[0];
      const chip = target;
      const startX = chip.chipCx;
      const startY = chip.chipCy;
      const area = snap0.area;
      // Sample a wide sweep: far LEFT past the area, through the strip, far RIGHT.
      const xs = [
        startX - 280, startX - 160, startX - 60, startX + 40, startX + 160, startX + 300, area.r + 160,
      ];
      const drag = await dragThrough(win, target.id, [], xs.map((x) => ({ x, y: startY })), false);
      await win.screenshot({ path: path.join(SHOTS, 'adv-p60-follow-middrag.png') });
      R({
        scenario: 'follow',
        area,
        header: snap0.header,
        startX, startY,
        tabCount: snap0.tabCount,
        target: { id: target.id, box: target.box, active: target.active },
        samples: drag.samples.map((s) => ({
          pointerX: s.pointerX, dx: s.dx,
          dragging: s.dragged ? s.dragged.dragging : null,
          dragX: s.dragged ? s.dragged.dragX : null,
          left: s.dragged ? s.dragged.box.l : null,
          expectedLeft: s.dragged ? +(drag.resting.box.l + s.dx).toFixed(2) : null,
          leftErr: s.dragged ? +(s.dragged.box.l - (drag.resting.box.l + s.dx)).toFixed(2) : null,
          clippedLeft: area ? s.dragged && s.dragged.box.l < area.l - 0.5 : null,
          clippedRight: area ? s.dragged && s.dragged.box.r > area.r + 0.5 : null,
          drop: s.drop,
        })),
      });
      // Return inside and release so no detach.
      await win.mouse.move(startX, startY, { steps: 10 });
      await win.waitForTimeout(120);
      await win.mouse.up();
      await win.waitForTimeout(300);

      // Minimized-ish (640) window: repeat with a tab that is HITTABLE inside
      // the narrow strip (scrolling may push some tabs off-view).
      await setWindowSize(app, 640, 620);
      await win.waitForTimeout(600);
      const snapZ = await snapshot(win);
      const restActive = snapZ.tabs.find((t) => t.active);
      R({
        scenario: 'follow-narrow640-rest',
        area: snapZ.area,
        list: snapZ.list,
        listScrollLeft: snapZ.listScrollLeft,
        listScrollWidth: snapZ.listScrollWidth,
        listClientWidth: snapZ.listClientWidth,
        active: restActive ? { id: restActive.id, l: restActive.box.l, r: restActive.box.r, clippedLeft: restActive.box.l < snapZ.list.l - 0.5, clippedRight: restActive.box.r > snapZ.list.r + 0.5 } : null,
      });
      let hittable = null;
      for (const t of snapZ.tabs) {
        if (t.active) continue;
        const hit = await win.evaluate(([x, y]) => {
          const el = document.elementFromPoint(x, y);
          if (!el) return null;
          const tb = el.closest('[data-tab-id]');
          return tb ? tb.getAttribute('data-tab-id') : null;
        }, [t.chipCx, t.chipCy]);
        if (hit === t.id) { hittable = t; break; }
      }
      const tz = hittable || snapZ.tabs.find((t) => !t.active) || snapZ.tabs[0];
      const dz = await dragThrough(win, tz.id, [], [
        { x: Math.max(snapZ.area.l + 6, tz.chipCx - 30), y: tz.chipCy },
        { x: Math.min(snapZ.area.r - 6, tz.chipCx + 40), y: tz.chipCy },
        { x: Math.min(snapZ.area.r - 6, tz.chipCx + 90), y: tz.chipCy },
      ], true);
      R({
        scenario: 'follow-narrow640',
        area: snapZ.area,
        listScrollWidth: snapZ.listScrollWidth,
        listClientWidth: snapZ.listClientWidth,
        target: { id: tz.id, hittable: hittable !== null, chipCx: tz.chipCx, chipCy: tz.chipCy },
        samples: dz.samples.map((s) => ({
          pointerX: s.pointerX,
          liveDragging: s.liveDragging,
          dragged: s.dragged ? s.dragged.dragging : null,
          dragX: s.dragged ? s.dragged.dragX : null,
          left: s.dragged ? s.dragged.box.l : null,
          expected: s.dragged ? +(dz.resting.box.l + s.dx).toFixed(2) : null,
          leftErr: s.dragged ? +(s.dragged.box.l - (dz.resting.box.l + s.dx)).toFixed(2) : null,
          clippedLeft: s.dragged && snapZ.area ? s.dragged.box.l < snapZ.area.l - 0.5 : null,
          clippedRight: s.dragged && snapZ.area ? s.dragged.box.r > snapZ.area.r + 0.5 : null,
          drop: s.drop,
          reflowAttrs: s.reflowAttrs,
        })),
      });
      const afterNarrow = await snapshot(win);
      const activeN = afterNarrow.tabs.find((t) => t.active);
      const listN = afterNarrow.list;
      await win.screenshot({ path: path.join(SHOTS, 'adv-p60-narrow640-clip.png') });
      R({
        scenario: 'follow-narrow640-post',
        order: orderOf(afterNarrow),
        activeClip: activeN ? { l: activeN.box.l, r: activeN.box.r, listL: listN.l, listR: listN.r, clippedLeft: activeN.box.l < listN.l - 0.5, clippedRight: activeN.box.r > listN.r + 0.5 } : null,
      });
      results.follow = 'done';
    } catch (e) {
      R({ scenario: 'follow', error: String((e && e.stack) || e) });
      results.follow = 'error';
    } finally { await hardClose(app, 'follow').catch(() => {}); }
  }

  // ============ REFLOW: gap geometry + instant under reduced motion / anim off ==
  if (runS('reflow')) {
    let app = null;
    try {
      app = await launchApp([], freshUserData('reflow'));
      const win = await app.firstWindow();
      await win.waitForSelector('.sample-card', { timeout: 30000 });
      await openThreePlusEmpties(app, win, 0);
      await win.waitForTimeout(700);
      const snap0 = await snapshot(win);
      const target = snap0.tabs.find((t) => !t.active) || snap0.tabs[0];
      const dragW = target.box.w;

      const normal = await reflowProbe(win, target.id, 0);
      R({ scenario: 'reflow-normal', targetId: target.id, draggedWidth: +dragW.toFixed(2), normal });

      // reduced motion: pick the LAST non-active tab and drag it far LEFT so a
      // genuine multi-tab reflow occurs, then the transition must collapse.
      await win.emulateMedia({ reducedMotion: 'reduce' });
      await win.waitForTimeout(200);
      const snapR = await snapshot(win);
      const nonActiveR = snapR.tabs.filter((t) => !t.active);
      const tr = nonActiveR[nonActiveR.length - 1] || snapR.tabs[snapR.tabs.length - 1];
      const reduced = await reflowProbe(win, tr.id, 0, snapR.list.l + 20);
      await win.emulateMedia({ reducedMotion: 'no-preference' });
      R({ scenario: 'reflow-reduced-motion', reduced });

      // Animations OFF via the settings hook (html data-animations="off").
      const animOff = await win.evaluate(() => {
        document.documentElement.setAttribute('data-animations', 'off');
        return document.documentElement.getAttribute('data-animations');
      });
      await win.waitForTimeout(200);
      const snapA = await snapshot(win);
      const nonActiveA = snapA.tabs.filter((t) => !t.active);
      const ta = nonActiveA[nonActiveA.length - 1] || snapA.tabs[snapA.tabs.length - 1];
      const off = await reflowProbe(win, ta.id, 0, snapA.list.l + 20);
      await win.evaluate(() => document.documentElement.removeAttribute('data-animations'));
      R({ scenario: 'reflow-anim-off', animOff, off });
      results.reflow = 'done';
    } catch (e) {
      R({ scenario: 'reflow', error: String((e && e.stack) || e) });
      results.reflow = 'error';
    } finally { await hardClose(app, 'reflow').catch(() => {}); }
  }

  // ============ JITTER: rapid midpoint crossings for oscillation ================
  if (runS('jitter')) {
    let app = null;
    try {
      app = await launchApp([], freshUserData('jitter'));
      const win = await app.firstWindow();
      await win.waitForSelector('.sample-card', { timeout: 30000 });
      await openThreePlusEmpties(app, win, 0);
      await win.waitForTimeout(700);
      const snap0 = await snapshot(win);
      const target = snap0.tabs.find((t) => !t.active) || snap0.tabs[0];
      // Find the midpoint of the tab that is 2 positions to the right, and
      // oscillate across it in tiny 1-2px steps.
      const idx = snap0.tabs.findIndex((t) => t.id === target.id);
      const other = snap0.tabs.filter((t) => t.id !== target.id);
      const mid = other[Math.min(1, other.length - 1)].box;
      const boundary = (mid.l + mid.r) / 2;
      const startX = target.chipCx;
      const startY = target.chipCy;
      await win.mouse.move(startX, startY);
      await win.mouse.down();
      await win.mouse.move(startX + 10, startY, { steps: 3 });
      await win.waitForTimeout(70);
      const seq = [];
      for (let i = 0; i < 24; i += 1) {
        const x = boundary + (i % 2 === 0 ? -1.5 : 1.5);
        await win.mouse.move(x, startY, { steps: 2 });
        await win.waitForTimeout(45);
        const s = await snapshot(win);
        seq.push(s.drop);
      }
      await win.mouse.move(startX, startY, { steps: 10 });
      await win.waitForTimeout(100);
      await win.mouse.up();
      await win.waitForTimeout(200);
      // Count sign flips in the sequence (oscillation).
      const flips = seq.slice(1).reduce((n, v, i) => n + (v !== seq[i] ? 1 : 0), 0);
      R({ scenario: 'jitter', targetId: target.id, boundary: +boundary.toFixed(2), seq, flips, uniqueDrops: Array.from(new Set(seq)) });
      results.jitter = 'done';
    } catch (e) {
      R({ scenario: 'jitter', error: String((e && e.stack) || e) });
      results.jitter = 'error';
    } finally { await hardClose(app, 'jitter').catch(() => {}); }
  }

  // ============ SQUEEZE: overlapping strip reflow geometry + active clip ========
  if (runS('squeeze')) {
    let app = null;
    try {
      app = await launchApp([], freshUserData('squeeze'));
      const win = await app.firstWindow();
      await win.waitForSelector('.sample-card', { timeout: 30000 });
      await openThreePlusEmpties(app, win, 30);
      await win.waitForTimeout(900);
      const snap0 = await snapshot(win);
      R({
        scenario: 'squeeze-rest',
        tabCount: snap0.tabCount,
        list: snap0.list,
        listScrollWidth: snap0.listScrollWidth,
        listClientWidth: snap0.listClientWidth,
        listScrollbar: snap0.listScrollbar,
        area: snap0.area,
        widths: Array.from(new Set(snap0.tabs.map((t) => t.box.w))),
        pitches: snap0.tabs.slice(1).map((t, i) => +(t.box.l - snap0.tabs[i].box.l).toFixed(2)).slice(0, 6),
      });
      const activeId = (snap0.tabs.find((t) => t.active) || {}).id;
      // pick a visible non-active tab
      const list = snap0.list;
      let target = snap0.tabs.find((t) => !t.active && t.chipCx > list.l + 6 && t.chipCx < list.r - 6);
      if (!target) target = snap0.tabs.find((t) => !t.active) || snap0.tabs[0];
      const drag = await dragThrough(win, target.id, [], [
        { x: target.chipCx + 40, y: target.chipCy },
        { x: Math.min(target.chipCx + 260, list.r - 40), y: target.chipCy },
        { x: Math.min(target.chipCx + 500, list.r - 20), y: target.chipCy },
      ], false);
      await win.screenshot({ path: path.join(SHOTS, 'adv-p60-squeeze-middrag.png') });
      await win.waitForTimeout(450);
      const settled = await snapshot(win);
      R({
        scenario: 'squeeze-settled',
        drop: settled.drop,
        gap: gapGeometry(settled),
        draggedWidth: +target.box.w.toFixed(2),
        reflowCount: settled.tabs.filter((t) => t.reflow !== null && t.reflow !== '0').length,
        targetId: target.id,
        draggingAttr: settled.draggingAttr,
        liveDragged: (() => { const d = settled.tabs.find((t) => t.dragging === 'true'); return d ? { id: d.id, l: d.box.l, r: d.box.r, dragX: d.dragX } : null; })(),
      });
      const afterDrag = await snapshot(win);
      R({
        scenario: 'squeeze-drag',
        targetId: target.id,
        draggedWidth: +target.box.w.toFixed(2),
        samples: drag.samples.map((s) => ({ pointerX: s.pointerX, drop: s.drop, gap: s.gap, reflowAttrs: s.reflowAttrs })),
        // overlap check: do rendered boxes of non-dragged tabs overlap by more
        // than the plan when reflowing?
        activeClipDuring: activeId ? (() => {
          const a = tabOf(afterDrag, activeId);
          return a && afterDrag.area ? { l: a.box.l, r: a.box.r, areaL: afterDrag.area.l, areaR: afterDrag.area.r, clippedLeft: a.box.l < afterDrag.area.l - 0.5, clippedRight: a.box.r > afterDrag.area.r + 0.5 } : null;
        })() : null,
      });
      await win.mouse.move(target.chipCx, target.chipCy, { steps: 12 });
      await win.waitForTimeout(120);
      await win.mouse.up();
      await win.waitForTimeout(400);
      const post = await snapshot(win);
      const a2 = activeId ? tabOf(post, activeId) : null;
      R({
        scenario: 'squeeze-post',
        tabCount: post.tabCount,
        orderChanged: JSON.stringify(orderOf(post)) !== JSON.stringify(orderOf(snap0)),
        activeClip: a2 && post.area ? { clippedLeft: a2.box.l < post.area.l - 0.5, clippedRight: a2.box.r > post.area.r + 0.5 } : null,
      });
      results.squeeze = 'done';
    } catch (e) {
      R({ scenario: 'squeeze', error: String((e && e.stack) || e) });
      results.squeeze = 'error';
    } finally { await hardClose(app, 'squeeze').catch(() => {}); }
  }

  // ============ SINGLE: one tab arms, follows, release is a no-op ===============
  if (runS('single')) {
    let app = null;
    try {
      app = await launchApp([], freshUserData('single'));
      const win = await app.firstWindow();
      await win.waitForSelector('.sample-card', { timeout: 30000 });
      await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
      await win.waitForSelector('.workspace', { timeout: 30000 });
      await win.waitForTimeout(900);
      const snap0 = await snapshot(win);
      R({ scenario: 'single-rest', tabCount: snap0.tabCount, tabs: snap0.tabs.map((t) => ({ id: t.id, active: t.active, box: t.box })) });
      const t0 = snap0.tabs[0];
      const drag = await dragThrough(win, t0.id, [], [
        { x: t0.chipCx + 40, y: t0.chipCy },
        { x: t0.chipCx, y: t0.chipCy + 60 },
      ], false);
      R({
        scenario: 'single-drag',
        samples: drag.samples.map((s) => ({
          dragging: s.dragged ? s.dragged.dragging : null,
          dragX: s.dragged ? s.dragged.dragX : null,
          dragY: s.dragged ? s.dragged.dragY : null,
          drop: s.drop,
          reflowAttrs: s.reflowAttrs,
          tearOut: null,
        })),
        tearOutAttrs: await win.evaluate(() => ({
          area: document.querySelector('.tab-area').getAttribute('data-tab-tearout'),
          list: document.querySelector('.tab-list').getAttribute('data-tab-tearout'),
        })),
      });
      await win.mouse.move(t0.chipCx, t0.chipCy, { steps: 8 });
      await win.waitForTimeout(100);
      await win.mouse.up();
      await win.waitForTimeout(300);
      const post = await snapshot(win);
      R({ scenario: 'single-post', tabCount: post.tabCount, draggingAttr: post.draggingAttr, order: orderOf(post) });
      results.single = 'done';
    } catch (e) {
      R({ scenario: 'single', error: String((e && e.stack) || e) });
      results.single = 'error';
    } finally { await hardClose(app, 'single').catch(() => {}); }
  }

  // ============ COMMIT: release commits the slot the gap showed =================
  if (runS('commit')) {
    let app = null;
    try {
      app = await launchApp([], freshUserData('commit'));
      const win = await app.firstWindow();
      await win.waitForSelector('.sample-card', { timeout: 30000 });
      await openThreePlusEmpties(app, win, 8);
      await win.waitForTimeout(800);
      const snap0 = await snapshot(win);
      const initial = orderOf(snap0);
      const activeId = (snap0.tabs.find((t) => t.active) || {}).id;
      const doc0 = await win.evaluate(() => { const d = window.tflexDiagnostics(); return { activeTabId: d.activeTabId, activeDocBytes: d.activeDocBytes, pageCount: d.pageCount }; });
      // Drag a middle tab LEFT across the first tab's midpoint, releasing at
      // the slot the gap shows.
      const target = snap0.tabs[Math.min(3, snap0.tabs.length - 1)];
      const drag = await dragThrough(win, target.id, [], [
        { x: snap0.list.l + 30, y: target.chipCy },
      ], false);
      const mid = drag.samples[drag.samples.length - 1];
      const dropShown = mid.drop;
      const implied = drag.gap;
      await win.mouse.up();
      await win.waitForTimeout(450);
      const post = await snapshot(win);
      const committed = orderOf(post);
      // reduced-frame expected order
      const arr = initial.slice();
      const from = arr.indexOf(target.id);
      const [el] = arr.splice(from, 1);
      arr.splice(Number(dropShown), 0, el);
      const doc1 = await win.evaluate(() => { const d = window.tflexDiagnostics(); return { activeTabId: d.activeTabId, activeDocBytes: d.activeDocBytes, pageCount: d.pageCount }; });
      R({
        scenario: 'commit',
        initial, targetId: target.id, dropShown, implied,
        expected: arr, committed, orderMatch: JSON.stringify(arr) === JSON.stringify(committed),
        activeUnchanged: (post.tabs.find((t) => t.active) || {}).id === activeId,
        docUnchanged: JSON.stringify(doc0) === JSON.stringify(doc1), doc0, doc1,
      });
      results.commit = 'done';
    } catch (e) {
      R({ scenario: 'commit', error: String((e && e.stack) || e) });
      results.commit = 'error';
    } finally { await hardClose(app, 'commit').catch(() => {}); }
  }

  // ============ NARROWCLIP: active tab clipped after a drag at 640px ==========
  if (runS('narrowclip')) {
    let app = null;
    try {
      app = await launchApp([], freshUserData('narrowclip'));
      const win = await app.firstWindow();
      await win.waitForSelector('.sample-card', { timeout: 30000 });
      await openThreePlusEmpties(app, win, 9); // 12 tabs
      await win.waitForTimeout(900);
      await setWindowSize(app, 640, 620);
      await win.waitForTimeout(700);
      let snap = await snapshot(win);
      // Activate a hittable background tab in the middle by a real click.
      let picked = null;
      for (const t of snap.tabs) {
        if (t.active) continue;
        const hit = await win.evaluate(([x, y]) => {
          const el = document.elementFromPoint(x, y);
          const tb = el ? el.closest('[data-tab-id]') : null;
          return tb ? tb.getAttribute('data-tab-id') : null;
        }, [Math.max(snap.list.l + 4, t.chipCx), t.chipCy]);
        if (hit === t.id) { picked = t; break; }
      }
      if (picked) {
        await win.mouse.click(Math.max(snap.list.l + 4, picked.chipCx), picked.chipCy);
        await win.waitForTimeout(500);
      }
      snap = await snapshot(win);
      const active0 = snap.tabs.find((t) => t.active);
      R({
        scenario: 'narrowclip-rest',
        pickedId: picked ? picked.id : null,
        list: snap.list, listScrollLeft: snap.listScrollLeft, listScrollWidth: snap.listScrollWidth, listClientWidth: snap.listClientWidth,
        active: active0 ? { id: active0.id, l: active0.box.l, r: active0.box.r, clippedRight: active0.box.r > snap.list.r + 0.5 } : null,
      });
      // Drag the ACTIVE tab rightwards (to the far right of the visible strip).
      const drag = await dragThrough(win, active0.id, [], [
        { x: Math.min(snap.list.r - 8, active0.chipCx + 80), y: active0.chipCy },
        { x: Math.min(snap.list.r - 8, active0.chipCx + 200), y: active0.chipCy },
      ], true);
      await win.waitForTimeout(500);
      const post = await snapshot(win);
      const active1 = post.tabs.find((t) => t.active);
      const order = orderOf(post);
      // can the strip scroll the active tab fully into view?
      const couldReveal = active1 ? await win.evaluate((id) => {
        const list = document.querySelector('.tab-list');
        const el = document.querySelector(`[data-tab-id="${id}"]`);
        if (!list || !el) return null;
        list.scrollLeft = list.scrollWidth;
        const lr = list.getBoundingClientRect();
        const ar = el.getBoundingClientRect();
        const r = { l: +ar.left.toFixed(2), r: +ar.right.toFixed(2), listL: +lr.left.toFixed(2), listR: +lr.right.toFixed(2), clippedLeft: ar.left < lr.left - 0.5, clippedRight: ar.right > lr.right + 0.5 };
        list.scrollLeft = 0;
        return r;
      }, active1.id) : null;
      await win.screenshot({ path: path.join(SHOTS, 'adv-p60-narrowclip.png') });
      R({
        scenario: 'narrowclip-post',
        activeId: active1 ? active1.id : null,
        activeAtRest: active0 ? { l: active0.box.l, r: active0.box.r } : null,
        activeAfter: active1 ? { l: active1.box.l, r: active1.box.r } : null,
        list: post.list,
        orderChanged: active0 ? order.indexOf(active0.id) !== orderOf(snap).indexOf(active0.id) : null,
        activeIndex: active0 ? order.indexOf(active0.id) : null,
        listScrollLeft: post.listScrollLeft,
        clippedRight: active1 ? active1.box.r > post.list.r + 0.5 : null,
        clippedLeft: active1 ? active1.box.l < post.list.l - 0.5 : null,
        couldRevealByScrolling: couldReveal,
        samples: drag.samples.map((s) => ({ drop: s.drop, draggedDragging: s.dragged ? s.dragged.dragging : null, reflowAttrs: s.reflowAttrs })),
      });
      results.narrowclip = 'done';
    } catch (e) {
      R({ scenario: 'narrowclip', error: String((e && e.stack) || e) });
      results.narrowclip = 'error';
    } finally { await hardClose(app, 'narrowclip').catch(() => {}); }
  }

  // ============ ACTIVEPUSH: reorder pushes the active tab out of a squeezed strip ======
  if (runS('activepush')) {
    let app = null;
    try {
      app = await launchApp([], freshUserData('activepush'));
      const win = await app.firstWindow();
      await win.waitForSelector('.sample-card', { timeout: 30000 });
      await openThreePlusEmpties(app, win, 3); // 6 tabs
      await win.waitForTimeout(900);
      await setWindowSize(app, 640, 620);
      await win.waitForTimeout(700);
      let snap = await snapshot(win);
      R({ scenario: 'activepush-rest', tabCount: snap.tabCount, list: snap.list, listScrollWidth: snap.listScrollWidth, listClientWidth: snap.listClientWidth, listScrollbar: snap.listScrollbar, widths: Array.from(new Set(snap.tabs.map((t) => t.box.w))), pitches: snap.tabs.slice(1).map((t, i) => +(t.box.l - snap.tabs[i].box.l).toFixed(2)).slice(0, 5) });

      // Activate a middle tab by clicking the topmost tab at a mid-strip point.
      const clickInfo = await win.evaluate(() => {
        const list = document.querySelector('.tab-list');
        const lr = list.getBoundingClientRect();
        const x = lr.left + lr.width * 0.22;
        const y = lr.top + 20;
        const el = document.elementFromPoint(x, y);
        const tb = el ? el.closest('[data-tab-id]') : null;
        return tb ? { id: tb.getAttribute('data-tab-id'), x, y } : null;
      });
      if (clickInfo) {
        await win.mouse.click(clickInfo.x, clickInfo.y);
        await win.waitForTimeout(600);
      }
      snap = await snapshot(win);
      const activeId = (snap.tabs.find((t) => t.active) || {}).id;
      R({ scenario: 'activepush-activated', clickInfo, activeId, activeIndex: orderOf(snap).indexOf(activeId), active: (() => { const a = snap.tabs.find((t) => t.id === activeId); return a ? { l: a.box.l, r: a.box.r } : null; })() });

      // Repeatedly drag a hittable tab AFTER the active to the far LEFT, so the
      // active tab is pushed one slot right each iteration.
      const iterations = [];
      for (let i = 0; i < 4; i += 1) {
        const s = await snapshot(win);
        const ai = s.tabs.findIndex((t) => t.active);
        // find a hittable non-active tab at index > ai
        let cand = null;
        for (let j = s.tabs.length - 1; j > ai; j -= 1) {
          const t = s.tabs[j];
          const hit = await win.evaluate(([x, y]) => {
            const el = document.elementFromPoint(x, y);
            const tb = el ? el.closest('[data-tab-id]') : null;
            return tb ? tb.getAttribute('data-tab-id') : null;
          }, [t.chipCx, t.chipCy]);
          if (hit === t.id && t.chipCx > s.list.l + 4 && t.chipCx < s.list.r - 4) { cand = t; break; }
        }
        if (!cand) { iterations.push({ i, skipped: 'no hittable tab after active' }); break; }
        const d = await dragThrough(win, cand.id, [], [{ x: s.list.l + 12, y: cand.chipCy }], true);
        await win.waitForTimeout(450);
        const after = await snapshot(win);
        const a = after.tabs.find((t) => t.active);
        iterations.push({
          i, movedId: cand.id,
          activeIndex: after.tabs.findIndex((t) => t.active),
          active: a ? { l: a.box.l, r: a.box.r } : null,
          listL: after.list.l, listR: after.list.r, listScrollLeft: after.listScrollLeft,
          clippedRight: a ? a.box.r > after.list.r + 0.5 : null,
          clippedLeft: a ? a.box.l < after.list.l - 0.5 : null,
        });
      }
      const final = await snapshot(win);
      const af = final.tabs.find((t) => t.active);
      await win.screenshot({ path: path.join(SHOTS, 'adv-p60-activepush.png') });
      R({
        scenario: 'activepush-post',
        iterations,
        finalActive: af ? { id: af.id, l: af.box.l, r: af.box.r } : null,
        list: final.list, listScrollLeft: final.listScrollLeft,
        clippedRight: af ? af.box.r > final.list.r + 0.5 : null,
        clippedLeft: af ? af.box.l < final.list.l - 0.5 : null,
      });
      results.activepush = 'done';
    } catch (e) {
      R({ scenario: 'activepush', error: String((e && e.stack) || e) });
      results.activepush = 'error';
    } finally { await hardClose(app, 'activepush').catch(() => {}); }
  }

  // ============ CLIP3: minimal active-tab-clip repro at 640px ==================
  if (runS('clip3')) {
    let app = null;
    try {
      app = await launchApp([], freshUserData('clip3'));
      const win = await app.firstWindow();
      await win.waitForSelector('.sample-card', { timeout: 30000 });
      await openThreePlusEmpties(app, win, 0);
      await win.waitForTimeout(700);
      await setWindowSize(app, 640, 620);
      await win.waitForTimeout(700);
      const rest = await snapshot(win);
      const activeId = (rest.tabs.find((t) => t.active) || {}).id;
      const a0 = rest.tabs.find((t) => t.id === activeId);
      R({ scenario: 'clip3-rest', list: rest.list, listScrollLeft: rest.listScrollLeft, listScrollWidth: rest.listScrollWidth, listClientWidth: rest.listClientWidth, active: a0 ? { id: a0.id, l: a0.box.l, r: a0.box.r, clippedRight: a0.box.r > rest.list.r + 0.5, clippedLeft: a0.box.l < rest.list.l - 0.5 } : null });

      // Drag the active tab rightwards to the far right of the visible strip.
      const drag = await dragThrough(win, activeId, [], [
        { x: rest.list.r - 10, y: a0.chipCy },
        { x: rest.list.r - 6, y: a0.chipCy },
      ], true);
      await win.waitForTimeout(600);
      const post = await snapshot(win);
      const a1 = post.tabs.find((t) => t.active);
      // Which scrollLeft WOULD show it fully?
      const reveal = a1 ? await win.evaluate((id) => {
        const list = document.querySelector('.tab-list');
        const el = document.querySelector(`[data-tab-id="${id}"]`);
        if (!list || !el) return null;
        const max = list.scrollWidth - list.clientWidth;
        const out = [];
        for (let s = 0; s <= max; s += 2) {
          list.scrollLeft = s;
          const lr = list.getBoundingClientRect();
          const ar = el.getBoundingClientRect();
          if (ar.left >= lr.left - 0.5 && ar.right <= lr.right + 0.5) out.push({ s, l: +ar.left.toFixed(1), r: +ar.right.toFixed(1) });
        }
        list.scrollLeft = 0;
        return { max, fitsAt: out.slice(0, 3) };
      }, a1.id) : null;
      R({
        scenario: 'clip3-post',
        order: orderOf(post),
        active: a1 ? { id: a1.id, l: a1.box.l, r: a1.box.r } : null,
        list: post.list, listScrollLeft: post.listScrollLeft,
        clippedRight: a1 ? a1.box.r > post.list.r + 0.5 : null,
        clippedLeft: a1 ? a1.box.l < post.list.l - 0.5 : null,
        revealByScrolling: reveal,
        samples: drag.samples.map((s) => ({ drop: s.drop, reflowAttrs: s.reflowAttrs })),
      });
      await win.screenshot({ path: path.join(SHOTS, 'adv-p60-clip3.png') });
      results.clip3 = 'done';
    } catch (e) {
      R({ scenario: 'clip3', error: String((e && e.stack) || e) });
      results.clip3 = 'error';
    } finally { await hardClose(app, 'clip3').catch(() => {}); }
  }

  // ============ CANCEL: pointercancel mid-reflow clears every transform =========
  if (runS('cancel')) {
    let app = null;
    try {
      app = await launchApp([], freshUserData('cancel'));
      const win = await app.firstWindow();
      await win.waitForSelector('.sample-card', { timeout: 30000 });
      await openThreePlusEmpties(app, win, 5);
      await win.waitForTimeout(800);
      const snap0 = await snapshot(win);
      const initials = orderOf(snap0);
      const target = snap0.tabs[1] || snap0.tabs[0];
      // Drag to a reflow state (cursor over a later slot), then cancel via window.
      const chip = tabOf(snap0, target.id);
      await win.mouse.move(chip.chipCx, chip.chipCy);
      await win.mouse.down();
      await win.mouse.move(chip.chipCx + 10, chip.chipCy, { steps: 3 });
      await win.waitForTimeout(60);
      await win.mouse.move(snap0.list.r - 30, chip.chipCy, { steps: 8 });
      await win.waitForTimeout(250);
      const during = await snapshot(win);
      await win.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1, bubbles: true, cancelable: true })));
      await win.waitForTimeout(300);
      const afterCancel = await snapshot(win);
      await win.mouse.up();
      await win.waitForTimeout(250);
      const afterUp = await snapshot(win);
      R({
        scenario: 'cancel',
        targetId: target.id,
        during: { drop: during.drop, draggingAttr: during.draggingAttr, reflowCount: during.tabs.filter((t) => t.reflow !== null).length },
        afterCancel: {
          drop: afterCancel.drop, draggingAttr: afterCancel.draggingAttr,
          reflowCount: afterCancel.tabs.filter((t) => t.reflow !== null).length,
          nonNoneTransforms: afterCancel.tabs.filter((t) => t.transform !== 'none').map((t) => ({ id: t.id, tr: t.transform })),
          order: orderOf(afterCancel),
        },
        afterUp: { dragCount: afterUp.tabs.filter((t) => t.dragging === 'true').length, order: orderOf(afterUp) },
        orderUnchanged: JSON.stringify(orderOf(afterCancel)) === JSON.stringify(initials),
      });
      results.cancel = 'done';
    } catch (e) {
      R({ scenario: 'cancel', error: String((e && e.stack) || e) });
      results.cancel = 'error';
    } finally { await hardClose(app, 'cancel').catch(() => {}); }
  }

  fs.writeFileSync(path.join(OUT_DIR, 'results.json'), JSON.stringify(results, null, 2));
  console.log('### DONE');
}

run().catch((e) => { console.error('FATAL', e); process.exit(1); });
