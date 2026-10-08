// Activity Shelf operation-state model (TFL-1216, chunk C1).
//
// Truthfulness invariants this module enforces. Later Activity Shelf chunks
// consume this model as the single source of truth for feedback and progress:
//
//   1. A cancellation REQUEST and a CONFIRMED cancellation are different
//      states. `cancellation-requested` is set the moment the user asks to
//      cancel; only the engine's own confirmation moves it to `cancelled`.
//      A request must never render as `cancelled` before that confirmation.
//   2. An operation is in exactly one state at a time. `running` and
//      `completed` can never both be true; once terminal, an operation never
//      returns to running (late or duplicate progress events are ignored).
//   3. `partial-success` always carries the explicit list of failed items; an
//      empty failed list is a plain `completed`.
//   4. Progress is either determinate with a known total (done/total/unit) or
//      indeterminate with a phase label. There is NO percentage field and NO
//      ETA anywhere in this model.
//   5. Document context is captured at creation and never re-derived from the
//      "active tab": an operation stays attached to the ORIGINAL document.
//   6. `undo` is offered only when the operation carries a reversible
//      transaction id; otherwise it is unavailable.
//
// Pure TypeScript + pure functions only: no React, no IPC, no engine calls.

import { toTruthfulProgress } from '../../shared/activity';
import type {
  ActivityCompletionAction,
  TruthfulProgress as ActivityProgress,
} from '../../shared/activity';

export type { ActivityCompletionAction } from '../../shared/activity';
export type { TruthfulProgress as ActivityProgress } from '../../shared/activity';

export type ActivityOperationId = string;

/** Identity of the document an operation belongs to, captured when the
 *  operation is created and never recomputed from the active tab. */
export interface ActivityDocumentIdentity {
  /** Engine document id the operation was started for. */
  readonly docId: string;
  /** Tab id that hosted the document when the operation was created. */
  readonly tabId: string;
  /** Absolute file path, or null for a never-saved document. */
  readonly path: string | null;
  /** User-facing name (filename or untitled label) at creation time. */
  readonly displayName: string;
}

/** Task name plus the scope/filename the task acted on. */
export interface ActivityTask {
  readonly name: string;
  readonly scope: string;
}

/** One failed item inside a partial-success result. */
export interface ActivityFailure {
  readonly item: string;
  readonly reason: string;
}

/** The seven distinct operation states. */
export type ActivityOperationState =
  | { readonly kind: 'queued' }
  | { readonly kind: 'running'; readonly progress: ActivityProgress }
  | {
      readonly kind: 'cancellation-requested';
      readonly progress: ActivityProgress;
    }
  | { readonly kind: 'cancelled' }
  | { readonly kind: 'completed' }
  | {
      readonly kind: 'partial-success';
      readonly failed: readonly ActivityFailure[];
    }
  | { readonly kind: 'failed'; readonly failure: ActivityFailure };

/** One Activity Shelf operation. */
export interface ActivityOperation {
  /** Stable operation id, unique for the lifetime of the operation. */
  readonly id: ActivityOperationId;
  /** Original document the operation belongs to (never "the active tab"). */
  readonly document: ActivityDocumentIdentity;
  readonly task: ActivityTask;
  readonly state: ActivityOperationState;
  /** Reversible transaction id; the ONLY thing that makes `undo` available. */
  readonly transactionId: string | null;
  /** The actions this operation can truly offer on completion. This is the
   *  single source of capability truth: `availableCompletionActions` never adds
   *  an action the operation did not declare here. */
  readonly completionActions: readonly ActivityCompletionAction[];
  /** Whether a real cancellation channel exists for this operation. The single
   *  source of cancel truth: an operation without a channel never renders an
   *  inert Cancel (mirrors `completionActions`). Defaults to false. */
  readonly cancelable: boolean;
}

/**
 * Build progress. Determinate progress is built ONLY when `total` is a finite
 * number greater than zero; an unknown or non-positive total (or a
 * non-finite `done`) yields indeterminate progress instead. Never produces a
 * percentage. `done` is clamped into [0, total] so a stray over-count cannot
 * misrepresent the bar.
 */
export function makeProgress(input: {
  done?: number;
  total?: number;
  unit?: string;
  phaseText?: string;
}): ActivityProgress {
  return toTruthfulProgress(input);
}

/** Create a queued operation bound to its original document. The operation
 *  declares the completion actions it can truly offer (omitted means none) and
 *  whether it has a real cancellation channel (omitted means none). */
export function createOperation(input: {
  id: ActivityOperationId;
  document: ActivityDocumentIdentity;
  task: ActivityTask;
  completionActions?: readonly ActivityCompletionAction[];
  cancelable?: boolean;
}): ActivityOperation {
  return {
    id: input.id,
    document: input.document,
    task: input.task,
    state: { kind: 'queued' },
    transactionId: null,
    completionActions: input.completionActions ?? [],
    cancelable: input.cancelable ?? false,
  };
}

/** queued -> running. Any other state is unchanged. */
export function startOperation(
  op: ActivityOperation,
  phaseText = 'Working',
): ActivityOperation {
  if (op.state.kind !== 'queued') return op;
  return { ...op, state: { kind: 'running', progress: makeProgress({ phaseText }) } };
}

/** Refresh progress while running or awaiting cancellation confirmation. A
 *  terminal operation ignores late progress events. */
export function updateProgress(
  op: ActivityOperation,
  progress: ActivityProgress,
): ActivityOperation {
  if (op.state.kind === 'running' || op.state.kind === 'cancellation-requested') {
    return { ...op, state: { kind: op.state.kind, progress } };
  }
  return op;
}

