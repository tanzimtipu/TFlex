// @vitest-environment jsdom
//
// DEF-175 (HIGH, release blocker) — the annotation color palette
// popover is INVISIBLE and click-through in the frosted theme (the
// default): the frosted-only backdrop-filter on `.ann-toolbar` makes
// the toolbar a stacking context AND the containing block for its
// absolutely positioned descendants, so the popover's z-index: 50
// only ranked INSIDE the toolbar's context; the toolbar (z auto,
// early in DOM) then stacked below the later-sibling
// `.document-scroller`, burying the whole toolbar subtree — popover
// included — under the page. Clicks where the palette should be fired
// the armed ink tool into the document instead.
//
// The fix portals the popover to document.body (root stacking
// context) and places it in viewport coordinates under the swatch.
// These tests pin the ESCAPE in the DOM — a regression to an
// in-toolbar absolute popover (which re-traps it under the frosted
// stacking context) fails here instead of at QA time.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import type { ReactElement } from "react";
import { AnnotationToolbar } from "../../../src/renderer/annotations/AnnotationToolbar";
import { ANNOTATION_COLORS } from "../../../src/renderer/annotations/model";
import type { AnnotationToolAction } from "../../../src/renderer/annotations/model";
import type { AnnotationColors } from "../../../src/renderer/state/colorPalette";

