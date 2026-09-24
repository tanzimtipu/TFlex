// Phase 36 (chunk 4) — the Command Palette's pure model.
//
// `Ctrl+K` opens the palette (with `Ctrl+Shift+P` kept as a legacy alias);
// it is the browse-everything surface that supersedes the All-tools panel.
// Everything that can be decided without a DOM lives here so the fuzzy
// matcher, the ranking, the keyboard chords and the usage counter are
// unit-testable in isolation:
//
//   - the SEARCH CORPUS is three things: every registry entry, the recent
//     files, and the view actions. The view actions (the split-view /
//     Multi Mode toggle, the zoom presets, the stage switches) are registry
//     entries like any other — listing them twice would duplicate rows, so
//     the palette searches `TOOL_REGISTRY` once and `VIEW_ACTION_IDS` names
//     the subset that must stay runnable for the tests.
//   - RANKING is match quality first, then the persisted `toolUsage`
//     frequency, then the registry's own order (stable).
//   - `Ctrl+P` is PRINT and is deliberately NOT in the chord table: the
//     palette never claims it (criterion 5 of the Phase-36 contract).
//   - A row with no command ANYWHERE (a panel control, a pointer
//     interaction, a per-item list) is DISABLED with the reason copy the
//     Action Dock already uses — never a silent no-op.
//
// Nothing in this module runs a command or touches Electron: the host
// supplies the run map, the settings writer and the availability gate.

import { DOCK_AVAILABILITY_REASON, sanitizeDockPins } from './dockModel';
import { STAGE_LABELS, type Stage } from './stages';
import { TOOL_REGISTRY, toolById, type ToolEntry, type ToolStage } from './toolsRegistry';

/** Row key prefixes (stable React keys and e2e selectors). */
export const PALETTE_TOOL_PREFIX = 'tool:';
export const PALETTE_RECENT_PREFIX = 'recent:';

/** The dock's refusal copy, mirrored from the Action Dock's own menu so the
 *  palette and the dock tell the user the same thing (max 4 pins). */
export const PALETTE_DOCK_FULL_MESSAGE = 'Dock is full (max 4 pins)';

/** `toolUsage` entry cap. Mirrors the MAIN-process settings validator's
 *  `TOOL_USAGE_CAP` (src/main/services/settings.ts) — the renderer cannot
 *  import main code, so the number is repeated here with this note. */
export const TOOL_USAGE_CAP = 200;

/** The registry `action` ids that have NO command anywhere: their control is
 *  a panel/inspector widget, a pointer interaction or a per-item list row.
 *  They stay listed (nothing is hidden) but render DISABLED with this copy,
 *  exactly like the dock's unavailable verbs. Every id here is a
 *  `surface: 'panel' | 'flyout'` entry that some panel owns. */
export const PALETTE_INTERACTIVE_ONLY: Readonly<Record<string, string>> = {
  railTabThumbnails: 'Switch to the Pages panel to use this',
  railTabOutline: 'Switch to the Pages panel to use this',
  railTabAnnotations: 'Switch to the Review panel to use this',
  pageContextMenu: 'Right-click a page in the Pages panel',
  dragPageToDocument: 'Drag a page onto another pane',
  editDefaultFont: 'Pick the font in the Edit panel',
  annotationColor: 'Pick the colour in the annotation flyout',
  annotationPenWidth: 'Pick the pen width in the annotation flyout',
  pageJump: 'Type a page number in the page pill',
  openRecent: 'Pick a recent file from the list below',
  removeRecent: 'Pick a recent file from the list below',
  openSample: 'Pick a sample from the welcome screen',
  appMenu: 'Use the File menu in the title bar',
  panePick: 'Pick a document from a Multi Mode pane',
  paneResize: 'Drag the Multi Mode divider',
};

/** The view actions the palette must expose (the Phase-36 search corpus names
 *  them explicitly: the split-view / Multi Mode toggle, the zoom presets and
 *  the stage switches). They are ordinary registry entries — this list only
 *  pins which ids the contract cares about. */
