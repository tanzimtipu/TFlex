// Phase 50 - OS link opening tests.
//
// Covers the browser-sign-in URL validator + handler (`accounts:openAuthUrl`)
// and the Default-apps settings handler (`app:openDefaultAppsSettings`):
//   - auth-host https accepted; another host, a subdomain, http, javascript:,
//     file:, malformed, empty and non-string each REFUSED;
//   - the exact ok / failed result shapes;
//   - the handlers never throw, and a refused URL is NEVER passed to the OS;
//   - the settings URI constant;
//   - the updated loopback return-page copy (asserted in the existing
//     accounts-oauth-callback spec, which owns the listener harness).
//
// electron is mocked only so importing `os-links` -> `window` has its module
// dependency satisfied; the handler under test takes `shell` by injection and
// constructs no Electron object.

import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: class {},
  screen: { getAllDisplays: vi.fn().mockReturnValue([]) },
}));

import {
  DEFAULT_APPS_SETTINGS_URI,
  isAllowedAuthUrl,
  openAuthUrlExternally,
  openDefaultAppsSettings,
  type OpenExternalLike,
} from '../../../src/main/services/os-links';

const AUTH_HOST = 'auth.example.com';

function fakeShell(): { openExternal: ReturnType<typeof vi.fn>; shell: OpenExternalLike } {
  const openExternal = vi.fn(async (): Promise<void> => {});
  return { openExternal, shell: { openExternal } };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe('isAllowedAuthUrl', () => {
  it('accepts an https URL on the configured auth host, with path and query', () => {
    expect(isAllowedAuthUrl('https://auth.example.com/sign-in/social?provider=google', AUTH_HOST))
      .toBe(true);
  });

  it('accepts the auth host case-insensitively', () => {
    expect(isAllowedAuthUrl('https://AUTH.example.com/callback/google', AUTH_HOST)).toBe(true);
  });

  it('refuses another https host', () => {
    expect(isAllowedAuthUrl('https://evil.example.com/', AUTH_HOST)).toBe(false);
  });

  it('refuses a subdomain of the auth host', () => {
    expect(isAllowedAuthUrl('https://sub.auth.example.com/', AUTH_HOST)).toBe(false);
  });

  it('refuses an http URL on the auth host', () => {
    expect(isAllowedAuthUrl('http://auth.example.com/', AUTH_HOST)).toBe(false);
  });

  it('refuses a javascript: URL', () => {
    expect(isAllowedAuthUrl('javascript:alert(1)', AUTH_HOST)).toBe(false);
  });

  it('refuses a file: URL', () => {
    expect(isAllowedAuthUrl('file:///C:/secret.txt', AUTH_HOST)).toBe(false);
  });

  it('refuses a malformed URL', () => {
    expect(isAllowedAuthUrl('not a url at all', AUTH_HOST)).toBe(false);
  });

  it('refuses an empty URL', () => {
    expect(isAllowedAuthUrl('', AUTH_HOST)).toBe(false);
    expect(isAllowedAuthUrl('   ', AUTH_HOST)).toBe(false);
  });

  it('refuses non-string values', () => {
    for (const bad of [null, undefined, 42, {}, []]) {
      expect(isAllowedAuthUrl(bad, AUTH_HOST)).toBe(false);
    }
  });

  it('refuses any URL when no auth host is configured', () => {
    expect(isAllowedAuthUrl('https://auth.example.com/', null)).toBe(false);
    expect(isAllowedAuthUrl('https://auth.example.com/', '   ')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// accounts:openAuthUrl handler
// ---------------------------------------------------------------------------

describe('openAuthUrlExternally', () => {
  it('opens an allowed auth-host https URL and resolves { ok: true }', async () => {
    const { openExternal, shell } = fakeShell();
    const url = 'https://auth.example.com/sign-in/social?provider=google';
    await expect(openAuthUrlExternally(url, AUTH_HOST, shell)).resolves.toEqual({ ok: true });
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith(url);
  });

  it('refuses another host and NEVER opens it', async () => {
    const { openExternal, shell } = fakeShell();
    await expect(openAuthUrlExternally('https://evil.example.com/', AUTH_HOST, shell))
      .resolves.toEqual({ ok: false, reason: 'invalid-url' });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('refuses a subdomain and NEVER opens it', async () => {
    const { openExternal, shell } = fakeShell();
    await expect(openAuthUrlExternally('https://sub.auth.example.com/', AUTH_HOST, shell))
      .resolves.toEqual({ ok: false, reason: 'invalid-url' });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('refuses http, javascript:, file: and malformed and NEVER opens them', async () => {
    const { openExternal, shell } = fakeShell();
    for (const bad of [
      'http://auth.example.com/',
      'javascript:alert(1)',
      'file:///C:/secret.txt',
      'not a url at all',
      '',
    ]) {
      await expect(openAuthUrlExternally(bad, AUTH_HOST, shell))
        .resolves.toEqual({ ok: false, reason: 'invalid-url' });
    }
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('refuses a non-string payload and NEVER opens it', async () => {
    const { openExternal, shell } = fakeShell();
    await expect(openAuthUrlExternally(undefined, AUTH_HOST, shell))
      .resolves.toEqual({ ok: false, reason: 'invalid-url' });
    await expect(openAuthUrlExternally(42, AUTH_HOST, shell))
      .resolves.toEqual({ ok: false, reason: 'invalid-url' });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('refuses when no auth host is configured', async () => {
    const { openExternal, shell } = fakeShell();
    await expect(openAuthUrlExternally('https://auth.example.com/', null, shell))
      .resolves.toEqual({ ok: false, reason: 'invalid-url' });
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('resolves { ok: false, reason: failed } when shell.openExternal rejects, never throws', async () => {
    const openExternal = vi.fn(async (): Promise<void> => {
      throw new Error('no default browser');
    });
    await expect(
      openAuthUrlExternally('https://auth.example.com/', AUTH_HOST, { openExternal }),
    ).resolves.toEqual({ ok: false, reason: 'failed' });
  });
});

// ---------------------------------------------------------------------------
// app:openDefaultAppsSettings handler
// ---------------------------------------------------------------------------

describe('openDefaultAppsSettings', () => {
  it('opens the fixed ms-settings:defaultapps URI and resolves { ok: true }', async () => {
    const { openExternal, shell } = fakeShell();
    await expect(openDefaultAppsSettings(shell)).resolves.toEqual({ ok: true });
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith(DEFAULT_APPS_SETTINGS_URI);
  });

  it('the settings URI is the fixed ms-settings:defaultapps constant', () => {
    expect(DEFAULT_APPS_SETTINGS_URI).toBe('ms-settings:defaultapps');
  });

  it('resolves { ok: false, reason: failed } when shell.openExternal rejects, never throws', async () => {
    const openExternal = vi.fn(async (): Promise<void> => {
      throw new Error('settings unavailable');
    });
    await expect(openDefaultAppsSettings({ openExternal }))
      .resolves.toEqual({ ok: false, reason: 'failed' });
  });
});
