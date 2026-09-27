// @vitest-environment jsdom
//
// DEF-366 / DEF-367 — bottom-edge control bars.
//
// DEF-366: the Phase-48 clamp flips a bottom-edge annotation's action
// bar ABOVE the annotation, but `commentBoxPlacement` still assumed the
// bar sat BELOW it, so the comment card was bottom-anchored exactly on
// top of the flipped bar — Delete/Confirm/Cancel were covered and
// unclickable. The card now clears the bar's ACTUAL box (one shared
// step: `selectionActionBarBox`), so the two rects never intersect.
//
// DEF-367: the pending signature bar clamps with a 32px height estimate
// while it renders at ~41.2px, poking ~6.4px past the page's bottom
// edge. It now reserves the real height.
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import {
  AnnotationOverlay,
  type AnnotationOverlayProps,
} from "../../../src/renderer/annotations/AnnotationOverlay";
import {
  COMMENT_BOX_ESTIMATED_HEIGHT,
  commentBoxPlacement,
  selectionActionBarBox,
} from "../../../src/renderer/annotations/AnnotationCommentBox";
import {
  CONTROL_BAR_HEIGHT,
  clampControlPosition,
} from "../../../src/renderer/components/controlPlacement";
import { SignatureActionBar, SIGNATURE_ACTION_BAR_HEIGHT } from "../../../src/renderer/signatures/SignaturesOverlay";
import { overlayRectToCss } from "../../../src/renderer/annotations/geometry";
import type { Annotation, AnnotationToolState } from "../../../src/renderer/annotations/model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PAGE_W = 612;
const PAGE_H = 792;
const SELECT_TOOL: AnnotationToolState = { tool: "select", color: "blue", penWidth: 2 };

/** A rectangle flush with the page's bottom edge. */
const BOTTOM_RECT = { x: 120, y: 752, width: 120, height: 40 };
/** A rectangle hard against the bottom-right corner. */
const CORNER_RECT = { x: 480, y: 700, width: 128, height: 88 };

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

function noop(): void {
  /* pointer-capture stub */
}

function overlaps(a: Box, b: Box): boolean {
  return (
    a.left < b.left + b.width &&
    a.left + a.width > b.left &&
    a.top < b.top + b.height &&
    a.top + a.height > b.top
  );
}

/** Resolve the comment card's rect from its style at a given zoom. */
function cardBox(bounds: { x: number; y: number; width: number; height: number }, cssScale: number): Box {
  const style = commentBoxPlacement(bounds, cssScale, PAGE_W, PAGE_H);
  const pageH = PAGE_H * cssScale;
  const top = style.top !== undefined ? Number(style.top) : pageH - Number(style.bottom) - COMMENT_BOX_ESTIMATED_HEIGHT;
  return {
    left: Number(style.left),
    top,
    width: Number(style.width),
    height: COMMENT_BOX_ESTIMATED_HEIGHT,
  };
}

function barBox(bounds: { x: number; y: number; width: number; height: number }, cssScale: number): Box {
  const b = selectionActionBarBox(bounds, cssScale, PAGE_W, PAGE_H);
  return { left: b.left, top: b.top, width: b.width, height: b.height };
}

describe("DEF-366 — the comment card never intersects a flipped-up action bar", () => {
  for (const scale of [1, 1.5]) {
    it(`bottom-edge annotation at ${scale * 100}%: card and bar rects do not intersect`, () => {
      const bar = barBox(BOTTOM_RECT, scale);
      const card = cardBox(BOTTOM_RECT, scale);
      // The bar flipped ABOVE the annotation (the bottom-edge case).
      const ring = overlayRectToCss(BOTTOM_RECT, scale);
      expect(bar.top, "bar flipped above the annotation").toBeLessThan(ring.top);
      // The card sits ABOVE the bar, clear of its full box.
      expect(overlaps(card, bar), "card must not cover the bar").toBe(false);
      expect(card.top + card.height, "card above the bar's top edge").toBeLessThanOrEqual(bar.top);
      // The bar itself is fully inside the page.
      expect(bar.top).toBeGreaterThanOrEqual(0);
      expect(bar.left + bar.width).toBeLessThanOrEqual(PAGE_W * scale);
      expect(bar.top + bar.height).toBeLessThanOrEqual(PAGE_H * scale);
    });
  }

  it("corner case: card and bar rects do not intersect (100%)", () => {
    const bar = barBox(CORNER_RECT, 1);
    const card = cardBox(CORNER_RECT, 1);
    expect(overlaps(card, bar), "card must not cover the bar").toBe(false);
    expect(card.top + card.height).toBeLessThanOrEqual(bar.top);
  });

  it("the bar box the card clears is the same one the bar renders", () => {
    // `selectionActionBarBox` is THE shared step: the bar component and
    // the card derive their position from it, so they cannot disagree.
    const b = selectionActionBarBox(BOTTOM_RECT, 1, PAGE_W, PAGE_H);
    expect(b.width).toBe(240);
    expect(b.height).toBe(CONTROL_BAR_HEIGHT);
  });
});

