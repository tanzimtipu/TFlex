// @vitest-environment jsdom
// Phase 10 — EditInlineEditor render tests.
//
// The inline editor is the user's primary touch-point for editing
// text. Mount it in jsdom with a few representative inputs and
// assert the resulting DOM — selectors, default values, the
// "background" picker that only renders for new text boxes, etc.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act, createElement, type ReactElement } from "react";
import { EditInlineEditor } from "../../../src/renderer/edit/EditInlineEditor";

function mount(props: {
  initialText: string;
  mode: "edit" | "box";
}): { host: HTMLElement; commit: ReturnType<typeof vi.fn>; cancel: ReturnType<typeof vi.fn> } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const commit = vi.fn();
  const cancel = vi.fn();
  function Harness(): ReactElement {
    return createElement(EditInlineEditor, {
      rect: { x: 50, y: 50, width: 200, height: 30 },
      cssScale: 1,
      initialText: props.initialText,
      initialStyle: { font: "Helvetica", size: 12, color: { r: 0, g: 0, b: 0 } },
      mode: props.mode,
      onCommit: commit,
      onCancel: cancel,
    });
  }
  act((): void => {
    root.render(createElement(Harness));
  });
  return { host, commit, cancel };
}

describe("EditInlineEditor — render", () => {
  it("renders the font / size / color controls", () => {
    const { host } = mount({ initialText: "Hello", mode: "edit" });
    expect(host.querySelector(".edit-inline-field-font")).not.toBeNull();
    expect(host.querySelector(".edit-inline-field-size")).not.toBeNull();
    expect(host.querySelector(".edit-inline-field-color")).not.toBeNull();
    // The textbox mode shows the background picker; the edit mode
    // does not (a text-run replacement always overwrites).
    expect(host.querySelector(".edit-inline-field-bg")).toBeNull();
  });

  it("renders the background picker when mode is 'box'", () => {
    const { host } = mount({ initialText: "", mode: "box" });
    expect(host.querySelector(".edit-inline-field-bg")).not.toBeNull();
  });

  it("pre-fills the textarea with the run's text in edit mode", () => {
    const { host } = mount({ initialText: "Original text", mode: "edit" });
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement | null;
    expect(textarea?.value).toBe("Original text");
  });

  it("the default font is Helvetica (matches settings.editDefaultFont default)", () => {
    const { host } = mount({ initialText: "x", mode: "edit" });
    const select = host.querySelector(".edit-inline-field-font select") as HTMLSelectElement | null;
    expect(select?.value).toBe("Helvetica");
  });
});
