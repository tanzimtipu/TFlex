// @vitest-environment node
// Static CSS guard for Bug 15 — the tools palette body used to
// stack entries one per row because each entry declared
// `width: 100%` inside a block container with no grid / flex
// layout. The fix set the body to a CSS grid with auto-fill
// columns at 64px minimum so tiles actually lay out in rows,
// and added `grid-column: 1 / -1` to the list-mode entries so
// labelled entries still span the full row.
//
// Phase B (frosted restyle) evolved that layout: the palette is now
// grouped into quiet section headers (ORGANIZE PAGES / DOCUMENT /
// RECOGNITION / EXPORT), so each group owns its own layout —
// `.tools-palette-group-grid` carries the tile grid (same auto-fill
// 64px columns + uniform 72px rows) and `.tools-palette-group-list`
// is the full-width flex column. The body stays a scrollable flow
// column. These pins preserve the Bug-15 guarantees (tiles in rows,
// list entries spanning the full row) in the new structure.

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

describe("Bug 15 — tools palette body lays entries out in rows (Phase B groups)", () => {
  const src = readStyles();

  it(".tools-palette-body is a scrollable flow column (groups own layout)", () => {
    const body = findRuleBody(src, ".tools-palette-body");
    expect(body).not.toBeNull();
    // Phase B — the body became a plain flow column so each group
    // section can own its own list/grid layout; it still reserves
    // scroll space for the whole list.
    expect(body ?? "").toMatch(/display:\s*block/);
    expect(body ?? "").toMatch(/overflow-y:\s*auto/);
  });

  it(".tools-palette-group-grid uses auto-fill columns (multiple tiles per row)", () => {
    const body = findRuleBody(src, ".tools-palette-group-grid");
    expect(body).not.toBeNull();
    // The tile grid moved from the body into the group section. Lock
    // both keywords so a future edit can't revert to a single column.
    expect(body ?? "").toMatch(/display:\s*grid/);
    expect(body ?? "").toMatch(/grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(/);
    // Uniform tile rows (the B21 height contract) live on the group
    // grid now.
    expect(body ?? "").toMatch(/grid-auto-rows:\s*minmax\(72px,\s*auto\)/);
  });

  it(".tools-palette-entry-list spans the full row in list mode", () => {
    // The list layout shows labelled entries (icon + text + shortcut)
    // one per row. Phase B — list entries live in a flex column
    // (`.tools-palette-group-list`) and fill their row via
    // `width: 100%`, preserving the full-width list affordance that
    // `grid-column: 1 / -1` used to provide in the body grid.
    const groupList = findRuleBody(src, ".tools-palette-group-list");
    expect(groupList).not.toBeNull();
    expect(groupList ?? "").toMatch(/flex-direction:\s*column/);
    const body = findRuleBody(src, ".tools-palette-entry-list");
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(/width:\s*100%/);
  });
});