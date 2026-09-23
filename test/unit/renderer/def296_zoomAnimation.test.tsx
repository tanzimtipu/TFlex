// @vitest-environment jsdom
//
// DEF-296 — page zoom had no animation: the page width jumped
// (1210 -> 1224) and every document surface computed transition-duration 0s.
//
// The fix is a one-shot transform-only FLIP on the `.pdf-page` wrapper: the
// slot re-lays-out at the NEW size (no width/height transition, so no layout
// thrashing), then the wrapper plays `tf-page-zoom-flip` back to identity.
//
// DEF-302 later upgraded WHAT the animation interpolates (a real
// translate+scale inverse about `transform-origin: 0 0` instead of a
// centre-origin scale) and moved the application to DocumentView (which owns
// the scroller, so it can preserve the scroll anchor). This file keeps the
// CSS contract + accessibility collapse pinned; the maths, the per-page
// application and the scroll anchor live in def302_zoomFlip.test.tsx.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ZOOM_FLIP_ANIMATION,
  ZOOM_FLIP_DX_VAR,
  ZOOM_FLIP_DY_VAR,
  ZOOM_FLIP_FROM_VAR,
} from "../../../src/renderer/components/zoomFlip";

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");

function stripCssComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "");
}

function findRuleBody(s: string, selector: string): string | null {
  const stripped = stripCssComments(s);
  const idx = stripped.indexOf(selector);
  if (idx === -1) return null;
  const braceOpen = stripped.indexOf("{", idx);
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

describe("DEF-296/DEF-302 — the zoom FLIP is a transform-only animation of the page wrapper", () => {
  const css = readFileSync(STYLES_PATH, "utf8");

  it("defines the one-shot zoom-flip animation on motion tokens", () => {
    const body = findRuleBody(css, ".pdf-page-zoom-flip {");
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(
      new RegExp(`${ZOOM_FLIP_ANIMATION} var\\(--motion-duration-standard\\) var\\(--motion-ease-standard\\)`),
    );
  });

  it("anchors the inverse on the top-left (transform-origin: 0 0)", () => {
    const body = findRuleBody(css, ".pdf-page-zoom-flip {");
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(/transform-origin:\s*0\s+0/);
  });

  it("the keyframe interpolates translate + scale from the start vars to identity", () => {
    const body = findRuleBody(css, "@keyframes tf-page-zoom-flip {");
    expect(body).not.toBeNull();
    const from = body ?? "";
    expect(from).toMatch(
      new RegExp(`from\\s*\\{\\s*transform:\\s*translate\\(var\\(${ZOOM_FLIP_DX_VAR}, 0px\\), var\\(${ZOOM_FLIP_DY_VAR}, 0px\\)\\)`),
    );
    expect(from).toMatch(
      new RegExp(`scale\\(var\\(${ZOOM_FLIP_FROM_VAR}, 1\\)\\)`),
    );
    expect(from).toMatch(/to\s*\{\s*transform:\s*translate\(0px, 0px\)\s*scale\(1, 1\)/);
    // Width/height are never animated (no layout thrash).
    expect(from).not.toMatch(/(width|height|left|top)\s*:/);
  });

  it("both accessibility paths collapse it (reduced motion + Animations off)", () => {
    const clean = stripCssComments(css);
    expect(clean).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]{0,120}animation-duration:\s*0\.01ms !important/);
    expect(clean).toMatch(/:root\[data-animations="off"\] \*[\s\S]{0,160}animation-duration:\s*0\.01ms !important/);
    // No rule re-enables a duration for the flip class.
    expect(clean).not.toMatch(/\.pdf-page-zoom-flip[^{]*\{[^}]*animation-duration/);
  });
});
