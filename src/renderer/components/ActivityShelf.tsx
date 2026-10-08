// TFL-1216 (chunk C2) - the Activity Shelf surface primitives.
//
// Presentational only: these three components take `operations` as props, own
// no store, context, reducer wiring or IPC, and are NOT wired into the app
// (that is chunk C3). They surface every honesty rule of the C1 model
// (src/renderer/state/activity.ts):
//   - progress reads as "N of M unit" or an indeterminate phase text, never a
//     percentage and never an ETA;
//   - a cancel REQUEST reads "Cancelling..." and never "Cancelled" before the
//     engine confirms it;
//   - completion actions come only from `availableCompletionActions`, so
//     `undo` appears only when the model offers it.

import { useEffect, useRef, type ReactElement, type Ref } from 'react';
import { FileText, X } from 'lucide-react';
import { Icon } from '../icons/Icon';
import { Button, IconButton } from './Button';
import {
  availableCompletionActions,
  failedItems,
  isRunning,
  type ActivityCompletionAction,
  type ActivityOperation,
  type ActivityProgress,
} from '../state/activity';

/** The visual role a state maps to. `cancelled` is neutral; every other state
 *  maps to one of the four restrained accents. */
export type ActivityStateRole =
  | 'progress'
  | 'success'
  | 'warning'
  | 'danger'
  | 'neutral';

/** Deterministic state -> role mapping. `running`/`cancellation-requested`
 *  (and `queued`) are `progress` (violet); `completed` -> `success`,
 *  `partial-success` -> `warning`, `failed` -> `danger`, `cancelled` -> the
 *  neutral role. */
export function activityStateRole(operation: ActivityOperation): ActivityStateRole {
  switch (operation.state.kind) {
    case 'queued':
    case 'running':
    case 'cancellation-requested':
      return 'progress';
    case 'completed':
      return 'success';
    case 'partial-success':
      return 'warning';
    case 'failed':
      return 'danger';
    case 'cancelled':
      return 'neutral';
  }
}

/** "N of M unit" for determinate progress, else the indeterminate phase text.
 *  Never emits a percentage or an ETA. */
export function activityRowText(operation: ActivityOperation): string {
  const state = operation.state;
  switch (state.kind) {
    case 'queued':
      return 'Queued';
    case 'running':
    case 'cancellation-requested':
      return progressText(state.progress);
    case 'cancelled':
      return 'Cancelled';
    case 'completed':
      return 'Completed';
    case 'partial-success':
      return `Completed with ${state.failed.length} ${
        state.failed.length === 1 ? 'issue' : 'issues'
      }`;
    case 'failed':
      return state.failure.reason;
  }
}

function progressText(progress: ActivityProgress): string {
  if (progress.kind === 'determinate') {
    return `${progress.done} of ${progress.total} ${progress.unit}`;
  }
  return progress.phaseText;
}

const COMPLETION_LABEL: Record<ActivityCompletionAction, string> = {
  'open-result': 'Open',
  'show-in-folder': 'Show in folder',
  'view-details': 'View details',
  undo: 'Undo',
};

export interface ActivityRowProps {
  operation: ActivityOperation;
  /** True only when a real cancel is supported for this operation. The Cancel
   *  control renders only for a running state AND a true flag. */
  canCancel?: boolean;
  onCancel: (operationId: string) => void;
  onAction: (operationId: string, action: ActivityCompletionAction) => void;
}

/** One Activity Shelf row: task icon, task name, scope, honest progress text, a
 *  6px progress track while running, the failure detail, and the available
 *  actions. */
