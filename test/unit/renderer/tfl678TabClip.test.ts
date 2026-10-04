// @vitest-environment node
// TFL-678 — a squeezed tab must clip its OWN content to its own box.
//
// Root cause: the Phase 72 uniform fit width may drop below a tab's
// min-content (5px title floor + 8px gap + the 18px close + padding). The
// close button then spills past the tab's right edge. Because every `.tab` is
// `position: relative` and the `.tab-list-new` "<li>" that carries the "+" is
// static, the spill painted and hit-tested ABOVE the "+". At the 640px minimum
// with ~11-14 tabs, `elementFromPoint` at the "+" centre returned `.tab-close`
// and a raw click on "+" closed the active tab (ADV-197).
//
// Fix: the base `.tab` rule declares `overflow: hidden`, so a tab can never
// paint or hit-test outside its own box. The "+" (and every neighbouring tab)
// keeps its own click target at any width.
//
// jsdom has no layout engine, so this is a static CSS guard (the same pattern
// as bug001_tabNewHeight.test.tsx): the stylesheet is the source of truth.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");

function readStyles(): string {
  return readFileSync(STYLES_PATH, "utf8");
}

/** Body of a top-level rule whose selector is exactly `selector {`, or null. */
function ruleBody(src: string, selector: string): string | null {
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const needle = `${selector}\\s*\\{`;
  const re = new RegExp(needle, "g");
  const m = re.exec(stripped);
  if (m === null) return null;
  const braceOpen = stripped.indexOf("{", m.index);
  if (braceOpen === -1) return null;
  let depth = 0;
  for (let i = braceOpen; i < stripped.length; i += 1) {
    const ch = stripped[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return stripped.slice(braceOpen + 1, i);
    }
  }
  return null;
}

describe("TFL-678 — a squeezed tab clips its own content", () => {
  const src = readStyles();

  it("the base `.tab` rule declares `overflow: hidden` (the containment contract)", () => {
    const body = ruleBody(src, "\\.tab");
    expect(body, "base `.tab` rule is present").not.toBeNull();
    expect(body).toMatch(/overflow:\s*hidden/);
  });

  it("no `.tab` rule re-opens the clip (`overflow: visible` / `clip`)", () => {
    // The colorful override (`.tab-area[data-tab-style="colorful"] .tab {`) and
    // the base rule must both keep the clip. A `visible`/`clip` override would
    // re-introduce the ADV-197 spill.
    const colorful = ruleBody(src, '\\.tab-area\\[data-tab-style="colorful"\\]\\s*\\.tab');
    expect(colorful, "colorful `.tab` override is present").not.toBeNull();
    expect(colorful).not.toMatch(/overflow:\s*(visible|clip)/);
  });

  it("the close control stays pinned to the tab's trailing edge", () => {
    // The clip is the last line of defence; the Phase 72 (item 4) pin contract
    // still owns the resting look and must not be removed to hide the spill.
    const close = ruleBody(src, '\\.tab-area\\[data-tab-style="colorful"\\]\\s*\\.tab-close');
    expect(close).not.toBeNull();
    expect(close).toMatch(/margin-left:\s*auto/);
  });

  it("documents the occlusion reason in the rule (lock against silent removal)", () => {
    expect(src).toMatch(/\.tab\s*\{[\s\S]*?TFL-678/);
  });
});
