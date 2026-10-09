// Phase 36 (chunk 4) — the Command Palette's pure model.
//
// `Ctrl+K` opens the palette (with `Ctrl+Shift+P` kept as a legacy alias);
// it is the browse-everything surface that supersedes the All-tools panel.
// Everything that can be decided without a DOM lives here so the fuzzy
// matcher, the ranking, the keyboard chords and the usage counter are
// unit-testable in isolation:
//
//   - the SEARCH CORPUS is three things: every runnable registry entry, the
//     recent files, and the view actions. The view actions (the split-view /
//     Multi Mode toggle, the zoom presets, the stage switches) are registry
//     entries like any other — listing them twice would duplicate rows, so
//     the palette searches `TOOL_REGISTRY` once and `VIEW_ACTION_IDS` names
//     the subset that must stay runnable for the tests.
//   - RANKING is match quality first, then the persisted `toolUsage`
//     frequency, then the registry's own order (stable).
//   - `Ctrl+P` is PRINT and is deliberately NOT in the chord table: the
//     palette never claims it (criterion 5 of the Phase-36 contract).
//   - Phase 59 (item 7): a registry entry whose action has no command
//     ANYWHERE (a panel control, a pointer interaction, a per-item list) is
//     REMOVED from the corpus (`PALETTE_UNRUNNABLE_ACTIONS`) rather than
//     listed as a dead row. A row that remains but cannot run in the CURRENT
//     context is DISABLED with the Action Dock's live reason copy — never a
//     silent no-op (DEF-327).
//
// Nothing in this module runs a command or touches Electron: the host
// supplies the run map, the settings writer and the availability gate.

import { DOCK_AVAILABILITY_REASON, sanitizeDockPins } from './dockModel';
import { STAGE_LABELS, type Stage } from './stages';
import {
  TOOL_REGISTRY,
  isPinVisibleInStage,
  toolById,
  type ToolEntry,
  type ToolStage,
} from './toolsRegistry';

/** Row key prefixes (stable React keys and e2e selectors). */
export const PALETTE_TOOL_PREFIX = 'tool:';
export const PALETTE_RECENT_PREFIX = 'recent:';

/** The dock's refusal copy, mirrored from the Action Dock's own menu so the
 *  palette and the dock tell the user the same thing. Phase 58: the old
 *  "(max 4 pins)" suffix is gone — the cap is now effectively unlimited. */
export const PALETTE_DOCK_FULL_MESSAGE = 'Dock is full';

/** `toolUsage` entry cap. Mirrors the MAIN-process settings validator's
 *  `TOOL_USAGE_CAP` (src/main/services/settings.ts) — the renderer cannot
 *  import main code, so the number is repeated here with this note. */
export const TOOL_USAGE_CAP = 200;

/** Phase 59 (item 7) — the registry `action` ids that have NO command in ANY
 *  context: no host run map entry (`paletteAppActions` / `dockAppActions`), no
 *  registered view command, and no live state that could ever make them run.
 *  Every one of these is a `surface: 'panel' | 'flyout'` widget or a pointer
 *  interaction (a colour swatch, a font picker, a right-click menu, a drag
 *  gesture, the rail's own annotations tab). They used to render as
 *  LISTED-DISABLED rows with a static "switch panels" refusal — a dead row the
 *  operator asked us to remove ("remove any component that are not usable from
 *  this Ctrl+K list"). They are now filtered OUT of the palette corpus, not
 *  listed. The dock / rail / flyout still own their real controls; nothing here
 *  is reachable from the palette by design.
 *
 *  Phase 59 (item 7) follow-up — `railTabThumbnails` and `railTabOutline` are
 *  NO LONGER here: the rail's active tab is now HOST-owned (App's `railTab`
 *  state, threaded through DocumentView/ContextPanel), so both commands have a
 *  real handler (`paletteAppActions`) that switches the tab and ensures the
 *  Pages panel is showing. They are listed and enabled again.
 *
 *  The rule for a new entry: if its `action` has no handler ANYWHERE, it does
 *  not belong in the palette row set — add it here rather than shipping a row
 *  that can never act. */
