// @vitest-environment jsdom
// DEF-110 — pressing a NON-focusable part of the edit context
// window (a toolbar label span / the bar chrome) was treated as an
// outside click. mousedown there moves focus from the textarea to
// the body, the textarea's onBlur fires with relatedTarget null, the
// blur guard only bailed when the new focus target was inside
// `.edit-inline-editor`, and the editor committed/cancelled and
// unmounted — a click on its own chrome closed it.
//
// The cross-cutting rule (B2c + B6): a context window must NOT close
// on ANY click inside the window (bar, label, chrome); it closes only
// on an explicit Cancel/Apply or a genuine outside click. The note /
// textbox / callout editors and the sign pending bar already satisfy
// this (no blur-commit path; wrapper pointerdown stopPropagation +
// interactive-ancestor walks); EditInlineEditor is the only editor
// with a blur-commit path, so the fix lives in its blur guard: a
// pointer press that STARTS inside the editor keeps it mounted.
//
// This file pins the behavior:
//   1. Pointerdown on a toolbar label span + textarea blur to the
//      body (relatedTarget null) -> editor STAYS mounted.
//   2. Same press on the toolbar bar's blank chrome -> still open.
//   3. After the inside press settles, a fresh genuine outside
//      focusout (no inside press in this gesture) still commits.
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
  unmount: () => void;
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
  return {
    host,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
    commit,
    cancel,
  };
}

/** Press a non-focusable element inside the editor (bubbling to the
 *  editor's onPointerDown, which records the inside press), then blur
 *  the textarea to the body with relatedTarget null — exactly what
 *  Chromium does when mousedown lands on a non-focusable label. */
function pressInsideThenBlurToBody(
  host: HTMLElement,
  target: Element,
): void {
  act((): void => {
    target.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
    );
  });
  const textarea = host.querySelector("textarea") as HTMLTextAreaElement | null;
  if (textarea === null) throw new Error("textarea not found");
  act((): void => {
    textarea.dispatchEvent(
      new FocusEvent("focusout", { bubbles: true, relatedTarget: null }),
    );
  });
}

describe("DEF-110 — a press on the editor's own chrome keeps the editor open", () => {
  it("pointerdown on the 'Font' label span + blur to body does NOT close / commit / cancel", () => {
    const { host, commit, cancel, unmount } = mountEditor();
    try {
      const label = host.querySelector<HTMLElement>(".edit-inline-field-font .edit-inline-label");
      expect(label).not.toBeNull();
      if (label === null) return;
      pressInsideThenBlurToBody(host, label);
      // The editor must stay mounted — the label press was inside
      // the window, not an outside click.
      expect(host.querySelector(".edit-inline-editor")).not.toBeNull();
      expect(commit).not.toHaveBeenCalled();
      expect(cancel).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });

  it("pointerdown on the toolbar bar's blank chrome + blur to body does NOT close / commit / cancel", () => {
    const { host, commit, cancel, unmount } = mountEditor();
    try {
      const bar = host.querySelector<HTMLElement>(".edit-inline-toolbar");
      expect(bar).not.toBeNull();
      if (bar === null) return;
      pressInsideThenBlurToBody(host, bar);
      expect(host.querySelector(".edit-inline-editor")).not.toBeNull();
      expect(commit).not.toHaveBeenCalled();
      expect(cancel).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });

  it("blur to body WITHOUT an inside press (genuine outside click) still commits", () => {
    // The click-outside-commit behaviour is preserved: no pointerdown
    // happened inside the editor, so the flag is clear and the blur
    // is a genuine outside click — it must commit.
    const { host, commit, cancel, unmount } = mountEditor();
    try {
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
    } finally {
      unmount();
    }
  });

  it("after an inside press settles, the NEXT genuine outside click commits (no stale guard)", async () => {
    // The inside-press flag is cleared a tick after the press, so a
    // later real outside click (its own gesture, no inside press)
    // still commits.
    const { host, commit, cancel, unmount } = mountEditor();
    try {
      const label = host.querySelector<HTMLElement>(".edit-inline-field-color .edit-inline-label");
      expect(label).not.toBeNull();
      if (label === null) return;
      // First: an inside press on a label keeps the editor open.
      pressInsideThenBlurToBody(host, label);
      expect(host.querySelector(".edit-inline-editor")).not.toBeNull();
      expect(commit).not.toHaveBeenCalled();
      // Wait for the inside-press flag to clear.
      await act(async (): Promise<void> => {
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
      });
      // Second: a fresh outside blur now commits.
      const textarea = host.querySelector("textarea") as HTMLTextAreaElement | null;
      if (textarea === null) throw new Error("textarea not found");
      act((): void => {
        textarea.dispatchEvent(
          new FocusEvent("focusout", { bubbles: true, relatedTarget: null }),
        );
      });
      expect(commit).toHaveBeenCalledTimes(1);
      expect(cancel).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });

  it("a focus-out to a focusable control inside the editor still keeps it open (bar select — regression)", () => {
    // B16 guard unchanged: focus moving to the font select inside the
    // editor (relatedTarget non-null, inside the editor) keeps the
    // editor mounted.
    const { host, commit, cancel, unmount } = mountEditor();
    try {
      const fontSelect = host.querySelector<HTMLSelectElement>(
        ".edit-inline-field-font select",
      );
      const textarea = host.querySelector("textarea") as HTMLTextAreaElement | null;
      expect(fontSelect).not.toBeNull();
      expect(textarea).not.toBeNull();
      if (fontSelect === null || textarea === null) return;
      act((): void => {
        textarea.dispatchEvent(
          new FocusEvent("focusout", { bubbles: true, relatedTarget: fontSelect }),
        );
      });
      expect(host.querySelector(".edit-inline-editor")).not.toBeNull();
      expect(commit).not.toHaveBeenCalled();
      expect(cancel).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });
});