// @vitest-environment node
//
// DEF-183 + DEF-188 — Phase-14 frosted-glass fix contracts.
//
// DEF-183 (titlebar transparency): qa's stacking probe
// (screenshots/def182-187-stacking-probe.json) found BOTH `.titlebar` and
// the `.app-header` nested inside its slot painting rgba(126,178,250,0.65)
// + blur(22px) at the same point — a ~0.88 effective film that blocked the
// desktop wallpaper (caption-strip see-through delta 5.0, while the single-
// film toolbar/rail/palette surfaces measured 36-58). The fix: the
// `.titlebar` is the caption strip's ONE painted + blurred glass surface and
// the inner `.app-header` goes fully transparent in frosted.
//
// DEF-188 (text contrast on blue glass): the old frosted ink ladder drowned
// on the mid-blue films — qa measured luma spreads of 11-16 (tool
// descriptions), 28 ("Undo last change") and -28 (group labels sat BELOW the
// glass luma) vs the reference mock's description spread of 57. The ladder
// re-anchors to the mock's dark-navy family; the numbers below are computed
// against qa's measured glass composites from screenshots/def182-187-metrics.json
// (surfaces.palette / surfaces.toolbar "glass" patch medians — the real
// composited films over the aurora and near-black backdrops).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");

function readStyles(): string {
  return readFileSync(STYLES_PATH, "utf8");
}

function stripCssComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "");
}

function extractRuleBody(src: string, selectorIndex: number): string {
  const braceOpen = src.indexOf("{", selectorIndex);
  if (braceOpen === -1) return "";
  let depth = 0;
  for (let i = braceOpen; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(braceOpen + 1, i);
    }
  }
  return "";
}

/** Every rule body whose stripped selector text contains `selector`
 *  directly before its `{`. */
function findRuleBodies(src: string, selector: string): string[] {
  const stripped = stripCssComments(src);
  const bodies: string[] = [];
  let from = 0;
  for (;;) {
    const idx = stripped.indexOf(selector, from);
    if (idx === -1) return bodies;
    let cursor = idx + selector.length;
    while (cursor < stripped.length && /\s/.test(stripped[cursor] ?? "")) cursor += 1;
    if (stripped[cursor] === "{") bodies.push(extractRuleBody(stripped, idx));
    from = idx + selector.length;
  }
}

function findRuleBody(src: string, selector: string): string | null {
  const bodies = findRuleBodies(src, selector);
  return bodies.length > 0 ? bodies[0] : null;
}

