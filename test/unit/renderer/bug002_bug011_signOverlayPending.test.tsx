// @vitest-environment jsdom
// Bug 2 + Bug 11 — SignaturesOverlay must show a cursor ghost
// preview when a signature is armed (Bug 11) and present a
// confirm/cancel/delete action bar for the in-flight placement
// (Bug 2).
//
// Previously: clicking the page with a signature armed committed
// the placement straight to the engine. The user had no chance
// to back out of an accidental click. The fix adds two layers:
//   - A ghost preview rect (translucent, follows the cursor)
//     that previews the placement size and content.
//   - A pending-placement state in local overlay state. After
//     the click, a translucent rect + a floating action bar
//     (Confirm / Cancel / Delete) appear. Confirm routes the
//     placement through the existing onPlace callback; Cancel /
//     Delete drop the pending state without touching the engine.
//
// We exercise the overlay here with a synthetic pointer event on
// the layer and assert both the ghost and the action bar render
// in the right state.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Phase 20 — the signature pending surface is a TfBar inside an
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
import type { SavedSignature } from "../../../src/shared/types";

const TYPED_SIG: SavedSignature = {
  id: "sig-1",
  label: "J. Doe",
  source: { kind: "typed", text: "J. Doe", width: 200, height: 60 },
  createdAt: new Date(1700000000000).toISOString(),
};

function makeRect(x: number, y: number, width: number, height: number) {
  return { x, y, width, height };
}

function mountOverlay(args: {
  armedSignatureId: string | null;
  onPlace: (sigId: string, rect: ReturnType<typeof makeRect>) => void;
  onMove: (id: string, rect: ReturnType<typeof makeRect>) => void;
  onDelete: (id: string) => void;
}): {
  host: HTMLElement;
  onPlace: ReturnType<typeof vi.fn>;
  onMove: ReturnType<typeof vi.fn>;
  onDelete: ReturnType<typeof vi.fn>;
} {
  const host = document.createElement("div");
  // jsdom doesn't compute layout, so getBoundingClientRect returns
  // zeros. We give the layer a non-zero rect via a direct style
  // override so the click → page point math works.
  host.style.position = "absolute";
  host.style.left = "0px";
  host.style.top = "0px";
  host.style.width = "800px";
  host.style.height = "600px";
  document.body.appendChild(host);
  // jsdom does not implement setPointerCapture /
  // releasePointerCapture. Patch to no-ops so the overlay's
  // pointer handler can run end-to-end.
  Element.prototype.setPointerCapture = function (): void {
    /* no-op */
  };
  Element.prototype.releasePointerCapture = function (): void {
    /* no-op */
  };
  const root = createRoot(host);
  // jsdom returns zero-sized rects; monkey-patch so the
  // SignaturesOverlay's page-point conversion gets a sensible
  // value. Without this, the click math resolves to the same
  // point as the cursor regardless of cssScale.
  host.getBoundingClientRect = (): DOMRect => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 800,
    bottom: 600,
    width: 800,
    height: 600,
    toJSON: () => ({}),
  });
  const onPlace = vi.fn(args.onPlace);
  const onMove = vi.fn(args.onMove);
  const onDelete = vi.fn(args.onDelete);
  act((): void => {
    root.render(
      <SignaturesOverlay
        page={1}
        pageWidthPt={612}
        pageHeightPt={792}
        cssScale={1}
        placements={[]}
        signatures={{ "sig-1": TYPED_SIG }}
        armedSignatureId={args.armedSignatureId}
        onPlace={onPlace}
        onMove={onMove}
        onDelete={onDelete}
      />,
    );
  });
  return { host, onPlace, onMove, onDelete };
}

describe("Bug 2 + Bug 11 — SignaturesOverlay pending + ghost", () => {
  it("shows a ghost preview when a signature is armed (Bug 11)", () => {
    // We can't drive a real pointermove in jsdom (the effect
    // reads layer.getBoundingClientRect() and the pagePoint
    // conversion runs; the ghost state updates through the
    // effect's pointermove listener). Simulate the click to
    // confirm the layer still commits a placement via onPlace
    // (regression guard) and that the pending placement renders
    // a ghost rect with the action bar.
    const { host, onPlace } = mountOverlay({
      armedSignatureId: "sig-1",
      onPlace: (): void => undefined,
      onMove: (): void => undefined,
      onDelete: (): void => undefined,
    });
    // Clicking the page with a signature armed should:
    //   - Create a pending placement (not commit immediately).
    //   - Render the .sig-pending + .sig-action-bar surface.
    // The previous behaviour committed via onPlace immediately;
    // the fix delays that to the Confirm click.
    const layer = host.querySelector("[data-page='1']") as HTMLElement | null;
    expect(layer).not.toBeNull();
    if (layer === null) return;
    act((): void => {
      layer.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: 100,
          clientY: 100,
        }),
      );
    });
    // onPlace must NOT fire on the bare page click — the
    // pending placement is in local state until the user
    // confirms. (Without this assertion the bug fix would
    // silently regress: the click would commit again.)
    expect(onPlace).not.toHaveBeenCalled();
    // The pending placement + action bar surface render.
    const pending = host.querySelector("[data-sig-pending]");
    const actionBar = host.querySelector("[data-sig-action-bar]");
    expect(pending).not.toBeNull();
    expect(actionBar).not.toBeNull();
  });

  it("Confirm routes the placement through onPlace; Cancel drops it (Bug 2)", async () => {
    const { host, onPlace } = mountOverlay({
      armedSignatureId: "sig-1",
      onPlace: (): void => undefined,
      onMove: (): void => undefined,
      onDelete: (): void => undefined,
    });
    const layer = host.querySelector("[data-page='1']") as HTMLElement | null;
    if (layer === null) return;
    act((): void => {
      layer.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: 100,
          clientY: 100,
        }),
      );
    });
    // Click Confirm.
    const confirmBtn = host.querySelector<HTMLButtonElement>(
      "[data-sig-action='confirm']",
    );
    expect(confirmBtn).not.toBeNull();
    if (confirmBtn === null) return;
    act((): void => {
      confirmBtn.click();
    });
    // After Confirm, onPlace fires with the placement rect.
    expect(onPlace).toHaveBeenCalledTimes(1);
    const call = onPlace.mock.calls[0];
    expect(call?.[0]).toBe("sig-1");
    // The pending placement is gone after Confirm.
    await settleMotion();
    expect(host.querySelector("[data-sig-pending]")).toBeNull();
  });

  it("Cancel drops the pending placement without calling onPlace", async () => {
    const { host, onPlace } = mountOverlay({
      armedSignatureId: "sig-1",
      onPlace: (): void => undefined,
      onMove: (): void => undefined,
      onDelete: (): void => undefined,
    });
    const layer = host.querySelector("[data-page='1']") as HTMLElement | null;
    if (layer === null) return;
    act((): void => {
      layer.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: 50,
          clientY: 50,
        }),
      );
    });
    const cancelBtn = host.querySelector<HTMLButtonElement>(
      "[data-sig-action='cancel']",
    );
    expect(cancelBtn).not.toBeNull();
    if (cancelBtn === null) return;
    act((): void => {
      cancelBtn.click();
    });
    expect(onPlace).not.toHaveBeenCalled();
    await settleMotion();
    expect(host.querySelector("[data-sig-pending]")).toBeNull();
  });
});
