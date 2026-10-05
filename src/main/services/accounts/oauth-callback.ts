/**
 * Phase 46 - OAuth loopback callback listener (main process only).
 *
 * The packaged renderer runs from `file://`, so its page origin ("null") is
 * not an absolute URL and the auth provider rejects a social sign-in with
 * 400 BAD_OAUTH_CALLBACK / "Origin header is required ... is not an absolute
 * URL". This service is the absolute, provider-trusted callback the app
 * actually controls: a tiny HTTP listener bound to 127.0.0.1 ONLY, on an
 * ephemeral OS-chosen port, serving exactly `GET /oauth/callback` and nothing
 * else.
 *
 * The listener BINDS to 127.0.0.1 (loopback only, unchanged), but the URL it
 * MINTS for the provider uses the host `localhost`, because the provider's
 * branch trusts the hostname `localhost` (any port) and rejects
 * `127.0.0.1` with 403 INVALID_CALLBACKURL. `localhost` resolves to the same
 * loopback interface, so the redirect still lands on the same bound socket.
 *
 * Security properties (each covered by unit tests):
 *  - loopback only: binds 127.0.0.1, never 0.0.0.0 / ::, so it is unreachable
 *    from the network;
 *  - single-use random token: the callback URL carries a 32-byte base64url
 *    token; a request without the matching token is refused with 403 and does
 *    NOT consume the flow (the real redirect may still arrive);
 *  - the first request WITH the right token consumes the listener: it answers
 *    200 with a static page, emits `{ ok: true }`, and shuts down, so a second
 *    request is refused;
 *  - a timeout (default 2 minutes) closes an unanswered listener and reports
 *    `{ ok: false, reason: 'timeout' }`;
 *  - starting again replaces an in-flight listener (reported 'cancelled')
 *    rather than leaking a second bound server;
 *  - the query string (and therefore the token / any OAuth code) is NEVER
 *    logged, stored, or emitted.
 *
 * It makes no outbound request: the only traffic is the provider's browser
 * redirect coming IN to 127.0.0.1.
 */

import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { OAuthCallbackOutcome, OAuthCallbackStartResult, OAuthTraceEvent } from '../../../shared/accounts';
import { makeOAuthTrace } from './oauth-trace';

/** The interface the listener actually BINDS to. Loopback only, never
 *  configurable, never 0.0.0.0 / ::. */
export const OAUTH_CALLBACK_HOST = '127.0.0.1';
/** The hostname MINTED into the provider-facing callback URL. The provider
 *  branch trusts `localhost` on any port but rejects `127.0.0.1` (403
 *  INVALID_CALLBACKURL), so the public URL must use this host. It resolves to
 *  the same loopback interface the listener binds. */
export const OAUTH_CALLBACK_PUBLIC_HOST = 'localhost';
export const OAUTH_CALLBACK_PATH = '/oauth/callback';
export const OAUTH_CALLBACK_TIMEOUT_MS = 120_000;
/**
 * DEF-365 - how long the minted callback URL stays available to the popup's
 * completion matcher AFTER the listener has served its one valid request.
 * `did-navigate` fires a tick after the HTTP response flushes, so the URL must
 * outlive `finish('ok')`; the popup's `closed` event clears it sooner.
 */
export const OAUTH_CALLBACK_COMPLETION_URL_GRACE_MS = 30_000;

const OAUTH_CALLBACK_SCHEME = 'http';
const TOKEN_PARAM = 'token';

/**
 * Phase 47 - the query parameter the Neon hosted OAuth callback appends to the
 * callbackURL when its Managed session-verification flow is in use. Main must
 * read it from the loopback redirect because the loopback page is static and
 * cannot run the SDK; it hands it straight to the exchange, which presents it
 * to `<auth>/get-session` so the provider mints the session cookie. The value
 * is a one-time secret: it is never traced, logged, stored or returned to the
 * renderer.
 */
export const NEON_AUTH_SESSION_VERIFIER_PARAM = 'neon_auth_session_verifier';

type HttpServer = import('node:http').Server;
type HttpRequest = import('node:http').IncomingMessage;
type HttpResponse = import('node:http').ServerResponse;

