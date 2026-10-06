// Phase 52 (feature B) — the truthful protection banner.
// Phase 59 (feature B) — the banner is now a ROUNDED, ANIMATED box that
// collapses on its own after a short reading pause into a floating "i" (info)
// icon pinned at the canvas's top-left. The user can expand it again from the
// icon and collapse it again from the box's collapse control; the dwell timer
// resets on every expand.
//
// Shown above the canvas when the active document is encrypted. It reports
// the cipher / revision read from the file and the permission flags the
// document asks for, and states plainly that TFlex does not enforce them.
// The document stays fully usable: nothing is hidden and no tool is greyed
// out (the phase ruling).
//
// Structure: `.protection-notice-region` is the flow/positioning wrapper in
// the pane's document column. While expanded the box stays in flow (it never
// covers the page); while collapsed the box is gone and the icon is an
// absolute overlay inside the region, so it neither pushes the page nor
// covers a control. Motion rides the shared token set (see .protection-notice
// CSS); the dwell timer and the exit phase are skipped on the instant path
// (useInstantMotion), so reduced motion / Animations OFF collapse instantly.

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { ChevronUp, Info, ShieldAlert } from 'lucide-react';
import { Icon } from '../icons/Icon';
import { IconButton } from './Button';
import type { DocumentProtectionState } from '../../shared/types';
import { useInstantMotion } from '../hooks/useAnimations';
import { MOTION_DURATION } from '../hooks/motionTokens';
import {
  PROTECTION_ENFORCEMENT_TEXT,
  protectionPermissionRows,
  protectionSummary,
} from '../security/protection';

export interface ProtectionNoticeProps {
  protection: DocumentProtectionState;
  /** Retained for the existing call site. Phase 59 (item 2) repurposed the
   *  banner's control from "dismiss for the session" to a collapse: the
   *  notice now stays available through the collapsed "i", so this callback
   *  is no longer invoked. */
  onDismiss?: () => void;
}

/** Dwell before the banner collapses on its own. This is a reading pause, not
 *  a motion duration, so it is a named constant rather than a motion token. */
export const PROTECTION_NOTICE_AUTO_COLLAPSE_MS = 10000;

/** The icon-first enter (`entering` -> `expanded`) -> closing (playing the
 *  exit) -> collapsed (the "i" icon). */
type NoticePhase = 'entering' | 'expanded' | 'closing' | 'collapsed';

export function ProtectionNotice(props: ProtectionNoticeProps): ReactElement {
  const { protection } = props;
  const rows = protectionPermissionRows(protection.permissions);
  const allowed = rows.filter((r) => r.allowed).map((r) => r.label);
  const denied = rows.filter((r) => !r.allowed).map((r) => r.label);

  const instant = useInstantMotion();
  // Phase 78 (DEF-465) — the animated enter shows the collapsed "i" for the
  // first frame, then commits to `expanded`, whose `protection-notice-in`
  // scale grows from the icon's top-right origin. The instant path skips the
  // icon leg and opens straight on the box (reduced motion / Animations OFF).
  const [phase, setPhase] = useState<NoticePhase>(() =>
    instant ? 'expanded' : 'entering',
  );

  const collapse = useCallback((): void => {
    if (instant) {
      setPhase('collapsed');
      return;
    }
    // Only an expanded banner collapses; a second click during the exit is a
    // no-op rather than a re-entry.
    setPhase((current) => (current === 'expanded' ? 'closing' : current));
  }, [instant]);

  const expand = useCallback((): void => {
    setPhase('expanded');
  }, []);

  // Phase 78 (DEF-465) — commit the icon-first enter after the collapsed "i"
  // has PAINTED. A passive effect can run in the same tick as the `entering`
  // commit, so the box would mount before the icon ever painted; deferring by
  // a DOUBLE rAF guarantees the icon frame first, then the morph. A paint
  // hand-off, not a motion band, so it carries no duration; the instant path
  // never enters this phase.
  useEffect(() => {
    if (phase !== 'entering') return undefined;
    let second = 0;
    const first = window.requestAnimationFrame(() => {
      second = window.requestAnimationFrame(() => setPhase('expanded'));
    });
    return (): void => {
      window.cancelAnimationFrame(first);
      window.cancelAnimationFrame(second);
    };
  }, [phase]);

  // Collapse ~10 s after the banner appears OR re-expands. Depending on
  // `phase` means every cleanup resets the dwell: expanding schedules a fresh
  // timer, and collapsing clears the pending one.
  useEffect(() => {
    if (phase !== 'expanded') return undefined;
    const id = window.setTimeout(collapse, PROTECTION_NOTICE_AUTO_COLLAPSE_MS);
    return (): void => window.clearTimeout(id);
  }, [phase, collapse]);

  // Commit the collapse once the exit animation has played. Skipped on the
  // instant path (collapse() goes straight to 'collapsed' there).
  useEffect(() => {
    if (phase !== 'closing') return undefined;
    const id = window.setTimeout(() => setPhase('collapsed'), MOTION_DURATION.standard);
    return (): void => window.clearTimeout(id);
  }, [phase]);

  return (
    <div
      className="protection-notice-region"
      data-protection-notice-state={
        phase === 'expanded' || phase === 'closing' ? 'expanded' : 'collapsed'
      }
    >
      {(phase === 'expanded' || phase === 'closing') && (
        <div
          className={
            phase === 'closing'
              ? 'protection-notice protection-notice--leaving'
              : 'protection-notice'
          }
          role="note"
          aria-label="Document protection"
          data-protection-notice
        >
          <Icon icon={ShieldAlert} size="md" className="protection-notice-icon" />
          <div className="protection-notice-body">
            <p className="protection-notice-title">
              Protected document
              <span className="protection-notice-algorithm" data-protection-algorithm>
                {protectionSummary(protection)}
              </span>
            </p>
            <p className="protection-notice-line" data-protection-permissions>
              <span className="protection-notice-key">Allowed:</span>{' '}
              {allowed.length > 0 ? allowed.join(', ') : 'none'}
              {denied.length > 0 ? (
                <>
                  {' '}
                  <span className="protection-notice-key">Not allowed:</span>{' '}
                  {denied.join(', ')}
                </>
              ) : null}
            </p>
            <p className="protection-notice-enforcement" data-protection-enforcement>
              {PROTECTION_ENFORCEMENT_TEXT}
            </p>
          </div>
          <IconButton
            label="Collapse document protection notice"
            intent="tertiary"
            kind="disclosure"
            density="compact"
            className="protection-notice-collapse"
            onClick={collapse}
            data-protection-collapse
            icon={<Icon icon={ChevronUp} size="xs" />}
          />
        </div>
      )}
      {(phase === 'collapsed' || phase === 'entering') && (
        <IconButton
          label="Show document protection details"
          intent="secondary"
          kind="disclosure"
          density="compact"
          className="protection-notice-collapsed-toggle"
          onClick={expand}
          data-protection-icon
          icon={<Icon icon={Info} size="sm" />}
        />
      )}
    </div>
  );
}
