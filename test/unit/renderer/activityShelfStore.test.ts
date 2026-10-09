// TFL-1216 (chunk C3) - Activity Shelf store + producer adapters.
//
// Pins the store contract: begin starts a queued operation, late progress on a
// terminal operation never resurrects it, a cancel REQUEST stays distinct from
// a confirmed cancellation, acknowledgment lives only in this store, and the
// OCR/convert adapters translate producer events truthfully (OCR determinate
// pages, conversion indeterminate phase text - never a fabricated total).
import { describe, expect, it } from 'vitest';
import {
  activityFromConvertStart,
  activityFromOcrStart,
  activityFromSearchIndexStart,
  applyConvertProgress,
  applyOcrProgress,
  convertProgressAction,
  convertStartAction,
  initialActivityShelfState,
  ocrProgressAction,
  ocrStartAction,
  reduceActivityShelf,
  searchIndexProgressAction,
  searchIndexStartAction,
  selectActiveOperations,
  selectActivitySummary,
  selectVisibleNotices,
  SUCCESS_NOTICE_AUTO_DISMISS_MS,
  terminalAlertFor,
  UPDATE_OPERATION_ID,
  UPDATE_TASK_NAME,
  updateStateAction,
  type ActivityShelfAction,
  type ActivityShelfState,
} from '../../../src/renderer/state/activityShelf';
import {
  availableCompletionActions,
  completeOperation,
  createOperation,
  type ActivityDocumentIdentity,
  type ActivityOperation,
} from '../../../src/renderer/state/activity';
import type { UpdateState } from '../../../src/shared/types';

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

function queuedOp(id: string, document: ActivityDocumentIdentity = docA): ActivityOperation {
  return createOperation({
    id,
    document,
    task: { name: 'Import', scope: document.displayName },
  });
}

function run(state: ActivityShelfState, ...actions: ActivityShelfAction[]): ActivityShelfState {
  return actions.reduce(reduceActivityShelf, state);
}

const beginOp = (id: string, document: ActivityDocumentIdentity = docA): ActivityShelfAction => ({
  type: 'begin',
  operation: queuedOp(id, document),
});

describe('reduceActivityShelf', () => {
  it('begin creates a queued operation and starts it running', () => {
    const state = run(initialActivityShelfState, beginOp('op-1'));
    expect(state.operations).toHaveLength(1);
    expect(state.operations[0]?.state.kind).toBe('running');
  });

  it('ignores progress on a terminal operation (no resurrect)', () => {
    const state = run(
      initialActivityShelfState,
      beginOp('op-1'),
      { type: 'complete', id: 'op-1', atMs: 1_000 },
      { type: 'progress', id: 'op-1', progress: { kind: 'indeterminate', phaseText: 'late' } },
    );
    expect(state.operations[0]?.state.kind).toBe('completed');
  });

  it('request-cancel gives cancellation-requested, confirm-cancel only then gives cancelled', () => {
    const requested = run(
      initialActivityShelfState,
      beginOp('op-1'),
      { type: 'request-cancel', id: 'op-1' },
    );
    expect(requested.operations[0]?.state.kind).toBe('cancellation-requested');

    const confirmed = reduceActivityShelf(requested, { type: 'confirm-cancel', id: 'op-1' });
    expect(confirmed.operations[0]?.state.kind).toBe('cancelled');
  });

  it('confirm-cancel without a pending request is ignored', () => {
    const state = run(
      initialActivityShelfState,
      beginOp('op-1'),
      { type: 'confirm-cancel', id: 'op-1' },
    );
    expect(state.operations[0]?.state.kind).toBe('running');
  });

  it('rejects complete after the operation is terminal (one terminal state)', () => {
    const cancelled = run(
      initialActivityShelfState,
      beginOp('op-1'),
      { type: 'request-cancel', id: 'op-1' },
      { type: 'confirm-cancel', id: 'op-1' },
    );
    const after = reduceActivityShelf(cancelled, { type: 'complete', id: 'op-1' });
    expect(after.operations[0]?.state.kind).toBe('cancelled');
  });

  it('remove drops the operation and its acknowledgment', () => {
    const state = run(
      initialActivityShelfState,
      beginOp('op-1'),
      { type: 'complete', id: 'op-1', atMs: 1_000 },
      { type: 'acknowledge', id: 'op-1' },
      { type: 'remove', id: 'op-1' },
    );
    expect(state.operations).toHaveLength(0);
    expect(state.acknowledged).not.toContain('op-1');
  });
});

