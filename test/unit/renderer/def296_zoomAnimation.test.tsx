// @vitest-environment jsdom
//
// DEF-296 — page zoom had no animation: the page width jumped
// (1210 -> 1224) and every document surface computed transition-duration 0s.
//
// The fix is a one-shot transform-only FLIP on the `.pdf-page` wrapper: the
// slot re-lays-out at the NEW size (no width/height transition, so no layout
// thrashing), then the wrapper plays `tf-page-zoom-flip` from the previous
// step's ratio back to 1. The rotation turn (DEF-274) is on the INNER
// `.pdf-page-canvas`, so the two transforms compose as parent x child.
//
// These tests pin the pure helper, the CSS contract + its motion-token
// wiring, and the class/var the component applies — and that the instant
// path (reduced motion) applies NOTHING. Real smoothness is qa's e2e.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import { PageView } from "../../../src/renderer/components/PageView";
import {
  ZOOM_FLIP_ANIMATION,
  ZOOM_FLIP_CLASS,
  ZOOM_FLIP_FROM_VAR,
  zoomFlipFromScale,
} from "../../../src/renderer/components/zoomFlip";
import { initialAnnotationToolState } from "../../../src/renderer/annotations/model";

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");

function stripCssComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "");
}

function findRuleBody(s: string, selector: string): string | null {
  const stripped = stripCssComments(s);
  const idx = stripped.indexOf(selector);
  if (idx === -1) return null;
  const braceOpen = stripped.indexOf("{", idx);
  if (braceOpen === -1) return null;
  let depth = 0;
  for (let i = braceOpen; i < stripped.length; i += 1) {
    const ch = stripped[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return stripped.slice(braceOpen + 1, i);
    }
  }
  return null;
}

describe("DEF-296 — the zoom FLIP is a transform-only scale of the page wrapper", () => {
  const css = readFileSync(STYLES_PATH, "utf8");

  it("defines the one-shot zoom-flip animation on motion tokens", () => {
    const body = findRuleBody(css, ".pdf-page-zoom-flip {");
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(
      new RegExp(`${ZOOM_FLIP_ANIMATION} var\\(--motion-duration-standard\\) var\\(--motion-ease-standard\\)`),
    );
  });

  it("the keyframe scales from the previous ratio to 1 (no layout property)", () => {
    const body = findRuleBody(css, "@keyframes tf-page-zoom-flip {");
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(
      new RegExp(`from\\s*\\{\\s*transform:\\s*scale\\(var\\(${ZOOM_FLIP_FROM_VAR}, 1\\)\\)`),
    );
    expect(body ?? "").toMatch(/to\s*\{\s*transform:\s*scale\(1\)/);
    // Width/height are never animated (no layout thrash).
    expect(body ?? "").not.toMatch(/(width|height|left|top)\s*:/);
  });

  it("both accessibility paths collapse it (reduced motion + Animations off)", () => {
    const clean = stripCssComments(css);
    expect(clean).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]{0,120}animation-duration:\s*0\.01ms !important/);
    expect(clean).toMatch(/:root\[data-animations="off"\] \*[\s\S]{0,160}animation-duration:\s*0\.01ms !important/);
    // No rule re-enables a duration for the flip class.
    expect(clean).not.toMatch(/\.pdf-page-zoom-flip[^{]*\{[^}]*animation-duration/);
  });
});

