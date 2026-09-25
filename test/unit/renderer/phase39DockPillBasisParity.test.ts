// Phase 39 (D3) — the dock's reserve/lift BASIS must be identical between
// single mode and Multi Mode at the same host width.
//
// Single mode measures the pills' real inner-edge offsets (the pills sit at the
// host's 12px insets). Multi Mode's shared dock lives in `.multi-dock-layer`
// while the FOCUSED pane's pills are OUTBOARD (pane-sized, at the pane's outer
// edge), so their measured POSITIONS are meaningless to the workspace-centred
// dock. `pillBasisFromWidths` rebuilds the basis from the pills' WIDTHS at the
// single-mode insets. These tests pin that rebuild to the single-mode
// computation, so the measured-overflow lane and the vertical lift can never
// diverge again at the same width.

import { describe, expect, it } from "vitest";
import {
  DOCK_PILL_INSET,
  dockBand,
  pillBandHeight,
  pillBasisFromWidths,
  pillFreeBand,
  pillReserve,
  shouldLiftDock,
  type PillBox,
} from "../../../src/renderer/state/dockFit";
import { PILL_RAISE, pillMode } from "../../../src/renderer/state/pillFit";

function box(left: number, top: number, width: number, height: number): PillBox {
  return { left, top, right: left + width, bottom: top + height, width, height };
}

/** The SINGLE-mode boxes: page at the host's left inset, zoom at its right. */
function singleBoxes(hostWidth: number, pageW: number, zoomW: number, pillH: number) {
  const page = box(DOCK_PILL_INSET, 0, pageW, pillH);
  const zoom = box(hostWidth - DOCK_PILL_INSET - zoomW, 0, zoomW, pillH);
  return { page, zoom };
}

/** The same pills OUTBOARD inside a focused pane (pane A's outer-left edge). */
function outboardBoxes(hostWidth: number, pageW: number, zoomW: number, pillH: number) {
  const paneW = hostWidth / 2;
  const page = box(DOCK_PILL_INSET, 0, pageW, pillH);
  const zoom = box(paneW - DOCK_PILL_INSET - zoomW, 0, zoomW, pillH);
  return { page, zoom };
}

function singleBasis(hostWidth: number, pageW: number, zoomW: number, pillH: number) {
  const { page, zoom } = singleBoxes(hostWidth, pageW, zoomW, pillH);
  return {
    reserve: pillReserve({ page, zoom, hostLeft: 0, hostRight: hostWidth }),
    pillHeight: pillBandHeight(page, zoom),
    free: pillFreeBand({ page, zoom, hostLeft: 0 }),
  };
}

function multiBasis(hostWidth: number, pageW: number, zoomW: number, pillH: number) {
  const { page, zoom } = outboardBoxes(hostWidth, pageW, zoomW, pillH);
  return pillBasisFromWidths({
    page,
    zoom,
    hostWidth,
    stackedRaisePx: pillMode(hostWidth) === "stacked" ? PILL_RAISE : 0,
  });
}

// qa's matrix host widths (single and multi are now the same at each window
// width) and the pills' live-measured widths at those widths: the zoom pill is
// 225.8px while its percent readout carries a fourth glyph and 218px at 760.
const MATRIX: ReadonlyArray<{ host: number; pageW: number; zoomW: number }> = [
  { host: 738, pageW: 154.4, zoomW: 225.8 },
  { host: 688, pageW: 154.4, zoomW: 225.8 },
  { host: 907.3, pageW: 154.4, zoomW: 225.8 },
  { host: 758, pageW: 154.4, zoomW: 225.8 },
  { host: 708, pageW: 154.4, zoomW: 225.8 },
  { host: 724, pageW: 154.4, zoomW: 225.8 },
  { host: 604, pageW: 154.4, zoomW: 218 },
  { host: 563.3, pageW: 154.4, zoomW: 218 },
  { host: 544, pageW: 154.4, zoomW: 218 },
];

const PILL_H = 41.33;

