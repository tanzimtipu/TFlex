// QA retest of the five Phase-34 FIX-READY defects DEF-286..DEF-290.
//
// Each test asserts the FIXED behaviour and logs the raw measurements so the
// DEFECTS.md History line can carry them. Launches only through the canonical
// launchApp helper. No screenshots unless a failure needs one.
const { test, expect } = require('@playwright/test');
const { launchApp } = require('../lib/launch.cjs');
const { hardClose } = require('../lib/helpers.cjs');
const { twoPaneSetup } = require('../lib/p33_common.cjs');

let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (app) await hardClose(app, 'def286-290');
  app = null;
  win = null;
});
test.setTimeout(300000);

async function setSize(w, h) {
  await app.evaluate(({ BrowserWindow }, size) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (bw) {
      if (bw.isMaximized()) bw.unmaximize();
      bw.setSize(size.w, size.h);
    }
  }, { w, h });
  await win.waitForTimeout(900);
}

async function openPanel() {
  await win.locator('[data-tools-badge]').first().click();
  await win.waitForSelector('[data-tools-palette]', { timeout: 10000 });
  await win.waitForTimeout(900);
}
async function closePanel() {
  await win.locator('.tools-palette-close').first().click();
  await win.waitForSelector('[data-tools-palette]', { state: 'detached', timeout: 10000 });
  await win.waitForTimeout(900);
}

// Drag the divider so the stage fraction lands on `frac` (panel closed).
async function dragDividerTo(frac) {
  const box = await win.locator('[data-multi-divider]').boundingBox();
  const stage = await win.locator('.tab-stage').boundingBox();
  if (!box || !stage) throw new Error('dragDividerTo: no divider/stage box');
  const targetX = stage.x + stage.width * frac;
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await win.mouse.down();
  await win.mouse.move(targetX, box.y + box.height / 2, { steps: 12 });
  await win.mouse.up();
  await win.waitForTimeout(500);
}

// Full geometry snapshot: stage, panes, page areas, strips, scrollers, divider.
async function geom() {
  return win.evaluate(() => {
    const r = (sel) => {
      const el = document.querySelector(sel);
      if (el === null) return null;
      const b = el.getBoundingClientRect();
      return {
        left: Math.round(b.left), right: Math.round(b.right),
        top: Math.round(b.top), bottom: Math.round(b.bottom),
        w: Math.round(b.width), h: Math.round(b.height),
      };
    };
    const st = document.querySelector('.tab-stage');
    const am = document.querySelector('.app-main');
    return {
      stage: r('.tab-stage'),
      divider: r('[data-multi-divider]'),
      panel: r('[data-tools-palette]'),
      paneA: r('.tab-pane[data-pane="A"]'),
      paneB: r('.tab-pane[data-pane="B"]'),
      mainA: r('.tab-pane[data-pane="A"] .workspace-main'),
      mainB: r('.tab-pane[data-pane="B"] .workspace-main'),
      stripA: r('.tab-pane[data-pane="A"] .pane-thumb-strip'),
      stripB: r('.tab-pane[data-pane="B"] .pane-thumb-strip'),
      scA: r('.tab-pane[data-pane="A"] .document-scroller'),
      scB: r('.tab-pane[data-pane="B"] .document-scroller'),
      inset: am ? getComputedStyle(am).getPropertyValue('--tf-tools-inset').trim() : null,
      frac: st ? getComputedStyle(st).getPropertyValue('--tf-split-frac').trim() : null,
    };
  });
}

