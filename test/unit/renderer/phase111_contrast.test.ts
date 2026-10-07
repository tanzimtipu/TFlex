// @vitest-environment node
//
// Phase 111 (TFL-1074 / DEF-613) — the navigator contrast contract.
//
// CTO ruling: add navigator-scoped tokens from the bundle palette and do NOT
// relax `Specifications/contrast-check.json`. This spec resolves the navigator
// tokens out of src/renderer/styles.css for light and dark, asserts they equal
// the bundle `Design System/navigator.tokens.json` values, then computes the
// SIX WCAG ratios the contract names:
//   body     = foreground on surface
//   helper   = secondary  on surface
//   selected = accent     on selectedSurface
// Every ratio must meet or beat its contrast-check.json threshold. The JSON
// stores the bundle's own measurements rounded to two decimals, so the computed
// ratio is compared at that same precision (never a relaxed floor).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(
  resolve(__dirname, "../../../src/renderer/styles.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

const BUNDLE = JSON.parse(
  readFileSync(
    resolve(__dirname, "../../../Visual overhaul/Design System/navigator.tokens.json"),
    "utf8",
  ),
) as Record<string, Record<string, string>>;

const THRESHOLDS = JSON.parse(
  readFileSync(
    resolve(
      __dirname,
      "../../../Visual overhaul/Thumbnails and Outline/Specifications/contrast-check.json",
    ),
    "utf8",
  ),
) as Record<string, number>;

interface RGB {
  r: number;
  g: number;
  b: number;
}

/** Parse the flat `selector { --a: b; ... }` block into a token map. */
function block(selector: RegExp): Record<string, string> {
  const start = CSS.search(selector);
  if (start === -1) throw new Error(`block not found: ${selector}`);
  const open = CSS.indexOf("{", start);
  const close = CSS.indexOf("}", open);
  const out: Record<string, string> = {};
  for (const decl of CSS.slice(open + 1, close).split(";")) {
    const m = decl.match(/^\s*(--[\w-]+)\s*:\s*(.+?)\s*$/s);
    if (m !== null) out[m[1]] = m[2];
  }
  return out;
}

const LIGHT = block(/:root\s*\{/);
const DARK = { ...LIGHT, ...block(/:root\[data-theme="dark"\]\s*\{/) };
const FROSTED = block(/:root\[data-theme="frosted"\]\s*\{/);

function hex(value: string): RGB {
  const m = value.trim().match(/^#([0-9a-f]{6})$/i);
  if (m === null) throw new Error(`unparseable colour: ${value}`);
  const h = m[1];
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

function lum(c: RGB): number {
  const channel = (n: number): number => {
    const s = n / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/** WCAG 2.1 contrast ratio between two opaque colours. */
function ratio(a: RGB, b: RGB): number {
  const l1 = lum(a);
  const l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

interface Theme {
  id: "light" | "dark";
  map: Record<string, string>;
}

const THEMES: readonly Theme[] = [
  { id: "light", map: LIGHT },
  { id: "dark", map: DARK },
];

const NAV_TOKENS = [
  "--tf-nav-surface",
  "--tf-nav-body-ink",
  "--tf-nav-helper-ink",
  "--tf-nav-selected-surface",
  "--tf-nav-selected-ink",
] as const;

describe("Phase 111 (TFL-1074 / DEF-613) — the navigator contrast contract", () => {
  it("declares the navigator-scoped palette in light, dark and frosted", () => {
    for (const [id, map] of [["light", LIGHT], ["dark", DARK], ["frosted", FROSTED]] as const) {
      for (const token of NAV_TOKENS) {
        expect(map[token], `${id} ${token}`).toBeTruthy();
      }
    }
    for (const { id, map } of THEMES) {
      expect(map["--tf-nav-body-ink"]).toBe(BUNDLE[id].foreground);
      expect(map["--tf-nav-helper-ink"]).toBe(BUNDLE[id].secondary);
      expect(map["--tf-nav-selected-ink"]).toBe(BUNDLE[id].accent);
      expect(map["--tf-nav-selected-surface"]).toBe(BUNDLE[id].selectedSurface);
      expect(map["--tf-nav-surface"]).toBe(BUNDLE[id].surface);
    }
  });

  it("meets all six contrast-check.json ratios (body / helper / selected)", () => {
    const measured: string[] = [];
    const failures: string[] = [];
    for (const { id, map } of THEMES) {
      const surface = hex(BUNDLE[id].surface);
      const selectedSurface = hex(BUNDLE[id].selectedSurface);
      const tiers: ReadonlyArray<[string, string, RGB]> = [
        ["body", map["--tf-nav-body-ink"] ?? "", surface],
        ["helper", map["--tf-nav-helper-ink"] ?? "", surface],
        ["selected", map["--tf-nav-selected-ink"] ?? "", selectedSurface],
      ];
      for (const [tier, ink, bg] of tiers) {
        const r = ratio(hex(ink), bg);
        const floor = THRESHOLDS[`${id}/${tier}`];
        measured.push(`${id}/${tier} ${r.toFixed(2)} (floor ${floor})`);
        if (Number(r.toFixed(2)) < floor) {
          failures.push(`${id}/${tier} = ${r.toFixed(2)} < ${floor}`);
        }
      }
    }
    console.log(`[DEF-613] navigator ratios: ${measured.join(" | ")}`);
    expect(failures, failures.join("\n")).toEqual([]);
  });
});
