// Phase 125 (TFL-1419 / TFL-1458 chunk B) — the whole-app text-legibility oracle.
//
// Retunes the visible-text ink ladder and proves it: resolve the REAL theme
// token colours out of src/renderer/styles.css for light (:root), dark
// (:root[data-theme="dark"]) and frosted (:root[data-theme="frosted"]),
// composite every translucent frosted surface over its base, then score every
// visible-text tier against every chrome surface at the WCAG 2.1 AA 4.5:1 body
// floor. It also pins --tf-text-supporting === --tf-nav-helper-ink per theme,
// the supporting-vs-muted hierarchy in light, the crispness change (no forced
// grayscale antialiasing on body), and that no enumerated visible-text selector
// still resolves its color to --fg-faint.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CSS_PATH = resolve(__dirname, "../../../src/renderer/styles.css");
const CSS = readFileSync(CSS_PATH, "utf8");
/** Comments stripped before parsing, so a declaration preceded by a comment in
 *  the same `;`-delimited chunk is never dropped. */
const CSS_NO_COMMENTS = CSS.replace(/\/\*[\s\S]*?\*\//g, "");

interface RGB {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Parse #rgb / #rrggbb / rgb() / rgba() into an RGBA record. */
export function parseColor(value: string): RGB {
  const v = value.trim();
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex !== null) {
    let h = hex[1];
    if (h.length === 3) h = h.split("").map((c) => c + c).join("");
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
      a: 1,
    };
  }
  const fn = v.match(/^rgba?\(([^)]+)\)$/i);
  if (fn !== null) {
    const parts = fn[1].split(",").map((p) => p.trim());
    return {
      r: Number(parts[0]),
      g: Number(parts[1]),
      b: Number(parts[2]),
      a: parts[3] === undefined ? 1 : Number(parts[3]),
    };
  }
  throw new Error(`Unparseable colour: ${value}`);
}

