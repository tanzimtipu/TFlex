// @vitest-environment jsdom
//
// Operator requirement — the annotation action bar's colour picker
// (AnnColorBox) must DISENGAGE as soon as a colour is chosen, and on a
// click outside the picker. Picking a swatch used to apply the colour
// and leave the popover open (no `setOpen(false)` in either apply
// path). These tests pin all five dismissal paths:
//   (a) built-in swatch applies AND closes
//   (b) custom hex (Enter) applies AND closes
//   (c) outside pointerdown closes
//   (d) inside pointerdown does NOT close
//   (e) Escape closes
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";
import AnnColorBox from "../../../src/renderer/annotations/AnnColorBox";
import type { AnnotationColorValue } from "../../../src/renderer/annotations/model";

const liveMounts: Root[] = [];

function mount(onApply: (c: AnnotationColorValue) => void): HTMLElement {
  while (liveMounts.length > 0) {
    const prev = liveMounts.pop();
    if (prev === undefined) continue;
    act((): void => {
      prev.unmount();
    });
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  liveMounts.push(root);
  const node: ReactElement = createElement(AnnColorBox, {
    color: "yellow",
    theme: "dark",
    presets: { light: [], dark: [] },
    onApply,
  });
  act((): void => {
    root.render(node);
  });
  return host;
}

/** Open the picker and return the portaled popover (or null). */
function openPicker(onApply: (c: AnnotationColorValue) => void): {
  host: HTMLElement;
  popover: HTMLElement | null;
} {
  const host = mount(onApply);
  const swatch = host.querySelector<HTMLElement>(".ann-color-box");
  if (swatch === null) return { host, popover: null };
  act((): void => {
    swatch.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  return { host, popover: document.body.querySelector<HTMLElement>(".color-popover") };
}

/** Let motion's skipAnimations exit complete and unmount. */
async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise((r) => setTimeout(r, 30));
  });
}

/** A pointerdown that only needs the `target` the AnnColorBox reads. */
function firePointerDown(target: EventTarget): void {
  act((): void => {
    target.dispatchEvent(new Event("pointerdown", { bubbles: true }));
  });
}

function currentPopover(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(".color-popover");
}

/** Drive the controlled hex input like the OCR/modals tests do. */
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

describe("AnnColorBox — picker disengages on selection (operator requirement)", () => {
  it("(a) picking a built-in swatch applies the colour AND closes the popover", async () => {
    const onApply = vi.fn();
    const { popover } = openPicker(onApply);
    expect(popover).not.toBeNull();
    if (popover === null) return;
    const btn = popover.querySelector<HTMLButtonElement>('[data-palette-built-in="green"]');
    expect(btn).not.toBeNull();
    if (btn === null) return;
    act((): void => {
      btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onApply).toHaveBeenCalledWith("green");
    await settle();
    expect(currentPopover()).toBeNull();
  });

  it("(b) committing a custom hex closes the popover too", async () => {
    const onApply = vi.fn();
    const { popover } = openPicker(onApply);
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
    expect(onApply).toHaveBeenCalledWith("#0000ff");
    await settle();
    expect(currentPopover()).toBeNull();
  });

  it("(c) an outside pointerdown closes the popover", async () => {
    const { host } = openPicker(vi.fn());
    expect(currentPopover()).not.toBeNull();
    firePointerDown(host);
    await settle();
    expect(currentPopover()).toBeNull();
  });

  it("(d) a pointerdown INSIDE the popover (hue slider) does NOT close it", async () => {
    const { popover } = openPicker(vi.fn());
    expect(popover).not.toBeNull();
    if (popover === null) return;
    const slider = popover.querySelector<HTMLElement>(".color-hue-slider");
    expect(slider).not.toBeNull();
    if (slider === null) return;
    firePointerDown(slider);
    await settle();
    expect(currentPopover()).not.toBeNull();
  });

  it("(e) Escape closes the popover", async () => {
    openPicker(vi.fn());
    expect(currentPopover()).not.toBeNull();
    act((): void => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    await settle();
    expect(currentPopover()).toBeNull();
  });
});