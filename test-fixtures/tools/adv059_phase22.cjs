// ADV phase-22 gate — attack the title-bar relocation of Open / Save / Save As
// into the caption strip. Sections (argv[2]):
//   region  — computed -webkit-app-region matrix, click-through and window-drag
//             leak probes across the three themes and 640/1440.
//   accel   — Ctrl+S / Ctrl+Shift+S / Ctrl+O single-vs-double invocation,
//             measuring both the renderer keydown branch and the native menu
//             accelerator (menu:action) plus engine IPC counts.
//   state   — welcome-screen no-ops and two-tab active-state matrix.
//   width   — the 900/700 width bands, tab visibility and hit-testing.
//   tabs    — tab strip interaction alongside the relocated group.
//   persist — read-only / modified / clean state ladder.
//   a11y    — accessible names + focus order through the caption strip.
//   silence — every introduced control clicked with state inspection.
//
// Usage: node test-fixtures/tools/adv059_phase22.cjs <section|all>
// Requires the dev bundle (dist/): `npm.cmd run build` first.
// Canonical launcher only (../../e2e/lib/launch.cjs). Never edits product code.
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { launchApp, getSamplePath } = require("../../e2e/lib/launch.cjs");
const { hardClose } = require("../../e2e/lib/helpers.cjs");

const ROOT = path.resolve(__dirname, "..", "..");
const SHOTS = path.join(ROOT, "screenshots");
fs.mkdirSync(SHOTS, { recursive: true });

