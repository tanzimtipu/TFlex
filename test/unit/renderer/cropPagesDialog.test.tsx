// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so
// that `act` recognises the test env and stops spamming stderr.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi, beforeAll } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CropPagesDialog } from "../../../src/renderer/components/CropPagesDialog";
import type { CropEntry } from "../../../src/shared/types";

/**
 * Phase 12 — CropPagesDialog render contract tests.
 *
 * The dialog's contract:
 *   - Renders two mode radios (allPages / perPage) and a confirm
 *     button.
 *   - In allPages mode, one box is emitted for every page.
 *   - In perPage mode, a per-page select picker switches the
 *     editor; the per-page boxes are emitted on confirm.
 *   - Boxes are emitted in page points (top-left origin), one
 *     CropEntry per page.
 *   - Esc + close button fire onClose.
 *
 * jsdom doesn't ship a working `ResizeObserver`; the dialog's
 * crop-editor uses one to track its wrap size. We polyfill a no-op
 * observer before the import so the dialog can mount without
 * crashing.
 */

beforeAll(() => {
  class StubResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as unknown as { ResizeObserver: typeof StubResizeObserver }).ResizeObserver =
    StubResizeObserver;
});

interface RenderArgs {
  totalPages?: number;
  pageSizes?: Record<number, { widthPt: number; heightPt: number }>;
  onConfirm?: (c: { entries: CropEntry[] }) => void;
  onClose?: () => void;
}

const DEFAULT_PAGE_SIZES: Record<number, { widthPt: number; heightPt: number }> = {
  1: { widthPt: 612, heightPt: 792 },
  2: { widthPt: 612, heightPt: 792 },
  3: { widthPt: 612, heightPt: 792 },
};

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
      <CropPagesDialog
        open={true}
        totalPages={args.totalPages ?? 3}
        pageSizes={args.pageSizes ?? DEFAULT_PAGE_SIZES}
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

describe("CropPagesDialog — render contract", () => {
  it("renders both mode radios and the confirm button", () => {
    const { container, cleanup } = renderDialog();
    expect(container.querySelector("[data-crop-mode='allPages']")).not.toBeNull();
    expect(container.querySelector("[data-crop-mode='perPage']")).not.toBeNull();
    expect(container.querySelector("[data-crop-confirm]")).not.toBeNull();
    cleanup();
  });

  it("emits one crop entry per page in allPages mode", () => {
    const onConfirm = vi.fn();
    const { container, cleanup } = renderDialog({
      totalPages: 3,
      onConfirm,
    });
    const confirm = container.querySelector<HTMLButtonElement>(
      "[data-crop-confirm]",
    );
    expect(confirm).not.toBeNull();
    if (confirm === null) return cleanup();
    act((): void => {
      confirm.click();
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const entries = onConfirm.mock.calls[0]?.[0].entries;
    expect(entries.length).toBe(3);
    expect(entries[0].page).toBe(1);
    expect(entries[1].page).toBe(2);
    expect(entries[2].page).toBe(3);
    for (const e of entries) {
      expect(e.box.width).toBeGreaterThan(0);
      expect(e.box.height).toBeGreaterThan(0);
    }
    cleanup();
  });

  it("emits one crop entry per page in perPage mode", () => {
    const onConfirm = vi.fn();
    const { container, cleanup } = renderDialog({
      totalPages: 2,
      onConfirm,
    });
    // Switch to perPage mode.
    const perPageRadio = container.querySelector<HTMLInputElement>(
      "[data-crop-mode='perPage']",
    );
    expect(perPageRadio).not.toBeNull();
    if (perPageRadio === null) return cleanup();
    act((): void => {
      perPageRadio.click();
    });
    const confirm = container.querySelector<HTMLButtonElement>(
      "[data-crop-confirm]",
    );
    expect(confirm).not.toBeNull();
    if (confirm === null) return cleanup();
    act((): void => {
      confirm.click();
    });
    const entries = onConfirm.mock.calls[0]?.[0].entries;
    expect(entries.length).toBe(2);
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