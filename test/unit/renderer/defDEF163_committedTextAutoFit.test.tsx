// @vitest-environment jsdom
//
// DEF-163 — committed callout (and textbox) text must stay INSIDE the
// fixed-height box: the committed div keeps the creation rect (engine
// geometry), so long wrapped text used to overflow the box and paint
// over the page content below it. The fix auto-fits the text to the
// box (the add-box auto-fit: wrap at the content width, shrink the
// font so every line fits the content height — DEF-113/DEF-146) and
// clips the box so nothing ever renders outside it.
//
// Coverage:
//   - pure fitAnnotationTextSizePx math (no DOM): the repro wraps +
//     shrinks so wrapped lines fit the content box, the 4px floor wins
//     in tiny boxes, short text keeps its font, the content box
//     removes the border + padding on both sides.
//   - component render: a committed callout div whose text would
//     overflow renders with a SHRUNK inline font-size (< the 12pt
//     default) and overflow hidden; a short-text callout keeps the
//     full font size.
//   - the committed textbox path behaves the same (DEF-163 names
//     callout/textbox committed text).
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import {
  AnnotationOverlay,
  fitAnnotationTextSizePx,
} from "../../../src/renderer/annotations/AnnotationOverlay";
import type { Annotation, AnnotationToolState } from "../../../src/renderer/annotations/model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no canvas 2D backend: measureTextWidthCss falls back to
// the deterministic ~0.55em/char estimate, making the fitted sizes
// exact in tests.
const width = (t: string, s: number): number => t.length * s * 0.55;

const SELECT_TOOL: AnnotationToolState = { tool: "select", color: "blue", penWidth: 2 };

function calloutAnn(rect: { x: number; y: number; width: number; height: number }, text: string): Annotation {
  return {
    id: "callout-1",
    kind: "callout",
    page: 1,
    color: "blue",
    createdAt: "2026-01-01T00:00:00.000Z",
    rect,
    at: { x: 30, y: 30 },
    text,
  };
}

function textboxAnn(rect: { x: number; y: number; width: number; height: number }, text: string): Annotation {
  return {
    id: "tbx-1",
    kind: "textbox",
    page: 1,
    color: "blue",
    createdAt: "2026-01-01T00:00:00.000Z",
    rect,
    text,
  };
}

