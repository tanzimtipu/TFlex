/**
 * Phase 53 — the print document shell and its security meta.
 *
 * Exported as STRING CONSTANTS, never asset files: `build:node` is a single
 * file esbuild bundle (`src/main/index.ts` -> `dist/main/index.js`) and cannot
 * copy assets, so a stylesheet or shell read from disk would simply be absent
 * in the packaged app.
 *
 * The meta is the capability-removal half of the offscreen sanitiser. The
 * engine runs with JavaScript disabled and every non-`file:` request cancelled
 * at its dedicated session (see `html-print.ts`); the CSP is belt-and-braces
 * for any subresource Chromium tries before the session rule lands. Safety is
 * therefore capability removal, NOT pattern matching — there is deliberately
 * no regex HTML sanitiser anywhere in this chunk.
 */

/** The exact CSP injected into every converted document. `default-src 'none'`
 *  denies scripts, frames and XHR; `img-src data: file:` allows only inline
 *  images and the temp document itself; `style-src 'unsafe-inline'` allows the
 *  conversion stylesheet; `font-src data:` allows embedded fonts only. */
export const CONVERT_CSP_META =
  '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: file:; style-src \'unsafe-inline\'; font-src data:">';

/** The bare minimum print styling for an HTML document with no stylesheet of
 *  its own. Deliberately sets NO `@page` rule: the engine prints with
 *  `preferCSSPageSize: false` so the Settings page size and margins win. */
export const HTML_PRINT_BASE_CSS = `
html, body { margin: 0; padding: 0; }
body { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; line-height: 1.4; color: #111; }
img, svg, table, pre { max-width: 100%; }
table { border-collapse: collapse; }
pre { white-space: pre-wrap; overflow: hidden; }
`;

/**
 * Inject `CONVERT_CSP_META` exactly once, wherever the document's own head is:
 *  - after an existing `<head ...>` opening tag;
 *  - after an `<html ...>` tag when there is no head; or
 *  - into a minimal shell when the fragment has neither.
 * The function never appends a second meta: it inserts only when the exact
 * marker is not already present, so re-running it is a no-op.
 */
export function injectSecurityMeta(html: string): string {
  if (html.includes('Content-Security-Policy')) return html;

  const head = /<head[^>]*>/i.exec(html);
  if (head !== null) {
    const at = head.index + head[0].length;
    return html.slice(0, at) + CONVERT_CSP_META + html.slice(at);
  }

  const root = /<html[^>]*>/i.exec(html);
  if (root !== null) {
    const at = root.index + root[0].length;
    return `${html.slice(0, at)}<head>${CONVERT_CSP_META}</head>${html.slice(at)}`;
  }

  return `<!doctype html><html><head><meta charset="utf-8">${CONVERT_CSP_META}<style>${HTML_PRINT_BASE_CSS}</style></head><body>${html}</body></html>`;
}