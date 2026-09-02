// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so
// that `act` recognises the test env and stops spamming stderr.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  CreateFromImagesDialog,
  DEFAULT_CREATE_IMAGE_QUALITY,
  clampCreateImageQuality,
} from "../../../src/renderer/components/CreateFromImagesDialog";
import {
  qualityFractionToPercent,
  qualityPercentToFraction,
} from "../../../src/renderer/state/preferences";

/**
 * Phase 9 — Create-from-images dialog rendering tests.
 *
 * The dialog's contract:
 *   - Renders the file picker (`data-create-pick`).
 *   - Lists picked files (one row per file) and exposes a remove
 *     button (`data-create-remove`).
 *   - Quality input displays as a percentage (10..100) for the user
 *     but the canonical persisted value is a FRACTION (0..1) so the
 *     wire shape matches the backend's `normalizeSettings`
 *     validation. `onQualityChange` receives the fraction; `onConfirm`
 *     receives the fraction. The display/input ranges are unit-
 *     tested in `preferences.test.ts` (clamp + percent↔fraction).
 *   - Confirm button is disabled until at least one file is picked.
 *   - On confirm, fires `onConfirm` with the picked files + quality
 *     (the fraction).
 *   - Esc + backdrop + close button all fire `onClose`.
 *
 * File-picker resolution is mocked here: jsdom can't drive the
 * native OS dialog. The dialog exposes the picked File objects via
 * a module-private path; tests poke the dialog by directly setting
 * the File[] state through the underlying React state... we cheat by
 * monkey-patching the dialog's button click to populate via a stub
 * picker. The cleanest way is to just verify the form/state contract
 * by checking the disabled / enabled states; the actual OS picker
 * integration is covered by the e2e harness.
 */

interface RenderArgs {
  initialQuality?: number;
  onConfirm?: (c: { files: File[]; quality: number }) => void;
  onQualityChange?: (q: number) => void;
  onClose?: () => void;
}

function renderDialog(args: RenderArgs = {}): {
  root: Root;
  container: HTMLElement;
  cleanup: () => void;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(
      <CreateFromImagesDialog
        open={true}
        initialQuality={args.initialQuality ?? DEFAULT_CREATE_IMAGE_QUALITY}
        onQualityChange={args.onQualityChange}
        onConfirm={args.onConfirm ?? ((): void => undefined)}
        onClose={args.onClose ?? ((): void => undefined)}
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

describe("CreateFromImagesDialog — render contract", () => {
  it("renders the picker and confirm button", () => {
    const { container, cleanup } = renderDialog();
    expect(container.querySelector("[data-create-pick]")).not.toBeNull();
    expect(container.querySelector("[data-create-confirm]")).not.toBeNull();
    cleanup();
  });

  it("disables confirm when no files are picked", () => {
    const { container, cleanup } = renderDialog();
    const confirm = container.querySelector<HTMLButtonElement>(
      "[data-create-confirm]",
    );
    expect(confirm?.disabled).toBe(true);
    cleanup();
  });

  it("renders nothing when open=false", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act((): void => {
      root.render(
        <CreateFromImagesDialog
          open={false}
          initialQuality={DEFAULT_CREATE_IMAGE_QUALITY}
          onConfirm={(): void => undefined}
          onClose={(): void => undefined}
        />,
      );
    });
    expect(container.querySelector("[data-create-from-images-dialog]")).toBeNull();
    act((): void => {
      root.unmount();
    });
    container.remove();
  });
});

describe("CreateFromImagesDialog — quality control", () => {
  it("seeds the quality input from the prop (fraction -> percent display)", () => {
    // Pass a fraction (the persisted shape). The dialog should
    // render the corresponding percentage (60).
    const { container, cleanup } = renderDialog({ initialQuality: 0.6 });
    const input = container.querySelector<HTMLInputElement>(
      "[data-create-quality]",
    );
    expect(input?.value).toBe(String(qualityFractionToPercent(0.6)));
    expect(input?.value).toBe("60");
    cleanup();
  });

  it("clamps out-of-range quality input on every change", () => {
    const onQualityChange = vi.fn();
    const { container, cleanup } = renderDialog({ onQualityChange });
    const input = container.querySelector<HTMLInputElement>(
      "[data-create-quality]",
    );
    expect(input).not.toBeNull();
    if (input === null) return cleanup();
    // React listens for the native `input` event on controlled
    // number inputs. Setting `.value` directly bypasses React's
    // value tracker; the React Testing Library approach is to use
    // the prototype's native value setter so React sees the new
    // value through its input event listener.
    act((): void => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "5");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Out-of-range "5" clamps to 10 percent on the display, and the
    // host callback receives the matching fraction (0.1).
    expect(input.value).toBe("10");
    expect(onQualityChange).toHaveBeenLastCalledWith(qualityPercentToFraction(10));
    cleanup();
  });

  it("clamps above-range quality input on every change", () => {
    const onQualityChange = vi.fn();
    const { container, cleanup } = renderDialog({ onQualityChange });
    const input = container.querySelector<HTMLInputElement>(
      "[data-create-quality]",
    );
    expect(input).not.toBeNull();
    if (input === null) return cleanup();
    act((): void => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "999");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // Above-range clamps to 100 percent on display, fraction 1.0
    // surfaces via onQualityChange.
    expect(input.value).toBe("100");
    expect(onQualityChange).toHaveBeenLastCalledWith(qualityPercentToFraction(100));
    cleanup();
  });
});

describe("CreateFromImagesDialog — close paths", () => {
  it("fires onClose when the backdrop is clicked (genuine outside click)", () => {
    // B3/B6 — a REAL outside click (mousedown AND click both on the
    // backdrop) still closes; `backdrop.click()` alone dispatches
    // only the click, so the mousedown must fire first.
    const onClose = vi.fn();
    const { container, cleanup } = renderDialog({ onClose });
    const backdrop = container.querySelector<HTMLElement>(".modal-backdrop");
    expect(backdrop).not.toBeNull();
    if (backdrop === null) return cleanup();
    act((): void => {
      backdrop.dispatchEvent(
        new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
      );
    });
    act((): void => {
      backdrop.click();
    });
    expect(onClose).toHaveBeenCalled();
    cleanup();
  });

  it("fires onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    const { container, cleanup } = renderDialog({ onClose });
    const close = container.querySelector<HTMLButtonElement>(
      "button[aria-label='Close dialog']",
    );
    expect(close).not.toBeNull();
    if (close === null) return cleanup();
    act((): void => {
      close.click();
    });
    expect(onClose).toHaveBeenCalled();
    cleanup();
  });
});

describe("clampCreateImageQuality — boundary clamp (0..1 fraction)", () => {
  it("clamps negative values up to 0", () => {
    expect(clampCreateImageQuality(-0.5)).toBe(0);
    expect(clampCreateImageQuality(-1)).toBe(0);
  });
  it("clamps above-1 values down to 1", () => {
    expect(clampCreateImageQuality(1.1)).toBe(1);
    expect(clampCreateImageQuality(9999)).toBe(1);
  });
  it("rounds fractional input to 3 decimal places", () => {
    expect(clampCreateImageQuality(0.1234)).toBe(0.123);
    expect(clampCreateImageQuality(0.85)).toBe(0.85);
    expect(clampCreateImageQuality(0.5)).toBe(0.5);
  });
  it("passes valid fractions through", () => {
    expect(clampCreateImageQuality(0)).toBe(0);
    expect(clampCreateImageQuality(1)).toBe(1);
    expect(clampCreateImageQuality(0.85)).toBe(0.85);
  });
});
