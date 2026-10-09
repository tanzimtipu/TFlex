// TFL-1216 (chunk C3) - the Activity Shelf store and producer adapters.
//
// One module, unit-testable without booting App. This module owns the
// `ActivityOperation[]` collection that the C2 primitives render and turns
// real producer events (OCR, conversion) into the C1 model's operations. It
// is pure TypeScript: no React, no IPC, no engine calls, no reads of "the
// active tab" - document identity is always supplied by the caller at creation
// and kept with the operation forever.
//
// It does NOT re-implement the C1 model: every state transition goes through
// the helpers in `./activity` (`startOperation`, `updateProgress`,
// `requestCancellation`, `confirmCancellation`, `completeOperation`,
// `completePartial`, `failOperation`, `makeProgress`). Acknowledgment (which
// the C1 model deliberately does not carry) lives here as store bookkeeping.
//
// Progress truthfulness is inherited from C1: determinate only with a known
// total, otherwise an indeterminate phase label. This module never fabricates
// a total, a percentage or an ETA - notably, a convert `ratio` (0..1) is
// intentionally NOT turned into a total.

import {
  completeOperation,
  completePartial,
  confirmCancellation,
  createOperation,
  failOperation,
  isRunning,
  isTerminal,
  makeProgress,
  requestCancellation,
  startOperation,
  updateProgress,
  type ActivityDocumentIdentity,
  type ActivityFailure,
  type ActivityOperation,
  type ActivityProgress,
} from './activity';
import { capabilityFor } from '../../shared/activity';
import type { ConvertProgress } from '../../shared/convert';
import type { OcrProgress, UpdateState } from '../../shared/types';
import type { SearchIndexProgress } from '../components/DocumentView';

/** How long a successful notice stays visible before it auto-dismisses. A
 *  `cancelled` notice never expires on its own. The UI freezes `nowMs` while the
 *  shelf is hovered or focused, which pauses dismissal by construction. */
export const SUCCESS_NOTICE_AUTO_DISMISS_MS = 8000;

/** The store's full state. `operations` is the ordered collection the shelf
 *  renders; `acknowledged` lists operation ids a terminal notice was dismissed
 *  through; `settledAtMs` records when each operation reached a terminal state
 *  so `selectVisibleNotices` can auto-dismiss successes deterministically. */
export interface ActivityShelfState {
  readonly operations: readonly ActivityOperation[];
  readonly acknowledged: readonly string[];
  readonly settledAtMs: Readonly<Record<string, number>>;
}

export const initialActivityShelfState: ActivityShelfState = {
  operations: [],
  acknowledged: [],
  settledAtMs: {},
};

/** Every action the store accepts. Terminal transitions accept an optional
 *  `atMs` so tests can pin the settle time; production omits it and the
 *  reducer stamps `Date.now()` (the only clock read in this module). */
export type ActivityShelfAction =
  | { readonly type: 'begin'; readonly operation: ActivityOperation; readonly phaseText?: string }
  | { readonly type: 'progress'; readonly id: string; readonly progress: ActivityProgress }
  | { readonly type: 'request-cancel'; readonly id: string }
  | { readonly type: 'confirm-cancel'; readonly id: string }
  | {
      readonly type: 'complete';
      readonly id: string;
      readonly transactionId?: string | null;
      readonly atMs?: number;
    }
  | {
      readonly type: 'complete-partial';
      readonly id: string;
      readonly failed: readonly ActivityFailure[];
      readonly transactionId?: string | null;
      readonly atMs?: number;
    }
  | {
      readonly type: 'fail';
      readonly id: string;
      readonly failure: ActivityFailure;
      readonly transactionId?: string | null;
      readonly atMs?: number;
    }
  | { readonly type: 'acknowledge'; readonly id: string }
  | { readonly type: 'remove'; readonly id: string };

/** Stamp a settle time only when an operation newly becomes terminal, so a
 *  duplicate/terminal transition cannot reset an already-running dismissal. */
function withSettledAt(
  state: ActivityShelfState,
  before: ActivityOperation,
  after: ActivityOperation,
  atMs: number | undefined,
): ActivityShelfState {
  if (isTerminal(after.state) && !isTerminal(before.state)) {
    return {
      ...state,
      settledAtMs: { ...state.settledAtMs, [after.id]: atMs ?? Date.now() },
    };
  }
  return state;
}

/** Apply one transition to the single operation with `id`. Non-matching
 *  operations are returned untouched. */
