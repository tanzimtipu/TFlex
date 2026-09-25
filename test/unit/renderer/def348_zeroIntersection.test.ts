// DEF-348b/c — Multi Mode's zero-intersection layout rule.
//
// The shared Action Dock owns a reserved bottom band; both panes (and therefore
// their thumbnail strips, pills and page-action bars) and the divider stop above
// it. These two tests pin the pure geometry and the stylesheet wiring, so the
// dock can never intersect another surface in Multi Mode at any width.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  MULTI_DOCK_BAND_BASE_PX,
  bandClearsDock,
  multiDockBandPx,
} from "../../../src/renderer/components/multiPaneLayout";

const STYLES = readFileSync(
  resolve(__dirname, "../../../src/renderer/styles.css"),
  "utf8",
);

// A labelled dock row is 59.5px tall with a 12px bottom inset (the measured
// qa values); an icon-only row is shorter.
const DOCK_H = 59.5;
const DOCK_BOTTOM = 12;

describe("Multi Mode dock band geometry (DEF-348b/c)", () => {
  it("reserves a base band that clears the dock when it is not lifted", () => {
    expect(MULTI_DOCK_BAND_BASE_PX).toBeGreaterThanOrEqual(DOCK_H + DOCK_BOTTOM);
    expect(
      bandClearsDock({
        bandPx: MULTI_DOCK_BAND_BASE_PX,
        dockHeightPx: DOCK_H,
        bottomInsetPx: DOCK_BOTTOM,
        liftPx: 0,
      }),
    ).toBe(true);
  });

  it("grows with the dock's lift so a parked dock still clears the panes", () => {
    for (const lift of [0, 20, 48, 72]) {
      const band = multiDockBandPx(lift);
      expect(band).toBe(MULTI_DOCK_BAND_BASE_PX + lift);
      expect(
        bandClearsDock({
          bandPx: band,
          dockHeightPx: DOCK_H,
          bottomInsetPx: DOCK_BOTTOM,
          liftPx: lift,
        }),
      ).toBe(true);
    }
  });

  it("treats a missing/negative lift as zero", () => {
    expect(multiDockBandPx(Number.NaN)).toBe(MULTI_DOCK_BAND_BASE_PX);
    expect(multiDockBandPx(-10)).toBe(MULTI_DOCK_BAND_BASE_PX);
  });
});

describe("Multi Mode dock band stylesheet wiring (DEF-348b/c)", () => {
  const paneRule = /\.tab-stage\[data-multi-mode="true"\] \.tab-pane\[data-pane\] \{([\s\S]*?)\n\}/.exec(
    STYLES,
  )?.[1];
  const dividerRule = /\.multi-divider \{([\s\S]*?)\n\}/.exec(STYLES)?.[1];

  it("stops the panes above the reserved dock band", () => {
    expect(paneRule).toBeDefined();
    expect(paneRule).toMatch(/bottom:\s*var\(--tf-multi-dock-band/);
  });

  it("stops the divider above the reserved dock band too", () => {
    expect(dividerRule).toBeDefined();
    expect(dividerRule).toMatch(/bottom:\s*var\(--tf-multi-dock-band/);
  });
});
