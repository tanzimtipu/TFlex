// @vitest-environment node
// TFL-684 — the "+ new tab" control keeps its own hit target at 640px.
//
// Root cause (ADV-197, observed out of scope by the TFL-524 / TFL-677 diff
// pass): at the 640px minimum with 11-14 tabs the squeezed active tab's
// `.tab-close` (`margin-left: auto`, 18px) spilled past the tab's own 6-8px
// box. Every `.tab` is `position: relative`; the `.tab-list-new` `<li>` that
// carries the "+" was static, so the positioned close painted and hit-tested
// ABOVE it. `elementFromPoint` at the "+" centre returned `.tab-close`, and a
// raw click CLOSED the active document tab (n=11 11->10, n=14 14->13) instead
// of opening a new one.
//
// Fix: `.tab-list-new` is promoted to `position: relative; z-index: 3`, above
// the active tab (`z-index: 2`) and below the dragged tab (`z-index: 60`), so
// the "+" centre is its own hit target at any width. The `.tab` base rule also
// clips its own content (the shared TFL-678 containment contract), so a
// neighbour can never paint outside its own box.
//
// jsdom has no layout engine, so this is a static CSS guard (same pattern as
// tfl678TabClip.test.ts): the stylesheet is the source of truth.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");

function readStyles(): string {
  return readFileSync(STYLES_PATH, "utf8");
}

/** True when `idx` is the first non-whitespace token on its line, so a
 *  selector is not part of a longer compound / descendant selector. The tab
 *  strip now carries scoped variants (`.tab-area[data-tab-style="chrome"]
 *  .tab-list-new`) whose rule sits EARLIER in the sheet than the base rule; an
 *  unanchored match would resolve the scoped variant instead. */
function startsLine(src: string, idx: number): boolean {
  for (let i = idx - 1; i >= 0; i -= 1) {
    const ch = src[i];
    if (ch === "\n") return true;
    if (!/\s/.test(ch ?? "")) return false;
  }
  return true;
}

/** Body of a top-level rule whose selector matches `selector {`, or null. */
function ruleBody(src: string, selector: string): string | null {
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "");
  const re = new RegExp(`${selector}\\s*\\{`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    if (!startsLine(stripped, m.index)) continue;
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
  return null;
}

/** Numeric value of a `prop:` declaration in a rule body, or null. */
function declNumber(body: string | null, prop: string): number | null {
  if (body === null) return null;
  const m = body.match(new RegExp(`${prop}:\\s*(-?\\d+)`));
  return m === null ? null : Number(m[1]);
}

describe("TFL-684 — the + new-tab control owns its hit target", () => {
  const src = readStyles();

  it("`.tab-list-new` is positioned with a stacking level above the active tab", () => {
    const plus = ruleBody(src, "\\.tab-list-new");
    expect(plus, "`.tab-list-new` rule is present").not.toBeNull();
    expect(plus).toMatch(/position:\s*(relative|absolute)/);

    const plusZ = declNumber(plus, "z-index");
    const activeZ = declNumber(ruleBody(src, "\\.tab-active"), "z-index");
    expect(plusZ, "`.tab-list-new` declares a numeric z-index").not.toBeNull();
    expect(activeZ, "`.tab-active` declares its z-index").not.toBeNull();
    expect(plusZ as number).toBeGreaterThan(activeZ as number);
  });

  it("the dragged tab still leads the + so reorder stays visible", () => {
    const plusZ = declNumber(ruleBody(src, "\\.tab-list-new"), "z-index");
    const drag = ruleBody(
      src,
      '\\.tab-list\\s*>\\s*li\\[data-tab-dragging="true"\\]'
    );
    const dragZ = declNumber(drag, "z-index");
    expect(dragZ, "the dragged-tab li declares its z-index").not.toBeNull();
    expect(plusZ, "`.tab-list-new` declares its z-index").not.toBeNull();
    expect(dragZ as number).toBeGreaterThan(plusZ as number);
  });

  it("the base `.tab` still clips its own content (containment lock)", () => {
    const tab = ruleBody(src, "\\.tab");
    expect(tab, "base `.tab` rule is present").not.toBeNull();
    expect(tab).toMatch(/overflow:\s*hidden/);
  });

  it("documents the TFL-684 reason in the rule (lock against silent removal)", () => {
    expect(src).toMatch(/\.tab-list-new\s*\{[\s\S]*?TFL-684/);
  });
});
