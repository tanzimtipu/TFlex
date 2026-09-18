// DEF-232 — the text-run commit must target the page the EditOverlay owns,
// never the viewer's "current page" readout.
// @vitest-environment jsdom
//
// Regression: at a scroll position where the target page's top is still
// below the chrome line, the DocumentView current-page heuristic reports
// the PREVIOUS page (page 2 top at viewport y=197 -> currentPage 1) while
// the run under the cursor is on page 2. `handleEditTextRun` used to read
// `currentPageOfTab`, so the engine masked/drew on page 1: the page-2 run
// was never masked and the move vanished from the saved file.
//
// The overlay already knows the page it belongs to; these tests pin that
// the commit payload carries it, for BOTH commit paths (inline editor and
// the run selection bar).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { EditOverlay } from "../../../src/renderer/edit/EditOverlay";
import { editReducer, initialEditState, type EditState, type EditTool } from "../../../src/renderer/edit/model";
import type { TextItemGeom } from "../../../src/renderer/annotations/AnnotationOverlay";

const RUN: TextItemGeom = { x: 100, y: 100, width: 200, height: 30, text: "orchestration layer run" };
const PICKED_PNG = {
  bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  format: "png" as const,
};

function mountOverlay(
  page: number,
  tool: EditTool = "text",
  pick: { bytes: Uint8Array; format: "png" | "jpeg" } | null = null,
): {
  host: HTMLElement;
  onCommitTextEdit: ReturnType<typeof vi.fn>;
  onCommitTextBox: ReturnType<typeof vi.fn>;
  onCommitImageEdit: ReturnType<typeof vi.fn>;
  onCommitTextBoxMove: ReturnType<typeof vi.fn>;
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
  Element.prototype.setPointerCapture = (): void => undefined;
  Element.prototype.releasePointerCapture = (): void => undefined;
  const root = createRoot(host);
  const onCommitTextEdit = vi.fn();
  const onCommitTextBox = vi.fn();
  const onCommitImageEdit = vi.fn();
  const onCommitTextBoxMove = vi.fn();
  let lastState: EditState = { ...initialEditState, tool };
  const render = (): void => {
    act((): void => {
      root.render(
        createElement(EditOverlay, {
          page,
          pageWidthPt: 612,
          pageHeightPt: 792,
          cssScale: 1,
          tool: lastState.tool,
          getTextItems: (): TextItemGeom[] => [RUN],
          edit: lastState,
          dispatch: (action): void => {
            lastState = editReducer(lastState, action);
            render();
          },
          pickImage: async (): Promise<{ bytes: Uint8Array; format: "png" | "jpeg" } | null> => pick,
          defaultFont: "Helvetica",
          onCommitTextEdit,
          onCommitTextBox,
          onCommitImageEdit,
          onCommitTextBoxMove,
        }),
      );
    });
  };
  render();
  return {
    host,
    onCommitTextEdit,
    onCommitTextBox,
    onCommitImageEdit,
    onCommitTextBoxMove,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function fire(el: EventTarget, type: string, x: number, y: number, button = 0): void {
  act((): void => {
    el.dispatchEvent(new PointerEvent(type, { bubbles: true, button, clientX: x, clientY: y, pointerId: 1 }));
  });
}

function clickCommit(host: HTMLElement, selector: string): void {
  const btn = host.querySelector<HTMLElement>(selector);
  if (btn === null) throw new Error(`button not found: ${selector}`);
  act((): void => {
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** Type into the inline editor's controlled textarea (React's native
 *  value setter + input event — jsdom has no real typing). */
function typeInto(host: HTMLElement, text: string): void {
  const ta = host.querySelector<HTMLTextAreaElement>("[data-edit-textarea]");
  if (ta === null) throw new Error("textarea not found");
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  act((): void => {
    setter?.call(ta, text);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("DEF-232 — the text-run commit carries the overlay's page", () => {
  it("inline-editor move commit on page 2 reports page 2 (not the viewer's current page)", () => {
    const { host, onCommitTextEdit, unmount } = mountOverlay(2);
    try {
      const layer = host.querySelector<HTMLElement>('[data-tool="text"]');
      if (layer === null) throw new Error("layer not found");
      fire(layer, "pointerdown", 120, 115);
      act((): void => {
        window.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 120, clientY: 115 }));
      });
      const editor = host.querySelector<HTMLElement>(".edit-inline-editor");
      if (editor === null) throw new Error("editor not found");
      editor.getBoundingClientRect = (): DOMRect => {
        const left = Number.parseFloat(editor.style.left) || 0;
        const top = Number.parseFloat(editor.style.top) || 0;
        return { left, top, width: 200, height: 180, right: left + 200, bottom: top + 180, x: left, y: top, toJSON: () => ({}) } as DOMRect;
      };
      const label = host.querySelector<HTMLElement>(".edit-inline-field-font .edit-inline-label");
      if (label === null) throw new Error("label not found");
      fire(label, "pointerdown", 100, 100);
      act((): void => {
        window.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 300, clientY: 220, pointerId: 1 }));
      });
      expect(host.querySelector('[data-edit-confirm="true"]')).not.toBeNull();
      clickCommit(host, '[data-edit-confirm="true"]');
      expect(onCommitTextEdit).toHaveBeenCalledTimes(1);
      const call = onCommitTextEdit.mock.calls[0]?.[0];
      // The moved rect + the original rect (DEF-151) AND the page.
      expect(call.rect).toEqual({ x: 300, y: 220, width: 200, height: 30 });
      expect(call.oldRect).toEqual({ x: 100, y: 100, width: 200, height: 30 });
      expect(call.page).toBe(2);
    } finally {
      unmount();
    }
  });

  it("run-selection-bar Confirm on page 2 reports page 2", () => {
    const { host, onCommitTextEdit, unmount } = mountOverlay(2);
    try {
      const layer = host.querySelector<HTMLElement>('[data-tool="text"]');
      if (layer === null) throw new Error("layer not found");
      // Select the run, drag it +90/+50 on the layer, release.
      fire(layer, "pointerdown", 120, 115);
      fire(layer, "pointermove", 210, 165);
      fire(layer, "pointerup", 210, 165);
      clickCommit(host, '[data-content-action="textrun-confirm"]');
      expect(onCommitTextEdit).toHaveBeenCalledTimes(1);
      const call = onCommitTextEdit.mock.calls[0]?.[0];
      expect(call.page).toBe(2);
      // Geometry only — the run-bar path carries the TextItemGeom's text
      // field on oldRect (pre-existing shape, ignored by the engine).
      expect(call.oldRect).toMatchObject({ x: 100, y: 100, width: 200, height: 30 });
      expect(call.rect).not.toEqual(call.oldRect);
    } finally {
      unmount();
    }
  });

  // DEF-232 siblings — the SAME class of mis-target on the text-box and
  // image commit paths. Both used to read `currentPageOfTab`; both now
  // carry the committing overlay's page.

  it("new text-box commit on page 2 reports page 2", () => {
    const { host, onCommitTextBox, unmount } = mountOverlay(2, "box");
    try {
      const layer = host.querySelector<HTMLElement>('[data-tool="box"]');
      if (layer === null) throw new Error("layer not found");
      // Drag-create a box larger than the 16x16 click threshold, which
      // opens the inline editor for a fresh box.
      fire(layer, "pointerdown", 100, 100);
      fire(layer, "pointermove", 300, 260);
      fire(layer, "pointerup", 300, 260);
      const editor = host.querySelector<HTMLElement>(".edit-inline-editor");
      if (editor === null) throw new Error("editor not found");
      // commit() cancels on empty text, so type a value first.
      typeInto(host, "Box on page 2");
      clickCommit(host, ".edit-inline-btn-commit");
      expect(onCommitTextBox).toHaveBeenCalledTimes(1);
      const call = onCommitTextBox.mock.calls[0]?.[0];
      expect(call.page).toBe(2);
      expect(call.text).toBe("Box on page 2");
    } finally {
      unmount();
    }
  });

  it("image create commit on page 2 reports page 2", async () => {
    const { host, onCommitImageEdit, unmount } = mountOverlay(2, "image", PICKED_PNG);
    try {
      const layer = host.querySelector<HTMLElement>('[data-tool="image"]');
      if (layer === null) throw new Error("layer not found");
      fire(layer, "pointerdown", 100, 100);
      fire(layer, "pointermove", 200, 200);
      // The create path awaits pickImage before committing.
      await act(async (): Promise<void> => {
        layer.dispatchEvent(new PointerEvent("pointerup", {
          bubbles: true, button: 0, clientX: 200, clientY: 200, pointerId: 1,
        }));
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(onCommitImageEdit).toHaveBeenCalledTimes(1);
      const call = onCommitImageEdit.mock.calls[0]?.[0];
      expect(call.op).toBe("replace");
      expect(call.page).toBe(2);
    } finally {
      unmount();
    }
  });
});
