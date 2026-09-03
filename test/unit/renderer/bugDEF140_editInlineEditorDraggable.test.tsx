// @vitest-environment jsdom
// DEF-140 — the floating Edit-mode inline editor window cannot be
// dragged / moved. The editor's only onPointerDown called
// stopPropagation + set an inside-press blur-guard flag; there was NO
// pointermove handler that repositioned the window, so the toolbox
// stayed stuck over the text box / page content while the user
// dragged (qa measured dx=0 dy=0 on a 220px/120px drag).
//
// The fix: the toolbar header row doubles as a drag handle. A press
// on its CHROME (label spans, gap, padding — anything that isn't a
// control) records the pointer + the editor's current viewport rect;
// a window pointermove repositions the window via a state offset
// applied on top of the anchored left/top, and pointerup ends the
// drag. Presses on a <select> / <input> / button never start a move.
// The window is clamped within the viewport. The blur-guard and
// click-to-edit / commit paths are untouched.
//
// This file pins the behavior:
//   1. Drag the toolbar chrome -> the editor's style.left/top move by
//      the pointer delta (the window follows the cursor), with the
//      dragging class applied while the gesture is in flight.
//   2. pointerup ends the drag: a later pointermove does not keep
//      moving the window.
//   3. A press + drag starting on a control (the Font select) does NOT
//      move the window.
//   4. Dragging beyond a viewport edge clamps the window at that edge
//      (both bottom-right and top-left directions).
//   5. The drag gesture never closes / commits / cancels the editor,
//      and the inside-press blur guard still keeps the editor mounted
//      when a header-chrome press blurs the textarea to the body.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act, createElement, type ReactElement } from "react";
import { EditInlineEditor } from "../../../src/renderer/edit/EditInlineEditor";

function mountEditor(args?: {
  initialText?: string;
  mode?: "edit" | "box";
}): {
  host: HTMLElement;
  commit: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const commit = vi.fn();
  const cancel = vi.fn();
  function Harness(): ReactElement {
    return createElement(EditInlineEditor, {
      rect: { x: 50, y: 50, width: 200, height: 30 },
      cssScale: 1,
      initialText: args?.initialText ?? "Original",
      initialStyle: { font: "Helvetica", size: 12, color: { r: 0, g: 0, b: 0 } },
      mode: args?.mode ?? "edit",
      onCommit: commit,
      onCancel: cancel,
    });
  }
  act((): void => {
    root.render(createElement(Harness));
  });
  return { host, commit, cancel };
}

/** jsdom does no layout — getBoundingClientRect is all zeros. Stub
 *  the editor's rect so the drag math (delta over the measured
 *  viewport rect + clamping against window.innerWidth/innerHeight)
 *  is exercised with a realistic window. The stub reads the element's
 *  CURRENT inline left/top so a second gesture anchors at the dragged
 *  position, exactly like a browser's layout rect tracks the window
 *  as it moves. */
function stubEditorRect(host: HTMLElement): HTMLElement {
  const editor = host.querySelector(".edit-inline-editor") as HTMLElement | null;
  expect(editor).not.toBeNull();
  if (editor === null) throw new Error("editor not found");
  editor.getBoundingClientRect = (): DOMRect => {
    const left = Number.parseFloat(editor.style.left) || 0;
    const top = Number.parseFloat(editor.style.top) || 0;
    return {
      left,
      top,
      width: 200,
      height: 182,
      right: left + 200,
      bottom: top + 182,
      x: left,
      y: top,
      toJSON: (): Record<string, never> => ({}),
    } as DOMRect;
  };
  return editor;
}

function toolbarEl(host: HTMLElement): HTMLElement {
  const toolbar = host.querySelector<HTMLElement>(".edit-inline-toolbar");
  expect(toolbar).not.toBeNull();
  if (toolbar === null) throw new Error("toolbar not found");
  return toolbar;
}

