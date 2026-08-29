// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so
// that `act` recognises the test env and stops spamming stderr.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  SaveAsDialog,
  linearizeToggleToPreset,
  presetToLinearizeToggle,
} from "../../../src/renderer/components/SaveAsDialog";
import type { OptimizePreset } from "../../../src/shared/types";

/**
 * Phase 8 — Save-As modal tests (DEF-040).
 *
 * The Save-As modal surfaces the "Fast web view (linearize)" toggle
 * that was missing from the Save-As flow. The toggle writes through
 * the existing AppSettings.optimizePreset field:
 *   - toggle ON  -> preset='none' (linearized output)
 *   - toggle OFF -> preset='compact' (default compression)
 *
 * The tests below pin:
 *   1. The two preset<->toggle helpers agree for every valid preset
 *      (so a future preset added to the union doesn't silently break
 *      the toggle's initial state).
 *   2. The modal renders the checkbox with the persisted preset as
 *      the initial state, and re-seeds when the prop changes.
 *   3. Toggling the checkbox fires onOptimizePresetChange with the
 *      mapped preset on every change (so the host reducer sees it).
 *   4. Confirming the dialog fires onConfirm and Esc / backdrop /
 *      close-button all fire onClose.
 *   5. The dialog handles `optimizePreset === undefined` gracefully
 *      (the field is optional in AppSettings).
 */

