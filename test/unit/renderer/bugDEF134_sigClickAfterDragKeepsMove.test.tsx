// @vitest-environment jsdom
//
// DEF-134 — a plain CLICK after a committed-signature drag must NOT
// revert the held move. The previous `onPointerDownPlacement` cleared
// `pendingMoveRect` on EVERY pointerdown, so a post-drag click (which
// is just a zero-movement press+release) discarded the held rect
// before anything could commit it — the signature snapped back to its
// previous position.
//
// Contract:
//   1. A drag holds the new rect (uncommitted position change) and
//      shows the action bar, exactly as DEF-123.
//   2. A subsequent CLICK (press+release with no travel) on the same
//      placement keeps the held rect — the signature stays where it
//      was dragged, the bar stays visible, and onMove is NOT called.
//   3. Confirm after the click still commits the held rect.
//   4. Cancel after the click still reverts to the committed rect.
//   5. A real second drag (beyond the click tolerance) still replaces
//      the held rect with the new drag result.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { SignaturesOverlay, SIG_CLICK_TOLERANCE_PX } from "../../../src/renderer/signatures/SignaturesOverlay";
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

function mountCommitted(): {
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
  const onMove = vi.fn();
  const onDelete = vi.fn();
  act((): void => {
    root.render(
      <SignaturesOverlay
        page={1}
        pageWidthPt={612}
        pageHeightPt={792}
        cssScale={1}
        placements={[COMMITTED]}
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

function pressAt(host: HTMLElement, x: number, y: number): void {
  act((): void => {
    placementEl(host).dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, clientX: x, clientY: y, pointerId: 1, button: 0 }),
    );
  });
}

function releaseAt(host: HTMLElement, x: number, y: number): void {
  act((): void => {
    placementEl(host).dispatchEvent(
      new PointerEvent("pointerup", { bubbles: true, clientX: x, clientY: y, pointerId: 1 }),
    );
  });
}

function drag(host: HTMLElement, from: { x: number; y: number }, to: { x: number; y: number }): void {
  pressAt(host, from.x, from.y);
  act((): void => {
    placementEl(host).dispatchEvent(
      new PointerEvent("pointermove", { bubbles: true, clientX: to.x, clientY: to.y, pointerId: 1 }),
    );
  });
  releaseAt(host, to.x, to.y);
}

function click(host: HTMLElement, at: { x: number; y: number }): void {
  // A click is a press+release with zero (or sub-tolerance) travel.
  pressAt(host, at.x, at.y);
  releaseAt(host, at.x, at.y);
}

describe("DEF-134 — a click after a drag keeps the held move", () => {
  it("post-drag click does NOT revert: held rect, bar, and selection survive (no onMove)", () => {
    const { host, onMove } = mountCommitted();
    try {
      // First: drag the committed signature 40,40 -> held rect 140,140.
      drag(host, { x: 120, y: 120 }, { x: 160, y: 160 });
      expect(barOf(host)).not.toBeNull();
      let el = placementEl(host);
      expect(Number.parseFloat(el.style.left)).toBe(140);
      expect(Number.parseFloat(el.style.top)).toBe(140);

      // DEF-134 — a plain click on the placement body must NOT clear
      // the held move (the old pointerdown handler did).
      click(host, { x: 150, y: 150 });
      expect(onMove).not.toHaveBeenCalled();
      el = placementEl(host);
      expect(
        Number.parseFloat(el.style.left),
        "held rect survives the click",
      ).toBe(140);
      expect(
        Number.parseFloat(el.style.top),
        "held rect survives the click",
      ).toBe(140);
      expect(barOf(host), "action bar stays visible").not.toBeNull();
      expect(el.className, "placement stays selected").toContain("sig-placement-selected");
    } finally {
      host.remove();
    }
  });

  it("Confirm after the click still commits the held rect", () => {
    const { host, onMove } = mountCommitted();
    try {
      drag(host, { x: 120, y: 120 }, { x: 160, y: 160 });
      click(host, { x: 150, y: 150 });
      const confirm = host.querySelector<HTMLButtonElement>("[data-sig-action='confirm']");
      expect(confirm).not.toBeNull();
      if (confirm === null) return;
      act((): void => {
        confirm.click();
      });
      expect(onMove).toHaveBeenCalledTimes(1);
      expect(onMove.mock.calls[0]?.[0]).toBe("pl-1");
      expect(onMove.mock.calls[0]?.[1]).toEqual({ x: 140, y: 140, width: 200, height: 60 });
      expect(barOf(host)).toBeNull();
    } finally {
      host.remove();
    }
  });

  it("Cancel after the click still reverts to the committed rect", () => {
    const { host, onMove } = mountCommitted();
    try {
      drag(host, { x: 120, y: 120 }, { x: 160, y: 160 });
      click(host, { x: 150, y: 150 });
      const cancel = host.querySelector<HTMLButtonElement>("[data-sig-action='cancel']");
      expect(cancel).not.toBeNull();
      if (cancel === null) return;
      act((): void => {
        cancel.click();
      });
      expect(onMove).not.toHaveBeenCalled();
      const el = placementEl(host);
      expect(Number.parseFloat(el.style.left)).toBe(100);
      expect(Number.parseFloat(el.style.top)).toBe(100);
      expect(barOf(host)).toBeNull();
    } finally {
      host.remove();
    }
  });

  it("a real second drag (beyond the tolerance) replaces the held rect", () => {
    const { host, onMove } = mountCommitted();
    try {
      drag(host, { x: 120, y: 120 }, { x: 160, y: 160 });
      // Second drag starts from the HELD rect (140,140) and moves a
      // further +20,+20 -> 160,160. The delta is beyond the click
      // tolerance, so it is a drag, not a click.
      const beyond = SIG_CLICK_TOLERANCE_PX + 2;
      drag(host, { x: 150, y: 150 }, { x: 150 + beyond, y: 150 + beyond });
      expect(onMove).not.toHaveBeenCalled();
      const el = placementEl(host);
      expect(Number.parseFloat(el.style.left)).toBe(140 + beyond);
      expect(Number.parseFloat(el.style.top)).toBe(140 + beyond);
      expect(barOf(host)).not.toBeNull();
    } finally {
      host.remove();
    }
  });
});