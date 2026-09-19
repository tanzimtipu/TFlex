// @vitest-environment jsdom
// Three precise fixes per qa reproduction (frontend-dev dispatch):
//
//   1. Ghost empty: the ghost must render when source is resolved;
//      if unresolved it should show the armed footprint placeholder
//      clearly (not invisible).
//
//   2. Pending bar unclickable: in SignaturesOverlay, the parent
//      layer's onGhostClick must NOT call e.preventDefault().
//      Instead check if target was a button and let it pass.
//
//   3. Theme toggle needs 2 clicks on armed stamp: disarm should
//      NOT happen on pointerdown capture when it's a UI control
//      click. Instead disarm on 'click' (after pointerup) or only
//      disarm if target has no interactive ancestor.
//
// Each fix is covered by at least one unit test below. The tests
// drive the actual SignaturesOverlay and StampOverlay components
// (no shallow renders) so the real event handlers run end-to-end.
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
import { StampOverlay } from "../../../src/renderer/annotations/StampOverlay";
import type { ArmedStamp } from "../../../src/renderer/annotations/StampOverlay";
import type { SavedSignature } from "../../../src/shared/types";

const TYPED_SIG: SavedSignature = {
  id: "sig-1",
  label: "J. Doe",
  source: { kind: "typed", text: "J. Doe", width: 200, height: 60 },
  createdAt: new Date(1700000000000).toISOString(),
};

// Minimal 1x1 PNG so the stamp ghost's <img> preview can render
// without crashing under jsdom.
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

function mountSignatures(args: {
  signatures: Record<string, SavedSignature>;
  armedSignatureId: string | null;
}): {
  host: HTMLElement;
  root: ReturnType<typeof createRoot>;
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
  Element.prototype.setPointerCapture = function (): void {
    /* no-op */
  };
  Element.prototype.releasePointerCapture = function (): void {
    /* no-op */
  };
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
  const root = createRoot(host);
  const onPlace = vi.fn();
  const onMove = vi.fn();
  const onDelete = vi.fn();
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
  return { host, root, onPlace, onMove, onDelete };
}

function mountStamp(args: {
  armed: ArmedStamp | null;
}): {
  host: HTMLElement;
  root: ReturnType<typeof createRoot>;
  onPlace: ReturnType<typeof vi.fn>;
} {
  const host = document.createElement("div");
  host.style.position = "absolute";
  host.style.left = "0px";
  host.style.top = "0px";
  host.style.width = "800px";
  host.style.height = "600px";
  document.body.appendChild(host);
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
  Element.prototype.setPointerCapture = function (): void {
    /* no-op */
  };
  Element.prototype.releasePointerCapture = function (): void {
    /* no-op */
  };
  const root = createRoot(host);
  const onPlace = vi.fn();
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
  return { host, root, onPlace };
}

