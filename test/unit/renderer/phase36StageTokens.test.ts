// @vitest-environment node
//
// Phase 36 (chunk 8) — the four per-theme STAGE-IDENTIFICATION tokens.
//
// styles.css defines --tf-stage-pages / --tf-stage-edit / --tf-stage-review /
// --tf-stage-deliver once per theme (light :root, flat dark, frosted). This
// contract pins three things at the source, mirroring designTokensContract's
// read-the-stylesheet idiom:
//
//   1. every token exists in all three theme blocks and is a plain hex;
//   2. the four hues are mutually distinguishable in every theme (>= 35deg of
//      hue separation) and each clears the WCAG AA floors on the surface it is
//      drawn on: 4.5:1 for the chip LABEL, 3:1 for the rail ICON / chip tint;
//   3. the CommandPalette + StageRail rules CONSUME the tokens (no literals) —
//      the chip label + tint, the pin marker and the rail icon all resolve
//      from the vars, and the brand accent keeps the active affordance.
//
// The contrast numbers are computed here from the SAME declared surface values
// the CSS resolves: the palette card is --bg-raised, the rail is --bg-rail, and
// frosted composites its translucent white films over --tf-bg. qa owns the
// visual pass across the three live themes.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(resolve(process.cwd(), "src/renderer/styles.css"), "utf8");

const STAGES = ["pages", "edit", "review", "deliver"] as const;
const TOKENS = STAGES.map((s) => `--tf-stage-${s}`);

const block = (re: RegExp): string => re.exec(CSS)?.[1] ?? "";
const light = block(/:root\s*\{([\s\S]*?)\n\}/m);
const dark = block(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/m);
const frosted = block(/:root\[data-theme="frosted"\]\s*\{([\s\S]*?)\n\}/m);

/** The first six-digit hex a token resolves to inside a theme block. */
function hex(theme: string, name: string): number[] {
  const m = new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{6})`).exec(theme);
  expect(m, `${name} must be defined as a 6-digit hex`).not.toBeNull();
  const s = (m?.[1] ?? "#000000").slice(1);
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
}

function rgba(value: string): number[] {
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/.exec(value);
  return [Number(m?.[1] ?? 0), Number(m?.[2] ?? 0), Number(m?.[3] ?? 0), m?.[4] === undefined ? 1 : Number(m[4])];
}

function rgbaDecl(theme: string, name: string): number[] {
  const m = new RegExp(`${name}\\s*:\\s*(rgba?\\([^)]*\\))`).exec(theme);
  expect(m, `${name} must be an rgba() film`).not.toBeNull();
  return rgba(m?.[1] ?? "rgba(255,255,255,1)");
}

/** Composite a translucent film [r,g,b,a] over an opaque surface. */
const over = (film: number[], surface: number[]): number[] =>
  film.slice(0, 3).map((c, i) => Math.round(c * (film[3] ?? 1) + (surface[i] ?? 0) * (1 - (film[3] ?? 1))));

const lin = (c: number): number => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const lum = (rgb: number[]): number => 0.2126 * lin(rgb[0] ?? 0) + 0.7152 * lin(rgb[1] ?? 0) + 0.0722 * lin(rgb[2] ?? 0);
const contrast = (a: number[], b: number[]): number => {
  const [hi, lo] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)];
  return (hi + 0.05) / (lo + 0.05);
};
const hue = (rgb: number[]): number => {
  const [r, g, b] = [0, 1, 2].map((i) => (rgb[i] ?? 0) / 255);
  const mx = Math.max(r ?? 0, g ?? 0, b ?? 0);
  const mn = Math.min(r ?? 0, g ?? 0, b ?? 0);
  const d = mx - mn;
  if (d === 0) return 0;
  let h = mx === r ? ((g ?? 0) - (b ?? 0)) / d : mx === g ? ((b ?? 0) - (r ?? 0)) / d + 2 : ((r ?? 0) - (g ?? 0)) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
};
/** Circular distance between two hue angles, in degrees. */
const hueGap = (a: number, b: number): number => {
  const d = Math.abs(a - b) % 360;
  return Math.min(d, 360 - d);
};

/** The surface a token is drawn on, per theme (card = palette, rail = stage rail). */
const surfaces = {
  light: { card: hex(light, "--bg-raised"), rail: hex(light, "--bg-rail") },
  dark: { card: hex(dark, "--bg-raised"), rail: hex(dark, "--bg-rail") },
  frosted: {
    card: over(rgbaDecl(frosted, "--tf-surface-dialog"), hex(frosted, "--tf-bg")),
    rail: over(rgbaDecl(frosted, "--glass-sidebar-bg"), hex(frosted, "--tf-bg")),
  },
};
/** The 10% stage tint the chip background uses (the CSS color-mix alpha). */
const chipBg = (token: number[], card: number[]): number[] =>
  token.map((c, i) => Math.round(c * 0.1 + (card[i] ?? 0) * 0.9));
/** The rail's active wash: --accent-soft (0.12) over the rail surface. */
const activeRail = (rail: number[]): number[] => {
  const accent = rgba((/--accent-soft:\s*(rgba\([^)]*\))/.exec(light)?.[1]) ?? "rgba(37,99,235,0.12)");
  return over([accent[0] ?? 0, accent[1] ?? 0, accent[2] ?? 0, accent[3] ?? 0.12], rail);
};

const THEMES = [
  ["light", light],
  ["dark", dark],
  ["frosted", frosted],
] as const;

describe("Phase 36 chunk 8 — the four stage tokens exist per theme", () => {
  for (const [name, theme] of THEMES) {
    it(`defines all four --tf-stage-* tokens in the ${name} theme`, () => {
      for (const token of TOKENS) {
        const m = new RegExp(`${token}\\s*:\\s*#[0-9a-fA-F]{6}`).exec(theme);
        expect(m, `${token} missing from the ${name} theme`).not.toBeNull();
      }
    });
  }

  it("leaves the brand accent untouched (the tokens are stage-identification only)", () => {
    // The stage hues are distinct from the accent in every theme, so a stage
    // chip can never read as a primary/selection affordance.
    const accent = /--accent:\s*(#[0-9a-fA-F]{6})/.exec(light)?.[1] ?? "";
    for (const [name, theme] of THEMES) {
      for (const token of TOKENS) {
        const v = new RegExp(`${token}\\s*:\\s*(#[0-9a-fA-F]{6})`).exec(theme)?.[1] ?? "";
        expect(v.toLowerCase(), `${token} must not equal the accent in ${name}`).not.toBe(accent.toLowerCase());
      }
    }
  });
});

