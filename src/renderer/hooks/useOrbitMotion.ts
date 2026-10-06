// Phase 106 (chunk B) — the React binding for the Home decorative-motion
// decision (utils/orbitMotion.ts). It observes the four live suspensions and
// resolves them through the pure policy:
//
//   - the persisted Animations setting  (useAnimationsEnabled)
//   - the persisted Home pause          (the `homeMotionPaused` argument)
//   - the OS reduced-motion preference  (useLiveReducedMotion, shared source)
//   - document visibility               (visibilitychange / document.hidden)
//   - window minimised / blurred        (renderSuspend IPC + window blur/focus)
//
// The hook returns true only while every gate is open, so the motif's
// `data-orbit-motion` attribute flips to "off" the instant the document is
// hidden, the window is minimised/blurred, reduced motion is on or the user
// paused. Consumers never re-derive the policy themselves.

import { useEffect, useState, useSyncExternalStore } from "react";
import { isRenderSuspended, subscribeRenderSuspend } from "../state/renderSuspend";
import { shouldAnimateOrbit } from "../utils/orbitMotion";
import { useAnimationsEnabled, useLiveReducedMotion } from "./useAnimations";

/** Subscribe to document visibility changes (tab backgrounded / hidden). */
function subscribeDocumentVisibility(notify: () => void): () => void {
  if (typeof document === "undefined") return (): void => undefined;
  document.addEventListener("visibilitychange", notify);
  return (): void => document.removeEventListener("visibilitychange", notify);
}

function getDocumentHidden(): boolean {
  return typeof document !== "undefined" && document.hidden === true;
}

/** Subscribe to the main-process minimise/restore signal. */
function subscribeMinimized(notify: () => void): () => void {
  return subscribeRenderSuspend(() => notify());
}

function getMinimized(): boolean {
  return isRenderSuspended();
}

/** Live window-focus flag: true while the window has lost OS focus. The blur
 *  is a transient suspension that lifts on focus; it never overrides a user
 *  pause (the Animations gate is separate and wins). */
function useWindowBlurred(): boolean {
  const [blurred, setBlurred] = useState(false);
  useEffect((): (() => void) => {
    const onBlur = (): void => setBlurred(true);
    const onFocus = (): void => setBlurred(false);
    window.addEventListener("blur", onBlur);
    window.addEventListener("focus", onFocus);
    return (): void => {
      window.removeEventListener("blur", onBlur);
      window.removeEventListener("focus", onFocus);
    };
  }, []);
  return blurred;
}

/** Resolve whether the decorative orbit may drift right now. */
export function useOrbitMotion(homeMotionPaused = false): boolean {
  const animationsEnabled = useAnimationsEnabled();
  const prefersReduced = useLiveReducedMotion();
  const documentHidden = useSyncExternalStore(
    subscribeDocumentVisibility,
    getDocumentHidden,
    (): boolean => false,
  );
  const windowMinimized = useSyncExternalStore(
    subscribeMinimized,
    getMinimized,
    (): boolean => false,
  );
  const windowBlurred = useWindowBlurred();
  return shouldAnimateOrbit({
    animationsEnabled,
    homeMotionPaused,
    prefersReduced,
    documentHidden,
    windowMinimized,
    windowBlurred,
  });
}
