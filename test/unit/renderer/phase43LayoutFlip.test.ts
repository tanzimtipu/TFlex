// @vitest-environment jsdom
//
// Phase 43 (item 1, criterion 1) — the page-layout transition is TOKEN-DRIVEN.
//
// Switching one/two/four re-lays-out the page slots instantly and plays the
// same transform-only FLIP as the zoom (zoomFlip.ts) on the PAPER-OWNING
// `.page-slot`, but over the LAYOUT motion token: the CSS rule
// `.pdf-page-layout-flip` reads `--motion-duration-layout` /
// `--motion-ease-layout` (350ms), never a hardcoded value, so the global
// prefers-reduced-motion / `:root[data-animations="off"]` catch-alls collapse
// it to the reduced duration (0ms) and the JS instant path skips the class
// entirely. The page's own pixels are moved by the transform only — the rule
// carries no opacity / colour property, so PDF content is never recoloured or
// cross-faded.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  applyZoomFlip,
  clearZoomFlip,
  runZoomFlip,
  LAYOUT_FLIP_CLASS,
  ZOOM_FLIP_ANIMATION,
  ZOOM_FLIP_CLASS,
  type ZoomFlipPageEl,
  type ZoomFlipPending,
  type ZoomFlipRect,
} from "../../../src/renderer/components/zoomFlip";
import { MOTION_DURATION, MOTION_EASE } from "../../../src/renderer/hooks/motionTokens";

const STYLES = readFileSync(resolve(__dirname, "../../../src/renderer/styles.css"), "utf8");
const ANIMATIONS = readFileSync(
  resolve(__dirname, "../../../src/renderer/styles/animations.css"),
  "utf8",
);

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

function withRect(el: HTMLElement, rect: ZoomFlipRect): HTMLElement {
  Object.defineProperty(el, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      ...rect,
      right: rect.left + rect.width,
      bottom: rect.top + rect.height,
      x: rect.left,
      y: rect.top,
      toJSON: () => rect,
    }),
  });
  return el;
}

describe("Phase 43 — page-layout FLIP is token-driven", () => {
  it("the layout class animates the shared keyframe over the LAYOUT tokens", () => {
    const body = findRuleBody(STYLES, ".pdf-page-layout-flip");
    expect(body, ".pdf-page-layout-flip rule missing").not.toBeNull();
    expect(body).toContain(`animation: ${ZOOM_FLIP_ANIMATION}`);
    expect(body).toContain("var(--motion-duration-layout)");
    expect(body).toContain("var(--motion-ease-layout)");
    // No hardcoded duration / easing anywhere in the rule.
    expect(body).not.toMatch(/\d+m?s\b/);
    expect(body).not.toContain("cubic-bezier");
    // Transform-only: the page pixels are never recoloured or cross-faded.
    expect(body).not.toMatch(/opacity|background|color|filter/i);
  });

  it("the layout tokens carry the Phase-15 values (350ms / layout easing)", () => {
    expect(ANIMATIONS).toMatch(/--motion-duration-layout:\s*350ms;/);
    expect(ANIMATIONS).toMatch(
      /--motion-ease-layout:\s*cubic-bezier\(0\.4,\s*0,\s*0\.2,\s*1\);/,
    );
    // The TS mirror the hooks read is the same value.
    expect(MOTION_DURATION.layout).toBe(350);
    expect(MOTION_EASE.layout).toEqual([0.4, 0, 0.2, 1]);
  });

  it("prefers-reduced-motion collapses the layout token to the reduced duration", () => {
    // Both accessibility paths zero the duration, so the switch is immediate.
    const reduced = stripCssComments(ANIMATIONS);
    expect(reduced).toMatch(/--motion-duration-reduced:\s*0ms;/);
    const collapses = reduced.match(
      /--motion-duration-layout:\s*var\(--motion-duration-reduced\);/g,
    );
    expect(collapses, "the reduced-motion + animations-off catch-alls").not.toBeNull();
    expect(collapses?.length ?? 0).toBeGreaterThanOrEqual(2);
  });

  it("applies the LAYOUT class (not the zoom class) for a layout FLIP", () => {
    const el = withRect(document.createElement("div"), {
      left: 100,
      top: 100,
      width: 200,
      height: 200,
    });
    // The element is now half the width / shifted right — a layout move.
    withRect(el, { left: 300, top: 100, width: 100, height: 100 });
    const applied = applyZoomFlip(el, { left: 100, top: 100, width: 200, height: 200 }, "layout");
    expect(applied).toBe(true);
    expect(el.classList.contains(LAYOUT_FLIP_CLASS)).toBe(true);
    expect(el.classList.contains(ZOOM_FLIP_CLASS)).toBe(false);
    clearZoomFlip(el);
    expect(el.classList.contains(LAYOUT_FLIP_CLASS)).toBe(false);
  });

  it("the reduced-motion / instant path switches immediately with no FLIP class", () => {
    const scrollerEl = withRect(document.createElement("div"), {
      left: 0,
      top: 0,
      width: 500,
      height: 500,
    });
    const pageEl = withRect(document.createElement("div"), {
      left: 10,
      top: 10,
      width: 100,
      height: 100,
    });
    const pages: ZoomFlipPageEl[] = [{ page: 1, el: pageEl }];
    const pending: ZoomFlipPending = {
      firstRects: new Map([[1, { left: 10, top: 10, width: 200, height: 200 }]]),
      anchorPage: 1,
      anchorOffsetBefore: 0,
    };
    const scroller = {
      scrollTop: 0,
      getBoundingClientRect: (): ZoomFlipRect => ({ left: 0, top: 0, width: 500, height: 500 }),
    };
    void scrollerEl;
    const animated = runZoomFlip(scroller, pages, pending, true, "layout");
    expect(animated, "no unit animates under instant motion").toBe(0);
    expect(pageEl.classList.contains(LAYOUT_FLIP_CLASS)).toBe(false);
    expect(pageEl.classList.contains(ZOOM_FLIP_CLASS)).toBe(false);
  });
});
