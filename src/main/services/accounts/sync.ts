/**
 * Phase 44 - settings + signature sync engine (main process only).
 *
 * The transport is injected (`SyncTransport`) so this module is pure logic
 * and unit-testable with a fake transport. The concrete Neon/PostgREST
 * transport lives in `transport.ts` and is only constructed by the wiring
 * layer, never here.
 *
 * Rules implemented here:
 *   - Settings: last-write-wins on `updated_at` with a `revision` counter;
 *     the FIRST link of a device (no local sync record) takes the CLOUD as
 *     authoritative. Device-local fields are never pushed or pulled.
 *   - Signatures: metadata only; deletes are SOFT (`deleted_at`) so a second
 *     device converges. Image bytes are a later chunk: `kind:'image'` rows
 *     sync metadata only and are not applied to the local signature store.
 *   - Every failure maps to a `SyncReport` and is non-blocking; `sync()`
 *     never throws. No session/flag/config means no network call at all.
 *
 * SECURITY: the engine never sends a user id - the Data API RLS boundary is
 * `auth.user_id() = user_id`; rows are addressed only by their own id/keys.
 */

import { createHash, randomUUID } from 'node:crypto';
import type { AppSettings, SavedSignature, SignatureSource } from '../../../shared/types';
import type { AccountsError, SyncReport } from '../../../shared/accounts';
import {
  SIGNATURE_IMAGE_MAX_BYTES,
  type ImageSignatureMeta,
  type SignatureKind,
} from '../../../shared/accounts';
import type { AccountsConfig } from './config';
import type { SyncState } from './sync-state';

export type { SignatureKind };

// ---------------------------------------------------------------------------
// Device-local settings exclusion
// ---------------------------------------------------------------------------
//
// These fields describe THIS install, not the user's preference, so they are
// excluded from both the push payload and the pull merge:
//   - `geometry`     window position/size/maximized (per machine)
//   - `recentFiles`  the recent-files list; every entry carries an absolute
//                    `path` (the path-bearing field the phase calls out)
//   - `syncDeviceId` the per-install id used for conflict notes; syncing it
//                    would overwrite every other device's identity
//   - `lastSyncedAt` per-device "last successful sync" display timestamp
//   - `accountsEnabled` the device-local rollout flag (an opt-out device must
//                    not be silently opted in by another device's sync)
export const DEVICE_LOCAL_SETTINGS_KEYS: readonly string[] = [
  'geometry',
  'recentFiles',
  'syncDeviceId',
  'lastSyncedAt',
  'accountsEnabled',
];

/** The subset of `AppSettings` that syncs: every non-device-local key with a
 *  defined value. */
export function pickSyncedSettings(settings: AppSettings): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings as unknown as Record<string, unknown>)) {
    if (DEVICE_LOCAL_SETTINGS_KEYS.includes(key)) continue;
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}

/** Merge cloud synced fields over the local settings, then restore every
 *  device-local field from the local copy. Unknown cloud keys survive the
 *  merge only until the settings service normalises them away on save. */
export function mergePulledSettings(
  local: AppSettings,
  cloudSettings: Record<string, unknown>,
): AppSettings {
  const merged: Record<string, unknown> = {
    ...(local as unknown as Record<string, unknown>),
    ...cloudSettings,
  };
  for (const key of DEVICE_LOCAL_SETTINGS_KEYS) {
    if (key in (local as unknown as Record<string, unknown>)) {
      merged[key] = (local as unknown as Record<string, unknown>)[key];
    } else {
      delete merged[key];
    }
  }
  for (const key of Object.keys(merged)) {
    if (merged[key] === undefined) delete merged[key];
  }
  return merged as unknown as AppSettings;
}

// ---------------------------------------------------------------------------
// Transport contract
// ---------------------------------------------------------------------------

export interface SettingsCloudRow {
  settings: Record<string, unknown>;
  revision: number;
  device_id: string | null;
  updated_at: string;
}

export interface SettingsPushRow {
  settings: Record<string, unknown>;
  revision: number;
  device_id: string;
  updated_at: string;
}

export interface SignatureCloudRow {
  id: string;
  label: string;
  kind: SignatureKind;
  payload: unknown;
  storage_key: string | null;
  sort_order: number;
  deleted_at: string | null;
  updated_at: string;
}

