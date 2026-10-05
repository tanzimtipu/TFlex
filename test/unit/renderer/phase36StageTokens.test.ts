// @vitest-environment node
//
// Phase 36 (chunk 8) — the four per-theme STAGE-IDENTIFICATION tokens.
//
// Phase 40 (item 11) SUPERSEDES the original contract: the stage tokens no
// longer carry their own cyan/amber/rose/green hues. They now RESOLVE from the
// single semantic 4-role palette (--sem-neutral / --sem-primary /
// --sem-attention / --sem-affirmative), one role per stage by what the stage is
// FOR. This spec keeps the three things chunk 8 cared about, retargeted:
//
//   1. all four --tf-stage-* tokens exist in all three theme blocks and each
//      resolves to the declared semantic role via var();
//   2. the four stage roles resolve to four PAIRWISE-DISTINCT values and each
//      clears the WCAG AA floors on the surface it is drawn on: 4.5:1 for the
//      chip LABEL, 3:1 for the rail ICON / chip graphic;
//   3. the CommandPalette + StageRail rules still CONSUME the tokens (no
//      literals) — the chip label + tint, the pin marker and the rail icon all
//      resolve from the vars, and the brand accent keeps the active affordance.
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
/** The Phase 40 semantic roles, one per stage (the declared mapping). */
const STAGE_ROLE: Record<(typeof STAGES)[number], string> = {
  pages: "--sem-neutral",
  edit: "--sem-primary",
  review: "--sem-attention",
  deliver: "--sem-affirmative",
};

const block = (re: RegExp): string => re.exec(CSS)?.[1] ?? "";
/** Comments stripped before a block is split into declarations, so a `--name`
 *  declaration preceded by a comment is never dropped. */
const stripComments = (s: string): string => s.replace(/\/\*[\s\S]*?\*\//g, "");
const rootVars = ((): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const decl of stripComments(block(/:root\s*\{([\s\S]*?)\n\}/m)).split(";")) {
    const m = decl.match(/^\s*(--[\w-]+)\s*:\s*(.+?)\s*$/s);
    if (m !== null) out[m[1]] = m[2];
  }
  return out;
})();
const merge = (theme: string): Record<string, string> => {
  const out = { ...rootVars };
  for (const decl of stripComments(theme).split(";")) {
    const m = decl.match(/^\s*(--[\w-]+)\s*:\s*(.+?)\s*$/s);
    if (m !== null) out[m[1]] = m[2];
  }
  return out;
};
const lightBlock = block(/:root\s*\{([\s\S]*?)\n\}/m);
const darkBlock = block(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/m);
const frostedBlock = block(/:root\[data-theme="frosted"\]\s*\{([\s\S]*?)\n\}/m);
const THEME_MAPS: Record<string, Record<string, string>> = {
  light: merge(lightBlock),
  dark: merge(darkBlock),
  frosted: merge(frostedBlock),
};

/** Resolve a token through any var() chain inside a theme map. */
function resolveVar(map: Record<string, string>, name: string, seen: readonly string[] = []): string | undefined {
  if (seen.includes(name)) return undefined;
  const raw = map[name];
  if (raw === undefined) return undefined;
  const m = raw.match(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/);
  if (m === null) return raw;
  const r = resolveVar(map, m[1] ?? "", [...seen, name]);
  return r ?? m[2]?.trim();
}

/** The first six-digit hex a token resolves to inside a theme map. */
function hex(map: Record<string, string>, name: string): number[] {
  const raw = resolveVar(map, name);
  const m = raw === undefined ? null : /^#([0-9a-fA-F]{6})$/.exec(raw.trim());
  expect(m, `${name} must resolve to a 6-digit hex`).not.toBeNull();
  const s = (m?.[1] ?? "000000");
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
}

function rgba(value: string): number[] {
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/.exec(value);
  return [Number(m?.[1] ?? 0), Number(m?.[2] ?? 0), Number(m?.[3] ?? 0), m?.[4] === undefined ? 1 : Number(m[4])];
}

