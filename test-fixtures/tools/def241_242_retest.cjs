// QA FIX-READY retest for DEF-241 (ADV-057) and DEF-242 (ADV-058).
//
// Usage: node test-fixtures/tools/def241_242_retest.cjs [def241|def242|all]
//
// DEF-241: text-properties panel + Tools palette coexistence at 640x520,
//   820x700, 1440x900: both rects, overlap (expect 0), elementFromPoint at a
//   representative enabled control in EACH surface, page-reflow animation
//   frames, palette-entry reachability at 640. Screenshot def241-retest-640.png.
// DEF-242: engine.updateTextBox empty/no-effective patch, all-unknown patch,
//   mixed patch, normal patch + undo, via window.tflex.engine.
//
// Canonical launcher only (../../e2e/lib/launch.cjs). Requires dist/ (build first).
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { launchApp, getSamplePath } = require("../../e2e/lib/launch.cjs");
const { hardClose } = require("../../e2e/lib/helpers.cjs");

const SHOTS = path.resolve(__dirname, "..", "..", "screenshots");
fs.mkdirSync(SHOTS, { recursive: true });

const log = (label, obj) => console.log(`[def241-242] ${label} ${JSON.stringify(obj)}`);
const r2 = (n) => (typeof n === "number" && Number.isFinite(n) ? +n.toFixed(2) : n);

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

async function setWindowSize(app, width, height) {
  await app.evaluate(({ BrowserWindow }, size) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) w.setSize(size.width, size.height);
  }, { width, height });
  await new Promise((res) => setTimeout(res, 500));
}

async function openEditMode(win) {
  if ((await win.locator("[data-edit-toolbar]").count()) === 0) {
    await win.click('button[aria-label="Edit content"]');
    await win.waitForSelector("[data-edit-toolbar]", { timeout: 8000 });
  }
}

async function diag(win) {
  return win.evaluate(() => window.tflexDiagnostics());
}

// rAF probe: samples the text panel width, the workspace-main left inset and
// the Tools palette rect every frame.
async function installReflowProbe(win) {
  await win.evaluate(() => {
    window.__df = { rows: [], done: false };
    window.__dfStart = (ms) => {
      window.__df = { rows: [], done: false };
      const t0 = performance.now();
      const tick = () => {
        const p = document.querySelector(".text-props-panel");
        const main = document.querySelector(".workspace-main");
        const pal = document.querySelector("[data-tools-palette]");
        const pr = p ? p.getBoundingClientRect() : null;
        const mr = main ? main.getBoundingClientRect() : null;
        const lr = pal ? pal.getBoundingClientRect() : null;
        window.__df.rows.push({
          t: Math.round(performance.now() - t0),
          panelW: pr ? +pr.width.toFixed(1) : 0,
          mainLeft: mr ? +mr.left.toFixed(1) : null,
          paletteLeft: lr ? +lr.left.toFixed(1) : null,
          paletteW: lr ? +lr.width.toFixed(1) : 0,
          vw: window.innerWidth,
        });
        if (performance.now() - t0 < ms) requestAnimationFrame(tick);
        else window.__df.done = true;
      };
      requestAnimationFrame(tick);
    };
  });
}
async function readReflow(win) {
  await win.waitForFunction(() => window.__df && window.__df.done === true, null, { timeout: 10000 }).catch(() => {});
  return win.evaluate(() => window.__df.rows);
}
function reflowStats(rows) {
  const live = rows.filter((r) => r.mainLeft !== null);
  return {
    frames: rows.length,
    liveFrames: live.length,
    distinctPanelWidths: [...new Set(live.map((r) => Math.round(r.panelW)))],
    distinctMainLeft: [...new Set(live.map((r) => Math.round(r.mainLeft)))],
    distinctPaletteWidths: [...new Set(live.map((r) => Math.round(r.paletteW)))],
    first: live[0] || null,
    last: live[live.length - 1] || null,
  };
}