export interface SignaturePushRow {
  id: string;
  label: string;
  kind: SignatureKind;
  payload: unknown;
  storage_key: string | null;
  sort_order: number;
  deleted_at: string | null;
  updated_at: string;
}

export type SyncErrorKind = 'offline' | 'server' | 'auth';

/** Thrown by the transport so the engine can tell "network unreachable"
 *  (offline) from "server rejected" (error). */
export class SyncTransportError extends Error {
  constructor(
    public readonly kind: SyncErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'SyncTransportError';
  }
}

export interface SyncTransport {
  fetchSettingsRow(): Promise<SettingsCloudRow | null>;
  upsertSettingsRow(row: SettingsPushRow): Promise<SettingsCloudRow>;
  fetchSignatureRows(): Promise<SignatureCloudRow[]>;
  upsertSignatureRows(rows: SignaturePushRow[]): Promise<void>;
  softDeleteSignature(id: string, deletedAt: string): Promise<void>;
  /** Phase 44 chunk 5 - POST the PNG bytes to the Neon Function and return the
   *  stored object key. Throws `SyncTransportError` (never a raw error). */
  uploadSignatureImage(bytes: Uint8Array): Promise<string>;
  /** Phase 44 chunk 5 - resolve the object key to a presigned GET URL through
   *  the Function, download the bytes and return them. */
  downloadSignatureImage(storageKey: string): Promise<Uint8Array>;
}

// ---------------------------------------------------------------------------
// Settings conflict resolution (pure)
// ---------------------------------------------------------------------------

export type SettingsAction = 'pull' | 'push' | 'none';

export interface SettingsDecision {
  action: SettingsAction;
  /** Present when action is 'push'. */
  push?: SettingsPushRow;
  /** Present when action is 'pull' - the cloud JSONB settings object. */
  pull?: Record<string, unknown>;
  /** The state fields the engine must persist for this decision. */
  next: Pick<
    SyncState,
    'settingsRevision' | 'settingsUpdatedAt' | 'settingsSynced' | 'localSettingsModifiedAt'
  >;
}

/**
 * Decide whether to push the local settings, pull the cloud row, or do
 * nothing.
 *
 * - No cloud row -> push (creation, revision 1).
 * - First link (no local sync record at all) -> pull: cloud is authoritative.
 * - Only local changed -> push. Only cloud changed -> pull.
 * - Both changed -> last-write-wins on `updated_at`: the newer of the cloud
 *   row's `updated_at` and the time the local edit was first observed wins.
 */
export function resolveSettingsConflict(
  local: AppSettings,
  state: SyncState,
  cloud: SettingsCloudRow | null,
  deviceId: string,
  now: string,
): SettingsDecision {
  const localSynced = pickSyncedSettings(local);
  const lastSynced = state.settingsSynced ?? null;
  const firstLink = state.settingsUpdatedAt === undefined && lastSynced === null;

  if (cloud === null) {
    return pushSettings(localSynced, 1, deviceId, now);
  }
  if (firstLink) {
    const merged = mergePulledSettings(local, cloud.settings);
    return {
      action: 'pull',
      pull: cloud.settings,
      next: {
        settingsRevision: cloud.revision,
        settingsUpdatedAt: cloud.updated_at,
        settingsSynced: pickSyncedSettings(merged),
        localSettingsModifiedAt: undefined,
      },
    };
  }

  const localDirty = stableStringify(localSynced) !== stableStringify(lastSynced);
  const cloudChanged = state.settingsUpdatedAt !== cloud.updated_at;

  if (!localDirty && !cloudChanged) {
    return { action: 'none', next: {} };
  }
  if (localDirty && !cloudChanged) {
    return pushSettings(localSynced, cloud.revision + 1, deviceId, now);
  }
  if (!localDirty && cloudChanged) {
    return pullSettings(local, cloud);
  }

  // Both sides changed: last-write-wins on updated_at.
  const localAt = Date.parse(state.localSettingsModifiedAt ?? now);
  const cloudAt = Date.parse(cloud.updated_at);
  if (Number.isFinite(cloudAt) && Number.isFinite(localAt) && cloudAt > localAt) {
    return pullSettings(local, cloud);
  }
  return pushSettings(localSynced, cloud.revision + 1, deviceId, now);
}

