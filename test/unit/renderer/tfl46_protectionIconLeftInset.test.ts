// @vitest-environment jsdom
//
// TFL-46.2 (DEF-435, HIGH) — the collapsed document-protection "i"
// (`.protection-notice-collapsed-toggle`) is absolute inside the zero-height
// `.protection-notice-region`, whose containing block starts at the stage rail
// (`--tf-stage-rail-w`, left: 64px). With `left: var(--space-standard)` the icon
// landed at x=80 — over the LEFT ContextPanel, covering the leading edge of the
// Combine control. It must be offset by the panel's own track (`--tf-rail-w`)
// so it lands at the page scroller's left edge (x=248 open, x=112 collapsed) —
// the canvas's top-left. Multi Mode has no left panel, so the offset is reset.
//
// jsdom applies no stylesheet, so this pins the CSS contract with a textual
// scan of `styles.css` (the established `ruleBody` pattern in
// phase53_protectionNoticeInspectorHitTest.test.ts).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(
  resolve(__dirname, "../../../src/renderer/styles.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

/** The body of the first `selector { ... }` whose selector starts a line. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = CSS.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`));
  return m?.[1] ?? "";
}

describe("TFL-46.2 — the collapsed protection icon clears the left ContextPanel", () => {
  it("offsets the collapsed toggle by the rail track plus the standard space", () => {
    const rule = ruleBody(".protection-notice-collapsed-toggle");
    expect(rule, "the collapsed-toggle rule is missing").not.toBe("");
    expect(rule).toMatch(
      /left:\s*calc\(var\(--tf-rail-w,\s*184px\)\s*\+\s*var\(--space-standard\)\)/,
    );
  });

  it("no longer pins the collapsed toggle at a bare --space-standard", () => {
    const rule = ruleBody(".protection-notice-collapsed-toggle");
    expect(rule).not.toMatch(/left:\s*var\(--space-standard\)\s*;/);
  });

  it("resets the offset in Multi Mode, which has no left panel", () => {
    const rule = ruleBody(
      '.tab-stage[data-multi-mode="true"] .protection-notice-collapsed-toggle',
    );
    expect(rule, "the Multi Mode collapsed-toggle reset is missing").not.toBe("");
    expect(rule).toMatch(/left:\s*var\(--space-standard\)/);
  });

  it("binds the offset to the registered --tf-rail-w track (one source)", () => {
    const collapsed = ruleBody('.app-main[data-rail-collapsed="true"]');
    expect(collapsed).toMatch(/--tf-rail-w:\s*48px/);
  });
});
