// ADV phase-20 gate — attack the animation standard (morphing surfaces,
// animated resizes, token-driven exits).
//
// Usage: node test-fixtures/tools/adv051_phase20.cjs <section>
//   sections: spam | midanim | edges | perf | ghosts | stacking | all
//
// Requires the dev bundle (dist/) — run `npm.cmd run build` first.
// Canonical launcher only (../../e2e/lib/launch.cjs). Never edits product code.
"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { launchApp, getSamplePath } = require("../../e2e/lib/launch.cjs");
const { hardClose } = require("../../e2e/lib/helpers.cjs");

const SHOTS = path.resolve(__dirname, "..", "..", "screenshots");
fs.mkdirSync(SHOTS, { recursive: true });

function log(label, obj) {
  console.log(`[adv051] ${label} ${JSON.stringify(obj)}`);
}

function near(a, b, tol) {
  return Math.abs(a - b) <= tol;
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

async function setTheme(win, want) {
  const current = await win.evaluate(() => document.documentElement.getAttribute("data-theme"));
  if (current === want) return;
  await win.click("[data-theme-toggle]");
  await win.waitForSelector(".theme-toggle-popover", { timeout: 5000 });
  await win.click(`[data-theme-option="${want}"]`);
  await win.waitForFunction(
    (w) => document.documentElement.getAttribute("data-theme") === w,
    want,
    { timeout: 5000 },
  );
  await win.waitForTimeout(450);
}

async function ensureClosed(win) {
  await win.keyboard.press("Escape");
  await win.waitForTimeout(450);
}

async function setWindowSize(app, width, height) {
  await app.evaluate(({ BrowserWindow }, size) => {
    const w = BrowserWindow.getAllWindows()[0];
    if (w) w.setSize(size.width, size.height);
  }, { width, height });
  await new Promise((r) => setTimeout(r, 400));
}

// ---------------------------------------------------------------------------
// In-page probes
// ---------------------------------------------------------------------------
async function installProbe(win) {
  await win.evaluate(() => {
    window.__p = { rows: [], done: true };
    window.__pStart = (surfaceSel, triggerSel, ms) => {
      window.__p = { rows: [], done: false };
      const t0 = performance.now();
      const tick = () => {
        const t = Math.round(performance.now() - t0);
        const surf = document.querySelector(surfaceSel);
        const trig = document.querySelector(triggerSel);
        const row = { t, n: surf ? 1 : 0 };
        row.cnt = document.querySelectorAll(surfaceSel).length;
        if (trig) {
          const r = trig.getBoundingClientRect();
          row.trig = [+r.left.toFixed(1), +r.top.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1), +r.right.toFixed(1), +r.bottom.toFixed(1)];
        }
        if (surf) {
          const cs = getComputedStyle(surf);
          const r = surf.getBoundingClientRect();
          row.s = [+r.left.toFixed(1), +r.top.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1), +r.right.toFixed(1), +r.bottom.toFixed(1)];
          row.op = +(+cs.opacity).toFixed(3);
          row.tr = cs.transform;
          row.to = cs.transformOrigin;
          row.morph = surf.getAttribute("data-tf-morph");
          row.pe = cs.pointerEvents;
          row.inert = surf.hasAttribute("inert") || surf.closest("[inert]") !== null;
        }
        window.__p.rows.push(row);
        if (performance.now() - t0 < ms) requestAnimationFrame(tick);
        else window.__p.done = true;
      };
      requestAnimationFrame(tick);
    };
  });
}

async function probeStart(win, surfaceSel, triggerSel, ms) {
  await win.evaluate(([s, t, m]) => window.__pStart(s, t, m), [surfaceSel, triggerSel, ms]);
}

async function probeRead(win) {
  await win
    .waitForFunction(() => window.__p && window.__p.done === true, null, { timeout: 15000 })
    .catch(() => {});
  return win.evaluate(() => window.__p.rows);
}

async function installFrameProbe(win) {
  await win.evaluate(() => {
    window.__f = { deltas: [], done: true };
    window.__fStart = (ms) => {
      window.__f = { deltas: [], done: false };
      let last = performance.now();
      const t0 = last;
      const tick = (now) => {
        window.__f.deltas.push(+(now - last).toFixed(2));
        last = now;
        if (now - t0 < ms) requestAnimationFrame(tick);
        else window.__f.done = true;
      };
      requestAnimationFrame(tick);
    };
  });
}

async function frameStart(win, ms) {
  await win.evaluate((m) => window.__fStart(m), ms);
}

async function frameRead(win) {
  await win
    .waitForFunction(() => window.__f && window.__f.done === true, null, { timeout: 20000 })
    .catch(() => {});
  return win.evaluate(() => window.__f.deltas);
}

function frameStats(deltas) {
  const d = deltas.slice(2); // drop startup frames
  if (d.length === 0) return { n: 0 };
  const sorted = [...d].sort((a, b) => a - b);
  const pick = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
  const over = d.filter((x) => x > 16.7).length;
  return {
    n: d.length,
    p50: +pick(0.5).toFixed(1),
    p95: +pick(0.95).toFixed(1),
    max: +sorted[sorted.length - 1].toFixed(1),
    over16_7: over,
    over33: d.filter((x) => x > 33).length,
    mean: +(d.reduce((a, b) => a + b, 0) / d.length).toFixed(1),
  };
}

// ---------------------------------------------------------------------------
// Section: SPAM — rapid open/close of the three morph menus
// ---------------------------------------------------------------------------
const MENUS = [
  { name: "theme", trigger: "[data-theme-toggle]", surface: ".theme-toggle-popover" },
  { name: "titlebar", trigger: "[data-menu-button]", surface: ".titlebar-menu-popover" },
  { name: "ann", trigger: "[data-ann-dropdown-toggle]", surface: ".ann-tool-menu" },
];

