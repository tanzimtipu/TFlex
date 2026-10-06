// TFL-1028 adversary phase-close diff-pass (TFL-855 migrated inventory).
// Menus/dismissal/focus/keys/silent-no-op probe. Launches ONLY via the canonical
// e2e/lib/launch.cjs helper. Writes a JSON result file next to this spec.
//
// Attack classes covered here:
//   T1  Welcome application menu (CommandMenu) - first focus, disabled skip,
//       Escape/outside/Tab close, focus return, opener-toggle collapse, clamp.
//   T2  Workspace File menu (CommandMenu) + application menu - command dispatch
//       (Close Tab / OCR), row inventory, dismissal contracts.
//   T3  Dock More overflow + Add-a-tool picker + Pin/Unpin (CommandMenu) -
//       silent no-op, edit-mode toggle collapse, Escape scopes, placement clamp.
//   T4  Thumbnail right-click context menu (CommandMenu) - verb inventory +
//       dispatch, viewport clamp at the bottom edge, scroll dismissal.
const { test, expect } = require("@playwright/test");
const path = require("node:path");
const fs = require("node:fs");
const { launchApp } = require("../../e2e/lib/launch.cjs");
const { hardClose, gotoStage } = require("../../e2e/lib/helpers.cjs");

const OUT = path.resolve(__dirname, "..", "..", "screenshots", "phase1028-adversary");
const RESULTS = path.join(__dirname, "adv_menus.output.json");
fs.mkdirSync(OUT, { recursive: true });
test.setTimeout(600000);

let app = null;
let win = null;
const results = {};

test.beforeEach(async () => {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector(".sample-card", { timeout: 30000 });
});

test.afterEach(async () => {
  fs.writeFileSync(RESULTS, JSON.stringify(results, null, 2));
  if (app) await hardClose(app, "tfl1028-adv");
  app = null;
  win = null;
});

async function shot(name) {
  const p = path.join(OUT, name);
  await win.screenshot({ path: p });
  fs.writeFileSync(RESULTS, JSON.stringify(results, null, 2));
  return p;
}

// Active element descriptor for the focus contract.
function activeDesc() {
  return win.evaluate(() => {
    const el = document.activeElement;
    if (!el) return null;
    return {
      tag: el.tagName,
      action: el.getAttribute("data-menu-action"),
      key: el.getAttribute("data-menu-key"),
      id: el.id || null,
      cls: (el.className && String(el.className).slice(0, 90)) || "",
    };
  });
}

function menuRows(rootSel) {
  return win.evaluate((sel) => {
    const root = document.querySelector(sel);
    if (!root) return null;
    return Array.from(root.querySelectorAll(".titlebar-menu-row")).map((b) => ({
      action: b.getAttribute("data-menu-action"),
      role: b.getAttribute("role"),
      checked: b.getAttribute("aria-checked"),
      disabled: b.disabled === true,
      reason: b.getAttribute("title"),
      text: (b.textContent || "").trim().slice(0, 40),
    }));
  }, rootSel);
}

function rect(sel) {
  return win.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      x: Math.round(r.x),
      y: Math.round(r.y),
      w: Math.round(r.width),
      h: Math.round(r.height),
      right: Math.round(r.right),
      bottom: Math.round(r.bottom),
      vw: window.innerWidth,
      vh: window.innerHeight,
      position: getComputedStyle(el).position,
      z: getComputedStyle(el).zIndex,
    };
  }, sel);
}

async function waitGone(sel, timeout = 4000) {
  try {
    await win.waitForSelector(sel, { state: "detached", timeout });
    return true;
  } catch {
    return false;
  }
}