function moveCursorIntoPage(host: HTMLElement, x: number, y: number): void {
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

describe("Fix 1 — Ghost renders an armed footprint placeholder when source is unresolved", () => {
  it("with armed ID and an empty signatures dict, the ghost contains a visible dashed rect + 'Signature' text label", () => {
    // Source is unresolved (signatures dict doesn't contain the
    // armed id). The previous code rendered an empty <svg> which
    // operators reported as invisible. The fix paints a clearly
    // visible armed-footprint placeholder so the user can see the
    // ghost at all times.
    const { host } = mountSignatures({
      signatures: {},
      armedSignatureId: "sig-1",
    });
    moveCursorIntoPage(host, 100, 100);
    const ghost = host.querySelector("[data-sig-ghost]");
    expect(ghost).not.toBeNull();
    // Wrapper stamps the source kind so tests / analytics can
    // detect the unloaded state.
    expect(ghost?.getAttribute("data-sig-ghost-source")).toBe("none");
    // The placeholder SVG is present and carries the empty flag.
    const placeholder = ghost?.querySelector("[data-sig-ghost-empty='true']");
    expect(placeholder).not.toBeNull();
    // The placeholder paints a single dashed footprint <rect>.
    const rects = placeholder?.querySelectorAll("rect");
    expect(rects?.length).toBe(1);
    // The placeholder paints a centered "Signature" <text> label
    // — that's the explicit visibility fix.
    const label = placeholder?.querySelector("text");
    expect(label).not.toBeNull();
    expect(label?.textContent).toBe("Signature");
    // No stamp PNG / <img> in the ghost path (the placeholder
    // is a vector SVG, never an image).
    expect(ghost?.querySelector("img")).toBeNull();
    // No drawn-source <path> either — those only appear once
    // the source resolves.
    expect(ghost?.querySelector("path")).toBeNull();
  });

  it("with armed ID and a resolved signature source, the ghost renders the actual vector content (NOT the placeholder)", () => {
    // When the source resolves, the ghost swaps to the real
    // SignatureRaster: typed → <text>, drawn → <path>. The
    // empty-placeholder <svg> must NOT be in the tree.
    const { host } = mountSignatures({
      signatures: { "sig-1": TYPED_SIG },
      armedSignatureId: "sig-1",
    });
    moveCursorIntoPage(host, 100, 100);
    const ghost = host.querySelector("[data-sig-ghost]");
    expect(ghost).not.toBeNull();
    expect(ghost?.getAttribute("data-sig-ghost-source")).toBe("typed");
    // No empty-placeholder svg in the resolved-source ghost.
    expect(ghost?.querySelector("[data-sig-ghost-empty='true']")).toBeNull();
    // Real content: the typed signature's <text> element.
    const raster = ghost?.querySelector("[data-sig-raster-source='typed']");
    expect(raster).not.toBeNull();
    expect(raster?.querySelector("text")?.textContent).toBe("J. Doe");
  });

  it("the placeholder wrapper has pointer-events: none so the click still creates a pending placement on the page", () => {
    // Belt-and-braces: even with the new visible placeholder,
    // the ghost wrapper must NOT absorb clicks. The previous
    // CSS rule already set this; we re-pin it because the new
    // placeholder content changes the SVG's role.
    const { host } = mountSignatures({
      signatures: {},
      armedSignatureId: "sig-1",
    });
    moveCursorIntoPage(host, 100, 100);
    const ghost = host.querySelector<HTMLElement>("[data-sig-ghost]");
    expect(ghost).not.toBeNull();
    expect(ghost?.style.pointerEvents).toBe("none");
  });
});

describe("Fix 2 — Pending bar buttons remain clickable (no preventDefault on the layer's pointerdown)", () => {
  it("clicking the Confirm button with the pointerdown handler bound to the layer still triggers Confirm's onClick", async () => {
    // Regression: the layer's onPointerDown handler used to call
    // e.preventDefault() on every pointerdown, which suppressed
    // the subsequent click event on the Confirm button. The user
    // had to click twice. The fix: the layer's pointerdown handler
    // walks up the target's ancestor chain for known interactive
    // selectors (.sig-action-bar, button, .sig-pending, etc.) and
    // lets those events pass through.
    const { host, onPlace } = mountSignatures({
      signatures: { "sig-1": TYPED_SIG },
      armedSignatureId: "sig-1",
    });
    // First, create the pending placement via a page click.
    clickOnLayer(host, 100, 100);
    const confirmBtn = host.querySelector<HTMLButtonElement>(
      "[data-sig-action='confirm']",
    );
    expect(confirmBtn).not.toBeNull();
    if (confirmBtn === null) return;
    // Now simulate a single-click on Confirm: pointerdown at the
    // button's center, then the click event. In a real browser,
    // pointerdown bubbles up to the layer's onPointerDown
    // handler, which would have called preventDefault previously.
    // With the fix, the handler detects the button and bails.
    const r = { left: 50, top: 80, right: 150, bottom: 110, width: 100, height: 30, x: 50, y: 80, toJSON: () => ({}) };
    confirmBtn.getBoundingClientRect = (): DOMRect => r as DOMRect;
    act((): void => {
      confirmBtn.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: r.left + r.width / 2,
          clientY: r.top + r.height / 2,
        }),
      );
    });
    act((): void => {
      confirmBtn.click();
    });
    // Single-click Confirm → onPlace fires once with the original
    // signature id. (No "needs two clicks" regression.)
    expect(onPlace).toHaveBeenCalledTimes(1);
    expect(onPlace.mock.calls[0]?.[0]).toBe("sig-1");
    // The pending placement is gone after Confirm.
    await settleMotion();
    expect(host.querySelector("[data-sig-pending]")).toBeNull();
  });

  it("clicking the Cancel button with the pointerdown bubbling to the layer still drops the pending placement", async () => {
    const { host, onPlace } = mountSignatures({
      signatures: { "sig-1": TYPED_SIG },
      armedSignatureId: "sig-1",
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
    await settleMotion();
    expect(host.querySelector("[data-sig-pending]")).toBeNull();
  });

  it("clicking inside the .sig-pending wrapper (but not on a button) does NOT create a new pending placement", () => {
    // The ancestor walk must hit `.sig-pending` and let the event
    // pass — i.e. clicking on the body of the pending rect (which
    // has pointer-events: auto) doesn't create a SECOND pending
    // placement overlapping the first one.
    const { host, onPlace } = mountSignatures({
      signatures: { "sig-1": TYPED_SIG },
      armedSignatureId: "sig-1",
    });
    clickOnLayer(host, 100, 100);
    expect(host.querySelector("[data-sig-pending]")).not.toBeNull();
    // Now simulate a click inside the pending rect's body (not on
    // any of the action-bar buttons). The body element has class
    // .sig-pending, which is in the interactive-ancestor list.
    const pendingEl = host.querySelector<HTMLElement>("[data-sig-pending]");
    expect(pendingEl).not.toBeNull();
    if (pendingEl === null) return;
    // Ensure the pointerdown has bubbles: true so it reaches the
    // layer's handler. jsdom lets us set target via Object.assign
    // — but the layer's onPointerDown uses e.target to walk
    // ancestors, and e.target is the dispatch target. We dispatch
    // directly on the pending element.
    act((): void => {
      pendingEl.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: 110,
          clientY: 110,
        }),
      );
    });
    // onPlace must NOT have fired a second time — the body click
    // was on the existing .sig-pending wrapper, not on the page.
    expect(onPlace).not.toHaveBeenCalled();
    // The original pending placement is still there.
    expect(host.querySelector("[data-sig-pending]")).not.toBeNull();
  });

  it("the layer's onGhostClick no longer calls preventDefault on the event (regression guard)", () => {
    // Drive a real page-canvas pointerdown and verify that the
    // React event's `defaultPrevented` is false after the layer
    // handler runs. The previous code unconditionally called
    // e.preventDefault() inside onGhostClick; the fix removes
    // that call so the event keeps flowing normally.
    const { host } = mountSignatures({
      signatures: { "sig-1": TYPED_SIG },
      armedSignatureId: "sig-1",
    });
    const layer = host.querySelector("[data-page='1']") as HTMLElement | null;
    if (layer === null) throw new Error("layer not found");
    let captured: PointerEvent | null = null;
    const onCapture = (e: Event): void => {
      captured = e as PointerEvent;
    };
    // Listen on the document AFTER the layer's handler runs so
    // we capture the post-handler defaultPrevented flag. jsdom
    // preserves defaultPrevented across handlers.
    document.addEventListener("pointerdown", onCapture);
    act((): void => {
      layer.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: 200,
          clientY: 200,
        }),
      );
    });
    document.removeEventListener("pointerdown", onCapture);
    expect(captured).not.toBeNull();
    const capturedNonNull = captured as PointerEvent | null;
    if (capturedNonNull !== null) {
      // The fix explicitly removes e.preventDefault() from
      // onGhostClick, so defaultPrevented stays false.
      expect(capturedNonNull.defaultPrevented).toBe(false);
    }
  });
});

