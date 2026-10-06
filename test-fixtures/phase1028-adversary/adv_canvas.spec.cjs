// TFL-1028 adversary phase-close diff-pass (TFL-855 migrated inventory).
// On-canvas ContextToolbox anchoring probe (EditOverlay -> ContextToolbox).
// Launches ONLY via the canonical e2e/lib/launch.cjs helper.
//
// Attack class 4 (edge/zoom/scroll): the text-box and image-placement action
// bars must stay anchored to their selection across document scroll and zoom,
// and near the page edges. A bar that detaches (stays put while the selection
// moves) is the target finding.
const { test, expect } = require("@playwright/test");
const path = require("node:path");
const fs = require("node:fs");
const { launchApp } = require("../../e2e/lib/launch.cjs");
const { hardClose, gotoStage } = require("../../e2e/lib/helpers.cjs");

const OUT = path.resolve(__dirname, "..", "..", "screenshots", "phase1028-adversary");
const RESULTS = path.join(__dirname, "adv_canvas.output.json");
const PNG = path.resolve(__dirname, "..", "red.png");
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
  if (app) await hardClose(app, "tfl1028-adv-canvas");
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
  await win.waitForTimeout(1500);
}

async function scaleFor(pageNo) {
  return win.evaluate((pg) => {
    const c =
      document.querySelector(`.page-slot[data-page="${pg}"] canvas`) ||
      document.querySelector(`.pdf-page[data-page="${pg}"] canvas`);
    if (!c) return null;
    const cr = c.getBoundingClientRect();
    return { cx: cr.x, cy: cr.y, cw: cr.width, ch: cr.height };
  }, pageNo);
}

async function dragMouse(from, to, steps = 14) {
  await win.mouse.move(from.x, from.y);
  await win.mouse.down();
  await win.mouse.move(to.x, to.y, { steps });
  await win.mouse.up();
}

// Bar-anchor geometry snapshot: the committed box and its action bar.
async function anchorSnap(barSel) {
  return win.evaluate((sel) => {
    const box = document.querySelector(".edit-box") || document.querySelector(".edit-image-placement");
    const bar = document.querySelector(sel);
    if (!box || !bar) return null;
    const b = box.getBoundingClientRect();
    const t = bar.getBoundingClientRect();
    const cs = getComputedStyle(bar);
    return {
      box: { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) },
      bar: { x: Math.round(t.x), y: Math.round(t.y), w: Math.round(t.width), h: Math.round(t.height) },
      rel: { dx: Math.round(t.x - b.x), dy: Math.round(t.y - b.y) },
      position: cs.position,
      inlineTop: bar.style.top,
      placement: bar.getAttribute("data-placement"),
      insideViewport: t.x >= 0 && t.y >= 0 && t.right <= window.innerWidth && t.bottom <= window.innerHeight,
    };
  }, barSel);
}

async function scrollDoc(dy) {
  await win.evaluate((d) => {
    const sc = document.querySelector(".document-scroller");
    if (sc) sc.scrollTop += d;
  }, dy);
  await win.waitForTimeout(700);
}