// ---------------------------------------------------------------------------
// DEF-241
// ---------------------------------------------------------------------------
async function sectionDef241(app, win) {
  console.log("\n=== DEF-241 retest (palette vs text panel) ===");
  await openReport(app, win);
  await openEditMode(win);
  // Observe the panel OPEN animation first: the page column and the panel must
  // interpolate in lockstep (page still reflows with animation).
  await installReflowProbe(win);
  await win.evaluate(() => window.__dfStart(900));
  await win.click('[data-edit-tool="box"]');
  await win.waitForSelector(".text-props-panel", { timeout: 5000 });
  const openRows = await readReflow(win);
  log("def241-panel-open-anim", reflowStats(openRows));
  await win.waitForTimeout(700);
  if ((await win.locator("[data-tools-palette]").count()) === 0) {
    await win.click("[data-tools-toggle]");
    await win.waitForSelector("[data-tools-palette]", { timeout: 5000 });
  }
  await win.waitForTimeout(600);

  const sizes = [[640, 520], [820, 700], [1440, 900]];
  const results = [];
  for (const [w, h] of sizes) {
    await setWindowSize(app, w, h);
    await win.waitForTimeout(800);
    const m = await win.evaluate(() => {
      const rect = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return {
          left: +r.left.toFixed(2), top: +r.top.toFixed(2),
          right: +r.right.toFixed(2), bottom: +r.bottom.toFixed(2),
          w: +r.width.toFixed(2), h: +r.height.toFixed(2),
        };
      };
      const panel = document.querySelector(".text-props-panel");
      const palette = document.querySelector("[data-tools-palette]");
      const panelRect = rect(panel);
      const paletteRect = rect(palette);
      const overlapX = panelRect && paletteRect
        ? Math.max(0, Math.min(panelRect.right, paletteRect.right) - Math.max(panelRect.left, paletteRect.left))
        : null;
      const probe = (el) => {
        if (!el) return { missing: true };
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const hit = document.elementFromPoint(cx, cy);
        return {
          tag: el.tagName,
          label: (el.textContent || "").trim().slice(0, 28) || "",
          isBoldControl: el.getAttribute("data-txt-bold") !== null,
          enabled: !el.disabled,
          rect: [+r.left.toFixed(0), +r.top.toFixed(0), +r.width.toFixed(0), +r.height.toFixed(0)],
          hitClass: hit ? (typeof hit.className === "string" ? hit.className.slice(0, 48) : hit.tagName) : null,
          inPanel: hit ? !!hit.closest(".text-props-panel") : false,
          inPalette: hit ? !!hit.closest("[data-tools-palette]") : false,
        };
      };
      // representative enabled control in the TEXT PANEL (bold is live in text mode)
      const panelControl = probe(document.querySelector(".text-props-panel [data-txt-bold]"));
      // representative enabled entry in the TOOLS PALETTE (first visible one)
      const entries = [...document.querySelectorAll("[data-tools-palette] .tools-palette-entry")]
        .filter((e) => !e.disabled);
      const visible = entries.filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.left >= -1 && r.top >= -1 &&
          r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1;
      });
      let paletteControl = null;
      for (const e of visible) {
        const p = probe(e);
        if (p.inPalette) { paletteControl = p; break; }
      }
      let reachable = 0;
      for (const e of visible) {
        const r = e.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (hit && hit.closest("[data-tools-palette]")) reachable += 1;
      }
      return {
        vw: window.innerWidth, vh: window.innerHeight,
        panel: panelRect, palette: paletteRect,
        overlapX,
        panelControl, paletteControl,
        entryReach: { visible: visible.length, reachable },
        paletteLeftOfPanel: paletteRect && panelRect ? paletteRect.left >= panelRect.right - 1 : null,
      };
    });
    results.push({ size: `${w}x${h}`, ...m });
    log("def241-size", { size: `${w}x${h}`, ...m });
    if (w === 640) {
      await win.screenshot({ path: path.join(SHOTS, "def241-retest-640.png") }).catch(() => {});
    }
  }
  log("def241-summary", results);

  // Page + palette reflow animation frames across the coexistence boundary:
  // the panel and the capped palette stay open; resize 640 -> 900 -> 640 and
  // sample every frame. Multiple distinct palette widths/main insets prove the
  // cap and the page column interpolate together rather than snapping.
  await setWindowSize(app, 640, 520);
  await win.waitForTimeout(600);
  await installReflowProbe(win);
  await win.evaluate(() => window.__dfStart(1300));
  await setWindowSize(app, 900, 650);
  await win.waitForTimeout(300);
  await setWindowSize(app, 640, 520);
  const rows = await readReflow(win);
  const live = rows.filter((r) => r.panelW > 0 && r.mainLeft !== null);
  const paletteMainDelta = live.length
    ? +Math.max(...live.map((r) => Math.abs(r.paletteLeft - r.mainLeft))).toFixed(2)
    : null;
  log("def241-reflow-frames", {
    ...reflowStats(rows),
    paletteLeftVsMainLeftMaxDelta: paletteMainDelta,
  });
  await win.screenshot({ path: path.join(SHOTS, "def241-retest-640.png") }).catch(() => {});
}

