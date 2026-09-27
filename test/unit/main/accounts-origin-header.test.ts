// Phase 46 - auth Origin header rule tests.
//
// The rule makes the packaged app (loaded from `file://`, so it sends no
// Origin) present the localhost origin the auth branch trusts, but ONLY to the
// configured auth host and only when the request has no Origin of its own.
// Covers the pure rule, the add/preserve semantics, and the installer wiring
// against a fake Electron session (no Electron process is launched).

import { describe, expect, it, vi } from 'vitest';
import {
  applyAuthOriginHeader,
  installAuthOriginHeader,
  resolveAuthOriginHeader,
  TRUSTED_AUTH_ORIGIN,
  type AuthOriginRequest,
  type AuthOriginSession,
} from '../../../src/main/services/accounts/origin-header';

const AUTH_HOST = 'auth.example.com';

function request(url: string, requestHeaders: Record<string, string> = {}): AuthOriginRequest {
  return { url, requestHeaders };
}

describe('resolveAuthOriginHeader', () => {
  it('returns the trusted origin for a request to the configured auth host', () => {
    expect(resolveAuthOriginHeader('https://auth.example.com/sign-in/email', AUTH_HOST)).toBe(
      TRUSTED_AUTH_ORIGIN,
    );
    expect(TRUSTED_AUTH_ORIGIN).toBe('http://localhost:5173');
  });

  it('matches the auth host case-insensitively', () => {
    expect(resolveAuthOriginHeader('https://AUTH.Example.com/x', AUTH_HOST)).toBe(TRUSTED_AUTH_ORIGIN);
  });

  it('returns null for any other host', () => {
    expect(resolveAuthOriginHeader('https://evil.example.com/x', AUTH_HOST)).toBeNull();
    expect(
      resolveAuthOriginHeader('https://ep-fragrant-pond.apirest.neon.tech/x', AUTH_HOST),
    ).toBeNull();
  });

  it('returns null for a subdomain of the auth host', () => {
    expect(resolveAuthOriginHeader('https://sub.auth.example.com/x', AUTH_HOST)).toBeNull();
  });

  it('returns null when no auth host is configured', () => {
    expect(resolveAuthOriginHeader('https://auth.example.com/x', null)).toBeNull();
    expect(resolveAuthOriginHeader('https://auth.example.com/x', '   ')).toBeNull();
  });

  it('returns null for a malformed URL', () => {
    expect(resolveAuthOriginHeader('not a url at all', AUTH_HOST)).toBeNull();
  });
});

describe('applyAuthOriginHeader', () => {
  it('adds the trusted origin when the request has none', () => {
    const headers = applyAuthOriginHeader(request('https://auth.example.com/x'), AUTH_HOST);
    expect(headers.Origin).toBe(TRUSTED_AUTH_ORIGIN);
  });

  it('never overwrites an existing Origin (exact key)', () => {
    const original = request('https://auth.example.com/x', { Origin: 'https://real.example.com' });
    const headers = applyAuthOriginHeader(original, AUTH_HOST);
    expect(headers.Origin).toBe('https://real.example.com');
  });

  it('never overwrites an existing Origin (lowercase key)', () => {
    const original = request('https://auth.example.com/x', { origin: 'https://real.example.com' });
    const headers = applyAuthOriginHeader(original, AUTH_HOST);
    expect(headers.origin).toBe('https://real.example.com');
    expect(headers.Origin).toBeUndefined();
  });

  it('returns the untouched header set for a non-auth host', () => {
    const original = request('https://data.example.com/x');
    expect(applyAuthOriginHeader(original, AUTH_HOST)).toBe(original.requestHeaders);
  });

  it('is a no-op when no auth host is configured', () => {
    const original = request('https://auth.example.com/x');
    expect(applyAuthOriginHeader(original, null)).toBe(original.requestHeaders);
  });
});

describe('installAuthOriginHeader', () => {
  /** Records the listener the installer attaches so a test can drive it. */
  function fakeSession(): {
    session: AuthOriginSession;
    fire: (details: AuthOriginRequest) => Record<string, string>;
  } {
    let listener:
      | ((
          details: AuthOriginRequest,
          callback: (response: { requestHeaders: Record<string, string> }) => void,
        ) => void)
      | null = null;
    const session: AuthOriginSession = {
      webRequest: {
        onBeforeSendHeaders(fn): void {
          listener = fn;
        },
      },
    };
    return {
      session,
      fire: (details) => {
        let result: Record<string, string> = {};
        listener!(details, (response) => {
          result = response.requestHeaders;
        });
        return result;
      },
    };
  }

  it('attaches a listener and adds the origin for the auth host only', () => {
    const { session, fire } = fakeSession();
    installAuthOriginHeader(session, () => AUTH_HOST);
    expect(fire({ url: 'https://auth.example.com/x', requestHeaders: {} }).Origin).toBe(
      TRUSTED_AUTH_ORIGIN,
    );
    expect(fire({ url: 'https://evil.example.com/x', requestHeaders: {} }).Origin).toBeUndefined();
  });

  it('resolves the host per request (config changes are honoured)', () => {
    const { session, fire } = fakeSession();
    const host = vi.fn().mockReturnValue(AUTH_HOST);
    installAuthOriginHeader(session, host);
    fire({ url: 'https://auth.example.com/x', requestHeaders: {} });
    host.mockReturnValue(null);
    expect(fire({ url: 'https://auth.example.com/x', requestHeaders: {} }).Origin).toBeUndefined();
  });
});
