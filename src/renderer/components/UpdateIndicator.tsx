// DEF-077 — OTA update toolbar indicator.
//
// The backend (electron-updater) drives the lifecycle; the renderer's
// job is to surface availability and route the user's click. The
// toolbar indicator lives next to the theme toggle in
// `AppHeader.header-actions` (the spec called this out: "mount it
// next to the Tools/theme controls"). It does NOT own the lifecycle —
// every state mutation is driven by the backend pushing a fresh
// `UpdateState` over `tflex.update.onStatusChanged`.
//
// State -> indicator mapping (see `indicatorView`):
//   - 'unsupported'   : hidden (the spec: "hides or appears muted")
//   - 'checking'      : muted spinner
//   - 'up-to-date'    : hidden (no toolbar noise when the app is current)
//   - 'available'     : accent pill "Update vX.Y.Z" — click triggers download
//   - 'downloading'   : muted progress pill (no click target while busy)
//   - 'downloaded'    : primary button "Restart to update" — click triggers install
//   - 'error'         : muted pill with the error message, clickable to retry
//
// `'unsupported'` is hidden rather than muted because the About dialog
// already explains the reason (portable build, missing publisher
// creds, etc.) — showing a muted chip in the header on top of that is
// noise. The spec said "hides or appears muted"; we hide. The About
// dialog remains the source of truth for that case.

import { type ReactElement, useEffect, useState, useCallback } from "react";
import { Check, Download, RefreshCw, X } from "lucide-react";
import type { UpdateState } from "../../shared/types";
import { BrandLoader } from "./BrandLoader";
import { normalizeUpdateState } from "./updateStateNormalize";

/** The visual presentation of the indicator for a given `UpdateState`.
 *  Pure: given the same state, returns the same view. Exported for
 *  unit tests so the mapping is exercised without mounting React. */
export type IndicatorView =
  | { kind: "hidden" }
  | { kind: "checking" }
  | { kind: "available"; version: string; ariaLabel: string }
  | { kind: "downloading"; progress: number; ariaLabel: string }
  | { kind: "downloaded"; version: string; ariaLabel: string }
  | { kind: "error"; message: string; ariaLabel: string };

/** Map an `UpdateState` from the backend to the toolbar's visual
 *  presentation. Exhaustive over the union: a new kind in
 *  `UpdateState` will surface as a TS exhaustiveness error here. */
export function indicatorView(state: UpdateState | null | undefined): IndicatorView {
  if (state === null || state === undefined) return { kind: "hidden" };
  switch (state.kind) {
    case "unsupported":
      // Hidden — About dialog surfaces the reason (DEF-074).
      return { kind: "hidden" };
    case "checking":
      return { kind: "checking" };
    case "up-to-date":
      // Hidden — no toolbar noise when the app is current.
      return { kind: "hidden" };
    case "available":
      return {
        kind: "available",
        version: state.version,
        ariaLabel: `Update available: version ${state.version}. Click to download.`,
      };
    case "downloading": {
      const pct = Math.max(0, Math.min(100, Math.round(state.progress)));
      return {
        kind: "downloading",
        progress: pct,
        ariaLabel: `Downloading update: ${pct} percent.`,
      };
    }
    case "downloaded":
      return {
        kind: "downloaded",
        version: state.version,
        ariaLabel: `Update ready to install: version ${state.version}. Click to restart.`,
      };
    case "error":
      return {
        kind: "error",
        message: state.message,
        ariaLabel: `Update error: ${state.message}. Click to retry.`,
      };
  }
}

/** The IPC handle we read off `window.tflex`. Typed locally so the
 *  component can degrade gracefully when the preload channel is
 *  absent (older build, jsdom test environment). */
interface UpdateApi {
  getStatus?: () => Promise<UpdateState>;
  download?: () => Promise<UpdateState>;
  install?: () => Promise<void>;
  onStatusChanged?: (cb: (state: UpdateState) => void) => () => void;
}

function readUpdateApi(): UpdateApi | null {
  const w = window as unknown as { tflex?: { update?: UpdateApi } };
  const api = w.tflex?.update;
  return api ?? null;
}

export interface UpdateIndicatorProps {
  /** When true (the default), the indicator subscribes to
   *  `tflex.update.onStatusChanged` and renders. The host can pass
   *  `enabled={false}` to skip the IPC entirely — useful in tests
   *  that don't want the indicator to fire IPC on mount. */
  enabled?: boolean;
  /** OTA UX — when the host owns the onStatusChanged
   *  subscription (so the UpdatePromptDialog can react to the
   *  same push), the indicator can be told to read its state
   *  from this prop instead of subscribing on its own. The
   *  default `undefined` keeps the existing single-surface
   *  behaviour so callers that don't care about the prompt
   *  continue to work. Tests pass `enabled={false}` + the
   *  prop to lock behaviour without IPC. */
  externalState?: UpdateState | null;
}

