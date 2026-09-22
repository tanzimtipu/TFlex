// DEF-297 — REGRESSION from DEF-285. DEF-285 painted the WHOLE single-mode
// surface `--tf-canvas-opaque` so the gutter beside a zoomed-out page could
// not show the desktop. That also made the full-bleed scroller behind the
// floating frosted chrome a flat opaque sheet, so the top command bar's
// `backdrop-filter` had nothing to diffuse — the operator's "top bar
// transparency is no longer visible in single pdf mode".
//
// DEF-297 confines the opaque paint to the area BELOW the measured chrome
// band in frosted single mode (the workspace frame steps aside again; the
// scroller is transparent behind the bar and opaque from `--tf-chrome-y`
// down). Both rules are guarded here so neither fix can silently undo the
// other.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");
const src = readFileSync(STYLES_PATH, "utf8");

function stripCssComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "");
}

function findRuleBody(s: string, selector: string): string | null {
  const stripped = stripCssComments(s);
  const idx = stripped.indexOf(selector);
  if (idx === -1) return null;
  const braceOpen = stripped.indexOf("{", idx);
  if (braceOpen === -1) return null;
  let depth = 0;
  for (let i = braceOpen; i < stripped.length; i += 1) {
    const ch = stripped[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return stripped.slice(braceOpen + 1, i);
    }
  }
  return null;
}

const DEF285_SELECTOR = '.tab-stage[data-multi-mode="false"] .workspace-main';
const FROSTED_WORKSPACE =
  ':root[data-theme="frosted"] .tab-stage[data-multi-mode="false"] .workspace-main';
const FROSTED_SCROLLER =
  ':root[data-theme="frosted"] .tab-stage[data-multi-mode="false"] .document-scroller';

describe("DEF-297 — the frosted top bar's glass is restored WITHOUT reopening the canvas", () => {
  it("DEF-285's opaque single-mode canvas rule still exists (untouched)", () => {
    const body = findRuleBody(src, DEF285_SELECTOR);
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(/background:\s*var\(--tf-canvas-opaque\)/);
  });

  it("frosted single mode steps the workspace frame aside again (bar glass)", () => {
    const body = findRuleBody(src, FROSTED_WORKSPACE);
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(/background:\s*transparent\s*;/);
  });

  it("the opaque canvas is confined below the measured chrome band", () => {
    const body = findRuleBody(src, FROSTED_SCROLLER);
    expect(body).not.toBeNull();
    // Transparent behind the chrome, opaque from --tf-chrome-y down.
    expect(body ?? "").toMatch(/linear-gradient\(/);
    expect(body ?? "").toMatch(/transparent\s+var\(--tf-chrome-y/);
    expect(body ?? "").toMatch(/var\(--tf-canvas-opaque\)\s+var\(--tf-chrome-y/);
  });

  it("the frosted override wins the cascade (source order after DEF-285)", () => {
    const def285 = stripCssComments(src).indexOf(DEF285_SELECTOR);
    const frosted = stripCssComments(src).indexOf(FROSTED_SCROLLER);
    expect(def285).toBeGreaterThan(-1);
    expect(frosted).toBeGreaterThan(def285);
  });

  it("light/dark keep the opaque single-mode chrome (no frosted leak)", () => {
    // The transparency restore is scoped to the frosted theme only.
    expect(stripCssComments(src)).not.toMatch(
      /:root\[data-theme="(light|dark)"\][^{]*data-multi-mode="false"[^{]*\{[^}]*background:\s*transparent/,
    );
  });
});