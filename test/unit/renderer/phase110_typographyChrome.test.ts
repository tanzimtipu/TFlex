// @vitest-environment node
//
// Phase 110 (chunk B) - the chrome-surface typography migration.
//
// Chunk A created the Quiet Precision semantic roles in styles.css :root. This
// suite pins the chunk-B application of those roles across the chrome surfaces:
// numeric readouts carry tabular figures, the named supporting-text selectors
// read --tf-text-supporting, the toast body takes the helper role line-height,
// and the stage rail keeps the documented 11px compact exception. It parses the
// stylesheet (mirroring phase107_paperStage.test.ts) so a regression fails here,
// not only in a screenshot review.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");

function stripCssComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** Extract the body of a rule whose selector is the WHOLE selector on its line
 *  (anchored after a newline), so `.page-total` never matches
 *  `.view-strip .page-total`. */
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

const stripped = stripCssComments(readFileSync(STYLES_PATH, "utf8"));

const SUPPORTING_TEXT = "var(--tf-text-supporting)";

describe("Phase 110 (chunk B) - chrome numeric readouts are tabular", () => {
  it("adds tabular figures to the page total on the toolbar and view strip", () => {
    expect(decl(ruleBody(stripped, ".page-total"), "font-variant-numeric")).toContain("tabular-nums");
    expect(
      decl(ruleBody(stripped, ".view-strip .page-total"), "font-variant-numeric"),
    ).toContain("tabular-nums");
  });

  it("keeps tabular figures on the existing numeric readouts", () => {
    const tabular = [
      ".page-input",
      ".page-label-hint",
      ".zoom-percent",
      ".view-strip .zoom-percent",
    ];
    for (const selector of tabular) {
      expect(decl(ruleBody(stripped, selector), "font-variant-numeric"), selector).toContain(
        "tabular-nums",
      );
    }
  });
});

describe("Phase 110 (chunk B) - supporting-text colour by role", () => {
  const SUPPORTING = [
    ".page-total",
    ".view-strip .page-total",
    ".toast-text",
    ".action-dock-tools-label",
  ];

  it("colours the named readable supporting-text selectors with the role token", () => {
    for (const selector of SUPPORTING) {
      expect(decl(ruleBody(stripped, selector), "color"), selector).toBe(SUPPORTING_TEXT);
    }
  });

  it("leaves --fg-muted itself unedited and keeps it off icon/decorative rules", () => {
    // --fg-muted is still declared per theme; the migration only repointed the
    // named readable-text selectors.
    expect(stripped).toMatch(/--fg-muted\s*:/);
    // The document-icon rule is a glyph, never readable supporting text, so it
    // keeps its muted ink and was NOT recoloured.
    expect(decl(ruleBody(stripped, ".recent-row .doc-icon"), "color")).toBe("var(--fg-muted)");
  });
});

describe("Phase 110 (chunk B) - role line-heights and the compact exception", () => {
  it("gives the toast body the helper role line-height", () => {
    expect(decl(ruleBody(stripped, ".toast-text"), "line-height")).toBe("var(--type-helper-line)");
  });

  it("keeps structural single-line line-height on the menu label", () => {
    expect(decl(ruleBody(stripped, ".titlebar-menu-label"), "line-height")).toBe("1");
  });

  it("keeps the stage-rail label as the documented 11px compact role", () => {
    const body = ruleBody(stripped, ".stage-rail-label");
    expect(decl(body, "font-size")).toBe("var(--type-compact-size)");
    expect(decl(body, "line-height")).toBe("var(--type-compact-line)");
  });

  it("sets no touched chrome selector below the 11px compact floor", () => {
    const touched = [
      ".page-total",
      ".view-strip .page-total",
      ".toast-text",
      ".titlebar-menu-label",
      ".action-dock-tools-label",
      ".action-dock-label",
      ".stage-rail-label",
    ];
    for (const selector of touched) {
      const size = decl(ruleBody(stripped, selector), "font-size");
      if (size === null) continue;
      const px = /^([\d.]+)px$/.exec(size);
      if (px !== null) {
        expect(Number.parseFloat(px[1]), `${selector} ${size}`).toBeGreaterThanOrEqual(11);
      }
    }
  });
});