// ---------------------------------------------------------------------------
// DEF-286 — the All Tools panel shrinks BOTH panes by the SAME amount at every
// split (inset/2 = 172px with the 344px list panel), divider stays centred.
// ---------------------------------------------------------------------------
test('DEF-286 equal panel shrink at 0.35 / 0.5 / 0.65 and pre-Phase-34 closed geometry', async () => {
  await setSize(1440, 900);
  await twoPaneSetup(app, win);
  await setSize(1440, 900);

  for (const f of [0.35, 0.5, 0.65]) {
    await dragDividerTo(f);
    const before = await geom();
    await openPanel();
    const after = await geom();
    const dPaneA = before.paneA.w - after.paneA.w;
    const dPaneB = before.paneB.w - after.paneB.w;
    const dMainA = before.mainA.w - after.mainA.w;
    const dMainB = before.mainB.w - after.mainB.w;
    console.log(`[DEF-286] frac req=${f} actual=${after.frac} inset=${after.inset}`);
    console.log(`[DEF-286]   paneA ${before.paneA.w}->${after.paneA.w} (d ${dPaneA}); paneB ${before.paneB.w}->${after.paneB.w} (d ${dPaneB}); |dPaneA-dPaneB|=${Math.abs(dPaneA - dPaneB)}`);
    console.log(`[DEF-286]   mainA ${before.mainA.w}->${after.mainA.w} (d ${dMainA}); mainB ${before.mainB.w}->${after.mainB.w} (d ${dMainB}); |dMainA-dMainB|=${Math.abs(dMainA - dMainB)}`);
    console.log(`[DEF-286]   divider=${JSON.stringify(after.divider)} paneA.right=${after.paneA.right} paneB.left=${after.paneB.left}`);

    // Equal shrink per split, and the expected 172px (344/2).
    expect(Math.abs(dPaneA - dPaneB), `pane deltas differ at ${f}: A=${dPaneA} B=${dPaneB}`).toBeLessThanOrEqual(1);
    expect(Math.abs(dMainA - dMainB), `page-area deltas differ at ${f}: A=${dMainA} B=${dMainB}`).toBeLessThanOrEqual(1);
    expect(Math.abs(dPaneA - 172), `pane A delta ${dPaneA} != 172 at ${f}`).toBeLessThanOrEqual(1);
    expect(Math.abs(dPaneB - 172), `pane B delta ${dPaneB} != 172 at ${f}`).toBeLessThanOrEqual(1);
    // Divider stays centred between the panes.
    expect(Math.abs(after.divider.left - after.paneA.right), `divider.left ${after.divider.left} != paneA.right ${after.paneA.right}`).toBeLessThanOrEqual(1);
    expect(Math.abs(after.divider.right - after.paneB.left), `divider.right ${after.divider.right} != paneB.left ${after.paneB.left}`).toBeLessThanOrEqual(1);
    await closePanel();
  }

  // Panel closed: geometry is the pre-Phase-34 arithmetic (no inset consumed).
  await dragDividerTo(0.35);
  const closed = await geom();
  const W = closed.stage.w;
  const expectedA = W * 0.35 - 4;
  const expectedB = W * 0.65 - 4;
  console.log(`[DEF-286] closed frac=${closed.frac} stageW=${W} paneA=${closed.paneA.w} (expect ~${Math.round(expectedA)}) paneB=${closed.paneB.w} (expect ~${Math.round(expectedB)}) inset=${closed.inset}`);
  expect(Math.abs(closed.paneA.w - expectedA), `closed paneA ${closed.paneA.w} != ${expectedA}`).toBeLessThanOrEqual(2);
  expect(Math.abs(closed.paneB.w - expectedB), `closed paneB ${closed.paneB.w} != ${expectedB}`).toBeLessThanOrEqual(2);
  expect(closed.paneA.w + closed.paneB.w + closed.divider.w, 'closed panes + divider != stage width').toBeGreaterThanOrEqual(W - 2);
  expect(closed.paneA.w + closed.paneB.w + closed.divider.w, 'closed panes + divider != stage width').toBeLessThanOrEqual(W + 2);
});

