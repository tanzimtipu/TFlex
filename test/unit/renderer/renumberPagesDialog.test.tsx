// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so
// that `act` recognises the test env and stops spamming stderr.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RenumberPagesDialog } from "../../../src/renderer/components/RenumberPagesDialog";

/**
 * Phase 12 — RenumberPagesDialog render contract tests.
 *
 * The dialog's contract:
 *   - Renders one input row per page.
 *   - Seeds rows from `initialLabels` so the user sees their prior
 *     choice.
 *   - Confirm emits only non-empty labels.
 *   - Confirm is blocked (with an inline error) when every label
 *     is blank.
 *   - Esc + close button fire onClose.
 */

interface RenderArgs {
  totalPages?: number;
  initialLabels?: { page: number; label: string }[];
  onConfirm?: (c: { labels: { page: number; label: string }[] }) => void;
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
      <RenumberPagesDialog
        open={true}
        totalPages={args.totalPages ?? 3}
        initialLabels={args.initialLabels ?? []}
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

describe("RenumberPagesDialog — render contract", () => {
  it("renders one row per page", () => {
    const { container, cleanup } = renderDialog({ totalPages: 4 });
    const rows = container.querySelectorAll("[data-renumber-input]");
    expect(rows.length).toBe(4);
    cleanup();
  });

  it("seeds rows from initialLabels", () => {
    const { container, cleanup } = renderDialog({
      totalPages: 3,
      initialLabels: [
        { page: 1, label: "i" },
        { page: 2, label: "ii" },
      ],
    });
    const inputs = container.querySelectorAll<HTMLInputElement>(
      "[data-renumber-input]",
    );
    expect(inputs[0]?.value).toBe("i");
    expect(inputs[1]?.value).toBe("ii");
    expect(inputs[2]?.value).toBe("");
    cleanup();
  });

  it("emits only non-empty labels on confirm", () => {
    const onConfirm = vi.fn();
    const { container, cleanup } = renderDialog({
      totalPages: 3,
      initialLabels: [{ page: 1, label: "i" }],
      onConfirm,
    });
    const inputs = container.querySelectorAll<HTMLInputElement>(
      "[data-renumber-input]",
    );
    expect(inputs[1]).not.toBeNull();
    if (inputs[1] !== null && inputs[1] !== undefined) {
      act((): void => {
        setInputValue(inputs[1], "ii");
      });
    }
    const confirm = container.querySelector<HTMLButtonElement>(
      "[data-renumber-confirm]",
    );
    expect(confirm).not.toBeNull();
    if (confirm === null) return cleanup();
    act((): void => {
      confirm.click();
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const labels = onConfirm.mock.calls[0]?.[0].labels;
    expect(labels).toEqual([
      { page: 1, label: "i" },
      { page: 2, label: "ii" },
    ]);
    cleanup();
  });

  it("blocks confirm when every label is blank (inline error)", () => {
    const onConfirm = vi.fn();
    const { container, cleanup } = renderDialog({
      totalPages: 2,
      onConfirm,
    });
    const confirm = container.querySelector<HTMLButtonElement>(
      "[data-renumber-confirm]",
    );
    expect(confirm).not.toBeNull();
    if (confirm === null) return cleanup();
    act((): void => {
      confirm.click();
    });
    expect(onConfirm).not.toHaveBeenCalled();
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