/** Toolbar indicator. Mounts once and stays mounted for the lifetime
 *  of the AppHeader so the subscription isn't churned on every
 *  render. The initial state is fetched via `getStatus()`; subsequent
 *  state changes come from the `onStatusChanged` push. */
export function UpdateIndicator(props: UpdateIndicatorProps): ReactElement | null {
  const { enabled = true, externalState } = props;
  // undefined = haven't asked yet, null = channel absent,
  // UpdateState = live state from the backend. When the host
  // passes `externalState`, the indicator reads from there and
  // skips its own subscription entirely — used by App.tsx to
  // share one onStatusChanged listener between the toolbar chip
  // and the UpdatePromptDialog.
  const [state, setState] = useState<UpdateState | null | undefined>(
    externalState,
  );

  useEffect(() => {
    // Host-supplied state wins — sync on every prop change so the
    // indicator reflects whatever the host's subscription sees.
    if (externalState !== undefined) {
      setState(externalState);
      return undefined;
    }
    if (!enabled) return undefined;
    const api = readUpdateApi();
    if (api === null) {
      setState(null);
      return undefined;
    }
    let cancelled = false;
    if (typeof api.getStatus === "function") {
      void api.getStatus()
        .then((next) => {
          // DEF-275 — this fallback subscription is live until App
          // supplies `externalState` (effects run child-first), so the
          // same untrusted-payload hardening applies here.
          if (!cancelled) setState(normalizeUpdateState(next));
        })
        .catch(() => {
          if (!cancelled) setState(normalizeUpdateState(null));
        });
    }
    const unsubscribe = typeof api.onStatusChanged === "function"
      ? api.onStatusChanged((next) => {
        if (!cancelled) setState(normalizeUpdateState(next));
      })
      : (): void => undefined;
    return (): void => {
      cancelled = true;
      unsubscribe();
    };
  }, [enabled, externalState]);

  const onDownload = useCallback((): void => {
    const api = readUpdateApi();
    if (api?.download === undefined) return;
    // download() resolves with the new UpdateState (typically
    // 'downloading'). We don't need to handle the resolution — the
    // backend will push the next state over onStatusChanged.
    void api.download().catch(() => undefined);
  }, []);

  const onInstall = useCallback((): void => {
    const api = readUpdateApi();
    if (api?.install === undefined) return;
    // install() triggers a quit + relaunch; no resolution expected.
    void api.install().catch(() => undefined);
  }, []);

  const view = indicatorView(state);
  if (view.kind === "hidden") return null;

  // Render the indicator. Each kind carries its own element so the
  // tests can pin the selector contract (data-update-indicator and
  // data-update-indicator-kind="<kind>").
  switch (view.kind) {
    case "checking":
      return (
        <span
          className="update-indicator update-indicator-checking"
          data-update-indicator
          data-update-indicator-kind="checking"
          aria-label="Checking for updates"
          title="Checking for updates"
        >
          <RefreshCw size={16} aria-hidden />
        </span>
      );
    case "available":
      return (
        <button
          type="button"
          className="update-indicator update-indicator-available"
          data-update-indicator
          data-update-indicator-kind="available"
          data-update-indicator-version={view.version}
          aria-label={view.ariaLabel}
          title={view.ariaLabel}
          onClick={onDownload}
        >
          <Download size={16} aria-hidden />
          <span>Update v{view.version}</span>
        </button>
      );
    case "downloading":
      return (
        <span
          className="update-indicator update-indicator-downloading"
          data-update-indicator
          data-update-indicator-kind="downloading"
          data-update-indicator-progress={view.progress}
          aria-label={view.ariaLabel}
          title={view.ariaLabel}
        >
          <BrandLoader className="update-indicator-spin" />
          <span>{view.progress}%</span>
        </span>
      );
    case "downloaded":
      return (
        <button
          type="button"
          className="update-indicator update-indicator-downloaded"
          data-update-indicator
          data-update-indicator-kind="downloaded"
          data-update-indicator-version={view.version}
          aria-label={view.ariaLabel}
          title={view.ariaLabel}
          onClick={onInstall}
        >
          <Check size={16} aria-hidden />
          <span>Restart to update</span>
        </button>
      );
    case "error":
      return (
        <button
          type="button"
          className="update-indicator update-indicator-error"
          data-update-indicator
          data-update-indicator-kind="error"
          aria-label={view.ariaLabel}
          title={view.ariaLabel}
          onClick={onDownload}
        >
          <X size={16} aria-hidden />
          <span>Retry</span>
        </button>
      );
  }
}
