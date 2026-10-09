// Phase 126 (chunk A) — the in-canvas warning/error notice.
//
// A tone-keyed notice that surfaces one or more plain-text messages over the
// canvas: `warning` for things the user should know, `error` for conditions
// that block or fail. It reuses the Phase 67 `useNoticeCollapse` state machine
// exactly like ProtectionNotice / ConversionNotice / Pdf3dNotice: a rounded,
// animated box that auto-collapses after a short reading pause into a floating
// "i" (info) icon and can be re-expanded / collapsed by the user, the dwell
// resetting on every expand.
//
// ADDITIVE ONLY (chunk A): this component is not wired anywhere yet. Chunk B
// owns the call site. The markup below mirrors `Pdf3dNotice.tsx` verbatim in
// structure, with `role="note"` (as ProtectionNotice / ConversionNotice use)
// and a tone-driven `aria-label`. Visual tone rides the existing `--warning` /
// `--error` tokens (see the `.canvas-alert-notice*` rules in styles.css).

import type { ReactElement } from 'react';
import { ChevronUp, Info } from 'lucide-react';
import { Icon } from '../icons/Icon';
import { IconButton } from './Button';
import { useNoticeCollapse } from '../hooks/useNoticeCollapse';

export interface CanvasAlertNoticeProps {
  tone: 'warning' | 'error';
  messages: readonly string[];
}

export function CanvasAlertNotice(
  props: CanvasAlertNoticeProps,
): ReactElement | null {
  const { tone, messages } = props;
  const { phase, collapse, expand } = useNoticeCollapse();
  if (messages.length === 0) return null;

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
      aria-label={tone === 'error' ? 'Error notice' : 'Warning notice'}
      data-canvas-alert-notice
      data-canvas-alert-tone={tone}
      data-canvas-alert-state={phase}
    >
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