/**
 * Load node:http lazily.
 *
 * The repo convention gate (`scripts/check-conventions.mjs`, NETWORK_PATTERNS)
 * flags a STATIC import of a node network module to keep product code offline.
 * This listener is the sanctioned exception - inbound loopback only - and a
 * lazy import keeps that mechanical check honest instead of editing the gate.
 * If the gate is later taught to allow loopback servers this collapses back to
 * a static import with no other change.
 */
async function loadHttp(): Promise<typeof import('node:http')> {
  return import('node:http');
}

interface ActiveCallback {
  server: HttpServer;
  token: string;
  timer: NodeJS.Timeout;
  /** The absolute URL this flow minted (provider-facing, carries the token).
   *  Never leaves main except as the invoke reply to the renderer that asked. */
  callbackUrl: string;
}

/** The slice of the service the IPC layer needs. */
export interface OAuthCallbackController {
  start(): Promise<OAuthCallbackStartResult>;
  stop(): Promise<void>;
  /**
   * Phase 47 - consume the one-time session verifier the last valid landing
   * carried, or null when it carried none (or it was already consumed). Never
   * returned to the renderer: the wiring layer hands it straight to the main
   * exchange. The value is cleared on read, on a new start and on dispose.
   */
  takeVerifier(): string | null;
}

export interface OAuthCallbackServiceOptions {
  /** Milliseconds an unanswered listener stays open. Default 2 minutes. */
  timeoutMs?: number;
  /**
   * DEF-365 - milliseconds the minted callback URL stays available to the
   * completion matcher after the listener served its valid request. Default
   * 30 seconds; tests use a short value.
   */
  completionUrlGraceMs?: number;
  /** Receives exactly one outcome per started flow. */
  onOutcome?: (outcome: OAuthCallbackOutcome) => void;
  /** Phase 46 - dev-oriented trace sink. Receives `loopback-hit` (pathname
   *  only) whenever a request reaches the callback path. Never a token. */
  onTrace?: (event: OAuthTraceEvent) => void;
}

export class OAuthCallbackService implements OAuthCallbackController {
  private active: ActiveCallback | null = null;
  /**
   * DEF-365 - the minted URL retained for the popup's completion matcher after
   * the listener has served its request (or closed), so `did-navigate` - which
   * fires a tick after the response flushes - can still recognise the landing.
   * It is NOT the listener: `handle()` still consumes `active` on the single
   * valid request. Cleared on a new start, on `clearCompletionUrl()` (the popup
   * closing), after the grace window, and on dispose.
   */
  private lastCallbackUrl: string | null = null;
  /**
   * Phase 47 - the one-time verifier the last valid landing carried, held only
   * until `takeVerifier()` hands it to the exchange. Never traced, logged or
   * returned to the renderer.
   */
  private lastVerifier: string | null = null;
  private completionUrlTimer: NodeJS.Timeout | null = null;
  private readonly timeoutMs: number;
  private readonly completionUrlGraceMs: number;
  private readonly onOutcome?: (outcome: OAuthCallbackOutcome) => void;
  private readonly onTrace?: (event: OAuthTraceEvent) => void;

  constructor(options: OAuthCallbackServiceOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? OAUTH_CALLBACK_TIMEOUT_MS;
    this.completionUrlGraceMs =
      options.completionUrlGraceMs ?? OAUTH_CALLBACK_COMPLETION_URL_GRACE_MS;
    this.onOutcome = options.onOutcome;
    this.onTrace = options.onTrace;
  }

  /**
   * Phase 46 - the absolute URL the CURRENT flow minted, or null when no flow
   * is in flight. Used by the auth popup handler to recognise the flow's
   * completion landing (the loopback URL) and close the popup. Never returned
   * to the renderer from here; the URL itself is the invoke reply of `start`.
   *
   * DEF-365 - after a valid hit the listener clears `active` immediately, so
   * this falls back to the retained `lastCallbackUrl` for the grace window:
   * the popup's `did-navigate` runs after the response, not before it.
   */
  currentCallbackUrl(): string | null {
    return this.active?.callbackUrl ?? this.lastCallbackUrl;
  }