async function sectionSpam(win) {
  console.log("\n=== SPAM: rapid morph open/close ===");
  await installProbe(win);
  for (const m of MENUS) {
    await ensureClosed(win);
    await probeStart(win, m.surface, m.trigger, 6000);
    // 26 trigger clicks at 30-80ms gaps => each lands mid-morph.
    for (let i = 0; i < 26; i += 1) {
      await win.click(m.trigger, { timeout: 4000 }).catch(() => {});
      await win.waitForTimeout(30 + (i % 4) * 15);
    }
    const rows = await probeRead(win);
    // settle and inspect the resting state
    await win.waitForTimeout(700);
    const rest = await win.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return { present: false };
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        present: true,
        x: +r.left.toFixed(1), y: +r.top.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1),
        op: +cs.opacity, tr: cs.transform, pe: cs.pointerEvents,
        morph: el.getAttribute("data-tf-morph"),
      };
    }, m.surface);
    const multi = rows.filter((r) => (r.cnt || 0) > 1).length;
    const enters = [];
    let prevN = 0;
    let prevMorph = null;
    for (let i = 0; i < rows.length; i += 1) {
      const r = rows[i];
      const rising = (r.n || 0) > 0 && (prevN === 0 || (prevMorph === "out" && r.morph === "in"));
      if (rising && r.s && r.trig) {
        enters.push({
          t: r.t,
          op: r.op,
          to: r.to,
          morph: r.morph,
          dev: +Math.max(
            Math.abs(r.s[0] - r.trig[0]),
            Math.abs(r.s[1] - r.trig[1]),
            Math.abs(r.s[2] - r.trig[2]),
            Math.abs(r.s[3] - r.trig[3]),
          ).toFixed(1),
        });
      }
      prevN = r.n || 0;
      prevMorph = r.morph || prevMorph;
    }
    // resting flush check: last opaque frame gap below trigger
    const opaque = rows.filter((r) => (r.n || 0) > 0 && r.op >= 0.99 && r.trig);
    const lastOpaque = opaque[opaque.length - 1];
    const gapBelow = lastOpaque ? +(lastOpaque.s[1] - lastOpaque.trig[5]).toFixed(1) : null;
    const devs = enters.map((e) => e.dev);
    const ghostFrames = rows.filter((r) => (r.n || 0) > 0 && r.op <= 0.001).length;
    const outRows = rows.filter((r) => (r.n || 0) > 0 && r.morph === "out");
    const exitNoPe = outRows.filter((r) => r.pe !== "none").length;
    const presentRows = rows.filter((r) => (r.n || 0) > 0);
    log(`spam-${m.name}`, {
      frames: rows.length,
      multiSurfaceFrames: multi,
      enterCount: enters.length,
      firstFrameDevs: devs,
      maxDev: devs.length ? Math.max(...devs) : null,
      entersOver2_5px: devs.filter((d) => d > 2.5).length,
      gapBelowAtRest: gapBelow,
      ghostFrames,
      exitFramesWithoutPointerNone: exitNoPe,
      outFrameCount: outRows.length,
      outPeValues: [...new Set(outRows.map((r) => r.pe))],
      outFirstFrames: outRows.slice(0, 6).map((r) => ({ t: r.t, op: r.op, pe: r.pe, morph: r.morph })),
      opValues: [...new Set(presentRows.map((r) => r.op))].slice(0, 10),
      rest,
    });
    await win.screenshot({ path: path.join(SHOTS, `adv051-spam-${m.name}.png`) }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Section: MIDANIM — interaction during an in-flight animation
// ---------------------------------------------------------------------------
async function sectionMidanim(app, win) {
  console.log("\n=== MIDANIM ===");
  await installProbe(win);

  // A) click a theme option mid-enter
  await setTheme(win, "frosted");
  await ensureClosed(win);
  await win.click("[data-theme-toggle]");
  await win.waitForTimeout(55);
  await win.click('[data-theme-option="dark"]', { timeout: 4000 }).catch((e) => log("theme-mid-click-err", { msg: String(e.message).slice(0, 120) }));
  await win.waitForTimeout(700);
  const themeAfter = await win.evaluate(() => document.documentElement.getAttribute("data-theme"));
  const popAfter = await win.locator(".theme-toggle-popover").count();
  log("midanim-theme-option", { themeAfter, popoverCount: popAfter, expectTheme: "dark" });

  // B) click an annotation row mid-enter (must arm exactly once)
  await ensureClosed(win);
  await win.click("[data-ann-dropdown-toggle]");
  await win.waitForSelector("[data-ann-dropdown-menu]", { timeout: 5000 });
  await win.click('[data-ann-dropdown-menu] [data-tool="rect"]');
  await win.waitForTimeout(400);
  const armedBefore = await win.evaluate(() => window.tflexDiagnostics().activeTool);
  // disarm rect so a single mid-morph arm is observable
  await win.click("[data-ann-dropdown-toggle]");
  await win.waitForSelector("[data-ann-dropdown-menu]", { timeout: 5000 });
  await win.click('[data-ann-dropdown-menu] [data-tool="rect"]');
  await win.waitForTimeout(400);
  await ensureClosed(win);
  const baselineTool = await win.evaluate(() => window.tflexDiagnostics().activeTool);
  await win.click("[data-ann-dropdown-toggle]");
  await win.waitForTimeout(50);
  await win.click('[data-ann-dropdown-menu] [data-tool="rect"]', { timeout: 4000 }).catch((e) => log("ann-mid-click-err", { msg: String(e.message).slice(0, 120) }));
  await win.waitForTimeout(600);
  const midTool = await win.evaluate(() => window.tflexDiagnostics().activeTool);
  const menuCount = await win.locator("[data-ann-dropdown-menu]").count();
  log("midanim-ann-row", { baselineTool, midTool, menuCount, armedBefore, expectMid: "rect" });

  // C) sign tabs: click the next tab mid-resize
  await ensureClosed(win);
  await win.click('button[data-icon="sign"]');
  await win.waitForSelector(".sig-manager", { timeout: 8000 });
  await win.waitForTimeout(500);
  await win.locator(".sig-tab", { hasText: "Draw" }).first().click();
  await win.waitForTimeout(450);
  await win.locator(".sig-tab", { hasText: "Type" }).first().click();
  await win.waitForTimeout(70);
  await win.locator(".sig-tab", { hasText: "Saved" }).first().click();
  await win.waitForTimeout(800);
  const signState = await win.evaluate(() => {
    const panes = [...document.querySelectorAll(".sig-tab-pane")];
    const frame = document.querySelector("[data-tf-resize]");
    return {
      panes: panes.map((p) => p.getAttribute("data-tf-pane")),
      paneCount: panes.length,
      outPanes: panes.filter((p) => p.getAttribute("data-tf-pane") === "out").length,
      frameH: frame ? Math.round(frame.getBoundingClientRect().height) : null,
      frameTr: frame ? getComputedStyle(frame).transform : null,
      activeTab: document.querySelector(".sig-tab-active") ? document.querySelector(".sig-tab-active").textContent.trim() : null,
    };
  });
  log("midanim-sign-tabs", signState);
  await win.screenshot({ path: path.join(SHOTS, "adv051-midanim-sign.png") }).catch(() => {});
  await win.keyboard.press("Escape");
  await win.waitForTimeout(500);

  // D) Escape mid-morph
  await ensureClosed(win);
  await win.click("[data-theme-toggle]");
  await win.waitForTimeout(50);
  await win.keyboard.press("Escape");
  await win.waitForTimeout(600);
  const escCount = await win.locator(".theme-toggle-popover").count();
  const escExpanded = await win.evaluate(() => document.querySelector("[data-theme-toggle]").getAttribute("aria-expanded"));
  log("midanim-escape", { popoverCount: escCount, ariaExpanded: escExpanded });

  // E) Ctrl+Enter key-repeat on the edit inline editor mid-exit
  await ensureClosed(win);
  await win.click('button[aria-label="Edit content"]');
  await win.waitForSelector("[data-edit-toolbar]", { timeout: 8000 });
  await win.click('[data-edit-tool="box"]');
  const page = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  const x = page.x + page.width * 0.3;
  const y = page.y + page.height * 0.3;
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + 180, y + 60, { steps: 6 });
  await win.mouse.up();
  await win.waitForSelector("[data-edit-editor]", { timeout: 8000 });
  await win.locator("[data-edit-textarea]").fill("DUP-TEST");
  // commit via the Apply button (mousedown preventDefault keeps textarea focus)
  await win.click("[data-edit-confirm]");
  const focusAfterCommit = await win.evaluate(() => {
    const a = document.activeElement;
    return {
      tag: a ? a.tagName : null,
      cls: a && typeof a.className === "string" ? a.className.slice(0, 60) : null,
      inEditor: !!(a && a.closest("[data-edit-editor]")),
      editorPresent: !!document.querySelector("[data-edit-editor]"),
    };
  });
  // hammer Ctrl+Enter during the exit window
  for (let i = 0; i < 8; i += 1) {
    await win.keyboard.press("Control+Enter").catch(() => {});
    await win.waitForTimeout(18);
  }
  await win.waitForTimeout(1500);
  const editCount = await win.evaluate(() => ({
    boxes: document.querySelectorAll(".edit-box").length,
    editors: document.querySelectorAll("[data-edit-editor]").length,
  }));
  log("midanim-edit-keyrepeat", { focusAfterCommit, ...editCount });
  await win.screenshot({ path: path.join(SHOTS, "adv051-midanim-edit-keyrepeat.png") }).catch(() => {});
  await win.click('button[aria-label="Edit content"]').catch(() => {});
  await win.waitForTimeout(400);

  // F) annotation textbox Ctrl+Enter key-repeat mid-exit (inert guard present)
  await ensureClosed(win);
  await win.click("[data-ann-dropdown-toggle]");
  await win.waitForSelector("[data-ann-dropdown-menu]", { timeout: 5000 });
  await win.click('[data-ann-dropdown-menu] [data-tool="textbox"]');
  await win.waitForTimeout(400);
  const pg = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  await win.mouse.click(pg.x + 220, pg.y + 220);
  await win.waitForSelector('[data-annotation-editor="textbox"]', { timeout: 8000 });
  await win.locator('[data-annotation-editor="textbox"] textarea').fill("ANN-DUP");
  const annBefore = await win.evaluate(() => {
    const d = window.tflexDiagnostics();
    return d.engineState && d.engineState.annotations ? d.engineState.annotations.length : -1;
  });
  await win.click('[data-annotation-action="textbox-confirm"]');
  const annFocus = await win.evaluate(() => {
    const a = document.activeElement;
    return { tag: a ? a.tagName : null, inEditor: !!(a && a.closest('[data-annotation-editor="textbox"]')), editorPresent: !!document.querySelector('[data-annotation-editor="textbox"]') };
  });
  for (let i = 0; i < 8; i += 1) {
    await win.keyboard.press("Control+Enter").catch(() => {});
    await win.waitForTimeout(18);
  }
  await win.waitForTimeout(1500);
  const annAfter = await win.evaluate(() => {
    const d = window.tflexDiagnostics();
    return d.engineState && d.engineState.annotations ? d.engineState.annotations.length : -1;
  });
  log("midanim-ann-keyrepeat", { annBefore, annAfter, annFocus });
}