describe('selectVisibleNotices', () => {
  function completedAt(atMs: number): ActivityShelfState {
    return run(
      initialActivityShelfState,
      beginOp('op-1'),
      { type: 'complete', id: 'op-1', atMs },
    );
  }

  it('hides an acknowledged notice', () => {
    const state = run(completedAt(1_000), { type: 'acknowledge', id: 'op-1' });
    expect(selectVisibleNotices(state, 1_000)).toHaveLength(0);
  });

  it('keeps a completed notice before the interval and auto-hides it past it', () => {
    const state = completedAt(1_000);
    expect(selectVisibleNotices(state, 1_000 + SUCCESS_NOTICE_AUTO_DISMISS_MS - 1)).toHaveLength(1);
    expect(selectVisibleNotices(state, 1_000 + SUCCESS_NOTICE_AUTO_DISMISS_MS)).toHaveLength(0);
  });

  it('excludes a failed notice entirely (it lives in the canvas alert now)', () => {
    const state = run(
      initialActivityShelfState,
      beginOp('op-1'),
      { type: 'fail', id: 'op-1', failure: { item: 'a.pdf', reason: 'decode failed' }, atMs: 1_000 },
    );
    expect(selectVisibleNotices(state, 1_000)).toHaveLength(0);
    expect(selectVisibleNotices(state, 1_000_000)).toHaveLength(0);
  });

  it('excludes a partial-success notice entirely (it lives in the canvas alert now)', () => {
    const state = run(
      initialActivityShelfState,
      beginOp('op-1'),
      {
        type: 'complete-partial',
        id: 'op-1',
        failed: [{ item: 'page 3', reason: 'blank' }],
        atMs: 1_000,
      },
    );
    expect(selectVisibleNotices(state, 1_000)).toHaveLength(0);
    expect(selectVisibleNotices(state, 1_000_000)).toHaveLength(0);
  });
});

describe('terminalAlertFor', () => {
  it('maps a failed operation to an error alert carrying the failure reason', () => {
    const state = run(
      initialActivityShelfState,
      beginOp('op-1'),
      { type: 'fail', id: 'op-1', failure: { item: 'a.pdf', reason: 'decode failed' } },
    );
    expect(terminalAlertFor(state.operations[0]!)).toEqual({
      kind: 'error',
      text: 'decode failed',
    });
  });

  it('maps a partial-success operation to the completed-with-N-issues warning', () => {
    const state = run(
      initialActivityShelfState,
      beginOp('op-1'),
      {
        type: 'complete-partial',
        id: 'op-1',
        failed: [
          { item: 'page 3', reason: 'blank' },
          { item: 'page 7', reason: 'corrupt' },
        ],
      },
    );
    expect(terminalAlertFor(state.operations[0]!)).toEqual({
      kind: 'warning',
      text: 'Import: completed with 2 issues (page 3: blank; page 7: corrupt)',
    });
  });

  it('uses the singular "issue" for a single failed item', () => {
    const state = run(
      initialActivityShelfState,
      beginOp('op-1'),
      {
        type: 'complete-partial',
        id: 'op-1',
        failed: [{ item: 'page 3', reason: 'blank' }],
      },
    );
    expect(terminalAlertFor(state.operations[0]!)).toEqual({
      kind: 'warning',
      text: 'Import: completed with 1 issue (page 3: blank)',
    });
  });

  it('returns null for running, completed and cancelled operations', () => {
    const running = run(initialActivityShelfState, beginOp('op-1'));
    expect(terminalAlertFor(running.operations[0]!)).toBeNull();

    const completed = run(initialActivityShelfState, beginOp('op-1'), {
      type: 'complete',
      id: 'op-1',
    });
    expect(terminalAlertFor(completed.operations[0]!)).toBeNull();

    const cancelled = run(
      initialActivityShelfState,
      beginOp('op-1'),
      { type: 'request-cancel', id: 'op-1' },
      { type: 'confirm-cancel', id: 'op-1' },
    );
    expect(terminalAlertFor(cancelled.operations[0]!)).toBeNull();
  });
});

