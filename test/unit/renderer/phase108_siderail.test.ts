// @vitest-environment node
//
// Phase 108 (Workspace Rail, TFL-862 chunk A) — the committed Siderail design.
//
// The chunk restyles the Stage Rail into the Workspace Rail: a 72px track, a
// 12px/8px inset, an 8px item gap, 60px stage items on the rail-item radius,
// the inset 3x20px accent marker, a neutral muted label that accents only when
// active, and three new rail-scoped tokens in every theme. jsdom has no layout
// engine, so this suite pins the contract in the real stylesheet and the rail
// source (the same static-CSS-guard pattern `def320_stageRailTrack` uses).
//
// Colours are asserted as token names, never literals — the source scan below
// is the same guard `phase36StageTokenSourceScan` applies to StageRail.tsx.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(resolve(__dirname, '../../../src/renderer/styles.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);
const RAIL_SRC = readFileSync(
  resolve(__dirname, '../../../src/renderer/components/StageRail.tsx'),
  'utf8',
);

/** A colour literal in source: hex, rgb()/rgba(), or hsl()/hsla(). */
const COLOUR_LITERAL = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The declaration block of the FIRST rule whose selector matches exactly. */
function rule(selector: string): string {
  const re = new RegExp(`(?:^|[},])\\s*${escapeRe(selector)}\\s*\\{([^}]*)\\}`, 'm');
  const match = re.exec(CSS);
  if (match === null) throw new Error(`no rule for ${selector}`);
  return match[1];
}

/** A `prop: value;` declaration inside a block, whitespace-normalised. */
function decl(block: string, prop: string): string | null {
  const re = new RegExp(`(?:^|;)\\s*${escapeRe(prop)}\\s*:\\s*([^;]+)`, 'm');
  const match = re.exec(block);
  return match === null ? null : match[1].trim().replace(/\s+/g, ' ');
}

/** CSS specificity as [ids, classes+attrs+pseudo-classes, elements]. */
function specificity(selector: string): [number, number, number] {
  const ids = (selector.match(/#[\w-]+/g) ?? []).length;
  const classes = (selector.match(/\.[\w-]+/g) ?? []).length;
  const attrs = (selector.match(/\[[^\]]+\]/g) ?? []).length;
  const pseudoClasses = (selector.match(/:(?!:)[\w-]+/g) ?? []).length;
  const pseudoElements = (selector.match(/::[\w-]+/g) ?? []).length;
  const elements = (selector.match(/(?:^|[\s>+~])([a-z][\w-]*)/gi) ?? [])
    .length;
  return [ids, classes + attrs + pseudoClasses, elements + pseudoElements];
}

const outSpecifies = (selector: string, generic: string): boolean => {
  const a = specificity(selector);
  const b = specificity(generic);
  for (let i = 0; i < 3; i += 1) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return false;
};

const GENERIC_ACTIVE = '.btn-toggle[aria-pressed="true"]';

// DEF-578 — the WCAG contrast math, identical to phase36StageTokens.test.ts
// (lin / lum / contrast / over). The rail label's ink and its surface are
// resolved from the real theme blocks, never hard-coded in the assertion.

/** A theme-block colour token as [r, g, b, a]; hex or rgba()/rgb(). */
function rgbaOf(blockText: string, name: string): number[] {
  const raw = decl(blockText, name);
  if (raw === null) throw new Error(`no ${name} declaration`);
  const hex = /^#([0-9a-fA-F]{6})$/.exec(raw);
  if (hex !== null) {
    const s = hex[1] ?? '000000';
    return [0, 2, 4].map((i) => Number.parseInt(s.slice(i, i + 2), 16)).concat(1);
  }
  const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/.exec(raw);
  if (m === null) throw new Error(`${name} is not a colour: ${raw}`);
  return [
    Number(m[1] ?? 0),
    Number(m[2] ?? 0),
    Number(m[3] ?? 0),
    m[4] === undefined ? 1 : Number(m[4]),
  ];
}

/** Composite a translucent film [r,g,b,a] over an opaque surface. */
const over = (film: number[], surface: number[]): number[] =>
  film
    .slice(0, 3)
    .map((c, i) => Math.round(c * (film[3] ?? 1) + (surface[i] ?? 0) * (1 - (film[3] ?? 1))));

const lin = (c: number): number => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
};
const lum = (rgb: number[]): number =>
  0.2126 * lin(rgb[0] ?? 0) + 0.7152 * lin(rgb[1] ?? 0) + 0.0722 * lin(rgb[2] ?? 0);
