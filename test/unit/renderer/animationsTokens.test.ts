// Cross-theme animation system — token layer contract tests.
//
// animations.css is the single source of truth for every motion value in
// the app; motionTokens.ts is its TS mirror for the motion/react hooks.
// These tests pin:
//   1. every required token exists with the canonical value,
//   2. the TS mirror matches the CSS (no drift),
//   3. the reduced-motion media query collapses every duration,
//   4. the theme-crossfade machinery keys on .tf-theme-transitioning,
//      transitions only colour-ish properties, and pins the PDF page
//      surfaces out of the crossfade (white pages stay white),
//   5. styles.css actually imports the token layer.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const ANIMATIONS_CSS = readFileSync(
  join(REPO_ROOT, "src", "renderer", "styles", "animations.css"),
  "utf8",
);
const STYLES_CSS = readFileSync(
  join(REPO_ROOT, "src", "renderer", "styles.css"),
  "utf8",
);

/** Extract the body of a top-level CSS block by brace matching. */
function cssBlock(css: string, startMarker: string): string {
  const start = css.indexOf(startMarker);
  if (start === -1) return "";
  const open = css.indexOf("{", start);
  let depth = 1;
  let i = open + 1;
  while (depth > 0 && i < css.length) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") depth -= 1;
    i += 1;
  }
  return css.slice(open + 1, i - 1);
}

const rootBody = cssBlock(ANIMATIONS_CSS, "\n:root {");
const root = new Map<string, string>(
  [...rootBody.matchAll(/--([a-z-]+):\s*([^;]+);/g)].map(
    (m) => [`--${m[1]}`, m[2].trim()] as const,
  ),
);

describe("animations.css token layer", () => {
  it("defines every canonical duration token with the spec value", () => {
    expect(root.get("--motion-duration-micro")).toBe("150ms");
    expect(root.get("--motion-duration-fast")).toBe("200ms");
    expect(root.get("--motion-duration-standard")).toBe("250ms");
    expect(root.get("--motion-duration-panel")).toBe("280ms");
    expect(root.get("--motion-duration-layout")).toBe("350ms");
    expect(root.get("--motion-duration-reduced")).toBe("0ms");
  });

  it("defines every canonical easing token", () => {
    expect(root.get("--motion-ease-standard")).toBe("cubic-bezier(0.4, 0, 0.2, 1)");
    expect(root.get("--motion-ease-enter")).toBe("cubic-bezier(0, 0, 0.2, 1)");
    expect(root.get("--motion-ease-exit")).toBe("cubic-bezier(0.4, 0, 1, 1)");
    expect(root.get("--motion-ease-layout")).toBe("cubic-bezier(0.4, 0, 0.2, 1)");
  });

  it("defines the canonical scale + translate + opacity tokens", () => {
    expect(root.get("--motion-scale-press")).toBe("0.97");
    expect(root.get("--motion-scale-enter")).toBe("0.95");
    expect(root.get("--motion-scale-exit")).toBe("0.98");
    expect(root.get("--motion-translate-micro")).toBe("2px");
    expect(root.get("--motion-translate-small")).toBe("4px");
    expect(root.get("--motion-translate-panel")).toBe("24px");
    expect(root.get("--motion-opacity-hidden")).toBe("0");
    expect(root.get("--motion-opacity-visible")).toBe("1");
  });

  it("defines the theme crossfade duration + elevation tokens", () => {
    expect(root.get("--motion-theme-crossfade")).toBe("400ms");
    expect(root.get("--motion-elevation-hover")).toContain("var(--motion-elevation-color)");
    expect(root.get("--motion-elevation-active")).toContain("var(--motion-elevation-color)");
  });

  it("collapses every duration under prefers-reduced-motion", () => {
    const mediaStart = ANIMATIONS_CSS.indexOf("@media (prefers-reduced-motion: reduce)");
    expect(mediaStart).toBeGreaterThan(-1);
    const media = ANIMATIONS_CSS.slice(mediaStart, ANIMATIONS_CSS.indexOf("}", ANIMATIONS_CSS.indexOf("--motion-duration-layout", mediaStart)));
    expect(media).toContain("--motion-duration-micro: var(--motion-duration-reduced)");
    expect(media).toContain("--motion-duration-fast: var(--motion-duration-reduced)");
    expect(media).toContain("--motion-duration-standard: var(--motion-duration-reduced)");
    expect(media).toContain("--motion-duration-panel: var(--motion-duration-reduced)");
    expect(media).toContain("--motion-duration-layout: var(--motion-duration-reduced)");
    expect(media).toContain("--motion-theme-crossfade: var(--motion-duration-reduced)");
  });

  it("disables movement utilities under reduced motion but keeps them mounted", () => {
    const mediaStart = ANIMATIONS_CSS.indexOf("@media (prefers-reduced-motion: reduce)");
    const media = ANIMATIONS_CSS.slice(mediaStart, mediaStart + 2000);
    expect(media).toContain(".anim-bloom-in");
    expect(media).toContain("transform: none !important");
  });

  it("is imported by styles.css before any style rules", () => {
    const importLine = STYLES_CSS.indexOf('@import "./styles/animations.css"');
    expect(importLine).toBeGreaterThan(-1);
    // Before the first rule block (the :root type scale).
    expect(importLine).toBeLessThan(STYLES_CSS.indexOf(":root {"));
  });
});

