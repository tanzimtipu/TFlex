// @vitest-environment jsdom
//
// DEF-105 (B6) — the window-capture pointerdown fix opens the inline
// editor, but the editor then AUTO-CLOSED in the same gesture: the
// editor focused its textarea on mount while the opening pointerdown
// was still being dispatched; Chromium's mousedown focus-clearing
// (the page target is not focusable) immediately blurred the
// textarea with relatedTarget null, onTextareaBlur committed the
// original text, and the editor unmounted ~1ms later. The click
// LOOKED inert (QA: hover hint shows, click does nothing) and a
// no-op engine edit was committed (doc went modified).
//
// The fix: EditInlineEditor defers its mount-focus to the next
// animation frame, so the textarea is NOT focused while the opening
// gesture is in flight — nothing to blur, nothing to auto-commit.
// This file pins that invariant:
//   1. A window pointerdown over a run opens the editor pre-filled.
//   2. Immediately after the gesture, the textarea is NOT focused
//      (the mid-gesture blur cannot fire — the fix).
//   3. After an animation frame, the textarea IS focused (the user
//      can type right away).
//   4. A real outside click afterwards (focusout related null)
//      still commits — the deferred focus doesn't break
//      click-outside-commit.
import { describe, expect, it, vi } from "vitest";
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
  pendingReplace: null,
  cropping: false,
};

function mountTextTool(onCommitTextEdit?: () => void): {
  host: HTMLElement;
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
        onCommitTextEdit: onCommitTextEdit ?? ((): void => undefined),
        onCommitTextBox: (): void => undefined,
        onCommitImageEdit: (): void => undefined,
      }),
    );
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

function runPointerDown(layer: HTMLElement, x: number, y: number): void {
  act((): void => {
    layer.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, clientX: x, clientY: y }),
    );
  });
}

/** Flush one animation frame so the editor's deferred focus lands. */
async function flushFrame(): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame((): void => resolve());
  });
}

describe("DEF-105 — editor stays open: mount-focus deferred past the opening gesture", () => {
  it("a window pointerdown opens the editor pre-filled with the run's text", () => {
    const { host, unmount } = mountTextTool();
    try {
      const layer = host.querySelector("[data-tool='text']") as HTMLElement | null;
      if (layer === null) throw new Error("edit layer not found");
      runPointerDown(layer, 150, 115);
      const editor = host.querySelector("[data-edit-editor='edit']");
      expect(editor).not.toBeNull();
      const textarea = host.querySelector<HTMLTextAreaElement>("[data-edit-textarea]");
      expect(textarea).not.toBeNull();
      expect(textarea?.value).toBe("Hello report");
    } finally {
      unmount();
    }
  });

  it("the textarea is NOT focused during the opening gesture (mid-gesture blur cannot fire)", async () => {
    const { host, unmount } = mountTextTool();
    try {
      const layer = host.querySelector("[data-tool='text']") as HTMLElement | null;
      if (layer === null) throw new Error("edit layer not found");
      runPointerDown(layer, 150, 115);
      const textarea = host.querySelector<HTMLTextAreaElement>("[data-edit-textarea]");
      expect(textarea).not.toBeNull();
      if (textarea === null) return;
      // DEF-105 — the editor must have mounted WITHOUT focusing the
      // textarea. With the pre-fix code the mount-focus ran here and
      // the still-dispatching pointer gesture's focus-clearing
      // blurred it (related null) -> onTextareaBlur committed ->
      // the editor unmounted (the "click is inert" report).
      expect(document.activeElement).not.toBe(textarea);
      // The editor is alive right now (nothing auto-committed).
      expect(host.querySelector("[data-edit-editor='edit']")).not.toBeNull();
      // After the frame, the textarea takes focus so the user can
      // type immediately.
      await act(async (): Promise<void> => {
        await flushFrame();
      });
      expect(document.activeElement).toBe(textarea);
    } finally {
      unmount();
    }
  });

  it("a genuine outside click after the gesture still commits (blur-commit preserved)", async () => {
    const commit = vi.fn();
    const { host, unmount } = mountTextTool(commit);
    try {
      const layer = host.querySelector("[data-tool='text']") as HTMLElement | null;
      if (layer === null) throw new Error("edit layer not found");
      runPointerDown(layer, 150, 115);
      await act(async (): Promise<void> => {
        await flushFrame();
      });
      const textarea = host.querySelector<HTMLTextAreaElement>("[data-edit-textarea]");
      expect(textarea).not.toBeNull();
      if (textarea === null) return;
      expect(document.activeElement).toBe(textarea);
      // A later genuine outside click commits, exactly as designed.
      act((): void => {
        textarea.dispatchEvent(
          new FocusEvent("focusout", { bubbles: true, relatedTarget: null }),
        );
      });
      expect(commit).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
    }
  });
});