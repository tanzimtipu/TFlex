// @vitest-environment jsdom
// Phase 113 (Quiet Actions) — migration wave E1: panels and inspectors.
//
// Pins the wave-E1 call sites onto the Phase 113 axes (`intent` / `kind` /
// `density`) via the chunk-B `Button` / `IconButton` primitive and the canonical
// class contract in docs/BUTTON-SYSTEM.md. Every assertion reads the shipped
// classes / ARIA the primitive emits; no behaviour (label, handler, data-* hook,
// disabled predicate) is re-derived here.
//
// DELIBERATE EXCEPTION — the annotation colour swatch formerly lived on the
// panel rows; Phase 116 (TFL-1228 chunk D) retired it (colour editing belongs to
// the inspector), so the call-site test now pins its ABSENCE and the row's
// Thread Stream hooks instead.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ContextPanel } from "../../../src/renderer/components/ContextPanel";
import { Inspector } from "../../../src/renderer/components/Inspector";
import { ReviewElementsPanel } from "../../../src/renderer/components/ReviewElementsPanel";
import { OcrSuspectsPanel } from "../../../src/renderer/components/OcrSuspectsPanel";
import { AnnotationsPanel } from "../../../src/renderer/annotations/AnnotationsPanel";
import { TextPropertiesPanel } from "../../../src/renderer/edit/TextPropertiesPanel";
import { ActionList } from "../../../src/renderer/components/panels/PanelPrimitives";
import { defaultTextStyleValues } from "../../../src/renderer/edit/textStyle";
import type { EngineState } from "../../../src/renderer/engine/types";
import type { Annotation } from "../../../src/renderer/annotations/model";
import type { BatesInfo, SignaturePlacement, WatermarkInfo } from "../../../src/shared/types";

const NOOP = (): void => undefined;

let roots: Root[] = [];
let hosts: HTMLElement[] = [];

function mount(ui: ReactElement): HTMLElement {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  act((): void => {
    root.render(ui);
  });
  roots.push(root);
  hosts.push(host);
  return host;
}

function cls(el: Element | null): string {
  if (el === null) throw new Error("expected element");
  return el.getAttribute("class") ?? "";
}

beforeEach((): void => {
  roots = [];
  hosts = [];
});

afterEach((): void => {
  const rs = roots;
  const hs = hosts;
  roots = [];
  hosts = [];
  for (const root of rs) {
    act((): void => {
      root.unmount();
    });
  }
  for (const h of hs) h.remove();
  document.body.innerHTML = "";
});

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

function docStub(numPages: number): PDFDocumentProxy {
  return {
    numPages,
    async getPage(n: number): Promise<unknown> {
      return {
        pageNumber: n,
        view: [0, 0, 612, 792],
        getViewport: (): { width: number; height: number } => ({ width: 612, height: 792 }),
        render: (): { promise: Promise<void>; cancel: () => void } => ({
          promise: Promise.resolve(),
          cancel: (): void => undefined,
        }),
        cleanup: async (): Promise<void> => undefined,
      };
    },
    destroy: async (): Promise<void> => undefined,
  } as unknown as PDFDocumentProxy;
}

function engineState(pageCount: number): EngineState {
  return {
    pageCount,
    pageOrder: Array.from({ length: pageCount }, (_, i) => i),
    rotations: new Array(pageCount).fill(0) as EngineState["rotations"],
    deleted: new Array(pageCount).fill(false),
    modified: false,
    annotations: [],
  };
}

