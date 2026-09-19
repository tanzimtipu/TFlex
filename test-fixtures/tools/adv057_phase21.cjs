// ADV phase-21 gate — attack the text-properties panel and everything it
// touched: geometry shift, hostile updateTextBox patches, retired toolbox
// resurrection, panel state machine, layout coexistence, annotation mode,
// persistence/undo abuse and perf.
//
// Usage: node test-fixtures/tools/adv057_phase21.cjs <section>
//   sections: geom | patch | resurrect | panel | layout | annot | persist |
//             perf | silence | all
//
// Requires the dev bundle (dist/) — run `npm.cmd run build` first.
// Canonical launcher only (../../e2e/lib/launch.cjs). Never edits product code.
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { launchApp, getSamplePath } = require("../../e2e/lib/launch.cjs");
const { hardClose, armAnnotationTool, openSamplePath, scrollToPage } = require("../../e2e/lib/helpers.cjs");

const SHOTS = path.resolve(__dirname, "..", "..", "screenshots");
fs.mkdirSync(SHOTS, { recursive: true });

function log(label, obj) {
  console.log(`[adv057] ${label} ${JSON.stringify(obj)}`);
}
function round(n, d = 2) {
  return typeof n === "number" && Number.isFinite(n) ? +n.toFixed(d) : n;
}

// ---------------------------------------------------------------------------
// shared driving helpers
// ---------------------------------------------------------------------------
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

async function setTheme(win, want) {
  const cur = await win.evaluate(() => document.documentElement.getAttribute("data-theme"));
  if (cur === want) return;
  await win.click("[data-theme-toggle]");
  await win.waitForSelector(".theme-toggle-popover", { timeout: 5000 });
  await win.click(`[data-theme-option="${want}"]`);
  await win.waitForFunction((w) => document.documentElement.getAttribute("data-theme") === w, want, {
    timeout: 5000,
  });
  await win.waitForTimeout(400);
}

async function openEditMode(win) {
  if ((await win.locator("[data-edit-toolbar]").count()) === 0) {
    await win.click('button[aria-label="Edit content"]');
    await win.waitForSelector("[data-edit-toolbar]", { timeout: 8000 });
  }
}
async function closeEditMode(win) {
  if ((await win.locator("[data-edit-toolbar]").count()) > 0) {
    await win.click('button[aria-label="Edit content"]');
    await win.waitForTimeout(450);
  }
}

async function diag(win) {
  return win.evaluate(() => window.tflexDiagnostics());
}

async function boxes(win) {
  return win.evaluate(() => {
    const st = window.tflexDiagnostics().engineState;
    if (!st || !st.textBoxes) return [];
    return st.textBoxes.map((b) => ({
      id: b.id, text: b.text, page: b.page, rect: b.rect, font: b.font, size: b.size,
      bold: b.bold, italic: b.italic, underline: b.underline, color: b.color,
      highlight: b.highlight ?? null, align: b.align, lineHeight: b.lineHeight,
      list: b.list, indent: b.indent, baselineShift: b.baselineShift,
      background: b.background,
    }));
  });
}

async function annotations(win) {
  return win.evaluate(() => {
    const st = window.tflexDiagnostics().engineState;
    return st && st.annotations ? st.annotations.map((a) => ({
      id: a.id, kind: a.kind, page: a.page, rects: a.rects, color: a.color,
      text: a.text ?? null, content: a.content ?? null,
    })) : [];
  });
}

async function panelState(win) {
  return win.evaluate(() => {
    const p = document.querySelector(".text-props-panel");
    if (!p) return null;
    const body = p.querySelector("[data-text-panel]");
    const q = (s) => p.querySelector(s);
    const pressed = (s) => q(s)?.getAttribute("aria-pressed") === "true";
    const dis = (s) => {
      const el = q(s);
      return el ? !!el.disabled : null;
    };
    return {
      mode: body ? body.getAttribute("data-text-panel-mode") : null,
      font: q("[data-txt-font]")?.value ?? null,
      size: q("[data-txt-size]")?.value ?? null,
      bold: pressed("[data-txt-bold]"),
      italic: pressed("[data-txt-italic]"),
      underline: pressed("[data-txt-underline]"),
      super: pressed("[data-txt-super]"),
      sub: pressed("[data-txt-sub]"),
      color: q("[data-txt-color]")?.value ?? null,
      highlight: q("[data-txt-highlight]")?.value ?? null,
      align: ["left", "center", "right", "justify"].filter((a) => pressed(`[data-txt-align-${a}]`)),
      lineHeight: q("[data-txt-line-height]")?.value ?? null,
      list: ["none", "bullet", "number"].filter((l) => pressed(`[data-txt-list-${l}]`)),
      indent: q("[data-txt-indent-value]")?.textContent ?? null,
      colorDisabled: dis("[data-txt-color]"),
      fontDisabled: dis("[data-txt-font]"),
    };
  });
}

async function layoutMetrics(win) {
  return win.evaluate(() => {
    const q = (s) => document.querySelector(s);
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        left: +r.left.toFixed(2), top: +r.top.toFixed(2),
        right: +r.right.toFixed(2), bottom: +r.bottom.toFixed(2),
        w: +r.width.toFixed(2), h: +r.height.toFixed(2),
      };
    };
    const ws = q(".workspace");
    const sc = q(".document-scroller");
    return {
      main: rect(q(".workspace-main")),
      panel: rect(q(".text-props-panel")),
      rail: rect(q(".side-rail")),
      page: rect(q('.pdf-page[data-page="1"]')),
      canvas: rect(q('.pdf-page[data-page="1"] canvas')),
      scrollTop: sc ? +sc.scrollTop.toFixed(1) : null,
      textW: ws ? getComputedStyle(ws).getPropertyValue("--tf-text-w").trim() : null,
      railW: ws ? getComputedStyle(ws).getPropertyValue("--tf-rail-w").trim() : null,
      vw: window.innerWidth,
      vh: window.innerHeight,
    };
  });
}

const ACTIVE_PANE = '.tab-pane[aria-hidden="false"]';

async function pageBox(win, page = 1) {
  const box = await win.locator(`${ACTIVE_PANE} .pdf-page[data-page="${page}"]`).boundingBox();
  if (box) return box;
  return win.locator(`.pdf-page[data-page="${page}"]`).first().boundingBox();
}

// Drag on the page using fractions of the VISIBLE page intersection. Returns
// the client drag rect. Clamping to the visible region keeps the gesture
// on-screen when the scroller has scrolled a tall page.
async function dragPage(win, fx, fy, fw, fh, opts = {}) {
  const pg = await pageBox(win);
  const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const left = Math.max(pg.x, 40);
  const right = Math.min(pg.x + pg.width, vp.w - 40);
  const top = Math.max(pg.y, 64);
  const bottom = Math.min(pg.y + pg.height, vp.h - 60);
  const W = Math.max(40, right - left);
  const H = Math.max(40, bottom - top);
  const fxx = Math.min(Math.max(fx, 0.05), 0.6);
  const fyy = Math.min(Math.max(fy, 0.05), 0.6);
  const x = left + W * fxx;
  const y = top + H * fyy;
  const x2 = Math.min(x + W * Math.min(fw, 0.3), right);
  const y2 = Math.min(y + H * Math.min(fh, 0.3), bottom);
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x2, y2, { steps: opts.steps ?? 6 });
  await win.mouse.up();
  return { x, y, x2, y2, w: x2 - x, h: y2 - y, page: pg, vis: { left, top, right, bottom } };
}

async function editorRect(win, sel = "[data-edit-editor]") {
  return win.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {
      left: +r.left.toFixed(2), top: +r.top.toFixed(2),
      right: +r.right.toFixed(2), bottom: +r.bottom.toFixed(2),
      w: +r.width.toFixed(2), h: +r.height.toFixed(2),
    };
  }, sel);
}

// Create a committed text box through the real UI; leaves it selected.
// Scoped to the ACTIVE tab pane so a second open tab's duplicate controls
// cannot steal the click.
async function createTextBox(win, text, fx = 0.22, fy = 0.18) {
  const pane = win.locator(ACTIVE_PANE);
  if ((await win.locator(`${ACTIVE_PANE} [data-edit-toolbar]`).count()) === 0) {
    await win.click(`${ACTIVE_PANE} button[aria-label="Edit content"]`);
    await win.waitForSelector(`${ACTIVE_PANE} [data-edit-toolbar]`, { timeout: 8000 });
  }
  await pane.locator('[data-edit-tool="box"]').first().click();
  await win.waitForTimeout(120);
  await dragPage(win, fx, fy, 0.2, 0.09);
  let appeared = await win
    .waitForSelector(`${ACTIVE_PANE} [data-edit-editor]`, { timeout: 4000 })
    .then(() => true)
    .catch(() => false);
  if (!appeared) {
    // the drag may have landed on an existing box (move, not create) or the
    // chrome; retry on a different patch of empty page
    await win.keyboard.press("Escape").catch(() => {});
    await win.waitForTimeout(300);
    await pane.locator('[data-edit-tool="box"]').first().click().catch(() => {});
    await win.waitForTimeout(150);
    await dragPage(win, 0.55, 0.6, 0.18, 0.08);
    appeared = await win
      .waitForSelector(`${ACTIVE_PANE} [data-edit-editor]`, { timeout: 5000 })
      .then(() => true)
      .catch(() => false);
  }
  if (!appeared) throw new Error("createTextBox: editor never opened");
  await pane.locator("[data-edit-textarea]").first().fill(text);
  await pane.locator("[data-edit-confirm]").first().click();
  await win.waitForSelector(`${ACTIVE_PANE} .edit-box`, { timeout: 8000 });
  await win.waitForTimeout(500);
  await pane.locator(".edit-box").last().click({ position: { x: 8, y: 8 } });
  await win.waitForTimeout(400);
}