describe("dock pill basis parity (Phase 39 D3)", () => {
  it("rebuilds single mode's reserve/free/band from the outboard pill widths", () => {
    for (const { host, pageW, zoomW } of MATRIX) {
      const single = singleBasis(host, pageW, zoomW, PILL_H);
      const multi = multiBasis(host, pageW, zoomW, PILL_H);
      expect(multi.reserve).toBeCloseTo(single.reserve, 6);
      expect(multi.free?.left).toBeCloseTo(single.free.left, 6);
      expect(multi.free?.width).toBeCloseTo(single.free.width, 6);
      expect(multi.pillHeight).toBeCloseTo(single.pillHeight, 6);
    }
  });

  it("keeps the band, lift and lane decisions identical at every matrix width", () => {
    for (const { host, pageW, zoomW } of MATRIX) {
      const single = singleBasis(host, pageW, zoomW, PILL_H);
      const multi = multiBasis(host, pageW, zoomW, PILL_H);
      expect(dockBand(host, multi.reserve)).toBeCloseTo(dockBand(host, single.reserve), 6);
      expect(shouldLiftDock(dockBand(host, multi.reserve))).toBe(
        shouldLiftDock(dockBand(host, single.reserve)),
      );
      // The lane keys on the same label band: free width when placed.
      expect(multi.free?.width ?? dockBand(host, multi.reserve)).toBeCloseTo(
        single.free.width ?? dockBand(host, single.reserve),
        6,
      );
    }
  });

  it("lifts at 719/700 in both modes and not above", () => {
    for (const host of [563.3, 544]) {
      const single = singleBasis(host, 154.4, 218, PILL_H);
      const multi = multiBasis(host, 154.4, 218, PILL_H);
      expect(shouldLiftDock(dockBand(host, single.reserve))).toBe(true);
      expect(shouldLiftDock(dockBand(host, multi.reserve))).toBe(true);
    }
  });

  it("proves the OUTBOARD positions are what used to diverge", () => {
    const host = 907.3;
    const { page, zoom } = outboardBoxes(host, 154.4, 225.8, PILL_H);
    // Feeding the outboard boxes to the position-based reserve charges the dock
    // the pane's whole offset — the D3 bug. The width-based basis ignores it.
    const naive = pillReserve({ page, zoom, hostLeft: 0, hostRight: host });
    const multi = multiBasis(host, 154.4, 225.8, PILL_H);
    const single = singleBasis(host, 154.4, 225.8, PILL_H);
    expect(naive).not.toBeCloseTo(single.reserve, 3);
    expect(multi.reserve).toBeCloseTo(single.reserve, 6);
  });

  it("holds the identity across arbitrary widths and pill widths", () => {
    for (let host = 420; host <= 1100; host += 17) {
      for (const zoomW of [170, 218, 225.8]) {
        const single = singleBasis(host, 154.4, zoomW, PILL_H);
        const multi = multiBasis(host, 154.4, zoomW, PILL_H);
        expect(multi.reserve).toBeCloseTo(single.reserve, 6);
        expect(multi.free?.width).toBeCloseTo(single.free.width, 6);
        expect(multi.pillHeight).toBeCloseTo(single.pillHeight, 6);
      }
    }
  });

  it("reports single mode's stacked band height from the host width rung", () => {
    // Below the stacked rung single mode raises the zoom pill one PILL_RAISE
    // above the page pill; Multi Mode must report the SAME band height (not the
    // focused pane's own, outboard stack), so the lift magnitude matches.
    const { page, zoom } = outboardBoxes(544, 106, 170, PILL_H);
    const basis = pillBasisFromWidths({
      page,
      zoom,
      hostWidth: 544,
      stackedRaisePx: PILL_RAISE,
    });
    expect(basis.pillHeight).toBeCloseTo(PILL_H + PILL_RAISE, 6);
  });

  it("gives identical lift magnitudes at the 719/700 host widths", () => {
    for (const host of [563.3, 544]) {
      const single = singleBasis(host, 154.4, 218, PILL_H);
      const multi = multiBasis(host, 154.4, 218, PILL_H);
      expect(shouldLiftDock(dockBand(host, multi.reserve))).toBe(true);
      expect(multi.pillHeight).toBeCloseTo(single.pillHeight, 6);
    }
  });
});
