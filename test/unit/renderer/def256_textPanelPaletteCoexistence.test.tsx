// DEF-256 — at 640px the Tools palette covered the text-properties card
// (font + colour controls unreachable), a regression of the DEF-241
// coexistence contract after the Phase-25 float conversion.
//
// Phase 38 (feature C) SUPERSEDES the drag half of DEF-256: the card no
// longer floats and no longer drags, so the drag-clamp cases are retired.
// What remains pinned here is the stylesheet relation only:
//   1. styles.css reserves a LEFT SLOT for the panel (--tf-text-slot = panel
//      width + left inset + gutter) and the palette + its floating badge cap
//      their left edge at that slot's right edge; the Phase-14 base sizing
//      rules stay intact (the DEF-241 retirement pins still hold).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TEXT_PANEL_PALETTE_GAP } from "../../../src/renderer/edit/TextPropertiesPanel";

const STYLES = readFileSync(resolve(__dirname, "../../../src/renderer/styles.css"), "utf8");
const CLEAN = STYLES.replace(/\/\*[\s\S]*?\*\//g, "");
const FLOAT_SELECTOR = ".app-main:has(.tab-pane[aria-hidden=\"false\"] .text-props-panel)";

describe("DEF-256 — styles.css reserves the panel's left slot for the palette", () => {
  it("the coexistence rule caps the palette at the slot's right edge", () => {
    const rule = new RegExp(
      `${FLOAT_SELECTOR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}` +
        `\\s*\\.tools-palette\\s*\\{[^}]*min-width:\\s*0[^}]*` +
        `max-width:\\s*calc\\(100%\\s*-\\s*var\\(--tf-rail-w[^)]*\\)[^)]*-\\s*var\\(--tf-text-slot`,
    );
    expect(CLEAN).toMatch(rule);
  });

  it("the reserved slot is derived from the panel's width, inset and gutter", () => {
    const slot = /--tf-text-slot:\s*calc\(\s*var\(--text-panel-w,[^)]*\)\s*\+\s*var\(--text-panel-left,[^)]*\)\s*\+\s*var\(--text-panel-gap,[^)]*\)/;
    expect(CLEAN).toMatch(slot);
    expect(CLEAN).toMatch(/--text-panel-left:\s*12px/);
    expect(CLEAN).toMatch(new RegExp(`--text-panel-gap:\\s*${TEXT_PANEL_PALETTE_GAP}px`));
    // The badge tab's width is a token, not a duplicated magic number.
    expect(CLEAN).toMatch(/\.tools-badge-tracker\s*\{[^}]*width:\s*var\(--tools-badge-w/);
  });

  it("the floating badge caps identically at the same edge", () => {
    const badge =
      `${FLOAT_SELECTOR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}` +
      "\\s*\\.tools-badge-tracker-open\\s*\\{[^}]*right:\\s*min\\(";
    expect(CLEAN).toMatch(new RegExp(badge));
  });

  it("the Phase-25 base sizing + the DEF-241 retirement pins still hold", () => {
    // Base (unconditional) palette sizing untouched.
    expect(CLEAN).toMatch(
      /\.tools-palette\s*\{[^}]*min-width:\s*320px[^}]*max-width:\s*calc\(100vw\s*-\s*24px\)/,
    );
    // The coexistence rule is keyed off the mounted panel, not the state marker.
    expect(CLEAN).not.toMatch(/data-text-panel-open[^{]*\.tools-palette/);
    // The retired DEF-241 token does not come back.
    expect(CLEAN).not.toMatch(/--tf-tools-clear\s*:/);
    // The base badge rule keeps its plain --tools-panel-w offset.
    const idx = CLEAN.indexOf(".tools-badge-tracker-open");
    const body = CLEAN.slice(CLEAN.indexOf("{", idx) + 1, CLEAN.indexOf("}", idx));
    expect(body).toMatch(/right:\s*var\(--tools-panel-w,\s*344px\)/);
    expect(body).not.toMatch(/min\(/);
  });
});
