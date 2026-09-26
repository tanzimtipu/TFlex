// Phase 44 chunk 1 — accounts contract tests.
//
// Covers: the three new AppSettings fields' validation (valid / invalid /
// missing), the encrypted session vault (store / read / clear, including the
// safeStorage-unavailable path and that no plaintext token reaches disk), and
// the accounts IPC wiring (channels registered, handlers delegate correctly,
// and no handler returns the token).

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  LAST_SYNCED_AT_MAX,
  SYNC_DEVICE_ID_MAX,
  normalizeSettings,
} from '../../../src/main/services/settings';
import {
  AccountsVault,
  type SafeStorageLike,
} from '../../../src/main/services/accounts/vault';
import { registerAccountsIpc } from '../../../src/main/services/accounts/ipc';
import { getAccountsConfig } from '../../../src/main/services/accounts/config';
import { IPC } from '../../../src/shared/ipc';
import type { SetSessionPayload, SyncReport } from '../../../src/shared/accounts';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'tflex-accounts-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const SESSION: SetSessionPayload = {
  user: { id: 'user-1', email: 'a@example.com', emailVerified: true, name: 'A' },
  token: 'jwt.secret.payload',
};

function fakeSafeStorage(available = true): SafeStorageLike {
  // A reversible transform (base64) stands in for real encryption so tests
  // can assert the token does not appear verbatim on disk.
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plainText: string): Buffer =>
      Buffer.from(Buffer.from(plainText, 'utf8').toString('base64'), 'utf8'),
    decryptString: (encrypted: Buffer): string =>
      Buffer.from(encrypted.toString('utf8'), 'base64').toString('utf8'),
  };
}

// ---------------------------------------------------------------------------
// Settings validation
// ---------------------------------------------------------------------------

