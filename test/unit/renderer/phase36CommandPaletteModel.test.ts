// @vitest-environment jsdom
//
// Phase 36 (chunk 4) — the Command Palette's pure model.
//
// The fuzzy matcher, the ranking (match quality THEN `toolUsage` frequency
// THEN corpus order), the keyboard chords (`Ctrl+K` / legacy `Ctrl+Shift+P`;
// `Ctrl+P` deliberately absent), the highlight stepping and the frequency
// counter are all pure, so they are pinned here without a DOM. The component
// contract lives in phase36CommandPalette.test.tsx.

import { describe, expect, it } from 'vitest';
import {
  PALETTE_DOCK_FULL_MESSAGE,
  PALETTE_UNRUNNABLE_ACTIONS,
  STAGE_TAG_LABELS,
  TOOL_USAGE_CAP,
  VIEW_ACTION_IDS,
  buildPaletteRows,
  bumpToolUsage,
  firstActionableIndex,
  fuzzyScore,
  isRowActionable,
  paletteChordFor,
  paletteNavFor,
  paletteRowState,
  scoreToolEntry,
  stepHighlight,
  stepHighlightEnabled,
  type PaletteRow,
} from '../../../src/renderer/state/commandPalette';
import { TOOL_REGISTRY, toolById } from '../../../src/renderer/state/toolsRegistry';

const chord = (
  key: string,
  mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {},
) => ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });

describe('Phase 36 — fuzzy matching', () => {
  it('bands exact > prefix > substring > subsequence, and -1 for no match', () => {
    const exact = fuzzyScore('merge', 'Merge');
    const prefix = fuzzyScore('mer', 'Merge PDFs');
    const substring = fuzzyScore('pdfs', 'Merge PDFs');
    const subsequence = fuzzyScore('mgp', 'Merge PDFs');
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(subsequence);
    expect(fuzzyScore('zzzz', 'Merge PDFs')).toBe(-1);
  });

  it('an empty query matches everything at score 0', () => {
    expect(fuzzyScore('', 'anything')).toBe(0);
    expect(fuzzyScore('   ', 'anything')).toBe(0);
  });

  it('prefers a word-boundary run inside the subsequence band', () => {
    expect(fuzzyScore('zp', 'Zoom in page')).toBeGreaterThan(fuzzyScore('zp', 'Zap zip'));
  });
});

describe('Phase 36 — matching the id, the label and the description', () => {
  it('matches a tool by its ID alone', () => {
    const entry = toolById('multi-mode');
    expect(entry).toBeDefined();
    // The hyphen exists in the id and nowhere in the label / description.
    expect(scoreToolEntry(entry!, 'multi-mode')).toBeGreaterThan(0);
  });

  it('matches a tool by its LABEL alone', () => {
    const entry = toolById('outlinePanel');
    expect(entry).toBeDefined();
    expect(scoreToolEntry(entry!, 'bookmarks')).toBeGreaterThan(0);
  });

  it('matches a tool by its DESCRIPTION alone (weighted below a label hit)', () => {
    const entry = toolById('recognizeText');
    expect(entry).toBeDefined();
    const byDescription = scoreToolEntry(entry!, 'searchable text layer');
    const byLabel = scoreToolEntry(entry!, 'recognize');
    expect(byDescription).toBeGreaterThan(0);
    expect(byLabel).toBeGreaterThan(byDescription);
  });
});

