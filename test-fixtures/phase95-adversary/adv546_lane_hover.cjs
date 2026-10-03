// TFL-546 Phase 95-D — focused arrows-lane HOVER probe.
// Confirms or refutes the analytical watch: in the arrows lane the scroll strip's
// computed overflow-y is auto (because overflow-x:auto), so it clips vertically; a
// hovered verb lifts --motion-translate-micro (2px) and could push the badge at
// top:0 above the clip box. Launches only through e2e/lib/launch.cjs.
"use strict";
delete process.env.ELECTRON_RUN_AS_NODE;
const path = require("node:path");
const os = require("node:os");
const { launchApp } = require("../../e2e/lib/launch.cjs");

const DOCK = "[data-action-dock]";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function measureLane(win, hoverId) {
  return win.evaluate((hoverId) => {
    const dock = document.querySelector("[data-action-dock]");
    const lane = dock.getAttribute("data-dock-arrows-lane") === "true";
    const scroll = dock.querySelector("[data-dock-scroll]");
    const useScroll = lane && scroll && scroll.getBoundingClientRect().width > 0;
    const cr = (useScroll ? scroll : dock).getBoundingClientRect();
    const clip = { left: cr.left, top: cr.top, right: cr.right, bottom: cr.bottom };
    const r = (el) => { const b = el.getBoundingClientRect(); return { left: b.left, top: b.top, right: b.right, bottom: b.bottom }; };
    const intersects = (b, c) => Math.min(b.right, c.right) - Math.max(b.left, c.left) > 0.5 && Math.min(b.bottom, c.bottom) - Math.max(b.top, c.top) > 0.5;
    const within = (b, c) => b.left >= c.left - 0.5 && b.right <= c.right + 0.5 && b.top >= c.top - 0.5 && b.bottom <= c.bottom + 0.5;
    const rows = Array.from(document.querySelectorAll("[data-dock-minus]")).map((badge) => {
      const b = r(badge);
      const contained = within(b, clip);
      return { id: badge.getAttribute("data-dock-minus"), contained, partial: !contained && intersects(b, clip), topEscape: +(clip.top - b.top).toFixed(2), top: +b.top.toFixed(2) };
    });
    // computed overflow of the scroller
    const so = useScroll ? getComputedStyle(scroll) : null;
    const verbTop = hoverId ? (() => { const v = document.querySelector(`[data-dock-verb="${hoverId}"]`); return v ? +v.getBoundingClientRect().top.toFixed(2) : null; })() : null;
    return { lane, useScroll, clipTop: +clip.top.toFixed(2), overflowX: so && so.overflowX, overflowY: so && so.overflowY, verbTop, hoverId, rows };
  }, hoverId);
}

(async () => {
  const app = await launchApp([], path.join(os.tmpdir(), `tflex-p95-lanehover-${Date.now()}`));
  const w = await app.firstWindow();
  const out = [];
  const rec = (s) => { out.push(s); console.log(s); };
  try {
    await w.waitForSelector(".sample-card", { timeout: 30000 });
    await w.locator(".sample-card").filter({ hasText: "report.pdf" }).first().click();
    await w.waitForSelector(".workspace", { timeout: 30000 });
    await w.waitForSelector(DOCK, { timeout: 30000 });
    await w.waitForTimeout(1000);
    await w.locator("[data-dock-edit-toggle]").click();
    await w.waitForTimeout(400);

    await app.evaluate(({ BrowserWindow }, s) => { const bw = BrowserWindow.getAllWindows()[0]; if (bw.isMaximized()) bw.unmaximize(); bw.setSize(s[0], s[1]); }, [700, 900]);
    await w.waitForTimeout(900);
    const lane0 = await measureLane(w, null);
    rec(`[lane 700 idle] lane=${lane0.lane} useScroll=${lane0.useScroll} overflowX=${lane0.overflowX} overflowY=${lane0.overflowY} clipTop=${lane0.clipTop}`);
    rec("  rest badge topEscape: " + JSON.stringify(lane0.rows.map((r) => `${r.id}:${r.topEscape}`)));
    rec("  rest partial: " + JSON.stringify(lane0.rows.filter((r) => r.partial).map((r) => r.id)));

    // hover the first (leading) verb in the lane, then a middle one
    const ids = lane0.rows.map((r) => r.id);
    for (const id of [ids[0], ids[Math.floor(ids.length / 2)]].filter(Boolean)) {
      await w.locator(`[data-dock-verb="${id}"]`).hover();
      await w.waitForTimeout(300);
      const h = await measureLane(w, id);
      const row = h.rows.find((r) => r.id === id);
      rec(`[hover ${id}] verbTop=${h.verbTop} clipTop=${h.clipTop} badgeTop=${row && row.top} topEscape=${row && row.topEscape} partial=${row && row.partial}`);
      await w.screenshot({ path: path.resolve(__dirname, "..", "..", "screenshots", `p95-lanehover-${id}.png`) });
      await w.mouse.move(3, 3);
      await w.waitForTimeout(250);
    }
  } finally {
    await app.close().catch(() => {});
  }
  const partials = out.filter((s) => /partial=true/.test(s));
  console.log("\n== LANE HOVER RESULT == partial-clipped-on-hover:", partials.length ? "CONFIRMED" : "not reproduced");
  process.exit(0);
})();