describe('selectActiveOperations and selectActivitySummary', () => {
  it('excludes terminal operations and reports the active count', () => {
    const state = run(
      initialActivityShelfState,
      beginOp('op-1'),
      beginOp('op-2', docB),
      { type: 'complete', id: 'op-1', atMs: 1_000 },
    );
    const active = selectActiveOperations(state);
    expect(active.map((op) => op.id)).toEqual(['op-2']);
    expect(selectActivitySummary(state).activeCount).toBe(1);
    expect(selectActivitySummary(state).active?.id).toBe('op-2');
  });
});

describe('producer adapters', () => {
  it('activityFromOcrStart starts running with indeterminate page text', () => {
    const op = activityFromOcrStart({
      operationId: 'ocr-1',
      docId: 'doc-a',
      tabId: 'tab-1',
      path: 'C:/docs/a.pdf',
      displayName: 'a.pdf',
      pageCount: 12,
    });
    expect(op.state.kind).toBe('running');
    if (op.state.kind === 'running' && op.state.progress.kind === 'indeterminate') {
      expect(op.state.progress.phaseText).toBe('Recognizing page 1 of 12');
    } else {
      throw new Error('expected indeterminate OCR start progress');
    }
  });

  it('applyOcrProgress yields determinate pages progress', () => {
    const op = activityFromOcrStart({
      operationId: 'ocr-1',
      docId: 'doc-a',
      tabId: 'tab-1',
      path: null,
      displayName: 'a.pdf',
      pageCount: 12,
    });
    const updated = applyOcrProgress(op, {
      docId: 'doc-a',
      page: 4,
      totalPages: 12,
      phase: 'recognizing',
    });
    if (updated.state.kind !== 'running' || updated.state.progress.kind !== 'determinate') {
      throw new Error('expected determinate OCR progress');
    }
    expect(updated.state.progress).toEqual({
      kind: 'determinate',
      done: 4,
      total: 12,
      unit: 'pages',
    });
  });

  it('applyConvertProgress is always indeterminate with the phase text and no fabricated total', () => {
    const op = activityFromConvertStart(
      {
        operationId: 'cv-1',
        docId: 'doc-a',
        tabId: 'tab-1',
        path: 'C:/docs/a.docx',
        displayName: 'a.docx',
      },
      'Reading document',
    );
    const updated = applyConvertProgress(op, { jobId: 'doc-a', phase: 'Converting', ratio: 0.42 });
    if (updated.state.kind !== 'running' || updated.state.progress.kind !== 'indeterminate') {
      throw new Error('expected indeterminate convert progress');
    }
    expect(updated.state.progress.phaseText).toBe('Converting');
    const serialized = JSON.stringify(updated.state.progress);
    expect(serialized).not.toContain('total');
    expect(serialized).not.toContain('percent');
    expect(serialized).not.toContain('%');
  });

  it('keeps each operation bound to the document it was created for', () => {
    const state = run(
      initialActivityShelfState,
      beginOp('op-a', docA),
      beginOp('op-b', docB),
    );
    const opA = state.operations.find((op) => op.id === 'op-a');
    const opB = state.operations.find((op) => op.id === 'op-b');
    expect(opA?.document.docId).toBe('doc-a');
    expect(opA?.document.tabId).toBe('tab-1');
    expect(opB?.document.docId).toBe('doc-b');
  });

  it('OCR declares only view-details and carries it through completion', () => {
    const op = activityFromOcrStart({
      operationId: 'ocr-1',
      docId: 'doc-a',
      tabId: 'tab-1',
      path: null,
      displayName: 'a.pdf',
      pageCount: 12,
    });
    expect(op.completionActions).toEqual(['view-details']);
    expect(op.cancelable).toBe(true);
    expect(availableCompletionActions(completeOperation(op))).toEqual(['view-details']);
  });

  it('convert declares open-result and view-details, never show-in-folder or undo', () => {
    const op = activityFromConvertStart(
      {
        operationId: 'cv-1',
        docId: 'doc-a',
        tabId: 'tab-1',
        path: 'C:/docs/a.docx',
        displayName: 'a.docx',
      },
      'Reading document',
    );
    expect(op.completionActions).toEqual(['open-result', 'view-details']);
    expect(op.cancelable).toBe(true);
    const actions = availableCompletionActions(completeOperation(op));
    expect(actions).toEqual(['open-result', 'view-details']);
    expect(actions).not.toContain('show-in-folder');
    expect(actions).not.toContain('undo');
  });

  it('carries the declared completion actions unchanged through progress', () => {
    const op = activityFromOcrStart({
      operationId: 'ocr-1',
      docId: 'doc-a',
      tabId: 'tab-1',
      path: null,
      displayName: 'a.pdf',
      pageCount: 12,
    });
    const progressed = applyOcrProgress(op, {
      docId: 'doc-a',
      page: 3,
      totalPages: 12,
      phase: 'recognizing',
    });
    expect(progressed.completionActions).toEqual(['view-details']);
  });
});