// ---------------------------------------------------------------------------
// DEF-242
// ---------------------------------------------------------------------------
async function createTextBox(win, text) {
  await openEditMode(win);
  await win.click('[data-edit-tool="box"]');
  const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const x = Math.max(40, Math.min(pg.x + pg.width * 0.22, vp.w - 260));
  const y = Math.max(pg.y + 20, Math.min(pg.y + pg.height * 0.18, vp.h - 130));
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + 200, y + 70, { steps: 6 });
  await win.mouse.up();
  await win.waitForSelector("[data-edit-editor]", { timeout: 8000 });
  await win.locator("[data-edit-textarea]").fill(text);
  await win.click("[data-edit-confirm]");
  await win.waitForSelector(".edit-box", { timeout: 8000 });
  await win.waitForTimeout(500);
  await win.locator(".edit-box").last().click({ position: { x: 8, y: 8 } });
  await win.waitForTimeout(400);
}

async function callUpdate(win, docId, id, patch) {
  return win.evaluate(async (args) => {
    const api = window.tflex && window.tflex.engine;
    if (!api || typeof api.updateTextBox !== "function") return { missing: true };
    try {
      const r = await api.updateTextBox(args.docId, args.id, args.patch);
      if (r && r.ok) {
        const boxes = (r.value && r.value.textBoxes) || [];
        const b = boxes.find((x) => x.id === args.id) || null;
        return {
          ok: true,
          modified: r.value ? r.value.modified : null,
          canUndo: r.value ? r.value.canUndo : null,
          canRedo: r.value ? r.value.canRedo : null,
          box: b ? { size: b.size, bold: b.bold, italic: b.italic, text: b.text } : null,
        };
      }
      return {
        ok: false,
        code: r && r.error ? r.error.code : null,
        message: r && r.error ? r.error.message : String(r),
      };
    } catch (e) {
      return { threw: String(e && e.message ? e.message : e) };
    }
  }, { docId, id, patch });
}

async function engineCall(win, method, args) {
  return win.evaluate(async (a) => {
    const api = window.tflex.engine;
    if (typeof api[a.method] !== "function") return { missing: a.method };
    const r = await api[a.method](...a.args);
    if (!r || !r.ok) return { ok: false, error: r && r.error ? r.error.message : String(r) };
    const boxes = (r.value && r.value.textBoxes) || [];
    return {
      ok: true,
      modified: r.value.modified,
      canUndo: r.value.canUndo,
      canRedo: r.value.canRedo,
      boxes: boxes.map((b) => ({ id: b.id, bold: b.bold, italic: b.italic, underline: b.underline, size: b.size })),
    };
  }, { method, args });
}

// Authoritative engine state straight from getState (the React mirror behind
// tflexDiagnostics does not update on direct window.tflex.engine calls).
async function engineState(win, docId) {
  return win.evaluate(async (d) => {
    const r = await window.tflex.engine.getState(d);
    if (!r || !r.ok) return { ok: false, error: r && r.error ? r.error.message : String(r) };
    return {
      ok: true,
      modified: r.value.modified,
      canUndo: r.value.canUndo,
      canRedo: r.value.canRedo,
      boxes: (r.value.textBoxes || []).map((b) => ({
        id: b.id, bold: b.bold, italic: b.italic, underline: b.underline, size: b.size, text: b.text,
      })),
    };
  }, docId);
}