describe("theme crossfade machinery", () => {
  it("keys the crossfade on the transitioning class on <html>", () => {
    expect(ANIMATIONS_CSS).toContain("html.tf-theme-transitioning");
  });

  it("transitions only colour-ish properties (never layout, never transform)", () => {
    const start = ANIMATIONS_CSS.indexOf("html.tf-theme-transitioning body *:not(.pdf-page)");
    expect(start).toBeGreaterThan(-1);
    const rule = ANIMATIONS_CSS.slice(start, ANIMATIONS_CSS.indexOf("}", start));
    // DEF-195: the crossfade carries SIX colour properties — outline/
    // text-decoration/caret were dropped (invisible at the 400ms scale)
    // to cut the per-element transition cost of the body-wide rule.
    for (const prop of [
      "background-color",
      "color",
      "border-color",
      "box-shadow",
      "fill",
      "stroke",
    ]) {
      expect(rule).toContain(prop);
    }
    for (const banned of [
      "width", "height", "margin", "padding", "transform", "opacity", "top", "left",
      "outline-color", "text-decoration-color", "caret-color",
    ]) {
      // Each banned property must not appear as a transitioned property
      // (a bare word inside a property name like border-color is fine).
      expect(rule).not.toMatch(new RegExp(`(^|[\\s,])${banned}\\s`));
    }
  });

  it("provides the View Transitions crossfade path over the same token (DEF-195)", () => {
    expect(ANIMATIONS_CSS).toContain("::view-transition-old(root)");
    expect(ANIMATIONS_CSS).toContain("::view-transition-new(root)");
    const start = ANIMATIONS_CSS.indexOf("::view-transition-old(root)");
    const rule = ANIMATIONS_CSS.slice(start, ANIMATIONS_CSS.indexOf("}", start));
    expect(rule).toContain("animation-duration: var(--motion-theme-crossfade)");
    expect(rule).toContain("animation-timing-function: var(--motion-ease-standard)");
  });

  it("pins the PDF page surfaces out of the crossfade", () => {
    const start = ANIMATIONS_CSS.indexOf("html.tf-theme-transitioning .pdf-page");
    expect(start).toBeGreaterThan(-1);
    const rule = ANIMATIONS_CSS.slice(start, ANIMATIONS_CSS.indexOf("}", start));
    expect(rule).toContain(".pdf-page-canvas");
    expect(rule).toContain(".page-placeholder");
    expect(rule).toContain("transition: none !important");
    expect(rule).toContain("filter: none !important");
  });
});

