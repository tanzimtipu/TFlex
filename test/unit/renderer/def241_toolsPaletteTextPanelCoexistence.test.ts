// @vitest-environment node
// DEF-241 (ADV-057) — the right-anchored Tools palette must never cover
// the docked text-properties panel at narrow widths. These are geometry
// contracts a jsdom run cannot resolve, so pin them at the CSS source
// (the established static-scan pattern).
//
// The coexistence cap: when the text panel is open, --tf-tools-clear is
// the x where the page column starts (rail + panel); the palette and its
// floating badge cap themselves to that edge, so at 640px they overlay
// ONLY the page column instead of the panel's controls.

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

function extractRuleBody(src: string, selectorIndex: number): string {
  const braceOpen = src.indexOf("{", selectorIndex);
  if (braceOpen === -1) return "";
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

function findRuleBody(src: string, selector: string): string | null {
  const stripped = stripCssComments(src);
  let from = 0;
  for (;;) {
    const idx = stripped.indexOf(selector, from);
    if (idx === -1) return null;
    let cursor = idx + selector.length;
    while (cursor < stripped.length && /\s/.test(stripped[cursor] ?? "")) cursor += 1;
    if (stripped[cursor] === "{") return extractRuleBody(stripped, idx);
    from = idx + selector.length;
  }
}

const CSS = readStyles();
const CLEAN = stripCssComments(CSS);
const ACTIVE_PANEL = '.tab-pane[aria-hidden="false"] .workspace[data-text-panel-open="true"]';

describe("DEF-241 — Tools palette vs docked text-properties panel", () => {
  it("declares ONE text-panel width token and resolves the grid track from it", () => {
    expect(CLEAN).toMatch(/--text-panel-w:\s*248px/);
    const open = findRuleBody(CLEAN, '.workspace[data-text-panel-open="true"]');
    expect(open).not.toBeNull();
    expect(open ?? "").toMatch(/--tf-text-w:\s*var\(--text-panel-w\)/);
  });

  it("drives --tf-tools-clear from the ACTIVE pane's open panel (rail + panel)", () => {
    const idx = CLEAN.indexOf(`.app-main:has(${ACTIVE_PANEL})`);
    expect(idx, "coexistence driver rule missing").toBeGreaterThan(-1);
    const body = extractRuleBody(CLEAN, idx);
    expect(body).toMatch(
      /--tf-tools-clear:\s*calc\(var\(--tf-rail-w\)\s*\+\s*var\(--text-panel-w\)\)/,
    );
  });

  it("caps the palette's left edge at the page column and drops the 320px floor only then", () => {
    const idx = CLEAN.indexOf(`.app-main:has(${ACTIVE_PANEL}) .tools-palette`);
    expect(idx, "palette cap rule missing").toBeGreaterThan(-1);
    const body = extractRuleBody(CLEAN, idx);
    expect(body).toMatch(/min-width:\s*0/);
    expect(body).toMatch(/max-width:\s*calc\(100%\s*-\s*var\(--tf-tools-clear,\s*0px\)\)/);
    // The cap must sit AFTER the Phase-14 max-width/min-width rule in
    // source order, or it would lose the same-specificity tie.
    const phase14 = CLEAN.indexOf("min-width: 320px");
    expect(phase14).toBeGreaterThan(-1);
    expect(idx).toBeGreaterThan(phase14);
  });

  it("caps the floating Tools badge identically so it cannot drift into the panel", () => {
    // The badge has a base rule (right: var(--tools-panel-w)) and the
    // DEF-241 override; scan for the min() form in a badge block.
    expect(CLEAN).toMatch(
      /\.tools-badge-tracker-open\s*\{[^}]*right:\s*min\(/,
    );
    expect(CLEAN).toMatch(
      /\.tools-badge-tracker-open\s*\{[^}]*var\(--tf-tools-clear,\s*0px\)/,
    );
  });

  it("keys the compact narrow-palette rule off the palette's own width", () => {
    expect(CLEAN).toMatch(/\.tools-palette\s*\{[^}]*container-type:\s*inline-size/);
    expect(CLEAN).toMatch(/@container\s*\(max-width:\s*343px\)/);
    const containerIdx = CLEAN.indexOf("@container (max-width: 343px)");
    expect(containerIdx).toBeGreaterThan(-1);
    expect(extractRuleBody(CLEAN, containerIdx)).toMatch(
      /\.tools-palette-entry-shortcut\s*\{[^}]*display:\s*none/,
    );
  });

  it("keeps both palette transition groups carrying the max-width channel", () => {
    const base = findRuleBody(CSS, ".tools-palette");
    expect(base ?? "").toMatch(/max-width var\(--motion-duration-panel\)/);
    const frosted = findRuleBody(CSS, ':root[data-theme="frosted"] .tools-palette');
    expect(frosted ?? "").toMatch(/max-width var\(--motion-duration-panel\)/);
    // The frosted group still re-states the DEF-233 backdrop channel.
    expect(frosted ?? "").toMatch(/backdrop-filter var\(--tf-motion-normal\)/);
  });
});
