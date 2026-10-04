// TFL-686 (TFL-525 A) — the Edit Text hover / selection box must sit
// symmetrically around the glyphs.
//
// A raw pdf.js `TextItemGeom` spans ascender-top -> baseline, so drawing the
// dashed `.edit-text-hover` box at that rect leaves more room above the text
// than below. `symmetricHoverRect` pads the glyph band (ascender-top ->
// descender bottom) by an equal amount on all four sides.
import { describe, expect, it } from "vitest";
import {
  RUN_COVER_DESCENT,
  symmetricHoverRect,
} from "../../../src/renderer/edit/EditOverlay";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const RECTS: readonly Rect[] = [
  { x: 100, y: 100, width: 200, height: 20 },
  { x: 0, y: 0, width: 10, height: 8 },
  { x: 250.5, y: 300.25, width: 80, height: 14 },
  { x: -5, y: 40, width: 120, height: 30 },
];

describe("TFL-686 — symmetricHoverRect pads the glyph box equally", () => {
  for (const rect of RECTS) {
    it(`equal padding for ${JSON.stringify(rect)}`, () => {
      const out = symmetricHoverRect(rect);
      // The glyph band is ascender-top (rect.y) -> descender bottom.
      const glyphTop = rect.y;
      const glyphBottom = rect.y + rect.height * (1 + RUN_COVER_DESCENT);
      const padTop = glyphTop - out.y;
      const padBottom = out.y + out.height - glyphBottom;
      const padLeft = rect.x - out.x;
      const padRight = out.x + out.width - (rect.x + rect.width);

      expect(Math.abs(padTop - padBottom), "top pad === bottom pad").toBeLessThanOrEqual(0.5);
      expect(Math.abs(padLeft - padRight), "left pad === right pad").toBeLessThanOrEqual(0.5);
      // All four sides share the same breathing room.
      expect(Math.abs(padTop - padLeft), "vertical === horizontal pad").toBeLessThanOrEqual(0.5);
      // The box always grows (never clips the glyphs).
      expect(out.x).toBeLessThanOrEqual(rect.x);
      expect(out.y).toBeLessThanOrEqual(rect.y);
      expect(out.width).toBeGreaterThan(rect.width);
      expect(out.height).toBeGreaterThan(rect.height);
    });
  }
});