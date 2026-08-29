/**
 * Search index over pdf.js textContent items.
 *
 * A page's items are concatenated (no separator) so phrases split across
 * adjacent items still match. Offsets let every hit map back to item(s) and
 * character offsets, which the highlighter turns into DOM ranges.
 */
export interface PageTextIndex {
  items: string[];
  offsets: number[]; // start position of each item within the page text
  text: string;
  totalLength: number;
}

export function buildPageIndex(items: string[]): PageTextIndex {
  const offsets: number[] = [];
  let text = '';
  for (const item of items) {
    offsets.push(text.length);
    text += item;
  }
  return { items, offsets, text, totalLength: text.length };
}

export interface HitBoundary {
  item: number;
  offset: number; // char offset within the item
}

export interface SearchHit {
  page: number; // 1-based page number
  start: HitBoundary;
  end: HitBoundary; // exclusive
}

function locate(index: PageTextIndex, pos: number): HitBoundary {
  for (let i = 0; i < index.items.length; i += 1) {
    const start = index.offsets[i];
    const len = index.items[i].length;
    if (pos >= start && pos < start + len) {
      return { item: i, offset: pos - start };
    }
  }
  // Position at (or past) the end: clamp to the last item.
  const last = index.items.length - 1;
  return last < 0
    ? { item: -1, offset: 0 }
    : { item: last, offset: index.items[last].length };
}

export function findPageHits(index: PageTextIndex, page: number, query: string): SearchHit[] {
  const q = query.trim();
  if (q.length === 0 || index.totalLength === 0) {
    return [];
  }
  const needle = q.toLowerCase();
  const hay = index.text.toLowerCase();
  const hits: SearchHit[] = [];
  let from = 0;
  for (;;) {
    const at = hay.indexOf(needle, from);
    if (at === -1) {
      break;
    }
    const endPos = at + needle.length;
    hits.push({
      page,
      start: locate(index, at),
      end: locate(index, endPos - 1),
    });
    // make end exclusive
    hits[hits.length - 1].end.offset += 1;
    from = at + needle.length;
  }
  return hits;
}

/** Wrap-around cycling helpers for next/previous navigation. */
export function nextHitIndex(current: number, length: number): number {
  return length === 0 ? -1 : (current + 1) % length;
}

export function prevHitIndex(current: number, length: number): number {
  return length === 0 ? -1 : (current - 1 + length) % length;
}
