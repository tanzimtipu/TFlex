// @vitest-environment jsdom
// Phase 73 (chunk A) + TFL-248 (DEF-462) — the dirty-dot geometry oracle.
// jsdom has no layout, so the sheet text is asserted directly (the same
// readFileSync pattern as the adjacent Phase 58 / 68 oracles): the dot's own
// box is 5px with its 1.5px ring painted INSIDE that box (border under
// box-sizing: border-box), and TFL-248 takes the dot OUT of the title's
// overflow clip: only the inner `.tab-title-text` span ellipsizes, so the
// title's `overflow` can never eat the dot at the squeezed fit width.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SHEET = readFileSync("src/renderer/styles.css", "utf8");

/** Slice a selector's declaration block out of the sheet. */
function blockFor(selector: string): string {
  const at = SHEET.indexOf(selector);
  expect(at, `selector ${selector} exists`).toBeGreaterThan(-1);
  return SHEET.slice(at, SHEET.indexOf("}", at));
}

describe("Phase 73 A — .tab-modified-dot is smaller and contains its ring", () => {
  const block = blockFor(".tab-modified-dot {");

  it("shrinks the dot's own box to <= 6px (5px)", () => {
    expect(block).toContain("width: 5px");
    expect(block).toContain("height: 5px");
    expect(block).not.toContain("width: 7px");
    expect(block).not.toContain("height: 7px");
  });

  it("uses box-sizing: border-box so the border is part of that box", () => {
    expect(block).toContain("box-sizing: border-box");
  });

  it("draws the 1.5px ring as a contained border, not an outset box-shadow", () => {
    expect(block).toContain("border: 1.5px solid var(--tf-tab-accent, var(--sem-neutral))");
    expect(block).not.toContain("box-shadow: 0 0 0 1.5px");
  });

  it("keeps the standard ink fill", () => {
    expect(block).toContain("background: var(--tf-tab-ink)");
  });
});

describe("Phase 73 A — ring overrides stay contained (border-color, no shadow)", () => {
  it("the active standard dot recolours the border only", () => {
    const block = blockFor(".tab-active .tab-modified-dot {");
    expect(block).toContain("border-color: var(--tf-tab-accent, var(--sem-neutral))");
    expect(block).not.toContain("box-shadow");
  });

  it("the inactive standard dot clears the border only", () => {
    const block = blockFor(".tab:not(.tab-active) .tab-modified-dot {");
    expect(block).toContain("border-color: transparent");
    expect(block).not.toContain("box-shadow");
  });
});

describe("Phase 73 A + TFL-248 — the dot is taken out of the title's clip", () => {
  it("the base .tab-title ellipsis clip is untouched (standard tabs)", () => {
    const block = blockFor(".tab-title {");
    expect(block).toContain("overflow: hidden");
    expect(block).toContain("text-overflow: ellipsis");
  });

  it("the inner .tab-title-text span carries the ellipsis clip", () => {
    const block = blockFor(".tab-title-text {");
    expect(block).toContain("overflow: hidden");
    expect(block).toContain("text-overflow: ellipsis");
    expect(block).toContain("white-space: nowrap");
    expect(block).toContain("min-width: 0");
  });

  it("the colorful .tab-title no longer clips, so the leading dot is never cut", () => {
    const block = blockFor('.tab-area[data-tab-style="colorful"] .tab-title {');
    expect(block).toContain("overflow: visible");
    expect(block).not.toContain("padding-left: 1px");
  });

  it("the colorful .tab caps its leading padding so the 5px dot fits the tab box", () => {
    const block = blockFor('.tab-area[data-tab-style="colorful"] .tab {');
    expect(block).toContain("calc(var(--tf-tab-width, 180px) - 5px)");
  });
});
