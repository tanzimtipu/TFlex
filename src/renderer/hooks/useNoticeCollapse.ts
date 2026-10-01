// Phase 67 (features A/B/C) — the shared auto-collapse state machine for the
// top-of-canvas notices.
//
// Phase 59 (feature B) gave the document-protection banner the collapse-to-"i"
// behaviour; Phase 67 lifts that exact machine out of ProtectionNotice so the
// conversion card and the 3D limitation notice can adopt the same behaviour
// without duplicating it. The protection notice is the reference and is NOT
// changed: this hook is a faithful extraction of its `expanded | closing |
// collapsed` machine, its ~10 s dwell (reset on every expand) and its
// useInstantMotion fast path.
//
// Motion rides the shared token set: the dwell is a reading pause (a named
// constant), while the exit phase commits after MOTION_DURATION.standard.

import { useCallback, useEffect, useState } from 'react';
import { useInstantMotion } from '../hooks/useAnimations';
import { MOTION_DURATION } from '../hooks/motionTokens';

/** Dwell before a notice collapses on its own. This is a reading pause, not a
 *  motion duration, so it is a named constant rather than a motion token. */
export const NOTICE_AUTO_COLLAPSE_MS = 10000;

/** The icon-first enter (`entering` -> `expanded`) -> closing (playing the
 *  exit) -> collapsed (the "i" icon). */
export type NoticePhase = 'entering' | 'expanded' | 'closing' | 'collapsed';

export interface NoticeCollapse {
  phase: NoticePhase;
  /** Collapse the notice (no-op while already closing). */
  collapse: () => void;
  /** Expand the notice and reset the dwell timer. */
  expand: () => void;
}

export function useNoticeCollapse(): NoticeCollapse {
  const instant = useInstantMotion();
  // Phase 78 (DEF-465) — the animated enter shows the collapsed "i" for the
  // first frame, then commits to `expanded`, whose `*-notice-in` scale grows
  // from the icon's top-right origin. The instant path skips the icon leg and
  // opens straight on the box (reduced motion / Animations OFF).
  const [phase, setPhase] = useState<NoticePhase>(() =>
    instant ? 'expanded' : 'entering',
  );

  const collapse = useCallback((): void => {
    if (instant) {
      setPhase('collapsed');
      return;
    }
    // Only an expanded notice collapses; a second click during the exit is a
    // no-op rather than a re-entry.
    setPhase((current) => (current === 'expanded' ? 'closing' : current));
  }, [instant]);

  const expand = useCallback((): void => {
    setPhase('expanded');
  }, []);

  // Phase 78 (DEF-465) — commit the icon-first enter. A passive effect can
  // run in the SAME tick as the `entering` commit, so React flushes the box
  // before the collapsed "i" ever paints (the measured bug: the first rAF
  // sample was already the box). Defer the commit by a DOUBLE rAF: the first
  // frame lets the "i" commit and paint, the second mounts the box, whose
  // token-based `*-notice-in` scale then grows from that painted origin.
  // This is a paint hand-off, not a motion band, so it carries no duration
  // token: the instant path never enters this phase (it starts `expanded`).
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

  // Collapse ~10 s after the notice appears OR re-expands. Depending on
  // `phase` means every cleanup resets the dwell: expanding schedules a fresh
  // timer, and collapsing clears the pending one.
  useEffect(() => {
    if (phase !== 'expanded') return undefined;
    const id = window.setTimeout(collapse, NOTICE_AUTO_COLLAPSE_MS);
    return (): void => window.clearTimeout(id);
  }, [phase, collapse]);

  // Commit the collapse once the exit animation has played. Skipped on the
  // instant path (collapse() goes straight to 'collapsed' there).
  useEffect(() => {
    if (phase !== 'closing') return undefined;
    const id = window.setTimeout(() => setPhase('collapsed'), MOTION_DURATION.standard);
    return (): void => window.clearTimeout(id);
  }, [phase]);

  return { phase, collapse, expand };
}
