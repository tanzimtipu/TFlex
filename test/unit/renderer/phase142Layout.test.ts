// @vitest-environment node
// Static CSS contract for the Phase 14.2 layout polish (fixes 1-6, 8).
//
// Textual scan of styles.css (the established pattern of
// formsCssStacking.test.ts): these are geometry/material contracts a
// jsdom run cannot resolve — pin the rules at the source instead.
//
//   FIX 2 — the ONE panel material: both side panels consume the
//           --panel-* tokens in every theme; frosted re-maps them to
//           the glass card material.
//   FIX 3 — the Open button's capsule paints nothing (single layer).
//   FIX 4/5 — the animated page-view inset: @property + workspace
//           driver + state attributes; the transition never touches
//           the scroller (PDF-safety audit).
//   FIX 8 — the frosted floating margins are the 16px minimum pair.
//   Shell — overflow: clip everywhere (the shell can never scroll).

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
      if (depth === 0) {
        return src.slice(braceOpen + 1, i);
      }
    }
  }
  return "";
}

function findRuleBody(src: string, selector: string): string | null {
  const idx = src.indexOf(selector);
  if (idx === -1) return null;
  return extractRuleBody(src, idx);
}

describe("Phase 14.2 — the ONE panel material contract (FIX 2)", () => {
  const css = stripCssComments(readStyles());

  it("defines the shared --panel-* tokens on :root", () => {
    const rootIdx = css.indexOf(":root {");
    expect(rootIdx).toBeGreaterThan(-1);
    const body = extractRuleBody(css, rootIdx);
    expect(body).toMatch(/--panel-bg:\s*var\(--bg-rail\)/);
    expect(body).toMatch(/--panel-border:\s*var\(--border\)/);
    expect(body).toMatch(/--panel-radius:\s*0px/);
    expect(body).toMatch(/--panel-shadow:\s*none/);
  });

  it("BOTH side panels consume the same tokens (rail and palette cannot drift)", () => {
    const rail = findRuleBody(css, ".side-rail {");
    expect(rail).not.toBeNull();
    expect(rail ?? "").toMatch(/background:\s*var\(--panel-bg\)/);
    expect(rail ?? "").toMatch(/border-right:\s*1px solid var\(--panel-border\)/);
    const palette = findRuleBody(css, ".tools-palette {");
    expect(palette).not.toBeNull();
    expect(palette ?? "").toMatch(/background:\s*var\(--panel-bg\)/);
    expect(palette ?? "").toMatch(/border-left:\s*1px solid var\(--panel-border\)/);
    // Docked panels carry NO floating shadow (the old left-falling
    // palette shadow read as a disconnected island in light/dark).
    expect(palette ?? "").toMatch(/box-shadow:\s*var\(--panel-shadow\)/);
  });

  it("frosted re-maps the panel tokens to the glass card material", () => {
    const m = /:root\[data-theme="frosted"\]\s*\{([\s\S]*?)\n\}/.exec(css);
    expect(m).not.toBeNull();
    const frosted = m?.[1] ?? "";
    expect(frosted).toMatch(/--panel-bg:\s*var\(--glass-sidebar-bg\)/);
    expect(frosted).toMatch(/--panel-border:\s*var\(--glass-sidebar-border\)/);
    expect(frosted).toMatch(/--panel-radius:\s*var\(--tf-radius-panel\)/);
    expect(frosted).toMatch(/--panel-shadow:\s*var\(--glass-shadow\)/);
  });
});

describe("Phase 14.2 — clean single-layer Open button (FIX 3)", () => {
  const css = stripCssComments(readStyles());

  it("the File capsule paints nothing behind the accent button", () => {
    const body = findRuleBody(css, ".toolbar-group.commandbar-group-open {");
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(/background:\s*transparent/);
    expect(body ?? "").toMatch(/border-color:\s*transparent/);
    expect(body ?? "").toMatch(/box-shadow:\s*none/);
    // Hover must not repaint the ghost capsule either.
    const hover = findRuleBody(css, ".toolbar-group.commandbar-group-open:hover {");
    expect(hover ?? "").toMatch(/background:\s*transparent/);
  });

  it("DEF-191 — the clean rules survive the frosted film (specificity re-statement)", () => {
    // The base clean rules are 0-2-0; the frosted glass film rule
    // (:root[data-theme="frosted"] .glass-control-group) is 0-3-0 and
    // its hover variant 0-4-0, so frosted alone painted the ghost
    // capsule back behind the Open button. The frosted re-statement
    // must exist and carry the same clean declarations — at 0-4-0 /
    // 0-5-0 it outranks the film in both states.
    const frosted = findRuleBody(
      css,
      ':root[data-theme="frosted"] .toolbar-group.commandbar-group-open {',
    );
    expect(frosted, "frosted clean-rule re-statement missing").not.toBeNull();
    expect(frosted ?? "").toMatch(/background:\s*transparent/);
    expect(frosted ?? "").toMatch(/border-color:\s*transparent/);
    expect(frosted ?? "").toMatch(/box-shadow:\s*none/);
    const frostedHover = findRuleBody(
      css,
      ':root[data-theme="frosted"] .toolbar-group.commandbar-group-open:hover {',
    );
    expect(frostedHover, "frosted hover re-statement missing").not.toBeNull();
    expect(frostedHover ?? "").toMatch(/background:\s*transparent/);
  });
});

