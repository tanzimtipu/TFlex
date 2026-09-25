// Phase 40 (items 2 + 13) — the caption strip's Open / Save controls.
//
// Item 2: the Open button's label must be readable AT REST. The defect: the
// Phase 38 family-hue rule (`.app-header .titlebar-file-btn` = (0,2,0)) beat
// the Open button's own `color: var(--fg-on-accent)` (0,1,0), so the resting
// label painted `--icon-blue` ON the solid `--accent` fill — 1.00:1 in light —
// and only became legible on hover (the operator's report).
//
// Item 13: the Open / Save controls lose their background box in EVERY theme —
// the group's glass capsule film/hairline and Open's solid accent fill are
// retired at rest, while the hover / focus affordance and the disabled
// distinction survive.
//
// This spec resolves the REAL theme tokens out of styles.css (the Phase 38
// legibility sweep's method: translucent frosted surfaces composited over the
// theme base), computes the WCAG 2.1 ratios and names every failing pair.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const CSS_PATH = resolve(__dirname, "../../../src/renderer/styles.css");
const CSS = readFileSync(CSS_PATH, "utf8");
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

const BASE = vars(block(CSS_NO_COMMENTS, /:root\s*\{/));
const DARK = { ...BASE, ...vars(block(CSS_NO_COMMENTS, /:root\[data-theme="dark"\]\s*\{/)) };
const FROST = { ...BASE, ...vars(block(CSS_NO_COMMENTS, /:root\[data-theme="frosted"\]\s*\{/)) };

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

/** The caption strip's REAL surface: `--bg-toolbar` (the `.app-header`
 *  background), composited over the theme base when it is translucent — the
 *  same method the Phase 38 legibility sweep uses. */
function headerSurface(theme: Record<string, string>): RGB {
  const toolbar = tokenColor(theme, "--bg-toolbar");
  const base = tokenColor(theme, "--bg-base");
  return toolbar.a < 1 ? composite(toolbar, base) : toolbar;
}

const TEXT_FLOOR = 4.5;

describe("Phase 40 items 2 + 13 — the caption strip's Open / Save controls", () => {
  it("item 2: the Open label clears 4.5:1 at rest on the real strip surface, all three themes", () => {
    const failures: string[] = [];
    const measured: string[] = [];
    for (const { id, map } of THEMES) {
      const surface = headerSurface(map);
      // The resting ink is the semantic-map rule's colour (the Open button no
      // longer declares its own colour), i.e. --sem-neutral on the strip.
      const ink = tokenColor(map, "--sem-neutral");
      const after = contrast(ink, surface);
      // The RETIRED pair (a family hue on the solid accent fill) is reported
      // so the defect's ratios stay on record.
      const before = contrast(ink, tokenColor(map, "--accent"));
      measured.push(
        `${id} before ${before.toFixed(2)}:1 (--sem-neutral on --accent) -> after ${after.toFixed(2)}:1`,
      );
      if (after < TEXT_FLOOR) {
        failures.push(`${id} Open label on ${resolveToken("--bg-toolbar", map)} = ${after.toFixed(2)} (floor ${TEXT_FLOOR})`);
      }
    }
    console.log(`[Phase40 item2] Open resting label: ${measured.join(" | ")}`);
    expect(failures, failures.join("\n")).toEqual([]);
    // The light theme's retired pair was the operator's unreadable state.
    expect(contrast(tokenColor(BASE, "--sem-neutral"), tokenColor(BASE, "--accent"))).toBeLessThan(
      TEXT_FLOOR,
    );
  });

  it("item 2: the hover ink still clears the floor on the hover wash in all three themes", () => {
    const failures: string[] = [];
    for (const { id, map } of THEMES) {
      const hover = composite(tokenColor(map, "--bg-hover"), headerSurface(map));
      const ink = tokenColor(map, "--fg-strong");
      const ratio = contrast(ink, hover);
      if (ratio < TEXT_FLOOR) {
        failures.push(`${id} hover --fg-strong on --bg-hover = ${ratio.toFixed(2)}`);
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("item 13: the file group capsule has no resting film, border or highlight", () => {
    const capsule = block(CSS_NO_COMMENTS, /\.titlebar-file\s*\{/);
    expect(capsule).toMatch(/background:\s*transparent/);
    expect(capsule).not.toContain("--glass-group-bg");
    expect(capsule).toMatch(/border:\s*1px solid transparent/);
    expect(capsule).not.toContain("--glass-group-border");
    expect(capsule).toMatch(/box-shadow:\s*none/);
    // The geometry contract (Phase 22 / 35) is untouched.
    expect(capsule).toContain("height: 32px");
    expect(capsule).toContain("-webkit-app-region: no-drag");
  });

  it("item 13: Open has no resting fill or border in any theme", () => {
    const open = block(CSS_NO_COMMENTS, /\.titlebar-file-open\s*\{/);
    expect(open).toMatch(/background:\s*transparent/);
    expect(open).toMatch(/border-color:\s*transparent/);
    expect(open).not.toContain("var(--accent)");
    expect(open).not.toContain("--fg-on-accent");
    // No Open-specific hover / active rule survives to repaint an accent box.
    expect(CSS_NO_COMMENTS).not.toMatch(/\.titlebar-file-open:hover/);
    expect(CSS_NO_COMMENTS).not.toMatch(/\.titlebar-file-open:active/);
    // The three controls rest transparent (Save / Save As ride the base rule).
    const btn = block(CSS_NO_COMMENTS, /\.titlebar-file-btn\s*\{/);
    expect(btn).toMatch(/background:\s*transparent/);
    expect(btn).toMatch(/border:\s*1px solid transparent/);
  });

  it("item 13: the hover / focus affordance and the disabled distinction survive", () => {
    const hover = block(CSS_NO_COMMENTS, /\.titlebar-file-btn:hover:not\(\[disabled\]\)\s*\{/);
    expect(hover).toMatch(/background:\s*var\(--bg-hover\)/);
    expect(hover).toMatch(/color:\s*var\(--fg-strong\)/);
    const active = block(CSS_NO_COMMENTS, /\.titlebar-file-btn:active:not\(\[disabled\]\)\s*\{/);
    expect(active).toMatch(/background:\s*var\(--accent-pressed-soft\)/);
    const focus = block(CSS_NO_COMMENTS, /\.titlebar-file-btn:focus-visible\s*\{/);
    expect(focus).toMatch(/box-shadow:\s*var\(--focus-ring\)/);
    const disabled = block(CSS_NO_COMMENTS, /\.titlebar-file-btn\[disabled\]\s*\{/);
    expect(disabled).toMatch(/opacity:\s*0\.45/);
    expect(disabled).toMatch(/cursor:\s*not-allowed/);
  });

  it("item 13: the neutral resting ink still applies to the header file controls", () => {
    // The semantic-map rule is what colours the Open label now; if it were
    // removed the label would fall back to --fg-muted (the base button ink).
    expect(CSS_NO_COMMENTS).toMatch(
      /\.app-header \.titlebar-file-btn,[\s\S]{0,400}?\{\s*color:\s*var\(--sem-neutral\);/,
    );
  });
});