async function firstBoxId(win) {
  const b = await boxes(win);
  return b.length ? b[b.length - 1].id : null;
}

// ---------------------------------------------------------------------------
// In-page frame probe (reused from adv051)
// ---------------------------------------------------------------------------
async function installFrameProbe(win) {
  await win.evaluate(() => {
    window.__af = { deltas: [], done: true };
    window.__afStart = (ms) => {
      window.__af = { deltas: [], done: false };
      let last = performance.now();
      const t0 = last;
      const tick = (now) => {
        window.__af.deltas.push(+(now - last).toFixed(2));
        last = now;
        if (now - t0 < ms) requestAnimationFrame(tick);
        else window.__af.done = true;
      };
      requestAnimationFrame(tick);
    };
  });
}
async function frameStart(win, ms) {
  await win.evaluate((m) => window.__afStart(m), ms);
}
async function frameRead(win) {
  await win.waitForFunction(() => window.__af && window.__af.done === true, null, { timeout: 20000 }).catch(() => {});
  return win.evaluate(() => window.__af.deltas);
}
function frameStats(deltas) {
  const d = deltas.slice(2);
  if (d.length === 0) return { n: 0 };
  const sorted = [...d].sort((a, b) => a - b);
  const pick = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  return {
    n: d.length,
    p50: round(pick(0.5), 1), p95: round(pick(0.95), 1), max: round(sorted[sorted.length - 1], 1),
    over16_7: d.filter((x) => x > 16.7).length,
    over33: d.filter((x) => x > 33).length,
    mean: round(d.reduce((a, b) => a + b, 0) / d.length, 1),
  };
}