describe('app action builders', () => {
  it('ocrStartAction yields a begin whose operation is running with the captured identity', () => {
    const action = ocrStartAction({
      operationId: 'ocr-1',
      docId: 'doc-a',
      tabId: 'tab-1',
      path: 'C:/docs/a.pdf',
      displayName: 'a.pdf',
      pageCount: 12,
    });
    expect(action.type).toBe('begin');
    if (action.type !== 'begin') throw new Error('expected a begin action');
    expect(action.operation.state.kind).toBe('running');
    expect(action.operation.document).toEqual({
      docId: 'doc-a',
      tabId: 'tab-1',
      path: 'C:/docs/a.pdf',
      displayName: 'a.pdf',
    });
    const state = reduceActivityShelf(initialActivityShelfState, action);
    expect(state.operations[0]?.state.kind).toBe('running');
    expect(state.operations[0]?.document.docId).toBe('doc-a');
  });

  it('ocrProgressAction yields determinate pages progress with no percentage or ETA', () => {
    const action = ocrProgressAction('ocr-1', {
      docId: 'doc-a',
      page: 4,
      totalPages: 12,
      phase: 'recognizing',
    });
    expect(action.type).toBe('progress');
    if (action.type !== 'progress') throw new Error('expected a progress action');
    expect(action.progress).toEqual({
      kind: 'determinate',
      done: 4,
      total: 12,
      unit: 'pages',
    });
    const serialized = JSON.stringify(action);
    expect(serialized).not.toContain('%');
    expect(serialized).not.toContain('percent');
    expect(serialized).not.toMatch(/ETA|estimates?/i);
  });

  it('convertStartAction yields a begin whose operation is running and indeterminate', () => {
    const action = convertStartAction(
      {
        operationId: 'cv-1',
        docId: 'doc-a',
        tabId: 'tab-1',
        path: 'C:/docs/a.docx',
        displayName: 'a.docx',
      },
      'Preparing',
    );
    expect(action.type).toBe('begin');
    if (action.type !== 'begin') throw new Error('expected a begin action');
    expect(action.operation.state.kind).toBe('running');
    if (
      action.operation.state.kind === 'running' &&
      action.operation.state.progress.kind === 'indeterminate'
    ) {
      expect(action.operation.state.progress.phaseText).toBe('Preparing');
    } else {
      throw new Error('expected indeterminate convert start progress');
    }
    expect(action.operation.document).toEqual({
      docId: 'doc-a',
      tabId: 'tab-1',
      path: 'C:/docs/a.docx',
      displayName: 'a.docx',
    });
    expect(action.operation.completionActions).toEqual(['open-result', 'view-details']);
    const state = reduceActivityShelf(initialActivityShelfState, action);
    expect(state.operations[0]?.state.kind).toBe('running');
  });

  it('convertProgressAction yields indeterminate phase text with no total or percent', () => {
    const action = convertProgressAction('cv-1', {
      jobId: 'doc-a',
      phase: 'Converting',
      ratio: 0.42,
    });
    expect(action.type).toBe('progress');
    if (action.type !== 'progress') throw new Error('expected a progress action');
    expect(action.progress.kind).toBe('indeterminate');
    if (action.progress.kind !== 'indeterminate') {
      throw new Error('expected indeterminate convert progress');
    }
    expect(action.progress.phaseText).toBe('Converting');
    const serialized = JSON.stringify(action);
    expect(serialized).not.toContain('total');
    expect(serialized).not.toContain('percent');
    expect(serialized).not.toContain('%');
    expect(serialized).not.toContain('0.42');
  });
});

