// @vitest-environment jsdom
//
// Phase 51 — items 3 and 4 (operator RE-REPORTS).
//
// Item 3: the first thumbnail's selection ring must never reach the "Undo last
// change" row. The ring is an OUTER box-shadow (1.5px light/dark, 4px frosted),
// so an element-box comparison can pass while the PAINTED ring is clipped at
// the scroller's top edge and reads as running under the Undo bar. The fix
// reserves the ring's full footprint inside the scroller
// (`.thumb-scroller-inner` padding-top = 8px = --sp-2, the SAME 8px the rail's
// `THUMB_OUTER_PADDING` already assumes for page 1's slot top).
//
// Item 4: a context-panel annotation row's 24px delete control was pushed past
// the row's right edge by a non-shrinking `.ann-panel-row-jump`
// (flex min-width: auto), and `.ann-panel-row`'s `overflow: hidden` clipped it
// for the longer kind labels ("Rectangle", "Pen stroke"). `min-width: 0` lets
// the label ellipsize; `flex: 0 0 auto` pins the delete target.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { AnnotationsPanel } from '../../../src/renderer/annotations/AnnotationsPanel';
import type { Annotation } from '../../../src/renderer/annotations/model';

const CSS = readFileSync(resolve(__dirname, '../../../src/renderer/styles.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function rule(selector: string): string {
  const re = new RegExp(`(?:^|[},])\\s*${escapeRe(selector)}\\s*\\{([^}]*)\\}`, 'm');
  const match = re.exec(CSS);
  if (match === null) throw new Error(`no rule for ${selector}`);
  return match[1];
}

function decl(block: string, prop: string): string | null {
  const re = new RegExp(`(?:^|;)\\s*${escapeRe(prop)}\\s*:\\s*([^;]+)`, 'm');
  const match = re.exec(block);
  return match === null ? null : match[1].trim().replace(/\s+/g, ' ');
}

/** Largest outer box-shadow spread (px) in a rule body. Our selection rings
 *  are all zero-offset rounded-rect shadows: `0 0 0 Npx [color]`. */
function maxRingSpread(block: string): number {
  const re = /0(?:px)?\s+0(?:px)?\s+0(?:px)?\s+([\d.]+)px/g;
  let max = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) max = Math.max(max, Number(m[1]));
  return max;
}

const SCROLLER = rule('.thumb-scroller');
const SCROLLER_INNER = rule('.thumb-scroller-inner');
const RAIL_ACTIONS = rule('.rail-actions');
const LIGHT_RING = rule('.thumb-current');
const ROOT = rule(':root');
const FROSTED_RING = rule(':root[data-theme="frosted"] .thumb-current');

const SP2 = Number((decl(ROOT, '--sp-2') ?? '0').replace('px', ''));

// ---------------------------------------------------------------------------
// Item 3 — the ring-vs-Undo geometry.
// ---------------------------------------------------------------------------

describe('Phase 51 item 3 — the selection ring stays inside the scroller', () => {
  it('reserves at least the largest painted ring spread above the first thumb', () => {
    const reservedTop = SP2; // `.thumb-scroller-inner` padding is `var(--sp-2)`
    expect(SP2, '--sp-2 is the 8px spacing token').toBe(8);
    expect(decl(SCROLLER_INNER, 'padding')).toBe('var(--sp-2)');
    const light = maxRingSpread(LIGHT_RING);
    const frosted = maxRingSpread(FROSTED_RING);
    expect(light, 'the light/dark current-thumb ring is the 1.5px accent ring').toBeGreaterThan(0);
    expect(frosted, 'the frosted current-thumb ring is a 4px outer halo').toBe(4);
    expect(reservedTop, 'the scroller reserves the full painted ring').toBeGreaterThanOrEqual(frosted);
  });

  it('keeps hard clipping as the backstop at the scroller edge', () => {
    // Even if a future theme grew the ring beyond the reserve, the scroller
    // must clip it rather than let it paint into the Undo row.
    expect(decl(SCROLLER, 'overflow')).toBe('hidden');
    expect(decl(SCROLLER_INNER, 'overflow-y')).toBe('auto');
    // The Undo row is a fixed, non-shrinking row above the scroller.
    expect(decl(RAIL_ACTIONS, 'flex')).toBe('0 0 auto');
  });
});