// ---------------------------------------------------------------------------
// SECTION: GEOMETRY-SHIFT (DEF-232 class)
// ---------------------------------------------------------------------------
async function sectionGeom(app, win) {
  console.log("\n=== GEOM (geometry shift) ===");
  await openReport(app, win);
  await openEditMode(win);
  await win.waitForTimeout(300);

  const closed = await layoutMetrics(win);

  // (A) open the panel via the box tool, let it settle, place a box.
  await win.click('[data-edit-tool="box"]');
  await win.waitForSelector(".text-props-panel", { timeout: 5000 });
  await win.waitForTimeout(700);
  const open = await layoutMetrics(win);

  const drag = await dragPage(win, 0.3, 0.22, 0.22, 0.1);
  await win.waitForSelector("[data-edit-editor]", { timeout: 8000 });
  const ed = await editorRect(win);
  await win.locator("[data-edit-textarea]").fill("GEOM-A");
  await win.click("[data-edit-confirm]");
  await win.waitForSelector(".edit-box", { timeout: 8000 });
  await win.waitForTimeout(600);
  const boxA = (await boxes(win)).find((b) => b.text === "GEOM-A") || null;
  const overlayA = await win.evaluate(() => {
    const el = document.querySelector(".edit-box");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: +r.left.toFixed(2), top: +r.top.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) };
  });
  log("geom-open-place", {
    closedMainLeft: closed.main?.left, openMainLeft: open.main?.left,
    textW: open.textW, railW: open.railW,
    panelW: open.panel?.w, pageLeftClosed: closed.page?.left, pageLeftOpen: open.page?.left,
    scrollTopClosed: closed.scrollTop, scrollTopOpen: open.scrollTop,
    drag: { x: round(drag.x, 1), y: round(drag.y, 1), x2: round(drag.x2, 1), y2: round(drag.y2, 1) },
    editorRect: ed,
    editorDeltaFromDragStart: ed ? { dx: round(ed.left - drag.x, 1), dy: round(ed.top - drag.y, 1) } : null,
    overlayA,
    overlayDeltaFromDragStart: overlayA ? { dx: round(overlayA.left - drag.x, 1), dy: round(overlayA.top - drag.y, 1) } : null,
    boxA: boxA ? { rect: boxA.rect } : null,
  });

  // (B) panel CLOSED -> box tool selected -> drag mid-open-animation.
  await closeEditMode(win);
  await win.waitForTimeout(500);
  await openEditMode(win);
  await win.click('[data-edit-tool="box"]');
  await win.waitForTimeout(40); // panel is still animating open
  const dragMid = await dragPage(win, 0.3, 0.45, 0.22, 0.1);
  await win.waitForSelector("[data-edit-editor]", { timeout: 8000 });
  const edMid = await editorRect(win);
  await win.locator("[data-edit-textarea]").fill("GEOM-MID");
  await win.click("[data-edit-confirm]");
  await win.waitForSelector(".edit-box", { timeout: 8000 });
  await win.waitForTimeout(800);
  const boxMid = (await boxes(win)).find((b) => b.text === "GEOM-MID") || null;
  const overlayMid = await win.evaluate(() => {
    const els = [...document.querySelectorAll(".edit-box")];
    const el = els[els.length - 1];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: +r.left.toFixed(2), top: +r.top.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) };
  });
  log("geom-midopen-place", {
    drag: { x: round(dragMid.x, 1), y: round(dragMid.y, 1) },
    editorRect: edMid,
    editorDelta: edMid ? { dx: round(edMid.left - dragMid.x, 1), dy: round(edMid.top - dragMid.y, 1) } : null,
    overlayMid,
    overlayDelta: overlayMid ? { dx: round(overlayMid.left - dragMid.x, 1), dy: round(overlayMid.top - dragMid.y, 1) } : null,
    boxMid: boxMid ? { rect: boxMid.rect } : null,
  });
  await win.screenshot({ path: path.join(SHOTS, "adv057-geom-midopen.png") }).catch(() => {});

  // (C) annotation textbox placed with the panel OPEN and settled.
  await closeEditMode(win);
  await win.waitForTimeout(500);
  await armAnnotationTool(win, "textbox");
  await win.waitForTimeout(400);
  const armedTool = await win.evaluate(() => window.tflexDiagnostics().activeTool);
  const dragAnn = await dragPage(win, 0.28, 0.62, 0.2, 0.08);
  const annEditorAppeared = await win
    .waitForSelector('[data-annotation-editor="textbox"]', { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  if (!annEditorAppeared) {
    log("geom-ann-editor-missing", {
      armedTool,
      panel: await win.locator(".text-props-panel").count(),
      editToolbar: await win.locator("[data-edit-toolbar]").count(),
      annLayer: await win.locator(".annotation-layer, [data-annotation-layer]").count(),
    });
  }
  const edAnn = annEditorAppeared ? await editorRect(win, '[data-annotation-editor="textbox"]') : null;
  if (annEditorAppeared) {
    await win.locator('[data-annotation-editor="textbox"] textarea').fill("GEOM-ANN");
    await win.click('[data-annotation-action="textbox-confirm"]');
    await win.waitForTimeout(1200);
  }
  const ann = (await annotations(win)).find((a) => a.text === "GEOM-ANN") || null;
  log("geom-open-annotation", {
    armedTool,
    drag: { x: round(dragAnn.x, 1), y: round(dragAnn.y, 1) },
    editorRect: edAnn,
    editorDelta: edAnn ? { dx: round(edAnn.left - dragAnn.x, 1), dy: round(edAnn.top - dragAnn.y, 1) } : null,
    ann: ann ? { rects: ann.rects } : null,
  });
  await win.screenshot({ path: path.join(SHOTS, "adv057-geom-ann.png") }).catch(() => {});

  // (D) rail collapsed with the panel open: measure page offset + place.
  await armAnnotationTool(win, "select");
  await win.waitForTimeout(400);
  await openEditMode(win);
  await win.click('[data-edit-tool="box"]');
  await win.waitForSelector(".text-props-panel", { timeout: 5000 });
  await win.waitForTimeout(600);
  await win.click("[data-rail-collapse]");
  await win.waitForTimeout(700);
  const railCollapsed = await layoutMetrics(win);
  const preRailDrag = await win.evaluate(() => ({
    activeTool: window.tflexDiagnostics().activeTool,
    editToolbar: !!document.querySelector("[data-edit-toolbar]"),
    boxToolArmed: document.querySelector('[data-edit-tool="box"]')?.getAttribute("aria-pressed") ?? null,
    panel: !!document.querySelector(".text-props-panel"),
  }));
  const dragRail = await dragPage(win, 0.32, 0.3, 0.22, 0.1);
  const railEditorAppeared = await win
    .waitForSelector("[data-edit-editor]", { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  const edRail = railEditorAppeared ? await editorRect(win) : null;
  if (railEditorAppeared) {
    await win.keyboard.press("Escape");
    await win.waitForTimeout(400);
  }
  log("geom-rail-collapsed", {
    railW: railCollapsed.railW, panel: railCollapsed.panel, page: railCollapsed.page,
    preRailDrag,
    drag: { x: round(dragRail.x, 1), y: round(dragRail.y, 1) },
    editorRect: edRail,
    editorDelta: edRail ? { dx: round(edRail.left - dragRail.x, 1), dy: round(edRail.top - dragRail.y, 1) } : null,
  });
  await win.click("[data-rail-collapse]").catch(() => {});
  await win.waitForTimeout(500);

  // (E) open/close repeatedly: does the scroller position or canvas offset drift?
  const drift = [];
  await closeEditMode(win);
  await win.waitForTimeout(500);
  const before = await layoutMetrics(win);
  for (let i = 0; i < 8; i += 1) {
    await armAnnotationTool(win, "textbox");
    await win.waitForTimeout(60);
    await armAnnotationTool(win, "select");
    await win.waitForTimeout(60);
  }
  await win.waitForTimeout(600);
  const after = await layoutMetrics(win);
  drift.push({
    scrollBefore: before.scrollTop, scrollAfter: after.scrollTop,
    pageBefore: before.page, pageAfter: after.page,
    mainBefore: before.main?.left, mainAfter: after.main?.left,
    panels: await win.locator(".text-props-panel").count(),
  });
  log("geom-open-close-drift", drift[0]);

  // (F) panel CLOSING mid-gesture: start a move-drag on a committed box, then
  // close the panel (Escape disarms edit tools) while the pointer is down.
  await openEditMode(win);
  await createTextBox(win, "GEOM-CLOSE", 0.35, 0.25);
  await win.waitForTimeout(600);
  const boxBefore = (await boxes(win)).find((b) => b.text === "GEOM-CLOSE") || null;
  const overlayBefore = await win.evaluate(() => {
    const els = [...document.querySelectorAll(".edit-box")];
    const el = els[els.length - 1];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { left: +r.left.toFixed(1), top: +r.top.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
  });
  const panelOpenBefore = await win.locator(".text-props-panel").count();
  if (overlayBefore) {
    await win.mouse.move(overlayBefore.left + 10, overlayBefore.top + 10);
    await win.mouse.down();
    await win.mouse.move(overlayBefore.left + 60, overlayBefore.top + 40, { steps: 4 });
    await win.keyboard.press("Escape");
    await win.waitForTimeout(120);
    await win.mouse.move(overlayBefore.left + 110, overlayBefore.top + 70, { steps: 4 });
    await win.mouse.up();
    await win.waitForTimeout(900);
  }
  const closeMid = await win.evaluate(() => {
    const d = window.tflexDiagnostics();
    const b = (d.engineState.textBoxes || []).find((x) => x.text === "GEOM-CLOSE");
    const p = document.querySelector(".text-props-panel");
    const editors = document.querySelectorAll("[data-edit-editor]").length;
    return {
      panel: !!p,
      panelAttr: document.querySelector(".workspace")?.getAttribute("data-text-panel-open"),
      editMode: !!document.querySelector("[data-edit-toolbar]"),
      editors,
      rect: b ? b.rect : null,
      modified: d.modified,
    };
  });
  log("geom-close-midgesture", {
    panelOpenBefore, boxBeforeRect: boxBefore ? boxBefore.rect : null,
    overlayBefore, closeMid,
  });
  await win.screenshot({ path: path.join(SHOTS, "adv057-geom-close-midgesture.png") }).catch(() => {});
}

// ---------------------------------------------------------------------------
// SECTION: HOSTILE PATCHES
// ---------------------------------------------------------------------------
async function callUpdate(win, docId, id, patch) {
  return win.evaluate(async (args) => {
    const api = window.tflex && window.tflex.engine;
    if (!api || typeof api.updateTextBox !== "function") {
      return { missing: true };
    }
    try {
      const r = await api.updateTextBox(args.docId, args.id, args.patch);
      if (r && r.ok) {
        const boxes = (r.value && r.value.textBoxes) || [];
        const b = boxes.find((x) => x.id === args.id) || null;
        return {
          ok: true,
          stateModified: r.value ? r.value.modified : null,
          stateCanUndo: r.value ? r.value.canUndo : null,
          stateCanRedo: r.value ? r.value.canRedo : null,
          box: b ? {
            size: b.size, lineHeight: b.lineHeight, baselineShift: b.baselineShift,
            indent: b.indent, align: b.align, list: b.list, font: b.font,
            bold: b.bold, highlight: b.highlight ?? null, text: b.text,
            color: b.color,
          } : null,
        };
      }
      return { ok: false, code: r && r.error ? r.error.code : null, message: r && r.error ? r.error.message : String(r) };
    } catch (e) {
      return { threw: String(e && e.message ? e.message : e) };
    }
  }, { docId, id, patch });
}

async function sectionPatch(app, win) {
  console.log("\n=== PATCH (hostile updateTextBox) ===");
  await openReport(app, win);
  await createTextBox(win, "PATCH-A", 0.2, 0.15);
  const docId = (await diag(win)).engineDocId;
  const id = await firstBoxId(win);
  log("patch-setup", { docId, id, engineHasUpdate: await win.evaluate(() => typeof (window.tflex.engine || {}).updateTextBox) });

  const baseline = (await boxes(win)).find((b) => b.id === id) || null;

  const cases = [
    ["size-0", { size: 0 }],
    ["size-1e9", { size: 1e9 }],
    ["size-NaN", { size: NaN }],
    ["size-Infinity", { size: Infinity }],
    ["lineHeight-0.4", { lineHeight: 0.4 }],
    ["lineHeight-5.1", { lineHeight: 5.1 }],
    ["lineHeight-NaN", { lineHeight: NaN }],
    ["baselineShift-201", { baselineShift: 201 }],
    ["baselineShift--201", { baselineShift: -201 }],
    ["baselineShift-NaN", { baselineShift: NaN }],
    ["indent--1", { indent: -1 }],
    ["indent-201", { indent: 201 }],
    ["indent-NaN", { indent: NaN }],
    ["align-bogus", { align: "bogus" }],
    ["list-x", { list: "x" }],
    ["font-Arial", { font: "Arial" }],
    ["highlight-r2", { highlight: { r: 2, g: 0, b: 0 } }],
    ["highlight-empty", { highlight: {} }],
    ["highlight-string", { highlight: "red" }],
    ["text-null", { text: null }],
    ["empty-patch", {}],
    ["unknown-key", { evil: 1 }],
  ];
  for (const [name, patch] of cases) {
    const r = await callUpdate(win, docId, id, patch);
    log(`patch-${name}`, r);
  }

  // empty patch side effects: modified flag + undo depth
  const beforeEmpty = await win.evaluate(() => {
    const d = window.tflexDiagnostics();
    return { modified: d.modified, canUndo: d.canUndo, engineModified: d.engineState ? d.engineState.modified : null };
  });
  const rEmpty = await callUpdate(win, docId, id, {});
  const afterEmpty = await win.evaluate(() => {
    const d = window.tflexDiagnostics();
    return { modified: d.modified, canUndo: d.canUndo, engineModified: d.engineState ? d.engineState.modified : null };
  });
  log("patch-empty-side-effects", { beforeEmpty, rEmpty, afterEmpty });

  // deleted id: create a throwaway box, delete it, then patch it.
  await createTextBox(win, "PATCH-DEL", 0.45, 0.3);
  const idDel = await firstBoxId(win);
  await win.evaluate(async ({ docId, id }) => {
    await window.tflex.engine.deleteTextBox(docId, id);
  }, { docId, id: idDel });
  await win.waitForTimeout(400);
  const rDeleted = await callUpdate(win, docId, idDel, { bold: true });
  log("patch-deleted-id", rDeleted);

  // no-op side effects on a CLEAN doc: save first (modified false), then an
  // empty patch / all-unknown-key patch.
  const cleanPath = path.join(os.tmpdir(), `adv057-clean-${Date.now()}.pdf`);
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, cleanPath);
  await win.click("[data-toolbar-save-as]");
  await win.waitForSelector("[data-save-as-confirm]", { timeout: 8000 });
  await win.click("[data-save-as-confirm]");
  await win.waitForFunction(() => !window.tflexDiagnostics().modified, null, { timeout: 30000 }).catch(() => {});
  const cleanBefore = await win.evaluate(() => {
    const d = window.tflexDiagnostics();
    return { modified: d.modified, canUndo: d.canUndo, canRedo: d.canRedo };
  });
  const rNoop = await callUpdate(win, docId, id, {});
  await win.waitForTimeout(500);
  const cleanAfter = await win.evaluate(() => {
    const d = window.tflexDiagnostics();
    return { modified: d.modified, canUndo: d.canUndo, canRedo: d.canRedo };
  });
  const rNoop2 = await callUpdate(win, docId, id, { evil: 1, another: "x" });
  await win.waitForTimeout(500);
  const cleanAfter2 = await win.evaluate(() => {
    const d = window.tflexDiagnostics();
    return { modified: d.modified, canUndo: d.canUndo, canRedo: d.canRedo };
  });
  log("patch-noop-side-effects", { cleanBefore, rNoop, cleanAfter, rNoop2, cleanAfter2 });

  // patch -> undo -> patch -> redo (single tab, box A)
  const seq = [];
  seq.push(["patch-bold", await callUpdate(win, docId, id, { bold: true })]);
  await win.waitForTimeout(500);
  await win.keyboard.press("Control+z");
  await win.waitForTimeout(600);
  seq.push(["after-undo", (await boxes(win)).find((b) => b.id === id) || null]);
  seq.push(["patch-italic", await callUpdate(win, docId, id, { italic: true })]);
  await win.waitForTimeout(500);
  await win.keyboard.press("Control+y");
  await win.waitForTimeout(600);
  seq.push(["after-redo", (await boxes(win)).find((b) => b.id === id) || null]);
  const redoState = await win.evaluate(() => {
    const d = window.tflexDiagnostics();
    return { canUndo: d.canUndo, canRedo: d.canRedo };
  });
  log("patch-undo-redo-sequence", {
    steps: seq.map(([k, v]) => [k, v && v.ok !== undefined ? v : (v ? { bold: v.bold, italic: v.italic } : null)]),
    redoState,
  });

  // patch during an in-flight save. Create a fresh box through the UI so a
  // box is selected, the panel is open and the doc is dirty (Save As enabled),
  // then fire a UI style patch concurrently with the save round-trip.
  await createTextBox(win, "SAVE-A", 0.5, 0.3);
  await win.locator("[data-txt-bold]").click().catch(() => {});
  await win.waitForTimeout(900);
  const savePath = path.join(os.tmpdir(), `adv057-during-save-${Date.now()}.pdf`);
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);
  await win.click("[data-toolbar-save-as]");
  await win.waitForSelector("[data-save-as-confirm]", { timeout: 8000 });
  await win.click("[data-save-as-confirm]");
  // fire the patch immediately, in parallel with the save round-trip (UI path)
  const uiPatch = win
    .locator("[data-txt-size]")
    .fill("33")
    .then(() => true)
    .catch((e) => String(e.message).split("\n")[0].slice(0, 100));
  const patchResult = { uiFill: await uiPatch };
  await win.waitForTimeout(4000);
  const afterSave = await win.evaluate(() => {
    const d = window.tflexDiagnostics();
    return { modified: d.modified, canUndo: d.canUndo };
  });
  // reopen the saved file in a NEW tab (avoid the unsaved-changes close gate
  // if the concurrent patch landed after the save snapshot)
  const tcBeforeSave = await win.locator(".tab").count();
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, savePath);
  await win.click("[data-toolbar-open]");
  await win.waitForFunction((n) => document.querySelectorAll(".tab").length > n, tcBeforeSave, { timeout: 15000 }).catch(() => {});
  await win.waitForTimeout(3000);
  const savedBoxes = await boxes(win);
  const savedA = savedBoxes.find((b) => b.text === "SAVE-A") || null;
  log("patch-during-save", {
    patchResult,
    afterSave,
    savedA: savedA ? { size: savedA.size, bold: savedA.bold, italic: savedA.italic } : null,
    savedExists: fs.existsSync(savePath),
  });
  await win.screenshot({ path: path.join(SHOTS, "adv057-patch-during-save.png") }).catch(() => {});
  // close the reopened tab so the cross-tab test starts from one tab
  await win.locator(".tab-active .tab-close").click().catch(() => {});
  await win.waitForTimeout(1500);

  // cross-tab LAST: open tab2, create box B, target wrong doc/id pairs.
  const p2 = path.join(os.tmpdir(), `adv057-tab2-${Date.now()}.pdf`);
  fs.copyFileSync(getSamplePath("report.pdf"), p2);
  const tabCountBefore = await win.locator(".tab").count();
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, p2);
  await win.click("[data-toolbar-open]");
  await win.waitForFunction((n) => document.querySelectorAll(".tab").length > n, tabCountBefore, { timeout: 15000 }).catch(() => {});
  await win.waitForTimeout(2500);
  const tabInfo = await win.evaluate(() => ({
    tabCount: document.querySelectorAll(".tab").length,
    activeTab: document.querySelector(".tab-active")?.textContent ?? null,
    activePaneCanvases: document.querySelectorAll('.tab-pane[aria-hidden="false"] .pdf-page canvas').length,
  }));
  const doc2 = (await diag(win)).engineDocId;
  log("patch-tab2-opened", { tabInfo, doc2, tabCountBefore });
  await createTextBox(win, "PATCH-B", 0.25, 0.2);
  const idB = await firstBoxId(win);
  const rCross = await callUpdate(win, doc2, id, { bold: true }); // box A's id in doc2
  const rCrossOther = await callUpdate(win, docId, idB, { bold: true }); // box B's id in doc1
  log("patch-cross-tab", { docId, doc2, idA: id, idB, wrongDocId: rCross, wrongBoxInDoc: rCrossOther });
}

