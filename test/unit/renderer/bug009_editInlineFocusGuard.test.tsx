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
  it("the Font SELECT does NOT preventDefault on mousedown (native dropdown opens — B16)", () => {
    // B16 — the old focus guard called e.preventDefault() on the
    // select's mousedown, which blocked the native dropdown from
    // opening. The select must let the browser open the list.
    const { host } = mountEditor();
    const fontSelect = host.querySelector<HTMLSelectElement>(
      ".edit-inline-field-font select",
    );
    expect(fontSelect).not.toBeNull();
    if (fontSelect === null) return;
    expect(dispatchMouseDown(fontSelect)).toBe(false);
  });

  it("the Background SELECT does NOT preventDefault on mousedown when mode is box (B16)", () => {
    const { host } = mountEditor({ mode: "box" });
    const bgSelect = host.querySelector<HTMLSelectElement>(
      ".edit-inline-field-bg select",
    );
    expect(bgSelect).not.toBeNull();
    if (bgSelect === null) return;
    expect(dispatchMouseDown(bgSelect)).toBe(false);
  });

  it("the size number input does NOT preventDefault on mousedown (native spinner / arrows work — DEF-109)", () => {
    // DEF-109 — the old Bug-9 focus guard on the number input
    // suppressed the native spinner/arrow auto-increment (and
    // Chromium's arrow-up), making the size control inert. The
    // guard is REMOVED from the number input; the textarea's onBlur
    // guard keeps the editor mounted because the number input is
    // focusable and inside the editor.
    const { host } = mountEditor();
    const sizeInput = host.querySelector<HTMLInputElement>(
      ".edit-inline-field-size input",
    );
    expect(sizeInput).not.toBeNull();
    if (sizeInput === null) return;
    expect(dispatchMouseDown(sizeInput)).toBe(false);
  });

  it("the color input and the Cancel / Apply buttons still preventDefault on mousedown", () => {
    // The focus-lock is kept where it is actually needed: the color
    // input (not a native dropdown, and its picker opens on click,
    // not on the suppressed default action) and the action buttons.
    const { host } = mountEditor();
    const colorInput = host.querySelector<HTMLInputElement>(
      ".edit-inline-field-color input",
    );
    const cancelBtn = host.querySelector<HTMLButtonElement>(
      ".edit-inline-btn-cancel",
    );
    const commitBtn = host.querySelector<HTMLButtonElement>(
      ".edit-inline-btn-commit",
    );
    for (const el of [colorInput, cancelBtn, commitBtn]) {
      expect(el).not.toBeNull();
    }
    if (
      colorInput === null ||
      cancelBtn === null ||
      commitBtn === null
    ) {
      return;
    }
    for (const el of [colorInput, cancelBtn, commitBtn]) {
      expect(dispatchMouseDown(el)).toBe(true);
    }
  });

  it("clicking the Font select keeps the editor mounted (blur guard — B16)", () => {
    // With the mousedown guard removed, clicking the select moves
    // focus off the textarea. The textarea's onBlur must NOT
    // commit/cancel when the new focus target is inside the
    // editor — otherwise the dropdown would dismiss the editor
    // before the user picks a font. We simulate the real focus
    // transition: blur the textarea with relatedTarget = the
    // select.
    const { host, commit, cancel } = mountEditor();
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement | null;
    const fontSelect = host.querySelector<HTMLSelectElement>(
      ".edit-inline-field-font select",
    );
    expect(textarea).not.toBeNull();
    expect(fontSelect).not.toBeNull();
    if (textarea === null || fontSelect === null) return;
    act((): void => {
      // React's onBlur is wired to the native `focusout` event
      // (which bubbles); a bare `blur` event never reaches React.
      textarea.dispatchEvent(
        new FocusEvent("focusout", { bubbles: true, relatedTarget: fontSelect }),
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