const contrast = (a: number[], b: number[]): number => {
  const [hi, lo] = lum(a) > lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)];
  return (hi + 0.05) / (lo + 0.05);
};
// The design budget (`label-contrast-check.json`) is published at two decimal
// places, so the ratio is compared at that same precision — the raw light
// selected ratio is 4.7260 and the dark selected ratio is 6.5890, which the
// budget records as 4.73 and 6.59.
const at2dp = (n: number): number => Math.round(n * 100) / 100;

const RAIL_W = Number.parseFloat((CSS.match(/--tf-stage-rail-w:\s*(\d+)px/) ?? [])[1] ?? 'NaN');
const APP_MAIN = rule('.app-main');
const RAIL = rule('.stage-rail');
const RAIL_BUTTONS = rule('.stage-rail-buttons');
const RAIL_BTN = rule('.stage-rail-btn');
const RAIL_MARKER = rule('.stage-rail-btn-active::before');
const RAIL_LABEL = rule('.stage-rail-label');
const ACTIVE_LABEL = rule('.stage-rail-btn-active .stage-rail-label');
// DEF-578 — the active FILL must out-specify the generic `.btn-toggle[
// aria-pressed="true"]` (0,2,0) override at styles.css:3572, or the latter
// paints `--accent-soft` over the rail's selected surface.
const ACTIVE_FILL = rule('.stage-rail .stage-rail-btn[aria-pressed="true"]');
const RAIL_GEAR = rule('.stage-rail-gear');
const RAIL_GEAR_SVG = rule('.stage-rail .stage-rail-gear svg');
const LIGHT = rule(':root');
const DARK = rule(':root[data-theme="dark"]');
const FROSTED = rule(':root[data-theme="frosted"]');

describe('Phase 108 — the Workspace Rail geometry', () => {
  it('widens the rail track to 72px, in the token and both fallbacks', () => {
    expect(RAIL_W).toBe(72);
    expect(decl(APP_MAIN, 'grid-template-columns')).toBe(
      'var(--tf-stage-rail-w, 72px) minmax(0, 1fr)',
    );
    expect(decl(RAIL, 'width')).toBe('var(--tf-stage-rail-w, 72px)');
  });

  it('sets the 12px/8px rail inset on the new siderail surface', () => {
    expect(decl(RAIL, 'padding')).toBe('12px 8px');
    expect(decl(RAIL, 'background')).toBe('var(--tf-siderail-surface)');
  });

  it('spaces items 8px apart, each a 60px hit target on the rail-item radius', () => {
    expect(decl(RAIL_BUTTONS, 'gap')).toBe('8px');
    expect(decl(RAIL_BTN, 'min-height')).toBe('60px');
    expect(decl(RAIL_BTN, 'padding')).toBe('8px 4px');
    expect(decl(RAIL_BTN, 'gap')).toBe('6px');
    expect(decl(RAIL_BTN, 'border-radius')).toBe('var(--tf-siderail-item-radius)');
  });

  it('draws the active marker as the inset 3x20px leading bar', () => {
    expect(decl(RAIL_MARKER, 'left')).toBe('2px');
    expect(decl(RAIL_MARKER, 'top')).toBe('20px');
    expect(decl(RAIL_MARKER, 'width')).toBe('3px');
    expect(decl(RAIL_MARKER, 'height')).toBe('20px');
    expect(decl(RAIL_MARKER, 'border-radius')).toBe('var(--tf-siderail-marker-radius)');
    expect(decl(RAIL_MARKER, 'background')).toBe('var(--accent)');
  });

  it('keeps the label visible at every width and accents only the active one', () => {
    // DEF-578 — the resting label ink is the design's inactive foreground
    // (--tf-icon-rest), matching the inactive rail icon; the active label
    // takes the accent ink.
    expect(decl(RAIL_LABEL, 'color')).toBe('var(--tf-icon-rest)');
    expect(decl(ACTIVE_LABEL, 'color')).toBe('var(--tf-icon-active)');
    expect(CSS).not.toMatch(/\.stage-rail-compact \.stage-rail-label\s*\{[^}]*display:\s*none/s);
  });

  it('gives the Settings utility gear the shorter rail-utility hit target', () => {
    expect(decl(RAIL_GEAR, 'min-height')).toBe('var(--tf-siderail-utility-min)');
    expect(decl(RAIL_GEAR_SVG, 'width')).toBe('var(--tf-siderail-utility-icon)');
    expect(decl(RAIL_GEAR_SVG, 'height')).toBe('var(--tf-siderail-utility-icon)');
  });

  it('scrolls the workspace list so Settings stays pinned at short heights', () => {
    expect(decl(RAIL_BUTTONS, 'min-height')).toBe('0');
    expect(decl(RAIL_BUTTONS, 'overflow-y')).toBe('auto');
    expect(decl(RAIL_BUTTONS, 'overscroll-behavior')).toBe('contain');
  });
});