export const PALETTE_UNRUNNABLE_ACTIONS: ReadonlySet<string> = new Set<string>([
  'railTabAnnotations', // the rail's Annotations tab is SideRail-local
  'pageContextMenu', // the per-page context menu (right-click a thumbnail)
  'dragPageToDocument', // a click-drag gesture on a thumbnail
  'editDefaultFont', // the Edit panel's font picker
  'annotationColor', // the annotation flyout's colour swatch
  'annotationPenWidth', // the annotation flyout's pen-width control
  'pageJump', // the canvas page pill
  'openRecent', // the palette's own recent rows already open a file
  'removeRecent', // the recents list's own remove control
  'openSample', // the welcome screen's sample tiles
  'panePick', // the Multi Mode pane header
  'paneResize', // the Multi Mode divider drag
]);

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

/** DEF-327 — the host's refusal copy for the commands whose registry
 *  precondition cannot express their live state (an empty undo stack, Multi
 *  Mode off). The palette and the dock's pins gate on the same live state, so
 *  they explain it with the same words; the undo copy is the one the rail's own
 *  Undo button already carries. */
export const PALETTE_ACTION_REASONS: Readonly<Record<string, string>> = {
  undo: 'Nothing to undo',
  redo: 'Nothing to redo',
  paneOpen: 'Turn on Multi Mode first',
  paneClear: 'Turn on Multi Mode first',
};

/**
 * DEF-327 — the refusal copy for a DISABLED row, in the Action Dock's own
 * order: the focused pane's live reason first ("Turn on Edit content first"),
 * then the host's per-action copy ("Nothing to undo"). `undefined` means "no
 * live copy", and the row then falls back to the registry's declared
 * availability ("Run Recognize text first") — exactly like the dock.
 */
export function paletteDisabledReasonFor(args: {
  entry: ToolEntry;
  paneReason?: ((entry: ToolEntry) => string | undefined) | undefined;
  actionReasons?: Readonly<Record<string, string>> | undefined;
}): string | undefined {
  return args.paneReason?.(args.entry) ?? args.actionReasons?.[args.entry.action];
}

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
  /** DEF-359 — the pin is in the CURRENT stage's dock. A stage-native tool
   *  pinned outside its own stage has `pinned: false` here and carries the
   *  home in `pinnedStage`, so the palette never reports a pin in a dock that
   *  filters the tool out. */
  pinned: boolean;
  /** The tool's own stage when the pin lives there but the current stage does
   *  not render it (the palette's "pinned-elsewhere" state). */
  pinnedStage?: ToolStage;
  /** The stage whose dock this row's pin ACTION lands in / is removed from,
   *  when that is not the current dock (drives the notice copy). Undefined for
   *  a global tool and for a tool already in the current stage. */
  pinHomeStage?: ToolStage;
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
  /** DEF-327 — the host's live refusal copy for a disabled row, consulted
   *  BEFORE the registry's declared availability copy, exactly like the Action
   *  Dock's own `reasonFor` (the host knows WHY: "Turn on Edit content first",
   *  "Nothing to undo"). */
  disabledReasonFor?: (entry: ToolEntry) => string | undefined;
  /** The persisted dock pins (already validated) — drives the pinned marker
   *  and the dock's own dedupe. */
  dockPins?: readonly string[];
  /** Phase 40 (item 6) — the host's TRUE dock membership for a tool id: an
   *  explicit pin OR a focused-stage default the user has not un-pinned. The
   *  palette's pin toggle icon must reflect what the dock is actually showing,
   *  so the host supplies the full answer; absent falls back to `dockPins`. */
  isToolPinned?: (id: string) => boolean;
  /** DEF-359 — the stage the user is looking at (the focused pane's stage).
   *  Phase 42's ONE-HOME rule means a stage-native tool only renders in its own
   *  stage's dock; the palette scopes a pin's marker to this stage (naming the
   *  home in `pinnedStage`) so the two surfaces can never disagree. Absent
   *  preserves the unscoped Phase-40 behaviour. */
  activeStage?: Stage;
}

