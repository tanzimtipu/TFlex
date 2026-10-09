// Phase 126 (chunk A) — the in-canvas warning/error notice.
//
// A single tone-grouped notice that surfaces every pending warning and error
// message over the canvas. It reuses the Phase 67 `useNoticeCollapse` state
// machine exactly like ProtectionNotice / ConversionNotice / Pdf3dNotice: a
// rounded, animated box that auto-collapses after a short reading pause into a
// floating "i" (info) icon and can be re-expanded / collapsed by the user, the
// dwell resetting on every expand.
//
// TFL-1533 — consolidated into ONE notice with ONE "i" icon. Warning and error
// messages are grouped by tone inside the box (errors first: they are the more
// severe condition), so a user with both pending never sees two competing
// icons. When only one tone is present its group renders label-less, matching
// the pre-consolidation single-tone look; when both are present each group
// carries a "Errors" / "Warnings" heading.
//
// The box-level `data-canvas-alert-tone` carries the DOMINANT tone (error wins)
// so the box accent and `aria-label` describe the most severe condition, while
// each group carries `data-canvas-alert-group` for its own heading accent.
// Visual tone rides the existing `--warning` / `--error` tokens (see the
// `.canvas-alert-notice*` rules in styles.css).

import type { ReactElement } from 'react';
import { ChevronUp, Info } from 'lucide-react';
import { Icon } from '../icons/Icon';
import { IconButton } from './Button';
import { useNoticeCollapse } from '../hooks/useNoticeCollapse';

export interface CanvasAlertNoticeProps {
  /** Pending warning messages, in arrival order. */
  warning: readonly string[];
  /** Pending error messages, in arrival order. */
  error: readonly string[];
}

function AlertGroup(props: {
  tone: 'warning' | 'error';
  messages: readonly string[];
  showLabel: boolean;
}): ReactElement {
  const { tone, messages, showLabel } = props;
  const heading = tone === 'error' ? 'Errors' : 'Warnings';
  return (
    <section
      className="canvas-alert-notice-group"
      data-canvas-alert-group={tone}
      aria-label={heading}
    >
      {showLabel && (
        <p className="canvas-alert-notice-group-label">{heading}</p>
      )}
      <ul className="canvas-alert-notice-messages" data-canvas-alert-messages>
        {messages.map((message, index) => (
          <li
            key={`${tone}-${index}`}
            className="canvas-alert-notice-message"
            data-canvas-alert-message
          >
            {message}
          </li>
        ))}
      </ul>
    </section>
  );
}

export function CanvasAlertNotice(
  props: CanvasAlertNoticeProps,
): ReactElement | null {
  const { warning, error } = props;
  const { phase, collapse, expand } = useNoticeCollapse();
  if (warning.length === 0 && error.length === 0) return null;

  // The dominant tone drives the box accent and `aria-label`: an error always
  // outranks a warning.
  const dominant: 'warning' | 'error' = error.length > 0 ? 'error' : 'warning';
  const showGroupLabels = warning.length > 0 && error.length > 0;

  // Phase 78 (DEF-465) — `entering` is the icon-first frame: it renders the
  // collapsed "i" exactly like `collapsed`, then the hook commits `expanded`.
  if (phase === 'collapsed' || phase === 'entering') {
    return (
      <div
        className="canvas-alert-notice-region"
        data-canvas-alert-notice-state={phase}
      >
        <IconButton
          label="Show notice"
          intent="secondary"
          kind="disclosure"
          density="compact"
          className="canvas-alert-notice-collapsed-toggle"
          onClick={expand}
          data-canvas-alert-icon
          icon={<Icon icon={Info} size="sm" />}
        />
      </div>
    );
  }

  return (
    <div
      className={
        phase === 'closing'
          ? 'canvas-alert-notice canvas-alert-notice--leaving'
          : 'canvas-alert-notice'
      }
      role="note"
      aria-label={dominant === 'error' ? 'Error notice' : 'Warning notice'}
      data-canvas-alert-notice
      data-canvas-alert-tone={dominant}
      data-canvas-alert-state={phase}
    >
      <div className="canvas-alert-notice-body" data-canvas-alert-groups>
        {error.length > 0 && (
          <AlertGroup tone="error" messages={error} showLabel={showGroupLabels} />
        )}
        {warning.length > 0 && (
          <AlertGroup
            tone="warning"
            messages={warning}
            showLabel={showGroupLabels}
          />
        )}
      </div>
      <IconButton
        label="Collapse notice"
        intent="tertiary"
        kind="disclosure"
        density="compact"
        className="canvas-alert-notice-collapse"
        onClick={collapse}
        data-canvas-alert-collapse
        icon={<Icon icon={ChevronUp} size="xs" />}
      />
    </div>
  );
}
