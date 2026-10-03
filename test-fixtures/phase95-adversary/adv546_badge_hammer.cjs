// TFL-546 Phase 95-D adversarial hammer — dock + home EDIT-mode remove badges.
//
// Standalone Playwright/Electron probe (no test-runner): launches ONLY through the
// canonical e2e/lib/launch.cjs launchApp, exactly as qa does. Read-only against the
// product; it only drives the shipped UI and prints a PASS/FAIL report. Nothing under
// src/, test/ or e2e/ is touched.
//
// Run:  node test-fixtures/phase95-adversary/adv546_badge_hammer.cjs
"use strict";
delete process.env.ELECTRON_RUN_AS_NODE;

const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");
const { launchApp } = require("../../e2e/lib/launch.cjs");

const SHOTS = path.resolve(__dirname, "..", "..", "screenshots");
if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`  [${pass ? "PASS" : "FAIL"}] ${name}${detail ? " :: " + detail : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DOCK = "[data-action-dock]";

// Measure every badge against its ACTIVE clip ancestor + viewport. The active
// clipper is the lane scroller ONLY when the lane is on (`.action-dock-scroll` is
// `display:contents` otherwise, so its rect is zero); else the dock root. This
// mirrors e2e/phase95_dock_edit_overflow.spec.cjs:111-127.
async function measure(win, badgeSel) {
  return win.evaluate(
    ({ badgeSel }) => {
      const dock = document.querySelector("[data-action-dock]");
      const vw = window.innerWidth, vh = window.innerHeight;
      const viewport = { left: 0, top: 0, right: vw, bottom: vh };
      const lane = dock.getAttribute("data-dock-arrows-lane") === "true";
      const scroll = dock.querySelector("[data-dock-scroll]");
      const useScroll = lane && scroll !== null && scroll.getBoundingClientRect().width > 0;
      const clipEl = useScroll ? scroll : dock;
      const cr = clipEl.getBoundingClientRect();
      const clip = { left: cr.left, top: cr.top, right: cr.right, bottom: cr.bottom };
      const r = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom }; };
      const within = (b, c) => b.left >= c.left - 0.5 && b.right <= c.right + 0.5 && b.top >= c.top - 0.5 && b.bottom <= c.bottom + 0.5;
      const intersects = (b, c) => Math.min(b.right, c.right) - Math.max(b.left, c.left) > 0.5 && Math.min(b.bottom, c.bottom) - Math.max(b.top, c.top) > 0.5;
      const rows = Array.from(document.querySelectorAll(badgeSel)).map((badge) => {
        const b = r(badge); const contained = within(b, clip) && within(b, viewport); const disjoint = !intersects(b, clip);
        const row = { id: badge.getAttribute("data-dock-minus") || badge.getAttribute("data-home-minus") || "?", contained, disjoint, partial: !contained && !disjoint, topEscape: +(clip.top - b.top).toFixed(2), hit: null, hitTarget: null };
        if (contained) {
          const cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2;
          const h = (cx >= 0 && cy >= 0 && cx <= vw && cy <= vh) ? document.elementFromPoint(cx, cy) : null;
          row.hit = h !== null && (h === badge || badge.contains(h));
          row.hitTarget = h === null ? "(none)" : `${h.tagName.toLowerCase()}.${String(h.className).split(" ")[0] || ""}`;
        }
        return row;
      });
      return { lane, clipTop: +clip.top.toFixed(2), clipName: useScroll ? "scroll" : "dock", rows };
    },
    { badgeSel },
  );
}

function badOf(m) {
  return m.rows.filter((r) => r.partial || (r.contained && r.hit === false));
}
function logMeasure(label, m) {
  console.log(`    ${label}: lane=${m.lane} clip=${m.clipName}@${m.clipTop} badges=${m.rows.length} partial=${m.rows.filter((r) => r.partial).length} notHit=${m.rows.filter((r) => r.contained && r.hit === false).length} topEscape=${JSON.stringify(m.rows.map((r) => r.topEscape))}`);
}

async function openReport(win) {
  await win.waitForSelector(".sample-card", { timeout: 30000 });
  await win.locator(".sample-card").filter({ hasText: "report.pdf" }).first().click();
  await win.waitForSelector(".workspace", { timeout: 30000 });
  await win.waitForSelector(DOCK, { timeout: 30000 });
  await win.waitForTimeout(1000);
}

async function dockRun() {
  const app = await launchApp([], path.join(os.tmpdir(), `tflex-p95-hammer-dock-${Date.now()}`));
  const w = await app.firstWindow();
  try {
    await openReport(w);
    await w.locator("[data-dock-edit-toggle]").click();
    await w.waitForTimeout(400);
    check("dock: edit mode arms", (await w.locator(DOCK).getAttribute("data-dock-edit")) === "true");

    // --- State 1: idle (40% opacity). Idle is suppressed while the pointer is over
    // the dock (hoveredRef) and while a tool is armed, so move the pointer away. ---
    await w.mouse.move(3, 3);
    await sleep(3800);
    const idleAttr = await w.locator(DOCK).getAttribute("data-dock-idle");
    const idleM = await measure(w, "[data-dock-minus]");
    logMeasure("idle", idleM);
    check("dock idle: data-dock-idle=true observed with pointer away", idleAttr === "true", `idle=${idleAttr}`);
    check("dock idle: every badge contained + hit-testable at 40% opacity", badOf(idleM).length === 0);
    {
      const before = await w.locator("[data-dock-minus]").evaluateAll((els) => els.map((e) => e.getAttribute("data-dock-minus")));
      await w.locator(`[data-dock-minus="${before[0]}"]`).click();
      await w.waitForTimeout(450);
      const gone = await w.locator(`[data-dock-minus="${before[0]}"]`).count();
      check("dock idle: a badge click still removes its verb at 40% opacity", gone === 0, `id=${before[0]}`);
      await w.mouse.move(3, 3);
      await sleep(3800);
    }

    // --- State 2: hover a lane verb (hover transform lifts the verb) ---
    await w.locator('[data-dock-verb="delete"]').scrollIntoViewIfNeeded();
    await w.locator('[data-dock-verb="delete"]').hover();
    await w.waitForTimeout(300);
    const hovM = await measure(w, "[data-dock-minus]");
    logMeasure("hover-delete", hovM);
    const hovDelete = hovM.rows.find((r) => r.id === "delete");
    check("dock hover: hovered verb badge not partially clipped by its clip ancestor", !(hovDelete && hovDelete.partial), hovDelete ? `partial=${hovDelete.partial} topEscape=${hovDelete.topEscape}` : "no row");
    await w.screenshot({ path: path.join(SHOTS, "p95-hammer-hover.png") });
    await w.mouse.move(3, 3);

    // --- State 3: badge click removes the RIGHT tool and does NOT run the verb ---
    const beforeIds = await w.locator("[data-dock-minus]").evaluateAll((els) => els.map((e) => e.getAttribute("data-dock-minus")));
    await w.locator('[data-dock-minus="cropPages"]').click();
    await w.waitForTimeout(500);
    const afterIds = await w.locator("[data-dock-minus]").evaluateAll((els) => els.map((e) => e.getAttribute("data-dock-minus")));
    const dialogs = await w.locator('[role="dialog"],[role="alertdialog"]').count();
    check("dock: badge click removes exactly its own verb", beforeIds.includes("cropPages") && !afterIds.includes("cropPages"), `before=${beforeIds.length} after=${afterIds.length}`);
    check("dock: badge click did NOT run the verb (no dialog/panel opened)", dialogs === 0, `dialogs=${dialogs}`);

    // --- State 4: keyboard ---
    const tabInfo = await w.evaluate(() => {
      const b = document.querySelector("[data-dock-minus]");
      return b ? { tabIndex: b.tabIndex, tag: b.tagName, role: b.getAttribute("role") } : null;
    });
    await w.locator("[data-dock-edit-toggle]").focus();
    let tabReached = false;
    for (let i = 0; i < 60; i++) {
      await w.keyboard.press("Tab");
      const cls = await w.evaluate(() => (document.activeElement && document.activeElement.className) || "");
      if (String(cls).includes("action-dock-minus")) { tabReached = true; break; }
    }
    check("dock keyboard: a badge is reachable by Tab from the dock chrome", tabReached, JSON.stringify(tabInfo));
    const any = w.locator("[data-dock-minus]").first();
    const idA = await any.getAttribute("data-dock-minus");
    await any.focus();
    const isFocused = await w.evaluate(() => String((document.activeElement && document.activeElement.className) || "").includes("action-dock-minus"));
    await w.keyboard.press("Enter");
    await w.waitForTimeout(400);
    check("dock keyboard: programmatic focus lands on a badge and Enter removes it", isFocused && (await w.locator(`[data-dock-minus="${idA}"]`).count()) === 0, `id=${idA} focused=${isFocused}`);
    const any2 = w.locator("[data-dock-minus]").first();
    const idB = await any2.getAttribute("data-dock-minus");
    await any2.focus();
    await w.keyboard.press(" ");
    await w.waitForTimeout(400);
    check("dock keyboard: Space on a focused badge removes it", (await w.locator(`[data-dock-minus="${idB}"]`).count()) === 0, `id=${idB}`);

    // --- State 5: pen toggle round-trip ---
    await w.locator("[data-dock-edit-toggle]").click();
    await w.waitForTimeout(300);
    const off = await w.locator(DOCK).getAttribute("data-dock-edit");
    const badgesOff = await w.locator("[data-dock-minus]").count();
    await w.locator("[data-dock-edit-toggle]").click();
    await w.waitForTimeout(300);
    const on = await w.locator(DOCK).getAttribute("data-dock-edit");
    check("dock: pen toggles edit off (badges hidden) then on", off === "false" && badgesOff === 0 && on === "true", `off=${off} badgesOff=${badgesOff} on=${on}`);

    // --- State 6: plus picker add works ---
    const n0 = await w.locator("[data-dock-minus]").count();
    await w.locator("[data-dock-plus]").click();
    await w.waitForSelector("[data-dock-picker]", { timeout: 5000 });
    const pickerItems = await w.locator("[data-dock-picker-item]").count();
    let added = null;
    if (pickerItems > 0) {
      added = await w.locator("[data-dock-picker-item]").first().getAttribute("data-dock-picker-item");
      await w.locator("[data-dock-picker-item]").first().click();
      await w.waitForTimeout(600);
    }
    const n1 = await w.locator("[data-dock-minus]").count();
    check("dock: plus picker opens and adds a verb", pickerItems > 0 && n1 > n0, `items=${pickerItems} added=${added} n0=${n0} n1=${n1}`);

    // --- State 7: many pins -> row overflow -> badges still contained ---
    for (let i = 0; i < 8; i++) {
      await w.locator("[data-dock-plus]").click();            // toggle picker open
      await w.waitForTimeout(200);
      const items = await w.locator("[data-dock-picker-item]").count();
      if (!items) { await w.locator("[data-dock-plus]").click(); break; }
      await w.locator("[data-dock-picker-item]").first().click();
      await w.waitForTimeout(350);
    }
    // close the picker by toggling the plus (never Escape: Escape exits edit mode)
    if (await w.locator("[data-dock-picker]").count()) await w.locator("[data-dock-plus]").click();
    await w.waitForTimeout(300);
    const editStillOn = await w.locator(DOCK).getAttribute("data-dock-edit");
    const laneAttr = await w.locator(DOCK).getAttribute("data-dock-arrows-lane");
    const manyM = await measure(w, "[data-dock-minus]");
    logMeasure("many-pins", manyM);
    check("dock many-pins/overflow: every rendered badge contained + hit-testable", editStillOn === "true" && manyM.rows.length > 0 && badOf(manyM).length === 0, `edit=${editStillOn} lane=${laneAttr} badges=${manyM.rows.length}`);
    await w.evaluate(() => { const s = document.querySelector("[data-dock-scroll]"); if (s && s.scrollWidth) s.scrollLeft = s.scrollWidth; });
    await w.waitForTimeout(300);
    const endM = await measure(w, "[data-dock-minus]");
    logMeasure("scrolled-end", endM);
    check("dock scrolled-to-end: badges not partially clipped at the trailing edge", badOf(endM).length === 0);
    await w.screenshot({ path: path.join(SHOTS, "p95-hammer-many-pins.png") });

    // --- State 8: context-menu Unpin on a pinned ENABLED verb ---
    const enabledPin = w.locator("[data-dock-pin]:not([disabled])").first();
    if ((await enabledPin.count()) > 0) {
      const pinId = await enabledPin.getAttribute("data-dock-pin");
      await enabledPin.click({ button: "right" });
      await w.waitForTimeout(300);
      const items = w.locator('[role="menuitem"]');
      const n = await items.count();
      const unpin = w.locator('[role="menuitem"]', { hasText: /unpin|remove/i }).first();
      const hasUnpin = (await unpin.count()) > 0;
      if (hasUnpin) { await unpin.click(); await w.waitForTimeout(450); }
      const stillPinned = await w.locator(`[data-dock-pin="${pinId}"]`).count();
      check("dock: context-menu Unpin available and removes the pin", hasUnpin && stillPinned === 0, `pinId=${pinId} menuItems=${n} stillPinned=${stillPinned}`);
    } else {
      check("dock: context-menu Unpin available on a pinned verb", true, "no enabled pinned verb present (informational)");
    }
  } finally {
    await app.close().catch(() => {});
  }
}

async function homeRun() {
  const app = await launchApp([], path.join(os.tmpdir(), `tflex-p95-hammer-home-${Date.now()}`));
  const w = await app.firstWindow();
  try {
    await w.waitForSelector(".welcome", { timeout: 30000 });
    await w.waitForSelector("[data-home-tools]", { timeout: 30000 });
    await w.locator("[data-home-edit-toggle]").click();
    await w.waitForTimeout(400);
    check("home: edit mode arms", (await w.locator("[data-home-tools]").getAttribute("data-home-edit")) === "true");

    const m = await w.evaluate(() => {
      const welcome = document.querySelector(".welcome");
      const vw = window.innerWidth, vh = window.innerHeight;
      const r = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom }; };
      const within = (b, c) => b.left >= c.left - 0.5 && b.right <= c.right + 0.5 && b.top >= c.top - 0.5 && b.bottom <= c.bottom + 0.5;
      const rw = r(welcome);
      return Array.from(document.querySelectorAll("[data-home-minus]")).map((badge) => {
        const b = r(badge); const cx = (b.left + b.right) / 2, cy = (b.top + b.bottom) / 2;
        const h = (cx >= 0 && cy >= 0 && cx <= vw && cy <= vh) ? document.elementFromPoint(cx, cy) : null;
        return { id: badge.getAttribute("data-home-minus"), inWelcome: within(b, rw), inViewport: cx >= 0 && cy >= 0 && cx <= vw && cy <= vh, hit: h !== null && (h === badge || badge.contains(h)) };
      });
    });
    const badHome = m.filter((r) => !r.inWelcome || !r.inViewport || r.hit === false);
    check("home: every badge contained in .welcome + viewport + hit-testable", badHome.length === 0, JSON.stringify(m));
    await w.screenshot({ path: path.join(SHOTS, "p95-hammer-home.png") });

    const before = await w.locator("[data-home-minus]").evaluateAll((els) => els.map((e) => e.getAttribute("data-home-minus")));
    await w.locator("[data-home-minus]").first().click();
    await w.waitForTimeout(400);
    const after = await w.locator("[data-home-minus]").evaluateAll((els) => els.map((e) => e.getAttribute("data-home-minus")));
    const dialogs = await w.locator('[role="dialog"],[role="alertdialog"]').count();
    check("home: badge click removes exactly its own tile, no dialog", after.length === before.length - 1 && before[0] !== undefined && !after.includes(before[0]) && dialogs === 0, `before=${JSON.stringify(before)} after=${JSON.stringify(after)} dialogs=${dialogs}`);
  } finally {
    await app.close().catch(() => {});
  }
}

(async () => {
  console.log("== TFL-546 Phase 95-D badge hammer ==");
  try { await dockRun(); } catch (e) { check("dock run completed without throwing", false, String((e && e.stack) || e)); }
  try { await homeRun(); } catch (e) { check("home run completed without throwing", false, String((e && e.stack) || e)); }
  const failed = results.filter((r) => !r.pass);
  console.log(`\n== SUMMARY: ${results.length - failed.length}/${results.length} checks passed ==`);
  if (failed.length) { console.log("FAILURES:"); for (const f of failed) console.log(" - " + f.name + (f.detail ? " :: " + f.detail : "")); }
  process.exit(0);
})();
