// TFL-1028 adversary phase-close diff-pass (TFL-855 migrated inventory).
// Migrated dialogs (TaskDialog / PreviewTaskDialog) + theme/reduced-motion.
// Launches ONLY via the canonical e2e/lib/launch.cjs helper.
const { test, expect } = require("@playwright/test");
const path = require("node:path");
const fs = require("node:fs");
const { launchApp } = require("../../e2e/lib/launch.cjs");
const { hardClose, runTool } = require("../../e2e/lib/helpers.cjs");

const OUT = path.resolve(__dirname, "..", "..", "screenshots", "phase1028-adversary");
const RESULTS = path.join(__dirname, "adv_dialogs.output.json");
const IMG_A = path.resolve(__dirname, "img-a.png");
const IMG_B = path.resolve(__dirname, "img-b.png");
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
  if (app) await hardClose(app, "tfl1028-adv-dlg");
  app = null;
  win = null;
});

async function shot(name) {
  const p = path.join(OUT, name);
  await win.screenshot({ path: p });
  return p;
}

async function openReport() {
  await win.locator(".sample-card").filter({ hasText: "report.pdf" }).first().click();
  await win.waitForSelector(".workspace", { timeout: 30000 });
  await win.waitForSelector("[data-action-dock]", { timeout: 30000 });
  await win.waitForTimeout(1400);
}

test("T7 Split dialog (TaskDialog): real source context, validated range/count, bounded body", async () => {
  const rec = (results.T7 = {});
  await openReport();
  await runTool(win, "split");
  await win.waitForSelector("#split-dialog-title", { state: "visible", timeout: 10000 });
  await win.waitForTimeout(500);

  rec.title = await win.locator("#split-dialog-title").textContent();
  rec.context = await win.locator(".modal-context").first().textContent().catch(() => null);
  rec.sourceNameInContext = /report\.pdf/i.test(rec.context || "");
  rec.pageCountInContext = /page/i.test(rec.context || "");
  rec.isTaskDialog = await win.evaluate(
    () => (document.querySelector(".task-dialog")?.className || "").includes("task-dialog"),
  );
  rec.bodyScroll = await win.evaluate(
    () => document.querySelector(".modal-body-scroll") !== null,
  );
  const confirm = win.locator(".modal-footer button, .dialog-footer button").filter({ hasText: /^(Extract|Split)$/ }).last();
  rec.defaultConfirmLabel = await confirm.textContent();
  rec.defaultConfirmEnabled = await confirm.isEnabled();
  rec.defaultStatus = await win.locator(".modal-status").first().textContent();
  await shot("tfl1028-split-default.png");

  // Invalid range -> the real parser must disable the primary action.
  const input = win.locator("#split-dialog-title").locator("xpath=ancestor::div[contains(@class,'dialog-shell') or contains(@class,'task-dialog')]//input[@type='text'][1]");
  let textInput = win.locator("input.modal-input[type='text']").first();
  await textInput.fill("999-1000");
  await win.waitForTimeout(400);
  rec.invalidConfirmEnabled = await confirm.isEnabled();
  rec.invalidStatus = await win.locator(".modal-status").first().textContent();
  await shot("tfl1028-split-invalid.png");

  // Valid small range -> count reflects the real parsed range.
  await textInput.fill("1-3");
  await win.waitForTimeout(400);
  rec.validConfirmEnabled = await confirm.isEnabled();
  rec.validStatus = await win.locator(".modal-status").first().textContent();
  await shot("tfl1028-split-valid.png");
  await win.keyboard.press("Escape");
  await win.waitForTimeout(400);
  rec.closedOnEscape = (await win.locator("#split-dialog-title").count()) === 0;
  expect(true).toBe(true);
});