describe('Phase 108 — rail-scoped tokens in every theme', () => {
  const TOKENS = [
    '--tf-siderail-surface',
    '--tf-siderail-selected-surface',
    '--tf-siderail-item-radius',
    '--tf-siderail-utility-min',
    '--tf-siderail-marker-radius',
    '--tf-siderail-utility-icon',
  ];

  it('declares each new token in the light, dark and frosted theme blocks', () => {
    for (const token of TOKENS) {
      expect(decl(LIGHT, token), `light ${token}`).not.toBeNull();
      expect(decl(DARK, token), `dark ${token}`).not.toBeNull();
      expect(decl(FROSTED, token), `frosted ${token}`).not.toBeNull();
    }
  });

  it('pins the per-theme surface and the shared geometry values', () => {
    expect(decl(LIGHT, '--tf-siderail-surface')).toBe('#FFFFFF');
    expect(decl(DARK, '--tf-siderail-surface')).toBe('#20232B');
    expect(decl(FROSTED, '--tf-siderail-surface')).toBe('var(--glass-sidebar-bg)');
    // DEF-578 — the rail-scoped selected fill: the frozen design
    // light/dark `selectedSurface`, frosted keeps the shared glass wash.
    expect(decl(LIGHT, '--tf-siderail-selected-surface')).toBe('#F0EBFC');
    expect(decl(DARK, '--tf-siderail-selected-surface')).toBe('#302740');
    expect(decl(FROSTED, '--tf-siderail-selected-surface')).toBe('var(--accent-soft)');
    expect(decl(LIGHT, '--tf-siderail-item-radius')).toBe('10px');
    expect(decl(DARK, '--tf-siderail-item-radius')).toBe('10px');
    expect(decl(FROSTED, '--tf-siderail-utility-min')).toBe('48px');
    expect(decl(LIGHT, '--tf-siderail-marker-radius')).toBe('2px');
    expect(decl(DARK, '--tf-siderail-marker-radius')).toBe('2px');
    expect(decl(FROSTED, '--tf-siderail-marker-radius')).toBe('2px');
    expect(decl(LIGHT, '--tf-siderail-utility-icon')).toBe('18px');
    expect(decl(DARK, '--tf-siderail-utility-icon')).toBe('18px');
    expect(decl(FROSTED, '--tf-siderail-utility-icon')).toBe('18px');
  });
});

describe('Phase 108 — the rail source', () => {
  it('renders the gear at the md size and carries no colour literal', () => {
    expect(RAIL_SRC).toContain('<Icon name="preferences" size="md" />');
    const hits = RAIL_SRC.split(/\r?\n/).filter((line) => COLOUR_LITERAL.test(line));
    expect(hits.map((line) => line.trim())).toEqual([]);
  });
});

