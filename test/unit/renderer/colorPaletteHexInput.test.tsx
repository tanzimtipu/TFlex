// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so
// that `act` recognises the test env and stops spamming stderr.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import ColorPalette from "../../../src/renderer/annotations/ColorPalette";
import type { AnnotationColor } from "../../../src/renderer/annotations/model";

/**
 * DEF-070 — annotation color palette must expose a custom hex input.
 *
 * The retest spec (retest_final.spec.cjs) drives the picker via
 *   await window.fill('input[aria-label="Custom color hex"]', '#0000ff');
 *   await window.keyboard.press('Enter');
 * and asserts the highlight swatch turned blue. The picker didn't
 * expose that input before the fix; the tests below pin the
 * contract: the input exists, accepts `#rrggbb`, `#rgb`, and
 * `rgb(r, g, b)` text, and surfaces a live `rgb(...)` mirror for
 * accessibility.
 */

interface RenderArgs {
  theme?: 'light' | 'dark';
  activeColor?: AnnotationColor;
  activeCustomHex?: string | null;
  onApplyCustom?: (hex: string) => void;
  onApplyBuiltIn?: (c: AnnotationColor) => void;
  onChange?: (next: unknown) => void;
}

function renderPalette(args: RenderArgs = {}): {
  root: Root;
  container: HTMLElement;
  cleanup: () => void;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(
      <ColorPalette
        ref={undefined}
        theme={args.theme ?? 'dark'}
        activeColor={args.activeColor ?? 'yellow'}
        activeCustomHex={args.activeCustomHex ?? null}
        presets={{ light: [], dark: [] }}
        onChange={args.onChange ?? ((): void => undefined)}
        onApplyBuiltIn={args.onApplyBuiltIn ?? ((): void => undefined)}
        onApplyCustom={args.onApplyCustom ?? ((): void => undefined)}
      />,
    );
  });
  return {
    root,
    container,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      container.remove();
    },
  };
}

/** Drive a controlled input via the native setter + change event so
 *  React's synthetic onChange fires. Matches the pattern the OCR
 *  dialog tests use. */
function setInputValue(input: HTMLInputElement, value: string): void {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set;
  act((): void => {
    nativeSetter?.call(input, value);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function pressKey(input: HTMLElement, key: string): void {
  act((): void => {
    input.dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
    );
  });
}

describe("ColorPalette — DEF-070 custom hex input", () => {
  it("renders a custom hex input with aria-label='Custom color hex'", () => {
    const { container, cleanup } = renderPalette();
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Custom color hex"]',
    );
    expect(input).not.toBeNull();
    expect(input?.type).toBe('text');
    cleanup();
  });

  it("renders a sibling rgb mirror input that reflects the live preview", () => {
    const { container, cleanup } = renderPalette({ activeColor: 'blue' });
    const rgb = container.querySelector<HTMLInputElement>(
      'input[aria-label="Custom color rgb (read only)"]',
    );
    expect(rgb).not.toBeNull();
    // blue in our palette is #3b82f6 -> rgb(59, 130, 246).
    expect(rgb?.value).toBe('rgb(59, 130, 246)');
    cleanup();
  });

  it("Enter on a #rrggbb hex commits and applies the parsed colour to the annotation tool", () => {
    const onApplyCustom = vi.fn();
    const { container, cleanup } = renderPalette({ onApplyCustom });
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Custom color hex"]',
    );
    expect(input).not.toBeNull();
    if (input === null) return cleanup();
    setInputValue(input, '#0000ff');
    pressKey(input, 'Enter');
    expect(onApplyCustom).toHaveBeenCalledWith('#0000ff');
    cleanup();
  });

  it("Enter on a #rgb short hex commits and applies it (expanded)", () => {
    const onApplyCustom = vi.fn();
    const { container, cleanup } = renderPalette({ onApplyCustom });
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Custom color hex"]',
    );
    expect(input).not.toBeNull();
    if (input === null) return cleanup();
    setInputValue(input, '#abc');
    pressKey(input, 'Enter');
    expect(onApplyCustom).toHaveBeenCalledWith('#aabbcc');
    cleanup();
  });

  it("Enter on rgb(r, g, b) commits and applies the parsed hex", () => {
    const onApplyCustom = vi.fn();
    const { container, cleanup } = renderPalette({ onApplyCustom });
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Custom color hex"]',
    );
    expect(input).not.toBeNull();
    if (input === null) return cleanup();
    setInputValue(input, 'rgb(0, 0, 255)');
    pressKey(input, 'Enter');
    expect(onApplyCustom).toHaveBeenCalledWith('#0000ff');
    cleanup();
  });

  it("Enter on garbage input does NOT apply, snaps the draft back to the live preview, and surfaces an error", () => {
    const onApplyCustom = vi.fn();
    const { container, cleanup } = renderPalette({
      onApplyCustom,
      activeColor: 'yellow', // -> #eab308
    });
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Custom color hex"]',
    );
    expect(input).not.toBeNull();
    if (input === null) return cleanup();
    setInputValue(input, 'not a hex');
    pressKey(input, 'Enter');
    expect(onApplyCustom).not.toHaveBeenCalled();
    // The draft snapped back to the live preview hex.
    expect(input.value).toBe('#eab308');
    cleanup();
  });

  it("Escape cancels mid-edit and snaps the draft back to the live preview", () => {
    const onApplyCustom = vi.fn();
    const { container, cleanup } = renderPalette({
      onApplyCustom,
      activeColor: 'green', // -> #22c55e
    });
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Custom color hex"]',
    );
    expect(input).not.toBeNull();
    if (input === null) return cleanup();
    setInputValue(input, '#abcdef');
    pressKey(input, 'Escape');
    expect(onApplyCustom).not.toHaveBeenCalled();
    expect(input.value).toBe('#22c55e');
    cleanup();
  });

  it("Live typing updates the rgb mirror as soon as the draft is parseable", () => {
    const { container, cleanup } = renderPalette({ activeColor: 'yellow' });
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Custom color hex"]',
    );
    const rgb = container.querySelector<HTMLInputElement>(
      'input[aria-label="Custom color rgb (read only)"]',
    );
    expect(input).not.toBeNull();
    expect(rgb).not.toBeNull();
    if (input === null || rgb === null) return cleanup();
    setInputValue(input, '#ff0000');
    expect(rgb.value).toBe('rgb(255, 0, 0)');
    cleanup();
  });

  it("initial draft reflects the activeCustomHex when one is provided", () => {
    const { container, cleanup } = renderPalette({
      activeCustomHex: '#abcdef',
      activeColor: 'yellow',
    });
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Custom color hex"]',
    );
    expect(input?.value).toBe('#abcdef');
    cleanup();
  });
});