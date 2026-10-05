// @vitest-environment node
//
// Phase 107 (chunk A) — the Paper Stage surface + page frame.
//
// The single-view editor canvas now reads as a "paper stage": a cooler light
// canvas (#ECEFF4), a lifted dark canvas (#151820), and a square-cornered
// paper-white page framed by one --shadow-page-canvas token (a 1px neutral
// ring plus contact + diffuse exterior shadow) in every theme. These tests pin
// the static CSS contract and the elevation mirror so a regression fails here,
// not only in a screenshot review. Mirrors the CSS-reading approach of
// def285_singleModeCanvasOpaque.test.tsx.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { SHADOW_ROLE } from "../../../src/renderer/design/elevation";

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");

function stripCssComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "");
}

function extractRuleBody(src: string, selectorIndex: number): string {
  const braceOpen = src.indexOf("{", selectorIndex);
  if (braceOpen === -1) return "";
  let depth = 0;
  for (let i = braceOpen; i < src.length; i += 1) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(braceOpen + 1, i);
    }
  }
  return "";
}

function scopeBody(src: string, scopeSelector: string): string {
  const idx = src.indexOf(scopeSelector);
  return idx === -1 ? "" : extractRuleBody(src, idx);
}

function token(body: string, name: string): string | null {
  const match = body.match(new RegExp(`--${name}\\s*:\\s*([^;]+);`));
  return match ? match[1].trim() : null;
}

const stripped = stripCssComments(readFileSync(STYLES_PATH, "utf8"));
const SCOPES = {
  light: scopeBody(stripped, ":root {"),
  dark: scopeBody(stripped, ':root[data-theme="dark"] {'),
  frosted: scopeBody(stripped, ':root[data-theme="frosted"] {'),
} as const;
const SCOPE_NAMES = ["light", "dark", "frosted"] as const;

describe("Phase 107 (chunk A) — Paper Stage canvas tokens", () => {
  it("light canvas is the cooler Paper Stage neutral", () => {
    expect(token(SCOPES.light, "bg-canvas")).toBe("#ECEFF4");
    expect(token(SCOPES.light, "tf-canvas-opaque")).toBe("#ECEFF4");
  });

  it("dark canvas lifts off near-black to the paper-stage tone", () => {
    expect(token(SCOPES.dark, "bg-canvas")).toBe("#151820");
    expect(token(SCOPES.dark, "tf-canvas-opaque")).toBe("#151820");
  });

  it("frosted keeps its opaque --tf-bg canvas (unchanged)", () => {
    expect(token(SCOPES.frosted, "bg-canvas")).toBe("var(--tf-bg)");
    expect(token(SCOPES.frosted, "tf-canvas-opaque")).toBe("var(--tf-bg)");
  });

  it("repoints --shadow-page to --shadow-page-canvas in all three scopes", () => {
    for (const name of SCOPE_NAMES) {
      expect(token(SCOPES[name], "shadow-page"), `${name} --shadow-page`).toBe(
        "var(--shadow-page-canvas)",
      );
    }
  });

  it("defines the 1px ring plus both exterior shadow layers in every scope", () => {
    for (const name of SCOPE_NAMES) {
      const value = token(SCOPES[name], "shadow-page-canvas") ?? "";
      expect(value, `${name} --shadow-page-canvas missing`).not.toBe("");
      expect(value, `${name} 1px ring`).toMatch(/0 0 0 1px/);
      expect(value, `${name} contact layer`).toMatch(/0 2px 4px/);
      expect(value, `${name} diffuse layer`).toMatch(/0 12px 24px/);
    }
  });

  it("uses the specified ring colours in light and dark", () => {
    expect(token(SCOPES.light, "shadow-page-canvas")).toContain("#DCE0E7");
    expect(token(SCOPES.dark, "shadow-page-canvas")).toContain("#A1A6AF");
  });

  it("leaves the --elevation-1..4 ladder untouched", () => {
    expect(token(SCOPES.light, "elevation-1")).toBe("0 4px 18px rgba(15, 23, 42, 0.14)");
  });
});

describe("Phase 107 (chunk A) — .pdf-page paper frame", () => {
  it("is a square-cornered, paper-white sheet framed by --shadow-page", () => {
    const body = scopeBody(stripped, ".pdf-page {");
    expect(body, ".pdf-page rule missing").not.toBe("");
    expect(body).toMatch(/border-radius:\s*0\s*;/);
    expect(body).toMatch(/background:\s*#ffffff\s*;/);
    expect(body).toMatch(/box-shadow:\s*var\(--shadow-page\)\s*;/);
  });

  it("implements the ring as a box-shadow, never a border or margin", () => {
    const body = scopeBody(stripped, ".pdf-page {");
    expect(body).not.toMatch(/(^|[;\s])border\s*:/);
    expect(body).not.toMatch(/(^|[;\s])margin\s*:/);
  });
});

describe("Phase 107 (chunk A) — elevation mirror", () => {
  it("SHADOW_ROLE.page points at --shadow-page-canvas", () => {
    expect(SHADOW_ROLE.page).toBe("var(--shadow-page-canvas)");
    expect(SHADOW_ROLE.page).toBe(token(SCOPES.light, "shadow-page"));
  });
});