function mapOperation(
  state: ActivityShelfState,
  id: string,
  transition: (op: ActivityOperation) => ActivityOperation,
): ActivityShelfState {
  let changed = false;
  const operations = state.operations.map((op) => {
    if (op.id !== id) return op;
    const next = transition(op);
    if (next !== op) changed = true;
    return next;
  });
  return changed ? { ...state, operations } : state;
}

/** The pure store reducer. Mirrors the C1 honesty rules through the C1
 *  helpers: a request is not a cancellation, a terminal operation never
 *  resurrects on late progress, and partial-success carries its failures. */
export function reduceActivityShelf(
  state: ActivityShelfState,
  action: ActivityShelfAction,
): ActivityShelfState {
  switch (action.type) {
    case 'begin': {
      const started = startOperation(action.operation, action.phaseText);
      return { ...state, operations: [...state.operations, started] };
    }
    case 'progress':
      return mapOperation(state, action.id, (op) => updateProgress(op, action.progress));
    case 'request-cancel':
      return mapOperation(state, action.id, (op) => requestCancellation(op));
    case 'confirm-cancel':
      return mapOperation(state, action.id, (op) => confirmCancellation(op));
    case 'complete':
      return mapTerminal(state, action.id, action.atMs, (op) =>
        completeOperation(op, action.transactionId ?? null),
      );
    case 'complete-partial':
      return mapTerminal(state, action.id, action.atMs, (op) =>
        completePartial(op, action.failed, action.transactionId ?? null),
      );
    case 'fail':
      return mapTerminal(state, action.id, action.atMs, (op) =>
        failOperation(op, action.failure, action.transactionId ?? null),
      );
    case 'acknowledge':
      if (state.acknowledged.includes(action.id)) return state;
      return { ...state, acknowledged: [...state.acknowledged, action.id] };
    case 'remove': {
      if (!state.operations.some((op) => op.id === action.id)) return state;
      const { [action.id]: _settled, ...settledAtMs } = state.settledAtMs;
      return {
        operations: state.operations.filter((op) => op.id !== action.id),
        acknowledged: state.acknowledged.filter((id) => id !== action.id),
        settledAtMs,
      };
    }
  }
}

function mapTerminal(
  state: ActivityShelfState,
  id: string,
  atMs: number | undefined,
  transition: (op: ActivityOperation) => ActivityOperation,
): ActivityShelfState {
  const before = state.operations.find((op) => op.id === id);
  if (before === undefined) return state;
  const after = transition(before);
  if (after === before) return state;
  const operations = state.operations.map((op) => (op.id === id ? after : op));
  return withSettledAt({ ...state, operations }, before, after, atMs);
}

/** Operations still doing work: `running` or `cancellation-requested`. A
 *  terminal operation is never active. */
export function selectActiveOperations(
  state: ActivityShelfState,
): ActivityOperation[] {
  return state.operations.filter((op) => isRunning(op.state));
}

/** The footer summary: how many operations are active plus the first active
 *  operation (or null). */
export interface ActivitySummary {
  readonly activeCount: number;
  readonly active: ActivityOperation | null;
}

export function selectActivitySummary(state: ActivityShelfState): ActivitySummary {
  const active = selectActiveOperations(state);
  return { activeCount: active.length, active: active[0] ?? null };
}

/**
 * Terminal notices the shelf should show: terminal `completed` and `cancelled`
 * operations that have not been acknowledged. A `completed` notice
 * auto-dismisses once `nowMs` is at least `SUCCESS_NOTICE_AUTO_DISMISS_MS` past
 * the time it settled; `cancelled` never auto-expires. `failed` and
 * `partial-success` are excluded entirely - their warning/error notices now
 * live in the in-canvas `CanvasAlertNotice`. Passing a frozen `nowMs` therefore
 * pauses dismissal - the UI does this while hovered/focused.
 */
export function selectVisibleNotices(
  state: ActivityShelfState,
  nowMs: number,
): ActivityOperation[] {
  const acknowledged = new Set(state.acknowledged);
  return state.operations.filter((op) => {
    if (!isTerminal(op.state)) return false;
    if (acknowledged.has(op.id)) return false;
    if (op.state.kind === 'failed' || op.state.kind === 'partial-success') return false;
    if (op.state.kind === 'completed') {
      const settledAt = state.settledAtMs[op.id];
      if (settledAt !== undefined && nowMs - settledAt >= SUCCESS_NOTICE_AUTO_DISMISS_MS) {
        return false;
      }
    }
    return true;
  });
}

export interface TerminalAlert {
  readonly kind: 'warning' | 'error';
  readonly text: string;
}

/** The in-canvas alert message for a settled warning/error operation, or null
 *  for every other state. `failed` -> error (the failure reason); `partial-success`
 *  -> warning (the completed-with-N-issues sentence plus the failed items). */
