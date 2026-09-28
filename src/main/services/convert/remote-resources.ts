/**
 * Phase 53 feature H (criterion 7) — source-level remote-subresource detection.
 *
 * The offscreen engine's dedicated session cancels every http/https/ws/wss/ftp
 * request (see `html-print.ts`), but the injected CSP can block a request
 * inside Blink BEFORE it reaches the session hook, leaving the recorded-URL
 * list empty and the conversion card with no `resource-blocked` warning.
 *
 * This module is the independent second source of truth: it scans the HTML
 * SOURCE for remote subresources so the user is told what was blocked even
 * when the session hook never fires. It is a pure string function — no
 * Electron, no I/O — and it deliberately reports only genuinely remote
 * references (`http:`, `https:` or a protocol-relative `//`). Relative,
 * `file:` and `data:` references are local capability, never blocked, and must
 * not raise a warning.
 *
 * Follows the same warning shape as `blockedResourceWarnings` in
 * `html-print.ts`: `mergeResourceUrls` de-duplicates the session list against
 * the detected list so a URL the session DID record is not reported twice.
 */

/** `src="..."` / `href="..."` attribute values (quoted or unquoted). */
const ATTRIBUTE_RE = /\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;

/** CSS `url(...)` references, including `@import url(...)`. */
const CSS_URL_RE = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi;

/** `@import "..."` and `@import url("...")` string forms. */
const IMPORT_RE = /@import\s+(?:url\(\s*)?(?:"([^"]*)"|'([^']*)'|([^\s;)]+))/gi;

/** A value is remote when it is absolute http(s) or protocol-relative. */
export function isRemoteResourceUrl(value: string): boolean {
  const url = value.trim().toLowerCase();
  return url.startsWith('http:') || url.startsWith('https:') || url.startsWith('//');
}

/**
 * Normalise a URL for de-duplication. Scheme and authority are case-insensitive
 * per RFC 3986; the path/query/fragment case is preserved so two genuinely
 * different URLs (e.g. `/A.png` and `/a.png`) are never merged. A
 * protocol-relative URL is kept distinct from its absolute http(s) form.
 */
export function normalizeResourceUrl(url: string): string {
  const trimmed = url.trim();
  if (trimmed.startsWith('//')) return `scheme-relative:${trimmed.toLowerCase()}`;
  const match = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]*)(.*)$/.exec(trimmed);
  if (match === null) return trimmed.toLowerCase();
  return `${match[1].toLowerCase()}://${match[2].toLowerCase()}${match[3]}`;
}

interface Detected {
  index: number;
  url: string;
}

/**
 * Scan HTML source for remote subresources and return the distinct URLs in
 * document order. At most one entry per normalised URL; the first spelling in
 * the document wins.
 */
export function detectRemoteResources(html: string): string[] {
  const found: Detected[] = [];
  const push = (index: number, value: string | undefined): void => {
    if (value === undefined) return;
    const url = value.trim();
    if (isRemoteResourceUrl(url)) found.push({ index, url });
  };

  for (const match of html.matchAll(ATTRIBUTE_RE)) {
    push(match.index ?? 0, match[1] ?? match[2] ?? match[3]);
  }
  for (const match of html.matchAll(CSS_URL_RE)) {
    push(match.index ?? 0, match[1] ?? match[2] ?? match[3]);
  }
  for (const match of html.matchAll(IMPORT_RE)) {
    push(match.index ?? 0, match[1] ?? match[2] ?? match[3]);
  }

  found.sort((a, b) => a.index - b.index);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of found) {
    const key = normalizeResourceUrl(item.url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item.url);
  }
  return out;
}

/**
 * Merge the session-recorded URLs with the source-detected URLs, de-duplicated
 * by normalised URL. Detected URLs are listed first (their source spelling is
 * the one the user can find in the document); a session URL the scan already
 * covers must not appear a second time.
 */
export function mergeResourceUrls(
  sessionUrls: string[],
  detectedUrls: string[],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of [...detectedUrls, ...sessionUrls]) {
    const key = normalizeResourceUrl(url);
    if (key.length === 0 || seen.has(key)) continue;
    seen.add(key);
    out.push(url);
  }
  return out;
}