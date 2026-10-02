// @vitest-environment jsdom
//
// Phase 84 (True redaction) — renderer overlay, first slice.
// Covers the three behaviours this slice owns: the layer + controls render,
// Clear resets the pending marks, and Apply routes through the engine stub.
import { describe, expect, it, vi, afterEach } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import {
  RedactionOverlay,
  type ApplyRedactions,
  type PendingRedactionMark,
} from "../../../src/renderer/redaction/RedactionOverlay";
import { stubRendererEngine } from "../../../src/renderer/engine/stubEngine";
import type { EngineState } from "../../../src/shared/types";
import type { TextItemGeom } from "../../../src/renderer/annotations/geometry";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RECT = { x: 10, y: 20, width: 30, height: 40 };
const MARK: PendingRedactionMark = { page: 1, rect: RECT };

interface MountOptions {
  docId?: string;
  applyRedactions?: ApplyRedactions;
  armed?: boolean;
  page?: number;
  cssScale?: number;
  markColor?: string;
  onMarkColorChange?: (hex: string) => void;
  getTextItems?: () => readonly TextItemGeom[];
}

function mount(
  initialMarks: readonly PendingRedactionMark[] = [],
  options: MountOptions = {},
): {
  host: HTMLElement;
  button: (hook: string) => HTMLButtonElement;
  markCount: () => number;
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(
      <RedactionOverlay
        docId={options.docId ?? "doc-1"}
        initialMarks={initialMarks}
        applyRedactions={options.applyRedactions}
        armed={options.armed}
        page={options.page}
        cssScale={options.cssScale}
        markColor={options.markColor}
        onMarkColorChange={options.onMarkColorChange}
        getTextItems={options.getTextItems}
      />,
    );
  });
  return {
    host,
    button: (hook: string): HTMLButtonElement => {
      const el = host.querySelector<HTMLButtonElement>(`[${hook}]`);
      if (el === null) throw new Error(`missing button ${hook}`);
      return el;
    },
    markCount: (): number => host.querySelectorAll("[data-redact-mark]").length,
  };
}

