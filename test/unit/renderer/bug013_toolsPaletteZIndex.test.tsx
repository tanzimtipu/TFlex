// @vitest-environment node
// Static CSS guard for Bug 13 — the tools palette used to render
// with `top: 0` against `.app-main`, so it covered the toolbar's
// right-side controls (Tools / Edit / Optimize / etc.). The fix
// anchors the palette below the toolbar using a new
// `--toolbar-h` token and lifts z-index above the workspace
// overlays (3) but below modal sheets (100+).

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

describe("Bug 13 — tools palette anchors below toolbar", () => {
  const src = readStyles();

  it(".tools-palette top is offset by --toolbar-h, not 0", () => {
    const body = findRuleBody(src, ".tools-palette");
    expect(body).not.toBeNull();
    // Old behaviour: `top: 0` overlapped the toolbar. New
    // behaviour uses the --toolbar-h token to start below the
    // toolbar's baseline.
    expect(body ?? "").toMatch(/top:\s*var\(--toolbar-h/);
    // The previous `top: 0` would have left the right cluster
    // hidden — lock against that regression.
    expect(body ?? "").not.toMatch(/top:\s*0\s*;/);
  });

  it(":root defines --toolbar-h (sizing token for the palette offset)", () => {
    const stripped = stripCssComments(src);
    const rootIdx = stripped.indexOf(":root {");
    expect(rootIdx).toBeGreaterThan(-1);
    const body = extractRuleBody(stripped, rootIdx);
    expect(body).toMatch(/--toolbar-h:\s*\d+px/);
  });

  it(".tools-palette z-index lifts the palette above workspace overlays (>=30)", () => {
    const body = findRuleBody(src, ".tools-palette");
    expect(body).not.toBeNull();
    const m = (body ?? "").match(/z-index:\s*(\d+)/);
    expect(m).not.toBeNull();
    const zi = m === null ? 0 : Number(m[1]);
    // Above workspace overlays (text / forms / edit-image-toolbar
    // at z-index 2-6) but below modal sheets (100+).
    expect(zi).toBeGreaterThanOrEqual(20);
    expect(zi).toBeLessThan(100);
  });
});
