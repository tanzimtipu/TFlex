// @vitest-environment jsdom
// Phase 117 (chunk C) — annotation + stamp selection chrome migrated onto
// the ONE shared `SelectionChrome`.
//
// Verifies the migration keeps BOTH kinds on the shared boundary / handle
// primitive while preserving every existing selector:
//   - a selected resizable annotation renders `[data-selection-boundary]`
//     with 4 `[data-selection-handle]`, each also carrying
//     `data-annotation-resize-handle`;
//   - a non-resizable kind (note) renders the boundary with NO handles;
//   - a selected stamp renders 4 handles carrying
//     `data-stamp-resize-handle`;
//   - the action bar's primary row is Confirm + Cancel and the Delete
//     control lives behind the More control.
//
// Setup/teardown mirrors the sibling renderer specs (react-dom/client +
// `act`; the repo ships no @testing-library/react).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { AnnotationOverlay } from "../../../src/renderer/annotations/AnnotationOverlay";
import {
  StampAnnotations,
  type PlacedStamp,
} from "../../../src/renderer/annotations/StampAnnotations";
import type {
  Annotation,
  AnnotationToolState,
} from "../../../src/renderer/annotations/model";

const RECT_ANN: Annotation = {
  id: "rect-1",
  kind: "rect",
  page: 1,
  color: "blue",
  createdAt: "2026-01-01T00:00:00.000Z",
  rect: { x: 100, y: 100, width: 150, height: 80 },
};

const NOTE_ANN: Annotation = {
  id: "note-1",
  kind: "note",
  page: 1,
  color: "yellow",
  createdAt: "2026-01-01T00:00:00.000Z",
  at: { x: 60, y: 300 },
  text: "a note",
};

const SELECT_TOOL: AnnotationToolState = { tool: "select", color: "blue", penWidth: 2 };

const PNG_1x1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

function makePlaced(overrides: Partial<PlacedStamp>): PlacedStamp {
  return {
    id: "p-1",
    stampId: "APPROVED",
    page: 1,
    rect: { x: 50, y: 60, width: 200, height: 80 },
    pngBytes: PNG_1x1,
    pngWidth: 200,
    pngHeight: 80,
    ...overrides,
  };
}

function stubLayout(host: HTMLElement, width: number, height: number): void {
  host.style.position = "absolute";
  host.style.left = "0px";
  host.style.top = "0px";
  host.style.width = `${width}px`;
  host.style.height = `${height}px`;
  host.getBoundingClientRect = (): DOMRect => ({
    x: 0, y: 0, left: 0, top: 0, right: width, bottom: height, width, height,
    toJSON: () => ({}),
  });
  // jsdom has no pointer capture; stub it like the sibling overlay specs.
  Element.prototype.setPointerCapture = function (): void { /* no-op */ };
  Element.prototype.releasePointerCapture = function (): void { /* no-op */ };
}

