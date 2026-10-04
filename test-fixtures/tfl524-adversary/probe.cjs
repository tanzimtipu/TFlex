'use strict';
// TFL-524 chunk C (adversary) — diff-pass probe on the colorful tab TOP-EDGE
// alignment fix (DEF-534). Standalone node harness (no test runner, so it is
// not bound by playwright.config testDir). Launches ONLY through the canonical
// e2e/lib/launch.cjs helper.
//
// Attack surfaces:
//   S1 drag / tear-out geometry (background + active tab, floated vs resting)
//   S2 the "+" control geometry + silence attack (welcome + multi-tab)
//   S3 overflow at the 640px minimum with 14 tabs
//   S4 multi-mode composite tab
//   S5 oracle integrity (revert to pre-fix CSS in-page; assert the oracle fails)
//   S6 standard style + close-button hit-test on the full-height active tab
//
// Run:  node test-fixtures/tfl524-adversary/probe.cjs
// (Unset ELECTRON_RUN_AS_NODE first if set.)

const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');

const OUT = path.resolve(__dirname);
const results = [];
function check(name, pass, detail) {
  const ok = !!pass;
  results.push({ name, pass: ok, detail: detail === undefined ? '' : String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail === undefined ? '' : ' | ' + detail}`);
}

async function launch(tag) {
  const app = await launchApp([], path.join(os.tmpdir(), `tfl524-adv-${tag}-${Date.now()}`));
  const win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
  return { app, win };
}

async function openBundled(app, win, name) {
  const p = getSamplePath(name);
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForTimeout(1300);
}

async function openFirst(app, win) {
  await win.locator('.sample-card').filter({ hasText: 'report.pdf' }).first().click();
  await win.waitForSelector('.workspace', { timeout: 30000 });
  await win.waitForTimeout(1000);
}

async function openThree(app, win) {
  await openFirst(app, win);
  await openBundled(app, win, 'long.pdf');
  await openBundled(app, win, 'form.pdf');
  await win.waitForFunction(() => document.querySelectorAll('[data-tab-id]').length >= 3, null, { timeout: 30000 });
  await win.waitForTimeout(500);
}

function measure(win) {
  return win.evaluate(() => {
    const r = (el) => {
      const b = el.getBoundingClientRect();
      return { top: +b.top.toFixed(2), bottom: +b.bottom.toFixed(2), height: +b.height.toFixed(2), left: +b.left.toFixed(2), right: +b.right.toFixed(2), width: +b.width.toFixed(2) };
    };
    const tabs = Array.from(document.querySelectorAll('[data-tab-id]')).map((el) => ({
      id: el.getAttribute('data-tab-id'),
      active: el.getAttribute('aria-selected') === 'true',
      dragging: el.getAttribute('data-tab-dragging') === 'true',
      ...r(el),
    }));
    const area = document.querySelector('.tab-area');
    const list = document.querySelector('.tab-list');
    const newLi = document.querySelector('.tab-list-new');
    const newBtn = document.querySelector('[data-new-tab]');
    const main = document.querySelector('.app-main');
    return {
      count: tabs.length,
      style: area ? area.getAttribute('data-tab-style') : null,
      tabs,
      area: area ? r(area) : null,
      list: list ? r(list) : null,
      newLi: newLi ? r(newLi) : null,
      newBtn: newBtn ? r(newBtn) : null,
      mainTop: main ? +main.getBoundingClientRect().top.toFixed(2) : null,
      newBtnCount: document.querySelectorAll('[data-new-tab]').length,
    };
  });
}

function hitTest(win, x, y) {
  return win.evaluate(({ px, py }) => {
    const el = document.elementFromPoint(px, py);
    if (el === null) return { tag: null };
    return { tag: el.tagName, cls: el.className && el.className.toString ? el.className.toString() : '', isNew: el.hasAttribute('data-new-tab') || el.closest('[data-new-tab]') !== null, isClose: el.classList.contains('tab-close') || el.closest('.tab-close') !== null };
  }, { px: x, py: y });
}

async function setSize(app, w, h) {
  await app.evaluate(({ BrowserWindow }, s) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (!bw) return;
    bw.unmaximize();
    bw.setSize(s.w, s.h);
  }, { w, h });
  await new Promise((r) => setTimeout(r, 500));
}

async function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ---------------------------------------------------------------------------
async function surface1_drag(app, win) {
  console.log('\n=== S1 drag / tear-out geometry ===');
  await openThree(app, win);
  const m0 = await measure(win);
  console.log(`[S1] resting containter=${JSON.stringify({ count: m0.count, style: m0.style, area: m0.area, list: m0.list })}`);
  console.log(`[S1] resting tabs=${JSON.stringify(m0.tabs)}`);
  const inactiveHeights = m0.tabs.filter((t) => !t.active).map((t) => t.height);
  const active0 = m0.tabs.find((t) => t.active);
  check('S1 resting: at least one active + one inactive', !!active0 && inactiveHeights.length > 0, `active=${!!active0} inactive=${inactiveHeights.length}`);
  check('S1 resting: inactive chips are 26px', inactiveHeights.every((h) => Math.abs(h - 26) <= 0.5), JSON.stringify(inactiveHeights));
  check('S1 resting: active fills the strip (>= all inactive)', active0 && active0.height > Math.max(...inactiveHeights), `active=${active0 && active0.height}`);
  const tops0 = m0.tabs.map((t) => t.top);
  check('S1 resting: every tab shares one top edge', Math.max(...tops0) - Math.min(...tops0) <= 0.5, JSON.stringify(tops0));
  check('S1 resting: active foot flush with canvas', m0.mainTop !== null && active0 && Math.abs(m0.mainTop - active0.bottom) <= 1, `mainTop=${m0.mainTop} activeBottom=${active0 && active0.bottom}`);

  // --- Drag a BACKGROUND tab (mousedown activates it, DEF-034) ---
  const bgId = m0.tabs.find((t) => !t.active).id;
  const bgRest = m0.tabs.find((t) => t.id === bgId);
  const chip = await win.locator(`[data-tab-id="${bgId}"] .tab-title`).boundingBox();
  const startX = chip.x + chip.width / 2;
  const y = chip.y + chip.height / 2;
  await win.mouse.move(startX, y);
  await win.mouse.down();
  await sleep(140);
  // after mousedown the tab should be active + full strip height, with an
  // UNCHANGED top edge (the TFL-524 guarantee). A pre-fix CSS would show a
  // ~3px top jump here.
  const postDown = await measure(win);
  const bgNow = postDown.tabs.find((t) => t.id === bgId);
  console.log(`[S1] bg post-mousedown=${JSON.stringify(bgNow)} (resting top=${bgRest.top} height=${bgRest.height})`);
  check('S1 drag: grabbing an inactive tab keeps its TOP edge fixed (no pre-fix-style jump)', bgNow && Math.abs(bgNow.top - bgRest.top) <= 0.5, `restTop=${bgRest.top} nowTop=${bgNow && bgNow.top}`);
  check('S1 drag: grabbed tab expands to the full strip height (top-aligned, not foot-pinned)', bgNow && bgNow.height > bgRest.height, `restH=${bgRest.height} nowH=${bgNow && bgNow.height}`);

  await win.mouse.move(startX + 9, y, { steps: 4 });
  await sleep(120);
  const armed = await measure(win);
  const bgArmed = armed.tabs.find((t) => t.id === bgId);
  const reserveLi = await win.evaluate((id) => {
    const el = document.querySelector(`[data-tab-id="${id}"]`);
    const li = el && el.parentElement;
    return li ? { height: +li.getBoundingClientRect().height.toFixed(2), width: +li.getBoundingClientRect().width.toFixed(2), alignSelf: getComputedStyle(li).alignSelf } : null;
  }, bgId);
  console.log(`[S1] armed dragged=${bgArmed && bgArmed.dragging} box=${JSON.stringify(bgArmed)} li=${JSON.stringify(reserveLi)}`);
  check('S1 drag: armed tab still full strip height (no collapse)', bgArmed && Math.abs(bgArmed.height - active0.height) <= 0.5, `armed=${bgArmed && bgArmed.height} activeRest=${active0.height}`);
  check('S1 drag: armed tab top unchanged from resting chip', bgArmed && Math.abs(bgArmed.top - bgRest.top) <= 0.5, `rest=${bgRest.top} armed=${bgArmed && bgArmed.top}`);

  // --- Tear-out past the threshold: floated box vs resting box ---
  await win.mouse.move(startX + 9, y + 130, { steps: 12 });
  await sleep(160);
  const tear = await win.evaluate((id) => {
    const el = document.querySelector(`[data-tab-id="${id}"]`);
    const li = el && el.parentElement;
    const area = document.querySelector('.tab-area');
    const list = document.querySelector('.tab-list');
    const rr = (x) => { if (!x) return null; const b = x.getBoundingClientRect(); return { top: +b.top.toFixed(2), bottom: +b.bottom.toFixed(2), height: +b.height.toFixed(2), left: +b.left.toFixed(2), width: +b.width.toFixed(2) }; };
    return {
      areaTearOut: area && area.getAttribute('data-tab-tearout'),
      listTearOut: list && list.getAttribute('data-tab-tearout'),
      tab: rr(el), li: rr(li), list: rr(list),
      tabPos: el ? getComputedStyle(el).position : null,
      liAlign: li ? getComputedStyle(li).alignSelf : null,
    };
  }, bgId);
  console.log(`[S1] tearout=${JSON.stringify(tear)}`);
  check('S1 tear-out: dragged tab is floated (position absolute)', tear.tabPos === 'absolute', tear.tabPos);
  check('S1 tear-out: floated box height equals the resting active height (no collapse/jump)', tear.tab && active0 && Math.abs(tear.tab.height - active0.height) <= 0.5, `floatH=${tear.tab && tear.tab.height} activeRest=${active0.height}`);
  check('S1 tear-out: floated box width equals the resting active width', tear.tab && Math.abs(tear.tab.width - active0.width) <= 1, `floatW=${tear.tab && tear.tab.width} activeRestW=${active0.width}`);
  check('S1 tear-out: reserve <li> keeps the full strip height', tear.li && Math.abs(tear.li.height - active0.height) <= 0.5, `liH=${tear.li && tear.li.height}`);
  await win.screenshot({ path: path.join(OUT, 's1-tearout-float.png') }).catch(() => {});

  // Move back INSIDE the strip before releasing so the release does not detach
  // the tab into a new window (detach itself is Phase 61 behaviour and would
  // make the follow-up active-tab drag read a torn-down window).
  await win.mouse.move(startX + 9, y + 4, { steps: 6 });
  await sleep(140);
  await win.mouse.up();
  await sleep(250);
  const afterReturn = await measure(win);
  const topsAfter = afterReturn.tabs.map((t) => t.top);
  check('S1 after release: all tops realign to one edge', Math.max(...topsAfter) - Math.min(...topsAfter) <= 0.5, JSON.stringify(topsAfter));

  // --- Drag the ALREADY-ACTIVE tab ---
  const activeNow = afterReturn.tabs.find((t) => t.active);
  check('S1 active-tab drag: an active tab survives the reorder gesture', !!activeNow, JSON.stringify(afterReturn.tabs.map((t) => t.id)));
  if (activeNow) {
    const acc = await win.locator(`[data-tab-id="${activeNow.id}"] .tab-title`).boundingBox();
    const ax = acc.x + acc.width / 2;
    const ay = acc.y + acc.height / 2;
    await win.mouse.move(ax, ay);
    await win.mouse.down();
    await win.mouse.move(ax + 10, ay, { steps: 4 });
    await sleep(120);
    const armedActive = await win.evaluate((id) => {
      const el = document.querySelector(`[data-tab-id="${id}"]`);
      if (el === null) return null;
      const b = el.getBoundingClientRect();
      return { dragging: el.getAttribute('data-tab-dragging'), top: +b.top.toFixed(2), height: +b.height.toFixed(2) };
    }, activeNow.id);
    console.log(`[S1] active drag armed=${JSON.stringify(armedActive)}`);
    check('S1 drag active tab: height + top stable while dragged', armedActive !== null && armedActive.dragging === 'true' && Math.abs(armedActive.height - activeNow.height) <= 0.5 && Math.abs(armedActive.top - activeNow.top) <= 0.5, JSON.stringify(armedActive));
    await win.mouse.up();
    await sleep(200);
  }

  await hardClose(app, 's1');
}

// ---------------------------------------------------------------------------
async function surface2_plus(app, win) {
  console.log('\n=== S2 "+" control + welcome state ===');
  // Welcome (zero tabs): DEF-055 gates the "+" on tabs.length >= 1.
  let m = await measure(win);
  check('S2 welcome: "+" is not rendered at zero tabs (DEF-055)', m.newBtnCount === 0, `count=${m.newBtnCount}`);
  check('S2 welcome: strip has zero tabs', m.count === 0, `count=${m.count}`);

  await openThree(app, win);
  m = await measure(win);
  console.log(`[S2] multi-tab area=${JSON.stringify(m.area)} list=${JSON.stringify(m.list)} newLi=${JSON.stringify(m.newLi)} newBtn=${JSON.stringify(m.newBtn)}`);
  check('S2 multi-tab: "+" <li> rendered', m.newLi !== null && m.newBtn !== null, JSON.stringify({ li: !!m.newLi, btn: !!m.newBtn }));
  if (m.newBtn && m.list) {
    check('S2 "+" fully inside the strip vertically', m.newBtn.top >= m.list.top - 0.5 && m.newBtn.bottom <= m.list.bottom + 0.5, `btn=${m.newBtn.top}..${m.newBtn.bottom} list=${m.list.top}..${m.list.bottom}`);
    check('S2 "+" height unchanged at 34px', Math.abs(m.newBtn.height - 34) <= 1, `h=${m.newBtn.height}`);
    const cx = m.newBtn.left + m.newBtn.width / 2;
    const cy = m.newBtn.top + m.newBtn.height / 2;
    const hit = await hitTest(win, cx, cy);
    console.log(`[S2] "+" hit-test at (${cx.toFixed(1)},${cy.toFixed(1)}) -> ${JSON.stringify(hit)}`);
    check('S2 "+" is hit-testable at its centre', hit.isNew === true, JSON.stringify(hit));
    const before = m.count;
    await win.locator('[data-new-tab]').first().click();
    await win.waitForTimeout(500);
    const after = await measure(win);
    check('S2 silence attack: clicking "+" opens a new tab', after.count === before + 1, `${before} -> ${after.count}`);
    const tops = after.tabs.map((t) => t.top);
    check('S2 after "+": all tops still share one edge', Math.max(...tops) - Math.min(...tops) <= 0.5, JSON.stringify(tops));
  }
  await win.screenshot({ path: path.join(OUT, 's2-plus-strip.png') }).catch(() => {});
  await hardClose(app, 's2');
}

// ---------------------------------------------------------------------------
async function surface3_overflow(app, win) {
  console.log('\n=== S3 overflow @640 with 14 tabs ===');
  await openFirst(app, win);
  for (let i = 0; i < 13; i += 1) {
    const plus = win.locator('[data-new-tab]');
    if ((await plus.count()) === 0) break;
    await plus.first().click({ timeout: 5000 }).catch(() => {});
    await win.waitForTimeout(280);
  }
  await setSize(app, 1280, 800);
  let m = await measure(win);
  console.log(`[S3] count=${m.count} @1280 area=${JSON.stringify(m.area)} list=${JSON.stringify(m.list)}`);
  const tops1280 = m.tabs.map((t) => t.top);
  check('S3 @1280: 14+ tabs open', m.count >= 14, `count=${m.count}`);
  check('S3 @1280: every top shares one edge', Math.max(...tops1280) - Math.min(...tops1280) <= 0.5, JSON.stringify(tops1280));
  const active1280 = m.tabs.find((t) => t.active);
  check('S3 @1280: active foot flush with canvas', active1280 && m.mainTop !== null && Math.abs(m.mainTop - active1280.bottom) <= 1, `mainTop=${m.mainTop} bottom=${active1280 && active1280.bottom}`);

  await setSize(app, 640, 800);
  m = await measure(win);
  console.log(`[S3] @640 area=${JSON.stringify(m.area)} list=${JSON.stringify(m.list)} newBtn=${JSON.stringify(m.newBtn)}`);
  console.log(`[S3] @640 tabs=${JSON.stringify(m.tabs.map((t) => ({ id: t.id.slice(0, 6), a: t.active, top: t.top, h: t.height, l: t.left, r: t.right })))}`);
  const tops640 = m.tabs.map((t) => t.top);
  check('S3 @640: every top shares one edge', Math.max(...tops640) - Math.min(...tops640) <= 0.5, JSON.stringify(tops640));
  const active640 = m.tabs.find((t) => t.active);
  check('S3 @640: active foot flush with canvas', active640 && m.mainTop !== null && Math.abs(m.mainTop - active640.bottom) <= 1, `mainTop=${m.mainTop} bottom=${active640 && active640.bottom}`);
  check('S3 @640: active tab not clipped past the list right', active640 && m.list && active640.right <= m.list.right + 1, `activeRight=${active640 && active640.right} listRight=${m.list && m.list.right}`);
  check('S3 @640: active tab not clipped past the list left', active640 && m.list && active640.left >= m.list.left - 1, `activeLeft=${active640 && active640.left} listLeft=${m.list && m.list.left}`);
  if (m.newBtn && m.list) {
    check('S3 @640: "+" still inside the strip vertically', m.newBtn.top >= m.list.top - 0.5 && m.newBtn.bottom <= m.list.bottom + 0.5, `btn=${m.newBtn.top}..${m.newBtn.bottom} list=${m.list.top}..${m.list.bottom}`);
    const cx = m.newBtn.left + m.newBtn.width / 2;
    const cy = m.newBtn.top + m.newBtn.height / 2;
    const hit = await hitTest(win, cx, cy);
    // Out of TFL-524 scope: the "+" centre is occluded at extreme squeeze and
    // this reproduces on the PRE-FIX CSS too (see probe-plus-occlusion.cjs /
    // probe-plus-prefix-click.cjs), so it is NOT a TFL-524 finding. Record it
    // as an observation only.
    console.log(`[S3] @640 "+" hit-test -> ${JSON.stringify(hit)} (occluder; pre-existing, see occlusion probe)`);
  }
  // Re-measure after a mid-state resize back up.
  await setSize(app, 900, 800);
  m = await measure(win);
  const tops900 = m.tabs.map((t) => t.top);
  check('S3 resize-back: every top shares one edge', Math.max(...tops900) - Math.min(...tops900) <= 0.5, JSON.stringify(tops900));
  await win.screenshot({ path: path.join(OUT, 's3-overflow-640.png') }).catch(() => {});
  await hardClose(app, 's3');
}

// ---------------------------------------------------------------------------
async function surface4_multimode(app, win) {
  console.log('\n=== S4 multi-mode composite tab ===');
  await openFirst(app, win);
  const toggle = win.locator('[data-header-multi-mode]').first();
  if ((await toggle.count()) === 0) {
    check('S4 multi-mode toggle present', false, 'no [data-header-multi-mode]');
    await hardClose(app, 's4');
    return;
  }
  await toggle.click();
  await win.waitForTimeout(700);
  await openBundled(app, win, 'long.pdf').catch(() => {});
  await win.waitForTimeout(800);
  const m = await measure(win);
  console.log(`[S4] multi-mode count=${m.count} tabs=${JSON.stringify(m.tabs)}`);
  // Multi Mode (DEF-288) shows ONE composite workspace tab, so count==1 is the
  // expected shape, not a failure.
  check('S4 multi-mode: composite tab present', m.count >= 1, `count=${m.count}`);
  const active = m.tabs.find((t) => t.active);
  check('S4 multi-mode: composite tab is active + full strip height', active && Math.abs(active.height - (m.area ? m.area.height : 43)) <= 1, JSON.stringify(active));
  check('S4 multi-mode: composite tab top aligned to the strip top', active && m.area && Math.abs(active.top - m.area.top) <= 1, `tabTop=${active && active.top} areaTop=${m.area && m.area.top}`);
  check('S4 multi-mode: composite tab foot flush with canvas', active && m.mainTop !== null && Math.abs(m.mainTop - active.bottom) <= 1, `mainTop=${m.mainTop} bottom=${active && active.bottom}`);
  check('S4 multi-mode: composite tab not clipped vertically', active && m.list && active.top >= m.list.top - 1 && active.bottom <= m.list.bottom + 1, `active=${active && active.top}..${active && active.bottom} list=${m.list && m.list.top}..${m.list && m.list.bottom}`);
  await win.screenshot({ path: path.join(OUT, 's4-multimode.png') }).catch(() => {});
  await hardClose(app, 's4');
}

// ---------------------------------------------------------------------------
async function surface5_oracle(app, win) {
  console.log('\n=== S5 oracle integrity (pre-fix CSS injection) ===');
  await openThree(app, win);
  async function aligned() {
    const m = await measure(win);
    const a = m.tabs.find((t) => t.active);
    const i = m.tabs.find((t) => !t.active);
    return { m, a, i, topDelta: a && i ? +Math.abs(a.top - i.top).toFixed(2) : null,
      activeGreater: a && i ? a.height > i.height : null,
      footFlush: a && m.mainTop !== null ? +Math.abs(m.mainTop - a.bottom).toFixed(2) : null };
  }
  const cur = await aligned();
  console.log(`[S5] current(topDelta=${cur.topDelta} activeGreater=${cur.activeGreater} footFlush=${cur.footFlush})`);
  check('S5 oracle current: topDelta <= 0.5 (would PASS on fixed CSS)', cur.topDelta !== null && cur.topDelta <= 0.5, `topDelta=${cur.topDelta}`);
  check('S5 oracle current: foot flush <= 1 (would PASS on fixed CSS)', cur.footFlush !== null && cur.footFlush <= 1, `footFlush=${cur.footFlush}`);

  // Revert the three TFL-524 declarations to the PRE-FIX values in-page only.
  await win.addStyleTag({ content: `
    .tab-area[data-tab-style="colorful"] .tab-list { align-items: center !important; }
    .tab-area[data-tab-style="colorful"] .tab-list > li[data-tab-active="true"] { align-self: flex-end !important; }
    .tab-area[data-tab-style="colorful"] .tab-active { height: 30px !important; }
  ` });
  await win.waitForTimeout(400);
  const pre = await aligned();
  console.log(`[S5] pre-fix(topDelta=${pre.topDelta} activeGreater=${pre.activeGreater} footFlush=${pre.footFlush}) aTop=${pre.a && pre.a.top} iTop=${pre.i && pre.i.top} aH=${pre.a && pre.a.height}`);
  check('S5 oracle discriminates: pre-fix CSS makes topDelta > 0.5 (oracle would FAIL)', pre.topDelta !== null && pre.topDelta > 0.5, `topDelta=${pre.topDelta}`);
  check('S5 oracle weakness: activeGreater still true on pre-fix CSS (weak assertion, not discriminating)', pre.activeGreater === true, `activeGreater=${pre.activeGreater}`);
  await hardClose(app, 's5');
}

// ---------------------------------------------------------------------------
async function surface6_standard_and_close(app, win) {
  console.log('\n=== S6 standard style + close-button hit-test ===');
  await openFirst(app, win);
  await openBundled(app, win, 'long.pdf');
  await win.waitForFunction(() => document.querySelectorAll('[data-tab-id]').length >= 2, null, { timeout: 30000 });
  await win.waitForTimeout(500);

  // Close-button hit test on the full-height colorful active tab.
  let m = await measure(win);
  const active = m.tabs.find((t) => t.active);
  const close = await win.evaluate((id) => {
    const el = document.querySelector(`[data-tab-id="${id}"]`);
    const btn = el && el.querySelector('.tab-close');
    if (!btn) return null;
    const b = btn.getBoundingClientRect();
    return { top: +b.top.toFixed(2), bottom: +b.bottom.toFixed(2), height: +b.height.toFixed(2), left: +b.left.toFixed(2), width: +b.width.toFixed(2) };
  }, active.id);
  console.log(`[S6] colorful active=${JSON.stringify({ top: active.top, bottom: active.bottom, height: active.height })} close=${JSON.stringify(close)}`);
  check('S6 colorful: close button inside the full-height active tab', close && close.top >= active.top - 0.5 && close.bottom <= active.bottom + 0.5, JSON.stringify(close));
  if (close) {
    const hit = await hitTest(win, close.left + close.width / 2, close.top + close.height / 2);
    console.log(`[S6] close hit-test -> ${JSON.stringify(hit)}`);
    check('S6 colorful: close button hit-testable at its centre', hit.isClose === true, JSON.stringify(hit));
  }
  const beforeCount = m.count;
  await win.locator(`[data-tab-id="${active.id}"] .tab-close`).click();
  await win.waitForTimeout(600);
  m = await measure(win);
  check('S6 colorful: clicking close closes the tab (silence attack)', m.count === beforeCount - 1, `${beforeCount} -> ${m.count}`);

  // Switch to standard and verify unchanged geometry.
  await win.locator('[data-open-preferences]').first().click();
  await win.waitForSelector('[data-prefs-tab-style]', { state: 'visible', timeout: 10000 });
  await win.locator('[data-prefs-tab-style]').selectOption('standard');
  await win.waitForTimeout(600);
  await win.locator('[data-prefs-dialog] .sheet-close').first().click().catch(() => {});
  await win.waitForTimeout(500);
  m = await measure(win);
  console.log(`[S6] standard style=${m.style} tabs=${JSON.stringify(m.tabs)}`);
  check('S6 standard: style is standard', m.style === 'standard', m.style);
  check('S6 standard: every tab is 34px', m.tabs.every((t) => Math.abs(t.height - 34) <= 0.5), JSON.stringify(m.tabs.map((t) => t.height)));
  const tops = m.tabs.map((t) => t.top);
  check('S6 standard: equal tops', Math.max(...tops) - Math.min(...tops) <= 0.5, JSON.stringify(tops));
  check('S6 standard: active not taller than inactive (unchanged contract)', m.tabs.every((t) => Math.abs(t.height - 34) <= 0.5), JSON.stringify(m.tabs.map((t) => `${t.active ? 'A' : 'i'}${t.height}`)));
  await win.screenshot({ path: path.join(OUT, 's6-standard.png') }).catch(() => {});
  await hardClose(app, 's6');
}

// ---------------------------------------------------------------------------
(async () => {
  const sections = [surface1_drag, surface2_plus, surface3_overflow, surface4_multimode, surface5_oracle, surface6_standard_and_close];
  for (const fn of sections) {
    try {
      const { app, win } = await launch(fn.name);
      await fn(app, win);
    } catch (e) {
      check(`${fn.name} completed`, false, `threw: ${e && e.message}`);
      console.log(e && e.stack ? e.stack : '');
    }
  }
  const failed = results.filter((r) => !r.pass);
  console.log(`\n=== SUMMARY: ${results.length - failed.length}/${results.length} PASS, ${failed.length} FAIL ===`);
  for (const f of failed) console.log(`FAIL | ${f.name} | ${f.detail}`);
  fs.writeFileSync(path.join(OUT, 'probe-results.json'), JSON.stringify(results, null, 2));
  process.exit(failed.length === 0 ? 0 : 1);
})();
