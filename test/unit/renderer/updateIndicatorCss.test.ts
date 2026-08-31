// @vitest-environment node
// Static CSS guard for the OTA update indicator (DEF-077).
//
// The Look-and-feel spec says: no gradient hero backgrounds, no
// purple-dominated themes, no one-sided accent borders, no
// uniform oversized corner radii, one accent color #2563eb. The
// indicator must:
//   - Use the single accent color (var(--accent), not a new hue).
//   - Stay within the existing radius scale (var(--radius-2)).
//   - Use a 150-250 ms ease transition (matches the spec motion
//     budget).
//   - Render the 'available' treatment as a clickable pill that
//     declares cursor: pointer and a hover state (so the user
//     can see it responds to interaction).
//   - Render the 'downloaded' treatment as a primary button
//     using var(--accent) (the strongest visual weight state).
//   - Render the 'downloading' treatment as non-interactive
//     (no cursor: pointer) so a click doesn't queue a second
//     download.
//
// We use a textual scan of styles.css rather than jsdom's
// getComputedStyle because jsdom does not implement real CSS
// cascade resolution; the rules are the source of truth.

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

function extractRuleBody(src: string, selectorIndex: number): string {
  const braceOpen = src.indexOf("{", selectorIndex);
  if (braceOpen === -1) return "";
  let depth = 0;
  for (let i = braceOpen; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(braceOpen + 1, i);
    }
  }
  return "";
}

function findRuleBody(src: string, selector: string): string | null {
  const stripped = stripCssComments(src);
  let from = 0;
  for (;;) {
    const idx = stripped.indexOf(selector, from);
    if (idx === -1) return null;
    let cursor = idx + selector.length;
    while (cursor < stripped.length && /\s/.test(stripped[cursor] ?? "")) cursor += 1;
    if (stripped[cursor] === "{") return extractRuleBody(stripped, idx);
    from = idx + selector.length;
  }
}

describe("UpdateIndicator — CSS contract (DEF-077, Look-and-feel spec)", () => {
  const src = readStyles();

  it("declares the .update-indicator base rule with the project's radius + transition tokens", () => {
    const body = findRuleBody(src, ".update-indicator");
    expect(body).not.toBeNull();
    // Border radius must come from the design token, not a magic number.
    expect(body).toMatch(/border-radius:\s*var\(--radius-2\)/);
    // Transition uses the spec's motion budget token (150 ms ease).
    expect(body).toMatch(/transition:\s*background\s+var\(--t-quick\)\s+var\(--ease\)/);
    // No one-sided accent border on the base (that's reserved for the
    // 'available' / 'downloaded' variants).
    expect(body).not.toMatch(/border:\s*1px solid var\(--accent\)/);
  });

  it("renders 'available' as a clickable accent-bordered pill", () => {
    const body = findRuleBody(src, ".update-indicator-available");
    expect(body).not.toBeNull();
    expect(body).toMatch(/cursor:\s*pointer/);
    expect(body).toMatch(/border-color:\s*var\(--accent\)/);
    expect(body).toMatch(/color:\s*var\(--accent\)/);
    // The hover must invert to a solid accent so the user gets clear
    // feedback that the pill is interactive.
    const hover = findRuleBody(src, ".update-indicator-available:hover");
    expect(hover).not.toBeNull();
    expect(hover).toMatch(/background:\s*var\(--accent\)/);
  });

  it("renders 'downloaded' as the highest-weight primary button", () => {
    const body = findRuleBody(src, ".update-indicator-downloaded");
    expect(body).not.toBeNull();
    expect(body).toMatch(/cursor:\s*pointer/);
    expect(body).toMatch(/background:\s*var\(--accent\)/);
    expect(body).toMatch(/border-color:\s*var\(--accent\)/);
    // Hover must darken via the project's hover token (not introduce
    // a new color).
    const hover = findRuleBody(src, ".update-indicator-downloaded:hover");
    expect(hover).not.toBeNull();
    expect(hover).toMatch(/background:\s*var\(--accent-hover\)/);
  });

  it("renders 'downloading' as non-interactive (no cursor: pointer)", () => {
    const body = findRuleBody(src, ".update-indicator-downloading");
    expect(body).not.toBeNull();
    // Clicks must not be invited.
    expect(body).not.toMatch(/cursor:\s*pointer/);
  });

  it("renders 'error' as a clickable retry button", () => {
    const body = findRuleBody(src, ".update-indicator-error");
    expect(body).not.toBeNull();
    expect(body).toMatch(/cursor:\s*pointer/);
  });

  it("does not introduce a new accent color (uses the project accent tokens only)", () => {
    // Lock the rule bodies against any #RRGGBB color literal that
    // would be a new accent. var(--accent) / var(--accent-hover) /
    // var(--accent-soft) are the only allowed accent sources.
    const stripped = stripCssComments(src);
    const indicatorRules = [
      ".update-indicator",
      ".update-indicator-checking",
      ".update-indicator-available",
      ".update-indicator-downloading",
      ".update-indicator-downloaded",
      ".update-indicator-error",
    ];
    for (const selector of indicatorRules) {
      const idx = stripped.indexOf(selector);
      if (idx === -1) continue;
      const body = extractRuleBody(stripped, idx);
      // No hex color literals in any indicator rule.
      expect(body).not.toMatch(/#[0-9a-fA-F]{3,6}/);
    }
  });
});
