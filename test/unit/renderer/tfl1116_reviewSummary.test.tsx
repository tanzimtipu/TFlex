// @vitest-environment jsdom
//
// TFL-1116 C13 (R20) — the REVIEW surface de-duplicates the document-wide
// summaries.
//
// Before this chunk BOTH sides rendered the unified review list, so the Bates /
// watermark / signature summaries repeated in the LEFT ContextPanel review
// navigator and in the RIGHT Inspector. R20 keeps the LEFT as the authoritative
// inventory (rows + select / edit / delete actions) and the RIGHT as the
// SELECTED annotation's scope only. `ReviewElementsPanel` now renders two
// scopes: `'document'` (default, the LEFT) and `'selection'` (the Inspector).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { ReviewElementsPanel } from "../../../src/renderer/components/ReviewElementsPanel";
import { ContextPanel } from "../../../src/renderer/components/ContextPanel";
import { Inspector } from "../../../src/renderer/components/Inspector";
import type { EngineState } from "../../../src/renderer/engine/types";
import type { Annotation } from "../../../src/renderer/annotations/model";
import type {
  BatesInfo,
  SignaturePlacement,
  WatermarkInfo,
} from "../../../src/shared/types";

const ANNOTATION = {
  id: "ann-1",
  kind: "highlight",
  page: 1,
  rect: { x: 10, y: 10, width: 40, height: 10 },
  color: "#facc15",
  text: "note",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
} as unknown as Annotation;

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

