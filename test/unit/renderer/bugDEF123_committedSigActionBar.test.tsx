// @vitest-environment jsdom
//
// DEF-123 — a SELECTED COMMITTED signature placement shows the same
// floating action bar (Confirm / Cancel / Delete) as the pending
// placement, anchored above the selected signature. Previously the
// action bar rendered only for `pendingPlacement`; a committed
// placement showed only move/resize handles, so the move couldn't
// be confirmed/reverted and there was no way to delete it except
// the Delete key.
//
// Contract:
//   1. Selecting a committed placement renders the action bar
//      (data-sig-action-bar with confirm/cancel/delete buttons).
//   2. Dragging the placement holds the new rect as an UNCOMMITTED
//      position change: onMove is NOT called on pointerup, the
//      placement re-renders at the held rect, and the bar appears.
//   3. Confirm commits the held rect through onMove and ends the
//      selection.
//   4. Cancel reverts the rect (the placement re-renders at the
//      committed rect) and ends the selection; no engine call.
//   5. Delete removes the placement via onDelete and ends the
//      selection.
//   6. Esc behaves like Cancel.
//   7. A bar-button press never starts a drag on the placement
//      underneath (the bar is a layer sibling, and the click still
//      completes).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Phase 20 — the signature action bar is a TfBar inside an
 *  AnimatePresence, so its DOM removal completes after the exit. */
async function settleMotion(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise((r) => setTimeout(r, 30));
  });
}
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { SignaturesOverlay } from "../../../src/renderer/signatures/SignaturesOverlay";
import type { SavedSignature, SignaturePlacement } from "../../../src/shared/types";

const TYPED_SIG: SavedSignature = {
  id: "sig-typed",
  label: "Jane Doe",
  source: { kind: "typed", text: "Jane Doe", width: 200, height: 60 },
  createdAt: new Date(1700000000000).toISOString(),
};

const COMMITTED: SignaturePlacement = {
  id: "pl-1",
  signatureId: "sig-typed",
  page: 1,
  rect: { x: 100, y: 100, width: 200, height: 60 },
  pngBytes: new Uint8Array(0),
};

function mountCommitted(args: {
  placements?: SignaturePlacement[];
  onMove?: (id: string, rect: { x: number; y: number; width: number; height: number }) => void;
  onDelete?: (id: string) => void;
}): {
  host: HTMLElement;
  onMove: ReturnType<typeof vi.fn>;
  onDelete: ReturnType<typeof vi.fn>;
} {
  const host = document.createElement("div");
  host.style.position = "absolute";
  host.style.left = "0px";
  host.style.top = "0px";
  host.style.width = "800px";
  host.style.height = "600px";
  document.body.appendChild(host);
  Element.prototype.setPointerCapture = function (): void {
    /* no-op */
  };
  Element.prototype.releasePointerCapture = function (): void {
    /* no-op */
  };
  host.getBoundingClientRect = (): DOMRect => ({
    x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600,
    toJSON: () => ({}),
  });
  const root = createRoot(host);
  const onMove = vi.fn(args.onMove ?? ((): void => undefined));
  const onDelete = vi.fn(args.onDelete ?? ((): void => undefined));
  act((): void => {
    root.render(
      <SignaturesOverlay
        page={1}
        pageWidthPt={612}
        pageHeightPt={792}
        cssScale={1}
        placements={args.placements ?? [COMMITTED]}
        signatures={{ "sig-typed": TYPED_SIG }}
        armedSignatureId={null}
        onPlace={(): void => undefined}
        onMove={onMove}
        onDelete={onDelete}
      />,
    );
  });
  return { host, onMove, onDelete };
}

function placementEl(host: HTMLElement): HTMLElement {
  const el = host.querySelector<HTMLElement>("[data-placement-id='pl-1']");
  if (el === null) throw new Error("placement not found");
  return el;
}

function barOf(host: HTMLElement): HTMLElement | null {
  return host.querySelector("[data-sig-action-bar]");
}

function dragPlacement(
  host: HTMLElement,
  from: { x: number; y: number },
  to: { x: number; y: number },
): void {
  const el = placementEl(host);
  act((): void => {
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: from.x, clientY: from.y, pointerId: 1, button: 0 }));
  });
  act((): void => {
    el.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: to.x, clientY: to.y, pointerId: 1 }));
  });
  act((): void => {
    el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: to.x, clientY: to.y, pointerId: 1 }));
  });
}