describe("motionTokens.ts mirror", () => {
  it("mirrors the CSS durations exactly", async () => {
    const { MOTION_DURATION, MOTION_THEME_CROSSFADE } = await import(
      "../../../src/renderer/hooks/motionTokens"
    );
    expect(MOTION_DURATION.micro).toBe(150);
    expect(MOTION_DURATION.fast).toBe(200);
    expect(MOTION_DURATION.standard).toBe(250);
    expect(MOTION_DURATION.panel).toBe(280);
    expect(MOTION_DURATION.layout).toBe(350);
    expect(MOTION_DURATION.reduced).toBe(0);
    expect(MOTION_THEME_CROSSFADE).toBe(400);
  });

  it("mirrors the CSS easings, scales, translates and opacities exactly", async () => {
    const { MOTION_EASE, MOTION_SCALE, MOTION_TRANSLATE, MOTION_OPACITY } = await import(
      "../../../src/renderer/hooks/motionTokens"
    );
    const bez = (v: readonly number[]): string =>
      `cubic-bezier(${v.join(", ")})`;
    const token = (name: string): string => {
      const value = root.get(name);
      expect(value, `token ${name} missing from :root`).toBeDefined();
      return value as string;
    };
    expect(bez(MOTION_EASE.standard)).toBe(token("--motion-ease-standard"));
    expect(bez(MOTION_EASE.enter)).toBe(token("--motion-ease-enter"));
    expect(bez(MOTION_EASE.exit)).toBe(token("--motion-ease-exit"));
    expect(bez(MOTION_EASE.layout)).toBe(token("--motion-ease-layout"));
    expect(MOTION_SCALE.press).toBe(Number(token("--motion-scale-press")));
    expect(MOTION_SCALE.enter).toBe(Number(token("--motion-scale-enter")));
    expect(MOTION_SCALE.exit).toBe(Number(token("--motion-scale-exit")));
    expect(MOTION_TRANSLATE.micro).toBe(Number(token("--motion-translate-micro").replace("px", "")));
    expect(MOTION_TRANSLATE.small).toBe(Number(token("--motion-translate-small").replace("px", "")));
    expect(MOTION_TRANSLATE.panel).toBe(Number(token("--motion-translate-panel").replace("px", "")));
    expect(MOTION_OPACITY.hidden).toBe(Number(token("--motion-opacity-hidden")));
    expect(MOTION_OPACITY.visible).toBe(Number(token("--motion-opacity-visible")));
  });
});

describe("named animation utilities", () => {
  it("maps each catalog animation to a token-only class", () => {
    const utilities: Array<[string, string | null]> = [
      [".anim-bloom-in", "tf-anim-bloom-in"],
      [".anim-bloom-out", "tf-anim-bloom-out"],
      [".anim-pop-in", "tf-anim-pop-in"],
      [".anim-pop-out", "tf-anim-pop-out"],
      [".anim-drop-in", "tf-anim-drop-in"],
      [".anim-slide-in-left", "tf-anim-slide-in-left"],
      [".anim-slide-out-left", "tf-anim-slide-out-left"],
      [".anim-slide-in-right", "tf-anim-slide-in-right"],
      [".anim-slide-out-right", "tf-anim-slide-out-right"],
      [".anim-bar-reveal", "tf-anim-bar-reveal"],
      [".anim-tab-in", "tf-anim-tab-in"],
      // Tab Dissolve reverses the tab-in keyframe (animation-direction:
      // reverse) so the strip keeps ONE opacity keyframe.
      [".anim-tab-out", "tf-anim-tab-in"],
      [".anim-materialize", "tf-anim-materialize"],
      [".anim-dissolve", "tf-anim-dissolve"],
      // Lift/press are transition-based utilities (no keyframes).
      [".anim-lift", null],
      [".anim-press", null],
    ];
    for (const [cls, keyframe] of utilities) {
      expect(ANIMATIONS_CSS, `missing class ${cls}`).toContain(cls);
      if (keyframe !== null) {
        expect(ANIMATIONS_CSS, `missing keyframe ${keyframe}`).toContain(`@keyframes ${keyframe}`);
      }
    }
  });

  it("keeps the canonical press scale on the command-bar tool buttons", () => {
    expect(ANIMATIONS_CSS).toContain(".tool-btn:active:not([disabled])");
    expect(ANIMATIONS_CSS).toMatch(
      /\.tool-btn:active:not\(\[disabled\]\)\s*\{\s*transform:\s*scale\(var\(--motion-scale-press\)\);/,
    );
  });

  it("resolves every press state to the token — no literal press scale survives (DEF-196)", () => {
    // The shared press group in styles.css loads AFTER animations.css,
    // so a literal there would win the cascade and leave the token rule
    // dead. Both layers must read --motion-scale-press.
    expect(STYLES_CSS).not.toContain("scale(0.982)");
    expect(STYLES_CSS).toContain(
      "transform: translateY(1px) scale(var(--motion-scale-press));",
    );
  });

  it("provides hardware-acceleration hint classes", () => {
    expect(ANIMATIONS_CSS).toContain(".tf-will-transform { will-change: transform; }");
    expect(ANIMATIONS_CSS).toContain(".tf-will-opacity   { will-change: opacity; }");
  });
});