test("T1 welcome application menu: focus, disabled skip, dismissal, opener toggle", async () => {
  const rec = (results.T1 = {});
  // Open the application menu from the Welcome header.
  await win.click("[data-app-menu]");
  await win.waitForSelector("[data-app-menu-popover]", { state: "visible", timeout: 8000 });
  await win.waitForTimeout(400);
  rec.rows = await menuRows("[data-app-menu-popover]");
  rec.firstFocus = await activeDesc();
  rec.rect = await rect("[data-app-menu-popover]");
  await shot("tfl1028-welcome-appmenu-open.png");

  // Arrow traversal must never land on a disabled row.
  const focusSeq = [];
  for (let i = 0; i < 14; i += 1) {
    await win.keyboard.press("ArrowDown");
    focusSeq.push(await activeDesc());
  }
  rec.focusSeq = focusSeq.map((f) => f && f.action);
  const disabledActs = new Set((rec.rows || []).filter((r) => r.disabled).map((r) => r.action));
  rec.focusLandedOnDisabled = focusSeq.some((f) => f && disabledActs.has(f.action));
  // End must land on the last ENABLED row.
  await win.keyboard.press("End");
  rec.endFocus = await activeDesc();
  await win.keyboard.press("Home");
  rec.homeFocus = await activeDesc();

  // Escape closes and returns focus to the opener.
  await win.keyboard.press("Escape");
  rec.escapeDetached = await waitGone("[data-app-menu-popover]");
  await win.waitForTimeout(250);
  rec.focusAfterEscape = await activeDesc();

  // Opener toggle: clicking the opener again must CLOSE its own menu.
  await win.click("[data-app-menu]");
  await win.waitForSelector("[data-app-menu-popover]", { state: "visible", timeout: 8000 });
  await win.click("[data-app-menu]");
  rec.openerToggleClosed = await waitGone("[data-app-menu-popover]", 2500);

  // Outside pointerdown closes and does not swallow the underlying gesture.
  await win.click("[data-app-menu]");
  await win.waitForSelector("[data-app-menu-popover]", { state: "visible", timeout: 8000 });
  await win.mouse.click(20, 400);
  rec.outsideClickClosed = await waitGone("[data-app-menu-popover]", 2500);

  // Tab closes and returns focus to the opener.
  await win.click("[data-app-menu]");
  await win.waitForSelector("[data-app-menu-popover]", { state: "visible", timeout: 8000 });
  await win.keyboard.press("Tab");
  rec.tabDetached = await waitGone("[data-app-menu-popover]", 2500);
  await win.waitForTimeout(200);
  rec.focusAfterTab = await activeDesc();
  await shot("tfl1028-welcome-appmenu-closed.png");
  expect(true).toBe(true);
});

