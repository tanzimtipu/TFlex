/**
 * Phase 53 (DEF-376) - the shared "does this rendered document show anything?"
 * test used by the Markdown and HTML adapters.
 *
 * Both adapters must agree on what "no visible content" means so the same
 * whitespace-only source produces the same `partial-content` warning. The rule
 * is the one the text adapter states: an `<img>` (local or remote) renders
 * content, so an image-only document is NOT empty; otherwise the document must
 * carry at least one non-whitespace character of visible text. Headings with no
 * words and horizontal rules render no text and therefore do not count.
 *
 * Pure string work - no engine, no I/O, no Electron.
 */

const COMMENT_RE = /<!--[\s\S]*?-->/g;
const IMG_RE = /<img\b/i;
const BODY_RE = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i;
const HEAD_RE = /<head\b[^>]*>[\s\S]*?<\/head\s*>/gi;
const STYLE_RE = /<style\b[^>]*>[\s\S]*?<\/style\s*>/gi;
const SCRIPT_RE = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi;
const TAG_RE = /<[^>]*>/g;
const NBSP_RE = /&nbsp;|&#160;/gi;
const ENTITY_RE = /&[a-z]+;|&#\d+;/gi;

/** True when the document carries an image element (local or remote). */
export function hasImage(html: string): boolean {
  return IMG_RE.test(html.replace(COMMENT_RE, ' '));
}

/** True when the document's rendered text has a non-whitespace character. */
export function hasVisibleText(html: string): boolean {
  const noComments = html.replace(COMMENT_RE, ' ');
  const body = BODY_RE.exec(noComments);
  // Prefer the body when present: head-only text (a <title>) never renders.
  let scope = body !== null ? body[1] : noComments.replace(HEAD_RE, ' ');
  scope = scope.replace(STYLE_RE, ' ').replace(SCRIPT_RE, ' ');
  const text = scope
    .replace(TAG_RE, ' ')
    .replace(NBSP_RE, ' ')
    // Any remaining entity stands for a real character the user would see.
    .replace(ENTITY_RE, 'x');
  return text.trim().length > 0;
}

/** True when the rendered HTML shows anything at all. */
export function htmlHasVisibleContent(html: string): boolean {
  return hasImage(html) || hasVisibleText(html);
}