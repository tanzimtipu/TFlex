// ADV phase-19 gate — item 5: MRU abuse via settings.json.
// Writes a crafted settings.json into a fresh --user-data-dir, launches the dev
// build, opens report.pdf and reports the visible five + whether the app
// survives. Scenario g marks settings.json read-only and arms a tool.
// Usage: node test-fixtures/tools/adv045_settings_mru.cjs
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { execSync } = require("node:child_process");
const { launchApp, getSamplePath } = require("../../e2e/lib/launch.cjs");
const { hardClose } = require("../../e2e/lib/helpers.cjs");

const CANON = ["select", "highlight", "underline", "strikeout", "ink", "textbox", "rect", "ellipse", "arrow", "callout", "note"];

function log(label, obj) {
  console.log(`[adv045s] ${label} ${JSON.stringify(obj)}`);
}

async function openReport(app, win) {
  const p = getSamplePath("report.pdf");
  await app.evaluate(async ({ dialog }, fp) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fp] });
  }, p);
  await win.locator('button:has-text("Open PDF")').first().click();
  await win.waitForSelector(".workspace", { timeout: 30000 });
  await win.waitForSelector(".pdf-page canvas", { timeout: 30000 });
  await win.waitForTimeout(500);
}

async function visibleIds(win) {
  return win.$$eval("[data-ann-tools-visible] [data-tool]", (els) => els.map((e) => e.getAttribute("data-tool")));
}

function makeUdd(name) {
  const dir = path.join(os.tmpdir(), `adv045s-${name}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function runScenario(name, rawValue, opts = {}) {
  const udd = makeUdd(name);
  const settingsPath = path.join(udd, "settings.json");
  fs.writeFileSync(settingsPath, JSON.stringify({ annotationRecentTools: rawValue, theme: "frosted" }, null, 2), "utf8");
  if (opts.readOnly) {
    try { execSync(`attrib +R "${settingsPath}"`); } catch (e) { log(`${name}-attrib`, { err: e.message }); }
  }
  const before = fs.readFileSync(settingsPath, "utf8");

  let app = null;
  const result = { name, raw: rawValue, launched: false, workspace: false, visible: null, persistedAfter: null, rejections: [], pageErrors: [], alive: false, settingsUnchanged: null };
  try {
    app = await launchApp([], udd, null);
    const win = await app.firstWindow();
    win.on("pageerror", (e) => result.pageErrors.push(String(e.message).split("\n")[0]));
    await win.waitForSelector(".sample-card", { timeout: 30000 });
    result.launched = true;
    await win.evaluate(() => {
      window.__advRejections = [];
      window.addEventListener("unhandledrejection", (e) => {
        try { window.__advRejections.push(String((e && e.reason && e.reason.message) || (e && e.reason) || "unknown")); } catch (_) { /* ignore */ }
      });
    }).catch(() => {});
    await openReport(app, win);
    result.workspace = true;
    result.visible = await visibleIds(win);
    if (opts.arm) {
      await win.click(`[data-ann-tools-visible] [data-tool="${opts.arm}"]`);
      await win.waitForTimeout(1200);
    }
    result.rejections = await win.evaluate(() => window.__advRejections || []).catch(() => []);
    result.activeTool = await win.evaluate(() => window.tflexDiagnostics().activeTool).catch(() => "diag-failed");
    // DEF-230 retest — post-arm observable state: did the optimistic MRU change
    // survive, and did the writeError toast fire?
    result.visibleAfterArm = await visibleIds(win).catch(() => null);
    result.toasts = await win.$$eval('.toast-text', (els) => els.map((e) => (e.textContent || '').trim())).catch(() => []);
    result.errorToasts = await win.$$eval('.toast-error .toast-text', (els) => els.map((e) => (e.textContent || '').trim())).catch(() => []);
    result.settingsLoaded = await win.evaluate(async () => {
      try { return await window.tflex.loadSettings(); } catch (e) { return { threw: String(e.message) }; }
    }).catch((e) => ({ evaluateFailed: String(e.message) }));
    // still interactive?
    await win.click("[data-ann-dropdown-toggle]");
    await win.waitForSelector("[data-ann-dropdown-menu]", { state: "visible", timeout: 5000 });
    result.alive = true;
    await win.keyboard.press("Escape");
    await win.waitForTimeout(300);
    try {
      result.persistedAfter = fs.readFileSync(settingsPath, "utf8");
      result.settingsUnchanged = result.persistedAfter === before;
    } catch (e) { result.settingsUnchanged = `read-failed: ${e.message}`; }

    // DEF-230 — observe the BACKEND in-memory rollback directly: clear the
    // read-only bit, force a fresh successful save whose payload merges
    // `this.current` (addRecentFile), then read annotationRecentTools back. If
    // _doSave restored `this.current` to `this.persisted`, the failed promotion
    // is absent; if it kept the failed value, the promotion is written.
    if (opts.readOnly) {
      try { execSync(`attrib -R "${settingsPath}"`); } catch (_) { /* ignore */ }
      await win.evaluate(async () => {
        try {
          await window.tflex.addRecentFile({ path: 'C:\\qa\\rollback-probe.pdf', name: 'rollback-probe.pdf', openedAt: new Date().toISOString() });
        } catch (_) { /* ignore */ }
      });
      await win.waitForTimeout(700);
      try {
        const after = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
        result.rollbackProbe = after.annotationRecentTools === undefined ? 'absent' : after.annotationRecentTools;
      } catch (e) { result.rollbackProbe = `read-failed: ${e.message}`; }
    }
  } catch (e) {
    result.error = String(e.message).split("\n")[0];
  } finally {
    if (opts.readOnly) {
      try { execSync(`attrib -R "${settingsPath}"`); } catch (_) { /* ignore */ }
    }
    if (app) await hardClose(app, `adv045s-${name}`);
  }
  log(`scenario-${name}`, result);
  return result;
}

async function main() {
  // Optional argv[2] prefix filter (e.g. `g` for scenario g-readonly).
  const only = process.argv[2] || null;
  const run = (name, fn) => (only === null || name.startsWith(only) ? fn() : Promise.resolve());
  await run("a-100-valid", () => runScenario("a-100-valid", Array.from({ length: 100 }, (_, i) => CANON[i % CANON.length])));
  await run("b-garbage", () => runScenario("b-garbage", ["zzz", "not-a-tool", "<script>alert(1)</script>", 42, null, {}, "select", true]));
  await run("c-duplicates", () => runScenario("c-duplicates", ["ink", "ink", "select", "select", "ink", "select"]));
  await run("d-non-array", () => runScenario("d-non-array", "highlight"));
  await run("e-proto", () => runScenario("e-proto", ["__proto__", "constructor", "select", "highlight"]));
  await run("f-order", () => runScenario("f-order", ["note", "callout", "arrow", "ellipse", "rect", "textbox"]));
  await run("g-readonly", () => runScenario("g-readonly", {}, { readOnly: true, arm: "highlight" }));
}

main().catch((e) => {
  console.error("[adv045s] FATAL", e && e.stack ? e.stack : e);
  process.exit(1);
});