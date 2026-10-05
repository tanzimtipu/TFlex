/**
 * Phase 46 - pure helpers behind `accounts:oauthTrace` (main process only).
 *
 * The trace exists so a stuck/blank Google sign-in popup can be diagnosed
 * from a log. Everything here is pure and dependency-free so the shape and
 * the redaction rules are unit-tested without Electron:
 *
 *  - `sanitizeUrlForTrace` drops the query and the hash, so a URL that carried
 *    an OAuth `code` / `state` / loopback token can never leak one;
 *  - `makeOAuthTrace` is the ONE constructor for a trace step, stamping `at`;
 *  - `cookieSummary` reports cookie NAMES and a COUNT only, never a value.
 *
 * No token, secret, OAuth code or cookie value is accepted by this module's
 * output shape.
 */

import type { OAuthTraceEvent, OAuthTraceKind } from '../../../shared/accounts';

/**
 * Reduce a URL to scheme + host + pathname. Query and hash are dropped so a
 * callback URL's `code` / `state` / `token` never appears in a trace. Returns
 * undefined for an unparseable value (nothing to report). For a `file://` URL
 * the host is empty and the pathname is kept, which is what identifies the
 * app renderer.
 */
export function sanitizeUrlForTrace(raw: string): string | undefined {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return undefined;
  }
  return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
}

/**
 * The ONE trace-step constructor. Any field set here is part of the public
 * `OAuthTraceEvent` shape and is therefore redaction-safe by construction.
 */
export function makeOAuthTrace(
  kind: OAuthTraceKind,
  fields: Omit<OAuthTraceEvent, 'at' | 'kind'> = {},
  now: number = Date.now(),
): OAuthTraceEvent {
  return { at: now, kind, ...fields };
}

/**
 * Summarize a `session.cookies.get()` result as sorted unique NAMES plus the
 * total count. The cookie VALUE is never read, so a session token cannot leak
 * through the trace.
 */
export function cookieSummary(
  cookies: readonly { name?: unknown }[],
): { cookieNames: string[]; cookieCount: number } {
  const names = new Set<string>();
  for (const cookie of cookies) {
    const name = cookie?.name;
    if (typeof name === 'string' && name.length > 0) names.add(name);
  }
  return { cookieNames: [...names].sort(), cookieCount: cookies.length };
}

/**
 * Phase 51 chunk C1 - report each cookie's ATTRIBUTES so a
 * "Session challenge cookie not found" rejection can be attributed to a
 * stale/legacy cookie rather than to a missing one. One
 * `name|domain|path|sameSite|expires` string per cookie; domain and path fall
 * back to `(none)`, and `expires` is the ISO string of `expirationDate` or
 * `session` when the cookie is a session cookie. The cookie VALUE is never
 * read, so no session token can leak through the diagnostic.
 */
export function cookieAttributes(
  cookies: readonly {
    name?: unknown;
    domain?: unknown;
    path?: unknown;
    sameSite?: unknown;
    expirationDate?: unknown;
    session?: unknown;
  }[],
): string[] {
  return cookies.map(
    (cookie) =>
      `${textOf(cookie?.name)}|${textOf(cookie?.domain)}|${textOf(cookie?.path)}|${textOf(
        cookie?.sameSite,
      )}|${expiresOf(cookie)}`,
  );
}

/** A cookie string attribute, or `(none)` when absent/non-string/empty. */
function textOf(value: unknown): string {
  return typeof value === 'string' && value.length > 0 ? value : '(none)';
}

/** A cookie's expiry as an ISO string, or `session` for a session cookie. */
function expiresOf(cookie: { expirationDate?: unknown; session?: unknown } | undefined): string {
  if (cookie?.session === true) return 'session';
  const raw = cookie?.expirationDate;
  if (raw instanceof Date && !Number.isNaN(raw.getTime())) return raw.toISOString();
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    const ms = raw > 1e12 ? raw : raw * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? 'session' : date.toISOString();
  }
  return 'session';
}