/** Frosted token value out of the `:root[data-theme="frosted"]` block. */
function frostedToken(css: string, token: string): string | null {
  const block = /:root\[data-theme="frosted"\]\s*\{([\s\S]*?)\n\}/m.exec(css);
  if (block === null) return null;
  const m = new RegExp(`${token}\\s*:\\s*(#[0-9a-fA-F]{6})`).exec(block[1] ?? "");
  return m?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// Color math (the exact formulas qa measures with).
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace(/^#/, "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/** qa's luma formula (e2e/lib/retest_182_187_contrast.cjs): ITU-R BT.601. */
function luma601(rgb: [number, number, number]): number {
  return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
}

/** WCAG 2.x relative luminance. */
function wcagLuminance(rgb: [number, number, number]): number {
  const lin = (c: number): number => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
}

/** WCAG contrast ratio between two sRGB colors. */
function wcagContrast(a: [number, number, number], b: [number, number, number]): number {
  const hi = Math.max(wcagLuminance(a), wcagLuminance(b));
  const lo = Math.min(wcagLuminance(a), wcagLuminance(b));
  return (hi + 0.05) / (lo + 0.05);
}

/** qa's text-vs-glass spread: glass median luma minus ink luma
 *  (e2e/lib/retest_182_187_contrast.cjs measures median - p5; the rendered
 *  p5 tracks the CSS ink luma within a few points on 12-13px text). */
function qaSpread(ink: string, glass: [number, number, number]): number {
  return luma601(glass) - luma601(hexToRgb(ink));
}

// ---------------------------------------------------------------------------
// qa's measured glass composites (screenshots/def182-187-metrics.json,
// surfaces.palette — the tools panel film the flagged text sits on).
// ---------------------------------------------------------------------------
const GLASS_AURORA: [number, number, number] = [97.1, 135.4, 213]; // over the aurora backdrop
const GLASS_DARK: [number, number, number] = [97.8, 130.8, 181.6]; // over near-black rgb(11,16,32)

describe("DEF-183 — the caption strip has exactly one frosted glass layer", () => {
  const css = readStyles();

  it("no frosted-scoped rule puts a backdrop-filter on .app-header", () => {
    // The header is INSIDE .titlebar's slot; a second blur there stacked
    // a double glass that blocked the wallpaper (see-through delta 5.0).
    const clean = stripCssComments(css);
    const offenders: string[] = [];
    for (const m of clean.matchAll(/:root\[data-theme="frosted"\]([^{]*)\{([\s\S]*?)\n\}/g)) {
      if (!/backdrop-filter\s*:/.test(m[2] ?? "")) continue;
      if ((m[1] ?? "").includes("app-header")) offenders.push((m[1] ?? "").trim());
    }
    expect(offenders, `.app-header must never carry the frosted blur (found: ${offenders.join(", ")})`).toEqual([]);
  });

  it("the nested .app-header paints nothing in frosted (background + hairline transparent)", () => {
    const bodies = findRuleBodies(css, ':root[data-theme="frosted"] .app-header');
    const transparent = bodies.find((b) => /background:\s*transparent/.test(b));
    expect(transparent, "a frosted rule must clear the header's own --bg-toolbar film").toBeDefined();
    expect(transparent ?? "").toMatch(/border-bottom-color:\s*transparent/);
  });

  it(".titlebar stays the caption strip's single painted + blurred glass film", () => {
    const paint = findRuleBody(css, ':root[data-theme="frosted"] .titlebar');
    expect(paint ?? "").toMatch(/background:\s*var\(--tf-surface-frame\)/);
    // The Phase-A blur rule is a MULTI-selector rule (`.titlebar` leads the
    // list), so scan every frosted rule whose selector names the titlebar.
    const clean = stripCssComments(css);
    let blurFound = false;
    for (const m of clean.matchAll(/:root\[data-theme="frosted"\]([^{]*)\{([\s\S]*?)\n\}/g)) {
      if (!/backdrop-filter\s*:\s*blur\(var\(--tf-acrylic-blur\)\)/.test(m[2] ?? "")) continue;
      if ((m[1] ?? "").includes(".titlebar")) blurFound = true;
    }
    expect(blurFound, ".titlebar must carry the Phase-A frosted blur").toBe(true);
  });
});

describe("DEF-188 — the frosted ink ladder reads against the blue glass", () => {
  const css = readStyles();

  const tokens = (): Record<string, string> => ({
    primary: frostedToken(css, "--tf-text-primary") ?? "",
    secondary: frostedToken(css, "--tf-text-secondary") ?? "",
    tertiary: frostedToken(css, "--tf-text-tertiary") ?? "",
    faint: frostedToken(css, "--tf-text-disabled") ?? "",
  });

  it("the ladder hexes are the DEF-188 dark-navy re-anchor (not the old slate values)", () => {
    expect(css).toMatch(/--tf-text-primary:\s*#0e1830/);
    expect(css).toMatch(/--tf-text-secondary:\s*#14203a/);
    expect(css).toMatch(/--tf-text-tertiary:\s*#1f2a4a/);
    expect(css).toMatch(/--tf-text-disabled:\s*#24325a/);
    for (const t of Object.values(tokens())) expect(t).toMatch(/^#[0-9a-fA-F]{6}$/);
  });

  it("the ladder stays monotonic and the muted step stays visibly lighter than the strong ink", () => {
    const t = tokens();
    const lumas = Object.entries(t).map(([name, hex]) => [name, luma601(hexToRgb(hex))] as const);
    const get = (name: string): number => lumas.find(([n]) => n === name)?.[1] ?? Infinity;
    // Monotonic ink steps, darkest = strongest tier.
    expect(get("primary")).toBeLessThan(get("secondary"));
    expect(get("secondary")).toBeLessThan(get("tertiary"));
    expect(get("tertiary")).toBeLessThan(get("faint"));
    // The muted step stays visibly lighter than the strong ink (the mock's
    // muted-but-readable hierarchy), while both stay dark enough to read.
    expect(get("tertiary") - get("primary")).toBeGreaterThanOrEqual(15);
  });

  it("tool descriptions + Undo row clear the mock's 57 luma spread on both measured backdrops", () => {
    // The desc + "Undo last change" ride --fg-muted (--tf-text-tertiary).
    const tertiary = frostedToken(css, "--tf-text-tertiary") ?? "";
    expect(qaSpread(tertiary, GLASS_AURORA)).toBeGreaterThanOrEqual(57);
    expect(qaSpread(tertiary, GLASS_DARK)).toBeGreaterThanOrEqual(57);
  });

  it("group labels + shortcut chips (--fg-faint) clear the mock's 57 spread on the aurora grab", () => {
    // qa filed the group labels at spread -28 (BELOW the glass). The faint
    // tier must now sit clearly darker than the measured glass.
    const faint = frostedToken(css, "--tf-text-disabled") ?? "";
    expect(qaSpread(faint, GLASS_AURORA)).toBeGreaterThanOrEqual(57);
    // The near-black backdrop composite is the darkest the film can go.
    expect(qaSpread(faint, GLASS_DARK)).toBeGreaterThanOrEqual(55);
  });

  it("the disabled rail state keeps the Undo label legible on the glass", () => {
    // The disabled "Undo last change" row. qa measured spread 28 with the
    // old whole-button 0.45 fade; a faded label over glass can never clear
    // the readability bar, so the disabled state reads through the FAINT
    // ink tier at full label opacity while the icon fades instead.
    const btn = /\.rail-action-btn\[disabled\]\s*\{([^}]*)\}/.exec(stripCssComments(css));
    expect(btn, ".rail-action-btn[disabled] rule missing").not.toBeNull();
    expect(btn?.[1] ?? "").toMatch(/color:\s*var\(--fg-faint\)/);
    expect(btn?.[1] ?? "").not.toMatch(/opacity:\s*0\.4/);
    const icon = /\.rail-action-btn\[disabled\]\s+svg\s*\{([^}]*)\}/.exec(stripCssComments(css));
    expect(icon, "the disabled icon fade rule missing").not.toBeNull();
    const iconOpacity = /opacity:\s*([\d.]+)\s*;/.exec(icon?.[1] ?? "")?.[1];
    expect(Number(iconOpacity)).toBeGreaterThan(0);
    expect(Number(iconOpacity)).toBeLessThan(1);
  });

  it("the strong ink clears WCAG 4.5:1 against both measured glass composites", () => {
    const primary = frostedToken(css, "--tf-text-primary") ?? "";
    expect(wcagContrast(hexToRgb(primary), GLASS_AURORA)).toBeGreaterThanOrEqual(4.5);
    expect(wcagContrast(hexToRgb(primary), GLASS_DARK)).toBeGreaterThanOrEqual(4.5);
  });

  it("body ink clears WCAG 4.5:1 on the aurora grab and stays >= 3.9 on the darkest measured composite", () => {
    const secondary = frostedToken(css, "--tf-text-secondary") ?? "";
    expect(wcagContrast(hexToRgb(secondary), GLASS_AURORA)).toBeGreaterThanOrEqual(4.5);
    // Physics ceiling: qa's darkest measured glass (L ~0.22) caps ANY dark
    // ink at 4.74:1 (pure black) — the mock's own description measures
    // ~1.6:1 there. 3.9+ on that extreme is the readable muted step.
    expect(wcagContrast(hexToRgb(secondary), GLASS_DARK)).toBeGreaterThanOrEqual(3.9);
  });

  it("the muted/faint tiers beat the old slate ladder by >= 30 luma spread everywhere", () => {
    const OLD = { tertiary: "#64748b", faint: "#94a3b8" } as const;
    const NEW = {
      tertiary: frostedToken(css, "--tf-text-tertiary") ?? "",
      faint: frostedToken(css, "--tf-text-disabled") ?? "",
    };
    for (const glass of [GLASS_AURORA, GLASS_DARK]) {
      for (const tier of ["tertiary", "faint"] as const) {
        expect(qaSpread(NEW[tier], glass)).toBeGreaterThan(qaSpread(OLD[tier], glass) + 30);
      }
    }
  });
});