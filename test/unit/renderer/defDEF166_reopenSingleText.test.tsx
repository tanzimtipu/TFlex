// @vitest-environment jsdom
//
// DEF-166 — reopening a saved file must not render annotation text
// DOUBLED. When the saved file's /Annots carry the committed
// textbox/callout (FreeText /Contents + /DA, no /AP), pdf.js
// GENERATES the appearance and paints the glyphs into the page
// canvas on reopen; the DOM overlay used to draw the same text a
// second time on top, slightly offset (the reported ghost).
//
// Fix: the host tracks which annotation ids must keep a LIVE overlay
// text (created / edited since the current page-canvas bytes were
// loaded). The AnnotationOverlay receives that set via
// `liveAnnTextIds`; an annotation whose id is NOT in the set is a
// parsed-from-file annotation whose baked appearance pdf.js already
// paints — the overlay drops ONLY the text node (the box border +
// tint stay so the committed annotation keeps its box identity).
// When the prop is absent the overlay draws every annotation's text
// (the historic behavior — unit-test and older-consumer compat).
//
// Coverage:
//   - textbox: live id -> text rendered; parsed id (missing from the
//     set) -> box chrome present but text node suppressed; no-prop
//     mount -> text rendered (backward compat).
//   - callout: same three cases; the arrow SVG sibling stays in all
//     of them (a callout's leader is never canvas-painted).
//   - note: the label ALWAYS renders (pdf.js paints no appearance
//     for a /Text note into the canvas, so suppressing it would
//     remove the only copy).
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { AnnotationOverlay } from "../../../src/renderer/annotations/AnnotationOverlay";
import type { Annotation, AnnotationToolState } from "../../../src/renderer/annotations/model";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SELECT_TOOL: AnnotationToolState = { tool: "select", color: "blue", penWidth: 2 };

function textboxAnn(text: string): Annotation {
  return {
    id: "tbx-1",
    kind: "textbox",
    page: 1,
    color: "blue",
    createdAt: "2026-01-01T00:00:00.000Z",
    rect: { x: 100, y: 100, width: 120, height: 40 },
    text,
  };
}

function calloutAnn(text: string): Annotation {
  return {
    id: "callout-1",
    kind: "callout",
    page: 1,
    color: "blue",
    createdAt: "2026-01-01T00:00:00.000Z",
    rect: { x: 100, y: 100, width: 120, height: 40 },
    at: { x: 30, y: 30 },
    text,
  };
}

