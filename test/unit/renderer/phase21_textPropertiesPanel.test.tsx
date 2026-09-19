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
import {
  ANNOTATION_DISABLED_REASON,
  TextPropertiesPanel,
  clearFormattingPatch,
} from "../../../src/renderer/edit/TextPropertiesPanel";
import { EditInlineEditor } from "../../../src/renderer/edit/EditInlineEditor";
import { AnnotationOverlay } from "../../../src/renderer/annotations/AnnotationOverlay";
import type {
  Annotation,
  AnnotationToolState,
} from "../../../src/renderer/annotations/model";
import {
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

  it("ships character spacing and horizontal scaling disabled with tooltips", () => {
    const { host, cleanup } = mount(base(), base(), (): void => undefined);
    const cs = host.querySelector<HTMLButtonElement>("[data-txt-character-spacing]");
    const hs = host.querySelector<HTMLButtonElement>("[data-txt-horizontal-scaling]");
    expect(cs?.disabled).toBe(true);
    expect(hs?.disabled).toBe(true);
    expect(cs?.getAttribute("title")).toMatch(/Tc|character spacing/i);
    expect(hs?.getAttribute("title")).toMatch(/Tz|horizontal scaling/i);
    cleanup();
  });
});

describe("Phase 21 — retired floating text toolboxes (criterion 3)", () => {
  function mountInlineEditor(): { host: HTMLElement; cleanup: () => void } {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act((): void => {
      root.render(
        createElement(EditInlineEditor, {
          rect: { x: 10, y: 10, width: 200, height: 40 },
          cssScale: 1,
          initialText: "Hello",
          initialStyle: { font: "Helvetica", size: 12, color: { r: 0, g: 0, b: 0 } },
          mode: "edit",
          onCommit: (): void => undefined,
          onCancel: (): void => undefined,
        }),
      );
    });
    return {
      host: container,
      cleanup: (): void => {
        act((): void => root.unmount());
        container.remove();
      },
    };
  }

  it("the inline text editor mounts no style controls but keeps grip + actions", () => {
    const { host, cleanup } = mountInlineEditor();
    // Retired style surface.
    expect(host.querySelector(".edit-inline-field-font")).toBeNull();
    expect(host.querySelector(".edit-inline-field-size")).toBeNull();
    expect(host.querySelector(".edit-inline-field-color")).toBeNull();
    expect(host.querySelector(".edit-inline-field-bg")).toBeNull();
    // Minimal in-canvas affordance stays reachable.
    expect(host.querySelector("[data-edit-drag-handle]")).not.toBeNull();
    expect(host.querySelector(".edit-inline-btn-cancel")).not.toBeNull();
    expect(host.querySelector(".edit-inline-btn-commit")).not.toBeNull();
    cleanup();
  });

  it("the panel is the editing surface: it mounts while the editor shows no style row", () => {
    const { host: panelHost, cleanup: cleanupPanel } = mount(base(), base(), (): void => undefined);
    const { host: editorHost, cleanup: cleanupEditor } = mountInlineEditor();
    expect(panelHost.querySelector("[data-text-panel]")).not.toBeNull();
    expect(editorHost.querySelector("[data-text-panel]")).toBeNull();
    cleanupEditor();
    cleanupPanel();
  });
});

// ---------------------------------------------------------------------------
// Phase 21 chunk 3b — annotation text objects (per-family scope).

/** Every control that is DISABLED in annotation mode. The colour control is
 *  the one deliberate exception and is asserted live separately. */