describe('store completion-action capability', () => {
  function beginWith(
    id: string,
    completionActions: readonly ('open-result' | 'show-in-folder' | 'view-details' | 'undo')[],
    document: ActivityDocumentIdentity = docA,
  ): ActivityOperation {
    return createOperation({
      id,
      document,
      task: { name: 'Import', scope: document.displayName },
      completionActions,
    });
  }

  it('a completed operation offers exactly the actions it declared', () => {
    const state = run(
      initialActivityShelfState,
      { type: 'begin', operation: beginWith('op-1', ['view-details']) },
      { type: 'complete', id: 'op-1', atMs: 1_000 },
    );
    expect(availableCompletionActions(state.operations[0]!)).toEqual(['view-details']);
  });

  it('an operation that declared no completion actions offers none', () => {
    const state = run(
      initialActivityShelfState,
      { type: 'begin', operation: queuedOp('op-1') },
      { type: 'complete', id: 'op-1', atMs: 1_000 },
    );
    expect(availableCompletionActions(state.operations[0]!)).toEqual([]);
  });

  it('undo requires BOTH the declaration and a transaction id', () => {
    const declaredWithTx = run(
      initialActivityShelfState,
      { type: 'begin', operation: beginWith('op-1', ['view-details', 'undo']) },
      { type: 'complete', id: 'op-1', transactionId: 'tx-1', atMs: 1_000 },
    );
    expect(availableCompletionActions(declaredWithTx.operations[0]!)).toEqual([
      'view-details',
      'undo',
    ]);

    const declaredNoTx = run(
      initialActivityShelfState,
      { type: 'begin', operation: beginWith('op-2', ['view-details', 'undo']) },
      { type: 'complete', id: 'op-2', atMs: 1_000 },
    );
    expect(availableCompletionActions(declaredNoTx.operations[0]!)).not.toContain('undo');

    const txNotDeclared = run(
      initialActivityShelfState,
      { type: 'begin', operation: beginWith('op-3', ['open-result']) },
      { type: 'complete', id: 'op-3', transactionId: 'tx-3', atMs: 1_000 },
    );
    expect(availableCompletionActions(txNotDeclared.operations[0]!)).toEqual(['open-result']);
  });

  it('a conversion declares open-result and view-details; both are offered on completion (DEF-652)', () => {
    // DEF-652 — a conversion's completion controls are honourable (the App now
    // activates the result tab and reveals the fidelity card), so the operation
    // keeps BOTH declared actions and offers both once it completes.
    const input = {
      operationId: 'conv-1',
      docId: 'doc-a',
      tabId: 'tab-1',
      path: 'C:/docs/a.txt',
      displayName: 'a.txt',
    };
    const state = run(
      initialActivityShelfState,
      convertStartAction(input, 'Preparing'),
      { type: 'complete', id: 'conv-1', atMs: 1_000 },
    );
    expect(state.operations[0]!.task.name).toBe('Import');
    expect(availableCompletionActions(state.operations[0]!)).toEqual([
      'open-result',
      'view-details',
    ]);
  });
});

