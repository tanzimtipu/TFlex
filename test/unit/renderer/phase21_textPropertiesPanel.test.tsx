// @vitest-environment jsdom
// Phase 21 — TextPropertiesPanel render + control -> patch tests.
//
// The panel is pure/controlled: it renders the host-supplied values and
// reports the smallest `TextBoxStylePatch` per gesture. These tests pin
// the full control surface (every `data-txt-*` hook), the selected-value
// reflection, the patch each control emits, the clamps, and the two
// disabled-with-tooltip controls.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  TextPropertiesPanel,
  clearFormattingPatch,
} from "../../../src/renderer/edit/TextPropertiesPanel";
import { AnnotationOverlay } from "../../../src/renderer/annotations/AnnotationOverlay";
import { DocumentView } from "../../../src/renderer/components/DocumentView";
import type { EngineState } from "../../../src/renderer/engine/types";
import type {
  Annotation,
  AnnotationPatch,
  AnnotationToolState,
} from "../../../src/renderer/annotations/model";
import {
  annotationStyleFromPanelPatch,
  defaultTextStyleValues,
  type TextStyleValues,
} from "../../../src/renderer/edit/textStyle";

const ALL_HOOKS = [
  "[data-txt-font]",
  "[data-txt-size]",
  "[data-txt-bold]",
  "[data-txt-italic]",
  "[data-txt-underline]",
  "[data-txt-super]",
  "[data-txt-sub]",
  "[data-txt-color]",
  "[data-txt-highlight]",
  "[data-txt-highlight-clear]",
  "[data-txt-clear]",
  "[data-txt-align-left]",
  "[data-txt-align-center]",
  "[data-txt-align-right]",
  "[data-txt-align-justify]",
  "[data-txt-line-height]",
  "[data-txt-list-none]",
  "[data-txt-list-bullet]",
  "[data-txt-list-number]",
  "[data-txt-indent-inc]",
  "[data-txt-indent-dec]",
  "[data-txt-character-spacing]",
  "[data-txt-horizontal-scaling]",
];

function mount(
  values: TextStyleValues,
  defaults: TextStyleValues,
  onPatch: (patch: unknown) => void,
  mode?: "text" | "annotation",
): { host: HTMLElement; rerender: (nextMode: "text" | "annotation") => void; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const render = (m: "text" | "annotation" | undefined): void => {
    act((): void => {
      root.render(
        createElement(TextPropertiesPanel, {
          open: true,
          values,
          defaults,
          ...(m === undefined ? {} : { mode: m }),
          onPatch: onPatch as never,
        }),
      );
    });
  };
  render(mode);
  return {
    host: container,
    rerender: (nextMode: "text" | "annotation"): void => render(nextMode),
    cleanup: (): void => {
      act((): void => root.unmount());
      container.remove();
    },
  };
}

