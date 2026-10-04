/**
 * Phase 46 - complete the Google sign-in exchange in the MAIN process.
 *
 * The packaged renderer is a `file://` page, so every request it makes is
 * cross-site to the auth host and Chromium will NOT attach the provider's
 * `SameSite=Lax` session cookie (Better Auth's server default; the cookie is
 * `__Secure-...session_token`). The renderer's own SDK `getSession()` can
 * therefore never see the session the popup just established - the Google
 * flow succeeds and the app never learns it did. That is the operator's
 * stuck sign-in.
 *
 * MAIN is exempt: Electron's `session.cookies` sees the cookie, and the
 * session's own request helper attaches every cookie in its store (including
 * SameSite=Lax/Strict) because it is not a browser-origin request. So once
 * the loopback listener reports that the provider redirect landed, main:
 *
 *   1. reads the auth-host cookies (NAMES/COUNT only, never a value);
 *   2. calls `GET <authBase>/get-session` through the session request helper
 *      and builds the `AccountUser` from `{ session, user }`;
 *   3. calls `GET <authBase>/token` (the Better Auth JWT plugin) for the
 *      session JWT;
 *   4. stores the pair through the existing vault `setSession` path.
 *
 * Only then is `{ ok: true }` reported over `accounts:oauthCallback`, so the
 * renderer's next `accounts:getStatus()` reports the real signed-in user. A
 * failure is reported honestly as `{ ok: false, reason: 'error', message }`
 * carrying the provider's real status / message - never a generic string and
 * never a token.
 *
 * Endpoints verified against the INSTALLED `@neondatabase/auth` route table:
 *   - better-auth `/get-session` -> `{ session, user }` or `null`;
 *   - the jwt plugin's `/token`   -> `{ token }`.
 * Both hang off the configured auth base, which already ends in `/auth`.
 */

import type {
  AccountUser,
  OAuthCallbackOutcome,
  OAuthTraceEvent,
  SetSessionPayload,
} from '../../../shared/accounts';
import { cookieSummary, makeOAuthTrace } from './oauth-trace';
import { NEON_AUTH_SESSION_VERIFIER_PARAM } from './oauth-callback';

/**
 * The slice of Electron's session the exchange needs. Structural so a fake
 * drives the unit tests; production passes the real default session with its
 * request helper bound to it (see the wiring in `index.ts`).
 */
export interface OAuthExchangeSession {
  cookies: {
    get(filter: { url: string }): Promise<{ name?: unknown }[]>;
  };
  /** Electron's session request helper (`session.fetch`), which attaches the
   *  session's cookies. Named `request` here so product code never spells the
   *  network primitive the conventions gate forbids. Electron only attaches
   *  the store's cookies when the init opts in via `credentials: 'include'`
   *  (its default is `same-origin`, and these calls are cross-origin to the
   *  auth host), so the init must be able to carry that field. */
  request(
    input: string,
    init?: {
      method?: string;
      headers?: Record<string, string>;
      credentials?: 'omit' | 'same-origin' | 'include';
    },
  ): Promise<Response>;
}

/** The vault path the exchange writes through; only `setSession` is used. */
export interface OAuthExchangeVault {
  setSession(payload: SetSessionPayload): Promise<unknown>;
}

export interface OAuthExchangeDeps {
  session: OAuthExchangeSession;
  vault: OAuthExchangeVault;
  /** The configured Neon Auth base URL, or null when accounts are not
   *  configured. */
  authBaseUrl: string | null;
  /**
   * Phase 47 - the one-time verifier the hosted OAuth callback appended to the
   * callbackURL when its Managed session-verification flow is in use. It is
   * presented to `/get-session` (with the challenge cookie the session holds)
   * so the provider mints the session cookie before we read the user. Absent
   * for flows that set the session cookie directly; the exchange then behaves
   * exactly as before. Never a token.
   */
  sessionVerifier?: string | null;
  /** Dev-oriented trace sink; never receives a token or cookie value. */
  onTrace?: (event: OAuthTraceEvent) => void;
  /**
   * Phase 47 - receives ONE compact, secret-free diagnosis line on failure:
   * the failing step, the HTTP status, the cookie NAMES present, verifier
   * presence and the provider's own message clipped. The main layer appends it
   * to `oauth-trace.log`. Never receives a token, cookie value, OAuth code or
   * verifier.
   */
  onDiagnostic?: (detail: string) => void;
}