// ---------------------------------------------------------------------------
// DEF-287 — at 640x520 with the panel open both page areas stay >= 44px and
// both strips shrink to their 100px minimum; a carried fraction re-clamps.
// ---------------------------------------------------------------------------
test('DEF-287 page areas never collapse at 640x520 with the panel open (incl. carried fraction)', async () => {
  await twoPaneSetup(app, win);
  await setSize(640, 520);
  await openPanel();
  const g = await geom();
  console.log(`[DEF-287] 640x520 panel open: stageW=${g.stage.w} inset=${g.inset} frac=${g.frac}`);
  console.log(`[DEF-287]   paneA=${g.paneA.w} paneB=${g.paneB.w} mainA=${g.mainA.w} mainB=${g.mainB.w} stripA=${g.stripA.w} stripB=${g.stripB.w} scA=${g.scA.w} scB=${g.scB.w}`);
  console.log(`[DEF-287]   divider=${JSON.stringify(g.divider)} panel=${JSON.stringify(g.panel)}`);
  expect(g.mainA.w, 'pane A page area collapsed').toBeGreaterThanOrEqual(44);
  expect(g.mainB.w, 'pane B page area collapsed').toBeGreaterThanOrEqual(44);
  expect(Math.abs(g.stripA.w - 100), `pane A strip ${g.stripA.w} != 100`).toBeLessThanOrEqual(1);
  expect(Math.abs(g.stripB.w - 100), `pane B strip ${g.stripB.w} != 100`).toBeLessThanOrEqual(1);

  // Carried-fraction case: extreme split at a wide window, then narrow to 640
  // with the panel open. The stored fraction must RE-CLAMP without a drag.
  await closePanel();
  await setSize(1440, 900);
  await dragDividerTo(0.35);
  await openPanel();
  const wide = await geom();
  console.log(`[DEF-287] carried: wide frac=${wide.frac} inset=${wide.inset}`);
  await setSize(640, 520);
  const carried = await geom();
  console.log(`[DEF-287] carried: 640 frac=${carried.frac} mainA=${carried.mainA.w} mainB=${carried.mainB.w} stripA=${carried.stripA.w} stripB=${carried.stripB.w}`);
  expect(Number(carried.frac), `stored fraction ${carried.frac} did not re-clamp`).toBeGreaterThanOrEqual(0.49);
  expect(Number(carried.frac), `stored fraction ${carried.frac} did not re-clamp`).toBeLessThanOrEqual(0.51);
  expect(carried.mainA.w, 'carried: pane A page area collapsed').toBeGreaterThanOrEqual(44);
  expect(carried.mainB.w, 'carried: pane B page area collapsed').toBeGreaterThanOrEqual(44);
  expect(Math.abs(carried.stripA.w - 100), `carried: pane A strip ${carried.stripA.w} != 100`).toBeLessThanOrEqual(1);
  expect(Math.abs(carried.stripB.w - 100), `carried: pane B strip ${carried.stripB.w} != 100`).toBeLessThanOrEqual(1);
});

// ---------------------------------------------------------------------------
// DEF-288 — "+" is disabled with its reason in Multi Mode (no hidden tab);
// enabled and unchanged in single mode.
// ---------------------------------------------------------------------------
async function tabSnap() {
  return win.evaluate(() => {
    const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : null);
    const tabs = Array.from(document.querySelectorAll('.tab[data-tab-id]')).map((t) => ({
      id: t.getAttribute('data-tab-id'), label: txt(t.querySelector('.tab-title')),
      sel: t.getAttribute('aria-selected'),
    }));
    const d = window.tflexDiagnostics ? window.tflexDiagnostics() : null;
    return {
      tabs, multi: document.querySelector('.tab-stage')?.getAttribute('data-multi-mode') ?? null,
      diagOpenTabs: d ? d.openTabs : null, activeTabId: d ? d.activeTabId : null,
      welcome: !!document.querySelector('.sample-card'),
    };
  });
}

