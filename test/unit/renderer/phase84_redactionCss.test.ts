// @vitest-environment node
// Static CSS guard for the Phase 84 redaction overlay (DEF-490).
//
// The RedactionOverlay markup carried class names but no stylesheet rules, so
// in a real browser the layer computed `position: static` and its bounding box
// sat at the page bottom instead of covering the page. A real mouse region
// drag therefore marked nothing, and the control bar painted over the action
// dock. jsdom applies no stylesheet, so the component spec passed anyway.
//
// This test pins the load-bearing rules textually rather than via
// getComputedStyle (jsdom does not resolve layout or stacking), mirroring the
// pattern in formsCssStacking.test.ts:
//   - .redact-layer must be position: absolute; inset: 0 so it covers the page.
//   - .redact-layer must stay pointer-events: none by default, with the armed
//     .redact-layer[data-redact-tool] opting back in to pointer-events: auto.
//   - .redact-actions must be positioned inside the page and hit-testable.
//   - marks stay pointer-transparent so drags reach the layer.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");

function readStyles(): string {
  return readFileSync(STYLES_PATH, "utf8");
}

/** Strip CSS comments so commented-out rules do not create false matches. */
function stripCssComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Extract the body of the rule whose selector precedes the FIRST opening
 *  brace after `selectorIndex`. */
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

/** Find the first top-level rule for `selector` (only whitespace between the
 *  selector and `{`) and return its body. */
function findRuleBody(src: string, selector: string): string | null {
  let from = 0;
  for (;;) {
    const idx = src.indexOf(selector, from);
    if (idx === -1) return null;
    let cursor = idx + selector.length;
    while (cursor < src.length && /\s/.test(src[cursor] ?? "")) cursor += 1;
    if (src[cursor] === "{") {
      return extractRuleBody(src, idx);
    }
    from = idx + selector.length;
  }
}

function declarationValue(body: string, property: string): string | null {
  const re = new RegExp(`(?:^|;|\\n)\\s*${property}\\s*:\\s*([^;]+?)\\s*(?:;|$)`, "m");
  const m = body.match(re);
  if (m === null) return null;
  return (m[1] ?? "").trim();
}

describe("styles.css — Phase 84 redaction overlay (DEF-490)", () => {
  it(".redact-layer covers the page (position: absolute; inset: 0)", () => {
    const raw = stripCssComments(readStyles());
    const body = findRuleBody(raw, ".redact-layer");
    expect(body).not.toBeNull();
    if (body === null) return;
    expect(declarationValue(body, "position")).toBe("absolute");
    expect(declarationValue(body, "inset")).toBe("0");
  });

  it(".redact-layer stays pointer-transparent until armed", () => {
    const raw = stripCssComments(readStyles());
    const body = findRuleBody(raw, ".redact-layer");
    expect(body).not.toBeNull();
    if (body === null) return;
    expect(declarationValue(body, "pointer-events")).toBe("none");
  });

  it(".redact-layer[data-redact-tool] opts back in with pointer-events: auto", () => {
    const raw = stripCssComments(readStyles());
    const body = findRuleBody(raw, ".redact-layer[data-redact-tool]");
    expect(body).not.toBeNull();
    if (body === null) return;
    expect(declarationValue(body, "pointer-events")).toBe("auto");
  });

  it(".redact-actions is positioned inside the page and hit-testable", () => {
    const raw = stripCssComments(readStyles());
    const body = findRuleBody(raw, ".redact-actions");
    expect(body).not.toBeNull();
    if (body === null) return;
    expect(declarationValue(body, "position")).toBe("absolute");
    expect(declarationValue(body, "pointer-events")).toBe("auto");
  });

  it("marks and draft stay pointer-transparent", () => {
    const raw = stripCssComments(readStyles());
    for (const sel of [".redact-mark", ".redact-draft"]) {
      const body = findRuleBody(raw, sel);
      expect(body).not.toBeNull();
      if (body === null) continue;
      expect(declarationValue(body, "pointer-events")).toBe("none");
    }
  });
});
