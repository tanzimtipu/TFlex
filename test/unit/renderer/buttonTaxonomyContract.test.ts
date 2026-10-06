// @vitest-environment jsdom
// Phase 91 — the button taxonomy contract.
//
// Pins docs/BUTTON-SYSTEM.md to the shipped CSS: every category class named in
// the doc must exist in src/renderer/styles.css, must consume its documented
// tokens, and must define its states with motion tokens only (no hardcoded
// duration/easing/press scale). Reads the source directly, mirroring
// bug014_saveIconAccent.test.tsx.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "../../..");
const STYLES_PATH = resolve(REPO_ROOT, "src/renderer/styles.css");
const DOC_PATH = resolve(REPO_ROOT, "docs/BUTTON-SYSTEM.md");

const styles = readFileSync(STYLES_PATH, "utf8");
const doc = readFileSync(DOC_PATH, "utf8");

function stripCssComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "");
}

function extractRuleBody(src: string, braceOpen: number): string {
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

/** Find the rule body whose selector list includes `selector`. Handles
 *  comma-separated selector lists and rejects prefix-only matches such as
 *  `.btn-segmented` inside `.btn-segmented-item`. */
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
    return extractRuleBody(stripped, braceOpen);
  }
}

const VARIANT_SELECTORS = [
  ".btn-primary",
  ".btn-secondary",
  ".btn-ghost",
  ".btn-danger",
  ".btn-danger-commit",
  ".btn-icon",
  ".btn-toolbar",
  ".btn-toggle",
  ".btn-disclosure",
  ".btn-sm",
  ".btn-compact",
  ".btn-prominent",
  ".btn-coarse",
  ".btn-busy",
  ".btn-segmented",
  ".btn-segmented-item",
] as const;

