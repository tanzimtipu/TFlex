// @vitest-environment node
//
// DEF-156 / DEF-158 / DEF-159 — dark-mode page-ink inventory.
//
// The paper-white page is NEVER inverted in dark mode (DEF-099), so
// every text the app paints OVER the page must use DARK ink in BOTH
// themes:
//   - DEF-159: committed annotation textbox `.ann-textbox` text.
//   - DEF-157(b) residual: committed callout `.ann-callout` text.
//   - DEF-158: committed sticky-note `.ann-note-text` label.
// And chrome over the page must stay readable:
//   - DEF-156: the "Drag to move" grip label — the `--fg-soft` token
//     the base rule referenced was UNDEFINED, and the hover state
//     swapped the opaque chip for a translucent tint + near-white
//     label. Both are fixed here: the token is defined in both
//     themes and the hover keeps an OPAQUE chip + strong label.
// We use a textual scan of styles.css (jsdom does not implement CSS
// cascade resolution — the rules are the source of truth), the same
// technique as updateIndicatorCss.test.ts.

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

function themeBlocks(src: string): { light: string; dark: string } {
  const stripped = stripCssComments(src);
  const lightMatch = /:root\s*\{([\s\S]*?)\n\}/.exec(stripped);
  const darkMatch = /:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/.exec(stripped);
  return {
    light: lightMatch?.[1] ?? "",
    dark: darkMatch?.[1] ?? "",
  };
}