describe("Phase 14.2 — annotation bar is the command-height bar (FIX 1)", () => {
  const css = readStyles();
  const clean = stripCssComments(css);

  it(".ann-toolbar min-height rides the annotation token", () => {
    const body = findRuleBody(css, ".ann-toolbar {");
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(/min-height:\s*var\(--ann-toolbar-h\)/);
    // Same vertical centering + padding rhythm as the command bar.
    expect(body ?? "").toMatch(/align-items:\s*center/);
    expect(body ?? "").toMatch(/padding:\s*var\(--space-small\)\s+var\(--space-standard\)/);
  });

  it("--ann-toolbar-h resolves to the 52px command-bar token", () => {
    const rootIdx = clean.indexOf(":root {");
    const body = extractRuleBody(clean, rootIdx);
    expect(body).toMatch(/--ann-toolbar-h:\s*var\(--chrome-commandbar-h\)/);
    expect(body).toMatch(/--chrome-commandbar-h:\s*52px/);
  });

  it("frosted gives the annotation bar the same full-width band as the command bar", () => {
    const band = findRuleBody(
      clean,
      ':root[data-theme="frosted"] .ann-toolbar {',
    );
    expect(band).not.toBeNull();
    expect(band ?? "").toMatch(
      /margin-left:\s*calc\(-1\s*\*\s*\(220px\s*\+\s*12px\s*\+\s*16px\)\)/,
    );
    expect(band ?? "").toMatch(/margin-right:\s*-16px/);
  });
});

describe("Phase 14.2 — state-driven page view in every theme (FIX 4/5)", () => {
  const css = stripCssComments(readStyles());

  it("html/body/#root and .app are overflow: clip (never a scroll container)", () => {
    const shell = /html,\s*\nbody,\s*\n#root\s*\{([\s\S]*?)\n\}/.exec(css);
    expect(shell).not.toBeNull();
    expect(shell?.[1] ?? "").toMatch(/overflow:\s*clip/);
    const app = findRuleBody(css, ".app {");
    expect(app ?? "").toMatch(/overflow:\s*clip/);
    const frostedApp = findRuleBody(css, ':root[data-theme="frosted"] .app {');
    expect(frostedApp ?? "").toMatch(/overflow:\s*clip/);
    // The shell rules never regress to hidden (hidden boxes are
    // programmatically scrollable — the Phase-14.2 shift bug).
    expect(shell?.[1] ?? "").not.toMatch(/overflow:\s*hidden/);
    expect(app ?? "").not.toMatch(/overflow:\s*hidden/);
    expect(frostedApp ?? "").not.toMatch(/overflow:\s*hidden/);
  });

  it("the open palette drives the inset from .app-main data attributes", () => {
    expect(css).toMatch(/\.app-main\[data-tools-open="true"\]\s*\{/);
    expect(css).toMatch(/\.app-main\[data-tools-open="true"\]\[data-tools-mode="grid"\]/);
    const driver = css.match(/\.app-main\[data-tools-open="true"\]\s*\{([^}]*)\}/);
    expect(driver?.[1] ?? "").toMatch(/--tf-tools-inset:\s*calc\(/);
  });

  it("the scroller consumes the inset with NO transition of its own", () => {
    const scroller = findRuleBody(css, ".document-scroller {");
    expect(scroller ?? "").toMatch(/margin-right:\s*var\(--tf-tools-inset,\s*0px\)/);
    expect(scroller ?? "").not.toMatch(/transition\s*:/);
  });

  it("the panel + page slide shares one 300ms ease-out", () => {
    const rootIdx = css.indexOf(":root {");
    const body = extractRuleBody(css, rootIdx);
    expect(body).toMatch(/--panel-slide-duration:\s*300ms/);
    expect(body).toMatch(/--panel-slide-ease:\s*cubic-bezier\(0\.16,\s*1,\s*0\.3,\s*1\)/);
    const main = findRuleBody(css, ".workspace-main {");
    expect(main ?? "").toMatch(/transition:[\s\S]*--tf-tools-inset/);
  });

  it("DEF-192/193 — .workspace-main inherits the inset (no local declaration)", () => {
    // A declared value beats an inherited one at the same element: the
    // old local `--tf-tools-inset: 0px` on .workspace-main swallowed
    // the .app-main[data-tools-open] driver, so the page never moved
    // while the panel slid in (the "not simultaneous" animation was
    // the same root cause). The grid must carry ONLY the transition.
    const main = findRuleBody(css, ".workspace-main {");
    expect(main, ".workspace-main rule missing").not.toBeNull();
    expect(main ?? "").not.toMatch(/--tf-tools-inset\s*:/);
    // The transition on the inherited token stays (the 300ms tween
    // that keeps panel + page moving together).
    expect(main ?? "").toMatch(/transition:[\s\S]*--tf-tools-inset/);
  });
});

describe("Phase 14.2 — frosted floating margins are the 16px minimum (FIX 8)", () => {
  const css = stripCssComments(readStyles());

  it("the frosted content pads 16px below the chrome stack and above the bottom", () => {
    const bodies = [...css.matchAll(/:root\[data-theme="frosted"\]\s+\.document-content\s*\{([^}]*)\}/g)];
    const body = bodies.at(-1)?.[1] ?? "";
    expect(body).toMatch(
      /padding:\s*calc\(var\(--tf-chrome-y,\s*104px\)\s*\+\s*16px\)\s+0\s+16px/,
    );
  });
});