describe("DEF-140 — the inline editor window is draggable by its toolbar header", () => {
  it("dragging the toolbar chrome moves the editor by the pointer delta", () => {
    const { host } = mountEditor({ initialText: "Hello", mode: "edit" });
    const editor = stubEditorRect(host);
    const toolbar = toolbarEl(host);
    // Anchored at rect (50,50) with no drag offset yet.
    expect(editor.style.left).toBe("50px");
    expect(editor.style.top).toBe("50px");

    act((): void => {
      toolbar.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 100, clientY: 100 }),
      );
    });
    // While the drag is in flight the window carries the dragging
    // class (the grab->grabbing affordance) and follows the cursor.
    expect(editor.classList.contains("edit-inline-dragging")).toBe(true);
    act((): void => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, clientX: 220, clientY: 180 }),
      );
    });
    // +120/+80 of pointer travel -> the window's left/top move by the
    // same deltas over the anchored position.
    expect(editor.style.left).toBe("170px");
    expect(editor.style.top).toBe("130px");
  });

  it("pointerup ends the drag — a later pointermove does not keep moving the window", () => {
    const { host } = mountEditor({ initialText: "Hello", mode: "edit" });
    const editor = stubEditorRect(host);
    const toolbar = toolbarEl(host);
    act((): void => {
      toolbar.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 100, clientY: 100 }),
      );
    });
    act((): void => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, clientX: 200, clientY: 150 }),
      );
    });
    expect(editor.style.left).toBe("150px");
    expect(editor.style.top).toBe("100px");
    act((): void => {
      window.dispatchEvent(
        new PointerEvent("pointerup", { bubbles: true, clientX: 200, clientY: 150 }),
      );
    });
    expect(editor.classList.contains("edit-inline-dragging")).toBe(false);
    // Post-release move: the window must stay where the drag ended.
    act((): void => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, clientX: 400, clientY: 300 }),
      );
    });
    expect(editor.style.left).toBe("150px");
    expect(editor.style.top).toBe("100px");
  });

  it("a cancelled pointer (OS gesture steal) also ends the drag", () => {
    const { host } = mountEditor({ initialText: "Hello", mode: "edit" });
    const editor = stubEditorRect(host);
    const toolbar = toolbarEl(host);
    act((): void => {
      toolbar.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 100, clientY: 100 }),
      );
    });
    expect(editor.classList.contains("edit-inline-dragging")).toBe(true);
    // The OS cancels the pointer (Alt-Tab / gesture steal): the drag
    // must end and a later move must not keep repositioning.
    act((): void => {
      window.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true }));
    });
    expect(editor.classList.contains("edit-inline-dragging")).toBe(false);
    act((): void => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, clientX: 400, clientY: 300 }),
      );
    });
    expect(editor.style.left).toBe("50px");
    expect(editor.style.top).toBe("50px");
  });

  it("a drag starting on the Font select does NOT move the window (controls keep their own presses)", () => {
    const { host } = mountEditor({ initialText: "Hello", mode: "edit" });
    const editor = stubEditorRect(host);
    const fontSelect = host.querySelector<HTMLSelectElement>(
      ".edit-inline-field-font select",
    );
    expect(fontSelect).not.toBeNull();
    if (fontSelect === null) return;
    act((): void => {
      fontSelect.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 100, clientY: 100 }),
      );
    });
    // No drag started, so a move does nothing.
    expect(editor.classList.contains("edit-inline-dragging")).toBe(false);
    act((): void => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, clientX: 220, clientY: 180 }),
      );
    });
    expect(editor.style.left).toBe("50px");
    expect(editor.style.top).toBe("50px");
  });

  it("dragging beyond a viewport edge clamps the window at that edge", () => {
    const { host } = mountEditor({ initialText: "Hello", mode: "edit" });
    const editor = stubEditorRect(host);
    const toolbar = toolbarEl(host);
    // Drag far past the bottom-right: the window stops with its right
    // edge at the viewport's right edge and its bottom at the bottom.
    act((): void => {
      toolbar.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 100, clientY: 100 }),
      );
    });
    act((): void => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, clientX: 5100, clientY: 5100 }),
      );
    });
    expect(editor.style.left).toBe(`${window.innerWidth - 200}px`);
    expect(editor.style.top).toBe(`${window.innerHeight - 182}px`);
    // New gesture, drag far past the top-left: the window stops at the
    // viewport origin.
    act((): void => {
      window.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    });
    act((): void => {
      toolbar.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 100, clientY: 100 }),
      );
    });
    act((): void => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, clientX: -4900, clientY: -4900 }),
      );
    });
    expect(editor.style.left).toBe("0px");
    expect(editor.style.top).toBe("0px");
  });

  it("the drag gesture never closes / commits / cancels, and the inside-press blur guard stays intact", () => {
    const { host, commit, cancel } = mountEditor({ initialText: "Hello", mode: "edit" });
    const editor = stubEditorRect(host);
    // A label span is drag chrome (not a control): pressing it starts
    // a move, exactly the DEF-140 reproduction surface.
    const label = host.querySelector<HTMLElement>(
      ".edit-inline-field-font .edit-inline-label",
    );
    expect(label).not.toBeNull();
    if (label === null) return;
    act((): void => {
      label.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 100, clientY: 100 }),
      );
    });
    act((): void => {
      window.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, clientX: 160, clientY: 140 }),
      );
    });
    // Mid-gesture: the editor is still mounted and nothing committed
    // or cancelled.
    expect(editor.style.left).toBe("110px");
    expect(editor.style.top).toBe("90px");
    expect(host.querySelector(".edit-inline-editor")).not.toBeNull();
    expect(commit).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    // The non-focusable label press blurs the textarea to the body
    // (relatedTarget null) — the DEF-110 inside-press guard must keep
    // the editor open even while the drag handle is in use.
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();
    if (textarea === null) return;
    act((): void => {
      textarea.dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, relatedTarget: null }),
      );
    });
    expect(host.querySelector(".edit-inline-editor")).not.toBeNull();
    expect(commit).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });
});