// Phase 44 chunk 4 - auth popup URL decision tests.
//
// These cover the three PURE functions that back the main-window popup
// handler: `decideAuthPopup` (allow only https on the configured auth host),
// `deriveAuthHost`, and `isAuthCompletionUrl` (auth /callback path or the
// app's own URL). No BrowserWindow is constructed here; electron is mocked
// only so importing window.ts has its module dependency satisfied.

import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: class {},
  screen: { getAllDisplays: vi.fn().mockReturnValue([]) },
}));

import {
  decideAuthPopup,
  deriveAuthHost,
  isAppNavigationUrl,
  isAuthCompletionUrl,
} from '../../../src/main/window';

const AUTH_HOST = 'auth.example.com';

describe('decideAuthPopup', () => {
  it('allows an https URL on the configured auth host', () => {
    expect(decideAuthPopup('https://auth.example.com/sign-in/social', AUTH_HOST)).toBe('allow');
  });

  it('allows the auth host case-insensitively, with path and query', () => {
    expect(decideAuthPopup('https://AUTH.example.com/callback/google?code=abc', AUTH_HOST)).toBe(
      'allow',
    );
  });

  it('denies a different https host', () => {
    expect(decideAuthPopup('https://evil.example.com/', AUTH_HOST)).toBe('deny');
  });

  it('denies a subdomain of the auth host', () => {
    expect(decideAuthPopup('https://sub.auth.example.com/', AUTH_HOST)).toBe('deny');
  });

  it('denies an http URL on the auth host', () => {
    expect(decideAuthPopup('http://auth.example.com/', AUTH_HOST)).toBe('deny');
  });

  it('denies a javascript: URL', () => {
    expect(decideAuthPopup('javascript:alert(1)', AUTH_HOST)).toBe('deny');
  });

  it('denies a file: URL', () => {
    expect(decideAuthPopup('file:///C:/secret.txt', AUTH_HOST)).toBe('deny');
  });

  it('denies a malformed URL', () => {
    expect(decideAuthPopup('not a url at all', AUTH_HOST)).toBe('deny');
  });

  it('denies when no auth host is configured (null)', () => {
    expect(decideAuthPopup('https://auth.example.com/', null)).toBe('deny');
  });

  it('denies when the auth host is empty', () => {
    expect(decideAuthPopup('https://auth.example.com/', '   ')).toBe('deny');
  });
});

describe('deriveAuthHost', () => {
  it('extracts a bare lowercase hostname from the base URL', () => {
    expect(deriveAuthHost('https://Auth.Example.com/api/auth')).toBe('auth.example.com');
  });

  it('returns null for a null base URL', () => {
    expect(deriveAuthHost(null)).toBeNull();
  });

  it('returns null for an unparseable base URL', () => {
    expect(deriveAuthHost('::::')).toBeNull();
  });
});

describe('isAuthCompletionUrl', () => {
  it('is true for the auth host /callback path', () => {
    expect(isAuthCompletionUrl('https://auth.example.com/callback/google?code=abc', AUTH_HOST, null)).toBe(
      true,
    );
  });

  it('is true for the exact /callback path', () => {
    expect(isAuthCompletionUrl('https://auth.example.com/callback', AUTH_HOST, null)).toBe(true);
  });

  it('is false for a non-callback auth host path', () => {
    expect(isAuthCompletionUrl('https://auth.example.com/sign-in', AUTH_HOST, null)).toBe(false);
  });

  it('is true when the popup lands back on the app origin', () => {
    expect(
      isAuthCompletionUrl('http://localhost:5173/?code=abc', AUTH_HOST, 'http://localhost:5173'),
    ).toBe(true);
  });

  it('is false for an unrelated host', () => {
    expect(isAuthCompletionUrl('https://evil.example.com/callback', AUTH_HOST, 'http://localhost:5173')).toBe(
      false,
    );
  });

  it('is false for a malformed URL', () => {
    expect(isAuthCompletionUrl('not a url', AUTH_HOST, 'http://localhost:5173')).toBe(false);
  });
});

describe('isAppNavigationUrl', () => {
  it('is true for the exact app file pathname', () => {
    expect(
      isAppNavigationUrl('file:///C:/app/dist/index.html', 'file:///C:/app/dist/index.html'),
    ).toBe(true);
  });

  it('is true for the app file pathname with a hash or query', () => {
    expect(
      isAppNavigationUrl(
        'file:///C:/app/dist/index.html#detached',
        'file:///C:/app/dist/index.html',
      ),
    ).toBe(true);
  });

  it('is false for a different file pathname', () => {
    expect(isAppNavigationUrl('file:///C:/Windows/win.ini', 'file:///C:/app/dist/index.html')).toBe(
      false,
    );
  });

  it('is false for https://example.com/ against the app', () => {
    expect(
      isAppNavigationUrl('https://example.com/?tfl772=tabnabbing', 'http://localhost:5173'),
    ).toBe(false);
  });

  it('is true for the same dev origin', () => {
    expect(isAppNavigationUrl('http://localhost:5173/?code=abc', 'http://localhost:5173')).toBe(true);
  });

  it('is false for a different dev origin', () => {
    expect(isAppNavigationUrl('http://localhost:9999/', 'http://localhost:5173')).toBe(false);
  });

  it('is false when the app URL is null', () => {
    expect(isAppNavigationUrl('http://localhost:5173/', null)).toBe(false);
  });

  it('is false for a malformed target URL', () => {
    expect(isAppNavigationUrl('not a url', 'http://localhost:5173')).toBe(false);
  });
});
