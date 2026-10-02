import { describe, expect, it } from "vitest";
import {
  buildPrintSettings,
  clampBookletCreepPt,
  clampBookletGutterPt,
  clampCopies,
  clampPosterGrid,
  clampPosterOverlapPt,
  clampPosterScalePercent,
  clampScalePercent,
  defaultPrintSettings,
  isCancelReason,
  posterTileCanvasBox,
  posterTileRects,
  seedPrintDialogState,
  type PrintDialogState,
} from "../../../src/renderer/pdf/printSettings";

/**
 * Phase 30 — dialog state -> PrintSettings mapping. Pins the fields the
 * main-process print service consumes, the collate/copies and scaling
 * rules, the auto-orientation resolution, and the absence of an
 * unmappable `paperSource` (Electron has no tray option).
 *
 * Phase 83 — the optional imposition keys: the 'single' path stays
 * byte-identical, booklet forces 2-up landscape, poster forces 1-up, and the
 * new clamps hold their bounds.
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
    layoutMode: "single",
    bookletGutterPt: 0,
    bookletCreepPt: 0,
    bookletSubset: "both",
    posterRows: 2,
    posterCols: 2,
    posterOverlapPt: 0,
    posterScalePercent: 100,
    posterCutMarks: false,
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

describe("printSettings — Phase 83 imposition mapping", () => {
  it("keeps the single path byte-identical (no imposed keys emitted)", () => {
    const settings = buildPrintSettings(state({ layoutMode: "single" }));
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
    expect(Object.prototype.hasOwnProperty.call(settings, "layoutMode")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(settings, "posterRows")).toBe(false);
  });

  it("forces booklet to 2-up landscape and carries all nine keys", () => {
    const settings = buildPrintSettings(
      state({
        layoutMode: "booklet",
        bookletGutterPt: 10,
        bookletCreepPt: 6,
        bookletSubset: "front",
        posterRows: 3,
        posterCols: 4,
        posterOverlapPt: 5,
        posterScalePercent: 150,
        posterCutMarks: true,
      }),
    );
    expect(settings.layoutMode).toBe("booklet");
    expect(settings.pagesPerSheet).toBe(2);
    expect(settings.landscape).toBe(true);
    expect(settings.bookletGutterPt).toBe(10);
    expect(settings.bookletCreepPt).toBe(6);
    expect(settings.bookletSubset).toBe("front");
    expect(settings.posterRows).toBe(3);
    expect(settings.posterCols).toBe(4);
    expect(settings.posterOverlapPt).toBe(5);
    expect(settings.posterScalePercent).toBe(150);
    expect(settings.posterCutMarks).toBe(true);
  });

  it("forces poster to 1-up", () => {
    const settings = buildPrintSettings(state({ layoutMode: "poster", pagesPerSheet: 4 }));
    expect(settings.layoutMode).toBe("poster");
    expect(settings.pagesPerSheet).toBe(1);
  });

  it("round-trips the nine keys through seedPrintDialogState", () => {
    const seeded = seedPrintDialogState({
      layoutMode: "booklet",
      bookletGutterPt: 12,
      bookletCreepPt: 9,
      bookletSubset: "back",
      posterRows: 4,
      posterCols: 5,
      posterOverlapPt: 7,
      posterScalePercent: 250,
      posterCutMarks: true,
    });
    expect(seeded.layoutMode).toBe("booklet");
    expect(seeded.bookletGutterPt).toBe(12);
    expect(seeded.bookletCreepPt).toBe(9);
    expect(seeded.bookletSubset).toBe("back");
    expect(seeded.posterRows).toBe(4);
    expect(seeded.posterCols).toBe(5);
    expect(seeded.posterOverlapPt).toBe(7);
    expect(seeded.posterScalePercent).toBe(250);
    expect(seeded.posterCutMarks).toBe(true);
  });

  it("seeds the defaults when the imposed keys are omitted", () => {
    const seeded = seedPrintDialogState({});
    expect(seeded.layoutMode).toBe("single");
    expect(seeded.bookletGutterPt).toBe(0);
    expect(seeded.bookletCreepPt).toBe(0);
    expect(seeded.bookletSubset).toBe("both");
    expect(seeded.posterRows).toBe(2);
    expect(seeded.posterCols).toBe(2);
    expect(seeded.posterOverlapPt).toBe(0);
    expect(seeded.posterScalePercent).toBe(100);
    expect(seeded.posterCutMarks).toBe(false);
  });

  it("clamps the new options at their bounds", () => {
    expect(clampBookletGutterPt(-1)).toBe(0);
    expect(clampBookletGutterPt(100)).toBe(72);
    expect(clampBookletCreepPt(-1)).toBe(0);
    expect(clampBookletCreepPt(99)).toBe(36);
    expect(clampPosterGrid(0)).toBe(1);
    expect(clampPosterGrid(11)).toBe(10);
    expect(clampPosterGrid(2.9)).toBe(2);
    expect(clampPosterOverlapPt(-1)).toBe(0);
    expect(clampPosterOverlapPt(100)).toBe(72);
    expect(clampPosterScalePercent(9)).toBe(10);
    expect(clampPosterScalePercent(900)).toBe(500);
    expect(clampPosterScalePercent(Number.NaN)).toBe(100);
    expect(clampPosterGrid(Number.NaN)).toBe(2);
  });
});

describe("printSettings — DEF-483 poster scale magnifies the tile derivation", () => {
  it("divides the sampled page region by S and enlarges the crop box by S", () => {
    const unit = posterTileRects(1, 2, 2, 0);
    const five = posterTileRects(5, 2, 2, 0);

    // 2x2 with no overlap: each S=1 tile samples half the page.
    expect(unit).toHaveLength(4);
    expect(unit[0].sourceW).toBeCloseTo(0.5, 6);
    expect(unit[0].sourceH).toBeCloseTo(0.5, 6);
    expect(unit[1].sourceX).toBeCloseTo(0.5, 6);

    // At S=5 the sampled region is the grid rect divided by 5, so the two
    // columns cover 1/5 of the page width and the two rows 1/5 of the height.
    expect(five[0].sourceW).toBeCloseTo(0.1, 6);
    expect(five[0].sourceH).toBeCloseTo(0.1, 6);
    expect(five[1].sourceX).toBeCloseTo(0.1, 6);
    const rowOne = five.filter((t) => t.row === 0);
    const colOne = five.filter((t) => t.col === 0);
    expect(rowOne.length * five[0].sourceW).toBeCloseTo(0.2, 6);
    expect(colOne.length * five[0].sourceH).toBeCloseTo(0.2, 6);

    // The source rects for S=1 and S=5 differ.
    expect(five[0].sourceW).not.toBeCloseTo(unit[0].sourceW, 6);

    // The raster sample shrinks with S while the crop output grows with S.
    const widthPx = 2000;
    const heightPx = 1000;
    const box1 = posterTileCanvasBox(unit[0], widthPx, heightPx, 1);
    const box5 = posterTileCanvasBox(five[0], widthPx, heightPx, 5);
    expect(box5.sw).toBeLessThan(box1.sw);
    expect(box5.sh).toBeLessThan(box1.sh);
    expect(box5.dw).toBeGreaterThan(box1.dw);
    expect(box5.dh).toBeGreaterThan(box1.dh);
    expect(box5.dw).toBeCloseTo(box1.dw * 5, 0);

    // S=1 is byte-identical to the pre-fix crop: sample and target coincide.
    expect(box1.dw).toBe(box1.sw);
    expect(box1.dh).toBe(box1.sh);
  });
});

describe("printSettings — DEF-485 imposed modes force horizontal page order", () => {
  it("emits horizontal for booklet regardless of the state's pageOrder", () => {
    const settings = buildPrintSettings(
      state({ layoutMode: "booklet", pageOrder: "verticalReversed" }),
    );
    expect(settings.pageOrder).toBe("horizontal");
  });

  it("emits horizontal for poster regardless of the state's pageOrder", () => {
    const settings = buildPrintSettings(
      state({ layoutMode: "poster", pageOrder: "horizontalReversed" }),
    );
    expect(settings.pageOrder).toBe("horizontal");
  });

  it("keeps the state's pageOrder on the single path", () => {
    const settings = buildPrintSettings(state({ layoutMode: "single", pageOrder: "vertical" }));
    expect(settings.pageOrder).toBe("vertical");
  });

  it("seeds horizontal for a booklet preset carrying a stale order", () => {
    const seeded = seedPrintDialogState({ layoutMode: "booklet", pageOrder: "verticalReversed" });
    expect(seeded.pageOrder).toBe("horizontal");
  });

  it("seeds horizontal for a poster preset carrying a stale order", () => {
    const seeded = seedPrintDialogState({ layoutMode: "poster", pageOrder: "verticalReversed" });
    expect(seeded.pageOrder).toBe("horizontal");
  });

  it("preserves the stored pageOrder on the single path", () => {
    const seeded = seedPrintDialogState({ layoutMode: "single", pageOrder: "vertical" });
    expect(seeded.pageOrder).toBe("vertical");
  });
});