test("T2 workspace File menu + application menu command dispatch", async () => {
  const rec = (results.T2 = {});
  // Open a real document.
  await win.locator(".sample-card").filter({ hasText: "report.pdf" }).first().click();
  await win.waitForSelector(".workspace", { timeout: 30000 });
  await win.waitForSelector("[data-action-dock]", { timeout: 30000 });
  await win.waitForTimeout(1200);

  // File menu inventory.
  await win.click("[data-menu-button]");
  await win.waitForSelector("[data-menu-popover]", { state: "visible", timeout: 8000 });
  await win.waitForTimeout(350);
  rec.fileRows = await menuRows("[data-menu-popover]");
  rec.fileFirstFocus = await activeDesc();
  rec.fileRect = await rect("[data-menu-popover]");
  await shot("tfl1028-file-menu.png");
  await win.keyboard.press("Escape");
  rec.fileEscapeDetached = await waitGone("[data-menu-popover]");

  // Opener toggle on the File menu.
  await win.click("[data-menu-button]");
  await win.waitForSelector("[data-menu-popover]", { state: "visible", timeout: 8000 });
  await win.click("[data-menu-button]");
  rec.fileToggleClosed = await waitGone("[data-menu-popover]", 2500);

  // Application menu: OCR must dispatch (open the OCR dialog).
  await win.click("[data-app-menu]");
  await win.waitForSelector("[data-app-menu-popover]", { state: "visible", timeout: 8000 });
  await win.waitForTimeout(300);
  rec.appRows = await menuRows("[data-app-menu-popover]");
  const ocrRow = win.locator('[data-app-menu-popover] [data-menu-action="recognizeText"]');
  rec.ocrEnabled = (await ocrRow.count()) > 0 && (await ocrRow.first().isEnabled());
  if (rec.ocrEnabled) {
    await ocrRow.first().click();
    // The OCR dialog is the real dispatch target.
    rec.ocrDialogOpened = await win
      .waitForSelector("[data-ocr-dialog], .ocr-dialog, [data-ocr-scope]", { state: "visible", timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    rec.appMenuClosedAfterDispatch = await waitGone("[data-app-menu-popover]", 2500);
    await win.keyboard.press("Escape");
    await win.waitForTimeout(500);
  }

  // Close Tab must actually close the document (real command, not a no-op).
  await win.click("[data-menu-button]");
  await win.waitForSelector("[data-menu-popover]", { state: "visible", timeout: 8000 });
  await win.waitForTimeout(250);
  await win.locator('[data-menu-popover] [data-menu-action="closeTab"]').first().click();
  rec.closeTabReturnedWelcome = await win
    .waitForSelector(".sample-card", { state: "visible", timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  await shot("tfl1028-after-close-tab.png");
  expect(true).toBe(true);
});

test("T3 dock More + Add-a-tool picker + Pin menu", async () => {
  const rec = (results.T3 = {});
  await win.locator(".sample-card").filter({ hasText: "report.pdf" }).first().click();
  await win.waitForSelector(".workspace", { timeout: 30000 });
  await win.waitForSelector("[data-action-dock]", { timeout: 30000 });
  await win.waitForTimeout(1200);

  // More overflow: rows + placement clamp.
  await win.click("[data-dock-overflow]");
  await win.waitForSelector("[data-dock-overflow-menu]", { state: "visible", timeout: 8000 });
  await win.waitForTimeout(350);
  rec.moreRows = await menuRows("[data-dock-overflow-menu]");
  rec.moreRect = await rect("[data-dock-overflow-menu]");
  rec.moreFirstFocus = await activeDesc();
  await shot("tfl1028-dock-more.png");
  // Clamp: menu must sit inside the viewport.
  if (rec.moreRect) {
    rec.moreInsideViewport =
      rec.moreRect.x >= 0 &&
      rec.moreRect.y >= 0 &&
      rec.moreRect.right <= rec.moreRect.vw &&
      rec.moreRect.bottom <= rec.moreRect.vh;
  }
  // Escape closes it.
  await win.keyboard.press("Escape");
  rec.moreEscapeDetached = await waitGone("[data-dock-overflow-menu]", 2500);

  // Reopen, enable Customize (checked toggle), then open the Add-a-tool picker.
  await win.click("[data-dock-overflow]");
  await win.waitForSelector('[data-dock-menu-item="customize"]', { state: "visible", timeout: 8000 });
  await win.locator('[data-dock-menu-item="customize"]').first().click();
  await win.waitForTimeout(500);
  rec.editModeOn = await win.evaluate(
    () => document.querySelector("[data-action-dock]")?.getAttribute("data-dock-edit") === "true",
  );
  await win.click("[data-dock-plus]");
  await win.waitForSelector("[data-dock-picker]", { state: "visible", timeout: 8000 });
  await win.waitForTimeout(350);
  rec.pickerRows = await menuRows("[data-dock-picker]");
  rec.pickerRect = await rect("[data-dock-picker]");
  rec.pickerFirstFocus = await activeDesc();
  await shot("tfl1028-dock-picker.png");
  if (rec.pickerRect) {
    rec.pickerInsideViewport =
      rec.pickerRect.x >= 0 &&
      rec.pickerRect.y >= 0 &&
      rec.pickerRect.right <= rec.pickerRect.vw &&
      rec.pickerRect.bottom <= rec.pickerRect.vh;
  }

  // Silent-no-op attack on the picker: clicking the first row must pin a new verb.
  const beforeVerbs = await win.evaluate(() =>
    Array.from(document.querySelectorAll("[data-dock-verb]")).map((b) => b.getAttribute("data-dock-verb")),
  );
  const firstPickerAction = rec.pickerRows && rec.pickerRows[0] && rec.pickerRows[0].action;
  rec.pickerFirstAction = firstPickerAction;
  if (firstPickerAction) {
    await win.locator(`[data-dock-picker] [data-menu-action="${firstPickerAction}"]`).first().click();
    await win.waitForTimeout(900);
    const afterVerbs = await win.evaluate(() =>
      Array.from(document.querySelectorAll("[data-dock-verb]")).map((b) => b.getAttribute("data-dock-verb")),
    );
    rec.pickerAddedVerb = afterVerbs.some((v) => !beforeVerbs.includes(v));
    rec.pickerMenuClosedAfterPick = await waitGone("[data-dock-picker]", 2500);
  }

  // Escape while the picker is open must exit EDIT mode (capture handler).
  await win.click("[data-dock-plus]");
  await win.waitForSelector("[data-dock-picker]", { state: "visible", timeout: 8000 });
  await win.keyboard.press("Escape");
  rec.escapeClosedPicker = await waitGone("[data-dock-picker]", 2500);
  await win.waitForTimeout(300);
  rec.escapeExitedEditMode = await win.evaluate(
    () => document.querySelector("[data-action-dock]")?.getAttribute("data-dock-edit") !== "true",
  );

  // Pin/Unpin context menu: right-click a dock verb.
  const verbEl = win.locator("[data-dock-verb]").first();
  await verbEl.click({ button: "right" });
  const pinOpen = await win
    .waitForSelector("[data-dock-menu]", { state: "visible", timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  rec.pinMenuOpened = pinOpen;
  if (pinOpen) {
    await win.waitForTimeout(300);
    rec.pinRows = await menuRows("[data-dock-menu]");
    rec.pinRect = await rect("[data-dock-menu]");
    await shot("tfl1028-dock-pin-menu.png");
    if (rec.pinRect) {
      rec.pinInsideViewport =
        rec.pinRect.x >= 0 &&
        rec.pinRect.y >= 0 &&
        rec.pinRect.right <= rec.pinRect.vw &&
        rec.pinRect.bottom <= rec.pinRect.vh;
    }
    await win.keyboard.press("Escape");
    rec.pinEscapeDetached = await waitGone("[data-dock-menu]", 2500);
  }
  expect(true).toBe(true);
});

test("T4 thumbnail right-click menu: inventory, dispatch, clamp, scroll dismissal", async () => {
  const rec = (results.T4 = {});
  await win.locator(".sample-card").filter({ hasText: "report.pdf" }).first().click();
  await win.waitForSelector(".workspace", { timeout: 30000 });
  await win.waitForTimeout(1500);
  const panel = win.locator('[data-context-panel="pages"]');
  await panel.locator(".thumb-item").first().waitFor({ timeout: 20000 });

  // Right-click a thumbnail near the BOTTOM edge of the viewport (worst case
  // for the clamp). Fall back to the first thumb when none sits low.
  const vh = await win.evaluate(() => window.innerHeight);
  const thumbs = await panel.locator(".thumb-item").all();
  let target = null;
  for (const t of thumbs.slice(0, 20)) {
    const b = await t.boundingBox();
    if (b && b.y + b.height / 2 > vh * 0.5 && b.y + b.height / 2 < vh - 20) {
      target = b;
      break;
    }
  }
  if (!target) target = await panel.locator(".thumb-item").first().boundingBox();
  const box = target;
  await win.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
  await win.waitForSelector("[data-context-menu]", { state: "visible", timeout: 8000 });
  await win.waitForTimeout(300);
  rec.rows = await menuRows("[data-context-menu]");
  rec.rect = await rect("[data-context-menu]");
  rec.firstFocus = await activeDesc();
  await shot("tfl1028-thumb-menu.png");
  if (rec.rect) {
    rec.insideViewport =
      rec.rect.x >= 0 &&
      rec.rect.y >= 0 &&
      rec.rect.right <= rec.rect.vw &&
      rec.rect.bottom <= rec.rect.vh;
  }

  // Dispatch a real verb: rotate-ccw must change the engine rotation.
  const before = await win.evaluate(() => window.tflexDiagnostics().engineState.rotations[0]);
  await win.locator('[data-context-menu] [data-menu-item="rotate-ccw"]').first().click();
  await win.waitForTimeout(1200);
  const after = await win.evaluate(() => window.tflexDiagnostics().engineState.rotations[0]);
  rec.rotateCcwChanged = before !== after;
  rec.menuClosedAfterVerb = await waitGone("[data-context-menu]", 2500);

  // Reopen and force a scroll: the menu must dismiss (dismissOnScroll).
  await win.mouse.click(box.x + box.width / 2, box.y + box.height / 2, { button: "right" });
  await win.waitForSelector("[data-context-menu]", { state: "visible", timeout: 8000 });
  await win.waitForTimeout(200);
  // Put the pointer over the thumbnail list and issue a real wheel scroll so a
  // genuine scroll event fires in the capture path.
  await win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await win.mouse.wheel(0, 320);
  await win.waitForTimeout(400);
  let dismissed = await waitGone("[data-context-menu]", 1500);
  if (!dismissed) {
    await win.evaluate(() => {
      const sc =
        document.querySelector(".thumb-scroller") ||
        document.querySelector(".thumb-list") ||
        document.querySelector(".context-panel-body") ||
        document.querySelector(".rail-scroll");
      if (sc) sc.dispatchEvent(new Event("scroll", { bubbles: false }));
    });
    dismissed = await waitGone("[data-context-menu]", 1500);
  }
  rec.scrollDismissed = dismissed;
  expect(true).toBe(true);
});
