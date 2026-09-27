// Phase 43 (item 1, criterion 3) — the animation-completeness GUARD.
//
// Every interactive surface must animate through the CENTRALISED motion
// system: `styles/animations.css` tokens + `hooks/motionTokens.ts`, with no
// hardcoded duration/easing in an animated rule. This test parses
// `styles.css`, walks every NON-reduced-motion / NON-Animations-off rule for
// the audited interactive selectors and asserts:
//
//   1. every `transition` / `animation` declaration is TOKEN-BASED — it
//      carries at least one `var(--...)` timing value and, after the var()
//      references (and their fallbacks) are removed, no bare `<n>ms` / `<n>s`
//      duration or raw `cubic-bezier(...)` easing survives;
//   2. the Phase 43 fixes exist with the named token per element (so a future
//      edit that strips the token fails here);
//   3. the reduced-motion block drops the phase's hover-lift / press-scale
//      transforms (transform/opacity-only rule + accessibility fallback).
//
// The var()-fallback carve-out is deliberate: the legacy chrome already
// carries `var(--token, <fallback>)` pairs and migration off them is out of
// scope; the guard's contract is "every animated value RESOLVES from a
// token", not "no fallback literal exists anywhere in the sheet".

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const STYLES = readFileSync(
  join(REPO_ROOT, "src", "renderer", "styles.css"),
  "utf8",
);

interface CssRule {
  selector: string;
  body: string;
  /** The at-rule preludes this rule is nested inside, outermost first. */
  at: string[];
}

function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Minimal CSS rule walker: returns every style rule with its selector, its
 *  body and the stack of at-rule preludes it lives inside. Keyframe steps
 *  (`from` / `to` / `%`) come back as rules too and are ignored by the scan. */
export function parseCssRules(css: string): CssRule[] {
  const src = stripComments(css);
  const rules: CssRule[] = [];
  const atStack: string[] = [];
  let buf = "";
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "{") {
      const prelude = buf.trim();
      buf = "";
      if (prelude.startsWith("@")) {
        atStack.push(prelude);
        i += 1;
        continue;
      }
      const start = i + 1;
      let depth = 1;
      let j = start;
      while (j < src.length && depth > 0) {
        if (src[j] === "{") depth += 1;
        else if (src[j] === "}") depth -= 1;
        j += 1;
      }
      rules.push({
        selector: prelude,
        body: src.slice(start, j - 1),
        at: [...atStack],
      });
      i = j;
      continue;
    }
    if (ch === "}") {
      atStack.pop();
      buf = "";
      i += 1;
      continue;
    }
    buf += ch;
    i += 1;
  }
  return rules;
}

/** A rule is "live" when it is not inside a reduced-motion or
 *  Animations-off override block (those deliberately set `none` / 0.01ms). */
function isLive(rule: CssRule): boolean {
  return !rule.at.some(
    (a) => a.includes("prefers-reduced-motion") || a.includes("data-animations"),
  );
}

function declarations(body: string): string[] {
  return body
    .split(";")
    .map((d) => d.trim())
    .filter((d) => d.length > 0);
}

/** Timing declarations only. */
function timingDeclarations(rule: CssRule): string[] {
  return declarations(rule.body).filter((d) =>
    /^(transition|animation)(-duration|-delay|-timing-function|-property)?\s*:/.test(d),
  );
}

/** Strip every `var(...)` reference (including its fallback) so only the
 *  non-token remainder is scanned for literals. */
function withoutVars(value: string): string {
  let out = "";
  let i = 0;
  while (i < value.length) {
    if (value.startsWith("var(", i)) {
      let depth = 1;
      i += 4;
      while (i < value.length && depth > 0) {
        if (value[i] === "(") depth += 1;
        else if (value[i] === ")") depth -= 1;
        i += 1;
      }
      out += " ";
      continue;
    }
    out += value[i];
    i += 1;
  }
  return out;
}

