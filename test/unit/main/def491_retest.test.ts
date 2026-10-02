// TFL-410 — independent qa retest for DEF-491 (Phase 84 true redaction).
//
// DEF-491: the remover over-removed a glyph when a mark touched the
// axis-aligned bounding box (AABB) of a non-90-degree rotated glyph but not
// the glyph itself. The fix replaced the AABB hit test with a true
// separating-axis test against the rotated glyph quad.
//
// This spec is written independently of the developer's
// `test/unit/main/redaction.test.ts`: it re-encodes the ADV-164 repro and the
// two neighbouring behaviours so a future AABB regression cannot pass by
// editing one shared case.

import { describe, expect, it } from 'vitest';
import {
  removeRedactedGlyphs,
  type RedactionAdvanceResolver,
} from '../../../src/shared/redaction';
import type { RedactionMark } from '../../../src/shared/types';

/** Fixed advance (thousandths of an em) for every glyph of any show string. */
const fixedAdvance: RedactionAdvanceResolver = (_font, _size, text) =>
  new Array(text.length).fill(500);

/** The exact ADV-164 content stream: a 45-degree CTM at page offset (200,200). */
const ROTATED_45 =
  'q 0.7071067811865476 0.7071067811865476 -0.7071067811865476 ' +
  '0.7071067811865476 200 200 cm BT /F1 10 Tf 1 0 0 1 0 0 Tm (A) Tj ET Q';

function rect(
  x: number,
  y: number,
  width: number,
  height: number,
): RedactionMark {
  return { rect: { x, y, width, height } };
}

describe('TFL-410 / DEF-491 independent retest', () => {
  it('NEGATIVE: a mark on the AABB only does not remove the rotated glyph', () => {
    // The AABB of the rotated cell is larger than the glyph quad; this mark
    // sits entirely outside the true quad but inside that hull.
    const result = removeRedactedGlyphs(
      ROTATED_45,
      [rect(194.0, 207.0, 0.5, 2.0)],
      fixedAdvance,
    );
    expect(result.removedGlyphs).toBe(0);
    expect(result.content).toBe(ROTATED_45);
  });

  it('POSITIVE: a mark over the rotated glyph cell centre removes it', () => {
    const result = removeRedactedGlyphs(
      ROTATED_45,
      [rect(199.65, 203.89, 0.5, 0.5)],
      fixedAdvance,
    );
    expect(result.removedGlyphs).toBe(1);
    expect(result.content).not.toBe(ROTATED_45);
  });

  it('REGRESSION: an unrotated glyph fully covered still removes exactly 1', () => {
    const content = 'BT /F1 12 Tf 10 20 Td (A) Tj ET';
    const result = removeRedactedGlyphs(
      content,
      [rect(0, 0, 100, 100)],
      fixedAdvance,
    );
    expect(result.removedGlyphs).toBe(1);
    expect(result.content).not.toBe(content);
  });
});
