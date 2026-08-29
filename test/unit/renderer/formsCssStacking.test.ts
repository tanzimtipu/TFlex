// @vitest-environment node
// Static CSS guard for the forms layer (DEF-024).
//
// Playwright reports the form checkbox / radio / input click is being
// intercepted by the pdf.js TextLayer spans (which sit at z-index: auto
// inside the .textLayer wrapper). The fix raises the .forms-layer above
// those spans AND keeps the textLayer wrapper itself fully clickable for
// text selection in non-form regions.
//
// This test pins the CSS rule rather than relying on getComputedStyle:
//   - .forms-layer must declare a z-index strictly greater than .textLayer's
//     effective stacking position. .textLayer has no explicit z-index, so
//     any numeric z-index on .forms-layer wins (z-index: auto vs z-index: N).
//   - .forms-layer must still declare pointer-events: none on the wrapper
//     (so click-through works in regions without editors).
//   - .form-checkbox must declare pointer-events: auto so individual
//     checkboxes stay clickable even when future CSS edits alter the
//     surrounding layer's pointer-events rule.
//   - .form-editor / .form-radio-group / .form-listbox must declare
//     pointer-events: auto (the editors that explicitly opt back in).
//   - .textLayer must keep pointer-events: auto (text selection must keep
//     working for annotation markup and copy/paste).
//
// We use a textual scan of styles.css rather than jsdom's
// getComputedStyle because jsdom does not implement stacking context
// resolution — only a real browser does that.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");

function readStyles(): string {
  return readFileSync(STYLES_PATH, "utf8");
}

/** Strip CSS comments so we don't get false matches on commented-out
 *  rules from past iterations. */
function stripCssComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Extract the body of the rule whose selector precedes the FIRST
 *  opening brace after `selectorIndex`. Returns the brace content as
 *  a single string. */
function extractRuleBody(src: string, selectorIndex: number): string {
  const braceOpen = src.indexOf("{", selectorIndex);
  if (braceOpen === -1) return "";
  let depth = 0;
  for (let i = braceOpen; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return src.slice(braceOpen + 1, i);
      }
    }
  }
  return "";
}

/** Find the first occurrence of a top-level CSS rule with the given
 *  selector (selector appears immediately before `{`, with only
 *  whitespace between) and return its body. */
function findRuleBody(src: string, selector: string): string | null {
  let from = 0;
  for (;;) {
    const idx = src.indexOf(selector, from);
    if (idx === -1) return null;
    // Selector must be at the start of a rule: only whitespace /
    // newlines between selector and `{`.
    let cursor = idx + selector.length;
    while (cursor < src.length && /\s/.test(src[cursor] ?? "")) cursor += 1;
    if (src[cursor] === "{") {
      return extractRuleBody(src, idx);
    }
    from = idx + selector.length;
  }
}

function hasDeclaration(body: string, property: string): boolean {
  // `pointer-events: auto` — accept either `auto` or `none`.
  const re = new RegExp(`(^|;|\\n)\\s*${property}\\s*:\\s*([^;]+?)\\s*(;|$)`, "m");
  return re.test(body);
}

function declarationValue(body: string, property: string): string | null {
  const re = new RegExp(`(?:^|;|\\n)\\s*${property}\\s*:\\s*([^;]+?)\\s*(?:;|$)`, "m");
  const m = body.match(re);
  if (m === null) return null;
  return (m[1] ?? "").trim();
}

describe("styles.css — forms layer stacking & pointer-events (DEF-024)", () => {
  it(".forms-layer is declared above the textLayer (numeric z-index wins over auto)", () => {
    const raw = stripCssComments(readStyles());
    const body = findRuleBody(raw, ".forms-layer");
    expect(body).not.toBeNull();
    if (body === null) return;
    const z = declarationValue(body, "z-index");
    expect(z).not.toBeNull();
    // Accept any positive integer. The spec says it must be ABOVE the
    // textLayer (which has no explicit z-index, so z-index: auto) and
    // above the signatures layer (z-index: 3). 5 is the chosen value.
    expect(z).toMatch(/^[1-9]\d*$/);
    const numeric = Number.parseInt(z ?? "0", 10);
    expect(numeric).toBeGreaterThanOrEqual(4);
  });

  it(".forms-layer keeps pointer-events: none on the wrapper", () => {
    const raw = stripCssComments(readStyles());
    const body = findRuleBody(raw, ".forms-layer");
    expect(body).not.toBeNull();
    if (body === null) return;
    expect(hasDeclaration(body, "pointer-events")).toBe(true);
    expect(declarationValue(body, "pointer-events")).toBe("none");
  });

  it(".form-editor opts back in with pointer-events: auto", () => {
    const raw = stripCssComments(readStyles());
    const body = findRuleBody(raw, ".form-editor");
    expect(body).not.toBeNull();
    if (body === null) return;
    expect(declarationValue(body, "pointer-events")).toBe("auto");
  });

  it(".form-checkbox explicitly opts back in (DEF-024 fix — defensive)", () => {
    // The .form-checkbox button previously relied on the HTML default
    // pointer-events: auto. The QA report says click is intercepted; we
    // add an explicit declaration so future edits to the surrounding
    // layer can't accidentally disable checkbox clicks.
    const raw = stripCssComments(readStyles());
    const body = findRuleBody(raw, ".form-checkbox");
    expect(body).not.toBeNull();
    if (body === null) return;
    expect(declarationValue(body, "pointer-events")).toBe("auto");
  });

  it(".form-radio-group and .form-listbox opt back in", () => {
    const raw = stripCssComments(readStyles());
    for (const sel of [".form-radio-group", ".form-listbox"]) {
      const body = findRuleBody(raw, sel);
      expect(body).not.toBeNull();
      if (body === null) continue;
      expect(declarationValue(body, "pointer-events")).toBe("auto");
    }
  });

  it(".textLayer keeps pointer-events: auto so text selection still works", () => {
    // The spec explicitly says "must keep text selection working for
    // markup". Disabling .textLayer pointer-events globally would break
    // text selection across the entire page. We only raise the forms
    // layer ABOVE the textLayer — we don't disable textLayer clicks.
    const raw = stripCssComments(readStyles());
    const body = findRuleBody(raw, ".textLayer");
    expect(body).not.toBeNull();
    if (body === null) return;
    expect(declarationValue(body, "pointer-events")).toBe("auto");
  });
});
