// TFL-688 (DEF-535) — the Edit Text hover / selection box must sit
// symmetrically around the RENDERED glyph box.
//
// DEF-535 root cause: a raw pdf.js `TextItemGeom` spans em-box-top ->
// baseline. Its top sits ABOVE the rendered glyph box and its bottom sits AT
// the baseline, so a box drawn at that rect (or one that only extends the
// bottom by a guessed descent) leaves more room above the text than below.
//
// This oracle defines the glyph band INDEPENDENTLY of the production code: it
// approximates the rendered pdf.js `.textLayer span` box as the run rect
// shifted DOWN by a plausible real font descent (REAL_GLYPH_DESCENT of the run
// height). It deliberately does NOT import or reuse `RUN_COVER_DESCENT`, so it
// cannot re-assert the old formula's own assumption.
import { describe, expect, it } from "vitest";
import { symmetricHoverRect } from "../../../src/renderer/edit/EditOverlay";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Case {
  label: string;
  rect: Rect;
}

// Runs with and without descenders. The rendered `.textLayer span` box is
// font-metric based (not content based), so a descender-rich run uses the same
// band shape — it is included to prove the fix is not content-tuned.
const CASES: readonly Case[] = [
  { label: "plain 20pt run", rect: { x: 100, y: 100, width: 200, height: 20 } },
  { label: "tiny 8pt run", rect: { x: 0, y: 0, width: 10, height: 8 } },
  { label: "mixed 14pt run", rect: { x: 250.5, y: 300.25, width: 80, height: 14 } },
  { label: "large 30pt run", rect: { x: -5, y: 40, width: 120, height: 30 } },
  { label: "descender-rich 24pt run (jggy)", rect: { x: 40, y: 200, width: 60, height: 24 } },
];

// Independent plausible real descent (kept separate from RUN_COVER_DESCENT).
const REAL_GLYPH_DESCENT = 0.21;

// The e2e criterion: equal breathing room within 2px.
const TOL = 2;

function glyphBand(rect: Rect): { top: number; bottom: number } {
  const descent = rect.height * REAL_GLYPH_DESCENT;
  return { top: rect.y + descent, bottom: rect.y + rect.height + descent };
}

describe("TFL-688 — symmetricHoverRect centres the box on the rendered glyph band", () => {
  for (const { label, rect } of CASES) {
    it(`equal breathing room for the ${label}`, () => {
      const out = symmetricHoverRect(rect);
      const band = glyphBand(rect);

      const padTop = band.top - out.y;
      const padBottom = out.y + out.height - band.bottom;
      const padLeft = rect.x - out.x;
      const padRight = out.x + out.width - (rect.x + rect.width);

      expect(
        Math.abs(padTop - padBottom),
        `top pad === bottom pad (top=${padTop.toFixed(3)} bottom=${padBottom.toFixed(3)})`,
      ).toBeLessThanOrEqual(TOL);
      expect(
        Math.abs(padLeft - padRight),
        `left pad === right pad (left=${padLeft.toFixed(3)} right=${padRight.toFixed(3)})`,
      ).toBeLessThanOrEqual(0.5);
      expect(
        Math.abs(padTop - padLeft),
        `vertical === horizontal breathing room (v=${padTop.toFixed(3)} h=${padLeft.toFixed(3)})`,
      ).toBeLessThanOrEqual(TOL);
      // The box always contains the whole glyph band (never clips the glyphs).
      expect(out.y).toBeLessThanOrEqual(band.top);
      expect(out.y + out.height).toBeGreaterThanOrEqual(band.bottom);
      expect(out.x).toBeLessThanOrEqual(rect.x);
      expect(out.x + out.width).toBeGreaterThanOrEqual(rect.x + rect.width);
    });
  }
});
