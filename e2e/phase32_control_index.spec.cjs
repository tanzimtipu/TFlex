// Phase 32 — Multi Mode CONTROL-INDEX sweep (section D of the gate task).
//
// Every control the phase introduces is exercised and its PROMISED observable
// effect asserted. A control whose interaction changes nothing observable is
// a NO-OP defect; each assertion below is a DOM/geometry change, never a
// "click completed" check.
//
//   [data-toolbar-multi-mode]      toggle (CommandBar)
//   [data-tool-id="multi-mode"]    toggle (All tools)
//   [data-pane] / [data-pane-focused] / [data-pane-header] / [data-pane-clear]
//   [data-pane-empty] / [data-pane-pick] / [data-pane-open]
//   [data-multi-divider] / [data-multi-panes]
//   [data-pane-strip] + -doc/-pane/-header/-drop-target (Phase 33 per-pane strips)
//   dynamic thumb width (126 single, 89 dual)
//   [data-page-drag-handle] / [data-drop-indicator] / [data-drop-copy]
//   .document-scroller[data-page-drop-pane] / .thumb-drop-target/-dragging/-copy
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const FIX = path.resolve(__dirname, '..', 'test-fixtures');
const ALPHA_SRC = path.join(FIX, 'report.pdf');
const BETA_SRC = path.join(FIX, 'long.pdf');
const TMP = path.join(os.tmpdir(), 'tflex-p32');

let electronApp = null;
let win = null;