// The popover portals to document.body; unmount every previous
// surface so a stale open popover can't pollute body-level queries.
const liveRoots: ReturnType<typeof createRoot>[] = [];
function mount(node: ReactElement): HTMLElement {
  while (liveRoots.length > 0) {
    const prev = liveRoots.pop();
    if (prev === undefined) continue;
    act((): void => {
      prev.unmount();
    });
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  liveRoots.push(root);
  act((): void => {
    root.render(node);
  });
  return host;
}

function mountOpenPalette(onAction?: (a: AnnotationToolAction) => void): {
  host: HTMLElement;
  popover: HTMLElement | null;
} {
  const host = mount(
    createElement(AnnotationToolbar, {
      state: { tool: "ink", color: "yellow", penWidth: 3 },
      onAction: onAction ?? ((): void => {}),
      theme: "dark",
      palette: { light: [], dark: [] } as AnnotationColors,
    }),
  );
  const swatch = host.querySelector<HTMLElement>(".ann-color-swatch-main");
  if (swatch === null) return { host, popover: null };
  act((): void => {
    swatch.click();
  });
  return { host, popover: document.body.querySelector<HTMLElement>(".color-popover") };
}

describe("DEF-175 - color palette popover escapes the frosted .ann-toolbar stacking context", () => {
  it("the popover is NOT a descendant of the toolbar — it portals to document.body", () => {
    const { host, popover } = mountOpenPalette();
    expect(popover).not.toBeNull();
    if (popover === null) return;
    // Pre-fix, the popover lived inside .ann-toolbar where the frosted
    // backdrop-filter stacking context buried it under the
    // .document-scroller. The fix renders it at the app root.
    expect(host.querySelector(".color-popover")).toBeNull();
    expect(popover.parentElement).toBe(document.body);
    // Sanity: the toolbar + swatch that open the picker still live in
    // the host (only the floating surface is portaled out).
    expect(host.querySelector("[data-annotation-toolbar]")).not.toBeNull();
  });

  it("the popover is placed in viewport coordinates under the swatch (fixed, right-aligned, clamped)", () => {
    const { popover } = mountOpenPalette();
    expect(popover).not.toBeNull();
    if (popover === null) return;
    // jsdom rects are zeros: anchor.right 0 - offsetWidth 0 -> left 0,
    // and the Phase-22 (DEF-248) flush join puts the popover's top at
    // anchor.bottom (0) — no gap. `position: fixed` in the ROOT stacking
    // context is what escapes the frosted toolbar trap.
    expect(popover.style.position).toBe("fixed");
    expect(popover.style.left).toBe("0px");
    expect(popover.style.top).toBe("0px");
  });

  it("the portaled palette stays fully interactive (a built-in swatch click applies the color)", () => {
    const actions: AnnotationToolAction[] = [];
    const { host, popover } = mountOpenPalette((a): void => {
      actions.push(a);
    });
    expect(popover).not.toBeNull();
    if (popover === null) return;
    const swatchBtn = popover.querySelector<HTMLElement>(".color-palette-grid .color-swatch");
    expect(swatchBtn).not.toBeNull();
    if (swatchBtn === null) return;
    act((): void => {
      swatchBtn.click();
    });
    expect(actions).toContainEqual({ type: "set-color", color: ANNOTATION_COLORS[0] });
    expect(host.querySelector(".ann-color-swatch-main")).not.toBeNull();
  });

  it("closing the palette removes the popover from document.body", async () => {
    const { host, popover } = mountOpenPalette();
    expect(popover).not.toBeNull();
    if (popover === null) return;
    const swatch = host.querySelector<HTMLElement>(".ann-color-swatch-main");
    expect(swatch).not.toBeNull();
    if (swatch === null) return;
    act((): void => {
      swatch.click();
    });
    // AnimatePresence exit completes on the next frame (skipAnimations).
    await act(async (): Promise<void> => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(document.body.querySelector(".color-popover")).toBeNull();
  });
});

// Operator requirement (same rule the action-bar AnnColorBox now
// follows): the annotation TOOLBAR's colour popover must DISENGAGE as
// soon as a colour is APPLIED — built-in swatch or committed custom
// hex — while preset add / remove edits (which route through
// `onChange`) keep it open, and click-outside / Escape still dismiss.
describe("annotation toolbar colour popover — disengages on selection", () => {
  function mountPalette(opts?: {
    onPaletteChange?: (next: AnnotationColors) => void;
    palette?: AnnotationColors;
  }): { host: HTMLElement; popover: HTMLElement | null } {
    const host = mount(
      createElement(AnnotationToolbar, {
        state: { tool: "ink", color: "yellow", penWidth: 3 },
        onAction: (): void => {},
        theme: "dark",
        palette: opts?.palette ?? ({ light: [], dark: [] } as AnnotationColors),
        onPaletteChange: opts?.onPaletteChange,
      }),
    );
    const swatch = host.querySelector<HTMLElement>(".ann-color-swatch-main");
    if (swatch === null) return { host, popover: null };
    act((): void => {
      swatch.click();
    });
    return { host, popover: document.body.querySelector<HTMLElement>(".color-popover") };
  }

  async function settle(): Promise<void> {
    await act(async (): Promise<void> => {
      await new Promise((r) => setTimeout(r, 30));
    });
  }

  function currentPopover(): HTMLElement | null {
    return document.body.querySelector<HTMLElement>(".color-popover");
  }

  function firePointerDown(target: EventTarget): void {
    act((): void => {
      target.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
  }

  function setInputValue(input: HTMLInputElement, value: string): void {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    act((): void => {
      setter?.call(input, value);
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
  }

  it("(a) applying a built-in swatch closes the popover", async () => {
    const { popover } = mountPalette();
    expect(popover).not.toBeNull();
    if (popover === null) return;
    const btn = popover.querySelector<HTMLButtonElement>('[data-palette-built-in="green"]');
    expect(btn).not.toBeNull();
    if (btn === null) return;
    act((): void => {
      btn.click();
    });
    await settle();
    expect(currentPopover()).toBeNull();
  });

  it("(b) committing a custom hex closes the popover", async () => {
    const { popover } = mountPalette();
    expect(popover).not.toBeNull();
    if (popover === null) return;
    const input = popover.querySelector<HTMLInputElement>('input[aria-label="Custom color hex"]');
    expect(input).not.toBeNull();
    if (input === null) return;
    setInputValue(input, "#0000ff");
    act((): void => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
      );
    });
    await settle();
    expect(currentPopover()).toBeNull();
  });

  it("(c) adding a preset (Add) does NOT close the popover", async () => {
    const onPaletteChange = vi.fn();
    const { popover } = mountPalette({ onPaletteChange });
    expect(popover).not.toBeNull();
    if (popover === null) return;
    const add = popover.querySelector<HTMLButtonElement>("[data-palette-add]");
    expect(add).not.toBeNull();
    if (add === null) return;
    act((): void => {
      add.click();
    });
    expect(onPaletteChange).toHaveBeenCalledTimes(1);
    await settle();
    expect(currentPopover()).not.toBeNull();
  });

  it("(d) removing a saved preset does NOT close the popover", async () => {
    const onPaletteChange = vi.fn();
    const preset = { id: "p1", hex: "#112233" };
    const { popover } = mountPalette({
      onPaletteChange,
      palette: { light: [], dark: [preset] } as AnnotationColors,
    });
    expect(popover).not.toBeNull();
    if (popover === null) return;
    const remove = popover.querySelector<HTMLButtonElement>(".color-swatch-remove");
    expect(remove).not.toBeNull();
    if (remove === null) return;
    act((): void => {
      remove.click();
    });
    expect(onPaletteChange).toHaveBeenCalledTimes(1);
    await settle();
    expect(currentPopover()).not.toBeNull();
  });

  it("(e) an outside pointerdown still closes the popover", async () => {
    const { host } = mountPalette();
    expect(currentPopover()).not.toBeNull();
    firePointerDown(host);
    await settle();
    expect(currentPopover()).toBeNull();
  });

  it("(f) Escape still closes the popover", async () => {
    mountPalette();
    expect(currentPopover()).not.toBeNull();
    act((): void => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await settle();
    expect(currentPopover()).toBeNull();
  });
});