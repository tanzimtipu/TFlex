// @vitest-environment jsdom
// B10 — stamp ghost + click-to-embed. The StampDialog used to
// commit the stamp directly on the "Place on page" confirm, with
// no preview. The user got no feedback that the click was
// received (and the stamp wasn't visible until save+reopen).
// The fix arms the stamp in App state; the StampOverlay renders
// a ghost following the cursor on every page; clicking the page
// embeds the stamp at the click point.
//
// We exercise StampOverlay in isolation:
//   1. With armed=null, the overlay renders nothing.
//   2. With armed set, the .stamp-ghost div renders.
//   3. pointermove updates the ghost's position; pointerdown on
//      the page calls onPlace with the resolved atPt.
//   4. Esc dispatches a `tflex:stamp-disarm` CustomEvent so the
//      host can clear its armed state.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { StampOverlay } from "../../../src/renderer/annotations/StampOverlay";
import type { ArmedStamp } from "../../../src/renderer/annotations/StampOverlay";

// Minimal 1x1 PNG (the smallest valid PNG) for the ghost's
// <img> preview to render without crashing.
const PNG_1x1 = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82,
]);

function makeArmed(): ArmedStamp {
  return {
    stampId: "APPROVED",
    pngBytes: PNG_1x1,
    pngWidth: 200,
    pngHeight: 80,
  };
}

function mountOverlay(args: {
  armed: ArmedStamp | null;
  onPlace: (args: ArmedStamp & { page: number; atPt: { x: number; y: number } }) => void;
}): {
  host: HTMLElement;
  onPlace: ReturnType<typeof vi.fn>;
} {
  const host = document.createElement("div");
  host.style.position = "absolute";
  host.style.left = "0px";
  host.style.top = "0px";
  host.style.width = "800px";
  host.style.height = "600px";
  document.body.appendChild(host);
  // jsdom returns zero rects; override so the pagePoint math works.
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
  // jsdom doesn't implement these, no-op so the overlay can run.
  Element.prototype.setPointerCapture = function (): void {
    /* no-op */
  };
  Element.prototype.releasePointerCapture = function (): void {
    /* no-op */
  };
  const root = createRoot(host);
  const onPlace = vi.fn(args.onPlace);
  act((): void => {
    root.render(
      <StampOverlay
        page={1}
        pageWidthPt={612}
        pageHeightPt={792}
        cssScale={1}
        armed={args.armed}
        onPlace={onPlace as unknown as (args: ArmedStamp & { page: number; atPt: { x: number; y: number } }) => void}
      />,
    );
  });
  return { host, onPlace };
}

describe("B10 — StampOverlay ghost + click-to-embed", () => {
  it("renders nothing when no stamp is armed", () => {
    const { host } = mountOverlay({
      armed: null,
      onPlace: (): void => undefined,
    });
    expect(host.querySelector("[data-stamp-ghost]")).toBeNull();
    expect(host.querySelector("[data-stamp-layer]")).toBeNull();
  });

  it("renders the ghost + layer when a stamp is armed", () => {
    const { host } = mountOverlay({
      armed: makeArmed(),
      onPlace: (): void => undefined,
    });
    const layer = host.querySelector("[data-stamp-layer='1']");
    const ghost = host.querySelector("[data-stamp-ghost]");
    expect(layer).not.toBeNull();
    expect(ghost).not.toBeNull();
    expect(layer?.getAttribute("data-armed")).toBe("true");
  });

  it("clicking the page (pointerdown) calls onPlace with the resolved atPt", () => {
    const { onPlace } = mountOverlay({
      armed: makeArmed(),
      onPlace: (): void => undefined,
    });
    act((): void => {
      window.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: 200,
          clientY: 150,
        }),
      );
    });
    expect(onPlace).toHaveBeenCalledTimes(1);
    const call = onPlace.mock.calls[0]?.[0];
    expect(call?.stampId).toBe("APPROVED");
    expect(call?.page).toBe(1);
    // The atPt is in page-points (client - host rect) / cssScale.
    expect(call?.atPt).toEqual({ x: 200, y: 150 });
  });

  it("Esc dispatches a 'tflex:stamp-disarm' CustomEvent", () => {
    const { host } = mountOverlay({
      armed: makeArmed(),
      onPlace: (): void => undefined,
    });
    void host; // mount to install listeners
    let dispatched: Event | null = null;
    const onDisarm = (e: Event): void => {
      dispatched = e;
    };
    window.addEventListener("tflex:stamp-disarm", onDisarm);
    act((): void => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          key: "Escape",
        }),
      );
    });
    expect(dispatched).not.toBeNull();
    const dispatchedNonNull = dispatched as Event | null;
    if (dispatchedNonNull !== null) {
      expect(dispatchedNonNull.type).toBe("tflex:stamp-disarm");
    }
    window.removeEventListener("tflex:stamp-disarm", onDisarm);
  });

  it("clicking outside the page bounds does not call onPlace", () => {
    const { onPlace } = mountOverlay({
      armed: makeArmed(),
      onPlace: (): void => undefined,
    });
    // clientX > 800 (page is 800px wide): outside the page.
    act((): void => {
      window.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: 1200,
          clientY: 400,
        }),
      );
    });
    expect(onPlace).not.toHaveBeenCalled();
  });
});
