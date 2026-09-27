// Phase 46 - the loopback-callback side of the account flows.
//
// The SDK seam (`AccountsAuthAdapter`) only knows how to ask the provider for
// an authorize URL and how to read the session a provider flow established.
// Everything that makes the flow work from an Electron renderer lives here and
// is injected, so the whole state machine is unit-tested without a DOM, the SDK
// or Electron:
//
//   start loopback listener -> signIn.social(callbackURL) -> open the popup
//   -> the browser lands on the loopback URL -> main completes the exchange
//   and stores the session, reporting `{ ok: true }` -> re-read getStatus()
//   -> signed in. The renderer does NOT read the SDK session itself: it runs
//   from `file://`, cross-site to the auth host, so Chromium never attaches
//   the provider's SameSite=Lax cookie to its own `getSession()` request.
//
// The callback MUST be absolute and provider-trusted: the packaged renderer is
// a `file://` page whose origin ("null") the provider rejects with 400
// BAD_OAUTH_CALLBACK. Main mints `http://127.0.0.1:<port>/oauth/callback` (the
// branch pre-approves localhost origins) and the browser lands there. The same
// absolute URL is what the password-reset request needs as `redirectTo`.

import type { AccountStatusResult, OAuthCallbackOutcome } from "../../shared/accounts";
import type { AccountsAuthAdapter, AuthFailure } from "./adapter";
import { describeAuthError } from "./adapter";

/** The slice of the preload bridge the loopback flows need. Optional members
 *  mean an older preload; a flow then reports "not available" instead of
 *  throwing. */
export interface OAuthCallbackBridge {
  startOAuthCallback?: () => Promise<{ callbackUrl: string }>;
  stopOAuthCallback?: () => Promise<void>;
  onOAuthCallback?: (cb: (outcome: OAuthCallbackOutcome) => void) => () => void;
}

/** A reason the loopback flow ended without the provider landing. */
export type OAuthOutcomeReason = "timeout" | "cancelled" | "error";

/** The one non-blocking message per loopback outcome reason. */
export function callbackOutcomeMessage(reason: OAuthOutcomeReason): string {
  if (reason === "timeout") return "Google sign-in timed out. Try again.";
  if (reason === "cancelled") return "Google sign-in was cancelled.";
  return "Google sign-in could not complete. Try again.";
}

/**
 * True when `value` is a usable absolute web origin. A packaged renderer is a
 * `file://` page whose `window.location.origin` is the string "null" - not an
 * absolute URL, and exactly what the provider rejected with BAD_OAUTH_CALLBACK.
 */
export function isUsableAppOrigin(value: string | null | undefined): boolean {
  return typeof value === "string" && /^https?:\/\/[^/]+/i.test(value);
}

/**
 * The absolute redirect the provider will accept for a flow whose result the
 * app already learns another way (the password-reset code is typed in-app).
 *
 * The renderer's OWN origin is preferred when it is a real absolute origin: it
 * is what the provider's origin check trusts (dev: `http://localhost:5173`).
 * A `file://` renderer has no absolute origin, so the app falls back to the
 * URL main mints, and to null when the bridge is too old to mint one.
 */
export async function resetRedirectUrl(
  bridge: OAuthCallbackBridge,
  appOrigin: string | null,
): Promise<string | null> {
  if (isUsableAppOrigin(appOrigin)) {
    const origin = appOrigin as string;
    return origin.endsWith("/") ? origin : `${origin}/`;
  }
  return absoluteRedirectUrl(bridge);
}

/**
 * Mint an absolute, provider-trusted URL from the loopback bridge for a flow
 * that will never receive a browser redirect. The listener is bound just long
 * enough to learn its URL and released immediately.
 *
 * Returns null when the bridge is too old to mint one, so the caller falls back
 * to its previous behaviour instead of sending a broken request.
 */
export async function absoluteRedirectUrl(bridge: OAuthCallbackBridge): Promise<string | null> {
  if (typeof bridge.startOAuthCallback !== "function") return null;
  try {
    const { callbackUrl } = await bridge.startOAuthCallback();
    if (typeof bridge.stopOAuthCallback === "function") {
      await bridge.stopOAuthCallback().catch(() => undefined);
    }
    return typeof callbackUrl === "string" && callbackUrl.length > 0 ? callbackUrl : null;
  } catch {
    return null;
  }
}

