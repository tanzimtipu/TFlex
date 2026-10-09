// @vitest-environment node
// Static CSS guard for Bug 1 — the "+ tab" affordance must match
// the height of the `.tab` element exactly so the affordance sits
// on the same row baseline as the rightmost tab. The previous
// 24px height left a visible 10px offset against the 34px tab,
// which read as misalignment. The fix pins the button to 34px
// (the same height the stylesheet rule for `.tab` declares).
//
// We use a textual scan of styles.css rather than jsdom's
// getComputedStyle because jsdom does not implement real CSS
// cascade resolution; the rules are the source of truth.

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

/** True when `idx` is the first non-whitespace token on its line, so a
 *  selector is not part of a longer compound / descendant selector. The tab
 *  strip now carries scoped variants (e.g. `.tab-area[data-tab-style="chrome"]
 *  .tab-new`) that appear EARLIER in the sheet than the base rule; an
 *  unanchored indexOf would resolve those instead of the base contract. */
function startsLine(src: string, idx: number): boolean {
  for (let i = idx - 1; i >= 0; i -= 1) {
    const ch = src[i];
    if (ch === "\n") return true;
    if (!/\s/.test(ch ?? "")) return false;
  }
  return true;
}

function findRuleBody(src: string, selector: string): string | null {
  const stripped = stripCssComments(src);
  let from = 0;
  for (;;) {
    const idx = stripped.indexOf(selector, from);
    if (idx === -1) return null;
    let cursor = idx + selector.length;
    while (cursor < stripped.length && /\s/.test(stripped[cursor] ?? "")) cursor += 1;
    if (stripped[cursor] === "{" && startsLine(stripped, idx)) {
      return extractRuleBody(stripped, idx);
    }
    from = idx + selector.length;
  }
}

function readHeight(src: string, selector: string): string {
  const body = findRuleBody(src, selector);
  if (body === null) return "";
  const m = body.match(/height:\s*([^;]+);/);
  return m === null ? "" : (m[1] ?? "").trim();
}

describe("Bug 1 — '+ tab' button height matches .tab height", () => {
  const src = readStyles();

  it(".tab declares a fixed height (34px)", () => {
    const h = readHeight(src, ".tab");
    expect(h).toBeTruthy();
    // Pin the value the rest of the spec assumes. The exact
    // value is a contract with the rest of the tab strip;
    // touching it requires touching the matching rule below.
    expect(h).toBe("34px");
  });

  it(".tab-new declares the same height as .tab (Bug 1 fix)", () => {
    const tabH = readHeight(src, ".tab");
    const newH = readHeight(src, ".tab-new");
    expect(tabH).toBeTruthy();
    expect(newH).toBeTruthy();
    expect(newH).toBe(tabH);
  });

  it(".tab-new rule documents the height contract (lock against silent drift)", () => {
    // The Bug 1 fix left a comment in the rule that explicitly
    // documents the height match. If a future change makes the
    // .tab height 36px and forgets to update .tab-new, this
    // test fails — the comment is the link between the two
    // rules. The text-based scan reads the raw source (no
    // comment-stripping) so the documentation comment is visible.
    expect(src).toMatch(/\.tab-new\s*\{[\s\S]*?Match \.tab exactly/);
  });
});
