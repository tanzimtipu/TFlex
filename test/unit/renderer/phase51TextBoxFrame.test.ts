// Phase 51 (item 11 / feature H) — every text box uses a thicker border with
// rounded corners.
//
// One pair of design tokens drives the whole family
// (`--border-w-box` / `--radius-box`), and each text-box surface consumes it:
// canvas text boxes, text annotations, callouts, comment boxes and the
// on-canvas run editor. Textual scan (jsdom applies no stylesheet) — the
// established pattern for CSS contracts.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = resolve(__dirname, "../../..");
const CSS = readFileSync(resolve(ROOT, "src/renderer/styles.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

/** The body of the first `selector { ... }` whose selector starts a line. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = CSS.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`));
  return m?.[1] ?? "";
}

const SURFACES = [
  ".ann-textbox",
  ".ann-editor",
  ".ann-comment-box",
  ".edit-box",
  ".edit-box-preview",
  ".ann-callout",
];

describe("Phase 51 item 11 — the shared text-box frame tokens", () => {
  it("defines a thicker width and a rounded radius", () => {
    const root = CSS.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(root).toMatch(/--border-w-box:\s*2px/);
    expect(root).toMatch(/--radius-box:\s*var\(--radius-2\)/);
  });

  it("applies both tokens to every text-box surface", () => {
    for (const selector of SURFACES) {
      const body = ruleBody(selector);
      expect(body, selector).not.toBe("");
      expect(body, `${selector} border`).toMatch(/border:\s*var\(--border-w-box\)/);
      expect(body, `${selector} radius`).toMatch(/border-radius:\s*var\(--radius-box\)/);
    }
  });

  it("keeps the shared grip/editor halves on the same radius", () => {
    expect(CSS).toMatch(
      /\.ann-textbox-grip,\s*\.content-grip\s*\{[^}]*border-radius:\s*var\(--radius-box\)\s+var\(--radius-box\)\s+0\s+0/,
    );
    expect(ruleBody(".ann-textbox-wrap .ann-textbox-editor")).toMatch(
      /border-radius:\s*0\s+0\s+var\(--radius-box\)\s+var\(--radius-box\)/,
    );
  });

  it("gives the run editor the same tokens", () => {
    const overlay = readFileSync(
      resolve(ROOT, "src/renderer/edit/EditOverlay.tsx"),
      "utf8",
    );
    expect(overlay).toMatch(/border:\s*"var\(--border-w-box\) solid transparent"/);
    expect(overlay).toMatch(/borderRadius:\s*"var\(--radius-box\)"/);
  });
});
