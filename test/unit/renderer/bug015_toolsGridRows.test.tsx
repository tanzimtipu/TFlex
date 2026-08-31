// @vitest-environment node
// Static CSS guard for Bug 15 — the tools palette body used to
// stack entries one per row because each entry declared
// `width: 100%` inside a block container with no grid / flex
// layout. The fix sets the body to a CSS grid with auto-fill
// columns at 64px minimum so tiles actually lay out in rows,
// and adds `grid-column: 1 / -1` to the list-mode entries so
// labelled entries still span the full row.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");

function readStyles(): string {
  return readFileSync(STYLES_PATH, "utf8");
}

function stripCssComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "");
}

function extractRuleBody(src: string, selectorIndex: number): string {
  const braceOpen = src.indexOf("{", selectorIndex);
  if (braceOpen === -1) return "";
  let depth = 0;
  for (let i = braceOpen; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(braceOpen + 1, i);
    }
  }
  return "";
}

function findRuleBody(src: string, selector: string): string | null {
  const stripped = stripCssComments(src);
  let from = 0;
  for (;;) {
    const idx = stripped.indexOf(selector, from);
    if (idx === -1) return null;
    let cursor = idx + selector.length;
    while (cursor < stripped.length && /\s/.test(stripped[cursor] ?? "")) cursor += 1;
    if (stripped[cursor] === "{") return extractRuleBody(stripped, idx);
    from = idx + selector.length;
  }
}

describe("Bug 15 — tools palette body lays entries out in rows", () => {
  const src = readStyles();

  it(".tools-palette-body uses display: grid for proper row layout", () => {
    const body = findRuleBody(src, ".tools-palette-body");
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(/display:\s*grid/);
  });

  it(".tools-palette-body uses auto-fill columns (multiple tiles per row)", () => {
    const body = findRuleBody(src, ".tools-palette-body");
    expect(body).not.toBeNull();
    // The fix uses `grid-template-columns: repeat(auto-fill, minmax(64px, 1fr))`
    // so the column count tracks the available width. Lock both
    // keywords so a future edit can't revert to a single column.
    expect(body ?? "").toMatch(/grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(/);
  });

  it(".tools-palette-entry-list spans the full row in list mode", () => {
    // The list layout shows labelled entries (icon + text + shortcut)
    // one per row. Without `grid-column: 1 / -1` the body's grid
    // would pack them into 3 columns, breaking the list affordance.
    const body = findRuleBody(src, ".tools-palette-entry-list");
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(/grid-column:\s*1\s*\/\s*-1/);
  });
});