describe("Phase 36 chunk 8 — WCAG AA + mutual distinguishability", () => {
  for (const [name] of THEMES) {
    it(`keeps the four hues a stage apart and above the AA floors (${name})`, () => {
      const theme = name === "light" ? light : name === "dark" ? dark : frosted;
      const surface = surfaces[name];
      const values = TOKENS.map((t) => hex(theme, t));

      // 1. Mutual distinguishability: every pair differs by >= 35deg of hue.
      for (let i = 0; i < values.length; i += 1) {
        for (let j = i + 1; j < values.length; j += 1) {
          const gap = hueGap(hue(values[i] ?? []), hue(values[j] ?? []));
          expect(gap, `${STAGES[i]} vs ${STAGES[j]} in ${name}`).toBeGreaterThanOrEqual(35);
        }
      }

      // 2. The chip LABEL (stage hue on the 10% wash of itself) clears 4.5:1.
      for (let i = 0; i < values.length; i += 1) {
        const token = values[i] ?? [];
        const ratio = contrast(token, chipBg(token, surface.card));
        expect(ratio, `${STAGES[i]} chip label on the ${name} card`).toBeGreaterThanOrEqual(4.5);
      }

      // 3. The stage IDENTIFIER (rail icon, chip graphic) clears 3:1 on the
      //    resting rail and on the active rail's accent-soft wash.
      const active = activeRail(surface.rail);
      for (let i = 0; i < values.length; i += 1) {
        const token = values[i] ?? [];
        expect(contrast(token, surface.rail), `${STAGES[i]} icon on the ${name} rail`).toBeGreaterThanOrEqual(3);
        expect(contrast(token, active), `${STAGES[i]} icon on the active ${name} rail`).toBeGreaterThanOrEqual(3);
      }
    });
  }
});

describe("Phase 36 chunk 8 — the palette + rail consume the tokens (no literals)", () => {
  const body = (sel: string): string => {
    const idx = CSS.indexOf(sel);
    expect(idx, `${sel} rule missing`).toBeGreaterThan(-1);
    const open = CSS.indexOf("{", idx);
    return CSS.slice(open + 1, CSS.indexOf("}", open));
  };
  const NO_LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/;

  it("the stage-tag chip resolves its fill and label from the stage vars", () => {
    const rule = body(".command-palette-tag {");
    expect(rule).toMatch(/background:\s*var\(--stage-soft,\s*var\(--accent-soft\)\)/);
    expect(rule).toMatch(/color:\s*var\(--stage-hue,\s*var\(--accent\)\)/);
    expect(rule).not.toMatch(NO_LITERAL);
  });

  it("binds each of the four stages to its own token (chip tint + pin marker)", () => {
    for (const stage of STAGES) {
      const rule = body(`.command-palette-row[data-stage="${stage}"]`);
      expect(rule).toMatch(new RegExp(`--stage-hue:\\s*var\\(--tf-stage-${stage}\\)`));
      expect(rule).toMatch(new RegExp(`--stage-soft:\\s*color-mix\\(in srgb,\\s*var\\(--tf-stage-${stage}\\)\\s*10%`));
      expect(rule).not.toMatch(NO_LITERAL);
    }
    const pin = body(".command-palette-pin {");
    expect(pin).toMatch(/color:\s*var\(--stage-hue,\s*var\(--accent\)\)/);
    expect(pin).not.toMatch(NO_LITERAL);
  });

  it("tints each rail icon with its stage token (the section comment pattern)", () => {
    for (const stage of STAGES) {
      const rule = body(`.stage-rail-btn[data-stage="${stage}"] {`);
      expect(rule).toMatch(new RegExp(`--stage-hue:\\s*var\\(--tf-stage-${stage}\\)`));
      expect(rule).not.toMatch(NO_LITERAL);
    }
    const icon = body(".stage-rail-btn[data-stage] .stage-rail-icon {");
    expect(icon).toMatch(/color:\s*var\(--stage-hue\)/);
    expect(icon).not.toMatch(NO_LITERAL);
  });

  it("keeps the active stage affordance on the brand accent, never a stage hue", () => {
    // The rail's active wash + 2px indicator and the palette's active row stay
    // accent; a stage hue must never claim them.
    expect(body(".stage-rail-btn-active {")).toMatch(/background:\s*var\(--accent-soft\)/);
    expect(body(".stage-rail-btn-active::before {")).toMatch(/background:\s*var\(--accent\)/);
    expect(body(".command-palette-row-active {")).toMatch(/background:\s*var\(--accent-selected\)/);
  });
});