const DURATION_LITERAL = /\d+(\.\d+)?m?s\b/;
const EASING_LITERAL = /cubic-bezier\(/;

/** The audited interactive surfaces from the Phase 43 animation audit. Rules
 *  whose selector starts with any of these tokens are scanned. `::after`
 *  selectors are excluded: the frosted reflection sheen
 *  (.toolbar/.search-bar/.side-rail/.tools-palette::after) is a THEME visual
 *  channel with its own long-period ambient animation, deliberately outside
 *  the interaction token catalogue (the one documented static/animation
 *  exemption). */
const AUDITED_SELECTORS: readonly string[] = [
  ".action-dock",
  ".action-dock-verb",
  ".action-dock-arrow",
  ".action-dock-menu",
  ".action-dock-menu-item",
  ".context-menu",
  ".canvas-pill",
  ".canvas-page-layout",
  ".inspector-section",
  ".inspector-divider",
  ".inspector-collapse-toggle",
  ".inspector-close",
  ".context-panel-section",
  ".context-panel-section-toggle",
  ".context-panel-outline-body",
  ".stage-rail-btn",
  ".stage-rail-btn-active",
  ".side-rail",
  ".thumb",
  ".annotation-flyout",
  ".annotation-flyout-arrow",
  ".toast",
  ".search-bar",
  ".ocr-suspects-panel",
  ".ocr-suspects-entry-btn",
  ".update-indicator",
  ".update-prompt-body",
  ".update-prompt-progress-bar",
  ".tab",
  // Phase 45 (item 3) — the Multi Mode activation FLIP. The band is armed by
  // the stage's `data-mode-anim` attribute; listing the stage selector here
  // means a future hardcoded duration/easing on the pane FLIP fails the audit.
  ".tab-stage[data-mode-anim]",
  ".command-palette",
  ".command-palette-row",
  ".command-palette-pin-toggle",
  ".command-palette-pin-glyph",
  ".tool-btn",
  ".btn",
  ".print-check",
  ".print-radio-group",
  ".ann-flash",
  // Phase 44 — the accounts surface: the header entry point and the dialog's
  // `.accounts-*` rules. Added so a future hardcoded `transition:` in any of
  // these rules fails the audited scan (the app-wide sweep only covers
  // `animation:` shorthands). The current rules resolve from `--motion-*` /
  // `--motion-duration-*` tokens.
  ".header-accounts",
  ".accounts-status",
  ".accounts-unconfigured",
  ".accounts-unconfigured-title",
  ".accounts-unconfigured-text",
  ".accounts-notice",
  ".accounts-mode",
  ".accounts-mode-tab",
  ".accounts-mode-tab-active",
  ".accounts-field",
  ".accounts-label",
  ".accounts-input",
  ".accounts-banner",
  ".accounts-banner-error",
  ".accounts-banner-info",
  ".accounts-submit",
  ".accounts-google",
  ".accounts-otp-lead",
  ".accounts-otp-actions",
  ".accounts-link",
  ".accounts-identity",
  ".accounts-identity-label",
  ".accounts-identity-email",
  ".accounts-sync",
  ".accounts-sync-now",
  ".accounts-sync-status",
  ".accounts-sync-label",
  ".accounts-sync-detail",
  ".accounts-sync-positive",
  ".accounts-sync-warning",
  ".accounts-sync-error",
  ".accounts-actions",
  ".accounts-signout",
];

function selectorMatches(selector: string, token: string): boolean {
  // Selector lists (comma-separated) are split so `.a:hover, .b` matches both.
  return selector
    .split(",")
    .map((s) => s.trim())
    .some((s) => s === token || s.startsWith(`${token}:`) || s.startsWith(`${token}[`) || s.startsWith(`${token} `) || s.startsWith(`${token}.`));
}

const allRules = parseCssRules(STYLES);

/**
 * The app-wide `animation:` sweep (below) exempts only rules whose rhythm is
 * deliberately independent of the interaction motion catalogue:
 *   - the documented LOADING spinners, which must keep spinning even when the
 *     motion system is collapsed (progress feedback is colour/state driven and
 *     is explicitly outside the interaction token catalogue);
 *   - dead rules the bundler tree-shakes out, kept pinned here so a future
 *     revival cannot silently reintroduce a raw literal.
 * Everything else carrying an `animation:` shorthand must resolve from a
 * `--motion-*` token — this is the class the DEF-362 hardcoded `.ann-flash`
 * escaped because it was absent from AUDITED_SELECTORS.
 */
const ANIMATION_EXEMPT: Readonly<Record<string, string>> = {
  ".update-indicator-spin": "documented indeterminate loading spinner (progress feedback, not an interaction)",
  ".update-prompt-spinner": "documented indeterminate loading spinner (progress feedback, not an interaction)",
  ".update-prompt-progress-indeterminate .update-prompt-progress-bar":
    "documented indeterminate progress bar (progress feedback, not an interaction)",
};

describe("Phase 43 — the animation-completeness guard", () => {
  it("parses the stylesheet into rules with at-rule context", () => {
    expect(allRules.length).toBeGreaterThan(500);
    expect(allRules.some((r) => r.at.some((a) => a.includes("prefers-reduced-motion")))).toBe(true);
  });

  it("scopes: every audited selector resolves to at least one live rule", () => {
    for (const token of AUDITED_SELECTORS) {
      const found = allRules.filter(
        (r) => isLive(r) && !r.selector.includes("::after") && selectorMatches(r.selector, token),
      );
      expect(found.length, `no live rule for ${token}`).toBeGreaterThan(0);
    }
  });

  it("has NO hardcoded duration/easing in any audited animated rule", () => {
    const violations: string[] = [];
    let checked = 0;
    for (const rule of allRules) {
      if (!isLive(rule) || rule.selector.includes("::after")) continue;
      if (rule.selector.startsWith("@keyframes")) continue;
      if (!AUDITED_SELECTORS.some((t) => selectorMatches(rule.selector, t))) continue;
      for (const decl of timingDeclarations(rule)) {
        checked += 1;
        if (!decl.includes("var(--")) {
          violations.push(`${rule.selector} -> ${decl} (no token)`);
          continue;
        }
        const remainder = withoutVars(decl);
        if (DURATION_LITERAL.test(remainder) || EASING_LITERAL.test(remainder)) {
          violations.push(`${rule.selector} -> ${decl} (literal timing)`);
        }
      }
    }
    expect(checked, "no timing declarations were scanned").toBeGreaterThan(20);
    expect(violations).toEqual([]);
  });

  it("app-wide: every live `animation:` shorthand resolves from a motion token (or is an exempt loading spinner)", () => {
    const violations: string[] = [];
    let checked = 0;
    for (const rule of allRules) {
      if (!isLive(rule) || rule.selector.includes("::after")) continue;
      if (rule.selector.startsWith("@keyframes")) continue;
      if (Object.keys(ANIMATION_EXEMPT).some((t) => selectorMatches(rule.selector, t))) continue;
      for (const decl of declarations(rule.body)) {
        if (!/^animation\s*:/.test(decl)) continue;
        if (/^animation\s*:\s*none\b/.test(decl)) continue;
        checked += 1;
        if (!decl.includes("var(--")) {
          violations.push(`${rule.selector} -> ${decl} (no token)`);
          continue;
        }
        const remainder = withoutVars(decl);
        if (DURATION_LITERAL.test(remainder) || EASING_LITERAL.test(remainder)) {
          violations.push(`${rule.selector} -> ${decl} (literal timing)`);
        }
      }
    }
    expect(checked, "no live animation declarations were scanned").toBeGreaterThan(10);
    expect(violations).toEqual([]);
  });
});

/** Every live rule body whose selector (any comma member) equals `token`. */
function bodiesFor(token: string): string[] {
  return allRules
    .filter((r) => isLive(r) && selectorMatches(r.selector, token))
    .map((r) => r.body);
}

function bodyIncludes(token: string, needle: string): boolean {
  return bodiesFor(token).some((b) => b.includes(needle));
}

describe("Phase 43 — the fixed elements carry their named token", () => {
  const pins: Array<[string, string]> = [
    // element -> the token its animation must resolve from
    [".action-dock-verb:hover:not(:disabled)", "var(--motion-translate-micro)"],
    [".action-dock-verb:active:not(:disabled)", "var(--motion-scale-press)"],
    [".action-dock-arrow:hover:not(:disabled)", "var(--motion-translate-micro)"],
    [".action-dock-arrow:active:not(:disabled)", "var(--motion-scale-press)"],
    [".annotation-flyout-arrow:active:not(:disabled)", "var(--motion-scale-press)"],
    [".stage-rail-btn:active", "var(--motion-scale-press)"],
    [".stage-rail-btn-active::before", "var(--motion-duration-fast)"],
    [".context-panel-outline-body", "var(--motion-duration-standard)"],
    [".update-indicator:active:not([disabled])", "var(--motion-scale-press)"],
    [".command-palette-pin-toggle:active:not([disabled])", "var(--motion-scale-press)"],
    [".command-palette-pin-glyph svg", "var(--motion-duration-fast)"],
    [".ann-flash", "var(--motion-duration-flash)"],
  ];

  for (const [selector, token] of pins) {
    it(`${selector} uses ${token}`, () => {
      expect(bodyIncludes(selector, token), `missing ${token} in ${selector}`).toBe(true);
    });
  }

  it("the reduced-motion block drops every Phase-43 hover-lift / press-scale transform", () => {
    const reduced = allRules.filter(
      (r) =>
        r.at.some((a) => a.includes("prefers-reduced-motion")) &&
        r.body.includes("transform: none !important") &&
        r.selector.includes(".action-dock-verb"),
    );
    expect(reduced.length).toBeGreaterThan(0);
    for (const token of [
      ".action-dock-arrow:active",
      ".annotation-flyout-arrow:active",
      ".stage-rail-btn:active",
      ".update-indicator:active",
      ".command-palette-pin-toggle:active",
    ]) {
      expect(
        reduced.some((r) => r.selector.includes(token)),
        `reduced motion should neutralise ${token}`,
      ).toBe(true);
    }
  });

  it("the Outline disclosure's materialize is removed under reduced motion", () => {
    const reduced = allRules.filter(
      (r) =>
        r.at.some((a) => a.includes("prefers-reduced-motion")) &&
        r.selector.includes(".context-panel-outline-body") &&
        r.body.includes("animation: none !important"),
    );
    expect(reduced.length).toBeGreaterThan(0);
  });

  it("the menu reveal keyframe composes via `translate` and is token-only", () => {
    const animations = readFileSync(
      join(REPO_ROOT, "src", "renderer", "styles", "animations.css"),
      "utf8",
    );
    const rules = parseCssRules(animations);
    const utility = rules.filter((r) => r.selector.trim() === ".anim-menu-pop");
    expect(utility.length).toBeGreaterThan(0);
    expect(utility[0].body).toContain("var(--motion-duration-fast)");
    expect(utility[0].body).toContain("var(--motion-ease-enter)");
    const keyframes = rules.filter((r) =>
      r.at.some((a) => a.includes("@keyframes tf-anim-menu-pop")),
    );
    expect(keyframes.some((r) => r.body.includes("var(--motion-translate-small)"))).toBe(true);
    // The dock pin menu + the thumbnail right-click menu consume it.
    const actionDock = readFileSync(
      join(REPO_ROOT, "src", "renderer", "components", "ActionDock.tsx"),
      "utf8",
    );
    const thumbMenu = readFileSync(
      join(REPO_ROOT, "src", "renderer", "components", "pageThumbMenu.tsx"),
      "utf8",
    );
    expect(actionDock).toContain("action-dock-menu anim-menu-pop");
    expect(actionDock).toContain("action-dock-menu action-dock-menu-overflow anim-menu-pop");
    expect(thumbMenu).toContain("context-menu anim-menu-pop");
  });
});