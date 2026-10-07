// TFL-1155 (TFL-1116 C9 / R11) — the one shared, theme-aware panel scrollbar.
//
// R11 replaced the dated native arrowed scrollbars with ONE panel scrollbar
// style: a thin rounded thumb on a transparent track that widens (hit-area
// grows) on hover / keyboard focus, never draws native arrow buttons, and hands
// the scrollbar back to the platform under forced-colors. This spec resolves the
// real rules out of styles.css (the phase40 contrast-test method) so the single
// shared block cannot silently regress into per-panel copies.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(resolve(__dirname, "../../../src/renderer/styles.css"), "utf8");
const CSS_NO_COMMENTS = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

function block(css: string, selector: RegExp): string {
  const start = css.search(selector);
  if (start === -1) throw new Error(`selector not found: ${selector}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

describe("R11 — the one shared panel scrollbar rule", () => {
  it("is a thin thumb on a transparent track", () => {
    const base = block(CSS_NO_COMMENTS, /\.tf-panel-scroll\s*\{/);
    expect(base).toMatch(/scrollbar-width:\s*thin/);
    expect(base).toMatch(/scrollbar-color:\s*var\(--tf-panel-scroll-thumb\)\s+transparent/);
    const track = block(CSS_NO_COMMENTS, /\.tf-panel-scroll::-webkit-scrollbar-track\s*\{/);
    expect(track).toMatch(/background:\s*transparent/);
    const thumb = block(CSS_NO_COMMENTS, /\.tf-panel-scroll::-webkit-scrollbar-thumb\s*\{/);
    expect(thumb).toMatch(/background-clip:\s*padding-box/);
    expect(thumb).toMatch(/border-radius:\s*var\(--radius-pill\)/);
  });

  it("expands the thumb hit-area on hover and keyboard focus", () => {
    const rest = block(CSS_NO_COMMENTS, /\.tf-panel-scroll::-webkit-scrollbar-thumb\s*\{/);
    expect(rest).toMatch(/border:\s*3px solid transparent/);
    const expanded = block(CSS_NO_COMMENTS, /\.tf-panel-scroll:hover::-webkit-scrollbar-thumb\s*,/);
    expect(expanded).toMatch(/border-width:\s*2px/);
    expect(expanded).toMatch(/background:\s*var\(--tf-panel-scroll-thumb-hover\)/);
    expect(CSS_NO_COMMENTS).toMatch(
      /\.tf-panel-scroll:hover::-webkit-scrollbar-thumb,\s*\.tf-panel-scroll:focus-visible::-webkit-scrollbar-thumb,\s*\.tf-panel-scroll:focus-within::-webkit-scrollbar-thumb\s*\{/,
    );
  });

  it("never draws the native arrow buttons and never scrolls sideways", () => {
    const bar = block(CSS_NO_COMMENTS, /\.tf-panel-scroll::-webkit-scrollbar\s*\{/);
    expect(bar).toMatch(/width:\s*10px/);
    expect(bar).toMatch(/height:\s*0/);
    const buttons = block(CSS_NO_COMMENTS, /\.tf-panel-scroll::-webkit-scrollbar-button\s*,/);
    expect(buttons).toMatch(/display:\s*none/);
    // No legacy arrowed-scrollbar properties survive anywhere in the sheet.
    expect(CSS_NO_COMMENTS).not.toMatch(
      /scrollbar-(arrow|base|face|highlight|shadow|3dlight|darkshadow|track)-color/,
    );
  });

  it("hands the scrollbar back to the platform under forced-colors", () => {
    expect(CSS_NO_COMMENTS).toMatch(
      /@media \(forced-colors: active\) \{\s*\.tf-panel-scroll \{\s*scrollbar-width: auto;\s*scrollbar-color: auto;/,
    );
    expect(CSS_NO_COMMENTS).toMatch(/\.tf-panel-scroll::-webkit-scrollbar-thumb \{\s*background: ButtonText;/);
  });

  it("resolves both thumb tokens from the theme inside the .tf-panel scope", () => {
    const scope = block(CSS_NO_COMMENTS, /\.tf-panel\s*\{/);
    expect(scope).toContain("--tf-panel-scroll-thumb: var(--border-strong);");
    expect(scope).toContain("--tf-panel-scroll-thumb-hover: var(--fg-muted);");
  });
});
