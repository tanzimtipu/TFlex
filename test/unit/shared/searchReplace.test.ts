// Phase 86 (FEA-038) chunk A — pure search-and-replace geometry.
//
// Pins `collectTextRuns` and `planReplace` in isolation: a run's box and
// baseline, a full-run replace, a substring replace inside a longer run (the
// untouched prefix/suffix survive exactly), a TJ-array replace, a no-match
// (content byte-unchanged), an empty replacement (delete), a find/covered-text
// mismatch (skipped, nothing removed), and an unresolvable font (skipped).
//
// Occurrence rects are supplied in the content stream's user space (the
// module header documents this; the engine converts before calling).

import { describe, expect, it } from 'vitest';
import {
  collectTextRuns,
  planReplace,
  type ReplaceAnchor,
} from '../../../src/shared/searchReplace';
import type { RedactionAdvanceResolver } from '../../../src/shared/redaction';
import type { AnnRect, ReplaceOccurrence } from '../../../src/shared/types';

/** A resolver reporting the SAME advance (thousandths of an em) per glyph. */
function fixedAdvance(width: number): RedactionAdvanceResolver {
  return (_font, _size, text) => new Array(text.length).fill(width);
}

function rect(x: number, y: number, width: number, height: number): AnnRect {
  return { x, y, width, height };
}

function occ(r: AnnRect, find: string, page = 1): ReplaceOccurrence {
  return { page, rect: r, find };
}

/** One show string "HELLO" at size 12, advance 0.5em = 6pt per glyph:
 *  baseline origin x=10,y=20; glyphs span x 10..40, y 17..30.2. */
const HELLO = 'BT /F1 12 Tf 10 20 Td (HELLO) Tj ET';

describe('phase86: collectTextRuns', () => {
  it('reports each show run text, font, size and box', () => {
    const runs = collectTextRuns(HELLO, fixedAdvance(500));
    expect(runs.length).toBe(1);
    expect(runs[0].text).toBe('HELLO');
    expect(runs[0].fontName).toBe('F1');
    expect(runs[0].fontSize).toBe(12);
    expect(runs[0].rect.x).toBeCloseTo(10, 6);
    expect(runs[0].rect.y).toBeCloseTo(17, 6);
    expect(runs[0].rect.width).toBeCloseTo(30, 6);
    expect(runs[0].rect.height).toBeCloseTo(13.2, 6);
  });

  it('omits a run whose advances cannot be measured', () => {
    const content = 'BT /Ghost 14 Tf 1 0 0 1 72 700 Tm (GHOST) Tj ET';
    const runs = collectTextRuns(content, () => null);
    expect(runs).toEqual([]);
  });
});

