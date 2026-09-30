// @vitest-environment node
//
// TFL-61 (Phase 63) — THE DOCK EDIT PEN CARRIES THE EDIT STAGE COLOUR.
//
// The pen arms EDIT mode. In the Stage Rail the edit stage owns a distinct hue
// (--tf-stage-edit). This guard pins that the pen's resting ink resolves to the
// same token -- and that no .action-dock-edit rule hard-codes a raw colour, so
// the identity survives the theme swap (light / dark / frosted) rather than
// freezing one theme's value.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");
const CSS = readFileSync(STYLES_PATH, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

function ruleBodies(css: string, selector: string): string[] {
  return [...css.matchAll(/([^{}]*)\{([^{}]*)\}/g)]
    .filter((m) => (m[1] ?? "").split(",").some((s) => s.trim() === selector))
    .map((m) => m[2] ?? "");
}

describe("TFL-61 — the dock edit pen rests in the EDIT stage hue", () => {
  it("declares color: var(--tf-stage-edit) in the .action-dock-edit base rule", () => {
    const bodies = ruleBodies(CSS, ".action-dock-edit");
    expect(bodies.length).toBeGreaterThan(0);
    expect(bodies.some((b) => b.includes("color: var(--tf-stage-edit)"))).toBe(true);
  });

  it("declares no raw hex/rgb/hsl colour in any .action-dock-edit rule", () => {
    const bodies = ruleBodies(CSS, ".action-dock-edit");
    const raw = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\(/i;
    for (const body of bodies) {
      expect(body).not.toMatch(raw);
    }
  });
});