test('DEF-288 "+" disabled with reason in Multi Mode, unchanged in single mode', async () => {
  await twoPaneSetup(app, win);
  const btn = win.locator('[data-new-tab]');
  expect(await btn.count(), 'no [data-new-tab] in Multi Mode').toBe(1);
  expect(await btn.isDisabled(), 'Multi Mode "+" is not disabled').toBe(true);
  const title = await btn.getAttribute('title');
  const aria = await btn.getAttribute('aria-label');
  console.log(`[DEF-288] multi: disabled=${await btn.isDisabled()} title="${title}" aria="${aria}"`);
  expect(title, 'reason not on title').toContain('Turn off Multi Mode');
  expect(aria, 'reason not on aria-label').toContain('Turn off Multi Mode');

  const before = await tabSnap();
  await btn.dispatchEvent('click');
  await win.waitForTimeout(700);
  const after = await tabSnap();
  console.log(`[DEF-288] multi click: tabs ${before.tabs.length}->${after.tabs.length} diagOpenTabs ${before.diagOpenTabs}->${after.diagOpenTabs} active ${before.activeTabId}->${after.activeTabId}`);
  expect(after.tabs.length, 'tab count changed on a disabled "+" click').toBe(before.tabs.length);
  expect(after.diagOpenTabs, 'hidden tab created on a disabled "+" click').toBe(before.diagOpenTabs);
  expect(after.activeTabId, 'active tab changed on a disabled "+" click').toBe(before.activeTabId);

  // Single mode: enabled and behaves exactly as before.
  await win.locator('[data-shared-toolbar] [data-toolbar-multi-mode]').first().click();
  await win.waitForTimeout(800);
  const btn2 = win.locator('[data-new-tab]');
  expect(await btn2.isDisabled(), 'single-mode "+" is disabled').toBe(false);
  const t0 = await win.locator('.tab[data-tab-id]').count();
  await btn2.click();
  await win.waitForTimeout(700);
  const t1 = await win.locator('.tab[data-tab-id]').count();
  const activeLabel = await win.locator('.tab[data-tab-id][aria-selected="true"] .tab-title').innerText();
  console.log(`[DEF-288] single click: tabs ${t0}->${t1} active="${activeLabel}"`);
  expect(t1, 'single-mode "+" did not add a tab').toBe(t0 + 1);
  expect(activeLabel).toContain('Empty tab');
});

// ---------------------------------------------------------------------------
// DEF-289 — the composite X with both panes empty leaves the workspace.
// ---------------------------------------------------------------------------
test('DEF-289 composite close with both panes empty leaves Multi Mode', async () => {
  await twoPaneSetup(app, win);
  await win.locator('.tab-pane[data-pane="B"] [data-pane-clear]').click();
  await win.waitForTimeout(600);
  await win.locator('.tab-pane[data-pane="A"] [data-pane-clear]').click();
  await win.waitForTimeout(600);
  const s0 = await tabSnap();
  const panes0 = await win.evaluate(() => Array.from(document.querySelectorAll('.tab-pane[data-pane]')).map((p) => ({ pane: p.getAttribute('data-pane'), empty: p.hasAttribute('data-pane-empty') })));
  console.log(`[DEF-289] before X: tabs=${s0.tabs.length} multi=${s0.multi} panes=${JSON.stringify(panes0)} welcome=${s0.welcome}`);
  expect(s0.multi).toBe('true');
  expect(panes0.every((p) => p.empty), 'a pane is not empty').toBe(true);

  await win.locator('.tab[data-tab-id="tf-multi-workspace"] .tab-close').click();
  await win.waitForTimeout(1000);
  const s1 = await tabSnap();
  const domActive = await win.evaluate(() => {
    const sel = document.querySelector('.tab[data-tab-id][aria-selected="true"]');
    return sel ? sel.getAttribute('data-tab-id') : null;
  });
  console.log(`[DEF-289] after X: tabs=${s1.tabs.length} multi=${s1.multi} active=${s1.activeTabId} domActive=${domActive} welcome=${s1.welcome}`);
  console.log(`[DEF-289] after X tabs=${JSON.stringify(s1.tabs)}`);
  const vis = await win.evaluate(() => ({
    visiblePanes: document.querySelectorAll('.tab-pane[aria-hidden="false"]').length,
    hiddenPanes: document.querySelectorAll('.tab-pane[aria-hidden="true"]').length,
    visibleScrollers: Array.from(document.querySelectorAll('.document-scroller')).filter((el) => el.getBoundingClientRect().width > 0).length,
    welcome: !!document.querySelector('.sample-card'),
    stageChildren: document.querySelector('.tab-stage') ? document.querySelector('.tab-stage').children.length : null,
  }));
  console.log(`[DEF-289] after X visible state=${JSON.stringify(vis)}`);
  expect(s1.multi, 'composite X did not leave Multi Mode').toBe('false');
  expect(s1.welcome || s1.tabs.length >= 1, 'composite X left neither tabs nor the welcome screen').toBe(true);
  expect(s1.tabs.length, 'the two unpaned documents should remain as tabs').toBe(2);
  // The remaining tabs must be active (one selected) - the workspace is left,
  // not a silent no-op.
  expect(domActive, 'no tab is selected after the composite close').not.toBeNull();
});