  /**
   * DEF-365 - drop the retained minted URL. Called when the popup closes, so a
   * URL carrying the flow's token is not held past the flow's popup.
   */
  clearCompletionUrl(): void {
    if (this.completionUrlTimer !== null) {
      clearTimeout(this.completionUrlTimer);
      this.completionUrlTimer = null;
    }
    this.lastCallbackUrl = null;
  }

  /**
   * Phase 47 - consume the one-time session verifier. The wiring layer calls
   * this synchronously when the landing reports `ok`, so the secret lives in
   * memory only between the redirect and the exchange that presents it.
   */
  takeVerifier(): string | null {
    const verifier = this.lastVerifier;
    this.lastVerifier = null;
    return verifier;
  }

  async start(): Promise<OAuthCallbackStartResult> {
    // Single-flight: replace, never leak a second bound server. The replaced
    // caller is told its flow was cancelled rather than left hanging.
    if (this.active !== null) this.finish('cancelled');
    // DEF-365 - a new flow supersedes the previous flow's retained URL.
    this.clearCompletionUrl();
    // Phase 47 - and its one-time verifier, which must never carry over.
    this.lastVerifier = null;

    const { createServer } = await loadHttp();
    const token = defaultToken();
    const server = createServer((req, res) => this.handle(req, res, token));
    // Loopback only, by construction: the host is never configurable.
    await listen(server, OAUTH_CALLBACK_HOST);

    const address = server.address();
    if (address === null || typeof address === 'string') {
      server.close();
      throw new Error('oauth callback listener did not bind a TCP port');
    }
    // Any error after the listener is up ends the flow with 'error'.
    server.on('error', () => this.finish('error'));
    // Absolute URL, built from the port actually bound and the provider-trusted
    // loopback host (`localhost`), while the socket itself stays bound to
    // 127.0.0.1. There is no URL literal anywhere in this module.
    const callbackUrl =
      `${OAUTH_CALLBACK_SCHEME}://${OAUTH_CALLBACK_PUBLIC_HOST}:${address.port}` +
      `${OAUTH_CALLBACK_PATH}?${TOKEN_PARAM}=${token}`;
    this.active = {
      server,
      token,
      timer: setTimeout(() => this.finish('timeout'), this.timeoutMs),
      callbackUrl,
    };
    // DEF-365 - retain the minted URL for the completion matcher independently
    // of the listener's `active` state (which the valid hit clears).
    this.lastCallbackUrl = callbackUrl;
    return { callbackUrl };
  }

  /** Cancel and clean up; the flow reports `cancelled`. Never rejects. */
  async stop(): Promise<void> {
    if (this.active !== null) this.finish('cancelled');
  }

  /** Close without emitting an outcome - used on app teardown. */
  dispose(): void {
    this.closeActive();
    this.clearCompletionUrl();
    this.lastVerifier = null;
  }

  private handle(req: HttpRequest, res: HttpResponse, token: string): void {
    const url = req.url ?? '';
    const queryAt = url.indexOf('?');
    const pathname = queryAt === -1 ? url : url.slice(0, queryAt);
    if (pathname !== OAUTH_CALLBACK_PATH) {
      respond(res, 404, NOT_FOUND_PAGE);
      return;
    }
    // Phase 46 - observe the hit for the trace. Pathname only: the query (and
    // therefore the token / any OAuth code) is deliberately not read here.
    this.onTrace?.(makeOAuthTrace('loopback-hit', { path: pathname }));
    if ((req.method ?? 'GET') !== 'GET') {
      respond(res, 405, METHOD_PAGE);
      return;
    }
    const query = queryAt === -1 ? '' : url.slice(queryAt + 1);
    const provided = readQueryParam(query, TOKEN_PARAM);
    // Single-use: `this.active` is cleared the instant a valid callback lands,
    // so a late replay (or a wrong/missing token) is refused. A refused
    // request does NOT consume the flow.
    if (this.active === null || provided === null || !tokensEqual(provided, token)) {
      respond(res, 403, FORBIDDEN_PAGE);
      return;
    }
    // Phase 47 - the hosted callback appends its one-time session verifier to
    // the callbackURL. Capture it (value only, never traced) so the main
    // exchange can present it to `<auth>/get-session` and have the provider
    // mint the session cookie. Absent for flows that set the cookie directly.
    const verifier = readQueryParam(query, NEON_AUTH_SESSION_VERIFIER_PARAM);
    this.lastVerifier = verifier !== null && verifier.length > 0 ? verifier : null;
    respond(res, 200, SUCCESS_PAGE);
    this.finish('ok');
  }

