// @vitest-environment node
// Static CSS guard for the panel header action-row overflow fix (TFL-1411).
//
// The Review context panel's Annotations header carries a count pill plus
// "Export comments" / "Import comments" buttons in `.glass-sidebar-actions`.
// At the left navigator's narrow widths that cluster overflowed the panel and
// the buttons were clipped (the panel body is `overflow: hidden`), because:
//   - `.glass-sidebar-actions` was a non-wrapping row with no `min-width: 0`;
//   - the shared headers were FIXED-height (44px / 52px) so a second row would
//     be clipped rather than grow the header.
//
// The fix:
//   - `.glass-sidebar-actions` wraps (`flex-wrap: wrap`), shrinks
//     (`min-width: 0`) and trailing-aligns wrapped rows (`justify-content:
//     flex-end`);
//   - `.glass-sidebar-header`, `.glass-sidebar-header-preferred` and
//     `.tf-panel-header-preferred` use `min-height` with the SAME numeric
//     values so single-line headers stay pixel-identical.
//
// These tests pin the contract so a future CSS edit doesn't undo the fix.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");

function readStyles(): string {
  return readFileSync(STYLES_PATH, "utf8");
}

/** Strip CSS comments so we don't get false matches on commented-out rules. */
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

describe("styles.css — panel header action-row overflow (TFL-1411)", () => {
  it(".glass-sidebar-actions wraps and shrinks so the cluster stays inside the panel", () => {
    const body = findRuleBody(stripCssComments(readStyles()), ".glass-sidebar-actions");
    expect(body).not.toBeNull();
    if (body === null) return;
    expect(declarationValue(body, "flex-wrap")).toBe("wrap");
    expect(declarationValue(body, "min-width")).toBe("0");
    expect(declarationValue(body, "justify-content")).toBe("flex-end");
  });

  it(".glass-sidebar-header uses min-height (not a fixed height) so a wrapped row grows it", () => {
    const body = findRuleBody(stripCssComments(readStyles()), ".glass-sidebar-header");
    expect(body).not.toBeNull();
    if (body === null) return;
    expect(declarationValue(body, "height")).toBeNull();
    expect(declarationValue(body, "min-height")).not.toBeNull();
  });

  it(".glass-sidebar-header-preferred uses min-height (not a fixed height)", () => {
    const body = findRuleBody(
      stripCssComments(readStyles()),
      ".glass-sidebar-header-preferred",
    );
    expect(body).not.toBeNull();
    if (body === null) return;
    expect(declarationValue(body, "height")).toBeNull();
    expect(declarationValue(body, "min-height")).not.toBeNull();
  });

  it(".tf-panel-header-preferred uses min-height (not a fixed height)", () => {
    const body = findRuleBody(
      stripCssComments(readStyles()),
      ".tf-panel-header-preferred",
    );
    expect(body).not.toBeNull();
    if (body === null) return;
    expect(declarationValue(body, "height")).toBeNull();
    expect(declarationValue(body, "min-height")).not.toBeNull();
  });
});
