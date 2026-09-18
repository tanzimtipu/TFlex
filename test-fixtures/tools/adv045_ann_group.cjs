// ADV phase-19 gate — annotation group in the CommandBar.
// Items 1-4, 6-8 of the dispatch. Requires the dev bundle (dist/).
// Usage: node test-fixtures/tools/adv045_ann_group.cjs [section]
//   section: all (default) | hooks | click | keys | disabled | layout | motion | color
"use strict";

const path = require("node:path");
const { launchApp, getSamplePath } = require("../../e2e/lib/launch.cjs");
const { hardClose } = require("../../e2e/lib/helpers.cjs");

const SHOTS = path.resolve(__dirname, "..", "..", "screenshots");
const CANON = ["select", "highlight", "underline", "strikeout", "ink", "textbox", "rect", "ellipse", "arrow", "callout", "note"];

function log(label, obj) {
  console.log(`[adv045] ${label} ${JSON.stringify(obj)}`);
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

async function openMenu(win) {
  await win.click("[data-ann-dropdown-toggle]");
  await win.waitForSelector("[data-ann-dropdown-menu]", { state: "visible", timeout: 8000 });
  await win.waitForTimeout(250);
}

async function activeEl(win) {
  return win.evaluate(() => {
    const a = document.activeElement;
    if (!a) return null;
    return {
      tag: a.tagName,
      cls: typeof a.className === "string" ? a.className.slice(0, 70) : String(a.className),
      tool: a.getAttribute("data-tool"),
      label: a.getAttribute("aria-label"),
      inMenu: !!a.closest("[data-ann-dropdown-menu]"),
      isToggle: a.hasAttribute("data-ann-dropdown-toggle"),
      isBody: a === document.body,
      text: (a.textContent || "").trim().slice(0, 22),
    };
  });
}

async function annCount(win) {
  return win.evaluate(() => {
    const d = window.tflexDiagnostics();
    return (d.engineState && d.engineState.annotations ? d.engineState.annotations.length : -1);
  });
}

async function activeTool(win) {
  return win.evaluate(() => window.tflexDiagnostics().activeTool);
}

async function visibleIds(win) {
  return win.$$eval("[data-ann-tools-visible] [data-tool]", (els) => els.map((e) => e.getAttribute("data-tool")));
}

async function pageBlankPoint(win, fracY) {
  return win.evaluate((fy) => {
    const pane = document.querySelector('.tab-pane[aria-hidden="false"]');
    const page = pane && pane.querySelector(".pdf-page");
    if (!page) return null;
    const r = page.getBoundingClientRect();
    return { x: Math.round(r.left + r.width * 0.5), y: Math.round(r.top + r.height * fy) };
  }, fracY);
}

// ---------------------------------------------------------------------------
// Item 1 — duplicate hooks
// ---------------------------------------------------------------------------
async function sectionHooks(win) {
  console.log("\n=== ITEM 1: DUPLICATE HOOKS ===");
  await openMenu(win);
  const dom = await win.evaluate(() => {
    const all = Array.from(document.querySelectorAll('[data-tool="highlight"]'));
    const ids = {};
    document.querySelectorAll("[id]").forEach((el) => {
      ids[el.id] = (ids[el.id] || 0) + 1;
    });
    const dupIds = Object.entries(ids).filter(([, n]) => n > 1);
    const first = document.querySelector('[data-tool="highlight"]');
    const allTools = document.querySelectorAll("[data-tool]").length;
    return {
      count: all.length,
      allDataToolCount: allTools,
      order: all.map((e) => ({
        inVisible: !!e.closest("[data-ann-tools-visible]"),
        inMenu: !!e.closest("[data-ann-dropdown-menu]"),
        cls: e.className,
      })),
      qsIsVisible: !!first.closest("[data-ann-tools-visible]"),
      qsInMenu: !!first.closest("[data-ann-dropdown-menu]"),
      duplicateIds: dupIds,
      idCount: Object.keys(ids).length,
    };
  });
  log("hooks-dom", dom);

  const strictCount = await win.locator('[data-tool="highlight"]').count();
  log("hooks-strict-count", { count: strictCount });
  let strictErr = null;
  try {
    await win.locator('[data-tool="highlight"]').click({ timeout: 2500 });
  } catch (e) {
    strictErr = String(e.message).split("\n").slice(0, 3).join(" | ").slice(0, 240);
  }
  log("hooks-strict-click", { error: strictErr });
  // Did the caught click arm anything / change state?
  log("hooks-after-strict", { activeTool: await activeTool(win), menuOpen: await win.locator("[data-ann-dropdown-menu]").count() });
  await win.keyboard.press("Escape");
  await win.waitForTimeout(900);

  // Existing-spec selector resolution: what do the old `.ann-toolbar
  // button[data-tool=...]` locators resolve to now, menu closed vs open?
  const closed = await win.evaluate(() => ({
    annToolbar_textbox: document.querySelectorAll('.ann-toolbar button[data-tool="textbox"]').length,
    annToolbar_note: document.querySelectorAll('.ann-toolbar button[data-tool="note"]').length,
    annToolbar_rect: document.querySelectorAll('.ann-toolbar button[data-tool="rect"]').length,
    annToolbar_highlight: document.querySelectorAll('.ann-toolbar button[data-tool="highlight"]').length,
    anyButton_note: document.querySelectorAll('button[data-tool="note"]').length,
    anyButton_highlight: document.querySelectorAll('button[data-tool="highlight"]').length,
    annToolbarExists: !!document.querySelector(".ann-toolbar"),
    menuMounted: !!document.querySelector("[data-ann-dropdown-menu]"),
  }));
  log("hooks-spec-resolution-menu-closed", closed);
  await openMenu(win);
  const open = await win.evaluate(() => ({
    annToolbar_textbox: document.querySelectorAll('.ann-toolbar button[data-tool="textbox"]').length,
    anyButton_note: document.querySelectorAll('button[data-tool="note"]').length,
    anyButton_highlight: document.querySelectorAll('button[data-tool="highlight"]').length,
    anyTool_highlight: document.querySelectorAll('[data-tool="highlight"]').length,
    menuIsInsideAnnToolbar: !!document.querySelector(".ann-toolbar [data-ann-dropdown-menu]"),
  }));
  log("hooks-spec-resolution-menu-open", open);
  await win.keyboard.press("Escape");
  await win.waitForTimeout(300);
}

// ---------------------------------------------------------------------------
// Item 2 — click-through
// ---------------------------------------------------------------------------
async function sectionClick(win) {
  console.log("\n=== ITEM 2: CLICK-THROUGH ===");
  const EXIT = 1200; // let the menu exit spring fully unmount
  // (a) arm note from the menu, then REOPEN the menu and single-click the page.
  await win.click('[data-ann-tools-visible] [data-tool="select"]');
  await win.waitForTimeout(200);
  await openMenu(win);
  await win.click('[data-ann-dropdown-menu] [data-tool="note"]');
  await win.waitForSelector("[data-ann-dropdown-menu]", { state: "detached", timeout: 6000 });
  await win.waitForTimeout(300);
  log("click-armed-note", { activeTool: await activeTool(win) });
  await openMenu(win);
  const before = await annCount(win);
  const pt = await pageBlankPoint(win, 0.35);
  log("click-blank-point", pt);
  if (pt) await win.mouse.click(pt.x, pt.y);
  await win.waitForTimeout(EXIT);
  log("click-a-note-single-with-menu-open", {
    annotationsBefore: before,
    annotationsAfter: await annCount(win),
    noteEditorOpen: await win.locator('[data-annotation-editor="note"]').count(),
    noteActionBar: await win.locator('[data-annotation-action-bar="note"]').count(),
    menuOpenAfter: await win.locator("[data-ann-dropdown-menu]").count(),
    activeTool: await activeTool(win),
  });
  await win.keyboard.press("Escape");
  await win.waitForTimeout(300);

  // (b) rect armed, menu OPEN, drag on the page: does the gesture both close the
  // menu and create the shape?
  await win.evaluate(() => document.querySelector('[data-ann-tools-visible] [data-tool="select"]').click());
  await win.waitForTimeout(200);
  await openMenu(win);
  await win.click('[data-ann-dropdown-menu] [data-tool="rect"]');
  await win.waitForSelector("[data-ann-dropdown-menu]", { state: "detached", timeout: 6000 });
  await win.waitForTimeout(300);
  log("click-armed-rect", { activeTool: await activeTool(win) });
  await openMenu(win);
  const b2 = await annCount(win);
  const pt2 = await pageBlankPoint(win, 0.45);
  if (pt2) {
    await win.mouse.move(pt2.x, pt2.y);
    await win.mouse.down();
    await win.mouse.move(pt2.x + 140, pt2.y + 80, { steps: 10 });
    await win.mouse.up();
  }
  await win.waitForTimeout(EXIT);
  log("click-b-rect-drag-with-menu-open", {
    annotationsBefore: b2,
    annotationsAfter: await annCount(win),
    rectActionBar: await win.locator('[data-annotation-action-bar="rect"]').count(),
    menuOpenAfter: await win.locator("[data-ann-dropdown-menu]").count(),
  });
  await win.keyboard.press("Escape");
  await win.waitForTimeout(300);

  // (c) single click on the page with the menu open and highlight armed
  await win.evaluate(() => document.querySelector('[data-ann-tools-visible] [data-tool="select"]').click());
  await win.waitForTimeout(200);
  await win.click('[data-ann-tools-visible] [data-tool="highlight"]');
  await win.waitForTimeout(200);
  await openMenu(win);
  const b3 = await annCount(win);
  const pt3 = await pageBlankPoint(win, 0.7);
  if (pt3) await win.mouse.click(pt3.x, pt3.y);
  await win.waitForTimeout(EXIT);
  log("click-c-highlight-single-with-menu-open", { annotationsBefore: b3, annotationsAfter: await annCount(win), menuOpenAfter: await win.locator("[data-ann-dropdown-menu]").count() });

  // (d) CommandBar Pan button while menu open — one click both closes and activates?
  await win.keyboard.press("Escape");
  await win.waitForTimeout(300);
  await openMenu(win);
  const panBefore = await win.locator("[data-hand-toggle]").getAttribute("data-hand-active");
  await win.click("[data-hand-toggle]");
  await win.waitForTimeout(EXIT);
  const panAfter = await win.locator("[data-hand-toggle]").getAttribute("data-hand-active");
  log("click-d-pan-with-menu-open", { panBefore, panAfter, menuOpenAfter: await win.locator("[data-ann-dropdown-menu]").count() });
  await win.click("[data-hand-toggle]");
  await win.waitForTimeout(400);

  // (e) CommandBar Edit button while menu open
  await openMenu(win);
  const editBefore = await win.locator("[data-toolbar-edit-toggle]").getAttribute("aria-pressed");
  await win.click("[data-toolbar-edit-toggle]");
  await win.waitForTimeout(EXIT);
  const editAfter = await win.locator("[data-toolbar-edit-toggle]").getAttribute("aria-pressed");
  log("click-e-edit-with-menu-open", { editBefore, editAfter, menuOpenAfter: await win.locator("[data-ann-dropdown-menu]").count(), editToolbar: await win.locator(".edit-toolbar").count() });
  if (editAfter === "true") {
    await win.click("[data-toolbar-edit-toggle]");
    await win.waitForTimeout(600);
  }
}

// ---------------------------------------------------------------------------
// Item 3 — keyboard/focus
// ---------------------------------------------------------------------------
async function sectionKeys(win) {
  console.log("\n=== ITEM 3: KEYBOARD/FOCUS ===");
  await openMenu(win);
  log("keys-open-active", await activeEl(win));
  const n = CANON.length;
  const seq = [];
  // ArrowDown to the last row
  for (let i = 0; i < n - 1; i += 1) {
    await win.keyboard.press("ArrowDown");
    await win.waitForTimeout(80);
  }
  seq.push({ step: `ArrowDown x${n - 1}`, hi: await win.locator(".ann-tool-menu-row-highlight").getAttribute("data-tool"), active: await activeEl(win) });
  // one more — wrap or stop?
  await win.keyboard.press("ArrowDown");
  await win.waitForTimeout(120);
  seq.push({ step: "ArrowDown +1", hi: await win.locator(".ann-tool-menu-row-highlight").getAttribute("data-tool") });
  // ArrowUp at first row: move to 0 then one more
  for (let i = 0; i < n; i += 1) {
    await win.keyboard.press("ArrowUp");
    await win.waitForTimeout(60);
  }
  seq.push({ step: `ArrowUp x${n}`, hi: await win.locator(".ann-tool-menu-row-highlight").getAttribute("data-tool") });
  await win.keyboard.press("ArrowUp");
  await win.waitForTimeout(120);
  seq.push({ step: "ArrowUp +1 at first", hi: await win.locator(".ann-tool-menu-row-highlight").getAttribute("data-tool") });
  log("keys-arrows", { seq });

  // Escape while a row is highlighted
  await win.keyboard.press("Escape");
  await win.waitForTimeout(250);
  log("keys-escape", { menuOpen: await win.locator("[data-ann-dropdown-menu]").count(), active: await activeEl(win) });

  // reopen — focus restored to toggle?
  await win.click("[data-ann-dropdown-toggle]");
  await win.waitForSelector("[data-ann-dropdown-menu]", { state: "visible", timeout: 5000 });
  await win.waitForTimeout(250);
  log("keys-reopen-active", await activeEl(win));

  // Tab: does focus escape the menu into the page?
  const tabs = [];
  for (let i = 0; i < 4; i += 1) {
    await win.keyboard.press("Tab");
    await win.waitForTimeout(100);
    tabs.push(await activeEl(win));
  }
  log("keys-tab", { tabs });
  log("keys-menu-still-open-after-tab", { menuOpen: await win.locator("[data-ann-dropdown-menu]").count() });

  // Tab all the way through the 11 rows and past the end: does focus escape?
  for (let i = 0; i < 7; i += 1) {
    await win.keyboard.press("Tab");
    await win.waitForTimeout(70);
  }
  log("keys-tab-end", { active: await activeEl(win), menuOpen: await win.locator("[data-ann-dropdown-menu]").count() });
  await win.keyboard.press("Tab");
  await win.waitForTimeout(120);
  log("keys-tab-past-last", { active: await activeEl(win), menuOpen: await win.locator("[data-ann-dropdown-menu]").count() });

  // Enter on the keyboard-highlighted row (container still focused)
  await win.keyboard.press("Escape");
  await win.waitForTimeout(700);
  await openMenu(win);
  await win.keyboard.press("ArrowDown");
  await win.waitForTimeout(120);
  const hi = await win.locator(".ann-tool-menu-row-highlight").getAttribute("data-tool");
  await win.keyboard.press("Enter");
  await win.waitForTimeout(700);
  log("keys-enter", { highlighted: hi, menuOpen: await win.locator("[data-ann-dropdown-menu]").count(), activeTool: await activeTool(win), active: await activeEl(win) });
  log("keys-after-select-focus", await activeEl(win));

  // Tab-focus vs keyboard-highlight divergence: focus a row, press Enter, see
  // which tool actually arms.
  await win.keyboard.press("Escape");
  await win.waitForTimeout(700);
  await openMenu(win);
  const hi0 = await win.locator(".ann-tool-menu-row-highlight").getAttribute("data-tool");
  await win.keyboard.press("Tab"); // -> first row (select)
  await win.keyboard.press("Tab"); // -> second row (highlight)
  await win.waitForTimeout(100);
  const focusedRow = await activeEl(win);
  const hiAfterTab = await win.locator(".ann-tool-menu-row-highlight").getAttribute("data-tool");
  await win.keyboard.press("Enter");
  await win.waitForTimeout(500);
  log("keys-tab-then-enter", { initialHighlight: hi0, focusedRow: focusedRow && focusedRow.tool, keyboardHighlight: hiAfterTab, activeTool: await activeTool(win), menuOpen: await win.locator("[data-ann-dropdown-menu]").count() });

  // Space on a Tab-focused row must arm that row too (DEF-228).
  await win.keyboard.press("Escape");
  await win.waitForTimeout(700);
  await openMenu(win);
  await win.keyboard.press("Tab"); // -> first row (select)
  await win.keyboard.press("Tab"); // -> second row (highlight)
  await win.keyboard.press("Tab"); // -> third row (underline)
  await win.waitForTimeout(100);
  const focusedRowSpace = await activeEl(win);
  await win.keyboard.press(" ");
  await win.waitForTimeout(500);
  log("keys-tab-then-space", { focusedRow: focusedRowSpace && focusedRowSpace.tool, activeTool: await activeTool(win), menuOpen: await win.locator("[data-ann-dropdown-menu]").count() });

  // Escape while a row button (not the container) has focus
  await win.keyboard.press("Escape");
  await win.waitForTimeout(700);
  await openMenu(win);
  await win.keyboard.press("Tab");
  await win.keyboard.press("Tab");
  const focused2 = await activeEl(win);
  await win.keyboard.press("Escape");
  await win.waitForTimeout(700);
  log("keys-escape-from-row", { focusedRow: focused2 && focused2.tool, menuOpen: await win.locator("[data-ann-dropdown-menu]").count(), active: await activeEl(win) });

  // measure the exit unmount time (Escape and outside click)
  await openMenu(win);
  const t0 = Date.now();
  await win.keyboard.press("Escape");
  let gone = false;
  for (let i = 0; i < 40; i += 1) {
    if ((await win.locator("[data-ann-dropdown-menu]").count()) === 0) { gone = true; break; }
    await win.waitForTimeout(50);
  }
  log("keys-exit-unmount-ms", { ms: gone ? Date.now() - t0 : -1, gone });

  // focus after an outside click close
  await openMenu(win);
  const pt = await pageBlankPoint(win, 0.8);
  if (pt) await win.mouse.click(pt.x, pt.y);
  await win.waitForTimeout(800);
  log("keys-after-outside-close-focus", { active: await activeEl(win), menuOpen: await win.locator("[data-ann-dropdown-menu]").count() });

  // reopen via keyboard: focus the toggle, ArrowDown
  await win.evaluate(() => document.querySelector("[data-ann-dropdown-toggle]").focus());
  await win.keyboard.press("ArrowDown");
  await win.waitForTimeout(250);
  log("keys-toggle-arrowdown", { menuOpen: await win.locator("[data-ann-dropdown-menu]").count(), active: await activeEl(win) });
  await win.keyboard.press("Escape");
  await win.waitForTimeout(150);
}

// ---------------------------------------------------------------------------
// Item 4 — disabled / state races
// ---------------------------------------------------------------------------
async function sectionDisabled(win) {
  console.log("\n=== ITEM 4: DISABLED/STATE RACES ===");
  await openMenu(win);
  await win.waitForTimeout(200);
  // Programmatic edit toggle keeps the menu mounted (no pointerdown).
  await win.evaluate(() => document.querySelector("[data-toolbar-edit-toggle]").click());
  await win.waitForTimeout(700);
  log("disabled-edit-menuopen", { menuOpen: await win.locator("[data-ann-dropdown-menu]").count(), editPressed: await win.locator("[data-toolbar-edit-toggle]").getAttribute("aria-pressed") });
  const editRows = await win.$$eval("[data-ann-dropdown-menu] [data-tool]", (els) => els.map((e) => ({ tool: e.getAttribute("data-tool"), disabled: e.disabled, ariaDisabled: e.getAttribute("aria-disabled"), title: (e.getAttribute("title") || "").slice(0, 60) })));
  log("disabled-edit-rows", editRows);
  await win.evaluate(() => document.querySelector("[data-toolbar-edit-toggle]").click());
  await win.waitForTimeout(600);
  // programmatic Pan toggle
  await win.evaluate(() => document.querySelector("[data-hand-toggle]").click());
  await win.waitForTimeout(600);
  log("disabled-pan-menuopen", { menuOpen: await win.locator("[data-ann-dropdown-menu]").count(), panActive: await win.locator("[data-hand-toggle]").getAttribute("data-hand-active") });
  const panRows = await win.$$eval("[data-ann-dropdown-menu] [data-tool]", (els) => els.map((e) => ({ tool: e.getAttribute("data-tool"), disabled: e.disabled, title: (e.getAttribute("title") || "").slice(0, 40) })));
  log("disabled-pan-rows", panRows);
  await win.evaluate(() => document.querySelector("[data-hand-toggle]").click());
  await win.waitForTimeout(500);

  // arm a tool, open menu: active in BOTH visible five and the menu
  await win.keyboard.press("Escape");
  await win.waitForTimeout(900);
  await openMenu(win);
  await win.click('[data-ann-dropdown-menu] [data-tool="rect"]');
  await win.waitForSelector("[data-ann-dropdown-menu]", { state: "detached", timeout: 6000 });
  await win.waitForTimeout(300);
  await openMenu(win);
  const vis = await win.$$eval("[data-ann-tools-visible] [data-tool]", (els) => els.map((e) => ({ tool: e.getAttribute("data-tool"), pressed: e.getAttribute("aria-pressed"), cls: e.className })));
  const rows = await win.$$eval("[data-ann-dropdown-menu] [data-tool]", (els) => els.map((e) => ({ tool: e.getAttribute("data-tool"), checked: e.getAttribute("aria-checked"), hasCheck: !!e.querySelector(".ann-tool-menu-check") })));
  log("disabled-active-both", { activeTool: await activeTool(win), visible: vis, menuActive: rows.filter((r) => r.checked === "true" || r.hasCheck) });
  await win.keyboard.press("Escape");
  await win.waitForTimeout(300);
}

// ---------------------------------------------------------------------------
// Item 6 — layout / overflow
// ---------------------------------------------------------------------------
async function sectionLayout(win, app) {
  console.log("\n=== ITEM 6: LAYOUT/OVERFLOW ===");
  const sizes = [[1440, 900], [1000, 800], [820, 700], [640, 600]];
  for (const [w, h] of sizes) {
    await app.evaluate(({ BrowserWindow }, s) => {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) win.setSize(s[0], s[1]);
    }, [w, h]);
    await win.waitForTimeout(500);
    const m = await win.evaluate(() => {
      const tb = document.querySelector(".workspace .toolbar") || document.querySelector(".toolbar");
      const groups = Array.from(document.querySelectorAll(".toolbar > .toolbar-group"));
      const sc = document.querySelector(".document-scroller");
      const pane = document.querySelector('.tab-pane[aria-hidden="false"]');
      const page = pane && pane.querySelector(".pdf-page");
      const g = document.querySelector("[data-annotation-toolbar]");
      const rects = groups.map((el) => {
        const r = el.getBoundingClientRect();
        return { cls: el.className.slice(0, 40), left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom) };
      });
      const tbw = tb ? tb.getBoundingClientRect() : null;
      const gr = g ? g.getBoundingClientRect() : null;
      return {
        innerWidth: window.innerWidth, innerHeight: window.innerHeight,
        toolbarCW: tb ? tb.clientWidth : null, toolbarSW: tb ? tb.scrollWidth : null,
        toolbarH: tbw ? Math.round(tbw.height) : null,
        toolbarBottom: tbw ? Math.round(tbw.bottom) : null,
        scrollerTop: sc ? Math.round(sc.getBoundingClientRect().top) : null,
        pageTop: page ? Math.round(page.getBoundingClientRect().top) : null,
        group: gr ? { left: Math.round(gr.left), right: Math.round(gr.right), top: Math.round(gr.top), bottom: Math.round(gr.bottom), w: Math.round(gr.width) } : null,
        groupReachable: gr ? gr.left >= 0 && gr.right <= window.innerWidth && gr.top >= 0 : null,
        groupClipped: gr ? gr.right > window.innerWidth : null,
        groups: rects,
      };
    });
    log(`layout-${w}x${h}`, m);
    const widest = await win.evaluate(() => {
      const tb = document.querySelector(".workspace .toolbar") || document.querySelector(".toolbar");
      if (!tb) return null;
      const tr = tb.getBoundingClientRect();
      let best = null;
      tb.querySelectorAll("*").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (!best || r.right > best.right) best = { right: Math.round(r.right), cls: (el.className && String(el.className).slice(0, 40)) || el.tagName, tag: el.tagName };
      });
      return { toolbarLeft: Math.round(tr.left), toolbarRight: Math.round(tr.right), toolbarWidth: Math.round(tr.width), overflowX: getComputedStyle(tb).overflowX, widestDescendant: best };
    });
    log(`layout-widest-${w}`, widest);
    await win.screenshot({ path: path.join(SHOTS, `adv045-layout-${w}.png`) });
  }
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) win.setSize(1440, 900);
  });
  await win.waitForTimeout(400);
  // theme offsets
  for (const theme of ["light", "dark", "frosted"]) {
    await win.evaluate((t) => { document.documentElement.setAttribute("data-theme", t); }, theme);
    await win.waitForTimeout(250);
    const off = await win.evaluate(() => {
      const tb = document.querySelector(".toolbar");
      const sc = document.querySelector(".document-scroller");
      const pane = document.querySelector('.tab-pane[aria-hidden="false"]');
      const page = pane && pane.querySelector(".pdf-page");
      return {
        toolbarBottom: tb ? Math.round(tb.getBoundingClientRect().bottom) : null,
        scrollerTop: sc ? Math.round(sc.getBoundingClientRect().top) : null,
        pageTop: page ? Math.round(page.getBoundingClientRect().top) : null,
        annVar: getComputedStyle(document.documentElement).getPropertyValue("--ann-toolbar-h").trim(),
      };
    });
    log(`layout-offset-${theme}`, off);
  }
  await win.evaluate(() => { document.documentElement.setAttribute("data-theme", "frosted"); });
  await win.waitForTimeout(250);
}