afterEach((): void => {
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("RedactionOverlay — first slice", () => {
  it("renders the redact layer and its three controls", () => {
    const view = mount();
    expect(view.host.querySelector("[data-redact-layer]")).not.toBeNull();
    expect(view.button("data-redact-clear")).toBeDefined();
    expect(view.button("data-redact-undo")).toBeDefined();
    expect(view.button("data-redact-apply")).toBeDefined();
  });

  it("Clear resets the pending marks", () => {
    const view = mount([MARK, { page: 2, rect: RECT }]);
    expect(view.markCount()).toBe(2);
    act((): void => {
      view.button("data-redact-clear").click();
    });
    expect(view.markCount()).toBe(0);
  });

  it("Undo drops the last pending mark only", () => {
    const view = mount([MARK, { page: 2, rect: RECT }]);
    act((): void => {
      view.button("data-redact-undo").click();
    });
    expect(view.markCount()).toBe(1);
  });

  it("Apply routes the pending marks through the stub applyRedactions", async () => {
    const spy = vi.spyOn(stubRendererEngine, "applyRedactions").mockResolvedValue({
      ok: true,
      value: { state: {} as unknown as EngineState, removedGlyphs: 0, warnings: [] },
    });
    const view = mount([MARK]);
    await act(async (): Promise<void> => {
      view.button("data-redact-apply").click();
      await Promise.resolve();
    });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("doc-1", {
      page: 1,
      marks: [{ rect: RECT }],
      color: "#000000",
    });
    expect(view.markCount()).toBe(0);
  });

  it("a region drag on the layer creates exactly one pending mark", () => {
    const view = mount([], { armed: true, page: 1, cssScale: 1 });
    const layer = view.host.querySelector<HTMLDivElement>("[data-redact-layer]");
    if (layer === null) throw new Error("missing redact layer");
    expect(layer.hasAttribute("data-redact-tool")).toBe(true);
    act((): void => {
      layer.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 20 }),
      );
      layer.dispatchEvent(
        new MouseEvent("pointermove", { bubbles: true, clientX: 50, clientY: 60 }),
      );
      layer.dispatchEvent(
        new MouseEvent("pointerup", { bubbles: true, clientX: 50, clientY: 60 }),
      );
    });
    expect(view.markCount()).toBe(1);
  });

  it("Apply routes the pending mark through an injected applyRedactions", async () => {
    const applyRedactions = vi.fn<ApplyRedactions>().mockResolvedValue({
      ok: true,
      value: { state: {} as unknown as EngineState, removedGlyphs: 0, warnings: [] },
    });
    const view = mount([MARK], { docId: "doc-1", applyRedactions });
    await act(async (): Promise<void> => {
      view.button("data-redact-apply").click();
      await Promise.resolve();
    });
    expect(applyRedactions).toHaveBeenCalledTimes(1);
    expect(applyRedactions).toHaveBeenCalledWith("doc-1", {
      page: 1,
      marks: [{ rect: RECT }],
      color: "#000000",
    });
  });

  it("renders the mark-colour swatch control", () => {
    const view = mount();
    const swatches = view.host.querySelectorAll("[data-redact-swatch]");
    expect(swatches.length).toBeGreaterThanOrEqual(3);
    expect(view.host.querySelector('[data-redact-swatch][data-color="#000000"]')).not.toBeNull();
    expect(view.host.querySelector('[data-redact-swatch][data-color="#d21f3c"]')).not.toBeNull();
    expect(view.host.querySelector('[data-redact-swatch][data-color="#1f6feb"]')).not.toBeNull();
  });

  it("clicking a swatch calls onMarkColorChange with its data-color", () => {
    const onMarkColorChange = vi.fn<(hex: string) => void>();
    const view = mount([], { onMarkColorChange });
    const swatch = view.host.querySelector<HTMLButtonElement>(
      '[data-redact-swatch][data-color="#d21f3c"]',
    );
    if (swatch === null) throw new Error("missing swatch");
    act((): void => {
      swatch.click();
    });
    expect(onMarkColorChange).toHaveBeenCalledTimes(1);
    expect(onMarkColorChange).toHaveBeenCalledWith("#d21f3c");
  });

  it("fills a pending mark with the passed markColor", () => {
    const view = mount([MARK], { markColor: "#1f6feb" });
    const mark = view.host.querySelector<HTMLDivElement>("[data-redact-mark]");
    if (mark === null) throw new Error("missing mark");
    const style = mark.getAttribute("style") ?? "";
    expect(style).toContain("background");
    expect(style).toMatch(/1f6feb|rgb\(31,\s*111,\s*235\)/i);
  });

  it("renders a disabled unsupported affordance with a tooltip", () => {
    const view = mount();
    const el = view.host.querySelector<HTMLButtonElement>("[data-redact-unsupported]");
    if (el === null) throw new Error("missing unsupported affordance");
    expect(el.disabled).toBe(true);
    expect((el.getAttribute("title") ?? "").length).toBeGreaterThan(0);
  });

  it("commit sends the markColor on the apply payload", async () => {
    const applyRedactions = vi.fn<ApplyRedactions>().mockResolvedValue({
      ok: true,
      value: { state: {} as unknown as EngineState, removedGlyphs: 0, warnings: [] },
    });
    const view = mount([MARK], { markColor: "#1f6feb", applyRedactions });
    await act(async (): Promise<void> => {
      view.button("data-redact-apply").click();
      await Promise.resolve();
    });
    expect(applyRedactions).toHaveBeenCalledTimes(1);
    expect(applyRedactions).toHaveBeenCalledWith("doc-1", {
      page: 1,
      marks: [{ rect: RECT }],
      color: "#1f6feb",
    });
  });

  it("defaults to region mode and renders both mode buttons", () => {
    const view = mount();
    const layer = view.host.querySelector("[data-redact-layer]");
    expect(layer?.getAttribute("data-redact-mode")).toBe("region");
    expect(
      view.host.querySelector('[data-redact-mode][data-mode="region"]'),
    ).not.toBeNull();
    expect(
      view.host.querySelector('[data-redact-mode][data-mode="text"]'),
    ).not.toBeNull();
  });

  it("clicking the Text mode button switches the layer mode", () => {
    const view = mount();
    const textButton = view.host.querySelector<HTMLButtonElement>(
      '[data-redact-mode][data-mode="text"]',
    );
    if (textButton === null) throw new Error("missing text mode button");
    act((): void => {
      textButton.click();
    });
    const layer = view.host.querySelector("[data-redact-layer]");
    expect(layer?.getAttribute("data-redact-mode")).toBe("text");
  });

  it("text mode marks one pending rect per covered line", () => {
    const first: TextItemGeom = { x: 0, y: 0, width: 50, height: 10, text: "secret" };
    const second: TextItemGeom = { x: 0, y: 100, width: 50, height: 10, text: "other" };
    const view = mount([], {
      armed: true,
      page: 1,
      cssScale: 1,
      getTextItems: () => [first, second],
    });
    const textButton = view.host.querySelector<HTMLButtonElement>(
      '[data-redact-mode][data-mode="text"]',
    );
    if (textButton === null) throw new Error("missing text mode button");
    act((): void => {
      textButton.click();
    });
    const layer = view.host.querySelector<HTMLDivElement>("[data-redact-layer]");
    if (layer === null) throw new Error("missing redact layer");
    act((): void => {
      layer.dispatchEvent(
        new MouseEvent("pointerdown", { bubbles: true, clientX: 0, clientY: 5 }),
      );
      layer.dispatchEvent(
        new MouseEvent("pointermove", { bubbles: true, clientX: 50, clientY: 5 }),
      );
      layer.dispatchEvent(
        new MouseEvent("pointerup", { bubbles: true, clientX: 50, clientY: 5 }),
      );
    });
    expect(view.markCount()).toBe(1);
    const mark = view.host.querySelector<HTMLDivElement>("[data-redact-mark]");
    if (mark === null) throw new Error("missing mark");
    expect(parseFloat(mark.style.left)).toBe(first.x);
    expect(parseFloat(mark.style.top)).toBe(first.y);
    expect(parseFloat(mark.style.width)).toBe(first.width);
    expect(parseFloat(mark.style.height)).toBe(first.height);
  });
});