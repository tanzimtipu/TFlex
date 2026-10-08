// @vitest-environment node
//
// Phase 119 (TFL-1342 chunk G) - the Adaptive Shell adaptation contract guard.
//
// The shell must survive the platform accessibility paths without a restyle:
// OS forced colors, reduced motion, long / localized labels, and 200% zoom
// (no font shrink). This spec scans the stylesheet and the named sources as
// text, mirroring the source-scan style of foundationGuards.test.ts. ADDITIVE
// ONLY - it pins the shipped behaviour plus the Phase 119 forced-colors block;
// it never restyles an existing surface and never rethemes a shared token.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const STYLES_CSS = readFileSync(
  join(REPO_ROOT, "src", "renderer", "styles.css"),
  "utf8",
);
const ANIMATED_TAB = readFileSync(
  join(REPO_ROOT, "src", "renderer", "components", "AnimatedTab.tsx"),
  "utf8",
);

/** Every @media block whose header begins with `atRule`, by brace matching. */
function mediaBlocks(css: string, atRule: string): string[] {
  const bodies: string[] = [];
  let from = 0;
  for (;;) {
    const at = css.indexOf(atRule, from);
    if (at === -1) break;
    const open = css.indexOf("{", at);
    if (open === -1) break;
    let depth = 1;
    let i = open + 1;
    while (depth > 0 && i < css.length) {
      if (css[i] === "{") depth += 1;
      else if (css[i] === "}") depth -= 1;
      i += 1;
    }
    bodies.push(css.slice(open + 1, i - 1));
    from = i;
  }
  return bodies;
}

/** The declaration body of the first rule whose selector is `selector`. */
function ruleBody(css: string, selector: string): string {
  const at = css.indexOf(selector);
  if (at === -1) return "";
  const open = css.indexOf("{", at);
  if (open === -1) return "";
  let depth = 1;
  let i = open + 1;
  while (depth > 0 && i < css.length) {
    if (css[i] === "{") depth += 1;
    else if (css[i] === "}") depth -= 1;
    i += 1;
  }
  return css.slice(open + 1, i - 1);
}

const FORCED_COLORS = mediaBlocks(
  STYLES_CSS,
  "@media (forced-colors: active)",
).join("\n");
const REDUCED_MOTION = mediaBlocks(
  STYLES_CSS,
  "@media (prefers-reduced-motion: reduce)",
).join("\n");

// The shell surface families named by the brief. Each entry is the set of
// class hooks that may carry the family; the family is covered when ANY hook
// appears inside a forced-colors block.
const SHELL_FAMILIES: ReadonlyArray<readonly [string, RegExp]> = [
  ["document rail", /\.(document-rail|tab-area|tab-list)\b/],
  ["action dock", /\.action-dock\b/],
  ["inspector", /\.(inspector|inspector-collapsed-strip)\b/],
  ["context panel", /\.(context-panel|side-rail|rail-ruler)\b/],
  ["view strip", /\.view-strip\b/],
  ["app header", /\.(app-header|titlebar)\b/],
];

const SYSTEM_KEYWORDS = [
  "Highlight",
  "HighlightText",
  "Canvas",
  "CanvasText",
  "ButtonFace",
  "ButtonText",
  "GrayText",
  "Field",
  "LinkText",
] as const;

describe("Phase 119 shell adaptation contract", () => {
  it("covers every shell surface family in a forced-colors block", () => {
    for (const [family, hook] of SHELL_FAMILIES) {
      expect(FORCED_COLORS, `forced-colors coverage for the ${family}`).toMatch(
        hook,
      );
    }
  });

  it("forced-colors coverage uses the system color keyword roles", () => {
    for (const keyword of SYSTEM_KEYWORDS) {
      expect(FORCED_COLORS, `system keyword ${keyword}`).toContain(keyword);
    }
  });

  it("keeps a native focus ring under forced colors", () => {
    expect(FORCED_COLORS).toMatch(/:focus-visible[^{]*\{[^}]*Highlight/);
  });

  it("ships the OS reduced-motion catch-all", () => {
    expect(REDUCED_MOTION).toMatch(/\*\s*,/);
    expect(REDUCED_MOTION).toMatch(/transition-duration:\s*0\.01ms/);
  });

  it("ships the Animations-OFF zero-duration catch-all", () => {
    const off =
      /:root\[data-animations="off"\]\s*\*[\s\S]*?\{[\s\S]*?transition-duration:\s*0\.01ms/;
    expect(STYLES_CSS).toMatch(off);
  });

  it("ellipsizes the tab title carrier and exposes the full title", () => {
    const carrier = ruleBody(STYLES_CSS, ".tab-title-text {");
    expect(carrier).toMatch(/overflow:\s*hidden/);
    expect(carrier).toMatch(/white-space:\s*nowrap/);
    expect(carrier).toMatch(/text-overflow:\s*ellipsis/);
    expect(ANIMATED_TAB).toMatch(/title=\{title\}/);
  });

  it("never shrinks the font-size of a shell control at a narrow width", () => {
    // For every @media block, no rule whose selector targets a shell control
    // class may declare a font-size. This is the "do not shrink fonts to solve
    // overflow" contract.
    const shell =
      /\.(document-rail|action-dock|inspector|context-panel|view-strip|app-header)\b/;
    const offenders: string[] = [];
    let from = 0;
    for (;;) {
      const at = STYLES_CSS.indexOf("@media", from);
      if (at === -1) break;
      const open = STYLES_CSS.indexOf("{", at);
      if (open === -1) break;
      let depth = 1;
      let i = open + 1;
      while (depth > 0 && i < STYLES_CSS.length) {
        if (STYLES_CSS[i] === "{") depth += 1;
        else if (STYLES_CSS[i] === "}") depth -= 1;
        i += 1;
      }
      const body = STYLES_CSS.slice(open + 1, i - 1);
      const rule = /[^{}]+\{[^{}]*\}/g;
      let r: RegExpExecArray | null;
      while ((r = rule.exec(body)) !== null) {
        const sel = r[0].slice(0, r[0].indexOf("{"));
        const decls = r[0].slice(r[0].indexOf("{") + 1, r[0].lastIndexOf("}"));
        if (shell.test(sel) && /font-size\s*:/.test(decls)) {
          offenders.push(sel.trim().replace(/\s+/g, " "));
        }
      }
      from = i;
    }
    expect(offenders, "shell font-size touched inside a @media block").toEqual(
      [],
    );
  });

  it("pairs the tab modified dot with a non-color text signal", () => {
    const dotAt = ANIMATED_TAB.indexOf('"tab-modified-dot"');
    expect(dotAt, "the tab-modified-dot hook").toBeGreaterThanOrEqual(0);
    const region = ANIMATED_TAB.slice(dotAt, dotAt + 600);
    expect(region).toMatch(/visually-hidden/);
    expect(region).toContain("Unsaved changes");
  });
});