// ---------------------------------------------------------------------------
// Item 7 — motion / theme
// ---------------------------------------------------------------------------
async function setTheme(win, want) {
  await win.keyboard.press("Escape");
  await win.waitForTimeout(600);
  await win.click("[data-theme-toggle]");
  await win.waitForSelector(".theme-toggle-popover", { timeout: 5000 });
  await win.click(`[data-theme-option="${want}"]`);
  await win.waitForFunction((w) => document.documentElement.getAttribute("data-theme") === w, want, { timeout: 5000 });
  await win.waitForTimeout(350);
}

async function sectionMotion(win) {
  console.log("\n=== ITEM 7: MOTION/THEME ===");
  const arrowCss = await win.evaluate(() => {
    const a = document.querySelector("[data-ann-dropdown-toggle] svg");
    if (!a) return null;
    const cs = getComputedStyle(a);
    return { transitionProperty: cs.transitionProperty, transitionDuration: cs.transitionDuration, transitionTimingFunction: cs.transitionTimingFunction };
  });
  log("motion-arrow-transition-closed", arrowCss);

  await openMenu(win);
  const arrowOpen = await win.evaluate(() => {
    const a = document.querySelector("[data-ann-dropdown-toggle]");
    const svg = a && a.querySelector("svg");
    return { toggleCls: a ? a.className : null, transform: svg ? getComputedStyle(svg).transform : null, transitionDuration: svg ? getComputedStyle(svg).transitionDuration : null, transitionTimingFunction: svg ? getComputedStyle(svg).transitionTimingFunction : null };
  });
  log("motion-arrow-open", arrowOpen);
  const menuFocus = await win.evaluate(() => {
    const m = document.querySelector("[data-ann-dropdown-menu]");
    const cs = getComputedStyle(m);
    return {
      activeIsMenu: document.activeElement === m,
      outline: `${cs.outlineWidth} ${cs.outlineStyle} ${cs.outlineColor}`,
      boxShadow: cs.boxShadow.slice(0, 80),
      border: `${cs.borderWidth} ${cs.borderStyle} ${cs.borderColor}`,
      focusVisible: m.matches(":focus-visible"),
      focus: m.matches(":focus"),
    };
  });
  log("motion-menu-focus-ring", menuFocus);

  // Sample the menu's transform/opacity over the first frames to derive the
  // enter shape (spring stiffness 1000 damping 50 per tfPresets).
  await win.keyboard.press("Escape");
  await win.waitForTimeout(300);
  const samples = await win.evaluate(async () => {
    const samples = [];
    const t0 = performance.now();
    document.querySelector("[data-ann-dropdown-toggle]").click();
    for (let i = 0; i < 24; i += 1) {
      await new Promise((r) => requestAnimationFrame(() => r()));
      const m = document.querySelector("[data-ann-dropdown-menu]");
      if (m) {
        const cs = getComputedStyle(m);
        samples.push({ t: Math.round(performance.now() - t0), transform: cs.transform, opacity: cs.opacity });
      }
    }
    return samples;
  });
  log("motion-menu-enter-samples", samples);

  for (const theme of ["light", "dark", "frosted"]) {
    await setTheme(win, theme);
    await openMenu(win);
    const cs = await win.evaluate(() => {
      const m = document.querySelector("[data-ann-dropdown-menu]");
      const s = getComputedStyle(m);
      const btn = document.querySelector('[data-ann-tools-visible] [data-tool="select"]');
      const bs = btn ? getComputedStyle(btn) : null;
      return {
        themeAttr: document.documentElement.getAttribute("data-theme"),
        bg: s.backgroundColor, border: s.borderColor, borderW: s.borderWidth, shadow: s.boxShadow.slice(0, 90),
        backdropFilter: s.backdropFilter || s.webkitBackdropFilter || "none",
        zIndex: s.zIndex, position: s.position, color: s.color,
        outline: `${s.outlineWidth} ${s.outlineStyle} ${s.outlineColor}`,
        focusVisible: m.matches(":focus-visible"),
        btnTransition: bs ? bs.transitionDuration : null,
      };
    });
    log(`motion-theme-${theme}`, cs);
    await win.screenshot({ path: path.join(SHOTS, `adv045-theme-${theme}-menu.png`) });
    await win.keyboard.press("Escape");
    await win.waitForTimeout(600);
  }
  // theme switch while the menu is open (real toggle is unreachable while the
  // menu is open via pointerdown, so drive the option programmatically)
  await setTheme(win, "frosted");
  await openMenu(win);
  await win.evaluate(() => { document.querySelector('[data-theme-option="dark"]')?.click(); document.documentElement.setAttribute("data-theme", "dark"); });
  await win.waitForTimeout(150);
  await win.evaluate(() => { document.documentElement.setAttribute("data-theme", "frosted"); });
  await win.waitForTimeout(400);
  log("motion-theme-switch-menu-open", { menuOpen: await win.locator("[data-ann-dropdown-menu]").count(), menuVisible: await win.locator("[data-ann-dropdown-menu]").isVisible().catch(() => false), rows: await win.locator("[data-ann-dropdown-menu] [data-tool]").count() });
  await win.keyboard.press("Escape");
  await win.waitForTimeout(400);
}

