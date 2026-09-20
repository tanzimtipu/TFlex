// @vitest-environment jsdom
//
// Phase 26 — the panel's Text field is the single text-editing surface.
//
// Two halves are covered here:
//   1. TextPropertiesPanel — the `data-txt-text` textarea: value, the
//      disabled/cleared state when nothing text-bearing is selected, the
//      live change report, the session commit on blur, and the
//      focus+select behaviour driven by `focusToken` (a text element was
//      placed or clicked).
//   2. AnnotationOverlay — placing / clicking a text element requests the
//      panel focus and mounts NO in-canvas editor; double-clicking any
//      committed surface (shape, textbox, callout arrow) opens NOTHING.

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { TextPropertiesPanel } from "../../../src/renderer/edit/TextPropertiesPanel";
import { AnnotationOverlay } from "../../../src/renderer/annotations/AnnotationOverlay";
import type { Annotation, AnnotationToolState } from "../../../src/renderer/annotations/model";
import { defaultTextStyleValues } from "../../../src/renderer/edit/textStyle";

const VALUES = defaultTextStyleValues("Helvetica");

const TEXTBOX_ANN: Annotation = {
  id: "tbx-1",
  kind: "textbox",
  page: 1,
  color: "yellow",
  createdAt: "2026-01-01T00:00:00.000Z",
  rect: { x: 100, y: 100, width: 150, height: 40 },
  text: "HELLO",
};

const SELECT_TOOL: AnnotationToolState = { tool: "select", color: "yellow", penWidth: 2 };
const TEXTBOX_TOOL: AnnotationToolState = { tool: "textbox", color: "yellow", penWidth: 2 };

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach((): void => {
  if (root !== null) {
    act((): void => root?.unmount());
    root = null;
  }
  host?.remove();
  host = null;
});

function mountPanel(props: {
  text?: string | null;
  onTextChange?: (text: string) => void;
  onTextCommit?: () => void;
  focusToken?: number;
}): HTMLElement {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  const render = (p: typeof props): void => {
    act((): void => {
      root?.render(
        createElement(TextPropertiesPanel, {
          open: true,
          values: VALUES,
          defaults: VALUES,
          onPatch: (): void => undefined,
          mode: "annotation",
          text: p.text,
          onTextChange: p.onTextChange,
          onTextCommit: p.onTextCommit,
          focusToken: p.focusToken,
        }),
      );
    });
  };
  render(props);
  (host as unknown as { rerender: (p: typeof props) => void }).rerender = render;
  return host;
}

function textareaOf(el: HTMLElement): HTMLTextAreaElement {
  const ta = el.querySelector<HTMLTextAreaElement>("[data-txt-text]");
  if (ta === null) throw new Error("[data-txt-text] not found");
  return ta;
}