// ---------------------------------------------------------------------------
// Item 4 — context-panel row containment (annotation rows).
// ---------------------------------------------------------------------------

const RJ = rule('.ann-panel-row');
const RJ_HEAD = rule('.ann-panel-row-head');
const RJ_JUMP = rule('.ann-panel-row-jump');
const RJ_DELETE = rule('.ann-panel-row-delete');

function ann(id: string, kind: Annotation['kind']): Annotation {
  const base = { id, page: 1, color: 'yellow' as const, createdAt: '2026-09-28T00:00:00Z' };
  switch (kind) {
    case 'highlight':
    case 'underline':
    case 'strikeout':
      return { ...base, kind, rects: [{ x: 0, y: 0, width: 10, height: 10 }], text: 'x' };
    case 'ink':
      return { ...base, kind, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }], width: 2 };
    case 'textbox':
      return { ...base, kind, rect: { x: 0, y: 0, width: 10, height: 10 }, text: 'x' };
    case 'rect':
    case 'ellipse':
      return { ...base, kind, rect: { x: 0, y: 0, width: 10, height: 10 } };
    case 'arrow':
      return { ...base, kind, from: { x: 0, y: 0 }, to: { x: 5, y: 5 } };
    case 'note':
      return { ...base, kind, at: { x: 0, y: 0 }, text: 'x' };
    case 'callout':
      return { ...base, kind, rect: { x: 0, y: 0, width: 10, height: 10 }, at: { x: 5, y: 5 }, text: 'x' };
  }
}

const ALL_KINDS: Annotation['kind'][] = [
  'highlight', 'underline', 'strikeout', 'ink', 'textbox',
  'rect', 'ellipse', 'arrow', 'note', 'callout',
];

describe('Phase 51 item 4 — every annotation row keeps its delete control inside the row', () => {
  it('lets the label column shrink and pins the delete target', () => {
    // The row clips (overflow: hidden) — so the delete MUST fit inside it.
    expect(decl(RJ, 'overflow')).toBe('hidden');
    // The jump is the shrinkable side: without min-width:0 its content-based
    // minimum pushed the delete past the row edge (measured delR 234.3 vs
    // rowR 227 in the running app).
    expect(decl(RJ_JUMP, 'min-width')).toBe('0');
    expect(decl(RJ_JUMP, 'flex')).toBe('1 1 auto');
    // The delete is a fixed 24px control and never yields space.
    expect(decl(RJ_DELETE, 'flex')).toBe('0 0 auto');
    expect(decl(RJ_DELETE, 'width')).toBe('24px');
    expect(decl(RJ_HEAD, 'display')).toBe('flex');
  });

  it('renders a jump + delete control for all ten annotation kinds', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const annotations = ALL_KINDS.map((k, i) => ann(`a${i}`, k));
    act((): void => {
      root.render(
        createElement(AnnotationsPanel, {
          annotations,
          onJumpTo: vi.fn(),
          onEdit: vi.fn(),
          onDelete: vi.fn(),
        }),
      );
    });
    try {
      const rows = [...host.querySelectorAll('.ann-panel-row')];
      expect(rows.length, 'one row per annotation').toBe(ALL_KINDS.length);
      for (const row of rows) {
        const jump = row.querySelector('.ann-panel-row-jump');
        const del = row.querySelector('.ann-panel-row-delete');
        expect(jump, 'every row has the jump button').not.toBeNull();
        expect(del, 'every row has the delete control').not.toBeNull();
        // The delete is a sibling of the jump inside the row head, so the
        // flex shrink rules above apply to every kind identically.
        expect(del?.parentElement?.className).toContain('ann-panel-row-head');
        expect(jump?.parentElement).toBe(del?.parentElement);
      }
    } finally {
      act((): void => {
        root.unmount();
      });
      host.remove();
    }
  });
});

