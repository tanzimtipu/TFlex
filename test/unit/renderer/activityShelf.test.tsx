// @vitest-environment jsdom
//
// TFL-1216 (chunk C2) - the Activity Shelf surface primitives.
//
// Pins the presentation contract of ActivityShelfSummary / ActivityShelfPanel /
// ActivityRow against the C1 model: honest progress text (no percentage, no
// ETA), the cancel-request vs confirmed-cancel distinction, completion actions
// driven only by availableCompletionActions, and the pure helpers.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';
import {
  ActivityRow,
  ActivityShelfPanel,
  ActivityShelfSummary,
  activityRowText,
  activityStateRole,
} from '../../../src/renderer/components/ActivityShelf';
import {
  availableCompletionActions,
  completeOperation,
  completePartial,
  confirmCancellation,
  createOperation,
  failOperation,
  isRunning,
  makeProgress,
  requestCancellation,
  startOperation,
  updateProgress,
  type ActivityCompletionAction,
  type ActivityDocumentIdentity,
  type ActivityOperation,
} from '../../../src/renderer/state/activity';

const DOC: ActivityDocumentIdentity = {
  docId: 'doc-1',
  tabId: 'tab-1',
  path: 'C:/docs/a.pdf',
  displayName: 'a.pdf',
};

const noop = (): void => undefined;

function makeOperation(id = 'op-1', name = 'Import', scope = 'a.pdf'): ActivityOperation {
  return createOperation({ id, document: DOC, task: { name, scope } });
}

function running(id = 'op-1'): ActivityOperation {
  return startOperation(makeOperation(id), 'Working');
}

/** A running operation that declares a real cancellation channel. The panel
 *  derives its per-row `canCancel` from `operation.cancelable` (DEF-647). */
function runningCancelable(id = 'op-1'): ActivityOperation {
  return startOperation(
    createOperation({
      id,
      document: DOC,
      task: { name: 'Import', scope: 'a.pdf' },
      cancelable: true,
    }),
    'Working',
  );
}

function declaredOperation(
  completionActions: readonly ActivityCompletionAction[],
  id = 'op-1',
): ActivityOperation {
  return startOperation(
    createOperation({
      id,
      document: DOC,
      task: { name: 'Import', scope: 'a.pdf' },
      completionActions,
    }),
    'Working',
  );
}

const roots: Root[] = [];
const hosts: HTMLElement[] = [];

function mount(element: ReactElement | null): HTMLElement {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(element);
  });
  roots.push(root);
  hosts.push(host);
  return host;
}

function renderPanel(
  operations: readonly ActivityOperation[],
  overrides: Partial<Parameters<typeof ActivityShelfPanel>[0]> = {},
): HTMLElement {
  return mount(
    <ActivityShelfPanel
      operations={operations}
      onClose={overrides.onClose ?? noop}
      onCancel={overrides.onCancel ?? noop}
      onAction={overrides.onAction ?? noop}
      onDismiss={overrides.onDismiss}
    />,
  );
}

function actionNames(host: HTMLElement): string[] {
  return [...host.querySelectorAll('[data-activity-action]')].map(
    (el): string => el.getAttribute('data-activity-action') ?? '',
  );
}

afterEach((): void => {
  act((): void => {
    for (const root of roots) root.unmount();
  });
  roots.length = 0;
  for (const host of hosts) host.remove();
  hosts.length = 0;
  document.body.innerHTML = '';
});

describe('activityShelf honest progress text', () => {
  it('renders determinate running progress as "4 of 12 pages" and contains no percentage', () => {
    const op = updateProgress(
      running(),
      makeProgress({ done: 4, total: 12, unit: 'pages' }),
    );
    const host = renderPanel([op]);
    expect(host.querySelector('[data-activity-row-text]')?.textContent).toBe('4 of 12 pages');
    expect(host.textContent).not.toContain('%');
  });

  it('renders the indeterminate phase text with no percentage or ETA guess', () => {
    const op = startOperation(makeOperation(), 'Scanning pages');
    const host = renderPanel([op]);
    expect(host.querySelector('[data-activity-row-text]')?.textContent).toBe('Scanning pages');
    expect(host.textContent).not.toContain('%');
    expect(host.textContent ?? '').not.toMatch(/ETA|estimated/i);
  });
});

describe('activityShelf single-state invariant', () => {
  it('never renders a completed operation as running', () => {
    const op = completeOperation(running(), 'tx-1');
    const host = renderPanel([op]);
    const row = host.querySelector('[data-activity-row]');
    expect(row?.getAttribute('data-activity-state')).toBe('completed');
    expect(
      host.querySelectorAll('[data-activity-row][data-activity-state="running"]').length,
    ).toBe(0);
    expect(host.querySelector('[data-activity-track]')).toBeNull();
  });
});

