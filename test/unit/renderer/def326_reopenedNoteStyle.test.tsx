// @vitest-environment jsdom
// DEF-326 — a reopened Times/bold note must show Times in the text-properties
// panel (not the tool default).
//
// The visible failure was that clicking the reopened note never selected it:
// the previously-selected callout's COMMENT CARD (z-index 13) was anchored
// below the callout and landed on top of the note icon, swallowing the click.
// So the panel kept the callout's style. Two contracts are pinned here:
//
//   1. the placement rule keeps the comment card OFF a neighbouring
//      annotation's hit surface (the actual regression), and
//   2. the panel's annotation values resolve from the ENGINE's stored style,
//      so once the note is selected its family is what the engine holds.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  COMMENT_BOX_WIDTH,
  COMMENT_BOX_ESTIMATED_HEIGHT,
  commentBoxPlacement,
} from "../../../src/renderer/annotations/AnnotationCommentBox";
import AnnotationCommentBox from "../../../src/renderer/annotations/AnnotationCommentBox";
import { defaultTextStyleValues } from "../../../src/renderer/edit/textStyle";
import { annotationTextPanelValues } from "../../../src/renderer/components/DocumentView";
import type { Annotation } from "../../../src/renderer/annotations/model";
import type { PageRect } from "../../../src/renderer/annotations/model";

/** A reopened sticky note that carries a non-default font. */
function reopenedNote(style?: Annotation["style"]): Annotation {
  return {
    id: "note-reopen",
    kind: "note",
    page: 1,
    color: "blue",
    createdAt: "2026-01-01T00:00:00.000Z",
    at: { x: 200, y: 300 },
    text: "P24-NT",
    ...(style === undefined ? {} : { style }),
  };
}

function callout(bounds: PageRect): Annotation {
  return {
    id: "callout-1",
    kind: "callout",
    page: 1,
    color: "blue",
    createdAt: "2026-01-01T00:00:00.000Z",
    rect: bounds,
    at: { x: bounds.x, y: bounds.y },
    text: "P24-CO",
    style: { font: "Courier", bold: true },
  };
}

const CALLOUT_BOUNDS: PageRect = { x: 120, y: 200, width: 160, height: 20 };
/** The reopened note sits directly BELOW the callout, inside the band the
 *  comment card used to occupy. */
const NOTE_AVOID: PageRect = { x: 200, y: 300, width: 24, height: 24 };

function overlaps(
  a: { left: number; top: number; width: number; height: number },
  b: { left: number; top: number; width: number; height: number },
): boolean {
  return (
    a.left < b.left + b.width &&
    a.left + a.width > b.left &&
    a.top < b.top + b.height &&
    a.top + a.height > b.top
  );
}

describe("DEF-326 — a reopened note's panel shows the engine's font", () => {
  it("resolves the note's stored Times/bold over the Helvetica tool defaults", () => {
    const defaults = defaultTextStyleValues("Helvetica");
    const values = annotationTextPanelValues(
      defaults,
      reopenedNote({ font: "Times", bold: true }),
      defaults.color,
    );
    // What the ENGINE holds (phase24 C2 line 400) is what the panel shows.
    expect(values.font).toBe("Times");
    expect(values.bold).toBe(true);
    // Fields the annotation never set still fall back to the defaults.
    expect(values.size).toBe(defaults.size);
  });

  it("keeps the callout/textbox precedent unchanged (Courier stays Courier)", () => {
    const defaults = defaultTextStyleValues("Helvetica");
    const values = annotationTextPanelValues(
      defaults,
      callout(CALLOUT_BOUNDS),
      defaults.color,
    );
    expect(values.font).toBe("Courier");
    expect(values.bold).toBe(true);
  });
});

describe("DEF-326 — the comment card never covers a neighbouring annotation", () => {
  it("flips above the selection when the below band would cover the note", () => {
    // Baseline: with nothing below to avoid, the card keeps its Phase-28
    // home - just BELOW the action bar (DEF-366: derived from the bar's
    // real box, so it clears the bar's full height plus an 8px gap).
    const clear = commentBoxPlacement(CALLOUT_BOUNDS, 1, 612, 792);
    expect(clear.top).toBe(200 + 20 + 4 + 32 + 8);

    const flipped = commentBoxPlacement(CALLOUT_BOUNDS, 1, 612, 792, [NOTE_AVOID]);
    // Bottom-anchored above the ring -> the note at y 300 is clear.
    expect(flipped.top).toBeUndefined();
    expect(Number(flipped.bottom)).toBe(792 - 200 + 8);
    const cardTop = 792 - Number(flipped.bottom) - COMMENT_BOX_ESTIMATED_HEIGHT;
    const card = {
      left: Number(flipped.left),
      top: cardTop,
      width: COMMENT_BOX_WIDTH,
      height: COMMENT_BOX_ESTIMATED_HEIGHT,
    };
    const noteBox = { left: NOTE_AVOID.x, top: NOTE_AVOID.y, width: NOTE_AVOID.width, height: NOTE_AVOID.height };
    expect(overlaps(card, noteBox)).toBe(false);
  });

  it("keeps the below placement when the avoid rect is outside its band", () => {
    const farAway: PageRect = { x: 200, y: 760, width: 24, height: 24 };
    const style = commentBoxPlacement(CALLOUT_BOUNDS, 1, 612, 792, [farAway]);
    expect(style.top).toBe(200 + 20 + 4 + 32 + 8);
  });

  it("the rendered card is bottom-anchored (not over the note) when it collides", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act((): void => {
      root.render(
        createElement(AnnotationCommentBox, {
          ann: callout(CALLOUT_BOUNDS),
          entries: [],
          onAddComment: (): void => undefined,
          cssScale: 1,
          widthPt: 612,
          heightPt: 792,
          avoid: [NOTE_AVOID],
        }),
      );
    });
    try {
      const box = host.querySelector<HTMLElement>(".ann-comment-box");
      expect(box).not.toBeNull();
      expect(box?.style.top).toBe("");
      expect(box?.style.bottom).toBe("600px");
    } finally {
      act((): void => root.unmount());
      host.remove();
    }
  });
});