// ---------------------------------------------------------------------------
// SECTION: PATCH-SEQ — deterministic engine-only undo/redo vs updateTextBox
// ---------------------------------------------------------------------------
async function engineStateCall(win, method, args) {
  return win.evaluate(async (a) => {
    const api = window.tflex.engine;
    if (typeof api[a.method] !== "function") return { missing: a.method };
    const r = await api[a.method](...a.args);
    if (!r || !r.ok) return { ok: false, error: r && r.error ? r.error.message : String(r) };
    return {
      ok: true,
      modified: r.value.modified,
      canUndo: r.value.canUndo,
      canRedo: r.value.canRedo,
      boxes: (r.value.textBoxes || []).map((b) => ({ id: b.id, bold: b.bold, italic: b.italic, size: b.size })),
    };
  }, { method, args });
}

async function sectionPatchSeq(app, win) {
  console.log("\n=== PATCH-SEQ (engine-only undo/redo) ===");
  await openReport(app, win);
  await createTextBox(win, "SEQ-A", 0.25, 0.2);
  const docId = (await diag(win)).engineDocId;
  const id = await firstBoxId(win);
  const pick = (r) => (r && r.boxes ? r.boxes.find((b) => b.id === id) : null);
  const r1 = await engineStateCall(win, "updateTextBox", [docId, id, { bold: true }]);
  log("seq-1-patch-bold", { ok: r1.ok, modified: r1.modified, canUndo: r1.canUndo, canRedo: r1.canRedo, box: pick(r1) });
  const u1 = await engineStateCall(win, "undo", [docId]);
  log("seq-2-undo", { ok: u1.ok, modified: u1.modified, canUndo: u1.canUndo, canRedo: u1.canRedo, box: pick(u1) });
  const r2 = await engineStateCall(win, "updateTextBox", [docId, id, { italic: true }]);
  log("seq-3-patch-italic", { ok: r2.ok, modified: r2.modified, canUndo: r2.canUndo, canRedo: r2.canRedo, box: pick(r2) });
  const rr = await engineStateCall(win, "redo", [docId]);
  log("seq-4-redo-after-new-patch", { ok: rr.ok, modified: rr.modified, canUndo: rr.canUndo, canRedo: rr.canRedo, box: pick(rr) });
  const u2 = await engineStateCall(win, "undo", [docId]);
  log("seq-5-undo", { ok: u2.ok, modified: u2.modified, canUndo: u2.canUndo, canRedo: u2.canRedo, box: pick(u2) });
  const r3 = await engineStateCall(win, "redo", [docId]);
  log("seq-6-redo", { ok: r3.ok, modified: r3.modified, canUndo: r3.canUndo, canRedo: r3.canRedo, box: pick(r3) });
}

// ---------------------------------------------------------------------------
// SECTION: RETIRED TOOLBOX RESURRECTION
// ---------------------------------------------------------------------------
const RETIRED = ".edit-inline-field-font, .edit-inline-field-size, .edit-inline-field-color, .edit-inline-field-bg, [data-annotation-color-section]";

async function scanStyleSurfaces(win, where) {
  return win.evaluate((args) => {
    const { ret, where: w } = args;
    const retired = [...document.querySelectorAll(ret)].map((el) => el.className);
    // any font/size/colour input outside the panel while a text-bearing
    // surface is mounted
    const inputs = [...document.querySelectorAll("input, select")].filter((el) => {
      if (el.closest(".text-props-panel")) return false;
      const cls = typeof el.className === "string" ? el.className : "";
      const dt = el.getAttribute("data-txt-font") !== null || el.getAttribute("data-txt-size") !== null ||
        el.getAttribute("data-txt-color") !== null;
      return /font|size|color|colour|highlight/i.test(cls) || dt;
    }).map((el) => ({
      tag: el.tagName, type: el.getAttribute("type"), cls: typeof el.className === "string" ? el.className.slice(0, 60) : "",
      inEditor: !!el.closest("[data-edit-editor]"), inAnnEditor: !!el.closest("[data-annotation-editor]"),
    }));
    return { where: w, retired, suspectInputs: inputs, panelMounted: !!document.querySelector(".text-props-panel") };
  }, { ret: RETIRED, where });
}

