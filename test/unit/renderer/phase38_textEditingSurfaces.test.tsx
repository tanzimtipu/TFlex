// @vitest-environment jsdom
//
// Phase 38 — features C and D on the text-editing surfaces.
//
//   C. The legacy floating text-manipulation panel (and its drag) is retired:
//      the Inspector's text block is the ONLY surface, and no capability loses
//      its home (the armed-tool defaults and the REVIEW text annotation both
//      reach the Inspector; the Ctrl+K palette rows are untouched).
//   D. Editing text looks like editing the original: the canvas editor renders
//      at the SOURCE run's size (no shrink), the original glyphs are fully
//      covered (descent included), and selecting a text object focuses the
//      Inspector's text field so typing needs no manual click.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import {
  Inspector,
  inspectorSelectionFor,
  inspectorTextPanelFor,
  type InspectorTextSelection,
} from "../../../src/renderer/components/Inspector";
import { TextPropertiesPanel } from "../../../src/renderer/edit/TextPropertiesPanel";
import { EditOverlay } from "../../../src/renderer/edit/EditOverlay";
import { initialEditState, type EditState, type EditTextStyle } from "../../../src/renderer/edit/model";
import type { TextItemGeom } from "../../../src/renderer/annotations/AnnotationOverlay";
import {
  runSourceTextStyle,
  textStyleValuesFromStyle,
  editTextStyleFromValues,
  defaultTextStyleValues,
} from "../../../src/renderer/edit/textStyle";

const ROOT = resolve(__dirname, "../../..");

function css(el: Element): CSSStyleDeclaration {
  return window.getComputedStyle(el as HTMLElement);
}

// ---------------------------------------------------------------------------
// Inspector mounts (feature C — the one surface).
// ---------------------------------------------------------------------------

function snapshot(overrides: Partial<InspectorTextSelection> = {}): InspectorTextSelection {
  const values = defaultTextStyleValues("Helvetica");
  return {
    targetKey: "box:box-1",
    name: "Text object",
    values,
    defaults: values,
    mode: "text",
    text: "STYLED TEXT",
    onPatch: vi.fn(),
    onTextChange: vi.fn(),
    onTextCommit: vi.fn(),
    focusToken: 1,
    ...overrides,
  };
}

function mountInspector(
  stage: "edit" | "review",
  text: InspectorTextSelection | null,
): { host: HTMLElement; unmount: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(
      createElement(Inspector, {
        stage,
        selection: inspectorSelectionFor({ stage, text, signatureLabel: null, page: 1 }),
        textPanel: inspectorTextPanelFor(text),
      }),
    );
  });
  return {
    host,
    unmount: (): void => {
      act((): void => root.unmount());
      host.remove();
    },
  };
}

