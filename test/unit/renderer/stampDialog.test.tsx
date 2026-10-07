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
 *     dimensions and the current page.
 *   - The dialog states the click-to-place flow: no page picker and
 *     no "centered on the picked page" promise (DEF-635 / ER24).
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

  it("has no page picker and no 'centered on the picked page' copy (DEF-635 / ER24)", () => {
    const { container, cleanup } = renderDialog({ totalPages: 4 });
    // The handler arms the stamp and ignores any picked page: the next click
    // places it. A page picker would be a silent no-op control, so it is gone.
    expect(container.querySelector("[data-stamp-page-select]")).toBeNull();
    expect(container.querySelectorAll("[data-stamp-id]").length).toBe(4);
    expect((container.textContent ?? "").toLowerCase()).not.toContain(
      "centered on the picked page",
    );
    expect((container.textContent ?? "").toLowerCase()).not.toContain("60 pt");
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

  // DEF-063 — the dialog must surface a clear error (and NOT call
  // onConfirm) when the canvas encode produced empty bytes or a
  // payload that doesn't look like a PNG. The pre-fix check only
  // looked at `width <= 1`, which is fine for the "no 2D backend"
  // fallback path but misses the "toDataURL returned a base64
  // empty payload" case — a real-browser edge case where the
  // canvas is present but the encode silently produced zero bytes.
  // Without this check, the engine would receive `pngBytes: []`
  // and bake a blank rectangle into the page.
  it("shows an error and does NOT call onConfirm when the encode produced empty bytes", () => {
    const onConfirm = vi.fn();
    const { container, cleanup } = renderDialog({ onConfirm });
    // Override toDataURL to return an empty base64 payload (the
    // "canvas is present but encode failed" edge case). The width
    // and height in the returned object are still 480/200 (the
    // function returns the requested canvas dims regardless of how
    // many bytes the encode produced), so the pre-fix width-based
    // check would have incorrectly let the call through.
    (HTMLCanvasElement.prototype as unknown as {
      toDataURL: (type?: string) => string;
    }).toDataURL = function toDataURLEmptyStub(): string {
      return "data:image/png;base64,";
    };
    const confirm = container.querySelector<HTMLButtonElement>(
      "[data-stamp-confirm]",
    );
    expect(confirm).not.toBeNull();
    if (confirm === null) return cleanup();
    act((): void => {
      confirm.click();
    });
    // onConfirm must NOT have been called — the empty bytes would
    // have baked a blank rectangle into the page.
    expect(onConfirm).not.toHaveBeenCalled();
    // The error message should be visible to the user.
    const status = container.querySelector<HTMLElement>(
      "[role='alert']",
    );
    expect(status?.textContent ?? "").toMatch(/could not render the stamp raster/i);
    cleanup();
  });

  it("shows an error and does NOT call onConfirm when bytes lack the PNG magic header", () => {
    const onConfirm = vi.fn();
    const { container, cleanup } = renderDialog({ onConfirm });
    // toDataURL returns a base64-encoded payload that decodes to
    // non-empty bytes that are NOT a valid PNG (no 0x89 0x50 0x4e
    // 0x47 magic header). The width-based check would have let
    // this through; the byte-level guard catches it.
    (HTMLCanvasElement.prototype as unknown as {
      toDataURL: (type?: string) => string;
    }).toDataURL = function toDataURLCorruptStub(): string {
      // "AA==" decodes to [0x00]. Pad to 8 non-PNG bytes.
      return "data:image/png;base64,AAAAAAAA";
    };
    const confirm = container.querySelector<HTMLButtonElement>(
      "[data-stamp-confirm]",
    );
    expect(confirm).not.toBeNull();
    if (confirm === null) return cleanup();
    act((): void => {
      confirm.click();
    });
    expect(onConfirm).not.toHaveBeenCalled();
    const status = container.querySelector<HTMLElement>(
      "[role='alert']",
    );
    expect(status?.textContent ?? "").toMatch(/could not render the stamp raster/i);
    cleanup();
  });
});