// Control for DEF-289: the shared toolbar's Multi Mode toggle DOES restore an
// active tab when it leaves the mode with both panes empty (App.tsx:6850-6866),
// so the blank workspace is specific to the composite close path.
test('DEF-289 control: the toolbar toggle restores an active tab with both panes empty', async () => {
  await twoPaneSetup(app, win);
  await win.locator('.tab-pane[data-pane="B"] [data-pane-clear]').click();
  await win.waitForTimeout(600);
  await win.locator('.tab-pane[data-pane="A"] [data-pane-clear]').click();
  await win.waitForTimeout(600);
  await win.locator('[data-shared-toolbar] [data-toolbar-multi-mode]').first().click();
  await win.waitForTimeout(1000);
  const domActive = await win.evaluate(() => {
    const sel = document.querySelector('.tab[data-tab-id][aria-selected="true"]');
    return sel ? sel.getAttribute('data-tab-id') : null;
  });
  const vis = await win.evaluate(() => ({
    multi: document.querySelector('.tab-stage')?.getAttribute('data-multi-mode') ?? null,
    visiblePanes: document.querySelectorAll('.tab-pane[aria-hidden="false"]').length,
    tabs: document.querySelectorAll('.tab[data-tab-id]').length,
  }));
  console.log(`[DEF-289-control] toolbar toggle: domActive=${domActive} state=${JSON.stringify(vis)}`);
  expect(vis.multi).toBe('false');
  expect(domActive, 'toolbar toggle did not restore an active tab').not.toBeNull();
  expect(vis.visiblePanes, 'toolbar toggle left no visible pane').toBeGreaterThanOrEqual(1);
});

// DEF-289 no-tabs-left case: close the underlying document FIRST (Ctrl+W
// while it is the active tab in pane A). The tabs reducer's `reconcile`
// auto-disables Multi Mode when the last tab closes (multiMode.ts:188-193),
// so the welcome screen shows and the composite X is no longer present.
test('DEF-289 no-tabs-left: closing the underlying document first shows the welcome screen', async () => {
  const { openFile, tmpCopy, REPORT } = require('../lib/p33_common.cjs');
  const soloPath = tmpCopy(REPORT, 'p33-solo.pdf');
  await openFile(app, win, soloPath);
  await win.waitForTimeout(900);
  await win.locator('[data-toolbar-multi-mode]').first().click();
  await win.waitForTimeout(700);
  const sMid = await tabSnap();
  console.log(`[DEF-289-notabs] multi on: tabs=${sMid.tabs.length} multi=${sMid.multi} active=${sMid.activeTabId}`);
  expect(sMid.multi).toBe('true');
  await win.keyboard.press('Control+w');
  await win.waitForTimeout(1000);
  const s1 = await tabSnap();
  const vis = await win.evaluate(() => ({
    visiblePanes: document.querySelectorAll('.tab-pane[aria-hidden="false"]').length,
    welcome: !!document.querySelector('.sample-card'),
    composite: !!document.querySelector('.tab[data-tab-id="tf-multi-workspace"]'),
  }));
  console.log(`[DEF-289-notabs] after close: tabs=${s1.tabs.length} multi=${s1.multi} active=${s1.activeTabId} welcome=${s1.welcome} vis=${JSON.stringify(vis)}`);
  expect(s1.tabs.length, 'the underlying document was not closed').toBe(0);
  expect(s1.welcome, 'welcome screen not shown with no tabs left').toBe(true);
});

