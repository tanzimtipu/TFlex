// @vitest-environment node
// Static CSS guard for the toolbar overflow regression (P9 fix #1).
//
// The pre-fix toolbar was a single fixed-height row with
// `justify-content: space-between` and a fixed-width 28px button
// even when the button carried a label (e.g. "Merge", "Sign",
// "Tools"). On a narrow window the labels overflowed the buttons and
// overlapped the navigation group, blocking the Tools button.
//
// The fix:
//   - .toolbar is a flex-wrap row with `min-height: 44px` so it
//     grows vertically when buttons overflow.
//   - .toolbar-group is also flex-wrap with min-width: 0 so it can
//     shrink as needed.
//   - Phase 13: the toolbar is fully icon-only — every button is the
//     fixed 28px square (`.tool-btn-with-label` and `.tool-btn-label`
//     were pruned with the text labels), so the labelled-width opt-out
//     contract below became "no such rule exists".
//   - .toolbar-group:last-child is margin-left: auto so the right
//     cluster still pins to the trailing edge when both groups fit
//     on one row.
//
// These tests pin the contract so a future CSS edit doesn't undo
// the regression fix without a deliberate test update.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");

function readStyles(): string {
  return readFileSync(STYLES_PATH, "utf8");
}

/** Strip CSS comments so we don't get false matches on commented-out
 *  rules from past iterations. */
function stripCssComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "");
}

function findRuleBody(src: string, selector: string): string | null {
  let from = 0;
  for (;;) {
    const idx = src.indexOf(selector, from);
    if (idx === -1) return null;
    let cursor = idx + selector.length;
    while (cursor < src.length && /\s/.test(src[cursor] ?? "")) cursor += 1;
    if (src[cursor] === "{") {
      let depth = 0;
      const braceOpen = cursor;
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
    from = idx + selector.length;
  }
}

function declarationValue(body: string, property: string): string | null {
  const re = new RegExp(`(?:^|;|\\n)\\s*${property}\\s*:\\s*([^;]+?)\\s*(?:;|$)`, "m");
  const m = body.match(re);
  if (m === null) return null;
  return (m[1] ?? "").trim();
}

describe("styles.css — toolbar overflow regression (P9 fix #1)", () => {
  it(".toolbar wraps to a second row when buttons overflow", () => {
    const body = findRuleBody(stripCssComments(readStyles()), ".toolbar");
    expect(body).not.toBeNull();
    if (body === null) return;
    // Pre-fix was `height: 44px` (locked single-row). The fix uses
    // min-height + flex-wrap so the toolbar grows vertically when
    // labelled buttons don't fit on one row.
    expect(declarationValue(body, "flex-wrap")).toBe("wrap");
    expect(declarationValue(body, "height")).toBeNull();
    expect(declarationValue(body, "min-height")).not.toBeNull();
    expect(declarationValue(body, "justify-content")).toBe("flex-start");
  });

  it(".toolbar-group wraps and shrinks so the right cluster can fit", () => {
    const body = findRuleBody(stripCssComments(readStyles()), ".toolbar-group");
    expect(body).not.toBeNull();
    if (body === null) return;
    expect(declarationValue(body, "flex-wrap")).toBe("wrap");
    expect(declarationValue(body, "min-width")).toBe("0");
  });

  it(".toolbar pushes the last group to the trailing edge", () => {
    const body = findRuleBody(
      stripCssComments(readStyles()),
      ".toolbar > .toolbar-group:last-child",
    );
    expect(body).not.toBeNull();
    if (body === null) return;
    expect(declarationValue(body, "margin-left")).toBe("auto");
  });

  it(".tool-btn keeps a fixed 28px width but never shrinks below it", () => {
    const body = findRuleBody(stripCssComments(readStyles()), ".tool-btn");
    expect(body).not.toBeNull();
    if (body === null) return;
    expect(declarationValue(body, "width")).toBe("28px");
    // flex-shrink: 0 stops the navigation cluster from compressing
    // into illegibility when the toolbar is narrow (DEF-042 follow-up
    // regression pre-fix).
    expect(declarationValue(body, "flex-shrink")).toBe("0");
    expect(declarationValue(body, "white-space")).toBe("nowrap");
  });

  it("Phase 13 — no label-width opt-out survives (the toolbar is icon-only)", () => {
    // The toolbar's labels are gone; the width-opt-out rule they
    // needed must not linger half-dead in the stylesheet. A re-added
    // label affordance must deliberately restore BOTH this rule and
    // the TSX spans.
    expect(
      findRuleBody(stripCssComments(readStyles()), ".tool-btn-with-label"),
    ).toBeNull();
    expect(findRuleBody(stripCssComments(readStyles()), ".tool-btn-label")).toBeNull();
  });

  it(".page-indicator shrinks under pressure (prevents toolbar overflow)", () => {
    // The page-indicator must allow the inner input to shrink so the
    // navigation cluster doesn't push the right cluster off-screen.
    const body = findRuleBody(stripCssComments(readStyles()), ".page-indicator");
    expect(body).not.toBeNull();
    if (body === null) return;
    expect(declarationValue(body, "min-width")).toBe("0");
  });
});
