// @vitest-environment node
// Static CSS guard for Bug 17 — theme toggle + Open buttons must
// be right-aligned in the title bar.
//
// DEF-085 revisited: the original fix pinned `margin-left: auto` on
// .header-actions. That looked correct but did nothing because
// .tab-area's `flex: 1 1 auto` basis collapsed to the width its
// .tab-list child demanded via `width: 100%`, leaving no free space
// for the trailing margin to consume. The structural fix puts the
// right-alignment intent on the parent (.app-header) via
// `justify-content: space-between` and gives .tab-area a real
// expanding basis (`flex: 1 1 0` + `min-width: 0`). The cluster
// now lands at the trailing edge regardless of tab area width.
//
// DEF-085 residual: the .app-header itself sits inside the
// .titlebar-slot (a flex item with `flex: 1 1 auto`). The slot
// already supplies width, but .app-header — itself a flex container,
// not a flex item — would otherwise shrink to its children's natural
// width and `justify-content: space-between` would only distribute
// across that intrinsic width, attaching the trailing cluster to
// the brand. Pinning `width: 100%` on .app-header fixes the residual.

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

describe("Bug 17 — theme toggle + Open buttons right-aligned (DEF-085 fix)", () => {
  const src = readStyles();

  it(".app-header uses justify-content: space-between to pin .header-actions to the trailing edge", () => {
    const body = findRuleBody(src, ".app-header");
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(/justify-content:\s*space-between/);
  });

  it(".tab-area declares flex:1 1 0 + min-width:0 so the strip absorbs the middle and can shrink", () => {
    const body = findRuleBody(src, ".tab-area");
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(/flex:\s*1\s+1\s+0/);
    expect(body ?? "").toMatch(/min-width:\s*0/);
  });

  it(".header-actions keeps its existing flex layout (display:flex, align-items:center)", () => {
    const body = findRuleBody(src, ".header-actions");
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(/display:\s*flex/);
    expect(body ?? "").toMatch(/align-items:\s*center/);
  });

  it(".header-actions keeps the left-side border (visual separator from tab area)", () => {
    const body = findRuleBody(src, ".header-actions");
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(/border-left:\s*1px solid var\(--border-subtle\)/);
  });

  it(".app-header pins width:100% so space-between distributes across the full .titlebar-slot width (DEF-085 residual)", () => {
    // Without this, .app-header — a flex container inside .titlebar-slot
    // (which is itself a flex item) — shrinks to its children's natural
    // width and `justify-content: space-between` collapses against the
    // brand, leaving .header-actions visually attached to the left edge.
    const body = findRuleBody(src, ".app-header");
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(/width:\s*100%/);
  });
});