// DEF-578 (qa, TFL-890) — the Workspace Rail label missed the phase's own
// design budget (`Visual overhaul/Siderail/Specifications/
// label-contrast-check.json`). The label rested in `--fg-muted` and the light
// selected fill was `--accent-soft` over white. The fix binds the label to the
// design's inactive foreground (`--tf-icon-rest`) and the selected fill to the
// rail-scoped `--tf-siderail-selected-surface`; this suite pins the resulting
// WCAG ratios against the phase budget. The values are RESOLVED from the theme
// blocks, so a future token change cannot silently drop the label under budget.
describe('Phase 108 / DEF-578 — the rail label contrast budget', () => {
  it('declares --tf-siderail-selected-surface in all three theme blocks', () => {
    for (const [name, theme] of [
      ['light', LIGHT],
      ['dark', DARK],
      ['frosted', FROSTED],
    ] as const) {
      expect(decl(theme, '--tf-siderail-selected-surface'), name).not.toBeNull();
    }
  });

  it('keeps the inactive label >= 7.96 (light) and >= 8.59 (dark)', () => {
    const lightInk = rgbaOf(LIGHT, '--tf-icon-rest');
    const lightSurface = rgbaOf(LIGHT, '--tf-siderail-surface');
    const darkInk = rgbaOf(DARK, '--tf-icon-rest');
    const darkSurface = rgbaOf(DARK, '--tf-siderail-surface');

    expect(at2dp(contrast(lightInk, lightSurface))).toBeGreaterThanOrEqual(7.96);
    expect(at2dp(contrast(darkInk, darkSurface))).toBeGreaterThanOrEqual(8.59);
  });

  it('keeps the selected label >= 4.73 (light) and >= 6.59 (dark)', () => {
    const lightInk = rgbaOf(LIGHT, '--tf-icon-active');
    const lightSurface = over(
      rgbaOf(LIGHT, '--tf-siderail-selected-surface'),
      rgbaOf(LIGHT, '--tf-siderail-surface'),
    );
    const darkInk = rgbaOf(DARK, '--tf-icon-active');
    const darkSurface = over(
      rgbaOf(DARK, '--tf-siderail-selected-surface'),
      rgbaOf(DARK, '--tf-siderail-surface'),
    );

    expect(at2dp(contrast(lightInk, lightSurface))).toBeGreaterThanOrEqual(4.73);
    expect(at2dp(contrast(darkInk, darkSurface))).toBeGreaterThanOrEqual(6.59);
  });
});

// DEF-578 (fix attempt 2) — the active rail FILL was DEAD in the rendered app
// because `.btn-toggle[aria-pressed="true"]` (0,2,0) at styles.css:3572 set
// `background: var(--accent-soft)` and beat the bare `.stage-rail-btn-active`
// fill (0,1,0) no matter the source order. This guard fails on that class of
// bug: the winning fill selector must out-specify the generic toggle override,
// and no lower-specificity bare fill may remain as the declared active wash.
describe('Phase 108 / DEF-578 — the active rail fill wins the CSS cascade', () => {
  it('declares the selected fill on a selector that out-specifies the generic toggle', () => {
    expect(decl(ACTIVE_FILL, 'background')).toBe('var(--tf-siderail-selected-surface)');
    expect(decl(ACTIVE_FILL, 'color')).toBe('var(--fg-strong)');
    // The generic override this must beat.
    expect(specificity(GENERIC_ACTIVE)).toEqual([0, 2, 0]);
    expect(outSpecifies('.stage-rail .stage-rail-btn[aria-pressed="true"]', GENERIC_ACTIVE)).toBe(
      true,
    );
  });

  it('binds the fill to a rail-scoped aria-pressed selector, not a bare class', () => {
    expect(ACTIVE_FILL).toBeTruthy();
    expect(CSS).not.toMatch(/\.stage-rail-btn-active\s*\{[^}]*background:/s);
  });
});

