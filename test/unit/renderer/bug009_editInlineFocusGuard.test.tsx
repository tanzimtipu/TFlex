// @vitest-environment jsdom
// Bug 9 — Edit text click does nothing + box dismisses on click.
//
// Part 1: the textarea's onBlur was firing prematurely when the
// user clicked any toolbar button (font / size / color / bg
// picker, Cancel, Apply). The button's mousedown moved focus off
// the textarea, the textarea fired `onBlur`, and the editor
// committed (or cancelled for an empty box) before the click
// reached the button. The fix calls `e.preventDefault()` on the
// toolbar buttons' `onMouseDown` so focus stays on the textarea.
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

function mountEditor(): {
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
      initialText: "Original",
      initialStyle: { font: "Helvetica", size: 12, color: { r: 0, g: 0, b: 0 } },
      mode: "edit",
      onCommit: commit,
      onCancel: cancel,
    });
  }
  act((): void => {
    root.render(createElement(Harness));
  });
  return { host, commit, cancel };
}

describe("Bug 9 — EditInlineEditor toolbar focus guard", () => {
  it("toolbar buttons call preventDefault on mousedown so the textarea keeps focus", () => {
    // The focus guard is the structural fix for "box dismisses on
    // click". Each interactive toolbar control (font / size /
    // color pickers, Cancel, Apply) installs an onMouseDown
    // handler that calls e.preventDefault() — that prevents the
    // browser from moving focus to the control when the user
    // clicks it, so the textarea never fires `onBlur` and the
    // editor stays mounted.
    const { host } = mountEditor();
    const fontSelect = host.querySelector<HTMLSelectElement>(
      ".edit-inline-field-font select",
    );
    const sizeInput = host.querySelector<HTMLInputElement>(
      ".edit-inline-field-size input",
    );
    const colorInput = host.querySelector<HTMLInputElement>(
      ".edit-inline-field-color input",
    );
    const cancelBtn = host.querySelector<HTMLButtonElement>(
      ".edit-inline-btn-cancel",
    );
    const commitBtn = host.querySelector<HTMLButtonElement>(
      ".edit-inline-btn-commit",
    );
    for (const el of [fontSelect, sizeInput, colorInput, cancelBtn, commitBtn]) {
      expect(el).not.toBeNull();
    }
    if (
      fontSelect === null ||
      sizeInput === null ||
      colorInput === null ||
      cancelBtn === null ||
      commitBtn === null
    ) {
      return;
    }
    // Synthesize a mousedown on each control and assert the
    // event's defaultPrevented is true. This is exactly the
    // contract the bug fix relies on — the fix calls
    // `e.preventDefault()` on the React MouseEvent handler.
    for (const el of [fontSelect, sizeInput, colorInput, cancelBtn, commitBtn]) {
      let prevented = false;
      act((): void => {
        const evt = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        // Track whether the React handler called preventDefault.
        // React's synthetic event wraps the native event, so
        // we observe the native event's `defaultPrevented` flag
        // after dispatch.
        el.dispatchEvent(evt);
        prevented = evt.defaultPrevented;
      });
      expect(prevented).toBe(true);
    }
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