export function ActivityRow(props: ActivityRowProps): ReactElement {
  const { operation, canCancel = false, onCancel, onAction } = props;
  const state = operation.state;
  const role = activityStateRole(operation);
  const running = isRunning(state);
  const showCancel = canCancel && running;
  const cancelLabel = state.kind === 'cancellation-requested' ? 'Cancelling...' : 'Cancel';
  const progress =
    state.kind === 'running' || state.kind === 'cancellation-requested'
      ? state.progress
      : null;
  const actions = availableCompletionActions(operation);
  const failed = failedItems(operation);

  return (
    <li
      className="activity-shelf-row"
      data-activity-row
      data-activity-state={state.kind}
      data-activity-role={role}
    >
      <Icon icon={FileText} size="sm" className="activity-shelf-row-icon" />
      <div className="activity-shelf-row-main">
        <p className="activity-shelf-row-title">
          <span className="activity-shelf-row-name" data-activity-task-name>
            {operation.task.name}
          </span>
          <span className="activity-shelf-row-scope" data-activity-task-scope>
            {operation.task.scope}
          </span>
        </p>
        <p className="activity-shelf-row-text" data-activity-row-text>
          {activityRowText(operation)}
        </p>
        {progress !== null && (
          <div
            className="activity-shelf-track"
            data-activity-track
            data-activity-track-kind={progress.kind}
          >
            <span
              className={
                progress.kind === 'determinate'
                  ? 'activity-shelf-track-bar'
                  : 'activity-shelf-track-bar activity-shelf-track-bar--indeterminate'
              }
              data-activity-track-bar
              style={
                progress.kind === 'determinate'
                  ? { transform: `scaleX(${progress.done / progress.total})` }
                  : undefined
              }
            />
          </div>
        )}
        {failed !== null && failed.length > 0 && (
          <ul className="activity-shelf-failed" role="alert" data-activity-failed-items>
            {failed.map((failure, index) => (
              <li
                className="activity-shelf-failed-item"
                key={`${failure.item}-${index}`}
                data-activity-failed-item
              >
                <span className="activity-shelf-failed-name">{failure.item}</span>
                <span className="activity-shelf-failed-reason">{failure.reason}</span>
              </li>
            ))}
          </ul>
        )}
        {state.kind === 'failed' && (
          <p
            className="activity-shelf-failure-reason"
            role="alert"
            data-activity-failure-reason
          >
            {state.failure.reason}
          </p>
        )}
      </div>
      <div className="activity-shelf-row-actions">
        {showCancel && (
          <Button
            intent="tertiary"
            kind="action"
            density="compact"
            className="activity-shelf-cancel"
            data-activity-cancel
            onClick={(): void => onCancel(operation.id)}
          >
            {cancelLabel}
          </Button>
        )}
        {actions.map((action) => (
          <Button
            key={action}
            intent="tertiary"
            kind="action"
            density="compact"
            className="activity-shelf-action"
            data-activity-action={action}
            onClick={(): void => onAction(operation.id, action)}
          >
            {COMPLETION_LABEL[action]}
          </Button>
        ))}
      </div>
    </li>
  );
}

export interface ActivityShelfPanelProps {
  operations: readonly ActivityOperation[];
  onClose: () => void;
  onCancel: (operationId: string) => void;
  onAction: (operationId: string, action: ActivityCompletionAction) => void;
  /** Acknowledge the terminal notices in the shelf. */
  onDismiss?: () => void;
}

/** The opened Activity surface: a non-modal dialog with a header and a
 *  scrollable list of ActivityRow. Escape closes it through `onClose`. */
