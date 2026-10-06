// TFL-1056 - real-input double-click reachability probe for the same-tick
// double-fire seen in adv_p113 (S1a/S1b). A synchronous el.click(); el.click()
// proves the handler is unguarded in one task; this probe checks whether a
// REAL user double-click (dblclick / two clicks 60-80ms apart) reproduces it.
const { test, expect } = require("@playwright/test");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { launchApp } = require("../../e2e/lib/launch.cjs");
const { hardClose, gotoStage, ensurePanelExpanded, openSample } = require("../../e2e/lib/helpers.cjs");

delete process.env.ELECTRON_RUN_AS_NODE;

const RESULTS = path.join(__dirname, "adv_realdbl.output.json");
test.setTimeout(600000);
let app = null;
let win = null;
const results = {};

test.beforeEach(async () => {
  app = await launchApp([], path.join(os.tmpdir(), `tflex-p113-rdbl-${Date.now()}`));
  win = await app.firstWindow();
  await win.waitForSelector(".sample-card", { timeout: 30000 });
});
test.afterEach(async () => {
  fs.writeFileSync(RESULTS, JSON.stringify(results, null, 2));
  if (app) await hardClose(app, "tfl1056-rdbl");
  app = null;
  win = null;
});
async function arm() {
  await app.evaluate(({ dialog }) => {
    globalThis.__advCounts = { open: 0, save: 0 };
    dialog.showOpenDialog = async () => { globalThis.__advCounts.open += 1; return { canceled: true, filePaths: [] }; };
    dialog.showSaveDialog = async () => { globalThis.__advCounts.save += 1; return { canceled: true, filePath: undefined }; };
  });
}
function counts() {
  return app.evaluate(() => globalThis.__advCounts || { open: 0, save: 0 });
}
async function closeAny() {
  const x = win.locator(".sheet-close").first();
  if ((await x.count()) > 0 && (await x.isVisible().catch(() => false))) {
    await x.click({ timeout: 1500 }).catch(() => {});
    await win.waitForTimeout(200);
  }
}

test("REALDBL home merge dblclick and two clicks at 60ms", async () => {
  const rec = (results.S1a = {});
  await arm();
  await win.locator('[data-home-tool="merge"]').first().dblclick().catch((e) => (rec.dblclickErr = String(e.message).split("\n")[0]));
  await win.waitForTimeout(900);
  rec.afterDblclick = await counts();
  await closeAny();
  await win.waitForTimeout(400);
  await arm();
  const b = await win.locator('[data-home-tool="merge"]').first().boundingBox();
  await win.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await win.waitForTimeout(60);
  await win.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await win.waitForTimeout(900);
  rec.afterTwoClicks60ms = await counts();
  await closeAny();
  expect(true).toBe(true);
});

test("REALDBL title-bar Open dblclick", async () => {
  const rec = (results.S1b = {});
  await openSample(win, app, "report.pdf");
  await win.waitForSelector("[data-action-dock]", { timeout: 30000 });
  await win.waitForTimeout(1200);
  await arm();
  await win.locator("[data-toolbar-open]").first().dblclick().catch((e) => (rec.dblclickErr = String(e.message).split("\n")[0]));
  await win.waitForTimeout(900);
  rec.openAfterDblclick = await counts();
  await closeAny();

  await gotoStage(win, 1);
  await ensurePanelExpanded(win);
  const thumb = win.locator('[data-context-panel] .thumb-item[data-page="1"]').first();
  await thumb.waitFor({ state: "visible", timeout: 15000 });
  await thumb.click({ button: "right" });
  await win.waitForSelector("[data-context-menu]", { state: "visible", timeout: 8000 });
  await win.waitForTimeout(250);
  rec.rotateBefore = await win.evaluate(() => window.tflexDiagnostics().engineState.rotations[0]);
  const row = await win.locator('[data-context-menu] [data-menu-item="rotate-cw"]').first().boundingBox();
  await win.mouse.click(row.x + row.width / 2, row.y + row.height / 2);
  await win.waitForTimeout(70);
  await win.mouse.click(row.x + row.width / 2, row.y + row.height / 2);
  await win.waitForTimeout(1000);
  rec.rotateAfter = await win.evaluate(() => window.tflexDiagnostics().engineState.rotations[0]);
  rec.rotateDelta = (rec.rotateAfter - rec.rotateBefore) % 360;
  expect(true).toBe(true);
});