async function sectionResurrect(app, win) {
  console.log("\n=== RESURRECT (retired toolbox) ===");
  await openReport(app, win);
  const out = {};

  // text box path
  await createTextBox(win, "RES-A", 0.22, 0.18);
  out.textBox = await scanStyleSurfaces(win, "text-box-selected");

  // action bar Edit path
  await win.click('[data-edit-box-action="edit"]');
  await win.waitForSelector("[data-edit-editor]", { timeout: 8000 });
  out.textBoxEdit = await scanStyleSurfaces(win, "text-box-action-edit");
  await win.keyboard.press("Escape");
  await win.waitForTimeout(400);

  // Tab focus sweep from the panel: does focus ever land on a retired style
  // control (in-canvas) rather than the panel's own?
  const focusHits = [];
  for (let i = 0; i < 45; i += 1) {
    await win.keyboard.press("Tab");
    const a = await win.evaluate(() => {
      const el = document.activeElement;
      if (!el) return null;
      const cls = typeof el.className === "string" ? el.className : "";
      return {
        tag: el.tagName,
        cls: cls.slice(0, 70),
        inPanel: !!el.closest(".text-props-panel"),
        inEditor: !!el.closest("[data-edit-editor]"),
        inAnnEditor: !!el.closest("[data-annotation-editor]"),
        dataTxt: ["font", "size", "bold", "color", "highlight"].find((k) => el.hasAttribute(`data-txt-${k}`)) || null,
      };
    });
    if (a && !a.inPanel && (a.inEditor || a.inAnnEditor)) focusHits.push({ i, ...a });
  }
  out.focusSweep = focusHits;
  await win.keyboard.press("Escape");
  await win.waitForTimeout(300);

  // annotation double-click editor (select an annotation textbox, dblclick)
  await closeEditMode(win);
  await armAnnotationTool(win, "textbox");
  await dragPage(win, 0.4, 0.4, 0.2, 0.08);
  await win.waitForSelector('[data-annotation-editor="textbox"]', { timeout: 8000 });
  await win.locator('[data-annotation-editor="textbox"] textarea').fill("RES-ANN");
  await win.click('[data-annotation-action="textbox-confirm"]');
  await win.waitForTimeout(1200);
  await armAnnotationTool(win, "select");
  await win.waitForTimeout(300);
  const annEl = win.locator(".ann-textbox, .ann-textbox-wrap, .annotation-textbox").first();
  const annCount = await win.locator(".ann-textbox").count();
  if ((await annEl.count()) > 0) {
    // the annotation layer is only a hit surface with a tool armed
    await armAnnotationTool(win, "textbox");
    await win.waitForTimeout(400);
    await annEl.scrollIntoViewIfNeeded().catch(() => {});
    await win.waitForTimeout(500);
    const ab = await annEl.boundingBox();
    await annEl.dblclick({ timeout: 4000 }).catch(() => {});
    await win.waitForTimeout(600);
    out.annDoubleClick = await scanStyleSurfaces(win, "annotation-dblclick");
    out.annDoubleClick.editorOpen = await win.evaluate(() => !!document.querySelector('[data-annotation-editor]'));
    out.annDoubleClick.annCount = annCount;
    out.annDoubleClick.bbox = ab;
    if (!out.annDoubleClick.editorOpen && ab) {
      // retry with an explicit click then dblclick at the centre
      await win.mouse.dblclick(ab.x + ab.width / 2, ab.y + ab.height / 2).catch(() => {});
      await win.waitForTimeout(600);
      out.annDoubleClick.retryEditorOpen = await win.evaluate(() => !!document.querySelector('[data-annotation-editor]'));
    }
    await win.keyboard.press("Escape");
    await win.waitForTimeout(400);
  } else {
    out.annDoubleClick = { skipped: "no .ann-textbox found", annCount };
  }

  // edit-text-run path
  await armAnnotationTool(win, "select");
  await openEditMode(win);
  await win.click('[data-edit-tool="text"]');
  const span = win.locator('.pdf-page[data-page="1"] .textLayer span').filter({ hasText: /[A-Za-z]/ }).first();
  if ((await span.count()) > 0) {
    const sb = await span.boundingBox();
    if (sb) await win.mouse.dblclick(sb.x + sb.width / 2, sb.y + sb.height / 2);
  }
  await win.waitForTimeout(800);
  out.editRun = await scanStyleSurfaces(win, "edit-text-run");
  out.editRun.editorOpen = await win.evaluate(() => !!document.querySelector('[data-edit-editor]'));
  await win.keyboard.press("Escape");
  await win.waitForTimeout(400);

  log("resurrect", out);
  await win.screenshot({ path: path.join(SHOTS, "adv057-resurrect.png") }).catch(() => {});
}

// ---------------------------------------------------------------------------
// SECTION: PANEL STATE MACHINE
// ---------------------------------------------------------------------------
async function sectionPanel(app, win) {
  console.log("\n=== PANEL (state machine) ===");
  await openReport(app, win);
  const trace = [];

  // rapid tool/object switching: box <-> annotation <-> nothing
  for (let i = 0; i < 6; i += 1) {
    await openEditMode(win);
    await win.click('[data-edit-tool="box"]');
    await win.waitForTimeout(25);
    const a = await win.evaluate(() => ({
      mounted: !!document.querySelector(".text-props-panel"),
      mode: document.querySelector("[data-text-panel]")?.getAttribute("data-text-panel-mode") ?? null,
    }));
    trace.push({ step: `box-${i}`, ...a });
    await closeEditMode(win);
    await win.waitForTimeout(25);
    await armAnnotationTool(win, "textbox");
    await win.waitForTimeout(25);
    const b = await win.evaluate(() => ({
      mounted: !!document.querySelector(".text-props-panel"),
      mode: document.querySelector("[data-text-panel]")?.getAttribute("data-text-panel-mode") ?? null,
    }));
    trace.push({ step: `ann-${i}`, ...b });
    await armAnnotationTool(win, "select");
    await win.waitForTimeout(25);
    const c = await win.evaluate(() => ({
      mounted: !!document.querySelector(".text-props-panel"),
      mode: document.querySelector("[data-text-panel]")?.getAttribute("data-text-panel-mode") ?? null,
    }));
    trace.push({ step: `none-${i}`, ...c });
  }
  await win.waitForTimeout(700);
  const settled = await win.evaluate(() => ({
    mounted: !!document.querySelector(".text-props-panel"),
    panels: document.querySelectorAll(".text-props-panel").length,
    mode: document.querySelector("[data-text-panel]")?.getAttribute("data-text-panel-mode") ?? null,
    activeTool: window.tflexDiagnostics().activeTool,
  }));
  log("panel-rapid-switch", { tail: trace.slice(-9), settled });

  // value leak: two committed boxes with different styles
  await openEditMode(win);
  await createTextBox(win, "LEAK-A", 0.2, 0.15);
  await win.locator("[data-txt-bold]").click();
  await win.locator("[data-txt-size]").fill("30");
  await win.locator("[data-txt-color]").fill("#ff0000");
  await win.waitForTimeout(900);
  const stateA = await panelState(win);
  await createTextBox(win, "LEAK-B", 0.5, 0.15);
  const stateB = await panelState(win);
  // select A again
  await win.locator(".edit-box").first().click({ position: { x: 8, y: 8 } });
  await win.waitForTimeout(600);
  const stateA2 = await panelState(win);
  log("panel-value-leak", { stateA, stateB, stateA2 });

  // select annotation then delete it: panel must close
  await closeEditMode(win);
  await armAnnotationTool(win, "textbox");
  await dragPage(win, 0.4, 0.5, 0.2, 0.08);
  await win.waitForSelector('[data-annotation-editor="textbox"]', { timeout: 8000 });
  await win.locator('[data-annotation-editor="textbox"] textarea').fill("DEL-ANN");
  await win.click('[data-annotation-action="textbox-confirm"]');
  await win.waitForTimeout(1200);
  await armAnnotationTool(win, "select");
  await win.waitForTimeout(300);
  const annList = await annotations(win);
  const target = annList.find((a) => a.text === "DEL-ANN") || annList[annList.length - 1];
  let selState = null;
  if (target) {
    // Reachable selection path: re-arm the SAME annotation text tool (the
    // create editor disarmed it on one-shot), then click the committed
    // surface — onPointerDown bails on the interactive surface and the
    // surface's onClick selects it.
    await armAnnotationTool(win, "textbox");
    await win.waitForTimeout(400);
    const annLoc = win.locator(`${ACTIVE_PANE} .ann-textbox`).first();
    await annLoc.scrollIntoViewIfNeeded().catch(() => {});
    await win.waitForTimeout(400);
    await annLoc.click({ timeout: 5000 }).catch(() => {});
    await win.waitForTimeout(700);
    selState = await win.evaluate(() => ({
      panel: !!document.querySelector(".text-props-panel"),
      mode: document.querySelector("[data-text-panel]")?.getAttribute("data-text-panel-mode") ?? null,
      actionBar: !!document.querySelector("[data-content-action-bar]"),
    }));
  }
  const beforeDel = (await annotations(win)).length;
  // delete through the selected annotation's own Delete action
  const delBtn = win.locator('[data-content-action$="-delete"]').first();
  if ((await delBtn.count()) > 0) {
    await delBtn.click({ timeout: 5000 }).catch(() => {});
  } else {
    await win.keyboard.press("Delete");
  }
  await win.waitForTimeout(1200);
  const afterDel = await win.evaluate(() => ({
    count: (window.tflexDiagnostics().engineState.annotations || []).length,
    panel: !!document.querySelector(".text-props-panel"),
    mode: document.querySelector("[data-text-panel]")?.getAttribute("data-text-panel-mode") ?? null,
  }));
  log("panel-annotation-delete", { selState, beforeDel, afterDel });

  // two tabs, switch mid-transition (open tab2 via the CommandBar Open button)
  const p2 = path.join(os.tmpdir(), `adv057-panel-tab2-${Date.now()}.pdf`);
  fs.copyFileSync(getSamplePath("report.pdf"), p2);
  await openEditMode(win);
  await win.click('[data-edit-tool="box"]');
  await win.waitForTimeout(40);
  const tcBefore = await win.locator(".tab").count();
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, p2);
  await win.click("[data-toolbar-open]");
  await win.waitForFunction((n) => document.querySelectorAll(".tab").length > n, tcBefore, { timeout: 15000 }).catch(() => {});
  await win.waitForTimeout(2500);
  const tabs = await win.evaluate(() => ({
    panels: document.querySelectorAll(".text-props-panel").length,
    textPanelOpenAttr: document.querySelector(`${'.tab-pane[aria-hidden="false"]'} .workspace`)?.getAttribute("data-text-panel-open"),
    mode: document.querySelector(`${'.tab-pane[aria-hidden="false"]'} [data-text-panel]`)?.getAttribute("data-text-panel-mode") ?? null,
    tabCount: document.querySelectorAll(".tab").length,
    activePaneCanvases: document.querySelectorAll('.tab-pane[aria-hidden="false"] .pdf-page canvas').length,
  }));
  log("panel-two-tab-switch", tabs);
  // close tab2 so the rest runs single-tab
  await win.locator(".tab-active .tab-close").click().catch(() => {});
  await win.waitForTimeout(1500);

  // open/close repeatedly while patching
  await openEditMode(win);
  await createTextBox(win, "SPAM-PATCH", 0.2, 0.3);
  const id = await firstBoxId(win);
  const docId = (await diag(win)).engineDocId;
  for (let i = 0; i < 12; i += 1) {
    const p = i % 2 === 0 ? { bold: true } : { italic: true };
    void callUpdate(win, docId, id, p);
    await closeEditMode(win);
    await win.waitForTimeout(30);
    await openEditMode(win);
    await win.locator(".edit-box").last().click({ position: { x: 8, y: 8 } }).catch(() => {});
    await win.waitForTimeout(30);
  }
  await win.waitForTimeout(1200);
  const afterSpam = await win.evaluate(() => {
    const d = window.tflexDiagnostics();
    const b = (d.engineState.textBoxes || []).find((x) => x.text === "SPAM-PATCH");
    const p = document.querySelector(".text-props-panel");
    return {
      box: b ? { bold: b.bold, italic: b.italic } : null,
      panelMounted: !!p,
      panelBold: p ? p.querySelector("[data-txt-bold]")?.getAttribute("aria-pressed") : null,
      panelItalic: p ? p.querySelector("[data-txt-italic]")?.getAttribute("aria-pressed") : null,
    };
  });
  log("panel-spam-patch", afterSpam);
  await win.screenshot({ path: path.join(SHOTS, "adv057-panel-spam.png") }).catch(() => {});
}