export interface GoogleSignInPorts {
  bridge: OAuthCallbackBridge;
  adapter: Pick<AccountsAuthAdapter, "signInGoogle">;
  /**
   * Re-query the account status after main reports the exchange completed.
   * `{ ok: true }` means MAIN has finished the exchange and the vault holds the
   * session, so the renderer learns the identity (status / email / name /
   * image) from here instead of attempting its own SDK session read.
   */
  getStatus(): Promise<AccountStatusResult>;
  /** Open the provider authorize URL in a popup. False when no window opened
   *  (blocked by the OS, or refused by the main-process popup policy). */
  openWindow(url: string): boolean;
  /** Close the popup the flow opened, if any. Must never throw. */
  closeWindow(): void;
  /** Main completed the sign-in and stored the session; drive the account
   *  machine to its signed-in state from this status. */
  onSignedIn(status: AccountStatusResult): void;
  onFailure(failure: AuthFailure): void;
  onInfo(text: string): void;
}

export interface GoogleSignInHandle {
  /** Abandon the flow: unsubscribe, release the listener, close the popup.
   *  No further callback fires. This is also the unmount/cancel path. */
  cancel(): void;
}

/**
 * Drive one "Continue with Google" attempt. Never throws: every failure ends
 * either in `onFailure` (a real provider/SDK reason, surfaced verbatim) or in
 * `onInfo` (a local outcome: timeout, cancel, a window that would not open).
 */
export function runGoogleSignIn(ports: GoogleSignInPorts): GoogleSignInHandle {
  const { bridge, adapter } = ports;
  const off = (): void => undefined;
  let disposed = false;
  let settled = false;
  let unsubscribe: () => void = off;

  const release = (): void => {
    unsubscribe();
    unsubscribe = off;
    if (typeof bridge.stopOAuthCallback === "function") {
      void bridge.stopOAuthCallback().catch(off);
    }
  };
  const end = (): void => {
    settled = true;
    release();
    ports.closeWindow();
  };

  if (typeof bridge.startOAuthCallback !== "function" || typeof bridge.onOAuthCallback !== "function") {
    ports.onInfo("Google sign-in is not available in this build.");
    return { cancel: off };
  }

  const handleOutcome = async (outcome: OAuthCallbackOutcome): Promise<void> => {
    if (disposed || settled) return;
    end();
    if (!outcome.ok) {
      // The honest provider/main reason when there is one; the local reason
      // otherwise. Never a generic string when the outcome carries a message.
      ports.onInfo(outcome.message ?? callbackOutcomeMessage(outcome.reason));
      return;
    }
    // `{ ok: true }` means MAIN completed the exchange and holds the session.
    // A file:// renderer is cross-site to the auth host, so its own SDK
    // session read can never see the SameSite=Lax cookie; re-query status.
    let status: AccountStatusResult;
    try {
      status = await ports.getStatus();
    } catch (error) {
      if (disposed) return;
      ports.onFailure({ ok: false, ...describeAuthError(error) });
      return;
    }
    if (disposed) return;
    if (status.status === "signed-in") {
      ports.onSignedIn(status);
      return;
    }
    // Main reported success but no session is readable: surface it instead of
    // silently showing a signed-out sheet.
    ports.onInfo("Google sign-in finished, but no session was stored. Try again.");
  };

  // Subscribe BEFORE the flow starts so the outcome can never be missed: the
  // provider may already be landing on the loopback URL by the time the
  // authorize URL resolves.
  unsubscribe = bridge.onOAuthCallback((outcome) => {
    void handleOutcome(outcome);
  });

  void (async (): Promise<void> => {
    let callbackUrl: string;
    try {
      ({ callbackUrl } = await bridge.startOAuthCallback!());
    } catch (error) {
      if (disposed) return;
      end();
      ports.onFailure({ ok: false, ...describeAuthError(error) });
      return;
    }
    if (disposed) return;
    const started = await adapter.signInGoogle({ callbackUrl });
    if (disposed) return;
    if (!started.ok) {
      end();
      ports.onFailure(started);
      return;
    }
    if (!ports.openWindow(started.url)) {
      end();
      ports.onInfo("TFlex could not open the Google sign-in window. Try again.");
      return;
    }
    ports.onInfo("Finish signing in with Google in the window that opened.");
  })();

  return {
    cancel(): void {
      if (disposed) return;
      disposed = true;
      release();
      ports.closeWindow();
    },
  };
}