export const VIEW_ACTION_IDS: readonly string[] = [
  'multi-mode',
  'zoomIn',
  'zoomOut',
  'fitWidth',
  'fitPage',
  'stagePages',
  'stageEdit',
  'stageReview',
  'stageDeliver',
];

/** The stage tag chip's text: the four rail stages plus the global bucket. */
export const STAGE_TAG_LABELS: Record<ToolStage, string> = {
  ...STAGE_LABELS,
  global: 'Global',
};

/* -------------------------------------------------------------------------
 * Fuzzy matching
 * ---------------------------------------------------------------------- */

/** Score of an exact whole-string match. */
const SCORE_EXACT = 1000;
/** Score of a text that STARTS with the query. */
const SCORE_PREFIX = 800;
/** Score of a query found inside the text (minus a small index penalty). */
const SCORE_SUBSTRING = 600;
/** Ceiling for the looser subsequence band, so a subsequence hit can never
 *  outrank a real substring hit. */
const SCORE_SUBSEQUENCE_MAX = 399;

/** True when `ch` may follow a word boundary (spaces, dashes, slashes). */
function isBoundary(ch: string | undefined): boolean {
  return ch === undefined || ch === ' ' || ch === '-' || ch === '_' || ch === '/';
}

/**
 * Score `query` against `text`, or -1 when the query does not match at all.
 * Three bands, best first: exact, prefix/substring, subsequence. Inside the
 * subsequence band a run of consecutive characters and a hit on a word
 * boundary both score higher, so "zpi" still prefers "Zoom in" over an
 * accidental scatter through a long description.
 */
export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  if (q === '') return 0;
  const t = text.toLowerCase();
  if (t === q) return SCORE_EXACT;
  if (t.startsWith(q)) return SCORE_PREFIX;
  const at = t.indexOf(q);
  if (at >= 0) return Math.max(SCORE_SUBSEQUENCE_MAX + 1, SCORE_SUBSTRING - at * 4);

  // Subsequence: every query character must appear, in order.
  let cursor = 0;
  let score = 0;
  let run = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, cursor);
    if (found < 0) return -1;
    if (found === cursor && cursor > 0) {
      run += 1;
      score += 10 + run;
    } else {
      run = 0;
      score += 2;
    }
    if (found === 0 || isBoundary(t[found - 1])) score += 6;
    cursor = found + 1;
  }
  return Math.min(SCORE_SUBSEQUENCE_MAX, score);
}

/** Field weights: the label leads, the id is authoritative shorthand, the
 *  description is the loosest way to reach a tool. */
export const PALETTE_FIELD_WEIGHT = {
  label: 1,
  id: 0.9,
  description: 0.6,
} as const;

/** Score a registry entry against the query across id + label + description. */
export function scoreToolEntry(entry: ToolEntry, query: string): number {
  const label = fuzzyScore(query, entry.label);
  const id = fuzzyScore(query, entry.id);
  const description = fuzzyScore(query, entry.description);
  let best = -1;
  if (label >= 0) best = label * PALETTE_FIELD_WEIGHT.label;
  if (id >= 0) best = Math.max(best, id * PALETTE_FIELD_WEIGHT.id);
  if (description >= 0) best = Math.max(best, description * PALETTE_FIELD_WEIGHT.description);
  return best;
}

/** Score a recent file against the query (its label and its full path). */
export function scoreRecentFile(file: PaletteRecentFile, query: string): number {
  const label = fuzzyScore(query, file.label);
  const path = fuzzyScore(query, file.path);
  let best = -1;
  if (label >= 0) best = label;
  if (path >= 0) best = Math.max(best, path * 0.8);
  return best;
}

/* -------------------------------------------------------------------------
 * Results
 * ---------------------------------------------------------------------- */

/** One recent-file row the host hands the palette. */
export interface PaletteRecentFile {
  path: string;
  label: string;
}

export interface PaletteToolRow {
  kind: 'tool';
  key: string;
  id: string;
  entry: ToolEntry;
  score: number;
  pinned: boolean;
  enabled: boolean;
  reason: string | undefined;
}

