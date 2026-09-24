import { describe, expect, it } from "vitest";
import {
  buildPrintSettings,
  clampCopies,
  clampScalePercent,
  defaultPrintSettings,
  isCancelReason,
  type PrintDialogState,
} from "../../../src/renderer/pdf/printSettings";

/**
 * Phase 30 — dialog state -> PrintSettings mapping. Pins the fields the
 * main-process print service consumes, the collate/copies and scaling
 * rules, the auto-orientation resolution, and the absence of an
 * unmappable `paperSource` (Electron has no tray option).
 */

function state(overrides: Partial<PrintDialogState> = {}): PrintDialogState {
  return {
    deviceName: "HP LaserJet",
    copies: 1,
    collate: false,
    scaling: "fit",
    scalePercent: 100,
    orientation: "portrait",
    autoLandscape: false,
    duplex: "simplex",
    color: true,
    pagesPerSheet: 1,
    pageOrder: "horizontal",
    oddEven: "all",
    reverse: false,
    printAnnotations: true,
    ...overrides,
  };
}

describe("printSettings — buildPrintSettings", () => {
  it("maps the baseline state onto the contract", () => {
    const settings = buildPrintSettings(state());
    expect(settings).toEqual({
      deviceName: "HP LaserJet",
      copies: 1,
      collate: false,
      scaling: "fit",
      landscape: false,
      duplex: "simplex",
      color: true,
      pagesPerSheet: 1,
      pageOrder: "horizontal",
      oddEven: "all",
      reverse: false,
      printAnnotations: true,
    });
  });

  it("never emits paperSource (Electron has no tray option)", () => {
    const settings = buildPrintSettings(state());
    expect(Object.prototype.hasOwnProperty.call(settings, "paperSource")).toBe(false);
  });

  it("forces collate off when copies is 1", () => {
    const settings = buildPrintSettings(state({ copies: 1, collate: true }));
    expect(settings.collate).toBe(false);
  });

  it("keeps collate when copies is greater than 1", () => {
    const settings = buildPrintSettings(state({ copies: 3, collate: true }));
    expect(settings.collate).toBe(true);
    expect(settings.copies).toBe(3);
  });

  it("emits scalePercent only for custom scaling", () => {
    expect(buildPrintSettings(state({ scaling: "actual" })).scalePercent).toBeUndefined();
    const custom = buildPrintSettings(state({ scaling: "custom", scalePercent: 250 }));
    expect(custom.scalePercent).toBe(250);
  });

  it("maps orientation, resolving auto from the preview aspect", () => {
    expect(buildPrintSettings(state({ orientation: "portrait" })).landscape).toBe(false);
    expect(buildPrintSettings(state({ orientation: "landscape" })).landscape).toBe(true);
    expect(
      buildPrintSettings(state({ orientation: "auto", autoLandscape: true })).landscape,
    ).toBe(true);
    expect(
      buildPrintSettings(state({ orientation: "auto", autoLandscape: false })).landscape,
    ).toBe(false);
  });

  it("carries the annotations toggle", () => {
    expect(buildPrintSettings(state({ printAnnotations: false })).printAnnotations).toBe(false);
  });

  it("carries N-up, page order, odd/even, reverse, duplex and colour", () => {
    const settings = buildPrintSettings(
      state({
        pagesPerSheet: 4,
        pageOrder: "verticalReversed",
        oddEven: "odd",
        reverse: true,
        duplex: "longEdge",
        color: false,
      }),
    );
    expect(settings.pagesPerSheet).toBe(4);
    expect(settings.pageOrder).toBe("verticalReversed");
    expect(settings.oddEven).toBe("odd");
    expect(settings.reverse).toBe(true);
    expect(settings.duplex).toBe("longEdge");
    expect(settings.color).toBe(false);
  });

  it("omits deviceName when none is selected", () => {
    expect(buildPrintSettings(state({ deviceName: null })).deviceName).toBeUndefined();
  });
});

describe("printSettings — clamps and cancel detection", () => {
  it("clamps copies to 1..99", () => {
    expect(clampCopies(0)).toBe(1);
    expect(clampCopies(1000)).toBe(99);
    expect(clampCopies(3.9)).toBe(3);
    expect(clampCopies(Number.NaN)).toBe(1);
  });

  it("clamps scale percent to 1..500", () => {
    expect(clampScalePercent(0)).toBe(1);
    expect(clampScalePercent(900)).toBe(500);
    expect(clampScalePercent(Number.NaN)).toBe(100);
  });

  it("treats a cancel reason as user cancellation, not an error", () => {
    expect(isCancelReason("Print job canceled")).toBe(true);
    expect(isCancelReason("cancelled by user")).toBe(true);
    expect(isCancelReason("The printer is offline")).toBe(false);
  });
});

describe("printSettings — defaultPrintSettings (Phase 37 item 17)", () => {
  it("is the default dialog state mapped onto the contract", () => {
    const settings = buildPrintSettings(state({
      deviceName: null,
      orientation: "auto",
      autoLandscape: false,
    }));
    expect(defaultPrintSettings()).toEqual(settings);
  });

  it("round-trips through seedPrintDialogState to the control defaults", () => {
    const settings = defaultPrintSettings();
    expect(settings.copies).toBe(1);
    expect(settings.scaling).toBe("fit");
    expect(settings.duplex).toBe("simplex");
    expect(settings.color).toBe(true);
    expect(settings.pagesPerSheet).toBe(1);
    expect(settings.oddEven).toBe("all");
    expect(settings.reverse).toBe(false);
    expect(settings.printAnnotations).toBe(true);
    expect(settings.landscape).toBe(false);
    expect(settings.deviceName).toBeUndefined();
  });
});