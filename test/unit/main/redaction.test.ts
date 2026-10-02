// Phase 84 (True redaction) chunk A — pure content-stream removal geometry.
//
// Pins the shared `removeRedactedGlyphs` remover in isolation: a glyph is
// dropped exactly when its page-space box intersects a mark, surrounding
// glyphs survive, TJ arrays are split so only covered strings are dropped,
// quote operators and q/Q/cm transforms are tracked, and an unresolvable
// font refuses loudly instead of guessing.
//
// Marks are supplied in the content stream's user space (the module header
// documents this contract; the engine performs the top-left conversion).

import { describe, expect, it } from 'vitest';
import {
  RedactionUnsupportedError,
  removeRedactedGlyphs,
  type RedactionAdvanceResolver,
} from '../../../src/shared/redaction';
import type { RedactionMark } from '../../../src/shared/types';

/** A resolver reporting the SAME advance (thousandths of an em) per glyph. */
function fixedAdvance(width: number): RedactionAdvanceResolver {
  return (_font, _size, text) => new Array(text.length).fill(width);
}

/** A resolver keyed by font name, to prove Tf tracking. */
function advanceByFont(map: Record<string, number>): RedactionAdvanceResolver {
  return (font, _size, text) => {
    const width = map[font];
    return typeof width === 'number'
      ? new Array(text.length).fill(width)
      : null;
  };
}

function mark(
  x: number,
  y: number,
  width: number,
  height: number,
): RedactionMark {
  return { rect: { x, y, width, height } };
}

describe('phase84: removeRedactedGlyphs', () => {
  it('drops a plain Tj whose glyphs are fully inside a mark', () => {
    const content = 'BT /F1 12 Tf 10 20 Td (HELLO) Tj ET';
    const result = removeRedactedGlyphs(content, [mark(5, 10, 60, 30)], fixedAdvance(500));
    expect(result.removedGlyphs).toBe(5);
    expect(result.textRuns).toBe(1);
    expect(result.content).not.toContain('HELLO');
    // Every glyph was removed, so the rewrite is a kerning-only TJ that keeps
    // the pen where the shown text left it (5 x 0.5em x 12pt = 30 -> -2500).
    expect(result.content).toContain('[-2500] TJ');
  });

  it('splits a TJ array so only the middle covered string is dropped', () => {
    const content =
      'BT /F1 12 Tf 10 20 Td [(ABC) -100 (DEF) -100 (GHI)] TJ ET';
    const result = removeRedactedGlyphs(
      content,
      [mark(29, 16, 19, 15)],
      fixedAdvance(500),
    );
    expect(result.removedGlyphs).toBe(3);
    expect(result.textRuns).toBe(1);
    // Siblings survive; the covered string is replaced by its advance kerning.
    expect(result.content).toContain('(ABC)');
    expect(result.content).toContain('(GHI)');
    expect(result.content).not.toContain('DEF');
    expect(result.content).toContain('-1500');
    expect(result.content).toContain('TJ');
  });

  it("tracks the quote operators ' and \"", () => {
    const content = "BT /F1 12 Tf 14 TL (AAA) ' 0 0 (BBB) \" ET";
    const result = removeRedactedGlyphs(
      content,
      [mark(-100, -100, 500, 500)],
      fixedAdvance(500),
    );
    expect(result.removedGlyphs).toBe(6);
    expect(result.textRuns).toBe(2);
    expect(result.content).not.toContain('AAA');
    expect(result.content).not.toContain('BBB');
    // The line advance (T*) is preserved by rewriting the quote op.
    expect(result.content).toContain('T*');
  });

  it('applies nested q/Q + cm transforms to the glyph geometry', () => {
    const content =
      'q 2 0 0 2 0 0 cm BT /F1 10 Tf 0 0 Td (XY) Tj ET Q';
    const result = removeRedactedGlyphs(
      content,
      [mark(1, 1, 5, 5)],
      fixedAdvance(500),
    );
    // Under the 2x CTM, Y starts at x=10 and is clear of the mark; only X
    // (x 0..10) intersects. Without the transform, Y (x 5..10) would also hit.
    expect(result.removedGlyphs).toBe(1);
    expect(result.content).toContain('<59>');
    expect(result.content).not.toContain('<58>');
  });

  it('tracks multiple Tf switches (per-font advances)', () => {
    const content = 'BT /F1 12 Tf 10 20 Td (AB) Tj /F2 12 Tf (CD) Tj ET';
    const result = removeRedactedGlyphs(
      content,
      [mark(34.5, 16, 10, 15)],
      advanceByFont({ F1: 1000, F2: 500 }),
    );
    // F1 (1em) puts AB at x 10..34; F2 (0.5em) puts CD at x 34..46.
    expect(result.removedGlyphs).toBe(2);
    expect(result.content).toContain('(AB)');
    expect(result.content).not.toContain('CD');
  });

  it('returns the content unchanged when no mark intersects', () => {
    const content = 'BT /F1 12 Tf 10 20 Td (ABC) Tj ET';
    const result = removeRedactedGlyphs(
      content,
      [mark(500, 500, 10, 10)],
      fixedAdvance(500),
    );
    expect(result.removedGlyphs).toBe(0);
    expect(result.textRuns).toBe(1);
    expect(result.content).toBe(content);
  });

  it('returns unchanged with no marks and never calls the resolver', () => {
    const content = 'BT /F1 12 Tf 10 20 Td (ABC) Tj ET';
    const resolver: RedactionAdvanceResolver = () => {
      throw new Error('resolver must not be called with no marks');
    };
    const result = removeRedactedGlyphs(content, [], resolver);
    expect(result.content).toBe(content);
    expect(result.removedGlyphs).toBe(0);
    expect(result.textRuns).toBe(0);
  });

  it('raises RedactionUnsupportedError when a marked run has no advances', () => {
    const content = 'BT /F1 12 Tf 10 20 Td (ABC) Tj ET';
    let caught: unknown;
    try {
      removeRedactedGlyphs(content, [mark(0, 0, 100, 100)], () => null);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RedactionUnsupportedError);
    const failure = caught as RedactionUnsupportedError;
    expect(failure.reason).toBe('font-advance-unresolved');
    expect(failure.fontName).toBe('F1');
  });

  it('keeps a rotated glyph whose mark only touches its AABB (DEF-491)', () => {
    // 45-degree CTM; the glyph quad leans away from the mark, but a box of the
    // same corners' axis-aligned hull would have caught it. The true quad test
    // must not.
    const content =
      'q 0.7071067811865476 0.7071067811865476 -0.7071067811865476 ' +
      '0.7071067811865476 200 200 cm BT /F1 10 Tf 1 0 0 1 0 0 Tm (A) Tj ET Q';
    const result = removeRedactedGlyphs(
      content,
      [{ rect: { x: 194.0, y: 207.0, width: 0.5, height: 2.0 } }],
      fixedAdvance(500),
    );
    expect(result.removedGlyphs).toBe(0);
    expect(result.content).toBe(content);
  });

  it('drops a rotated glyph when the mark covers its centre (DEF-491)', () => {
    const content =
      'q 0.7071067811865476 0.7071067811865476 -0.7071067811865476 ' +
      '0.7071067811865476 200 200 cm BT /F1 10 Tf 1 0 0 1 0 0 Tm (A) Tj ET Q';
    const result = removeRedactedGlyphs(
      content,
      [{ rect: { x: 199.65, y: 203.89, width: 0.5, height: 0.5 } }],
      fixedAdvance(500),
    );
    expect(result.removedGlyphs).toBe(1);
    expect(result.content).not.toContain('(A)');
  });
});