describe('Phase 36 — buildPaletteRows', () => {
  const recents = [{ path: 'C:/docs/quarterly.pdf', label: 'quarterly.pdf' }];

  it('lists every RUNNABLE registry entry for an empty query, recents first', () => {
    // Phase 59 (item 7) — entries whose action has no command anywhere are
    // removed from the corpus, so the count is the registry minus those.
    const expected = TOOL_REGISTRY.length - PALETTE_UNRUNNABLE_ACTIONS.size;
    const rows = buildPaletteRows({ query: '', recents });
    expect(rows).toHaveLength(expected + 1);
    expect(rows[0]?.kind).toBe('recent');
    const ids = rows.filter((r) => r.kind === 'tool').map((r) => (r.kind === 'tool' ? r.id : ''));
    expect(new Set(ids).size).toBe(expected);
  });

  it('ranks an empty query by frequency, then by registry order', () => {
    const rows = buildPaletteRows({ query: '', usage: { exportDocx: 9 } });
    const tools = rows.filter((r) => r.kind === 'tool');
    expect(tools[0]?.kind === 'tool' && tools[0].id).toBe('exportDocx');
    // Everything else keeps its registry order.
    expect(tools[1]?.kind === 'tool' && tools[1].id).toBe('merge');
  });

  it('breaks a match-quality TIE with the seeded toolUsage frequency', () => {
    const bare = buildPaletteRows({ query: 'export' });
    const bareIds = bare.map((r) => (r.kind === 'tool' ? r.id : ''));
    expect(bareIds).toContain('exportText');
    // Seven entries tie on the "export" label prefix, so the corpus (registry)
    // order decides: exportComments is declared first in the registry. Phase 57
    // added the exportFormData palette tool to this tie.
    expect(bareIds[0]).toBe('exportComments');
    expect(bareIds.filter((id) => id.startsWith('export'))).toHaveLength(7);
    // Seeding usage for exportText must lift it to the top of that tie.
    const seeded = buildPaletteRows({ query: 'export', usage: { exportText: 7 } });
    expect(seeded[0]?.kind === 'tool' && seeded[0].id).toBe('exportText');
  });

  it('drops rows that do not match, and returns nothing for gibberish', () => {
    const rows = buildPaletteRows({ query: 'multi-mode' });
    expect(rows.map((r) => (r.kind === 'tool' ? r.id : ''))).toEqual(['multi-mode']);
    expect(buildPaletteRows({ query: 'qqqqzz' })).toHaveLength(0);
  });

  it('finds a recent file by name and by path', () => {
    expect(buildPaletteRows({ query: 'quarterly', recents })[0]?.kind).toBe('recent');
    expect(buildPaletteRows({ query: 'docs', recents })[0]?.kind).toBe('recent');
  });

  it('carries the pinned marker from the persisted dock pins', () => {
    const rows = buildPaletteRows({ query: 'merge', dockPins: ['merge', 'sign'] });
    const merge = rows.find((r) => r.kind === 'tool' && r.id === 'merge');
    expect(merge?.kind === 'tool' && merge.pinned).toBe(true);
    const sign = buildPaletteRows({ query: 'sign', dockPins: ['sign'] }).find(
      (r) => r.kind === 'tool' && r.id === 'sign',
    );
    expect(sign?.kind === 'tool' && sign.pinned).toBe(true);
  });

  it('exposes every VIEW_ACTION_IDS entry as a row (split / Multi Mode, zoom presets, stage switches)', () => {
    const rows = buildPaletteRows({ query: '' });
    const ids = new Set(rows.map((r) => (r.kind === 'tool' ? r.id : '')));
    for (const id of VIEW_ACTION_IDS) {
      expect(ids.has(id), `${id} missing from the palette corpus`).toBe(true);
    }
    expect(VIEW_ACTION_IDS).toContain('multi-mode');
    expect(VIEW_ACTION_IDS).toContain('stageDeliver');
  });
});

describe('Phase 36 — row state: disabled rows are never silent no-ops', () => {
  it('Phase 59 (item 7): a command-less action is REMOVED from the corpus, not listed', () => {
    // The old Phase-36 contract listed them disabled with a static copy; the
    // operator asked for dead rows to be removed instead.
    expect(PALETTE_UNRUNNABLE_ACTIONS.has('annotationColor')).toBe(true);
    expect(PALETTE_UNRUNNABLE_ACTIONS.has('dragPageToDocument')).toBe(true);
    const rows = buildPaletteRows({ query: '' });
    const ids = rows.map((r) => (r.kind === 'tool' ? r.id : ''));
    expect(ids).not.toContain('annColor');
    expect(ids).not.toContain('dragPage');
  });

  it('keeps a RUNNABLE entry enabled and disables it only when the host gate closes', () => {
    const entry = toolById('merge')!;
    expect(paletteRowState(entry, { isToolEnabled: () => true }).enabled).toBe(true);
    const closed = paletteRowState(entry, { isToolEnabled: () => false });
    expect(closed.enabled).toBe(false);
    expect(closed.reason).toBe('Open a document first');
  });

  it('keeps a runnable merge row listed and enabled when the corpus is unfiltered by a gate', () => {
    const rows = buildPaletteRows({ query: 'merge', dockPins: [] });
    const merge = rows.find((r) => r.kind === 'tool' && r.id === 'merge');
    expect(merge?.kind === 'tool' && merge.enabled).toBe(true);
  });
});

