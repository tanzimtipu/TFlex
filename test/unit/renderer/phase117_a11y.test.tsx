// @vitest-environment jsdom
//
// Phase 117 (chunk F) — ADAPTATION static CSS guard for the shared selection
// chrome.
//
// This is a STATIC source guard over `src/renderer/styles.css` (same technique
// as `phase111_pages.test.tsx`): it does not render anything, so it does not
// duplicate the render assertions in `phase117_selectionPrimitives.test.tsx`.
// It pins the accessibility-adaptation half of feature F:
//   (a) a `@media (forced-colors: active)` block styles BOTH
//       `.selection-chrome` and `.selection-handle`, using system colour roles
//       (Highlight / ButtonText / CanvasText) so the boundary never relies on
//       the violet hex alone;
//   (b) a `@media (prefers-reduced-motion: reduce)` (or the
//       `:root[data-animations="off"]` catch-all) block collapses the
//       selection's emphasis transition, referencing `.selection-chrome`.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const STYLES = readFileSync(
  resolve(__dirname, "../../../src/renderer/styles.css"),
  "utf8",
);

function stripCssComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Return the body of the `{...}` block whose opening brace is the first one
 *  at or after `start`. */
function extractBlock(src: string, start: number): string | null {
  const open = src.indexOf("{", start);
  if (open === -1) return null;
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(open + 1, i);
    }
  }
  return null;
}

/** All bodies of the given at-rule occurrence(s) in source order. */
function atRuleBodies(src: string, atRule: string): string[] {
  const stripped = stripCssComments(src);
  const bodies: string[] = [];
  let from = 0;
  for (;;) {
    const idx = stripped.indexOf(atRule, from);
    if (idx === -1) break;
    const body = extractBlock(stripped, idx + atRule.length);
    if (body !== null) bodies.push(body);
    from = idx + atRule.length;
  }
  return bodies;
}

describe("Phase 117 (chunk F) — selection chrome adaptation (static CSS guard)", () => {
  it("has a forced-colors block styling .selection-chrome and .selection-handle with system colours", () => {
    const blocks = atRuleBodies(STYLES, "@media (forced-colors: active)");
    const selection = blocks.find(
      (b) => b.includes(".selection-chrome") && b.includes(".selection-handle"),
    );
    expect(selection).toBeDefined();
    // Never rely on the violet hex alone: a system colour role must be present.
    expect(selection ?? "").toMatch(/\b(Highlight|ButtonText|CanvasText|Canvas)\b/);
  });

  it("collapses the selection emphasis transition under reduced motion / animations off", () => {
    const reduced = atRuleBodies(STYLES, "@media (prefers-reduced-motion: reduce)");
    const inMedia = reduced.some((b) => b.includes(".selection-chrome"));
    const animationsOff = /:root\[data-animations="off"\][^{]*\.selection-chrome/.test(
      stripCssComments(STYLES),
    );
    expect(inMedia || animationsOff).toBe(true);
  });
});