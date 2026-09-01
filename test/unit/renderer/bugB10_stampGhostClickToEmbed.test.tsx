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

  // Cross-arm guard (orchestrator dispatch, B10 follow-up).
  // The stamp overlay's window-level pointerdown handler used
  // to call e.stopPropagation() on every click while armed —
  // that swallowed toolbar / rail / signature-pending-bar
  // clicks too, leaving the user stuck. The fix removes the
  // stopPropagation call and lets the event bubble normally.
  // We verify by dispatching a click event while armed and
  // confirming `event.cancelBubble` stays false afterwards.
  it("does NOT stopPropagation on pointerdown while armed", () => {
    mountOverlay({
      armed: makeArmed(),
      onPlace: (): void => undefined,
    });
    let captured: PointerEvent | null = null;
    const onCapture = (e: Event): void => {
      captured = e as PointerEvent;
    };
    // Listen on the capture phase so we see the event before
    // any element handler potentially mangles it. The stamp
    // overlay listens on the bubble phase (window.addEventListener
    // with `true` flag = capture, but the overlay's listener
    // was registered without `true` in this test — checking
    // the bubble phase also works).
    window.addEventListener("pointerdown", onCapture);
    act((): void => {
      window.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: 200,
          clientY: 150,
        }),
      );
    });
    expect(captured).not.toBeNull();
    const capturedNonNull = captured as PointerEvent | null;
    if (capturedNonNull !== null) {
      // The overlay must not have called stopPropagation — if
      // it did, `cancelBubble` would be true and the toolbar /
      // rail / signature bar wouldn't have seen the click.
      expect(capturedNonNull.cancelBubble).toBe(false);
    }
    window.removeEventListener("pointerdown", onCapture);
  });

  // Cross-arm guard — clicking outside the page bounds while
  // armed used to leave the stamp armed (no listener handled
  // it), then any subsequent click inside the page would
  // stamp an unexpected location. The fix dispatches
  // `tflex:stamp-disarm` on outside-page clicks so the host
  // can clear `armedStamp`, mirroring the Esc disarm path.
  //
  // Updated (B10-followup): disarm now fires on the `click`
  // event phase, NOT on `pointerdown`. The previous
  // pointerdown disarm raced the host's React onClick handlers
  // (theme toggle, toolbar buttons) — the re-render between
  // pointerdown and click swallowed the click, so the user
  // had to click the toolbar button twice. The fix routes the
  // disarm through the click event so the host's click
  // handler runs first. This test exercises both arms of the
  // contract: pointerdown alone does NOT disarm, but the
  // followup click DOES.
  it("clicking outside the page bounds dispatches tflex:stamp-disarm on click (not on pointerdown)", () => {
    const { host } = mountOverlay({
      armed: makeArmed(),
      onPlace: (): void => undefined,
    });
    void host; // mount to install listeners
    let disarmEvent: Event | null = null;
    const onDisarm = (e: Event): void => {
      disarmEvent = e;
    };
    window.addEventListener("tflex:stamp-disarm", onDisarm);
    // Pointerdown alone MUST NOT disarm (the disarm-on-pointerdown
    // regression was the root cause of the "theme toggle needs 2
    // clicks" defect).
    act((): void => {
      window.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          // clientX > 800 = past the right edge of the host,
          // which is the only thing the overlay uses to decide
          // "this click landed on the page".
          clientX: 1200,
          clientY: 400,
        }),
      );
    });
    expect(disarmEvent).toBeNull();
    // The followup click DOES disarm (mirroring the Esc path).
    act((): void => {
      window.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          clientX: 1200,
          clientY: 400,
        }),
      );
    });
    expect(disarmEvent).not.toBeNull();
    const disarmNonNull = disarmEvent as Event | null;
    if (disarmNonNull !== null) {
      expect(disarmNonNull.type).toBe("tflex:stamp-disarm");
    }
    window.removeEventListener("tflex:stamp-disarm", onDisarm);
  });

  // Cross-arm guard — clicking a textbox / callout editor or
  // the signature action bar should be a no-op (NOT disarm, NOT
  // place). The user is mid-edit and a stray disarm would
  // silently cancel their work. We simulate the closest-match
  // ancestor with a real DOM element and a synthetic pointer
  // event whose `target` resolves to that element via
  // Object.defineProperty — jsdom dispatches the event with
  // `target` set to the dispatch target, but Element.closest()
  // walks from `target` upward, so we just need the event's
  // `target.closest(...)` call to return non-null. We do that
  // by attaching a sentinel .sig-action-bar element to the
  // document and dispatching the click on it; the overlay's
  // pointerdown handler reads `e.target` and walks the tree.
  it("clicking inside an editor / action bar does not place and does not disarm", () => {
    const { onPlace } = mountOverlay({
      armed: makeArmed(),
      onPlace: (): void => undefined,
    });
    // Build a synthetic editor ancestor and dispatch a click
    // on a child inside it. The overlay's pointerdown handler
    // checks `e.target.closest('.ann-editor, .sig-action-bar,
    // .ann-textbox-wrap, .ann-note-editor')`.
    const wrap = document.createElement("div");
    wrap.className = "sig-action-bar";
    const inner = document.createElement("button");
    inner.textContent = "Place";
    wrap.appendChild(inner);
    document.body.appendChild(wrap);
    let disarmEvent: Event | null = null;
    const onDisarm = (e: Event): void => {
      disarmEvent = e;
    };
    window.addEventListener("tflex:stamp-disarm", onDisarm);
    act((): void => {
      inner.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: 100,
          clientY: 100,
        }),
      );
    });
    expect(onPlace).not.toHaveBeenCalled();
    expect(disarmEvent).toBeNull();
    document.body.removeChild(wrap);
    window.removeEventListener("tflex:stamp-disarm", onDisarm);
  });
});
