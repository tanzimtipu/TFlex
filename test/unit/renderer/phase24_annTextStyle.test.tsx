// @vitest-environment jsdom
// Phase 24 — the LIVE overlay text honours the stored `AnnTextStyle`.
//
// The page canvas only paints the engine's baked FreeText /AP stream, which
// is re-baked at save time. A style change made in the text-properties panel
// must be visible immediately on the annotation the user is looking at, so
// the committed textbox / callout text node renders the stored style. These
// tests pin the mapping AND the defaults-preserving rule: an annotation with
// no stored style must render exactly as it did before Phase 24.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { AnnotationOverlay } from "../../../src/renderer/annotations/AnnotationOverlay";
import { annTextCss } from "../../../src/renderer/annotations/annTextStyle";
import type { Annotation, AnnotationToolState } from "../../../src/renderer/annotations/model";

const SELECT_TOOL: AnnotationToolState = { tool: "select", color: "blue", penWidth: 2 };

function textbox(style?: Annotation["style"]): Annotation {
  return {
    id: "tbx-24",
    kind: "textbox",
    page: 1,
    color: "blue",
    createdAt: "2026-01-01T00:00:00.000Z",
    rect: { x: 100, y: 100, width: 220, height: 90 },
    text: "STYLED",
    ...(style === undefined ? {} : { style }),
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
      createElement(AnnotationOverlay, {
        page: 1,
        widthPt: 612,
        heightPt: 792,
        cssScale: 1,
        annotations: [ann],
        tool: SELECT_TOOL,
        flashId: null,
        getTextItems: (): never[] => [],
        onCreate: (): void => undefined,
      }),
    );
  });
  return {
    host,
    cleanup: (): void => {
      act((): void => root.unmount());
      host.remove();
    },
  };
}

describe("annTextCss — stored style -> live CSS", () => {
  it("maps every CSS-representable field and leaves the rest undefined", () => {
    const css = annTextCss({
      font: "Times",
      size: 18,
      bold: true,
      italic: true,
      underline: true,
      align: "center",
      lineHeight: 1.5,
      highlight: { r: 1, g: 1, b: 0 },
      indent: 24,
    });
    expect(css).toEqual({
      fontFamily: 'Times, "Times New Roman", serif',
      sizePt: 18,
      fontWeight: 700,
      fontStyle: "italic",
      textDecoration: "underline",
      textAlign: "center",
      lineHeight: 1.5,
      highlight: "#ffff00",
      indentPt: 24,
    });
  });

  it("carries nothing for an absent style (the pre-Phase-24 defaults hold)", () => {
    expect(annTextCss(undefined)).toEqual({});
    expect(annTextCss({})).toEqual({});
  });

  it("does not express list / baselineShift (baked-only in the /AP stream)", () => {
    const css = annTextCss({ list: "bullet", baselineShift: 6, indent: 0 });
    expect(Object.prototype.hasOwnProperty.call(css, "list")).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(css, "baselineShiftPt")).toBe(false);
    // indent 0 is a no-op too — it must not add a padding override.
    expect(css.indentPt).toBeUndefined();
  });
});

describe("committed textbox — live style application", () => {
  it("renders the stored font / size / bold / italic / underline / align", () => {
    const { host, cleanup } = mount(
      textbox({
        font: "Times",
        size: 18,
        bold: true,
        italic: true,
        underline: true,
        align: "center",
      }),
    );
    const box = host.querySelector<HTMLElement>(".ann-textbox");
    expect(box).not.toBeNull();
    const inline = box?.style ?? ({} as CSSStyleDeclaration);
    expect(inline.fontFamily).toContain("Times");
    expect(Number.parseFloat(inline.fontSize)).toBe(18);
    expect(inline.fontWeight).toBe("700");
    expect(inline.fontStyle).toBe("italic");
    expect(inline.textDecoration).toBe("underline");
    expect(inline.textAlign).toBe("center");
    // The text is still present and readable.
    expect(box?.textContent).toBe("STYLED");
    cleanup();
  });

  it("applies the stored highlight to the text span, not the box tint", () => {
    const { host, cleanup } = mount(textbox({ highlight: { r: 1, g: 1, b: 0 } }));
    const span = host.querySelector<HTMLElement>(".ann-text-content");
    expect(span).not.toBeNull();
    expect(span?.style.background).toBe("rgb(255, 255, 0)");
    cleanup();
  });

  it("an unstyled annotation keeps the pre-Phase-24 rendering", () => {
    const { host, cleanup } = mount(textbox());
    const box = host.querySelector<HTMLElement>(".ann-textbox");
    const inline = box?.style ?? ({} as CSSStyleDeclaration);
    // No inline font-family / weight / align: the stylesheet's defaults rule.
    expect(inline.fontFamily).toBe("");
    expect(inline.fontWeight).toBe("");
    expect(inline.textAlign).toBe("");
    // The auto-fit keeps the historic 12pt ceiling.
    expect(Number.parseFloat(inline.fontSize)).toBe(12);
    expect(inline.lineHeight).toBe("1.35");
    cleanup();
  });

  it("a bigger stored size raises the live text size (fit still caps it)", () => {
    const { host, cleanup } = mount(textbox({ size: 20 }));
    const box = host.querySelector<HTMLElement>(".ann-textbox");
    const size = Number.parseFloat((box?.style ?? ({} as CSSStyleDeclaration)).fontSize);
    expect(size).toBeGreaterThan(12);
    expect(size).toBeLessThanOrEqual(20);
    cleanup();
  });
});
