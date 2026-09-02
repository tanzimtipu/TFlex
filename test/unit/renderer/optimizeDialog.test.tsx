// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so
// that `act` recognises the test env and stops spamming stderr.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { OptimizeDialog } from "../../../src/renderer/components/OptimizeDialog";
import type { OptimizePreset, SpaceAudit } from "../../../src/shared/types";

/**
 * Phase 8 — Optimize dialog rendering tests. These pin the dialog's
 * contract: preset selector with three radios, before/after FFT
 * comparison, confirm runs the runOptimize callback with the chosen
 * preset, and cancel closes without firing the callback. The dialog
 * also exposes a one-line "biggest category" hint when the optional
 * runAuditSpace callback returns a valid audit.
 */

interface RenderArgs {
  initialPreset?: OptimizePreset;
  originalBytes?: number;
  runOptimize?: (preset: OptimizePreset) => Promise<{ bytes: ArrayBuffer; size: number } | { error: string }>;
  runAuditSpace?: () => Promise<SpaceAudit | { error: string }>;
  onConfirm?: (preset: OptimizePreset, bytes: ArrayBuffer) => void;
  /** DEF-039 — optional callback fired whenever the user picks a
   *  different preset in the radio group. The dialog passes the
   *  new preset value through; the host (App.tsx) wires this into
   *  the preferences reducer + trackAndPersist so the choice
   *  survives across launches. */
  onOptimizePresetChange?: (preset: OptimizePreset) => void;
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
      <OptimizeDialog
        open={true}
        initialPreset={args.initialPreset ?? "none"}
        originalBytes={args.originalBytes ?? 1024 * 200}
        runOptimize={
          args.runOptimize ?? (async (): Promise<{ bytes: ArrayBuffer; size: number }> => ({
            bytes: new ArrayBuffer(1024 * 150),
            size: 1024 * 150,
          }))
        }
        runAuditSpace={args.runAuditSpace}
        onConfirm={args.onConfirm ?? ((): void => undefined)}
        onOptimizePresetChange={args.onOptimizePresetChange}
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

describe("OptimizeDialog — preset selector (Phase 8)", () => {
  it("renders all three preset radios with the initial preset checked", () => {
    const { container, cleanup } = renderDialog({ initialPreset: "compact" });
    const radios = container.querySelectorAll<HTMLInputElement>(
      'input[name="optimize-preset"]',
    );
    expect(radios.length).toBe(3);
    const checked = Array.from(radios).filter((r) => r.checked);
    expect(checked.length).toBe(1);
    expect(checked[0]?.value).toBe("compact");
    cleanup();
  });

  it("switches the checked radio when the user picks a different preset", () => {
    const { container, cleanup } = renderDialog({ initialPreset: "none" });
    const max = container.querySelector<HTMLInputElement>(
      'input[value="max"]',
    );
    expect(max).not.toBeNull();
    if (max === null) return cleanup();
    act((): void => {
      max.click();
    });
    expect(max.checked).toBe(true);
    cleanup();
  });

  it("renders the FFT before/after comparison row", () => {
    const { container, cleanup } = renderDialog({ originalBytes: 1024 * 500 });
    const before = container.querySelector('[data-optimize-fft-before]');
    const after = container.querySelector('[data-optimize-fft-after]');
    const delta = container.querySelector('[data-optimize-fft-delta]');
    expect(before).not.toBeNull();
    expect(after).not.toBeNull();
    expect(delta).not.toBeNull();
    expect(before?.textContent).toContain("500");
    cleanup();
  });

  it("renders the biggest-category hint when the audit returns valid data", async () => {
    const audit: SpaceAudit = {
      totalBytes: 10_000,
      breakdown: {
        images: 6000,
        fonts: 1000,
        contentStreams: 2000,
        metadata: 500,
        other: 500,
      },
    };
    const { container, cleanup } = renderDialog({
      runAuditSpace: async (): Promise<SpaceAudit> => audit,
    });
    // wait for the audit promise microtask to settle
    await act(async (): Promise<void> => {
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Images");
    cleanup();
  });

  it("shows an error hint when auditSpace fails", async () => {
    const { container, cleanup } = renderDialog({
      runAuditSpace: async (): Promise<{ error: string }> => ({
        error: "engine-error",
      }),
    });
    await act(async (): Promise<void> => {
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Audit unavailable");
    cleanup();
  });

  it("confirm click runs runOptimize with the currently selected preset", async () => {
    const runOptimize = vi.fn(
      async (_preset: OptimizePreset): Promise<{ bytes: ArrayBuffer; size: number }> => ({
        bytes: new ArrayBuffer(0),
        size: 0,
      }),
    );
    const { container, cleanup } = renderDialog({
      initialPreset: "max",
      runOptimize,
    });
    const confirm = container.querySelector<HTMLButtonElement>(
      "[data-optimize-confirm]",
    );
    expect(confirm).not.toBeNull();
    if (confirm === null) return cleanup();
    await act(async (): Promise<void> => {
      confirm.click();
      await Promise.resolve();
    });
    expect(runOptimize).toHaveBeenCalledWith("max");
    cleanup();
  });

  it("onClose fires when the backdrop is clicked", () => {
    // B3/B6 — genuine outside click = mousedown + click on the
    // backdrop.
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

  it("renders nothing when open=false", () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    act((): void => {
      root.render(
        <OptimizeDialog
          open={false}
          initialPreset="none"
          originalBytes={0}
          runOptimize={async (): Promise<{ bytes: ArrayBuffer; size: number }> => ({
            bytes: new ArrayBuffer(0),
            size: 0,
          })}
          onConfirm={(): void => undefined}
          onClose={(): void => undefined}
        />,
      );
    });
    expect(container.querySelector(".modal-dialog")).toBeNull();
    act((): void => {
      root.unmount();
    });
    container.remove();
  });

  // DEF-039 — preset choice must persist in AppSettings. The dialog
  // surfaces the user's choice via `onOptimizePresetChange` whenever a
  // radio is toggled (not just on confirm), so the host can dispatch
  // the preferences reducer and write through `trackAndPersist`. The
  // tests below pin that contract: the callback fires on every radio
  // toggle, including switches back to the existing preset (the host
  // reducer is idempotent and no-ops equal values).
  describe("OptimizeDialog — onOptimizePresetChange (DEF-039)", () => {
    /** Pick a preset by clicking the label that wraps the radio.
     *  React 19's event delegation listens on the root, so a
     *  bubbling `click` on the label reaches React's onChange on the
     *  embedded input (the same path the browser uses when a user
     *  clicks a styled radio label). This avoids jsdom-specific
     *  quirks where calling `.click()` on a hidden `<input type=radio>`
     *  does not always trigger the React synthetic onChange event. */
    function pickRadio(container: HTMLElement, value: OptimizePreset): void {
      const radio = container.querySelector<HTMLInputElement>(
        `input[value="${value}"]`,
      );
      expect(radio).not.toBeNull();
      if (radio === null) return;
      // The label is the parent of the radio (per OptimizeDialog's
      // <label> wrapping).
      const label = radio.closest("label");
      expect(label).not.toBeNull();
      if (label === null) return;
      act((): void => {
        label.click();
      });
    }

    it("fires onOptimizePresetChange when the user picks a different preset", () => {
      const onOptimizePresetChange = vi.fn();
      const { container, cleanup } = renderDialog({
        initialPreset: "none",
        onOptimizePresetChange,
      });
      pickRadio(container, "max");
      expect(onOptimizePresetChange).toHaveBeenCalledWith("max");
      cleanup();
    });

    it("fires onOptimizePresetChange when the user toggles to the existing preset", () => {
      // Same-input re-selection still fires so the host reducer has
      // the final word on whether the write is a no-op. The reducer's
      // equality guard short-circuits the persist path so this is
      // harmless at runtime; the contract is "every radio toggle
      // surfaces". Native HTML radio buttons don't fire `change`
      // when clicked while already selected, so we click another
      // option first to force a `change`, then click back to the
      // initial — that exercises the "user re-selects the existing
      // preset" branch.
      const onOptimizePresetChange = vi.fn();
      const { container, cleanup } = renderDialog({
        initialPreset: "compact",
        onOptimizePresetChange,
      });
      pickRadio(container, "max");
      pickRadio(container, "compact");
      // The second click re-selects `compact`. The host reducer
      // idempotently no-ops on equal values, but the dialog still
      // surfaces the choice to the host so it can decide.
      expect(onOptimizePresetChange).toHaveBeenLastCalledWith("compact");
      cleanup();
    });

    it("fires for each preset option", () => {
      // All three radios should surface their value through the
      // callback. This guards against a future refactor that
      // accidentally only registers one of them. We cycle through
      // them in order, never re-clicking the initial value (native
      // radios no-op on same-value click).
      const onOptimizePresetChange = vi.fn();
      const { container, cleanup } = renderDialog({
        initialPreset: "compact",
        onOptimizePresetChange,
      });
      // Cycle: max -> none -> compact. Three distinct change events.
      pickRadio(container, "max");
      pickRadio(container, "none");
      pickRadio(container, "compact");
      expect(onOptimizePresetChange).toHaveBeenCalledTimes(3);
      expect(onOptimizePresetChange).toHaveBeenNthCalledWith(1, "max");
      expect(onOptimizePresetChange).toHaveBeenNthCalledWith(2, "none");
      expect(onOptimizePresetChange).toHaveBeenNthCalledWith(3, "compact");
      cleanup();
    });

    it("does not crash when onOptimizePresetChange is omitted (backward compat)", () => {
      // Existing callers that don't yet wire the persistence path
      // must still render. The dialog treats the callback as
      // optional; the radio just calls into undefined.
      const { container, cleanup } = renderDialog({ initialPreset: "none" });
      expect((): void => pickRadio(container, "max")).not.toThrow();
      cleanup();
    });
  });
});