function mountAnnotation(annotations: Annotation[]): { host: HTMLElement; cleanup: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  stubLayout(host, 800, 600);
  const root = createRoot(host);
  act((): void => {
    root.render(
      <AnnotationOverlay
        page={1}
        widthPt={612}
        heightPt={792}
        cssScale={1}
        annotations={annotations}
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

function mountStamp(items: PlacedStamp[]): { host: HTMLElement; cleanup: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  stubLayout(host, 900, 700);
  const root = createRoot(host);
  act((): void => {
    root.render(
      <StampAnnotations
        cssScale={2}
        items={items}
        pageWidthPt={612}
        pageHeightPt={792}
        onMove={vi.fn()}
        onDelete={vi.fn()}
        onRetype={vi.fn()}
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

function clickEl(el: Element | null): void {
  if (el === null) throw new Error("expected a clickable element");
  act((): void => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function handlesOf(host: HTMLElement): Element[] {
  return Array.from(host.querySelectorAll("[data-selection-handle]"));
}

function markValues(handles: Element[], attr: string): string[] {
  return handles.map((h) => h.getAttribute(attr) ?? "").sort();
}

describe("Phase 117 (chunk C) — annotation selection chrome", () => {
  it("a selected resizable annotation renders the shared boundary + 4 handles marked data-annotation-resize-handle", () => {
    const { host, cleanup } = mountAnnotation([RECT_ANN]);
    try {
      clickEl(host.querySelector(".ann-shape[data-annotation-id='rect-1']"));
      const boundary = host.querySelector("[data-selection-boundary]");
      expect(boundary, "shared boundary renders").not.toBeNull();
      expect(boundary?.getAttribute("data-selection-kind")).toBe("annotation");
      expect(host.querySelector("[data-content-selection-bounds]"), "boundary rect present").not.toBeNull();
      const handles = handlesOf(host);
      expect(handles, "a rectangle gets 4 corner handles").toHaveLength(4);
      for (const h of handles) {
        expect(h.getAttribute("data-annotation-resize-handle"), "legacy handle selector survives").not.toBeNull();
        expect(h.classList.contains("selection-handle"), "handle uses the shared class").toBe(true);
      }
      expect(markValues(handles, "data-annotation-resize-handle")).toEqual(["ne", "nw", "se", "sw"]);
      // The chrome root keeps the legacy frame selector and wraps the handles.
      const frame = host.querySelector("[data-content-selection-frame]");
      expect(frame, "frame selector survives on the chrome root").not.toBeNull();
      for (const h of handles) {
        expect(frame?.contains(h), "handle is a child of the shared frame").toBe(true);
      }
    } finally {
      cleanup();
    }
  });

  it("a non-resizable kind renders the boundary with no handles", () => {
    const { host, cleanup } = mountAnnotation([NOTE_ANN]);
    try {
      clickEl(host.querySelector(".ann-note[data-annotation-id='note-1']"));
      expect(host.querySelector("[data-selection-boundary]"), "boundary renders").not.toBeNull();
      expect(host.querySelector("[data-content-selection-bounds]"), "boundary rect present").not.toBeNull();
      expect(host.querySelectorAll("[data-selection-handle]"), "no handles for a non-resizable kind").toHaveLength(0);
      expect(host.querySelectorAll("[data-annotation-resize-handle]")).toHaveLength(0);
    } finally {
      cleanup();
    }
  });
});

describe("Phase 117 (chunk C) — stamp selection chrome", () => {
  it("a selected stamp renders the shared boundary + 4 handles marked data-stamp-resize-handle", () => {
    const { host, cleanup } = mountStamp([makePlaced({})]);
    try {
      clickEl(host.querySelector(".stamp-annotation"));
      const boundary = host.querySelector("[data-selection-boundary]");
      expect(boundary, "shared boundary renders").not.toBeNull();
      expect(boundary?.getAttribute("data-selection-kind")).toBe("stamp");
      expect(host.querySelector("[data-content-selection-frame]"), "frame selector survives").not.toBeNull();
      const handles = handlesOf(host);
      expect(handles, "a stamp gets 4 corner handles").toHaveLength(4);
      for (const h of handles) {
        expect(h.getAttribute("data-stamp-resize-handle"), "legacy handle selector survives").not.toBeNull();
      }
      expect(markValues(handles, "data-stamp-resize-handle")).toEqual(["ne", "nw", "se", "sw"]);
    } finally {
      cleanup();
    }
  });
});

describe("Phase 117 (chunk C) — action bar primary row", () => {
  it("keeps Confirm + Cancel primary and moves Delete behind the More control", () => {
    const { host, cleanup } = mountAnnotation([RECT_ANN]);
    try {
      clickEl(host.querySelector(".ann-shape[data-annotation-id='rect-1']"));
      const confirm = host.querySelector("[data-content-action='ann-rect-confirm']");
      const cancel = host.querySelector("[data-content-action='ann-rect-cancel']");
      expect(confirm).not.toBeNull();
      expect(cancel).not.toBeNull();
      expect(confirm?.closest(".content-action-more-menu"), "Confirm is in the primary row").toBeNull();
      expect(cancel?.closest(".content-action-more-menu"), "Cancel is in the primary row").toBeNull();
      // Delete is not a sibling of Confirm / Cancel: it is behind More.
      expect(host.querySelector("[data-content-action='ann-rect-delete']")).toBeNull();
      const more = host.querySelector("[data-content-action='ann-rect-more']");
      expect(more, "the separated More control renders").not.toBeNull();
      clickEl(more);
      const del = host.querySelector("[data-content-action='ann-rect-delete']");
      expect(del, "Delete appears only after More opens").not.toBeNull();
      expect(del?.closest(".content-action-more-menu"), "Delete lives inside the More surface").not.toBeNull();
    } finally {
      cleanup();
    }
  });
});
