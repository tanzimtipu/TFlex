// Phase 38 (feature B) — the LEGIBILITY + CONTRAST sweep.
//
// Success criteria 4 and 5 are measured, not asserted from CSS alone: this
// spec resolves the REAL theme token colours out of src/renderer/styles.css for
// each of the three themes (light = :root, dark = :root[data-theme="dark"],
// frosted = :root[data-theme="frosted"]), composites every translucent frosted
// surface over its base, then computes the WCAG 2.1 contrast ratio for each
// defined text/surface and icon/surface pair. Any pair below its floor fails
// the test and is NAMED in the failure message. It also pins the size floors
// (icon >= 18px, control label >= 12px) and that the disabled state is a
// distinct token from every enabled one.

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

/** The chrome surfaces a labelled control actually sits on. */
const SURFACES = ["--bg-elevated", "--bg-raised", "--bg-toolbar", "--bg-rail", "--panel-bg"] as const;

/** The text tokens and the family/icon tokens that may colour a label. */
const LABEL_TOKENS = ["--fg-strong", "--fg", "--fg-muted"] as const;
/** Phase 40 (item 11) — the EIGHT per-family hues were replaced by the four
 *  semantic roles. This sweep now scores the roles themselves, the four stage
 *  tokens that resolve from them, and the dock primary's on-wash ink. */
const FAMILY_TOKENS = [
  "--sem-primary",
  "--sem-neutral",
  "--sem-affirmative",
  "--sem-attention",
  "--tf-stage-pages",
  "--tf-stage-edit",
  "--tf-stage-review",
  "--tf-stage-deliver",
  "--dock-primary-fg",
] as const;

const TEXT_FLOOR = 4.5;
const ICON_FLOOR = 3;

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