// ---------------------------------------------------------------------------
// Section: EDGES — 640px window, clamped placement, resize mid-flight
// ---------------------------------------------------------------------------
async function sectionEdges(app, win) {
  console.log("\n=== EDGES ===");
  await installProbe(win);
  await setWindowSize(app, 640, 520);
  await setTheme(win, "light");
  const vp = await win.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }));
  log("edges-viewport", vp);
  for (const m of MENUS) {
    await ensureClosed(win);
    await probeStart(win, m.surface, m.trigger, 1200);
    await win.click(m.trigger, { timeout: 4000 }).catch(() => {});
    const rows = await probeRead(win);
    await win.waitForTimeout(400);
    const final = await win.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: +r.left.toFixed(1), y: +r.top.toFixed(1), right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
    }, m.surface);
    const trig = await win.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: +r.left.toFixed(1), y: +r.top.toFixed(1), right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) };
    }, m.trigger);
    const visible = rows.filter((r) => (r.n || 0) > 0);
    const first = visible[0];
    log(`edges-640-${m.name}`, {
      trigger: trig,
      first: first ? { s: first.s, dev: first.trig ? +Math.max(
        Math.abs(first.s[0] - first.trig[0]),
        Math.abs(first.s[1] - first.trig[1]),
        Math.abs(first.s[2] - first.trig[2]),
        Math.abs(first.s[3] - first.trig[3]),
      ).toFixed(1) : null } : null,
      final,
      insideViewport: final ? (final.right <= vp.w + 1 && final.bottom <= vp.h + 1 && final.x >= -1 && final.y >= -1) : null,
    });
    await win.screenshot({ path: path.join(SHOTS, `adv051-edges-640-${m.name}.png`) }).catch(() => {});
  }

  // resize window while a morph is mid-flight
  await ensureClosed(win);
  await win.click("[data-theme-toggle]");
  await win.waitForTimeout(45);
  await setWindowSize(app, 900, 700);
  await win.waitForTimeout(700);
  const afterResize = await win.evaluate(() => {
    const el = document.querySelector(".theme-toggle-popover");
    if (!el) return { present: false };
    const r = el.getBoundingClientRect();
    return {
      present: true,
      x: +r.left.toFixed(1), y: +r.top.toFixed(1), right: +r.right.toFixed(1), bottom: +r.bottom.toFixed(1),
      op: getComputedStyle(el).opacity, tr: getComputedStyle(el).transform,
      vw: window.innerWidth, vh: window.innerHeight,
      inside: r.left >= -1 && r.top >= -1 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight + 1,
    };
  });
  log("edges-resize-mid-morph", afterResize);
  await ensureClosed(win);

  // resize window while the Sign resize is mid-flight
  await win.click('button[data-icon="sign"]');
  await win.waitForSelector(".sig-manager", { timeout: 8000 });
  await win.waitForTimeout(500);
  await win.locator(".sig-tab", { hasText: "Draw" }).first().click();
  await win.waitForTimeout(400);
  await win.locator(".sig-tab", { hasText: "Type" }).first().click();
  await win.waitForTimeout(50);
  await setWindowSize(app, 700, 560);
  await win.waitForTimeout(900);
  const signResize = await win.evaluate(() => {
    const frame = document.querySelector("[data-tf-resize]");
    return {
      frameH: frame ? Math.round(frame.getBoundingClientRect().height) : null,
      frameW: frame ? Math.round(frame.getBoundingClientRect().width) : null,
      outPanes: document.querySelectorAll('.sig-tab-pane[data-tf-pane="out"]').length,
    };
  });
  log("edges-resize-mid-sign", signResize);
  await win.keyboard.press("Escape");
  await win.waitForTimeout(400);
  await setWindowSize(app, 1280, 800);
}

