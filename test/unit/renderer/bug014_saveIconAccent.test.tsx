// @vitest-environment node
// Static CSS guard for Bug 14 — when a document is modified the
// toolbar Save button must show the accent color even if it is
// disabled (samples / never-saved docs are read-only and the
// disabled attribute forces opacity: 0.4, which made the icon
// look greyed out next to the lit tab dot). The fix adds a
// `.tool-btn-modified[disabled]` override that keeps the icon
// accent-tinted without removing the disabled cursor.

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

describe("Bug 14 — Save icon stays accent-tinted when modified + disabled", () => {
  const src = readStyles();

  it(".tool-btn-modified declares the accent color (icon lights up)", () => {
    const body = findRuleBody(src, ".tool-btn-modified");
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(/color:\s*var\(--accent\)/);
  });

  it(".tool-btn-modified[disabled] keeps the accent color and a not-allowed cursor", () => {
    // Without this rule the disabled attribute would apply the
    // generic opacity:0.4 + color fallback, making the icon look
    // greyed out next to the lit tab dot. The override must keep
    // the icon accent-tinted and explicitly set the cursor.
    const body = findRuleBody(src, ".tool-btn-modified[disabled]");
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(/color:\s*var\(--accent\)/);
    expect(body ?? "").toMatch(/cursor:\s*not-allowed/);
  });

  it(".tool-btn-modified hover (non-disabled) still uses the accent (no regression)", () => {
    const body = findRuleBody(src, ".tool-btn-modified:hover:not([disabled])");
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(/background:\s*var\(--accent-soft\)/);
    expect(body ?? "").toMatch(/color:\s*var\(--accent\)/);
  });
});