describe("Phase 38 feature B — the legibility + contrast sweep", () => {
  it("names the resolved surface colours (one per theme x surface)", () => {
    const resolved: Record<string, Record<string, RGB>> = {};
    for (const { id, map } of THEMES) {
      resolved[id] = {};
      for (const surface of SURFACES) {
        resolved[id][surface] = surfaceColor(map, surface);
      }
    }
    // The light/frosted rail+panel and the dark raised surface are the binding
    // ones; assert they resolve to real, opaque colours.
    for (const { id } of THEMES) {
      for (const surface of SURFACES) {
        expect(resolved[id][surface].a, `${id} ${surface}`).toBe(1);
      }
    }
  });

  it("every interactive text token clears 4.5:1 on its actual surface in all three themes", () => {
    const failures: string[] = [];
    for (const { id, map } of THEMES) {
      for (const surface of SURFACES) {
        const bg = surfaceColor(map, surface);
        for (const token of LABEL_TOKENS) {
          const ratio = contrast(tokenColor(map, token), bg);
          if (ratio < TEXT_FLOOR) {
            failures.push(`${id} ${token} on ${surface} = ${ratio.toFixed(2)} (floor ${TEXT_FLOOR})`);
          }
        }
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("every family/icon accent colour clears 4.5:1 as a LABEL on its actual surface in all three themes", () => {
    // The dock applies the family hue to the label text as well as the glyph,
    // so the stronger text floor is the contract; the 3:1 icon floor follows.
    const failures: string[] = [];
    for (const { id, map } of THEMES) {
      for (const surface of SURFACES) {
        const bg = surfaceColor(map, surface);
        for (const token of FAMILY_TOKENS) {
          const ratio = contrast(tokenColor(map, token), bg);
          if (ratio < TEXT_FLOOR) {
            failures.push(`${id} ${token} on ${surface} = ${ratio.toFixed(2)} (floor ${TEXT_FLOOR})`);
          }
        }
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("every family/icon accent colour also clears the 3:1 icon floor", () => {
    const failures: string[] = [];
    for (const { id, map } of THEMES) {
      for (const surface of SURFACES) {
        const bg = surfaceColor(map, surface);
        for (const token of FAMILY_TOKENS) {
          const ratio = contrast(tokenColor(map, token), bg);
          if (ratio < ICON_FLOOR) {
            failures.push(`${id} ${token} on ${surface} = ${ratio.toFixed(2)} (floor ${ICON_FLOOR})`);
          }
        }
      }
    }
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("declares the size floors as ONE token layer (icon >= 18px, label >= 12px)", () => {
    const sizes = {
      "--tf-icon-size": 18,
      "--tf-icon-size-md": 18,
      "--tf-icon-size-lg": 18,
    } as const;
    for (const [token, floor] of Object.entries(sizes)) {
      const raw = resolveToken(token, BASE);
      const px = Number.parseFloat(raw ?? "");
      expect(px, `${token} = ${raw}`).toBeGreaterThanOrEqual(floor);
    }
    const label = Number.parseFloat(resolveToken("--tf-label-size", BASE) ?? "");
    expect(label, `--tf-label-size`).toBeGreaterThanOrEqual(12);
    // --fs-xs is the body-ladder floor every control label rides.
    const bodyFloor = Number.parseFloat(resolveToken("--fs-xs", BASE) ?? "");
    expect(bodyFloor, `--fs-xs`).toBeGreaterThanOrEqual(12);
  });

  it("keeps the disabled state a distinct token from every enabled label/icon", () => {
    for (const { id, map } of THEMES) {
      const disabled = resolveToken("--fg-disabled", map);
      expect(disabled, `${id} --fg-disabled`).toBeTruthy();
      const enabled = [...LABEL_TOKENS, ...FAMILY_TOKENS].map((t) => resolveToken(t, map));
      expect(enabled, `${id} disabled distinct`).not.toContain(disabled);
    }
  });

  // DEF-340 — the dock's stage-primary verb is the ONE label that sits on the
  // `--accent-soft` wash (over `--bg-elevated`) instead of the bare surface.
  // The old pair (--accent on the wash) measured 4.27 / 2.92 / 4.34 — below the
  // 4.5 floor in all three themes — because the sweep above never composited
  // the wash. This test resolves the REAL rendered pair per theme.
  it("DEF-340: the dock primary verb clears 4.5:1 on its accent-soft wash in all three themes", () => {
    const failures: string[] = [];
    const measured: string[] = [];
    for (const { id, map } of THEMES) {
      const elevated = surfaceColor(map, "--bg-elevated");
      const wash = tokenColor(map, "--accent-soft");
      const surface = composite(wash, elevated);
      const ink = tokenColor(map, "--dock-primary-fg");
      const ratio = contrast(ink, surface);
      measured.push(
        `${id} ${resolveToken("--dock-primary-fg", map)} on ${resolveToken("--accent-soft", map)} over --bg-elevated = ${ratio.toFixed(2)}`,
      );
      if (ratio < TEXT_FLOOR) {
        failures.push(`${id} --dock-primary-fg on --accent-soft = ${ratio.toFixed(2)} (floor ${TEXT_FLOOR})`);
      }
    }
    // Reported in the test output so the three numbers are readable in a run.
    console.log(`[DEF-340] primary-on-soft: ${measured.join(" | ")}`);
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("DEF-340: the dock primary ink token is declared per theme (never the accent fallback)", () => {
    for (const { id, map } of THEMES) {
      expect(resolveToken("--dock-primary-fg", map), `${id} --dock-primary-fg`).toBeTruthy();
    }
  });

  // DEF-344 — the dock verb HOVER / PRESSED states. The per-verb family-hue
  // rules are (0,5,0) with the `[data-dock-verb]` guard; the old hover/active
  // ink rules were (0,3,0), so a hovered or pressed family verb kept its hue on
  // the darker `--bg-hover` / `--bg-active` surface. Light blue/cyan/green/
  // orange measured 4.29/4.45/4.16/4.17 — below the 4.5 floor. The state
  // overrides sit AFTER the family block with the same three guards, so they
  // win by position and every family's hover/pressed ink is `--fg-strong`.
  it("DEF-344: hover and pressed dock ink clears 4.5:1 on the real surfaces in all three themes", () => {
    const failures: string[] = [];
    const measured: string[] = [];
    for (const { id, map } of THEMES) {
      const elevated = surfaceColor(map, "--bg-elevated");
      const ink = tokenColor(map, "--fg-strong");
      const hover = composite(tokenColor(map, "--bg-hover"), elevated);
      const active = composite(tokenColor(map, "--bg-active"), elevated);
      const hoverRatio = contrast(ink, hover);
      const activeRatio = contrast(ink, active);
      measured.push(`${id} hover ${hoverRatio.toFixed(2)} pressed ${activeRatio.toFixed(2)}`);
      if (hoverRatio < TEXT_FLOOR) {
        failures.push(`${id} --fg-strong on --bg-hover = ${hoverRatio.toFixed(2)} (floor ${TEXT_FLOOR})`);
      }
      if (activeRatio < TEXT_FLOOR) {
        failures.push(`${id} --fg-strong on --bg-active = ${activeRatio.toFixed(2)} (floor ${TEXT_FLOOR})`);
      }
    }
    console.log(`[DEF-344] state ink: ${measured.join(" | ")}`);
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("DEF-344: per-family hover/pressed table uses the applied --fg-strong ink and clears the floor", () => {
    const rows: string[] = [];
    const failures: string[] = [];
    for (const { id, map } of THEMES) {
      const elevated = surfaceColor(map, "--bg-elevated");
      const hover = composite(tokenColor(map, "--bg-hover"), elevated);
      const active = composite(tokenColor(map, "--bg-active"), elevated);
      // The state override applies to EVERY family (it has the family rule's
      // guards and comes later in the sheet), so the applied ink is the same.
      const applied = tokenColor(map, "--fg-strong");
      for (const family of FAMILY_TOKENS) {
        const raw = tokenColor(map, family);
        const appliedHover = contrast(applied, hover);
        const appliedActive = contrast(applied, active);
        rows.push(
          `${id} ${family}: hover ${appliedHover.toFixed(2)} pressed ${appliedActive.toFixed(2)}` +
            ` (raw hue hover ${contrast(raw, hover).toFixed(2)} / pressed ${contrast(raw, active).toFixed(2)})`,
        );
        if (appliedHover < TEXT_FLOOR) failures.push(`${id} ${family} hover = ${appliedHover.toFixed(2)}`);
        if (appliedActive < TEXT_FLOOR) failures.push(`${id} ${family} pressed = ${appliedActive.toFixed(2)}`);
      }
    }
    console.log(`[DEF-344] per-family state table:\n${rows.join("\n")}`);
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("DEF-344: the hover/active overrides carry the family rule's guards and sit after it", () => {
    const hover = ".action-dock-verb:hover:not(:disabled):not(.action-dock-verb-primary):not([aria-pressed='true'])";
    const active = ".action-dock-verb:active:not(:disabled):not(.action-dock-verb-primary):not([aria-pressed='true'])";
    expect(CSS_NO_COMMENTS).toContain(hover);
    expect(CSS_NO_COMMENTS).toContain(active);
    // Both appear AFTER the last per-verb family rule, so equal specificity
    // resolves in the state override's favour.
    const lastFamily = CSS_NO_COMMENTS.lastIndexOf(
      ".action-dock-verb[data-dock-verb='createFromImages']",
    );
    expect(CSS_NO_COMMENTS.indexOf(hover)).toBeGreaterThan(lastFamily);
    expect(CSS_NO_COMMENTS.indexOf(active)).toBeGreaterThan(lastFamily);
    expect(CSS_NO_COMMENTS.slice(CSS_NO_COMMENTS.indexOf(hover))).toMatch(
      /color:\s*var\(--fg-strong\)/,
    );
    expect(CSS_NO_COMMENTS.slice(CSS_NO_COMMENTS.indexOf(active))).toMatch(
      /color:\s*var\(--fg-strong\)/,
    );
  });
});

/**
 * DEF-354 / DEF-355 — the two on-WASH pairs the DEF-340 sweep did not cover.
 * Each is a translucent accent wash composited over its REAL surface, so the
 * ratio is computed from the rendered pair, not the bare tokens.
 */
function washSurface(
  theme: Record<string, string>,
  washToken: string,
  surfaceToken: string,
): RGB {
  const base = surfaceColor(theme, surfaceToken);
  return composite(tokenColor(theme, washToken), base);
}

describe("Phase 38 feature B — DEF-354 / DEF-355 on-wash contrast", () => {
  it("DEF-354: the palette Recent/Global tag clears 4.5:1 on the accent-soft wash in all three themes", () => {
    const failures: string[] = [];
    const measured: string[] = [];
    for (const { id, map } of THEMES) {
      const surface = washSurface(map, "--accent-soft", "--bg-raised");
      const ink = tokenColor(map, "--dock-primary-fg");
      const ratio = contrast(ink, surface);
      measured.push(`${id} ${ratio.toFixed(2)}`);
      if (ratio < TEXT_FLOOR) {
        failures.push(`${id} tag ink on --accent-soft/--bg-raised = ${ratio.toFixed(2)} (floor ${TEXT_FLOOR})`);
      }
    }
    console.log(`[DEF-354] palette tag ink: ${measured.join(" | ")}`);
    // The fallback text the fix replaces measured below the floor (3.24 dark).
    expect(contrast(tokenColor(DARK, "--accent"), washSurface(DARK, "--accent-soft", "--bg-raised")))
      .toBeLessThan(TEXT_FLOOR);
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("DEF-354: the tag's non-stage fallback resolves to the on-wash ink token", () => {
    const rule = block(CSS_NO_COMMENTS, /\.command-palette-tag\s*\{/);
    expect(rule).toMatch(/color:\s*var\(--stage-hue,\s*var\(--dock-primary-fg\)\)/);
  });

  it("DEF-355: the pressed Open label clears 4.5:1 on the pressed wash in all three themes", () => {
    const failures: string[] = [];
    const measured: string[] = [];
    for (const { id, map } of THEMES) {
      const surface = washSurface(map, "--accent-pressed-soft", "--bg-toolbar");
      const ink = tokenColor(map, "--dock-primary-fg");
      const ratio = contrast(ink, surface);
      measured.push(`${id} ${ratio.toFixed(2)}`);
      if (ratio < TEXT_FLOOR) {
        failures.push(`${id} pressed Open = ${ratio.toFixed(2)} (floor ${TEXT_FLOOR})`);
      }
    }
    console.log(`[DEF-355] pressed Open: ${measured.join(" | ")}`);
    // The retired pair (plain --accent) failed in light (3.75).
    expect(contrast(tokenColor(BASE, "--accent"), washSurface(BASE, "--accent-pressed-soft", "--bg-toolbar")))
      .toBeLessThan(TEXT_FLOOR);
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("DEF-355: the pressed file controls resolve to the on-wash ink token", () => {
    const active = block(CSS_NO_COMMENTS, /\.titlebar-file-btn:active:not\(\[disabled\]\)\s*\{/);
    expect(active).toMatch(/background:\s*var\(--accent-pressed-soft\)/);
    expect(active).toMatch(/color:\s*var\(--dock-primary-fg\)/);
  });

  it("DEF-355: the active page-layout option icon clears 3:1 in every theme (dark included)", () => {
    const failures: string[] = [];
    const measured: string[] = [];
    for (const { id, map } of THEMES) {
      const surface = washSurface(map, "--accent-selected", "--bg-elevated");
      const ink = tokenColor(map, "--dock-primary-fg");
      const ratio = contrast(ink, surface);
      measured.push(`${id} ${ratio.toFixed(2)}`);
      if (ratio < ICON_FLOOR) {
        failures.push(`${id} active layout icon = ${ratio.toFixed(2)} (floor ${ICON_FLOOR})`);
      }
    }
    console.log(`[DEF-355] active page-layout icon: ${measured.join(" | ")}`);
    // The retired pair failed dark (2.98).
    expect(contrast(tokenColor(DARK, "--accent"), washSurface(DARK, "--accent-selected", "--bg-elevated")))
      .toBeLessThan(ICON_FLOOR);
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("DEF-355: the active page-layout option resolves to the on-wash ink token", () => {
    const rule = block(CSS_NO_COMMENTS, /\.canvas-page-layout \.tool-btn-active\s*\{/);
    expect(rule).toMatch(/color:\s*var\(--dock-primary-fg\)/);
  });
});

/**
 * Phase 41 (item 3) — the professional SELECTION trio. The accent glyph sits on
 * the `--select-fill` wash composited over the control's real surface (the
 * panel for the text-props segmented buttons, the rail for the thumbnail's
 * page-number label). Both must clear the 4.5:1 interactive-text floor in all
 * three themes, and the trio must be the SAME token names everywhere.
 */
describe("Phase 41 item 3 — the selection trio clears the text floor", () => {
  it("--select-glyph on --select-fill over --panel-bg clears 4.5:1 in all three themes", () => {
    const failures: string[] = [];
    const measured: string[] = [];
    for (const { id, map } of THEMES) {
      const surface = washSurface(map, "--select-fill", "--panel-bg");
      const ink = tokenColor(map, "--select-glyph");
      const ratio = contrast(ink, surface);
      measured.push(`${id} ${ratio.toFixed(2)}`);
      if (ratio < TEXT_FLOOR) {
        failures.push(
          `${id} --select-glyph on --select-fill/--panel-bg = ${ratio.toFixed(2)} (floor ${TEXT_FLOOR})`,
        );
      }
    }
    console.log(`[P41 selection] glyph on fill: ${measured.join(" | ")}`);
    expect(failures, failures.join("\n")).toEqual([]);
  });

  it("the trio is declared per theme and the glyph resolves to the theme primary", () => {
    for (const { id, map } of THEMES) {
      expect(resolveToken("--select-fill", map), `${id} --select-fill`).toBeTruthy();
      expect(resolveToken("--select-edge", map), `${id} --select-edge`).toBeTruthy();
      expect(resolveToken("--select-glyph", map), `${id} --select-glyph`).toBe(
        resolveToken("--sem-primary", map),
      );
    }
  });
});

