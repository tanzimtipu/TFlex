// Phase 46 - `accounts:oauthTrace` shape and redaction tests.
//
// The trace is the diagnosis tool for a stuck Google sign-in popup, so its
// two hard properties are pinned here: the event SHAPE is stable, and the
// payload can NEVER carry an OAuth code, a callback token or a cookie VALUE.
// Pure helpers are tested directly; the loopback listener gets a real socket
// to prove `loopback-hit` carries the pathname only.

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: class {},
  screen: { getAllDisplays: vi.fn().mockReturnValue([]) },
}));

import {
  cookieSummary,
  makeOAuthTrace,
  sanitizeUrlForTrace,
} from '../../../src/main/services/accounts/oauth-trace';
import { OAuthCallbackService } from '../../../src/main/services/accounts/oauth-callback';
import {
  isAuthCompletionUrl,
  isLoopbackCompletionUrl,
} from '../../../src/main/window';
import type { OAuthTraceEvent } from '../../../src/shared/accounts';

const AUTH_HOST = 'auth.example.com';
const LOOPBACK = 'http://localhost:51234/oauth/callback?token=tok-abcdef';

const services: OAuthCallbackService[] = [];
afterEach(() => {
  for (const service of services.splice(0)) service.dispose();
});

describe('sanitizeUrlForTrace', () => {
  it('keeps scheme + host + pathname and drops the query and hash', () => {
    expect(sanitizeUrlForTrace('https://auth.example.com/callback/google?code=SECRET&state=s#frag')).toBe(
      'https://auth.example.com/callback/google',
    );
  });

  it('keeps the port and drops the loopback token', () => {
    expect(sanitizeUrlForTrace('http://localhost:51234/oauth/callback?token=SECRET')).toBe(
      'http://localhost:51234/oauth/callback',
    );
  });

  it('drops a file URL query', () => {
    expect(sanitizeUrlForTrace('file:///C:/app/index.html?debug=1')).toBe('file:///C:/app/index.html');
  });

  it('returns undefined for an unparseable value', () => {
    expect(sanitizeUrlForTrace('not a url')).toBeUndefined();
  });
});

describe('makeOAuthTrace', () => {
  it('stamps at + kind and copies the redaction-safe fields', () => {
    const event = makeOAuthTrace('popup-fail-load', { errorCode: -105, errorDescription: 'NAME_NOT_RESOLVED' }, 1234);
    expect(event).toEqual({
      at: 1234,
      kind: 'popup-fail-load',
      errorCode: -105,
      errorDescription: 'NAME_NOT_RESOLVED',
    });
  });

  it('produces only the declared keys', () => {
    const event = makeOAuthTrace('popup-closed', {});
    expect(Object.keys(event).sort()).toEqual(['at', 'kind']);
  });
});

describe('cookieSummary', () => {
  it('reports sorted unique names and the total count, never a value', () => {
    // A typed variable (not a fresh literal at the call site) so the extra
    // `value` field exists at runtime without tripping excess-property checks:
    // the helper must still be unable to surface it.
    const cookies: { name?: unknown; value?: string }[] = [
      { name: 'better-auth.session_token', value: 'SUPER-SECRET' },
      { name: '__Secure-neon-auth', value: 'ALSO-SECRET' },
      { name: 'better-auth.session_token', value: 'DUPLICATE-NAME' },
    ];
    const summary = cookieSummary(cookies);
    expect(summary.cookieNames).toEqual(['__Secure-neon-auth', 'better-auth.session_token']);
    expect(summary.cookieCount).toBe(3);
    expect(JSON.stringify(summary)).not.toContain('SUPER-SECRET');
    expect(JSON.stringify(summary)).not.toContain('ALSO-SECRET');
  });

  it('ignores entries with no usable name', () => {
    const summary = cookieSummary([{ name: '' }, { name: 42 }, {}]);
    expect(summary.cookieNames).toEqual([]);
    expect(summary.cookieCount).toBe(3);
  });
});

describe('isLoopbackCompletionUrl', () => {
  it('is true for the minted loopback URL with the provider query appended', () => {
    expect(isLoopbackCompletionUrl('http://localhost:51234/oauth/callback?code=abc&state=s', LOOPBACK)).toBe(
      true,
    );
  });

  it('ignores the query on the minted URL too', () => {
    expect(isLoopbackCompletionUrl('http://localhost:51234/oauth/callback', LOOPBACK)).toBe(true);
  });

  it('is false for a different port', () => {
    expect(isLoopbackCompletionUrl('http://localhost:51235/oauth/callback?token=x', LOOPBACK)).toBe(false);
  });

  it('is false for a different path on the same origin', () => {
    expect(isLoopbackCompletionUrl('http://localhost:51234/other', LOOPBACK)).toBe(false);
  });

  it('is false when no loopback URL is in flight', () => {
    expect(isLoopbackCompletionUrl('http://localhost:51234/oauth/callback', null)).toBe(false);
  });

  it('is false for an unparseable URL', () => {
    expect(isLoopbackCompletionUrl('not a url', LOOPBACK)).toBe(false);
  });
});

describe('isAuthCompletionUrl with the loopback rule', () => {
  it('accepts the loopback URL in addition to the auth callback and app origin', () => {
    expect(
      isAuthCompletionUrl('http://localhost:51234/oauth/callback?token=t', AUTH_HOST, null, LOOPBACK),
    ).toBe(true);
  });

  it('still accepts the auth host /callback and the app origin', () => {
    expect(isAuthCompletionUrl('https://auth.example.com/callback/google?code=abc', AUTH_HOST, null)).toBe(
      true,
    );
    expect(
      isAuthCompletionUrl('http://localhost:5173/?code=abc', AUTH_HOST, 'http://localhost:5173'),
    ).toBe(true);
  });

  it('rejects a lookalike loopback origin', () => {
    expect(
      isAuthCompletionUrl('http://localhost:51234.evil.test/oauth/callback', AUTH_HOST, null, LOOPBACK),
    ).toBe(false);
  });
});

describe('loopback-hit trace', () => {
  it('reports the callback path and never the token, on a real hit', async () => {
    const traces: OAuthTraceEvent[] = [];
    const service = new OAuthCallbackService({ onTrace: (event) => traces.push(event) });
    services.push(service);
    const { callbackUrl } = await service.start();
    const token = new URL(callbackUrl).searchParams.get('token') ?? '';
    expect(token.length).toBeGreaterThan(0);

    const response = await fetch(callbackUrl);
    expect(response.status).toBe(200);

    const hit = traces.find((event) => event.kind === 'loopback-hit');
    expect(hit).toBeDefined();
    expect(hit?.path).toBe('/oauth/callback');
    expect(hit?.url).toBeUndefined();
    expect(JSON.stringify(traces)).not.toContain(token);
  });

  it('does not report a hit for a non-callback path', async () => {
    const traces: OAuthTraceEvent[] = [];
    const service = new OAuthCallbackService({ onTrace: (event) => traces.push(event) });
    services.push(service);
    const { callbackUrl } = await service.start();
    await fetch(`${new URL(callbackUrl).origin}/other`);
    expect(traces.some((event) => event.kind === 'loopback-hit')).toBe(false);
  });
});