function mount(node: React.ReactElement): { host: HTMLElement; unmount: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(node);
  });
  return {
    host,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function makeDocStub(numPages: number): PDFDocumentProxy {
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

function makeEngineState(pageCount: number): EngineState {
  return {
    pageCount,
    pageOrder: Array.from({ length: pageCount }, (_, i) => i),
    rotations: new Array(pageCount).fill(0) as EngineState["rotations"],
    deleted: new Array(pageCount).fill(false),
    modified: false,
    annotations: [],
  };
}

function contextPanel(): { host: HTMLElement; unmount: () => void } {
  return mount(
    <ContextPanel
      stage="review"
      doc={makeDocStub(3)}
      currentPage={1}
      defaultWidthPt={612}
      defaultHeightPt={792}
      engineState={makeEngineState(3)}
      canUndo={false}
      onUndo={(): void => undefined}
      onJump={(): void => undefined}
      outline={null}
      annotations={[ANNOTATION]}
      bates={[BATES]}
      watermarks={[WATERMARK]}
      signatures={[SIGNATURE]}
    />,
  );
}

function inspector(): { host: HTMLElement; unmount: () => void } {
  return mount(
    <Inspector
      stage="review"
      annotations={[ANNOTATION]}
      bates={[BATES]}
      watermarks={[WATERMARK]}
      signatures={[SIGNATURE]}
      onExportComments={vi.fn()}
      onImportComments={vi.fn()}
    />,
  );
}

const DOC_CATEGORIES = ["bates", "watermarks", "signatures"] as const;

describe("TFL-1116 C13 (R20) — review summary de-duplication", () => {
  it("keeps the LEFT navigator as the authoritative document inventory with actions", () => {
    const m = contextPanel();
    try {
      const root = m.host.querySelector("[data-review-elements]");
      expect(root?.getAttribute("data-review-elements-scope")).toBe("document");
      const cats = [...m.host.querySelectorAll<HTMLElement>("[data-review-category]")].map(
        (el) => el.getAttribute("data-review-category"),
      );
      expect(cats).toEqual(["annotations", "bates", "watermarks", "signatures"]);
      // The document-wide summary ROWS + their actions live here.
      for (const type of ["bates", "watermark", "signature"] as const) {
        const row = m.host.querySelector<HTMLElement>(`[data-review-element-type="${type}"]`);
        expect(row, `left row for ${type}`).not.toBeNull();
        expect(row?.querySelector("[data-review-element-select]")).not.toBeNull();
        expect(row?.querySelector("[data-review-element-edit]")).not.toBeNull();
        expect(row?.querySelector("[data-review-element-delete]")).not.toBeNull();
      }
    } finally {
      m.unmount();
    }
  });

  it("keeps the RIGHT Inspector selection-specific, with no document-wide summary", () => {
    const m = inspector();
    try {
      const root = m.host.querySelector("[data-review-elements]");
      expect(root, "the Inspector review section still renders").not.toBeNull();
      expect(root?.getAttribute("data-review-elements-scope")).toBe("selection");
      const cats = [...m.host.querySelectorAll<HTMLElement>("[data-review-category]")].map(
        (el) => el.getAttribute("data-review-category"),
      );
      expect(cats).toEqual(["annotations"]);
      for (const c of DOC_CATEGORIES) {
        expect(
          m.host.querySelector(`[data-review-category="${c}"]`),
          `Inspector must not repeat ${c}`,
        ).toBeNull();
      }
      expect(m.host.querySelectorAll("[data-review-element-type]")).toHaveLength(0);
      // The selection scope still shows the selected-annotation hint.
      expect(m.host.querySelector("[data-inspector-review-empty]")).not.toBeNull();
    } finally {
      m.unmount();
    }
  });

  it("renders each document-wide summary in exactly ONE authoritative location across both sides", () => {
    const left = contextPanel();
    const right = inspector();
    try {
      const count = (sel: string): number =>
        left.host.querySelectorAll(sel).length + right.host.querySelectorAll(sel).length;
      for (const type of ["bates", "watermark", "signature"] as const) {
        expect(
          count(`[data-review-element-type="${type}"]`),
          `exactly one ${type} summary across both sides`,
        ).toBe(1);
      }
      for (const c of DOC_CATEGORIES) {
        expect(count(`[data-review-category="${c}"]`), `exactly one ${c} category`).toBe(1);
      }
      // The annotations category is the one the RIGHT legitimately keeps.
      expect(count('[data-review-category="annotations"]')).toBe(2);
    } finally {
      left.unmount();
      right.unmount();
    }
  });

  it("dispatches the LEFT document-wide actions to the host handlers", () => {
    const onSelect = vi.fn();
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const m = mount(
      <ReviewElementsPanel
        scope="document"
        annotations={[]}
        bates={[BATES]}
        watermarks={[WATERMARK]}
        signatures={[]}
        onSelect={onSelect}
        onEdit={onEdit}
        onDelete={onDelete}
      />,
    );
    try {
      const click = (el: Element | null): void => {
        if (el === null) throw new Error("missing target");
        act((): void => {
          el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
        });
      };
      click(m.host.querySelector('[data-review-element-type="bates"] [data-review-element-select]'));
      click(m.host.querySelector('[data-review-element-type="bates"] [data-review-element-edit]'));
      click(
        m.host.querySelector(
          '[data-review-element-type="watermark"] [data-review-element-delete]',
        ),
      );
      expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ type: "bates", id: "bates-1" }));
      expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ type: "bates", id: "bates-1" }));
      expect(onDelete).toHaveBeenCalledWith(
        expect.objectContaining({ type: "watermark", id: "wm-1" }),
      );
    } finally {
      m.unmount();
    }
  });

  it("selection scope omits the document-wide categories entirely", () => {
    const m = mount(
      <ReviewElementsPanel
        scope="selection"
        annotations={[]}
        bates={[BATES]}
        watermarks={[WATERMARK]}
        signatures={[SIGNATURE]}
      />,
    );
    try {
      expect(m.host.querySelectorAll("[data-review-category]")).toHaveLength(1);
      expect(m.host.querySelector('[data-review-category="annotations"]')).not.toBeNull();
      expect(m.host.querySelectorAll("[data-review-element-type]")).toHaveLength(0);
      expect(m.host.querySelectorAll("[data-review-empty]")).toHaveLength(0);
    } finally {
      m.unmount();
    }
  });
});