export interface PaletteRecentRow {
  kind: 'recent';
  key: string;
  path: string;
  label: string;
  score: number;
}

export type PaletteRow = PaletteToolRow | PaletteRecentRow;

export interface PaletteRowGateArgs {
  /** Host availability gate (live state). Absent = the registry's own
   *  preconditions are the only gate. */
  isToolEnabled?: (entry: ToolEntry) => boolean;
  /** The persisted dock pins (already validated) — drives the pinned marker
   *  and the dock's own dedupe. */
  dockPins?: readonly string[];
}

/** The enabled state + the reason copy for one registry row. */
export function paletteRowState(
  entry: ToolEntry,
  gate: PaletteRowGateArgs = {},
): { enabled: boolean; reason: string | undefined } {
  const interactive = PALETTE_INTERACTIVE_ONLY[entry.action];
  if (interactive !== undefined) return { enabled: false, reason: interactive };
  if (gate.isToolEnabled !== undefined && !gate.isToolEnabled(entry)) {
    return { enabled: false, reason: DOCK_AVAILABILITY_REASON[entry.availability] };
  }
  return { enabled: true, reason: undefined };
}

export interface PaletteRowsArgs extends PaletteRowGateArgs {
  query: string;
  /** The searchable tool corpus. Defaults to the single registry. */
  entries?: readonly ToolEntry[];
  recents?: readonly PaletteRecentFile[];
  usage?: Readonly<Record<string, number>> | undefined;
}

/**
 * Build the ranked row list. With a query, rows are ranked by match quality,
 * then by `toolUsage` frequency, then by the corpus order (stable). With an
 * empty query the recents lead and the tools follow in
 * frequency-then-registry order — the palette's resting state is the user's
 * own recent history, not an alphabetical dump.
 */
export function buildPaletteRows(args: PaletteRowsArgs): PaletteRow[] {
  const entries = args.entries ?? TOOL_REGISTRY;
  const recents = args.recents ?? [];
  const usage = args.usage;
  const pins = sanitizeDockPins(args.dockPins);
  const query = args.query.trim();

  const toolRows: PaletteToolRow[] = entries.map((entry) => {
    const state = paletteRowState(entry, args);
    return {
      kind: 'tool',
      key: `${PALETTE_TOOL_PREFIX}${entry.id}`,
      id: entry.id,
      entry,
      score: scoreToolEntry(entry, query),
      pinned: pins.includes(entry.id),
      enabled: state.enabled,
      reason: state.reason,
    };
  });

  const recentRows: PaletteRecentRow[] = recents.map((file) => ({
    kind: 'recent',
    key: `${PALETTE_RECENT_PREFIX}${file.path}`,
    path: file.path,
    label: file.label,
    score: scoreRecentFile(file, query),
  }));

  if (query === '') {
    const byUsage = [...toolRows].sort(
      (a, b) => (usage?.[b.id] ?? 0) - (usage?.[a.id] ?? 0),
    );
    return [...recentRows, ...byUsage];
  }

  const matched: PaletteRow[] = [...recentRows, ...toolRows].filter((row) => row.score >= 0);
  return matched.map((row, index) => ({ row, index })).sort((a, b) => {
    if (b.row.score !== a.row.score) return b.row.score - a.row.score;
    const aUsage = a.row.kind === 'tool' ? usage?.[a.row.id] ?? 0 : 0;
    const bUsage = b.row.kind === 'tool' ? usage?.[b.row.id] ?? 0 : 0;
    if (bUsage !== aUsage) return bUsage - aUsage;
    return a.index - b.index;
  }).map((wrapped) => wrapped.row);
}

/* -------------------------------------------------------------------------
 * Keyboard chords
 * ---------------------------------------------------------------------- */

/** The subset of a keyboard event the palette's chords read. */
export interface PaletteKeyEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** Host chords: `Ctrl+K` toggles the palette, `Ctrl+Shift+P` (the legacy
 *  All-tools binding) opens it. `Ctrl+P` is deliberately absent — it stays
 *  the Print shortcut. */
export type PaletteChord = 'toggle' | 'legacy-open';