export function ActivityShelfPanel(props: ActivityShelfPanelProps): ReactElement {
  const { operations, onClose, onCancel, onAction, onDismiss } = props;
  const panelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return (): void => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // TFL-1216 (chunk C8) - opening the shelf moves keyboard focus into the
  // panel (the dialog container, announced by its aria-label) so Escape and
  // Tab reach the shelf surface immediately. The panel is non-modal
  // (aria-modal="false"), so focus is not trapped; Escape is handled above and
  // the host restores focus to the summary trigger.
  useEffect((): void => {
    panelRef.current?.focus();
  }, []);

  const hasNotice = operations.some(
    (op) => !isRunning(op.state) && op.state.kind !== 'queued',
  );

  return (
    <section
      className="activity-shelf activity-shelf-panel"
      role="dialog"
      aria-modal="false"
      aria-label="Activity"
      ref={panelRef}
      tabIndex={-1}
      data-activity-shelf-panel
    >
      <header className="activity-shelf-header">
        <h2 className="activity-shelf-title">Activity</h2>
        {onDismiss !== undefined && hasNotice && (
          <Button
            intent="tertiary"
            kind="action"
            density="compact"
            className="activity-shelf-dismiss"
            data-activity-shelf-dismiss
            onClick={onDismiss}
          >
            Dismiss
          </Button>
        )}
        <IconButton
          label="Close activity"
          intent="tertiary"
          kind="disclosure"
          density="compact"
          className="activity-shelf-close"
          data-activity-shelf-close
          onClick={onClose}
          icon={<Icon icon={X} size="sm" />}
        />
      </header>
      <ul className="activity-shelf-list" data-activity-shelf-list>
        {operations.map((operation) => (
          <ActivityRow
            key={operation.id}
            operation={operation}
            canCancel={operation.cancelable}
            onCancel={onCancel}
            onAction={onAction}
          />
        ))}
      </ul>
    </section>
  );
}

export interface ActivityShelfSummaryProps {
  operations: readonly ActivityOperation[];
  onOpen: () => void;
  /** TFL-1216 (chunk C8) - optional handle on the "Activity" trigger so the
   *  host can restore focus to it when the panel closes (Escape / close). */
  openButtonRef?: Ref<HTMLButtonElement>;
}

/** The quiet collapsed summary anchored to the viewing footer. Renders null
 *  with no operations to report; otherwise the operation count plus the active
 *  operation's honest state and one restrained role mark, with a button that
 *  opens the panel. */
export function ActivityShelfSummary(
  props: ActivityShelfSummaryProps,
): ReactElement | null {
  const { operations, onOpen, openButtonRef } = props;
  if (operations.length === 0) return null;

  const active =
    operations.find((op) => isRunning(op.state) || op.state.kind === 'queued') ??
    operations[0];
  const count = operations.length;
  // TFL-1216 (chunk C8) - a live region must announce stage / completion
  // changes politely but never each progress point (Feedback and Progress
  // design-decisions: "announce neither each percentage point nor every
  // background event"). A determinate running counter ticks "4 of 12 pages" ->
  // "5 of 12 pages"; that detail stays visible but is removed from the
  // accessibility tree so the polite region only re-announces the stable task
  // identity and the real state transitions. Indeterminate phase text is a
  // genuine stage, so it stays announced.
  const activeState = active.state;
  const determinateCounter =
    (activeState.kind === 'running' || activeState.kind === 'cancellation-requested') &&
    activeState.progress.kind === 'determinate';

  return (
    <div
      className="activity-shelf activity-shelf-summary"
      role="status"
      aria-live="polite"
      data-activity-shelf-summary
    >
      <span
        className="activity-shelf-summary-mark"
        data-activity-shelf-role={activityStateRole(active)}
        aria-hidden="true"
      />
      <span className="activity-shelf-summary-text">
        <span className="activity-shelf-summary-count" data-activity-shelf-count>
          {count === 1 ? '1 operation' : `${count} operations`}
        </span>
        <span className="activity-shelf-summary-active" data-activity-shelf-active>
          {determinateCounter ? (
            <>
              {active.task.name}
              <span aria-hidden="true">{` - ${activityRowText(active)}`}</span>
            </>
          ) : (
            `${active.task.name} - ${activityRowText(active)}`
          )}
        </span>
      </span>
      <Button
        intent="secondary"
        kind="action"
        density="compact"
        className="activity-shelf-open"
        data-activity-shelf-open
        ref={openButtonRef}
        onClick={onOpen}
      >
        Activity
      </Button>
    </div>
  );
}