describe("DEF-123 — selected committed signature shows the action bar", () => {
  it("selecting a committed placement renders Confirm / Cancel / Delete above it", () => {
    const { host } = mountCommitted({});
    try {
      // No bar before selection.
      expect(barOf(host)).toBeNull();
      dragPlacement(host, { x: 120, y: 120 }, { x: 120, y: 120 });
      expect(barOf(host)).not.toBeNull();
      const confirm = host.querySelector("[data-sig-action='confirm']");
      const cancel = host.querySelector("[data-sig-action='cancel']");
      const del = host.querySelector("[data-sig-action='delete']");
      expect(confirm).not.toBeNull();
      expect(cancel).not.toBeNull();
      expect(del).not.toBeNull();
    } finally {
      host.remove();
    }
  });

  it("a drag holds the rect as an UNCOMMITTED change: no onMove on pointerup, placement re-renders at the held rect", () => {
    const { host, onMove } = mountCommitted({});
    try {
      dragPlacement(host, { x: 120, y: 120 }, { x: 160, y: 160 });
      // Engine untouched until Confirm (the core DEF-123 behavior).
      expect(onMove).not.toHaveBeenCalled();
      const el = placementEl(host);
      expect(Number.parseFloat(el.style.left)).toBe(140);
      expect(Number.parseFloat(el.style.top)).toBe(140);
      // The bar is visible over the selected placement.
      expect(barOf(host)).not.toBeNull();
    } finally {
      host.remove();
    }
  });

  it("Confirm commits the held rect through onMove and ends the selection", async () => {
    const { host, onMove } = mountCommitted({});
    try {
      dragPlacement(host, { x: 120, y: 120 }, { x: 160, y: 160 });
      const confirm = host.querySelector<HTMLButtonElement>("[data-sig-action='confirm']");
      expect(confirm).not.toBeNull();
      if (confirm === null) return;
      act((): void => {
        confirm.click();
      });
      expect(onMove).toHaveBeenCalledTimes(1);
      expect(onMove.mock.calls[0]?.[0]).toBe("pl-1");
      expect(onMove.mock.calls[0]?.[1]).toEqual({ x: 140, y: 140, width: 200, height: 60 });
      // Selection session over: no bar, no selection border.
      await settleMotion();
      expect(barOf(host)).toBeNull();
      expect(placementEl(host).className).not.toContain("sig-placement-selected");
    } finally {
      host.remove();
    }
  });

  it("Cancel reverts the rect (no engine call) and ends the selection", async () => {
    const { host, onMove } = mountCommitted({});
    try {
      dragPlacement(host, { x: 120, y: 120 }, { x: 160, y: 160 });
      const cancel = host.querySelector<HTMLButtonElement>("[data-sig-action='cancel']");
      expect(cancel).not.toBeNull();
      if (cancel === null) return;
      act((): void => {
        cancel.click();
      });
      expect(onMove).not.toHaveBeenCalled();
      // The placement re-renders at the COMMITTED rect.
      const el = placementEl(host);
      expect(Number.parseFloat(el.style.left)).toBe(100);
      expect(Number.parseFloat(el.style.top)).toBe(100);
      await settleMotion();
      expect(barOf(host)).toBeNull();
    } finally {
      host.remove();
    }
  });

  it("Delete removes the placement via onDelete and ends the selection", async () => {
    const { host, onDelete } = mountCommitted({});
    try {
      dragPlacement(host, { x: 120, y: 120 }, { x: 120, y: 120 });
      const deleteButton = host.querySelector<HTMLButtonElement>("[data-sig-action='delete']");
      if (deleteButton === null) return;
      act((): void => {
        deleteButton.click();
      });
      expect(onDelete).toHaveBeenCalledTimes(1);
      expect(onDelete.mock.calls[0]?.[0]).toBe("pl-1");
      await settleMotion();
      expect(barOf(host)).toBeNull();
    } finally {
      host.remove();
    }
  });

  it("Esc on a selected committed placement reverts like Cancel and ends the selection", async () => {
    const { host, onMove } = mountCommitted({});
    try {
      dragPlacement(host, { x: 120, y: 120 }, { x: 160, y: 160 });
      expect(barOf(host)).not.toBeNull();
      act((): void => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });
      expect(onMove).not.toHaveBeenCalled();
      const el = placementEl(host);
      expect(Number.parseFloat(el.style.left)).toBe(100);
      await settleMotion();
      expect(barOf(host)).toBeNull();
    } finally {
      host.remove();
    }
  });

  it("a bar-button press does not start a drag on the placement underneath, and the click completes (no swallow)", async () => {
    const { host, onMove } = mountCommitted({});
    try {
      dragPlacement(host, { x: 120, y: 120 }, { x: 160, y: 160 });
      const confirm = host.querySelector<HTMLButtonElement>("[data-sig-action='confirm']");
      expect(confirm).not.toBeNull();
      if (confirm === null) return;
      // Full press chain ON the button: pointerdown bubbles to the
      // layer (which is not armed, so it must not create a pending
      // placement or swallow the event), then the click fires.
      act((): void => {
        confirm.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 150, clientY: 40 }));
      });
      act((): void => {
        confirm.click();
      });
      // Confirm committed exactly once; no pending placement spawned.
      expect(onMove).toHaveBeenCalledTimes(1);
      expect(host.querySelector("[data-sig-pending]")).toBeNull();
      await settleMotion();
      expect(barOf(host)).toBeNull();
    } finally {
      host.remove();
    }
  });
});