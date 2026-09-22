// @vitest-environment node
// Phase 35 — static CSS guards for the two visual contracts this chunk owns:
//
//   1. The caption strip is a FULL-WIDTH drag region except genuinely
//      interactive controls. The DEF-132 design said "the whole bar minus
//      interactive children", but only `.titlebar` actually carried
//      `-webkit-app-region: drag`, so the tab strip's own box was not a drag
//      surface (qa measured the strip as only ~51% draggable). The
//      non-interactive containers now re-declare `drag`; the interactive
//      opt-outs remain.
//
//   2. The window is opaque now. The app's own window radius must MATCH the
//      OS's window corner (Windows 11 ~8px) instead of the old transparent-
//      window 20px, and the frosted base must be an explicit opaque colour
//      rather than a transparent "step aside for the wallpaper" rule.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");
const src = readFileSync(STYLES_PATH, "utf8");

function stripCssComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "");
}

const STRIPPED = stripCssComments(src);

function extractRuleBody(from: number): string {
  const braceOpen = STRIPPED.indexOf("{", from);
  if (braceOpen === -1) return "";
  let depth = 0;
  for (let i = braceOpen; i < STRIPPED.length; i += 1) {
    const ch = STRIPPED[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return STRIPPED.slice(braceOpen + 1, i);
    }
  }
  return "";
}

/** The rule whose selector list contains `anchor` (first occurrence followed
 *  by a `{`), with the full selector text from the previous `}`/`;`. */
function ruleAround(anchor: string): { selector: string; body: string } | null {
  const idx = STRIPPED.indexOf(anchor);
  if (idx === -1) return null;
  const braceOpen = STRIPPED.indexOf("{", idx);
  if (braceOpen === -1) return null;
  let start = braceOpen - 1;
  while (start > 0 && STRIPPED[start] !== "}" && STRIPPED[start] !== ";") start -= 1;
  return { selector: STRIPPED.slice(start + 1, braceOpen), body: extractRuleBody(idx) };
}

const INTERACTIVE_OPT_OUTS = [
  ".app-header .tab,",
  ".app-header .tab-close,",
  ".app-header .tab-new,",
  ".app-header .theme-toggle,",
  ".app-header .theme-toggle-wrap,",
  ".app-header .theme-toggle-popover,",
  ".app-header .update-indicator,",
  ".app-header button,",
];

describe("Phase 35 — caption drag region covers the whole strip", () => {
  it(".titlebar carries the window-drag region", () => {
    const rule = ruleAround(".titlebar {");
    expect(rule).not.toBeNull();
    expect(rule?.selector ?? "").toContain(".titlebar");
    expect(rule?.body ?? "").toMatch(/-webkit-app-region:\s*drag/);
  });

  it("every non-interactive caption container re-declares the drag region", () => {
    const rule = ruleAround(".brand {");
    expect(rule).not.toBeNull();
    const selector = rule?.selector ?? "";
    for (const part of [".titlebar-slot", ".app-header", ".tab-area", ".tab-list", ".brand"]) {
      expect(selector, `drag rule must cover ${part}`).toContain(part);
    }
    expect(rule?.body ?? "").toMatch(/-webkit-app-region:\s*drag/);
  });

  it("the tab strip's empty space is draggable but its tabs are not", () => {
    const strip = ruleAround(".brand {");
    expect(strip?.selector ?? "").toContain(".tab-area");
    expect(strip?.selector ?? "").toContain(".tab-list");
    expect(strip?.body ?? "").toMatch(/-webkit-app-region:\s*drag/);
    const optOuts = ruleAround(".app-header .tab,");
    expect(optOuts?.body ?? "").toMatch(/-webkit-app-region:\s*no-drag/);
  });

  it("keeps the DEF-132 interactive opt-outs (controls, menu, tabs, inputs)", () => {
    const optOuts = ruleAround(".app-header .tab,");
    expect(optOuts).not.toBeNull();
    for (const selector of INTERACTIVE_OPT_OUTS) {
      expect(optOuts?.selector ?? "", `opt-out must list ${selector}`).toContain(selector);
    }
    expect(optOuts?.body ?? "").toMatch(/-webkit-app-region:\s*no-drag/);

    const controls = ruleAround(".titlebar-controls,");
    expect(controls?.selector ?? "").toContain(".titlebar-control");
    expect(controls?.body ?? "").toMatch(/-webkit-app-region:\s*no-drag/);

    const menu = ruleAround(".titlebar-menu-button,");
    expect(menu?.selector ?? "").toContain(".titlebar-menu-popover");
    expect(menu?.body ?? "").toMatch(/-webkit-app-region:\s*no-drag/);

    const fileCapsule = ruleAround(".titlebar-file {");
    expect(fileCapsule?.body ?? "").toMatch(/-webkit-app-region:\s*no-drag/);
  });
});

describe("Phase 35 — opaque-window visual decision", () => {
  it("the window radius matches the OS window corner (8px), not the old 20px", () => {
    expect(src).toMatch(/--radius-window:\s*8px/);
    expect(src).not.toMatch(/--radius-window:\s*20px/);
  });

  it("the frosted shell rounds at the window token and clips; maximized is square", () => {
    const app = ruleAround(':root[data-theme="frosted"] .app {');
    expect(app?.body ?? "").toMatch(/border-radius:\s*var\(--radius-window,\s*8px\)/);
    expect(app?.body ?? "").toMatch(/overflow:\s*clip/);
    const maximized = ruleAround(':root[data-theme="frosted"] .app-maximized');
    expect(maximized?.body ?? "").toMatch(/border-radius:\s*0/);
  });

  it("the frosted base is an explicit opaque colour, not a wallpaper step-aside", () => {
    expect(STRIPPED).not.toMatch(/:root\[data-theme="frosted"\]\s*\{\s*background:\s*transparent/);
    expect(STRIPPED).not.toMatch(/:root\[data-theme="frosted"\]\s+body\s*\{\s*background:\s*transparent/);
    // html + body still paint the themed base so the base never depends on
    // the main-process window colour.
    expect(STRIPPED).toMatch(/html\s*\{\s*background:\s*var\(--bg-base\)/);
    expect(STRIPPED).toMatch(/body\s*\{[^}]*background:\s*var\(--bg-base\)/);
  });
});