/** running -> cancellation-requested. This is a REQUEST only; it never moves
 *  the operation to `cancelled`. */
export function requestCancellation(op: ActivityOperation): ActivityOperation {
  if (op.state.kind !== 'running') return op;
  return {
    ...op,
    state: { kind: 'cancellation-requested', progress: op.state.progress },
  };
}

/** Apply the ENGINE's confirmation. Only a cancellation-requested operation
 *  becomes `cancelled`; confirmation without a pending request is ignored. */
export function confirmCancellation(op: ActivityOperation): ActivityOperation {
  if (op.state.kind !== 'cancellation-requested') return op;
  return { ...op, state: { kind: 'cancelled' } };
}

/** Move any non-terminal operation to `completed`. Terminal operations are
 *  unchanged, so an operation can never be both running and completed. */
export function completeOperation(
  op: ActivityOperation,
  transactionId: string | null = null,
): ActivityOperation {
  if (isTerminal(op.state)) return op;
  return { ...op, state: { kind: 'completed' }, transactionId };
}

/** Complete with an explicit failed-item list. An empty list is a plain
 *  `completed`; a non-empty list yields `partial-success` carrying the list. */
export function completePartial(
  op: ActivityOperation,
  failed: readonly ActivityFailure[],
  transactionId: string | null = null,
): ActivityOperation {
  if (isTerminal(op.state)) return op;
  if (failed.length === 0) return completeOperation(op, transactionId);
  return {
    ...op,
    state: { kind: 'partial-success', failed: failed.map((f) => ({ ...f })) },
    transactionId,
  };
}

/** Move any non-terminal operation to `failed`. */
export function failOperation(
  op: ActivityOperation,
  failure: ActivityFailure,
  transactionId: string | null = null,
): ActivityOperation {
  if (isTerminal(op.state)) return op;
  return { ...op, state: { kind: 'failed', failure: { ...failure } }, transactionId };
}

/** The single reducer input union for one operation. */
export type ActivityOperationAction =
  | { readonly type: 'start'; readonly phaseText?: string }
  | { readonly type: 'progress'; readonly progress: ActivityProgress }
  | { readonly type: 'request-cancellation' }
  | { readonly type: 'confirm-cancellation' }
  | { readonly type: 'complete'; readonly transactionId?: string | null }
  | {
      readonly type: 'complete-partial';
      readonly failed: readonly ActivityFailure[];
      readonly transactionId?: string | null;
    }
  | {
      readonly type: 'fail';
      readonly failure: ActivityFailure;
      readonly transactionId?: string | null;
    };

/** Pure reducer over one operation. Enforces every invariant above: only a
 *  confirmed cancellation becomes `cancelled`, terminal operations never
 *  return to running, and `partial-success` always carries its failures. */
export function reduceOperation(
  op: ActivityOperation,
  action: ActivityOperationAction,
): ActivityOperation {
  switch (action.type) {
    case 'start':
      return startOperation(op, action.phaseText);
    case 'progress':
      return updateProgress(op, action.progress);
    case 'request-cancellation':
      return requestCancellation(op);
    case 'confirm-cancellation':
      return confirmCancellation(op);
    case 'complete':
      return completeOperation(op, action.transactionId ?? null);
    case 'complete-partial':
      return completePartial(op, action.failed, action.transactionId ?? null);
    case 'fail':
      return failOperation(op, action.failure, action.transactionId ?? null);
  }
}

export function isTerminal(state: ActivityOperationState): boolean {
  return (
    state.kind === 'cancelled' ||
    state.kind === 'completed' ||
    state.kind === 'partial-success' ||
    state.kind === 'failed'
  );
}

export function isRunning(state: ActivityOperationState): boolean {
  return state.kind === 'running' || state.kind === 'cancellation-requested';
}

/** True for `completed` and `partial-success` only. Never true at the same
 *  time as `isRunning`. */
export function isCompleted(state: ActivityOperationState): boolean {
  return state.kind === 'completed' || state.kind === 'partial-success';
}

/** The explicit failed-item list for a partial-success operation, else null. */
export function failedItems(
  op: ActivityOperation,
): readonly ActivityFailure[] | null {
  return op.state.kind === 'partial-success' ? op.state.failed : null;
}

/** The original document identity, independent of any "active tab". */
export function operationDocument(
  op: ActivityOperation,
): ActivityDocumentIdentity {
  return op.document;
}

/** Completion actions for the operation's current state. On completion the
 *  result is EXACTLY the operation's declared `completionActions`, with `undo`
 *  included only when it is BOTH declared and backed by a reversible
 *  transaction id. No action is ever added that the operation did not declare.
 *  A `failed` operation offers `view-details` (failure details are always
 *  viewable) and nothing else. */
export function availableCompletionActions(
  op: ActivityOperation,
): ActivityCompletionAction[] {
  switch (op.state.kind) {
    case 'completed':
    case 'partial-success':
      return op.completionActions.filter(
        (action) =>
          action !== 'undo' ||
          (op.transactionId !== null && op.transactionId !== ''),
      );
    case 'failed':
      return ['view-details'];
    default:
      return [];
  }
}

/** Operations belonging to one document, keyed by the ORIGINAL document id,
 *  never by whichever tab is currently active. */
export function operationsForDocument(
  ops: readonly ActivityOperation[],
  docId: string,
): ActivityOperation[] {
  return ops.filter((op) => op.document.docId === docId);
}