function changeValue(el: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  act((): void => {
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("Phase 26 — TextPropertiesPanel: the Text field", () => {
  it("renders at the top of the panel, above the Font group", () => {
    const el = mountPanel({ text: "HELLO" });
    const ta = textareaOf(el);
    const body = el.querySelector("[data-text-panel]");
    if (body === null) throw new Error("panel body not found");
    // The field is the FIRST group in the panel body.
    const firstGroup = body.querySelector(".text-props-group");
    expect(firstGroup?.querySelector("[data-txt-text]")).toBe(ta);
    // The Phase-24 style controls are untouched (criterion 5).
    expect(el.querySelector("[data-txt-font]")).not.toBeNull();
    expect(el.querySelector("[data-txt-bold]")).not.toBeNull();
    expect(el.querySelector("[data-txt-align-left]")).not.toBeNull();
  });

  it("reflects the selected element's text and reports every keystroke", () => {
    const onTextChange = vi.fn();
    const el = mountPanel({ text: "HELLO", onTextChange });
    const ta = textareaOf(el);
    expect(ta.value).toBe("HELLO");
    changeValue(ta, "HELLO WORLD");
    expect(onTextChange).toHaveBeenCalledWith("HELLO WORLD");
  });

  it("is disabled and empty when nothing text-bearing is selected", () => {
    const el = mountPanel({ text: null });
    const ta = textareaOf(el);
    expect(ta.disabled).toBe(true);
    expect(ta.value).toBe("");
    expect(ta.placeholder).toBe("Select a text element to edit");
  });

  it("commits the session ONCE on blur (one undo entry per session)", () => {
    const onTextCommit = vi.fn();
    const el = mountPanel({ text: "HELLO", onTextCommit });
    const ta = textareaOf(el);
    act((): void => {
      ta.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    expect(onTextCommit).toHaveBeenCalledTimes(1);
  });

  it("focuses and SELECTS the whole content when focusToken flips (element placed or clicked)", () => {
    const el = mountPanel({ text: "HELLO", focusToken: 0 });
    const ta = textareaOf(el);
    expect(document.activeElement).not.toBe(ta);
    (el as unknown as { rerender: (p: unknown) => void }).rerender({
      text: "HELLO",
      focusToken: 1,
    });
    expect(document.activeElement).toBe(ta);
    expect(ta.selectionStart).toBe(0);
    expect(ta.selectionEnd).toBe("HELLO".length);
  });
});

// ---------------------------------------------------------------------------
// AnnotationOverlay — placement / click hand the text to the panel.

function mountOverlay(args: {
  annotations?: Annotation[];
  tool?: AnnotationToolState;
}): {
  host: HTMLElement;
  onCreate: ReturnType<typeof vi.fn>;
  onTextFocusRequest: ReturnType<typeof vi.fn>;
  rerender: (annotations: Annotation[], tool: AnnotationToolState) => void;
} {
  host = document.createElement("div");
  host.style.position = "absolute";
  host.style.left = "0px";
  host.style.top = "0px";
  host.style.width = "800px";
  host.style.height = "600px";
  document.body.appendChild(host);
  Element.prototype.setPointerCapture = function (): void {
    /* no-op */
  };
  Element.prototype.releasePointerCapture = function (): void {
    /* no-op */
  };
  root = createRoot(host);
  host.getBoundingClientRect = (): DOMRect => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 800,
    bottom: 600,
    width: 800,
    height: 600,
    toJSON: () => ({}),
  });
  const onCreate = vi.fn();
  const onTextFocusRequest = vi.fn();
  const render = (annotations: Annotation[], tool: AnnotationToolState): void => {
    act((): void => {
      root?.render(
        createElement(AnnotationOverlay, {
          page: 1,
          widthPt: 612,
          heightPt: 792,
          cssScale: 1,
          annotations,
          tool,
          flashId: null,
          getTextItems: (): never[] => [],
          onCreate,
          onFinishedOneShot: (): void => undefined,
          onDeleteAnnotation: (): void => undefined,
          onSelectAnnotation: (): void => undefined,
          onTextFocusRequest,
        }),
      );
    });
  };
  render(args.annotations ?? [], args.tool ?? SELECT_TOOL);
  return { host, onCreate, onTextFocusRequest, rerender: render };
}

function pointer(el: Element, type: string, x: number, y: number): void {
  act((): void => {
    el.dispatchEvent(
      new PointerEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1 }),
    );
  });
}

function click(el: Element): void {
  act((): void => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("Phase 26 — AnnotationOverlay: no in-canvas editor, panel focus on place/click", () => {
  it("placing a textbox creates it immediately, mounts NO editor and requests the panel focus", () => {
    const h = mountOverlay({ tool: TEXTBOX_TOOL });
    const layer = h.host.querySelector("[data-annotation-layer='1']");
    if (layer === null) throw new Error("layer not found");
    pointer(layer, "pointerdown", 120, 160);
    expect(h.onCreate).toHaveBeenCalledTimes(1);
    const created = h.onCreate.mock.calls[0]?.[0] as Annotation;
    expect(created.kind).toBe("textbox");
    expect((created as { text?: string }).text).toBe("");
    // No in-canvas editor of any kind.
    expect(h.host.querySelector("[data-annotation-editor]")).toBeNull();
    expect(h.host.querySelector("[data-annotation-editor-wrap]")).toBeNull();
    expect(h.host.querySelector("textarea")).toBeNull();
    // The panel's Text field is asked to take the text.
    expect(h.onTextFocusRequest).toHaveBeenCalledWith(created.id);
  });

  it("clicking a committed textbox selects it and requests the panel focus; double-click opens nothing", () => {
    const h = mountOverlay({ annotations: [TEXTBOX_ANN] });
    const tbx = h.host.querySelector("[data-annotation-id='tbx-1']");
    if (tbx === null) throw new Error("textbox not found");
    click(tbx);
    expect(h.onTextFocusRequest).toHaveBeenCalledWith("tbx-1");
    expect(h.host.querySelector("[data-content-action-bar='ann-textbox']")).not.toBeNull();
    // No Edit button on the selection chrome (the panel field is the editor).
    expect(h.host.querySelector("[data-content-action$='-edit']")).toBeNull();
    act((): void => {
      tbx.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(h.host.querySelector("[data-annotation-editor]")).toBeNull();
    expect(h.host.querySelector("[data-annotation-color-editor]")).toBeNull();
    expect(h.host.querySelector("[data-move-hint]")).toBeNull();
  });

  it("a shape double-click opens nothing (no in-canvas colour palette)", () => {
    const shape: Annotation = {
      id: "rect-1",
      kind: "rect",
      page: 1,
      color: "red",
      createdAt: "2026-01-01T00:00:00.000Z",
      rect: { x: 100, y: 100, width: 150, height: 80 },
    };
    const h = mountOverlay({ annotations: [shape] });
    const el = h.host.querySelector("[data-annotation-id='rect-1']");
    if (el === null) throw new Error("shape not found");
    act((): void => {
      el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
    });
    expect(h.host.querySelector("[data-annotation-color-editor]")).toBeNull();
    expect(h.host.querySelector("[data-ann-color-edit]")).toBeNull();
    expect(h.host.querySelector(".shape-color-editor")).toBeNull();
    // A shape is not a text target: no panel focus request.
    expect(h.onTextFocusRequest).not.toHaveBeenCalled();
  });

  it("the retired editor symbols are gone from the overlay's module surface", async () => {
    const mod = await import("../../../src/renderer/annotations/AnnotationOverlay");
    const surface = mod as unknown as Record<string, unknown>;
    for (const gone of [
      "TextBoxEditor",
      "NoteEditor",
      "CalloutBoxEditor",
      "CommittedContentEditor",
      "ShapeColorEditor",
    ]) {
      expect(surface[gone], `${gone} must be deleted`).toBeUndefined();
    }
  });
});
