// @vitest-environment jsdom
// B8 — Delete pages dialog. The toolbar's Delete button opens a
// dialog with two modes:
//   - Current page: delete the page the user is on.
//   - Custom range: delete a contiguous range or comma list of pages.
//
// We exercise both modes end-to-end:
//   1. Render the dialog with `currentPage=2` and `totalPages=5`.
//   2. Default mode is "current" -> the radio reflects page 2.
//   3. Click Delete -> onConfirm fires with `pages: [2]`.
//   4. Re-open the dialog, switch to "range", type "3-5" -> the
//      parser resolves to [3, 4, 5].
//   5. Click Delete -> onConfirm fires with `pages: [3, 4, 5]`.
//   6. Validation: range "1-5" (all pages) -> onConfirm is gated
//      (button disabled / "must keep at least one").
//   7. Validation: invalid range "abc" -> error renders, button
//      disabled.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { DeletePageDialog } from "../../../src/renderer/components/DeletePageDialog";

interface HarnessArgs {
  currentPage: number;
  totalPages: number;
  onConfirm?: (c: { mode: "current" | "range"; pages: number[] }) => void;
  onClose?: () => void;
}

function mountDialog(args: HarnessArgs): {
  host: HTMLElement;
  rerender: (next: Partial<HarnessArgs>) => void;
  unmount: () => void;
  onConfirm: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onConfirm = vi.fn((): void => undefined);
  const onClose = vi.fn((): void => undefined);
  let current = { ...args, onConfirm, onClose };
  const render = (): void => {
    act((): void => {
      root.render(
        <DeletePageDialog
          open={true}
          totalPages={current.totalPages}
          currentPage={current.currentPage}
          onConfirm={current.onConfirm as unknown as (c: { mode: "current" | "range"; pages: number[] }) => void}
          onClose={current.onClose as unknown as () => void}
        />,
      );
    });
  };
  render();
  return {
    host,
    rerender: (next): void => {
      current = { ...current, ...next } as typeof current;
      render();
    },
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
    onConfirm,
    onClose,
  };
}