describe("DEF-296 — zoomFlipFromScale", () => {
  it("zooming IN starts smaller (ratio < 1); zooming OUT starts larger (> 1)", () => {
    expect(zoomFlipFromScale(1, 1.25)).toBeCloseTo(0.8);
    expect(zoomFlipFromScale(1.25, 1)).toBeCloseTo(1.25);
  });

  it("returns null when there is nothing to animate", () => {
    expect(zoomFlipFromScale(1, 1)).toBeNull();
    expect(zoomFlipFromScale(0, 1)).toBeNull();
    expect(zoomFlipFromScale(Number.NaN, 1)).toBeNull();
    expect(zoomFlipFromScale(-1, 1)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The component applies the class/var on a scale change, and nothing when
// motion is instant.

const pending: Array<() => void> = [];

function makeDoc(): PDFDocumentProxy {
  return {
    numPages: 1,
    async getPage(): Promise<PDFPageProxy> {
      return {
        pageNumber: 1,
        view: [0, 0, 612, 792],
        getViewport: (args: { scale: number; rotation?: number }): { width: number; height: number } => ({
          width: 612 * args.scale,
          height: 792 * args.scale,
        }),
        render: (): { promise: Promise<void>; cancel: () => void } => {
          const promise = new Promise<void>((r) => pending.push(r));
          return { promise, cancel: (): void => undefined };
        },
        getTextContent: async (): Promise<{ items: unknown[] }> => ({ items: [] }),
      } as unknown as PDFPageProxy;
    },
    destroy: async (): Promise<void> => undefined,
  } as unknown as PDFDocumentProxy;
}

function mount(cssScale: number, animated = true): { host: HTMLElement; rerender: (s: number) => void; unmount: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const noop = (): void => undefined;
  const draw = (scale: number): void => {
    act((): void => {
      root.render(
        <PageView
          doc={makeDoc()}
          page={1}
          sourcePage={1}
          widthPt={612}
          heightPt={792}
          cssScale={scale}
          zoomAnimated={animated}
          shouldRender={true}
          hits={[]}
          activeHit={null}
          registerPage={noop}
          onPageSize={noop}
          onActiveHitTop={noop}
          annotations={[]}
          annotationTool={initialAnnotationToolState}
          flashId={null}
          onCreateAnnotation={noop}
          onFinishedOneShot={noop}
          onRenderStart={noop}
          onRenderEnd={noop}
        />,
      );
    });
  };
  draw(cssScale);
  return {
    host,
    rerender: draw,
    unmount: (): void => {
      act((): void => root.unmount());
      host.remove();
    },
  };
}

const wrapper = (host: HTMLElement): HTMLElement | null => host.querySelector(".pdf-page");

describe("DEF-296 — PageView applies the FLIP on a zoom step", () => {
  beforeEach(() => {
    pending.length = 0;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      () => ({ fillRect: vi.fn(), drawImage: vi.fn() }) as unknown as CanvasRenderingContext2D,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("adds the class and the from-ratio var when cssScale changes", () => {
    const { host, rerender, unmount } = mount(1);
    try {
      expect(wrapper(host)?.className).not.toContain(ZOOM_FLIP_CLASS);
      rerender(1.25);
      const el = wrapper(host);
      expect(el?.className).toContain(ZOOM_FLIP_CLASS);
      expect(el?.style.getPropertyValue(ZOOM_FLIP_FROM_VAR)).toBe("0.8");
    } finally {
      unmount();
    }
  });

  it("does not animate a fit-mode recompute (zoomAnimated=false)", () => {
    const { host, rerender, unmount } = mount(1, false);
    try {
      rerender(1.25);
      const el = wrapper(host);
      expect(el?.className).not.toContain(ZOOM_FLIP_CLASS);
      expect(el?.style.getPropertyValue(ZOOM_FLIP_FROM_VAR)).toBe("");
    } finally {
      unmount();
    }
  });

  it("applies nothing under reduced motion (instant path)", () => {
    const original = window.matchMedia;
    (window as { matchMedia?: typeof window.matchMedia }).matchMedia = ((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addEventListener: (): void => undefined,
      removeEventListener: (): void => undefined,
      addListener: (): void => undefined,
      removeListener: (): void => undefined,
      dispatchEvent: (): boolean => false,
    })) as unknown as typeof window.matchMedia;
    const { host, rerender, unmount } = mount(1);
    try {
      rerender(1.25);
      const el = wrapper(host);
      expect(el?.className).not.toContain(ZOOM_FLIP_CLASS);
      expect(el?.style.getPropertyValue(ZOOM_FLIP_FROM_VAR)).toBe("");
    } finally {
      unmount();
      (window as { matchMedia?: typeof window.matchMedia }).matchMedia = original;
    }
  });
});