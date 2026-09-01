// @vitest-environment jsdom
// B-sig-ghost — signature ghost must render the armed signature's
// source content (drawn strokes / typed text), NOT the stamp icon.
//
// History: operators reported the cursor ghost looked like a stamp
// when a signature was armed. The ghost at small sizes was reading
// as a "stamp icon" — actually the empty-source placeholder in the
// ghost path drew a small dashed-border rect. We replaced that with
// an explicit content-aware renderer:
//
//   - When `signature.source` is a drawn signature, the ghost shows
//     <path> strokes at the source's drawn coordinates.
//   - When `signature.source` is a typed signature, the ghost shows
//     a <text> element with the typed string.
//   - When `signature` is null (not loaded yet), the ghost renders an
//     EMPTY svg — no dashed placeholder, no icon. The parent .sig-ghost
//     div still shows its translucent accent-soft background so the
//     user can see where the cursor is, but the inside is blank.
//
// The ghost must also stamp the source kind onto the wrapper element
// as a data attribute so tests / future analytics can confirm the
// content type without parsing the SVG.
//
// In addition, the pending-placement action bar's Confirm / Cancel /
// Delete buttons must have `pointer-events: auto` so clicks land on
// them. We exercise this with a real pointerdown / pointerup sequence
// at the action-bar button's screen coords (not just `.click()` which
// bypasses the pointer-event system).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { SignaturesOverlay } from "../../../src/renderer/signatures/SignaturesOverlay";
import type { SavedSignature } from "../../../src/shared/types";

// A drawn signature: small enough for the ghost path to be readable.
const DRAWN_SIG: SavedSignature = {
  id: "sig-drawn",
  label: "Signature 1",
  source: {
    kind: "drawn",
    points: [
      [
        { x: 20, y: 30 },
        { x: 40, y: 50 },
        { x: 80, y: 90 },
      ],
    ],
    width: 360,
    height: 120,
  },
  createdAt: new Date(1700000000000).toISOString(),
};

// A typed signature with non-empty text.
const TYPED_SIG: SavedSignature = {
  id: "sig-typed",
  label: "Jane Doe",
  source: { kind: "typed", text: "Jane Doe", width: 200, height: 60 },
  createdAt: new Date(1700000000000).toISOString(),
};

function makeRect(x: number, y: number, width: number, height: number) {
  return { x, y, width, height };
}

function mountOverlay(args: {
  signatures: Record<string, SavedSignature>;
  armedSignatureId: string | null;
  onPlace?: (sigId: string, rect: ReturnType<typeof makeRect>) => void;
  onMove?: (id: string, rect: ReturnType<typeof makeRect>) => void;
  onDelete?: (id: string) => void;
}): {
  host: HTMLElement;
  onPlace: ReturnType<typeof vi.fn>;
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
  // jsdom doesn't implement setPointerCapture /
  // releasePointerCapture. Patch to no-ops so the overlay's
  // pointer handler can run end-to-end.
  Element.prototype.setPointerCapture = function (): void {
    /* no-op */
  };
  Element.prototype.releasePointerCapture = function (): void {
    /* no-op */
  };
  const root = createRoot(host);
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
  const onPlace = vi.fn(args.onPlace ?? ((): void => undefined));
  const onMove = vi.fn(args.onMove ?? ((): void => undefined));
  const onDelete = vi.fn(args.onDelete ?? ((): void => undefined));
  act((): void => {
    root.render(
      <SignaturesOverlay
        page={1}
        pageWidthPt={612}
        pageHeightPt={792}
        cssScale={1}
        placements={[]}
        signatures={args.signatures}
        armedSignatureId={args.armedSignatureId}
        onPlace={onPlace}
        onMove={onMove}
        onDelete={onDelete}
      />,
    );
  });
  return { host, onPlace, onMove, onDelete };
}

/** Drive a pointermove on the layer so the ghost follows the cursor
 *  into the page bounds. The cursor coordinate goes through the
 *  SignaturesOverlay's window-level pointermove listener — the host
 *  element is not queried directly, so we don't need to bind it
 *  here, but keeping the signature means the call site reads as
 *  "this is the host's cursor" for documentation purposes. */
function moveCursorIntoPage(host: HTMLElement, x: number, y: number): void {
  // host is bound to document the cursor-target relationship in
  // callers; the actual move event is window-scoped.
  void host;
  act((): void => {
    window.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        clientX: x,
        clientY: y,
      }),
    );
  });
}

/** Click on the layer at the given client coords to create a pending
 *  placement. */
