// @vitest-environment node
//
// Phase 52 regression — form editors must not paint a background they do
// not own.
//
// The operator's encrypted AcroForm (956.pdf) opened with many fields and
// the .form-editor overlay painted an opaque fill (white-ish in light, dark
// slate in dark) over the page. Where several editors piled up this read as
// solid dark/light blocks covering the document's own text and headings.
// The editor's affordance is its accent border; the fill itself must stay
// transparent so the page shows through. A light wash is allowed ONLY on
// :focus (the user is typing into that one field).
//
// This pins the rule textually (jsdom does not resolve the cascade against
// :root[data-theme] attributes reliably). It is a CSS contract test, the
// same style as formsCssStacking.test.ts.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");

function stripCssComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Body of the first rule whose selector is exactly `selector` at the
 *  start of a rule (only whitespace before `{`). */
function findRuleBody(src: string, selector: string): string | null {
  let from = 0;
  for (;;) {
    const idx = src.indexOf(selector, from);
    if (idx === -1) return null;
    let cursor = idx + selector.length;
    while (cursor < src.length && /\s/.test(src[cursor] ?? "")) cursor += 1;
    if (src[cursor] === "{") {
      const braceOpen = cursor;
      let depth = 0;
      for (let i = braceOpen; i < src.length; i += 1) {
        if (src[i] === "{") depth += 1;
        else if (src[i] === "}") {
          depth -= 1;
          if (depth === 0) return src.slice(braceOpen + 1, i);
        }
      }
      return null;
    }
    from = idx + selector.length;
  }
}

function declarationValue(body: string, property: string): string | null {
  const re = new RegExp(`(?:^|;|\\n)\\s*${property}\\s*:\\s*([^;]+?)\\s*(?:;|$)`, "m");
  const m = body.match(re);
  return m === null ? null : (m[1] ?? "").trim();
}

/** True when a background value is fully transparent or an extremely low
 *  alpha wash that cannot hide document content. Anything opaque (or a dark
 *  fill) fails. */
function isNonObscuring(background: string | null): boolean {
  if (background === null) return false;
  if (background === "transparent") return true;
  if (background === "none") return true;
  const rgba = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+)\s*)?\)/.exec(background);
  if (rgba === null) return false;
  const alpha = rgba[4] === undefined ? 1 : Number.parseFloat(rgba[4]);
  return alpha <= 0.15;
}

describe("styles.css — form editors do not obscure the page (Phase 52)", () => {
  const raw = stripCssComments(readFileSync(STYLES_PATH, "utf8"));

  it("base .form-editor paints no opaque background", () => {
    const body = findRuleBody(raw, ".form-editor");
    expect(body).not.toBeNull();
    if (body === null) return;
    const bg = declarationValue(body, "background");
    expect(bg, "base .form-editor background").not.toBeNull();
    expect(isNonObscuring(bg), `background was ${String(bg)}`).toBe(true);
  });

  it("dark theme .form-editor paints no dark fill over the document", () => {
    const body = findRuleBody(raw, ':root[data-theme="dark"] .form-editor');
    expect(body).not.toBeNull();
    if (body === null) return;
    const bg = declarationValue(body, "background");
    expect(bg, "dark .form-editor background").not.toBeNull();
    expect(isNonObscuring(bg), `background was ${String(bg)}`).toBe(true);
  });

  it("the editor keeps its accent affordance and stays interactive", () => {
    const body = findRuleBody(raw, ".form-editor");
    expect(body).not.toBeNull();
    if (body === null) return;
    expect(declarationValue(body, "pointer-events")).toBe("auto");
    expect(declarationValue(body, "border")).toContain("var(--accent)");
  });

  it("checkbox and radio toggles paint no chrome fill over the page", () => {
    for (const selector of [".form-checkbox", ".form-radio-dot"]) {
      const body = findRuleBody(raw, selector);
      expect(body, selector).not.toBeNull();
      if (body === null) continue;
      const bg = declarationValue(body, "background");
      expect(isNonObscuring(bg), `${selector} background was ${String(bg)}`).toBe(true);
    }
  });
});
