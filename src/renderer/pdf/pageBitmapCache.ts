// Phase 128 (TFL-1571) — session-level page bitmap cache.
//
// pdf.js keeps its decoded image caches inside the worker, but the idle
// cleanup coordinator's `doc.cleanup()` (DEF-016) flushes them after a
// few seconds of quiet, and even a warm worker still re-rasterizes the
// full operator list onto the main thread on every `pageProxy.render()`.
// For a scanned (image-only) page that re-rasterization is a large
// `drawImage` of a decoded JPEG/JPX bitmap, so returning to a
// previously-rendered page paid the full cost again.
//
// This module keeps the last few RENDERED page bitmaps per tab in a
// module-level cache keyed by `(tabId, sourcePage, cssScale, rotation)`.
// A hit lets `PageView` blit the cached `ImageBitmap` onto the visible
// canvas and skip `doc.getPage -> render -> getTextContent -> TextLayer`
// entirely, making tab switches and scroll-backs to warm pages instant.
//
// It is intentionally a pure, module-level helper: no React state, no
// context, no provider. Memory is bounded per tab (LRU by last use) and
// dropped on tab close / proxy refresh.

/** Default cap on the number of cached bitmaps retained per tab. */
export const PAGE_BITMAP_CACHE_LIMIT = 24;

/** One cached page bitmap plus the bookkeeping the LRU prune needs. */
interface CacheEntry {
  bitmap: ImageBitmap;
  timestamp: number;
}

/** tabId -> (page key -> entry). */
const tabCaches = new Map<string, Map<string, CacheEntry>>();

/** Build the canonical cache key for one page render identity. */
function cacheKey(
  tabId: string,
  sourcePage: number,
  cssScale: number,
  rotation: number,
): string {
  return `${tabId}:${sourcePage}:${cssScale}:${rotation}`;
}

/** Release a bitmap that is being evicted, tolerating partial stubs. */
function disposeEntry(entry: CacheEntry): void {
  if (typeof entry.bitmap.close === "function") {
    entry.bitmap.close();
  }
}

/**
 * Return the cached bitmap for this exact render identity, refreshing its
 * LRU timestamp on a hit. Returns null on a miss.
 */
export function getCachedBitmap(
  tabId: string,
  sourcePage: number,
  cssScale: number,
  rotation: number,
): ImageBitmap | null {
  const tab = tabCaches.get(tabId);
  if (tab === undefined) return null;
  const entry = tab.get(cacheKey(tabId, sourcePage, cssScale, rotation));
  if (entry === undefined) return null;
  entry.timestamp = Date.now();
  return entry.bitmap;
}

/** Store a rendered page bitmap under this render identity. */
export function setCachedBitmap(
  tabId: string,
  sourcePage: number,
  cssScale: number,
  rotation: number,
  bitmap: ImageBitmap,
): void {
  let tab = tabCaches.get(tabId);
  if (tab === undefined) {
    tab = new Map<string, CacheEntry>();
    tabCaches.set(tabId, tab);
  }
  const key = cacheKey(tabId, sourcePage, cssScale, rotation);
  const existing = tab.get(key);
  if (existing !== undefined && existing.bitmap !== bitmap) {
    // Replacing the same key: drop the old bitmap to avoid leaking it.
    disposeEntry(existing);
  }
  tab.set(key, { bitmap, timestamp: Date.now() });
}

/**
 * Bound the tab's cache to `maxEntries`, evicting the least-recently-used
 * bitmaps first (LRU by timestamp). No-op when the tab has no cache or is
 * already within the limit.
 */
export function pruneTabCache(
  tabId: string,
  maxEntries: number = PAGE_BITMAP_CACHE_LIMIT,
): void {
  const tab = tabCaches.get(tabId);
  if (tab === undefined) return;
  if (tab.size <= maxEntries) return;
  const entries = Array.from(tab.entries()).sort(
    (a, b) => a[1].timestamp - b[1].timestamp,
  );
  const excess = tab.size - maxEntries;
  for (let i = 0; i < excess; i += 1) {
    const key = entries[i][0];
    const entry = tab.get(key);
    if (entry !== undefined) disposeEntry(entry);
    tab.delete(key);
  }
}

/** Drop every cached bitmap for a tab (tab close). */
export function clearTabCache(tabId: string): void {
  const tab = tabCaches.get(tabId);
  if (tab === undefined) return;
  for (const entry of tab.values()) disposeEntry(entry);
  tabCaches.delete(tabId);
}

/**
 * Alias of {@link clearTabCache} used when the pdf.js proxy identity is
 * swapped (`refreshDocProxyFor`): the old proxy's bitmaps are positional
 * against the old document and must not be reused.
 */
export function invalidateProxyCache(tabId: string): void {
  clearTabCache(tabId);
}