function pushSettings(
  settings: Record<string, unknown>,
  revision: number,
  deviceId: string,
  now: string,
): SettingsDecision {
  return {
    action: 'push',
    push: { settings, revision, device_id: deviceId, updated_at: now },
    next: {
      settingsRevision: revision,
      settingsUpdatedAt: now,
      settingsSynced: settings,
      localSettingsModifiedAt: undefined,
    },
  };
}

function pullSettings(local: AppSettings, cloud: SettingsCloudRow): SettingsDecision {
  const merged = mergePulledSettings(local, cloud.settings);
  return {
    action: 'pull',
    pull: cloud.settings,
    next: {
      settingsRevision: cloud.revision,
      settingsUpdatedAt: cloud.updated_at,
      settingsSynced: pickSyncedSettings(merged),
      localSettingsModifiedAt: undefined,
    },
  };
}

// ---------------------------------------------------------------------------
// Signature metadata helpers (pure)
// ---------------------------------------------------------------------------

/** The local signature store can only hold drawn/typed sources; image rows
 *  are cloud metadata the local store does not model yet (deferred). */
export function localSignatureToPushRow(
  signature: SavedSignature,
  sortOrder: number,
  now: string,
): SignaturePushRow {
  return {
    id: signature.id,
    label: signature.label,
    kind: signature.source.kind,
    payload: signature.source,
    storage_key: null,
    sort_order: sortOrder,
    deleted_at: null,
    updated_at: now,
  };
}

/** Content hash used to detect a locally changed signature, since the local
 *  store carries no modification timestamp. */
export function hashSignature(signature: SavedSignature): string {
  return createHash('sha256')
    .update(stableStringify({ label: signature.label, source: signature.source }))
    .digest('hex');
}

/** Convert a cloud signature row to a local `SavedSignature`, or null when it
 *  is an image row (handled by `remoteImageToLocal` instead). */
export function remoteSignatureToLocal(row: SignatureCloudRow): SavedSignature | null {
  if (row.kind === 'image') return null;
  const source = row.payload as SignatureSource | null;
  if (source === null || typeof source !== 'object' || source.kind !== row.kind) return null;
  return {
    id: row.id,
    label: row.label,
    createdAt: row.updated_at,
    source,
  };
}

/** Phase 44 chunk 5 - the user-facing message when an image signature exceeds
 *  the upload cap. Surfaced verbatim through `SyncReport.error.message`. */
export const SIGNATURE_IMAGE_TOO_LARGE_MESSAGE = `Signature image is too large. The limit is ${Math.round(
  SIGNATURE_IMAGE_MAX_BYTES / 1024,
)} KB.`;

/** Content hash for an image signature (metadata + key, NOT the bytes). */
export function hashImageSignature(meta: ImageSignatureMeta): string {
  return createHash('sha256')
    .update(
      stableStringify({
        label: meta.label,
        width: meta.width,
        height: meta.height,
        storageKey: meta.storageKey,
      }),
    )
    .digest('hex');
}

/** Build the cloud push row for a local image signature. */
export function imageMetaToPushRow(
  meta: ImageSignatureMeta,
  storageKey: string,
  sortOrder: number,
  now: string,
): SignaturePushRow {
  return {
    id: meta.id,
    label: meta.label,
    kind: 'image',
    payload: { width: meta.width, height: meta.height },
    storage_key: storageKey,
    sort_order: sortOrder,
    deleted_at: null,
    updated_at: now,
  };
}

/** Convert a cloud image row to local image metadata, or null when it carries
 *  no object key (nothing to download) or is not an image row. */
