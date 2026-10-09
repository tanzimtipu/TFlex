// TFL-1531 — the in-canvas activity summary notice.
//
// Mirrors the CanvasAlertNotice expand/collapse behaviour exactly — it reuses
// the same `useNoticeCollapse` state machine (icon-first enter, auto-collapse
// after a reading pause, user re-expand resetting the dwell) — but surfaces a
// compact operation summary instead of pending warning/error messages: a status
// dot, an operation count, and the active operation's name + status text.
//
// The `role` prop is the ActivityStateRole from ActivityShelf and drives the
// accent (progress/success/warning/danger/neutral) on both the box border and
// the status mark, so the notice reads the same tone language as the shelf.

import type { ReactElement } from 'react';
import { Activity, ChevronUp } from 'lucide-react';
import { Icon } from '../icons/Icon';
import { IconButton } from './Button';
import { useNoticeCollapse } from '../hooks/useNoticeCollapse';
import type { ActivityStateRole } from '../components/ActivityShelf';

export interface ActivityAlertNoticeProps {
  /** Number of operations in the summary. */
  count: number;
  /** Display name of the active operation. */
  activeName: string;
  /** Status text for the active operation. */
  activeText: string;
  /** Visual role; drives the box + mark accent. */
  role: ActivityStateRole;
}

export function ActivityAlertNotice(
  props: ActivityAlertNoticeProps,
): ReactElement | null {
  const { count, activeName, activeText, role } = props;
  const { phase, collapse, expand } = useNoticeCollapse();

  if (phase === 'collapsed' || phase === 'entering') {
    return (
      <div
        className="activity-alert-notice-region"
        data-activity-alert-notice-state={phase}
      >
        <IconButton
          label="Show activity notice"
          intent="secondary"
          kind="disclosure"
          density="compact"
          className="activity-alert-notice-collapsed-toggle"
          onClick={expand}
          data-activity-alert-icon
          icon={<Icon icon={Activity} size="sm" />}
        />
      </div>
    );
  }

  return (
    <div
      className={
        phase === 'closing'
          ? 'activity-alert-notice activity-alert-notice--leaving'
          : 'activity-alert-notice'
      }
      role="note"
      aria-label="Activity notice"
      data-activity-alert-notice
      data-activity-alert-tone={role}
      data-activity-alert-state={phase}
    >
      <div className="activity-alert-notice-body">
        <span
          className="activity-alert-notice-mark"
          data-activity-alert-role={role}
        />
        <span className="activity-alert-notice-count">
          {count === 1 ? '1 operation' : `${count} operations`}
        </span>
        <span className="activity-alert-notice-active">
          {activeName} - {activeText}
        </span>
      </div>
      <IconButton
        label="Collapse activity notice"
        intent="tertiary"
        kind="disclosure"
        density="compact"
        className="activity-alert-notice-collapse"
        onClick={collapse}
        data-activity-alert-collapse
        icon={<Icon icon={ChevronUp} size="xs" />}
      />
    </div>
  );
}
