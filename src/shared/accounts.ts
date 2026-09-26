/**
 * Phase 44 — accounts and cloud sync: shared contract.
 *
 * Deliberately SMALL and explicit. This chunk defines only the surface the
 * renderer needs to branch on: the signed-in user identity, the coarse
 * account status, the sync report shape and the error taxonomy. The network
 * transport itself lives in a later chunk.
 *
 * SECURITY: `AccountUser` is safe to hand the renderer. The raw session /
 * JWT is NEVER part of this contract's renderer-facing payloads — it is
 * accepted by `setSession` and thereafter held only in the main process
 * (see `src/main/services/accounts/vault.ts`).
 */

/** The signed-in user's identity, as shown in the account surface. */
export interface AccountUser {
  id: string;
  email: string;
  emailVerified: boolean;
  name?: string;
}

/**
 * Coarse account state the UI branches on.
 *
 * - `signed-out` — no session held; the app behaves exactly as today.
 * - `signed-in`  — a session is held in memory (and normally on disk).
 * - `unavailable` — no session held AND secure session storage is not
 *   usable on this machine (Electron safeStorage reports no encryption
 *   backend), so a session could not survive a restart. The account
 *   surface reports this rather than pretending sign-in would persist.
 */
export type AccountStatus = 'signed-out' | 'signed-in' | 'unavailable';

/** What `accounts:getStatus` resolves to. The renderer sees the status and
 *  the user's email only — never the session token. */
export interface AccountStatusResult {
  status: AccountStatus;
  email: string | null;
}

/**
 * What `accounts:getConfig` resolves to — the non-secret slice of the
 * accounts configuration the renderer needs to construct the Neon auth
 * client. `authBaseUrl` is null when no endpoint is configured; `configured`
 * mirrors that. The Data API URL and any token/secret are deliberately absent.
 */
export interface AccountsClientConfig {
  authBaseUrl: string | null;
  configured: boolean;
}

/** Renderer -> main, called after a successful sign-in. Main encrypts and
 *  stores this material; the token is never echoed back to the renderer. */
export interface SetSessionPayload {
  user: AccountUser;
  /** The session JWT. Written only through the encrypted vault. */
  token: string;
}

/**
 * Error taxonomy the UI can branch on. Each code maps to one clear user
 * message; transport errors carry `server` or `network-offline` only.
 */
export type AccountsErrorCode =
  | 'invalid-credentials'
  | 'email-not-verified'
  | 'code-invalid'
  | 'code-expired'
  | 'network-offline'
  | 'server';

export interface AccountsError {
  code: AccountsErrorCode;
  message: string;
}

/**
 * The phase of the last sync attempt.
 *
 * - `idle`        — nothing to do: the feature flag is off or no session is held.
 * - `syncing`     — reserved for an in-flight attempt (the engine reports only
 *                   completed attempts).
 * - `synced`      — the attempt completed.
 * - `unavailable` — the feature is switched on and a session is held, but the
 *                   sync transport is not configured on this install. The UI
 *                   says the feature is not configured rather than showing a
 *                   server failure. No network call is made.
 * - `error`       — the attempt failed (server / unknown).
 * - `offline`     — the attempt failed because the network was unreachable.
 */
export type SyncPhase = 'idle' | 'syncing' | 'synced' | 'unavailable' | 'error' | 'offline';

/**
 * Result of a sync attempt, for the account surface. `at` is an ISO-8601
 * timestamp of the last completed attempt; `pushed` / `pulled` are row
 * counts when the attempt succeeded. `error` is present only when
 * `phase` is `error` or `offline`.
 */
export interface SyncReport {
  phase: SyncPhase;
  at?: string;
  pushed?: number;
  pulled?: number;
  error?: AccountsError;
}