describe("Phase 113 — ContextPanel call sites", () => {
  function renderPanel(): HTMLElement {
    stubObservers();
    return mount(
      <ContextPanel
        stage="pages"
        doc={docStub(3)}
        currentPage={1}
        defaultWidthPt={612}
        defaultHeightPt={792}
        pageSizes={null}
        engineState={engineState(3)}
        proxyVisibleOrder={false}
        canUndo={false}
        onJump={NOOP}
        outline={[{ title: "Chapter 1", dest: [1], children: [] }]}
        onMerge={NOOP}
        onRemoveBlankPages={NOOP}
      />,
    );
  }

  it("renders the page-view tool buttons on the canonical secondary primitive", () => {
    const host = renderPanel();
    // TFL-1582 — the header tools are labelled buttons on the Book View
    // secondary treatment (icon + visible text).
    const blank = host.querySelector("[data-blank-scan-open]");
    expect(cls(blank)).toContain("btn");
    expect(cls(blank)).toContain("btn-secondary");
  });

  it("renders the navigator view selector on the canonical segmented primitive", () => {
    const host = renderPanel();
    const tablist = host.querySelector("[data-context-panel-view-tabs]");
    expect(tablist).not.toBeNull();
    expect(tablist?.getAttribute("role")).toBe("tablist");
    const outline = host.querySelector('[data-context-panel-view-tab="outline"]');
    expect(cls(outline)).toContain("btn");
    expect(cls(outline)).toContain("btn-toggle");
    expect(cls(outline)).toContain("tool-btn");
    expect(["true", "false"]).toContain(outline?.getAttribute("aria-selected"));
  });

  it("renders the collapse control as a canonical tertiary toggle", () => {
    const host = renderPanel();
    const collapse = host.querySelector("[data-rail-collapse]");
    expect(cls(collapse)).toContain("btn");
    expect(cls(collapse)).toContain("btn-ghost");
    expect(cls(collapse)).toContain("btn-toggle");
  });

  it("keeps the Combine action's accessible name", () => {
    const host = renderPanel();
    // TFL-1582 — Combine is a direct header labelled button; its accessible
    // name is exposed through aria-label.
    const combine = host.querySelector("[data-context-panel-combine]");
    expect(combine?.getAttribute("aria-label")).toBe("Combine with another PDF");
    expect(cls(combine)).toContain("btn-secondary");
  });
});

describe("Phase 113 — Inspector call sites", () => {
  it("renders an inspector action on the secondary primitive and the link compact", () => {
    const host = mount(
      <Inspector
        stage="pages"
        selection={{ kind: "page", page: 2 }}
        pageCount={9}
        pageSize={{ widthPt: 612, heightPt: 792 }}
        annotationCount={4}
        onRenumberPages={NOOP}
        onJumpToReview={NOOP}
      />,
    );
    const action = host.querySelector('[data-inspector-action="renumber"]');
    expect(cls(action)).toContain("btn");
    expect(cls(action)).toContain("btn-secondary");
    const link = host.querySelector('[data-inspector-action="jump-to-review"]');
    expect(cls(link)).toContain("btn-ghost");
    expect(cls(link)).toContain("btn-compact");
  });

  it("renders the primary export commit as btn-primary", () => {
    const host = mount(
      <Inspector
        stage="deliver"
        selection={{ kind: "none" }}
        pageCount={3}
        exportFormat="png"
        exportSourceName="report.pdf"
        exportDpi={150}
        exportCurrentPage={1}
        onExportRun={NOOP}
      />,
    );
    const primary = host.querySelector('[data-inspector-action="export"]');
    expect(primary).not.toBeNull();
    expect(cls(primary)).toContain("btn-primary");
  });

  it("keeps the inspector close button's accessible name", () => {
    const host = mount(<Inspector stage="pages" onClose={NOOP} />);
    const close = host.querySelector(".inspector-close");
    expect(close?.getAttribute("aria-label")).toBe("Close inspector");
    expect(cls(close)).toContain("btn-ghost");
  });
});

const BATES: BatesInfo = {
  id: "bates-1",
  prefix: "ABC",
  suffix: "",
  startNumber: 1,
  padding: 6,
  position: "bottom-right",
  size: 10,
  pages: [2, 3],
  labels: ["ABC000001", "ABC000002"],
};

const WATERMARK: WatermarkInfo = { id: "wm-1", type: "text", text: "DRAFT", pages: [5] };

const SIGNATURE: SignaturePlacement = {
  id: "sig-place-1",
  signatureId: "saved-1",
  page: 7,
  rect: { x: 0, y: 0, width: 10, height: 10 },
  pngBytes: new Uint8Array(),
};

describe("Phase 113 — ReviewElementsPanel call sites", () => {
  it("renders the row select / edit / delete on the canonical primitives", () => {
    const host = mount(
      <ReviewElementsPanel
        annotations={[]}
        bates={[BATES]}
        watermarks={[WATERMARK]}
        signatures={[SIGNATURE]}
        onSelect={NOOP}
        onEdit={NOOP}
        onDelete={NOOP}
      />,
    );
    const select = host.querySelector("[data-review-element-select]");
    expect(cls(select)).toContain("btn");
    expect(cls(select)).toContain("btn-secondary");
    const edit = host.querySelector("[data-review-element-edit]");
    expect(cls(edit)).toContain("btn-ghost");
    const del = host.querySelector("[data-review-element-delete]");
    expect(cls(del)).toContain("btn-danger");
  });
});