/** The enabled state + the reason copy for one registry row. Phase 59 (item
 *  7): an entry whose action is in `PALETTE_UNRUNNABLE_ACTIONS` never reaches
 *  this function (it is filtered out of the corpus); the only gate left is the
 *  host's LIVE availability, exactly like the Action Dock. */
export function paletteRowState(
  entry: ToolEntry,
  gate: PaletteRowGateArgs = {},
): { enabled: boolean; reason: string | undefined } {
  if (gate.isToolEnabled !== undefined && !gate.isToolEnabled(entry)) {
    // The dock's own order (ActionDock `reasonFor`): the host's live copy wins,
    // then the registry's declared availability ("Run Recognize text first").
    return {
      enabled: false,
      reason: gate.disabledReasonFor?.(entry) ?? DOCK_AVAILABILITY_REASON[entry.availability],
    };
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
  // Phase 59 (item 7) — the corpus is the registry (or an explicit test
  // corpus) MINUS every action that has no command anywhere. Those rows can
  // never act, so they are removed rather than listed-disabled.
  const entries = (args.entries ?? TOOL_REGISTRY).filter(
    (entry) => !PALETTE_UNRUNNABLE_ACTIONS.has(entry.action),
  );
  const recents = args.recents ?? [];
  const usage = args.usage;
  const pins = sanitizeDockPins(args.dockPins);
  const query = args.query.trim();

  const toolRows: PaletteToolRow[] = entries.map((entry) => {
    const state = paletteRowState(entry, args);
    const rawPinned =
      args.isToolPinned !== undefined
        ? args.isToolPinned(entry.id)
        : pins.includes(entry.id);
    // DEF-359 — scope the palette's pin marker to the dock the user is
    // actually looking at, using the SAME Phase-42 one-home rule the Action
    // Dock applies (`isPinVisibleInStage`). A stage-native tool pinned in
    // another stage is reported as pinned THERE (`pinnedStage`), never as if
    // it were in the current dock; a global tool pins everywhere as before.
    const visibleHere =
      args.activeStage === undefined || isPinVisibleInStage(entry, args.activeStage);
    const foreign = !visibleHere && entry.stage !== 'global';
    return {
      kind: 'tool',
      key: `${PALETTE_TOOL_PREFIX}${entry.id}`,
      id: entry.id,
      entry,
      score: scoreToolEntry(entry, query),
      pinned: rawPinned && visibleHere,
      ...(rawPinned && foreign ? { pinnedStage: entry.stage } : {}),
      ...(foreign ? { pinHomeStage: entry.stage } : {}),
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

/* -------------------------------------------------------------------------
 * DEF-359 — the pin toggle's state and copy
 * ---------------------------------------------------------------------- */

/** The three pin states the palette can render. `pinned` = in the CURRENT
 *  stage's dock; `pinned-elsewhere` = pinned, but in the tool's own stage
 *  (`row.pinnedStage`), which the current dock filters out; `unpinned` = not
 *  in any dock. */
export type PalettePinState = 'pinned' | 'pinned-elsewhere' | 'unpinned';

export function palettePinStateFor(row: PaletteToolRow): PalettePinState {
  if (row.pinned) return 'pinned';
  return row.pinnedStage === undefined ? 'unpinned' : 'pinned-elsewhere';
}

/** The dock name a pin action on this row actually lands in / leaves, or
 *  `undefined` when it is the current dock (the copy then just says "the
 *  dock"). A stage-native tool pinned from/into a foreign stage names that
 *  stage, so the notice never claims a change the visible dock did not make. */
export function palettePinDockName(row: PaletteToolRow): string | undefined {
  const stage = row.pinnedStage ?? row.pinHomeStage;
  return stage === undefined ? undefined : STAGE_TAG_LABELS[stage];
}