// ---------------------------------------------------------------------------
// SECTION: LAYOUT COEXISTENCE
// ---------------------------------------------------------------------------
async function setWindowSize(app, width, height) {
  await app.evaluate(({ BrowserWindow }, size) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) w.setSize(size.width, size.height);
  }, { width, height });
  await new Promise((r) => setTimeout(r, 450));
}

async function sectionLayout(app, win) {
  console.log("\n=== LAYOUT (coexistence) ===");
  await openReport(app, win);
  await openEditMode(win);
  await win.click('[data-edit-tool="box"]');
  await win.waitForSelector(".text-props-panel", { timeout: 5000 });
  await win.waitForTimeout(600);

  const results = [];
  for (const [w, h] of [[640, 520], [820, 640], [1440, 900]]) {
    await setWindowSize(app, w, h);
    await win.waitForTimeout(400);
    // open the tools palette too
    const openPalette = await win.locator("[data-tools-palette]").count() === 0;
    if (openPalette) {
      await win.click("[data-tools-toggle]");
      await win.waitForTimeout(500);
    }
    const m = await win.evaluate(() => {
      const rect = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { left: +r.left.toFixed(1), top: +r.top.toFixed(1), right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
      };
      const panel = document.querySelector(".text-props-panel");
      const palette = document.querySelector("[data-tools-palette]");
      const main = document.querySelector(".workspace-main");
      const scroller = document.querySelector(".document-scroller");
      const page = document.querySelector('.pdf-page[data-page="1"]');
      const cmd = document.querySelector(".command-bar, .toolbar");
      const panelBody = document.querySelector(".text-props-body");
      const paletteRect = rect(palette);
      const panelRect = rect(panel);
      const overlap = panelRect && paletteRect
        ? Math.max(0, Math.min(panelRect.right, paletteRect.right) - Math.max(panelRect.left, paletteRect.left))
        : null;
      const unreachable = [...document.querySelectorAll(".text-props-panel button, .text-props-panel input, .text-props-panel select")]
        .filter((el) => {
          const r = el.getBoundingClientRect();
          return r.width === 0 || r.height === 0 || r.right > window.innerWidth + 1 || r.bottom > window.innerHeight + 1;
        }).map((el) => el.getAttribute("data-txt-font") !== null ? "font"
          : (el.getAttribute("data-txt-size") !== null ? "size" : el.tagName + ":" + (typeof el.className === "string" ? el.className.slice(0, 30) : "")));
      // Occlusion: for each ENABLED panel control, what does elementFromPoint
      // at its centre resolve to? A control covered by the palette reports
      // covered:true.
      const covered = [];
      for (const el of document.querySelectorAll(".text-props-panel button, .text-props-panel input, .text-props-panel select")) {
        if (el.disabled) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const hit = document.elementFromPoint(cx, cy);
        const inPanel = hit ? !!hit.closest(".text-props-panel") : false;
        const inPalette = hit ? !!hit.closest("[data-tools-palette]") : false;
        if (!inPanel) {
          covered.push({
            name: el.getAttribute("data-txt-font") !== null ? "font"
              : el.getAttribute("data-txt-size") !== null ? "size"
              : el.getAttribute("data-txt-bold") !== null ? "bold"
              : el.getAttribute("data-txt-color") !== null ? "color"
              : el.getAttribute("data-txt-clear") !== null ? "clear"
              : (typeof el.className === "string" ? el.className.slice(0, 30) : el.tagName),
            inPalette,
            hit: hit ? (typeof hit.className === "string" ? hit.className.slice(0, 40) : hit.tagName) : null,
            rect: [+r.left.toFixed(0), +r.top.toFixed(0), +r.width.toFixed(0), +r.height.toFixed(0)],
          });
        }
      }
      return {
        vw: window.innerWidth, vh: window.innerHeight,
        panel: panelRect, palette: paletteRect, main: rect(main),
        page: rect(page), commandBar: rect(cmd),
        panelPaletteOverlapX: overlap,
        panelClipped: panelBody ? panelBody.scrollWidth > panelBody.clientWidth + 2 : null,
        mainClipped: main ? main.scrollWidth > main.clientWidth + 2 : null,
        hScroll: scroller ? scroller.scrollWidth > scroller.clientWidth + 2 : null,
        unreachable,
        coveredControls: covered,
        zoomInfo: (() => {
          const d = window.tflexDiagnostics();
          return { zoom: d.zoom, mode: d.mode, pageCount: d.pageCount };
        })(),
        canvas: rect(document.querySelector(`${'.tab-pane[aria-hidden="false"]'} .pdf-page[data-page="1"] canvas`)),
      };
    });
    results.push({ size: `${w}x${h}`, ...m });
    await win.screenshot({ path: path.join(SHOTS, `adv057-layout-${w}x${h}.png`) }).catch(() => {});
    if (await win.locator("[data-tools-palette]").count() > 0) {
      await win.click("[data-tools-toggle]");
      await win.waitForTimeout(400);
    }
  }
  log("layout-sizes", results);

  // Grow/shrink recovery with both panels open.
  const growSeq = [];
  for (const [w, h] of [[640, 520], [900, 620], [640, 520], [1440, 900], [640, 520]]) {
    await setWindowSize(app, w, h);
    await win.waitForTimeout(600);
    growSeq.push(await win.evaluate((sz) => {
      const pg = document.querySelector('.tab-pane[aria-hidden="false"] .pdf-page[data-page="1"]');
      const cv = pg ? pg.querySelector("canvas") : null;
      const d = window.tflexDiagnostics();
      const r = pg ? pg.getBoundingClientRect() : null;
      return {
        size: sz,
        pageW: r ? +r.width.toFixed(1) : null,
        pageH: r ? +r.height.toFixed(1) : null,
        canvasW: cv ? +cv.getBoundingClientRect().width.toFixed(1) : null,
        zoom: d.zoom, mode: d.mode,
        vw: window.innerWidth,
      };
    }, `${w}x${h}`));
  }
  log("layout-grow-recovery", growSeq);
  await win.screenshot({ path: path.join(SHOTS, "adv057-layout-grow.png") }).catch(() => {});

  // reflow mid-animation on resize
  await setWindowSize(app, 1440, 900);
  await win.waitForTimeout(400);
  await win.evaluate(() => {
    window.__lr = { rows: [], done: false };
    window.__lrStart = (ms) => {
      window.__lr = { rows: [], done: false };
      const t0 = performance.now();
      const tick = () => {
        const p = document.querySelector(".text-props-panel");
        const m = document.querySelector(".workspace-main");
        const pr = p ? p.getBoundingClientRect() : null;
        const mr = m ? m.getBoundingClientRect() : null;
        window.__lr.rows.push({
          t: Math.round(performance.now() - t0),
          panelW: pr ? +pr.width.toFixed(1) : 0,
          mainLeft: mr ? +mr.left.toFixed(1) : null,
          mainRight: mr ? +mr.right.toFixed(1) : null,
          vw: window.innerWidth,
        });
        if (performance.now() - t0 < ms) requestAnimationFrame(tick);
        else window.__lr.done = true;
      };
      requestAnimationFrame(tick);
    };
  });
  await win.evaluate(() => window.__lrStart(900));
  await setWindowSize(app, 700, 600);
  await win.waitForTimeout(300);
  await setWindowSize(app, 1100, 800);
  await win.waitForFunction(() => window.__lr && window.__lr.done === true, null, { timeout: 8000 }).catch(() => {});
  const rows = await win.evaluate(() => window.__lr.rows);
  const overflows = rows.filter((r) => r.mainRight !== null && r.mainRight > r.vw + 1);
  log("layout-resize-midanim", {
    frames: rows.length,
    overflowFrames: overflows.length,
    firstOverflow: overflows.slice(0, 3),
    last: rows[rows.length - 1],
  });
  await win.screenshot({ path: path.join(SHOTS, "adv057-layout-resize.png") }).catch(() => {});
}