const OCR_SUSPECT = {
  page: 1,
  word: "gud",
  confidence: 50,
  rect: { x: 0, y: 0, width: 10, height: 4 },
} as unknown as import("../../../src/shared/types").OcrSuspect;

describe("Phase 113 — OcrSuspectsPanel call sites", () => {
  it("renders the close and the word rows on the canonical primitives", () => {
    const host = mount(
      <OcrSuspectsPanel
        suspects={[OCR_SUSPECT]}
        hasRun
        onNavigate={NOOP}
        onClose={NOOP}
      />,
    );
    const close = host.querySelector(".ocr-suspects-close");
    expect(cls(close)).toContain("btn");
    expect(cls(close)).toContain("btn-ghost");
    const word = host.querySelector("[data-ocr-suspect-word]");
    expect(cls(word)).toContain("btn-ghost");
    expect(cls(word)).toContain("btn-compact");
  });
});

const ANNOTATION = {
  id: "ann-1",
  kind: "highlight",
  page: 1,
  rect: { x: 10, y: 10, width: 40, height: 10 },
  color: "yellow",
  text: "note",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
} as unknown as Annotation;

describe("Phase 113 — AnnotationsPanel call sites", () => {
  it("retires the per-row colour swatch (colour editing lives in the inspector)", () => {
    const host = mount(
      <AnnotationsPanel
        annotations={[ANNOTATION]}
        onJumpTo={NOOP}
        onEdit={NOOP}
        onDelete={NOOP}
      />,
    );
    const row = host.querySelector("[data-annotation-row]");
    expect(row).not.toBeNull();
    expect(row?.querySelector('[data-color="yellow"]')).toBeNull();
    expect(host.querySelector(".ann-panel-swatch")).toBeNull();
    expect(host.querySelector("[data-color]")).toBeNull();
  });

  it("keeps the jump row's accessible name and the Thread Stream hooks", () => {
    const host = mount(
      <AnnotationsPanel
        annotations={[ANNOTATION]}
        onJumpTo={NOOP}
        onEdit={NOOP}
        onDelete={NOOP}
      />,
    );
    const row = host.querySelector("[data-annotation-row]");
    const jump = row?.querySelector('[aria-label^="Jump to "]') ?? null;
    expect(jump).not.toBeNull();
    expect(cls(jump)).toContain("btn-secondary");
    expect(jump?.getAttribute("aria-label")?.startsWith("Jump to ")).toBe(true);
    expect(row?.querySelector("[data-ann-kind]")).not.toBeNull();
  });
});

describe("Phase 113 — TextPropertiesPanel call sites", () => {
  function renderTextPanel(): HTMLElement {
    const values = defaultTextStyleValues("Helvetica");
    return mount(
      <TextPropertiesPanel open values={values} defaults={values} onPatch={NOOP} />,
    );
  }

  it("renders a font-style toggle on the tertiary toggle compact primitive", () => {
    const host = renderTextPanel();
    const bold = host.querySelector("[data-txt-bold]");
    expect(cls(bold)).toContain("btn");
    expect(cls(bold)).toContain("btn-ghost");
    expect(cls(bold)).toContain("btn-toggle");
    expect(cls(bold)).toContain("btn-compact");
  });

  it("renders the alignment options as segmented items", () => {
    const host = renderTextPanel();
    const align = host.querySelector("[data-txt-align-left]");
    expect(cls(align)).toContain("btn-segmented-item");
  });
});

describe("Phase 113 — PanelPrimitives ActionList", () => {
  it("renders each action on the secondary primitive with the legacy hook", () => {
    const host = mount(
      <ActionList actions={[{ id: "opt", label: "Optimize", onClick: NOOP }]} />,
    );
    const action = host.querySelector('[data-tf-panel-action="opt"]');
    expect(cls(action)).toContain("btn");
    expect(cls(action)).toContain("btn-secondary");
  });
});