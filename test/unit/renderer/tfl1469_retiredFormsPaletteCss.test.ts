// @vitest-environment node
//
// TFL-1469 (C2b) — no dead palette CSS for the retired forms tool.
//
// [TFL-1436] retired the guided "forms" command from the registry
// (`state/toolsRegistry.ts`). The Tools palette paints each entry's icon
// through a `.tools-palette-entry[data-tool-id="<id>"] .tools-palette-entry-icon`
// colour rule, and the `forms` rule was left behind — it can no longer match a
// rendered element because the palette only emits `data-tool-id` values drawn
// from `PALETTE_TOOL_IDS`.
//
// This is a static source guard on styles.css: every `data-tool-id` selector in
// the palette colour block must name a LIVE palette tool. A future retirement
// that forgets to drop its rule fails here instead of shipping dead CSS.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { PALETTE_TOOL_IDS } from "../../../src/renderer/state/toolsRegistry";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
// Comments are stripped first so an id mentioned in prose is never counted.
const CSS = readFileSync(
  join(REPO_ROOT, "src", "renderer", "styles.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

/** Every tool id the palette colour block hooks via `data-tool-id`. */
function paletteCssToolIds(): string[] {
  return [
    ...CSS.matchAll(/\.tools-palette-entry\[data-tool-id="([^"]+)"\]/g),
  ].map((m) => m[1] ?? "");
}

const CSS_IDS = [...new Set(paletteCssToolIds())].sort();

describe("TFL-1469 — the retired forms tool leaves no palette CSS", () => {
  it("has no data-tool-id=\"forms\" selector anywhere in styles.css", () => {
    expect(paletteCssToolIds()).not.toContain("forms");
  });

  it("every palette data-tool-id selector names a live palette tool", () => {
    const live = new Set(PALETTE_TOOL_IDS);
    const dead = CSS_IDS.filter((id) => !live.has(id));
    expect(dead, `dead palette CSS for: ${dead.join(", ")}`).toEqual([]);
  });

  it("still colours every live palette tool (the removal dropped only forms)", () => {
    const hooked = new Set(CSS_IDS);
    const missing = PALETTE_TOOL_IDS.filter((id) => !hooked.has(id));
    expect(missing, `palette tools with no colour rule: ${missing.join(", ")}`).toEqual(
      [],
    );
  });
});
