// @vitest-environment node
//
// Phase 40 (items 11 + 12) — THE SEMANTIC PALETTE CONTRACT.
//
// Item 11 replaced the eight per-family --icon-* hues with a FINITE set of four
// named semantic roles applied by tool category / importance:
//
//   --sem-primary      PRIMARY / brand accent (selection, primary actions,
//                      the active panel edge)
//   --sem-neutral      NEUTRAL — the bulk of tools, navigation, app text
//   --sem-affirmative  AFFIRMATIVE — constructive / completion
//   --sem-attention    ATTENTION — destructive / critical
//
// This spec pins the three measurable promises:
//   1. FINITE: every palette-hooked rule (dock verb, tool-btn, annotation
//      tool, edit tool, tools-palette entry, rail tab, stage) resolves colour
//      only to a declared token — no raw hex/rgb/hsl survives;
//   2. MAPPING: every registry tool category resolves to exactly one declared
//      role (dock verbs, palette entries, annotation/edit tools), and all four
//      roles are actually used;
//   3. FLOORS: each role clears 4.5:1 as a LABEL on every chrome surface in
//      all three themes (and by extension the 3:1 icon floor), and the
//      disabled state stays its own distinct token.
//
// The contrast method is the Phase-38 legibility sweep's: resolve the REAL
// theme tokens out of styles.css, composite translucent frosted surfaces over
// the theme base, compute WCAG 2.1 ratios.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DOCK_STAGE_IDS, PALETTE_TOOL_IDS } from "../../../src/renderer/state/toolsRegistry";

const CSS = readFileSync(resolve(__dirname, "../../../src/renderer/styles.css"), "utf8");
const CSS_NO_COMMENTS = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

interface RGB {
  r: number;
  g: number;
  b: number;
  a: number;
}

function parseColor(value: string): RGB {
  const v = value.trim();
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex !== null) {
    let h = hex[1];
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  }
  const fn = v.match(/^rgba?\(([^)]+)\)$/i);
  if (fn !== null) {
    const p = fn[1].split(",").map((x) => x.trim());
    return { r: Number(p[0]), g: Number(p[1]), b: Number(p[2]), a: p[3] === undefined ? 1 : Number(p[3]) };
  }
  throw new Error(`Unparseable colour: ${value}`);
}