export function paletteChordFor(event: PaletteKeyEvent): PaletteChord | null {
  if (!(event.ctrlKey || event.metaKey)) return null;
  if (event.altKey) return null;
  const key = event.key.toLowerCase();
  if (key === 'k' && !event.shiftKey) return 'toggle';
  if (key === 'p' && event.shiftKey) return 'legacy-open';
  return null;
}

/** The keys the OPEN palette owns. */
export type PaletteNav = 'prev' | 'next' | 'run' | 'pin' | 'close';

export function paletteNavFor(event: PaletteKeyEvent): PaletteNav | null {
  switch (event.key) {
    case 'ArrowDown':
      return 'next';
    case 'ArrowUp':
      return 'prev';
    case 'Escape':
      return 'close';
    case 'Enter':
      return event.ctrlKey || event.metaKey ? 'pin' : 'run';
    default:
      return null;
  }
}

/** Move the highlighted index by `delta`, wrapping at both ends. A count of
 *  0 keeps index 0 so an empty list never yields -1. */
export function stepHighlight(current: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  const next = (current + delta) % count;
  return next < 0 ? next + count : next;
}

/** True when the row can be RUN (a recent file, or an enabled tool). */
export function isRowActionable(row: PaletteRow | undefined): boolean {
  if (row === undefined) return false;
  return row.kind === 'recent' || row.enabled;
}

/** The first actionable row's index (0 when none — the list is then empty or
 *  entirely disabled, and every action is refused by `isRowActionable`). */
export function firstActionableIndex(rows: readonly PaletteRow[]): number {
  const at = rows.findIndex((row) => isRowActionable(row));
  return at < 0 ? 0 : at;
}

/** ↑/↓ navigation SKIPS the disabled rows: a highlight the user cannot run
 *  would make Enter look broken. Wraps; returns `current` when nothing in the
 *  list is actionable. */
export function stepHighlightEnabled(
  rows: readonly PaletteRow[],
  current: number,
  delta: number,
): number {
  if (rows.length === 0) return 0;
  let index = current;
  for (let step = 0; step < rows.length; step += 1) {
    index = stepHighlight(index, delta, rows.length);
    if (isRowActionable(rows[index])) return index;
  }
  return current;
}

/* -------------------------------------------------------------------------
 * Frequency learning
 * ---------------------------------------------------------------------- */

/**
 * Increment one tool's run count, mirroring the main-process validator's
 * rule (non-negative integers only, capped at `TOOL_USAGE_CAP` entries with
 * the highest counts winning). Returns a NEW record; the caller writes it
 * through the settings path.
 */
export function bumpToolUsage(
  usage: Readonly<Record<string, number>> | undefined,
  id: string,
): Record<string, number> {
  if (id.length === 0) return { ...(usage ?? {}) };
  const current: Record<string, number> = { ...(usage ?? {}) };
  const prev = current[id];
  const base = typeof prev === 'number' && Number.isInteger(prev) && prev >= 0 ? prev : 0;
  const next: Record<string, number> = { ...current, [id]: base + 1 };
  const keys = Object.keys(next);
  if (keys.length <= TOOL_USAGE_CAP) return next;
  keys.sort((a, b) => (next[b] ?? 0) - (next[a] ?? 0));
  const kept: Record<string, number> = {};
  for (const key of keys.slice(0, TOOL_USAGE_CAP)) kept[key] = next[key] ?? 0;
  return kept;
}

/** True when the entry resolves through the registry (the palette refuses an
 *  id it cannot describe — the run map is keyed by `action`). */
export function paletteEntryFor(id: string): ToolEntry | undefined {
  return toolById(id);
}

/** The stage tag for a row's registry entry, or `null` for a recent row. */
export function stageTagFor(row: PaletteRow): string | null {
  return row.kind === 'tool' ? STAGE_TAG_LABELS[row.entry.stage] : null;
}

/** The stage a tool belongs to, for the tag chip's `data-stage` hook. */
export function rowStage(row: PaletteRow): ToolStage | Stage | null {
  return row.kind === 'tool' ? row.entry.stage : null;
}