describe('search-index producer (TFL-1216 chunk C5b)', () => {
  const input = {
    operationId: 'si-1',
    docId: 'doc-a',
    tabId: 'tab-1',
    path: 'C:/docs/a.pdf',
    displayName: 'a.pdf',
  };

  it('searchIndexStartAction yields a running determinate op with the captured identity and no completion actions', () => {
    const action = searchIndexStartAction(input, 10);
    expect(action.type).toBe('begin');
    if (action.type !== 'begin') throw new Error('expected a begin action');
    if (action.operation.state.kind !== 'running') {
      throw new Error('expected a running search-index op');
    }
    expect(action.operation.state.progress).toEqual({
      kind: 'determinate',
      done: 0,
      total: 10,
      unit: 'pages',
    });
    expect(action.operation.document).toEqual({
      docId: 'doc-a',
      tabId: 'tab-1',
      path: 'C:/docs/a.pdf',
      displayName: 'a.pdf',
    });
    expect(action.operation.completionActions).toEqual([]);
    expect(action.operation.cancelable).toBe(false);
    const state = reduceActivityShelf(initialActivityShelfState, action);
    expect(state.operations[0]?.state.kind).toBe('running');
    expect(state.operations[0]?.document.docId).toBe('doc-a');
  });

  it('searchIndexProgressAction yields determinate pages progress (built 3 of 10)', () => {
    const action = searchIndexProgressAction('si-1', { built: 3, total: 10 });
    expect(action.type).toBe('progress');
    if (action.type !== 'progress') throw new Error('expected a progress action');
    expect(action.progress).toEqual({
      kind: 'determinate',
      done: 3,
      total: 10,
      unit: 'pages',
    });
    const serialized = JSON.stringify(action);
    expect(serialized).not.toContain('%');
    expect(serialized).not.toContain('percent');
    expect(serialized).not.toMatch(/ETA|estimates?/i);
  });

  it('a null settle (the index settled) completes the operation', () => {
    const state = run(
      initialActivityShelfState,
      searchIndexStartAction(input, 10),
      { type: 'complete', id: 'si-1', atMs: 1_000 },
    );
    expect(state.operations[0]?.state.kind).toBe('completed');
    expect(availableCompletionActions(state.operations[0]!)).toEqual([]);
  });
});

describe('per-operation cancel capability (DEF-647)', () => {
  const ocrInput = {
    operationId: 'ocr-1',
    docId: 'doc-a',
    tabId: 'tab-1',
    path: 'C:/docs/a.pdf',
    displayName: 'a.pdf',
    pageCount: 12,
  };
  const convertInput = {
    operationId: 'cv-1',
    docId: 'doc-a',
    tabId: 'tab-1',
    path: 'C:/docs/a.docx',
    displayName: 'a.docx',
  };
  const searchInput = {
    operationId: 'si-1',
    docId: 'doc-a',
    tabId: 'tab-1',
    path: 'C:/docs/a.pdf',
    displayName: 'a.pdf',
  };

  it('declares cancelable true only for OCR and convert, false for search-index', () => {
    expect(activityFromOcrStart(ocrInput).cancelable).toBe(true);
    expect(activityFromConvertStart(convertInput, 'Preparing').cancelable).toBe(true);
    expect(activityFromSearchIndexStart(searchInput, 10).cancelable).toBe(false);
  });

  it('carries the capability unchanged through progress and the store', () => {
    const progressed = applyOcrProgress(activityFromOcrStart(ocrInput), {
      docId: 'doc-a',
      page: 3,
      totalPages: 12,
      phase: 'recognizing',
    });
    expect(progressed.cancelable).toBe(true);

    const state = run(
      initialActivityShelfState,
      searchIndexStartAction(searchInput, 10),
      searchIndexProgressAction('si-1', { built: 3, total: 10 }),
    );
    expect(state.operations[0]?.cancelable).toBe(false);
  });

  it('createOperation defaults cancelable to false and accepts true', () => {
    expect(queuedOp('op-default').cancelable).toBe(false);
    const cancelable = createOperation({
      id: 'op-cancelable',
      document: docA,
      task: { name: 'Import', scope: 'a.pdf' },
      cancelable: true,
    });
    expect(cancelable.cancelable).toBe(true);
  });
});