async function sectionDef242(app, win) {
  console.log("\n=== DEF-242 retest (updateTextBox no-op) ===");
  await openReport(app, win);
  await createTextBox(win, "DEF242-A");
  const docId = (await diag(win)).engineDocId;
  const id = await win.evaluate(() => {
    const b = window.tflexDiagnostics().engineState.textBoxes;
    return b.length ? b[b.length - 1].id : null;
  });
  log("def242-setup", { docId, id, updateType: await win.evaluate(() => typeof (window.tflex.engine || {}).updateTextBox) });

  // CLEAN the document: Save As so modified:false and the undo stack is cleared.
  const cleanPath = path.join(os.tmpdir(), `def242-clean-${Date.now()}.pdf`);
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, cleanPath);
  await win.click("[data-toolbar-save-as]");
  await win.waitForSelector("[data-save-as-confirm]", { timeout: 8000 });
  await win.click("[data-save-as-confirm]");
  await win.waitForFunction(() => !window.tflexDiagnostics().modified, null, { timeout: 30000 }).catch(() => {});
  await win.waitForTimeout(500);

  const cleanBefore = await engineState(win, docId);
  const rEmpty = await callUpdate(win, docId, id, {});
  await win.waitForTimeout(400);
  const afterEmpty = await engineState(win, docId);
  const undoEmpty = await engineCall(win, "undo", [docId]);
  log("def242-empty-patch", { cleanBefore, rEmpty, afterEmpty, undoReports: undoEmpty });

  const rEvil = await callUpdate(win, docId, id, { evil: 1 });
  const afterEvil = await engineState(win, docId);
  log("def242-all-unknown", { rEvil, afterEvil });

  const rMixed = await callUpdate(win, docId, id, { size: 20, evil: 1 });
  await win.waitForTimeout(400);
  const afterMixed = await engineState(win, docId);
  log("def242-mixed-unknown-known", { rMixed, afterMixed });

  // normal patch dirties + undoes
  const rNormal = await callUpdate(win, docId, id, { bold: true });
  await win.waitForTimeout(400);
  const afterNormal = await engineState(win, docId);
  const undoNormal = await engineCall(win, "undo", [docId]);
  await win.waitForTimeout(300);
  const afterUndo = await engineState(win, docId);
  log("def242-normal-patch-undo", { rNormal, afterNormal, undoNormal, afterUndo });

  // redo preserved across an empty patch: patch -> undo -> empty patch -> redo
  const rItalic = await callUpdate(win, docId, id, { italic: true });
  await win.waitForTimeout(300);
  const undo2 = await engineCall(win, "undo", [docId]);
  const beforeNoopRedo = await engineState(win, docId);
  const rEmpty2 = await callUpdate(win, docId, id, {});
  const afterNoopRedo = await engineState(win, docId);
  const redo2 = await engineCall(win, "redo", [docId]);
  const afterRedo2 = await engineState(win, docId);
  log("def242-redo-preserved", { rItalic, undo2, beforeNoopRedo, rEmpty2, afterNoopRedo, redo2, afterRedo2 });

  // redo sanity, independent of any empty patch: patch -> undo -> redo.
  const s1 = await callUpdate(win, docId, id, { underline: true });
  const s2 = await engineCall(win, "undo", [docId]);
  const s3 = await engineCall(win, "redo", [docId]);
  log("def242-redo-sanity", { s1, s2, s3 });
}

async function run(section) {
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector(".sample-card", { timeout: 30000 }).catch(() => {});
    if (section === "def241" || section === "all") await sectionDef241(app, win);
    if (section === "def242" || section === "all") await sectionDef242(app, win);
  } finally {
    await hardClose(app, `def241-242-${section}`);
  }
}

const section = process.argv[2] || "all";
run(section)
  .then(() => {
    console.log(`[def241-242] DONE ${section}`);
    process.exit(0);
  })
  .catch((e) => {
    console.error(`[def241-242] FAILED ${section}: ${e && e.stack ? e.stack : e}`);
    process.exit(1);
  });