// ---------------------------------------------------------------------------
// Item 8 — colour edge cases
// ---------------------------------------------------------------------------
async function sectionColor(win) {
  console.log("\n=== ITEM 8: COLOUR EDGE CASES ===");
  // ensure Select armed, menu closed
  await win.keyboard.press("Escape");
  await win.waitForTimeout(200);
  const sel = await win.locator("[data-ann-tools-visible] [data-tool]").count();
  await win.click('[data-ann-tools-visible] [data-tool="select"]');
  await win.waitForTimeout(300);
  log("color-select-no-swatch", { selectVisibleButtons: sel, swatchCount: await win.locator("[data-ann-color]").count(), activeTool: await activeTool(win) });

  // arm a colour tool from the MENU only (callout)
  await openMenu(win);
  await win.click('[data-ann-dropdown-menu] [data-tool="callout"]');
  await win.waitForSelector("[data-ann-dropdown-menu]", { state: "detached", timeout: 6000 });
  await win.waitForTimeout(400);
  log("color-callout-from-menu-swatch", { activeTool: await activeTool(win), swatchCount: await win.locator("[data-ann-color]").count(), swatchVisible: await win.locator("[data-ann-color]").isVisible().catch(() => false) });

  // both the menu and the colour popover open — programmatic swatch click
  await openMenu(win);
  await win.evaluate(() => document.querySelector("[data-ann-color]").click());
  await win.waitForTimeout(500);
  const both = await win.evaluate(() => {
    const menu = document.querySelector("[data-ann-dropdown-menu]");
    const pop = document.querySelector(".color-popover");
    const mr = menu ? menu.getBoundingClientRect() : null;
    const pr = pop ? pop.getBoundingClientRect() : null;
    const overlap = mr && pr ? Math.max(0, Math.min(mr.right, pr.right) - Math.max(mr.left, pr.left)) * Math.max(0, Math.min(mr.bottom, pr.bottom) - Math.max(mr.top, pr.top)) : null;
    let topAt = null;
    if (pr) {
      const cx = Math.round(Math.max(pr.left, 0) + Math.min(pr.width, window.innerWidth) / 2);
      const cy = Math.round(Math.max(pr.top, 0) + Math.min(pr.height, window.innerHeight) / 2);
      const el = document.elementFromPoint(cx, cy);
      topAt = el ? { tag: el.tagName, cls: typeof el.className === "string" ? el.className.slice(0, 50) : "", inColorPop: !!el.closest(".color-popover"), inMenu: !!el.closest("[data-ann-dropdown-menu]") } : null;
    }
    return {
      themeAttr: document.documentElement.getAttribute("data-theme"),
      menuOpen: !!menu, popoverOpen: !!pop,
      menuZ: menu ? getComputedStyle(menu).zIndex : null,
      popZ: pop ? getComputedStyle(pop).zIndex : null,
      menuBackdrop: menu ? (getComputedStyle(menu).backdropFilter || getComputedStyle(menu).webkitBackdropFilter) : null,
      popBackdrop: pop ? (getComputedStyle(pop).backdropFilter || getComputedStyle(pop).webkitBackdropFilter) : null,
      menuRect: mr ? { l: Math.round(mr.left), t: Math.round(mr.top), w: Math.round(mr.width), h: Math.round(mr.height) } : null,
      popRect: pr ? { l: Math.round(pr.left), t: Math.round(pr.top), w: Math.round(pr.width), h: Math.round(pr.height) } : null,
      overlapAreaPx2: overlap,
      topAtPopoverCenter: topAt,
    };
  });
  log("color-both-open", both);
  await win.screenshot({ path: path.join(SHOTS, "adv045-color-and-menu.png") });
  await win.keyboard.press("Escape");
  await win.waitForTimeout(300);
}