export function terminalAlertFor(op: ActivityOperation): TerminalAlert | null {
  if (op.state.kind === 'failed') {
    return { kind: 'error', text: op.state.failure.reason };
  }
  if (op.state.kind === 'partial-success') {
    const n = op.state.failed.length;
    const items = op.state.failed.map((f) => `${f.item}: ${f.reason}`).join('; ');
    return {
      kind: 'warning',
      text: `${op.task.name}: completed with ${n} issue${n === 1 ? '' : 's'} (${items})`,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Producer adapters. Each captures the document identity the caller supplies
// at start time (the active document then) and never re-reads "the active
// tab" later. Progress translation stays truthful: OCR has a real page total
// so it is determinate; conversion reports phase text only, so its 0..1
// `ratio` is deliberately discarded rather than turned into a total.
// ---------------------------------------------------------------------------

/** Shared creation input: a caller-minted operation id plus the captured
 *  document identity. */
export interface ActivityProducerInput {
  readonly operationId: string;
  readonly docId: string;
  readonly tabId: string;
  readonly path: string | null;
  readonly displayName: string;
}

export interface OcrStartInput extends ActivityProducerInput {
  /** Pages in the captured document at start time. */
  readonly pageCount: number;
}

export const OCR_TASK_NAME = 'Recognize text';
export const CONVERT_TASK_NAME = 'Import';

function identityFrom(input: ActivityProducerInput): ActivityDocumentIdentity {
  return {
    docId: input.docId,
    tabId: input.tabId,
    path: input.path,
    displayName: input.displayName,
  };
}

/** Human phase label for OCR progress (the raw union is not user copy). */
export function ocrPhaseLabel(phase: OcrProgress['phase']): string {
  return phase === 'recognizing' ? 'Recognizing text' : 'Writing text layer';
}

/** Build the running OCR operation: indeterminate, "Recognizing page 1 of N".
 *  OCR opens no output file and carries no reversible transaction, so on
 *  completion it can truly offer only `view-details` (the suspects panel). */
export function activityFromOcrStart(input: OcrStartInput): ActivityOperation {
  const capability = capabilityFor('ocr');
  const queued = createOperation({
    id: input.operationId,
    document: identityFrom(input),
    task: { name: OCR_TASK_NAME, scope: input.displayName },
    completionActions: capability.completionActions,
    cancelable: capability.cancelable,
  });
  return startOperation(queued, `Recognizing page 1 of ${input.pageCount}`);
}

/** Translate one OCR progress event into determinate pages progress. The
 *  phase label is carried as `phaseText` so it surfaces whenever the model
 *  falls back to indeterminate (an unknown page total); the determinate case
 *  is exactly `{ done: page, total: totalPages, unit: 'pages' }`. */
export function applyOcrProgress(
  op: ActivityOperation,
  progress: OcrProgress,
): ActivityOperation {
  return updateProgress(
    op,
    makeProgress({
      done: progress.page,
      total: progress.totalPages,
      unit: 'pages',
      phaseText: ocrPhaseLabel(progress.phase),
    }),
  );
}

// ---------------------------------------------------------------------------
// Thin action builders the App dispatches. Keeping the OCR -> action mapping
// here lets the App stay trivial and lets the translation be unit-tested
// without booting App: `ocrStartAction` captures the identity at start time,
// and `ocrProgressAction` turns one engine progress event into determinate
// pages progress (never a percentage and never an ETA).
// ---------------------------------------------------------------------------

/** The `begin` action for a freshly started OCR run. The operation carries the
 *  caller-captured identity and starts `running`. */
export function ocrStartAction(input: OcrStartInput): ActivityShelfAction {
  return { type: 'begin', operation: activityFromOcrStart(input) };
}

/** The `progress` action for one OCR progress event. Determinate from the real
 *  page total (`done`/`total`/`pages`) with the phase carried as `phaseText`. */
export function ocrProgressAction(
  id: string,
  progress: OcrProgress,
): ActivityShelfAction {
  return {
    type: 'progress',
    id,
    progress: makeProgress({
      done: progress.page,
      total: progress.totalPages,
      unit: 'pages',
      phaseText: ocrPhaseLabel(progress.phase),
    }),
  };
}

export interface ConvertStartInput extends ActivityProducerInput {}

/** Build the running conversion operation: indeterminate phase text. On
 *  completion the converted document is opened in a tab, so `open-result` is a
 *  real action; there is no confirmed saved path (no `show-in-folder`) and no
 *  reversible transaction (no `undo`). */
export function activityFromConvertStart(
  input: ConvertStartInput,
  phase: string,
): ActivityOperation {
  const capability = capabilityFor('convert');
  const queued = createOperation({
    id: input.operationId,
    document: identityFrom(input),
    task: { name: CONVERT_TASK_NAME, scope: input.displayName },
    completionActions: capability.completionActions,
    cancelable: capability.cancelable,
  });
  return startOperation(queued, phase);
}

/** Translate one conversion progress event. Always indeterminate: `ratio`
 *  (0..1) is NOT a known total, so it is never turned into a total or a
 *  percentage. */
export function applyConvertProgress(
  op: ActivityOperation,
  progress: ConvertProgress,
): ActivityOperation {
  return updateProgress(op, { kind: 'indeterminate', phaseText: progress.phase });
}

// ---------------------------------------------------------------------------
// Thin action builders the App dispatches for a conversion (mirrors the OCR
// pair above). `convertStartAction` captures the identity at start time;
// `convertProgressAction` turns one engine progress event into an indeterminate
// phase label (never a percentage and never an ETA - a convert `ratio` is not a
// known total).
// ---------------------------------------------------------------------------

/** The `begin` action for a freshly started conversion run. The operation
 *  carries the caller-captured identity and starts `running` with the phase. */
export function convertStartAction(
  input: ConvertStartInput,
  phase: string,
): ActivityShelfAction {
  return { type: 'begin', operation: activityFromConvertStart(input, phase) };
}

/** The `progress` action for one conversion progress event. Always
 *  indeterminate: the `ratio` (0..1) is not a known total, so it is discarded
 *  and never turned into a total or a percentage. */
export function convertProgressAction(
  id: string,
  progress: ConvertProgress,
): ActivityShelfAction {
  return {
    type: 'progress',
    id,
    progress: makeProgress({ phaseText: progress.phase }),
  };
}

// ---------------------------------------------------------------------------
// Search-index producer (TFL-1216, chunk C5b). DocumentView's background
// page-index build - previously visible only through diagnostics - is the
// third real shelf producer. It reports a REAL page total (`built`/`total`), so
// progress is determinate `pages`; it opens no output file and has NO
// cancellation channel, so it declares no completion actions and the shelf
// renders neither completion buttons nor an inert Cancel.
// ---------------------------------------------------------------------------

export const SEARCH_INDEX_TASK_NAME = 'Index for search';

/** What `built` counts: DocumentView increments it once per indexed PAGE and
 *  `total` is the page count, so the truthful unit is pages. */
export const SEARCH_INDEX_UNIT = 'pages';

/** Build the running search-index operation: determinate `pages` progress from
 *  the known total, or indeterminate when the total is unknown/non-positive
 *  (`makeProgress` decides). It declares no completion actions: there is no
 *  result to open and no reversible transaction. */
export function activityFromSearchIndexStart(
  input: ActivityProducerInput,
  total: number,
): ActivityOperation {
  const capability = capabilityFor('search-index');
  const queued = createOperation({
    id: input.operationId,
    document: identityFrom(input),
    task: { name: SEARCH_INDEX_TASK_NAME, scope: input.displayName },
    completionActions: capability.completionActions,
    cancelable: capability.cancelable,
  });
  return updateProgress(
    startOperation(queued, 'Indexing'),
    makeProgress({ done: 0, total, unit: SEARCH_INDEX_UNIT }),
  );
}

/** The `begin` action for a freshly observed search-index build. The operation
 *  carries the caller-captured identity, starts running with determinate
 *  `pages` progress, and offers no completion actions. */
export function searchIndexStartAction(
  input: ActivityProducerInput,
  total: number,
): ActivityShelfAction {
  return { type: 'begin', operation: activityFromSearchIndexStart(input, total) };
}

/** The `progress` action for one index snapshot. Determinate from the real page
 *  total (`done`/`total`/`pages`); `makeProgress` falls back to indeterminate
 *  when the total is unknown, so a total is never fabricated. */
export function searchIndexProgressAction(
  id: string,
  progress: SearchIndexProgress,
): ActivityShelfAction {
  return {
    type: 'progress',
    id,
    progress: makeProgress({
      done: progress.built,
      total: progress.total,
      unit: SEARCH_INDEX_UNIT,
    }),
  };
}

// ---------------------------------------------------------------------------
// Update producer (TFL-1216, chunk C7). The live app-updater is the fourth real
// shelf producer. It is NOT document-scoped: the identity is the application
// itself, and there is at most ONE update operation per app lifetime, so its id
// is a stable constant - every transition targets the same row.
//
// The shelf mirrors state/notice only. It carries NO percentage: the updater's
// `downloading.progress` (0..100) belongs to the Top Bar badge, which owns the
// Download / Install action surface (see the TFL-856/857/903 seam). The update
// capability declares `cancelable: false` and no completion actions, so the row
// never renders a Cancel or a completion button; the badge owns "Restart to
// update".
// ---------------------------------------------------------------------------

export const UPDATE_TASK_NAME = 'Update';

/** Stable operation id for the single app-update lifecycle. */
export const UPDATE_OPERATION_ID = 'tflex-update';

/** Scope label shown beside the task name: the application, not a document. */
export const UPDATE_SCOPE = 'TFlex';

export const UPDATE_AVAILABLE_PHASE = 'Update available';
export const UPDATE_DOWNLOADING_PHASE = 'Downloading update';

/** The application identity the update operation is bound to. `path` is null
 *  (there is no file) and the id is the stable operation id so it can never
 *  collide with a document-scoped operation. */
function updateIdentity(): ActivityDocumentIdentity {
  return {
    docId: UPDATE_OPERATION_ID,
    tabId: UPDATE_OPERATION_ID,
    path: null,
    displayName: UPDATE_SCOPE,
  };
}

/** Build the running update operation: indeterminate phase text, no cancel
 *  channel and no completion actions (both come from `capabilityFor('update')`). */
export function activityFromUpdateStart(phaseText: string): ActivityOperation {
  const capability = capabilityFor('update');
  const queued = createOperation({
    id: UPDATE_OPERATION_ID,
    document: updateIdentity(),
    task: { name: UPDATE_TASK_NAME, scope: UPDATE_SCOPE },
    completionActions: capability.completionActions,
    cancelable: capability.cancelable,
  });
  return startOperation(queued, phaseText);
}

/** Begin the update row when none exists, otherwise refresh its indeterminate
 *  phase text on the SAME operation. Never emits a total or a percentage.
 *
 *  DEF-653 — a TERMINAL row cannot be resurrected by a `progress`/`complete`
 *  dispatch (the C1 reducer ignores transitions on a terminal operation), so a
 *  fresh `available`/`downloading` cycle after a terminal state must start a
 *  NEW row. This returns `begin` in that case; the App drops the stale terminal
 *  row before dispatching it, so at most one update row ever exists. */
function runningUpdateAction(
  current: ActivityOperation | undefined,
  phaseText: string,
): ActivityShelfAction {
  if (current === undefined || isTerminal(current.state)) {
    return { type: 'begin', operation: activityFromUpdateStart(phaseText) };
  }
  return {
    type: 'progress',
    id: UPDATE_OPERATION_ID,
    progress: makeProgress({ phaseText }),
  };
}

/**
 * Map one live `UpdateState` onto a single Activity Shelf action (TFL-1216 C7).
 *
 * Pure: `current` is the update operation already on the shelf (or undefined),
 * `next` is the live updater state (null when the state clears). Returns the
 * action to dispatch, or null when nothing should change.
 *
 *   - `available`   -> begin (or keep) a running op, "Update available"
 *   - `downloading` -> begin (or keep) a running op, "Downloading update".
 *                      The updater's `progress` (a percentage) is deliberately
 *                      IGNORED - the shelf has no percentage.
 *   - `downloaded`  -> complete (no completion buttons; the badge owns restart)
 *   - `error`       -> fail, item "Update", reason `next.message`
 *   - `checking` / `up-to-date` / `unsupported` / null -> remove the row when it
 *                      exists, otherwise no operation
 *
 *  DEF-653 — when `current` is TERMINAL, `available`/`downloading` return a
 *  fresh `begin` (not a `progress`), so the caller can discard the stale row and
 *  start a new lifecycle instead of leaving the row stuck in its terminal state.
 */
export function updateStateAction(
  current: ActivityOperation | undefined,
  next: UpdateState | null,
): ActivityShelfAction | null {
  switch (next?.kind) {
    case 'available':
      return runningUpdateAction(current, UPDATE_AVAILABLE_PHASE);
    case 'downloading':
      return runningUpdateAction(current, UPDATE_DOWNLOADING_PHASE);
    case 'downloaded':
      return { type: 'complete', id: UPDATE_OPERATION_ID };
    case 'error':
      return {
        type: 'fail',
        id: UPDATE_OPERATION_ID,
        failure: { item: UPDATE_TASK_NAME, reason: next.message },
      };
    case 'checking':
    case 'up-to-date':
    case 'unsupported':
      return current === undefined ? null : { type: 'remove', id: UPDATE_OPERATION_ID };
    default:
      return current === undefined ? null : { type: 'remove', id: UPDATE_OPERATION_ID };
  }
}