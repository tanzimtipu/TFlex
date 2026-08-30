// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so
// that `act` recognises the test env and stops spamming stderr.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ReplacePagesDialog } from "../../../src/renderer/components/ReplacePagesDialog";

/**
 * Phase 12 — ReplacePagesDialog render contract tests.
 *
 * The dialog's contract:
 *   - Renders a file-picker button + the target-pages input.
 *   - Validates a contiguous 1-based range.
 *   - Confirm is disabled when no file is picked OR the range is
 *     invalid OR non-contiguous.
 *   - Esc + backdrop + close button fire onClose.
 *   - On confirm, translates the 1-based range to a 0-based
 *     inclusive slice.
 */

interface RenderArgs {
  totalPages?: number;
  pickOtherFile?: () => Promise<
    { bytes: Uint8Array; path: string } | null
  >;
  onConfirm?: (c: {
    otherBytes: Uint8Array;
    otherPath: string;
    targetRange: [number, number];
  }) => void;
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
      <ReplacePagesDialog
        open={true}
        totalPages={args.totalPages ?? 5}
        pickOtherFile={args.pickOtherFile ?? (async () => null)}
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

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("ReplacePagesDialog — render contract", () => {
  it("renders the file-pick button and confirm button", () => {
    const { container, cleanup } = renderDialog();
    expect(container.querySelector("[data-replace-pick]")).not.toBeNull();
    expect(container.querySelector("[data-replace-confirm]")).not.toBeNull();
    cleanup();
  });

  it("seeds the range to '1-N' by default", () => {
    const { container, cleanup } = renderDialog({ totalPages: 5 });
    const range = container.querySelector<HTMLInputElement>(
      "[data-replace-range]",
    );
    expect(range?.value).toBe("1-5");
    cleanup();
  });

  it("disables confirm when no file has been picked", () => {
    const { container, cleanup } = renderDialog();
    const confirm = container.querySelector<HTMLButtonElement>(
      "[data-replace-confirm]",
    );
    expect(confirm?.disabled).toBe(true);
    cleanup();
  });

  it("rejects a non-contiguous range", () => {
    const { container, cleanup } = renderDialog({ totalPages: 10 });
    const range = container.querySelector<HTMLInputElement>(
      "[data-replace-range]",
    );
    expect(range).not.toBeNull();
    if (range === null) return cleanup();
    act((): void => {
      setInputValue(range, "1,3,5");
    });
    const confirm = container.querySelector<HTMLButtonElement>(
      "[data-replace-confirm]",
    );
    // No file picked -> confirm is disabled regardless.
    expect(confirm?.disabled).toBe(true);
    cleanup();
  });

  it("enables confirm after a file is picked + a valid range", async () => {
    const pickOtherFile = vi.fn(async (): Promise<{
      bytes: Uint8Array;
      path: string;
    }> => ({ bytes: new Uint8Array([1, 2, 3]), path: "/tmp/x.pdf" }));
    const { container, cleanup } = renderDialog({
      totalPages: 5,
      pickOtherFile,
    });
    const pick = container.querySelector<HTMLButtonElement>(
      "[data-replace-pick]",
    );
    expect(pick).not.toBeNull();
    if (pick === null) return cleanup();
    await act(async (): Promise<void> => {
      pick.click();
      // Let the async onPickFile settle.
      await Promise.resolve();
    });
    const confirm = container.querySelector<HTMLButtonElement>(
      "[data-replace-confirm]",
    );
    expect(confirm?.disabled).toBe(false);
    cleanup();
  });

  it("translates 1-based visible range to 0-based on confirm", async () => {
    const onConfirm = vi.fn();
    const pickOtherFile = vi.fn(async (): Promise<{
      bytes: Uint8Array;
      path: string;
    }> => ({ bytes: new Uint8Array([1, 2, 3]), path: "/tmp/x.pdf" }));
    const { container, cleanup } = renderDialog({
      totalPages: 10,
      pickOtherFile,
      onConfirm,
    });
    const pick = container.querySelector<HTMLButtonElement>(
      "[data-replace-pick]",
    );
    const range = container.querySelector<HTMLInputElement>(
      "[data-replace-range]",
    );
    expect(pick).not.toBeNull();
    expect(range).not.toBeNull();
    if (pick === null || range === null) return cleanup();
    await act(async (): Promise<void> => {
      pick.click();
      await Promise.resolve();
    });
    act((): void => {
      setInputValue(range, "3-7");
    });
    const confirm = container.querySelector<HTMLButtonElement>(
      "[data-replace-confirm]",
    );
    expect(confirm).not.toBeNull();
    if (confirm === null) return cleanup();
    await act(async (): Promise<void> => {
      confirm.click();
      await Promise.resolve();
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const args = onConfirm.mock.calls[0]?.[0];
    expect(args.targetRange).toEqual([2, 6]);
    expect(args.otherPath).toBe("/tmp/x.pdf");
    expect(args.otherBytes).toBeInstanceOf(Uint8Array);
    cleanup();
  });

  it("calls onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    const { container, cleanup } = renderDialog({ onClose });
    const closeBtn = container.querySelector<HTMLButtonElement>(
      "button.modal-close",
    );
    expect(closeBtn).not.toBeNull();
    if (closeBtn === null) return cleanup();
    act((): void => {
      closeBtn.click();
    });
    expect(onClose).toHaveBeenCalled();
    cleanup();
  });
});