// ---------------------------------------------------------------------------
// Item 8b — pen-width row (moved into the menu) is reachable and live
// ---------------------------------------------------------------------------
async function sectionPen(win) {
  console.log("\n=== ITEM 8b: PEN WIDTH IN MENU ===");
  await win.keyboard.press("Escape");
  await win.waitForTimeout(800);
  // arm ink from the visible five (ink is the default fifth)
  await win.click('[data-ann-tools-visible] [data-tool="ink"]');
  await win.waitForTimeout(300);
  await openMenu(win);
  const before = await win.$$eval("[data-pen-width]", (els) => els.map((e) => ({ w: e.getAttribute("data-pen-width"), pressed: e.getAttribute("aria-pressed") })));
  await win.click('[data-pen-width="5"]');
  await win.waitForTimeout(400);
  const after = await win.$$eval("[data-pen-width]", (els) => els.map((e) => ({ w: e.getAttribute("data-pen-width"), pressed: e.getAttribute("aria-pressed") })));
  log("pen-row", { before, after, menuStillOpen: await win.locator("[data-ann-dropdown-menu]").count() });
  await win.keyboard.press("Escape");
  await win.waitForTimeout(400);
}

async function main() {
  const section = process.argv[2] || "all";
  const app = await launchApp();
  const win = await app.firstWindow();
  const errors = [];
  win.on("pageerror", (e) => errors.push(String(e.message)));
  try {
    await win.waitForSelector(".sample-card", { timeout: 30000 });
    await app.evaluate(({ BrowserWindow }) => {
      const w = BrowserWindow.getAllWindows()[0];
      if (w) w.setSize(1440, 900);
    });
    await openReport(app, win);
    const run = async (name, fn) => {
      if (section !== "all" && section !== name) return;
      try {
        await fn();
      } catch (e) {
        log(`${name}-THREW`, { message: String(e.message).split("\n")[0] });
      }
    };
    await run("hooks", () => sectionHooks(win));
    await run("click", () => sectionClick(win));
    await run("keys", () => sectionKeys(win));
    await run("disabled", () => sectionDisabled(win));
    await run("layout", () => sectionLayout(win, app));
    await run("motion", () => sectionMotion(win));
    await run("color", () => sectionColor(win));
    await run("pen", () => sectionPen(win));
    log("page-errors", errors);
  } finally {
    await hardClose(app, "adv045");
  }
}

main().catch((e) => {
  console.error("[adv045] FATAL", e && e.stack ? e.stack : e);
  process.exit(1);
});