function mount(ann: Annotation): { host: HTMLElement; cleanup: () => void } {
  const host = document.createElement("div");
  host.style.position = "absolute";
  host.style.width = "800px";
  host.style.height = "600px";
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(
      <AnnotationOverlay
        page={1}
        widthPt={612}
        heightPt={792}
        cssScale={1}
        annotations={[ann]}
        tool={SELECT_TOOL}
        flashId={null}
        getTextItems={(): never[] => []}
        onCreate={(): void => undefined}
        onFinishedOneShot={undefined}
      />,
    );
  });
  return {
    host,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

describe("DEF-163 — fitAnnotationTextSizePx (committed text-box / callout auto-fit)", () => {
  it("wraps the repro text and shrinks the font so every line fits the callout box content height", () => {
    // "VERIFY CALLOUT 1725" wraps to 3 lines in a 90-wide callout
    // (content 77 = 90 - 2*(5px padding + 1.5px border)).
    const fitted = fitAnnotationTextSizePx({
      text: "VERIFY CALLOUT 1725",
      userSizePx: 12,
      boxWidthPx: 90,
      boxHeightPx: 40,
      lineHeight: 1.35,
      sideInsetPx: 5 + 1.5,
      measure: width,
    });
    // 3 lines at s*1.35 must fit the content height 40-13=27:
    // s = 27/(3*1.35) = 6.67 < 12 and >= the 4px floor.
    expect(fitted).toBeCloseTo(27 / (3 * 1.35), 5);
    expect(fitted).toBeLessThan(12);
    expect(fitted).toBeGreaterThanOrEqual(4);
    expect(fitted * 1.35 * 3).toBeLessThanOrEqual(40 - 2 * (5 + 1.5) + 1e-6);
  });

  it("3 wrapped lines cannot fit the tiny create-flow box, so the 4px floor wins", () => {
    // The DEF-163 creation rect is 90 x 26.2 pt (the callout box is
    // fixed at drag-release). Content height = 26.2 - 13 = 13.2; three
    // wrapped lines need 3*s*1.35 <= 13.2 -> s <= 3.26, below the 4px
    // floor. The floor holds and the box's overflow guard clips the
    // residual (nothing paints over the page).
    const fitted = fitAnnotationTextSizePx({
      text: "VERIFY CALLOUT 1725",
      userSizePx: 12,
      boxWidthPx: 90,
      boxHeightPx: 26.2,
      lineHeight: 1.35,
      sideInsetPx: 5 + 1.5,
      measure: width,
    });
    expect(fitted).toBe(4);
  });

  it("keeps the user font when the text already fits (auto-fit never enlarges)", () => {
    const fitted = fitAnnotationTextSizePx({
      text: "SWATCH CO",
      userSizePx: 12,
      boxWidthPx: 120,
      boxHeightPx: 40,
      lineHeight: 1.35,
      sideInsetPx: 5 + 1.5,
      measure: width,
    });
    expect(fitted).toBe(12);
  });

  it("textbox chrome (1px border + 5px padding, doubled) is subtracted before fitting", () => {
    // Content = 60-12 = 48 wide, 30-12 = 18 tall. "ARTIFACT CHECK 88"
    // wraps to 3 lines; s = 18/(3*1.35) = 4.44, above the floor.
    const fitted = fitAnnotationTextSizePx({
      text: "ARTIFACT CHECK 88",
      userSizePx: 12,
      boxWidthPx: 60,
      boxHeightPx: 30,
      lineHeight: 1.35,
      sideInsetPx: 5 + 1,
      measure: width,
    });
    expect(fitted).toBeCloseTo(18 / (3 * 1.35), 5);
    expect(fitted).toBeLessThan(12);
    expect(fitted * 1.35 * 3).toBeLessThanOrEqual(30 - 2 * (5 + 1) + 1e-6);
  });

  it("empty text keeps the default font (nothing to fit)", () => {
    const fitted = fitAnnotationTextSizePx({
      text: "",
      userSizePx: 12,
      boxWidthPx: 90,
      boxHeightPx: 26.2,
      lineHeight: 1.35,
      sideInsetPx: 5 + 1.5,
      measure: width,
    });
    expect(fitted).toBe(12);
  });
});

describe("DEF-163 — committed callout / textbox render with the fitted font", () => {
  it("a too-long callout text renders SHRUNK and clipped (no page spill)", () => {
    const { host, cleanup } = mount(calloutAnn({ x: 100, y: 100, width: 90, height: 40 }, "VERIFY CALLOUT 1725"));
    try {
      const box = host.querySelector<HTMLElement>(".ann-callout[data-annotation-id='callout-1']");
      if (box === null) throw new Error("callout box not found");
      const fontSize = Number.parseFloat(box.style.fontSize);
      expect(Number.isFinite(fontSize) && fontSize > 0).toBe(true);
      // Unshrunk committed callouts rendered at TEXTBOX_FONT_PT=12.
      expect(fontSize).toBeLessThan(12);
      // The fitted text occupies the content box (chrome removed).
      expect(fontSize * 1.35 * 3).toBeLessThanOrEqual(40 - 2 * (5 + 1.5) + 1e-6);
      // DEF-163 core: nothing may paint outside the box, and the box
      // keeps its fixed creation size (the engine geometry is
      // untouched by the visual fit).
      expect(box.style.overflow).toBe("hidden");
      expect(box.style.height).toBe("40px");
      expect(box.style.width).toBe("90px");
    } finally {
      cleanup();
    }
  });

  it("a short callout text keeps the default 12px font (no shrink, no enlarge)", () => {
    const { host, cleanup } = mount(calloutAnn({ x: 100, y: 100, width: 120, height: 40 }, "SWATCH CO"));
    try {
      const box = host.querySelector<HTMLElement>(".ann-callout[data-annotation-id='callout-1']");
      if (box === null) throw new Error("callout box not found");
      expect(Number.parseFloat(box.style.fontSize)).toBe(12);
      expect(box.style.overflow).toBe("hidden");
    } finally {
      cleanup();
    }
  });

  it("a too-long committed textbox text auto-fits the same way", () => {
    const { host, cleanup } = mount(textboxAnn({ x: 100, y: 100, width: 90, height: 40 }, "VERIFY CALLOUT 1725"));
    try {
      const box = host.querySelector<HTMLElement>(".ann-textbox[data-annotation-id='tbx-1']");
      if (box === null) throw new Error("textbox not found");
      const fontSize = Number.parseFloat(box.style.fontSize);
      expect(Number.isFinite(fontSize) && fontSize > 0).toBe(true);
      expect(fontSize).toBeLessThan(12);
      // Textbox chrome: 5px padding + 1px border per side.
      expect(fontSize * 1.35 * 3).toBeLessThanOrEqual(40 - 2 * (5 + 1) + 1e-6);
      expect(box.style.height).toBe("40px");
    } finally {
      cleanup();
    }
  });
});