/** Drive a controlled form element through React's synthetic onChange. */
function fireChange(el: Element | null, value: string): void {
  const input = el as HTMLInputElement | HTMLSelectElement;
  const proto =
    input instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  act((): void => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function click(el: Element | null): void {
  act((): void => {
    el?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function base(): TextStyleValues {
  return defaultTextStyleValues("Helvetica");
}

describe("TextPropertiesPanel — control surface", () => {
  it("renders every Phase-21 control hook", () => {
    const { host, cleanup } = mount(base(), base(), (): void => undefined);
    for (const hook of ALL_HOOKS) {
      expect(host.querySelector(hook), hook).not.toBeNull();
    }
    expect(host.querySelector("[data-text-panel]")).not.toBeNull();
    cleanup();
  });

  it("reflects the selected object's actual values", () => {
    const values: TextStyleValues = {
      ...base(),
      font: "Times",
      size: 18,
      bold: true,
      italic: true,
      underline: true,
      color: { r: 1, g: 0, b: 0 },
      highlight: { r: 1, g: 1, b: 0 },
      baselineShift: 6,
      align: "center",
      lineHeight: 1.5,
      list: "bullet",
      indent: 24,
    };
    const { host, cleanup } = mount(values, base(), (): void => undefined);
    expect(host.querySelector<HTMLSelectElement>("[data-txt-font]")?.value).toBe("Times");
    expect(host.querySelector<HTMLInputElement>("[data-txt-size]")?.value).toBe("18");
    expect(host.querySelector("[data-txt-bold]")?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector("[data-txt-italic]")?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector("[data-txt-underline]")?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector("[data-txt-super]")?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector<HTMLInputElement>("[data-txt-color]")?.value).toBe("#ff0000");
    expect(host.querySelector<HTMLInputElement>("[data-txt-highlight]")?.value).toBe("#ffff00");
    expect(host.querySelector("[data-txt-align-center]")?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector<HTMLInputElement>("[data-txt-line-height]")?.value).toBe("1.5");
    expect(host.querySelector("[data-txt-list-bullet]")?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector("[data-txt-indent-value]")?.textContent).toBe("24");
    cleanup();
  });

  it("shows the per-tool defaults when nothing is selected", () => {
    const defaults = { ...base(), font: "Courier" as const };
    const { host, cleanup } = mount(defaults, defaults, (): void => undefined);
    expect(host.querySelector<HTMLSelectElement>("[data-txt-font]")?.value).toBe("Courier");
    expect(host.querySelector<HTMLInputElement>("[data-txt-size]")?.value).toBe("12");
    expect(host.querySelector("[data-txt-bold]")?.getAttribute("aria-pressed")).toBe("false");
    expect(host.querySelector<HTMLInputElement>("[data-txt-color]")?.value).toBe("#000000");
    cleanup();
  });
});

describe("TextPropertiesPanel — control -> patch", () => {
  it("emits the right patch for every control", () => {
    const onPatch = vi.fn();
    const values: TextStyleValues = { ...base(), indent: 12 };
    const { host, cleanup } = mount(values, base(), onPatch);

    fireChange(host.querySelector("[data-txt-font]"), "Courier");
    expect(onPatch).toHaveBeenLastCalledWith({ font: "Courier" });

    fireChange(host.querySelector("[data-txt-size]"), "20");
    expect(onPatch).toHaveBeenLastCalledWith({ size: 20 });

    click(host.querySelector("[data-txt-bold]"));
    expect(onPatch).toHaveBeenLastCalledWith({ bold: true });
    click(host.querySelector("[data-txt-italic]"));
    expect(onPatch).toHaveBeenLastCalledWith({ italic: true });
    click(host.querySelector("[data-txt-underline]"));
    expect(onPatch).toHaveBeenLastCalledWith({ underline: true });
    click(host.querySelector("[data-txt-super]"));
    expect(onPatch).toHaveBeenLastCalledWith({ baselineShift: 6 });
    click(host.querySelector("[data-txt-sub]"));
    expect(onPatch).toHaveBeenLastCalledWith({ baselineShift: -6 });

    fireChange(host.querySelector("[data-txt-color]"), "#00ff00");
    expect(onPatch).toHaveBeenLastCalledWith({ color: { r: 0, g: 1, b: 0 } });
    fireChange(host.querySelector("[data-txt-highlight]"), "#ffff00");
    expect(onPatch).toHaveBeenLastCalledWith({ highlight: { r: 1, g: 1, b: 0 } });
    click(host.querySelector("[data-txt-highlight-clear]"));
    expect(onPatch).toHaveBeenLastCalledWith({ highlight: null });

    click(host.querySelector("[data-txt-align-center]"));
    expect(onPatch).toHaveBeenLastCalledWith({ align: "center" });
    click(host.querySelector("[data-txt-align-justify]"));
    expect(onPatch).toHaveBeenLastCalledWith({ align: "justify" });
    fireChange(host.querySelector("[data-txt-line-height]"), "2");
    expect(onPatch).toHaveBeenLastCalledWith({ lineHeight: 2 });
    click(host.querySelector("[data-txt-list-number]"));
    expect(onPatch).toHaveBeenLastCalledWith({ list: "number" });
    click(host.querySelector("[data-txt-indent-inc]"));
    expect(onPatch).toHaveBeenLastCalledWith({ indent: 24 });
    click(host.querySelector("[data-txt-indent-dec]"));
    expect(onPatch).toHaveBeenLastCalledWith({ indent: 0 });

    cleanup();
  });

  it("clear formatting resets every field to the per-tool defaults", () => {
    const onPatch = vi.fn();
    const defaults: TextStyleValues = { ...base(), font: "Times", size: 14, bold: true };
    const { host, cleanup } = mount(
      { ...base(), font: "Courier", size: 40, italic: true, indent: 96 },
      defaults,
      onPatch,
    );
    click(host.querySelector("[data-txt-clear]"));
    expect(onPatch).toHaveBeenLastCalledWith(clearFormattingPatch(defaults));
    const patch = onPatch.mock.calls[onPatch.mock.calls.length - 1]?.[0] as Record<string, unknown>;
    expect(patch.font).toBe("Times");
    expect(patch.size).toBe(14);
    expect(patch.bold).toBe(true);
    expect(patch.italic).toBe(false);
    expect(patch.indent).toBe(0);
    cleanup();
  });
});

describe("TextPropertiesPanel — bounds and disabled controls", () => {
  it("clamps size / line height / indent to their engine bounds", () => {
    const onPatch = vi.fn();
    const { host, cleanup } = mount(
      { ...base(), indent: 188 },
      base(),
      onPatch,
    );
    fireChange(host.querySelector("[data-txt-size]"), "5000");
    expect(onPatch).toHaveBeenLastCalledWith({ size: 2000 });
    fireChange(host.querySelector("[data-txt-size]"), "-5");
    expect(onPatch).toHaveBeenLastCalledWith({ size: 1 });
    fireChange(host.querySelector("[data-txt-line-height]"), "9");
    expect(onPatch).toHaveBeenLastCalledWith({ lineHeight: 5 });
    fireChange(host.querySelector("[data-txt-line-height]"), "0.1");
    expect(onPatch).toHaveBeenLastCalledWith({ lineHeight: 0.5 });
    click(host.querySelector("[data-txt-indent-inc]"));
    expect(onPatch).toHaveBeenLastCalledWith({ indent: 200 });
    cleanup();
  });

  it("ships horizontal scaling disabled; character spacing is live (Phase 27)", () => {
    const { host, cleanup } = mount(base(), base(), (): void => undefined);
    const cs = host.querySelector<HTMLInputElement>("[data-txt-character-spacing]");
    const hs = host.querySelector<HTMLButtonElement>("[data-txt-horizontal-scaling]");
    expect(cs?.disabled).toBe(false);
    expect(hs?.disabled).toBe(true);
    // Phase 27 — the Tc engine limit is gone: the tooltip no longer
    // claims the control is unavailable.
    expect(cs?.getAttribute("title") ?? "").not.toMatch(/not available|not supported/i);
    expect(hs?.getAttribute("title")).toMatch(/Tz|horizontal scaling/i);
    cleanup();
  });
});


// ---------------------------------------------------------------------------
// Phase 24 — the panel is FULLY LIVE for annotation text objects.
//
// Phase 21's per-family scope (annotation mode = colour-only, every other
// control disabled with a "not supported" tooltip) is retired. The control
// matrix is now identical in both modes. Phase 27 retired the Tc control
// from the disabled set (the engine now emits Tc); only the Tz control
// stays disabled, for an engine reason (pdf-lib exposes no Tz operator),
// never a per-family one.

/** Hooks that stay disabled in both modes, for the engine reason. */
const ALWAYS_DISABLED_HOOKS = ["[data-txt-horizontal-scaling]"];

/** Hooks whose disabled state is a VALUE condition, not a mode gate: the
 *  indent-decrement button sits disabled at indent 0 in the base values. */
const VALUE_DISABLED_HOOKS = new Set(["[data-txt-indent-dec]"]);

function disabledFlag(el: Element | null): boolean {
  return (el as HTMLButtonElement | HTMLInputElement | HTMLSelectElement | null)?.disabled ?? false;
}

describe("Phase 24 — annotation mode control matrix", () => {
  it("annotation mode leaves every control live (the retired disabled set)", () => {
    const { host, cleanup } = mount(base(), base(), (): void => undefined, "annotation");
    expect(host.querySelector("[data-text-panel]")?.getAttribute("data-text-panel-mode")).toBe(
      "annotation",
    );
    // The retired "not supported" note is gone from the surface.
    expect(host.querySelector("[data-txt-annotation-note]")).toBeNull();
    for (const hook of ALL_HOOKS) {
      if (ALWAYS_DISABLED_HOOKS.includes(hook) || VALUE_DISABLED_HOOKS.has(hook)) continue;
      expect(disabledFlag(host.querySelector(hook)), hook).toBe(false);
    }
    cleanup();
  });

  it("no control carries the retired annotation tooltip reason", () => {
    const { host, cleanup } = mount(base(), base(), (): void => undefined, "annotation");
    for (const hook of ALL_HOOKS) {
      expect(host.querySelector(hook)?.getAttribute("title") ?? "", hook).not.toMatch(
        /not supported for annotations/i,
      );
    }
    // The colour control keeps its annotation-specific label.
    expect(host.querySelector("[data-txt-color]")?.getAttribute("title")).toBe("Annotation colour");
    cleanup();
  });

  it("the Tz control stays disabled with the engine reason in annotation mode", () => {
    const { host, cleanup } = mount(base(), base(), (): void => undefined, "annotation");
    const cs = host.querySelector<HTMLInputElement>("[data-txt-character-spacing]");
    const hs = host.querySelector<HTMLButtonElement>("[data-txt-horizontal-scaling]");
    expect(cs?.disabled).toBe(false);
    expect(hs?.disabled).toBe(true);
    expect(hs?.getAttribute("title")).toMatch(/Tz|horizontal scaling/i);
    cleanup();
  });

  it("reflects the selected annotation's stored font / size / bold / colour", () => {
    const values: TextStyleValues = {
      ...base(),
      font: "Times",
      size: 18,
      bold: true,
      italic: true,
      align: "center",
      color: { r: 1, g: 0, b: 0 },
    };
    const { host, cleanup } = mount(values, base(), (): void => undefined, "annotation");
    expect(host.querySelector<HTMLSelectElement>("[data-txt-font]")?.value).toBe("Times");
    expect(host.querySelector<HTMLInputElement>("[data-txt-size]")?.value).toBe("18");
    expect(host.querySelector("[data-txt-bold]")?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector("[data-txt-italic]")?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector("[data-txt-align-center]")?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector<HTMLInputElement>("[data-txt-color]")?.value).toBe("#ff0000");
    cleanup();
  });

  it("every control now dispatches its patch in annotation mode", () => {
    const onPatch = vi.fn();
    const { host, cleanup } = mount({ ...base(), indent: 12 }, base(), onPatch, "annotation");
    fireChange(host.querySelector("[data-txt-font]"), "Courier");
    expect(onPatch).toHaveBeenLastCalledWith({ font: "Courier" });
    fireChange(host.querySelector("[data-txt-size]"), "20");
    expect(onPatch).toHaveBeenLastCalledWith({ size: 20 });
    click(host.querySelector("[data-txt-bold]"));
    expect(onPatch).toHaveBeenLastCalledWith({ bold: true });
    click(host.querySelector("[data-txt-italic]"));
    expect(onPatch).toHaveBeenLastCalledWith({ italic: true });
    click(host.querySelector("[data-txt-underline]"));
    expect(onPatch).toHaveBeenLastCalledWith({ underline: true });
    click(host.querySelector("[data-txt-super]"));
    expect(onPatch).toHaveBeenLastCalledWith({ baselineShift: 6 });
    fireChange(host.querySelector("[data-txt-highlight]"), "#ffff00");
    expect(onPatch).toHaveBeenLastCalledWith({ highlight: { r: 1, g: 1, b: 0 } });
    click(host.querySelector("[data-txt-highlight-clear]"));
    expect(onPatch).toHaveBeenLastCalledWith({ highlight: null });
    click(host.querySelector("[data-txt-align-center]"));
    expect(onPatch).toHaveBeenLastCalledWith({ align: "center" });
    fireChange(host.querySelector("[data-txt-line-height]"), "2");
    expect(onPatch).toHaveBeenLastCalledWith({ lineHeight: 2 });
    click(host.querySelector("[data-txt-list-bullet]"));
    expect(onPatch).toHaveBeenLastCalledWith({ list: "bullet" });
    click(host.querySelector("[data-txt-indent-inc]"));
    expect(onPatch).toHaveBeenLastCalledWith({ indent: 24 });
    click(host.querySelector("[data-txt-indent-dec]"));
    expect(onPatch).toHaveBeenLastCalledWith({ indent: 0 });
    click(host.querySelector("[data-txt-clear]"));
    expect(onPatch).toHaveBeenLastCalledWith(clearFormattingPatch(base()));
    fireChange(host.querySelector("[data-txt-color]"), "#00ff00");
    expect(onPatch).toHaveBeenLastCalledWith({ color: { r: 0, g: 1, b: 0 } });
    cleanup();
  });

  it("re-targets the SAME instance when switching annotation <-> text", () => {
    const onPatch = vi.fn();
    const { host, rerender, cleanup } = mount(base(), base(), onPatch, "annotation");
    expect(disabledFlag(host.querySelector("[data-txt-bold]"))).toBe(false);
    click(host.querySelector("[data-txt-bold]"));
    expect(onPatch).toHaveBeenLastCalledWith({ bold: true });
    // Switch to a TFlex-owned text object: still live, same instance.
    rerender("text");
    expect(host.querySelector("[data-text-panel]")?.getAttribute("data-text-panel-mode")).toBe(
      "text",
    );
    click(host.querySelector("[data-txt-bold]"));
    expect(onPatch).toHaveBeenLastCalledWith({ bold: true });
    // And back to an annotation target.
    rerender("annotation");
    expect(host.querySelector("[data-text-panel]")?.getAttribute("data-text-panel-mode")).toBe(
      "annotation",
    );
    expect(disabledFlag(host.querySelector("[data-txt-bold]"))).toBe(false);
    cleanup();
  });

  it("text mode is unaffected: every control stays live", () => {
    const { host, cleanup } = mount(base(), base(), (): void => undefined, "text");
    expect(host.querySelector("[data-text-panel]")?.getAttribute("data-text-panel-mode")).toBe("text");
    expect(host.querySelector("[data-txt-annotation-note]")).toBeNull();
    for (const hook of ALL_HOOKS) {
      if (ALWAYS_DISABLED_HOOKS.includes(hook) || VALUE_DISABLED_HOOKS.has(hook)) continue;
      expect(disabledFlag(host.querySelector(hook)), hook).toBe(false);
    }
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// Phase 21 chunk 3b — the overlay selection conduit the panel re-targets on.

const TEXTBOX_ANN: Annotation = {
  id: "tbx-1",
  kind: "textbox",
  page: 1,
  color: "blue",
  createdAt: "2026-01-01T00:00:00.000Z",
  rect: { x: 200, y: 200, width: 160, height: 60 },
  text: "SOME BOX TEXT",
};

const SELECT_TOOL: AnnotationToolState = { tool: "select", color: "blue", penWidth: 2 };

describe("Phase 21 chunk 3b — annotation selection reporting", () => {
  function mountOverlay(
    ann: Annotation,
    onSelectAnnotation: (a: Annotation | null) => void,
  ): { host: HTMLElement; cleanup: () => void } {
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
    Element.prototype.setPointerCapture = function (): void { /* jsdom no-op */ };
    Element.prototype.releasePointerCapture = function (): void { /* jsdom no-op */ };
    const root = createRoot(host);
    act((): void => {
      root.render(
        createElement(AnnotationOverlay, {
          page: 1,
          widthPt: 612,
          heightPt: 792,
          cssScale: 1,
          annotations: [ann],
          tool: SELECT_TOOL,
          flashId: null,
          getTextItems: (): never[] => [],
          onCreate: (): void => undefined,
          onSelectAnnotation,
        }),
      );
    });
    return {
      host,
      cleanup: (): void => {
        act((): void => root.unmount());
        host.remove();
      },
    };
  }

  it("reports a selected annotation text object and clears on deselect", () => {
    const spy = vi.fn<(a: Annotation | null) => void>();
    const { host, cleanup } = mountOverlay(TEXTBOX_ANN, spy);
    // Nothing selected at mount.
    expect(spy).toHaveBeenLastCalledWith(null);
    const surface = host.querySelector(".ann-textbox[data-annotation-id='tbx-1']");
    expect(surface, "committed textbox surface").not.toBeNull();
    act((): void => {
      surface?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(spy).toHaveBeenLastCalledWith(TEXTBOX_ANN);
    cleanup();
  });
});

// ---------------------------------------------------------------------------
// Phase 21 regression — placing an annotation text object must AUTO-SELECT it.
//
// Operator report: "after placing any text like 'text box', 'comments' etc,
// single or double clicking does not work. The screen just glitches for a
// bit." Root cause: the one-shot text tool disarms in the same tick the
// annotation is committed, so nothing kept the host's text-properties panel
// open — it closed, its 248px reflow moved the page origin, and the user's
// follow-up click on the annotation they had just placed missed.
//
// The overlay is the conduit: it must select the just-placed annotation and
// KEEP that selection across the disarm re-render, so the host's
// `selectedAnnText` branch stays true (panel open, no reflow) while the
// engine's create echo is still in flight.

const TEXTBOX_TOOL: AnnotationToolState = { tool: "textbox", color: "blue", penWidth: 2 };
const RECT_TOOL: AnnotationToolState = { tool: "rect", color: "blue", penWidth: 2 };


function firePointer(
  el: Element,
  type: "pointerdown" | "pointermove" | "pointerup",
  x: number,
  y: number,
): void {
  act((): void => {
    el.dispatchEvent(
      new PointerEvent(type, {
        bubbles: true,
        button: 0,
        clientX: x,
        clientY: y,
        pointerId: 1,
      }),
    );
  });
}

interface PlacementHarness {
  host: HTMLElement;
  rerender: (tool: AnnotationToolState, annotations: Annotation[], cssScale?: number) => void;
  cleanup: () => void;
}

function mountPlacement(args: {
  tool: AnnotationToolState;
  annotations: Annotation[];
  onCreate: (a: Annotation) => void;
  onSelectAnnotation: (a: Annotation | null) => void;
  onFinishedOneShot: () => void;
}): PlacementHarness {
  const host = document.createElement("div");
  host.style.position = "absolute";
  host.style.left = "0px";
  host.style.top = "0px";
  host.style.width = "800px";
  host.style.height = "600px";
  document.body.appendChild(host);
  Element.prototype.setPointerCapture = function (): void { /* jsdom no-op */ };
  Element.prototype.releasePointerCapture = function (): void { /* jsdom no-op */ };
  host.getBoundingClientRect = (): DOMRect => ({
    x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600,
    toJSON: () => ({}),
  });
  const root = createRoot(host);
  const render = (
    tool: AnnotationToolState,
    annotations: Annotation[],
    cssScale = 1,
  ): void => {
    act((): void => {
      root.render(
        createElement(AnnotationOverlay, {
          page: 1,
          widthPt: 612,
          heightPt: 792,
          cssScale,
          annotations,
          tool,
          flashId: null,
          getTextItems: (): never[] => [],
          onCreate: args.onCreate,
          onFinishedOneShot: args.onFinishedOneShot,
          onSelectAnnotation: args.onSelectAnnotation,
        }),
      );
    });
  };
  render(args.tool, args.annotations);
  return {
    host,
    rerender: (tool: AnnotationToolState, annotations: Annotation[], cssScale?: number): void =>
      render(tool, annotations, cssScale),
    cleanup: (): void => {
      act((): void => root.unmount());
      host.remove();
    },
  };
}

/** Phase 26 — place a textbox: pressing the page with the textbox tool
 *  armed creates the annotation immediately (empty text) and hands the
 *  text entry to the panel's Text field. No in-canvas editor mounts. */
function placeTextbox(h: PlacementHarness): void {
  const layer = h.host.querySelector("[data-annotation-layer='1']");
  if (layer === null) throw new Error("annotation layer not found");
  firePointer(layer, "pointerdown", 120, 160);
  if (h.host.querySelector("[data-annotation-editor]") !== null) {
    throw new Error("an in-canvas editor mounted on placement");
  }
}

describe("Phase 21 regression — a placed annotation text object is auto-selected", () => {
  it("selects and reports the placed textbox in the same commit as the disarm", () => {
    const onCreate = vi.fn<(a: Annotation) => void>();
    const onSelect = vi.fn<(a: Annotation | null) => void>();
    const onFinished = vi.fn();
    const h = mountPlacement({
      tool: TEXTBOX_TOOL,
      annotations: [],
      onCreate,
      onSelectAnnotation: onSelect,
      onFinishedOneShot: onFinished,
    });
    try {
      placeTextbox(h);
      expect(onCreate).toHaveBeenCalledTimes(1);
      const created = onCreate.mock.calls[0]?.[0] as Annotation;
      expect(created.kind).toBe("textbox");
      // The selection report carries the SAME object identity the host
      // received through onCreate — the host keeps it while the engine
      // echo is pending, so the panel never dips closed.
      expect(onSelect).toHaveBeenLastCalledWith(created);
      expect(onFinished).toHaveBeenCalledTimes(1);
    } finally {
      h.cleanup();
    }
  });

  it("keeps the placed annotation selected across the one-shot disarm re-render", () => {
    const onCreate = vi.fn<(a: Annotation) => void>();
    const onSelect = vi.fn<(a: Annotation | null) => void>();
    const h = mountPlacement({
      tool: TEXTBOX_TOOL,
      annotations: [],
      onCreate,
      onSelectAnnotation: onSelect,
      onFinishedOneShot: (): void => undefined,
    });
    try {
      placeTextbox(h);
      const created = onCreate.mock.calls[0]?.[0] as Annotation;
      // The host's one-shot disarm: the tool flips to "select" while the
      // engine's create echo has NOT landed yet (annotations still []).
      h.rerender(SELECT_TOOL, []);
      expect(onSelect).toHaveBeenLastCalledWith(created);
      // The placed annotation is still rendered (the local draft stands in
      // for the not-yet-echoed engine entry).
      expect(h.host.querySelector(`[data-annotation-id='${created.id}']`)).not.toBeNull();
      // The echo lands: still selected, no deselect frame in between.
      h.rerender(SELECT_TOOL, [created]);
      expect(onSelect).toHaveBeenLastCalledWith(created);
      expect(h.host.querySelector(`[data-annotation-id='${created.id}']`)).not.toBeNull();
    } finally {
      h.cleanup();
    }
  });

  it("a single click on the placed annotation after the disarm keeps the selection stable", () => {
    const onCreate = vi.fn<(a: Annotation) => void>();
    const onSelect = vi.fn<(a: Annotation | null) => void>();
    const h = mountPlacement({
      tool: TEXTBOX_TOOL,
      annotations: [],
      onCreate,
      onSelectAnnotation: onSelect,
      onFinishedOneShot: (): void => undefined,
    });
    try {
      placeTextbox(h);
      const created = onCreate.mock.calls[0]?.[0] as Annotation;
      h.rerender(SELECT_TOOL, [created]);
      const callsBefore = onSelect.mock.calls.length;
      const surface = h.host.querySelector(`[data-annotation-id='${created.id}']`);
      if (surface === null) throw new Error("placed textbox surface not found");
      // The follow-up single click (the operator's "clicking does not work").
      firePointer(surface, "pointerdown", 130, 170);
      firePointer(surface, "pointerup", 130, 170);
      click(surface);
      // No deselect / re-select churn: the panel's open branch never flips.
      for (const call of onSelect.mock.calls.slice(callsBefore)) {
        expect(call[0]).not.toBeNull();
      }
      expect(onSelect).toHaveBeenLastCalledWith(created);
    } finally {
      h.cleanup();
    }
  });

  it("still clears the selection when the user clicks elsewhere (panel closes)", () => {
    const onCreate = vi.fn<(a: Annotation) => void>();
    const onSelect = vi.fn<(a: Annotation | null) => void>();
    const h = mountPlacement({
      tool: TEXTBOX_TOOL,
      annotations: [],
      onCreate,
      onSelectAnnotation: onSelect,
      onFinishedOneShot: (): void => undefined,
    });
    try {
      placeTextbox(h);
      const created = onCreate.mock.calls[0]?.[0] as Annotation;
      h.rerender(SELECT_TOOL, [created]);
      const layer = h.host.querySelector("[data-annotation-layer='1']");
      if (layer === null) throw new Error("annotation layer not found");
      firePointer(layer, "pointerdown", 400, 500);
      expect(onSelect).toHaveBeenLastCalledWith(null);
    } finally {
      h.cleanup();
    }
  });

  it("does not auto-select a shape placement (the panel is not theirs)", () => {
    const onCreate = vi.fn<(a: Annotation) => void>();
    const onSelect = vi.fn<(a: Annotation | null) => void>();
    const h = mountPlacement({
      tool: RECT_TOOL,
      annotations: [],
      onCreate,
      onSelectAnnotation: onSelect,
      onFinishedOneShot: (): void => undefined,
    });
    try {
      const layer = h.host.querySelector("[data-annotation-layer='1']");
      if (layer === null) throw new Error("annotation layer not found");
      firePointer(layer, "pointerdown", 120, 160);
      firePointer(layer, "pointermove", 220, 260);
      firePointer(layer, "pointerup", 220, 260);
      expect(onCreate).toHaveBeenCalledTimes(1);
      expect((onCreate.mock.calls[0]?.[0] as Annotation).kind).toBe("rect");
      // Only the mount report (null) — a shape placement selects nothing.
      expect(onSelect.mock.calls.length).toBe(1);
      expect(onSelect).toHaveBeenLastCalledWith(null);
    } finally {
      h.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// DEF-253 — a `cssScale` change is NOT a tool change.
//
// The text-properties panel's 248px reflow changes the page's fit scale the
// moment a selection opens or closes it. That `cssScale` re-render used to run
// the same reset as a tool switch and cleared `selectedAnnId`, so clicking an
// EXISTING annotation selected it for ~40ms before the panel dropped closed
// (the placement path was protected by `placedSelectionRef`, a click selection
// had no such guard). Only a deliberate tool switch, or a blank-area click,
// may clear a live selection.

describe("DEF-253 — a cssScale reflow must not clear an annotation selection", () => {
  it("keeps a click-selected annotation selected when cssScale changes", () => {
    const onSelect = vi.fn<(a: Annotation | null) => void>();
    const h = mountPlacement({
      tool: SELECT_TOOL,
      annotations: [TEXTBOX_ANN],
      onCreate: (): void => undefined,
      onSelectAnnotation: onSelect,
      onFinishedOneShot: (): void => undefined,
    });
    try {
      expect(onSelect).toHaveBeenLastCalledWith(null);
      const surface = h.host.querySelector("[data-annotation-id='tbx-1']");
      if (surface === null) throw new Error("committed textbox surface not found");
      firePointer(surface, "pointerdown", 130, 170);
      firePointer(surface, "pointerup", 130, 170);
      click(surface);
      expect(onSelect).toHaveBeenLastCalledWith(TEXTBOX_ANN);
      // The panel's open reflow: the fit scale changes with the selection up.
      h.rerender(SELECT_TOOL, [TEXTBOX_ANN], 0.82);
      expect(onSelect).toHaveBeenLastCalledWith(TEXTBOX_ANN);
      // A further reflow in the other direction keeps it too.
      h.rerender(SELECT_TOOL, [TEXTBOX_ANN], 1);
      expect(onSelect).toHaveBeenLastCalledWith(TEXTBOX_ANN);
      // The report stream never dipped to null after the mount report.
      expect(onSelect.mock.calls.filter((c) => c[0] === null)).toHaveLength(1);
    } finally {
      h.cleanup();
    }
  });

  it("clears the selection on a deliberate tool-kind change (existing behaviour)", () => {
    const onSelect = vi.fn<(a: Annotation | null) => void>();
    const h = mountPlacement({
      tool: SELECT_TOOL,
      annotations: [TEXTBOX_ANN],
      onCreate: (): void => undefined,
      onSelectAnnotation: onSelect,
      onFinishedOneShot: (): void => undefined,
    });
    try {
      const surface = h.host.querySelector("[data-annotation-id='tbx-1']");
      if (surface === null) throw new Error("committed textbox surface not found");
      firePointer(surface, "pointerdown", 130, 170);
      firePointer(surface, "pointerup", 130, 170);
      click(surface);
      expect(onSelect).toHaveBeenLastCalledWith(TEXTBOX_ANN);
      // A real tool switch still resets the selection.
      h.rerender(RECT_TOOL, [TEXTBOX_ANN]);
      expect(onSelect).toHaveBeenLastCalledWith(null);
    } finally {
      h.cleanup();
    }
  });

  it("keeps a freshly placed annotation selected across the disarm + panel reflow", () => {
    const onCreate = vi.fn<(a: Annotation) => void>();
    const onSelect = vi.fn<(a: Annotation | null) => void>();
    const h = mountPlacement({
      tool: TEXTBOX_TOOL,
      annotations: [],
      onCreate,
      onSelectAnnotation: onSelect,
      onFinishedOneShot: (): void => undefined,
    });
    try {
      placeTextbox(h);
      const created = onCreate.mock.calls[0]?.[0] as Annotation;
      expect(onSelect).toHaveBeenLastCalledWith(created);
      // The one-shot disarm AND the panel's reflow in the SAME re-render:
      // the tool flips to "select" and the fit scale changes while the
      // engine's create echo is still in flight (annotations still []).
      h.rerender(SELECT_TOOL, [], 0.78);
      expect(onSelect).toHaveBeenLastCalledWith(created);
      expect(h.host.querySelector(`[data-annotation-id='${created.id}']`)).not.toBeNull();
      // A bare reflow after the echo lands: still selected, still rendered.
      h.rerender(SELECT_TOOL, [created], 0.9);
      expect(onSelect).toHaveBeenLastCalledWith(created);
      expect(h.host.querySelector(`[data-annotation-id='${created.id}']`)).not.toBeNull();
      // No closed frame anywhere in the placement + reflow window.
      expect(onSelect.mock.calls.filter((c) => c[0] === null)).toHaveLength(1);
    } finally {
      h.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 21 regression — the host panel's open state across a placement.
//
// `data-text-panel-open` on `.workspace` is the panel's single source of
// truth; the 248px page reflow rides its open/close transition. The
// regression was that placing an annotation text object flipped it to
// "false" for a frame (armed tool disarmed, nothing selected yet), so the
// page slid out from under the user's follow-up click.

function stubObservers(): void {
  const g = globalThis as unknown as {
    IntersectionObserver?: unknown;
    ResizeObserver?: unknown;
  };
  if (g.IntersectionObserver === undefined) {
    class NoopIntersectionObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
      takeRecords(): IntersectionObserverEntry[] {
        return [];
      }
    }
    g.IntersectionObserver = NoopIntersectionObserver;
  }
  if (g.ResizeObserver === undefined) {
    class NoopResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    g.ResizeObserver = NoopResizeObserver;
  }
}

function makeDocStub(numPages: number): PDFDocumentProxy {
  return {
    numPages,
    async getPage(): Promise<unknown> {
      return {
        view: [0, 0, 612, 792],
        getViewport: (_args: { scale: number }): { width: number; height: number } => ({
          width: 612,
          height: 792,
        }),
        render: (_args: unknown): { promise: Promise<void> } => ({
          promise: Promise.resolve(),
        }),
        cleanup: async (): Promise<void> => undefined,
      };
    },
    destroy: async (): Promise<void> => undefined,
  } as unknown as PDFDocumentProxy;
}

function makeEngineState(pageCount: number): EngineState {
  return {
    pageCount,
    pageOrder: Array.from({ length: pageCount }, (_, i) => i),
    rotations: Array.from({ length: pageCount }, () => 0),
    deleted: Array.from({ length: pageCount }, () => false),
    modified: false,
    annotations: [],
  };
}

function workspacePanelOpen(host: HTMLElement): string | null {
  return host.querySelector(".workspace")?.getAttribute("data-text-panel-open") ?? null;
}

/** Arm the textbox tool the way a user does: open the REVIEW annotations
 *  flyout (Phase 36 chunk 3b — the toolbar row is retired), then use the MRU
 *  row when it is there, otherwise the all-tools dropdown (the default MRU row
 *  is select / highlight / underline / strikeout / ink, so textbox lives in
 *  the menu). */
function armTextboxTool(host: HTMLElement): void {
  const direct = host.querySelector(
    "[data-annotation-toolbar] button[data-tool='textbox']",
  );
  if (direct !== null) {
    click(direct);
    return;
  }
  // The annotation toolbar now lives in the REVIEW dock's flyout.
  const annotate = host.querySelector('[data-dock-verb="annotate"]');
  if (annotate !== null) {
    click(annotate);
  }
  const opened = host.querySelector(
    "[data-annotation-toolbar] button[data-tool='textbox']",
  );
  if (opened !== null) {
    click(opened);
    return;
  }
  const toggle = host.querySelector("[data-ann-dropdown-toggle]");
  if (toggle === null) throw new Error("annotation toolbar dropdown toggle not found");
  click(toggle);
  const menuRow = document.querySelector(
    "[data-ann-dropdown-menu] button[data-tool='textbox']",
  );
  if (menuRow === null) throw new Error("textbox entry not found in the tools menu");
  click(menuRow);
}

describe("Phase 21 regression — the text-properties panel across a placement", () => {
  async function mountDocView(args: {
    onCreateAnnotation: (a: Annotation) => void;
  }): Promise<{ host: HTMLElement; unmount: () => void }> {
    stubObservers();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async (): Promise<void> => {
      root.render(
        createElement(DocumentView, {
          doc: makeDocStub(3),
          pageCount: 3,
          outline: null,
          initial: {
            zoomMode: "fit-width",
            manualScale: 1,
            currentPage: 1,
            searchOpen: false,
            query: "",
            activeHitIndex: -1,
          },
          onPersist: (): void => undefined,
          onDiagnostics: (): void => undefined,
          engineState: makeEngineState(3),
          modified: false,
          canUndo: false,
          saveInPlaceEnabled: false,
          annotations: [],
          formFields: [],
          signatures: [],
          savedSignatures: [],
          stampAnnotations: [],
          onCreateAnnotation: args.onCreateAnnotation,
          // Phase 36 (chunk 3b) — annotations live in the REVIEW stage; the
          // dock's Annotate primary opens their flyout.
          activeStage: "review",
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    return {
      host,
      unmount: (): void => {
        act((): void => root.unmount());
        host.remove();
      },
    };
  }

  it("stays open from arming through placement, then closes on a blank-page click", async () => {
    const onCreateAnnotation = vi.fn<(a: Annotation) => void>();
    const { host, unmount } = await mountDocView({ onCreateAnnotation });
    try {
      const layer = host.querySelector("[data-annotation-layer='1']");
      if (layer === null) throw new Error("page 1 annotation layer did not mount");
      // Closed before any text surface is engaged.
      expect(workspacePanelOpen(host)).toBe("false");
      // Arm the annotation text tool: the panel opens.
      armTextboxTool(host);
      expect(workspacePanelOpen(host)).toBe("true");
      // Place: a page press creates the annotation immediately (Phase 26
      // — the text is typed in the panel's Text field, no editor mounts).
      firePointer(layer, "pointerdown", 10, 10);
      expect(host.querySelector("[data-annotation-editor]")).toBeNull();
      expect(onCreateAnnotation).toHaveBeenCalledTimes(1);
      expect((onCreateAnnotation.mock.calls[0]?.[0] as Annotation).kind).toBe("textbox");
      // The panel's Text field is the live editor and is enabled.
      const field = host.querySelector<HTMLTextAreaElement>("[data-txt-text]");
      expect(field, "the panel Text field is mounted").not.toBeNull();
      expect(field?.disabled).toBe(false);
      // THE REGRESSION: the one-shot disarm must not close the panel. The
      // engine's create echo has not landed either (annotations is still
      // []), so this also pins the host's retention of the reported
      // annotation object.
      expect(workspacePanelOpen(host)).toBe("true");
      expect(host.querySelector("[data-text-panel]")?.getAttribute("data-text-panel-mode")).toBe(
        "annotation",
      );
      // The intentional close path is untouched: a blank-page press
      // deselects and the panel closes (the reflow runs only here).
      firePointer(layer, "pointerdown", 2, 2);
      expect(workspacePanelOpen(host)).toBe("false");
    } finally {
      unmount();
    }
  });

  // Phase 25 — the panel floats INSIDE the page-view area. It is no
  // longer a direct child of the .workspace grid, so opening it cannot
  // take a column or move the page.
  it("mounts the panel inside .workspace-main, not as a workspace grid column", async () => {
    const { host, unmount } = await mountDocView({
      onCreateAnnotation: (): void => undefined,
    });
    try {
      expect(host.querySelector(".workspace-main [data-text-panel]")).toBeNull();
      armTextboxTool(host);
      const panel = host.querySelector(".workspace-main [data-text-panel]");
      expect(panel).not.toBeNull();
      expect(panel?.getAttribute("data-text-panel-mode")).toBe("annotation");
      // The floating wrapper lives in the page-view area only, never as a
      // direct .workspace child (the retired docked column slot).
      expect(host.querySelector(".workspace-main [data-text-panel-float]")).not.toBeNull();
      expect(host.querySelector(".workspace > [data-text-panel-float]")).toBeNull();
      // Header-less: the grip strip is the only chrome.
      expect(host.querySelector(".workspace-main .text-props-header")).toBeNull();
      expect(host.querySelector("[data-drag-grip='text-props']")).not.toBeNull();
    } finally {
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 24 — the host wires the panel to the annotation model.
//
// Three things are pinned end-to-end at the DocumentView boundary:
//   1. a SELECTED annotation text object makes the panel show its STORED
//      style (font / size / bold), not the per-tool defaults;
//   2. a style gesture in annotation mode reaches `editAnnotation` as a
//      `{ style }` payload carrying every patched field;
//   3. a colour gesture keeps the existing colour path and is NEVER
//      double-sent through the style payload.

const STYLED_TEXTBOX: Annotation = {
  id: "tbx-styled",
  kind: "textbox",
  page: 1,
  color: "blue",
  createdAt: "2026-01-01T00:00:00.000Z",
  rect: { x: 100, y: 100, width: 160, height: 60 },
  text: "STYLED BOX",
  style: { font: "Times", size: 18, bold: true, align: "center" },
};

describe("Phase 24 — panel patch -> AnnTextStyle reduction", () => {
  it("keeps every style field and never carries colour", () => {
    const style = annotationStyleFromPanelPatch({
      font: "Times",
      size: 18,
      bold: true,
      italic: true,
      underline: true,
      color: { r: 1, g: 0, b: 0 },
      highlight: { r: 1, g: 1, b: 0 },
      baselineShift: 6,
      align: "center",
      lineHeight: 1.5,
      list: "bullet",
      indent: 24,
    });
    expect(style).toEqual({
      font: "Times",
      size: 18,
      bold: true,
      italic: true,
      underline: true,
      highlight: { r: 1, g: 1, b: 0 },
      baselineShift: 6,
      align: "center",
      lineHeight: 1.5,
      list: "bullet",
      indent: 24,
    });
    expect(Object.prototype.hasOwnProperty.call(style, "color")).toBe(false);
  });

  it("passes highlight:null through to clear the band (Phase 24)", () => {
    // Phase 24 widened AnnTextStyle.highlight to `EditColor | null |
    // undefined`, so the panel's "None" button / clear-formatting removal
    // is now expressible: null means REMOVAL of the stored band, absent
    // preserves it. `annotationStyleFromPanelPatch` forwards null rather
    // than dropping it, matching TextBoxStylePatch semantics.
    const style = annotationStyleFromPanelPatch({ highlight: null, bold: true });
    expect(style).toEqual({ bold: true, highlight: null });
  });

  it("ignores text / background (text-box patch fields, not annotation style)", () => {
    const style = annotationStyleFromPanelPatch({ text: "hi", background: "none", italic: true });
    expect(style).toEqual({ italic: true });
  });
});

describe("Phase 24 — annotation text style wiring", () => {
  async function mountStyledDocView(args: {
    annotations: Annotation[];
    onEditAnnotation: (id: string, patch: AnnotationPatch) => void;
  }): Promise<{ host: HTMLElement; unmount: () => void }> {
    stubObservers();
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async (): Promise<void> => {
      root.render(
        createElement(DocumentView, {
          doc: makeDocStub(3),
          pageCount: 3,
          outline: null,
          initial: {
            zoomMode: "fit-width",
            manualScale: 1,
            currentPage: 1,
            searchOpen: false,
            query: "",
            activeHitIndex: -1,
          },
          onPersist: (): void => undefined,
          onDiagnostics: (): void => undefined,
          engineState: makeEngineState(3),
          modified: false,
          canUndo: false,
          saveInPlaceEnabled: false,
          annotations: args.annotations,
          formFields: [],
          signatures: [],
          savedSignatures: [],
          stampAnnotations: [],
          onCreateAnnotation: (): void => undefined,
          onEditAnnotation: args.onEditAnnotation,
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    return {
      host,
      unmount: (): void => {
        act((): void => root.unmount());
        host.remove();
      },
    };
  }

  /** Click the committed annotation surface so the overlay reports it
   *  selected and the host panel re-targets it. */
  function selectStyledTextbox(host: HTMLElement): void {
    const surface = host.querySelector(".ann-textbox[data-annotation-id='tbx-styled']");
    if (surface === null) throw new Error("styled textbox surface did not mount");
    act((): void => {
      surface.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
  }

  it("shows the selected annotation's stored font / size / bold", async () => {
    const { host, unmount } = await mountStyledDocView({
      annotations: [STYLED_TEXTBOX],
      onEditAnnotation: (): void => undefined,
    });
    try {
      selectStyledTextbox(host);
      const panel = host.querySelector("[data-text-panel]");
      expect(panel?.getAttribute("data-text-panel-mode")).toBe("annotation");
      expect(host.querySelector<HTMLSelectElement>("[data-txt-font]")?.value).toBe("Times");
      expect(host.querySelector<HTMLInputElement>("[data-txt-size]")?.value).toBe("18");
      expect(host.querySelector("[data-txt-bold]")?.getAttribute("aria-pressed")).toBe("true");
      expect(host.querySelector("[data-txt-align-center]")?.getAttribute("aria-pressed")).toBe(
        "true",
      );
      // The annotation's own colour, not the tool default.
      expect(host.querySelector<HTMLInputElement>("[data-txt-color]")?.value).toBe("#3b82f6");
    } finally {
      unmount();
    }
  });

  it("routes a style patch to editAnnotation as a style payload", async () => {
    const onEditAnnotation = vi.fn<(id: string, patch: AnnotationPatch) => void>();
    const { host, unmount } = await mountStyledDocView({
      annotations: [STYLED_TEXTBOX],
      onEditAnnotation,
    });
    try {
      selectStyledTextbox(host);
      fireChange(host.querySelector("[data-txt-font]"), "Courier");
      expect(onEditAnnotation).toHaveBeenCalledTimes(1);
      expect(onEditAnnotation).toHaveBeenLastCalledWith("tbx-styled", { style: { font: "Courier" } });
      // A multi-field patch carries every patched field (no colour key).
      fireChange(host.querySelector("[data-txt-size]"), "22");
      expect(onEditAnnotation).toHaveBeenLastCalledWith("tbx-styled", { style: { size: 22 } });
      click(host.querySelector("[data-txt-bold]"));
      expect(onEditAnnotation).toHaveBeenLastCalledWith("tbx-styled", { style: { bold: false } });
      click(host.querySelector("[data-txt-underline]"));
      expect(onEditAnnotation).toHaveBeenLastCalledWith("tbx-styled", {
        style: { underline: true },
      });
      click(host.querySelector("[data-txt-align-right]"));
      expect(onEditAnnotation).toHaveBeenLastCalledWith("tbx-styled", { style: { align: "right" } });
      fireChange(host.querySelector("[data-txt-line-height]"), "1.6");
      expect(onEditAnnotation).toHaveBeenLastCalledWith("tbx-styled", {
        style: { lineHeight: 1.6 },
      });
      click(host.querySelector("[data-txt-list-bullet]"));
      expect(onEditAnnotation).toHaveBeenLastCalledWith("tbx-styled", { style: { list: "bullet" } });
      click(host.querySelector("[data-txt-indent-inc]"));
      expect(onEditAnnotation).toHaveBeenLastCalledWith("tbx-styled", { style: { indent: 12 } });
    } finally {
      unmount();
    }
  });

  it("routes a colour patch through the colour path only (never double-sent)", async () => {
    const onEditAnnotation = vi.fn<(id: string, patch: AnnotationPatch) => void>();
    const { host, unmount } = await mountStyledDocView({
      annotations: [STYLED_TEXTBOX],
      onEditAnnotation,
    });
    try {
      selectStyledTextbox(host);
      fireChange(host.querySelector("[data-txt-color]"), "#00ff00");
      expect(onEditAnnotation).toHaveBeenCalledTimes(1);
      const [id, patch] = onEditAnnotation.mock.calls[0] ?? [];
      expect(id).toBe("tbx-styled");
      expect(patch).toEqual({ color: "#00ff00" });
      expect(Object.prototype.hasOwnProperty.call(patch, "style")).toBe(false);
    } finally {
      unmount();
    }
  });

  it("clear formatting sends style and colour in ONE call (a single undo step)", async () => {
    const onEditAnnotation = vi.fn<(id: string, patch: AnnotationPatch) => void>();
    const { host, unmount } = await mountStyledDocView({
      annotations: [STYLED_TEXTBOX],
      onEditAnnotation,
    });
    try {
      selectStyledTextbox(host);
      click(host.querySelector("[data-txt-clear]"));
      expect(onEditAnnotation).toHaveBeenCalledTimes(1);
      const [, patch] = onEditAnnotation.mock.calls[0] ?? [];
      // Style fields reset to the per-tool defaults ...
      expect(patch?.style?.font).toBe("Helvetica");
      expect(patch?.style?.size).toBe(12);
      expect(patch?.style?.bold).toBe(false);
      expect(patch?.style?.align).toBe("left");
      // ... and the colour rides the same call, not a second one.
      expect(typeof patch?.color).toBe("string");
    } finally {
      unmount();
    }
  });
});