// ---------------------------------------------------------------------------
// SECTION: ANNOTATION MODE
// ---------------------------------------------------------------------------
const ANNOT_DISABLED_SELECTORS = [
  "[data-txt-font]", "[data-txt-size]",
  "[data-txt-bold]", "[data-txt-italic]", "[data-txt-underline]",
  "[data-txt-super]", "[data-txt-sub]",
  "[data-txt-highlight]", "[data-txt-highlight-clear]", "[data-txt-clear]",
  "[data-txt-align-left]", "[data-txt-align-center]", "[data-txt-align-right]", "[data-txt-align-justify]",
  "[data-txt-line-height]",
  "[data-txt-list-none]", "[data-txt-list-bullet]", "[data-txt-list-number]",
  "[data-txt-indent-dec]", "[data-txt-indent-inc]",
  "[data-txt-character-spacing]", "[data-txt-horizontal-scaling]",
];
const ANNOT_REASON = "not supported for annotations - the annotation's text is baked by the annotation engine";

async function sectionAnnot(app, win) {
  console.log("\n=== ANNOT (annotation mode) ===");
  await openReport(app, win);
  await armAnnotationTool(win, "textbox");
  await win.waitForSelector(".text-props-panel", { timeout: 5000 });
  await win.waitForTimeout(600);

  const state = await win.evaluate((sels) => {
    const p = document.querySelector(".text-props-panel");
    const out = {};
    for (const s of sels) {
      const el = p.querySelector(s);
      out[s] = el ? { disabled: !!el.disabled, title: el.getAttribute("title") } : { missing: true };
    }
    return {
      mode: document.querySelector("[data-text-panel]")?.getAttribute("data-text-panel-mode"),
      colour: { disabled: p.querySelector("[data-txt-color]").disabled, title: p.querySelector("[data-txt-color]").getAttribute("title") },
      controls: out,
      note: !!p.querySelector("[data-txt-annotation-note]"),
    };
  }, ANNOT_DISABLED_SELECTORS);
  const wrongTitles = Object.entries(state.controls).filter(([, v]) => v.disabled && v.title !== ANNOT_REASON);
  const missing = Object.entries(state.controls).filter(([, v]) => v.missing);
  const notDisabled = Object.entries(state.controls).filter(([, v]) => !v.missing && !v.disabled);
  log("annot-disabled-set", {
    mode: state.mode, colour: state.colour, note: state.note,
    disabledCount: Object.values(state.controls).filter((v) => v.disabled).length,
    missing: missing.map(([k]) => k), notDisabled: notDisabled.map(([k]) => k),
    wrongTitles: wrongTitles.map(([k, v]) => [k, v.title]),
  });

  // programmatic dispatch on disabled controls (React delegated handler path)
  const before = await annotations(win);
  const beforeModified = (await diag(win)).modified;
  const dispatch = await win.evaluate((sels) => {
    const p = document.querySelector(".text-props-panel");
    const results = [];
    for (const s of sels) {
      const el = p.querySelector(s);
      if (!el) { results.push({ s, missing: true }); continue; }
      try {
        el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        results.push({ s, dispatched: true });
      } catch (e) {
        results.push({ s, dispatched: false, err: String(e.message) });
      }
    }
    return results;
  }, ANNOT_DISABLED_SELECTORS);
  await win.waitForTimeout(800);
  const after = await annotations(win);
  const afterModified = (await diag(win)).modified;
  log("annot-dispatch-sweep", {
    dispatched: dispatch.filter((r) => r.dispatched).length,
    annBefore: before.length, annAfter: after.length,
    payloadSame: JSON.stringify(before) === JSON.stringify(after),
    modifiedBefore: beforeModified, modifiedAfter: afterModified,
  });

  // programmatic change on disabled font select + size input
  const changeResult = await win.evaluate(() => {
    const p = document.querySelector(".text-props-panel");
    const font = p.querySelector("[data-txt-font]");
    const size = p.querySelector("[data-txt-size]");
    const before = { font: font.value, size: size.value };
    try {
      font.value = "Times";
      font.dispatchEvent(new Event("change", { bubbles: true }));
      size.value = "99";
      size.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (e) { return { err: String(e.message), before }; }
    return { before, after: { font: font.value, size: size.value } };
  });
  await win.waitForTimeout(600);
  const afterChange = await panelState(win);
  log("annot-programmatic-change", { changeResult, afterChange });

  // colour path is live: change colour and verify the annotation tool colour
  const colourBefore = await win.evaluate(() => {
    const el = document.querySelector("[data-txt-color]");
    return el ? el.value : null;
  });
  await win.locator("[data-txt-color]").fill("#00ff00");
  await win.waitForTimeout(500);
  const colourAfter = await win.evaluate(() => {
    const el = document.querySelector("[data-txt-color]");
    return { panel: el ? el.value : null };
  });
  log("annot-colour-live", { colourBefore, colourAfter });

  // switching annotation -> text box restores the full live set
  await armAnnotationTool(win, "select");
  await win.waitForTimeout(300);
  await openEditMode(win);
  await win.click('[data-edit-tool="box"]');
  await win.waitForTimeout(500);
  const restored = await win.evaluate(() => {
    const p = document.querySelector(".text-props-panel");
    if (!p) return { mounted: false };
    return {
      mounted: true,
      mode: document.querySelector("[data-text-panel]")?.getAttribute("data-text-panel-mode"),
      fontDisabled: p.querySelector("[data-txt-font]")?.disabled,
      boldDisabled: p.querySelector("[data-txt-bold]")?.disabled,
      colourDisabled: p.querySelector("[data-txt-color]")?.disabled,
    };
  });
  log("annot-to-textbox", restored);
  await win.screenshot({ path: path.join(SHOTS, "adv057-annot.png") }).catch(() => {});
}

// ---------------------------------------------------------------------------
// SECTION: PERSISTENCE / UNDO ABUSE
// ---------------------------------------------------------------------------
async function sectionPersist(app, win) {
  console.log("\n=== PERSIST (persistence/undo) ===");
  await openReport(app, win);
  await createTextBox(win, "FULL-A", 0.2, 0.12);
  const id = await firstBoxId(win);
  const docId = (await diag(win)).engineDocId;

  // apply EVERY style field
  const full = {
    font: "Courier", size: 21, bold: true, italic: true, underline: true,
    baselineShift: 6, align: "justify", lineHeight: 2.1, list: "bullet", indent: 24,
    color: { r: 0, g: 0, b: 1 }, highlight: { r: 1, g: 1, b: 0 },
  };
  const applied = await callUpdate(win, docId, id, full);
  await win.waitForTimeout(1000);
  const liveBox = (await boxes(win)).find((b) => b.id === id) || null;
  log("persist-all-fields-live", { applied, liveBox });

  // save as + reopen
  const savePath = path.join(os.tmpdir(), `adv057-full-${Date.now()}.pdf`);
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
  }, savePath);
  await win.click("[data-toolbar-save-as]");
  await win.waitForSelector("[data-save-as-confirm]", { timeout: 8000 });
  await win.click("[data-save-as-confirm]");
  await win.waitForFunction(() => !window.tflexDiagnostics().modified, null, { timeout: 30000 }).catch(() => {});
  await win.locator(".tab-active .tab-close").click();
  await win.waitForTimeout(1500);
  await openSamplePath(win, app, savePath);
  await win.waitForSelector(".pdf-page canvas", { timeout: 30000 });
  await win.waitForTimeout(1800);
  const reopened = (await boxes(win)).find((b) => b.text === "FULL-A") || null;
  const survive = reopened ? {
    font: reopened.font, size: reopened.size, bold: reopened.bold, italic: reopened.italic,
    underline: reopened.underline, baselineShift: reopened.baselineShift, align: reopened.align,
    lineHeight: reopened.lineHeight, list: reopened.list, indent: reopened.indent,
    color: reopened.color, highlight: reopened.highlight,
  } : null;
  log("persist-reopen", { savedExists: fs.existsSync(savePath), survive });

  // patch a field, undo, save, reopen: which value persists? Use a fresh
  // UI-created box (createTextBox leaves it selected + panel open).
  await createTextBox(win, "UNDO-A", 0.3, 0.2);
  const id2 = (await boxes(win)).find((b) => b.text === "UNDO-A")?.id ?? null;
  if (id2) {
    log("persist-undo-setup", { id2, panelUp: await win.locator(".text-props-panel").count() });
    await win.locator("[data-txt-size]").fill("5");
    await win.waitForTimeout(1000);
    const afterPatch = (await boxes(win)).find((b) => b.id === id2);
    await win.keyboard.press("Control+z");
    await win.waitForTimeout(900);
    const afterUndo = (await boxes(win)).find((b) => b.id === id2);
    const savePath2 = path.join(os.tmpdir(), `adv057-undo-${Date.now()}.pdf`);
    await app.evaluate(async ({ dialog }, p) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, savePath2);
    await win.click("[data-toolbar-save-as]");
    await win.waitForSelector("[data-save-as-confirm]", { timeout: 8000 });
    await win.click("[data-save-as-confirm]");
    await win.waitForFunction(() => !window.tflexDiagnostics().modified, null, { timeout: 30000 }).catch(() => {});
    await win.locator(".tab-active .tab-close").click();
    await win.waitForTimeout(1500);
    await openSamplePath(win, app, savePath2);
    await win.waitForSelector(".pdf-page canvas", { timeout: 30000 });
    await win.waitForTimeout(1800);
    const persisted = (await boxes(win)).find((b) => b.text === "UNDO-A") || null;
    log("persist-undo-save-reopen", {
      afterPatchSize: afterPatch?.size, afterUndoSize: afterUndo?.size,
      persistedSize: persisted?.size,
    });
  }

  // 50 rapid UI patches then one undo: panel vs model
  await openEditMode(win);
  await createTextBox(win, "RAPID-A", 0.3, 0.3);
  await win.waitForTimeout(500);
  const boldBefore = await panelState(win);
  for (let i = 0; i < 50; i += 1) {
    await win.locator("[data-txt-bold]").click({ timeout: 2000 }).catch(() => {});
  }
  await win.waitForTimeout(1800);
  const after50 = await win.evaluate(() => {
    const d = window.tflexDiagnostics();
    const b = (d.engineState.textBoxes || []).find((x) => x.text === "RAPID-A");
    const p = document.querySelector(".text-props-panel");
    return {
      modelBold: b ? b.bold : null,
      panelBold: p ? p.querySelector("[data-txt-bold]")?.getAttribute("aria-pressed") : null,
      canUndo: d.canUndo,
    };
  });
  await win.keyboard.press("Control+z");
  await win.waitForTimeout(1200);
  const afterUndo = await win.evaluate(() => {
    const d = window.tflexDiagnostics();
    const b = (d.engineState.textBoxes || []).find((x) => x.text === "RAPID-A");
    const p = document.querySelector(".text-props-panel");
    return {
      modelBold: b ? b.bold : null,
      panelBold: p ? p.querySelector("[data-txt-bold]")?.getAttribute("aria-pressed") : null,
      canUndo: d.canUndo, canRedo: d.canRedo,
    };
  });
  log("persist-50-rapid-undo", { boldBefore, after50, afterUndo });
  await win.screenshot({ path: path.join(SHOTS, "adv057-persist-rapid.png") }).catch(() => {});
}

