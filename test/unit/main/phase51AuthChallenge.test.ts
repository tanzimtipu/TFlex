// Phase 51 - auth challenge cookie cleanup tests.
//
// The browser sign-in flow fails with "Session challenge cookie not found"
// when the exchange presents a challenge left over from an earlier attempt.
// `clearAuthChallengeCookies` removes the challenge cookies (and only those)
// from the app session before a flow starts. No Electron is needed: the cookie
// jar is a fake that records the removals.

import { describe, expect, it } from 'vitest';
import {
  clearAuthChallengeCookies,
  NEON_AUTH_CHALLENGE_COOKIE_NAMES,
  type AuthCookies,
} from '../../../src/main/services/accounts/auth-cookies';

interface Removal {
  url: string;
  name: string;
}

/** A fake cookie jar that records removals and can reject a given name. */
function fakeJar(rejectName?: string): { removals: Removal[]; cookies: AuthCookies } {
  const removals: Removal[] = [];
  return {
    removals,
    cookies: {
      async get(): Promise<{ name?: unknown }[]> {
        return [];
      },
      async remove(url: string, name: string): Promise<void> {
        removals.push({ url, name });
        if (name === rejectName) throw new Error('cookie store unavailable');
      },
    },
  };
}

const AUTH_BASE = 'https://ep-fragrant-pond-b3gqd6cf.neonauth.c-4.ap-southeast-1.aws.neon.tech/neondb/auth';

describe('Phase 51 auth challenge cookie cleanup', () => {
  it('covers the canonical name and the provider legacy misspelling', () => {
    expect(NEON_AUTH_CHALLENGE_COOKIE_NAMES).toContain('__Secure-neon-auth.session_challenge');
    expect(NEON_AUTH_CHALLENGE_COOKIE_NAMES).toContain('__Secure-neon-auth.session_challange');
    expect(NEON_AUTH_CHALLENGE_COOKIE_NAMES).toHaveLength(2);
  });

  it('removes both challenge cookies for the configured auth base URL', async () => {
    const jar = fakeJar();
    await clearAuthChallengeCookies(jar.cookies, AUTH_BASE);
    expect(jar.removals).toEqual([
      { url: AUTH_BASE, name: '__Secure-neon-auth.session_challenge' },
      { url: AUTH_BASE, name: '__Secure-neon-auth.session_challange' },
    ]);
  });

  it('never removes the session token (that would sign the user out)', async () => {
    const jar = fakeJar();
    await clearAuthChallengeCookies(jar.cookies, AUTH_BASE);
    const names = jar.removals.map((r) => r.name);
    expect(names).not.toContain('__Secure-neon-auth.session_token');
    expect(names.every((n) => n.includes('session_challenge') || n.includes('session_challange'))).toBe(true);
  });

  it('does nothing when accounts are unconfigured', async () => {
    for (const value of [null, '', '   ']) {
      const jar = fakeJar();
      await clearAuthChallengeCookies(jar.cookies, value);
      expect(jar.removals).toHaveLength(0);
    }
  });

  it('swallows a removal failure and still clears the other name', async () => {
    const jar = fakeJar('__Secure-neon-auth.session_challenge');
    const result = await clearAuthChallengeCookies(jar.cookies, AUTH_BASE);
    expect(result.removed).toEqual(['__Secure-neon-auth.session_challange']);
    expect(result.present).toEqual([]);
    expect(jar.removals.map((r) => r.name)).toEqual([
      '__Secure-neon-auth.session_challenge',
      '__Secure-neon-auth.session_challange',
    ]);
  });
});
