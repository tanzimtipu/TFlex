import { marked } from 'marked';
import { CONVERT_CSP_META } from './templates';

/**
 * Phase 53 feature E — the pure Markdown-to-HTML step.
 *
 * `marked` produces the semantic body; this module wraps it in the print shell
 * and the bundled print stylesheet (a STRING constant, not an asset: the main
 * bundle cannot copy files). Links survive as text only — Chromium's
 * `printToPDF` emits no link annotations — which the adapter states with a
 * `links-not-live` warning.
 */

/** The print stylesheet. H1-H6 are six pairwise-different font sizes; every
 *  inline and block construct the phase promises has its own rule. No `@page`
 *  rule: the engine prints with `preferCSSPageSize: false`, so Settings win. */
export const MARKDOWN_PRINT_CSS = `
body { font-family: Arial, Helvetica, sans-serif; font-size: 11pt; line-height: 1.45; color: #111; }
h1 { font-size: 28pt; margin: 0.6em 0 0.4em; }
h2 { font-size: 23pt; margin: 0.6em 0 0.4em; }
h3 { font-size: 19pt; margin: 0.6em 0 0.4em; }
h4 { font-size: 16pt; margin: 0.6em 0 0.4em; }
h5 { font-size: 14pt; margin: 0.6em 0 0.4em; }
h6 { font-size: 12pt; margin: 0.6em 0 0.4em; }
strong { font-weight: 700; }
em { font-style: italic; }
a { color: #1a73e8; text-decoration: underline; }
ul { margin: 0.4em 0; padding-left: 1.4em; list-style: disc; }
ul ul { list-style: circle; }
ol { margin: 0.4em 0; padding-left: 1.6em; list-style: decimal; }
li { margin: 0.15em 0; }
table { border-collapse: collapse; margin: 0.5em 0; max-width: 100%; }
th, td { border: 1px solid #999; padding: 4px 8px; text-align: left; }
thead th { background: #f0f0f0; font-weight: 700; }
blockquote { border-left: 3px solid #ccc; margin: 0.6em 0; padding: 0.1em 0 0.1em 12px; color: #555; }
pre { background: #f6f6f6; border: 1px solid #e0e0e0; border-radius: 4px; padding: 8px 10px; overflow: hidden; white-space: pre-wrap; }
pre code { font-family: Consolas, 'Courier New', monospace; font-size: 10pt; }
code { font-family: Consolas, 'Courier New', monospace; }
hr { border: none; border-top: 1px solid #bbb; margin: 1em 0; }
img { max-width: 100%; }
`;

/** Render Markdown to a complete, print-ready HTML document. Pure. */
export function markdownToHtml(md: string): string {
  const body = marked.parse(md, { async: false, gfm: true }) as string;
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
${CONVERT_CSP_META}
<style>${MARKDOWN_PRINT_CSS}</style>
</head>
<body>
${body}
</body>
</html>`;
}