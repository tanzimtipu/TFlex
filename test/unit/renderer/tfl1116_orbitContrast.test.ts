// @vitest-environment node
//
// TFL-1116 (R10) — the Home Orbit arcs' visible contrast + occupied area, with
// the no-flash / no-full-canvas-moving-gradient guardrails.
//
// R10: the thin violet/amber arcs read too faint on the Home gray canvas. The
// fix inks them from the Jovrel Halo mark's violet/amber, raises the ring
// layer's opacity into the top of the sanctioned 0.18-0.28 band and grows its
// occupied area modestly, adding a slow FILTER hue drift (never opacity, never
// a moving gradient). This spec parses the real stylesheet, composites each arc
// ink over the ACTUAL per-theme Home surface (--bg-sunken) and asserts the
// composited contrast rose in every theme, that the layer grew, and that
// nothing can flash or move a gradient under the text.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(
  resolve(__dirname, "../../../src/renderer/styles.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

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
  throw new Error(`Unparseable colour: ${value}`);
}

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function luminance(c: RGB): number {
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/** WCAG 2.1 contrast of a semi-transparent arc ink over its real surface. */
function compositedContrast(ink: string, surface: string, alpha: number): number {
  const fg = parseColor(ink);
  const bg = parseColor(surface);
  const mixed: RGB = {
    r: fg.r * alpha + bg.r * (1 - alpha),
    g: fg.g * alpha + bg.g * (1 - alpha),
    b: fg.b * alpha + bg.b * (1 - alpha),
    a: 1,
  };
  const l1 = luminance(mixed);
  const l2 = luminance(bg);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/** Body of a flat (non-nested) rule, found by its selector prefix. */
function ruleBody(selector: string): string {
  const start = CSS.indexOf(selector);
  if (start === -1) throw new Error(`selector not found: ${selector}`);
  const open = CSS.indexOf("{", start);
  const close = CSS.indexOf("}", open);
  return CSS.slice(open + 1, close);
}

/** Brace-matched body (for @keyframes, whose blocks nest). */
function braceBlock(marker: string): string {
  const start = CSS.indexOf(marker);
  if (start === -1) throw new Error(`marker not found: ${marker}`);
  const open = CSS.indexOf("{", start);
  let depth = 1;
  let i = open + 1;
  while (depth > 0 && i < CSS.length) {
    if (CSS[i] === "{") depth += 1;
    else if (CSS[i] === "}") depth -= 1;
    i += 1;
  }
  return CSS.slice(open + 1, i - 1);
}

function decl(body: string, name: string): string {
  const m = body.match(new RegExp(`(?:^|;)\\s*${name}\\s*:\\s*([^;]+)`, "s"));
  if (m === null) throw new Error(`declaration not found: ${name} in rule`);
  return m[1].trim();
}

function resolveVar(name: string, root: string): string {
  const raw = decl(root, name);
  const m = raw.match(/var\(\s*(--[\w-]+)\s*\)/);
  return m === null ? raw : decl(root, m[1]);
}

const LIGHT_ROOT = ruleBody(":root");
const DARK_ROOT = ruleBody(':root[data-theme="dark"]');
const FROSTED_ROOT = ruleBody(':root[data-theme="frosted"]');
const MOTIF = ruleBody(".orbit-desk-motif {");
const DARK_MOTIF = ruleBody(':root[data-theme="dark"] .orbit-desk-motif {');
const ORBIT = ruleBody(".orbit-desk-orbit {");

describe("TFL-1116 (R10) — Home Orbit arc contrast + occupied area", () => {
  it("inks the arcs from the logo violet/amber (resolved through the tokens)", () => {
    expect(decl(MOTIF, "--orbit-violet")).toBe("var(--tf-accent)");
    expect(resolveVar("--tf-accent", LIGHT_ROOT)).toBe("#7C3AED");
    expect(decl(MOTIF, "--orbit-amber")).toBe("#B45309");
    // Dark keeps the lightened Halo pair.
    expect(decl(DARK_MOTIF, "--orbit-violet")).toBe("#B9A4FF");
    expect(decl(DARK_MOTIF, "--orbit-amber")).toBe("#FBB724");
    // The conic rings paint BOTH logo inks.
    const rings = ruleBody(".orbit-desk-orbit::before");
    expect(rings).toContain("conic-gradient");
    expect(rings).toContain("var(--orbit-violet)");
    expect(rings).toContain("var(--orbit-amber)");
  });

  it("raises the COMPOSITED arc contrast on every Home surface", () => {
    const lightSurface = resolveVar("--bg-sunken", LIGHT_ROOT);
    const frostedSurface = resolveVar("--bg-sunken", FROSTED_ROOT);
    const darkSurface = resolveVar("--bg-sunken", DARK_ROOT);
    expect(lightSurface).toBe("#e4e9ef");
    expect(frostedSurface).toBe("#e8ebf0");
    expect(darkSurface).toBe("#08090b");

    const alpha = Number(decl(MOTIF, "--orbit-opacity"));
    const darkAlpha = Number(decl(DARK_MOTIF, "--orbit-opacity"));
    const violet = resolveVar("--tf-accent", LIGHT_ROOT);
    const amber = decl(MOTIF, "--orbit-amber");
    const darkViolet = decl(DARK_MOTIF, "--orbit-violet");
    const darkAmber = decl(DARK_MOTIF, "--orbit-amber");

    // Pre-R10 baseline: violet accent / muted amber at 0.22 everywhere except
    // the dark pastels at 0.2 which frosted wrongly inherited.
    const cases: Array<[string, number, number]> = [
      ["light violet", compositedContrast(violet, lightSurface, alpha), compositedContrast("#7C3AED", lightSurface, 0.22)],
      ["light amber", compositedContrast(amber, lightSurface, alpha), compositedContrast("#b77526", lightSurface, 0.22)],
      ["frosted violet", compositedContrast(violet, frostedSurface, alpha), compositedContrast("#b9a4ff", frostedSurface, 0.2)],
      ["frosted amber", compositedContrast(amber, frostedSurface, alpha), compositedContrast("#e9bc7d", frostedSurface, 0.2)],
      ["dark violet", compositedContrast(darkViolet, darkSurface, darkAlpha), compositedContrast("#b9a4ff", darkSurface, 0.2)],
      ["dark amber", compositedContrast(darkAmber, darkSurface, darkAlpha), compositedContrast("#e9bc7d", darkSurface, 0.2)],
    ];
    for (const [label, after, before] of cases) {
      expect(
        after,
        `${label}: ${before.toFixed(3)} -> ${after.toFixed(3)}`,
      ).toBeGreaterThan(before);
    }
    // R10 lands the opacity at the top of the sanctioned 0.18-0.28 band.
    expect(alpha).toBeGreaterThanOrEqual(0.18);
    expect(alpha).toBeLessThanOrEqual(0.28);
    expect(darkAlpha).toBeGreaterThan(0.2);
    expect(darkAlpha).toBeLessThanOrEqual(0.28);
  });

  it("grows the occupied arc area MODESTLY and keeps it corner-anchored", () => {
    const width = Number(decl(ORBIT, "width").replace("px", ""));
    const height = Number(decl(ORBIT, "height").replace("px", ""));
    expect(width).toBeGreaterThan(320);
    expect(width).toBeLessThanOrEqual(420);
    expect(height).toBe(width);
    // Not a full-canvas layer: explicit width/height and a negative corner
    // offset, never `inset: 0`.
    expect(ORBIT).not.toMatch(/inset:\s*0/);
    expect(Number(decl(ORBIT, "top").replace("px", ""))).toBeLessThan(0);
    expect(Number(decl(ORBIT, "right").replace("px", ""))).toBeLessThan(0);
  });

  it("never flashes: no orbit keyframe touches opacity or visibility", () => {
    const spin = braceBlock("@keyframes tf-anim-orbit {");
    const hue = braceBlock("@keyframes tf-anim-orbit-hue {");
    for (const body of [spin, hue]) {
      expect(body).not.toMatch(/opacity\s*:/);
      expect(body).not.toMatch(/visibility\s*:/);
    }
    expect(spin).toMatch(/transform:\s*rotate/);
    expect(hue).toMatch(/filter:\s*hue-rotate/);
  });

  it("keeps text on a stable background: no moving gradient on the motif layer", () => {
    // The wrapper is a static positioning layer: no gradient, no animation.
    expect(MOTIF).not.toMatch(/background/);
    expect(MOTIF).not.toMatch(/animation/);
    // No keyframe near the motif animates background position.
    for (const marker of [
      "@keyframes tf-anim-orbit {",
      "@keyframes tf-anim-orbit-hue {",
    ]) {
      expect(braceBlock(marker)).not.toMatch(/background/);
    }
  });
});
