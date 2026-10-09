// @vitest-environment node
// Static CSS guard for TFL-1413 C1 — panel section body / empty-state text
// must read as normal body text: regular weight (400) and left-aligned,
// while section headings stay bold and left-aligned. The global designed
// hero EmptyState (.empty-state*) is only re-presented when it is rendered
// as the body of a titled panel section (.tf-panel-section scope).

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

describe("TFL-1413 C1 — panel section body text is normal weight and left-aligned", () => {
  const src = readStyles();

  it(".tf-panel-empty is left-aligned, not centred", () => {
    const body = findRuleBody(src, ".tf-panel-empty");
    expect(body).not.toBeNull();
    expect(body).toMatch(/align-items:\s*flex-start/);
    expect(body).toMatch(/text-align:\s*left/);
    expect(body).not.toMatch(/align-items:\s*center/);
    expect(body).not.toMatch(/text-align:\s*center/);
  });

  it(".tf-panel-empty-headline uses the body type role", () => {
    const body = findRuleBody(src, ".tf-panel-empty-headline");
    expect(body).not.toBeNull();
    expect(body).toMatch(/font-size:\s*var\(--tf-panel-body-size\)/);
    expect(body).toMatch(/font-weight:\s*var\(--type-body-weight\)/);
  });

  it(".tf-panel-section .empty-state is left-aligned", () => {
    const body = findRuleBody(src, ".tf-panel-section .empty-state");
    expect(body).not.toBeNull();
    expect(body).toMatch(/text-align:\s*left/);
  });

  it(".tf-panel-section .empty-state .empty-state-headline uses the body weight", () => {
    const body = findRuleBody(
      src,
      ".tf-panel-section .empty-state .empty-state-headline",
    );
    expect(body).not.toBeNull();
    expect(body).toMatch(/font-weight:\s*var\(--type-body-weight\)/);
  });
});