// DEF-579 (ADV-218) - the generic `.btn-toggle:hover:not([disabled]):not([
// aria-disabled="true"])` hover (0,4,0) at styles.css:3617 out-specified the
// selected-fill rule and repainted the ACTIVE rail item to the neutral
// --bg-hover wash on hover. The fix adds a rail-scoped hover rule with the same
// (0,4,0) that sits LATER in source, so the tie goes to the selected fill. This
// guard fails if that hover rule is removed or its value drifts.
const GENERIC_HOVER = '.btn-toggle:hover:not([disabled]):not([aria-disabled="true"])';

describe('Phase 108 / DEF-579 - the active rail fill survives hover', () => {
  it('declares a rail-scoped :hover rule that keeps the selected fill', () => {
    const hover = rule('.stage-rail .stage-rail-btn[aria-pressed="true"]:hover');
    expect(decl(hover, 'background')).toBe('var(--tf-siderail-selected-surface)');
  });

  it('places the rail hover rule after the generic toggle hover it ties', () => {
    // Equal specificity -> the LATER rule wins; assert the source order that
    // makes the selected fill survive hover.
    expect(CSS.indexOf('.stage-rail .stage-rail-btn[aria-pressed="true"]:hover')).toBeGreaterThan(
      CSS.indexOf(GENERIC_HOVER),
    );
  });
});

// DEF-580 (ADV-219) - in forced-colors the active fill collapses, the ::before
// marker is forced to the Canvas colour and the rail's border:0 removes the
// toggle border, leaving the active item with no shape cue (aria-pressed only).
// The fix adds a rail-scoped forced-colors block that gives the active item a
// system-colour outline (no layout shift) and keeps the leading marker visible.
function mediaBlocks(query: string): string[] {
  const blocks: string[] = [];
  let from = 0;
  for (;;) {
    const start = CSS.indexOf(`@media (${query})`, from);
    if (start === -1) return blocks;
    const open = CSS.indexOf('{', start);
    let depth = 0;
    let i = open;
    for (; i < CSS.length; i += 1) {
      if (CSS[i] === '{') depth += 1;
      else if (CSS[i] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    blocks.push(CSS.slice(open + 1, i));
    from = i + 1;
  }
}

/** The declaration block of the FIRST matching rule inside `text`. */
function ruleIn(text: string, selector: string): string {
  const re = new RegExp(`(?:^|[},])\\s*${escapeRe(selector)}\\s*\\{([^}]*)\\}`, 'm');
  const match = re.exec(text);
  if (match === null) throw new Error(`no rule for ${selector}`);
  return match[1];
}

const SYSTEM_COLOR = /Highlight|ButtonText|CanvasText|ButtonFace|LinkText/;
const RAIL_FORCED = mediaBlocks('forced-colors: active').find((block) =>
  block.includes('.stage-rail .stage-rail-btn[aria-pressed="true"]'),
);

describe('Phase 108 / DEF-580 - the active rail cue survives forced-colors', () => {
  it('declares a rail-scoped forced-colors block for the active item', () => {
    expect(RAIL_FORCED, 'a forced-colors block covering the active rail item').toBeTruthy();
  });

  it('gives the active item an outline with a system colour (no border/geometry change)', () => {
    const outline = decl(ruleIn(RAIL_FORCED ?? '', '.stage-rail .stage-rail-btn[aria-pressed="true"]'), 'outline');
    expect(outline, 'an outline cue on the active item').not.toBeNull();
    expect(SYSTEM_COLOR.test(outline ?? ''), `system colour in: ${outline}`).toBe(true);
    // outline, never border - geometry stays identical to the resting item.
    expect(outline).toContain('solid');
  });

  it('keeps the leading marker visible with a system colour', () => {
    const marker = ruleIn(
      RAIL_FORCED ?? '',
      '.stage-rail .stage-rail-btn[aria-pressed="true"]::before',
    );
    expect(decl(marker, 'background'), 'a system-colour marker').toMatch(SYSTEM_COLOR);
    expect(decl(marker, 'forced-color-adjust')).toBe('none');
  });
});
