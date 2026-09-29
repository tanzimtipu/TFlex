import { describe, expect, it } from 'vitest';
import {
  parseSvg,
  resolveSvgSize,
  type SvgNode,
} from '../../../src/main/services/convert/svg/svg-parse';
import {
  generatePaintOps,
  multiplyMatrix,
  parseTransform,
  translationMatrix,
  scaleMatrix,
  type PathOp,
} from '../../../src/main/services/convert/svg/svg-paint';

/**
 * Phase 54 feature C — the pure SVG scanner and translator. Fixtures are
 * in-test strings; nothing is read from disk and no Electron is involved.
 */

function node(doc: ReturnType<typeof parseSvg>, tag: string): SvgNode | undefined {
  const walk = (n: SvgNode | null): SvgNode | undefined => {
    if (n === null) return undefined;
    if (n.tag === tag) return n;
    for (const child of n.children) {
      const found = walk(child);
      if (found !== undefined) return found;
    }
    return undefined;
  };
  return walk(doc.root);
}

describe('phase54 svg-parse: transform composition', () => {
  it('composes nested g transforms into one matrix per op', () => {
    const doc = parseSvg(
      '<svg viewBox="0 0 100 100"><g transform="translate(10,20)">' +
        '<g transform="scale(2)"><rect x="0" y="0" width="5" height="5"/></g></g></svg>',
    );
    const ops = generatePaintOps(doc).ops;
    expect(ops).toHaveLength(1);
    // translate(10,20) applied after scale(2): [2 0 0 2 10 20].
    expect(ops[0].transform).toEqual([2, 0, 0, 2, 10, 20]);
  });

  it('parses matrix() plus a later function left-to-right', () => {
    const m = parseTransform('matrix(1,0,0,1,5,5) translate(3,4)');
    expect(m).toEqual(multiplyMatrix(translationMatrix(5, 5), translationMatrix(3, 4)));
    expect(m).toEqual([1, 0, 0, 1, 8, 9]);
  });

  it('composes rotate about a point and scale', () => {
    const m = parseTransform('scale(2) rotate(90)');
    // rotate(90) is applied to the coordinates first, then scale(2).
    const expected = multiplyMatrix(scaleMatrix(2, 2), [0, 1, -1, 0, 0, 0]);
    expect(m[0]).toBeCloseTo(expected[0], 10);
    expect(m[1]).toBeCloseTo(expected[1], 10);
    expect(m[2]).toBeCloseTo(expected[2], 10);
    expect(m[3]).toBeCloseTo(expected[3], 10);
  });
});

describe('phase54 svg-parse: inherited presentation', () => {
  const source =
    '<svg viewBox="0 0 100 100">' +
    '<g fill="red" stroke="#00ff00" stroke-width="3">' +
    '<rect x="0" y="0" width="10" height="10"/>' +
    '<g fill="blue"><circle cx="5" cy="5" r="4"/></g>' +
    '</g></svg>';

  it('resolves inherited attributes and a child override', () => {
    const doc = parseSvg(source);
    const rect = node(doc, 'rect');
    expect(rect?.presentation.fill).toBe('red');
    expect(rect?.presentation.stroke).toBe('#00ff00');
    expect(rect?.presentation['stroke-width']).toBe('3');

    const circle = node(doc, 'circle');
    expect(circle?.presentation.fill).toBe('blue');
    expect(circle?.presentation.stroke).toBe('#00ff00');
  });

  it('normalises the resolved colours into the paint ops', () => {
    const ops = generatePaintOps(parseSvg(source)).ops;
    expect(ops.map((op) => op.fill)).toEqual(['#ff0000', '#0000ff']);
    expect(ops[0].stroke).toBe('#00ff00');
    expect(ops[0].strokeWidth).toBe(3);
  });
});

describe('phase54 svg-parse: malformed input', () => {
  it('returns diagnostics instead of throwing on unclosed markup', () => {
    let doc: ReturnType<typeof parseSvg> | undefined;
    expect(() => {
      doc = parseSvg('<svg width="10" height="10"><g><rect width="4" height="4"></svg>');
    }).not.toThrow();
    expect((doc?.diagnostics.length ?? 0)).toBeGreaterThan(0);
  });

  it('reports a malformed viewBox without throwing', () => {
    const doc = parseSvg('<svg viewBox="0 0 10"><rect width="1" height="1"/></svg>');
    expect(doc.viewBox).toBeNull();
    expect(doc.diagnostics.join(' ')).toContain('viewBox');
  });
});

describe('phase54 svg-parse: sizing units', () => {
  it('honours pt, mm, px and unitless (CSS px at 96 DPI)', () => {
    expect(resolveSvgSize(parseSvg('<svg width="100pt" height="50pt"></svg>'))).toEqual({
      widthPt: 100,
      heightPt: 50,
    });
    const mm = resolveSvgSize(parseSvg('<svg width="25.4mm" height="10mm"></svg>'));
    expect(mm?.widthPt).toBeCloseTo(72, 6);
    expect(mm?.heightPt).toBeCloseTo((10 * 72) / 25.4, 6);
    const px = resolveSvgSize(parseSvg('<svg width="96px" height="48px"></svg>'));
    expect(px?.widthPt).toBeCloseTo(72, 6);
    expect(px?.heightPt).toBeCloseTo(36, 6);
    const unitless = resolveSvgSize(parseSvg('<svg width="96" height="48"></svg>'));
    expect(unitless?.widthPt).toBeCloseTo(72, 6);
    expect(unitless?.heightPt).toBeCloseTo(36, 6);
  });

  it('falls back to the viewBox at 96 DPI when no size is declared', () => {
    const size = resolveSvgSize(parseSvg('<svg viewBox="0 0 200 100"></svg>'));
    expect(size?.widthPt).toBeCloseTo(150, 6);
    expect(size?.heightPt).toBeCloseTo(75, 6);
  });

  it('derives the missing axis from the viewBox aspect', () => {
    const size = resolveSvgSize(
      parseSvg('<svg width="100" viewBox="0 0 200 100"></svg>'),
    );
    expect(size?.widthPt).toBeCloseTo(75, 6);
    expect(size?.heightPt).toBeCloseTo(37.5, 6);
  });

  it('returns null when neither a size nor a viewBox exists', () => {
    expect(resolveSvgSize(parseSvg('<svg><rect width="1" height="1"/></svg>'))).toBeNull();
  });
});

describe('phase54 svg-paint: path preservation', () => {
  it('keeps curves, arcs and relative commands intact', () => {
    const d = 'M10 10 C 20 20, 40 20, 50 10 S 70 0 80 10 Q 90 20 100 10 T 110 10 A 5 5 0 1 0 115 15 l 5 5 z';
    const ops = generatePaintOps(
      parseSvg(`<svg width="200" height="200"><path d="${d}"/></svg>`),
    ).ops;
    expect(ops).toHaveLength(1);
    expect((ops[0] as PathOp).d).toBe(d);
  });
});