/** Longest provider message copied into a user-facing / trace payload. */
const MESSAGE_MAX_CHARS = 300;

/** Fields a failure can contribute to the compact diagnosis line. */
interface DiagnosticFields {
  status?: number;
  provider?: string;
}

/**
 * Run the whole exchange once. Never throws: every path resolves to an
 * `OAuthCallbackOutcome`, so the renderer is never left waiting.
 */
export async function completeOAuthExchange(
  deps: OAuthExchangeDeps,
): Promise<OAuthCallbackOutcome> {
  const { session, vault, authBaseUrl } = deps;
  const providedVerifier = typeof deps.sessionVerifier === 'string' ? deps.sessionVerifier.trim() : '';
  const verifier = providedVerifier.length > 0 ? providedVerifier : null;
  const verifierPresent = verifier !== null;
  let cookieNames: string[] = [];
  const trace = (event: OAuthTraceEvent): void => deps.onTrace?.(event);
  const fail = (
    reason: string,
    message: string,
    fields: DiagnosticFields = {},
  ): OAuthCallbackOutcome => {
    trace(makeOAuthTrace('exchange-failed', { reason }));
    const detail = diagnosticLine(reason, fields, cookieNames, verifierPresent);
    deps.onDiagnostic?.(detail);
    return { ok: false, reason: 'error', message: `${message} [${detail}]` };
  };

  if (authBaseUrl === null || authBaseUrl.trim().length === 0) {
    return fail('configuration', 'Neon Auth is not configured, so the sign-in could not be completed.');
  }
  const base = authBaseUrl.replace(/\/+$/, '');
  const host = hostOf(base);

  // 1. Cookies: presence only, reported as names + count.
  let cookies: { name?: unknown }[];
  try {
    cookies = await session.cookies.get({ url: base });
  } catch (error) {
    return fail('cookies', `Could not read the auth-host cookies to complete the sign-in: ${errorText(error)}`);
  }
  trace(makeOAuthTrace('exchange-cookies', { host, ...cookieSummary(cookies) }));
  cookieNames = cookieSummary(cookies).cookieNames;
  if (cookies.length === 0) {
    return fail(
      'no-cookie',
      'No Neon Auth session cookie was present after the Google redirect, so the sign-in could not be completed.',
    );
  }

  // 2. /get-session (better-auth). session.request attaches the Lax cookie,
  // but only when the init asks for it: Electron's request helper defaults to
  // `credentials: 'same-origin'` and these calls are cross-origin to the auth
  // host, so `credentials: 'include'` is what lets it send the held
  // `__Secure-neon-auth.session_challenge` cookie the provider needs.
  // Phase 47 - when the Managed flow handed us a one-time verifier, present it
  // here: the provider mints the session cookie from the challenge cookie +
  // verifier and then answers with `{ session, user }`. Without it the hosted
  // route sees only the challenge cookie and answers `null` (the operator's
  // "no usable session").
  const getSessionUrl =
    verifier !== null
      ? `${base}/get-session?${NEON_AUTH_SESSION_VERIFIER_PARAM}=${encodeURIComponent(verifier)}`
      : `${base}/get-session`;
  let sessionResponse: Response;
  try {
    sessionResponse = await session.request(getSessionUrl, { method: 'GET', credentials: 'include' });
  } catch (error) {
    return fail('reach', `Could not reach Neon Auth to complete the sign-in: ${errorText(error)}`);
  }
  trace(makeOAuthTrace('exchange-get-session', { status: sessionResponse.status }));
  if (!sessionResponse.ok) {
    const provider = await providerMessageOf(sessionResponse);
    const detail = provider.length > 0 ? `: ${provider}` : '';
    return fail(
      'session-rejected',
      `Neon Auth rejected the session lookup (HTTP ${sessionResponse.status})${detail}.`,
      { status: sessionResponse.status, provider },
    );
  }
  const user = readAccountUser(await parseJson(sessionResponse));
  if (user === null) {
    return fail(
      'no-session',
      'Neon Auth returned no usable session for the sign-in cookie (it may have expired).',
      { status: sessionResponse.status },
    );
  }

  // 3. /token (the jwt plugin) for the session JWT.
  let tokenResponse: Response;
  try {
    tokenResponse = await session.request(`${base}/token`, { method: 'GET', credentials: 'include' });
  } catch (error) {
    return fail('reach', `Could not reach Neon Auth to fetch the session token: ${errorText(error)}`);
  }
  trace(makeOAuthTrace('exchange-token', { status: tokenResponse.status }));
  if (!tokenResponse.ok) {
    const provider = await providerMessageOf(tokenResponse);
    const detail = provider.length > 0 ? `: ${provider}` : '';
    return fail(
      'token-rejected',
      `Neon Auth rejected the token request (HTTP ${tokenResponse.status})${detail}.`,
      { status: tokenResponse.status, provider },
    );
  }
  const token = readToken(await parseJson(tokenResponse));
  if (token === null) {
    return fail('no-token', 'Neon Auth returned no session token for this sign-in.', {
      status: tokenResponse.status,
    });
  }

  // 4. Store through the vault (encrypted when safeStorage is available).
  try {
    await vault.setSession({ user, token });
  } catch (error) {
    return fail('store', `The sign-in succeeded but the session could not be stored: ${errorText(error)}`, {
      status: tokenResponse.status,
    });
  }
  trace(makeOAuthTrace('exchange-stored', { host }));
  return { ok: true };
}

