// DEF-341 — the Action Dock's verb row must stay INSIDE the dock's box and the
// LEADING verb of every stage must stay hit-testable at every width.
//
// qa measured the regression at the default window: `.action-dock-group`'s
// `justify-content: center` let an overflowing row spill half its excess to the
// LEFT of the scroll box, so REVIEW's `annotate` laid out at x=340 while the
// dock box began at x=422 — its centre resolved to `.page-indicator`, and
// `P36-C3-N` reported `clipped=["rotate","extract","merge","cropPages"]` at
// 1440. The fix makes the scroll container own the overflow and start-align the
// overflowing row (the arrows lane absorbs it); nothing may paint or hit-test
// outside the dock.
//
// Two layers are pinned here, without a browser:
//   1. the pure containment rule (`dockRowLeadingOffset` / `dockRowNeedsLane`)
//      exercised over the REAL per-stage verb sets and a width matrix;
//   2. the stylesheet contract that implements it.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { Stage } from "../../../src/renderer/state/stages";
import {
  DOCK_LIFT_INSET,
  DOCK_MIN_BAND,
  dockRowLeadingOffset,
  dockRowNeedsLane,
  dockVerbWidth,
  labelledDockNeed,
} from "../../../src/renderer/state/dockFit";
import { dockToolsForStage } from "../../../src/renderer/state/toolsRegistry";

const STAGES: readonly Stage[] = ["pages", "edit", "review", "deliver"];

/** The supported window widths from the acceptance matrix. */
const WIDTHS = [1920, 1440, 1200, 880, 719, 640] as const;

/** A conservative model of the dock's available scroll box at a window width.
 *  The host is the window minus the open Inspector (264px) minus the stage
 *  rail's 44px; the pills leave a clearance-exclusive free band, and below the
 *  dock's minimum band the dock parks ABOVE the pill row and may use the host.
 *  The numbers are deliberately PESSIMISTIC (a smaller box than the live app
 *  reports), so the containment rule is proven for the worst case at each
 *  width. */
function scrollBoxFor(width: number): number {
  const host = Math.max(0, width - 264 - 44);
  const pagePill = 12 + 154;
  const zoomPill = 12 + 226;
  const band = Math.max(0, host - pagePill - zoomPill - 16);
  const cap = band < DOCK_MIN_BAND ? Math.max(0, host - 2 * DOCK_LIFT_INSET) : band;
  // The lane's arrows (2 x 26) and gaps (2 x 4) come out of the scroller.
  return Math.max(0, cap - 60);
}

function rowNeed(stage: Stage): number {
  const labels = dockToolsForStage(stage).map((entry) => entry.label);
  return labelledDockNeed(labels);
}

describe("DEF-341 — the leading verb is contained at every stage and width", () => {
  it("start-aligns an overflowing row so the leading verb is inside the box", () => {
    for (const stage of STAGES) {
      for (const width of WIDTHS) {
        const box = scrollBoxFor(width);
        const need = rowNeed(stage);
        if (!dockRowNeedsLane(need, box)) continue;
        expect(
          dockRowLeadingOffset(need, box),
          `${stage} @ ${width}: an overflowing row must start at the scroll origin`,
        ).toBe(0);
        // The leading verb's own centre must lie inside the box.
        const leadingWidth = dockVerbWidth(dockToolsForStage(stage)[0].label);
        // A box narrower than one verb cannot host the dock at all; the real
        // geometry never produces one at a supported width.
        if (box < leadingWidth) continue;
        const centre = dockRowLeadingOffset(need, box) + leadingWidth / 2;
        expect(centre, `${stage} @ ${width}: leading verb centre inside the box`).toBeGreaterThan(0);
        expect(centre, `${stage} @ ${width}: leading verb centre inside the box`).toBeLessThanOrEqual(box);
      }
    }
  });

  it("centres only a row that actually fits, and never to a negative offset", () => {
    expect(dockRowLeadingOffset(300, 400)).toBe(50);
    expect(dockRowLeadingOffset(400, 400)).toBe(0);
    // The old bug: a centred overflow spilled (need - box) / 2 to the LEFT.
    expect(dockRowLeadingOffset(552, 430)).toBe(0);
    expect(dockRowLeadingOffset(552, 430)).not.toBe((552 - 430) / 2);
  });

  it("names the lane for the REAL PAGES row at 1440 (the measured regression)", () => {
    // qa's raw: dock x=422 w=508, scroller clientWidth 430, scrollWidth 552.
    // The row needs the lane at 1440, and the lane start-aligns it.
    const need = rowNeed("pages");
    expect(dockRowNeedsLane(need, 430)).toBe(true);
    expect(dockRowLeadingOffset(need, 430)).toBe(0);
  });
});

describe("DEF-341 — the stylesheet makes the scroll container own the overflow", () => {
  const css = readFileSync(resolve(process.cwd(), "src/renderer/styles.css"), "utf8")
    .replace(/\r\n/g, "\n")
    .replace(/\/\*[\s\S]*?\*\//g, "");

  function ruleBody(selector: string): string {
    const start = css.indexOf(selector);
    expect(start, `selector present: ${selector}`).toBeGreaterThanOrEqual(0);
    const open = css.indexOf("{", start);
    const close = css.indexOf("}", open);
    return css.slice(open + 1, close);
  }

  it("the arrows-lane scroller clips and scrolls, and starts the row at the origin", () => {
    const body = ruleBody(".action-dock[data-dock-arrows-lane='true'] .action-dock-scroll {");
    expect(body).toMatch(/overflow-x:\s*auto/);
    expect(body).toMatch(/min-width:\s*0/);
    expect(body).toMatch(/flex:\s*1 1 auto/);
    expect(body).toMatch(/justify-content:\s*flex-start/);
    expect(body).not.toMatch(/justify-content:\s*center/);
  });

  it("the lane's row keeps its natural width (never shrinks to an unreachable centre)", () => {
    const body = ruleBody(".action-dock[data-dock-arrows-lane='true'] .action-dock-scroll > * {");
    expect(body).toMatch(/flex:\s*0 0 auto/);
    const group = ruleBody(".action-dock[data-dock-arrows-lane='true'] .action-dock-group {");
    expect(group).toMatch(/max-width:\s*none/);
    expect(group).toMatch(/margin-inline:\s*auto/);
    expect(group).toMatch(/justify-content:\s*flex-start/);
  });

  it("the base group can never centre-overflow (safe center, with a plain fallback)", () => {
    const body = ruleBody(".action-dock-group {");
    expect(body).toMatch(/justify-content:\s*center;/);
    expect(body).toMatch(/justify-content:\s*safe center;/);
  });

  it("the dock itself never wraps or paints outside its capped box", () => {
    const body = ruleBody(".action-dock {");
    expect(body).toMatch(/flex-wrap:\s*nowrap/);
    expect(body).toMatch(/max-width:\s*max\(0px, calc\(100% - var\(--dock-reserve/);
  });
});