function tmpCopy(src, name) {
  fs.mkdirSync(TMP, { recursive: true });
  const dst = path.join(TMP, `${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
  fs.copyFileSync(src, dst);
  return dst;
}
async function mockOpen(p) {
  await electronApp.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
}
async function openFile(p) {
  await mockOpen(p);
  await win.locator('[data-toolbar-open]').first().click();
  await win.waitForTimeout(900);
}
async function waitTabCount(n) {
  await expect(win.locator('.tab[data-tab-id]')).toHaveCount(n, { timeout: 30000 });
}
async function state() {
  return win.evaluate(() => {
    const stage = document.querySelector('.tab-stage');
    const widthOf = (sel) => {
      const el = document.querySelector(sel);
      return el ? Math.round(el.getBoundingClientRect().width) : null;
    };
    const thumbW = (rootSel) => {
      const el = document.querySelector(`${rootSel} .thumb-canvas-wrap`);
      return el ? Math.round(el.getBoundingClientRect().width) : null;
    };
    return {
      multi: stage ? stage.getAttribute('data-multi-mode') : null,
      multiPanes: stage ? stage.getAttribute('data-multi-panes') : null,
      paneCount: document.querySelectorAll('.tab-pane[data-pane]').length,
      paneA: !!document.querySelector('.tab-pane[data-pane="A"]'),
      paneB: !!document.querySelector('.tab-pane[data-pane="B"]'),
      paneBEmpty: !!document.querySelector('.tab-pane[data-pane="B"][data-pane-empty]'),
      focused: document.querySelector('.tab-pane[data-pane-focused="true"]')
        ? document.querySelector('.tab-pane[data-pane-focused="true"]').getAttribute('data-pane')
        : null,
      headers: document.querySelectorAll('[data-pane-header]').length,
      divider: !!document.querySelector('[data-multi-divider]'),
      // Phase 33 — the shared rail is retired: each pane now renders its own
      // thumbnail strip ([data-pane-strip]). The focused pane's strip header
      // carries the accent tint, so "active" is read from the computed
      // background (the retired [data-rail-section-active] attribute is gone).
      paneStrips: document.querySelectorAll('[data-pane-strip]').length,
      railActivePane: (() => {
        const strips = Array.from(document.querySelectorAll('[data-pane-strip-pane]'));
        const active = strips.find((s) => {
          const h = s.querySelector('[data-pane-strip-header]');
          if (h === null) return false;
          const bg = getComputedStyle(h).backgroundColor;
          return bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent';
        });
        return active ? active.getAttribute('data-pane-strip-pane') : null;
      })(),
      paneAWidth: widthOf('.tab-pane[data-pane="A"]'),
      paneBWidth: widthOf('.tab-pane[data-pane="B"]'),
      singleRailThumbW: thumbW('.side-rail'),
      multiThumbA: thumbW('[data-pane-strip-pane="A"]'),
      dragHandles: document.querySelectorAll('[data-page-drag-handle]').length,
      cmdPressed: document.querySelector('[data-toolbar-multi-mode]')
        ? document.querySelector('[data-toolbar-multi-mode]').getAttribute('aria-pressed')
        : null,
    };
  });
}
async function allToolsPressed() {
  const el = await win.locator('[data-tool-id="multi-mode"]').count();
  if (el === 0) return null;
  return win.locator('[data-tool-id="multi-mode"]').getAttribute('aria-pressed');
}

test.beforeEach(async () => {
  electronApp = await launchApp();
  win = await electronApp.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  await win.waitForTimeout(300);
});
test.afterEach(async () => {
  if (electronApp) await hardClose(electronApp);
  electronApp = null;
  win = null;
});
test.setTimeout(240000);

test('CONTROL-INDEX: every Multi Mode control has its promised observable effect', async () => {
  await openFile(tmpCopy(ALPHA_SRC, 'p32-alpha.pdf'));
  await waitTabCount(1);
  // Amended Phase 32 semantics (DEF-277): a title-bar Open while the mode is on
  // assigns the document to the FOCUSED pane. Open BOTH documents in single
  // mode, then make alpha active before enabling the mode, so pane A is seeded
  // with alpha and beta stays available in pane B's pick list.
  await openFile(tmpCopy(BETA_SRC, 'p32-beta.pdf'));
  await waitTabCount(2);
  await win.locator('.tab[data-tab-id]').filter({ hasText: 'p32-alpha' }).first().click();
  await win.waitForTimeout(300);
  await win.waitForTimeout(600);

  const s0 = await state();
  console.log(`[P32-ci] single mode: ${JSON.stringify(s0)}`);
  expect(s0.multi).toBe('false');
  expect(s0.paneCount).toBe(0);
  expect(s0.divider).toBe(false);
  expect(s0.paneStrips).toBe(0);
  expect(s0.singleRailThumbW).toBe(126); // single-mode thumb width
  expect(s0.dragHandles).toBe(0); // canvas drag is Multi-Mode-only

  // --- [data-toolbar-multi-mode]: ON (pane A seeded, B empty) ---
  await win.locator('[data-toolbar-multi-mode]').first().click();
  await win.waitForTimeout(500);
  const s1 = await state();
  console.log(`[P32-ci] after CommandBar ON: ${JSON.stringify(s1)}`);
  expect(s1.multi).toBe('true');
  expect(s1.multiPanes).toBe('1');
  expect(s1.paneA).toBe(true);
  expect(s1.paneBEmpty).toBe(true);
  expect(s1.headers).toBe(1);
  expect(s1.divider).toBe(true);
  expect(s1.paneStrips).toBe(1);
  expect(s1.multiThumbA).toBe(126); // one document in Multi Mode -> 126
  expect(s1.focused).toBe('A');
  expect(s1.railActivePane).toBe('A');
  expect(s1.cmdPressed).toBe('true');
  expect(s1.dragHandles).toBeGreaterThan(0); // canvas grip exists in Multi Mode
  // All tools entry agrees.
  await win.locator('[data-tools-badge]').first().click();
  await win.waitForSelector('[data-tool-id="multi-mode"]', { timeout: 10000 });
  expect(await allToolsPressed()).toBe('true');
  await win.locator('.tools-palette-close').click();
  await win.waitForSelector('[data-tools-palette]', { state: 'detached', timeout: 10000 });

  // --- [data-pane-pick] fills pane B; [data-multi-panes] -> 2 ---
  await expect(win.locator('.tab-pane[data-pane="B"][data-pane-empty]')).toBeVisible({ timeout: 15000 });
  await win.locator('.tab-pane[data-pane="B"] [data-pane-pick]').filter({ hasText: 'p32-beta' }).first().click();
  await win.waitForTimeout(1300);
  const s2 = await state();
  console.log(`[P32-ci] after pick into B: ${JSON.stringify(s2)}`);
  expect(s2.multiPanes).toBe('2');
  expect(s2.paneBEmpty).toBe(false);
  expect(s2.headers).toBe(2);
  expect(s2.paneStrips).toBe(2);
  expect(s2.multiThumbA).toBe(89); // two documents -> 89 (dynamic width)

  // --- [data-pane-strip-header] focuses its pane ---
  await win.locator('.multi-pane-header[data-pane="A"]').click();
  await win.waitForTimeout(350);
  expect((await state()).focused).toBe('A');
  await win.locator('[data-pane-strip-pane="B"] [data-pane-strip-header]').click();
  await win.waitForTimeout(350);
  const s3 = await state();
  console.log(`[P32-ci] after rail-section-B header click: focused=${s3.focused} railActive=${s3.railActivePane}`);
  expect(s3.focused).toBe('B');
  expect(s3.railActivePane).toBe('B');

  // --- [data-multi-divider] resizes the panes ---
  const before = await state();
  const dbox = await win.locator('[data-multi-divider]').boundingBox();
  await win.mouse.move(dbox.x + dbox.width / 2, dbox.y + dbox.height / 2);
  await win.mouse.down();
  await win.mouse.move(dbox.x + dbox.width / 2 - 180, dbox.y + dbox.height / 2, { steps: 6 });
  await win.mouse.up();
  await win.waitForTimeout(400);
  const after = await state();
  console.log(`[P32-ci] divider: paneA ${before.paneAWidth}->${after.paneAWidth} paneB ${before.paneBWidth}->${after.paneBWidth}`);
  expect(Math.abs(after.paneAWidth - before.paneAWidth)).toBeGreaterThan(50);
  expect(Math.abs(after.paneBWidth - before.paneBWidth)).toBeGreaterThan(50);
  // Panes are adjacent (no overlap / gap beyond the 8px divider).
  const gap = after.paneAWidth + after.paneBWidth;
  const stageW = await win.evaluate(() => {
    const st = document.querySelector('.tab-stage');
    return st ? Math.round(st.getBoundingClientRect().width) : 0;
  });
  console.log(`[P32-ci] pane widths sum=${gap} stage=${stageW} (divider only - Phase 33 retired the shared rail)`);
  // Phase 33 supersession: the shared 220px rail column is retired (each pane
  // now carries its own strip INSIDE its DocumentView), so in Multi Mode the
  // panes are adjacent with ONLY the 8px divider between them. Assert the stage
  // is exactly filled by the two panes plus the divider (allowing +/-1px
  // rounding on each pane width) - a reserved rail gap would now be the bug.
  expect(stageW - gap).toBeGreaterThanOrEqual(6);
  expect(stageW - gap).toBeLessThanOrEqual(10);

  // --- [data-pane-clear] empties pane B, rail section goes, width back to 126 ---
  await win.locator('.tab-pane[data-pane="B"] [data-pane-clear]').click();
  // Wait for the settled promise (one filled pane) rather than a fixed delay:
  // under load the React transition can be sampled mid-flight.
  await expect(win.locator('.tab-stage')).toHaveAttribute('data-multi-panes', '1', { timeout: 10000 });
  const s4 = await state();
  console.log(`[P32-ci] after clear pane B: ${JSON.stringify(s4)}`);
  expect(s4.paneBEmpty).toBe(true);
  expect(s4.multiPanes).toBe('1');
  expect(s4.paneStrips).toBe(1);
  expect(s4.multiThumbA).toBe(126);
  expect(await win.locator('.tab-pane[data-pane="B"] canvas.pdf-page-canvas').count()).toBe(0);

  // --- [data-pane-open] loads a PDF straight into the empty pane ---
  await mockOpen(tmpCopy(BETA_SRC, 'p32-beta2.pdf'));
  await win.locator('.tab-pane[data-pane="B"] [data-pane-open]').click();
  // Phase 34 — Multi Mode shows ONE composite tab, not one per document. The
  // observable effect is pane B filling; assert that AND that the strip stays
  // a single composite tab (the tab count no longer grows per open).
  await expect(win.locator('.tab-pane[data-pane="B"] canvas.pdf-page-canvas').first()).toBeVisible({ timeout: 30000 });
  await expect(win.locator('.tab-stage')).toHaveAttribute('data-multi-panes', '2', { timeout: 10000 });
  await win.waitForTimeout(1300);
  expect(await win.locator('.tab[data-tab-id]').count()).toBe(1);
  const s5 = await state();
  console.log(`[P32-ci] after pane-open: ${JSON.stringify(s5)}`);
  expect(s5.paneBEmpty).toBe(false);
  expect(s5.multiPanes).toBe('2');
  expect(s5.paneStrips).toBe(2);

  // --- [data-tool-id="multi-mode"]: OFF (All tools) ---
  await win.locator('[data-tools-badge]').last().click({ force: true });
  await win.waitForSelector('[data-tool-id="multi-mode"]', { timeout: 10000 });
  expect(await allToolsPressed()).toBe('true');
  await win.locator('[data-tool-id="multi-mode"]').click();
  await win.waitForTimeout(600);
  const s6 = await state();
  console.log(`[P32-ci] after All tools OFF: ${JSON.stringify(s6)}`);
  expect(s6.multi).toBe('false');
  expect(s6.paneCount).toBe(0);
  expect(s6.headers).toBe(0);
  expect(s6.divider).toBe(false);
  expect(s6.paneStrips).toBe(0);
  expect(s6.dragHandles).toBe(0);
  expect(s6.singleRailThumbW).toBe(126);
});
