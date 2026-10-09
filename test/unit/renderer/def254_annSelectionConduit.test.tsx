// @vitest-environment jsdom
// DEF-254 — the annotation-selection conduit's page guard.
//
// Every mounted page's `AnnotationOverlay` reports its own selection upward.
// A neighbouring page mounting (virtualization) or remounting (during the
// panel's reflow) reported `null`, and the host's single-selection conduit
// used the most-recent report — so selecting an annotation on page 4 closed
// the text-properties panel the moment page 3/5's overlay mounted.
//
// Two layers are pinned here:
//   A. `applyAnnSelectionReport` — the conduit decision (the guard);
//   B. `PageView` tags every report with its OWN visible page index, and the
//      full neighbour-mount sequence keeps a live page-4 selection.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { PageView } from "../../../src/renderer/components/PageView";
import { applyAnnSelectionReport } from "../../../src/renderer/components/DocumentView";
import type {
  Annotation,
  AnnotationToolState,
} from "../../../src/renderer/annotations/model";

const SELECT_TOOL: AnnotationToolState = { tool: "select", color: "blue", penWidth: 2 };

const ANN3: Annotation = {
  id: "tbx-3",
  kind: "textbox",
  page: 3,
  color: "blue",
  createdAt: "2026-01-01T00:00:00.000Z",
  rect: { x: 100, y: 100, width: 160, height: 60 },
  text: "PAGE THREE",
};

const ANN4: Annotation = {
  id: "tbx-4",
  kind: "textbox",
  page: 4,
  color: "blue",
  createdAt: "2026-01-01T00:00:00.000Z",
  rect: { x: 100, y: 100, width: 160, height: 60 },
  text: "PAGE FOUR",
};

describe("DEF-254 A — the conduit's page guard", () => {
  it("a null report from page 3 does not clear a selection held on page 4", () => {
    expect(applyAnnSelectionReport(ANN4, null, 3)).toBe(ANN4);
  });

  it("a null report from page 4 clears the selection held on page 4", () => {
    expect(applyAnnSelectionReport(ANN4, null, 4)).toBeNull();
  });

  it("a non-null report from page 3 re-targets the selection onto page 3", () => {
    expect(applyAnnSelectionReport(ANN4, ANN3, 3)).toBe(ANN3);
  });

  it("a non-null report always wins, and null with nothing selected stays null", () => {
    expect(applyAnnSelectionReport(null, ANN4, 5)).toBe(ANN4);
    expect(applyAnnSelectionReport(null, null, 3)).toBeNull();
    // After page 3 took the selection, page 4 reporting null no longer clears.
    expect(applyAnnSelectionReport(ANN3, null, 4)).toBe(ANN3);
  });
});

// ---------------------------------------------------------------------------
// DEF-254 B — PageView tags the report with its own page.

function makeDocStub(numPages: number): PDFDocumentProxy {
  return {
    numPages,
    async getPage(): Promise<unknown> {
      return {
        view: [0, 0, 612, 792],
        getViewport: (_args: { scale: number }): { width: number; height: number } => ({
          width: 612,
          height: 792,
        }),
        render: (_args: unknown): { promise: Promise<void>; cancel: () => void } => ({
          promise: Promise.resolve(),
          cancel: (): void => undefined,
        }),
        cleanup: async (): Promise<void> => undefined,
      };
    },
    destroy: async (): Promise<void> => undefined,
  } as unknown as PDFDocumentProxy;
}

interface Report {
  ann: Annotation | null;
  page: number;
}

/** Mirrors DocumentView's conduit: the latest report is folded through the
 *  production guard `applyAnnSelectionReport`. */
function makeConduit(): {
  calls: Report[];
  selection: () => Annotation | null;
  report: (ann: Annotation | null, page: number) => void;
} {
  let current: Annotation | null = null;
  const calls: Report[] = [];
  return {
    calls,
    selection: (): Annotation | null => current,
    report: (ann: Annotation | null, page: number): void => {
      calls.push({ ann, page });
      current = applyAnnSelectionReport(current, ann, page);
    },
  };
}