describe("Phase 91 — button tokens exist and resolve", () => {
  it("declares the geometry/rhythm tokens", () => {
    expect(styles).toMatch(/--btn-h:\s*var\(--control-height\)/);
    expect(styles).toMatch(/--btn-h-sm:\s*28px/);
    expect(styles).toMatch(/--btn-toolbar-size:\s*var\(--btn-h-sm\)/);
    expect(styles).toMatch(/--btn-icon-size:\s*16px/);
    expect(styles).toMatch(/--btn-radius:\s*9px/);
    expect(styles).toMatch(/--btn-gap:\s*6px/);
  });

  it("declares the Phase 113 geometry/rhythm additions", () => {
    expect(styles).toMatch(/--btn-pad-x:\s*12px/);
    expect(styles).toMatch(/--btn-label-size:\s*12px/);
    expect(styles).toMatch(/--btn-label-weight:\s*500/);
    expect(styles).toMatch(/--btn-h-compact:\s*32px/);
    expect(styles).toMatch(/--btn-h-prominent:\s*40px/);
    expect(styles).toMatch(/--btn-target-coarse:\s*44px/);
  });

  it("declares the button-scoped Quiet Actions colour tokens (light + dark)", () => {
    expect(styles).toMatch(/--btn-primary-bg:\s*#7050D6/);
    expect(styles).toMatch(/--btn-primary-fg:\s*#FFFFFF/);
    expect(styles).toMatch(/--btn-primary-hover:\s*#6341C5/);
    expect(styles).toMatch(/--btn-primary-pressed:\s*#5734B6/);
    expect(styles).toMatch(/--btn-neutral-pressed:\s*#EAEDF2/);
    expect(styles).toMatch(/--btn-selected-bg:\s*#F0EBFC/);
    expect(styles).toMatch(/--btn-selected-fg:\s*#7050D6/);
    expect(styles).toMatch(/--btn-selected-border:\s*#7050D6/);
    expect(styles).toMatch(/--btn-danger-fg:\s*#B82E43/);
    expect(styles).toMatch(/--btn-primary-bg:\s*#B9A4FF/);
    expect(styles).toMatch(/--btn-primary-fg:\s*#171A21/);
    expect(styles).toMatch(/--btn-primary-hover:\s*#C5B4FF/);
    expect(styles).toMatch(/--btn-primary-pressed:\s*#AC94F5/);
    expect(styles).toMatch(/--btn-neutral-pressed:\s*#303641/);
    expect(styles).toMatch(/--btn-selected-bg:\s*#302740/);
    expect(styles).toMatch(/--btn-selected-fg:\s*#B9A4FF/);
    expect(styles).toMatch(/--btn-selected-border:\s*#B9A4FF/);
    expect(styles).toMatch(/--btn-danger-fg:\s*#FF9AAD/);
  });

  it("defines the previously-missing --error-hover token derived from --error", () => {
    expect(styles).toMatch(/--error-hover:\s*color-mix\(in srgb,\s*var\(--error\)/);
  });

  it("keeps the solid destructive-commit hover free of a fallback literal", () => {
    const body = findRuleBody(
      styles,
      '.btn-danger-commit:hover:not([disabled]):not([aria-disabled="true"])',
    );
    expect(body).not.toBeNull();
    expect(body ?? "").toContain("var(--error-hover)");
    expect(body ?? "").not.toContain("#b91c1c");
    expect(body ?? "").not.toMatch(/var\(--error-hover\s*,/);
  });

  it("makes .btn-danger the subtle treatment (transparent fill, token ink)", () => {
    const body = findRuleBody(styles, ".btn-danger") ?? "";
    expect(body).toContain("background: transparent");
    expect(body).toContain("var(--btn-danger-fg)");
    expect(body).toContain("color-mix");
  });
});

describe("Phase 91 — the .btn family consumes the documented tokens", () => {
  it(".btn base takes its geometry and motion from tokens", () => {
    const match = stripCssComments(styles).match(/\.btn\s*\{([\s\S]*?)\}/);
    expect(match).not.toBeNull();
    const body = match?.[1] ?? "";
    expect(body).toContain("height: var(--btn-h)");
    expect(body).toContain("border-radius: var(--btn-radius)");
    expect(body).toContain("gap: var(--btn-gap)");
    expect(body).toContain("var(--motion-duration-fast)");
    expect(body).toContain("var(--motion-ease-standard)");
  });

  for (const selector of VARIANT_SELECTORS) {
    it(`${selector} is defined with a non-empty rule`, () => {
      const body = findRuleBody(styles, selector);
      expect(body, `missing rule for ${selector}`).not.toBeNull();
      expect((body ?? "").trim().length).toBeGreaterThan(0);
    });
  }

  it(".btn-icon is square from --btn-h (and --btn-h-sm when small)", () => {
    const body = findRuleBody(styles, ".btn-icon") ?? "";
    expect(body).toContain("var(--btn-h)");
    const small = findRuleBody(styles, ".btn-icon.btn-sm") ?? "";
    expect(small).toContain("var(--btn-h-sm)");
  });

  it(".btn-toolbar is sized by --btn-toolbar-size", () => {
    const body = findRuleBody(styles, ".btn-toolbar") ?? "";
    expect(body).toContain("var(--btn-toolbar-size)");
  });

  it(".btn-sm takes its height from --btn-h-sm", () => {
    const body = findRuleBody(styles, ".btn-sm") ?? "";
    expect(body).toContain("var(--btn-h-sm)");
  });

  it(".btn-toggle drives its selected state from the selected tokens", () => {
    const body = findRuleBody(styles, '.btn-toggle[aria-pressed="true"]') ?? "";
    expect(body).toContain("var(--btn-selected-bg)");
    expect(body).toContain("var(--btn-selected-fg)");
    expect(body).toContain("var(--btn-selected-border)");
  });

  it("each density class consumes its target token", () => {
    expect(findRuleBody(styles, ".btn-compact") ?? "").toContain("var(--btn-h-compact)");
    expect(findRuleBody(styles, ".btn-prominent") ?? "").toContain("var(--btn-h-prominent)");
    expect(findRuleBody(styles, ".btn-coarse") ?? "").toContain("var(--btn-target-coarse)");
  });

  it(".btn-disclosure is chrome-neutral with an expanded hook", () => {
    const body = findRuleBody(styles, ".btn-disclosure") ?? "";
    expect(body).toContain("background: transparent");
    const expanded = findRuleBody(styles, '.btn-disclosure[aria-expanded="true"]') ?? "";
    expect(expanded).toContain("var(--btn-selected-bg)");
  });

  it(".btn-segmented owns the outer radius and items are square", () => {
    const group = findRuleBody(styles, ".btn-segmented") ?? "";
    expect(group).toContain("var(--btn-radius)");
    const item = findRuleBody(styles, ".btn-segmented-item") ?? "";
    expect(item).toMatch(/border-radius:\s*0/);
  });

  it(".btn disabled states are dimmed with a not-allowed cursor", () => {
    const body = findRuleBody(styles, ".btn[disabled]") ?? "";
    expect(body).toContain("cursor: not-allowed");
    expect(body).toContain("opacity");
  });
});

describe("Phase 91 — no hardcoded motion in the button family", () => {
  const bodies = [
    stripCssComments(styles).match(/\.btn\s*\{([\s\S]*?)\}/)?.[1] ?? "",
    ...VARIANT_SELECTORS.map((s) => findRuleBody(styles, s) ?? ""),
    findRuleBody(styles, '.btn-toggle[aria-pressed="true"]') ?? "",
  ];

  it("declares no literal duration, easing or press scale", () => {
    for (const body of bodies) {
      expect(body).not.toMatch(/\bcubic-bezier\(/);
      expect(body).not.toMatch(/:\s*\d+(\.\d+)?m?s\b/);
      expect(body).not.toMatch(/scale\(0\.\d+\)/);
    }
  });
});

describe("Phase 91 — the taxonomy document is pinned to the CSS", () => {
  it("names every canonical class", () => {
    for (const cls of [
      ".btn",
      ".btn-primary",
      ".btn-secondary",
      ".btn-ghost",
      ".btn-danger",
      ".btn-danger-commit",
      ".btn-icon",
      ".btn-toolbar",
      ".btn-toggle",
      ".btn-disclosure",
      ".btn-sm",
      ".btn-compact",
      ".btn-prominent",
      ".btn-coarse",
      ".btn-busy",
      ".btn-segmented",
      ".btn-segmented-item",
    ]) {
      expect(doc, `doc must name ${cls}`).toContain(cls);
    }
  });

  it("defines every required category", () => {
    for (const category of [
      "Primary",
      "Secondary",
      "Ghost",
      "Icon-only",
      "Toolbar",
      "Destructive",
      "Toggle",
      "Segmented",
      "Disclosure",
      "Density",
      "Busy",
    ]) {
      expect(doc, `doc must define ${category}`).toContain(category);
    }
  });

  it("names every button token it consumes", () => {
    for (const token of [
      "--btn-h",
      "--btn-h-sm",
      "--btn-toolbar-size",
      "--btn-icon-size",
      "--btn-radius",
      "--btn-gap",
      "--btn-pad-x",
      "--btn-label-size",
      "--btn-label-weight",
      "--btn-h-compact",
      "--btn-h-prominent",
      "--btn-target-coarse",
      "--btn-primary-bg",
      "--btn-primary-fg",
      "--btn-primary-hover",
      "--btn-primary-pressed",
      "--btn-neutral-pressed",
      "--btn-selected-bg",
      "--btn-selected-fg",
      "--btn-selected-border",
      "--btn-danger-fg",
      "--error-hover",
      "--motion-duration-fast",
      "--motion-ease-standard",
      "--motion-scale-press",
    ]) {
      expect(doc, `doc must name ${token}`).toContain(token);
    }
  });

  it("states the accessible-name, focus, toggle, disclosure and group contracts", () => {
    expect(doc).toContain("aria-label");
    expect(doc).toContain("title");
    expect(doc).toContain("aria-pressed");
    expect(doc).toContain("aria-expanded");
    expect(doc).toContain("aria-busy");
    expect(doc).toContain('role="group"');
    expect(doc).toContain("--focus-ring");
  });
});