// ---------------------------------------------------------------------------
// Section: PERF — rAF frame times in all three themes
// ---------------------------------------------------------------------------
async function sectionPerf(app, win) {
  console.log("\n=== PERF ===");
  await installFrameProbe(win);
  await win.bringToFront().catch(() => {});
  const results = [];
  for (const theme of ["light", "dark", "frosted"]) {
    await setTheme(win, theme);
    await ensureClosed(win);
    await win.waitForTimeout(300);

    // (a) menu morph
    await frameStart(win, 900);
    await win.click("[data-theme-toggle]");
    let d = await frameRead(win);
    results.push({ theme, action: "theme-morph-open", ...frameStats(d) });
    await frameStart(win, 700);
    await win.keyboard.press("Escape");
    d = await frameRead(win);
    results.push({ theme, action: "theme-morph-close", ...frameStats(d) });
    await win.waitForTimeout(400);

    // (b) sign tab resize
    await win.click('button[data-icon="sign"]');
    await win.waitForSelector(".sig-manager", { timeout: 8000 });
    await win.waitForTimeout(500);
    await win.locator(".sig-tab", { hasText: "Draw" }).first().click();
    await win.waitForTimeout(400);
    await frameStart(win, 700);
    await win.locator(".sig-tab", { hasText: "Type" }).first().click();
    d = await frameRead(win);
    results.push({ theme, action: "sign-tab-resize", ...frameStats(d) });
    await win.keyboard.press("Escape");
    await win.waitForTimeout(500);

    // (c) tools palette list<->grid resize
    await win.click("[data-tools-toggle]");
    await win.waitForSelector("[data-tools-palette]", { timeout: 8000 });
    await win.waitForTimeout(450);
    await frameStart(win, 700);
    await win.click('[data-tools-layout="grid"]');
    d = await frameRead(win);
    results.push({ theme, action: "palette-resize-grid", ...frameStats(d) });
    await win.waitForTimeout(300);
    await win.click("[data-tools-toggle]");
    await win.waitForTimeout(400);

    // (d) a swap: edit toolbar -> inline editor
    await win.click('button[aria-label="Edit content"]');
    await win.waitForSelector("[data-edit-toolbar]", { timeout: 8000 });
    await win.click('[data-edit-tool="box"]');
    const page = await win.locator('.pdf-page[data-page="1"]').boundingBox();
    await frameStart(win, 700);
    await win.mouse.move(page.x + page.width * 0.3, page.y + page.height * 0.3);
    await win.mouse.down();
    await win.mouse.move(page.x + page.width * 0.3 + 160, page.y + page.height * 0.3 + 50, { steps: 5 });
    await win.mouse.up();
    d = await frameRead(win);
    results.push({ theme, action: "swap-toolbar-to-editor", ...frameStats(d) });
    await win.keyboard.press("Escape");
    await win.waitForTimeout(300);
    await win.click('button[aria-label="Edit content"]').catch(() => {});
    await win.waitForTimeout(400);
  }
  for (const r of results) log(`perf-${r.theme}-${r.action}`, r);
  fs.writeFileSync(path.join(SHOTS, "adv051-perf.json"), JSON.stringify(results, null, 2));
}

