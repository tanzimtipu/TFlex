// DEF-610 / DEF-611 — renderer regression spec.
//
// DEF-610: a same-tick double activation of a file-open / merge / command row
// dispatched the underlying action twice (two native pickers, two Rotate CW
// applications). DEF-611: closing the Command Palette or the Preferences sheet
// left focus on `document.body` instead of returning it to the opener.
//
// The spec mirrors the main-side dialog-counter `arm()` and the real-input
// double-activation pattern of test-fixtures/phase113-adversary/adv_realdbl.spec.cjs
// and the S2 focus checks of adv_p113.spec.cjs, then asserts the fixed values.
const { test, expect } = require("@playwright/test");
const path = require("node:path");
const os = require("node:os");
const { launchApp } = require("./lib/launch.cjs");
const { hardClose, gotoStage, ensurePanelExpanded, openSample } = require("./lib/helpers.cjs");

delete process.env.ELECTRON_RUN_AS_NODE;

test.setTimeout(600000);
let app = null;
let win = null;

test.beforeEach(async () => {
  app = await launchApp([], path.join(os.tmpdir(), `tflex-def610-611-${Date.now()}`));
  win = await app.firstWindow();
  await win.waitForSelector(".sample-card", { timeout: 30000 });
});

test.afterEach(async () => {
  if (app) await hardClose(app, "def610-611");
  app = null;
  win = null;
});

// Benign "canceled" stubs so an accidental extra invocation is countable with
// no side effects. Reset before each probe.
async function arm() {
  await app.evaluate(({ dialog }) => {
    globalThis.__defCounts = { open: 0, save: 0 };
    dialog.showOpenDialog = async () => {
      globalThis.__defCounts.open += 1;
      return { canceled: true, filePaths: [] };
    };
    dialog.showSaveDialog = async () => {
      globalThis.__defCounts.save += 1;
      return { canceled: true, filePath: undefined };
    };
  });
}

function counts() {
  return app.evaluate(() => globalThis.__defCounts || { open: 0, save: 0 });
}

async function closeAny() {
  const x = win.locator(".sheet-close").first();
  if ((await x.count()) > 0 && (await x.isVisible().catch(() => false))) {
    await x.click({ timeout: 1500 }).catch(() => {});
    await win.waitForTimeout(200);
  }
}

function activeFlags() {
  return win.evaluate(() => {
    const el = document.activeElement;
    if (!el) return null;
    return {
      tag: el.tagName,
      search: el.hasAttribute("data-header-tool-search"),
      appMenu: el.hasAttribute("data-app-menu"),
    };
  });
}

test("DEF-610/611 — same-tick re-entry guards + focus return on close", async () => {
  // ---- A2: Home hero Merge — dblclick then two clicks 60ms apart ----
  await arm();
  await win.locator('[data-home-tool="merge"]').first().dblclick().catch(() => {});
  await win.waitForTimeout(900);
  expect((await counts()).open).toBe(1);
  await closeAny();
  await win.waitForTimeout(400);

  await arm();
  const mergeBox = await win.locator('[data-home-tool="merge"]').first().boundingBox();
  await win.mouse.click(mergeBox.x + mergeBox.width / 2, mergeBox.y + mergeBox.height / 2);
  await win.waitForTimeout(60);
  await win.mouse.click(mergeBox.x + mergeBox.width / 2, mergeBox.y + mergeBox.height / 2);
  await win.waitForTimeout(900);
  expect((await counts()).open).toBe(1);
  await closeAny();

  // ---- A1: title-bar Open — dblclick ----
  await openSample(win, app, "report.pdf");
  await win.waitForSelector("[data-action-dock]", { timeout: 30000 });
  await win.waitForTimeout(1200);
  await arm();
  await win.locator("[data-toolbar-open]").first().dblclick().catch(() => {});
  await win.waitForTimeout(900);
  expect((await counts()).open).toBe(1);
  await closeAny();

  // ---- A3: page-thumb context-menu Rotate CW — two synchronous clicks ----
  await gotoStage(win, 1);
  await ensurePanelExpanded(win);
  const thumb = win.locator('[data-context-panel] .thumb-item[data-page="1"]').first();
  await thumb.waitFor({ state: "visible", timeout: 15000 });
  await thumb.scrollIntoViewIfNeeded();
  await thumb.click({ button: "right" });
  await win.waitForSelector("[data-context-menu]", { state: "visible", timeout: 8000 });
  await win.waitForTimeout(250);
  const rotateBefore = await win.evaluate(
    () => window.tflexDiagnostics().engineState.rotations[0],
  );
  await win.evaluate(() => {
    const el = document.querySelector('[data-context-menu] [data-menu-item="rotate-cw"]');
    if (el) {
      el.click();
      el.click();
    }
  });
  await win.waitForTimeout(1000);
  const rotateAfter = await win.evaluate(
    () => window.tflexDiagnostics().engineState.rotations[0],
  );
  expect((rotateAfter - rotateBefore) % 360).toBe(1);

  // ---- B1: Command Palette — Escape returns focus to the Search-tools button ----
  await win.evaluate(() => document.activeElement && document.activeElement.blur());
  await win.keyboard.press("Control+k");
  await win.waitForSelector("[data-command-palette-input]", { state: "visible", timeout: 8000 });
  await win.waitForTimeout(200);
  await win.keyboard.press("Escape");
  await win
    .waitForSelector("[data-command-palette-input]", { state: "detached", timeout: 4000 })
    .catch(() => {});
  await win.waitForTimeout(250);
  const paletteFocus = await activeFlags();
  expect(paletteFocus?.search).toBe(true);
  expect(paletteFocus?.tag).not.toBe("BODY");

  // ---- B2: Preferences — Escape returns focus to the app-menu trigger ----
  await win.click("[data-app-menu]");
  await win.waitForSelector("[data-app-menu-popover]", { state: "visible", timeout: 8000 });
  await win.waitForTimeout(250);
  const prefsRow = win.locator('[data-app-menu-popover] [data-menu-action="preferences"]');
  expect(await prefsRow.count()).toBeGreaterThan(0);
  await prefsRow.first().click();
  await win.waitForSelector("[data-prefs-dialog]", { state: "visible", timeout: 8000 });
  await win.waitForTimeout(400);
  await win.keyboard.press("Escape");
  await win
    .waitForSelector("[data-prefs-dialog]", { state: "detached", timeout: 5000 })
    .catch(() => {});
  await win.waitForTimeout(300);
  const prefsFocus = await activeFlags();
  expect(prefsFocus?.appMenu).toBe(true);
  expect(prefsFocus?.tag).not.toBe("BODY");
});