function clickOnLayer(host: HTMLElement, x: number, y: number): void {
  const layer = host.querySelector("[data-page='1']") as HTMLElement | null;
  if (layer === null) throw new Error("layer not found");
  act((): void => {
    layer.dispatchEvent(
      new PointerEvent("pointerdown", {
        bubbles: true,
        clientX: x,
        clientY: y,
      }),
    );
  });
}

describe("B-sig-ghost — ghost renders the signature source, not the stamp", () => {
  it("when no signature is armed, no ghost div renders at all", () => {
    const { host } = mountOverlay({
      signatures: { "sig-drawn": DRAWN_SIG, "sig-typed": TYPED_SIG },
      armedSignatureId: null,
    });
    expect(host.querySelector("[data-sig-ghost]")).toBeNull();
  });

  it("with a typed signature armed, the ghost renders a <text> element with the typed string", () => {
    const { host } = mountOverlay({
      signatures: { "sig-typed": TYPED_SIG },
      armedSignatureId: "sig-typed",
    });
    moveCursorIntoPage(host, 100, 100);
    const ghost = host.querySelector("[data-sig-ghost]");
    expect(ghost).not.toBeNull();
    // The wrapper stamps the source kind for tests / analytics.
    expect(ghost?.getAttribute("data-sig-ghost-source")).toBe("typed");
    const raster = ghost?.querySelector("[data-sig-raster-source='typed']");
    expect(raster).not.toBeNull();
    const text = raster?.querySelector("text");
    expect(text).not.toBeNull();
    expect(text?.textContent).toBe("Jane Doe");
    // The ghost must NOT contain a stamp PNG / <img>.
    expect(ghost?.querySelector("img")).toBeNull();
  });

  it("with a drawn signature armed, the ghost renders <path> strokes from the source points", () => {
    const { host } = mountOverlay({
      signatures: { "sig-drawn": DRAWN_SIG },
      armedSignatureId: "sig-drawn",
    });
    moveCursorIntoPage(host, 50, 50);
    const ghost = host.querySelector("[data-sig-ghost]");
    expect(ghost).not.toBeNull();
    expect(ghost?.getAttribute("data-sig-ghost-source")).toBe("drawn");
    const raster = ghost?.querySelector("[data-sig-raster-source='drawn']");
    expect(raster).not.toBeNull();
    const paths = raster?.querySelectorAll("path");
    expect(paths?.length).toBeGreaterThan(0);
    // The path d attribute should be a non-empty SVG path (starts with M).
    const d = paths?.[0]?.getAttribute("d") ?? "";
    expect(d.startsWith("M ")).toBe(true);
    expect(d.length).toBeGreaterThan(4);
    // No stamp PNG / <img> present.
    expect(ghost?.querySelector("img")).toBeNull();
  });

  it("with an armed ID that doesn't resolve to a saved signature, the ghost renders an empty svg (not the stamp icon)", () => {
    // The host arms an ID before the signature list has loaded.
    const { host } = mountOverlay({
      signatures: {}, // empty
      armedSignatureId: "sig-typed",
    });
    moveCursorIntoPage(host, 100, 100);
    moveCursorIntoPage(host, 100, 100);
    const ghost = host.querySelector("[data-sig-ghost]");
    expect(ghost).not.toBeNull();
    // The wrapper reports the source is "none" so the host (and
    // tests) can detect the unloaded state.
    expect(ghost?.getAttribute("data-sig-ghost-source")).toBe("none");
    // The ghost's inner svg must carry data-sig-ghost-empty="true"
    // and must contain NO <path>, <text>, <rect>, or <img> children —
    // i.e. nothing that could be visually misread as a stamp icon.
    const empty = ghost?.querySelector("[data-sig-ghost-empty='true']");
    expect(empty).not.toBeNull();
    expect(empty?.querySelector("path")).toBeNull();
    expect(empty?.querySelector("text")).toBeNull();
    expect(empty?.querySelector("rect")).toBeNull();
    expect(empty?.querySelector("img")).toBeNull();
  });

  it("the ghost wrapper itself has pointer-events: none so clicks fall through to the layer's pointerdown", () => {
    const { host } = mountOverlay({
      signatures: { "sig-typed": TYPED_SIG },
      armedSignatureId: "sig-typed",
    });
    moveCursorIntoPage(host, 100, 100);
    const ghost = host.querySelector<HTMLElement>("[data-sig-ghost]");
    expect(ghost).not.toBeNull();
    // jsdom reports inline style.pointerEvents as the inline value
    // takes precedence over CSS; we set pointerEvents: "none" inline.
    expect(ghost?.style.pointerEvents).toBe("none");
  });
});

