// Phase 44 — the renderer's access to the accounts preload bridge.
//
// Both the sign-in surface (`AccountsDialog`) and the top-bar account menu
// (`AccountMenu`) read the SAME bridge subset. Kept in one module so the shape
// is declared once and the "no bridge exposed" case (jsdom / older builds) is
// resolved identically — a disabled/unconfigured state, never a thrown error.

import type {
  AccountsClientConfig,
  AccountStatusResult,
  OAuthCallbackOutcome,
  OAuthCallbackStartResult,
  SetSessionPayload,
  SyncReport,
} from "../../shared/accounts";

/** The accounts bridge subset the renderer uses, or null when the preload does
 *  not expose it (treated as "not configured"). */
export interface AccountsBridge {
  getConfig(): Promise<AccountsClientConfig>;
  /** The boot status. `name` / `image` are null when signed out, unavailable,
   *  or when the stored user record predates those fields. */
  getStatus(): Promise<AccountStatusResult>;
  setSession(payload: SetSessionPayload): Promise<void>;
  clearSession(): Promise<void>;
  syncNow(): Promise<SyncReport>;
  onSyncReport(cb: (report: SyncReport) => void): () => void;
  /** Phase 46 - bind the loopback callback listener and resolve its absolute
   *  URL, or undefined on a preload that predates the loopback flow. */
  startOAuthCallback?: () => Promise<OAuthCallbackStartResult>;
  /** Phase 46 - cancel/release the loopback listener. */
  stopOAuthCallback?: () => Promise<void>;
  /** Phase 46 - the single outcome of the loopback listener. */
  onOAuthCallback?: (cb: (outcome: OAuthCallbackOutcome) => void) => () => void;
}

/** Read the bridge off `window.tflex`, or null when it is missing / malformed. */
export function accountsBridge(): AccountsBridge | null {
  const w = window as unknown as { tflex?: { accounts?: AccountsBridge } };
  const api = w.tflex?.accounts;
  if (api === undefined) return null;
  if (typeof api.getConfig !== "function" || typeof api.getStatus !== "function") return null;
  return api;
}