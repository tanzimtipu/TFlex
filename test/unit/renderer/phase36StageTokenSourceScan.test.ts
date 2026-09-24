// @vitest-environment node
//
// Phase 36 (chunk 8) — the source sweep: the phase's NEW renderer surfaces
// carry no colour literals. Every stage hue is a `--tf-stage-*` token defined
// once per theme in styles.css; a `#rrggbb` / `rgb()` / `rgb()` / `hsl()` in
// the component code is a regression to catch at the source (the chunk-8
// rule: no hardcoded colours anywhere).
//
// This pins the phase-36 component set so a future edit cannot quietly
// reintroduce a literal, and confirms the two files chunk 8 touched
// (CommandPalette.tsx, StageRail.tsx) stay literal-free.

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RENDERER = resolve(process.cwd(), "src/renderer");
const COMPONENTS = [
  "components/StageRail.tsx",
  "components/CommandPalette.tsx",
  "components/ActionDock.tsx",
  "components/MultiActionDock.tsx",
  "components/AnnotationFlyout.tsx",
  "components/CanvasPills.tsx",
  "components/Inspector.tsx",
];

/** A colour literal in source: hex, rgb()/rgba(), or hsl()/hsla(). */
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;

describe("Phase 36 chunk 8 — the new surfaces ship no colour literals", () => {
  it("every phase-36 component file exists", () => {
    for (const file of COMPONENTS) {
      expect(existsSync(resolve(RENDERER, file)), `${file} missing`).toBe(true);
    }
  });

  for (const file of COMPONENTS) {
    it(`${file} has no hardcoded colour`, () => {
      const text = readFileSync(resolve(RENDERER, file), "utf8");
      const lines = text.split(/\r?\n/);
      const hits = lines
        .map((line, i) => [i + 1, line] as const)
        .filter(([, line]) => COLOUR_LITERAL.test(line));
      expect(hits.map(([n, line]) => `${file}:${n} ${line.trim()}`)).toEqual([]);
    });
  }

  it("the palette's stage rows resolve the stage hue from the tokens", () => {
    // Belt-and-braces on the consumer side: the tool row carries the registry
    // entry's stage as `data-stage` (the CSS hook that binds the row's chip +
    // pin to the matching --tf-stage-* token), and the tag chip carries it too.
    const palette = readFileSync(resolve(RENDERER, "components/CommandPalette.tsx"), "utf8");
    const hooks = palette.match(/data-stage=\{row\.entry\.stage\}/g) ?? [];
    expect(hooks.length).toBeGreaterThanOrEqual(2);
  });
});
