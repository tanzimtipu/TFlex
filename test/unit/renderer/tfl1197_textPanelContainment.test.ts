// TFL-1197 (DEF-631 / ER02) — the re-parented text-properties panel must not
// draw a nested horizontal scroller inside the Inspector's ~249px content
// width, and must not hide/clip any interactive control to achieve that.
//
// jsdom does not compute layout, so this pins the containment contract in the
// stylesheet: the flex children can shrink (`min-width: 0`), the rows reflow
// (wrap) instead of overflowing, the preview wraps in its real content box,
// and the panel body does NOT mask overflow with `overflow-x: hidden`.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");
const SRC = readFileSync(STYLES_PATH, "utf8");

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

describe("TFL-1197 DEF-631 / ER02 — text inspector horizontal containment", () => {
  it("does not mask overflow by clipping the panel body", () => {
    const body = findRuleBody(SRC, ".text-props-body");
    expect(body).not.toBeNull();
    // The forbidden fix is `overflow-x: hidden` on the panel body.
    expect(body).not.toMatch(/overflow-x\s*:\s*hidden/);
  });

  it("lets the group bodies shrink below their content", () => {
    for (const sel of [".text-props-group-body", ".text-props-advanced-body"]) {
      const body = findRuleBody(SRC, sel);
      expect(body, sel).not.toBeNull();
      expect(body, sel).toMatch(/min-width:\s*0/);
    }
  });

  it("reflows the label/control rows instead of overflowing", () => {
    const row = findRuleBody(SRC, ".text-props-row");
    expect(row).not.toBeNull();
    expect(row).toMatch(/flex-wrap:\s*wrap/);
    expect(row).toMatch(/min-width:\s*0/);
    const label = findRuleBody(SRC, ".text-props-label");
    expect(label).not.toBeNull();
    expect(label).toMatch(/min-width:\s*0/);
  });

  it("reflows the formatting button rows into complete rows", () => {
    const btnRow = findRuleBody(SRC, ".text-props-btn-row");
    expect(btnRow).not.toBeNull();
    expect(btnRow).toMatch(/flex-wrap:\s*wrap/);
    expect(btnRow).toMatch(/min-width:\s*0/);
    // The 28px box must win over `.btn-icon`'s 36px min-width floor so a row
    // of six toggles fits the content width on one line.
    const btn = findRuleBody(SRC, ".text-props-btn");
    expect(btn).not.toBeNull();
    expect(btn).toMatch(/min-width:\s*0/);
  });

  it("wraps the style preview inside its real content box", () => {
    const preview = findRuleBody(SRC, ".text-props-preview");
    expect(preview).not.toBeNull();
    expect(preview).toMatch(/white-space:\s*normal/);
    expect(preview).not.toMatch(/white-space:\s*nowrap/);
    expect(preview).toMatch(/overflow-wrap:\s*anywhere/);
  });
});