describe("B8 — Delete pages dialog (current / custom range)", () => {
  it("renders the dialog with the default 'current' mode selected", () => {
    const { host } = mountDialog({
      currentPage: 2,
      totalPages: 5,
      onConfirm: (): void => undefined,
      onClose: (): void => undefined,
    });
    const currentRadio = host.querySelector<HTMLInputElement>(
      "input[data-delete-mode='current']",
    );
    expect(currentRadio?.checked).toBe(true);
    // The label should reflect page 2.
    const label = host.querySelector("label")?.textContent;
    expect(label).toContain("2");
  });

  it("Delete commits the current page (mode=current, pages=[2])", () => {
    const { host, onConfirm } = mountDialog({
      currentPage: 2,
      totalPages: 5,
      onConfirm: (): void => undefined,
      onClose: (): void => undefined,
    });
    const confirmBtn = host.querySelector<HTMLButtonElement>(
      "[data-delete-confirm]",
    );
    expect(confirmBtn).not.toBeNull();
    if (confirmBtn === null) return;
    act((): void => {
      confirmBtn.click();
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0]?.[0]).toEqual({ mode: "current", pages: [2] });
  });

  it("range mode: typing '3-5' commits pages [3,4,5]", () => {
    const { host, onConfirm } = mountDialog({
      currentPage: 1,
      totalPages: 5,
      onConfirm: (): void => undefined,
      onClose: (): void => undefined,
    });
    // Switch to range mode.
    const rangeRadio = host.querySelector<HTMLInputElement>(
      "input[data-delete-mode='range']",
    );
    expect(rangeRadio).not.toBeNull();
    if (rangeRadio === null) return;
    act((): void => {
      rangeRadio.click();
    });
    // Type the range.
    const rangeInput = host.querySelector<HTMLInputElement>("[data-delete-range]");
    expect(rangeInput).not.toBeNull();
    if (rangeInput === null) return;
    act((): void => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(rangeInput, "3-5");
      rangeInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const confirmBtn = host.querySelector<HTMLButtonElement>(
      "[data-delete-confirm]",
    );
    expect(confirmBtn).not.toBeNull();
    if (confirmBtn === null) return;
    act((): void => {
      confirmBtn.click();
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0]?.[0]).toEqual({ mode: "range", pages: [3, 4, 5] });
  });

  it("range mode: comma list '1,3' commits pages [1,3]", () => {
    const { host, onConfirm } = mountDialog({
      currentPage: 1,
      totalPages: 5,
      onConfirm: (): void => undefined,
      onClose: (): void => undefined,
    });
    const rangeRadio = host.querySelector<HTMLInputElement>(
      "input[data-delete-mode='range']",
    );
    if (rangeRadio === null) return;
    act((): void => {
      rangeRadio.click();
    });
    const rangeInput = host.querySelector<HTMLInputElement>("[data-delete-range]");
    if (rangeInput === null) return;
    act((): void => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(rangeInput, "1,3");
      rangeInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const confirmBtn = host.querySelector<HTMLButtonElement>(
      "[data-delete-confirm]",
    );
    if (confirmBtn === null) return;
    act((): void => {
      confirmBtn.click();
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0]?.[0]).toEqual({ mode: "range", pages: [1, 3] });
  });

  it("range mode: deleting every page is gated (button disabled)", () => {
    const { host, onConfirm } = mountDialog({
      currentPage: 1,
      totalPages: 3,
      onConfirm: (): void => undefined,
      onClose: (): void => undefined,
    });
    const rangeRadio = host.querySelector<HTMLInputElement>(
      "input[data-delete-mode='range']",
    );
    if (rangeRadio === null) return;
    act((): void => {
      rangeRadio.click();
    });
    const rangeInput = host.querySelector<HTMLInputElement>("[data-delete-range]");
    if (rangeInput === null) return;
    act((): void => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(rangeInput, "1-3");
      rangeInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const confirmBtn = host.querySelector<HTMLButtonElement>(
      "[data-delete-confirm]",
    );
    expect(confirmBtn?.disabled).toBe(true);
    // Even if a user programmatically clicks, no confirm fires.
    act((): void => {
      confirmBtn?.removeAttribute("disabled");
      confirmBtn?.click();
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("range mode: invalid range renders an error and disables confirm", () => {
    const { host, onConfirm } = mountDialog({
      currentPage: 1,
      totalPages: 5,
      onConfirm: (): void => undefined,
      onClose: (): void => undefined,
    });
    const rangeRadio = host.querySelector<HTMLInputElement>(
      "input[data-delete-mode='range']",
    );
    if (rangeRadio === null) return;
    act((): void => {
      rangeRadio.click();
    });
    const rangeInput = host.querySelector<HTMLInputElement>("[data-delete-range]");
    if (rangeInput === null) return;
    act((): void => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(rangeInput, "abc");
      rangeInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // An error status surfaces.
    const error = host.querySelector(".modal-status.optimize-error");
    expect(error).not.toBeNull();
    const confirmBtn = host.querySelector<HTMLButtonElement>(
      "[data-delete-confirm]",
    );
    expect(confirmBtn?.disabled).toBe(true);
    act((): void => {
      confirmBtn?.removeAttribute("disabled");
      confirmBtn?.click();
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("current mode on a 1-page document is gated", () => {
    const { host, onConfirm } = mountDialog({
      currentPage: 1,
      totalPages: 1,
      onConfirm: (): void => undefined,
      onClose: (): void => undefined,
    });
    const confirmBtn = host.querySelector<HTMLButtonElement>(
      "[data-delete-confirm]",
    );
    expect(confirmBtn?.disabled).toBe(true);
    const error = host.querySelector(".modal-status.optimize-error");
    expect(error?.textContent).toContain("at least one");
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("close button dismisses the dialog without committing", () => {
    const { host, onClose } = mountDialog({
      currentPage: 2,
      totalPages: 5,
      onConfirm: (): void => undefined,
      onClose: (): void => undefined,
    });
    const closeBtn = host.querySelector<HTMLButtonElement>(".modal-close");
    expect(closeBtn).not.toBeNull();
    if (closeBtn === null) return;
    act((): void => {
      closeBtn.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
