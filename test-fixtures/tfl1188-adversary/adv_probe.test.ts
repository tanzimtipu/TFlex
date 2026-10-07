// TFL-1188 adversary diff-pass probes — pure-function invariants for the
// phase's high-risk merges. Adversary-owned fixture; imports product source
// read-only, changes nothing under src/.
import { vi, describe, it, expect } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: class {},
  screen: { getAllDisplays: () => [] },
}));

import {
  classifyPageRange,
  pageRangeMessage,
  parsePageRange,
} from '../../../src/renderer/engine/types';
import {
  normalizedAnchorFraction,
  anchorOffsetAfter,
  zoomFlipIsStale,
  runZoomFlip,
  type ZoomFlipPending,
} from '../../../src/renderer/components/zoomFlip';
import { isSampleRecentPath } from '../../../src/renderer/utils/sampleRecents';
import { applyThemeDefault, nextTheme, resolveThemeDefault } from '../../../src/renderer/state/theme';
import { fitGeometryToWorkArea } from '../../../src/main/window';
import type { AppSettings } from '../../../src/shared/types';

// ---------------------------------------------------------------------------
// AR-07 page-range classifier
// ---------------------------------------------------------------------------
describe('AR-07 classifyPageRange', () => {
  const TOTAL = 34;

  const caseOf = (input: string, total = TOTAL) => classifyPageRange(input, total);

  it('gates the WHOLE input: a valid subset plus one out-of-bounds token never yields pages', () => {
    for (const input of ['1-3,999', '1,2,999', '999,1-3', '1-3,34,999', '5,999,7']) {
      const c = caseOf(input);
      expect(c.state, input).toBe('out-of-bounds');
      expect(c.pages, input).toBeNull();
      expect(parsePageRange(input, TOTAL), input).toBeNull();
    }
  });

  it('names the out-of-bounds token for a single token and a span endpoint', () => {
    expect(caseOf('999').invalidTokens).toEqual([999]);
    expect(caseOf('1-999').invalidTokens).toEqual([999]);
    expect(caseOf('0').invalidTokens).toEqual([0]);
    expect(caseOf('1-3,999').invalidTokens).toEqual([999]);
    expect(caseOf('0-3').invalidTokens).toEqual([0]);
  });

  it('names BOTH ends of a wholly out-of-bounds span', () => {
    // 50-60 on a 34-page doc: both endpoints are outside. The message must
    // not imply 50 is acceptable.
    const c = caseOf('50-60');
    expect(c.state).toBe('out-of-bounds');
    expect(c.invalidTokens).toEqual([50, 60]);
  });

  it('classifies structural problems as malformed and never returns pages', () => {
    for (const input of ['-', '1-', '1--3', '1-2-3', '3-1', 'a', '1,,2', '', '   ']) {
      const c = caseOf(input);
      expect(['malformed', 'empty'], input).toContain(c.state);
      expect(c.pages, input).toBeNull();
      expect(c.state === 'valid', input).toBe(false);
    }
  });

  it('rejects tokens with trailing garbage rather than acting on the leading number', () => {
    for (const input of ['1abc', '2x', '1.9', '2-3x', '1,2abc', '12px']) {
      const c = caseOf(input);
      expect(c.state, `${input} state`).not.toBe('valid');
      expect(parsePageRange(input, TOTAL), `${input} pages`).toBeNull();
    }
  });

  it('accepts, normalises and dedupes valid input', () => {
    expect(caseOf('1-3').pages).toEqual([1, 2, 3]);
    expect(caseOf(' 1 , 2 ').pages).toEqual([1, 2]);
    expect(caseOf('01').pages).toEqual([1]);
    expect(caseOf('3,1,3,2').pages).toEqual([1, 2, 3]);
    expect(caseOf('34').pages).toEqual([34]);
  });

  it('holds the page-set invariant on every accepted input', () => {
    for (const input of ['1', '1-34', '2,4,6', '34', '1-1', '10-20']) {
      const c = caseOf(input);
      expect(c.state, input).toBe('valid');
      expect(c.pages, input).not.toBeNull();
      const pages = c.pages as number[];
      expect(pages.length, input).toBeGreaterThan(0);
      for (const p of pages) {
        expect(Number.isInteger(p) && p >= 1 && p <= TOTAL, `${input} -> ${p}`).toBe(true);
      }
      // sorted + deduped
      expect(pages, input).toEqual([...new Set(pages)].sort((a, b) => a - b));
    }
  });

  it('message is non-null iff state is not valid', () => {
    for (const input of ['1-3', '999', '-', '', '0', '1-999', '2,4']) {
      const c = caseOf(input);
      expect(c.message === null, `${input} state=${c.state}`).toBe(c.state === 'valid');
    }
  });

  it('no-document totalPages=0 is out-of-bounds with the open-document message', () => {
    const c = caseOf('1', 0);
    expect(c.state).toBe('out-of-bounds');
    expect(c.pages).toBeNull();
    expect(c.message).toBe('Open a document first.');
  });

  it('pageRangeMessage with no invalid tokens keeps the generic bound wording', () => {
    expect(pageRangeMessage('out-of-bounds', 34)).toBe(
      'Page numbers must be between 1 and 34.',
    );
  });
});

