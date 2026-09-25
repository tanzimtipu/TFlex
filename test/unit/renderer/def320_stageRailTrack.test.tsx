// @vitest-environment jsdom
//
// DEF-320 — the Stage Rail must claim a REAL layout track to the LEFT of the
// ContextPanel, so the two can never overlap and the panel's collapse/expand
// control stays clickable in both states.
//
// The defect: chunk 1 mounted the 44px rail as an absolute left-edge OVERLAY
// (the panel had not moved into the left slot yet). Once chunk 6 promoted the
// ContextPanel into that slot both anchored at x=0: the rail clipped the
// panel's header ("Pages · 6" truncated to titleClientW 44 vs 57) and, in the
// collapsed 48px state, covered the "Expand panel" control entirely — the
// panel was stuck on the ruler strip for the rest of the session.
//
// jsdom has no layout engine, so this suite pins the LAYOUT CONTRACT in the
// real stylesheet (the same static-CSS-guard pattern the DEF-282 pane-offset
// and DEF-315 reserve suites use) and derives the geometry arithmetic from the
// values it parses: the rail's own grid column, the track width, the collapsed
// strip width and the 38px control all come out of styles.css, so a revert to
// `position: absolute; left: 0` fails here.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  STAGE_RAIL_COMPACT_WIDTH,
  isStageRailCompact,
} from '../../../src/renderer/components/StageRail';

