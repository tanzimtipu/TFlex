// @vitest-environment node
// Static CSS guard for Bug 14 — when a document is modified the
// toolbar Save button must show the state color even if it is
// disabled (samples / never-saved docs are read-only and the
// disabled attribute forces opacity: 0.4, which made the icon
// look greyed out next to the lit tab dot). The fix adds a
// `.tool-btn-modified[disabled]` override that keeps the icon
// state-tinted without removing the disabled cursor.
//
// Phase 4 — the Save button now uses the SEMANTIC warning token,
// not the accent: orange is reserved for interactive accent
// controls, "unsaved changes" reads as --warning (success owns the
// clean/saved state, error owns a failed save). These assertions
// pin the changed colors at the source.

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

describe("Bug 14 — Save icon stays state-tinted when modified + disabled", () => {
  const src = readStyles();

  it(".tool-btn-modified declares the warning color (unsaved changes, not accent)", () => {
    // Phase 4 — "unsaved changes" is a state, so it uses the
    // semantic --warning token. The accent is NOT the save color.
    const body = findRuleBody(src, ".tool-btn-modified");
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(/color:\s*var\(--warning\)/);
    expect(body ?? "").not.toMatch(/color:\s*var\(--accent\)/);
  });

  it(".tool-btn-modified[disabled] keeps the warning color and a not-allowed cursor", () => {
    // Without this rule the disabled attribute would apply the
    // generic opacity:0.4 + color fallback, making the icon look
    // greyed out next to the lit tab dot. The override must keep
    // the icon state-tinted and explicitly set the cursor.
    const body = findRuleBody(src, ".tool-btn-modified[disabled]");
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(/color:\s*var\(--warning\)/);
    expect(body ?? "").toMatch(/cursor:\s*not-allowed/);
  });

  it(".tool-btn-modified hover (non-disabled) uses the warning tint (no regression)", () => {
    const body = findRuleBody(src, ".tool-btn-modified:hover:not([disabled])");
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(/background:\s*var\(--warning-soft\)/);
    expect(body ?? "").toMatch(/color:\s*var\(--warning\)/);
  });

  it(".tool-btn-save-clean paints the SAVED state with the success token", () => {
    // Phase 4 — a clean document reads as --success, never orange.
    const body = findRuleBody(src, ".tool-btn-save-clean[disabled]");
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(/color:\s*var\(--success\)/);
  });
});