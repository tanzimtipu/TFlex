// TFL-1116 C12 (R18/R19) — the OCR suspects panel's pure model.
//
// Extracted from OcrSuspectsPanel so the grouping + bounded-window arithmetic
// can be profiled with no DOM and no React (see
// `test/unit/renderer/tfl1116_ocrPerf.test.ts`). The component renders exactly
// this model; the pure tests measure exactly this model, so a performance claim
// is tied to the shipped code, not to a copy.

import type { OcrSuspect } from '../../shared/types';

/** R19 — row count above which the panel switches from the grouped (all-mount)
 *  render to a bounded, windowed list. Below it every existing host/test keeps
 *  the exact grouped DOM it had; above it a noisy scan (thousands of entries)
 *  mounts only the visible slice. */
export const OCR_SUSPECT_WINDOW_THRESHOLD = 200;

/** R19 — fixed item height (px) the window arithmetic assumes. CSS pins every
 *  row and page header to `var(--ocr-suspect-row-h)`, the same 30px, so the
 *  spacer offsets never drift from the rendered rows. */
export const OCR_SUSPECT_ROW_H = 30;

/** R19 — rows rendered beyond the viewport on each side, so a fast scroll does
 *  not flash empty space before the next window paints. */
export const WINDOW_OVERSCAN = 6;

/** R19 — viewport height used before the scroll container has been measured
 *  (first paint, jsdom). Keeps the first window bounded and non-empty. */
export const FALLBACK_VIEWPORT_H = 320;

/** Suspects grouped by their 1-based visible page, ascending. Entries keep the
 *  engine's order within a page. */
export interface GroupedPage {
  page: number;
  entries: OcrSuspect[];
}

export function groupByPage(suspects: readonly OcrSuspect[]): GroupedPage[] {
  const map = new Map<number, OcrSuspect[]>();
  for (const s of suspects) {
    const list = map.get(s.page);
    if (list === undefined) {
      map.set(s.page, [s]);
    } else {
      list.push(s);
    }
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([page, entries]) => ({ page, entries }));
}

/** One row of the flattened page/row stream the bounded window renders. Page
 *  headers and suspect rows share the stream so a single fixed height drives
 *  the scroll offsets. `ordinal` is the 0-based suspect index (page headers
 *  carry -1). */
export interface OcrSuspectItem {
  key: string;
  kind: 'page' | 'row';
  page: number;
  pageCount: number;
  suspect: OcrSuspect | null;
  ordinal: number;
}

/** Flatten the grouped pages into the page-header + suspect-row stream with
 *  stable keys (`p:<page>` / `r:<page>:<ordinal>`). */
export function flattenSuspectItems(
  grouped: readonly GroupedPage[],
): OcrSuspectItem[] {
  const items: OcrSuspectItem[] = [];
  let ordinal = 0;
  for (const page of grouped) {
    items.push({
      key: `p:${page.page}`,
      kind: 'page',
      page: page.page,
      pageCount: page.entries.length,
      suspect: null,
      ordinal: -1,
    });
    for (const entry of page.entries) {
      items.push({
        key: `r:${page.page}:${ordinal}`,
        kind: 'row',
        page: page.page,
        pageCount: page.entries.length,
        suspect: entry,
        ordinal,
      });
      ordinal += 1;
    }
  }
  return items;
}

/** The half-open `[start, end)` window of items to mount for a scroll position
 *  and viewport height. Always bounded by `WINDOW_OVERSCAN` + the visible
 *  slice, never by the total — that is R19's whole point. */
export function computeWindowRange(
  scrollTop: number,
  viewportH: number,
  count: number,
): { start: number; end: number } {
  if (count <= 0) return { start: 0, end: 0 };
  const top = Number.isFinite(scrollTop) && scrollTop > 0 ? scrollTop : 0;
  const height =
    Number.isFinite(viewportH) && viewportH > 0 ? viewportH : FALLBACK_VIEWPORT_H;
  const first = Math.floor(top / OCR_SUSPECT_ROW_H);
  const visible = Math.max(1, Math.ceil(height / OCR_SUSPECT_ROW_H) + 1);
  const start = Math.max(0, first - WINDOW_OVERSCAN);
  const end = Math.min(count, first + visible + WINDOW_OVERSCAN);
  return { start, end };
}

/** How many items mount for a list of `count` at the top of a `viewportH` tall
 *  window. The measured bound R19 asserts. */
export function windowMountCount(count: number, viewportH: number): number {
  const { start, end } = computeWindowRange(0, viewportH, count);
  return Math.max(0, end - start);
}

/** The suspect at a flat 0-based index, or null out of range. */
export function suspectAtIndex(
  grouped: readonly GroupedPage[],
  index: number,
): OcrSuspect | null {
  if (index < 0) return null;
  let cursor = 0;
  for (const page of grouped) {
    if (index < cursor + page.entries.length) {
      return page.entries[index - cursor] ?? null;
    }
    cursor += page.entries.length;
  }
  return null;
}

/** Deterministic DOM id for the bounded list's nth option (listbox / aria). */
export function suspectOptionId(index: number): string {
  return `ocr-suspect-option-${index}`;
}

/** The engine's real word rect as a stable `x,y,w,h` string (page points,
 *  top-left origin). Surfaced on the row so the host's highlight can consume
 *  the EXACT bounds instead of guessing. */
export function formatSuspectBounds(suspect: OcrSuspect): string {
  const { x, y, width, height } = suspect.rect;
  return `${Math.round(x)},${Math.round(y)},${Math.round(width)},${Math.round(height)}`;
}