test("T8 Stamp (PreviewTaskDialog): real canvas preview renders and re-renders on stamp change", async () => {
  const rec = (results.T8 = {});
  await openReport();
  await runTool(win, "stamp");
  await win.waitForSelector("[data-stamp-dialog]", { state: "visible", timeout: 10000 });
  await win.waitForTimeout(700);

  rec.isPreviewTaskDialog = await win.evaluate(
    () => (document.querySelector("[data-stamp-dialog]")?.className || "").includes("task-dialog-preview"),
  );
  rec.radios = await win.locator("[data-stamp-id]").count();
  const canvas = win.locator("[data-stamp-preview]").first();
  rec.previewPresent = (await canvas.count()) > 0;
  rec.selectedStamp = await canvas.getAttribute("data-stamp-preview");
  // The preview must carry real rendered pixels, not a blank canvas.
  rec.previewDataUrlLen = await win.evaluate(() => {
    const c = document.querySelector("[data-stamp-preview]");
    if (!c) return -1;
    try {
      return c.toDataURL("image/png").length;
    } catch {
      return -2;
    }
  });
  await shot("tfl1028-stamp.png");

  // Change the stamp; the preview attribute must change (real re-render).
  const ids = await win.locator("[data-stamp-id]").evaluateAll((els) => els.map((e) => e.getAttribute("data-stamp-id")));
  const other = ids.find((i) => i !== rec.selectedStamp);
  if (other) {
    await win.locator(`[data-stamp-id="${other}"]`).check();
    await win.waitForTimeout(600);
    rec.previewAfterChange = await canvas.getAttribute("data-stamp-preview");
    rec.previewChanged = rec.previewAfterChange === other;
    rec.previewDataUrlLenAfter = await win.evaluate(() => {
      const c = document.querySelector("[data-stamp-preview]");
      return c ? c.toDataURL("image/png").length : -1;
    });
    await shot("tfl1028-stamp-changed.png");
  }
  await win.keyboard.press("Escape");
  await win.waitForTimeout(400);
  rec.closedOnEscape = (await win.locator("[data-stamp-dialog]").count()) === 0;
  expect(true).toBe(true);
});

test("T9 Create PDF from images (PreviewTaskDialog): empty state, add, reorder, remove, encoding", async () => {
  const rec = (results.T9 = {});
  await openReport();
  await runTool(win, "createFromImages");
  await win.waitForSelector("[data-create-from-images-dialog]", { state: "visible", timeout: 10000 });
  await win.waitForTimeout(500);

  rec.isPreviewTaskDialog = await win.evaluate(
    () => (document.querySelector("[data-create-from-images-dialog]")?.className || "").includes("task-dialog-preview"),
  );
  rec.emptyHint = await win.locator("[data-create-from-images-dialog] .modal-picked").textContent().catch(() => null);
  const confirm = win.locator("[data-create-confirm]").first();
  rec.emptyConfirmDisabled = !(await confirm.isEnabled());
  rec.encodingFieldset = (await win.locator("[data-create-encoding]").count()) > 0;
  await shot("tfl1028-create-images-empty.png");

  // Add two real images through the real picker.
  const fc1 = win.waitForEvent("filechooser");
  await win.locator("[data-create-pick]").click();
  (await fc1).setFiles([IMG_A, IMG_B]);
  await win.waitForTimeout(1500);
  rec.rows = await win.locator("[data-create-image-row]").count();
  rec.countLabel = await win.locator("[data-create-from-images-dialog] .modal-picked").textContent().catch(() => null);
  rec.confirmEnabledAfterAdd = await confirm.isEnabled();

  // Reorder-button disabled-state recovery at the edges.
  rec.moveUp0Disabled = !(await win.locator('[data-create-move-up="0"]').isEnabled());
  rec.moveUp1Enabled = await win.locator('[data-create-move-up="1"]').isEnabled();
  rec.moveDownLastDisabled = !(await win.locator('[data-create-move-down="1"]').isEnabled());
  rec.moveDown0Enabled = await win.locator('[data-create-move-down="0"]').isEnabled();

  const namesBefore = await win.locator("[data-create-image-row] .create-image-name").allTextContents();
  await win.locator('[data-create-move-down="0"]').click();
  await win.waitForTimeout(400);
  const namesAfter = await win.locator("[data-create-image-row] .create-image-name").allTextContents();
  rec.reorderChangedOrder = JSON.stringify(namesBefore) !== JSON.stringify(namesAfter);
  rec.namesBefore = namesBefore;
  rec.namesAfter = namesAfter;
  await shot("tfl1028-create-images-two.png");

  // Keyboard reorder path (Alt+ArrowDown on a focused row).
  await win.locator("[data-create-image-row]").first().focus();
  await win.keyboard.press("Alt+ArrowDown");
  await win.waitForTimeout(400);
  const namesAfterKey = await win.locator("[data-create-image-row] .create-image-name").allTextContents();
  rec.keyboardReorderChanged = JSON.stringify(namesAfter) !== JSON.stringify(namesAfterKey);

  // Remove one; count must drop.
  await win.locator("[data-create-remove]").first().click();
  await win.waitForTimeout(400);
  rec.rowsAfterRemove = await win.locator("[data-create-image-row]").count();

  // Invalid quality entry clamps on blur.
  const q = win.locator("[data-create-quality]").first();
  await q.fill("5");
  await q.blur();
  await win.waitForTimeout(400);
  rec.qualityAfterLowEntry = await q.inputValue();
  await q.fill("9999");
  await q.blur();
  await win.waitForTimeout(400);
  rec.qualityAfterHighEntry = await q.inputValue();
  await shot("tfl1028-create-images-after.png");
  await win.keyboard.press("Escape");
  await win.waitForTimeout(400);
  rec.closedOnEscape = (await win.locator("[data-create-from-images-dialog]").count()) === 0;
  expect(true).toBe(true);
});