describe('Phase 44 settings validation', () => {
  it('accountsEnabled: keeps real booleans, rejects non-booleans, absent stays absent', () => {
    expect(normalizeSettings({ accountsEnabled: true }).accountsEnabled).toBe(true);
    expect(normalizeSettings({ accountsEnabled: false }).accountsEnabled).toBe(false);
    expect(normalizeSettings({ accountsEnabled: 'yes' }).accountsEnabled).toBeUndefined();
    expect(normalizeSettings({ accountsEnabled: 1 }).accountsEnabled).toBeUndefined();
    expect(normalizeSettings({}).accountsEnabled).toBeUndefined();
    expect(DEFAULT_SETTINGS.accountsEnabled).toBeUndefined();
  });

  it('syncDeviceId: keeps a valid id, rejects empty / over-long / non-string', () => {
    expect(normalizeSettings({ syncDeviceId: 'dev-abc' }).syncDeviceId).toBe('dev-abc');
    expect(normalizeSettings({ syncDeviceId: 'x'.repeat(SYNC_DEVICE_ID_MAX) }).syncDeviceId)
      .toHaveLength(SYNC_DEVICE_ID_MAX);
    expect(normalizeSettings({ syncDeviceId: '' }).syncDeviceId).toBeUndefined();
    expect(normalizeSettings({ syncDeviceId: 'x'.repeat(SYNC_DEVICE_ID_MAX + 1) }).syncDeviceId)
      .toBeUndefined();
    expect(normalizeSettings({ syncDeviceId: 42 }).syncDeviceId).toBeUndefined();
    expect(normalizeSettings({}).syncDeviceId).toBeUndefined();
  });

  it('lastSyncedAt: keeps a valid ISO string, rejects bad / over-long / non-string', () => {
    const iso = '2026-09-27T10:00:00.000Z';
    expect(normalizeSettings({ lastSyncedAt: iso }).lastSyncedAt).toBe(iso);
    expect(normalizeSettings({ lastSyncedAt: 'not-a-date' }).lastSyncedAt).toBeUndefined();
    expect(normalizeSettings({ lastSyncedAt: 'x'.repeat(LAST_SYNCED_AT_MAX + 1) }).lastSyncedAt)
      .toBeUndefined();
    expect(normalizeSettings({ lastSyncedAt: 123 }).lastSyncedAt).toBeUndefined();
    expect(normalizeSettings({}).lastSyncedAt).toBeUndefined();
  });

  it('validates the three fields independently of one another', () => {
    const s = normalizeSettings({
      accountsEnabled: true,
      syncDeviceId: '',
      lastSyncedAt: 'nope',
    });
    expect(s.accountsEnabled).toBe(true);
    expect(s.syncDeviceId).toBeUndefined();
    expect(s.lastSyncedAt).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Vault
// ---------------------------------------------------------------------------

describe('AccountsVault', () => {
  it('stores, reads and clears a session with encryption available', async () => {
    const file = join(dir, 'accounts-session.bin');
    const vault = new AccountsVault(file, fakeSafeStorage(true));

    const stored = await vault.setSession(SESSION);
    expect(stored).toEqual({ persisted: true, encryptionAvailable: true });

    const session = await vault.getSession();
    expect(session?.user.email).toBe('a@example.com');
    expect(session?.token).toBe('jwt.secret.payload');

    await vault.clearSession();
    expect(await vault.getSession()).toBeNull();
    expect(await vault.getSessionToken()).toBeNull();
  });

  it('never writes the token as plaintext to disk', async () => {
    const file = join(dir, 'accounts-session.bin');
    const vault = new AccountsVault(file, fakeSafeStorage(true));
    await vault.setSession(SESSION);

    const raw = await readFile(file, 'utf8');
    expect(raw).not.toContain('jwt.secret.payload');
    expect(raw).not.toContain('"token"');
    expect(raw.startsWith('{"user"')).toBe(false);
  });

  it('status is signed-out with encryption available and no session', async () => {
    const vault = new AccountsVault(join(dir, 'v.bin'), fakeSafeStorage(true));
    expect(await vault.status()).toEqual({ status: 'signed-out', email: null });
  });

  it('degrades to in-memory only when encryption is unavailable', async () => {
    const file = join(dir, 'accounts-session.bin');
    const vault = new AccountsVault(file, fakeSafeStorage(false));

    const stored = await vault.setSession(SESSION);
    expect(stored).toEqual({ persisted: false, encryptionAvailable: false });

    // Sign-in still works for this run...
    expect(await vault.status()).toEqual({ status: 'signed-in', email: 'a@example.com' });
    expect(await vault.getSessionToken()).toBe('jwt.secret.payload');

    // ...but nothing was written to disk.
    await expect(readFile(file)).rejects.toThrow();

    await vault.clearSession();
    expect(await vault.status()).toEqual({ status: 'unavailable', email: null });
  });

  it('status is unavailable with encryption unavailable and no session', async () => {
    const vault = new AccountsVault(join(dir, 'v.bin'), fakeSafeStorage(false));
    expect(await vault.status()).toEqual({ status: 'unavailable', email: null });
  });

  it('rejects malformed session payloads', async () => {
    const vault = new AccountsVault(join(dir, 'v.bin'), fakeSafeStorage(true));
    await expect(vault.setSession({ user: SESSION.user } as never)).rejects.toThrow();
    await expect(vault.setSession({ token: 't' } as never)).rejects.toThrow();
    await expect(vault.setSession(null as never)).rejects.toThrow();
  });

  it('returns null for a corrupt stored record instead of throwing', async () => {
    const file = join(dir, 'accounts-session.bin');
    await writeFile(file, Buffer.from('garbage-not-decryptable', 'utf8'));
    const vault = new AccountsVault(file, fakeSafeStorage(true));
    expect(await vault.getSession()).toBeNull();
    expect(await vault.status()).toEqual({ status: 'signed-out', email: null });
  });
});

// ---------------------------------------------------------------------------
// Config accessor
// ---------------------------------------------------------------------------

describe('getAccountsConfig', () => {
  it('reads the two endpoint env vars and trims them', () => {
    const cfg = getAccountsConfig({
      TFLEX_AUTH_BASE_URL: '  https://auth.example.test/base  ',
      TFLEX_DATA_API_URL: 'https://api.example.test/rest/v1',
    } as unknown as NodeJS.ProcessEnv);
    expect(cfg.authBaseUrl).toBe('https://auth.example.test/base');
    expect(cfg.dataApiUrl).toBe('https://api.example.test/rest/v1');
  });

  it('returns null for a missing or blank env var (no hardcoded fallback)', () => {
    expect(getAccountsConfig({} as unknown as NodeJS.ProcessEnv)).toEqual({
      authBaseUrl: null,
      dataApiUrl: null,
    });
    expect(
      getAccountsConfig({
        TFLEX_AUTH_BASE_URL: '   ',
        TFLEX_DATA_API_URL: undefined,
      } as unknown as NodeJS.ProcessEnv),
    ).toEqual({ authBaseUrl: null, dataApiUrl: null });
  });
});

// ---------------------------------------------------------------------------
// IPC wiring
// ---------------------------------------------------------------------------

describe('registerAccountsIpc', () => {
  type Handler = (event: unknown, ...args: unknown[]) => unknown;

  function captureIpc(): { handlers: Map<string, Handler>; ipc: unknown } {
    const handlers = new Map<string, Handler>();
    const ipc = {
      handle(channel: string, fn: Handler): void {
        handlers.set(channel, fn);
      },
    };
    return { handlers, ipc };
  }

  it('registers the three session channels plus the config channel', () => {
    const capture = captureIpc();
    const vault = new AccountsVault(join(dir, 'v.bin'), fakeSafeStorage(true));
    registerAccountsIpc(capture.ipc as never, vault);
    expect([...capture.handlers.keys()].sort()).toEqual([
      IPC.accountsClearSession,
      IPC.accountsGetConfig,
      IPC.accountsGetStatus,
      IPC.accountsSetSession,
    ].sort());
  });

  it('delegates getStatus / setSession / clearSession and never returns the token', async () => {
    const capture = captureIpc();
    const vault = new AccountsVault(join(dir, 'v.bin'), fakeSafeStorage(true));
    registerAccountsIpc(capture.ipc as never, vault);

    const setResult = await capture.handlers.get(IPC.accountsSetSession)!(null, SESSION);
    expect(setResult).toBeUndefined();

    const statusResult = await capture.handlers.get(IPC.accountsGetStatus)!(null);
    expect(statusResult).toEqual({ status: 'signed-in', email: 'a@example.com' });
    expect(JSON.stringify(statusResult)).not.toContain('jwt.secret.payload');

    await capture.handlers.get(IPC.accountsClearSession)!(null);
    expect(await vault.getSessionToken()).toBeNull();
    expect(await capture.handlers.get(IPC.accountsGetStatus)!(null))
      .toEqual({ status: 'signed-out', email: null });
  });

  it('registers accounts:syncNow only when a coordinator is supplied and delegates to it', async () => {
    const capture = captureIpc();
    const vault = new AccountsVault(join(dir, 'v.bin'), fakeSafeStorage(true));
    const report: SyncReport = {
      phase: 'synced',
      at: '2026-09-27T12:00:00.000Z',
      pushed: 1,
      pulled: 0,
    };
    const syncNow = vi.fn(async () => report);
    registerAccountsIpc(capture.ipc as never, vault, { syncNow });

    expect([...capture.handlers.keys()].sort()).toEqual([
      IPC.accountsClearSession,
      IPC.accountsGetConfig,
      IPC.accountsGetStatus,
      IPC.accountsSetSession,
      IPC.accountsSyncNow,
    ].sort());

    await expect(capture.handlers.get(IPC.accountsSyncNow)!(null)).resolves.toEqual(report);
    expect(syncNow).toHaveBeenCalledTimes(1);
  });

  // accounts:getConfig — the non-secret config the renderer uses to build the
  // auth client. It must never throw, and must never carry a secret, token or
  // the Data API URL.

  it('accounts:getConfig resolves the configured shape from the accessor', () => {
    const capture = captureIpc();
    const vault = new AccountsVault(join(dir, 'v.bin'), fakeSafeStorage(true));
    registerAccountsIpc(capture.ipc as never, vault, null, () => ({
      authBaseUrl: 'https://auth.example.test',
      // Present in main config but deliberately NOT part of the response.
      dataApiUrl: 'https://data.example.test/rest/v1',
    }));

    expect(capture.handlers.get(IPC.accountsGetConfig)!(null)).toEqual({
      authBaseUrl: 'https://auth.example.test',
      configured: true,
    });
  });

  it('accounts:getConfig resolves { null, false } with no provider or a null accessor', () => {
    const capture = captureIpc();
    const vault = new AccountsVault(join(dir, 'v.bin'), fakeSafeStorage(true));
    registerAccountsIpc(capture.ipc as never, vault);
    expect(capture.handlers.get(IPC.accountsGetConfig)!(null)).toEqual({
      authBaseUrl: null,
      configured: false,
    });

    const capture2 = captureIpc();
    registerAccountsIpc(capture2.ipc as never, vault, null, () => ({
      authBaseUrl: null,
      dataApiUrl: null,
    }));
    expect(capture2.handlers.get(IPC.accountsGetConfig)!(null)).toEqual({
      authBaseUrl: null,
      configured: false,
    });
  });

  it('accounts:getConfig never throws when the accessor throws', () => {
    const capture = captureIpc();
    const vault = new AccountsVault(join(dir, 'v.bin'), fakeSafeStorage(true));
    registerAccountsIpc(capture.ipc as never, vault, null, () => {
      throw new Error('boom');
    });
    expect(capture.handlers.get(IPC.accountsGetConfig)!(null)).toEqual({
      authBaseUrl: null,
      configured: false,
    });
  });

  it('accounts:getConfig exposes no token, secret or Data API URL', () => {
    const capture = captureIpc();
    const vault = new AccountsVault(join(dir, 'v.bin'), fakeSafeStorage(true));
    registerAccountsIpc(capture.ipc as never, vault, null, () => ({
      authBaseUrl: 'https://auth.example.test',
      dataApiUrl: 'https://data.example.test/rest/v1',
    }));
    const result = capture.handlers.get(IPC.accountsGetConfig)!(null);
    const json = JSON.stringify(result);
    expect(json).not.toContain('dataApiUrl');
    expect(json).not.toContain('data.example.test');
    expect(json).not.toContain('token');
    expect(Object.keys(result as object).sort()).toEqual(['authBaseUrl', 'configured']);
  });
});