// ---------------------------------------------------------------------------
// SECTION: PERF
// ---------------------------------------------------------------------------
async function sectionPerf(app, win) {
  console.log("\n=== PERF (34-page report) ===");
  await openReport(app, win);
  await installFrameProbe(win);
  await win.bringToFront().catch(() => {});
  const results = [];
  const POS = { light: [0.25, 0.15], dark: [0.55, 0.2], frosted: [0.3, 0.55] };
  for (const theme of ["light", "dark", "frosted"]) {
    await setTheme(win, theme);
    await win.waitForTimeout(400);
    await closeEditMode(win);
    await win.waitForTimeout(300);

    // panel open (annotation textbox arm)
    await frameStart(win, 900);
    await armAnnotationTool(win, "textbox");
    let d = await frameRead(win);
    results.push({ theme, action: "panel-open", ...frameStats(d) });
    await win.waitForTimeout(500);

    // panel close
    await frameStart(win, 800);
    await armAnnotationTool(win, "select");
    d = await frameRead(win);
    results.push({ theme, action: "panel-close", ...frameStats(d) });
    await win.waitForTimeout(500);

    // a real engine patch on a committed box: create it, then click bold
    // while it is selected and the panel is open.
    try {
      await createTextBox(win, `PERF-${theme}`, POS[theme][0], POS[theme][1]);
      await win.waitForTimeout(400);
      await frameStart(win, 900);
      await win.locator("[data-txt-bold]").click();
      d = await frameRead(win);
      results.push({ theme, action: "patch-bold", ...frameStats(d) });
    } catch (e) {
      results.push({ theme, action: "patch-bold", skipped: String(e.message).slice(0, 80) });
    }
    await win.waitForTimeout(500);
    await closeEditMode(win);
    await win.waitForTimeout(400);
  }
  for (const r of results) log(`perf-${r.theme}-${r.action}`, r);
  fs.writeFileSync(path.join(SHOTS, "adv057-perf.json"), JSON.stringify(results, null, 2));
}

// ---------------------------------------------------------------------------
// SECTION: SILENCE (no-op sweep on the panel controls)
// ---------------------------------------------------------------------------
async function sectionSilence(app, win) {
  console.log("\n=== SILENCE (panel control sweep) ===");
  await openReport(app, win);
  await createTextBox(win, "SILENT-A", 0.25, 0.18);
  await win.waitForTimeout(600);

  const snap = async () => {
    const d = await diag(win);
    const b = (d.engineState.textBoxes || []).find((x) => x.text === "SILENT-A");
    return b ? {
      font: b.font, size: b.size, bold: b.bold, italic: b.italic, underline: b.underline,
      baselineShift: b.baselineShift, color: b.color, highlight: b.highlight ?? null,
      align: b.align, lineHeight: b.lineHeight, list: b.list, indent: b.indent, text: b.text,
    } : null;
  };

  const rows = [];
  const clickStep = async (name, sel, act) => {
    const before = await snap();
    try {
      if (act) await act();
      else await win.locator(sel).click({ timeout: 3000 });
    } catch (e) {
      rows.push({ name, sel, error: String(e.message).split("\n")[0].slice(0, 100) });
      return;
    }
    await win.waitForTimeout(700);
    const after = await snap();
    const changed = JSON.stringify(before) !== JSON.stringify(after);
    rows.push({ name, sel, changed, before, after });
  };

  await clickStep("bold", "[data-txt-bold]");
  await clickStep("italic", "[data-txt-italic]");
  await clickStep("underline", "[data-txt-underline]");
  await clickStep("superscript", "[data-txt-super]");
  await clickStep("subscript", "[data-txt-sub]");
  await clickStep("align-center", "[data-txt-align-center]");
  await clickStep("align-right", "[data-txt-align-right]");
  await clickStep("align-justify", "[data-txt-align-justify]");
  await clickStep("list-bullet", "[data-txt-list-bullet]");
  await clickStep("list-number", "[data-txt-list-number]");
  await clickStep("indent-inc", "[data-txt-indent-inc]");
  await clickStep("indent-dec", "[data-txt-indent-dec]");
  await clickStep("font-Times", "[data-txt-font]", async () => { await win.locator("[data-txt-font]").selectOption("Times"); });
  await clickStep("size-18", "[data-txt-size]", async () => { await win.locator("[data-txt-size]").fill("18"); });
  await clickStep("lineHeight-1.8", "[data-txt-line-height]", async () => { await win.locator("[data-txt-line-height]").fill("1.8"); });
  await clickStep("colour-red", "[data-txt-color]", async () => { await win.locator("[data-txt-color]").fill("#ff0000"); });
  await clickStep("highlight-yellow", "[data-txt-highlight]", async () => { await win.locator("[data-txt-highlight]").fill("#ffff00"); });
  await clickStep("highlight-none", "[data-txt-highlight-clear]");
  await clickStep("clear-formatting", "[data-txt-clear]");

  // disabled spacing controls: enabled? clickable?
  const spacing = await win.evaluate(() => {
    const a = document.querySelector("[data-txt-character-spacing]");
    const b = document.querySelector("[data-txt-horizontal-scaling]");
    return {
      charSpacing: a ? { disabled: a.disabled, title: a.getAttribute("title") } : null,
      hScaling: b ? { disabled: b.disabled, title: b.getAttribute("title") } : null,
    };
  });
  const beforeSpacing = await snap();
  for (const sel of ["[data-txt-character-spacing]", "[data-txt-horizontal-scaling]"]) {
    await win.locator(sel).click({ force: true, timeout: 2000 }).catch(() => {});
  }
  await win.waitForTimeout(600);
  const afterSpacing = await snap();
  log("silence-spacing-disabled", {
    spacing, changed: JSON.stringify(beforeSpacing) !== JSON.stringify(afterSpacing),
    before: beforeSpacing, after: afterSpacing,
  });

  log("silence-sweep", {
    total: rows.length,
    noChange: rows.filter((r) => r.changed === false).map((r) => ({ name: r.name, sel: r.sel })),
    errors: rows.filter((r) => r.error).map((r) => ({ name: r.name, error: r.error })),
    rows,
  });
  await win.screenshot({ path: path.join(SHOTS, "adv057-silence.png") }).catch(() => {});
}

// ---------------------------------------------------------------------------
async function run(section) {
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector(".sample-card", { timeout: 30000 });
    const sections = {
      geom: () => sectionGeom(app, win),
      patch: () => sectionPatch(app, win),
      patchseq: () => sectionPatchSeq(app, win),
      resurrect: () => sectionResurrect(app, win),
      panel: () => sectionPanel(app, win),
      layout: () => sectionLayout(app, win),
      annot: () => sectionAnnot(app, win),
      persist: () => sectionPersist(app, win),
      perf: () => sectionPerf(app, win),
      silence: () => sectionSilence(app, win),
    };
    if (section === "all") {
      for (const [name, fn] of Object.entries(sections)) {
        try {
          await fn();
        } catch (e) {
          log(`section-${name}-error`, { error: String(e && e.stack ? e.stack : e).slice(0, 500) });
        }
      }
    } else if (sections[section]) {
      await sections[section]();
    } else {
      throw new Error(`unknown section ${section}`);
    }
  } finally {
    await hardClose(app, `adv057-${section}`);
  }
}

const section = process.argv[2] || "all";
run(section)
  .then(() => {
    console.log(`[adv057] DONE ${section}`);
    process.exit(0);
  })
  .catch((e) => {
    console.error(`[adv057] FAILED ${section}: ${e && e.stack ? e.stack : e}`);
    process.exit(1);
  });