function log(label, obj) {
  console.log(`[adv059] ${label} ${JSON.stringify(obj)}`);
}
function round(n, d = 1) {
  return typeof n === "number" && Number.isFinite(n) ? +n.toFixed(d) : n;
}
function tmpCopy(name) {
  const p = path.join(os.tmpdir(), `adv059-${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
  fs.copyFileSync(path.join(ROOT, "assets", "samples", name), p);
  return p;
}

// ---------------------------------------------------------------------------
// shared helpers
// ---------------------------------------------------------------------------
async function setWindowSize(app, width, height) {
  await app.evaluate(({ BrowserWindow }, size) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) {
      if (w.isMaximized()) w.unmaximize();
      w.setSize(size.width, size.height);
    }
  }, { width, height });
  await new Promise((r) => setTimeout(r, 500));
}

async function resetWindowPos(app) {
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (!w) return;
    const b = w.getBounds();
    w.setBounds({ x: 90, y: 90, width: b.width, height: b.height });
  });
  await new Promise((r) => setTimeout(r, 250));
}

async function setTheme(win, want) {
  const cur = await win.evaluate(() => document.documentElement.getAttribute("data-theme"));
  if (cur === want) return;
  await win.click("[data-theme-toggle]");
  await win.waitForSelector(".theme-toggle-popover", { timeout: 5000 });
  await win.click(`[data-theme-option="${want}"]`);
  await win.waitForFunction((w) => document.documentElement.getAttribute("data-theme") === w, want, { timeout: 5000 });
  await win.waitForTimeout(350);
}

async function mockOpen(app, filePath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, filePath);
}

// Open a writable copy of report.pdf via the relocated title-bar Open control.
async function openWritable(app, win, src = "report.pdf") {
  const p = tmpCopy(src);
  await mockOpen(app, p);
  await win.click("[data-toolbar-open]");
  await win.waitForSelector(".workspace", { timeout: 30000 });
  await win.waitForSelector(".pdf-page canvas", { timeout: 30000 });
  await win.waitForTimeout(700);
  return p;
}

async function dirty(win) {
  const btn = win.locator('.tab-pane[aria-hidden="false"] [data-toolbar-rotate-cw]');
  if ((await btn.count()) > 0) {
    await btn.first().click();
  } else {
    await win.click("[data-toolbar-rotate-cw]");
  }
  await win.waitForTimeout(700);
}

async function openSecondTab(app, win) {
  const p = tmpCopy("report.pdf");
  await mockOpen(app, p);
  const before = await win.locator(".tab").count();
  await win.click("[data-toolbar-open]");
  await win.waitForFunction((n) => document.querySelectorAll(".tab").length > n, before, { timeout: 20000 }).catch(() => {});
  await win.waitForTimeout(1800);
  return p;
}

const REGION = (el) => (el ? getComputedStyle(el).getPropertyValue("-webkit-app-region") : null);

async function regionMatrix(win) {
  return win.evaluate(() => {
    const g = (el) => (el ? getComputedStyle(el).getPropertyValue("-webkit-app-region") : null);
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { l: +r.left.toFixed(1), t: +r.top.toFixed(1), r: +r.right.toFixed(1), b: +r.bottom.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
    };
    const q = (s) => document.querySelector(s);
    const openBtn = q("[data-toolbar-open]");
    const saveBtn = q("[data-toolbar-save]");
    const saBtn = q("[data-toolbar-save-as]");
    const group = q(".titlebar-file");
    return {
      titlebar: g(q(".titlebar")),
      appHeader: g(q(".app-header")),
      group: { region: g(group), rect: rect(group) },
      open: { region: g(openBtn), rect: rect(openBtn) },
      save: { region: g(saveBtn), rect: rect(saveBtn) },
      saveAs: { region: g(saBtn), rect: rect(saBtn) },
      openSvg: g(q("[data-toolbar-open] svg")),
      openLabel: g(q(".titlebar-file-label")),
      saveSvg: g(q("[data-toolbar-save] svg")),
      saveDot: g(q("[data-toolbar-save] .titlebar-file-dot")),
      sep: g(q(".titlebar-file-sep")),
      brand: g(q(".brand")),
      tabArea: { region: g(q(".tab-area")), rect: rect(q(".tab-area")) },
    };
  });
}

// Attempt a real press-move-release drag from a viewport point; report whether
// the OS window moved. A positive control on the known-drag brand area tells us
// whether CDP synthetic input can drive the native move loop at all.
async function dragFromPoint(app, win, x, y, dx, dy) {
  const before = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const b = w.getBounds();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  });
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + dx, y + dy, { steps: 14 });
  await win.waitForTimeout(120);
  await win.mouse.up();
  await win.waitForTimeout(300);
  const after = await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    const b = w.getBounds();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  });
  return {
    dx: after.x - before.x,
    dy: after.y - before.y,
    moved: after.x !== before.x || after.y !== before.y,
    before: { x: before.x, y: before.y },
    after: { x: after.x, y: after.y },
  };
}

async function center(win, sel) {
  const b = await win.locator(sel).first().boundingBox();
  if (!b) return null;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b };
}

async function saveState(win) {
  return win.evaluate(() => {
    const open = document.querySelector("[data-toolbar-open]");
    const save = document.querySelector("[data-toolbar-save]");
    const sa = document.querySelector("[data-toolbar-save-as]");
    const dot = save ? save.querySelector(".titlebar-file-dot") : null;
    const ds = dot ? getComputedStyle(dot) : null;
    const s = save ? getComputedStyle(save) : null;
    const inCommandBar = document.querySelectorAll(".toolbar [data-toolbar-open], .toolbar [data-toolbar-save], .toolbar [data-toolbar-save-as]").length;
    return {
      openDisabled: open ? open.disabled : null,
      saveDisabled: save ? save.disabled : null,
      saveTitle: save ? save.title : null,
      saveColor: s ? s.color : null,
      saveAsDisabled: sa ? sa.disabled : null,
      saveAsTitle: sa ? sa.title : null,
      dotOpacity: ds ? ds.opacity : null,
      dotVisibility: ds ? ds.visibility : null,
      dupInCommandBar: inCommandBar,
      modified: window.tflexDiagnostics().modified,
      activeTabDot: (() => {
        const t = document.querySelector(".tab-active");
        const d = t ? t.querySelector(".tab-modified-dot") : null;
        return d ? getComputedStyle(d).opacity : null;
      })(),
    };
  });
}

async function dialogState(win) {
  return win.evaluate(() => ({
    saveAs: document.querySelectorAll("[data-save-as-dialog]").length,
    confirm: document.querySelectorAll("[data-save-as-confirm]").length,
    modals: document.querySelectorAll(".modal-dialog").length,
    toasts: [...document.querySelectorAll(".toast")].map((t) => (t.textContent || "").slice(0, 80)),
  }));
}

async function installAppCounters(app) {
  await app.evaluate(({ dialog }) => {
    globalThis.__advOpen = 0;
    globalThis.__advSave = 0;
    if (!globalThis.__advWrapped) {
      const oo = dialog.showOpenDialog.bind(dialog);
      dialog.showOpenDialog = async (...a) => { globalThis.__advOpen += 1; return oo(...a); };
      const ss = dialog.showSaveDialog.bind(dialog);
      dialog.showSaveDialog = async (...a) => { globalThis.__advSave += 1; return ss(...a); };
      globalThis.__advWrapped = true;
    }
  });
}
async function appCounts(app) {
  return app.evaluate(() => ({ open: globalThis.__advOpen || 0, save: globalThis.__advSave || 0 }));
}
async function resetAppCounts(app) {
  await app.evaluate(() => { globalThis.__advOpen = 0; globalThis.__advSave = 0; });
}

async function installRendererCounters(win) {
  await win.evaluate(() => {
    window.__adv = { menu: [], key: [], save: 0, saveAs: 0 };
    if (!window.__advSub) {
      try {
        if (window.tflex && window.tflex.menu && typeof window.tflex.menu.onAction === "function") {
          window.tflex.menu.onAction((a) => {
            try { window.__adv.menu.push(a && a.action ? a.action : String(a)); } catch (e) { /* ignore */ }
          });
          window.__advSub = true;
        }
      } catch (e) { /* ignore */ }
    }
    const eng = window.tflex && window.tflex.engine;
    if (eng && !eng.__advWrapped) {
      for (const m of ["save", "saveAs"]) {
        const orig = eng[m];
        if (typeof orig === "function") {
          eng[m] = function (...args) { window.__adv[m] += 1; return orig.apply(this, args); };
        }
      }
      eng.__advWrapped = true;
    }
    if (!window.__advKeySub) {
      window.addEventListener("keydown", (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key && e.key.toLowerCase() === "s") {
          window.__adv.key.push((e.shiftKey ? "Ctrl+Shift+S" : "Ctrl+S") + (e.defaultPrevented ? "|prevented" : "|notprevented"));
        }
      }, false);
      window.__advKeySub = true;
    }
  });
}
async function rendererCounts(win) {
  return win.evaluate(() => ({ menu: window.__adv.menu.slice(), key: window.__adv.key.slice(), save: window.__adv.save, saveAs: window.__adv.saveAs }));
}
async function resetRendererCounts(win) {
  await win.evaluate(() => { window.__adv = { menu: [], key: [], save: 0, saveAs: 0 }; });
}

// ---------------------------------------------------------------------------
// SECTION: REGION — app-region matrix + drag leak
// ---------------------------------------------------------------------------
async function sectionRegion(app, win) {
  console.log("\n=== REGION (app-region + window drag leak) ===");
  await openWritable(app, win);

  // Positive control first: does CDP synthetic input move the window from a
  // KNOWN drag region (the brand / strip padding)?
  const brand = await center(win, ".brand");
  const control = brand ? await dragFromPoint(app, win, brand.x, brand.y, 160, 90) : { error: "no brand box" };
  log("region-drag-positive-control-brand", control);
  await resetWindowPos(app);

  const combo = [];
  for (const [w, h] of [[1440, 900], [640, 600]]) {
    for (const theme of ["frosted", "light", "dark"]) {
      await setWindowSize(app, w, h);
      await setTheme(win, theme);
      const matrix = await regionMatrix(win);
      const out = { w, theme, titlebar: matrix.titlebar, appHeader: matrix.appHeader, group: matrix.group.region, open: matrix.open.region, save: matrix.save.region, saveAs: matrix.saveAs.region, openSvg: matrix.openSvg, openLabel: matrix.openLabel, sep: matrix.sep, tabArea: matrix.tabArea.region };

      // Big drag from each control -> would move the window if it leaked.
      for (const sel of ["[data-toolbar-open]", "[data-toolbar-save]", "[data-toolbar-save-as]"]) {
        const c = await center(win, sel);
        if (!c) { out[sel] = { error: "no box" }; continue; }
        const d = await dragFromPoint(app, win, c.x, c.y, 170, 80);
        out[sel] = { region: matrix[sel === "[data-toolbar-open]" ? "open" : sel === "[data-toolbar-save]" ? "save" : "saveAs"].region, dx: d.dx, dy: d.dy, moved: d.moved };
        if (d.moved) await resetWindowPos(app);
      }
      // Seam drags: capsule padding (left inner edge), Open|sep seam, sep|Save
      // seam, Save|SaveAs seam.
      const seams = await win.evaluate(() => {
        const q = (s) => document.querySelector(s);
        const r = (el) => (el ? el.getBoundingClientRect() : null);
        const g = r(q(".titlebar-file"));
        const o = r(q("[data-toolbar-open]"));
        const s = r(q("[data-toolbar-save]"));
        const sa = r(q("[data-toolbar-save-as]"));
        return {
          padLeft: g ? { x: g.left + 1.5, y: g.top + g.height / 2 } : null,
          openSep: o && s ? { x: o.right + 1, y: o.top + o.height / 2 } : null,
          saveSeam: s && sa ? { x: (s.right + sa.left) / 2, y: s.top + s.height / 2 } : null,
          padRight: g ? { x: g.right - 1.5, y: g.top + g.height / 2 } : null,
        };
      });
      out.seams = {};
      for (const [name, pt] of Object.entries(seams)) {
        if (!pt) { out.seams[name] = { error: "no point" }; continue; }
        const d = await dragFromPoint(app, win, pt.x, pt.y, 150, 70);
        out.seams[name] = { x: round(pt.x), y: round(pt.y), dx: d.dx, dy: d.dy, moved: d.moved };
        if (d.moved) await resetWindowPos(app);
      }
      combo.push(out);
    }
  }
  log("region-matrix", combo);

  // elementFromPoint hit test at each control centre.
  await setWindowSize(app, 1440, 900);
  await setTheme(win, "frosted");
  const hit = await win.evaluate(() => {
    const out = {};
    for (const sel of ["[data-toolbar-open]", "[data-toolbar-save]", "[data-toolbar-save-as]"]) {
      const el = document.querySelector(sel);
      if (!el) { out[sel] = { error: "missing" }; continue; }
      const r = el.getBoundingClientRect();
      const hitEl = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      out[sel] = { hitSelf: hitEl === el, hitClosest: hitEl ? hitEl.closest(sel) === el : false, hitTag: hitEl ? hitEl.tagName : null };
    }
    return out;
  });
  log("region-elementFromPoint", hit);
  await win.screenshot({ path: path.join(SHOTS, "adv059-region.png") }).catch(() => {});
}

// ---------------------------------------------------------------------------
// SECTION: ACCEL — single vs double invocation
// ---------------------------------------------------------------------------
async function sectionAccel(app, win) {
  console.log("\n=== ACCEL (accelerator single vs double invocation) ===");
  await openWritable(app, win);
  await dirty(win);
  await installAppCounters(app);
  await installRendererCounters(win);
  const base = await saveState(win);
  log("accel-baseline", { save: base.saveDisabled, saveAs: base.saveAsDisabled, modified: base.modified });

  async function pressCombo(keys) {
    await resetRendererCounts(win);
    await resetAppCounts(app);
    await win.keyboard.press(keys);
    await win.waitForTimeout(1200);
    const d = await dialogState(win);
    const rc = await rendererCounts(win);
    const ac = await appCounts(app);
    return { dialogs: d, renderer: rc, main: ac };
  }

  // 1) Ctrl+Shift+S once
  let r = await pressCombo("Control+Shift+S");
  log("accel-ctrl-shift-s-once", r);
  // close the dialog
  await win.keyboard.press("Escape").catch(() => {});
  await win.waitForTimeout(600);
  log("accel-after-escape", await dialogState(win));

  // 2) Ctrl+Shift+S five times back-to-back
  await resetRendererCounts(win);
  for (let i = 0; i < 5; i += 1) { await win.keyboard.press("Control+Shift+S"); await win.waitForTimeout(60); }
  await win.waitForTimeout(1000);
  log("accel-ctrl-shift-s-x5", { dialogs: await dialogState(win), renderer: await rendererCounts(win), main: await appCounts(app) });
  await win.keyboard.press("Escape").catch(() => {});
  await win.waitForTimeout(500);

  // 3) Ctrl+Shift+S held down ~1.2s (auto-repeat)
  await resetRendererCounts(win);
  await resetAppCounts(app);
  await win.keyboard.down("Control");
  await win.keyboard.down("Shift");
  await win.keyboard.down("s");
  await win.waitForTimeout(1200);
  await win.keyboard.up("s");
  await win.keyboard.up("Shift");
  await win.keyboard.up("Control");
  await win.waitForTimeout(900);
  log("accel-ctrl-shift-s-held", { dialogs: await dialogState(win), renderer: await rendererCounts(win), main: await appCounts(app) });
  await win.keyboard.press("Escape").catch(() => {});
  await win.waitForTimeout(500);

  // 4) Ctrl+S once on a dirty doc -> engine.save count
  const dirtyAgain = await win.evaluate(() => window.tflexDiagnostics().modified);
  log("accel-before-ctrl-s", { modified: dirtyAgain });
  r = await pressCombo("Control+s");
  log("accel-ctrl-s-once", { dialogs: r.dialogs, rendererMenu: r.renderer.menu, rendererKey: r.renderer.key, engineSave: r.renderer.save, engineSaveAs: r.renderer.saveAs, mainOpen: r.main.open, mainSave: r.main.save });

  // 5) Ctrl+S held ~1.2s
  await dirty(win);
  await resetRendererCounts(win);
  await resetAppCounts(app);
  await win.keyboard.down("Control");
  await win.keyboard.down("s");
  await win.waitForTimeout(1200);
  await win.keyboard.up("s");
  await win.keyboard.up("Control");
  await win.waitForTimeout(900);
  log("accel-ctrl-s-held", { dialogs: await dialogState(win), renderer: await rendererCounts(win), main: await appCounts(app) });

  // 6) Ctrl+O once / held -> OS open dialog count
  await resetRendererCounts(win);
  await resetAppCounts(app);
  await win.keyboard.press("Control+o");
  await win.waitForTimeout(900);
  log("accel-ctrl-o-once", { dialogs: await dialogState(win), renderer: await rendererCounts(win), main: await appCounts(app) });
  await win.keyboard.press("Escape").catch(() => {});
  await win.waitForTimeout(500);

  await resetRendererCounts(win);
  await resetAppCounts(app);
  await win.keyboard.down("Control");
  await win.keyboard.down("o");
  await win.waitForTimeout(1200);
  await win.keyboard.up("o");
  await win.keyboard.up("Control");
  await win.waitForTimeout(1000);
  log("accel-ctrl-o-held", { dialogs: await dialogState(win), renderer: await rendererCounts(win), main: await appCounts(app) });
  await win.keyboard.press("Escape").catch(() => {});

  // 7) typing inside an input: does Ctrl+Shift+S still route to Save As?
  const hasInput = await win.locator("[data-save-as-linearize]").count();
  if (hasInput === 0) {
    await win.click("[data-toolbar-save-as]").catch(() => {});
    await win.waitForSelector("[data-save-as-dialog]", { timeout: 6000 }).catch(() => {});
  }
  const focusInput = await win.evaluate(() => {
    const cb = document.querySelector("[data-save-as-linearize]");
    if (!cb) return false;
    cb.focus();
    return document.activeElement === cb;
  });
  log("accel-input-focus", { focusInput, dialogs: await dialogState(win) });
  await win.screenshot({ path: path.join(SHOTS, "adv059-accel.png") }).catch(() => {});
}

// ---------------------------------------------------------------------------
// SECTION: STATE — welcome no-ops + two-tab matrix
// ---------------------------------------------------------------------------
async function sectionState(app, win) {
  console.log("\n=== STATE (welcome no-ops + two-tab active matrix) ===");
  await win.waitForSelector(".sample-card", { timeout: 20000 });
  const welcome = await saveState(win);
  log("state-welcome-baseline", welcome);

  const before = await dialogState(win);
  await win.keyboard.press("Control+s");
  await win.waitForTimeout(500);
  await win.keyboard.press("Control+Shift+S");
  await win.waitForTimeout(500);
  await win.keyboard.press("Control+o");
  await win.waitForTimeout(700);
  await win.keyboard.press("Escape").catch(() => {});
  await win.waitForTimeout(400);
  const after = await dialogState(win);
  const errs = await win.evaluate(() => window.__advErrors || []);
  const pageErr = await win.evaluate(() => window.tflexDiagnostics().openTabs);
  log("state-welcome-keys", { before, after, openTabs: pageErr, errs });

  // click Save / Save As on welcome (both disabled)
  let clickErr = null;
  try {
    await win.click("[data-toolbar-save]", { timeout: 1500, force: true });
  } catch (e) { clickErr = String(e.message).split("\n")[0]; }
  try {
    await win.click("[data-toolbar-save-as]", { timeout: 1500, force: true });
  } catch (e) { clickErr = (clickErr || "") + " | " + String(e.message).split("\n")[0]; }
  await win.waitForTimeout(500);
  log("state-welcome-clicks", { clickErr, dialogs: await dialogState(win), openTabs: await win.evaluate(() => window.tflexDiagnostics().openTabs) });

  // Two tabs, dirty only the FIRST.
  await openWritable(app, win);
  await dirty(win);
  const tab1State = await saveState(win);
  await openSecondTab(app, win);
  const tab2State = await saveState(win);
  const tabInfo = await win.evaluate(() => ({
    tabCount: document.querySelectorAll(".tab").length,
    active: document.querySelector(".tab-active")?.getAttribute("data-tab-id") ?? null,
    titles: [...document.querySelectorAll(".tab-title")].map((t) => t.textContent.trim().slice(0, 40)),
  }));
  log("state-two-tab-diag", { tabInfo, tab1State, tab2State });

  // Rapid switch: click tab1 then tab2 then tab1, sampling save state each time.
  const tabs = await win.evaluate(() => [...document.querySelectorAll(".tab")].map((t) => t.getAttribute("data-tab-id")));
  const trace = [];
  for (let i = 0; i < 6; i += 1) {
    const id = tabs[i % tabs.length];
    if (!id) continue;
    await win.locator(`[data-tab-id="${id}"]`).click({ position: { x: 12, y: 12 } }).catch(() => {});
    await win.waitForTimeout(350);
    const s = await saveState(win);
    const act = await win.evaluate(() => document.querySelector(".tab-active")?.getAttribute("data-tab-id") ?? null);
    trace.push({ wanted: id, active: act, saveDisabled: s.saveDisabled, saveTitle: s.saveTitle, dot: s.dotOpacity, modified: s.modified });
  }
  log("state-rapid-switch-trace", trace);

  // Stale click: switch to the clean tab, then synchronously click Save As on
  // the same tick (React may not have re-rendered the header yet).
  const activeNow = await win.evaluate(() => document.querySelector(".tab-active")?.getAttribute("data-tab-id") ?? null);
  const cleanTab = tabs.find((t) => t && t !== activeNow) || activeNow;
  const stale = await win.evaluate((id) => {
    const t = document.querySelector(`[data-tab-id="${id}"]`);
    const before = document.querySelector(".tab-active")?.getAttribute("data-tab-id") ?? null;
    if (t) t.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    const sa = document.querySelector("[data-toolbar-save-as]");
    const saDisabled = sa ? sa.disabled : null;
    if (sa && !sa.disabled) sa.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return { targetTab: id, activeBefore: before, saDisabledAtClick: saDisabled };
  }, cleanTab);
  await win.waitForTimeout(700);
  log("state-stale-save-as-click", { stale, dialogs: await dialogState(win), activeAfter: await win.evaluate(() => document.querySelector(".tab-active")?.getAttribute("data-tab-id") ?? null) });
  await win.keyboard.press("Escape").catch(() => {});
  await win.screenshot({ path: path.join(SHOTS, "adv059-state.png") }).catch(() => {});
}

// ---------------------------------------------------------------------------
// SECTION: WIDTH — bands, tab visibility, hit testing
// ---------------------------------------------------------------------------
async function sectionWidth(app, win) {
  console.log("\n=== WIDTH (900/700 bands + tab visibility) ===");
  await openWritable(app, win);
  const widths = [1440, 1280, 1100, 1001, 901, 900, 899, 820, 720, 701, 700, 699, 680, 660, 645, 640];
  const rows = [];
  for (const w of widths) {
    await setWindowSize(app, w, 800);
    const m = await win.evaluate(() => {
      const r = (el) => {
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { l: +b.left.toFixed(1), r: +b.right.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) };
      };
      const q = (s) => document.querySelector(s);
      const ta = q(".tab-area");
      const tl = q(".tab-list");
      const tab = q(".tab");
      const openLabel = q(".titlebar-file-label");
      const themeLabel = q(".theme-toggle-label");
      const group = q(".titlebar-file");
      const disp = (el) => (el ? getComputedStyle(el).display : null);
      const groupR = group ? group.getBoundingClientRect() : null;
      const taR = ta ? ta.getBoundingClientRect() : null;
      const hit = {};
      for (const sel of ["[data-toolbar-open]", "[data-toolbar-save]", "[data-toolbar-save-as]", ".tab-new", ".tab"]) {
        const el = q(sel);
        if (!el) { hit[sel] = { missing: true }; continue; }
        const b = el.getBoundingClientRect();
        if (b.width < 1 || b.height < 1) { hit[sel] = { zero: true, w: +b.width.toFixed(1) }; continue; }
        const he = document.elementFromPoint(b.left + Math.min(b.width / 2, 10), b.top + b.height / 2);
        hit[sel] = { resolvesToSelf: he ? he.closest(sel) === el : false, hitClosest: he ? he.closest(sel)?.className?.slice?.(0, 40) ?? null : null };
      }
      return {
        vw: window.innerWidth,
        groupRight: groupR ? +groupR.right.toFixed(1) : null,
        tabAreaLeft: taR ? +taR.left.toFixed(1) : null,
        overlap: groupR && taR ? +(groupR.right - taR.left).toFixed(1) : null,
        tabAreaW: ta ? +ta.clientWidth.toFixed(1) : null,
        tabListW: tl ? +tl.clientWidth.toFixed(1) : null,
        tabListScrollW: tl ? +tl.scrollWidth.toFixed(1) : null,
        canScroll: tl ? tl.scrollWidth > tl.clientWidth + 1 : null,
        firstTab: r(tab),
        firstTabTitle: tab ? tab.querySelector(".tab-title")?.textContent.trim().slice(0, 30) ?? null : null,
        openLabelDisplay: disp(openLabel),
        themeLabelDisplay: disp(themeLabel),
        hit,
      };
    });
    rows.push({ w, ...m });
  }
  log("width-matrix", rows);

  // Band-boundary live resize with hover: set 901, hover Save, resize to 899
  // mid-hover, then click Open and confirm it activates (not swallowed).
  await setWindowSize(app, 901, 800);
  const saveBox = await center(win, "[data-toolbar-save]");
  if (saveBox) await win.mouse.move(saveBox.x, saveBox.y);
  await setWindowSize(app, 899, 800);
  await win.waitForTimeout(200);
  const openAfterResize = await center(win, "[data-toolbar-open]");
  let activated = null;
  if (openAfterResize) {
    await mockOpen(app, tmpCopy("report.pdf"));
    const beforeTabs = await win.locator(".tab").count();
    await win.mouse.click(openAfterResize.x, openAfterResize.y);
    await win.waitForTimeout(1500);
    activated = (await win.locator(".tab").count()) > beforeTabs;
  }
  log("width-boundary-click", { activated });

  // Theme label band check around 700.
  const bandTheme = [];
  for (const w of [701, 700]) {
    await setWindowSize(app, w, 800);
    bandTheme.push(await win.evaluate((width) => ({
      w: width,
      themeLabel: (() => { const e = document.querySelector(".theme-toggle-label"); return e ? getComputedStyle(e).display : null; })(),
      themeAria: document.querySelector("[data-theme-toggle]")?.getAttribute("aria-label") ?? null,
      themeTitle: document.querySelector("[data-theme-toggle]")?.title ?? null,
    }), w));
  }
  log("width-theme-band", bandTheme);

  // Keyboard reach of the icon-only Open at 640.
  await setWindowSize(app, 640, 800);
  const kb = await win.evaluate(() => {
    const o = document.querySelector("[data-toolbar-open]");
    return { name: o ? (o.getAttribute("aria-label") || o.textContent.trim()) : null, labelVisible: (() => { const l = o?.querySelector(".titlebar-file-label"); return l ? getComputedStyle(l).display !== "none" : null; })() };
  });
  log("width-open-keyboard-name", kb);
  await win.screenshot({ path: path.join(SHOTS, "adv059-width-640.png") }).catch(() => {});
  await setWindowSize(app, 900, 800);
  await win.screenshot({ path: path.join(SHOTS, "adv059-width-900.png") }).catch(() => {});
}

// ---------------------------------------------------------------------------
// SECTION: TABS — strip interaction beside the group
// ---------------------------------------------------------------------------
async function sectionTabs(app, win) {
  console.log("\n=== TABS (strip interaction) ===");
  await openWritable(app, win);
  await openSecondTab(app, win);
  await openSecondTab(app, win);
  const rows = [];
  for (const w of [1440, 900, 640]) {
    await setWindowSize(app, w, 800);
    const tabs = await win.evaluate(() => [...document.querySelectorAll(".tab")].map((t, i) => {
      const b = t.getBoundingClientRect();
      const he = b.width > 1 ? document.elementFromPoint(b.left + Math.min(b.width / 2, 14), b.top + b.height / 2) : null;
      return { i, id: t.getAttribute("data-tab-id"), active: t.classList.contains("tab-active"), w: +b.width.toFixed(1), left: +b.left.toFixed(1), right: +b.right.toFixed(1), hitsSelf: he ? he.closest(".tab") === t : false };
    }));
    const newBtn = await win.evaluate(() => {
      const el = document.querySelector(".tab-new");
      if (!el) return { missing: true };
      const b = el.getBoundingClientRect();
      const he = b.width > 1 ? document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2) : null;
      return { w: +b.width.toFixed(1), left: +b.left.toFixed(1), hitsSelf: he ? he.closest(".tab-new") === el : false };
    });
    rows.push({ w, tabs, newBtn });
  }
  log("tabs-hit-matrix", rows);

  // At 640 the "+" and the tab-close buttons sit beyond the scrolled viewport.
  // Can the user scroll the strip to reach them?
  const scrollProbe = [];
  for (const w of [640, 720, 901]) {
    await setWindowSize(app, w, 800);
    const before = await win.evaluate(() => {
      const tl = document.querySelector(".tab-list");
      const nb = document.querySelector(".tab-new");
      const b = nb ? nb.getBoundingClientRect() : null;
      const he = b && b.width > 1 ? document.elementFromPoint(b.left + Math.min(b.width / 2, 5), b.top + b.height / 2) : null;
      return { scrollLeft: tl ? tl.scrollLeft : null, scrollW: tl ? tl.scrollWidth : null, clientW: tl ? tl.clientWidth : null, newReachable: he ? he.closest(".tab-new") === nb : false };
    });
    await win.evaluate(() => { const tl = document.querySelector(".tab-list"); if (tl) tl.scrollLeft = 9999; });
    await win.waitForTimeout(300);
    const after = await win.evaluate(() => {
      const tl = document.querySelector(".tab-list");
      const nb = document.querySelector(".tab-new");
      const b = nb ? nb.getBoundingClientRect() : null;
      const he = b && b.width > 1 ? document.elementFromPoint(b.left + Math.min(b.width / 2, 5), b.top + b.height / 2) : null;
      return { scrollLeft: tl ? tl.scrollLeft : null, newReachable: he ? he.closest(".tab-new") === nb : false };
    });
    scrollProbe.push({ w, before, after });
    await win.evaluate(() => { const tl = document.querySelector(".tab-list"); if (tl) tl.scrollLeft = 0; });
  }
  log("tabs-scroll-probe", scrollProbe);

  // Newly-opened tab visibility: opening a document appends + activates a tab
  // at the strip's right end. Is it revealed automatically at narrow widths?
  const newVis = [];
  for (const w of [1440, 900, 640]) {
    await setWindowSize(app, w, 800);
    await win.evaluate(() => { const tl = document.querySelector(".tab-list"); if (tl) tl.scrollLeft = 0; });
    const before = await win.locator(".tab").count();
    const p = tmpCopy("report.pdf");
    await mockOpen(app, p);
    await win.click("[data-toolbar-open]");
    await win.waitForFunction((n) => document.querySelectorAll(".tab").length > n, before, { timeout: 20000 }).catch(() => {});
    await win.waitForTimeout(1200);
    const m = await win.evaluate(() => {
      const tl = document.querySelector(".tab-list");
      const active = document.querySelector(".tab-active");
      const ta = document.querySelector(".tab-area");
      const ar = active ? active.getBoundingClientRect() : null;
      const tr = ta ? ta.getBoundingClientRect() : null;
      return {
        count: document.querySelectorAll(".tab").length,
        scrollLeft: tl ? +tl.scrollLeft.toFixed(1) : null,
        scrollW: tl ? tl.scrollWidth : null,
        clientW: tl ? tl.clientWidth : null,
        activeLeft: ar ? +ar.left.toFixed(1) : null,
        activeRight: ar ? +ar.right.toFixed(1) : null,
        stripLeft: tr ? +tr.left.toFixed(1) : null,
        stripRight: tr ? +tr.right.toFixed(1) : null,
        activeFullyVisible: ar && tr ? ar.left >= tr.left - 1 && ar.right <= tr.right + 1 : null,
        activeStartsVisible: ar && tr ? ar.left < tr.right - 2 : null,
      };
    });
    newVis.push({ w, ...m });
  }
  log("tabs-new-tab-visibility", newVis);

  // Click each tab by index; verify active follows.
  const clickTrace = [];
  for (const w of [1440, 640]) {
    await setWindowSize(app, w, 800);
    for (let i = 0; i < 3; i += 1) {
      const id = await win.evaluate((idx) => [...document.querySelectorAll(".tab")][idx]?.getAttribute("data-tab-id") ?? null, i);
      if (!id) continue;
      await win.locator(`[data-tab-id="${id}"]`).click({ position: { x: 10, y: 10 }, timeout: 3000 }).catch(() => {});
      await win.waitForTimeout(300);
      const act = await win.evaluate(() => document.querySelector(".tab-active")?.getAttribute("data-tab-id") ?? null);
      clickTrace.push({ w, i, wanted: id, active: act, ok: id === act });
    }
  }
  log("tabs-click-trace", clickTrace);

  // "+" new tab at 640 and 1440
  const newTrace = [];
  for (const w of [640, 1440]) {
    await setWindowSize(app, w, 800);
    const before = await win.locator(".tab").count();
    await win.click(".tab-new", { timeout: 3000 }).catch(() => {});
    await win.waitForTimeout(700);
    newTrace.push({ w, before, after: await win.locator(".tab").count() });
  }
  log("tabs-new-tab-trace", newTrace);

  // Close a tab at 640.
  await setWindowSize(app, 640, 800);
  const beforeClose = await win.locator(".tab").count();
  await win.locator(".tab-close").first().click({ timeout: 3000 }).catch(() => {});
  await win.waitForTimeout(800);
  log("tabs-close-trace", { beforeClose, after: await win.locator(".tab").count() });
  await win.screenshot({ path: path.join(SHOTS, "adv059-tabs-640.png") }).catch(() => {});
}

// ---------------------------------------------------------------------------
// SECTION: PERSIST — state ladder
// ---------------------------------------------------------------------------
async function sectionPersist(app, win) {
  console.log("\n=== PERSIST (read-only / modified / clean) ===");
  // Read-only source: open a bundled sample through the welcome sample card.
  await win.waitForSelector(".sample-card", { timeout: 20000 });
  const cards = win.locator(".sample-card");
  const n = await cards.count();
  let roState = null;
  let roModified = null;
  if (n > 0) {
    await cards.first().click();
    await win.waitForSelector(".workspace", { timeout: 30000 });
    await win.waitForSelector(".pdf-page canvas", { timeout: 30000 });
    await win.waitForTimeout(900);
    roModified = await win.evaluate(() => window.tflexDiagnostics().modified);
    roState = await saveState(win);
  }
  log("persist-readonly-sample", { cardCount: n, state: roState, modified: roModified });

  // Dirty it -> Save must stay disabled for a bytes-loaded sample (no on-disk path).
  if (n > 0) {
    await dirty(win);
    const dirtyRO = await saveState(win);
    log("persist-readonly-dirty", dirtyRO);
    // Save As should be enabled.
    const sa = await center(win, "[data-toolbar-save-as]");
    let saDialog = null;
    if (sa) {
      await win.mouse.click(sa.x, sa.y);
      await win.waitForTimeout(700);
      saDialog = await dialogState(win);
    }
    log("persist-readonly-saveas", { saDialog });
    await win.keyboard.press("Escape").catch(() => {});
    await win.waitForTimeout(500);
  }

  // Writable source: modified -> dot + warning tint; save -> clean.
  const wp = await openWritable(app, win);
  const before = await saveState(win);
  await dirty(win);
  const dirtied = await saveState(win);
  await installAppCounters(app);
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, wp);
  // In-place Save (Ctrl+S) on the writable copy.
  await win.keyboard.press("Control+s");
  await win.waitForTimeout(1800);
  const cleaned = await saveState(win);
  log("persist-writable-ladder", { before, dirtied, cleaned, fileExists: fs.existsSync(wp) });
  await win.screenshot({ path: path.join(SHOTS, "adv059-persist.png") }).catch(() => {});
}

// ---------------------------------------------------------------------------
// SECTION: A11Y — names + focus order
// ---------------------------------------------------------------------------
async function sectionA11y(app, win) {
  console.log("\n=== A11Y (names + focus order) ===");
  await openWritable(app, win);
  const names = await win.evaluate(() => {
    const info = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return { missing: true };
      return {
        aria: el.getAttribute("aria-label"),
        title: el.getAttribute("title"),
        text: (el.textContent || "").trim().slice(0, 40),
        tag: el.tagName,
        disabled: el.disabled ?? null,
      };
    };
    const group = document.querySelector(".titlebar-file");
    return {
      groupRole: group ? group.getAttribute("role") : null,
      groupAria: group ? group.getAttribute("aria-label") : null,
      open: info("[data-toolbar-open]"),
      save: info("[data-toolbar-save]"),
      saveAs: info("[data-toolbar-save-as]"),
      theme: info("[data-theme-toggle]"),
    };
  });
  log("a11y-names", names);

  // Focus order: start at the title-bar menu button (the first focusable in the
  // caption strip) and Tab forward so the relocated controls are in the run.
  await dirty(win);
  await win.evaluate(() => {
    const start = document.querySelector(".titlebar-menu-button");
    if (start) start.focus();
  });
  const order = [];
  const startName = await win.evaluate(() => {
    const el = document.activeElement;
    return el ? (el.getAttribute("aria-label") || el.className) : null;
  });
  for (let i = 0; i < 12; i += 1) {
    await win.keyboard.press("Tab");
    await win.waitForTimeout(60);
    const f = await win.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      return {
        tag: el.tagName,
        aria: el.getAttribute("aria-label"),
        isOpen: el.hasAttribute("data-toolbar-open"),
        isSave: el.hasAttribute("data-toolbar-save"),
        isSaveAs: el.hasAttribute("data-toolbar-save-as"),
        txt: (el.textContent || "").trim().slice(0, 24),
        cls: (typeof el.className === "string" ? el.className : "").slice(0, 40),
      };
    });
    order.push(f);
  }
  log("a11y-focus-order", { startName, order });
  const focusable = await win.evaluate(() => {
    const out = {};
    for (const sel of ["[data-toolbar-open]", "[data-toolbar-save]", "[data-toolbar-save-as]"]) {
      const el = document.querySelector(sel);
      if (!el) { out[sel] = { missing: true }; continue; }
      el.focus();
      out[sel] = { canFocus: document.activeElement === el, tabIndex: el.tabIndex, disabled: el.disabled };
    }
    return out;
  });
  log("a11y-focusable", focusable);
  // Document order of the relocated group vs the tab strip.
  const domOrder = await win.evaluate(() => {
    const brand = document.querySelector(".brand");
    const group = document.querySelector(".titlebar-file");
    const tabs = document.querySelector(".tab-area");
    const cmp = (a, b) => {
      if (!a || !b) return null;
      return (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 ? "before" : "after";
    };
    return { brand_before_group: cmp(brand, group), group_before_tabs: cmp(group, tabs), group_before_tabsBtn: cmp(group, document.querySelector(".tab")) };
  });
  log("a11y-dom-order", domOrder);

  // Save As dialog Escape / Enter behaviour.
  await dirty(win);
  await win.keyboard.press("Control+Shift+S");
  await win.waitForSelector("[data-save-as-dialog]", { timeout: 6000 }).catch(() => {});
  const opened = await dialogState(win);
  await win.keyboard.press("Escape");
  await win.waitForTimeout(600);
  const afterEsc = await dialogState(win);
  // Reopen and press Enter -> confirm (would open OS save dialog; mock it).
  await app.evaluate(async ({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true }); });
  await win.keyboard.press("Control+Shift+S");
  await win.waitForSelector("[data-save-as-dialog]", { timeout: 6000 }).catch(() => {});
  const opened2 = await dialogState(win);
  await win.keyboard.press("Enter");
  await win.waitForTimeout(900);
  const afterEnter = await dialogState(win);
  log("a11y-saveas-keys", { opened, afterEsc, opened2, afterEnter });
}

// ---------------------------------------------------------------------------
// SECTION: CLEANACCEL — do the accelerators honour the clean-state disable?
// ---------------------------------------------------------------------------
async function sectionCleanAccel(app, win) {
  console.log("\n=== CLEANACCEL (Save As disabled vs accelerator) ===");
  const wp = await openWritable(app, win);
  await installAppCounters(app);
  await app.evaluate(async ({ dialog }, p) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }); }, wp + ".copy.pdf");

  // Make it dirty then save in place -> clean, on-disk path present.
  await dirty(win);
  await win.keyboard.press("Control+s");
  await win.waitForTimeout(1600);
  const clean = await saveState(win);
  log("cleanaccel-clean-state", clean);

  // Button click on the disabled Save As -> nothing.
  let clickErr = null;
  try { await win.click("[data-toolbar-save-as]", { timeout: 1500, force: true }); } catch (e) { clickErr = String(e.message).split("\n")[0]; }
  await win.waitForTimeout(500);
  log("cleanaccel-button-click", { clickErr, dialogs: await dialogState(win) });

  // Ctrl+Shift+S on a CLEAN doc.
  await win.keyboard.press("Control+Shift+S");
  await win.waitForTimeout(900);
  log("cleanaccel-ctrl-shift-s", { dialogs: await dialogState(win) });
  await win.keyboard.press("Escape").catch(() => {});
  await win.waitForTimeout(500);

  // Menu File -> Save As on a clean doc.
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) w.webContents.send("menu:action", { action: "saveAs" });
  });
  await win.waitForTimeout(900);
  log("cleanaccel-menu-saveas", { dialogs: await dialogState(win) });
  await win.keyboard.press("Escape").catch(() => {});
  await win.waitForTimeout(400);

  // Ctrl+S on the clean doc (does it re-save / toast?).
  const toastsBefore = (await dialogState(win)).toasts.length;
  await win.keyboard.press("Control+s");
  await win.waitForTimeout(1200);
  const after = await dialogState(win);
  log("cleanaccel-ctrl-s-clean", { toastsBefore, toasts: after.toasts, save: await saveState(win) });
  await win.screenshot({ path: path.join(SHOTS, "adv059-cleanaccel.png") }).catch(() => {});
}

// ---------------------------------------------------------------------------
// SECTION: STACK — Save As modal + a second accelerator-driven modal
// ---------------------------------------------------------------------------
async function sectionStack(app, win) {
  console.log("\n=== STACK (Save As modal + Ctrl+W close prompt) ===");
  await openWritable(app, win);
  await dirty(win);

  const modalInfo = () => win.evaluate(() => {
    const modals = [...document.querySelectorAll(".modal-dialog")].map((m) => ({
      saveAs: m.hasAttribute("data-save-as-dialog"),
      closePrompt: !!m.querySelector("[data-close-prompt]") || m.hasAttribute("data-close-prompt"),
      text: (m.textContent || "").replace(/\s+/g, " ").trim().slice(0, 70),
    }));
    const backdrops = document.querySelectorAll(".modal-backdrop").length;
    return { modals, backdrops, saveAs: document.querySelectorAll("[data-save-as-dialog]").length };
  });

  // 1) Open Save As, then Ctrl+W.
  await win.keyboard.press("Control+Shift+S");
  await win.waitForSelector("[data-save-as-dialog]", { timeout: 6000 }).catch(() => {});
  log("stack-after-saveas", await modalInfo());
  await win.keyboard.press("Control+w");
  await win.waitForTimeout(1000);
  log("stack-after-ctrl-w", await modalInfo());

  // 2) Escape presses: how many are needed and does the app recover?
  const escTrace = [];
  for (let i = 0; i < 4; i += 1) {
    await win.keyboard.press("Escape");
    await win.waitForTimeout(600);
    escTrace.push({ i, ...(await modalInfo()) });
  }
  log("stack-escape-trace", escTrace);

  // 3) Can the canvas be clicked / can a rotate click land?
  const recovered = await win.evaluate(() => ({
    backdrops: document.querySelectorAll(".modal-backdrop").length,
    activeEl: document.activeElement ? document.activeElement.tagName + ":" + (typeof document.activeElement.className === "string" ? document.activeElement.className.slice(0, 30) : "") : null,
    rotateHittable: (() => {
      const b = document.querySelector('.tab-pane[aria-hidden="false"] [data-toolbar-rotate-cw]');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      const he = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return he ? he.closest("[data-toolbar-rotate-cw]") === b : false;
    })(),
  }));
  log("stack-recovery", recovered);

  // 4) Ctrl+S while the Save As dialog is open.
  if ((await win.locator(".workspace").count()) === 0) await openWritable(app, win);
  await dirty(win);
  await win.keyboard.press("Control+Shift+S");
  await win.waitForSelector("[data-save-as-dialog]", { timeout: 6000 }).catch(() => {});
  await win.keyboard.press("Control+s");
  await win.waitForTimeout(900);
  log("stack-ctrl-s-with-saveas", { modals: await modalInfo(), dialogs: await dialogState(win) });

  // 5) Ctrl+O while the Save As dialog is open.
  await app.evaluate(async ({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true }); });
  await win.keyboard.press("Control+o");
  await win.waitForTimeout(900);
  log("stack-ctrl-o-with-saveas", { modals: await modalInfo(), dialogs: await dialogState(win) });
  await win.screenshot({ path: path.join(SHOTS, "adv059-stack.png") }).catch(() => {});
  for (let i = 0; i < 3; i += 1) { await win.keyboard.press("Escape").catch(() => {}); await win.waitForTimeout(300); }
}

// ---------------------------------------------------------------------------
// SECTION: RACE — hostile sequences around the relocated controls
// ---------------------------------------------------------------------------
async function sectionRace(app, win) {
  console.log("\n=== RACE (hostile sequences) ===");
  const wp = await openWritable(app, win);
  await installAppCounters(app);
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, wp);

  // (A) Ctrl+S then immediately Ctrl+W (close while save in flight).
  await dirty(win);
  await resetAppCounts(app);
  const tabsBefore = await win.locator(".tab").count();
  await win.keyboard.press("Control+s");
  await win.keyboard.press("Control+w");
  await win.waitForTimeout(2500);
  log("race-save-then-close", {
    tabsBefore,
    tabsAfter: await win.locator(".tab").count(),
    dialogs: await dialogState(win),
    diag: await win.evaluate(() => ({ openTabs: window.tflexDiagnostics().openTabs, modified: window.tflexDiagnostics().modified })),
  });
  await win.keyboard.press("Escape").catch(() => {});
  await win.waitForTimeout(600);
  // If a close-prompt opened, confirm discard to reset.
  const discard = win.locator("button", { hasText: /Discard|Close without/i }).first();
  if ((await discard.count()) > 0) { await discard.click().catch(() => {}); await win.waitForTimeout(1200); }
  await win.keyboard.press("Escape").catch(() => {});
  await win.waitForTimeout(600);

  // (B) Ctrl+Shift+S then immediately Ctrl+W.
  if ((await win.locator(".workspace").count()) === 0) { await openWritable(app, win); }
  await dirty(win);
  await win.keyboard.press("Control+Shift+S");
  await win.waitForTimeout(120);
  await win.keyboard.press("Control+w");
  await win.waitForTimeout(1200);
  log("race-saveas-then-close", {
    dialogs: await dialogState(win),
    tabs: await win.locator(".tab").count(),
    diag: await win.evaluate(() => ({ openTabs: window.tflexDiagnostics().openTabs })),
  });
  await win.keyboard.press("Escape").catch(() => {});
  await win.waitForTimeout(800);

  // (C) dirty, Ctrl+S, immediately switch theme (theme crossfade mid-save).
  if ((await win.locator(".workspace").count()) === 0) { await openWritable(app, win); }
  await dirty(win);
  await win.keyboard.press("Control+s");
  await win.click("[data-theme-toggle]").catch(() => {});
  await win.waitForTimeout(200);
  await win.click('[data-theme-option="dark"]').catch(() => {});
  await win.waitForTimeout(2000);
  log("race-save-then-theme", {
    theme: await win.evaluate(() => document.documentElement.getAttribute("data-theme")),
    dialogs: await dialogState(win),
    save: await saveState(win),
  });
  await win.screenshot({ path: path.join(SHOTS, "adv059-race.png") }).catch(() => {});
}

// ---------------------------------------------------------------------------
// SECTION: SENDINPUT — browser-level key injection (may reach menu accelerators)
// ---------------------------------------------------------------------------
async function sectionSendInput(app, win) {
  console.log("\n=== SENDINPUT (webContents.sendInputEvent) ===");
  await openWritable(app, win);
  await dirty(win);
  await installRendererCounters(win);
  await resetRendererCounts(win);

  const fire = async (keyCode, modifiers) => {
    await app.evaluate(({ BrowserWindow }, args) => {
      const w = BrowserWindow.getAllWindows()[0];
      if (!w) return;
      w.webContents.sendInputEvent({ type: "keyDown", keyCode: args.keyCode, modifiers: args.modifiers });
      w.webContents.sendInputEvent({ type: "keyUp", keyCode: args.keyCode, modifiers: args.modifiers });
      w.focus();
    }, { keyCode, modifiers });
    await win.waitForTimeout(900);
  };

  await fire("S", ["control", "shift"]);
  log("sendinput-ctrl-shift-s", { dialogs: await dialogState(win), renderer: await rendererCounts(win) });
  await win.keyboard.press("Escape").catch(() => {});
  await win.waitForTimeout(500);

  await dirty(win);
  await resetRendererCounts(win);
  await fire("S", ["control"]);
  log("sendinput-ctrl-s", { dialogs: await dialogState(win), renderer: await rendererCounts(win) });

  // Menu invoked route for comparison (already validated in menuroute).
  await win.screenshot({ path: path.join(SHOTS, "adv059-sendinput.png") }).catch(() => {});
}

// ---------------------------------------------------------------------------
// SECTION: NEWTAB — minimal repro: does an opened tab land in view?
// ---------------------------------------------------------------------------
async function sectionNewTab(app, win) {
  console.log("\n=== NEWTAB (opened tab visibility, minimal) ===");
  await openWritable(app, win);
  const rows = [];
  for (const w of [1440, 900, 640]) {
    // reduce to a single tab
    let guard = 0;
    while ((await win.locator(".tab").count()) > 1 && guard < 12) {
      await win.locator(".tab-close").first().click({ timeout: 2000 }).catch(() => {});
      await win.waitForTimeout(500);
      guard += 1;
    }
    await setWindowSize(app, w, 800);
    await win.evaluate(() => { const tl = document.querySelector(".tab-list"); if (tl) tl.scrollLeft = 0; });
    const before = await win.locator(".tab").count();
    const p = tmpCopy("report.pdf");
    await mockOpen(app, p);
    await win.click("[data-toolbar-open]");
    await win.waitForFunction((n) => document.querySelectorAll(".tab").length > n, before, { timeout: 20000 }).catch(() => {});
    await win.waitForTimeout(1400);
    const m = await win.evaluate(() => {
      const tl = document.querySelector(".tab-list");
      const ta = document.querySelector(".tab-area");
      const active = document.querySelector(".tab-active");
      const ar = active ? active.getBoundingClientRect() : null;
      const tr = ta ? ta.getBoundingClientRect() : null;
      return {
        tabCount: document.querySelectorAll(".tab").length,
        scrollLeft: tl ? +tl.scrollLeft.toFixed(1) : null,
        scrollW: tl ? tl.scrollWidth : null,
        clientW: tl ? tl.clientWidth : null,
        strip: tr ? { l: +tr.left.toFixed(1), r: +tr.right.toFixed(1) } : null,
        activeTab: ar ? { l: +ar.left.toFixed(1), r: +ar.right.toFixed(1) } : null,
        activeTitle: active ? (active.querySelector(".tab-title")?.textContent || "").trim().slice(0, 40) : null,
        activeAnyVisible: ar && tr ? ar.left < tr.right - 1 && ar.right > tr.left + 1 : null,
        activeStartsVisible: ar && tr ? ar.left <= tr.right - 2 : null,
      };
    });
    rows.push({ w, ...m });
  }
  log("newtab-visibility", rows);
  await win.screenshot({ path: path.join(SHOTS, "adv059-newtab.png") }).catch(() => {});
}

// ---------------------------------------------------------------------------
// SECTION: MENUROUTE — validate the native-menu path in isolation
// ---------------------------------------------------------------------------
async function sectionMenuRoute(app, win) {
  console.log("\n=== MENUROUTE (native menu:action path) ===");
  await openWritable(app, win);
  await dirty(win);
  await installAppCounters(app);
  await installRendererCounters(win);
  await resetRendererCounts(win);
  const send = async (action) => {
    await app.evaluate(({ BrowserWindow }, act) => {
      const w = BrowserWindow.getAllWindows()[0];
      if (w) w.webContents.send("menu:action", { action: act });
    }, action);
    await win.waitForTimeout(800);
  };

  await send("saveAs");
  log("menuroute-saveas", { dialogs: await dialogState(win), renderer: await rendererCounts(win) });
  await win.keyboard.press("Escape").catch(() => {});
  await win.waitForTimeout(500);

  await resetRendererCounts(win);
  await send("save");
  log("menuroute-save", { dialogs: await dialogState(win), renderer: await rendererCounts(win) });

  // Now the synthetic double path: menu 'saveAs' AND a renderer Ctrl+Shift+S in
  // the same tick. Counts how many independent opens the two routes can drive.
  await dirty(win);
  await resetRendererCounts(win);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) w.webContents.send("menu:action", { action: "saveAs" });
  });
  await win.keyboard.press("Control+Shift+S");
  await win.waitForTimeout(900);
  log("menuroute-double-saveas", { dialogs: await dialogState(win), renderer: await rendererCounts(win) });
  await win.keyboard.press("Escape").catch(() => {});
  await win.waitForTimeout(500);

  // Menu 'open' route counts the OS dialog once.
  await resetAppCounts(app);
  await app.evaluate(async ({ dialog }) => { dialog.showOpenDialog = async () => ({ canceled: true }); });
  await send("open");
  await win.waitForTimeout(700);
  log("menuroute-open", { main: await appCounts(app) });
  await win.keyboard.press("Escape").catch(() => {});
  await win.screenshot({ path: path.join(SHOTS, "adv059-menuroute.png") }).catch(() => {});
}

// ---------------------------------------------------------------------------
// SECTION: SILENCE — no-op sweep of the introduced controls
// ---------------------------------------------------------------------------
async function sectionSilence(app, win) {
  console.log("\n=== SILENCE (no-op sweep) ===");
  await openWritable(app, win);
  await installAppCounters(app);
  await installRendererCounters(win);
  const findings = [];

  // Open (enabled): click -> OS open dialog once.
  await mockOpen(app, tmpCopy("report.pdf"));
  await resetAppCounts(app);
  await win.click("[data-toolbar-open]");
  await win.waitForTimeout(1600);
  const oc = await appCounts(app);
  findings.push({ control: "Open", enabled: true, mainOpenDelta: oc.open, expect: 1 });

  // Save on a clean doc: disabled -> click must be swallowed by disabled.
  const cleanSave = await saveState(win);
  await dirty(win);
  const dirtySave = await saveState(win);
  // Save As on clean doc:
  await resetRendererCounts(win);
  const cleanSA = await win.evaluate(() => {
    const el = document.querySelector("[data-toolbar-save-as]");
    return { disabled: el ? el.disabled : null };
  });
  findings.push({ control: "SaveAs on dirty", disabled: dirtySave.saveAsDisabled });

  // Save (enabled dirty): click -> engine.save once, doc cleans.
  await resetRendererCounts(win);
  await app.evaluate(async ({ dialog }, p) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }); }, tmpCopy("report.pdf"));
  await win.click("[data-toolbar-save]");
  await win.waitForTimeout(1500);
  const rc = await rendererCounts(win);
  findings.push({ control: "Save dirty", engineSaveCalls: rc.save, after: await saveState(win) });

  // Save As dialog open -> confirm with mocked save dialog.
  await dirty(win);
  await resetRendererCounts(win);
  await win.click("[data-toolbar-save-as]");
  await win.waitForSelector("[data-save-as-confirm]", { timeout: 6000 });
  const dlg = await dialogState(win);
  await win.click("[data-save-as-confirm]");
  await win.waitForTimeout(1600);
  const rc2 = await rendererCounts(win);
  findings.push({ control: "SaveAs confirm", dialogOpened: dlg.saveAs, engineSaveAsCalls: rc2.saveAs, after: await saveState(win) });

  log("silence-sweep", findings);

  // Console / page errors collected by the launcher are surfaced on stdout as
  // [ELECTRON-ERROR]; additionally read any renderer-side error handler state.
  const health = await win.evaluate(() => ({
    hasDiag: typeof window.tflexDiagnostics === "function",
    tabs: window.tflexDiagnostics().openTabs,
    saveRow: !!document.querySelector(".titlebar-file"),
  }));
  log("silence-health", health);
  await win.screenshot({ path: path.join(SHOTS, "adv059-silence.png") }).catch(() => {});
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
const SECTIONS = {
  region: sectionRegion,
  accel: sectionAccel,
  state: sectionState,
  width: sectionWidth,
  tabs: sectionTabs,
  newtab: sectionNewTab,
  menuroute: sectionMenuRoute,
  sendinput: sectionSendInput,
  race: sectionRace,
  stack: sectionStack,
  cleanaccel: sectionCleanAccel,
  persist: sectionPersist,
  a11y: sectionA11y,
  silence: sectionSilence,
};

async function main() {
  const which = (process.argv[2] || "all").toLowerCase();
  const app = await launchApp();
  const win = await app.firstWindow();
  win.on("pageerror", (e) => console.log(`[adv059][pageerror] ${e.message}`));
  win.on("console", (m) => {
    const t = m.text();
    if (m.type() === "error") console.log(`[adv059][console-error] ${t}`);
  });
  await win.waitForSelector(".sample-card", { timeout: 30000 });
  await win.waitForTimeout(500);

  const run = which === "all" ? Object.keys(SECTIONS) : [which];
  for (const name of run) {
    const fn = SECTIONS[name];
    if (!fn) { console.log(`[adv059] unknown section: ${name}`); continue; }
    try {
      await fn(app, win);
    } catch (e) {
      console.log(`[adv059][SECTION-ERROR] ${name}: ${e && e.stack ? e.stack : e}`);
    }
  }
  await hardClose(app, "adv059");
}

main().catch((e) => {
  console.error(`[adv059][FATAL] ${e && e.stack ? e.stack : e}`);
  process.exitCode = 1;
});