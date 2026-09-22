// DEF-294 — the thumbnail page-view header's TOP-RIGHT corner must be flush
// (square). The header element itself declares no radius, but it is the top
// row inside a rounded `overflow: hidden` panel: single mode `.side-rail`
// (16px) and Multi Mode `.pane-thumb-strip` (16px) clipped the header corner
// round. The fix squares the CONTAINER's top corner(s), so the header row —
// and the strip body that replaced it in Multi Mode (DEF-291) — reads flush.
//
// Static CSS guard in the style of the def282 / def285 guards: a revert to
// the four-value radii fails.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");

function stripCssComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "");
}

function findRuleBody(src: string, selector: string): string | null {
  const stripped = stripCssComments(src);
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

/** The four `border-radius` corner lengths, in TL TR BR BL order. */
function radii(body: string): string[] {
  const m = /border-radius:\s*([^;]+);/.exec(body);
  if (m === null) return [];
  return (m[1] ?? "").trim().split(/\s+/);
}

const src = readFileSync(STYLES_PATH, "utf8");

describe("DEF-294 — the thumbnail panel's top corner is flush", () => {
  it("single mode: .side-rail top-right is square, bottom-right still rounds", () => {
    const body = findRuleBody(src, ".side-rail {");
    expect(body).not.toBeNull();
    const r = radii(body ?? "");
    expect(r[0]).toBe("0"); // top-left (window edge)
    expect(r[1]).toBe("0"); // top-right — the header corner
    expect(r[2]).toBe("var(--panel-radius)"); // bottom-right (page-facing)
    expect(r[3]).toBe("0"); // bottom-left (window edge)
    expect(body ?? "").not.toMatch(/border-radius:\s*0 var\(--panel-radius\) var\(--panel-radius\) 0/);
  });

  it("Multi Mode pane B strip: top-right square, bottom-right rounds", () => {
    const body = findRuleBody(src, ".pane-thumb-strip {");
    expect(body).not.toBeNull();
    const r = radii(body ?? "");
    expect(r[1]).toBe("0");
    expect(r[2]).toBe("var(--panel-radius)");
  });

  it("Multi Mode pane A strip (mirrored): top-left square, bottom-left rounds", () => {
    const body = findRuleBody(src, '.workspace[data-rail-side="right"] .pane-thumb-strip {');
    expect(body).not.toBeNull();
    const r = radii(body ?? "");
    expect(r[0]).toBe("0");
    expect(r[3]).toBe("var(--panel-radius)");
    expect(r[1]).toBe("0");
    expect(r[2]).toBe("0");
  });

  it("frosted's rail clip no longer rounds a top corner", () => {
    // The frosted rail keeps `overflow: hidden` (its ::after sheen is
    // clipped), but with a square top-right there is nothing to round.
    const clean = stripCssComments(src).replace(/\r\n/g, "\n");
    const anchor =
      ':root[data-theme="frosted"] .toolbar,\n' +
      ':root[data-theme="frosted"] .search-bar,\n' +
      ':root[data-theme="frosted"] .side-rail {';
    const idx = clean.indexOf(anchor);
    expect(idx).toBeGreaterThan(-1);
    expect(clean.slice(idx, idx + 200)).toMatch(/overflow:\s*hidden\s*;/);
  });
});