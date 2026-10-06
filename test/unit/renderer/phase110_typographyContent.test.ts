// @vitest-environment node
//
// Phase 110 (chunk C) - the content-surface typography migration.
//
// Chunk A created the Quiet Precision semantic roles in styles.css :root and
// chunk B migrated the chrome. This suite pins the chunk-C application across
// the content surfaces (home, panels, dialogs, command palette, empty states,
// forms and validation): the named supporting-text selectors read
// --tf-text-supporting, the PDF form controls take the body role, no touched
// text selector drops below the 11px compact floor, the numeric readouts keep
// tabular figures, and the on-page move-hint chip keeps its fixed light ink
// (DEF-099) rather than the themeable supporting colour. It parses the
// stylesheet, mirroring phase110_typographyChrome.test.ts.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");

function stripCssComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Extract the body of a rule whose selector is the WHOLE selector on its line. */
function ruleBody(src: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{`).exec(src);
  if (match === null) return "";
  const braceOpen = src.indexOf("{", match.index);
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

/** Read one declaration value out of a rule body. */
function decl(body: string, property: string): string | null {
  const escaped = property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = body.match(new RegExp(`(?:^|;)\\s*${escaped}\\s*:\\s*([^;]+);`));
  return match ? match[1].trim() : null;
}

/** Resolve a font-size (px literal or a known --fs-* / --type-* var) to px. */
const FONT_SIZE_VARS: Readonly<Record<string, number>> = {
  "--fs-xs": 12,
  "--fs-sm": 12,
  "--fs-md": 13,
  "--fs-lg": 16,
  "--fs-xl": 18,
  "--fs-2xl": 32,
  "--type-body-size": 14,
  "--type-helper-size": 12,
  "--type-label-size": 12,
  "--type-panel-size": 16,
  "--type-compact-size": 11,
};

function fontSizePx(value: string | null): number | null {
  if (value === null) return null;
  const px = /^([\d.]+)px$/.exec(value);
  if (px !== null) return Number.parseFloat(px[1]);
  const v = /^var\((--[a-z0-9-]+)\)$/.exec(value);
  if (v !== null && v[1] in FONT_SIZE_VARS) return FONT_SIZE_VARS[v[1]];
  return null;
}

const stripped = stripCssComments(readFileSync(STYLES_PATH, "utf8"));
const SUPPORTING_TEXT = "var(--tf-text-supporting)";

const SUPPORTING_SELECTORS = [
  ".welcome-sub",
  ".home-tools-hint",
  ".welcome-section h3 .count",
  ".recent-row .doc-path",
  ".recent-row .doc-when",
  ".sample-sub",
  ".empty-state-help",
  ".inspector-row-label",
  ".inspector-note",
  ".context-panel-row-label",
  ".modal-hint",
  ".modal-picked .hint",
  ".modal-status .hint",
  ".command-palette-hint",
  ".prefs-hint",
  ".ann-panel-empty .hint",
  ".sig-empty .hint",
  ".validation-notice-detail",
  ".validation-notice-line",
] as const;

describe("Phase 110 (chunk C) - content supporting text by role", () => {
  it("colours every named readable supporting-text selector with the role token", () => {
    for (const selector of SUPPORTING_SELECTORS) {
      const body = ruleBody(stripped, selector);
      expect(body, `${selector} rule not found`).not.toBe("");
      expect(decl(body, "color"), selector).toBe(SUPPORTING_TEXT);
    }
  });

  it("leaves --fg-muted / --fg-faint and the on-page chip ink unedited", () => {
    expect(stripped).toMatch(/--fg-muted\s*:/);
    expect(stripped).toMatch(/--fg-faint\s*:/);
    // The document-icon glyph is never readable supporting text.
    expect(decl(ruleBody(stripped, ".recent-row .doc-icon"), "color")).toBe("var(--fg-muted)");
    // The "double click to edit" chip floats over paper and stays a fixed dark
    // chip with light ink in both themes (DEF-099), so it keeps #f1f5f9.
    expect(decl(ruleBody(stripped, ".content-move-hint"), "color")).toBe("#f1f5f9");
  });
});

describe("Phase 110 (chunk C) - PDF form controls take the body role", () => {
  const BODY = [".form-editor", ".form-textarea", ".form-select"] as const;

  it("sets the body role size / line / weight on every form control", () => {
    for (const selector of BODY) {
      const body = ruleBody(stripped, selector);
      expect(decl(body, "font-size"), selector).toBe("var(--type-body-size)");
      expect(decl(body, "line-height"), selector).toBe("var(--type-body-line)");
      expect(decl(body, "font-weight"), selector).toBe("var(--type-body-weight)");
    }
  });

  it("keeps the control label on its own role rather than the body size", () => {
    expect(decl(ruleBody(stripped, ".form-radio-label"), "font-size")).toBeNull();
  });
});

describe("Phase 110 (chunk C) - floors and tabular figures", () => {
  it("sets no named content text selector below the 11px compact floor", () => {
    const touched = [...SUPPORTING_SELECTORS, ".form-editor", ".form-textarea", ".form-select"];
    for (const selector of touched) {
      const px = fontSizePx(decl(ruleBody(stripped, selector), "font-size"));
      if (px === null) continue;
      expect(px, `${selector}`).toBeGreaterThanOrEqual(11);
    }
  });

  it("keeps tabular figures on the changing document-time readout", () => {
    expect(decl(ruleBody(stripped, ".recent-row .doc-when"), "font-variant-numeric")).toContain(
      "tabular-nums",
    );
  });
});
