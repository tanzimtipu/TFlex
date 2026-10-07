// @vitest-environment jsdom
//
// TFL-913 (Phase 108 deferral) — the Workspace Rail's label must not overflow
// the fixed 72px track under 200% Windows text scaling.
//
// The adversary design-critique flagged that the 11px labels fit the 56px
// content box at 100% text scaling, but the old `white-space: nowrap` would
// push them past the fixed `--tf-stage-rail-w` track at 200%, spilling across
// the ContextPanel column. No expanded mode ships this phase, so the label
// must WRAP inside the track instead.
//
// jsdom has no layout engine, so this suite pins the contract in the real
// stylesheet (the same static-CSS-guard pattern the DEF-320 and DEF-282
// suites use): the label wraps (`white-space: normal` + `overflow-wrap:
// anywhere` + `max-width: 100%`), the button grows with its content
// (`height: auto` + `min-height`), and the rail keeps its token width.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(resolve(__dirname, '../../../src/renderer/styles.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

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

const RAIL_W = Number.parseFloat((CSS.match(/--tf-stage-rail-w:\s*(\d+)px/) ?? [])[1] ?? 'NaN');
const RAIL = rule('.stage-rail');
const LABEL = rule('.stage-rail-label');
const BTN = rule('.stage-rail-btn');
const BUTTONS = rule('.stage-rail-buttons');

describe('TFL-913 — the rail label wraps instead of overflowing at 200% text scaling', () => {
  it('keeps the rail at its fixed token track', () => {
    expect(RAIL_W).toBe(72);
    expect(decl(RAIL, 'width')).toBe('var(--tf-stage-rail-w, 72px)');
  });

  it('wraps the label inside the track (never nowrap)', () => {
    expect(decl(LABEL, 'white-space')).toBe('normal');
    expect(decl(LABEL, 'overflow-wrap')).toBe('anywhere');
    expect(decl(LABEL, 'max-width')).toBe('100%');
    expect(decl(LABEL, 'text-align')).toBe('center');
  });

  it('grows the item vertically instead of clipping the wrapped lines', () => {
    expect(decl(BTN, 'height')).toBe('auto');
    expect(decl(BTN, 'min-height')).toBe('60px');
    // The column scrolls when the grown items exceed the rail height.
    expect(decl(BUTTONS, 'overflow-y')).toBe('auto');
  });

  it('uses the documented 11px compact role for the label ink', () => {
    expect(decl(LABEL, 'font-size')).toBe('var(--type-compact-size)');
    expect(decl(LABEL, 'line-height')).toBe('var(--type-compact-line)');
    expect(CSS).toMatch(/--type-compact-size:\s*11px/);
  });

  it('does not hide the label at the compact breakpoint', () => {
    expect(CSS).not.toMatch(/\.stage-rail-compact \.stage-rail-label\s*\{[^}]*display:\s*none/s);
  });
});
