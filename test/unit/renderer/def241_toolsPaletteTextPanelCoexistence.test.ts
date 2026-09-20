// @vitest-environment node
// DEF-241 (ADV-057) — RETIRED by Phase 25.
//
// DEF-241 existed because the text-properties panel was a DOCKED grid
// column the right-anchored Tools palette could cover at narrow widths,
// so the palette and its badge capped themselves at --tf-tools-clear
// (rail + panel). Phase 25 makes the panel a floating card over the page
// view: it takes no column, so there is nothing for the palette to cover
// and the whole coexistence apparatus is gone. These pins are the
// retirement contract — the cap driver, the open-column rule and the
// badge override must NOT come back, and the palette keeps its
// unconditional Phase-14 sizing.

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

function findRuleBody(src: string, selector: string): string | null {
  const stripped = stripCssComments(src);
  const idx = stripped.indexOf(selector);
  if (idx === -1) return null;
  const braceOpen = stripped.indexOf("{", idx);
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

const CSS = readStyles();
const CLEAN = stripCssComments(CSS);

describe("Phase 25 — the DEF-241 coexistence apparatus is retired", () => {
  it("no rule drives --tf-tools-clear any more", () => {
    expect(CLEAN).not.toMatch(/--tf-tools-clear\s*:/);
    expect(CLEAN).not.toMatch(/var\(--tf-tools-clear/);
  });

  it("no rule keys the palette or its badge off data-text-panel-open", () => {
    expect(CLEAN).not.toMatch(/data-text-panel-open[^{]*\.tools-palette/);
    expect(CLEAN).not.toMatch(/data-text-panel-open[^{]*\.tools-badge/);
  });

  it("the palette keeps its unconditional Phase-14 sizing", () => {
    // The "dynamic width bounds" rule (344/380px, capped at the window).
    expect(CLEAN).toMatch(
      /\.tools-palette\s*\{[^}]*min-width:\s*320px[^}]*max-width:\s*calc\(100vw\s*-\s*24px\)/,
    );
  });

  it("the floating Tools badge keeps its base --tools-panel-w offset", () => {
    const badge = findRuleBody(CLEAN, ".tools-badge-tracker-open");
    expect(badge).not.toBeNull();
    expect(badge ?? "").toMatch(/right:\s*var\(--tools-panel-w,\s*344px\)/);
    expect(badge ?? "").not.toMatch(/min\(/);
  });

  it("the narrow-palette container safeguard survives", () => {
    expect(CLEAN).toMatch(/\.tools-palette\s*\{[^}]*container-type:\s*inline-size/);
    expect(CLEAN).toMatch(/@container\s*\(max-width:\s*343px\)/);
  });
});
