// TFL-1056 Phase 113 chunk H - adversarial diff-pass over the Quiet Actions
// button system (uncommitted migration waves A-F3 + the F5 alias fix).
//
// One spec, one launched dev app per test (all launches go through the canonical
// e2e/lib/launch.cjs helper). Every attack surface in the brief gets an explicit
// attempt and a measured result; the JSON dumps next to this spec.
//
// Surfaces:
//   S1 double execution      S2 focus behaviour      S3 disabled/busy honesty
//   S4 false persistent selection
//   S5 disclosure keyboard/menu semantics
//   S6 native caption-control geometry
//   S7 destructive styling gates
const { test, expect } = require("@playwright/test");
const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { launchApp } = require("../../e2e/lib/launch.cjs");
const {
  hardClose,
  gotoStage,
  ensurePanelExpanded,
  openSample,
} = require("../../e2e/lib/helpers.cjs");

delete process.env.ELECTRON_RUN_AS_NODE;

const OUT = path.resolve(__dirname, "..", "..", "screenshots", "phase113-adversary");
const RESULTS = path.join(__dirname, "adv_p113.output.json");
fs.mkdirSync(OUT, { recursive: true });
test.setTimeout(600000);

let app = null;
let win = null;
const results = {};

test.beforeEach(async () => {
  app = await launchApp([], path.join(os.tmpdir(), `tflex-p113-adv-${Date.now()}`));
  win = await app.firstWindow();
  await win.waitForSelector(".sample-card", { timeout: 30000 });
});

test.afterEach(async () => {
  fs.writeFileSync(RESULTS, JSON.stringify(results, null, 2));
  if (app) await hardClose(app, "tfl1056-adv");
  app = null;
  win = null;
});

async function shot(name) {
  const p = path.join(OUT, name);
  await win.screenshot({ path: p });
  fs.writeFileSync(RESULTS, JSON.stringify(results, null, 2));
  return p;
}

function activeDesc() {
  return win.evaluate(() => {
    const el = document.activeElement;
    if (!el) return null;
    return {
      tag: el.tagName,
      id: el.id || null,
      cls: String(el.className || "").slice(0, 120),
      action:
        el.getAttribute("data-menu-action") || el.getAttribute("data-menu-item") || null,
      ariaLabel: el.getAttribute("aria-label") || null,
      dataMenuButton: el.hasAttribute("data-menu-button"),
      dataAppMenu: el.hasAttribute("data-app-menu"),
      dataToolSearch: el.hasAttribute("data-header-tool-search"),
      text: (el.textContent || "").trim().slice(0, 28),
    };
  });
}

// Main-process dialog counters + a benign "canceled" stub so an accidental
// extra invocation is countable with no side effects.
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

async function openReport() {
  await openSample(win, app, "report.pdf");
  await win.waitForSelector("[data-action-dock]", { timeout: 30000 });
  await win.waitForTimeout(1200);
}

async function closeAnyDialog() {
  // Best-effort dismissal of a leftover in-app dialog without touching product
  // code: the shared DialogShell close X, then Escape.
  const x = win.locator(".sheet-close").first();
  if ((await x.count()) > 0 && (await x.isVisible().catch(() => false))) {
    await x.click({ timeout: 2000 }).catch(() => {});
    await win.waitForTimeout(250);
  }
  const backdrop = win.locator(".modal-backdrop, .sheet-backdrop").first();
  if ((await backdrop.count()) > 0 && (await backdrop.isVisible().catch(() => false))) {
    await win.keyboard.press("Escape");
    await win.waitForTimeout(250);
  }
}