describe("DEF-366 — the rendered bottom-edge overlay keeps Delete reachable", () => {
  function mount(bounds: { x: number; y: number; width: number; height: number }): {
    host: HTMLElement;
    onDelete: ReturnType<typeof vi.fn>;
    cleanup: () => void;
  } {
    const host = document.createElement("div");
    host.style.position = "absolute";
    host.style.left = "0px";
    host.style.top = "0px";
    host.style.width = "800px";
    host.style.height = "900px";
    document.body.appendChild(host);
    Element.prototype.setPointerCapture = noop;
    Element.prototype.releasePointerCapture = noop;
    const root = createRoot(host);
    const onDelete = vi.fn();
    const ann: Annotation = {
      id: "rect-b",
      kind: "rect",
      page: 1,
      color: "blue",
      createdAt: "2026-01-01T00:00:00.000Z",
      rect: bounds,
    };
    const props: AnnotationOverlayProps = {
      page: 1,
      widthPt: PAGE_W,
      heightPt: PAGE_H,
      cssScale: 1,
      annotations: [ann],
      tool: SELECT_TOOL,
      flashId: null,
      getTextItems: (): never[] => [],
      onCreate: (): void => undefined,
      onAddComment: (): void => undefined,
      onDeleteAnnotation: onDelete,
      onTextFocusRequest: (): void => undefined,
      onDisarmTool: (): void => undefined,
      onFinishedOneShot: (): void => undefined,
    };
    act((): void => {
      root.render(<AnnotationOverlay {...props} />);
    });
    return {
      host,
      onDelete,
      cleanup: (): void => {
        act((): void => {
          root.unmount();
        });
        host.remove();
      },
    };
  }

  it("selecting the bottom rectangle mounts both surfaces, geometrically clear of each other", () => {
    const h = mount(BOTTOM_RECT);
    try {
      act((): void => {
        h.host
          .querySelector(".ann-shape[data-annotation-id='rect-b']")
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      });
      const bar = h.host.querySelector<HTMLElement>("[data-content-action-bar='ann-rect']");
      const box = h.host.querySelector<HTMLElement>("[data-ann-comment-box]");
      expect(bar, "action bar mounted").not.toBeNull();
      expect(box, "comment box mounted").not.toBeNull();
      if (bar === null || box === null) return;
      const barRect: Box = {
        left: Number.parseFloat(bar.style.left),
        top: Number.parseFloat(bar.style.top),
        width: 240,
        height: CONTROL_BAR_HEIGHT,
      };
      const boxRect: Box = {
        left: Number.parseFloat(box.style.left),
        top: PAGE_H - Number.parseFloat(box.style.bottom) - COMMENT_BOX_ESTIMATED_HEIGHT,
        width: Number.parseFloat(box.style.width),
        height: COMMENT_BOX_ESTIMATED_HEIGHT,
      };
      expect(overlaps(boxRect, barRect), "comment box must not cover the action bar").toBe(false);

      // The Delete control is present and its click path works when the
      // card is clear of it (the true elementFromPoint proof is the
      // Phase-48 e2e gate).
      const del = h.host.querySelector<HTMLButtonElement>("[data-content-action='ann-rect-delete']");
      expect(del, "Delete control mounted").not.toBeNull();
      act((): void => {
        del?.click();
      });
      expect(h.onDelete).toHaveBeenCalledWith("rect-b");
    } finally {
      h.cleanup();
    }
  });
});

describe("DEF-367 — the signature bar reserves its real rendered height", () => {
  it("the reserved height covers the measured 41.2px render", () => {
    expect(SIGNATURE_ACTION_BAR_HEIGHT).toBeGreaterThanOrEqual(41.2);
  });

  it("a pending bar at the page's bottom edge clamps fully inside", () => {
    const placed = clampControlPosition(
      { left: 900, top: 900 },
      { width: 260, height: SIGNATURE_ACTION_BAR_HEIGHT },
      { width: PAGE_W, height: PAGE_H },
    );
    // The bar's REAL box (measured height) is what must stay inside.
    expect(placed.top + 41.2).toBeLessThanOrEqual(PAGE_H);
    expect(placed.left + 260).toBeLessThanOrEqual(PAGE_W);
  });

  it("the rendered SignatureActionBar spans its full box inside the page", () => {
    const host = document.createElement("div");
    host.style.position = "absolute";
    host.style.left = "0px";
    host.style.top = "0px";
    document.body.appendChild(host);
    Element.prototype.setPointerCapture = noop;
    Element.prototype.releasePointerCapture = noop;
    const root = createRoot(host);
    try {
      act((): void => {
        root.render(
          <SignatureActionBar
            // Ghost flush with the bottom edge: the historic pending
            // case (wrapper at 0,0 with the ghost filling the height).
            base={{ x: 0, y: 0, width: 160, height: 780 }}
            viewport={{ width: PAGE_W, height: PAGE_H }}
            confirmTitle="Confirm placement"
            cancelTitle="Cancel"
            deleteTitle="Discard"
            onConfirm={(): void => undefined}
            onCancel={(): void => undefined}
            onDelete={(): void => undefined}
          />,
        );
      });
      const bar = host.querySelector<HTMLElement>("[data-sig-action-bar]");
      expect(bar).not.toBeNull();
      if (bar === null) return;
      const top = Number.parseFloat(bar.style.top);
      // The wrapper is at page y 0 here, so the bar's top IS page-relative.
      expect(top + 41.2, "the rendered bar's full box stays inside the page").toBeLessThanOrEqual(PAGE_H);
      expect(top).toBeGreaterThanOrEqual(0);
    } finally {
      act((): void => {
        root.unmount();
      });
      host.remove();
    }
  });
});
