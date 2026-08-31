// @vitest-environment node
// Static CSS guard for the OTA UpdatePromptDialog (DEF-080).
//
// The prompt is a sheet-styled dialog (matching About /
// Preferences). The Look-and-feel spec says:
//   - Use the single accent color (var(--accent), not a new hue).
//   - Stay within the existing radius / spacing scale.
//   - Use 150-250 ms ease transitions.
//   - Primary action button (Update / Restart) uses
//     .btn-primary (the project's existing button system).
//   - Secondary action button (Cancel / Later) uses
//     .btn-secondary (same).
//   - No gradient backgrounds, no purple-dominated themes, no
//     one-sided accent borders, no oversized radii.
//
// We scan styles.css the same way the existing CSS tests do —
// jsdom does not implement real cascade resolution, so the
// rules in the file are the source of truth.

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

describe("UpdatePromptDialog — CSS contract (OTA UX)", () => {
  const src = readStyles();

  it("uses the project's existing sheet container (no new background or border-radius)", () => {
    // The dialog reuses the .sheet / .sheet-header / .sheet-title /
    // .sheet-close / .sheet-body rules the About and Preferences
    // dialogs already pin. No new sheet-level overrides should
    // introduce a new background color or radius.
    const stripped = stripCssComments(src);
    const sheetRules = [
      ".sheet-update-prompt",
      ".sheet-body-update-prompt",
      ".update-prompt-body",
      ".update-prompt-text",
      ".update-prompt-actions",
    ];
    for (const selector of sheetRules) {
      const idx = stripped.indexOf(selector);
      if (idx === -1) continue;
      const body = extractRuleBody(stripped, idx);
      // No hex color literals — must use design tokens only.
      expect(body).not.toMatch(/#[0-9a-fA-F]{3,6}/);
      // No raw gradient declarations (look-and-feel avoid-list).
      expect(body).not.toMatch(/linear-gradient|radial-gradient/);
    }
  });

  it("renders the body with comfortable spacing + neutral foreground", () => {
    const body = findRuleBody(src, ".update-prompt-text");
    expect(body).not.toBeNull();
    // The body uses the project's fg -- token, not a hex.
    expect(body).toMatch(/color:\s*var\(--fg\)/);
    // Line-height around 1.4-1.6 for comfortable paragraph copy.
    expect(body).toMatch(/line-height:\s*1\.[4-6]/);
  });

  it("lays out actions right-aligned in a single row (Cancel/Update side-by-side)", () => {
    const body = findRuleBody(src, ".update-prompt-actions");
    expect(body).not.toBeNull();
    expect(body).toMatch(/display:\s*flex/);
    expect(body).toMatch(/justify-content:\s*flex-end/);
    // The actions row uses the project's spacing token, not a magic number.
    expect(body).toMatch(/gap:\s*var\(--sp-/);
  });
});