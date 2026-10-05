/**
 * Phase 51 - clear the stale Neon Auth session-challenge cookies BEFORE a new
 * sign-in flow starts.
 *
 * The hosted OAuth callback mints a one-time `neon_auth_session_verifier` that
 * main presents to `<auth>/get-session`. The provider accepts it only when the
 * request ALSO carries the `*.session_challenge` cookie established by THIS
 * flow's own `signIn.social` call - see the installed `@neondatabase/auth`
 * server middleware `exchangeOAuthToken`, which requires `hasVerifier &&
 * hasSessionChallengeCookie`. A challenge left over from an earlier attempt is
 * a different server-side challenge, so the provider answers `400 Session
 * challenge cookie not found` even though a cookie with that name is present.
 * Removing the challenge cookies at flow START (before the renderer's
 * `signIn.social` issues a fresh one) closes that failure mode.
 *
 * Deliberately narrow and secret-free:
 *  - only the two challenge cookie names are removed; the session token is
 *    NEVER touched, because removing it would sign the user out;
 *  - no cookie VALUE is ever read (the removal is name-based);
 *  - best-effort: a remove failure never breaks the sign-in.
 */

/**
 * The Neon Auth session-challenge cookie names. The misspelled name is the
 * provider's own legacy name, retained server-side during its migration; a
 * request is accepted with either, so both stale copies must go.
 */
export const NEON_AUTH_CHALLENGE_COOKIE_NAMES = [
  '__Secure-neon-auth.session_challenge',
  '__Secure-neon-auth.session_challange',
] as const;

/**
 * The slice of Electron's session cookie jar this helper needs. Structural so
 * a fake drives the unit tests without Electron.
 */
export interface AuthCookies {
  get(filter: { url: string }): Promise<{ name?: unknown }[]>;
  remove(url: string, name: string): Promise<void>;
}

/**
 * Remove any challenge cookie the app session still holds for the configured
 * auth host, so the next flow presents only the challenge its own
 * `signIn.social` call establishes. Does nothing when accounts are
 * unconfigured; never rejects.
 *
 * Phase 51 chunk C1 - returns which of the two challenge cookie NAMES were
 * present before the clear and which removes succeeded, so the flow log can
 * show whether a stale/legacy challenge survived. Names only; no cookie value
 * is ever read.
 */
export async function clearAuthChallengeCookies(
  cookies: AuthCookies,
  authBaseUrl: string | null,
): Promise<{ present: string[]; removed: string[] }> {
  const url = (authBaseUrl ?? '').trim();
  if (url.length === 0) return { present: [], removed: [] };
  const challengeNames = new Set<string>(NEON_AUTH_CHALLENGE_COOKIE_NAMES);
  let held: string[] = [];
  try {
    const found = await cookies.get({ url });
    held = found
      .map((cookie) => cookie?.name)
      .filter((name): name is string => typeof name === 'string' && challengeNames.has(name));
  } catch {
    // Best effort: if the jar cannot be read, still attempt the removals.
    held = [];
  }
  const present = [...new Set(held)].sort();
  const removed: string[] = [];
  for (const name of NEON_AUTH_CHALLENGE_COOKIE_NAMES) {
    try {
      await cookies.remove(url, name);
      removed.push(name);
    } catch {
      // Best effort: a cookie that cannot be removed must not break sign-in.
    }
  }
  return { present, removed };
}