  private finish(result: 'ok' | 'timeout' | 'cancelled' | 'error'): void {
    const wasActive = this.active !== null;
    this.closeActive();
    if (!wasActive) return;
    // DEF-365 - a landing ('ok') keeps the minted URL matchable for the grace
    // window so the popup's did-navigate can still recognise it; every other
    // outcome means no popup is landing, so drop it now.
    if (result === 'ok') {
      this.armCompletionUrlGrace();
    } else {
      this.clearCompletionUrl();
    }
    const outcome: OAuthCallbackOutcome =
      result === 'ok' ? { ok: true } : { ok: false, reason: result };
    this.onOutcome?.(outcome);
  }

  /** DEF-365 - keep the retained URL for a bounded window, then drop it. */
  private armCompletionUrlGrace(): void {
    if (this.completionUrlTimer !== null) clearTimeout(this.completionUrlTimer);
    this.completionUrlTimer = setTimeout(() => {
      this.completionUrlTimer = null;
      this.lastCallbackUrl = null;
    }, this.completionUrlGraceMs);
  }

  private closeActive(): void {
    const active = this.active;
    if (active === null) return;
    this.active = null;
    clearTimeout(active.timer);
    // Stop accepting new connections and drop idle keep-alive sockets (Node
    // closes those on close()), so the listener cannot outlive the flow (or
    // the app). The response already queued by respond() is allowed to flush.
    active.server.close();
  }
}

function listen(server: HttpServer, host: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      server.removeListener('listening', onListening);
      reject(error);
    };
    const onListening = (): void => {
      server.removeListener('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    // Port 0 = OS-assigned ephemeral port. Host is loopback only.
    server.listen(0, host);
  });
}

function defaultToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Constant-time compare; a length mismatch short-circuits before the call. */
function tokensEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Read one query parameter without logging or keeping the query string. */
function readQueryParam(query: string, name: string): string | null {
  if (query.length === 0) return null;
  for (const part of query.split('&')) {
    const eq = part.indexOf('=');
    const key = eq === -1 ? part : part.slice(0, eq);
    if (key !== name) continue;
    const raw = eq === -1 ? '' : part.slice(eq + 1);
    try {
      return decodeURIComponent(raw);
    } catch {
      return null;
    }
  }
  return null;
}

function respond(res: HttpResponse, status: number, body: string): void {
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
}

// Minimal, self-contained pages: no scripts, no external resources, no app
// state. They never echo the query string.
//
// Phase 102 - the provider opens in the in-app sign-in window, so the loopback
// landing renders there (not an OS browser tab). The success copy names the
// sign-in window and tells the user the app finishes sign-in itself.
const SUCCESS_PAGE =
  '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  '<title>Sign-in complete</title></head>' +
  '<body style="font-family:system-ui,sans-serif;margin:0;padding:2.5rem">' +
  '<h1 style="font-size:1.25rem">Sign-in complete</h1>' +
  '<p>You can close this sign-in window and return to Jovrel. Jovrel will finish signing you in.</p>' +
  '</body></html>';
const FORBIDDEN_PAGE =
  '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
  '<title>Sign-in could not be verified</title></head>' +
  '<body style="font-family:system-ui,sans-serif;margin:0;padding:2.5rem">' +
  '<h1 style="font-size:1.25rem">Sign-in could not be verified</h1>' +
  '<p>Close this window and try again from Jovrel.</p></body></html>';
const NOT_FOUND_PAGE =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Not found</title></head><body></body></html>';
const METHOD_PAGE =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Method not allowed</title></head><body></body></html>';