// ---------------------------------------------------------------------------
// Section: GHOSTS — exiting nodes and a11y
// ---------------------------------------------------------------------------
async function sectionGhosts(win) {
  console.log("\n=== GHOSTS ===");
  await installProbe(win);

  // Search bar exit
  await ensureClosed(win);
  await win.keyboard.press("Control+f");
  await win.waitForSelector(".search-bar", { timeout: 6000 });
  await win.waitForTimeout(300);
  await win.locator(".search-bar input").first().focus();
  await win.keyboard.type("QA");
  const box = await win.locator(".search-bar").boundingBox();
  await probeStart(win, ".search-bar", "[data-menu-button]", 800);
  await win.keyboard.press("Escape");
  const focusState = await win.evaluate(() => {
    const a = document.activeElement;
    return { tag: a ? a.tagName : null, inSearch: !!(a && a.closest(".search-bar")) };
  });
  const rows = await probeRead(win);
  const exiting = rows.filter((r) => (r.n || 0) > 0 && r.op < 0.99);
  const ghost = rows.filter((r) => (r.n || 0) > 0 && r.op <= 0.001);
  log("ghost-searchbar", {
    exitingFrames: exiting.length,
    ghostFrames: ghost.length,
    pointerEvents: [...new Set(exiting.map((r) => r.pe))],
    inert: [...new Set(exiting.map((r) => r.inert))],
    morphPhase: [...new Set(exiting.map((r) => r.morph))],
    focusAfterEscape: focusState,
    unmounted: rows.some((r) => (r.n || 0) === 0),
  });
  // keyboard reach during the exit window
  await win.waitForTimeout(120);
  await win.keyboard.type("ZZ");
  const inputVal = await win.evaluate(() => {
    const i = document.querySelector(".search-bar input");
    return i ? i.value : null;
  });
  log("ghost-searchbar-type", { inputValue: inputVal });

  // click-through
  await win.waitForTimeout(400);
  await win.keyboard.press("Control+f");
  await win.waitForSelector(".search-bar", { timeout: 6000 });
  await win.waitForTimeout(300);
  const b2 = await win.locator(".search-bar").boundingBox();
  await win.keyboard.press("Escape");
  await win.waitForTimeout(320);
  const hit = await win.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    return { tag: el ? el.tagName : null, inSearch: !!(el && el.closest(".search-bar")) };
  }, [b2.x + b2.width / 2, b2.y + b2.height / 2]);
  log("ghost-searchbar-hit", hit);

  // duplicate ids / hooks while an ann menu exit twin is present
  await win.waitForTimeout(500);
  await win.click("[data-ann-dropdown-toggle]");
  await win.waitForSelector("[data-ann-dropdown-menu]", { timeout: 6000 });
  await win.waitForTimeout(250);
  await win.click('[data-ann-dropdown-menu] [data-tool="highlight"]');
  await win.waitForTimeout(40);
  const dup = await win.evaluate(() => {
    const ids = {};
    document.querySelectorAll("[id]").forEach((el) => { ids[el.id] = (ids[el.id] || 0) + 1; });
    const dupIds = Object.entries(ids).filter(([, n]) => n > 1);
    const annMenu = document.querySelectorAll("[data-ann-dropdown-menu]").length;
    const tools = document.querySelectorAll("[data-tool]").length;
    const exiting = document.querySelector("[data-ann-dropdown-menu]");
    return {
      annMenu,
      dataToolCount: tools,
      duplicateIds: dupIds,
      exitingPe: exiting ? getComputedStyle(exiting).pointerEvents : null,
      exitingInert: exiting ? (exiting.hasAttribute("inert") || exiting.closest("[inert]") !== null) : null,
      exitingMorph: exiting ? exiting.getAttribute("data-tf-morph") : null,
    };
  });
  let strictErr = null;
  try {
    await win.locator("[data-ann-dropdown-menu]").click({ timeout: 1500 });
  } catch (e) {
    strictErr = String(e.message).split("\n")[0].slice(0, 160);
  }
  log("ghost-ann-exit", { ...dup, strictClickError: strictErr });

  // Tab into an exiting surface
  await win.waitForTimeout(500);
  await win.keyboard.press("Control+f");
  await win.waitForSelector(".search-bar", { timeout: 6000 });
  await win.waitForTimeout(250);
  await win.keyboard.press("Escape");
  await win.waitForTimeout(60);
  await win.keyboard.press("Tab");
  const tabbed = await win.evaluate(() => {
    const a = document.activeElement;
    return { tag: a ? a.tagName : null, inSearch: !!(a && a.closest(".search-bar")) };
  });
  log("ghost-searchbar-tab", tabbed);
}

// ---------------------------------------------------------------------------
// Section: STACKING — theme / portaled surfaces / frosted
// ---------------------------------------------------------------------------
async function sectionStacking(app, win) {
  console.log("\n=== STACKING ===");
  await setTheme(win, "frosted");
  await ensureClosed(win);

  // frosted blur on the three morph menus + color popover
  await win.click("[data-ann-dropdown-toggle]");
  await win.waitForSelector("[data-ann-dropdown-menu]", { timeout: 6000 });
  const blurs = await win.evaluate(() => {
    const g = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { bf: cs.backdropFilter || cs.webkitBackdropFilter, z: cs.zIndex, pos: cs.position };
    };
    return {
      annMenu: g(".ann-tool-menu"),
      themePop: g(".theme-toggle-popover"),
      titlePop: g(".titlebar-menu-popover"),
    };
  });
  // menu above the page?
  const stack = await win.evaluate(() => {
    const menu = document.querySelector(".ann-tool-menu");
    if (!menu) return null;
    const r = menu.getBoundingClientRect();
    const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      topElementClass: el && typeof el.className === "string" ? el.className.slice(0, 60) : null,
      inMenu: !!(el && el.closest(".ann-tool-menu")),
    };
  });
  log("stacking-frosted-menus", { blurs, stack });

  // open the theme popover while the ann menu is open (two floating surfaces)
  await win.click("[data-theme-toggle]");
  await win.waitForTimeout(500);
  const two = await win.evaluate(() => ({
    annMenu: document.querySelectorAll("[data-ann-dropdown-menu]").length,
    themePop: document.querySelectorAll(".theme-toggle-popover").length,
    themeOpen: document.querySelector("[data-theme-toggle]").getAttribute("aria-expanded"),
  }));
  log("stacking-two-surfaces", two);
  await ensureClosed(win);

  // switch theme mid-morph
  await win.click("[data-theme-toggle]");
  await win.waitForTimeout(50);
  await win.click('[data-theme-option="dark"]', { timeout: 4000 }).catch(() => {});
  await win.waitForTimeout(800);
  const afterSwitch = await win.evaluate(() => ({
    theme: document.documentElement.getAttribute("data-theme"),
    themePop: document.querySelectorAll(".theme-toggle-popover").length,
  }));
  log("stacking-theme-mid-morph", afterSwitch);

  // open a dialog then try to reach a morph menu behind it
  await win.click("[data-tools-toggle]");
  await win.waitForSelector("[data-tools-palette]", { timeout: 8000 });
  await win.click('[data-tool-id="insertPages"]');
  await win.waitForSelector(".modal-dialog", { timeout: 8000 });
  await win.waitForTimeout(400);
  let behind = null;
  try {
    await win.click("[data-theme-toggle]", { timeout: 1500 });
    behind = { clicked: true };
  } catch (e) {
    behind = { clicked: false, err: String(e.message).split("\n")[0].slice(0, 120) };
  }
  await win.waitForTimeout(400);
  const dialogState = await win.evaluate(() => ({
    dialog: !!document.querySelector(".modal-dialog"),
    themePop: document.querySelectorAll(".theme-toggle-popover").length,
    themeExpanded: document.querySelector("[data-theme-toggle]").getAttribute("aria-expanded"),
  }));
  log("stacking-dialog-behind", { behind, dialogState });
  await win.screenshot({ path: path.join(SHOTS, "adv051-stacking.png") }).catch(() => {});
  await win.keyboard.press("Escape");
  await win.waitForTimeout(400);
}

