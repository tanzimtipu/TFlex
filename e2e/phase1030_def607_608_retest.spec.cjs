// TFL-1030 — qa retest probe for DEF-607 (ADV-234) and DEF-608 (ADV-235).
// Launches ONLY via the canonical e2e/lib/launch.cjs helper.
//
// DEF-607: the page-view ContextToolbox (EditOverlay text-box / image-placement
// bars) must compute position:absolute on a fine pointer, while a NON-page-view
// ContextToolbox still computes position:fixed. The adversary probe already
// measured the live bars; this adds the fine-pointer computed-style cascade
// check for BOTH classes plus a strict dock-floor clamp assertion.
// DEF-608: the dock Pin/Unpin [data-dock-menu] rect must clamp fully inside the
// viewport when opened near the window floor.
const { test, expect } = require("@playwright/test");
const { launchApp } = require("./lib/launch.cjs");
const { hardClose } = require("./lib/helpers.cjs");

test.setTimeout(300000);

test("DEF-607 page-view toolbox is absolute, window toolbox is fixed (fine pointer)", async () => {
  const app = await launchApp();
  try {
    const win = await app.firstWindow();
    await win.waitForSelector(".sample-card", { timeout: 30000 });
    const probe = await win.evaluate(() => {
      const mk = (cls) => {
        const d = document.createElement("div");
        d.className = cls;
        document.body.appendChild(d);
        const pos = getComputedStyle(d).position;
        d.remove();
        return pos;
      };
      return {
        coarse: window.matchMedia("(pointer: coarse)").matches,
        window: mk("context-toolbox"),
        pageView: mk("context-toolbox context-toolbox--page-view"),
      };
    });
    console.log("DEF-607 computed cascade:", JSON.stringify(probe));
    expect(probe.coarse).toBe(false);
    expect(probe.window).toBe("fixed");
    expect(probe.pageView).toBe("absolute");
  } finally {
    await hardClose(app, "tfl1030-def607");
  }
});

test("DEF-608 dock pin menu clamps inside the viewport near the floor", async () => {
  const app = await launchApp();
  try {
    const win = await app.firstWindow();
    await win.waitForSelector(".sample-card", { timeout: 30000 });
    await win.locator(".sample-card").filter({ hasText: "report.pdf" }).first().click();
    await win.waitForSelector(".workspace", { timeout: 30000 });
    await win.waitForSelector("[data-action-dock]", { timeout: 30000 });
    await win.waitForTimeout(1200);

    // Pick the dock verb whose centre sits lowest (closest to the window floor).
    const verbs = await win.locator("[data-dock-verb]").all();
    let target = null;
    for (const v of verbs) {
      const b = await v.boundingBox();
      if (b && (target === null || b.y > target.y)) target = b;
    }
    expect(target).not.toBeNull();
    await win.mouse.click(target.x + target.width / 2, target.y + target.height / 2, { button: "right" });
    await win.waitForSelector("[data-dock-menu]", { state: "visible", timeout: 8000 });
    await win.waitForTimeout(400);
    const rect = await win.evaluate(() => {
      const el = document.querySelector("[data-dock-menu]");
      const r = el.getBoundingClientRect();
      return {
        y: Math.round(r.y), h: Math.round(r.height), bottom: Math.round(r.bottom),
        vh: window.innerHeight, position: getComputedStyle(el).position,
      };
    });
    console.log("DEF-608 dock menu rect:", JSON.stringify(rect));
    expect(rect.position).toBe("fixed");
    expect(rect.bottom).toBeLessThanOrEqual(rect.vh);
  } finally {
    await hardClose(app, "tfl1030-def608");
  }
});