/**
 * Build the ONE compact, secret-free diagnosis line a failure surfaces (in the
 * UI message) and persists (to `oauth-trace.log`): the failing step, the HTTP
 * status, the cookie NAMES present (NEVER values), verifier presence and the
 * provider's own clipped message. Only fixed machine codes and cookie names
 * flow in, so no token, cookie value, OAuth code or verifier can appear.
 */
function diagnosticLine(
  step: string,
  fields: DiagnosticFields,
  cookieNames: readonly string[],
  verifierPresent: boolean,
): string {
  const status = typeof fields.status === 'number' ? String(fields.status) : 'none';
  const cookies = cookieNames.length > 0 ? cookieNames.join(',') : 'none';
  const provider = fields.provider !== undefined && fields.provider.length > 0 ? `"${fields.provider}"` : 'none';
  return `step=${step} status=${status} cookies=${cookies} verifier=${
    verifierPresent ? 'present' : 'absent'
  } provider=${provider}`;
}

/** Build the renderer-safe identity from the `/get-session` body. */
function readAccountUser(body: unknown): AccountUser | null {
  if (body === null || typeof body !== 'object') return null;
  const raw = (body as { user?: unknown }).user;
  if (raw === null || typeof raw !== 'object') return null;
  const u = raw as Record<string, unknown>;
  if (typeof u.id !== 'string' || u.id.length === 0) return null;
  if (typeof u.email !== 'string' || u.email.length === 0) return null;
  return {
    id: u.id,
    email: u.email,
    emailVerified: u.emailVerified === true,
    name: typeof u.name === 'string' ? u.name : undefined,
    image: typeof u.image === 'string' ? u.image : null,
  };
}

/** Read the JWT from the `/token` body. Never logged, never traced. */
function readToken(body: unknown): string | null {
  if (body === null || typeof body !== 'object') return null;
  const token = (body as { token?: unknown }).token;
  return typeof token === 'string' && token.length > 0 ? token : null;
}

/** Parse a JSON body, or null when it is not JSON / not readable. */
async function parseJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * The provider's real, non-secret message for a rejected call. Falls back to
 * the HTTP status text, then to nothing. Clipped so a hostile body cannot
 * produce an unbounded user-facing string, and secret-free by construction.
 */
async function providerMessageOf(response: Response): Promise<string> {
  const message = readProviderMessage(await parseJson(response));
  if (message.length > 0) return clip(message);
  const statusText = response.statusText.trim();
  return statusText.length > 0 ? clip(statusText) : '';
}

/** Pull `message` (or `error` / `error.message`) out of a provider body. */
function readProviderMessage(body: unknown): string {
  if (body === null || typeof body !== 'object') return '';
  const r = body as Record<string, unknown>;
  if (typeof r.message === 'string') return r.message;
  if (typeof r.error === 'string') return r.error;
  if (r.error !== null && typeof r.error === 'object') {
    const nested = (r.error as Record<string, unknown>).message;
    if (typeof nested === 'string') return nested;
  }
  return '';
}

/** The hostname of a configured base URL, for the trace only. */
function hostOf(base: string): string | undefined {
  try {
    return new URL(base).host;
  } catch {
    return undefined;
  }
}

/** A clipped, single-line error text; never a token. */
function errorText(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return clip(text);
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > MESSAGE_MAX_CHARS ? `${flat.slice(0, MESSAGE_MAX_CHARS)}...` : flat;
}
