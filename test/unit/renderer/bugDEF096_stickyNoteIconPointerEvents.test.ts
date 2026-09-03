// @vitest-environment jsdom
//
// Regression guard for DEF-096 — the committed sticky-note icon
// (.ann-note) must receive clicks even when pdf.js's textLayer
// spans overlap its bounding box. The previous CSS pinned
// `.ann-note` to `pointer-events: none` and let it inherit the
// `.annotation-layer`'s implicit z-index; on pages with text under
// the icon, the textLayer's `pointer-events: auto` spans (which
// sit underneath the icon in DOM order) intercepted the click and
// the user couldn't focus the note via the icon.
//
// The fix:
//   1. `.ann-note` is `pointer-events: auto` so the icon absorbs
//      clicks even when overlapping textLayer spans.
//   2. `.ann-note` is `z-index: 3` (above .annotation-layer's 2)
//      so the icon paints above textLayer spans regardless of DOM
//      order.
//
// This file pins both pieces by reading the CSS source and
// asserting the rules are in place. jsdom doesn't fully implement
// stacking-context paint order, so the only portable regression
// guard is the source-level contract.
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const stylesPath = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "renderer",
  "styles.css",
);
const stylesSource = fs.readFileSync(stylesPath, "utf8");

function getAnnNoteRule(): string {
  const raw = stylesSource.match(/\.ann-note\s*\{[^}]*\}/);
  if (raw === null) return "";
  // Strip the CSS comment block before inspecting properties —
  // the comment block mentions the previous shape (which used
  // `pointer-events: none`) as historical context. Inspecting
  // the rule's actual declarations only keeps the negative
  // assertions honest.
  return raw[0].replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("DEF-096 — sticky-note icon is clickable (pointer-events: auto) and above textLayer (z-index)", () => {
  it(".ann-note CSS has pointer-events: auto so the icon absorbs clicks", () => {
    const rule = getAnnNoteRule();
    expect(rule).not.toBe("");
    expect(rule).toMatch(/pointer-events:\s*auto/);
    // Regression guard against the original bug: the previous
    // shape was `pointer-events: none` which let textLayer spans
    // swallow clicks. We assert the exact "auto" value, not just
    // any pointer-events rule, so a future refactor that flips it
    // back fails the test.
    expect(rule).not.toMatch(/pointer-events:\s*none/);
  });

  it(".ann-note CSS has an explicit z-index above .annotation-layer (z-index 2)", () => {
    const rule = getAnnNoteRule();
    expect(rule).not.toBe("");
    const zMatch = rule.match(/z-index:\s*(\d+)\s*;/);
    expect(zMatch).not.toBeNull();
    if (zMatch === null) return;
    const noteZ = Number(zMatch[1]);
    expect(noteZ).toBeGreaterThan(2);
  });

  it(".ann-note CSS's z-index sits above the textLayer spans (z-index auto)", () => {
    // The textLayer spans are z-index: auto inside the layer
    // (which itself has no explicit z-index). The note icon at
    // z-index >= 3 in its own stacking context paints above
    // them by spec. We assert the note's z-index is a non-auto
    // integer so it actually establishes a stacking context
    // rather than falling back to auto and being dominated by
    // sibling span positioning.
    const rule = getAnnNoteRule();
    expect(rule).not.toBe("");
    expect(rule).toMatch(/z-index:\s*\d+\s*;/);
    expect(rule).not.toMatch(/z-index:\s*auto/);
  });

  it(".ann-note CSS still paints with a cursor change so the user sees the icon is interactive", () => {
    // UX marker: a clickable surface should show a grabbing/palm
    // cursor so the user knows clicks land on the icon. DEF-153 —
    // committed content now uses the palm/grab cursor (the
    // Acrobat-style model), not the old `pointer` /
    // `move` / `text`.
    const rule = getAnnNoteRule();
    expect(rule).not.toBe("");
    expect(rule).toMatch(/cursor:\s*grab/);
  });
});