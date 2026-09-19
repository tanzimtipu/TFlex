// @vitest-environment jsdom
// Bug 9 + B16 — Edit text click does nothing + box dismisses on click.
//
// Part 1: the textarea's onBlur was firing prematurely when the
// user clicked any toolbar button (font / size / color / bg
// picker, Cancel, Apply). The button's mousedown moved focus off
// the textarea, the textarea fired `onBlur`, and the editor
// committed (or cancelled for an empty box) before the click
// reached the button. The original fix called `e.preventDefault()`
// on the toolbar buttons' `onMouseDown` so focus stays on the
// textarea.
//
// B16 (this file's update): the preventDefault guard on the Font /
// Background SELECT elements blocked the native dropdown from
// opening — the user could never change the font. The guard is
// REMOVED from the selects; the focus-lock now lives at the blur
// site: the textarea's onBlur checks where focus is going and
// keeps the editor mounted when the new focus target is inside
// the editor. Text inputs (size / color) and the Cancel / Apply
// buttons keep the mousedown guard.
//
// Part 2: text-tool clicks on text runs were captured by the
// overlay's pointer handler and never reached the editor because
// the editor's own pointer events were redirected by the
// overlay's pointer capture. The fix removes pointer capture for
// the text tool specifically (capture is still needed for the
// drag tools). We exercise the textarea focus-guard below.
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

function dispatchMouseDown(el: Element): boolean {
  let prevented = false;
  act((): void => {
    const evt = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    el.dispatchEvent(evt);
    prevented = evt.defaultPrevented;
  });
  return prevented;
}

describe("Bug 9 / B16 — EditInlineEditor toolbar focus guard", () => {
  it("the retired style controls (font / size / colour / background) are gone — Phase 21", () => {
    // Phase 21 criterion 3 retires the floating style surface; the
    // editor keeps only the grip + action bar. The Bug-9 / B16 /
    // DEF-109 focus-guard questions for those controls are moot.
    const { host } = mountEditor({ mode: "box" });
    expect(host.querySelector(".edit-inline-field-font")).toBeNull();
    expect(host.querySelector(".edit-inline-field-size")).toBeNull();
    expect(host.querySelector(".edit-inline-field-color")).toBeNull();
    expect(host.querySelector(".edit-inline-field-bg")).toBeNull();
    expect(host.querySelector(".edit-inline-toolbar-actions")).not.toBeNull();
  });

  it("the Cancel / Apply buttons still preventDefault on mousedown", () => {
    // The focus-lock is kept where it is actually needed: the action
    // buttons (so the textarea's onBlur cannot commit/cancel before the
    // click reaches the button).
    const { host } = mountEditor();
    const cancelBtn = host.querySelector<HTMLButtonElement>(
      ".edit-inline-btn-cancel",
    );
    const commitBtn = host.querySelector<HTMLButtonElement>(
      ".edit-inline-btn-commit",
    );
    for (const el of [cancelBtn, commitBtn]) {
      expect(el).not.toBeNull();
    }
    if (cancelBtn === null || commitBtn === null) {
      return;
    }
    for (const el of [cancelBtn, commitBtn]) {
      expect(dispatchMouseDown(el)).toBe(true);
    }
  });

  it("focus moving to an in-editor button keeps the editor mounted (blur guard)", () => {
    // With the style controls gone, the remaining focusable targets are
    // the textarea and the action buttons. A focus-out whose
    // relatedTarget is inside the editor must NOT commit/cancel.
    const { host, commit, cancel } = mountEditor();
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement | null;
    const cancelBtn = host.querySelector<HTMLButtonElement>(".edit-inline-btn-cancel");
    expect(textarea).not.toBeNull();
    expect(cancelBtn).not.toBeNull();
    if (textarea === null || cancelBtn === null) return;
    act((): void => {
      textarea.dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, relatedTarget: cancelBtn }),
      );
    });
    // Editor still mounted; nothing committed or cancelled.
    expect(host.querySelector(".edit-inline-editor")).not.toBeNull();
    expect(commit).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("blurring to the page (outside the editor) still commits the edit", () => {
    // The click-outside-commit behaviour is preserved: when focus
    // leaves the editor entirely (relatedTarget null — e.g. a
    // click on the page canvas), the edit commits.
    const { host, commit, cancel } = mountEditor();
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();
    if (textarea === null) return;
    act((): void => {
      textarea.dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, relatedTarget: null }),
      );
    });
    expect(commit).toHaveBeenCalledTimes(1);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("clicking the Cancel button dismisses via onCancel (not the textarea onBlur path)", () => {
    // After the focus-guard fix, clicking Cancel focuses the
    // button (no preventDefault on the click — only on the
    // mousedown for the focus guard). The textarea's onBlur
    // would normally fire on the same tick, but the React render
    // unmounts the editor before onBlur commits. We assert
    // onCancel is the path that fires.
    const { host, commit, cancel } = mountEditor();
    const cancelBtn = host.querySelector<HTMLButtonElement>(
      ".edit-inline-btn-cancel",
    );
    expect(cancelBtn).not.toBeNull();
    if (cancelBtn === null) return;
    act((): void => {
      cancelBtn.click();
    });
    expect(cancel).toHaveBeenCalled();
    // onCommit is the alternative path; it must NOT fire when
    // the user clicks Cancel.
    expect(commit).not.toHaveBeenCalled();
  });
});
