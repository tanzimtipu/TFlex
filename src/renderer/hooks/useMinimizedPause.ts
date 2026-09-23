// DEF-303 — the single IPC subscription that drives the renderer's
// minimised-window pause. Main pushes `window:minimizedChanged`
// (`{ minimized }`) on the window's `minimize`/`restore` events. The
// `backgroundThrottling: false` option was tried and reverted (Chromium
// still suspends a minimised window's frames), so the renderer cannot infer
// a minimise from `visibilitychange`/`document.hidden` and must rely on
// this explicit signal to park its render/raster work.
//
// Mirrors the app's other push subscriptions (the `onCloseRequested` /
// `onPrintRequest` effects in App.tsx and `useOsOpenPathRequests`): one
// mount effect, an older-preload guard so a preload without the channel
// degrades to a no-op instead of crashing, and the unsubscribe returned
// for cleanup on unmount. `setRenderSuspended` is the one suspend state
// the render/raster entry points consult.

import { useEffect } from "react";
import { setRenderSuspended } from "../state/renderSuspend";

/** The slice of the preload bridge this hook touches. Optional so a
 *  preload that predates DEF-303 (or a jsdom test) degrades gracefully. */
export interface MinimizedPauseBridge {
  onMinimizedChanged?(cb: (state: { minimized: boolean }) => void): () => void;
}

function getBridge(): MinimizedPauseBridge | undefined {
  return (window as unknown as { tflex?: MinimizedPauseBridge }).tflex;
}

/** Subscribe to the main process's minimise/restore pause signal. */
export function useMinimizedPause(): void {
  useEffect(() => {
    const api = getBridge();
    if (api === undefined || typeof api.onMinimizedChanged !== "function") return;
    const unsubscribe = api.onMinimizedChanged((state) => {
      setRenderSuspended(state.minimized === true);
    });
    return unsubscribe;
  }, []);
}