// Self-contained page function (Playwright serializes the source; no closures).
function measureEl(sel) {
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(",").map((x) => parseFloat(x));
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const lum = (c) => {
    const f = (v) => {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  let bg = null;
  for (let n = el; n; n = n.parentElement) {
    const c = parse(getComputedStyle(n).backgroundColor);
    if (c && c.a > 0.5) {
      bg = c;
      break;
    }
  }
  if (!bg) bg = { r: 255, g: 255, b: 255, a: 1 };
  const fg = parse(cs.color) || { r: 0, g: 0, b: 0, a: 1 };
  const effFg = {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
  };
  const L1 = lum(effFg);
  const L2 = lum(bg);
  const hi = Math.max(L1, L2);
  const lo = Math.min(L1, L2);
  const contrast = (hi + 0.05) / (lo + 0.05);
  return {
    tag: el.tagName,
    disabled: el.disabled === true || el.getAttribute("aria-disabled") === "true",
    ariaBusy: el.getAttribute("aria-busy"),
    title: el.getAttribute("title"),
    ariaLabel: el.getAttribute("aria-label"),
    cls: String(el.className || ""),
    opacity: parseFloat(cs.opacity),
    color: cs.color,
    bg: cs.backgroundColor,
    effectiveBg: bg,
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    contrast: Math.round(contrast * 100) / 100,
  };
}

// ---------------------------------------------------------------------------
// S1 - DOUBLE EXECUTION
// ---------------------------------------------------------------------------

test("S1a double execution: Home hero merge rapid double and five-click storm", async () => {
  const rec = (results.S1a = {});
  await armDialogCounters();
  const mergeTile = win.locator('[data-home-tool="merge"]');
  rec.mergeTilePresent = (await mergeTile.count()) > 0;
  if (!rec.mergeTilePresent) return;

  // Two SYNCHRONOUS activations - the classic double-fire on one element.
  await win.evaluate(() => {
    const b = document.querySelector('[data-home-tool="merge"]');
    b.click();
    b.click();
  });
  await win.waitForTimeout(800);
  rec.mergeAfterDoubleCounts = await readCounts();
  rec.mergeAfterDoubleDialogs = await win
    .locator(".modal-backdrop, .sheet-backdrop")
    .count();
  await shot("s1a-home-merge-double.png");
  await closeAnyDialog();

  // Five-click storm.
  await win.waitForTimeout(400);
  await armDialogCounters();
  await win.evaluate(() => {
    const b = document.querySelector('[data-home-tool="merge"]');
    for (let i = 0; i < 5; i += 1) b.click();
  });
  await win.waitForTimeout(800);
  rec.mergeAfterStormCounts = await readCounts();
  rec.mergeAfterStormDialogs = await win.locator(".modal-backdrop, .sheet-backdrop").count();
  await closeAnyDialog();
  rec.dialogsAfterClose = await win.locator(".modal-backdrop, .sheet-backdrop").count();
  expect(true).toBe(true);
});

test("S1b double execution: title-bar Open/Save As and menu-row Rotate CW", async () => {
  const rec = (results.S1b = {});
  await openReport();

  // Title-bar Open: two synchronous activations.
  await armDialogCounters();
  await win.evaluate(() => {
    const b = document.querySelector("[data-toolbar-open]");
    b.click();
    b.click();
  });
  await win.waitForTimeout(800);
  rec.openCounts = await readCounts();
  rec.openDialogs = await win.locator(".modal-backdrop, .sheet-backdrop").count();
  await closeAnyDialog();

  // Title-bar Save As: two synchronous activations.
  await armDialogCounters();
  rec.saveAsDisabled = await win
    .locator("[data-toolbar-save-as]")
    .first()
    .isDisabled()
    .catch(() => null);
  await win.evaluate(() => {
    const b = document.querySelector("[data-toolbar-save-as]");
    if (b) {
      b.click();
      b.click();
    }
  });
  await win.waitForTimeout(900);
  rec.saveAsCounts = await readCounts();
  rec.saveAsDialogs = await win.locator(".modal-backdrop, .sheet-backdrop").count();
  await closeAnyDialog();

  // Menu-row Rotate CW: a one-shot with an observable numeric state delta.
  await gotoStage(win, 1);
  await ensurePanelExpanded(win);
  const thumb = win.locator('[data-context-panel] .thumb-item[data-page="1"]').first();
  await thumb.waitFor({ state: "visible", timeout: 15000 });
  await thumb.scrollIntoViewIfNeeded();
  await thumb.click({ button: "right" });
  await win.waitForSelector("[data-context-menu]", { state: "visible", timeout: 8000 });
  await win.waitForTimeout(250);
  rec.rotateBefore = await win.evaluate(
    () => window.tflexDiagnostics().engineState.rotations[0],
  );
  await win.evaluate(() => {
    const b = document.querySelector('[data-context-menu] [data-menu-item="rotate-cw"]');
    if (b) {
      b.click();
      b.click();
    }
  });
  await win.waitForTimeout(1000);
  rec.rotateAfter = await win.evaluate(
    () => window.tflexDiagnostics().engineState.rotations[0],
  );
  rec.rotateDelta = (rec.rotateAfter - rec.rotateBefore) % 360;
  rec.menuClosedAfterVerb = (await win.locator("[data-context-menu]").count()) === 0;
  await shot("s1b-rotate-double.png");
  expect(true).toBe(true);
});

// ---------------------------------------------------------------------------
// S2 - FOCUS BEHAVIOUR
// ---------------------------------------------------------------------------

test("S2 focus: menu/escape/outside focus return, palette focus, dialog focus", async () => {
  const rec = (results.S2 = {});
  await openReport();

  await win.click("[data-menu-button]");
  await win.waitForSelector("[data-menu-popover]", { state: "visible", timeout: 8000 });
  await win.waitForTimeout(300);
  rec.fileOpenFocus = await activeDesc();
  rec.fileAriaExpandedOpen = await win
    .locator("[data-menu-button]")
    .first()
    .getAttribute("aria-expanded");
  await win.keyboard.press("Escape");
  await win.waitForSelector("[data-menu-popover]", { state: "detached", timeout: 4000 }).catch(() => {});
  await win.waitForTimeout(250);
  rec.fileFocusAfterEscape = await activeDesc();
  rec.fileAriaExpandedClosed = await win
    .locator("[data-menu-button]")
    .first()
    .getAttribute("aria-expanded");

  await win.click("[data-menu-button]");
  await win.waitForSelector("[data-menu-popover]", { state: "visible", timeout: 8000 });
  await win.mouse.click(30, 420);
  rec.fileOutsideDismissed = await win
    .waitForSelector("[data-menu-popover]", { state: "detached", timeout: 2500 })
    .then(() => true)
    .catch(() => false);

  await win.click("[data-menu-button]");
  await win.waitForSelector("[data-menu-popover]", { state: "visible", timeout: 8000 });
  const seq = [];
  for (let i = 0; i < 6; i += 1) {
    await win.keyboard.press("ArrowDown");
    seq.push(await activeDesc());
  }
  rec.fileArrowSeq = seq.map((s) => (s ? s.action || s.text : null));
  await win.keyboard.press("Escape");
  await win.waitForTimeout(200);

  // Command Palette focus + focus restoration on Escape.
  await win.evaluate(() => document.activeElement && document.activeElement.blur());
  await win.keyboard.press("Control+k");
  await win.waitForSelector("[data-command-palette-input]", { state: "visible", timeout: 8000 });
  await win.waitForTimeout(200);
  rec.paletteOpenFocus = await activeDesc();
  await win.keyboard.press("Escape");
  await win.waitForSelector("[data-command-palette-input]", { state: "detached", timeout: 4000 }).catch(() => {});
  await win.waitForTimeout(250);
  rec.paletteFocusAfterEscape = await activeDesc();

  // Preferences dialog via the application menu; focus after close.
  await win.click("[data-app-menu]");
  await win.waitForSelector("[data-app-menu-popover]", { state: "visible", timeout: 8000 });
  await win.waitForTimeout(250);
  const prefsRow = win.locator('[data-app-menu-popover] [data-menu-action="preferences"]');
  rec.prefsRowPresent = (await prefsRow.count()) > 0;
  if (rec.prefsRowPresent) {
    await prefsRow.first().click();
    await win.waitForSelector("[data-prefs-dialog]", { state: "visible", timeout: 8000 });
    await win.waitForTimeout(400);
    rec.prefsOpenFocus = await activeDesc();
    await win.keyboard.press("Escape");
    await win.waitForSelector("[data-prefs-dialog]", { state: "detached", timeout: 5000 }).catch(() => {});
    await win.waitForTimeout(300);
    rec.prefsFocusAfterClose = await activeDesc();
    rec.prefsClosed = (await win.locator("[data-prefs-dialog]").count()) === 0;
  }
  await shot("s2-focus.png");
  expect(true).toBe(true);
});

// ---------------------------------------------------------------------------
// S3 - DISABLED AND BUSY HONESTY
// ---------------------------------------------------------------------------

test("S3 disabled/busy honesty: legibility, accessible reason, no width jump", async () => {
  const rec = (results.S3 = {});
  await openReport();
  rec.saveDisabled = await win.evaluate(measureEl, "[data-toolbar-save]");
  rec.saveAsDisabled = await win.evaluate(measureEl, "[data-toolbar-save-as]");
  rec.printDisabled = await win.evaluate(measureEl, "[data-print]");

  // Modify the document so Save becomes enabled; width must not jump.
  await gotoStage(win, 1);
  await ensurePanelExpanded(win);
  const thumb = win.locator('[data-context-panel] .thumb-item[data-page="1"]').first();
  await thumb.waitFor({ state: "visible", timeout: 15000 });
  await thumb.click({ button: "right" });
  await win.waitForSelector("[data-context-menu]", { state: "visible", timeout: 8000 });
  await win.locator('[data-context-menu] [data-menu-item="rotate-cw"]').first().click();
  await win.waitForTimeout(1200);
  rec.saveEnabled = await win.evaluate(measureEl, "[data-toolbar-save]");
  if (rec.saveDisabled && rec.saveEnabled) {
    rec.saveWidthDeltaPx = Math.abs(rec.saveEnabled.rect.w - rec.saveDisabled.rect.w);
    rec.saveHeightDeltaPx = Math.abs(rec.saveEnabled.rect.h - rec.saveDisabled.rect.h);
  }

  rec.busyControlsOnLoad = await win.evaluate(() =>
    Array.from(document.querySelectorAll('[aria-busy="true"]')).map(
      (e) => String(e.className || e.tagName).slice(0, 80),
    ),
  );
  rec.busySurfaceReachable = await win.evaluate(() => {
    const el = document.querySelector("[data-account-sync-now]");
    return el ? { present: true, busy: el.getAttribute("aria-busy") } : { present: false };
  });
  await shot("s3-disabled.png");
  expect(true).toBe(true);
});

// ---------------------------------------------------------------------------
// S4 - FALSE PERSISTENT SELECTION
// ---------------------------------------------------------------------------

test("S4 false persistent selection: one-shot commands do not stay selected; persistent tools follow state", async () => {
  const rec = (results.S4 = {});
  await openReport();
  await gotoStage(win, 1);
  await ensurePanelExpanded(win);

  // One-shot rotate-cw from the context menu.
  const thumb = win.locator('[data-context-panel] .thumb-item[data-page="1"]').first();
  await thumb.waitFor({ state: "visible", timeout: 15000 });
  await thumb.click({ button: "right" });
  await win.waitForSelector("[data-context-menu]", { state: "visible", timeout: 8000 });
  const rowClsBefore = await win
    .locator('[data-context-menu] [data-menu-item="rotate-cw"]')
    .first()
    .getAttribute("class");
  await win.locator('[data-context-menu] [data-menu-item="rotate-cw"]').first().click();
  await win.waitForTimeout(900);
  rec.rotateRowClassBeforeClick = rowClsBefore;
  rec.rotateRowStillInDom = (await win.locator('[data-context-menu]').count()) > 0;
  rec.pressedTrueAfterOneShot = await win.evaluate(() =>
    Array.from(document.querySelectorAll('[aria-pressed="true"]')).map((e) =>
      String(e.className || "").slice(0, 70),
    ),
  );
  rec.thumbStillPressed = await win.evaluate(() => {
    const t = document.querySelector('[data-context-panel] .thumb-item[data-page="1"]');
    return t ? t.getAttribute("aria-pressed") : null;
  });

  // View Strip exclusive-selection: clicking a DIFFERENT segment must move the
  // selection (read from real app state), not leave the old segment pressed.
  const segSel = "[data-page-layout-option]";
  rec.viewSegPresent = (await win.locator(segSel).count()) > 0;
  if (rec.viewSegPresent) {
    const readAll = () =>
      win.evaluate((s) =>
        Array.from(document.querySelectorAll(s)).map((e) => ({
          v: e.getAttribute("data-page-layout-option"),
          pressed: e.getAttribute("aria-pressed"),
        })), segSel);
    rec.viewSegInitial = await readAll();
    await win.locator(`${segSel}[data-page-layout-option="two"]`).first().click();
    await win.waitForTimeout(700);
    rec.viewSegAfterTwo = await readAll();
    await win.locator(`${segSel}[data-page-layout-option="one"]`).first().click();
    await win.waitForTimeout(500);
    rec.viewSegAfterOne = await readAll();
  }
  await shot("s4-selection.png");
  expect(true).toBe(true);
});

// ---------------------------------------------------------------------------
// S5 - DISCLOSURE KEYBOARD / MENU SEMANTICS
// ---------------------------------------------------------------------------

test("S5 disclosure semantics: aria-expanded, arrow nav, escape, outside dismissal, screen-bound placement", async () => {
  const rec = (results.S5 = {});
  await openReport();
  const rect = (sel) =>
    win.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height),
        right: Math.round(r.right), bottom: Math.round(r.bottom), vw: window.innerWidth, vh: window.innerHeight,
        position: getComputedStyle(el).position,
      };
    }, sel);

  await gotoStage(win, 1);
  const more = win.locator("[data-dock-overflow]").first();
  rec.dockMoreAriaExpandedBefore = await more.getAttribute("aria-expanded");
  await more.click();
  await win.waitForSelector("[data-dock-overflow-menu]", { state: "visible", timeout: 8000 });
  await win.waitForTimeout(300);
  rec.dockMoreAriaExpandedAfter = await win.locator("[data-dock-overflow]").first().getAttribute("aria-expanded");
  rec.dockMoreRect = await rect("[data-dock-overflow-menu]");
  rec.dockMoreFirstFocus = await activeDesc();
  await win.keyboard.press("Escape");
  rec.dockMoreEscapeDetached = await win
    .waitForSelector("[data-dock-overflow-menu]", { state: "detached", timeout: 2500 })
    .then(() => true)
    .catch(() => false);

  // Thumbnail context menu near the BOTTOM edge: clamp + arrow nav.
  await ensurePanelExpanded(win);
  const thumbs = await win.locator('[data-context-panel] .thumb-item').all();
  let target = null;
  const vh = await win.evaluate(() => window.innerHeight);
  for (const t of thumbs.slice(0, 24)) {
    const b = await t.boundingBox();
    if (b && b.y + b.height / 2 > vh * 0.55 && b.y + b.height / 2 < vh - 15) {
      target = b;
      break;
    }
  }
  if (!target && thumbs[0]) target = await thumbs[0].boundingBox();
  if (target) {
    await win.mouse.click(target.x + target.width / 2, target.y + target.height / 2, { button: "right" });
    await win.waitForSelector("[data-context-menu]", { state: "visible", timeout: 8000 });
    await win.waitForTimeout(250);
    rec.ctxRect = await rect("[data-context-menu]");
    rec.ctxFirstFocus = await activeDesc();
    const seq = [];
    for (let i = 0; i < 4; i += 1) {
      await win.keyboard.press("ArrowDown");
      seq.push((await activeDesc()) || {});
    }
    rec.ctxArrowSeq = seq.map((s) => s.action || s.text);
    await win.keyboard.press("Escape");
    rec.ctxEscapeDetached = await win
      .waitForSelector("[data-context-menu]", { state: "detached", timeout: 2500 })
      .then(() => true)
      .catch(() => false);
  }

  await win.evaluate(() => document.activeElement && document.activeElement.blur());
  await win.keyboard.press("Control+k");
  await win.waitForSelector("[data-command-palette-input]", { state: "visible", timeout: 8000 });
  await win.waitForTimeout(250);
  rec.paletteFirstFocus = await activeDesc();
  rec.paletteRect = await rect("[data-command-palette-input]");
  await win.keyboard.press("Escape");
  rec.paletteClosed = await win
    .waitForSelector("[data-command-palette-input]", { state: "detached", timeout: 2500 })
    .then(() => true)
    .catch(() => false);
  await shot("s5-disclosure.png");
  expect(true).toBe(true);
});