// ---------------------------------------------------------------------------
// Section: DUPREPRO — controlled duplicate-commit probe (edit inline editor)
// ---------------------------------------------------------------------------
async function countEditState(win) {
  return win.evaluate(() => {
    let tb = null;
    try {
      const d = window.tflexDiagnostics();
      const e = d.engineState || {};
      tb = e.textBoxes ? e.textBoxes.length : (d.textBoxes ? d.textBoxes.length : null);
    } catch (_) { tb = "diag-error"; }
    return {
      boxes: document.querySelectorAll(".edit-box").length,
      editors: document.querySelectorAll("[data-edit-editor]").length,
      textBoxes: tb,
    };
  });
}

async function createEditBox(app, win, label) {
  await win.click('button[aria-label="Edit content"]');
  await win.waitForSelector("[data-edit-toolbar]", { timeout: 8000 });
  await win.click('[data-edit-tool="box"]');
  const page = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  const x = page.x + page.width * 0.3;
  const y = page.y + page.height * 0.3;
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + 180, y + 60, { steps: 6 });
  await win.mouse.up();
  await win.waitForSelector("[data-edit-editor]", { timeout: 8000 });
  await win.locator("[data-edit-textarea]").fill(label);
  await win.click("[data-edit-confirm]");
}

async function sectionDupRepro(app, win) {
  console.log("\n=== DUPREPRO ===");
  const baseline = await countEditState(win);
  log("duprepro-baseline", baseline);

  // Scenario A: hammer Ctrl+Enter during the exit window (textarea keeps focus)
  await createEditBox(app, win, "DUP-A");
  const focusA = await win.evaluate(() => {
    const a = document.activeElement;
    return { tag: a ? a.tagName : null, cls: a && typeof a.className === "string" ? a.className.slice(0, 40) : null, inEditor: !!(a && a.closest("[data-edit-editor]")) };
  });
  const rightAfterA = await countEditState(win);
  for (let i = 0; i < 10; i += 1) {
    await win.keyboard.press("Control+Enter").catch(() => {});
    await win.waitForTimeout(15);
  }
  await win.waitForTimeout(1800);
  const afterA = await countEditState(win);
  log("duprepro-A-keyrepeat-during-exit", { focusA, rightAfterA, afterA });
  await win.click('button[aria-label="Edit content"]').catch(() => {});
  await win.waitForTimeout(500);

  // Scenario B (control): commit, wait for the exit to complete, then hammer keys
  await createEditBox(app, win, "DUP-B");
  await win.waitForTimeout(1200);
  const rightAfterB = await countEditState(win);
  for (let i = 0; i < 10; i += 1) {
    await win.keyboard.press("Control+Enter").catch(() => {});
    await win.waitForTimeout(15);
  }
  await win.waitForTimeout(1500);
  const afterB = await countEditState(win);
  log("duprepro-B-after-exit-control", { rightAfterB, afterB });
  await win.screenshot({ path: path.join(SHOTS, "adv051-duprepro.png") }).catch(() => {});
  await win.click('button[aria-label="Edit content"]').catch(() => {});
  await win.waitForTimeout(400);
}

// ---------------------------------------------------------------------------
// Section: DUPCTRL — control: commit, let the exit finish, then hammer keys
// ---------------------------------------------------------------------------
async function sectionDupCtrl(app, win) {
  console.log("\n=== DUPCTRL ===");
  const baseline = await countEditState(win);
  log("dupctrl-baseline", baseline);
  await createEditBox(app, win, "CTRL-ONLY");
  const rightAfter = await countEditState(win);
  await win.waitForTimeout(1500); // exit completes, editor unmounts
  const settled = await countEditState(win);
  for (let i = 0; i < 10; i += 1) {
    await win.keyboard.press("Control+Enter").catch(() => {});
    await win.waitForTimeout(15);
  }
  await win.waitForTimeout(1500);
  const afterKeys = await countEditState(win);
  log("dupctrl-result", { rightAfter, settled, afterKeys });
}

// ---------------------------------------------------------------------------
// Section: TOOLBOXEXIT — exit guard on the remaining TfBar toolboxes
// (signature pending / committed bar, stamp type editor)
// ---------------------------------------------------------------------------
async function exitProbe(win, sel, action) {
  await probeStart(win, sel, "[data-menu-button]", 900);
  await action();
  const rows = await probeRead(win);
  const exiting = rows.filter((r) => (r.n || 0) > 0 && r.op < 0.99);
  const ghost = rows.filter((r) => (r.n || 0) > 0 && r.op <= 0.001);
  return {
    sel,
    exitingFrames: exiting.length,
    ghostFrames: ghost.length,
    pointerEvents: [...new Set(exiting.map((r) => r.pe))],
    ghostPointerEvents: [...new Set(ghost.map((r) => r.pe))],
    inert: [...new Set(exiting.map((r) => r.inert))],
    unmounted: rows.some((r) => (r.n || 0) === 0),
  };
}

