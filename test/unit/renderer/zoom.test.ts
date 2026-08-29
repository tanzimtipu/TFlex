// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STEPS,
  accumulateWheel,
  clampZoom,
  stepTowards,
  zoomReducer,
} from "../../../src/renderer/state/zoom";

describe("zoom reducer", () => {
  it("set-manual-scale clamps and switches to manual mode", () => {
    const s = zoomReducer(
      { mode: "fit-width", manualScale: 1 },
      { type: "set-manual-scale", scale: 0.1 }, // below min
    );
    expect(s.mode).toBe("manual");
    expect(s.manualScale).toBe(MIN_ZOOM);
  });

  it("set-manual-scale clamps to max", () => {
    const s = zoomReducer(
      { mode: "manual", manualScale: 1 },
      { type: "set-manual-scale", scale: 99 },
    );
    expect(s.manualScale).toBe(MAX_ZOOM);
  });

  it("set-mode preserves manualScale", () => {
    const before = { mode: "manual" as const, manualScale: 1.25 };
    const after = zoomReducer(before, { type: "set-mode", mode: "fit-width" });
    expect(after.mode).toBe("fit-width");
    expect(after.manualScale).toBe(1.25);
  });
});

describe("clampZoom", () => {
  it("clamps inside the ladder", () => {
    expect(clampZoom(0.5)).toBe(0.5);
    expect(clampZoom(-1)).toBe(MIN_ZOOM);
    expect(clampZoom(99)).toBe(MAX_ZOOM);
  });
});

describe("stepTowards", () => {
  it("moves up to the next ladder step", () => {
    expect(stepTowards(1, 1)).toBe(ZOOM_STEPS[ZOOM_STEPS.indexOf(1) + 1]);
  });

  it("moves down to the previous ladder step", () => {
    expect(stepTowards(1.25, -1)).toBe(ZOOM_STEPS[ZOOM_STEPS.indexOf(1.25) - 1]);
  });

  it("clamps at extremes", () => {
    expect(stepTowards(MAX_ZOOM, 1)).toBe(MAX_ZOOM);
    expect(stepTowards(MIN_ZOOM, -1)).toBe(MIN_ZOOM);
  });

  it("snaps a fractional fit-derived scale to the nearest ladder step up", () => {
    // 1.43 is between 1.25 and 1.5; stepping up lands on 1.5.
    expect(stepTowards(1.43, 1)).toBe(1.5);
    // 1.43 stepping down lands on 1.25.
    expect(stepTowards(1.43, -1)).toBe(1.25);
  });
});

describe("wheel accumulator", () => {
  // The contract: deltaY>0 (down) zooms OUT (negative steps),
  // deltaY<0 (up) zooms IN (positive steps). Remainder accumulates across
  // calls so a single full detent (-/+120) emits exactly one step.
  it("returns remainder without consuming a step until a full detent is reached", () => {
    const r = accumulateWheel(0, 60); // half a detent down
    expect(r.steps).toBe(0);
    // The function negates deltaY when accumulating, so remainder becomes -60.
    expect(r.remainder).toBe(-60);
  });

  it("consumes full detents into signed steps (negative deltaY -> positive steps)", () => {
    expect(accumulateWheel(0, -120).steps).toBe(1);
    expect(accumulateWheel(0, 240).steps).toBe(-2);
  });

  it("handles remainder accumulated across calls", () => {
    const a = accumulateWheel(0, -60); // half a detent up
    const b = accumulateWheel(a.remainder, -60); // second half -> one full step
    expect(a.steps).toBe(0);
    expect(b.steps).toBe(1);
    expect(Math.abs(b.remainder)).toBeLessThan(120);
  });
});