/** Composite a possibly-translucent colour over an opaque base. */
export function composite(fg: RGB, base: RGB): RGB {
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

/** WCAG 2.1 contrast ratio between two opaque colours. */
export function contrast(a: RGB, b: RGB): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Extract a declaration block (`selector { ... }`) from the stylesheet. */
export function block(css: string, selector: RegExp): string {
  const start = css.search(selector);
  if (start === -1) throw new Error(`selector not found: ${selector}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

/** Parse `--name: value` declarations from a block. */
export function vars(source: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const decl of source.split(";")) {
    const m = decl.match(/^\s*(--[\w-]+)\s*:\s*(.+?)\s*$/s);
    if (m !== null) out[m[1]] = m[2];
  }
  return out;
}

/** Resolve a token (following var() chains and fallbacks) in a theme map. */
export function resolveToken(
  name: string,
  theme: Record<string, string>,
  seen: readonly string[] = [],
): string | undefined {
  if (seen.includes(name)) return undefined;
  const raw = theme[name];
  if (raw === undefined) return undefined;
  const m = raw.match(/var\(\s*(--[\w-]+)\s*(?:,\s*([^)]+))?\)/);
  if (m === null) return raw;
  const resolved = resolveToken(m[1], theme, [...seen, name]);
  if (resolved !== undefined) return resolved;
  return m[2]?.trim();
}

const BASE = vars(block(CSS_NO_COMMENTS, /:root\s*\{/));
const DARK = { ...BASE, ...vars(block(CSS_NO_COMMENTS, /:root\[data-theme="dark"\]\s*\{/)) };
const FROST = { ...BASE, ...vars(block(CSS_NO_COMMENTS, /:root\[data-theme="frosted"\]\s*\{/)) };

const THEMES: ReadonlyArray<{ id: string; map: Record<string, string> }> = [
  { id: "light", map: BASE },
  { id: "dark", map: DARK },
  { id: "frosted", map: FROST },
];

/** Every chrome surface a visible-text tier may sit on. */
const SURFACES = [
  "--bg-base",
  "--bg-toolbar",
  "--bg-rail",
  "--bg-panel",
  "--panel-bg",
  "--bg-elevated",
  "--bg-raised",
  "--bg-secondary",
  "--bg-sunken",
] as const;

/** Every visible-text tier: the six shared ink steps plus the frosted ladder. */
const TEXT_TOKENS = [
  "--fg-strong",
  "--fg",
  "--fg-muted",
  "--fg-soft",
  "--tf-text-supporting",
  "--tf-nav-helper-ink",
  "--tf-text-primary",
  "--tf-text-secondary",
  "--tf-text-tertiary",
  "--tf-text-disabled",
] as const;

/** The six tiers declared in every theme (the frosted --tf-text-* are
 *  theme-scoped and only resolve under data-theme="frosted"). */
const CORE_TOKENS = [
  "--fg-strong",
  "--fg",
  "--fg-muted",
  "--fg-soft",
  "--tf-text-supporting",
  "--tf-nav-helper-ink",
] as const;

const TEXT_FLOOR = 4.5;

function surfaceColor(theme: Record<string, string>, name: string): RGB {
  const raw = resolveToken(name, theme);
  if (raw === undefined) throw new Error(`unresolved surface ${name}`);
  const baseRaw = resolveToken("--bg-base", theme);
  if (baseRaw === undefined) throw new Error("unresolved --bg-base");
  const parsed = parseColor(raw);
  // Frosted surfaces are translucent; the ACTUAL surface is the composite over
  // the theme base (what the user's eye integrates through the glass).
  return parsed.a < 1 ? composite(parsed, parseColor(baseRaw)) : parsed;
}

function tokenColor(theme: Record<string, string>, name: string): RGB {
  const raw = resolveToken(name, theme);
  if (raw === undefined) throw new Error(`unresolved token ${name}`);
  return parseColor(raw);
}

describe("Phase 125 chunk B — the whole-app text-legibility sweep", () => {
  it("declares the six shared tiers in every theme and the frosted ladder in frosted", () => {
    for (const { id, map } of THEMES) {
      for (const token of CORE_TOKENS) {
        expect(resolveToken(token, map), `${id} ${token}`).toBeTruthy();
      }
    }
    for (const token of [
      "--tf-text-primary",
      "--tf-text-secondary",
      "--tf-text-tertiary",
      "--tf-text-disabled",
    ] as const) {
      expect(resolveToken(token, FROST), `frosted ${token}`).toBeTruthy();
    }
  });

  it("sweeps every visible-text tier over every chrome surface at >= 4.5:1, naming each failing pair", () => {
    const failures: string[] = [];
    let checked = 0;
    for (const { id, map } of THEMES) {
      for (const surface of SURFACES) {
        const bg = surfaceColor(map, surface);
        for (const token of TEXT_TOKENS) {
          // Theme-scoped tiers (the frosted --tf-text-* ladder) are absent from
          // the light/dark maps; only score the pairs that actually render.
          if (resolveToken(token, map) === undefined) continue;
          const ratio = contrast(tokenColor(map, token), bg);
          checked += 1;
          if (ratio < TEXT_FLOOR) {
            failures.push(`${id} ${token} on ${surface} = ${ratio.toFixed(2)} (floor ${TEXT_FLOOR})`);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("keeps --tf-text-supporting equal to --tf-nav-helper-ink in every theme", () => {
    for (const { id, map } of THEMES) {
      expect(resolveToken("--tf-nav-helper-ink", map), `${id} nav helper ink`).toBe(
        resolveToken("--tf-text-supporting", map),
      );
    }
  });

  it("keeps --tf-text-supporting lighter than --fg-muted in light (hierarchy survives)", () => {
    const supporting = tokenColor(BASE, "--tf-text-supporting");
    const muted = tokenColor(BASE, "--fg-muted");
    expect(luminance(supporting), "supporting luminance > muted luminance").toBeGreaterThan(
      luminance(muted),
    );
  });

  it("restores the Windows-default font rendering (no forced grayscale antialiasing)", () => {
    expect(CSS_NO_COMMENTS).not.toContain("-webkit-font-smoothing");
    expect(CSS_NO_COMMENTS).toContain("text-rendering: optimizeLegibility;");
    expect(CSS_NO_COMMENTS).toContain('font-feature-settings: "cv11", "ss01", "ss03";');
  });

  it("repoints every enumerated visible-text selector off --fg-faint", () => {
    const selectors: ReadonlyArray<{ name: string; re: RegExp }> = [
      { name: ".outline-empty", re: /\.outline-empty\s*\{/ },
      { name: ".thumb-empty", re: /\.thumb-empty\s*\{/ },
      { name: ".ann-panel-row-page", re: /\.ann-panel-row-page\s*\{/ },
      { name: ".ann-panel-text-readonly", re: /\.ann-panel-text-readonly\s*\{/ },
      { name: ".tools-palette-entry-shortcut", re: /\.tools-palette-entry-shortcut\s*\{/ },
      { name: ".color-palette-count", re: /\.color-palette-count\s*\{/ },
      // Brief anchor 12515 lands on the fg-faint rule beside .optimize-fft-value.
      { name: ".optimize-fft-muted", re: /\.optimize-fft-muted\s*\{/ },
      { name: ".audit-bar-hint", re: /\.audit-bar-hint\s*\{/ },
      { name: ".create-image-index", re: /\.create-image-index\s*\{/ },
      { name: ".ocr-suspects-pages", re: /\.ocr-suspects-pages\s*\{/ },
      { name: ".ocr-suspects-page-count", re: /\.ocr-suspects-page-count\s*\{/ },
      // Brief anchor 14566 lands on the fg-faint rule beside .ocr-suspects-count-value.
      { name: ".ocr-suspects-columns", re: /\.ocr-suspects-columns\s*\{/ },
      {
        name: ".command-palette-input::placeholder",
        re: /\.command-palette-input::placeholder\s*\{/,
      },
      { name: ".doc-info-section-empty", re: /\.doc-info-section-empty\s*\{/ },
      { name: ".intake-index", re: /\.intake-index\s*\{/ },
    ];
    const failures: string[] = [];
    for (const { name, re } of selectors) {
      const rule = block(CSS_NO_COMMENTS, re);
      if (!/color:\s*var\(--tf-text-supporting\)/.test(rule)) {
        failures.push(`${name} does not resolve color to --tf-text-supporting`);
      }
      if (/color:\s*var\(--fg-faint\)/.test(rule)) {
        failures.push(`${name} still resolves color to --fg-faint`);
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("keeps the five decorative / disabled exemptions on --fg-faint", () => {
    const exemptions: ReadonlyArray<{ name: string; re: RegExp }> = [
      { name: ".empty-state-mark", re: /\.empty-state-mark\s*\{/ },
      {
        name: ".thread-stream-row-meta [data-ann-icon]",
        re: /\.thread-stream-row-meta \[data-ann-icon\]\s*\{/,
      },
      { name: ".multi-pane-empty-icon", re: /\.multi-pane-empty-icon\s*\{/ },
      {
        name: ".command-palette-row-disabled .command-palette-row-desc",
        re: /\.command-palette-row-disabled \.command-palette-row-desc\s*\{/,
      },
      { name: ".accounts-divider", re: /\.accounts-divider\s*\{/ },
    ];
    for (const { name, re } of exemptions) {
      expect(block(CSS_NO_COMMENTS, re), `${name} keeps --fg-faint`).toMatch(
        /color:\s*var\(--fg-faint\)/,
      );
    }
  });
});
