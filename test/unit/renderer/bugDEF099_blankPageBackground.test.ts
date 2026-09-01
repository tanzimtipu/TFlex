// @vitest-environment node
//
// Regression guard for DEF-099 — the page-slot background must be
// paper-white (`#ffffff`), independent of theme. The previous
// shape read `var(--bg-raised)`, which inherits the theme — in
// dark mode that's `#15181c` (near-black), so a blank page
// rendered as a dark rectangle next to the toolbar.
//
// The fix:
//   1. `.pdf-page` (the PageView wrapper) is hard-coded to
//      `#ffffff`.
//   2. `.page-slot` (the always-mounted scroll-space placeholder)
//      is also hard-coded to `#ffffff` so unmounted slots don't
//      inherit the canvas-coloured background.
//
// We pin both rules by reading the stylesheet source and asserting
// the values are present. Direct CSS-eval testing in a unit
// environment is brittle, so this is the only portable regression
// guard.
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

describe("DEF-099 — page slot background is paper-white, independent of theme", () => {
  it(".pdf-page CSS sets background: #ffffff (paper white)", () => {
    const raw = stylesSource.match(/\.pdf-page\s*\{[^}]*\}/);
    expect(raw).not.toBeNull();
    if (raw === null) return;
    // Strip the CSS comment block before inspecting properties —
    // the comment mentions the previous shape as historical
    // context, which would otherwise trip the negative regex.
    const rule = raw[0].replace(/\/\*[\s\S]*?\*\//g, "");
    expect(rule).toMatch(/background:\s*#ffffff\s*;/);
    // Regression guard against the original bug: the previous
    // shape read `var(--bg-raised)`, which inherits the theme
    // (dark mode = `#15181c`). We assert the rule does NOT
    // reference `--bg-raised` so a future refactor that reverts
    // to the theme token fails the test.
    expect(rule).not.toMatch(/var\(--bg-raised\)/);
  });

  it(".page-slot CSS sets background: #ffffff (paper white) for the always-mounted scroll placeholder", () => {
    const rule = stylesSource.match(/\.page-slot\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    if (rule === null) return;
    expect(rule[0]).toMatch(/background:\s*#ffffff\s*;/);
  });

  it(".pdf-page CSS does NOT depend on --bg-raised (theme-inherited) for its background", () => {
    // Belt-and-braces: if a future edit re-introduces
    // `var(--bg-raised)` as a fallback expression, we still want
    // to fail the test. We strip the CSS comment block from the
    // captured rule so the test only inspects the actual property
    // declarations (the comment mentions the previous shape as
    // historical context, which would otherwise trip the regex).
    const raw = stylesSource.match(/\.pdf-page\s*\{[^}]*\}/);
    expect(raw).not.toBeNull();
    if (raw === null) return;
    const rule = raw[0].replace(/\/\*[\s\S]*?\*\//g, "");
    expect(rule).not.toMatch(/--bg-raised/);
  });
});