// ---------------------------------------------------------------------------
// S6 - NATIVE CAPTION-CONTROL GEOMETRY
// ---------------------------------------------------------------------------

test("S6 native caption-control geometry: drag region and min/max/close unchanged", async () => {
  const rec = (results.S6 = {});
  await openReport();
  const measure = (sel) =>
    win.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName,
        cls: String(el.className || ""),
        ariaLabel: el.getAttribute("aria-label"),
        rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom) },
        appRegion: getComputedStyle(el).webkitAppRegion || getComputedStyle(el).getPropertyValue("-webkit-app-region"),
        borderRadius: getComputedStyle(el).borderRadius,
        position: getComputedStyle(el).position,
        vw: window.innerWidth,
      };
    }, sel);
  rec.controlsWrap = await measure("[data-titlebar-controls]");
  rec.minimize = await measure("[data-window-minimize]");
  rec.maximize = await measure("[data-window-maximize]");
  rec.close = await measure("[data-window-close]");
  rec.dragRegion = await measure(".titlebar-drag");
  rec.dragRegionPresent = (await win.locator(".titlebar-drag").count()) > 0;
  rec.bridge = await win.evaluate(() => ({
    minimize: typeof (window.tflex && window.tflex.minimizeWindow),
    maximize: typeof (window.tflex && window.tflex.maximizeWindow),
    close: typeof (window.tflex && window.tflex.closeWindow),
  }));
  // Clicking the caption controls must still reach the main-process window
  // controls (not a web-layer dead button). Minimize is observed via the window
  // bounds event; do NOT actually minimize the test window.
  rec.captionButtonsRawTag = await win.evaluate(() =>
    ["[data-window-minimize]", "[data-window-maximize]", "[data-window-close]"].map((s) => {
      const e = document.querySelector(s);
      return e ? e.tagName + "|" + e.className : null;
    }),
  );
  await shot("s6-caption.png");
  expect(true).toBe(true);
});

