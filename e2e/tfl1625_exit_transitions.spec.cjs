// TFL-1625 — focused QA for TFL-1620 exit transitions.
//
// The two compact DRAWER surfaces (Inspector, ContextPanel) are enter-only CSS
// animations. TFL-1620 added a `--leaving` modifier whose reverse keyframe plays
// over the MICRO band before the surface leaves the DOM. The unit suite pins the
// hook and the Inspector drawer; the ContextPanel drawer's leaving pose had NO
// automated coverage (CONTROL-INDEX claimed tfl1620_exitTransitions covered it —
// it does not). This spec proves the exit keyframe actually runs in the running
// Electron app for BOTH drawers.
//
// Oracle: the leaving pose lasts ~150 ms (MOTION_DURATION.micro), too short for a
// locator poll and easily coalesced by a MutationObserver. Sample the root class
// every animation frame for 400 ms across the close and assert the leaving class
// was observed, with the reverse keyframe + pinned pointer-events computed while
// it was applied.
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

delete process.env.ELECTRON_RUN_AS_NODE;

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const shotPath = (name) => path.join(SHOTS, name);

let app = null;
let win = null;
test.setTimeout(180000);

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
});

test.afterEach(async () => {
  if (app) await hardClose(app, 'tfl1625-exit');
  app = null;
  win = null;
});

const setSize = async (w, h) => {
  await app.evaluate(({ BrowserWindow }) => {
    const bw = BrowserWindow.getAllWindows()[0];
    if (bw.isMaximized()) bw.unmaximize();
  });
  await win.waitForTimeout(350);
  await app.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0].setSize(size[0], size[1]);
  }, [w, h]);
  await win.waitForFunction((s) => Math.abs(window.innerWidth - s) < 60, w, { timeout: 8000 }).catch(() => {});
  await win.waitForTimeout(300);
};

async function openDoc() {
  await win.click('.sample-card');
  await win.waitForSelector('.workspace', { timeout: 20000 });
  await win.waitForSelector('[data-stage-rail]', { timeout: 20000 });
  await win.waitForTimeout(700);
}

// Samples the surface root every frame for 400 ms and reports the exit evidence.
function sampleExitContract(rootSelector, leavingClass) {
  return win.evaluate(({ rootSelector, leavingClass }) => new Promise((resolve) => {
    const out = { sawLeaving: false, frames: 0, distinct: [] };
    const t0 = performance.now();
    const step = () => {
      const el = document.querySelector(rootSelector);
      if (el) {
        const cls = el.className;
        if (!out.distinct.includes(cls)) out.distinct.push(cls);
        if (el.classList.contains(leavingClass)) {
          out.sawLeaving = true;
          out.frames += 1;
          if (!out.animationName) {
            const cs = getComputedStyle(el);
            out.animationName = cs.animationName;
            out.animationDuration = cs.animationDuration;
            out.pointerEvents = cs.pointerEvents;
          }
        }
      }
      if (performance.now() - t0 < 400) requestAnimationFrame(step);
      else resolve(out);
    };
    requestAnimationFrame(step);
  }), { rootSelector, leavingClass });
}

test('TFL-1625: both compact drawers play their reverse exit keyframe before unmounting', async () => {
  await openDoc();
  await setSize(960, 640);
  await win.waitForTimeout(500);

  // --- ContextPanel drawer (stage: edit), the surface with no prior coverage.
  await win.click('[data-stage-rail] [data-stage="edit"]');
  await win.waitForTimeout(300);
  await win.locator('[data-context-panel-launcher-open]').click();
  await expect(
    win.locator('[data-context-panel="edit"][data-context-panel-drawer="true"]'),
  ).toHaveCount(1, { timeout: 8000 });
  await win.waitForTimeout(400); // let the enter keyframe settle

  const ctxPromise = sampleExitContract('[data-context-panel]', 'context-panel-drawer--leaving');
  await win.keyboard.press('Escape');
  await expect(win.locator('[data-context-panel-drawer="true"]')).toHaveCount(0, { timeout: 6000 });
  const ctx = await ctxPromise;
  expect(ctx.sawLeaving, `ContextPanel leaving pose never observed; frames=${JSON.stringify(ctx)}`).toBe(true);
  expect(ctx.animationName).toBe('context-drawer-out');
  expect(ctx.pointerEvents).toBe('none');

  // --- Inspector drawer, the blast-radius neighbour on the same exit machine.
  await win.waitForTimeout(300);
  await win.locator('[data-inspector-collapse]').first().click();
  await expect(
    win.locator('[data-inspector][data-inspector-drawer="true"]'),
  ).toHaveCount(1, { timeout: 8000 });
  await win.waitForTimeout(400);
  await win.screenshot({ path: shotPath('tfl1625_inspector_drawer_open.png') });

  const inspPromise = sampleExitContract('[data-inspector]', 'inspector-drawer--leaving');
  await win.keyboard.press('Escape');
  await expect(
    win.locator('[data-inspector][data-inspector-drawer="true"]'),
  ).toHaveCount(0, { timeout: 6000 });
  const insp = await inspPromise;
  expect(insp.sawLeaving, `Inspector leaving pose never observed; frames=${JSON.stringify(insp)}`).toBe(true);
  expect(insp.animationName).toBe('inspector-drawer-out');
  expect(insp.pointerEvents).toBe('none');
});
