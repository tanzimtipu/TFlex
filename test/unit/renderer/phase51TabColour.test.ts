// Phase 51 (item 5 / feature E) — BRIGHT tab colours.
//
// The operator read the Phase-45 tab as "a shade" because the tab body was an
// 8% wash. The fix paints the FULL semantic token and labels it with
// `--tf-tab-ink`. This test pins the rule textually and RE-COMPUTES the
// contrast numbers from the token values, so a future palette edit cannot
// quietly drop a label below the 4.5:1 floor.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { tabColoursDiffer } from "../../../src/renderer/state/tabColour";

const CSS = readFileSync(
  resolve(__dirname, "../../../src/renderer/styles.css"),
  "utf8",
).replace(/\/\*[\s\S]*?\*\//g, "");

function lin(c: number): number {
  c /= 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
function contrast(a: string, b: string): number {
  const l1 = luminance(a);
  const l2 = luminance(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/** The four semantic token values per theme, read from the stylesheet. */
function tokenHex(name: string, theme: "light" | "dark" | "frosted"): string {
  // The light values live in the first `:root` block; dark/frosted override in
  // later blocks. Read every declaration and take the one in the right scope.
  const blockRe =
    theme === "light"
      ? /:root\s*\{([\s\S]*?)\n\}/
      : theme === "dark"
        ? /:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/
        : /:root\[data-theme="frosted"\]\s*\{([\s\S]*?)\n\}/;
  const block = CSS.match(blockRe);
  expect(block, `${theme} block`).not.toBeNull();
  const m = block?.[1].match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  expect(m, `${name} in ${theme}`).not.toBeNull();
  return m?.[1] ?? "#000000";
}

function inkHex(theme: "light" | "dark" | "frosted", name = "--tf-tab-ink"): string {
  const blockRe =
    theme === "light"
      ? /:root\s*\{([\s\S]*?)\n\}/
      : theme === "dark"
        ? /:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/
        : /:root\[data-theme="frosted"\]\s*\{([\s\S]*?)\n\}/;
  const block = CSS.match(blockRe);
  const m = block?.[1].match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  expect(m, `${name} in ${theme}`).not.toBeNull();
  return m?.[1] ?? "#000000";
}

const HUES = ["--sem-primary", "--sem-attention", "--sem-affirmative", "--sem-neutral"] as const;

describe("Phase 51 item 5 — the tab body is the full-strength colour", () => {
  it("paints the semantic token itself, not an 8% wash", () => {
    const tab = CSS.match(/(?:^|\n)\.tab\s*\{([^}]*)\}/);
    expect(tab).not.toBeNull();
    expect(tab?.[1]).toMatch(/background:\s*var\(--tf-tab-accent/);
    expect(tab?.[1]).toMatch(/color:\s*var\(--tf-tab-ink-soft\)/);
    expect(tab?.[1]).not.toMatch(/background:\s*color-mix\([^;]*8%/);
  });

  it("has a dedicated tab ink per theme", () => {
    for (const theme of ["light", "dark", "frosted"] as const) {
      expect(inkHex(theme)).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(inkHex(theme, "--tf-tab-ink-soft")).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });

  it("holds the 4.5:1 text floor on every hue in every theme", () => {
    const themes = ["light", "frosted", "dark"] as const;
    for (const theme of themes) {
      for (const name of ["--tf-tab-ink", "--tf-tab-ink-soft"] as const) {
        const ink = inkHex(theme, name);
        for (const hue of HUES) {
          const ratio = contrast(ink, tokenHex(hue, theme));
          expect(ratio, `${ink} (${name}, ${theme}) on ${hue}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("keeps adjacent slots on different hues", () => {
    for (let i = 0; i < 6; i += 1) {
      expect(tabColoursDiffer(i, i + 1), `tabs ${i} and ${i + 1}`).toBe(true);
    }
  });
});
