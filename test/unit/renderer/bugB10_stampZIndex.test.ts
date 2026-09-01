// @vitest-environment jsdom
//
// B10 follow-up — stamp ghost must paint above every other
// per-page layer (annotations / signatures / forms / edit).
//
// History: the original stamp-overlay CSS sat `.stamp-layer` at
// z-index 4, the same z-index as `.edit-layer`. A user with the
// stamp tool armed AND a form field on the page (the Form
// overlay is z-index 5) saw the stamp ghost rendered behind the
// form's white background — the report read as "stamp behind
// background". The form overlay's opaque backgrounds covered the
// stamp at the same place the user wanted to place it.
//
// Fix: bump `.stamp-layer` to z-index 6 (above forms at 5) AND
// update the inline `zIndex` on the rendered ghost so the two
// stay in lockstep — otherwise the ghost's own stacking context
// would still paint at 4 even though the parent is at 6.
//
// We pin both surfaces here:
//   1. The `.stamp-layer` CSS rule is at z-index 6 (above the
//      per-page layer hierarchy).
//   2. The inline `zIndex` on `.stamp-ghost` is 6, matching the
//      stylesheet.
//
// Direct CSS-eval testing in a unit environment is brittle, so
// we read the source files and assert the rules are in place.
// jsdom doesn't fully implement stacking-context paint order,
// so the only portable regression guard is the source-level
// contract.
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const stylesPath = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "renderer",
  "styles.css",
);
const stampOverlayPath = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "renderer",
  "annotations",
  "StampOverlay.tsx",
);
const stylesSource = fs.readFileSync(stylesPath, "utf8");
const stampOverlaySource = fs.readFileSync(stampOverlayPath, "utf8");

describe("B10 — stamp ghost z-index sits above every other per-page layer", () => {
  it(".stamp-layer CSS is at z-index 6 (above forms at z-index 5)", () => {
    // Find the .stamp-layer rule and assert its z-index is 6.
    const rule = stylesSource.match(/\.stamp-layer\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    if (rule === null) return;
    expect(rule[0]).toMatch(/z-index:\s*6\s*;/);
  });

  it(".stamp-layer CSS sits ABOVE .forms-layer (z-index 5)", () => {
    // The stamp must be above forms — the bug was a stamp placed
    // over a form field rendering behind the form's background.
    const stampMatch = stylesSource.match(/\.stamp-layer\s*\{[^}]*\}/);
    const formsMatch = stylesSource.match(/\.forms-layer\s*\{[\s\S]*?\n\}/);
    expect(stampMatch).not.toBeNull();
    expect(formsMatch).not.toBeNull();
    if (stampMatch === null || formsMatch === null) return;
    const stampZ = Number(/z-index:\s*(\d+)\s*;/.exec(stampMatch[0])?.[1]);
    const formsZ = Number(/z-index:\s*(\d+)\s*;/.exec(formsMatch[0])?.[1]);
    expect(stampZ).toBeGreaterThan(formsZ);
  });

  it(".stamp-layer CSS sits ABOVE .signatures-layer (z-index 3)", () => {
    const stampMatch = stylesSource.match(/\.stamp-layer\s*\{[^}]*\}/);
    const sigMatch = stylesSource.match(/\.signatures-layer\s*\{[\s\S]*?\n\}/);
    expect(stampMatch).not.toBeNull();
    expect(sigMatch).not.toBeNull();
    if (stampMatch === null || sigMatch === null) return;
    const stampZ = Number(/z-index:\s*(\d+)\s*;/.exec(stampMatch[0])?.[1]);
    const sigZ = Number(/z-index:\s*(\d+)\s*;/.exec(sigMatch[0])?.[1]);
    expect(stampZ).toBeGreaterThan(sigZ);
  });

  it(".stamp-layer CSS sits ABOVE .annotation-layer (z-index 2)", () => {
    const stampMatch = stylesSource.match(/\.stamp-layer\s*\{[^}]*\}/);
    const annMatch = stylesSource.match(/\.annotation-layer\s*\{[\s\S]*?\n\}/);
    expect(stampMatch).not.toBeNull();
    expect(annMatch).not.toBeNull();
    if (stampMatch === null || annMatch === null) return;
    const stampZ = Number(/z-index:\s*(\d+)\s*;/.exec(stampMatch[0])?.[1]);
    const annZ = Number(/z-index:\s*(\d+)\s*;/.exec(annMatch[0])?.[1]);
    expect(stampZ).toBeGreaterThan(annZ);
  });

  it(".stamp-layer CSS sits ABOVE .edit-layer (z-index 4)", () => {
    // The edit layer was the original collision — both were at
    // z-index 4, and paint order fell back to document order.
    // Bumping stamp to 6 puts it definitively above edit too.
    const stampMatch = stylesSource.match(/\.stamp-layer\s*\{[^}]*\}/);
    const editMatch = stylesSource.match(/\.edit-layer\s*\{[\s\S]*?\n\}/);
    expect(stampMatch).not.toBeNull();
    expect(editMatch).not.toBeNull();
    if (stampMatch === null || editMatch === null) return;
    const stampZ = Number(/z-index:\s*(\d+)\s*;/.exec(stampMatch[0])?.[1]);
    const editZ = Number(/z-index:\s*(\d+)\s*;/.exec(editMatch[0])?.[1]);
    expect(stampZ).toBeGreaterThan(editZ);
  });

  it("StampOverlay's inline ghost style uses zIndex: 6 (matches the CSS)", () => {
    // The .stamp-ghost's inline `zIndex` overrides its parent's
    // stacking context. Without the inline bump, the ghost would
    // paint at z-index 4 inside the layer's z-index 6 — which is
    // fine for ordering against the layer's siblings but means the
    // ghost itself sits at z-index 4 within the layer's context.
    // Setting the inline value to 6 mirrors the layer so the
    // ghost is unambiguously on top.
    const ghostStyle = stampOverlaySource.match(
      /const style: CSSProperties = \{[\s\S]*?\};/,
    );
    expect(ghostStyle).not.toBeNull();
    if (ghostStyle === null) return;
    expect(ghostStyle[0]).toMatch(/zIndex:\s*6/);
  });

  it("the stamp-layer still has pointer-events: none so clicks fall through", () => {
    // Regression guard: the previous bump would be wrong if it
    // accidentally enabled pointer events on the layer (which
    // would swallow page clicks the host needs). The layer stays
    // visual-only; placement is driven by the window-level
    // pointerdown listener.
    const rule = stylesSource.match(/\.stamp-layer\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    if (rule === null) return;
    expect(rule[0]).toMatch(/pointer-events:\s*none/);
  });
});