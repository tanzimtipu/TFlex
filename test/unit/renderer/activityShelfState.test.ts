// TFL-1216 (chunk C1) — Activity Shelf operation-state foundation.
//
// Pins the truthfulness invariants of `src/renderer/state/activity.ts`:
// unknown totals never become determinate progress, a cancel REQUEST stays
// distinct from a confirmed cancellation, an operation cannot be running and
// completed at once, partial-success carries its failed items, undo is gated
// on a reversible transaction id, and document identity is retained
// independently of the active document.
import { describe, expect, it } from 'vitest';
import {
  availableCompletionActions,
  completeOperation,
  completePartial,
  createOperation,
  failedItems,
  isCompleted,
  isRunning,
  isTerminal,
  makeProgress,
  operationDocument,
  operationsForDocument,
  reduceOperation,
  requestCancellation,
  startOperation,
  type ActivityDocumentIdentity,
  type ActivityOperation,
} from '../../../src/renderer/state/activity';

const docA: ActivityDocumentIdentity = {
  docId: 'doc-a',
  tabId: 'tab-1',
  path: 'C:/docs/a.pdf',
  displayName: 'a.pdf',
};

const docB: ActivityDocumentIdentity = {
  docId: 'doc-b',
  tabId: 'tab-2',
  path: 'C:/docs/b.pdf',
  displayName: 'b.pdf',
};

function queued(id = 'op-1'): ActivityOperation {
  return createOperation({
    id,
    document: docA,
    task: { name: 'Import', scope: 'a.pdf' },
  });
}

