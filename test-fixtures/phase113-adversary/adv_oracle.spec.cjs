// TFL-1056 oracle - the double-execution subset (S1a + S1b), run identically
// against the Phase 113 working tree and the detached HEAD f9a88c2 worktree so
// a same-tick double-fire can be classified PHASE-INDUCED vs PRE-EXISTING.
const { test, expect } = require("@playwright/test");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { launchApp } = require("../../e2e/lib/launch.cjs");
const { hardClose, gotoStage, ensurePanelExpanded, openSample } = require("../../e2e/lib/helpers.cjs");

delete process.env.ELECTRON_RUN_AS_NODE;

const RESULTS = path.join(__dirname, "adv_oracle.output.json");
test.setTimeout(600000);

let app = null;
let win = null;
const results = {};

test.beforeEach(async () => {
  app = await launchApp([], path.join(os.tmpdir(), `tflex-p113-oracle-${Date.now()}`));
  win = await app.firstWindow();
  await win.waitForSelector(".sample-card", { timeout: 30000 });
});

test.afterEach(async () => {
  fs.writeFileSync(RESULTS, JSON.stringify(results, null, 2));
  if (app) await hardClose(app, "tfl1056-oracle");
  app = null;
  win = null;
});

async function armDialogCounters() {
  await app.evaluate(({ dialog }) => {
    globalThis.__advCounts = { open: 0, save: 0 };
    dialog.showOpenDialog = async () => {
      globalThis.__advCounts.open += 1;
      return { canceled: true, filePaths: [] };
    };
    dialog.showSaveDialog = async () => {
      globalThis.__advCounts.save += 1;
      return { canceled: true, filePath: undefined };
    };
  });
}
function readCounts() {
  return app.evaluate(() => globalThis.__advCounts || { open: 0, save: 0 });
}
async function closeAnyDialog() {
  const x = win.locator(".sheet-close").first();
  if ((await x.count()) > 0 && (await x.isVisible().catch(() => false))) {
    await x.click({ timeout: 2000 }).catch(() => {});
    await win.waitForTimeout(250);
  }
  const bd = win.locator(".modal-backdrop, .sheet-backdrop").first();
  if ((await bd.count()) > 0 && (await bd.isVisible().catch(() => false))) {
    await win.keyboard.press("Escape");
    await win.waitForTimeout(250);
  }
}

test("ORACLE S1a Home merge double", async () => {
  const rec = (results.S1a = {});
  await armDialogCounters();
  rec.mergeTilePresent = (await win.locator('[data-home-tool="merge"]').count()) > 0;
  if (!rec.mergeTilePresent) return;
  await win.evaluate(() => {
    const b = document.querySelector('[data-home-tool="merge"]');
    b.click();
    b.click();
  });
  await win.waitForTimeout(800);
  rec.mergeAfterDoubleCounts = await readCounts();
  await closeAnyDialog();
  await win.waitForTimeout(400);
  await armDialogCounters();
  await win.evaluate(() => {
    const b = document.querySelector('[data-home-tool="merge"]');
    for (let i = 0; i < 5; i += 1) b.click();
  });
  await win.waitForTimeout(800);
  rec.mergeAfterStormCounts = await readCounts();
  await closeAnyDialog();
  expect(true).toBe(true);
});

test("ORACLE S1b title-bar Open / Save As / rotate-cw double", async () => {
  const rec = (results.S1b = {});
  await openSample(win, app, "report.pdf");
  await win.waitForSelector("[data-action-dock]", { timeout: 30000 });
  await win.waitForTimeout(1200);

  await armDialogCounters();
  await win.evaluate(() => {
    const b = document.querySelector("[data-toolbar-open]");
    b.click();
    b.click();
  });
  await win.waitForTimeout(800);
  rec.openCounts = await readCounts();
  await closeAnyDialog();

  await armDialogCounters();
  await win.evaluate(() => {
    const b = document.querySelector("[data-toolbar-save-as]");
    if (b) {
      b.click();
      b.click();
    }
  });
  await win.waitForTimeout(900);
  rec.saveAsCounts = await readCounts();
  await closeAnyDialog();

  await gotoStage(win, 1);
  await ensurePanelExpanded(win);
  const thumb = win.locator('[data-context-panel] .thumb-item[data-page="1"]').first();
  await thumb.waitFor({ state: "visible", timeout: 15000 });
  await thumb.click({ button: "right" });
  await win.waitForSelector("[data-context-menu]", { state: "visible", timeout: 8000 });
  await win.waitForTimeout(250);
  rec.rotateBefore = await win.evaluate(() => window.tflexDiagnostics().engineState.rotations[0]);
  await win.evaluate(() => {
    const b = document.querySelector('[data-context-menu] [data-menu-item="rotate-cw"]');
    if (b) {
      b.click();
      b.click();
    }
  });
  await win.waitForTimeout(1000);
  rec.rotateAfter = await win.evaluate(() => window.tflexDiagnostics().engineState.rotations[0]);
  rec.rotateDelta = (rec.rotateAfter - rec.rotateBefore) % 360;
  expect(true).toBe(true);
});
