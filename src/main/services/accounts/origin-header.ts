/**
 * Phase 46 - present a trusted Origin to the auth host (main process only).
 *
 * In the PACKAGED app the renderer is loaded from `file://`, so the requests
 * it sends carry NO `Origin` header (`origin=(none)`). The auth provider's
 * branch refuses every Origin-checked route in that case: Google social
 * sign-in returns 403 INVALID_CALLBACKURL, password reset returns 403
 * "Invalid redirectURL", and email sign-in returns 403 "Missing or null
 * Origin" - which is why registration fails regardless of the credentials
 * typed.
 *
 * The branch's configuration explicitly allows `localhost` origins
 * (`allow_localhost`), so the app declares itself as the localhost client it
 * actually is: for requests whose URL host is EXACTLY the configured auth
 * host, and only that host, we add `Origin: http://localhost:5173` when (and
 * only when) the request has no Origin of its own.
 *
 * Security scope, deliberately narrow:
 *  - the auth host is the ONLY host covered. The Data API host and the
 *    Function host never receive the header (neither needs an Origin the
 *    provider already trusts; adding one would hand out a forged origin for
 *    no reason);
 *  - an existing Origin is NEVER overwritten, so the rule cannot launder a
 *    genuine origin sent by the dev renderer or the auth popup;
 *  - the injected value is exactly the dev origin the branch already trusts,
 *    so the packaged app claims no capability an unmodified dev build does
 *    not already exercise.
 *
 * The rule is a PURE function so it can be unit-tested without Electron.
 */

/** The localhost dev origin the auth branch trusts through `allow_localhost`. */
export const TRUSTED_AUTH_ORIGIN = 'http://localhost:5173';

/** Minimal slice of the Electron request details the rule reads. */
export interface AuthOriginRequest {
  url: string;
  requestHeaders: Record<string, string>;
}

/**
 * Decide the `Origin` value for a request, or null to leave it untouched.
 * Adds the trusted origin ONLY when the URL parses and its host is exactly the
 * configured auth host; every other host (including a different port or a
 * subdomain of the auth host) yields null. A missing/empty auth host is a
 * no-op. Pure and exported for the unit tests.
 */
export function resolveAuthOriginHeader(
  requestUrl: string,
  authHost: string | null,
): string | null {
  const host = (authHost ?? '').trim().toLowerCase();
  if (host.length === 0) return null;
  let parsed: URL;
  try {
    parsed = new URL(requestUrl);
  } catch {
    return null;
  }
  if (parsed.hostname.trim().toLowerCase() !== host) return null;
  return TRUSTED_AUTH_ORIGIN;
}

/**
 * Apply the rule to one request. Returns the headers to send: the original
 * set when the rule does not apply or an Origin is already present, or a copy
 * carrying the trusted Origin otherwise. Pure and exported for the tests.
 */
export function applyAuthOriginHeader(
  request: AuthOriginRequest,
  authHost: string | null,
): Record<string, string> {
  if (hasHeader(request.requestHeaders, 'origin')) return request.requestHeaders;
  const origin = resolveAuthOriginHeader(request.url, authHost);
  if (origin === null) return request.requestHeaders;
  return { ...request.requestHeaders, Origin: origin };
}

/** The slice of Electron's session the installer needs (kept structural so a
 *  fake session can drive it in tests). */
export interface AuthOriginSession {
  webRequest: {
    onBeforeSendHeaders(
      listener: (
        details: AuthOriginRequest,
        callback: (response: { requestHeaders: Record<string, string> }) => void,
      ) => void,
    ): void;
  };
}

/**
 * Install the rule on the app's session. `getAuthHost` is resolved per request
 * from the live accounts config, so a config change without a restart is
 * honoured. The listener replaces no existing webRequest listener (the app
 * attaches none).
 */
export function installAuthOriginHeader(
  session: AuthOriginSession,
  getAuthHost: () => string | null,
): void {
  session.webRequest.onBeforeSendHeaders((details, callback) => {
    callback({ requestHeaders: applyAuthOriginHeader(details, getAuthHost()) });
  });
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const wanted = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === wanted) return true;
  }
  return false;
}
