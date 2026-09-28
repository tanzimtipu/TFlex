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

/** The signed-in user's identity, as shown in the account surface.
 *  `image` is an avatar URL (or data URI) supplied by the identity provider;
 *  null/absent when the provider holds no picture. Present so the value can
 *  round-trip through `setSession` and be served back from the vault on a
 *  cold boot without any network read. */
export interface AccountUser {
  id: string;
  email: string;
  emailVerified: boolean;
  name?: string;
  image?: string | null;
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

/** What `accounts:getStatus` resolves to. The renderer sees the status, the
 *  user's email, their display name and avatar image — never the session
 *  token. `name` / `image` are null when signed out, unavailable, or when
 *  the stored user record predates these fields; the renderer then falls
 *  back to initials / the email letter. */
export interface AccountStatusResult {
  status: AccountStatus;
  email: string | null;
  name: string | null;
  image: string | null;
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

// ---------------------------------------------------------------------------
// Phase 44 chunk 5 - signature image storage contract
// ---------------------------------------------------------------------------

/**
 * The hard cap on a single signature image, in bytes, matching the Neon
 * Function's own `MAX_BYTES`. The app enforces it BEFORE uploading so an
 * over-size image fails fast with a clear, non-blocking message instead of
 * a wasted round trip (the Function would answer 413). Shared so the future
 * image picker can pre-check with the same number.
 */
export const SIGNATURE_IMAGE_MAX_BYTES = 256 * 1024;

/**
 * The kind of a signature row: vector strokes, typed text, or a raster image
 * whose bytes live in the private `tflex` bucket (never base64 in the DB).
 */
export type SignatureKind = 'drawn' | 'typed' | 'image';

/**
 * The metadata half of a locally held image signature. The PNG bytes live in
 * a file under userData (never in `settings.json`, never in the database);
 * `storageKey` is null until those bytes have been uploaded. This shape is
 * main-process local state, safe to hand to the renderer as it carries no
 * credential and no bytes; the JWT and the AWS credentials never appear in it.
 */
export interface ImageSignatureMeta {
  id: string;
  label: string;
  createdAt: string;
  width: number;
  height: number;
  /** Cloud object key, or null while the bytes are still local-only. */
  storageKey: string | null;
  /** True when the local store currently holds the PNG bytes for this id.
   *  Set by the store on list; never sent to the cloud. */
  hasBytes?: boolean;
}

// ---------------------------------------------------------------------------
// Phase 46 - Google sign-in loopback callback contract
// ---------------------------------------------------------------------------

/**
 * What `accounts:startOAuthCallback` resolves to: the ABSOLUTE loopback URL
 * the renderer hands to the auth SDK as `callbackURL`. The renderer runs from
 * `file://` in the packaged app, where the page origin ("null") is not an
 * absolute URL and the provider rejects the call (400 BAD_OAUTH_CALLBACK).
 *
 * `callbackUrl` is `http://127.0.0.1:<ephemeral-port>/oauth/callback?token=...`.
 * The random single-use `token` is bound to the listener that produced it, so
 * another local process cannot spoof the callback. It is returned ONLY to the
 * invoking renderer over the invoke reply - never broadcast.
 */
export interface OAuthCallbackStartResult {
  callbackUrl: string;
}

/**
 * Delivered over `accounts:oauthCallback` when the loopback listener is
 * reached, or closes without being reached. `timeout` is the 2-minute expiry,
 * `cancelled` is a `stop` / a replaced start, `error` is a listener or
 * exchange failure.
 *
 * Phase 46 - `{ ok: true }` now means MAIN has COMPLETED the sign-in: the
 * renderer runs from `file://`, so it is cross-site to the auth host and
 * Chromium will not attach the provider's `SameSite=Lax` session cookie - its
 * own SDK `getSession()` can never see the session the popup established.
 * Main reads the cookie (which its session DOES hold) and completes the
 * exchange through `session.fetch`, then stores the identity + JWT in the
 * vault. The renderer therefore learns the outcome by re-querying
 * `accounts:getStatus()`; it must NOT attempt its own exchange.
 *
 * A failure carries a NON-secret `message` with the provider's real status /
 * message (the Phase 46 rule) so the surface never shows a generic string.
 * Deliberately carries NO OAuth `code` / `state`, no callback token and no
 * session token.
 */
export type OAuthCallbackOutcome =
  | { ok: true }
  | { ok: false; reason: 'timeout' | 'cancelled' | 'error'; message?: string };

// ---------------------------------------------------------------------------
// Phase 50 - open the provider sign-in URL in the OS default browser
// ---------------------------------------------------------------------------

/**
 * Result of `accounts:openAuthUrl`. The renderer hands main the provider URL
 * the auth SDK returned; main opens it in the OS DEFAULT BROWSER only after
 * validating it is `https:` and its host is EXACTLY the configured auth host.
 *
 * `{ ok: true }`  - the URL passed validation and was handed to the OS shell.
 * `invalid-url`   - the URL was refused (another host, a subdomain, `http:`,
 *                   `javascript:`, `file:`, malformed, empty, or no configured
 *                   auth host) and was NEVER opened.
 * `failed`        - the URL was valid but `shell.openExternal` rejected.
 *
 * The handler never throws, so the renderer always gets this shape.
 */
export type OpenAuthUrlResult =
  | { ok: true }
  | { ok: false; reason: 'invalid-url' | 'failed' };

// ---------------------------------------------------------------------------
// Phase 46 - observable Google sign-in chain (dev-oriented trace)
// ---------------------------------------------------------------------------

/**
 * One step of the Google sign-in popup/callback chain, emitted by main over
 * `accounts:oauthTrace`. This exists to make a stuck or blank popup
 * diagnosable from the renderer log without a debugger: the popup's
 * navigation/redirect/fail-load events, the loopback listener being reached,
 * the completion matcher firing, the popup closing, and the auth-host cookie
 * presence afterwards.
 *
 * SAFETY: the payload NEVER carries an OAuth `code`, `state`, callback token
 * or cookie value. `url` is sanitized to origin + pathname (query and hash
 * dropped) and `path` is a pathname only; cookies are reported as NAMES and a
 * COUNT. The trace is always on but cheap (a handful of events per sign-in).
 */
export type OAuthTraceKind =
  | 'popup-open'
  | 'popup-navigate'
  | 'popup-redirect'
  | 'popup-navigate-in-page'
  | 'popup-fail-load'
  | 'popup-complete'
  | 'popup-closed'
  | 'popup-cookies'
  | 'loopback-hit'
  // Phase 46 - the main-process session exchange after the loopback landed.
  | 'exchange-cookies'
  | 'exchange-get-session'
  | 'exchange-token'
  | 'exchange-stored'
  | 'exchange-failed';

export interface OAuthTraceEvent {
  /** Epoch milliseconds; events order by this. */
  at: number;
  kind: OAuthTraceKind;
  /** Sanitized location: scheme + host + pathname only. Query and hash are
   *  dropped, so no OAuth code / state / loopback token can ever appear. */
  url?: string;
  /** Loopback pathname only, e.g. `/oauth/callback`. */
  path?: string;
  /** The auth hostname when known (never credentials, never a path). */
  host?: string;
  /** `popup-fail-load` only - Chromium's numeric net error. */
  errorCode?: number;
  /** `popup-fail-load` only - Chromium's net error description. */
  errorDescription?: string;
  /** `popup-cookies` / `exchange-cookies` only - cookie NAMES, sorted;
   *  never values. */
  cookieNames?: string[];
  /** `popup-cookies` / `exchange-cookies` only - total matching cookies. */
  cookieCount?: number;
  /** `exchange-get-session` / `exchange-token` only - the HTTP status the auth
   *  host answered. Never a body. */
  status?: number;
  /** `exchange-failed` only - a fixed machine reason code (e.g.
   *  `no-cookie`, `session-rejected`). Never a provider message or a token. */
  reason?: string;
}
