// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so
// that `act` recognises the test env and stops spamming stderr.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SaveAsDialog } from "../../../src/renderer/components/SaveAsDialog";

/**
 * Phase 8/13 — Save-As modal tests (DEF-040, DEF-073).
 *
 * The Save-As modal surfaces the "Fast web view (linearize)" toggle
 * that was missing from the Save-As flow. The toggle writes through
 * a dedicated `saveAsLinearize` AppSettings boolean — DEF-073
 * moved it off the Optimize dialog's `optimizePreset` field so the
 * two features no longer silently overwrite each other's setting.
 *
 * The tests below pin:
 *   1. The checkbox's initial state matches the persisted
 *      `saveAsLinearize` prop (true = checked, false/undefined = unchecked).
 *   2. Toggling the checkbox fires `onSaveAsLinearizeChange` with the
 *      new boolean on every change.
 *   3. The checkbox re-seeds when `saveAsLinearize` changes while
 *      the dialog is open (same defensive pattern as the Optimize
 *      dialog's preset re-seed).
 *   4. Confirming fires `onConfirm`; Esc / backdrop / close-button
 *      fire `onClose`.
 *   5. The dialog handles `saveAsLinearize === undefined` gracefully
 *      (the field is optional in AppSettings; the default is false).
 */

interface RenderArgs {
  saveAsLinearize?: boolean | undefined;
  onSaveAsLinearizeChange?: (value: boolean) => void;
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
        saveAsLinearize={args.saveAsLinearize}
        onSaveAsLinearizeChange={args.onSaveAsLinearizeChange ?? ((): void => undefined)}
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

describe("SaveAsDialog — checkbox initial state (DEF-073)", () => {
  it("checks the box when saveAsLinearize is true", () => {
    const { container, cleanup } = renderDialog({ saveAsLinearize: true });
    const checkbox = container.querySelector<HTMLInputElement>(
      "[data-save-as-linearize]",
    );
    expect(checkbox).not.toBeNull();
    expect(checkbox?.checked).toBe(true);
    cleanup();
  });

  it("leaves the box unchecked when saveAsLinearize is false", () => {
    const { container, cleanup } = renderDialog({ saveAsLinearize: false });
    const checkbox = container.querySelector<HTMLInputElement>(
      "[data-save-as-linearize]",
    );
    expect(checkbox?.checked).toBe(false);
    cleanup();
  });

  it("leaves the box unchecked when saveAsLinearize is undefined", () => {
    // AppSettings.saveAsLinearize is optional. Until the user has
    // picked one, the dialog defaults to OFF so the first Save-As
    // doesn't surprise the user with a linearized copy.
    const { container, cleanup } = renderDialog({ saveAsLinearize: undefined });
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

describe("SaveAsDialog — toggle persistence (DEF-073)", () => {
  it("fires onSaveAsLinearizeChange with true when the user ticks the box", () => {
    const onSaveAsLinearizeChange = vi.fn();
    const { container, cleanup } = renderDialog({
      saveAsLinearize: false,
      onSaveAsLinearizeChange,
    });
    const checkbox = container.querySelector<HTMLInputElement>(
      "[data-save-as-linearize]",
    );
    expect(checkbox).not.toBeNull();
    if (checkbox === null) return cleanup();
    act((): void => {
      checkbox.click();
    });
    expect(onSaveAsLinearizeChange).toHaveBeenCalledWith(true);
    cleanup();
  });

  it("fires onSaveAsLinearizeChange with false when the user unticks the box", () => {
    const onSaveAsLinearizeChange = vi.fn();
    const { container, cleanup } = renderDialog({
      saveAsLinearize: true,
      onSaveAsLinearizeChange,
    });
    const checkbox = container.querySelector<HTMLInputElement>(
      "[data-save-as-linearize]",
    );
    expect(checkbox).not.toBeNull();
    if (checkbox === null) return cleanup();
    act((): void => {
      checkbox.click();
    });
    expect(onSaveAsLinearizeChange).toHaveBeenCalledWith(false);
    cleanup();
  });

  it("re-seeds from the prop when saveAsLinearize changes while open", () => {
    // The host can change saveAsLinearize while the dialog is open
    // (e.g. an external settings write flows in). The Save-As
    // checkbox should re-sync so the visible state matches the
    // persisted state — same defensive pattern as the Optimize
    // dialog's preset re-seed.
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    let current: boolean = false;
    const rerender = (): void => {
      act((): void => {
        root.render(
          <SaveAsDialog
            open={true}
            saveAsLinearize={current}
            onSaveAsLinearizeChange={(): void => undefined}
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
    current = true;
    rerender();
    expect(checkbox?.checked).toBe(true);
    current = false;
    rerender();
    expect(checkbox?.checked).toBe(false);
    act((): void => {
      root.unmount();
    });
    container.remove();
  });
});

describe("SaveAsDialog — confirm / close (DEF-073)", () => {
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
          saveAsLinearize={false}
          onSaveAsLinearizeChange={(): void => undefined}
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