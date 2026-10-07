// @vitest-environment node
//
// TFL-1116 C6 (finding R12) — ENABLED-control legibility in the settled dock
// and viewing footer.
//
// The defect: with the pointer away the dock and footer faded to
// `opacity: 0.4` even for ENABLED commands, so the settled chrome was almost
// illegible and only hover restored it. The correction: idle keeps its STATE
// (the 3s timing, hover/focus restore and the `data-*-idle` hooks) but paints
// CHROME only — it must never lower the opacity of enabled label/icon content.
//
// This spec parses the real stylesheet, proves no idle rule applies
// `opacity < 1`, and computes the WCAG 2.1 ratio on the COMPOSITED resting
// colours (not token hex alone). It mirrors the method of
// `phase40_headerGhostContrast.test.ts` and `phase110_homeContrast.test.ts`.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CSS_PATH = resolve(__dirname, "../../../src/renderer/styles.css");
const CSS = readFileSync(CSS_PATH, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

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

function resolveToken(
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

const BASE = vars(block(CSS, /:root\s*\{/));
const DARK = { ...BASE, ...vars(block(CSS, /:root\[data-theme="dark"\]\s*\{/)) };
const FROST = { ...BASE, ...vars(block(CSS, /:root\[data-theme="frosted"\]\s*\{/)) };

const THEMES: ReadonlyArray<{ id: string; map: Record<string, string> }> = [
  { id: "light", map: BASE },
  { id: "dark", map: DARK },
  { id: "frosted", map: FROST },
];

function tokenColor(theme: Record<string, string>, name: string): RGB {
  const raw = resolveToken(name, theme);
  if (raw === undefined) throw new Error(`unresolved token ${name}`);
  return parseColor(raw);
}

/** A chrome surface, composited over the theme base when it is translucent. */
function surface(theme: Record<string, string>, token: string): RGB {
  const s = tokenColor(theme, token);
  return s.a < 1 ? composite(s, tokenColor(theme, "--bg-base")) : s;
}

/** Every flat CSS rule as { selector, body } (innermost blocks; the idle hooks
 *  live at top level so nesting at-rules never hide them). */
function rules(css: string): Array<{ selector: string; body: string }> {
  const out: Array<{ selector: string; body: string }> = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) out.push({ selector: m[1].trim(), body: m[2] });
  return out;
}

function opacityDeclarations(body: string): number[] {
  const out: number[] = [];
  const re = /(?:^|;)\s*opacity\s*:\s*([^;]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const n = Number(m[1].trim());
    if (!Number.isNaN(n)) out.push(n);
  }
  return out;
}

const FLOOR = 4.5;
const IDLE_TOKENS = [
  "[data-dock-idle='true']",
  '[data-dock-idle="true"]',
  "[data-view-strip-idle='true']",
  '[data-view-strip-idle="true"]',
];
const selectsIdle = (selector: string): boolean => IDLE_TOKENS.some((t) => selector.includes(t));

describe("TFL-1116 R12 — idle keeps enabled dock/footer content legible", () => {
  it("the dock idle rule paints chrome only (no content opacity)", () => {
    const body = block(CSS, /\.action-dock\[data-dock-idle='true'\]\s*\{/);
    expect(opacityDeclarations(body), `dock idle body: ${body}`).toEqual([]);
    // The resting reduction is elevation (chrome), never content.
    expect(body).toMatch(/box-shadow:\s*none/);
  });

  it("the footer idle rule paints chrome only (no content opacity)", () => {
    const body = block(CSS, /\.view-strip\[data-view-strip-idle='true'\]\s*\{/);
    expect(opacityDeclarations(body), `footer idle body: ${body}`).toEqual([]);
    // The resting reduction is the separator (chrome), never content.
    expect(body).toMatch(/border-top-color:\s*transparent/);
  });

  it("no rule keyed on an idle hook applies opacity < 1 to anything", () => {
    const offenders = rules(CSS)
      .filter((r) => selectsIdle(r.selector))
      .flatMap((r) =>
        opacityDeclarations(r.body)
          .filter((n) => n < 1)
          .map((n) => `${r.selector} { opacity: ${n} }`),
      );
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("enabled content stays at full opacity while disabled remains visibly muted", () => {
    // Enabled label/icon opacity is 1 (no idle rule lowers it) — proven above.
    // Disabled keeps the canonical family dim so the two states stay distinct.
    expect(CSS).toMatch(/\.btn\[disabled\],[\s\S]{0,120}?opacity:\s*0\.55/);
    const disabled = Number(/\.btn\[disabled\],[\s\S]{0,120}?opacity:\s*([\d.]+)/.exec(CSS)?.[1]);
    expect(disabled).toBeLessThan(1);
    expect(disabled).toBeGreaterThan(0);
  });

  it("composited resting contrast clears 4.5:1 for enabled dock + footer content, all themes", () => {
    // Representative ENABLED content pairs, on the real chrome surfaces:
    //   dock verb ink --tf-icon-rest on --bg-elevated
    //   footer toolbar ink --fg on --bg-toolbar
    const pairs: ReadonlyArray<{ label: string; ink: string; surfaceToken: string }> = [
      { label: "dock", ink: "--tf-icon-rest", surfaceToken: "--bg-elevated" },
      { label: "footer", ink: "--fg", surfaceToken: "--bg-toolbar" },
    ];
    const failures: string[] = [];
    const measured: string[] = [];
    for (const { id, map } of THEMES) {
      for (const p of pairs) {
        const ink = tokenColor(map, p.ink);
        const surf = surface(map, p.surfaceToken);
        // Idle content is FULL opacity (alpha 1); the retired 0.4 parent fade
        // is modelled only to record how far below the floor it fell.
        const after = contrast(composite({ ...ink, a: 1 }, surf), surf);
        const before = contrast(composite({ ...ink, a: 0.4 }, surf), surf);
        measured.push(
          `${id} ${p.label}: ${before.toFixed(2)} (0.4 fade) -> ${after.toFixed(2)}`,
        );
        if (after < FLOOR) {
          failures.push(`${id} ${p.label} ${p.ink} on ${p.surfaceToken} = ${after.toFixed(2)}`);
        }
      }
    }
    console.log(`[TFL1116-R12] enabled content contrast: ${measured.join(" | ")}`);
    expect(failures, failures.join("\n")).toEqual([]);
  });
});