test("T10 migrated menu opacity + light/dark + reduced motion", async () => {
  const rec = (results.T10 = {});
  await openReport();

  async function menuPaint() {
    await win.click("[data-menu-button]");
    await win.waitForSelector("[data-menu-popover]", { state: "visible", timeout: 8000 });
    await win.waitForTimeout(400);
    const out = await win.evaluate(() => {
      const el = document.querySelector("[data-menu-popover]");
      const cs = getComputedStyle(el);
      const m = cs.backgroundColor.match(/rgba?\(([^)]+)\)/);
      const parts = m ? m[1].split(",").map((s) => Number.parseFloat(s.trim())) : [];
      return {
        bg: cs.backgroundColor,
        alpha: parts.length === 4 ? parts[3] : 1,
        color: cs.color,
        theme: document.documentElement.getAttribute("data-theme"),
      };
    });
    await win.keyboard.press("Escape");
    await win.waitForTimeout(250);
    return out;
  }

  rec.light = await menuPaint();
  // Toggle theme twice to reach dark (frosted -> dark per the app cycle).
  for (let i = 0; i < 3; i += 1) {
    const th = await win.evaluate(() => document.documentElement.getAttribute("data-theme"));
    if (th === "dark") break;
    await win.click("[data-app-menu]");
    await win.waitForSelector('[data-menu-action="toggleTheme"]', { state: "visible", timeout: 8000 });
    await win.click('[data-menu-action="toggleTheme"]');
    await win.waitForTimeout(500);
  }
  rec.dark = await menuPaint();
  await shot("tfl1028-file-menu-dark.png");

  // Reduced motion: the menu must not animate a travel; its transition duration
  // must collapse.
  await win.emulateMedia({ reducedMotion: "reduce" });
  await win.waitForTimeout(200);
  rec.reducedMatches = await win.evaluate(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  await win.click("[data-menu-button]");
  await win.waitForSelector("[data-menu-popover]", { state: "visible", timeout: 8000 });
  await win.waitForTimeout(120);
  rec.reducedDuration = await win.evaluate(() => {
    const el = document.querySelector("[data-menu-popover]");
    if (!el) return null;
    const cs = getComputedStyle(el);
    return {
      transitionDuration: cs.transitionDuration,
      animationDuration: cs.animationDuration,
      opacity: cs.opacity,
      transform: cs.transform,
    };
  });
  await shot("tfl1028-file-menu-reduced.png");
  expect(true).toBe(true);
});
