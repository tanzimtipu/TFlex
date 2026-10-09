// TFL-1620 — the shared exit state machine for enter-only CSS surfaces.
//
// Three surfaces (the compact Inspector drawer, the compact ContextPanel drawer
// and the Activity Shelf panel) animate their ENTRANCE with a CSS keyframe but
// snapped out instantly because the element was removed from the DOM with no
// out keyframe. This hook mirrors the `closing` phase of `useNoticeCollapse`
// for that class of surface: when `active` flips true -> false it holds the
// surface in the DOM for one MICRO-band exit so the caller can render its
// `--leaving` pose and the out keyframe can play. The caller owns the class
// and the keyframe; this hook owns only the timing.
//
// Contract:
//   - `active` true keeps the surface rendered with `leaving === false`.
//   - `active` false -> true during an exit cancels it (re-open never waits).
//   - Under reduced motion OR the Animations setting OFF (motionPolicy
//     `instant`) the exit collapses: `leaving` is never set, so the caller
//     releases the surface immediately and the settled end state is instant.
//   - The exit duration is passed in by the caller from the motion tokens
//     (the exit band), never a magic number.

import { useEffect, useRef, useState } from 'react';
import { useInstantMotion } from './useAnimations';

/** Returns true while an `active -> inactive` transition is playing its exit,
 *  so the caller can keep the surface mounted and apply its `--leaving` class.
 *  False at every other time. */
export function useExitTransition(active: boolean, exitMs: number): boolean {
  const instant = useInstantMotion();
  const [leaving, setLeaving] = useState(false);
  const wasActiveRef = useRef(active);

  useEffect((): (() => void) | undefined => {
    const wasActive = wasActiveRef.current;
    wasActiveRef.current = active;
    // Opening, a no-op render, or the instant path: never hold an exit.
    if (active || !wasActive || instant) {
      setLeaving(false);
      return undefined;
    }
    setLeaving(true);
    const id = window.setTimeout((): void => setLeaving(false), exitMs);
    return (): void => window.clearTimeout(id);
  }, [active, instant, exitMs]);

  return leaving;
}