describe('phase86: planReplace', () => {
  it('replaces a whole single run and anchors at its baseline origin', () => {
    const plan = planReplace(
      HELLO,
      [occ(rect(8, 15, 36, 18), 'HELLO')],
      'NEW',
      fixedAdvance(500),
    );
    expect(plan.removedGlyphs).toBe(5);
    expect(plan.skipped).toEqual([]);
    expect(plan.anchors.length).toBe(1);
    const anchor: ReplaceAnchor = plan.anchors[0];
    expect(anchor.pageX).toBeCloseTo(10, 6);
    expect(anchor.pageYBaseline).toBeCloseTo(20, 6);
    expect(anchor.fontName).toBe('F1');
    expect(anchor.fontSize).toBe(12);
    expect(anchor.drawnText).toBe('NEW');
    expect(anchor.substituted).toBe(true);
    // Every glyph was removed, so the rewrite is a kerning-only TJ that keeps
    // the pen where the shown text left it (5 x 6pt = 30 -> -2500).
    expect(plan.content).not.toContain('HELLO');
    expect(plan.content).toContain('[-2500] TJ');
  });

  it('replaces a substring and keeps the prefix/suffix exactly', () => {
    // "ELL" is glyphs 1..3, x 16..34.
    const plan = planReplace(
      HELLO,
      [occ(rect(16.5, 15, 17, 18), 'ELL')],
      'X',
      fixedAdvance(500),
    );
    expect(plan.removedGlyphs).toBe(3);
    expect(plan.anchors.length).toBe(1);
    // The anchor sits at the FIRST covered glyph (x=16), not the run origin.
    expect(plan.anchors[0].pageX).toBeCloseTo(16, 6);
    // The untouched prefix "H" and suffix "O" survive exactly (hex-encoded);
    // only the 3 covered glyphs are replaced by their pen advance (-1500).
    expect(plan.content).toContain('<48>');
    expect(plan.content).toContain('<4F>');
    expect(plan.content).toContain('-1500');
    expect(plan.content).not.toContain('(HELLO)');
    // Exactly 2 literal bytes (H, O) survive and are re-emitted as hex.
    expect(plan.content).toContain('[<48> -1500 <4F>] TJ');
  });

  it('replaces inside a TJ array and keeps the sibling strings', () => {
    const content = 'BT /F1 12 Tf 10 20 Td [(ABC) -100 (DEF) -100 (GHI)] TJ ET';
    const plan = planReplace(
      content,
      [occ(rect(29.5, 15, 17, 18), 'DEF')],
      'ZZ',
      fixedAdvance(500),
    );
    expect(plan.removedGlyphs).toBe(3);
    expect(plan.skipped).toEqual([]);
    // The untouched array elements keep their exact original source spans.
    expect(plan.content).toContain('(ABC)');
    expect(plan.content).toContain('(GHI)');
    expect(plan.content).not.toContain('DEF');
  });

  it('leaves the content byte-unchanged when nothing matches', () => {
    const plan = planReplace(
      HELLO,
      [occ(rect(500, 500, 10, 10), 'HELLO')],
      'NEW',
      fixedAdvance(500),
    );
    expect(plan.content).toBe(HELLO);
    expect(plan.removedGlyphs).toBe(0);
    expect(plan.anchors).toEqual([]);
    expect(plan.skipped.length).toBe(1);
  });

  it('treats an empty replacement as a delete (no anchor)', () => {
    const plan = planReplace(
      HELLO,
      [occ(rect(8, 15, 36, 18), 'HELLO')],
      '',
      fixedAdvance(500),
    );
    expect(plan.removedGlyphs).toBe(5);
    expect(plan.anchors).toEqual([]);
    expect(plan.skipped).toEqual([]);
    expect(plan.content).not.toContain('HELLO');
  });

  it('skips a find that the covered glyphs do not spell, removing nothing', () => {
    const plan = planReplace(
      HELLO,
      [occ(rect(8, 15, 36, 18), 'WORLD')],
      'NEW',
      fixedAdvance(500),
    );
    expect(plan.content).toBe(HELLO);
    expect(plan.removedGlyphs).toBe(0);
    expect(plan.anchors).toEqual([]);
    expect(plan.skipped.length).toBe(1);
    expect(plan.skipped[0].find).toBe('WORLD');
    expect(plan.skipped[0].reason).toContain('HELLO');
  });

  it('matches case-insensitively like the Find bar', () => {
    const plan = planReplace(
      HELLO,
      [occ(rect(8, 15, 36, 18), 'hello')],
      'NEW',
      fixedAdvance(500),
    );
    expect(plan.removedGlyphs).toBe(5);
    expect(plan.skipped).toEqual([]);
  });

  it('skips an occurrence over an unresolvable font', () => {
    const content = 'BT /Ghost 14 Tf 1 0 0 1 72 700 Tm (GHOST) Tj ET';
    const plan = planReplace(
      content,
      [occ(rect(60, 690, 120, 20), 'GHOST')],
      'NEW',
      () => null,
    );
    expect(plan.content).toBe(content);
    expect(plan.removedGlyphs).toBe(0);
    expect(plan.anchors).toEqual([]);
    expect(plan.skipped.length).toBe(1);
    expect(plan.skipped[0].reason).toContain('measured');
  });

  // DEF-507 — a term split across show runs is replaceable.
  it('replaces a term split across the show strings of one TJ (kerning)', () => {
    const content = 'BT /F1 12 Tf 10 20 Td [(HEL) -20 (LO)] TJ ET';
    const plan = planReplace(
      content,
      [occ(rect(8, 15, 40, 18), 'HELLO')],
      'X',
      fixedAdvance(500),
    );
    expect(plan.skipped).toEqual([]);
    expect(plan.removedGlyphs).toBe(5);
    expect(plan.anchors.length).toBe(1);
    // The single anchor sits at the FIRST covered glyph's baseline origin.
    expect(plan.anchors[0].pageX).toBeCloseTo(10, 6);
    expect(plan.anchors[0].pageYBaseline).toBeCloseTo(20, 6);
    expect(plan.anchors[0].drawnText).toBe('X');
    expect(plan.content).not.toContain('HEL');
    expect(plan.content).not.toContain('LO');
  });

  it('replaces a term split across a Tf font switch, anchoring at the first run', () => {
    const content = 'BT /F1 12 Tf 10 20 Td (HEL) Tj /F2 12 Tf (LO) Tj ET';
    const plan = planReplace(
      content,
      [occ(rect(8, 15, 40, 18), 'HELLO')],
      'X',
      fixedAdvance(500),
    );
    expect(plan.skipped).toEqual([]);
    expect(plan.removedGlyphs).toBe(5);
    expect(plan.anchors.length).toBe(1);
    expect(plan.anchors[0].pageX).toBeCloseTo(10, 6);
    expect(plan.anchors[0].pageYBaseline).toBeCloseTo(20, 6);
    // Cross-Tf anchors use the FIRST covered run's font.
    expect(plan.anchors[0].fontName).toBe('F1');
  });

  it('skips show runs that contribute no covered glyph between two covered runs', () => {
    // HEL then LO form "HELLO" on one baseline; ZZ sits on another baseline and
    // is not covered. Run order is HEL, ZZ, LO — ZZ must be skipped.
    const content =
      'BT /F1 12 Tf 1 0 0 1 10 20 Tm (HEL) Tj /F2 12 Tf 1 0 0 1 10 700 Tm (ZZ) Tj /F1 12 Tf 1 0 0 1 28 20 Tm (LO) Tj ET';
    const plan = planReplace(
      content,
      [occ(rect(8, 15, 38, 18), 'HELLO')],
      'X',
      fixedAdvance(500),
    );
    expect(plan.skipped).toEqual([]);
    expect(plan.removedGlyphs).toBe(5);
    expect(plan.anchors.length).toBe(1);
    expect(plan.anchors[0].pageX).toBeCloseTo(10, 6);
    // The uncovered run's characters survive.
    expect(plan.content).toContain('ZZ');
  });
});