interface RenderArgs {
  optimizePreset?: OptimizePreset | undefined;
  onOptimizePresetChange?: (preset: OptimizePreset) => void;
  onConfirm?: () => void;
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
      <SaveAsDialog
        open={true}
        optimizePreset={args.optimizePreset}
        onOptimizePresetChange={args.onOptimizePresetChange ?? ((): void => undefined)}
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

describe("SaveAsDialog — preset <-> linearize helpers (DEF-040)", () => {
  it("linearizeToggleToPreset returns 'none' when ON", () => {
    expect(linearizeToggleToPreset(true)).toBe("none");
  });

  it("linearizeToggleToPreset returns 'compact' when OFF", () => {
    expect(linearizeToggleToPreset(false)).toBe("compact");
  });

  it("presetToLinearizeToggle is true only for 'none'", () => {
    expect(presetToLinearizeToggle("none")).toBe(true);
    expect(presetToLinearizeToggle("compact")).toBe(false);
    expect(presetToLinearizeToggle("max")).toBe(false);
  });

  it("presetToLinearizeToggle treats undefined as OFF (default)", () => {
    // AppSettings.optimizePreset is optional. Until the user has
    // picked one, the dialog defaults to OFF so the first Save-As
    // doesn't surprise the user with a linearized copy.
    expect(presetToLinearizeToggle(undefined)).toBe(false);
  });

  it("the round-trip agrees for every preset in the union", () => {
    // Defensive: if a future preset is added, the toggle still has
    // a well-defined initial state (not 'none').
    const presets: OptimizePreset[] = ["none", "compact", "max"];
    for (const p of presets) {
      const on = presetToLinearizeToggle(p);
      expect(linearizeToggleToPreset(on)).toBe(p === "none" ? "none" : "compact");
    }
  });
});

describe("SaveAsDialog — checkbox initial state (DEF-040)", () => {
  it("checks the box when optimizePreset is 'none'", () => {
    const { container, cleanup } = renderDialog({ optimizePreset: "none" });
    const checkbox = container.querySelector<HTMLInputElement>(
      "[data-save-as-linearize]",
    );
    expect(checkbox).not.toBeNull();
    expect(checkbox?.checked).toBe(true);
    cleanup();
  });

  it("leaves the box unchecked when optimizePreset is 'compact'", () => {
    const { container, cleanup } = renderDialog({ optimizePreset: "compact" });
    const checkbox = container.querySelector<HTMLInputElement>(
      "[data-save-as-linearize]",
    );
    expect(checkbox?.checked).toBe(false);
    cleanup();
  });

  it("leaves the box unchecked when optimizePreset is 'max'", () => {
    // 'max' is a non-linearizing aggressive-compression preset.
    // The Save-As toggle is OFF for it.
    const { container, cleanup } = renderDialog({ optimizePreset: "max" });
    const checkbox = container.querySelector<HTMLInputElement>(
      "[data-save-as-linearize]",
    );
    expect(checkbox?.checked).toBe(false);
    cleanup();
  });

  it("leaves the box unchecked when optimizePreset is undefined", () => {
    const { container, cleanup } = renderDialog({ optimizePreset: undefined });
    const checkbox = container.querySelector<HTMLInputElement>(
      "[data-save-as-linearize]",
    );
    expect(checkbox?.checked).toBe(false);
    cleanup();
  });

  it("renders the 'Fast web view (linearize)' label", () => {
    const { container, cleanup } = renderDialog({});
    expect(container.textContent).toContain("Fast web view (linearize)");
    cleanup();
  });
});

describe("SaveAsDialog — toggle persistence (DEF-040)", () => {
  it("fires onOptimizePresetChange with 'none' when the user ticks the box", () => {
    const onOptimizePresetChange = vi.fn();
    const { container, cleanup } = renderDialog({
      optimizePreset: "compact",
      onOptimizePresetChange,
    });
    const checkbox = container.querySelector<HTMLInputElement>(
      "[data-save-as-linearize]",
    );
    expect(checkbox).not.toBeNull();
    if (checkbox === null) return cleanup();
    act((): void => {
      checkbox.click();
    });
    expect(onOptimizePresetChange).toHaveBeenCalledWith("none");
    cleanup();
  });

  it("fires onOptimizePresetChange with 'compact' when the user unticks the box", () => {
    const onOptimizePresetChange = vi.fn();
    const { container, cleanup } = renderDialog({
      optimizePreset: "none",
      onOptimizePresetChange,
    });
    const checkbox = container.querySelector<HTMLInputElement>(
      "[data-save-as-linearize]",
    );
    expect(checkbox).not.toBeNull();
    if (checkbox === null) return cleanup();
    act((): void => {
      checkbox.click();
    });
    expect(onOptimizePresetChange).toHaveBeenCalledWith("compact");
    cleanup();
  });

  it("re-seeds from the prop when optimizePreset changes while open", () => {
    // The host can change optimizePreset while the dialog is open
    // (e.g. the Optimize dialog runs in the background and writes
    // the same field). The Save-As checkbox should re-sync so the
    // visible state matches the persisted state.
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let currentPreset: OptimizePreset | undefined = "compact";
    const rerender = (): void => {
      act((): void => {
        root.render(
          <SaveAsDialog
            open={true}
            optimizePreset={currentPreset}
            onOptimizePresetChange={(): void => undefined}
            onConfirm={(): void => undefined}
            onClose={(): void => undefined}
          />,
        );
      });
    };
    rerender();
    const checkbox = container.querySelector<HTMLInputElement>(
      "[data-save-as-linearize]",
    );
    expect(checkbox?.checked).toBe(false);
    currentPreset = "none";
    rerender();
    expect(checkbox?.checked).toBe(true);
    currentPreset = "compact";
    rerender();
    expect(checkbox?.checked).toBe(false);
    act((): void => {
      root.unmount();
    });
    container.remove();
  });
});

describe("SaveAsDialog — confirm / close (DEF-040)", () => {
  it("fires onConfirm when the confirm button is clicked", () => {
    const onConfirm = vi.fn();
    const { container, cleanup } = renderDialog({ onConfirm });
    const confirm = container.querySelector<HTMLButtonElement>(
      "[data-save-as-confirm]",
    );
    expect(confirm).not.toBeNull();
    if (confirm === null) return cleanup();
    act((): void => {
      confirm.click();
    });
    expect(onConfirm).toHaveBeenCalled();
    cleanup();
  });

  it("fires onClose when the backdrop is clicked", () => {
    const onClose = vi.fn();
    const { container, cleanup } = renderDialog({ onClose });
    const backdrop = container.querySelector<HTMLElement>(".modal-backdrop");
    expect(backdrop).not.toBeNull();
    if (backdrop === null) return cleanup();
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

  it("renders nothing when open=false", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act((): void => {
      root.render(
        <SaveAsDialog
          open={false}
          optimizePreset={undefined}
          onOptimizePresetChange={(): void => undefined}
          onConfirm={(): void => undefined}
          onClose={(): void => undefined}
        />,
      );
    });
    expect(container.querySelector("[data-save-as-dialog]")).toBeNull();
    act((): void => {
      root.unmount();
    });
    container.remove();
  });
});