describe("Phase 38 feature C — the Inspector is the one text surface", () => {
  it("renders one panel with no float attribute, no grip and no drag handle", () => {
    const { host, unmount } = mountInspector("edit", snapshot());
    try {
      expect(host.querySelectorAll(".text-props-panel")).toHaveLength(1);
      expect(host.querySelector("[data-inspector-text-panel]")).not.toBeNull();
      expect(host.querySelector("[data-text-panel]")).not.toBeNull();
      // The retired floating chrome is absent on the Inspector instance too.
      expect(host.querySelector("[data-text-panel-float]")).toBeNull();
      expect(host.querySelector("[data-text-panel-grip]")).toBeNull();
      expect(host.querySelector(".text-props-grip")).toBeNull();
      expect(host.querySelector("[data-drag-grip='text-props']")).toBeNull();
    } finally {
      unmount();
    }
  });

  it("arms the text tool with nothing selected: the defaults render in the Inspector", () => {
    // An armed text tool publishes a snapshot with `text: null`; this is the
    // case the retired floating card used to host.
    const armed = snapshot({ targetKey: "none", text: null, mode: "annotation", name: "Text annotation" });
    const { host, unmount } = mountInspector("review", armed);
    try {
      expect(host.querySelector("[data-inspector-text-panel]")).not.toBeNull();
      const field = host.querySelector<HTMLTextAreaElement>("[data-txt-text]");
      expect(field).not.toBeNull();
      expect(field?.disabled).toBe(true);
      expect(host.querySelector("[data-txt-font]")).not.toBeNull();
      expect(host.querySelector("[data-txt-bold]")).not.toBeNull();
    } finally {
      unmount();
    }
  });

  it("a text annotation selected in REVIEW renders editable in the Inspector", () => {
    const ann = snapshot({ targetKey: "ann:a1", mode: "annotation", name: "Text annotation" });
    const { host, unmount } = mountInspector("review", ann);
    try {
      expect(host.querySelector("[data-inspector-text-panel]")).not.toBeNull();
      const field = host.querySelector<HTMLTextAreaElement>("[data-txt-text]");
      expect(field?.disabled).toBe(false);
      expect(field?.value).toBe("STYLED TEXT");
    } finally {
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// DocumentView source seam: it renders no pop-out and publishes the surface.
// ---------------------------------------------------------------------------

describe("Phase 38 feature C — the DocumentView publishes, never mounts", () => {
  const code = readFileSync(resolve(ROOT, "src/renderer/components/DocumentView.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("mounts no TextPropertiesPanel and no float attribute", () => {
    expect(code).not.toContain("<TextPropertiesPanel");
    expect(code).not.toContain("data-text-panel-float");
    expect(code).not.toContain("resolveFloatingTextPanelOpen");
  });

  it("publishes a text surface for a target OR an armed tool with no target", () => {
    expect(code).toContain("const textPanelSelectionActive = textPanelOpen || textTarget !== null;");
    expect(code).toContain("if (!textPanelSelectionActive) return null;");
  });

  it("seeds a selected run from its SOURCE rect (feature D)", () => {
    expect(code).toContain("runSourceTextStyle(editTextTarget.rect.height");
    expect(code).toContain("pendingTextStyle ?? selectedRunValues ?? textPanelDefaults");
  });
});

// ---------------------------------------------------------------------------
// Feature D — the editor renders the SOURCE run's size and covers the original.
// ---------------------------------------------------------------------------

function mountRunEditor(
  item: TextItemGeom,
  cssScale: number,
): { host: HTMLElement; unmount: () => void } {
  const host = document.createElement("div");
  host.style.position = "absolute";
  host.style.left = "0px";
  host.style.top = "0px";
  host.style.width = "800px";
  host.style.height = "600px";
  document.body.appendChild(host);
  const root = createRoot(host);
  // The host seeds the panel/editor from the run's source rect (feature D) —
  // exactly what DocumentView's `selectedRunValues` does.
  const textStyle: EditTextStyle = editTextStyleFromValues(
    textStyleValuesFromStyle(runSourceTextStyle(item.height, "Helvetica")),
  );
  const editState: EditState = { ...initialEditState, tool: "text" };
  act((): void => {
    root.render(
      createElement(EditOverlay, {
        page: 1,
        pageWidthPt: 612,
        pageHeightPt: 792,
        cssScale,
        tool: "text",
        getTextItems: (): TextItemGeom[] => [item],
        edit: editState,
        dispatch: (): void => undefined,
        pickImage: async (): Promise<null> => null,
        defaultFont: "Helvetica",
        onCommitTextEdit: ((): void => undefined) as never,
        onCommitTextBox: (): void => undefined,
        onCommitImageEdit: (): void => undefined,
        onCommitTextBoxMove: (): void => undefined,
        textStyle,
      }),
    );
  });
  return {
    host,
    unmount: (): void => {
      act((): void => root.unmount());
      host.remove();
    },
  };
}

function selectRun(host: HTMLElement, item: TextItemGeom, cssScale: number): void {
  const layer = host.querySelector<HTMLElement>(".edit-layer");
  if (layer === null) throw new Error("edit layer not found");
  act((): void => {
    layer.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: (item.x + 10) * cssScale,
        clientY: (item.y + item.height / 2) * cssScale,
        pointerId: 1,
      }),
    );
  });
}

describe("Phase 38 feature D — edit renders at the source run size, glyphs covered", () => {
  it("runSourceTextStyle uses the run's font height as the source size", () => {
    // pdf.js reports the run's font size as TextItem.height (device space).
    expect(runSourceTextStyle(20, "Helvetica").size).toBe(20);
    expect(runSourceTextStyle(37, "Times").size).toBe(37);
  });

  it("renders the live run preview at the source size at zoom 1", () => {
    const item: TextItemGeom = { x: 100, y: 100, width: 200, height: 20, text: "Source run" };
    const { host, unmount } = mountRunEditor(item, 1);
    try {
      selectRun(host, item, 1);
      const preview = host.querySelector<HTMLElement>("[data-edit-run-preview]");
      expect(preview, "the run preview mounts on selection").not.toBeNull();
      // Source size = 20pt -> 20px at scale 1 (not the 12pt tool default).
      expect(css(preview as Element).fontSize).toBe("20px");
      // The cover extends past the baseline so the original descenders are
      // hidden too (height 20 -> 25 with the descent pad).
      const eraser = host.querySelector<HTMLElement>("[data-edit-box-eraser]");
      expect(eraser).not.toBeNull();
      expect(eraser?.style.height).toBe("25px");
    } finally {
      unmount();
    }
  });

  it("renders the live run preview at the source size at zoom 2", () => {
    const item: TextItemGeom = { x: 50, y: 60, width: 240, height: 30, text: "Zoomed run" };
    const { host, unmount } = mountRunEditor(item, 2);
    try {
      selectRun(host, item, 2);
      const preview = host.querySelector<HTMLElement>("[data-edit-run-preview]");
      expect(preview).not.toBeNull();
      // Source size = 30pt -> 60px at scale 2.
      expect(css(preview as Element).fontSize).toBe("60px");
    } finally {
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// Feature D — selecting a text object focuses the Inspector's text field.
// ---------------------------------------------------------------------------

describe("Phase 38 feature D — the focus token lands on the text field", () => {
  function mountPanel(props: { text: string | null; focusToken: number }): {
    host: HTMLElement;
    rerender: (p: { text: string | null; focusToken: number }) => void;
    unmount: () => void;
  } {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const values = defaultTextStyleValues("Helvetica");
    const render = (p: { text: string | null; focusToken: number }): void => {
      act((): void => {
        root.render(
          createElement(TextPropertiesPanel, {
            open: true,
            values,
            defaults: values,
            mode: "text",
            onPatch: (): void => undefined,
            text: p.text,
            focusToken: p.focusToken,
          }),
        );
      });
    };
    render(props);
    return {
      host,
      rerender: render,
      unmount: (): void => {
        act((): void => root.unmount());
        host.remove();
      },
    };
  }

  it("focuses and selects when the token flips", () => {
    const m = mountPanel({ text: "HELLO", focusToken: 0 });
    try {
      const ta = m.host.querySelector<HTMLTextAreaElement>("[data-txt-text]");
      expect(ta).not.toBeNull();
      expect(document.activeElement).not.toBe(ta);
      m.rerender({ text: "HELLO", focusToken: 1 });
      expect(document.activeElement).toBe(ta);
      expect(ta?.selectionStart).toBe(0);
      expect(ta?.selectionEnd).toBe("HELLO".length);
    } finally {
      m.unmount();
    }
  });

  it("focuses on a FRESH mount that already carries the token (Inspector remount)", () => {
    // The Inspector's text block mounts for the first time with the token
    // already bumped; the retired initialisation saw no change and never
    // focused.
    const m = mountPanel({ text: "HELLO", focusToken: 1 });
    try {
      const ta = m.host.querySelector<HTMLTextAreaElement>("[data-txt-text]");
      expect(document.activeElement).toBe(ta);
    } finally {
      m.unmount();
    }
  });

  it("does not steal focus on a mount with no request (token 0)", () => {
    const m = mountPanel({ text: "HELLO", focusToken: 0 });
    try {
      const ta = m.host.querySelector<HTMLTextAreaElement>("[data-txt-text]");
      expect(document.activeElement).not.toBe(ta);
    } finally {
      m.unmount();
    }
  });
});