function noteAnn(text: string): Annotation {
  return {
    id: "note-1",
    kind: "note",
    page: 1,
    color: "blue",
    createdAt: "2026-01-01T00:00:00.000Z",
    at: { x: 200, y: 200 },
    text,
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

describe("DEF-166 — reopen-of-saved-file overlay text suppression", () => {
  it("textbox: a LIVE id (created this session) keeps its overlay text", () => {
    const { host, cleanup } = mount([textboxAnn("HELLO 166")], new Set(["tbx-1"]));
    try {
      const box = host.querySelector<HTMLElement>(".ann-textbox[data-annotation-id='tbx-1']");
      if (box === null) throw new Error("textbox box not found");
      expect(box.textContent).toContain("HELLO 166");
    } finally {
      cleanup();
    }
  });

  it("textbox: a PARSED id (saved file, baked canvas appearance) suppresses ONLY the duplicate text", () => {
    // The reopen flow: the live set is empty (the tab never created
    // anything), so the parsed annotation's id is absent -> the text
    // node must go while the box chrome stays for a single crisp
    // render (the canvas already paints the glyphs).
    const { host, cleanup } = mount([textboxAnn("HELLO 166")], new Set());
    try {
      const box = host.querySelector<HTMLElement>(".ann-textbox[data-annotation-id='tbx-1']");
      if (box === null) throw new Error("textbox box not found");
      // The box itself is still the annotation's hit surface + chrome.
      expect(box.getAttribute("data-kind")).toBe("textbox");
      // ... but the duplicated overlay TEXT is gone.
      expect(box.textContent).toBe("");
    } finally {
      cleanup();
    }
  });

  it("textbox: without the prop the historic always-draw behavior is preserved", () => {
    const { host, cleanup } = mount([textboxAnn("HELLO 166")]);
    try {
      const box = host.querySelector<HTMLElement>(".ann-textbox[data-annotation-id='tbx-1']");
      if (box === null) throw new Error("textbox box not found");
      expect(box.textContent).toContain("HELLO 166");
    } finally {
      cleanup();
    }
  });

  it("callout: a LIVE id keeps its overlay text AND its arrow", () => {
    const { host, cleanup } = mount([calloutAnn("VERIFY CALLOUT 166")], new Set(["callout-1"]));
    try {
      const box = host.querySelector<HTMLElement>(".ann-callout[data-annotation-id='callout-1']");
      if (box === null) throw new Error("callout box not found");
      expect(box.textContent).toContain("VERIFY CALLOUT 166");
      expect(host.querySelector(".ann-callout-arrow")).not.toBeNull();
    } finally {
      cleanup();
    }
  });

  it("callout: a PARSED id suppresses the duplicate text but keeps box + arrow", () => {
    const { host, cleanup } = mount([calloutAnn("VERIFY CALLOUT 166")], new Set());
    try {
      const box = host.querySelector<HTMLElement>(".ann-callout[data-annotation-id='callout-1']");
      if (box === null) throw new Error("callout box not found");
      expect(box.textContent).toBe("");
      // The leader + arrowhead are never painted by the generated
      // FreeText appearance, so they must stay with the overlay.
      expect(host.querySelector(".ann-callout-arrow")).not.toBeNull();
    } finally {
      cleanup();
    }
  });

  it("callout: without the prop the historic always-draw behavior is preserved", () => {
    const { host, cleanup } = mount([calloutAnn("VERIFY CALLOUT 166")]);
    try {
      const box = host.querySelector<HTMLElement>(".ann-callout[data-annotation-id='callout-1']");
      if (box === null) throw new Error("callout box not found");
      expect(box.textContent).toContain("VERIFY CALLOUT 166");
    } finally {
      cleanup();
    }
  });

  it("note: the label ALWAYS renders, even for a parsed note (pdf.js paints no note appearance on the canvas)", () => {
    // A /Text annotation without /AP gets NO canvas paint from
    // pdf.js (the icon lives in the annotation-layer DOM we don't
    // mount), so suppressing the note label would remove the only
    // visible copy. The suppression must be textbox/callout-only.
    const { host, cleanup } = mount([noteAnn("READ ME 166")], new Set());
    try {
      const icon = host.querySelector<HTMLElement>(".ann-note[data-annotation-id='note-1']");
      if (icon === null) throw new Error("note icon not found");
      const label = icon.querySelector<HTMLElement>(".ann-note-text");
      if (label === null) throw new Error("note label not found");
      expect(label.textContent).toContain("READ ME 166");
    } finally {
      cleanup();
    }
  });

  it("a textbox id that IS live wins even when other parsed ids are suppressed", () => {
    // Reopened file: the parsed textbox is suppressed (empty set is
    // provided by the host), but the host adds the id the moment the
    // user edits / re-creates it — the live id must render again.
    const parsedTbx = textboxAnn("PARSED");
    const liveTbx = { ...textboxAnn("LIVE"), id: "tbx-live-2" };
    const { host, cleanup } = mount([parsedTbx, liveTbx], new Set(["tbx-live-2"]));
    try {
      const parsed = host.querySelector<HTMLElement>(".ann-textbox[data-annotation-id='tbx-1']");
      const live = host.querySelector<HTMLElement>(".ann-textbox[data-annotation-id='tbx-live-2']");
      if (parsed === null || live === null) throw new Error("boxes not found");
      expect(parsed.textContent).toBe("");
      expect(live.textContent).toContain("LIVE");
    } finally {
      cleanup();
    }
  });
});