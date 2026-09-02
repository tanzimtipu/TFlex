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
import { EditInlineEditor, fontFamilyFor } from "../../../src/renderer/edit/EditInlineEditor";

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

  it("the textarea style applies the chosen font live (B5a)", () => {
    // B5 — the textarea's inline style used to set color + fontSize
    // but NOT fontFamily, so picking Times/Courier in the Font
    // select previewed nothing. The preview must reflect the chosen
    // font immediately.
    const { host } = mount({ initialText: "Hello", mode: "edit" });
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement | null;
    const select = host.querySelector<HTMLSelectElement>(
      ".edit-inline-field-font select",
    );
    expect(textarea).not.toBeNull();
    expect(select).not.toBeNull();
    if (textarea === null || select === null) return;
    // Default: Helvetica stack.
    expect(textarea.style.fontFamily).toContain("Helvetica");
    act((): void => {
      select.value = "Times";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(textarea.style.fontFamily).toContain("Times New Roman");
    act((): void => {
      select.value = "Courier";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(textarea.style.fontFamily).toContain("Courier New");
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

  it("renders an editor panel with a white background and black text — DEF-061", () => {
    // The original defect: the editor's background was tied to
    // `var(--bg-raised)`, which in dark mode resolves to #15181c
    // (near black). The text colour is forced to #000000 because
    // text-run replacements overwrite the original page text, so a
    // dark background plus black text gave the user a "black
    // window" they couldn't read. The panel is now pinned to a
    // white background + black text in both themes (the PDF page
    // is white, the editor sits over it, so white-on-black-text
    // matches the page). This test guards the two key facts:
    //   1. the editor element has no inline `background` style
    //      (the CSS class provides white, an inline override
    //      would clobber the fix).
    //   2. the inline text colour stays black so the user's
    //      committed text is readable on the white panel.
    const { host } = mount({ initialText: "Hello", mode: "edit" });
    const editor = host.querySelector(".edit-inline-editor") as HTMLElement | null;
    expect(editor).not.toBeNull();
    if (editor === null) return;
    // No inline background on the wrapper — the CSS class owns it.
    expect(editor.style.background).toBe("");
    expect(editor.style.backgroundColor).toBe("");
    // The textarea is the visible text surface; its inline color
    // must be black so committed text is readable on the white
    // panel. (The textarea's `background: transparent` is set by
    // the CSS class, not inline — we don't assert it here.)
    const textarea = host.querySelector("textarea") as HTMLTextAreaElement | null;
    expect(textarea).not.toBeNull();
    // `style.color` is the inline declaration. In a browser the
    // computed colour resolves to rgb(0, 0, 0) — we assert the
    // inline declaration is present and parses to black.
    expect(textarea?.style.color).toBe("rgb(0, 0, 0)");
  });
});

describe("fontFamilyFor — B5 live-font mapping", () => {
  it("maps each PDF standard font to a locally-installed CSS stack", () => {
    expect(fontFamilyFor("Helvetica")).toMatch(/Helvetica/);
    expect(fontFamilyFor("Times")).toMatch(/Times New Roman/);
    expect(fontFamilyFor("Courier")).toMatch(/Courier/);
  });

  it("always maps to a serif / monospace / sans stack (never the UI font)", () => {
    // The preview must look like the PDF-standard font family the
    // engine will draw, so picking Times/Courier changes the glyph
    // shapes on screen.
    expect(fontFamilyFor("Times")).toMatch(/serif/);
    expect(fontFamilyFor("Courier")).toMatch(/monospace/);
    expect(fontFamilyFor("Helvetica")).toMatch(/sans-serif/);
  });
});