function ruleBodyFor(src: string, selector: string): string | null {
  const stripped = stripCssComments(src);
  // Characters allowed between a selector and its opening brace:
  // whitespace, commas (selector lists), and selector-ish tokens
  // (.class, :pseudo, [attr], combinator chars). If anything else
  // (e.g. a ';' from a property) appears first, it is not a rule.
  const legalGap = /[\s,.#:\[\]<>+~*a-zA-Z0-9_-]/;
  let from = 0;
  for (;;) {
    const idx = stripped.indexOf(selector, from);
    if (idx === -1) return null;
    let cursor = idx + selector.length;
    // Token boundary: the char right after must not be another word
    // char (so `.edit-box` never matches `.edit-box-toolbar`).
    const after = stripped[cursor];
    if (after !== undefined && /[a-zA-Z0-9_-]/.test(after)) {
      from = idx + selector.length;
      continue;
    }
    while (cursor < stripped.length) {
      const ch = stripped[cursor];
      if (ch === undefined) return null;
      if (ch === "{") {
        const braceOpen = cursor;
        let depth = 0;
        for (let i = braceOpen; i < stripped.length; i += 1) {
          const inner = stripped[i];
          if (inner === "{") depth += 1;
          else if (inner === "}") {
            depth -= 1;
            if (depth === 0) return stripped.slice(braceOpen + 1, i);
          }
        }
        return null;
      }
      if (legalGap.test(ch)) {
        cursor += 1;
        continue;
      }
      break;
    }
    from = idx + selector.length;
  }
}

describe("DEF-156 — the 'Drag to move' grip over the white page", () => {
  const src = readStyles();

  it("defines the --fg-soft token in BOTH themes (the base rule referenced an undefined token)", () => {
    const { light, dark } = themeBlocks(src);
    expect(light).toMatch(/--fg-soft:\s*#[0-9a-f]{6}/);
    expect(dark).toMatch(/--fg-soft:\s*#[0-9a-f]{6}/);
  });

  it(".ann-textbox-grip base uses an OPAQUE chip + the now-defined --fg-soft label", () => {
    const body = ruleBodyFor(src, ".ann-textbox-grip");
    expect(body).not.toBeNull();
    // Opaque chip: the background must not be an rbga() alpha tint
    // (a translucent tint lets the paper-white page wash the label).
    if (body === null) return;
    expect(body).toMatch(/background:\s*var\(--bg-sunken\)/);
    expect(body).toMatch(/color:\s*var\(--fg-soft\)/);
    expect(body).not.toMatch(/background:\s*rgba\(/);
  });

  it(".ann-textbox-grip:hover keeps an OPAQUE chip + a strong label (no white-on-white)", () => {
    const body = ruleBodyFor(src, ".ann-textbox-grip:hover");
    expect(body).not.toBeNull();
    if (body === null) return;
    // The hover must NOT swap in the translucent --bg-hover tint
    // (rgba(255,255,255,0.04) over the white page = invisible); it
    // must stay opaque and flip the label to the strong tone.
    expect(body).toMatch(/background:\s*var\(--bg-raised\)/);
    expect(body).toMatch(/color:\s*var\(--fg-strong\)/);
    expect(body).not.toMatch(/var\(--bg-hover\)/);
  });
});

describe("DEF-158/159 — committed page text stays DARK in both themes (the page is never inverted)", () => {
  const src = readStyles();

  it("declares a theme-independent --fg-on-page ink token", () => {
    // Defined in the BASE :root only (theme-independent — the page
    // stays paper-white in dark mode, so page ink is always dark).
    const { light, dark } = themeBlocks(src);
    expect(light).toMatch(/--fg-on-page:\s*#[0-9a-f]{6}/);
    // It must not be redefined to a light color in the dark block.
    expect(dark).not.toMatch(/--fg-on-page:\s*#(?:[0-9a-fA-F]{6})/);
  });

  it(".ann-textbox brushes with var(--fg-on-page), not the UI --fg-strong", () => {
    const body = ruleBodyFor(src, ".ann-textbox");
    expect(body).not.toBeNull();
    if (body === null) return;
    expect(body).toMatch(/color:\s*var\(--fg-on-page\)/);
    expect(body).not.toMatch(/color:\s*var\(--fg-strong\)/);
  });

  it(".ann-callout brushes with var(--fg-on-page) (inheriting --fg made it faint)", () => {
    const body = ruleBodyFor(src, ".ann-callout");
    expect(body).not.toBeNull();
    if (body === null) return;
    expect(body).toMatch(/color:\s*var\(--fg-on-page\)/);
  });

  it(".ann-note-text (inline style in AnnotationOverlay) brushes with var(--fg-on-page), not --fg-strong", () => {
    const path = resolve(__dirname, "../../../src/renderer/annotations/AnnotationOverlay.tsx");
    const srcTs = readFileSync(path, "utf8");
    // The note label style object sets the color field.
    const noteTextSection = srcTs.slice(srcTs.indexOf("noteTextStyle"), srcTs.indexOf("noteTextStyle") + 2600);
    expect(noteTextSection).toMatch(/color:\s*"var\(--fg-on-page\)"/);
    expect(noteTextSection).not.toMatch(/color:\s*"var\(--fg-strong\)"/);
  });
});

describe("DEF-154 — committed shapes / ink / arrows are page-interactive (pointer-events)", () => {
  const src = readStyles();

  it(".ann-shape is pointer-events: auto with the grab cursor", () => {
    const body = ruleBodyFor(src, ".ann-shape");
    expect(body).not.toBeNull();
    if (body === null) return;
    expect(body).toMatch(/pointer-events:\s*auto/);
    expect(body).toMatch(/cursor:\s*grab/);
  });

  it(".ann-ink visual stays transparent but gains a fat .ann-ink-hit target", () => {
    expect(ruleBodyFor(src, ".ann-ink")).toMatch(/pointer-events:\s*none/);
    const hit = ruleBodyFor(src, ".ann-ink-hit");
    expect(hit).not.toBeNull();
    if (hit === null) return;
    expect(hit).toMatch(/pointer-events:\s*stroke/);
    expect(hit).toMatch(/cursor:\s*grab/);
  });

  it(".ann-arrow has a fat .ann-arrow-hit target beating the .ann-arrow line pointer-events:none rule (DEF-154)", () => {
    // The hit-line rule must be SELECTED WITH the .ann-arrow
    // ancestor: `.ann-arrow line` (class + element) has higher
    // specificity than the lone `.ann-arrow-hit` class, so a bare
    // `.ann-arrow-hit { pointer-events: stroke }` rule would LOSE
    // to `.ann-arrow line { pointer-events: none }` and leave the
    // whole arrow click-transparent (qa found hover falling
    // through to the textLayer). The .ann-arrow-prefixed selector
    // restores the wide invisible hit path.
    const bare = ruleBodyFor(src, ".ann-arrow-hit");
    const prefixed = ruleBodyFor(src, ".ann-arrow line.ann-arrow-hit");
    expect(bare).not.toBeNull();
    if (bare === null) return;
    expect(bare).toMatch(/pointer-events:\s*stroke/);
    expect(bare).toMatch(/cursor:\s*grab/);
    // The prefixed selector must exist AND still declare the stroke
    // hit (the rule that actually wins the cascade).
    expect(prefixed).not.toBeNull();
    if (prefixed === null) return;
    expect(prefixed).toMatch(/pointer-events:\s*stroke/);
  });

  it(".ann-arrow-head-hit gives the arrowhead a pointer target of its own (DEF-154)", () => {
    const body = ruleBodyFor(src, ".ann-arrow polygon.ann-arrow-head-hit");
    expect(body).not.toBeNull();
    if (body === null) return;
    expect(body).toMatch(/pointer-events:\s*all/);
    expect(body).toMatch(/cursor:\s*grab/);
  });

  it(".content-selection-frame wraps the ring so corner handles land on the shape (DEF-154)", () => {
    const frame = ruleBodyFor(src, ".content-selection-frame");
    expect(frame).not.toBeNull();
    if (frame === null) return;
    expect(frame).toMatch(/position:\s*absolute/);
    expect(frame).toMatch(/pointer-events:\s*none/);
    // The ring is now inset:0 inside the frame (its old standalone
    // rule positioned handles relative to the page layer, collapsing
    // them onto the page's corners).
    const ring = ruleBodyFor(src, ".content-selection-frame .content-selection-bounds");
    expect(ring).not.toBeNull();
    if (ring === null) return;
    expect(ring).toMatch(/inset:\s*0/);
    expect(ring).toMatch(/pointer-events:\s*none/);
  });

  it(".ann-textbox and .ann-callout are pointer-events: auto with the grab cursor", () => {
    expect(ruleBodyFor(src, ".ann-textbox")).toMatch(/pointer-events:\s*auto/);
    expect(ruleBodyFor(src, ".ann-textbox")).toMatch(/cursor:\s*grab/);
    expect(ruleBodyFor(src, ".ann-callout")).toMatch(/pointer-events:\s*auto/);
    expect(ruleBodyFor(src, ".ann-callout")).toMatch(/cursor:\s*grab/);
  });

  it(".ann-note uses the grab cursor (Acrobat-style palm), not pointer", () => {
    expect(ruleBodyFor(src, ".ann-note")).toMatch(/cursor:\s*grab/);
  });

  it(".edit-box uses the grab cursor, not the 4-arrow move cursor", () => {
    const body = ruleBodyFor(src, ".edit-box");
    expect(body).not.toBeNull();
    if (body === null) return;
    expect(body).toMatch(/cursor:\s*grab/);
    expect(body).not.toMatch(/cursor:\s*move/);
  });
});