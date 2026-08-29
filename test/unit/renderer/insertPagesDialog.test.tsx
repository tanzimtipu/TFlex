// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so
// that `act` recognises the test env and stops spamming stderr.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { InsertPagesDialog } from "../../../src/renderer/components/InsertPagesDialog";

/**
 * Phase 9 — InsertPagesDialog render contract tests.
 *
 * The dialog's contract:
 *   - Renders two mode radios (blank / from PDF).
 *   - Position field validates 1..totalPages+1 or "end".
 *   - Confirm is disabled when the position is invalid or
 *     (from-PDF mode) no file has been picked.
 *   - Esc + backdrop + close button fire onClose.
 */

interface RenderArgs {
  totalPages?: number;
  pickOtherFile?: () => Promise<
    { bytes: Uint8Array; path: string } | null
  >;
  onConfirm?: (c: {
    mode: "blank" | "fromPdf";
    position: number;
    widthPt?: number;
    heightPt?: number;
    otherBytes?: Uint8Array;
    otherPath?: string;
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
      <InsertPagesDialog
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

describe("InsertPagesDialog — render contract", () => {
  it("renders both mode radios and the confirm button", () => {
    const { container, cleanup } = renderDialog();
    expect(container.querySelector("[data-insert-mode='blank']")).not.toBeNull();
    expect(container.querySelector("[data-insert-mode='fromPdf']")).not.toBeNull();
    expect(container.querySelector("[data-insert-confirm]")).not.toBeNull();
    cleanup();
  });

  it("seeds the position field to 'end' by default", () => {
    const { container, cleanup } = renderDialog({ totalPages: 5 });
    const position = container.querySelector<HTMLInputElement>(
      "[data-insert-position]",
    );
    expect(position?.value).toBe("6");
    cleanup();
  });

  it("disables confirm when the position is out of range", () => {
    const { container, cleanup } = renderDialog({ totalPages: 3 });
    const position = container.querySelector<HTMLInputElement>(
      "[data-insert-position]",
    );
    const confirm = container.querySelector<HTMLButtonElement>(
      "[data-insert-confirm]",
    );
    expect(position).not.toBeNull();
    expect(confirm).not.toBeNull();
    if (position === null || confirm === null) return cleanup();
    act((): void => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(position, "999");
      position.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(confirm.disabled).toBe(true);
    cleanup();
  });

  it("renders the size preset radios in blank mode", () => {
    const { container, cleanup } = renderDialog();
    for (const id of ["letter", "a4", "legal", "square"]) {
      expect(
        container.querySelector<HTMLInputElement>(
          `[data-insert-preset="${id}"]`,
        ),
      ).not.toBeNull();
    }
    cleanup();
  });
});

describe("InsertPagesDialog — close paths", () => {
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
});