describe("Fix 3 — Theme toggle (toolbar button) works on first click while stamp is armed", () => {
  it("pointerdown outside the page does NOT dispatch tflex:stamp-disarm (deferred to click)", () => {
    // Disarming on pointerdown used to re-render the React tree
    // between pointerdown and click, swallowing the toolbar
    // button's React onClick. The fix: disarm is deferred to the
    // click event phase, so the host's click handler runs first.
    // This test pins the no-disarm-on-pointerdown contract.
    const { host } = mountStamp({ armed: { stampId: "APPROVED", pngBytes: PNG_1x1, pngWidth: 200, pngHeight: 80 } });
    void host;
    let disarmEvent: Event | null = null;
    const onDisarm = (e: Event): void => {
      disarmEvent = e;
    };
    window.addEventListener("tflex:stamp-disarm", onDisarm);
    act((): void => {
      window.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: 1200, // outside the host (800px wide)
          clientY: 50,   // above the host (host starts at y=0)
        }),
      );
    });
    expect(disarmEvent).toBeNull();
    window.removeEventListener("tflex:stamp-disarm", onDisarm);
  });

  it("clicking a button (theme toggle) outside the page does NOT disarm — interactive ancestor guard", () => {
    // The toolbar's theme toggle button sits outside the page
    // canvas. With the stamp armed, the user must still be able
    // to click it once and have the React onClick fire (no
    // disarm-on-pointerdown race). The fix's click-phase handler
    // skips disarm when the target's ancestor chain includes an
    // interactive control — so the theme toggle's own click
    // handler runs and the React state (theme) flips on the
    // first click.
    const { host } = mountStamp({ armed: { stampId: "APPROVED", pngBytes: PNG_1x1, pngWidth: 200, pngHeight: 80 } });
    void host;
    let disarmEvent: Event | null = null;
    const onDisarm = (e: Event): void => {
      disarmEvent = e;
    };
    window.addEventListener("tflex:stamp-disarm", onDisarm);
    // Build a "fake" toolbar theme toggle button outside the page.
    const toolbarBtn = document.createElement("button");
    toolbarBtn.className = "theme-toggle";
    toolbarBtn.textContent = "Toggle theme";
    document.body.appendChild(toolbarBtn);
    // Position the button well outside the page so the
    // getBoundingClientRect-derived page-point math falls
    // outside [0..612]x[0..792].
    const btnRect = { left: 1000, top: 0, right: 1100, bottom: 30, width: 100, height: 30, x: 1000, y: 0, toJSON: () => ({}) };
    toolbarBtn.getBoundingClientRect = (): DOMRect => btnRect as DOMRect;
    // Dispatch the FULL click chain ON the button (so the
    // event's target resolves to the <button> element). jsdom
    // sets e.target to the dispatch target, and the click
    // bubbles up to window where our listener catches it.
    act((): void => {
      toolbarBtn.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: btnRect.left + 10,
          clientY: btnRect.top + 10,
        }),
      );
    });
    act((): void => {
      toolbarBtn.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          clientX: btnRect.left + 10,
          clientY: btnRect.top + 10,
        }),
      );
    });
    // Toolbar button click does NOT disarm — interactive ancestor.
    // This is the core fix: the theme toggle works on the first
    // click, the React onClick fires, and the stamp stays armed
    // until the user explicitly disarms (Esc / re-click stamp
    // toolbar button / click non-interactive area).
    expect(disarmEvent).toBeNull();
    document.body.removeChild(toolbarBtn);
    window.removeEventListener("tflex:stamp-disarm", onDisarm);
  });

  it("clicking outside the page on a non-interactive element DOES disarm (via click event)", () => {
    // Outside-page click on a plain element (no interactive
    // ancestor) DOES disarm — this is the deferred-disarm path
    // for non-UI clicks (e.g. the page background outside the
    // PDF canvas).
    const { host } = mountStamp({ armed: { stampId: "APPROVED", pngBytes: PNG_1x1, pngWidth: 200, pngHeight: 80 } });
    void host;
    let disarmEvent: Event | null = null;
    const onDisarm = (e: Event): void => {
      disarmEvent = e;
    };
    window.addEventListener("tflex:stamp-disarm", onDisarm);
    // Plain div outside the page — no interactive ancestor.
    const plain = document.createElement("div");
    plain.style.position = "absolute";
    plain.style.left = "1200px";
    plain.style.top = "0px";
    plain.style.width = "100px";
    plain.style.height = "100px";
    document.body.appendChild(plain);
    act((): void => {
      plain.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          clientX: 1250,
          clientY: 50,
        }),
      );
    });
    expect(disarmEvent).toBeNull();
    act((): void => {
      plain.dispatchEvent(
        new MouseEvent("click", {
          bubbles: true,
          clientX: 1250,
          clientY: 50,
        }),
      );
    });
    expect(disarmEvent).not.toBeNull();
    const disarmNonNull = disarmEvent as Event | null;
    if (disarmNonNull !== null) {
      expect(disarmNonNull.type).toBe("tflex:stamp-disarm");
    }
    document.body.removeChild(plain);
    window.removeEventListener("tflex:stamp-disarm", onDisarm);
  });

  it("Esc still disarms the stamp (unchanged behavior)", () => {
    // Esc must continue to disarm — it's the explicit disarm
    // path and must not be regressed by the click-deferred fix.
    const { host } = mountStamp({ armed: { stampId: "APPROVED", pngBytes: PNG_1x1, pngWidth: 200, pngHeight: 80 } });
    void host;
    let disarmEvent: Event | null = null;
    const onDisarm = (e: Event): void => {
      disarmEvent = e;
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
    expect(disarmEvent).not.toBeNull();
    window.removeEventListener("tflex:stamp-disarm", onDisarm);
  });

  it("pointerdown on the page (page-canvas click) still places the stamp — no disarm regression", () => {
    // Page-canvas placement must keep working: pointerdown
    // computes atPt and calls onPlace, no disarm, no click-phase
    // double-fire.
    const { onPlace } = mountStamp({ armed: { stampId: "APPROVED", pngBytes: PNG_1x1, pngWidth: 200, pngHeight: 80 } });
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
    expect(call?.atPt).toEqual({ x: 200, y: 150 });
  });
});