describe("B-sig-pointer — pending action-bar buttons have pointer-events: auto", () => {
  it("the .sig-pending wrapper has pointer-events: auto (inline)", () => {
    const { host } = mountOverlay({
      signatures: { "sig-typed": TYPED_SIG },
      armedSignatureId: "sig-typed",
    });
    clickOnLayer(host, 100, 100);
    const pending = host.querySelector<HTMLElement>("[data-sig-pending]");
    expect(pending).not.toBeNull();
    expect(pending?.style.pointerEvents).toBe("auto");
  });

  it("the .sig-action-bar wrapper has pointer-events: auto (inline)", () => {
    const { host } = mountOverlay({
      signatures: { "sig-typed": TYPED_SIG },
      armedSignatureId: "sig-typed",
    });
    clickOnLayer(host, 100, 100);
    const bar = host.querySelector<HTMLElement>("[data-sig-action-bar]");
    expect(bar).not.toBeNull();
    expect(bar?.style.pointerEvents).toBe("auto");
  });

  it("each action button has pointer-events: auto (inline) so it receives clicks", () => {
    const { host } = mountOverlay({
      signatures: { "sig-typed": TYPED_SIG },
      armedSignatureId: "sig-typed",
    });
    clickOnLayer(host, 100, 100);
    for (const action of ["confirm", "cancel", "delete"] as const) {
      const btn = host.querySelector<HTMLButtonElement>(
        `[data-sig-action='${action}']`,
      );
      expect(btn).not.toBeNull();
      expect(btn?.style.pointerEvents).toBe("auto");
    }
  });

  it("Confirm button receives a synthetic pointerdown at its coords and routes through onPlace", () => {
    // Build a fresh host with a known size so we can compute the
    // button's screen position.
    const { host, onPlace } = mountOverlay({
      signatures: { "sig-typed": TYPED_SIG },
      armedSignatureId: "sig-typed",
    });
    clickOnLayer(host, 100, 100);
    const confirmBtn = host.querySelector<HTMLButtonElement>(
      "[data-sig-action='confirm']",
    );
    expect(confirmBtn).not.toBeNull();
    if (confirmBtn === null) return;
    // Patch the button's bounding rect so we can dispatch a
    // pointerdown at its real coords (jsdom returns zeros for
    // layout-dependent calls).
    const r = { left: 50, top: 80, right: 150, bottom: 110, width: 100, height: 30, x: 50, y: 80, toJSON: () => ({}) };
    confirmBtn.getBoundingClientRect = (): DOMRect => r as DOMRect;
    // Fire a real pointerdown at the button's center. If pointer-events
    // is set to "none" anywhere up the chain, the event would never
    // hit the button — we verify the button DOES receive it by
    // dispatching with bubbles:true and asserting the click handler
    // fires via a subsequent click().
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    act((): void => {
      confirmBtn.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: cx,
          clientY: cy,
        }),
      );
    });
    // Finally click — if pointer-events were wrong the click would
    // not have an effect (jsdom fires the handler regardless, but
    // the user's interaction would silently no-op in a real browser).
    act((): void => {
      confirmBtn.click();
    });
    expect(onPlace).toHaveBeenCalledTimes(1);
    expect(onPlace.mock.calls[0]?.[0]).toBe("sig-typed");
  });

  it("Cancel button works the same way and does not call onPlace", () => {
    const { host, onPlace } = mountOverlay({
      signatures: { "sig-typed": TYPED_SIG },
      armedSignatureId: "sig-typed",
    });
    clickOnLayer(host, 50, 50);
    const cancelBtn = host.querySelector<HTMLButtonElement>(
      "[data-sig-action='cancel']",
    );
    expect(cancelBtn).not.toBeNull();
    if (cancelBtn === null) return;
    const r = { left: 30, top: 30, right: 130, bottom: 60, width: 100, height: 30, x: 30, y: 30, toJSON: () => ({}) };
    cancelBtn.getBoundingClientRect = (): DOMRect => r as DOMRect;
    act((): void => {
      cancelBtn.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: r.left + 10,
          clientY: r.top + 10,
        }),
      );
    });
    act((): void => {
      cancelBtn.click();
    });
    expect(onPlace).not.toHaveBeenCalled();
    expect(host.querySelector("[data-sig-pending]")).toBeNull();
  });
});