// DEF-289 no-tabs-left via the composite close: with the only document in
// pane A, the composite close closes it and leaves Multi Mode -> welcome.
test('DEF-289 no-tabs-left via composite close: the only document closes and the welcome screen shows', async () => {
  const { openFile, tmpCopy, REPORT } = require('../lib/p33_common.cjs');
  const soloPath = tmpCopy(REPORT, 'p33-solo2.pdf');
  await openFile(app, win, soloPath);
  await win.waitForTimeout(900);
  await win.locator('[data-toolbar-multi-mode]').first().click();
  await win.waitForTimeout(700);
  const s0 = await tabSnap();
  console.log(`[DEF-289-notabs2] before X: tabs=${s0.tabs.length} multi=${s0.multi} active=${s0.activeTabId}`);
  expect(s0.multi).toBe('true');
  await win.locator('.tab[data-tab-id="tf-multi-workspace"] .tab-close').click();
  await win.waitForTimeout(1200);
  const s1 = await tabSnap();
  const vis = await win.evaluate(() => ({
    visiblePanes: document.querySelectorAll('.tab-pane[aria-hidden="false"]').length,
    welcome: !!document.querySelector('.sample-card'),
  }));
  console.log(`[DEF-289-notabs2] after X: tabs=${s1.tabs.length} multi=${s1.multi} active=${s1.activeTabId} welcome=${s1.welcome} vis=${JSON.stringify(vis)}`);
  expect(s1.multi, 'composite X did not leave Multi Mode').toBe('false');
  expect(s1.tabs.length, 'the only document was not closed').toBe(0);
  expect(s1.welcome, 'welcome screen not shown with no tabs left').toBe(true);
});

// ---------------------------------------------------------------------------
// DEF-290 — the first-page canvas insertion line is inside the scroller's
// visible box and spans the page column; non-first slots keep the gap offset.
// ---------------------------------------------------------------------------
async function synthStep(step, arg) {
  return win.evaluate(({ step: s, arg: a }) => {
    const KEY = '__def290dt';
    if (s === 'start') {
      const src = document.querySelector(a.src);
      if (!src) return { ok: false, reason: 'no-src' };
      const dt = new DataTransfer();
      window[KEY] = dt;
      src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
      return { ok: true };
    }
    const dt = window[KEY];
    if (!dt) return { ok: false, reason: 'no-dt' };
    if (s === 'over') {
      const tgt = document.querySelector(a.tgt);
      if (!tgt) return { ok: false, reason: 'no-tgt' };
      const r = tgt.getBoundingClientRect();
      const ev = new DragEvent('dragover', {
        bubbles: true, cancelable: true, dataTransfer: dt,
        clientX: r.left + r.width / 2, clientY: r.top + r.height * 0.25,
      });
      tgt.dispatchEvent(ev);
      return { ok: true, prevented: ev.defaultPrevented };
    }
    if (s === 'end') {
      const src = document.querySelector(a.src);
      if (src) src.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: dt }));
      delete window[KEY];
      return { ok: true };
    }
    return { ok: false, reason: 'bad-step' };
  }, { step, arg });
}