// ---------------------------------------------------------------------------
// AR-01 / AR-04 anchor maths
// ---------------------------------------------------------------------------
describe('AR-01/AR-04 anchor maths', () => {
  it('normalizedAnchorFraction clamps and treats the top edge as 0', () => {
    expect(normalizedAnchorFraction(0, 1000)).toBe(0);
    expect(normalizedAnchorFraction(-250, 1000)).toBeCloseTo(0.25, 10);
    expect(normalizedAnchorFraction(100, 1000)).toBe(0); // page below the top
    expect(normalizedAnchorFraction(-1500, 1000)).toBe(1); // fully scrolled past
    expect(normalizedAnchorFraction(-250, 0)).toBe(0);
    expect(normalizedAnchorFraction(-250, Number.NaN)).toBe(0);
    expect(normalizedAnchorFraction(Number.NaN, 1000)).toBe(0);
  });

  it('anchorOffsetAfter keeps the same in-page point at the same viewport position across a scale change', () => {
    // Page top 400px above the scroller top, height 1000, scale x1.5.
    const topOffsetBefore = -400;
    const heightBefore = 1000;
    const frac = normalizedAnchorFraction(topOffsetBefore, heightBefore);
    expect(frac).toBeCloseTo(0.4, 10);
    const heightAfter = 1500;
    const target = anchorOffsetAfter(topOffsetBefore, frac, heightBefore, heightAfter);
    // Restore places the page top at `target`; the anchor point within the page
    // then sits at target + frac*heightAfter and must equal the original
    // viewport position topOffsetBefore + frac*heightBefore.
    const pointAfter = target + frac * heightAfter;
    const pointBefore = topOffsetBefore + frac * heightBefore;
    expect(pointAfter).toBeCloseTo(pointBefore, 9);
  });

  it('anchorOffsetAfter is a no-op on a same-height reflow and falls back on NaN', () => {
    expect(anchorOffsetAfter(-400, 0.4, 1000, 1000)).toBe(-400);
    expect(anchorOffsetAfter(-400, Number.NaN, 1000, 1200)).toBe(-400);
  });

  it('zoomFlipIsStale only discards a different defined generation', () => {
    const base: ZoomFlipPending = {
      firstRects: new Map(),
      anchorPage: 1,
      anchorOffsetBefore: 0,
    };
    expect(zoomFlipIsStale(base, 5)).toBe(false); // undefined generation
    expect(zoomFlipIsStale({ ...base, generation: 5 }, 5)).toBe(false);
    expect(zoomFlipIsStale({ ...base, generation: 4 }, 5)).toBe(true);
  });

  it('runZoomFlip discards a stale pending entirely (no scroll, no animation)', () => {
    const pending: ZoomFlipPending = {
      firstRects: new Map([[1, { left: 0, top: 0, width: 100, height: 100 }]]),
      anchorPage: 1,
      anchorOffsetBefore: -50,
      anchorFraction: 0.5,
      anchorHeightBefore: 100,
      generation: 1,
    };
    const scroller = { scrollTop: 123, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) };
    const el = { getBoundingClientRect: () => ({ left: 0, top: -50, width: 100, height: 100 }) } as unknown as HTMLElement;
    const animated = runZoomFlip(scroller, [{ page: 1, el }], pending, false, 'zoom', 2);
    expect(animated).toBe(0);
    expect(scroller.scrollTop).toBe(123);
  });
});