const ANNOTATION_DISABLED_HOOKS = [
  "[data-txt-font]",
  "[data-txt-size]",
  "[data-txt-bold]",
  "[data-txt-italic]",
  "[data-txt-underline]",
  "[data-txt-super]",
  "[data-txt-sub]",
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

function disabledFlag(el: Element | null): boolean {
  return (el as HTMLButtonElement | HTMLInputElement | HTMLSelectElement | null)?.disabled ?? false;
}

/** Hooks that are disabled in TEXT mode too, so they are excluded from the
 *  "re-enabled" assertions: indent-dec sits at 0 in the base values, and
 *  the two Tc/Tz controls ship disabled by design in both modes. */
const TEXT_MODE_ALSO_DISABLED = new Set([
  "[data-txt-indent-dec]",
  "[data-txt-character-spacing]",
  "[data-txt-horizontal-scaling]",
]);

function textModeLiveHooks(): string[] {
  return ANNOTATION_DISABLED_HOOKS.filter((h) => !TEXT_MODE_ALSO_DISABLED.has(h));
}

describe("Phase 21 chunk 3b — annotation mode control matrix", () => {
  it("annotation mode disables every control except colour", () => {
    const { host, cleanup } = mount(base(), base(), (): void => undefined, "annotation");
    expect(host.querySelector("[data-text-panel]")?.getAttribute("data-text-panel-mode")).toBe(
      "annotation",
    );
    expect(host.querySelector("[data-txt-annotation-note]")).not.toBeNull();
    // The one live control.
    expect(disabledFlag(host.querySelector("[data-txt-color]"))).toBe(false);
    // Everything else is disabled.
    for (const hook of ANNOTATION_DISABLED_HOOKS) {
      expect(disabledFlag(host.querySelector(hook)), hook).toBe(true);
    }
    cleanup();
  });

  it("every disabled control carries the exact contract tooltip reason", () => {
    const { host, cleanup } = mount(base(), base(), (): void => undefined, "annotation");
    for (const hook of ANNOTATION_DISABLED_HOOKS) {
      expect(host.querySelector(hook)?.getAttribute("title"), hook).toBe(
        ANNOTATION_DISABLED_REASON,
      );
    }
    // The live colour control keeps its own tooltip, not the reason.
    expect(host.querySelector("[data-txt-color]")?.getAttribute("title")).toBe("Annotation colour");
    cleanup();
  });

  it("reflects the selected annotation's ACTUAL colour", () => {
    const values: TextStyleValues = { ...base(), color: { r: 1, g: 0, b: 0 } };
    const { host, cleanup } = mount(values, base(), (): void => undefined, "annotation");
    expect(host.querySelector<HTMLInputElement>("[data-txt-color]")?.value).toBe("#ff0000");
    cleanup();
  });

  it("routes the colour control through the annotation colour path", () => {
    const onPatch = vi.fn();
    const { host, cleanup } = mount(base(), base(), onPatch, "annotation");
    fireChange(host.querySelector("[data-txt-color]"), "#00ff00");
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenLastCalledWith({ color: { r: 0, g: 1, b: 0 } });
    cleanup();
  });

  it("never dispatches from a disabled control", () => {
    const onPatch = vi.fn();
    const { host, cleanup } = mount(base(), base(), onPatch, "annotation");
    for (const hook of ANNOTATION_DISABLED_HOOKS) {
      const el = host.querySelector(hook);
      // Buttons and form elements alike: a programmatic click / change
      // must not reach the engine through a disabled control.
      if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) {
        fireChange(el, "20");
      } else {
        click(el);
      }
    }
    expect(onPatch).not.toHaveBeenCalled();
    // The live colour control still works in the same mount.
    fireChange(host.querySelector("[data-txt-color]"), "#123456");
    expect(onPatch).toHaveBeenCalledTimes(1);
    expect(onPatch).toHaveBeenLastCalledWith({ color: { r: 0x12 / 255, g: 0x34 / 255, b: 0x56 / 255 } });
    cleanup();
  });

  it("re-targets the SAME instance when switching annotation <-> text", () => {
    const onPatch = vi.fn();
    const { host, rerender, cleanup } = mount(base(), base(), onPatch, "annotation");
    expect(disabledFlag(host.querySelector("[data-txt-bold]"))).toBe(true);
    // Switch to a TFlex-owned text object: the full control set re-enables
    // without the panel unmounting.
    rerender("text");
    expect(host.querySelector("[data-text-panel]")?.getAttribute("data-text-panel-mode")).toBe(
      "text",
    );
    for (const hook of textModeLiveHooks()) {
      expect(disabledFlag(host.querySelector(hook)), hook).toBe(false);
    }
    click(host.querySelector("[data-txt-bold]"));
    expect(onPatch).toHaveBeenLastCalledWith({ bold: true });
    // And back to an annotation target: disabled again, same instance.
    rerender("annotation");
    expect(disabledFlag(host.querySelector("[data-txt-bold]"))).toBe(true);
    expect(host.querySelector("[data-txt-annotation-note]")).not.toBeNull();
    cleanup();
  });

  it("text mode is unaffected: every control stays live", () => {
    const { host, cleanup } = mount(base(), base(), (): void => undefined, "text");
    expect(host.querySelector("[data-text-panel]")?.getAttribute("data-text-panel-mode")).toBe("text");
    expect(host.querySelector("[data-txt-annotation-note]")).toBeNull();
    for (const hook of textModeLiveHooks()) {
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




