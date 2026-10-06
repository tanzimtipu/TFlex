// @vitest-environment jsdom
// Phase 113 (Quiet Actions) — the CSS-level button foundation.
//
// Pins the token/theme foundation this chunk introduces: each new token exists
// with its exact value in the right theme block, the new classes consume the
// right tokens, the destructive split (subtle `.btn-danger` vs solid
// `.btn-danger-commit`) is real, and no new rule hardcodes a duration, easing
// or press scale. Reads src/renderer/styles.css directly.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "../../..");
const STYLES_PATH = resolve(REPO_ROOT, "src/renderer/styles.css");
const styles = readFileSync(STYLES_PATH, "utf8");

function stripCssComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Body of the first block whose header matches `header`. */
function blockBody(src: string, header: RegExp): string {
  const stripped = stripCssComments(src);
  const match = header.exec(stripped);
  if (!match || match.index === undefined) return "";
  const braceOpen = stripped.indexOf("{", match.index);
  if (braceOpen === -1) return "";
  let depth = 0;
  for (let i = braceOpen; i < stripped.length; i += 1) {
    const ch = stripped[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return stripped.slice(braceOpen + 1, i);
    }
  }
  return "";
}

/** Body of a rule whose selector list includes `selector`. */
function findRuleBody(src: string, selector: string): string | null {
  const stripped = stripCssComments(src);
  let from = 0;
  for (;;) {
    const idx = stripped.indexOf(selector, from);
    if (idx === -1) return null;
    const after = stripped[idx + selector.length] ?? "";
    if (/[a-zA-Z0-9_-]/.test(after)) {
      from = idx + selector.length;
      continue;
    }
    const braceOpen = stripped.indexOf("{", idx + selector.length);
    if (braceOpen === -1) return null;
    if (stripped.slice(idx + selector.length, braceOpen).includes("}")) {
      from = idx + selector.length;
      continue;
    }
    return blockBody(stripped.slice(idx), /./);
  }
}

const root = blockBody(styles, /^:root\s*\{/m);
const dark = blockBody(styles, /^:root\[data-theme="dark"\]\s*\{/m);

describe("Phase 113 — geometry tokens live in :root", () => {
  it("declares each new geometry/rhythm token with its exact value", () => {
    for (const line of [
      "--btn-icon-size: 16px;",
      "--btn-radius: 9px;",
      "--btn-gap: 6px;",
      "--btn-pad-x: 12px;",
      "--btn-label-size: 12px;",
      "--btn-label-weight: 500;",
      "--btn-h-compact: 32px;",
      "--btn-h-prominent: 40px;",
      "--btn-target-coarse: 44px;",
    ]) {
      expect(root, `:root must declare ${line}`).toContain(line);
    }
  });

  it("keeps the standard and legacy size tokens", () => {
    expect(root).toContain("--btn-h: var(--control-height);");
    expect(root).toContain("--btn-h-sm: 28px;");
    expect(root).toContain("--btn-toolbar-size: var(--btn-h-sm);");
  });
});

describe("Phase 113 — colour tokens in the right theme blocks", () => {
  it("declares the light defaults in :root", () => {
    for (const line of [
      "--btn-primary-bg: #7050D6;",
      "--btn-primary-fg: #FFFFFF;",
      "--btn-primary-hover: #6341C5;",
      "--btn-primary-pressed: #5734B6;",
      "--btn-neutral-pressed: #EAEDF2;",
      "--btn-selected-bg: #F0EBFC;",
      "--btn-selected-fg: #7050D6;",
      "--btn-selected-border: #7050D6;",
      "--btn-danger-fg: #B82E43;",
    ]) {
      expect(root, `:root must declare ${line}`).toContain(line);
    }
  });

  it("declares the dark overrides in the dark block", () => {
    for (const line of [
      "--btn-primary-bg: #B9A4FF;",
      "--btn-primary-fg: #171A21;",
      "--btn-primary-hover: #C5B4FF;",
      "--btn-primary-pressed: #AC94F5;",
      "--btn-neutral-pressed: #303641;",
      "--btn-selected-bg: #302740;",
      "--btn-selected-fg: #B9A4FF;",
      "--btn-selected-border: #B9A4FF;",
      "--btn-danger-fg: #FF9AAD;",
    ]) {
      expect(dark, `dark must declare ${line}`).toContain(line);
    }
  });

  it("does not repaint the app-wide accent tokens from the button layer", () => {
    expect(root).not.toMatch(/--accent:\s*#7050D6/);
  });
});

describe("Phase 113 — the new classes consume the new tokens", () => {
  it(".btn-primary consumes the button primary tokens", () => {
    const body = findRuleBody(styles, ".btn-primary") ?? "";
    expect(body).toContain("var(--btn-primary-bg)");
    expect(body).toContain("var(--btn-primary-fg)");
  });

  it(".btn-toggle[aria-pressed=true] consumes the selected tokens", () => {
    const body = findRuleBody(styles, '.btn-toggle[aria-pressed="true"]') ?? "";
    expect(body).toContain("var(--btn-selected-bg)");
    expect(body).toContain("var(--btn-selected-fg)");
    expect(body).toContain("var(--btn-selected-border)");
  });

  it(".btn-danger is SUBTLE and .btn-danger-commit is SOLID", () => {
    const subtle = findRuleBody(styles, ".btn-danger") ?? "";
    expect(subtle).toContain("background: transparent");
    expect(subtle).toContain("var(--btn-danger-fg)");
    expect(subtle).toContain("color-mix");
    const solid = findRuleBody(styles, ".btn-danger-commit") ?? "";
    expect(solid).toContain("var(--error)");
    expect(solid).toContain("var(--fg-on-accent)");
  });

  it("each density class consumes its target token", () => {
    expect(findRuleBody(styles, ".btn-compact") ?? "").toContain("var(--btn-h-compact)");
    expect(findRuleBody(styles, ".btn-prominent") ?? "").toContain("var(--btn-h-prominent)");
    expect(findRuleBody(styles, ".btn-coarse") ?? "").toContain("var(--btn-target-coarse)");
  });

  it("defines .btn-disclosure and .btn-busy", () => {
    expect(findRuleBody(styles, ".btn-disclosure")).not.toBeNull();
    expect(findRuleBody(styles, ".btn-busy")).not.toBeNull();
  });
});

describe("Phase 113 — no hardcoded motion in the new rules", () => {
  const selectors = [
    ".btn-compact",
    ".btn-prominent",
    ".btn-coarse",
    ".btn-disclosure",
    ".btn-busy",
    ".btn-danger",
    ".btn-danger-commit",
    ".btn-primary",
  ];

  it("declares no literal duration, easing or press scale", () => {
    for (const selector of selectors) {
      const body = findRuleBody(styles, selector) ?? "";
      expect(body).not.toMatch(/\bcubic-bezier\(/);
      expect(body).not.toMatch(/:\s*\d+(\.\d+)?m?s\b/);
      expect(body).not.toMatch(/scale\(0\.\d+\)/);
    }
  });
});