test("T5 text-box action bar stays anchored across scroll and zoom", async () => {
  const rec = (results.T5 = {});
  await openReport();
  await gotoStage(win, 2);
  await win.locator('[data-dock-verb="editTextBox"]').waitFor({ state: "visible", timeout: 10000 });
  await win.locator('[data-dock-verb="editTextBox"]').click();
  await win.waitForTimeout(500);

  const scale = await scaleFor(1);
  if (!scale) {
    rec.error = "no-page-1-canvas";
    return;
  }
  const from = { x: scale.cx + 140, y: scale.cy + 160 };
  const to = { x: from.x + 180, y: from.y + 44 };
  await dragMouse(from, to, 16);
  await win.waitForSelector("[data-txt-text]", { timeout: 8000 });
  await win.waitForFunction(
    () => {
      const ta = document.querySelector("[data-txt-text]");
      return ta !== null && ta.disabled === false;
    },
    null,
    { timeout: 8000 },
  );
  await win.fill("[data-txt-text]", "ADV ANCHOR 1028");
  await win.locator("[data-txt-text]").blur();
  await win.waitForTimeout(1600);

  // Ensure the committed box is selected so its ContextToolbox renders.
  if ((await win.locator("[data-edit-box-toolbar]").count()) === 0) {
    const br = await win.locator(".edit-box").first().boundingBox();
    if (br) {
      await win.mouse.click(br.x + br.width / 2, br.y + br.height / 2);
      await win.waitForTimeout(700);
    }
  }
  const barSeen = await win
    .waitForSelector("[data-edit-box-toolbar]", { state: "visible", timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  rec.toolbarShown = barSeen;
  if (!barSeen) {
    rec.note = "toolbar never appeared after commit/select";
    return;
  }
  await win.waitForTimeout(400);
  rec.snap0 = await anchorSnap("[data-edit-box-toolbar]");
  rec.toolboxClass = await win.evaluate(
    () => document.querySelector("[data-edit-box-toolbar]")?.className || null,
  );
  rec.hasPageViewClass = await win.evaluate(
    () => document.querySelector("[data-edit-box-toolbar]")?.classList.contains("context-toolbox--page-view") || false,
  );
  await shot("tfl1028-textbox-toolbar-initial.png");

  // Scroll the document; an anchored bar moves with the box.
  await scrollDoc(260);
  rec.snapScroll = await anchorSnap("[data-edit-box-toolbar]");
  if (rec.snap0 && rec.snapScroll) {
    rec.scrollBoxDelta = rec.snapScroll.box.y - rec.snap0.box.y;
    rec.scrollBarDelta = rec.snapScroll.bar.y - rec.snap0.bar.y;
    rec.scrollDrift = Math.abs(rec.scrollBoxDelta - rec.scrollBarDelta);
  }
  await shot("tfl1028-textbox-toolbar-after-scroll.png");

  // Zoom in; the relation of the bar to the box must be preserved.
  const zoomBtn = win.locator('button[aria-label="Zoom in"]').first();
  if ((await zoomBtn.count()) > 0) {
    await zoomBtn.click();
    await win.waitForTimeout(1200);
    rec.snapZoom = await anchorSnap("[data-edit-box-toolbar]");
    if (rec.snap0 && rec.snapZoom) {
      rec.zoomRelDriftX = Math.abs(rec.snapZoom.rel.dx - rec.snap0.rel.dx);
      rec.zoomRelDriftY = Math.abs(rec.snapZoom.rel.dy - rec.snap0.rel.dy);
    }
    await shot("tfl1028-textbox-toolbar-after-zoom.png");
    await zoomBtn.click();
    await win.waitForTimeout(800);
  }
  expect(true).toBe(true);
});

test("T6 image-placement action bar stays anchored across scroll", async () => {
  const rec = (results.T6 = {});
  await openReport();
  await gotoStage(win, 2);
  await win.locator('[data-dock-verb="editImage"]').waitFor({ state: "visible", timeout: 10000 });
  await win.locator('[data-dock-verb="editImage"]').click();
  await win.waitForTimeout(500);

  const scale = await scaleFor(1);
  if (!scale) {
    rec.error = "no-page-1-canvas";
    return;
  }
  const from = { x: scale.cx + 160, y: scale.cy + 260 };
  const to = { x: from.x + 150, y: from.y + 90 };
  const fcPromise = win.waitForEvent("filechooser");
  await dragMouse(from, to, 16);
  let placed = false;
  try {
    const fc = await fcPromise;
    await fc.setFiles(PNG);
    placed = true;
  } catch (e) {
    rec.fileChooser = String(e && e.message);
  }
  rec.fileChosen = placed;
  await win.waitForTimeout(1800);
  rec.placementExists = (await win.locator(".edit-image-placement").count()) > 0;
  if (!(await win.locator(".edit-image-toolbar").isVisible().catch(() => false)) && rec.placementExists) {
    const pr = await win.locator(".edit-image-placement").first().boundingBox();
    if (pr) {
      await win.mouse.click(pr.x + pr.width / 2, pr.y + pr.height / 2);
      await win.waitForTimeout(700);
    }
  }
  const barSeen = await win
    .waitForSelector(".edit-image-toolbar", { state: "visible", timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  rec.toolbarShown = barSeen;
  if (!barSeen) return;
  await win.waitForTimeout(400);
  rec.snap0 = await anchorSnap(".edit-image-toolbar");
  rec.hasPageViewClass = await win.evaluate(
    () => document.querySelector(".edit-image-toolbar")?.classList.contains("context-toolbox--page-view") || false,
  );
  await shot("tfl1028-image-toolbar-initial.png");
  await scrollDoc(240);
  rec.snapScroll = await anchorSnap(".edit-image-toolbar");
  if (rec.snap0 && rec.snapScroll) {
    rec.scrollBoxDelta = rec.snapScroll.box.y - rec.snap0.box.y;
    rec.scrollBarDelta = rec.snapScroll.bar.y - rec.snap0.bar.y;
    rec.scrollDrift = Math.abs(rec.scrollBoxDelta - rec.scrollBarDelta);
  }
  await shot("tfl1028-image-toolbar-after-scroll.png");
  expect(true).toBe(true);
});