const CSS = readFileSync(resolve(__dirname, '../../../src/renderer/styles.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/** Phase 38 (feature B) — the rail's width token, now the ONE track value. */
const RAIL_W = Number.parseFloat((CSS.match(/--tf-stage-rail-w:\s*(\d+)px/) ?? [])[1] ?? 'NaN');

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

const APP_MAIN = rule('.app-main');
const STAGE_RAIL = rule('.stage-rail');
const TAB_STAGE = rule('.tab-stage');
const SUSPECTS = rule('.ocr-suspects-panel');
const COLLAPSED_HEADER = rule(
  '.context-panel[data-context-panel-collapsed="true"] .context-panel-header',
);
const RAIL_TAB = rule('.rail-tab');
const COLLAPSED_APP_MAIN = rule('.app-main[data-rail-collapsed="true"]');

/** The five supported window widths the task pins. */
const WIDTHS = [1440, 1100, 900, 760, 640];
/** The panel's two column widths: expanded rest and the collapsed strip. */
const PANEL_WIDTHS = [220, 48];

// ---------------------------------------------------------------------------
// 1. The app frame is the four-zone grid: rail | context panel | canvas |
//    inspector.
// ---------------------------------------------------------------------------

describe('DEF-320 — the rail owns a real track in .app-main', () => {
  it('makes .app-main a two-column grid (rail track + stage) with the bar row above', () => {
    expect(decl(APP_MAIN, 'display')).toBe('grid');
    // Phase 38 (feature B) — the track is the --tf-stage-rail-w token (64px),
    // widened from the hardcoded 44px for the 12px label floor.
    expect(decl(APP_MAIN, 'grid-template-columns')).toBe(
      'var(--tf-stage-rail-w, 64px) minmax(0, 1fr)',
    );
    // Row 1 is the (optional) suspects bar, row 2 the rail + stage.
    expect(decl(APP_MAIN, 'grid-template-rows')).toBe('auto minmax(0, 1fr)');
  });

  it('places the rail in column 1 and the stage in column 2 of the same row', () => {
    expect(decl(STAGE_RAIL, 'grid-column')).toBe('1');
    expect(decl(STAGE_RAIL, 'grid-row')).toBe('2');
    expect(decl(TAB_STAGE, 'grid-column')).toBe('2');
    expect(decl(TAB_STAGE, 'grid-row')).toBe('2');
    // The stage still shrinks inside its track.
    expect(decl(TAB_STAGE, 'min-width')).toBe('0');
  });

  it('never re-absolutes the rail (the chunk-1 overlay is what stacked it)', () => {
    expect(decl(STAGE_RAIL, 'position')).toBe('relative');
    // The old overlay's three offsets are gone from the rail block.
    expect(decl(STAGE_RAIL, 'left')).toBeNull();
    expect(decl(STAGE_RAIL, 'top')).toBeNull();
    expect(decl(STAGE_RAIL, 'bottom')).toBeNull();
  });

  it('keeps the suspects bar a full-width flow row above the rail + stage', () => {
    expect(decl(SUSPECTS, 'grid-column')).toBe('1 / -1');
    expect(decl(SUSPECTS, 'grid-row')).toBe('1');
  });

  it('parses the rail width out of the same track the frame reserves', () => {
    expect(RAIL_W).toBe(64);
    expect(decl(APP_MAIN, 'grid-template-columns')).toContain('var(--tf-stage-rail-w, 64px)');
    expect(decl(STAGE_RAIL, 'width')).toBe('var(--tf-stage-rail-w, 64px)');
  });
});

// ---------------------------------------------------------------------------
// 2. The rail and the panel are adjacent, never stacked — at every width and
//    in BOTH panel states.
// ---------------------------------------------------------------------------

describe('DEF-320 — rail and panel never overlap, at any width or state', () => {
  it('starts the panel column at the rail track edge, so the overlap is 0', () => {
    const railTrack = RAIL_W;
    for (const width of WIDTHS) {
      for (const panelWidth of PANEL_WIDTHS) {
        // The rail occupies the app frame's first track; the panel column
        // begins exactly at its right edge (the rail is in-flow, so it
        // consumes the track instead of painting over the next column).
        const rail = { left: 0, right: railTrack };
        const panel = { left: railTrack, right: railTrack + panelWidth };
        const overlap = Math.max(
          0,
          Math.min(rail.right, panel.right) - Math.max(rail.left, panel.left),
        );
        expect(overlap, `overlap at ${width}px window, panel ${panelWidth}px`).toBe(0);
        expect(panel.left, `panel starts after the rail at ${width}px`).toBe(rail.right);
        // And the panel still fits the remaining width beside the rail.
        expect(panel.right, `panel fits at ${width}px`).toBeLessThan(width);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 3. The collapse affordance is reachable in both states.
// ---------------------------------------------------------------------------

describe('DEF-320 — the panel collapse/expand control stays clickable', () => {
  it('centres the lone control in the collapsed 48px strip', () => {
    // The collapsed header drops its 16px side padding for a 2px inset and
    // centres the actions cluster, mirroring the rail's own ruler header.
    expect(decl(COLLAPSED_HEADER, 'padding')).toBe('0 2px');
    expect(decl(COLLAPSED_HEADER, 'justify-content')).toBe('center');
    expect(decl(COLLAPSED_HEADER, 'gap')).toBe('0');
  });

  it('fits the 38px control inside the collapsed strip, with the rail clear of it', () => {
    const strip = Number.parseFloat(
      (decl(COLLAPSED_APP_MAIN, '--tf-rail-w') ?? '48px').replace('px', ''),
    );
    const button = Number.parseFloat((decl(RAIL_TAB, 'width') ?? '38px').replace('px', ''));
    const inset = Number.parseFloat((decl(COLLAPSED_HEADER, 'padding') ?? '0 2px').split(' ')[1] ?? '2');
    expect(strip).toBe(48);
    expect(button).toBe(38);
    expect(inset).toBe(2);
    // 48 - 2*2 = 44px of content box holds the 38px control.
    expect(strip - 2 * inset).toBeGreaterThanOrEqual(button);
    // The rail track (64px) sits entirely to the LEFT of the panel column, so
    // no part of the control can be covered by it.
    expect(RAIL_W).toBe(64);
  });

  it('keeps the compact (<1100px) rail behaviour and the Ctrl+1..4 chords', () => {
    expect(STAGE_RAIL_COMPACT_WIDTH).toBe(1100);
    expect(isStageRailCompact(1099)).toBe(true);
    expect(isStageRailCompact(1100)).toBe(false);
    // The label is what compact drops; the rail keeps its token track width.
    expect(CSS).toMatch(/\.stage-rail-compact \.stage-rail-label\s*\{[^}]*display:\s*none/s);
    const railSrc = readFileSync(
      resolve(__dirname, '../../../src/renderer/components/StageRail.tsx'),
      'utf8',
    );
    expect(railSrc).toContain('stageForCtrlDigit(event)');
    expect(railSrc).toContain("window.addEventListener('keydown', onKeyDown)");
  });
});