async function sectionToolboxExit(app, win) {
  console.log("\n=== TOOLBOXEXIT ===");
  await installProbe(win);
  await ensureClosed(win);

  // Signature pending view -> confirm -> exit
  await win.click('button[data-icon="sign"]');
  await win.waitForSelector(".sig-manager", { timeout: 8000 });
  await win.locator(".sig-tab", { hasText: "Type" }).first().click();
  await win.waitForTimeout(450);
  await win.locator(".sig-type-input").fill("ADV51");
  await win.locator('.sig-tab-pane[data-tf-pane="in"] .sig-tab-actions .btn-primary').click();
  await win.waitForSelector(".sig-saved-pick", { timeout: 8000 });
  await win.locator(".sig-saved-pick").first().click();
  await win.waitForFunction(() => document.querySelector(".sig-manager") === null, null, { timeout: 5000 });
  await win.waitForTimeout(300);
  const page = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  await win.mouse.click(page.x + page.width * 0.4, page.y + page.height * 0.4);
  await win.waitForSelector("[data-sig-pending]", { timeout: 8000 });
  await win.waitForTimeout(400);
  const pendingExit = await exitProbe(win, "[data-sig-pending]", async () => {
    await win.click('[data-sig-pending] [data-sig-action="confirm"]');
  });
  log("toolboxexit-sig-pending", pendingExit);
  await win.waitForTimeout(600);

  // Committed signature placement -> select -> action bar -> deselect -> exit
  const selBar = await win.locator("[data-sig-action-bar]").count();
  if (selBar === 0) {
    await win.locator(".sig-placement").first().click().catch(() => {});
    await win.waitForTimeout(400);
  }
  if (await win.locator("[data-sig-action-bar]").count() > 0) {
    const barExit = await exitProbe(win, "[data-sig-action-bar]", async () => {
      await win.keyboard.press("Escape");
    });
    log("toolboxexit-sig-committed-bar", barExit);
  } else {
    log("toolboxexit-sig-committed-bar", { skipped: "no committed action bar appeared" });
  }
  await win.waitForTimeout(400);

  // Stamp type editor -> cancel -> exit
  await win.click("[data-tools-toggle]");
  await win.waitForSelector("[data-tools-palette]", { timeout: 8000 });
  await win.click('[data-tool-id="stamp"]');
  await win.waitForSelector("[data-stamp-dialog]", { timeout: 8000 });
  await win.click("[data-stamp-confirm]");
  await win.waitForTimeout(500);
  if (await win.locator("[data-tools-palette]").count()) {
    await win.click("[data-tools-toggle]");
    await win.waitForTimeout(350);
  }
  const pg2 = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  await win.mouse.click(pg2.x + pg2.width * 0.6, pg2.y + pg2.height * 0.6);
  await win.waitForSelector(".stamp-annotation", { timeout: 10000 });
  await win.waitForTimeout(1000);
  await win.locator(".stamp-annotation").first().click();
  await win.waitForSelector('[data-content-action-bar="stamp"]', { timeout: 8000 });
  await win.click('[data-content-action="stamp-edit"]');
  await win.waitForSelector("[data-stamp-type-editor]", { timeout: 8000 });
  await win.waitForTimeout(300);
  const stampExit = await exitProbe(win, "[data-stamp-type-editor]", async () => {
    await win.click("[data-stamp-type-cancel]");
  });
  log("toolboxexit-stamp-type", stampExit);
  await win.waitForTimeout(400);

  // Edit box committed toolbar -> delete -> exit
  await win.click('button[aria-label="Edit content"]');
  await win.waitForSelector("[data-edit-toolbar]", { timeout: 8000 });
  await win.click('[data-edit-tool="box"]');
  const pg3 = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  await win.mouse.move(pg3.x + pg3.width * 0.2, pg3.y + pg3.height * 0.2);
  await win.mouse.down();
  await win.mouse.move(pg3.x + pg3.width * 0.2 + 150, pg3.y + pg3.height * 0.2 + 50, { steps: 5 });
  await win.mouse.up();
  await win.waitForSelector("[data-edit-editor]", { timeout: 8000 });
  await win.locator("[data-edit-textarea]").fill("TOOLBOX");
  await win.click("[data-edit-confirm]");
  await win.waitForTimeout(1200);
  if (await win.locator("[data-edit-box-toolbar]").count() === 0) {
    await win.locator(".edit-box").first().click().catch(() => {});
    await win.waitForTimeout(400);
  }
  if (await win.locator("[data-edit-box-toolbar]").count() > 0) {
    const boxExit = await exitProbe(win, "[data-edit-box-toolbar]", async () => {
      await win.keyboard.press("Escape");
    });
    log("toolboxexit-edit-box-toolbar", boxExit);
  } else {
    log("toolboxexit-edit-box-toolbar", { skipped: "no committed box toolbar" });
  }
  await win.screenshot({ path: path.join(SHOTS, "adv051-toolboxexit.png") }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Section: SIGKEY — key-repeat Enter on the signature confirm during its exit
// ---------------------------------------------------------------------------
async function sigCount(win) {
  return win.evaluate(() => {
    const d = window.tflexDiagnostics();
    const e = d.engineState || {};
    return {
      signatures: e.signatures ? e.signatures.length : (d.signatures ? d.signatures.length : null),
      placements: document.querySelectorAll("[data-placement-id]").length,
      pending: document.querySelectorAll("[data-sig-pending]").length,
    };
  });
}

async function sectionSigKey(app, win) {
  console.log("\n=== SIGKEY ===");
  await ensureClosed(win);
  await win.click('button[data-icon="sign"]');
  await win.waitForSelector(".sig-manager", { timeout: 8000 });
  await win.locator(".sig-tab", { hasText: "Type" }).first().click();
  await win.waitForTimeout(450);
  await win.locator(".sig-type-input").fill("SIGKEY");
  await win.locator('.sig-tab-pane[data-tf-pane="in"] .sig-tab-actions .btn-primary').click();
  await win.waitForSelector(".sig-saved-pick", { timeout: 8000 });
  await win.locator(".sig-saved-pick").first().click();
  await win.waitForFunction(() => document.querySelector(".sig-manager") === null, null, { timeout: 5000 });
  await win.waitForTimeout(300);
  const page = await win.locator('.pdf-page[data-page="1"]').boundingBox();
  await win.mouse.click(page.x + page.width * 0.45, page.y + page.height * 0.45);
  await win.waitForSelector("[data-sig-pending]", { timeout: 8000 });
  await win.waitForTimeout(400);
  const before = await sigCount(win);
  await win.click('[data-sig-pending] [data-sig-action="confirm"]');
  const focus = await win.evaluate(() => {
    const a = document.activeElement;
    return { tag: a ? a.tagName : null, action: a ? a.getAttribute("data-sig-action") : null, inPending: !!(a && a.closest("[data-sig-pending]")) };
  });
  for (let i = 0; i < 10; i += 1) {
    await win.keyboard.press("Enter").catch(() => {});
    await win.waitForTimeout(15);
  }
  await win.waitForTimeout(1800);
  const after = await sigCount(win);
  log("sigkey-enter-repeat", { before, focus, after });
  await win.screenshot({ path: path.join(SHOTS, "adv051-sigkey.png") }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Section: SEARCHKEY — typing into the exiting (non-inert) search input
// ---------------------------------------------------------------------------
async function sectionSearchKey(win) {
  console.log("\n=== SEARCHKEY ===");
  await ensureClosed(win);
  await win.keyboard.press("Control+f");
  await win.waitForSelector(".search-bar", { timeout: 6000 });
  await win.waitForTimeout(300);
  await win.locator(".search-bar input").first().focus();
  await win.keyboard.type("AB");
  await win.keyboard.press("Escape");
  await win.waitForTimeout(40);
  const atEscape = await win.evaluate(() => {
    const a = document.activeElement;
    const i = document.querySelector(".search-bar input");
    return { activeTag: a ? a.tagName : null, activeInSearch: !!(a && a.closest(".search-bar")), value: i ? i.value : null, barPresent: !!document.querySelector(".search-bar") };
  });
  await win.keyboard.type("ZZ");
  await win.waitForTimeout(30);
  const afterType = await win.evaluate(() => {
    const i = document.querySelector(".search-bar input");
    return { value: i ? i.value : null, barPresent: !!document.querySelector(".search-bar") };
  });
  await win.waitForTimeout(600);
  const settled = await win.evaluate(() => ({ barPresent: !!document.querySelector(".search-bar") }));
  log("searchkey-exit-typing", { atEscape, afterType, settled });
}

// ---------------------------------------------------------------------------
// Section: REOPEN — one controlled mid-exit re-open per menu (crisp repro)
// ---------------------------------------------------------------------------
async function sectionReopen(win) {
  console.log("\n=== REOPEN ===");
  await installProbe(win);
  for (const m of MENUS) {
    await ensureClosed(win);
    // open and settle so the surface is at its final rect
    await win.click(m.trigger, { timeout: 4000 });
    await win.waitForSelector(m.surface, { timeout: 5000 });
    await win.waitForTimeout(500);
    const trig = await win.evaluate((sel) => {
      const r = document.querySelector(sel).getBoundingClientRect();
      return [+r.left.toFixed(1), +r.top.toFixed(1), +r.width.toFixed(1), +r.height.toFixed(1)];
    }, m.trigger);
    // start the exit, then re-open 80ms in (mid-exit)
    await win.keyboard.press("Escape");
    await win.waitForTimeout(80);
    await probeStart(win, m.surface, m.trigger, 600);
    await win.click(m.trigger, { timeout: 4000 }).catch(() => {});
    const rows = await probeRead(win);
    const present = rows.filter((r) => (r.n || 0) > 0 && r.s);
    const firstIn = present.find((r) => r.morph === "in");
    const dev = firstIn && firstIn.trig ? +Math.max(
      Math.abs(firstIn.s[0] - firstIn.trig[0]),
      Math.abs(firstIn.s[1] - firstIn.trig[1]),
      Math.abs(firstIn.s[2] - firstIn.trig[2]),
      Math.abs(firstIn.s[3] - firstIn.trig[3]),
    ).toFixed(1) : null;
    log(`reopen-${m.name}`, {
      triggerRect: trig,
      firstEnterFrame: firstIn ? { s: firstIn.s, op: firstIn.op, morph: firstIn.morph, to: firstIn.to } : null,
      deviationPx: dev,
      firstFive: present.slice(0, 5).map((r) => ({ t: r.t, s: r.s, op: r.op, morph: r.morph, to: r.to })),
    });
    await win.screenshot({ path: path.join(SHOTS, `adv051-reopen-${m.name}.png`) }).catch(() => {});
    await ensureClosed(win);
  }
}

// ---------------------------------------------------------------------------
async function run(section) {
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector(".sample-card", { timeout: 30000 });
    await openReport(app, win);
    if (section === "spam") await sectionSpam(win);
    else if (section === "midanim") await sectionMidanim(app, win);
    else if (section === "edges") await sectionEdges(app, win);
    else if (section === "perf") await sectionPerf(app, win);
    else if (section === "ghosts") await sectionGhosts(win);
    else if (section === "stacking") await sectionStacking(app, win);
    else if (section === "duprepro") await sectionDupRepro(app, win);
    else if (section === "dupctrl") await sectionDupCtrl(app, win);
    else if (section === "toolboxexit") await sectionToolboxExit(app, win);
    else if (section === "sigkey") await sectionSigKey(app, win);
    else if (section === "searchkey") await sectionSearchKey(win);
    else if (section === "reopen") await sectionReopen(win);
    else {
      await sectionSpam(win);
      await sectionMidanim(app, win);
      await sectionEdges(app, win);
      await sectionPerf(app, win);
      await sectionGhosts(win);
      await sectionStacking(app, win);
    }
  } finally {
    await hardClose(app, `adv051-${section}`);
  }
}

const section = process.argv[2] || "all";
run(section)
  .then(() => {
    console.log(`[adv051] DONE ${section}`);
    process.exit(0);
  })
  .catch((e) => {
    console.error(`[adv051] FAILED ${section}: ${e && e.stack ? e.stack : e}`);
    process.exit(1);
  });