function composite(fg: RGB, base: RGB): RGB {
  const mix = (a: number, b: number): number => a * fg.a + b * (1 - fg.a);
  return { r: mix(fg.r, base.r), g: mix(fg.g, base.g), b: mix(fg.b, base.b), a: 1 };
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}
function luminance(c: RGB): number {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}
function contrast(a: RGB, b: RGB): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function block(css: string, selector: RegExp): string {
  const start = css.search(selector);
  if (start === -1) throw new Error(`selector not found: ${selector}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}
function vars(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const decl of source.split(";")) {
    const m = decl.match(/^\s*(--[\w-]+)\s*:\s*(.+?)\s*$/s);
    if (m !== null) out[m[1]] = m[2];
  }
  return out;
}
function resolveToken(name: string, theme: Record<string, string>, seen: readonly string[] = []): string | undefined {
  if (seen.includes(name)) return undefined;
  const raw = theme[name];
  if (raw === undefined) return undefined;
  const m = raw.match(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/);
  if (m === null) return raw;
  const r = resolveToken(m[1] ?? "", theme, [...seen, name]);
  return r ?? m[2]?.trim();
}

const BASE = vars(block(CSS_NO_COMMENTS, /:root\s*\{/));
const DARK = { ...BASE, ...vars(block(CSS_NO_COMMENTS, /:root\[data-theme="dark"\]\s*\{/)) };
const FROST = { ...BASE, ...vars(block(CSS_NO_COMMENTS, /:root\[data-theme="frosted"\]\s*\{/)) };
const THEMES: ReadonlyArray<{ id: string; map: Record<string, string> }> = [
  { id: "light", map: BASE },
  { id: "dark", map: DARK },
  { id: "frosted", map: FROST },
];

const ROLES = ["--sem-primary", "--sem-neutral", "--sem-affirmative", "--sem-attention"] as const;
const STAGES = ["--tf-stage-pages", "--tf-stage-edit", "--tf-stage-review", "--tf-stage-deliver"] as const;
/** The declared token set a palette-hooked rule may resolve to. */
const DECLARED = [
  ...ROLES,
  ...STAGES,
  "--dock-primary-fg",
  "--accent",
  "--accent-hover",
  "--accent-soft",
  "--accent-selected",
  "--accent-pressed-soft",
  "--accent-hover-bg",
  "--fg-strong",
  "--fg",
  "--fg-soft",
  "--fg-muted",
  "--fg-faint",
  "--fg-disabled",
  "--bg-hover",
  "--bg-active",
  "--border",
  "--border-strong",
  "--border-subtle",
  "--divider",
  "--stage-hue",
  "--stage-soft",
  "--family-hue",
  "--panel-border",
  "--focus-ring",
  "--tf-accent-focus",
  "--tf-icon-rest",
  "--tf-icon-active",
  "--tf-icon-disabled",
  "--tf-icon-danger",
  "--tf-icon-success",
] as const;

const SURFACES = ["--bg-elevated", "--bg-raised", "--bg-toolbar", "--bg-rail", "--panel-bg"] as const;
const TEXT_FLOOR = 4.5;

function surfaceColor(theme: Record<string, string>, name: string): RGB {
  const raw = resolveToken(name, theme);
  if (raw === undefined) throw new Error(`unresolved surface ${name}`);
  const baseRaw = resolveToken("--bg-base", theme);
  const parsed = parseColor(raw);
  return parsed.a < 1 ? composite(parsed, parseColor(baseRaw ?? "#ffffff")) : parsed;
}
function tokenColor(theme: Record<string, string>, name: string): RGB {
  const raw = resolveToken(name, theme);
  if (raw === undefined) throw new Error(`unresolved token ${name}`);
  return parseColor(raw);
}

/** Every rule whose selector carries a palette hook (dock verb, tool-btn icon,
 *  annotation/edit tool, tools-palette entry, rail tab, stage, context panel
 *  stage), with its body. */
const PALETTE_HOOK = /\[data-(?:dock-verb|tool-id|icon|tool|edit-tool|rail-tab|stage|context-panel-stage)=/;
function paletteRules(): ReadonlyArray<{ selector: string; body: string }> {
  const out: Array<{ selector: string; body: string }> = [];
  for (const m of CSS_NO_COMMENTS.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const selector = (m[1] ?? "").trim();
    if (PALETTE_HOOK.test(selector)) out.push({ selector, body: m[2] ?? "" });
  }
  return out;
}

/** The colour-bearing declarations of a rule body. */
function colorDecls(body: string): string[] {
  const out: string[] = [];
  for (const decl of body.split(";")) {
    const m = decl.match(/^\s*([\w-]*color|background|background-color)\s*:\s*(.+?)\s*$/is);
    if (m !== null) out.push(m[2] ?? "");
  }
  return out;
}

const RAW_COLOR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;
const NEUTRAL_OK = /^(transparent|none|inherit|currentColor|unset|initial)$/i;

describe("Phase 40 item 11 — the palette is FINITE (no colour outside the token set)", () => {
  it("every palette-hooked rule resolves colour only to a declared token", () => {
    const rules = paletteRules();
    expect(rules.length, "palette rules found").toBeGreaterThan(10);
    const failures: string[] = [];
    for (const rule of rules) {
      for (const value of colorDecls(rule.body)) {
        if (NEUTRAL_OK.test(value)) continue;
        if (RAW_COLOR.test(value)) {
          failures.push(`${rule.selector} -> ${value} (raw colour)`);
          continue;
        }
        const varNames = [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1] ?? "");
        if (varNames.length === 0) {
          failures.push(`${rule.selector} -> ${value} (not a token)`);
          continue;
        }
        for (const name of varNames) {
          if (!DECLARED.includes(name as (typeof DECLARED)[number])) {
            failures.push(`${rule.selector} -> ${name} (outside the declared set)`);
          }
        }
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });
});

describe("Phase 40 item 11 — every tool category maps to a declared role", () => {
  it("every Action Dock verb resolves to the state ink ladder", () => {
    // Phase 103 (chunk 3e) retired the per-command category colouring: the
    // resting dock is one graphite family (--tf-icon-rest) and only the
    // genuinely destructive commands keep a scoped rule (--tf-icon-danger).
    // Any other per-verb colour rule is a regression.
    const DESTRUCTIVE = new Set(["delete", "sanitize"]);
    const failures: string[] = [];
    for (const id of Object.values(DOCK_STAGE_IDS).flat()) {
      const re = new RegExp(`\\[data-dock-verb='${id}'\\][^{]*\\{([^}]*)\\}`);
      const m = re.exec(CSS_NO_COMMENTS);
      if (m === null) {
        if (DESTRUCTIVE.has(id)) failures.push(`destructive dock verb ${id}: no danger rule`);
        continue;
      }
      const body = m[1] ?? "";
      if (DESTRUCTIVE.has(id)) {
        if (!/var\(--tf-icon-danger\)/.test(body)) failures.push(`dock verb ${id}: ${body.trim()}`);
      } else {
        failures.push(`dock verb ${id}: unexpected scoped colour ${body.trim()}`);
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
    // The single graphite rest rule covers every other verb.
    expect(CSS_NO_COMMENTS).toMatch(
      /\.action-dock-verb:not\(\.action-dock-verb-primary\):not\(\[aria-pressed='true'\]\):not\(:disabled\)\s*\{\s*color:\s*var\(--tf-icon-rest\)/,
    );
  });

  it("every palette (tools) entry resolves to a semantic role", () => {
    const failures: string[] = [];
    for (const id of PALETTE_TOOL_IDS) {
      const re = new RegExp(`\\[data-tool-id="${id}"\\][^{]*\\{[^}]*color:\\s*var\\((--sem-[a-z]+)\\)`);
      const m = re.exec(CSS_NO_COMMENTS);
      if (m === null) failures.push(`palette entry ${id}: no --sem-* colour`);
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("every annotation and rail-tab hook resolves to a declared ink token", () => {
    const failures: string[] = [];
    // Phase 103 (chunk 3g, DEF-566) — the annotation tools no longer carry a
    // per-tool category role: their glyph ink rests on the shared icon ladder
    // (`--tf-icon-rest`) and arms to `--tf-icon-active`. The rail tab keeps its
    // stage token. Both are declared tokens; neither is a raw colour.
    const hooks: ReadonlyArray<{ re: RegExp; label: string }> = [
      { re: /\[data-tool="[a-z]+"\][^{]*\{[^}]*color:\s*var\((--(?:sem|tf-stage|tf-icon)-[a-z]+)\)/g, label: "annotation tool" },
      { re: /\[data-rail-tab="[a-z]+"\][^{]*\{[^}]*color:\s*var\((--(?:sem|tf-stage)-[a-z]+)\)/g, label: "rail tab" },
    ];
    for (const hook of hooks) {
      const matches = [...CSS_NO_COMMENTS.matchAll(hook.re)];
      if (matches.length === 0) failures.push(`${hook.label}: no mapped rule`);
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("all four roles are actually used by a tool rule", () => {
    const used = new Set(
      [...CSS_NO_COMMENTS.matchAll(/var\((--sem-[a-z]+)\)/g)].map((m) => m[1] ?? ""),
    );
    for (const role of ROLES) {
      expect(used, `${role} is unused`).toContain(role);
    }
  });
});

describe("Phase 40 item 11 — the semantic roles hold the contrast floors", () => {
  it("every role clears 4.5:1 as a LABEL on every chrome surface in all three themes", () => {
    const failures: string[] = [];
    const measured: string[] = [];
    for (const { id, map } of THEMES) {
      for (const surface of SURFACES) {
        const bg = surfaceColor(map, surface);
        for (const role of ROLES) {
          const ratio = contrast(tokenColor(map, role), bg);
          measured.push(`${id} ${role} on ${surface} = ${ratio.toFixed(2)}`);
          if (ratio < TEXT_FLOOR) failures.push(`${id} ${role} on ${surface} = ${ratio.toFixed(2)} (floor ${TEXT_FLOOR})`);
        }
      }
    }
    console.log(`[P40 palette] ${measured.join(" | ")}`);
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("the stage tokens resolve into the role values (one palette, not two)", () => {
    for (const { id, map } of THEMES) {
      const stageValues = STAGES.map((t) => resolveToken(t, map));
      for (const v of stageValues) {
        expect(v, `${id}: a stage token did not resolve`).toBeTruthy();
        expect(ROLES.map((r) => resolveToken(r, map)), `${id}: ${v} is not a role value`)
          .toContain(v);
      }
      expect(new Set(stageValues).size, `${id}: the four stages use four distinct roles`).toBe(4);
    }
  });

  it("keeps the disabled state a distinct token from every role", () => {
    for (const { id, map } of THEMES) {
      const disabled = resolveToken("--fg-disabled", map);
      expect(disabled, `${id} --fg-disabled`).toBeTruthy();
      const roles = ROLES.map((r) => resolveToken(r, map));
      expect(roles, `${id}: disabled is distinct from every role`).not.toContain(disabled);
    }
  });
});

describe("Phase 40 item 12/13 — separators and the active panel edge", () => {
  it("uses the neutral divider for separators and the primary accent for the ACTIVE edge only", () => {
    // Separators: the lowest-contrast neutral hairline, shared everywhere.
    expect(CSS_NO_COMMENTS).toMatch(
      /\.inspector-section-body > \* \+ \*\s*\{[^}]*border-top:\s*1px solid var\(--divider\)/,
    );
    expect(CSS_NO_COMMENTS).toMatch(
      /\.context-panel-outline\s*\{[^}]*border-top:\s*1px solid var\(--divider\)/,
    );
    // Phase 41 (item 4) SUPERSEDES the Phase-40 "active edge takes
    // --sem-primary" rule: the Inspector's page-facing edge is now the neutral
    // hairline plus a NEUTRAL shadow/glow while a selection is live.
    expect(CSS_NO_COMMENTS).toMatch(
      /\.inspector\[data-inspector-selection\]:not\(\[data-inspector-selection='none'\]\)\s*\{[^}]*border-left-color:\s*var\(--panel-border\)/,
    );
    expect(CSS_NO_COMMENTS).toMatch(
      /\.inspector\[data-inspector-selection\]:not\(\[data-inspector-selection='none'\]\)\s*\{[^}]*box-shadow:/,
    );
    // The retired accent edge must be gone.
    expect(CSS_NO_COMMENTS).not.toMatch(
      /\.inspector\[data-inspector-selection\]:not\(\[data-inspector-selection='none'\]\)\s*\{[^}]*border-left-color:\s*var\(--sem-primary\)/,
    );
    // No decorative one-sided accent stripe exists on a resting panel.
    expect(CSS_NO_COMMENTS).not.toMatch(/border-(?:left|right):\s*\d+px solid var\(--sem-/);
    expect(CSS_NO_COMMENTS).not.toMatch(/border-(?:left|right):\s*\d+px solid var\(--family-hue/);
  });
});

