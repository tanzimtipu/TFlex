// Phase 114 (chunk A) — the React binding over the page-flip engine core.
//
// `usePageFlipTransition` is a DOM side-effect controller: `play` writes the
// start vars + class directly on the paper-owning page unit and never calls
// setState, so a turn can never trigger a per-frame re-render. The instant
// gate is read through `useInstantMotion()` (the shared effective-motion
// policy: reduced motion OR the Animations setting off), mirroring the gating
// the other animation hooks use.
//
// Latest-wins: `play` clears the PREVIOUS element before applying the new one,
// so two rapid turns leave the class on at most one element. Exactly one
// fallback `setTimeout` is kept — jsdom never fires `animationend`, and a real
// browser may skip it — and it is reset on every `play`. `cancel` clears both
// the timer and the class.

import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  applyPageFlip,
  clearPageFlip,
  type PageFlipDirection,
} from "../components/pageFlip";
import { useInstantMotion } from "./useAnimations";
import { MOTION_DURATION } from "./motionTokens";

export interface PageFlipTransitionApi {
  /** Play a turn on `el`. Passing a null element (nothing mounted) cancels. */
  play: (el: HTMLElement | null, dir: PageFlipDirection) => void;
  /** Stop the in-flight turn: clear the fallback timer and the class. */
  cancel: () => void;
}

export function usePageFlipTransition(): PageFlipTransitionApi {
  const instant = useInstantMotion();
  // Read the live gate inside `play` without making `play` depend on it (a
  // dependency would rebuild the callback and re-render consumers on every
  // motion-setting flip).
  const instantRef = useRef(instant);
  instantRef.current = instant;
  const activeElRef = useRef<HTMLElement | null>(null);
  const timerRef = useRef<number | null>(null);

  const clearTimer = useCallback((): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const cancel = useCallback((): void => {
    clearTimer();
    const el = activeElRef.current;
    if (el !== null) {
      clearPageFlip(el);
      activeElRef.current = null;
    }
  }, [clearTimer]);

  const play = useCallback(
    (el: HTMLElement | null, dir: PageFlipDirection): void => {
      if (el === null) {
        cancel();
        return;
      }
      clearTimer();
      const previous = activeElRef.current;
      if (previous !== null && previous !== el) {
        clearPageFlip(previous);
      }
      const played = applyPageFlip(el, dir, instantRef.current);
      if (!played) {
        activeElRef.current = null;
        return;
      }
      activeElRef.current = el;
      timerRef.current = window.setTimeout((): void => {
        timerRef.current = null;
        if (activeElRef.current === el) {
          clearPageFlip(el);
          activeElRef.current = null;
        }
      }, MOTION_DURATION.fast);
    },
    [cancel, clearTimer],
  );

  // Unmount hygiene: never leave a half-flipped page or a pending timer.
  useEffect(() => cancel, [cancel]);

  return useMemo(() => ({ play, cancel }), [play, cancel]);
}
