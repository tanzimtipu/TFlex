// @vitest-environment node
//
// Phase 110 (chunk E2) / DEF-594 / ADV-224 - the LIGHT Home-hero supporting
// text contrast. `.welcome-sub` and `.welcome-section h3 .count` ride the
// global `--tf-text-supporting` token, but the Home hero (`.welcome.orbit-desk`)
// paints `--bg-sunken` behind them. In light that pair measures 4.07:1, below
// the 4.5:1 interactive-text floor, so the light theme gives those two hero
// labels a Home-hero-scoped ink. This spec parses the real stylesheet, resolves
// the applied ink and the surface, and computes the WCAG 2.1 relative-luminance
// ratio (the same formula phase38LegibilityContrast.test.ts uses).

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
    return { r: Number(parts[0]), g: Number(parts[1]), b: Number(parts[2]), a: parts[3] === undefined ? 1 : Number(parts[3]) };
  }
  throw new Error(`Unparseable colour: ${value}`);
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

const LIGHT = vars(block(CSS, /:root\s*\{/));
const DARK = { ...LIGHT, ...vars(block(CSS, /:root\[data-theme="dark"\]\s*\{/)) };

const FLOOR = 4.5;
const HERO_SELECTOR =
  /:root:not\(\[data-theme="dark"\]\):not\(\[data-theme="frosted"\]\)\s+\.welcome\.orbit-desk\s+\.welcome-sub/;

function heroRule(): { selector: string; body: string } {
  const start = CSS.search(HERO_SELECTOR);
  if (start === -1) throw new Error("light Home-hero supporting-text override not found");
  const open = CSS.indexOf("{", start);
  const close = CSS.indexOf("}", open);
  return { selector: CSS.slice(start, open), body: CSS.slice(open + 1, close) };
}

describe("Phase 110 (chunk E2) - light Home-hero supporting-text contrast", () => {
  it("leaves the global --tf-text-supporting token unchanged", () => {
    expect(resolveToken("--tf-text-supporting", LIGHT)).toBe("#667085");
    expect(resolveToken("--tf-text-supporting", DARK)).toBe("#929BAC");
  });

  it("scopes the override to light only and to both hero labels", () => {
    const { selector } = heroRule();
    expect(selector).toContain(':not([data-theme="dark"])');
    expect(selector).toContain(':not([data-theme="frosted"])');
    expect(selector).toContain(".welcome.orbit-desk .welcome-sub");
    expect(selector).toContain(".welcome.orbit-desk .welcome-section h3 .count");
  });

  it("applies the retired --fg-muted ink to the hero supporting text", () => {
    const { body } = heroRule();
    expect(body).toMatch(/color:\s*var\(--fg-muted\)/);
  });

  it("clears 4.5:1 on --bg-sunken for both hero labels in the light theme", () => {
    const { body } = heroRule();
    const inkVar = body.match(/color:\s*var\((--[\w-]+)\)/);
    expect(inkVar?.[1]).toBe("--fg-muted");

    const inkRaw = resolveToken(inkVar![1], LIGHT);
    const sunkenRaw = resolveToken("--bg-sunken", LIGHT);
    expect(inkRaw, "resolved hero ink").toBeTruthy();
    expect(sunkenRaw, "resolved --bg-sunken").toBeTruthy();

    const ratio = contrast(parseColor(inkRaw!), parseColor(sunkenRaw!));
    const before = contrast(parseColor("#667085"), parseColor(sunkenRaw!));
    console.log(
      `[P110-E2] light Home hero supporting ink on --bg-sunken: before ${before.toFixed(2)} -> after ${ratio.toFixed(2)}`,
    );

    // The raw global token is the documented gap this override closes.
    expect(before).toBeLessThan(FLOOR);
    // Both hero labels share the override, so one ratio proves both.
    expect(ratio, `hero ink on --bg-sunken = ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(FLOOR);
  });

  it("keeps the dark Home hero on the global token, which clears the floor", () => {
    const ink = resolveToken("--tf-text-supporting", DARK);
    const sunken = resolveToken("--bg-sunken", DARK);
    const ratio = contrast(parseColor(ink!), parseColor(sunken!));
    console.log(`[P110-E2] dark Home hero supporting ink on --bg-sunken: ${ratio.toFixed(2)}`);
    expect(ratio).toBeGreaterThanOrEqual(FLOOR);
  });
});