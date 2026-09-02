// @vitest-environment jsdom
//
// DEF-103 (B2) — after a Sign flow ends, the signatures overlay must
// stop pointer-hijacking the page. The defect: `.signatures-layer`
// stayed pointer-active while committed placements existed, because
// the layer's `interactive` flag was
// `armedSignatureId !== null || pagePlacements.length > 0`. A
// committed placement (just confirmed, or placed in an earlier
// session) keeps `pagePlacements.length > 0`, so the class
// `.signatures-layer-active` (pointer-events: auto, z-index 3)
// stayed mounted ABOVE the annotation layer (z-index 2) — the next
// Text Box / Rect / Ellipse page click landed on the signatures
// layer and the annotation tool placed nothing (bar=0, editor=0,
// committed=0).
//
// The fix: `interactive` is true ONLY while armed. Committed
// placement divs carry inline `pointer-events: auto` (the cross-
// bubbling rule: pointer-transparent layer, auto action surfaces),
// so move / resize / select keep working with the layer itself
// transparent.
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { SignaturesOverlay } from "../../../src/renderer/signatures/SignaturesOverlay";
import type { SavedSignature, SignaturePlacement } from "../../../src/shared/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const TYPED_SIG: SavedSignature = {
  id: "sig-1",
  label: "J. Doe",
  source: { kind: "typed", text: "J. Doe", width: 200, height: 60 },
  createdAt: new Date(1700000000000).toISOString(),
};

const COMMITTED_PLACEMENT: SignaturePlacement = {
  id: "place-1",
  page: 1,
  signatureId: "sig-1",
  rect: { x: 100, y: 100, width: 64, height: 22 },
  pngBytes: new Uint8Array([1, 2, 3]),
};

function mountOverlay(args: {
  armedSignatureId: string | null;
  placements: SignaturePlacement[];
}): {
  host: HTMLElement;
  layer: HTMLElement;
} {
  const host = document.createElement("div");
  host.style.position = "absolute";
  host.style.width = "800px";
  host.style.height = "600px";
  document.body.appendChild(host);
  host.getBoundingClientRect = (): DOMRect => ({
    x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600,
    toJSON: () => ({}),
  });
  const onPlace = vi.fn((_id: string, _r: SignaturePlacement["rect"]): void => undefined);
  const onMove = vi.fn((_id: string, _r: SignaturePlacement["rect"]): void => undefined);
  const onDelete = vi.fn((_id: string): void => undefined);
  const root = createRoot(host);
  act((): void => {
    root.render(
      <SignaturesOverlay
        page={1}
        pageWidthPt={612}
        pageHeightPt={792}
        cssScale={1}
        placements={args.placements}
        signatures={{ "sig-1": TYPED_SIG }}
        armedSignatureId={args.armedSignatureId}
        onPlace={onPlace}
        onMove={onMove}
        onDelete={onDelete}
      />,
    );
  });
  const layer = host.querySelector("[data-page='1']") as HTMLElement | null;
  if (layer === null) throw new Error("signatures layer not found");
  return { host, layer };
}

describe("DEF-103 — signatures layer pointer-transparent after the Sign flow ends", () => {
  it("a committed placement WITHOUT arm keeps the layer inactive (pointer-events off)", () => {
    // The exact DEF-103 state: Confirm added a placement to the page,
    // B1's onCancelArm cleared the armed id. The layer must NOT be
    // pointer-active, or it swallows the next annotation click.
    const { host, layer } = mountOverlay({
      armedSignatureId: null,
      placements: [COMMITTED_PLACEMENT],
    });
    expect(layer.classList.contains("signatures-layer-active")).toBe(false);
    // The committed placement surface itself stays interactive.
    const placement = host.querySelector<HTMLElement>("[data-placement-id='place-1']");
    expect(placement).not.toBeNull();
    expect(placement?.style.pointerEvents).toBe("auto");
  });

  it("the layer is pointer-active WHILE armed (ghost + pending click-to-place still work)", () => {
    const { layer } = mountOverlay({
      armedSignatureId: "sig-1",
      placements: [],
    });
    expect(layer.classList.contains("signatures-layer-active")).toBe(true);
  });

  it("the layer is pointer-active when armed AND a committed placement exists (arming wins)", () => {
    const { layer } = mountOverlay({
      armedSignatureId: "sig-1",
      placements: [COMMITTED_PLACEMENT],
    });
    expect(layer.classList.contains("signatures-layer-active")).toBe(true);
  });
});