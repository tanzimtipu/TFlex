/**
 * Phase 44 - local sync bookkeeping (main process only).
 *
 * A tiny JSON file under userData that records what the last sync agreed on
 * with the cloud: the settings revision/updated_at that was last observed or
 * written, the synced-fields snapshot that detects a local edit, a timestamp
 * for local edits (the local half of last-write-wins), and the per-signature
 * updated_at map used to detect local deletes and changed rows.
 *
 * Phase 48 - `signatureTombstones` is the DEVICE-LOCAL half of the delete
 * protocol. A hard-deleted cloud row leaves no marker there, so this device
 * remembers which signature ids it deleted (id -> ISO deletion time). A pull
 * that still carries such an id is ignored and the cloud row is re-deleted,
 * and a remote row missing for a previously-synced id is treated as a delete
 * pushed by another device. The tombstone is pruned after a fixed window.
 *
 * This is deliberately NOT part of `settings.json`: it is device-local
 * bookkeeping, not a user preference, and it must not be exported or synced
 * itself. A missing or corrupt file simply means "no sync record yet", which
 * is exactly the first-link state the engine expects.
 */

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface SyncState {
  /** Cloud `revision` last observed or written for the settings row. */
  settingsRevision?: number;
  /** Cloud `updated_at` last observed or written for the settings row. */
  settingsUpdatedAt?: string;
  /** The synced-fields snapshot (device-local keys excluded) last agreed on. */
  settingsSynced?: Record<string, unknown>;
  /** When a local settings edit was first seen but not yet synced; the local
   *  half of the last-write-wins comparison. */
  localSettingsModifiedAt?: string;
  /** id -> content hash of the signature last agreed on; detects a local
   *  edit and a local hard-delete (id present here, absent locally). */
  signatures?: Record<string, string>;
  /** Phase 48 - id -> ISO timestamp when THIS device hard-deleted the
   *  signature. The cloud row is gone, so the tombstone lives here; it stops
   *  a stale pull resurrecting the id and is pruned after the TTL. */
  signatureTombstones?: Record<string, string>;
}

export class SyncStateStore {
  private cached: SyncState | null = null;

  constructor(private readonly filePath: string) {}

  async load(): Promise<SyncState> {
    if (this.cached !== null) return structuredClone(this.cached);
    this.cached = await this.loadFromDisk();
    return structuredClone(this.cached);
  }

  async save(state: SyncState): Promise<void> {
    this.cached = structuredClone(state);
    const tmp = `${this.filePath}.tmp`;
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8');
      await rename(tmp, this.filePath);
    } catch {
      try {
        await unlink(tmp);
      } catch {
        // Best-effort tmp cleanup; the in-memory cache still serves this run.
      }
      // A bookkeeping write is never allowed to fail a sync.
    }
  }

  private async loadFromDisk(): Promise<SyncState> {
    let text: string;
    try {
      text = await readFile(this.filePath, 'utf8');
    } catch {
      return {};
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return {};
    }
    if (parsed === null || typeof parsed !== 'object') return {};
    const raw = parsed as Record<string, unknown>;
    const state: SyncState = {};
    if (typeof raw.settingsRevision === 'number' && Number.isFinite(raw.settingsRevision)) {
      state.settingsRevision = raw.settingsRevision;
    }
    if (typeof raw.settingsUpdatedAt === 'string') state.settingsUpdatedAt = raw.settingsUpdatedAt;
    if (isPlainObject(raw.settingsSynced)) {
      state.settingsSynced = raw.settingsSynced as Record<string, unknown>;
    }
    if (typeof raw.localSettingsModifiedAt === 'string') {
      state.localSettingsModifiedAt = raw.localSettingsModifiedAt;
    }
    if (isPlainObject(raw.signatures)) {
      const signatures: Record<string, string> = {};
      for (const [id, value] of Object.entries(raw.signatures as Record<string, unknown>)) {
        if (typeof value === 'string') signatures[id] = value;
      }
      state.signatures = signatures;
    }
    if (isPlainObject(raw.signatureTombstones)) {
      const tombstones: Record<string, string> = {};
      for (const [id, value] of Object.entries(
        raw.signatureTombstones as Record<string, unknown>,
      )) {
        if (typeof value === 'string') tombstones[id] = value;
      }
      state.signatureTombstones = tombstones;
    }
    return state;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
