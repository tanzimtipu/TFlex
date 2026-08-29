import type { SearchHit } from '../search/searchIndex';

export interface HitRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Measure a hit over the rendered TextLayer spans. Range API gives exact,
 * per-line rects. Boundary items that pdf.js did not render (whitespace-only
 * items stay in #textDivs but are not mounted) are skipped by scanning the
 * hit span for the nearest attached item; the fallback draws the whole item
 * box rather than dropping the highlight.
 */
export function measureHitRects(
  container: HTMLElement,
  textDivs: HTMLElement[],
  hit: SearchHit,
): HitRect[] {
  const base = container.getBoundingClientRect();
  const lo = Math.min(hit.start.item, hit.end.item);
  const hi = Math.max(hit.start.item, hit.end.item);

  let startDiv = pickAttached(textDivs, lo, hi, 1);
  let endDiv = pickAttached(textDivs, hi, lo, -1);
  if (startDiv === null) {
    startDiv = safeDiv(textDivs, lo);
  }
  if (endDiv === null) {
    endDiv = safeDiv(textDivs, hi);
  }

  const rects: HitRect[] = [];
  if (startDiv !== null && endDiv !== null && startDiv.firstChild && endDiv.firstChild) {
    try {
      const range = document.createRange();
      const startLen = startDiv.textContent?.length ?? 0;
      const endLen = endDiv.textContent?.length ?? 0;
      // If boundary items had to be skipped, clamp to full item extents.
      const startOffset =
        startDiv === safeDiv(textDivs, hit.start.item) ? Math.min(hit.start.offset, startLen) : 0;
      const endOffset =
        endDiv === safeDiv(textDivs, hit.end.item) ? Math.min(hit.end.offset, endLen) : endLen;
      range.setStart(startDiv.firstChild, startOffset);
      range.setEnd(endDiv.firstChild, Math.max(endOffset, 0));
      for (const r of range.getClientRects()) {
        rects.push({
          left: r.left - base.left,
          top: r.top - base.top,
          width: r.width,
          height: r.height,
        });
      }
      if (rects.length > 0) {
        return rects;
      }
    } catch {
      // fall through to whole-item fallback
    }
  }
  const fallback = startDiv ?? endDiv;
  if (fallback !== null) {
    const r = fallback.getBoundingClientRect();
    rects.push({
      left: r.left - base.left,
      top: r.top - base.top,
      width: r.width,
      height: r.height,
    });
  }
  return rects;
}

function pickAttached(
  divs: HTMLElement[],
  from: number,
  bound: number,
  step: 1 | -1,
): HTMLElement | null {
  if (from < 0 || from >= divs.length) {
    return null;
  }
  for (let i = from; step === 1 ? i <= bound : i >= bound; i += step) {
    const div = divs[i];
    if (div.isConnected && (div.textContent?.length ?? 0) > 0) {
      return div;
    }
  }
  return null;
}

function safeDiv(divs: HTMLElement[], index: number): HTMLElement | null {
  if (index < 0 || index >= divs.length) {
    return null;
  }
  return divs[index];
}
