// @vitest-environment jsdom
//
// DEF-163 (updated for DEF-262) — committed textbox / callout text must not
// paint outside its box. DEF-163 originally SHRANK the font so the wrapped
// lines fit the fixed one-line creation rect; DEF-262 replaced that with the
// Adobe-style auto-GROW (the shrink collapsed multi-line text to the 4pt
// floor and made the Size control a no-op). The box now grows its height to
// the wrapped block at the requested size, and only the page-bound / cap
// fallback still shrinks. These tests pin the new rule:
//   - a too-long callout / textbox grows to the wrapped block and keeps the
//     requested font size (no 4pt collapse);
//   - short text keeps the stored height and the default size;
//   - `overflow: hidden` stays as the guard on the clamped fallback.
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { AnnotationOverlay } from "../../../src/renderer/annotations/AnnotationOverlay";
import { grownAnnTextRect, layoutAnnTextBox } from "../../../src/renderer/annotations/annTextLayout";
import type { Annotation, AnnotationToolState } from "../../../src/renderer/annotations/model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no canvas 2D backend: measureTextWidthCss falls back to
// the deterministic ~0.55em/char estimate, making the wrapped line
// counts and grown heights exact in tests.
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

describe("DEF-262 — layoutAnnTextBox (committed text-box / callout auto-grow)", () => {
  it("wraps the repro text and GROWS the box to the block at the requested size", () => {
    // "VERIFY CALLOUT 1725" wraps to 3 lines in a 90-wide callout
    // (content 77 = 90 - 2*(5 padding + 1.5 border)).
    const layout = layoutAnnTextBox({
      text: "VERIFY CALLOUT 1725",
      style: undefined,
      boxWidthPt: 90,
      boxHeightPt: 40,
      insetPt: 5 + 1.5,
      maxHeightPt: 600,
      measure: width,
    });
    expect(layout.lines).toHaveLength(3);
    // No shrink: the requested 12pt survives because the box grows.
    expect(layout.fontSizePt).toBe(12);
    expect(layout.heightPt).toBeCloseTo(3 * 12 * 1.35 + 13, 5);
    expect(layout.heightPt).toBeGreaterThan(40);
  });

  it("clamps to the page bound and only then shrinks to fit (4pt floor)", () => {
    const layout = layoutAnnTextBox({
      text: "VERIFY CALLOUT 1725",
      style: undefined,
      boxWidthPt: 90,
      boxHeightPt: 26.2,
      insetPt: 5 + 1.5,
      // The tiny create-flow box cannot grow past 26.2 here.
      maxHeightPt: 26.2,
      measure: width,
    });
    // 3 lines in a 13.2pt content height: below the 4pt floor, so it holds.
    expect(layout.fontSizePt).toBe(4);
    expect(layout.heightPt).toBe(26.2);
  });

  it("keeps the stored height and the user font when the text already fits", () => {
    const layout = layoutAnnTextBox({
      text: "SWATCH CO",
      style: undefined,
      boxWidthPt: 120,
      boxHeightPt: 40,
      insetPt: 5 + 1.5,
      maxHeightPt: 600,
      measure: width,
    });
    expect(layout.fontSizePt).toBe(12);
    expect(layout.heightPt).toBe(40);
    expect(layout.lines).toHaveLength(1);
  });

  it("grownAnnTextRect returns the grown rect (or null when it already fits)", () => {
    const grown = grownAnnTextRect({
      kind: "textbox",
      rect: { x: 100, y: 100, width: 90, height: 40 },
      text: "VERIFY CALLOUT 1725",
      style: undefined,
      maxHeightPt: 600,
      measure: width,
    });
    expect(grown?.height).toBeCloseTo(3 * 12 * 1.35 + 12, 5);
    expect(
      grownAnnTextRect({
        kind: "textbox",
        rect: { x: 100, y: 100, width: 120, height: 40 },
        text: "SWATCH CO",
        style: undefined,
        maxHeightPt: 600,
        measure: width,
      }),
    ).toBeNull();
  });
});

describe("DEF-262 — committed callout / textbox grow instead of collapsing", () => {
  it("a long callout grows to the wrapped block at the requested size", () => {
    const { host, cleanup } = mount(calloutAnn({ x: 100, y: 100, width: 90, height: 40 }, "VERIFY CALLOUT 1725"));
    try {
      const box = host.querySelector<HTMLElement>(".ann-callout[data-annotation-id='callout-1']");
      if (box === null) throw new Error("callout box not found");
      // No 4pt collapse: the requested 12pt renders and the box grew.
      expect(Number.parseFloat(box.style.fontSize)).toBe(12);
      expect(box.style.height).toBe("61.6px");
      expect(host.querySelectorAll("[data-ann-text-line]")).toHaveLength(3);
      // The page-spill guard is still there for the clamped fallback.
      expect(box.style.overflow).toBe("hidden");
    } finally {
      cleanup();
    }
  });

  it("a short callout keeps the stored height and the default 12px font", () => {
    const { host, cleanup } = mount(calloutAnn({ x: 100, y: 100, width: 120, height: 40 }, "SWATCH CO"));
    try {
      const box = host.querySelector<HTMLElement>(".ann-callout[data-annotation-id='callout-1']");
      if (box === null) throw new Error("callout box not found");
      expect(Number.parseFloat(box.style.fontSize)).toBe(12);
      expect(box.style.height).toBe("40px");
      expect(box.style.overflow).toBe("hidden");
    } finally {
      cleanup();
    }
  });

  it("a long committed textbox grows the same way", () => {
    const { host, cleanup } = mount(textboxAnn({ x: 100, y: 100, width: 90, height: 40 }, "VERIFY CALLOUT 1725"));
    try {
      const box = host.querySelector<HTMLElement>(".ann-textbox[data-annotation-id='tbx-1']");
      if (box === null) throw new Error("textbox not found");
      expect(Number.parseFloat(box.style.fontSize)).toBe(12);
      // Textbox chrome: 5px padding + 1px border per side (12pt total).
      expect(box.style.height).toBe("60.6px");
    } finally {
      cleanup();
    }
  });
});
