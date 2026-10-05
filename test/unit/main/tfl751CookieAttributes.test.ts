// TFL-751 chunk C1 - attribute-level cookie measurement for the sign-in
// failure diagnostic.
//
// The operator's browser sign-in is rejected with "Session challenge cookie
// not found". Names alone cannot tell a stale/legacy challenge from a missing
// one, so the diagnostic now reports each cookie's ATTRIBUTES
// (name|domain|path|sameSite|expires) - and NEVER a value. These tests pin the
// pure helper, the failure diagnostic line and the challenge-clear result.

import { describe, expect, it } from 'vitest';
import { cookieAttributes } from '../../../src/main/services/accounts/oauth-trace';
import {
  completeOAuthExchange,
  type OAuthExchangeSession,
} from '../../../src/main/services/accounts/oauth-exchange';
import {
  clearAuthChallengeCookies,
  type AuthCookies,
} from '../../../src/main/services/accounts/auth-cookies';

const BASE = 'https://auth.example.test/neondb/auth';
const CANONICAL = '__Secure-neon-auth.session_challenge';
const LEGACY = '__Secure-neon-auth.session_challange';

interface AttribCookie {
  name?: unknown;
  domain?: unknown;
  path?: unknown;
  sameSite?: unknown;
  expirationDate?: unknown;
  session?: unknown;
  value?: string;
}

describe('cookieAttributes', () => {
  it('renders name|domain|path|sameSite|expires and never a value', () => {
    const expirySeconds = 1893456000;
    const cookies: AttribCookie[] = [
      {
        name: CANONICAL,
        domain: 'auth.example.test',
        path: '/',
        sameSite: 'lax',
        expirationDate: expirySeconds,
        value: 'SECRET',
      },
      { name: LEGACY, value: 'SECRET' },
      { name: 'session-only', session: true, expirationDate: expirySeconds, value: 'SECRET' },
    ];

    const lines = cookieAttributes(cookies);
    const expectedExpiry = new Date(expirySeconds * 1000).toISOString();
    expect(lines[0]).toBe(`${CANONICAL}|auth.example.test|/|lax|${expectedExpiry}`);
    expect(lines[1]).toBe(`${LEGACY}|(none)|(none)|(none)|session`);
    expect(lines[2]).toBe(`session-only|(none)|(none)|(none)|session`);
    expect(lines.join('\n')).not.toContain('SECRET');
  });
});

describe('failure diagnostic carries cookie attributes', () => {
  it('appends attrs= with both challenge cookie names, never a value', async () => {
    const session: OAuthExchangeSession = {
      cookies: {
        get: async () => [
          { name: CANONICAL, domain: 'auth.example.test', path: '/', sameSite: 'lax', session: true, value: 'SECRET' },
          { name: LEGACY, value: 'SECRET' },
        ],
      },
      request: async () =>
        new Response(JSON.stringify({ message: 'Session challenge cookie not found' }), {
          status: 400,
          statusText: 'Bad Request',
          headers: { 'content-type': 'application/json' },
        }),
    };
    const lines: string[] = [];

    const outcome = await completeOAuthExchange({
      session,
      vault: { setSession: async () => ({}) },
      authBaseUrl: BASE,
      onDiagnostic: (detail) => lines.push(detail),
    });

    expect(outcome.ok).toBe(false);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('step=session-rejected');
    expect(lines[0]).toContain('status=400');
    expect(lines[0]).toContain('attrs=');
    expect(lines[0]).toContain(CANONICAL);
    expect(lines[0]).toContain(LEGACY);
    expect(lines[0]).not.toContain('SECRET');
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.message).toContain(lines[0]);
  });
});

describe('clearAuthChallengeCookies result', () => {
  it('returns present/removed by name only, best-effort on a remove failure', async () => {
    const removed: string[] = [];
    const cookies: AuthCookies = {
      get: async () => [
        { name: CANONICAL, value: 'SECRET' },
        { name: LEGACY, value: 'SECRET' },
        { name: '__Secure-neon-auth.session_token', value: 'TOKEN-SECRET' },
      ],
      remove: async (_url, name) => {
        if (name === LEGACY) throw new Error('cookie store unavailable');
        removed.push(name);
      },
    };

    const result = await clearAuthChallengeCookies(cookies, BASE);

    expect([...result.present].sort()).toEqual([CANONICAL, LEGACY].sort());
    expect(result.removed).toEqual([CANONICAL]);
    expect(removed).toEqual([CANONICAL]);
    expect(JSON.stringify(result)).not.toContain('SECRET');
    expect(JSON.stringify(result)).not.toContain('session_token');
  });

  it('returns empty present/removed when accounts are unconfigured', async () => {
    const cookies: AuthCookies = {
      get: async () => {
        throw new Error('must not be called');
      },
      remove: async () => {
        throw new Error('must not be called');
      },
    };
    await expect(clearAuthChallengeCookies(cookies, null)).resolves.toEqual({ present: [], removed: [] });
  });
});