// @vitest-environment jsdom
//
// B4/B5 — committed sticky-note text must render at the icon's
// position (no double offset) and the note must show a Sign-like
// selection state while SELECTED (Bug 3 unified model: single click
// selects, double click opens the toolbox).
//
// The defect: the on-page note text (`.ann-note-text`) was
// positioned with PAGE coordinates inside the already-translated
// `.ann-note` wrapper — `left: (at.x + NOTE_ICON_PT) * cssScale`
// added `at.x` a second time, so the text landed far to the right
// of its icon. The fix anchors the text to the icon's own box
// (`left: NOTE_ICON_PT * cssScale + 4; top: 0`), keeping icon and
// text co-located at every zoom.
//
// Single click marks the note selected (the Confirm / Edit / Delete
// bar appears and the icon carries `data-note-selected="true"` +
// the `.ann-note-selected` ring). Double click opens the floating
// editor (Confirm / Cancel / Delete); while the editor is open the
// page icon is hidden — the toolbox holds the content (Bug 3).
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { AnnotationOverlay } from "../../../src/renderer/annotations/AnnotationOverlay";
import type { Annotation, AnnotationToolState } from "../../../src/renderer/annotations/model";
import type { TextItemGeom } from "../../../src/renderer/annotations/geometry";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const COMMITTED_NOTE: Annotation = {
  id: "note-1",
  kind: "note",
  page: 1,
  color: "yellow",
  createdAt: "2026-01-01T00:00:00.000Z",
  at: { x: 100, y: 120 },
  text: "visible note text",
};

function mountOverlay(): {
  host: HTMLElement;
  cleanup: () => void;
} {
  const host = document.createElement("div");
  host.style.position = "absolute";
  host.style.left = "0px";
  host.style.top = "0px";
  host.style.width = "800px";
  host.style.height = "600px";
  document.body.appendChild(host);
  host.getBoundingClientRect = (): DOMRect => ({
    x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600,
    toJSON: () => ({}),
  });
  const root = createRoot(host);
  const tool: AnnotationToolState = { tool: "select", color: "yellow", penWidth: 2 };
  act((): void => {
    root.render(
      <AnnotationOverlay
        page={1}
        widthPt={612}
        heightPt={792}
        cssScale={1}
        annotations={[COMMITTED_NOTE]}
        tool={tool}
        flashId={null}
        getTextItems={(): TextItemGeom[] => []}
        onCreate={(): void => undefined}
        onEditAnnotation={(): void => undefined}
        onDeleteAnnotation={(): void => undefined}
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

describe("B4/B5 — note text co-located with the icon + Sign-like selection", () => {
  it("the on-page note text is positioned relative to the icon box, not in page coords", () => {
    const { host, cleanup } = mountOverlay();
    try {
      const text = host.querySelector<HTMLElement>("[data-ann-note-text]");
      expect(text).not.toBeNull();
      if (text === null) return;
      // The icon div is translated to at.x (100) by the wrapper.
      // The text's inline left must be relative to the icon box:
      // NOTE_ICON_PT (16) + 4 gap = 20px, top 0. The old buggy
      // value was (at.x + 16) + 4 = 120px — the double offset.
      expect(text.style.left).toBe("20px");
      expect(text.style.top).toBe("0px");
    } finally {
      cleanup();
    }
  });

  it("the note text container lays out horizontally, NOT as a one-char-per-line column (DEF-104)", () => {
    const { host, cleanup } = mountOverlay();
    try {
      const text = host.querySelector<HTMLElement>("[data-ann-note-text]");
      expect(text).not.toBeNull();
      if (text === null) return;
      // DEF-104 (updated for DEF-264) — the width must be EXPLICIT so the
      // absolutely-positioned text is not shrink-fit into the ~48px icon
      // box's leftover width (iconWidth - left offset), which is what
      // produced the 48x431 vertical column. DEF-264 replaced the
      // `max-content` keyword with the measured natural width in px (so
      // alignment is visible on a multi-line note); the point of the
      // assertion is unchanged: a real horizontal width, not auto.
      expect(text.style.width).toMatch(/^\d+(\.\d+)?px$/);
      expect(Number.parseFloat(text.style.width)).toBeGreaterThan(60);
      expect(text.style.maxWidth).not.toBe("");
      // white-space normal lets multi-word phrases lay out on one
      // line up to the maxWidth cap (pre-wrap's preferred width is
      // the widest word, so it re-wrapped mid-phrase).
      expect(text.style.whiteSpace).toBe("normal");
    } finally {
      cleanup();
    }
  });

});
