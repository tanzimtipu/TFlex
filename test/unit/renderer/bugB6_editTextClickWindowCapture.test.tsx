// @vitest-environment jsdom
//
// B6 — Edit-mode text-run CLICK must open the inline editor.
//
// The defect: the text-run HOVER hint worked (it listens at window
// level via pointermove) but the CLICK never reached the layer's
// onPointerDown — a sibling (the pdf.js textLayer's
// pointer-events: auto spans, or the annotation layer) swallowed
// the pointerdown for the neutral select tool, so the inline
// editor never mounted.
//
// The fix mirrors the hover pattern: while the text tool is
// active, EditOverlay registers a WINDOW-LEVEL capture pointerdown
// listener that computes the page point and opens the editor
// directly. Guards (AGENTS.md cross-bubbling rule): the handler
// bails when the event target sits inside any interactive control
// (editor, image placement/toolbar, native controls, annotation
// surfaces) and only treats left-button presses inside the page
// bounds as text-run clicks.
//
// We exercise EditOverlay in isolation:
//   1. A window-level pointerdown over a text run opens the
//      inline editor pre-filled with the run's text.
//   2. A pointerdown on an interactive control (button) does NOT
//      open the editor.
//   3. A pointerdown outside the page bounds does NOT open the
//      editor.
import { describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { EditOverlay } from "../../../src/renderer/edit/EditOverlay";
import type { EditState, EditTool } from "../../../src/renderer/edit/model";
import type { TextItemGeom } from "../../../src/renderer/annotations/AnnotationOverlay";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TEXT_ITEMS: TextItemGeom[] = [
  { x: 100, y: 100, width: 200, height: 30, text: "Hello report" },
];

const EMPTY_STATE: EditState = {
  tool: "text",
  placements: [],
  selectedImage: null,
  selectedTextBox: null,
  textBoxes: [],
  pendingReplace: null,
  cropping: false,
};

function mountTextTool(): {
  host: HTMLElement;
  layer: HTMLElement;
  unmount: () => void;
} {
  const host = document.createElement("div");
  host.style.position = "absolute";
  host.style.left = "0px";
  host.style.top = "0px";
  host.style.width = "800px";
  host.style.height = "600px";
  document.body.appendChild(host);
  host.getBoundingClientRect = (): DOMRect => ({
    x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600,
    toJSON: () => ({}),
  });
  const root = createRoot(host);
  act((): void => {
    root.render(
      createElement(EditOverlay, {
        page: 1,
        pageWidthPt: 612,
        pageHeightPt: 792,
        cssScale: 1,
        tool: "text" as EditTool,
        getTextItems: (): TextItemGeom[] => TEXT_ITEMS,
        edit: EMPTY_STATE,
        dispatch: (): void => undefined,
        pickImage: (): Promise<{ bytes: Uint8Array; format: "png" | "jpeg" } | null> =>
          Promise.resolve(null),
        defaultFont: "Helvetica",
        onCommitTextEdit: (): void => undefined,
        onCommitTextBox: (): void => undefined,
        onCommitImageEdit: (): void => undefined,
        onCommitTextBoxMove: (): void => undefined,
      }),
    );
  });
  const layer = host.querySelector("[data-tool='text']") as HTMLElement | null;
  if (layer === null) throw new Error("edit layer not found");
  return {
    host,
    layer,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function pointerDownOn(el: Element, x: number, y: number): void {
  act((): void => {
    el.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, clientX: x, clientY: y }),
    );
  });
}

describe("B6 — Edit-mode text-run click opens the inline editor (window capture)", () => {
  it("a pointerdown over a text run mounts the editor pre-filled with the run's text", () => {
    const { layer, unmount } = mountTextTool();
    try {
      // Click at the center of the text run (150, 115). The event
      // bubbles to window where the capture listener picks it up —
      // exactly the path that was swallowed by a sibling layer
      // before the fix.
      pointerDownOn(layer, 150, 115);
      // The inline editor mounts in "edit" mode (the run has text).
      const editor = document.querySelector("[data-edit-editor='edit']");
      expect(editor).not.toBeNull();
      const textarea = document.querySelector("[data-edit-textarea]");
      expect(textarea).not.toBeNull();
      expect((textarea as HTMLTextAreaElement | null)?.value).toBe(
        "Hello report",
      );
    } finally {
      unmount();
    }
  });

  it("a pointerdown on an interactive control does NOT open the editor (cross-bubbling guard)", () => {
    const { host, unmount } = mountTextTool();
    try {
      // A toolbar-like button inside the page: the capture handler
      // must walk the ancestor chain and bail out on interactive
      // elements so the button's own click still works.
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "Toolbar";
      host.appendChild(btn);
      pointerDownOn(btn, 150, 115);
      expect(document.querySelector("[data-edit-editor='edit']")).toBeNull();
    } finally {
      unmount();
    }
  });

  it("a pointerdown outside the page bounds does NOT open the editor", () => {
    const { layer, unmount } = mountTextTool();
    try {
      // Point far outside the 612x792pt page (the host is 800px
      // wide but the page is 612pt wide at cssScale 1).
      pointerDownOn(layer, 700, 500);
      expect(document.querySelector("[data-edit-editor='text']")).toBeNull();
    } finally {
      unmount();
    }
  });
});