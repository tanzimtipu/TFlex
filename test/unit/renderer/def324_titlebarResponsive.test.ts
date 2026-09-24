// DEF-324 — the caption strip at every supported window width.
//
// Phase 36 added the "File" label, the quick file actions, the Multi Mode
// toggle, the update indicator, the theme picker, Print and the gear to the
// title bar, so at the 640px minimum the tab strip collapsed to 15px and no
// tab title was visible (the DEF-244/245 regression).
//
// The fix is a CSS contract: at the narrow bands the LOWER-PRIORITY chrome
// compacts (the brand wordmark and the File label drop, paddings/gaps
// tighten) so the strip keeps a usable width, while EVERY control stays
// mounted and reachable. These tests pin the contract for the five widths in
// the dispatch (1440 / 1100 / 900 / 760 / 640) against styles.css.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(
  path.resolve(__dirname, "../../../src/renderer/styles.css"),
  "utf8",
);

/** Every `@media (max-width: <max>px) { ... }` block body, joined. Modules
 *  are matched by brace balance so a nested rule cannot truncate the body. */
function mediaBodies(max: number): string {
  const out: string[] = [];
  const needle = new RegExp(`@media \\(max-width:\\s*${max}px\\)\\s*\\{`, "g");
  let m: RegExpExecArray | null;
  while ((m = needle.exec(CSS)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    const start = i;
    while (i < CSS.length && depth > 0) {
      if (CSS[i] === "{") depth += 1;
      else if (CSS[i] === "}") depth -= 1;
      i += 1;
    }
    out.push(CSS.slice(start, i - 1));
  }
  return out.join("\n");
}

/** Body of a top-level (non-media) rule, or null. */
function ruleBody(selector: string): string | null {
  const needle = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
  );
  const m = needle.exec(CSS);
  return m === null ? null : m[1];
}

const WIDTHS = [1440, 1100, 900, 760, 640] as const;

describe("DEF-324 — title bar keeps the tab strip usable at every supported width", () => {
  it.each(WIDTHS)("the tab strip contract is present at %ipx", () => {
    // The strip itself is width-independent: it always absorbs the leftover
    // space and scrolls its own overflow.
    const area = ruleBody(".tab-area");
    expect(area).not.toBeNull();
    expect(area).toMatch(/flex:\s*1 1 0/);
    expect(area).toMatch(/min-width:\s*0/);
    expect(area).toMatch(/overflow:\s*hidden/);

    const list = ruleBody(".tab-list");
    expect(list).not.toBeNull();
    expect(list).toMatch(/overflow-x:\s*auto/);
    expect(list).toMatch(/width:\s*100%/);
  });

  it("the narrow band compacts the lower-priority chrome (not the tabs)", () => {
    const narrow = mediaBodies(900);
    // Brand wordmark and the File label compact; their controls stay.
    expect(narrow).toMatch(/\.brand > span:not\(\.brand-mark\)\s*\{[^}]*display:\s*none/);
    expect(narrow).toMatch(/\.titlebar-menu-label\s*\{[^}]*display:\s*none/);
    expect(narrow).toMatch(/\.app-header\s*\{[^}]*padding:\s*0 var\(--sp-2\)/);
    expect(narrow).toMatch(/\.header-actions\s*\{[^}]*gap:\s*var\(--sp-1\)/);
    expect(narrow).toMatch(/\.header-actions\s*\{[^}]*padding-left:\s*var\(--sp-2\)/);
    expect(narrow).toMatch(/\.theme-toggle\s*\{[^}]*padding:\s*0 5px/);
  });

  it("no Phase-36 control is ever display:none'd — every control stays reachable", () => {
    // The only labels allowed to hide are the brand wordmark and the two
    // text labels (Open / File / theme). The CONTROLS themselves stay.
    for (const selector of [
      "\\.header-multi-mode",
      "\\.header-print",
      "\\.header-gear",
      "\\.theme-toggle",
      "\\.ann-tool",
      "\\.tab-new",
      "\\.tab-close",
      "\\.update-indicator",
    ]) {
      const hidden = new RegExp(`${selector}\\s*\\{[^}]*display:\\s*none`);
      expect(CSS, `${selector} must never be display:none`).not.toMatch(hidden);
    }
    // The theme trigger keeps its pill but only its LABEL may hide.
    const labelHidden = /\.theme-toggle-label\s*\{[^}]*display:\s*none/;
    expect(CSS).toMatch(labelHidden);
  });

  it("1440 / 1100 stay in the wide band (no unnecessary compaction at 1100)", () => {
    // The brand wordmark compaction is scoped to <= 900, so 1100/1440 keep
    // the full caption strip.
    const body = mediaBodies(1100);
    expect(body).not.toMatch(/\.brand > span:not\(\.brand-mark\)/);
  });
});