async function indicatorAt(page) {
  return win.evaluate((p) => {
    const r = (el) => {
      if (el === null) return null;
      const b = el.getBoundingClientRect();
      return { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) };
    };
    const sc = document.querySelector('.tab-pane[data-pane="B"] .document-scroller');
    const slot = document.querySelector(`.tab-pane[data-pane="B"] .page-slot[data-page="${p}"]`);
    const prev = document.querySelector(`.tab-pane[data-pane="B"] .page-slot[data-page="${p - 1}"]`);
    const ind = slot ? slot.querySelector('[data-drop-indicator]') : null;
    return {
      scroller: r(sc), slot: r(slot), prev: r(prev), indicator: r(ind),
      cls: ind ? ind.className : null,
      side: ind ? ind.getAttribute('data-drop-indicator') : null,
      page: ind ? Number(ind.getAttribute('data-drop-page')) : null,
    };
  }, page);
}

test('DEF-290 first-page insertion line is inside the scroller and spans the page column', async () => {
  await twoPaneSetup(app, win);
  await win.evaluate(() => {
    const sc = document.querySelector('.tab-pane[data-pane="B"] .document-scroller');
    if (sc) sc.scrollTop = 0;
  });
  await win.waitForTimeout(700);

  await synthStep('start', { src: '[data-pane-strip-pane="A"] .thumb-item[data-page="1"]' });
  await win.waitForTimeout(200);
  await synthStep('over', { tgt: '.tab-pane[data-pane="B"] .page-slot[data-page="1"]' });
  await win.waitForTimeout(500);
  const i1 = await indicatorAt(1);
  console.log(`[DEF-290] first page: ${JSON.stringify(i1)}`);
  expect(i1.side).toBe('before');
  expect(i1.page).toBe(1);
  expect(i1.cls, 'first-page line missing the -first variant').toContain('page-drop-indicator-first');
  expect(i1.indicator, 'no indicator rendered').not.toBeNull();
  // Inside the scroller's visible box (not clipped above it).
  expect(i1.indicator.top, `line top ${i1.indicator.top} above scroller top ${i1.scroller.top}`).toBeGreaterThanOrEqual(i1.scroller.top - 1);
  expect(i1.indicator.bottom, `line bottom ${i1.indicator.bottom} below scroller bottom ${i1.scroller.bottom}`).toBeLessThanOrEqual(i1.scroller.bottom + 1);
  // Anchored at the first slot's top edge.
  expect(i1.indicator.top, 'line not at the first slot top').toBeLessThanOrEqual(i1.slot.top + 1);
  // Spans the page column.
  expect(i1.indicator.w, `line width ${i1.indicator.w} vs page column ${i1.slot.w}`).toBeGreaterThanOrEqual(i1.slot.w - 2);
  expect(i1.indicator.w).toBeLessThanOrEqual(i1.slot.w + 2);

  // Non-first slot keeps the between-pages gap positioning.
  await synthStep('over', { tgt: '.tab-pane[data-pane="B"] .page-slot[data-page="3"]' });
  await win.waitForTimeout(400);
  const i3 = await indicatorAt(3);
  console.log(`[DEF-290] page 3: ${JSON.stringify(i3)}`);
  expect(i3.side).toBe('before');
  expect(i3.cls, 'non-first line wrongly carries the -first variant').not.toContain('page-drop-indicator-first');
  expect(i3.prev, 'page 2 slot present').not.toBeNull();
  expect(i3.indicator.top, 'line overlaps page 2 content').toBeGreaterThanOrEqual(i3.prev.bottom - 1);
  expect(i3.indicator.bottom, 'line overlaps page 3 content').toBeLessThanOrEqual(i3.slot.top + 1);

  await synthStep('end', { src: '[data-pane-strip-pane="A"] .thumb-item[data-page="1"]' });
  await win.waitForTimeout(500);
  const gone = await win.evaluate(() => document.querySelectorAll('[data-drop-indicator]').length);
  expect(gone, 'indicator did not clear on drag end').toBe(0);
});