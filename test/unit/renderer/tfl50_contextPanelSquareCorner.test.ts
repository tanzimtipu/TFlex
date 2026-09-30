// TFL-50 — the left Pages/Outline panel's bottom-right corner must be SQUARE.
// The `.context-panel` rule used to declare `border-radius: 0 0 var(--panel-radius) 0`,
// rounding its bottom-right corner. All four corners must now be square
// (browser default 0). Static CSS guard in the def294 style.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");

function stripCssComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "");
}

function findRuleBody(src: string, selector: string): string | null {
  const stripped = stripCssComments(src);
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

const src = readFileSync(STYLES_PATH, "utf8");

describe("TFL-50 — the Outline/PAGES panel corner is square", () => {
  it(".context-panel declares no border-radius", () => {
    const body = findRuleBody(src, ".context-panel {");
    expect(body).not.toBeNull();
    expect(body ?? "").not.toMatch(/border-radius\s*:/);
  });
});