function stubObservers(): void {
  const g = globalThis as unknown as {
    IntersectionObserver?: unknown;
    ResizeObserver?: unknown;
  };
  if (g.IntersectionObserver === undefined) {
    class NoopIntersectionObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }
    g.IntersectionObserver = NoopIntersectionObserver;
  }
  if (g.ResizeObserver === undefined) {
    class NoopResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    g.ResizeObserver = NoopResizeObserver;
  }
}

function firePointer(
  el: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  x: number,
  y: number,
): void {
  act((): void => {
    el.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        button: 0,
        clientX: x,
        clientY: y,
        pointerId: 1,
      }),
    );
  });
}

function click(el: Element | null): void {
  act((): void => {
    el?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function pageProps(
  page: number,
  anns: Annotation[],
  report: (ann: Annotation | null, page: number) => void,
): Parameters<typeof PageView>[0] {
  return {
    doc: makeDocStub(6),
    tabId: "tab-def254",
    page,
    sourcePage: page,
    widthPt: 612,
    heightPt: 792,
    cssScale: 1,
    shouldRender: true,
    hits: [],
    activeHit: null,
    onPageSize: (): void => undefined,
    onActiveHitTop: (): void => undefined,
    annotations: anns,
    annotationTool: SELECT_TOOL,
    flashId: null,
    onCreateAnnotation: (): void => undefined,
    onSelectAnnotation: report,
  };
}

describe("DEF-254 B — PageView tags each report with its own page", () => {
  it("keeps a page-4 selection when page 3 (re)mounts and reports null", () => {
    stubObservers();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const conduit = makeConduit();

    const render = (page3Mounted: boolean): void => {
      act((): void => {
        root.render(
          createElement(
            "div",
            null,
            page3Mounted
              ? createElement(PageView, {
                  ...pageProps(3, [ANN3], conduit.report),
                  key: "p3",
                })
              : null,
            createElement(PageView, {
              ...pageProps(4, [ANN4], conduit.report),
              key: "p4",
            }),
          ),
        );
      });
    };

    try {
      render(true);
      // Selecting the page-4 textbox sets the selection.
      click(host.querySelector(".ann-textbox[data-annotation-id='tbx-4']"));
      expect(conduit.selection()).toBe(ANN4);
      expect(conduit.calls).toContainEqual({ ann: ANN4, page: 4 });

      // A neighbouring page mounts/remounts and reports (null, 3). Before
      // DEF-254 this clobbered the selection and closed the panel. Assert
      // the null report lands AFTER the selection (the exact repro order).
      const beforeRemount = conduit.calls.length;
      render(false);
      render(true);
      expect(
        conduit.calls.slice(beforeRemount).some((c) => c.ann === null && c.page === 3),
        "page 3 must report (null, 3) after page 4 is selected",
      ).toBe(true);
      expect(conduit.selection()).toBe(ANN4);

      // A blank click ON page 4 is a genuine deselect for the holding page.
      const layer4 = host.querySelector("[data-annotation-layer='4']");
      if (layer4 === null) throw new Error("page 4 annotation layer did not mount");
      firePointer(layer4, "pointerdown", 2, 2);
      expect(conduit.calls).toContainEqual({ ann: null, page: 4 });
      expect(conduit.selection()).toBeNull();

      // Re-select page 4, then a non-null report from page 3 re-targets it.
      click(host.querySelector(".ann-textbox[data-annotation-id='tbx-4']"));
      expect(conduit.selection()).toBe(ANN4);
      click(host.querySelector(".ann-textbox[data-annotation-id='tbx-3']"));
      expect(conduit.selection()).toBe(ANN3);
    } finally {
      act((): void => root.unmount());
      host.remove();
    }
  });
});