function rgbaDecl(raw: string, name: string): number[] {
  const m = new RegExp(`${name}\\s*:\\s*(rgba?\\([^)]*\\))`).exec(raw);
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

/** The surface a token is drawn on, per theme (card = palette, rail = stage rail). */
const surfaces = {
  light: { card: hex(THEME_MAPS.light, "--bg-raised"), rail: hex(THEME_MAPS.light, "--bg-rail") },
  dark: { card: hex(THEME_MAPS.dark, "--bg-raised"), rail: hex(THEME_MAPS.dark, "--bg-rail") },
  frosted: {
    card: over(rgbaDecl(frostedBlock, "--tf-surface-dialog"), hex(THEME_MAPS.frosted, "--tf-bg")),
    rail: over(rgbaDecl(frostedBlock, "--glass-sidebar-bg"), hex(THEME_MAPS.frosted, "--tf-bg")),
  },
};
/** The 10% stage tint the chip background uses (the CSS color-mix alpha). */
const chipBg = (token: number[], card: number[]): number[] =>
  token.map((c, i) => Math.round(c * 0.1 + (card[i] ?? 0) * 0.9));
/** The rail's active wash: --accent-soft (0.12) over the rail surface. */
const activeRail = (themeName: string, rail: number[]): number[] => {
  const accent = rgba(String(resolveVar(THEME_MAPS[themeName], "--accent-soft") ?? "rgba(37,99,235,0.12)"));
  return over([accent[0] ?? 0, accent[1] ?? 0, accent[2] ?? 0, accent[3] ?? 0.12], rail);
};

const THEMES = [
  ["light", lightBlock],
  ["dark", darkBlock],
  ["frosted", frostedBlock],
] as const;

describe("Phase 40 item 11 — the stage tokens resolve from the semantic roles", () => {
  for (const [name, theme] of THEMES) {
    it(`binds all four --tf-stage-* tokens to their declared role (${name})`, () => {
      for (const stage of STAGES) {
        const token = `--tf-stage-${stage}`;
        const raw = merge(theme)[token];
        expect(raw, `${token} missing from the ${name} theme`).toBeDefined();
        expect(raw, `${token} must resolve from ${STAGE_ROLE[stage]}`).toContain(
          `var(${STAGE_ROLE[stage]})`,
        );
      }
    });
  }

  it("uses exactly the four declared semantic roles — no fifth colour", () => {
    for (const { name } of THEMES.map(([n]) => ({ name: n }))) {
      const map = THEME_MAPS[name];
      for (const role of Object.values(STAGE_ROLE)) {
        expect(map[role], `${role} missing from the ${name} theme`).toBeDefined();
      }
    }
  });
});

describe("Phase 40 item 11 — WCAG AA + role distinctness", () => {
  for (const [name] of THEMES) {
    it(`keeps the four stage roles distinct and above the AA floors (${name})`, () => {
      const surface = surfaces[name];
      const values = TOKENS.map((t) => hex(THEME_MAPS[name], t));

      // 1. Distinctness: the four stages resolve to four different values.
      const serialised = values.map((v) => v.join(","));
      expect(new Set(serialised).size, `${name}: the four stage roles are pairwise distinct`).toBe(4);

      // 2. The chip LABEL (stage role on the 10% wash of itself) clears 4.5:1.
      for (let i = 0; i < values.length; i += 1) {
        const token = values[i] ?? [];
        const ratio = contrast(token, chipBg(token, surface.card));
        expect(ratio, `${STAGES[i]} chip label on the ${name} card`).toBeGreaterThanOrEqual(4.5);
      }

      // 3. The stage IDENTIFIER (rail icon, chip graphic) clears 3:1 on the
      //    resting rail and on the active rail's accent-soft wash.
      const active = activeRail(name, surface.rail);
      for (let i = 0; i < values.length; i += 1) {
        const token = values[i] ?? [];
        expect(contrast(token, surface.rail), `${STAGES[i]} icon on the ${name} rail`).toBeGreaterThanOrEqual(3);
        expect(contrast(token, active), `${STAGES[i]} icon on the active ${name} rail`).toBeGreaterThanOrEqual(3);
      }
    });
  }
});

describe("Phase 40 item 11 — the palette + rail consume the tokens (no literals)", () => {
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
    // DEF-354 — the non-stage fallback is the accent-family on-wash ink
    // (`--dock-primary-fg`), not the plain `--accent`, so the Recent / Global
    // tags clear the 4.5:1 floor in all three themes.
    expect(rule).toMatch(/color:\s*var\(--stage-hue,\s*var\(--dock-primary-fg\)\)/);
    expect(rule).not.toMatch(NO_LITERAL);
  });

  it("binds each of the four stages to its own token (chip tint + pin marker)", () => {
    for (const stage of STAGES) {
      const rule = body(`.command-palette-row[data-stage="${stage}"]`);
      expect(rule).toMatch(new RegExp(`--stage-hue:\\s*var\\(--tf-stage-${stage}\\)`));
      expect(rule).toMatch(new RegExp(`--stage-soft:\\s*color-mix\\(in srgb,\\s*var\\(--tf-stage-${stage}\\)\\s*10%`));
      expect(rule).not.toMatch(NO_LITERAL);
    }
    const pin = body(".command-palette-pin-toggle-on {");
    expect(pin).toMatch(/color:\s*var\(--stage-hue,\s*var\(--accent\)\)/);
    expect(pin).not.toMatch(NO_LITERAL);
  });

  it("rests each rail icon in the neutral ink and accents it only when active", () => {
    // Phase 103 (chunk 3e) retired the per-stage category hue: navigation
    // categories carry no permanent colour. Every stage glyph uses the single
    // rest ink; the active stage takes the one accent ink. The active stage's
    // wash + leading-edge rail (checked below) carry the selection identity.
    const icon = body(".stage-rail-btn .stage-rail-icon {");
    expect(icon).toMatch(/color:\s*var\(--tf-icon-rest\)/);
    expect(icon).not.toMatch(NO_LITERAL);
    const active = body(".stage-rail-btn-active .stage-rail-icon {");
    expect(active).toMatch(/color:\s*var\(--tf-icon-active\)/);
    expect(active).not.toMatch(NO_LITERAL);
  });

  it("keeps the active stage affordance on the brand accent, never a stage hue", () => {
    // The rail's active wash + 2px indicator and the palette's active row stay
    // accent; a stage hue must never claim them.
    // DEF-578 (fix attempt 2) — the active fill must out-specify the generic
    // `.btn-toggle[aria-pressed="true"]` override, so it lives on the
    // rail-scoped aria-pressed selector, never a bare `.stage-rail-btn-active`.
    expect(body('.stage-rail .stage-rail-btn[aria-pressed="true"] {')).toMatch(/background:\s*var\(--tf-siderail-selected-surface\)/);
    expect(body(".stage-rail-btn-active::before {")).toMatch(/background:\s*var\(--accent\)/);
    expect(body(".command-palette-row-active {")).toMatch(/background:\s*var\(--accent-selected\)/);
  });
});