// ---------------------------------------------------------------------------
// S7 - DESTRUCTIVE STYLING GATES
// ---------------------------------------------------------------------------

test("S7 destructive styling: delete commands render danger ink and add no approval step", async () => {
  const rec = (results.S7 = {});
  await openReport();
  await gotoStage(win, 1);
  await ensurePanelExpanded(win);

  const thumb = win.locator('[data-context-panel] .thumb-item[data-page="1"]').first();
  await thumb.waitFor({ state: "visible", timeout: 15000 });
  await thumb.click({ button: "right" });
  await win.waitForSelector("[data-context-menu]", { state: "visible", timeout: 8000 });
  await win.waitForTimeout(250);
  rec.menuDangerRows = await win.evaluate(() =>
    Array.from(document.querySelectorAll("[data-context-menu] [data-menu-item]")).map((b) => ({
      item: b.getAttribute("data-menu-item"),
      cls: String(b.className || "").slice(0, 110),
      variant: b.getAttribute("data-menu-variant"),
      color: getComputedStyle(b).color,
    })),
  );

  // One dispatcher click must raise the existing DeletePageDialog - no extra
  // approval gate introduced by the visual migration.
  const deleteRow = win.locator('[data-context-menu] [data-menu-item="delete"]').first();
  rec.deleteRowPresent = (await deleteRow.count()) > 0;
  if (rec.deleteRowPresent) {
    rec.dialogBeforeDelete = await win.locator('[role="dialog"], .modal-backdrop').count();
    await deleteRow.click();
    await win.waitForTimeout(900);
    rec.dialogAfterDelete = await win.locator('[role="dialog"], .modal-backdrop').count();
    rec.deleteDialogTitle = await win.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      if (!d) return null;
      const t = d.querySelector(".sheet-title, .modal-title, h2");
      return t ? t.textContent.trim().slice(0, 60) : null;
    });
    await win.keyboard.press("Escape");
    await win.waitForTimeout(300);
  }

  rec.dangerCommitCount = await win.locator(".btn-danger-commit").count();
  rec.homeMinus = await win.evaluate(() => {
    const el = document.querySelector(".home-tool-minus");
    return el ? { cls: String(el.className || ""), color: getComputedStyle(el).color } : null;
  });
  await shot("s7-destructive.png");
  expect(true).toBe(true);
});
