/**
 * Phase 44 — encrypted session vault (main process only).
 *
 * Holds the signed-in user's session material. The session JWT is the only
 * credential the app keeps; it must never appear in `settings.json`, never
 * be logged, and never be returned to the renderer in bulk. The renderer
 * gets a status + email only (see `AccountStatusResult`); main-process sync
 * code reads the raw token through `getSessionToken()`.
 *
 * Storage: Electron `safeStorage.encryptString()` writes encrypted bytes to
 * a single file under the app's userData dir. If
 * `safeStorage.isEncryptionAvailable()` is false the vault does NOT write
 * anything: it keeps the session in memory for the current process only and
 * reports `{ persisted: false, encryptionAvailable: false }` from
 * `setSession` — sign-in still works for this run, and no plaintext token is
 * ever written to disk. `status()` then reports `unavailable` while no
 * session is held, so the UI can say persistence is not available on this
 * machine.
 */

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type {
  AccountStatusResult,
  AccountUser,
  SetSessionPayload,
} from '../../../shared/accounts';

/** Internal, main-process-only session record. Never serialised to the
 *  renderer and never logged. */
export interface AccountSession {
  user: AccountUser;
  token: string;
  savedAt: string;
}

/** The subset of Electron `safeStorage` the vault depends on. Injectable so
 *  tests can drive the encryption-unavailable path deterministically. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

/** Outcome of `setSession`. `persisted` is false either because encryption
 *  is unavailable (in-memory only) or because the encrypted write failed;
 *  `encryptionAvailable` distinguishes the two. */
export interface VaultStoreResult {
  persisted: boolean;
  encryptionAvailable: boolean;
}

export class AccountsVault {
  private memory: AccountSession | null = null;
  private diskLoaded = false;

  constructor(
    private readonly filePath: string,
    private readonly safeStorage: SafeStorageLike,
  ) {}

  isEncryptionAvailable(): boolean {
    return this.safeStorage.isEncryptionAvailable();
  }

  /** The session if one is held (memory, else a decryptable disk record),
   *  otherwise null. Never throws on a corrupt/foreign record. */
  async getSession(): Promise<AccountSession | null> {
    if (this.memory !== null) return this.memory;
    if (!this.diskLoaded) {
      this.memory = await this.loadFromDisk();
      this.diskLoaded = true;
    }
    return this.memory;
  }

  /** Main-process sync code only: the raw JWT, or null when signed out.
   *  Must never be exposed over IPC. */
  async getSessionToken(): Promise<string | null> {
    const session = await this.getSession();
    return session === null ? null : session.token;
  }

  /**
   * Store a session. Validates the payload (invalid -> throws; the token is
   * never included in the error). With encryption available the session is
   * encrypted and written; otherwise it is kept in memory only and the
   * caller learns `persisted: false`.
   */
  async setSession(payload: SetSessionPayload): Promise<VaultStoreResult> {
    const session = normalizeSessionPayload(payload);
    if (session === null) {
      throw new Error('invalid account session payload');
    }
    this.memory = session;
    this.diskLoaded = true;

    if (!this.safeStorage.isEncryptionAvailable()) {
      return { persisted: false, encryptionAvailable: false };
    }
    try {
      await this.writeEncrypted(session);
      return { persisted: true, encryptionAvailable: true };
    } catch {
      // Sign-in must not fail because the disk write failed; the in-memory
      // session still serves this run.
      return { persisted: false, encryptionAvailable: true };
    }
  }

  /** Sign-out: drop the in-memory session and delete the encrypted file. */
  async clearSession(): Promise<void> {
    this.memory = null;
    this.diskLoaded = true;
    try {
      await unlink(this.filePath);
    } catch {
      // ENOENT (nothing stored) and any cleanup error are both fine here.
    }
  }

  /** Status + identity for the renderer. No token material. `name` / `image`
   *  come from the stored user record; both resolve to null for a legacy
   *  record that predates them (never throws). */
  async status(): Promise<AccountStatusResult> {
    const session = await this.getSession();
    if (session !== null) {
      return {
        status: 'signed-in',
        email: session.user.email,
        name: session.user.name ?? null,
        image: session.user.image ?? null,
      };
    }
    if (!this.safeStorage.isEncryptionAvailable()) {
      return { status: 'unavailable', email: null, name: null, image: null };
    }
    return { status: 'signed-out', email: null, name: null, image: null };
  }

  private async loadFromDisk(): Promise<AccountSession | null> {
    if (!this.safeStorage.isEncryptionAvailable()) return null;
    let encrypted: Buffer;
    try {
      encrypted = await readFile(this.filePath);
    } catch {
      return null;
    }
    try {
      const plain = this.safeStorage.decryptString(encrypted);
      const parsed: unknown = JSON.parse(plain);
      return normalizeStoredSession(parsed);
    } catch {
      return null;
    }
  }

  private async writeEncrypted(session: AccountSession): Promise<void> {
    const encrypted = this.safeStorage.encryptString(JSON.stringify(session));
    const tmp = `${this.filePath}.tmp`;
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      await writeFile(tmp, encrypted);
      await rename(tmp, this.filePath);
    } catch (e) {
      try {
        await unlink(tmp);
      } catch {
        // Best-effort tmp cleanup.
      }
      throw e;
    }
  }
}

function isAccountUser(value: unknown): value is AccountUser {
  if (value === null || typeof value !== 'object') return false;
  const u = value as Record<string, unknown>;
  if (typeof u.id !== 'string' || typeof u.email !== 'string') return false;
  if (typeof u.emailVerified !== 'boolean') return false;
  if (u.name !== undefined && typeof u.name !== 'string') return false;
  // `image` is optional and nullable; a legacy record simply omits it.
  if (u.image !== undefined && u.image !== null && typeof u.image !== 'string') return false;
  return true;
}

function normalizeSessionPayload(payload: unknown): AccountSession | null {
  if (payload === null || typeof payload !== 'object') return null;
  const r = payload as Record<string, unknown>;
  if (!isAccountUser(r.user)) return null;
  if (typeof r.token !== 'string' || r.token.length === 0) return null;
  // Always stamp fresh on set; the payload carries no timestamp.
  return { user: r.user, token: r.token, savedAt: new Date().toISOString() };
}

function normalizeStoredSession(value: unknown): AccountSession | null {
  if (value === null || typeof value !== 'object') return null;
  const r = value as Record<string, unknown>;
  if (!isAccountUser(r.user)) return null;
  if (typeof r.token !== 'string' || r.token.length === 0) return null;
  if (typeof r.savedAt !== 'string') return null;
  return { user: r.user, token: r.token, savedAt: r.savedAt };
}
