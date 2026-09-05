// @vitest-environment jsdom
//
// DEF-174 — reopening a saved file must not render a highlight DOUBLED.
// The backend bakes a native /Highlight (QuadPoints only — no /OP, no
// /AP), so on reopen pdf.js SYNTHESIZES a full-opacity multiply-blend
// appearance into the page canvas; the SVG overlay used to draw the
// same <rect class="ann-highlight"> a second time on top at
// fill-opacity 0.35, stacking the two washes into the reported ~0.58
// near-opaque block.
//
// Fix: the same live-overlay rule as DEF-166's textbox/callout text
// suppression — the overlay highlight rect renders only for LIVE
// annotation ids (created/edited this session, present in
// `liveAnnTextIds`). A highlight parsed from the saved file (id
// missing from the set) has its appearance painted by pdf.js natively
// and must not draw the rect again. `liveAnnTextIds === null` (no
// live/id split known) keeps the historic always-draw.
//
// The highlight <g> carries NO pointer/selection handlers (highlights
// are selected via the AnnotationsPanel, never page clicks), so
// suppressing the rect loses no interaction — the panel's flash /
// scroll-to reads the engine-list geometry, not this SVG node.
//
// Underline / strikeout are SOLID stroke marks rendered by the
// overlay, not translucent fills — pdf.js paints no canvas partner for
// them, so no double-render concern; only the "highlight" case reads
// the prop and a parsed underline/strikeout stays rendered.
//
// Coverage:
//   - parsed-from-file highlight (id NOT in the set): NO overlay rect
//     (the whole highlight group is absent).
//   - live highlight (id in the set): overlay rect(s) render.
//   - no prop (null): overlay rect(s) render (backward compat).
//   - underline/strikeout: never suppressed, live-or-parsed.
//   - live id wins when parsed siblings are suppressed.
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { AnnotationOverlay } from "../../../src/renderer/annotations/AnnotationOverlay";
import type { Annotation, AnnotationToolState } from "../../../src/renderer/annotations/model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SELECT_TOOL: AnnotationToolState = { tool: "select", color: "blue", penWidth: 2 };

function highlightAnn(): Annotation {
  return {
    id: "hl-1",
    kind: "highlight",
    page: 1,
    color: "orange",
    createdAt: "2026-01-01T00:00:00.000Z",
    // Two quads (one per covered line), matching the engine's
    // annotationFromWire shape for a parsed highlight.
    rects: [
      { x: 100, y: 100, width: 200, height: 14 },
      { x: 100, y: 114, width: 160, height: 14 },
    ],
    text: "TFlex Technical Report",
  };
}

function underlineAnn(): Annotation {
  return {
    id: "ul-1",
    kind: "underline",
    page: 1,
    color: "blue",
    createdAt: "2026-01-01T00:00:00.000Z",
    rects: [{ x: 100, y: 100, width: 200, height: 14 }],
    text: "underlined text",
  };
}

function mount(
  anns: Annotation[],
  liveAnnTextIds?: ReadonlySet<string>,
): { host: HTMLElement; cleanup: () => void } {
  const host = document.createElement("div");
  host.style.position = "absolute";
  host.style.width = "800px";
  host.style.height = "600px";
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(
      <AnnotationOverlay
        page={1}
        widthPt={612}
        heightPt={792}
        cssScale={1}
        annotations={anns}
        tool={SELECT_TOOL}
        flashId={null}
        getTextItems={(): never[] => []}
        onCreate={(): void => undefined}
        onFinishedOneShot={undefined}
        liveAnnTextIds={liveAnnTextIds}
      />,
    );
  });
  return {
    host,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function committedHighlightRects(host: HTMLElement): Element[] {
  return Array.from(host.querySelectorAll("rect.ann-highlight:not(.ann-preview)"));
}

describe("DEF-174 — reopen-of-saved-file highlight overlay suppression", () => {
  it("highlight: a LIVE id (created this session) keeps its overlay rects", () => {
    const { host, cleanup } = mount([highlightAnn()], new Set(["hl-1"]));
    try {
      const rects = committedHighlightRects(host);
      expect(rects.length).toBe(2);
      // The group identity stays for the live annotation.
      const g = host.querySelector<Element>("[data-annotation-id='hl-1'][data-kind='highlight']");
      expect(g).not.toBeNull();
    } finally {
      cleanup();
    }
  });

  it("highlight: a PARSED id (saved file, baked canvas appearance) renders NO overlay rect", () => {
    // The reopen flow: the live set is empty (the tab never created
    // anything), so the parsed highlight's id is absent -> pdf.js
    // paints the native /Highlight into the page canvas and the
    // overlay must NOT draw the rect again (that stacked the second
    // 0.35 wash -> ~0.58 heavy block).
    const { host, cleanup } = mount([highlightAnn()], new Set());
    try {
      expect(committedHighlightRects(host)).toHaveLength(0);
      // Nothing left to render: the whole highlight group is gone.
      expect(host.querySelector("[data-annotation-id='hl-1'][data-kind='highlight']")).toBeNull();
    } finally {
      cleanup();
    }
  });

  it("highlight: without the prop the historic always-draw behavior is preserved", () => {
    const { host, cleanup } = mount([highlightAnn()]);
    try {
      expect(committedHighlightRects(host).length).toBe(2);
    } finally {
      cleanup();
    }
  });

  it("underline: a PARSED solid stroke is NEVER suppressed (no translucent canvas partner)", () => {
    // Underline/strikeout are solid stroke marks drawn by the overlay —
    // pdf.js paints no translucent fill for them, so the live/id rule
    // must not touch them even for a parsed-from-file annotation.
    const { host, cleanup } = mount([underlineAnn()], new Set());
    try {
      const g = host.querySelector<Element>("[data-annotation-id='ul-1'][data-kind='underline']");
      expect(g).not.toBeNull();
      expect(g?.querySelectorAll("line").length).toBeGreaterThanOrEqual(1);
    } finally {
      cleanup();
    }
  });

  it("a highlight id that IS live wins even when other parsed highlights are suppressed", () => {
    // Reopened file: the parsed highlight is suppressed (empty live
    // set), but the host adds the id the moment the user re-creates /
    // edits it — the live id must render its rects again.
    const parsed = highlightAnn();
    const live = { ...highlightAnn(), id: "hl-live-2" };
    const { host, cleanup } = mount([parsed, live], new Set(["hl-live-2"]));
    try {
      expect(host.querySelector("[data-annotation-id='hl-1']")).toBeNull();
      const liveRects = host.querySelectorAll<Element>(
        "[data-annotation-id='hl-live-2'] rect.ann-highlight",
      );
      expect(liveRects.length).toBe(2);
    } finally {
      cleanup();
    }
  });
});