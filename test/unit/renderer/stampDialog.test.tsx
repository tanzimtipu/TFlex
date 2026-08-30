// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so
// that `act` recognises the test env and stops spamming stderr.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi, beforeEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { StampDialog } from "../../../src/renderer/components/StampDialog";
import type { StampId } from "../../../src/shared/types";

/**
 * Phase 12 — StampDialog render contract tests.
 *
 * The dialog's contract:
 *   - Renders four stamp-id radios (APPROVED / DRAFT / CONFIDENTIAL
 *     / FINAL) and a confirm button.
 *   - Initial id comes from `initialStampId`.
 *   - Picking a different id fires `onStampIdChange`.
 *   - Confirm fires `onConfirm` with the stampId, PNG bytes,
 *     dimensions and the chosen page.
 *   - The page picker is populated from `totalPages`.
 *   - Esc + close button fire onClose.
 *
 * jsdom doesn't ship a working canvas 2D backend; we polyfill
 * `HTMLCanvasElement.prototype.getContext` so the dialog's preview
 * canvas can mount without throwing. We also polyfill `toDataURL`
 * to return a base64 of the PNG magic header so the renderer's
 * `renderStampToPng` path runs end-to-end and produces non-empty
 * bytes for every stamp id.
 */

interface RenderArgs {
  totalPages?: number;
  currentPage?: number;
  initialStampId?: StampId;
  onStampIdChange?: (id: StampId) => void;
  onConfirm?: (c: {
    stampId: StampId;
    pngBytes: Uint8Array;
    pngWidth: number;
    pngHeight: number;
    page: number;
  }) => void;
  onClose?: () => void;
}

beforeEach(() => {
  const NO_OP_FN = (): void => undefined;
  const stubContext = new Proxy(
    {},
    {
      get(_target, prop) {
        if (typeof prop === "symbol") return undefined;
        if (prop === "canvas") return null;
        return NO_OP_FN;
      },
      set() {
        return true;
      },
    },
  );
  (HTMLCanvasElement.prototype as unknown as {
    getContext: (kind: string) => unknown;
  }).getContext = function getContextStub(): unknown {
    return stubContext;
  };
  (HTMLCanvasElement.prototype as unknown as {
    toDataURL: (type?: string) => string;
  }).toDataURL = function toDataURLStub(): string {
    return "data:image/png;base64,iVBORw0KGgo=";
  };
});

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
      <StampDialog
        open={true}
        totalPages={args.totalPages ?? 3}
        currentPage={args.currentPage ?? 1}
        initialStampId={args.initialStampId ?? "APPROVED"}
        onStampIdChange={args.onStampIdChange}
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

describe("StampDialog — render contract", () => {
  it("renders four stamp-id radios and a confirm button", () => {
    const { container, cleanup } = renderDialog();
    expect(container.querySelector("[data-stamp-id='APPROVED']")).not.toBeNull();
    expect(container.querySelector("[data-stamp-id='DRAFT']")).not.toBeNull();
    expect(container.querySelector("[data-stamp-id='CONFIDENTIAL']")).not.toBeNull();
    expect(container.querySelector("[data-stamp-id='FINAL']")).not.toBeNull();
    expect(container.querySelector("[data-stamp-confirm]")).not.toBeNull();
    cleanup();
  });

  it("checks the radio matching initialStampId", () => {
    const { container, cleanup } = renderDialog({ initialStampId: "DRAFT" });
    const draft = container.querySelector<HTMLInputElement>(
      "input[data-stamp-id='DRAFT']",
    );
    expect(draft?.checked).toBe(true);
    cleanup();
  });

  it("calls onStampIdChange when the user picks a different id", () => {
    const onStampIdChange = vi.fn();
    const { container, cleanup } = renderDialog({ onStampIdChange });
    const draft = container.querySelector<HTMLInputElement>(
      "input[data-stamp-id='DRAFT']",
    );
    expect(draft).not.toBeNull();
    if (draft === null) return cleanup();
    act((): void => {
      draft.click();
    });
    expect(onStampIdChange).toHaveBeenCalledWith("DRAFT");
    cleanup();
  });

  it("populates the page picker from totalPages", () => {
    const { container, cleanup } = renderDialog({ totalPages: 4 });
    const options = container.querySelectorAll<HTMLOptionElement>(
      "[data-stamp-page-select] option",
    );
    expect(options.length).toBe(4);
    cleanup();
  });

  it("emits a StampConfirm with PNG bytes + chosen page on confirm", () => {
    const onConfirm = vi.fn();
    const { container, cleanup } = renderDialog({
      totalPages: 3,
      currentPage: 2,
      onConfirm,
    });
    const confirm = container.querySelector<HTMLButtonElement>(
      "[data-stamp-confirm]",
    );
    expect(confirm).not.toBeNull();
    if (confirm === null) return cleanup();
    act((): void => {
      confirm.click();
    });
    expect(onConfirm).toHaveBeenCalledTimes(1);
    const args = onConfirm.mock.calls[0]?.[0];
    expect(args.stampId).toBe("APPROVED");
    expect(args.pngBytes).toBeInstanceOf(Uint8Array);
    expect(args.pngWidth).toBeGreaterThan(1);
    expect(args.pngHeight).toBeGreaterThan(1);
    expect(args.page).toBe(2);
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