export function remoteImageToLocal(
  row: SignatureCloudRow,
): (ImageSignatureMeta & { storageKey: string }) | null {
  if (row.kind !== 'image') return null;
  if (row.storage_key === null || row.storage_key.length === 0) return null;
  const payload = (row.payload ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    label: row.label,
    createdAt: row.updated_at,
    width: typeof payload.width === 'number' ? payload.width : 0,
    height: typeof payload.height === 'number' ? payload.height : 0,
    storageKey: row.storage_key,
  };
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = sortValue((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Local ports
// ---------------------------------------------------------------------------

export interface SettingsPort {
  get(): AppSettings;
  apply(next: AppSettings): Promise<void>;
}

export interface SignaturesPort {
  list(): Promise<SavedSignature[]>;
  /** Upsert drawn/typed signatures by id and remove the given ids locally. */
  applyRemote(upserts: SavedSignature[], removedIds: string[]): Promise<void>;
  /** Phase 44 chunk 5 - the image half of the local store. */
  listImages(): Promise<ImageSignatureMeta[]>;
  /** The local PNG bytes for an image signature, or null when absent. */
  readImage(id: string): Promise<Uint8Array | null>;
  /** Persist downloaded PNG bytes for an image signature. */
  writeImage(id: string, bytes: Uint8Array): Promise<void>;
  /** Record the uploaded object key against a local image signature. */
  setImageStorageKey(id: string, storageKey: string): Promise<void>;
  /** Upsert image metadata by id and remove the given ids locally. */
  applyRemoteImages(upserts: ImageSignatureMeta[], removedIds: string[]): Promise<void>;
}

// ---------------------------------------------------------------------------
// Sync engine
// ---------------------------------------------------------------------------

export interface SyncEngineDeps {
  getToken(): Promise<string | null>;
  getConfig(): AccountsConfig;
  makeTransport(opts: {
    dataApiUrl: string;
    functionApiUrl: string | null;
    getToken: () => Promise<string | null>;
  }): SyncTransport;
  state: { load(): Promise<SyncState>; save(state: SyncState): Promise<void> };
  settings: SettingsPort;
  signatures: SignaturesPort;
  now?(): string;
}

export class AccountsSyncEngine {
  constructor(private readonly deps: SyncEngineDeps) {}

  /**
   * Run one sync attempt. NEVER throws: every failure is mapped to a
   * non-blocking `SyncReport`. Performs no network call when the feature flag
   * is off, no session is held, or no Data API URL is configured.
   */
  async sync(): Promise<SyncReport> {
    const at = this.now();
    try {
      const settings = this.deps.settings.get();
      if (settings.accountsEnabled !== true) {
        return { phase: 'idle', at };
      }
      const token = await this.deps.getToken();
      if (token === null) {
        return { phase: 'idle', at };
      }
      const config = this.deps.getConfig();
      if (config.dataApiUrl === null) {
        // The feature is on and a session is held, but this install has no
        // sync transport configured. Report `unavailable` (no `error`) so the
        // UI says the feature is not configured instead of showing a server
        // failure. No network call is made.
        return { phase: 'unavailable', at };
      }

      const transport = this.deps.makeTransport({
        dataApiUrl: config.dataApiUrl,
        functionApiUrl: config.functionApiUrl,
        getToken: () => this.deps.getToken(),
      });
      const state = await this.deps.state.load();

      const settingsCounts = await this.syncSettings(transport, state, at);
      const signatureCounts = await this.syncSignatures(transport, state, at);

      await this.deps.state.save(state);
      return {
        phase: 'synced',
        at,
        pushed: settingsCounts.pushed + signatureCounts.pushed,
        pulled: settingsCounts.pulled + signatureCounts.pulled,
      };
    } catch (error) {
      return reportFor(error, at);
    }
  }

  private async syncSettings(
    transport: SyncTransport,
    state: SyncState,
    now: string,
  ): Promise<{ pushed: number; pulled: number }> {
    let local = this.deps.settings.get();
    let deviceId = local.syncDeviceId;
    if (!deviceId) {
      deviceId = randomUUID();
      local = { ...local, syncDeviceId: deviceId };
      await this.deps.settings.apply(local);
    }
    const cloud = await transport.fetchSettingsRow();
    const decision = resolveSettingsConflict(local, state, cloud, deviceId, now);

    if (decision.action === 'push' && decision.push !== undefined) {
      const saved = await transport.upsertSettingsRow(decision.push);
      state.settingsRevision = saved.revision;
      state.settingsUpdatedAt = saved.updated_at;
      state.settingsSynced = decision.push.settings;
      state.localSettingsModifiedAt = undefined;
      return { pushed: 1, pulled: 0 };
    }
    if (decision.action === 'pull' && decision.pull !== undefined) {
      const merged = mergePulledSettings(local, decision.pull);
      await this.deps.settings.apply(merged);
      state.settingsRevision = decision.next.settingsRevision;
      state.settingsUpdatedAt = decision.next.settingsUpdatedAt;
      state.settingsSynced = decision.next.settingsSynced;
      state.localSettingsModifiedAt = undefined;
      return { pushed: 0, pulled: 1 };
    }
    // No change: leave the recorded local-edit timestamp for the next attempt.
    return { pushed: 0, pulled: 0 };
  }

  /**
   * Record that a local settings edit happened, so the local half of the
   * last-write-wins comparison is the edit time and not the sync time. Called
   * (debounced) by the coordinator on every settings change; never throws and
   * does nothing on the first link (cloud is authoritative) or when the edit
   * touched only device-local fields.
   */
  async markLocalSettingsChanged(): Promise<void> {
    try {
      const settings = this.deps.settings.get();
      if (settings.accountsEnabled !== true) return;
      const state = await this.deps.state.load();
      if (state.settingsSynced === undefined) return;
      if (state.localSettingsModifiedAt !== undefined) return;
      const localSynced = pickSyncedSettings(settings);
      if (stableStringify(localSynced) === stableStringify(state.settingsSynced)) return;
      state.localSettingsModifiedAt = this.now();
      await this.deps.state.save(state);
    } catch {
      // Local bookkeeping only; a failure means the next conflict falls back
      // to the sync-time clock rather than surfacing anything to the UI.
    }
  }

  private async syncSignatures(
    transport: SyncTransport,
    state: SyncState,
    now: string,
  ): Promise<{ pushed: number; pulled: number }> {
    const prevHashes = state.signatures ?? {};
    state.signatures = { ...prevHashes };
    let pushed = 0;
    let pulled = 0;

    const local = await this.deps.signatures.list();
    const localImages = await this.deps.signatures.listImages();
    const localById = new Map(local.map((s) => [s.id, s]));
    const localImageById = new Map(localImages.map((m) => [m.id, m]));

    // 1. Local hard-deletes: an id we previously synced that is now absent
    //    from BOTH local stores was deleted locally; soft-delete it in the
    //    cloud so the other device converges.
    for (const id of Object.keys(prevHashes)) {
      if (localById.has(id) || localImageById.has(id)) continue;
      await transport.softDeleteSignature(id, now);
      delete state.signatures[id];
      pushed += 1;
    }

    // 2. Pull. Apply a cloud row only when this device has no local edit for
    //    that id (an edited local signature is pushed instead, below).
    const remote = await transport.fetchSignatureRows();
    const upserts: SavedSignature[] = [];
    const removedIds: string[] = [];
    const imageUpserts: ImageSignatureMeta[] = [];
    const imageRemovedIds: string[] = [];
    for (const row of remote) {
      const prevHash = prevHashes[row.id];

      if (row.kind === 'image') {
        const localMeta = localImageById.get(row.id);
        const localHash = localMeta === undefined ? null : hashImageSignature(localMeta);
        if (localHash !== null && prevHash !== localHash) continue; // local wins
        if (row.deleted_at !== null) {
          imageRemovedIds.push(row.id);
          delete state.signatures[row.id];
          continue;
        }
        const meta = remoteImageToLocal(row);
        if (meta === null) continue; // image row with no key: nothing to pull
        // Download the bytes when the key is set and the local blob is missing.
        if (localMeta?.hasBytes !== true) {
          const bytes = await transport.downloadSignatureImage(meta.storageKey);
          await this.deps.signatures.writeImage(row.id, bytes);
        }
        imageUpserts.push(meta);
        state.signatures[row.id] = hashImageSignature(meta);
        pulled += 1;
        continue;
      }

      const localSig = localById.get(row.id);
      const localHash = localSig === undefined ? null : hashSignature(localSig);
      if (localHash !== null && prevHash !== localHash) continue; // local wins
      if (row.deleted_at !== null) {
        removedIds.push(row.id);
        delete state.signatures[row.id];
        continue;
      }
      const mapped = remoteSignatureToLocal(row);
      if (mapped === null) continue;
      upserts.push(mapped);
      state.signatures[row.id] = hashSignature(mapped);
      pulled += 1;
    }
    if (upserts.length > 0 || removedIds.length > 0) {
      await this.deps.signatures.applyRemote(upserts, removedIds);
    }
    if (imageUpserts.length > 0 || imageRemovedIds.length > 0) {
      await this.deps.signatures.applyRemoteImages(imageUpserts, imageRemovedIds);
    }

    // 3. Push local drawn/typed signatures that are new or changed.
    const after = await this.deps.signatures.list();
    for (const [index, signature] of after.entries()) {
      const hash = hashSignature(signature);
      if (state.signatures[signature.id] === hash) continue;
      await transport.upsertSignatureRows([localSignatureToPushRow(signature, index, now)]);
      state.signatures[signature.id] = hash;
      pushed += 1;
    }

    // 4. Push local image signatures. Bytes with no key are uploaded first
    //    (the cap is enforced locally BEFORE the upload), then the metadata
    //    row carrying the returned key is upserted.
    const afterImages = await this.deps.signatures.listImages();
    for (const [index, meta] of afterImages.entries()) {
      let storageKey = meta.storageKey;
      if (state.signatures[meta.id] === hashImageSignature(meta)) continue;
      if (storageKey === null) {
        const bytes = await this.deps.signatures.readImage(meta.id);
        if (bytes === null) continue; // metadata without bytes: nothing to upload
        if (bytes.byteLength === 0 || bytes.byteLength > SIGNATURE_IMAGE_MAX_BYTES) {
          throw new SyncTransportError('server', SIGNATURE_IMAGE_TOO_LARGE_MESSAGE);
        }
        storageKey = await transport.uploadSignatureImage(bytes);
        await this.deps.signatures.setImageStorageKey(meta.id, storageKey);
      }
      await transport.upsertSignatureRows([imageMetaToPushRow(meta, storageKey, index, now)]);
      state.signatures[meta.id] = hashImageSignature({ ...meta, storageKey });
      pushed += 1;
    }

    return { pushed, pulled };
  }

  private now(): string {
    return this.deps.now ? this.deps.now() : new Date().toISOString();
  }
}

function reportFor(error: unknown, at: string): SyncReport {
  if (error instanceof SyncTransportError && error.kind === 'offline') {
    return { phase: 'offline', at, error: { code: 'network-offline', message: error.message } };
  }
  const message = error instanceof Error ? error.message : 'sync failed';
  const accountsError: AccountsError = { code: 'server', message };
  return { phase: 'error', at, error: accountsError };
}

// ---------------------------------------------------------------------------
// Debounced single-flight coordinator
// ---------------------------------------------------------------------------

export interface SyncCoordinatorOptions {
  debounceMs?: number;
  onReport?: (report: SyncReport) => void;
}

/**
 * Keeps sync off the UI path: `requestSync()` debounces and fires-and-forgets,
 * and `syncNow()` is single-flight so two syncs can never overlap. Neither
 * method ever rejects.
 */
export class SyncCoordinator {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight: Promise<SyncReport> | null = null;

  constructor(
    private readonly engine: {
      sync(): Promise<SyncReport>;
      markLocalSettingsChanged?(): Promise<void>;
    },
    private readonly options: SyncCoordinatorOptions = {},
  ) {}

  /** Schedule a sync after the debounce window; never throws. Also stamps the
   *  local-edit time so settings conflicts are true last-write-wins. */
  requestSync(): void {
    void this.engine.markLocalSettingsChanged?.();
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.syncNow();
    }, this.options.debounceMs ?? 1500);
  }

  /** Run now, or join the in-flight attempt. Never rejects. */
  syncNow(): Promise<SyncReport> {
    if (this.inFlight !== null) return this.inFlight;
    const run = this.engine.sync().then(
      (report) => {
        this.inFlight = null;
        this.options.onReport?.(report);
        return report;
      },
      (error: unknown) => {
        this.inFlight = null;
        const report = reportFor(error, new Date().toISOString());
        this.options.onReport?.(report);
        return report;
      },
    );
    this.inFlight = run;
    return run;
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
