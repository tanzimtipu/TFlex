// @vitest-environment jsdom
// Phase 80 (F1) — Format Painter in the FORMAT TEXT panel.
//
// The panel stays pure/controlled: these tests pin the painter button's
// disabled/enabled + aria-pressed reflection, the arm / cancel gesture, the
// hint element, the exact captured patch shape (the host captures with
// `valuesToPatch`), and the Inspector snapshot forwarding.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { TextPropertiesPanel } from "../../../src/renderer/edit/TextPropertiesPanel";
import {
  defaultTextStyleValues,
  valuesToPatch,
  type TextStyleValues,
} from "../../../src/renderer/edit/textStyle";
import {
  inspectorTextPanelFor,
  type InspectorTextSelection,
} from "../../../src/renderer/components/Inspector";

function base(): TextStyleValues {
  return defaultTextStyleValues("Helvetica");
}

interface PainterProps {
  painterArmed?: boolean;
  painterHint?: string | null;
  canPickUpPainter?: boolean;
  onArmPainter?: () => void;
  onCancelPainter?: () => void;
}

function mountPainter(
  values: TextStyleValues,
  props: PainterProps,
): { host: HTMLElement; cleanup: () => void } {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(
      createElement(TextPropertiesPanel, {
        open: true,
        values,
        defaults: base(),
        onPatch: (): void => undefined,
        ...props,
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

function click(el: Element | null): void {
  act((): void => {
    el?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

describe("Phase 80 — Format Painter button", () => {
  it("is disabled-with-tooltip when canPickUpPainter is false", () => {
    const { host, cleanup } = mountPainter(base(), { canPickUpPainter: false });
    const btn = host.querySelector<HTMLButtonElement>("[data-txt-format-painter]");
    expect(btn).not.toBeNull();
    expect(btn?.disabled).toBe(true);
    expect(btn?.getAttribute("title") ?? "").toMatch(/format painter/i);
    expect(btn?.getAttribute("aria-label")).toBe("Format Painter");
    cleanup();
  });

  it("is enabled when canPickUpPainter is true", () => {
    const { host, cleanup } = mountPainter(base(), { canPickUpPainter: true });
    const btn = host.querySelector<HTMLButtonElement>("[data-txt-format-painter]");
    expect(btn?.disabled).toBe(false);
    cleanup();
  });

  it("calls onArmPainter when clicked while disarmed", () => {
    const onArmPainter = vi.fn();
    const { host, cleanup } = mountPainter(base(), {
      canPickUpPainter: true,
      onArmPainter,
    });
    click(host.querySelector("[data-txt-format-painter]"));
    expect(onArmPainter).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("reports aria-pressed=true when armed and cancels on the second click", () => {
    const onArmPainter = vi.fn();
    const onCancelPainter = vi.fn();
    const { host, cleanup } = mountPainter(base(), {
      canPickUpPainter: true,
      painterArmed: true,
      onArmPainter,
      onCancelPainter,
    });
    const btn = host.querySelector<HTMLButtonElement>("[data-txt-format-painter]");
    expect(btn?.getAttribute("aria-pressed")).toBe("true");
    click(btn);
    expect(onCancelPainter).toHaveBeenCalledTimes(1);
    expect(onArmPainter).not.toHaveBeenCalled();
    cleanup();
  });
});

describe("Phase 80 — Format Painter hint", () => {
  it("renders the hint only when painterHint is non-null", () => {
    const none = mountPainter(base(), { painterHint: null });
    expect(none.host.querySelector("[data-txt-format-painter-hint]")).toBeNull();
    none.cleanup();

    const shown = mountPainter(base(), { painterHint: "Pick a text box to apply." });
    const hint = shown.host.querySelector("[data-txt-format-painter-hint]");
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toBe("Pick a text box to apply.");
    shown.cleanup();
  });
});

describe("Phase 80 — captured format", () => {
  const FULL: TextStyleValues = {
    font: "Times",
    size: 18,
    bold: true,
    italic: true,
    underline: true,
    color: { r: 0.2, g: 0.4, b: 0.6 },
    highlight: { r: 1, g: 1, b: 0 },
    baselineShift: 6,
    align: "center",
    lineHeight: 1.5,
    list: "bullet",
    indent: 24,
    charSpacing: 2,
  };

  it("equals valuesToPatch(values) with every field and no unsupported field", () => {
    expect(valuesToPatch(FULL)).toEqual({
      font: "Times",
      size: 18,
      bold: true,
      italic: true,
      underline: true,
      color: { r: 0.2, g: 0.4, b: 0.6 },
      highlight: { r: 1, g: 1, b: 0 },
      baselineShift: 6,
      align: "center",
      lineHeight: 1.5,
      list: "bullet",
      indent: 24,
      charSpacing: 2,
    });
    expect(Object.keys(valuesToPatch(FULL)).sort()).toEqual(
      [
        "align",
        "baselineShift",
        "bold",
        "charSpacing",
        "color",
        "font",
        "highlight",
        "indent",
        "italic",
        "lineHeight",
        "list",
        "size",
        "underline",
      ].sort(),
    );
  });

  it("captures highlight: null when there is no band", () => {
    const patch = valuesToPatch({ ...FULL, highlight: null });
    expect(patch.highlight).toBeNull();
  });

  it("is independent of the source values object (copies colours)", () => {
    const patch = valuesToPatch(FULL);
    patch.color = { r: 1, g: 1, b: 1 };
    expect(FULL.color).toEqual({ r: 0.2, g: 0.4, b: 0.6 });
  });
});

describe("Phase 80 — Inspector snapshot forwarding", () => {
  it("forwards the painter props through inspectorTextPanelFor", () => {
    const onArmPainter = (): void => undefined;
    const onCancelPainter = (): void => undefined;
    const snapshot: InspectorTextSelection = {
      targetKey: "box:a",
      name: "Text object",
      values: base(),
      defaults: base(),
      mode: "text",
      text: "hello",
      onPatch: (): void => undefined,
      onTextChange: (): void => undefined,
      onTextCommit: (): void => undefined,
      focusToken: 0,
      painterArmed: true,
      painterHint: "apply me",
      canPickUpPainter: true,
      onArmPainter,
      onCancelPainter,
    };
    const props = inspectorTextPanelFor(snapshot);
    expect(props?.painterArmed).toBe(true);
    expect(props?.painterHint).toBe("apply me");
    expect(props?.canPickUpPainter).toBe(true);
    expect(props?.onArmPainter).toBe(onArmPainter);
    expect(props?.onCancelPainter).toBe(onCancelPainter);
  });
});