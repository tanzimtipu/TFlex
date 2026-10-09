// @vitest-environment node
//
// Phase 110 (chunk A) - the Quiet Precision semantic type-scale foundation.
//
// styles.css :root is the single source of truth: the eight --type-* semantic
// roles, the supporting-text colour in both theme scopes, the Segoe UI Variable
// family, and every legacy type token repointed as an alias at a role. This
// suite parses the stylesheet (mirroring phase107_paperStage.test.ts) and fails
// if a role value drifts, a legacy alias stops resolving, or the label floor
// regresses below 12px.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

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

/** Follow one var(--token) hop against the same scope body. */
function resolveVar(body: string, value: string): string {
  const match = /^var\((--[a-z0-9-]+)\)$/.exec(value);
  if (match === null) return value;
  const next = token(body, match[1].slice(2));
  return next === null ? value : next;
}

const stripped = stripCssComments(readFileSync(STYLES_PATH, "utf8"));
const LIGHT = scopeBody(stripped, ":root {");
const DARK = scopeBody(stripped, ':root[data-theme="dark"] {');

const FAMILY = '"Segoe UI Variable", "Segoe UI", system-ui, sans-serif';

const ROLE_SPECS: ReadonlyArray<[string, string, string, string]> = [
  ["home", "32px", "38px", "500"],
  ["title", "18px", "25px", "500"],
  ["panel", "16px", "22px", "500"],
  ["body", "14px", "22px", "400"],
  ["row", "13px", "20px", "500"],
  ["label", "12px", "17px", "500"],
  ["helper", "12px", "18px", "400"],
  ["compact", "11px", "16px", "500"],
];

describe("Phase 110 (chunk A) - the semantic type scale", () => {
  it("declares the eight --type-* roles at their spec size / line / weight", () => {
    for (const [role, size, line, weight] of ROLE_SPECS) {
      expect(token(LIGHT, `type-${role}-size`), `--type-${role}-size`).toBe(size);
      expect(token(LIGHT, `type-${role}-line`), `--type-${role}-line`).toBe(line);
      expect(token(LIGHT, `type-${role}-weight`), `--type-${role}-weight`).toBe(weight);
    }
  });

  it("declares the constrained home variant", () => {
    expect(token(LIGHT, "type-home-size-constrained")).toBe("28px");
    expect(token(LIGHT, "type-home-line-constrained")).toBe("34px");
  });

  it("sets the UI family to the Segoe UI Variable stack", () => {
    expect(token(LIGHT, "type-family")).toBe(FAMILY);
    expect(token(LIGHT, "font-sans")).toBe("var(--type-family)");
    expect(token(LIGHT, "font-ui")).toBe("var(--type-family)");
    expect(resolveVar(LIGHT, token(LIGHT, "font-sans") ?? "")).toBe(FAMILY);
    expect(resolveVar(LIGHT, token(LIGHT, "font-ui") ?? "")).toBe(FAMILY);
  });
});

describe("Phase 110 (chunk A) - supporting-text colour", () => {
  it("is #5b6577 in :root and #929BAC in the dark theme", () => {
    expect(token(LIGHT, "tf-text-supporting")).toBe("#5b6577");
    expect(token(DARK, "tf-text-supporting")).toBe("#929BAC");
  });

  it("leaves the non-text/disabled token untouched", () => {
    expect(token(LIGHT, "tf-icon-disabled")).toBe("#70798A");
  });
});

describe("Phase 110 (chunk A) - legacy tokens alias the semantic roles", () => {
  const ALIASES: ReadonlyArray<[string, string]> = [
    ["fs-xs", "type-helper-size"],
    ["fs-sm", "type-label-size"],
    ["fs-md", "type-row-size"],
    ["fs-lg", "type-panel-size"],
    ["fs-xl", "type-title-size"],
    ["fs-2xl", "type-home-size"],
    ["tf-label-size", "type-label-size"],
    ["tf-label-size-md", "type-row-size"],
    ["dlg-title-fs", "type-title-size"],
    ["dlg-label-fs", "type-label-size"],
    ["dlg-help-fs", "type-helper-size"],
    ["dock-label-size", "type-label-size"],
    ["dock-label-weight", "type-label-weight"],
  ];

  it("repoints every legacy type token at its role", () => {
    for (const [legacy, role] of ALIASES) {
      // File-wide: --dock-label-* live in the .action-dock block, the rest in
      // :root; every alias name is a single declaration.
      expect(token(stripped, legacy), `--${legacy}`).toBe(`var(--${role})`);
    }
  });

  it("keeps the 12px label / body-ladder floor after resolution", () => {
    const label = Number.parseFloat(resolveVar(LIGHT, token(LIGHT, "tf-label-size") ?? ""));
    const bodyFloor = Number.parseFloat(resolveVar(LIGHT, token(LIGHT, "fs-xs") ?? ""));
    expect(label, "--tf-label-size").toBeGreaterThanOrEqual(12);
    expect(bodyFloor, "--fs-xs").toBeGreaterThanOrEqual(12);
  });
});