describe('activityShelf cancellation truthfulness', () => {
  it('renders "Cancelling..." for a cancellation request and never "Cancelled"', () => {
    const op = requestCancellation(runningCancelable());
    const host = renderPanel([op]);
    const cancel = host.querySelector('[data-activity-cancel]');
    expect(cancel?.textContent).toBe('Cancelling...');
    expect(host.textContent).not.toContain('Cancelled');
  });

  it('renders a confirmed cancellation as the neutral cancelled state with no cancel action', () => {
    const op = confirmCancellation(requestCancellation(running()));
    const host = renderPanel([op]);
    const row = host.querySelector('[data-activity-row]');
    expect(row?.getAttribute('data-activity-state')).toBe('cancelled');
    expect(row?.getAttribute('data-activity-role')).toBe('neutral');
    expect(host.querySelector('[data-activity-row-text]')?.textContent).toBe('Cancelled');
    expect(host.querySelector('[data-activity-cancel]')).toBeNull();
  });
});

describe('activityShelf completion actions', () => {
  it('offers exactly the declared actions, defaults to none, and gates undo on both declaration and a transaction id', () => {
    const declared = completeOperation(declaredOperation(['view-details']));
    expect(availableCompletionActions(declared)).toEqual(['view-details']);
    const hostDeclared = renderPanel([declared]);
    expect(actionNames(hostDeclared)).toEqual(['view-details']);

    const none = completeOperation(declaredOperation([], 'op-none'));
    expect(availableCompletionActions(none)).toEqual([]);
    const hostNone = renderPanel([none]);
    expect(actionNames(hostNone)).toEqual([]);

    const undoNoTx = completeOperation(declaredOperation(['undo'], 'op-undo-notx'));
    expect(availableCompletionActions(undoNoTx)).toEqual([]);
    expect(actionNames(renderPanel([undoNoTx]))).not.toContain('undo');

    const undoWithTx = completeOperation(declaredOperation(['undo'], 'op-undo-tx'), 'tx-9');
    expect(availableCompletionActions(undoWithTx)).toEqual(['undo']);
    const hostTx = renderPanel([undoWithTx]);
    expect(actionNames(hostTx)).toEqual(['undo']);
    expect(
      [...hostTx.querySelectorAll('[data-activity-action]')].map(
        (el): string => el.textContent ?? '',
      ),
    ).toContain('Undo');
  });
});

describe('activityShelf failure detail (retired to the canvas alert)', () => {
  it('renders no failed-items list and no failure reason for a partial-success operation', () => {
    const op = completePartial(running(), [
      { item: 'page 3', reason: 'blank' },
      { item: 'page 7', reason: 'corrupt' },
    ]);
    const host = renderPanel([op]);
    expect(host.querySelector('[data-activity-failed-items]')).toBeNull();
    expect(host.querySelector('[data-activity-failed-item]')).toBeNull();
    expect(host.querySelector('[data-activity-failure-reason]')).toBeNull();
  });

  it('renders no failure detail for a failed operation', () => {
    const op = failOperation(running('op-f'), { item: 'a.pdf', reason: 'unreadable' });
    const host = renderPanel([op]);
    expect(host.querySelector('[data-activity-failed-items]')).toBeNull();
    expect(host.querySelector('[data-activity-failure-reason]')).toBeNull();
  });
});