describe('Phase 36 — keyboard chords', () => {
  it('Ctrl+K toggles the palette and Ctrl+Shift+P is the legacy alias', () => {
    expect(paletteChordFor(chord('k', { ctrlKey: true }))).toBe('toggle');
    expect(paletteChordFor(chord('K', { metaKey: true }))).toBe('toggle');
    expect(paletteChordFor(chord('p', { ctrlKey: true, shiftKey: true }))).toBe('legacy-open');
  });

  it('NEVER claims Ctrl+P — it stays the Print shortcut', () => {
    expect(paletteChordFor(chord('p', { ctrlKey: true }))).toBeNull();
    expect(paletteChordFor(chord('P', { metaKey: true }))).toBeNull();
    // And no other stray chord is claimed.
    expect(paletteChordFor(chord('k', { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(paletteChordFor(chord('k', { ctrlKey: true, altKey: true }))).toBeNull();
    expect(paletteChordFor(chord('k'))).toBeNull();
    expect(paletteChordFor(chord('s', { ctrlKey: true }))).toBeNull();
    expect(paletteChordFor(chord('o', { ctrlKey: true, shiftKey: true }))).toBeNull();
  });

  it('maps the open palette keys, including Ctrl+Enter for the pin', () => {
    expect(paletteNavFor(chord('ArrowDown'))).toBe('next');
    expect(paletteNavFor(chord('ArrowUp'))).toBe('prev');
    expect(paletteNavFor(chord('Escape'))).toBe('close');
    expect(paletteNavFor(chord('Enter'))).toBe('run');
    expect(paletteNavFor(chord('Enter', { ctrlKey: true }))).toBe('pin');
    expect(paletteNavFor(chord('Enter', { metaKey: true }))).toBe('pin');
    // Ctrl+P is not a palette key either.
    expect(paletteNavFor(chord('p', { ctrlKey: true }))).toBeNull();
    expect(paletteNavFor(chord('k', { ctrlKey: true }))).toBeNull();
  });

  it('wraps the highlight at both ends', () => {
    expect(stepHighlight(0, -1, 5)).toBe(4);
    expect(stepHighlight(4, 1, 5)).toBe(0);
    expect(stepHighlight(0, 1, 0)).toBe(0);
  });

  it('skips disabled rows and anchors on the first runnable one', () => {
    const rows: PaletteRow[] = [
      { kind: 'recent', key: 'recent:a', path: 'a', label: 'a', score: 0 },
      {
        kind: 'tool',
        key: 'tool:x',
        id: 'x',
        entry: toolById('merge')!,
        score: 0,
        pinned: false,
        enabled: false,
        reason: 'nope',
      },
      {
        kind: 'tool',
        key: 'tool:y',
        id: 'y',
        entry: toolById('split')!,
        score: 0,
        pinned: false,
        enabled: true,
        reason: undefined,
      },
    ];
    expect(isRowActionable(rows[1])).toBe(false);
    // ↓ from the recent row skips the disabled tool row and lands on the next
    // runnable one; ↑ wraps through the disabled row to the same place.
    expect(stepHighlightEnabled(rows, 0, 1)).toBe(2);
    expect(stepHighlightEnabled(rows, 0, -1)).toBe(2);
    expect(firstActionableIndex(rows)).toBe(0);
    const onlyDisabled = rows.slice(1, 2);
    expect(firstActionableIndex(onlyDisabled)).toBe(0);
    expect(stepHighlightEnabled(onlyDisabled, 0, 1)).toBe(0);
  });
});

describe('Phase 36 — the frequency counter', () => {
  it('increments one tool and preserves the rest', () => {
    const next = bumpToolUsage({ merge: 2, split: 1 }, 'merge');
    expect(next).toEqual({ merge: 3, split: 1 });
  });

  it('starts at 1 for an unknown / invalid count', () => {
    expect(bumpToolUsage(undefined, 'merge')).toEqual({ merge: 1 });
    expect(bumpToolUsage({ merge: -4 as number }, 'merge')).toEqual({ merge: 1 });
  });

  it('keeps the record at the cap and bumps in place', () => {
    const full: Record<string, number> = {};
    for (let i = 0; i < TOOL_USAGE_CAP; i += 1) full[`tool${i}`] = 1;
    full.tool0 = 40;
    const next = bumpToolUsage(full, 'tool1');
    expect(Object.keys(next)).toHaveLength(TOOL_USAGE_CAP);
    expect(next.tool0).toBe(40);
    expect(next.tool1).toBe(2);
  });

  it('trims an over-long record to the cap, highest counts kept', () => {
    // A hand-edited settings.json can carry more entries than the cap. The
    // main-process validator keeps the highest counts; the renderer mirrors it.
    const over: Record<string, number> = { hot: 9 };
    for (let i = 0; i < TOOL_USAGE_CAP; i += 1) over[`tool${i}`] = 1;
    const next = bumpToolUsage(over, 'tool0');
    expect(Object.keys(next)).toHaveLength(TOOL_USAGE_CAP);
    expect(next.hot).toBe(9);
    expect(next.tool0).toBe(2);
  });
});

describe('Phase 36 — palette copy', () => {
  it('names the four stages plus the global bucket for the tag chip', () => {
    expect(STAGE_TAG_LABELS).toEqual({
      pages: 'Pages',
      edit: 'Edit',
      review: 'Review',
      deliver: 'Deliver',
      global: 'Global',
    });
  });

  it('mirrors the dock refusal copy verbatim', () => {
    expect(PALETTE_DOCK_FULL_MESSAGE).toBe('Dock is full');
  });
});