describe('activityShelf progress model', () => {
  it('(i) unknown or non-positive totals yield indeterminate progress, never a percentage', () => {
    for (const total of [undefined, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const p = makeProgress({ done: 3, total, unit: 'pages', phaseText: 'Scanning' });
      expect(p.kind).toBe('indeterminate');
      if (p.kind === 'indeterminate') expect(p.phaseText).toBe('Scanning');
      const serialized = JSON.stringify(p);
      expect(serialized).not.toContain('percent');
      expect(serialized).not.toContain('ratio');
      expect(serialized).not.toContain('total');
    }
  });

  it('builds determinate progress only with a known positive total and no percentage field', () => {
    const p = makeProgress({ done: 3, total: 10, unit: 'pages' });
    expect(p).toEqual({ kind: 'determinate', done: 3, total: 10, unit: 'pages' });
    expect(Object.keys(p).sort()).toEqual(['done', 'kind', 'total', 'unit']);
    expect(JSON.stringify(p)).not.toContain('percent');
  });

  it('clamps a stray over-count into [0, total]', () => {
    expect(makeProgress({ done: 99, total: 10, unit: 'pages' })).toEqual({
      kind: 'determinate',
      done: 10,
      total: 10,
      unit: 'pages',
    });
    expect(makeProgress({ done: -4, total: 10, unit: 'pages' })).toEqual({
      kind: 'determinate',
      done: 0,
      total: 10,
      unit: 'pages',
    });
  });
});

describe('activityShelf cancellation truthfulness', () => {
  it('(ii) a cancel request stays distinct from cancelled until the engine confirms', () => {
    const running = startOperation(queued());
    expect(running.state.kind).toBe('running');

    const requested = requestCancellation(running);
    expect(requested.state.kind).toBe('cancellation-requested');
    expect(requested.state.kind).not.toBe('cancelled');
    expect(isTerminal(requested.state)).toBe(false);
    expect(isRunning(requested.state)).toBe(true);

    // Late progress while awaiting confirmation keeps the requested state.
    const stillRequested = reduceOperation(requested, {
      type: 'progress',
      progress: makeProgress({ done: 1, total: 4, unit: 'pages' }),
    });
    expect(stillRequested.state.kind).toBe('cancellation-requested');

    // Only the engine confirmation yields `cancelled`.
    const confirmed = reduceOperation(stillRequested, { type: 'confirm-cancellation' });
    expect(confirmed.state.kind).toBe('cancelled');
    expect(isTerminal(confirmed.state)).toBe(true);
    expect(isRunning(confirmed.state)).toBe(false);
  });

  it('confirmation without a pending request never cancels', () => {
    const running = startOperation(queued());
    const unchanged = reduceOperation(running, { type: 'confirm-cancellation' });
    expect(unchanged.state.kind).toBe('running');
  });

  it('start and progress never turn a request into cancelled', () => {
    const requested = requestCancellation(startOperation(queued()));
    const restarted = reduceOperation(requested, { type: 'start', phaseText: 'Again' });
    expect(restarted.state.kind).toBe('cancellation-requested');
  });
});

describe('activityShelf single-state invariant', () => {
  it('(iii) an operation is either running or completed, never both', () => {
    const states = [
      queued().state,
      startOperation(queued()).state,
      requestCancellation(startOperation(queued())).state,
      completeOperation(startOperation(queued())).state,
    ];
    for (const state of states) {
      expect(isRunning(state) && isCompleted(state)).toBe(false);
    }
  });

  it('terminal operations ignore late progress and start events', () => {
    const done = completeOperation(startOperation(queued()));
    expect(isCompleted(done.state)).toBe(true);
    const lateProgress = reduceOperation(done, {
      type: 'progress',
      progress: makeProgress({ done: 9, total: 10, unit: 'pages' }),
    });
    const lateStart = reduceOperation(lateProgress, { type: 'start' });
    expect(lateStart.state.kind).toBe('completed');
    expect(isRunning(lateStart.state)).toBe(false);
    expect(lateStart).toBe(done);
  });
});

describe('activityShelf partial success', () => {
  it('(iv) partial-success exposes the explicit failed-item list', () => {
    const failed = [
      { item: 'page 3', reason: 'blank' },
      { item: 'page 7', reason: 'corrupt' },
    ];
    const partial = completePartial(startOperation(queued()), failed);
    expect(partial.state.kind).toBe('partial-success');
    expect(failedItems(partial)).toEqual(failed);
    expect(isCompleted(partial.state)).toBe(true);
    expect(isRunning(partial.state)).toBe(false);
  });

  it('an empty failed list collapses to a plain completed operation', () => {
    const completed = completePartial(startOperation(queued()), []);
    expect(completed.state.kind).toBe('completed');
    expect(failedItems(completed)).toBeNull();
  });
});

describe('activityShelf completion actions and identity', () => {
  it('(v) a completed operation offers exactly its declared actions', () => {
    const op = createOperation({
      id: 'op-ocr',
      document: docA,
      task: { name: 'Recognize text', scope: 'a.pdf' },
      completionActions: ['view-details'],
    });
    const completed = completeOperation(startOperation(op));
    expect(completed.state.kind).toBe('completed');
    expect(availableCompletionActions(completed)).toEqual(['view-details']);
  });

  it('an operation that declares no completion actions offers none', () => {
    const completed = completeOperation(startOperation(queued()));
    expect(availableCompletionActions(completed)).toEqual([]);
  });

  it('undo is absent when not declared even with a transaction id', () => {
    const op = createOperation({
      id: 'op-open',
      document: docA,
      task: { name: 'Import', scope: 'a.pdf' },
      completionActions: ['open-result'],
    });
    const completed = completeOperation(startOperation(op), 'tx-99');
    expect(availableCompletionActions(completed)).toEqual(['open-result']);
    expect(availableCompletionActions(completed)).not.toContain('undo');
  });

  it('undo is present only when BOTH declared and backed by a transaction id', () => {
    const op = createOperation({
      id: 'op-undo',
      document: docA,
      task: { name: 'Import', scope: 'a.pdf' },
      completionActions: ['open-result', 'view-details', 'undo'],
    });
    const running = startOperation(op);

    const noTx = completeOperation(running);
    expect(availableCompletionActions(noTx)).toEqual(['open-result', 'view-details']);
    expect(availableCompletionActions(noTx)).not.toContain('undo');

    const withTx = completeOperation(running, 'tx-42');
    expect(availableCompletionActions(withTx)).toEqual([
      'open-result',
      'view-details',
      'undo',
    ]);

    const emptyTx = completeOperation(running, '');
    expect(availableCompletionActions(emptyTx)).not.toContain('undo');
  });

  it('a partial-success operation also offers exactly its declared actions', () => {
    const op = createOperation({
      id: 'op-partial',
      document: docA,
      task: { name: 'Import', scope: 'a.pdf' },
      completionActions: ['view-details', 'undo'],
    });
    const partial = completePartial(
      startOperation(op),
      [{ item: 'page 1', reason: 'blank' }],
      'tx-7',
    );
    expect(partial.state.kind).toBe('partial-success');
    expect(availableCompletionActions(partial)).toEqual(['view-details', 'undo']);
    expect(availableCompletionActions(partial)).not.toContain('open-result');
    expect(availableCompletionActions(partial)).not.toContain('show-in-folder');
  });

  it('a failed operation offers only view-details', () => {
    const failed = reduceOperation(startOperation(queued()), {
      type: 'fail',
      failure: { item: 'a.pdf', reason: 'unreadable' },
    });
    expect(failed.state.kind).toBe('failed');
    expect(availableCompletionActions(failed)).toEqual(['view-details']);
  });

  it('(vi) document identity is retained independently of the active document', () => {
    const opA = createOperation({
      id: 'op-a',
      document: docA,
      task: { name: 'Run OCR', scope: 'a.pdf' },
    });
    const opB = createOperation({
      id: 'op-b',
      document: docB,
      task: { name: 'Run OCR', scope: 'b.pdf' },
    });
    const ops = [opA, opB];

    // The operation reports its ORIGINAL document, whatever is active now.
    expect(operationDocument(opA)).toEqual(docA);
    expect(isRunning(opA.state)).toBe(false);
    const movedOn = completeOperation(startOperation(opA), 'tx-9');
    expect(movedOn.document).toEqual(docA);
    expect(movedOn.document.tabId).toBe('tab-1');

    const activeDocId = 'doc-b';
    expect(operationsForDocument(ops, 'doc-a')).toEqual([opA]);
    expect(operationsForDocument(ops, activeDocId)).toEqual([opB]);
    expect(opA.document.docId).toBe('doc-a');
  });
});