describe('update producer (TFL-1216 chunk C7)', () => {
  const availableState: UpdateState = { kind: 'available', version: '9.9.9' };
  const downloadingState: UpdateState = { kind: 'downloading', progress: 42 };
  const downloadedState: UpdateState = { kind: 'downloaded', version: '9.9.9' };

  function beginUpdate(): { state: ActivityShelfState; op: ActivityOperation } {
    const action = updateStateAction(undefined, availableState);
    if (action === null) throw new Error('expected a begin action');
    const state = reduceActivityShelf(initialActivityShelfState, action);
    return { state, op: state.operations[0]! };
  }

  it('available begins one running, indeterminate operation with no percentage', () => {
    const { state, op } = beginUpdate();
    expect(state.operations).toHaveLength(1);
    expect(op.id).toBe(UPDATE_OPERATION_ID);
    expect(op.state.kind).toBe('running');
    expect(op.cancelable).toBe(false);
    expect(op.completionActions).toEqual([]);
    expect(op.task.name).toBe(UPDATE_TASK_NAME);
    if (op.state.kind !== 'running' || op.state.progress.kind !== 'indeterminate') {
      throw new Error('expected indeterminate running update progress');
    }
    expect(op.state.progress.phaseText).toBe('Update available');
    const serialized = JSON.stringify(op.state.progress);
    expect(serialized).not.toContain('percent');
    expect(serialized).not.toContain('%');
    expect(serialized).not.toContain('total');
  });

  it('available keeps the same operation running (no duplicate row)', () => {
    const { state, op } = beginUpdate();
    const action = updateStateAction(op, availableState);
    expect(action?.type).toBe('progress');
    const next = action === null ? state : reduceActivityShelf(state, action);
    expect(next.operations).toHaveLength(1);
    expect(next.operations[0]?.id).toBe(UPDATE_OPERATION_ID);
    expect(next.operations[0]?.state.kind).toBe('running');
  });

  it('downloading is running indeterminate with "Downloading update" and no percentage', () => {
    const { state, op } = beginUpdate();
    const action = updateStateAction(op, downloadingState);
    expect(action?.type).toBe('progress');
    if (action?.type !== 'progress') throw new Error('expected a progress action');
    expect(action.progress.kind).toBe('indeterminate');
    const next = reduceActivityShelf(state, action);
    const row = next.operations[0]!;
    if (row.state.kind !== 'running' || row.state.progress.kind !== 'indeterminate') {
      throw new Error('expected indeterminate running update progress');
    }
    expect(row.state.progress.phaseText).toBe('Downloading update');
    const serialized = JSON.stringify(action);
    expect(serialized).not.toContain('percent');
    expect(serialized).not.toContain('%');
    expect(serialized).not.toContain('42');
    expect(serialized).not.toContain('total');
  });

  it('downloading with no operation begins one (app started mid-download)', () => {
    const action = updateStateAction(undefined, downloadingState);
    if (action?.type !== 'begin') throw new Error('expected a begin action');
    const state = reduceActivityShelf(initialActivityShelfState, action);
    const row = state.operations[0]!;
    if (row.state.kind !== 'running' || row.state.progress.kind !== 'indeterminate') {
      throw new Error('expected indeterminate running update progress');
    }
    expect(row.state.progress.phaseText).toBe('Downloading update');
  });

  it('downloaded completes with no completion actions (badge owns restart)', () => {
    const { state, op } = beginUpdate();
    const action = updateStateAction(op, downloadedState);
    expect(action).toEqual({ type: 'complete', id: UPDATE_OPERATION_ID });
    const next = reduceActivityShelf(state, action!);
    expect(next.operations[0]?.state.kind).toBe('completed');
    expect(availableCompletionActions(next.operations[0]!)).toEqual([]);
  });

  it('error fails the operation with item "Update" and the updater message', () => {
    const { state, op } = beginUpdate();
    const action = updateStateAction(op, { kind: 'error', message: 'download failed' });
    expect(action).toEqual({
      type: 'fail',
      id: UPDATE_OPERATION_ID,
      failure: { item: 'Update', reason: 'download failed' },
    });
    const next = reduceActivityShelf(state, action!);
    const row = next.operations[0]!;
    if (row.state.kind !== 'failed') throw new Error('expected a failed update op');
    expect(row.state.failure).toEqual({ item: 'Update', reason: 'download failed' });
  });

  it('a new cycle after a FAILED update maps to a fresh begin, then reaches completed (DEF-653)', () => {
    // DEF-653 — a terminal row must not stay stuck. After `available -> error`
    // the row is `failed`; the next `available` maps to a fresh `begin` (not a
    // `progress`, which the terminal reducer would ignore). The App drops the
    // stale terminal row first, then dispatches the begin, so exactly one update
    // row exists and the new cycle reaches `completed`.
    const { state: running, op } = beginUpdate();
    const failedState = reduceActivityShelf(
      running,
      updateStateAction(op, { kind: 'error', message: 'download failed' })!,
    );
    expect(failedState.operations).toHaveLength(1);
    expect(failedState.operations[0]!.state.kind).toBe('failed');

    const restart = updateStateAction(failedState.operations[0]!, availableState);
    expect(restart?.type).toBe('begin');

    let next = reduceActivityShelf(failedState, {
      type: 'remove',
      id: UPDATE_OPERATION_ID,
    });
    next = reduceActivityShelf(next, restart!);
    expect(next.operations).toHaveLength(1);
    expect(next.operations[0]!.state.kind).toBe('running');

    next = reduceActivityShelf(
      next,
      updateStateAction(next.operations[0], downloadingState)!,
    );
    next = reduceActivityShelf(
      next,
      updateStateAction(next.operations[0], downloadedState)!,
    );
    expect(next.operations).toHaveLength(1);
    expect(next.operations[0]!.state.kind).toBe('completed');
  });

  it('a new cycle after a COMPLETED update maps to a fresh begin, then reaches completed (DEF-653)', () => {
    // The `completed -> available -> downloading -> downloaded` path is the
    // other stuck case: reusing the completed row with a `progress` is ignored.
    const { state: running, op } = beginUpdate();
    const completedState = reduceActivityShelf(
      running,
      updateStateAction(op, downloadedState)!,
    );
    expect(completedState.operations[0]!.state.kind).toBe('completed');

    const restart = updateStateAction(completedState.operations[0]!, availableState);
    expect(restart?.type).toBe('begin');

    let next = reduceActivityShelf(completedState, {
      type: 'remove',
      id: UPDATE_OPERATION_ID,
    });
    next = reduceActivityShelf(next, restart!);
    next = reduceActivityShelf(
      next,
      updateStateAction(next.operations[0], downloadingState)!,
    );
    next = reduceActivityShelf(
      next,
      updateStateAction(next.operations[0], downloadedState)!,
    );
    expect(next.operations).toHaveLength(1);
    expect(next.operations[0]!.state.kind).toBe('completed');
  });

  it('checking / up-to-date / unsupported / null remove the row, or are a no-op when none exists', () => {
    const inactive: UpdateState[] = [
      { kind: 'checking' },
      { kind: 'up-to-date', version: '1.0.0' },
      { kind: 'unsupported', reason: 'dev build' },
    ];
    for (const next of inactive) {
      expect(updateStateAction(undefined, next)).toBeNull();
      const { state, op } = beginUpdate();
      const action = updateStateAction(op, next);
      expect(action).toEqual({ type: 'remove', id: UPDATE_OPERATION_ID });
      const after = reduceActivityShelf(state, action!);
      expect(after.operations).toHaveLength(0);
    }
    expect(updateStateAction(undefined, null)).toBeNull();
    const { state, op } = beginUpdate();
    const cleared = reduceActivityShelf(state, updateStateAction(op, null)!);
    expect(cleared.operations).toHaveLength(0);
  });
});