describe('activityShelf panel and summary controls', () => {
  it('plays the exit keyframe on Escape, then notifies onClose after the MICRO band', () => {
    vi.useFakeTimers();
    try {
      const onClose = vi.fn();
      const host = renderPanel([running()], { onClose });
      act((): void => {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      });
      // TFL-1620 — the surface holds its leaving pose; onClose is deferred so
      // the out keyframe can play before the host unmounts the panel.
      expect(onClose).not.toHaveBeenCalled();
      expect(host.querySelector('.activity-shelf-panel--leaving')).not.toBeNull();
      act((): void => {
        vi.advanceTimersByTime(200);
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders the summary as null with no operations', () => {
    const host = mount(<ActivityShelfSummary operations={[]} onOpen={noop} />);
    expect(host.querySelector('[data-activity-shelf-summary]')).toBeNull();
    expect(host.textContent).toBe('');
  });

  it('shows the operation count and the active operation state, and opens on click', () => {
    const onOpen = vi.fn();
    const host = mount(
      <ActivityShelfSummary
        operations={[running('op-1'), completeOperation(running('op-2'))]}
        onOpen={onOpen}
      />,
    );
    expect(host.querySelector('[data-activity-shelf-count]')?.textContent).toBe('2 operations');
    expect(host.querySelector('[data-activity-shelf-active]')?.textContent).toContain('Working');
    expect(host.querySelector('[data-activity-shelf-role]')?.getAttribute('data-activity-shelf-role')).toBe(
      'progress',
    );
    act((): void => {
      (host.querySelector('[data-activity-shelf-open]') as HTMLButtonElement).click();
    });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe('activityShelf cancel control guard', () => {
  it('fires onCancel from the row cancel action without swallowing the click', () => {
    const onCancel = vi.fn();
    const host = mount(
      <ActivityRow
        operation={requestCancellation(running('op-c'))}
        canCancel
        onCancel={onCancel}
        onAction={noop}
      />,
    );
    const cancel = host.querySelector('[data-activity-cancel]') as HTMLButtonElement;
    act((): void => {
      cancel.click();
    });
    expect(onCancel).toHaveBeenCalledWith('op-c');
  });

  it('does not render a cancel action when the operation cannot be cancelled', () => {
    const host = renderPanel([running()]);
    expect(host.querySelector('[data-activity-cancel]')).toBeNull();

    // Per-op capability: a cancelable running op DOES render the control, so
    // the panel's per-row `canCancel={operation.cancelable}` is what decides.
    const cancelableHost = renderPanel([runningCancelable('op-cc')]);
    expect(cancelableHost.querySelector('[data-activity-cancel]')).not.toBeNull();
  });
});

describe('activityShelf pure helpers', () => {
  it('activityRowText never emits a percentage for determinate or indeterminate progress', () => {
    const determinate = updateProgress(running(), makeProgress({ done: 4, total: 12, unit: 'pages' }));
    expect(activityRowText(determinate)).toBe('4 of 12 pages');
    expect(activityRowText(determinate)).not.toContain('%');

    const indeterminate = startOperation(makeOperation(), 'Scanning');
    expect(activityRowText(indeterminate)).toBe('Scanning');
  });

  it('activityStateRole maps each state to its role', () => {
    expect(activityStateRole(makeOperation())).toBe('progress');
    expect(activityStateRole(running())).toBe('progress');
    expect(activityStateRole(requestCancellation(running()))).toBe('progress');
    expect(activityStateRole(completeOperation(running()))).toBe('success');
    expect(
      activityStateRole(completePartial(running(), [{ item: 'p', reason: 'r' }])),
    ).toBe('warning');
    expect(
      activityStateRole(failOperation(running(), { item: 'p', reason: 'r' })),
    ).toBe('danger');
    expect(activityStateRole(confirmCancellation(requestCancellation(running())))).toBe(
      'neutral',
    );
  });

  it('isRunning holds for running and cancellation-requested only', () => {
    expect(isRunning(running().state)).toBe(true);
    expect(isRunning(requestCancellation(running()).state)).toBe(true);
    expect(isRunning(completeOperation(running()).state)).toBe(false);
  });
});

describe('activityShelf accessibility (TFL-1216 chunk C8)', () => {
  it('exposes the summary as a polite status region with no percentage', () => {
    const op = updateProgress(running(), makeProgress({ done: 4, total: 12, unit: 'pages' }));
    const host = mount(<ActivityShelfSummary operations={[op]} onOpen={noop} />);
    const summary = host.querySelector('[data-activity-shelf-summary]');
    expect(summary?.getAttribute('role')).toBe('status');
    expect(summary?.getAttribute('aria-live')).toBe('polite');
    expect(host.textContent).not.toContain('%');
  });

  it('keeps the determinate progress counter visible but out of the polite region', () => {
    const op = updateProgress(running(), makeProgress({ done: 4, total: 12, unit: 'pages' }));
    const host = mount(<ActivityShelfSummary operations={[op]} onOpen={noop} />);
    const active = host.querySelector('[data-activity-shelf-active]');
    expect(active?.textContent).toBe('Import - 4 of 12 pages');
    expect(active?.querySelector('[aria-hidden="true"]')?.textContent).toBe(' - 4 of 12 pages');
  });

  it('renders no actionable failure alert in the shelf (retired to the canvas alert)', () => {
    const partial = completePartial(running('op-p'), [{ item: 'page 3', reason: 'blank' }]);
    const failed = failOperation(running('op-f'), { item: 'a.pdf', reason: 'unreadable' });
    const host = renderPanel([partial, failed]);
    expect(host.querySelector('[data-activity-failed-items]')).toBeNull();
    expect(host.querySelector('[data-activity-failure-reason]')).toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it('moves focus into the non-modal panel on open', () => {
    const host = renderPanel([running()]);
    const panel = host.querySelector('[data-activity-shelf-panel]');
    expect(panel?.getAttribute('aria-modal')).toBe('false');
    expect(panel?.getAttribute('tabindex')).toBe('-1');
    expect(document.activeElement).toBe(panel);
  });

  it('exposes the summary trigger through openButtonRef for focus return', () => {
    const ref = createRef<HTMLButtonElement>();
    const host = mount(
      <ActivityShelfSummary operations={[running()]} onOpen={noop} openButtonRef={ref} />,
    );
    expect(ref.current).toBe(host.querySelector('[data-activity-shelf-open]'));
  });
});
