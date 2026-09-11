// @vitest-environment node
//
// DEF-189 — the theme dropdown's options rendered UNDER the Tools
// palette card.
//
// Root cause: `.titlebar` (the caption strip that hosts the AppHeader
// and its theme dropdown) is `position: relative` and sat at
// z-index: 2, while `.tools-palette` — an absolutely positioned
// sibling inside `.app-main` — sits at z-index: 30. The theme
// popover's own z-index (60) lives INSIDE the strip's stacking
// context, so it could never paint above the palette. Phase 14
// widened the palette from 280px to 344px, moving its card over the
// dropdown's "Light" option.
//
// Fix: lift `.titlebar` above the palette. The ladder this test pins
// (all surfaces share the root stacking context):
//
//   .titlebar            40   <- lifted (was 2)
//   .tools-palette       30   (unchanged; bug013 test pins >= 20)
//   .color-popover       50   (fixed, portaled to body — DEF-175)
//   .sheet-backdrop     100
//   .modal-backdrop     800
//   .toast-stack       1000
//
// The strip must stay BELOW the fixed dialogs so a modal still dims
// it (DEF-169 rhythm), and the palette's z-index stays untouched so
// bug013's contract keeps holding.
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

/** Extract the body of the FIRST rule whose selector matches exactly
 *  `selector` followed by `{` (not a `-suffix` selector). */
function findRuleBody(src: string, selector: string): string | null {
  const stripped = stripCssComments(src);
  const re = new RegExp(
    `(?:^|[\\n,])\\s*${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`,
  );
  const m = re.exec(stripped);
  if (m === null) return null;
  const braceOpen = stripped.indexOf("{", m.index);
  let depth = 0;
  for (let i = braceOpen; i < stripped.length; i += 1) {
    if (stripped[i] === "{") depth += 1;
    else if (stripped[i] === "}") {
      depth -= 1;
      if (depth === 0) return stripped.slice(braceOpen + 1, i);
    }
  }
  return null;
}

function zOf(body: string | null): number {
  if (body === null) return Number.NaN;
  const m = body.match(/z-index:\s*(-?\d+)/);
  return m === null ? Number.NaN : Number(m[1]);
}

describe("DEF-189 — the caption strip paints above the Tools palette", () => {
  const css = readStyles();

  it(".titlebar carries a numeric z-index (positioned stacking context)", () => {
    const body = findRuleBody(css, ".titlebar");
    expect(body, "the .titlebar rule exists").not.toBeNull();
    expect(Number.isNaN(zOf(body))).toBe(false);
  });

  it(".titlebar z-index is ABOVE .tools-palette z-index", () => {
    const titlebar = zOf(findRuleBody(css, ".titlebar"));
    const palette = zOf(findRuleBody(css, ".tools-palette"));
    expect(Number.isNaN(titlebar)).toBe(false);
    expect(Number.isNaN(palette)).toBe(false);
    // The defect: the strip (2) sat under the palette (30), capping
    // the theme popover's own z-index 60 inside it.
    expect(titlebar).toBeGreaterThan(palette);
  });

  it(".tools-palette z-index is unchanged (still >= 20, below sheets)", () => {
    // bug013 pins the palette band; re-assert here so lifting the
    // titlebar is never "fixed" by demoting the palette under the
    // workspace overlays.
    const body = findRuleBody(css, ".tools-palette");
    const palette = zOf(body);
    expect(palette).toBeGreaterThanOrEqual(20);
    expect(palette).toBeLessThan(100);
  });

  it(".titlebar stays BELOW every fixed dialog / popover surface", () => {
    // The strip must never cover the color popover (DEF-175 portal)
    // or the dialog backdrops (DEF-169: a modal dims the palette AND
    // the caption strip).
    const titlebar = zOf(findRuleBody(css, ".titlebar"));
    for (const selector of [
      ".color-popover",
      ".sheet-backdrop",
      ".modal-backdrop",
      ".toast-stack",
    ]) {
      const z = zOf(findRuleBody(css, selector));
      expect(Number.isNaN(z), `${selector} carries a z-index`).toBe(false);
      expect(titlebar, `.titlebar stays below ${selector}`).toBeLessThan(z);
    }
  });

  it(".theme-toggle-popover keeps its own z-index inside the strip", () => {
    // The popover's z-index orders it WITHIN the strip's context
    // (above the strip's other content). Lifting the strip is what
    // carries it past the palette — the popover rule itself must not
    // have been flattened.
    const body = findRuleBody(css, ".theme-toggle-popover");
    expect(body, "the .theme-toggle-popover rule exists").not.toBeNull();
    expect(zOf(body)).toBeGreaterThanOrEqual(1);
  });
});