// ---------------------------------------------------------------------------
// AR-05 sample identity
// ---------------------------------------------------------------------------
describe('AR-05 isSampleRecentPath', () => {
  it('recognises only the virtual samples/ form', () => {
    expect(isSampleRecentPath('samples/report.pdf')).toBe(true);
    expect(isSampleRecentPath('samples/a/b.pdf')).toBe(true);
    expect(isSampleRecentPath('samples/')).toBe(true);
  });

  it('never flags a real filesystem path that merely contains a samples folder', () => {
    const realPaths = [
      'C:\\Users\\me\\samples\\report.pdf',
      'C:/Users/me/samples/report.pdf',
      'C:\\Users\\me\\Documents\\samples\\report.pdf',
      '\\\\server\\share\\samples\\report.pdf',
      '/home/me/samples/report.pdf',
      'samples', // bare word, no separator
      'samplesx/report.pdf',
      'C:\\samples-perf\\a.pdf',
      'SAMPLES/report.pdf', // writer is lowercase; case must not match
      'samples\\report.pdf', // backslash form is not what the writer emits
    ];
    for (const p of realPaths) {
      expect(isSampleRecentPath(p), p).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// AR-08 theme/settings coherence
// ---------------------------------------------------------------------------
describe('AR-08 applyThemeDefault', () => {
  const base: AppSettings = {
    theme: 'light',
    geometry: { x: 0, y: 0, width: 1200, height: 800, maximized: false },
    recentFiles: [],
  };

  it('writes theme and themeDefault coherently for every pick/scheme combination', () => {
    for (const pick of ['light', 'dark', 'frosted', 'system'] as const) {
      for (const prefersDark of [false, true]) {
        const out = applyThemeDefault(base, pick, prefersDark);
        expect(out.theme, `${pick}/${prefersDark}`).toBe(resolveThemeDefault(pick, prefersDark));
        // The dropdown displays `themeDefault ?? theme`; the effective pick must
        // be the one shown and the concrete theme it resolves to.
        expect(out.themeDefault ?? out.theme, `${pick}/${prefersDark}`).toBe(pick);
        if (out.themeDefault !== undefined) {
          expect(out.theme, `${pick}/${prefersDark}`).toBe(
            resolveThemeDefault(out.themeDefault, prefersDark),
          );
        }
      }
    }
  });

  it('a live theme toggle keeps the persisted themeDefault equal to the effective theme (AR-08 invariant)', () => {
    // Pick Dark through the dropdown, then use the documented Toggle Theme
    // command (Ctrl+Shift+T / app menu). The persisted pair must not become
    // `theme=light, themeDefault=dark` — the exact AR-08 residue.
    const afterPick = applyThemeDefault(base, 'dark', false);
    expect(afterPick.themeDefault).toBe('dark');
    const toggled: AppSettings = { ...afterPick, theme: nextTheme(afterPick.theme) };
    expect(toggled.theme).not.toBe(toggled.themeDefault); // precondition of the repro
    expect(toggled.themeDefault).toBe(toggled.theme); // AR-08: must stay coherent
  });

  it('heals a legacy theme/themeDefault disagreement on the next pick', () => {
    // The documented residue: theme=light, themeDefault=dark.
    const residue: AppSettings = { ...base, theme: 'light', themeDefault: 'dark' };
    const out = applyThemeDefault(residue, 'dark', false);
    expect(out.theme).toBe('dark');
    expect(out.themeDefault).toBe('dark');
  });
});

// ---------------------------------------------------------------------------
// Window bounds (chunk F)
// ---------------------------------------------------------------------------
describe('F fitGeometryToWorkArea', () => {
  const geo = (x: number, y: number, width: number, height: number) => ({
    x,
    y,
    width,
    height,
    maximized: false,
  });

  it('a normal 1920x1040 work area keeps the 960x640 floor', () => {
    expect(fitGeometryToWorkArea(geo(100, 100, 400, 300), { x: 0, y: 0, width: 1920, height: 1040 })).toEqual({
      x: 100,
      y: 100,
      width: 960,
      height: 640,
    });
  });

  it('a work area smaller than the floor clamps the window down to the work area, never larger', () => {
    const tiny = { x: 0, y: 0, width: 800, height: 500 };
    const out = fitGeometryToWorkArea(geo(0, 0, 1200, 900), tiny);
    expect(out.width).toBe(800);
    expect(out.height).toBe(500);
    expect(out.width).toBeLessThanOrEqual(tiny.width);
    expect(out.height).toBeLessThanOrEqual(tiny.height);
  });

  it('never exceeds the work area for any geometry, even a maximized 4K save', () => {
    const displays = [
      { x: 0, y: 0, width: 1920, height: 1040 },
      { x: -1280, y: 0, width: 1280, height: 984 },
      { x: 0, y: 0, width: 800, height: 480 },
    ];
    for (const wa of displays) {
      for (const g of [geo(0, 0, 3840, 2160), geo(5000, 5000, 2000, 1200), geo(-3000, 0, 1000, 700)]) {
        const out = fitGeometryToWorkArea(g, wa);
        expect(out.width, `${JSON.stringify(wa)}`).toBeLessThanOrEqual(wa.width);
        expect(out.height, `${JSON.stringify(wa)}`).toBeLessThanOrEqual(wa.height);
        expect(out.x).toBeGreaterThanOrEqual(wa.x);
        expect(out.y).toBeGreaterThanOrEqual(wa.y);
        expect(out.x + out.width).toBeLessThanOrEqual(wa.x + wa.width);
        expect(out.y + out.height).toBeLessThanOrEqual(wa.y + wa.height);
      }
    }
  });
});
