// Phase 44 chunk 2 - sync transport + engine tests.
//
// Transport is always mocked; no network is touched. Covers: the
// device-local exclusion (push payload + pull merge), the upsert payload
// shape, the first-link cloud-wins rule, last-write-wins, soft delete,
// image-metadata deferral, offline/server error mapping, the flag/session
// guards, and the coordinator's debounce + single-flight behaviour. Also
// covers the package.json config resolution.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../../src/main/services/settings';
import { getAccountsConfig } from '../../../src/main/services/accounts/config';
import {
  AccountsSyncEngine,
  DEVICE_LOCAL_SETTINGS_KEYS,
  mergePulledSettings,
  pickSyncedSettings,
  resolveSettingsConflict,
  SyncCoordinator,
  SyncTransportError,
  type SettingsCloudRow,
  type SettingsPort,
  type SignatureCloudRow,
  type SignaturesPort,
  type SignaturePushRow,
  type SettingsPushRow,
  type SyncTransport,
} from '../../../src/main/services/accounts/sync';
import { SignatureService } from '../../../src/main/services/signature-service';
import { createSignaturesPort } from '../../../src/main/services/accounts/ports';
import type { AppSettings, SavedSignature } from '../../../src/shared/types';
import type { SyncReport } from '../../../src/shared/accounts';
import type { SyncState } from '../../../src/main/services/accounts/sync-state';

const NOW = '2026-09-27T12:00:00.000Z';

function baseSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    ...DEFAULT_SETTINGS,
    theme: 'light',
    accountsEnabled: true,
    syncDeviceId: 'dev-local',
    lastSyncedAt: '2026-09-01T00:00:00.000Z',
    geometry: { x: 1, y: 2, width: 800, height: 600, maximized: false },
    recentFiles: [{ path: 'C:/secret.pdf', name: 'secret.pdf', openedAt: NOW }],
    dockPins: ['undo'],
    ...overrides,
  };
}

function fakeSettingsPort(initial: AppSettings) {
  let current = initial;
  const applied: AppSettings[] = [];
  const port: SettingsPort = {
    get: () => structuredClone(current),
    apply: async (next) => {
      current = structuredClone(next);
      applied.push(current);
    },
  };
  return { port, applied, current: () => current };
}

function fakeSignaturesPort(initial: SavedSignature[] = []) {
  let current = initial;
  const calls: { upserts: SavedSignature[]; removedIds: string[] }[] = [];
  const port: SignaturesPort = {
    list: async () => structuredClone(current),
    applyRemote: async (upserts, removedIds) => {
      calls.push({ upserts, removedIds });
      const removed = new Set(removedIds);
      const byId = new Map(current.filter((s) => !removed.has(s.id)).map((s) => [s.id, s]));
      for (const u of upserts) byId.set(u.id, u);
      current = [...byId.values()];
    },
  };
  return { port, calls, current: () => current };
}

interface FakeTransport extends SyncTransport {
  calls: {
    fetchSettings: number;
    upsertSettings: SettingsPushRow[];
    fetchSignatures: number;
    upsertSignatures: SignaturePushRow[];
    softDelete: { id: string; deletedAt: string }[];
  };
}

function fakeTransport(options: {
  settingsRow?: SettingsCloudRow | null;
  signatureRows?: SignatureCloudRow[];
  upsertSettings?: (row: SettingsPushRow) => SettingsCloudRow;
  throwOnFetch?: unknown;
}): FakeTransport {
  const calls: FakeTransport['calls'] = {
    fetchSettings: 0,
    upsertSettings: [],
    fetchSignatures: 0,
    upsertSignatures: [],
    softDelete: [],
  };
  return {
    calls,
    async fetchSettingsRow() {
      calls.fetchSettings += 1;
      if (options.throwOnFetch !== undefined) throw options.throwOnFetch;
      return options.settingsRow ?? null;
    },
    async upsertSettingsRow(row) {
      calls.upsertSettings.push(row);
      return options.upsertSettings?.(row) ?? {
        settings: row.settings,
        revision: row.revision,
        device_id: row.device_id,
        updated_at: row.updated_at,
      };
    },
    async fetchSignatureRows() {
      calls.fetchSignatures += 1;
      return options.signatureRows ?? [];
    },
    async upsertSignatureRows(rows) {
      calls.upsertSignatures.push(...rows);
    },
    async softDeleteSignature(id, deletedAt) {
      calls.softDelete.push({ id, deletedAt });
    },
  };
}

function fakeStateStore(initial: SyncState = {}) {
  let state: SyncState = { ...initial };
  return {
    store: {
      load: async () => structuredClone(state),
      save: async (next: SyncState) => {
        state = structuredClone(next);
      },
    },
    state: () => state,
  };
}

function makeEngine(overrides: {
  settings?: SettingsPort;
  signatures?: SignaturesPort;
  transport?: SyncTransport;
  stateWrapper?: ReturnType<typeof fakeStateStore>;
  token?: string | null;
  dataApiUrl?: string | null;
  now?: () => string;
}) {
  const settings = overrides.settings ?? fakeSettingsPort(baseSettings()).port;
  const signatures = overrides.signatures ?? fakeSignaturesPort().port;
  const stateWrapper = overrides.stateWrapper ?? fakeStateStore();
  const transport = overrides.transport ?? fakeTransport({});
  const engine = new AccountsSyncEngine({
    getToken: async () => overrides.token === undefined ? 'jwt' : overrides.token,
    getConfig: () => ({
      authBaseUrl: null,
      dataApiUrl: overrides.dataApiUrl === undefined ? 'https://cfg.test/rest/v1' : overrides.dataApiUrl,
    }),
    makeTransport: () => transport,
    state: stateWrapper.store,
    settings,
    signatures,
    now: overrides.now ?? (() => NOW),
  });
  return { engine, transport, state: stateWrapper, settings, signatures };
}

// ---------------------------------------------------------------------------
// Device-local exclusion
// ---------------------------------------------------------------------------

describe('device-local settings exclusion', () => {
  it('pickSyncedSettings drops every device-local key and keeps preferences', () => {
    const picked = pickSyncedSettings(baseSettings());
    for (const key of DEVICE_LOCAL_SETTINGS_KEYS) {
      expect(picked).not.toHaveProperty(key);
    }
    expect(picked.theme).toBe('light');
    expect(picked.dockPins).toEqual(['undo']);
    // The recent-files list is the path-bearing field; assert its path never
    // appears anywhere in the push payload.
    expect(JSON.stringify(picked)).not.toContain('secret.pdf');
  });

  it('mergePulledSettings takes cloud preferences but keeps local device fields', () => {
    const local = baseSettings({ theme: 'light' });
    const merged = mergePulledSettings(local, {
      theme: 'dark',
      dockPins: ['redo'],
      geometry: { x: 9, y: 9, width: 9, height: 9, maximized: true },
      recentFiles: [{ path: 'C:/cloud.pdf', name: 'cloud.pdf', openedAt: NOW }],
      syncDeviceId: 'dev-other',
      lastSyncedAt: '2000-01-01T00:00:00.000Z',
      accountsEnabled: false,
    });
    expect(merged.theme).toBe('dark');
    expect(merged.dockPins).toEqual(['redo']);
    expect(merged.geometry).toEqual(local.geometry);
    expect(merged.recentFiles).toEqual(local.recentFiles);
    expect(merged.syncDeviceId).toBe('dev-local');
    expect(merged.lastSyncedAt).toBe('2026-09-01T00:00:00.000Z');
    expect(merged.accountsEnabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Conflict resolution
// ---------------------------------------------------------------------------

describe('resolveSettingsConflict', () => {
  const cloudRow = (over: Partial<SettingsCloudRow>): SettingsCloudRow => ({
    settings: { theme: 'dark' },
    revision: 4,
    device_id: 'dev-other',
    updated_at: '2026-09-27T10:00:00.000Z',
    ...over,
  });

  it('pushes with revision 1 and stamps device_id/updated_at when no cloud row exists', () => {
    const decision = resolveSettingsConflict(baseSettings(), {}, null, 'dev-local', NOW);
    expect(decision.action).toBe('push');
    expect(decision.push).toMatchObject({
      revision: 1,
      device_id: 'dev-local',
      updated_at: NOW,
    });
    expect(decision.push!.settings).not.toHaveProperty('geometry');
    expect(decision.push!.settings).not.toHaveProperty('recentFiles');
  });

  it('first link (no local sync record) takes the cloud as authoritative', () => {
    const decision = resolveSettingsConflict(
      baseSettings({ theme: 'light' }),
      {},
      cloudRow({ settings: { theme: 'dark' } }),
      'dev-local',
      NOW,
    );
    expect(decision.action).toBe('pull');
    expect(decision.pull).toEqual({ theme: 'dark' });
    expect(decision.next.settingsRevision).toBe(4);
    expect(decision.next.settingsUpdatedAt).toBe('2026-09-27T10:00:00.000Z');
  });

  it('pushes when only the local settings changed, bumping the revision', () => {
    const local = baseSettings({ theme: 'dark' });
    const state = {
      settingsSynced: pickSyncedSettings(baseSettings({ theme: 'light' })),
      settingsUpdatedAt: '2026-09-27T10:00:00.000Z',
      settingsRevision: 4,
    };
    const decision = resolveSettingsConflict(local, state, cloudRow({}), 'dev-local', NOW);
    expect(decision.action).toBe('push');
    expect(decision.push!.revision).toBe(5);
  });

  it('pulls when only the cloud row changed', () => {
    const local = baseSettings({ theme: 'light' });
    const state = {
      settingsSynced: pickSyncedSettings(local),
      settingsUpdatedAt: '2026-09-27T10:00:00.000Z',
      settingsRevision: 4,
    };
    const decision = resolveSettingsConflict(
      local,
      state,
      cloudRow({ updated_at: '2026-09-27T11:00:00.000Z', settings: { theme: 'dark' } }),
      'dev-local',
      NOW,
    );
    expect(decision.action).toBe('pull');
  });

  it('last-write-wins: the newer cloud row beats an older local edit', () => {
    const local = baseSettings({ theme: 'dark' });
    const state = {
      settingsSynced: pickSyncedSettings(baseSettings({ theme: 'light' })),
      settingsUpdatedAt: '2026-09-27T10:00:00.000Z',
      settingsRevision: 4,
      localSettingsModifiedAt: '2026-09-27T11:00:00.000Z',
    };
    const decision = resolveSettingsConflict(
      local,
      state,
      cloudRow({ updated_at: '2026-09-27T11:30:00.000Z' }),
      'dev-local',
      NOW,
    );
    expect(decision.action).toBe('pull');
  });

  it('last-write-wins: a newer local edit beats an older cloud row', () => {
    const local = baseSettings({ theme: 'dark' });
    const state = {
      settingsSynced: pickSyncedSettings(baseSettings({ theme: 'light' })),
      settingsUpdatedAt: '2026-09-27T10:00:00.000Z',
      settingsRevision: 4,
      localSettingsModifiedAt: '2026-09-27T11:30:00.000Z',
    };
    const decision = resolveSettingsConflict(
      local,
      state,
      cloudRow({ updated_at: '2026-09-27T11:00:00.000Z' }),
      'dev-local',
      NOW,
    );
    expect(decision.action).toBe('push');
  });

  it('does nothing when neither side changed', () => {
    const local = baseSettings({ theme: 'light' });
    const decision = resolveSettingsConflict(
      local,
      {
        settingsSynced: pickSyncedSettings(local),
        settingsUpdatedAt: '2026-09-27T10:00:00.000Z',
        settingsRevision: 4,
      },
      cloudRow({ updated_at: '2026-09-27T10:00:00.000Z', settings: { theme: 'light' } }),
      'dev-local',
      NOW,
    );
    expect(decision.action).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

describe('AccountsSyncEngine', () => {
  it('pushes a settings row with the right shape and no device-local fields', async () => {
    const settings = fakeSettingsPort(baseSettings());
    const transport = fakeTransport({ settingsRow: null });
    const { engine } = makeEngine({ settings: settings.port, transport });

    const report = await engine.sync();

    expect(report).toMatchObject({ phase: 'synced', pushed: 1, pulled: 0 });
    expect(transport.calls.upsertSettings).toHaveLength(1);
    const row = transport.calls.upsertSettings[0];
    expect(row.revision).toBe(1);
    expect(row.device_id).toBe('dev-local');
    expect(row.updated_at).toBe(NOW);
    expect(row.settings.theme).toBe('light');
    for (const key of DEVICE_LOCAL_SETTINGS_KEYS) {
      expect(row.settings).not.toHaveProperty(key);
    }
  });

  it('first link pulls the cloud row and keeps local device-local fields', async () => {
    const settings = fakeSettingsPort(baseSettings({ theme: 'light' }));
    const transport = fakeTransport({
      settingsRow: {
        settings: { theme: 'dark', dockPins: ['redo'] },
        revision: 4,
        device_id: 'dev-other',
        updated_at: '2026-09-27T10:00:00.000Z',
      },
    });
    const { engine, state } = makeEngine({ settings: settings.port, transport });

    const report = await engine.sync();

    expect(report).toMatchObject({ phase: 'synced', pushed: 0, pulled: 1 });
    expect(transport.calls.upsertSettings).toHaveLength(0);
    expect(settings.current().theme).toBe('dark');
    expect(settings.current().dockPins).toEqual(['redo']);
    expect(settings.current().geometry).toEqual(baseSettings().geometry);
    expect((state.state() as { settingsRevision: number }).settingsRevision).toBe(4);
  });

  it('soft-deletes a signature the user removed locally', async () => {
    const signatures = fakeSignaturesPort([]);
    const state = fakeStateStore({ signatures: { 'sig-1': 'oldhash' } });
    const transport = fakeTransport({ settingsRow: null, signatureRows: [] });
    const { engine } = makeEngine({ signatures: signatures.port, stateWrapper: state, transport });

    await engine.sync();

    expect(transport.calls.softDelete).toEqual([{ id: 'sig-1', deletedAt: NOW }]);
    expect((state.state() as { signatures: Record<string, string> }).signatures).toEqual({});
  });

  it('syncs image rows as metadata only (deferred) and never applies them locally', async () => {
    const signatures = fakeSignaturesPort([]);
    const transport = fakeTransport({
      settingsRow: null,
      signatureRows: [
        {
          id: 'img-1',
          label: 'Photo sig',
          kind: 'image',
          payload: {},
          storage_key: 'sig/img-1.png',
          sort_order: 0,
          deleted_at: null,
          updated_at: NOW,
        },
      ],
    });
    const { engine } = makeEngine({ signatures: signatures.port, transport });

    const report = await engine.sync();

    expect(report.phase).toBe('synced');
    expect(signatures.calls).toHaveLength(0);
    expect(transport.calls.upsertSignatures).toHaveLength(0);
  });

  it('pulls a drawn signature and pushes a new local one', async () => {
    const local: SavedSignature = {
      id: 'sig-local',
      label: 'Local',
      createdAt: NOW,
      source: { kind: 'drawn', points: [[{ x: 0, y: 0 }]], width: 10, height: 10 },
    };
    const signatures = fakeSignaturesPort([local]);
    const transport = fakeTransport({
      settingsRow: null,
      signatureRows: [
        {
          id: 'sig-cloud',
          label: 'Cloud',
          kind: 'typed',
          payload: { kind: 'typed', text: 'Cloud', width: 10, height: 10 },
          storage_key: null,
          sort_order: 0,
          deleted_at: null,
          updated_at: NOW,
        },
      ],
    });
    const { engine } = makeEngine({ signatures: signatures.port, transport });

    const report = await engine.sync();

    expect(report.pulled).toBe(1);
    // One settings row (cloud settings row is null in this fixture) plus the
    // one new local signature.
    expect(report.pushed).toBe(2);
    expect(transport.calls.upsertSignatures).toHaveLength(1);
    const applied = signatures.calls[0];
    expect(applied.upserts.map((s) => s.id)).toEqual(['sig-cloud']);
    expect(transport.calls.upsertSignatures[0]).toMatchObject({
      id: 'sig-local',
      kind: 'drawn',
      storage_key: null,
      deleted_at: null,
      updated_at: NOW,
    });
  });

  it('maps a network failure to a non-blocking offline report', async () => {
    const transport = fakeTransport({
      throwOnFetch: new SyncTransportError('offline', 'no network'),
    });
    const { engine } = makeEngine({ transport });

    const report = await engine.sync();

    expect(report.phase).toBe('offline');
    expect(report.error?.code).toBe('network-offline');
  });

  it('maps a server/unknown failure to a non-blocking error report and never throws', async () => {
    const { engine } = makeEngine({ transport: fakeTransport({ throwOnFetch: new Error('boom') }) });
    const report = await engine.sync();
    expect(report.phase).toBe('error');
    expect(report.error?.code).toBe('server');

    const { engine: engine2 } = makeEngine({
      transport: fakeTransport({ throwOnFetch: 'not an error object' }),
    });
    await expect(engine2.sync()).resolves.toMatchObject({ phase: 'error' });
  });
});

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

describe('AccountsSyncEngine guards (no network)', () => {
  it('does nothing when the feature flag is off', async () => {
    const settings = fakeSettingsPort(baseSettings({ accountsEnabled: false }));
    const transport = fakeTransport({ settingsRow: null });
    const { engine } = makeEngine({ settings: settings.port, transport });
    await expect(engine.sync()).resolves.toMatchObject({ phase: 'idle' });
    expect(transport.calls.fetchSettings).toBe(0);
  });

  it('does nothing when no session is held', async () => {
    const transport = fakeTransport({ settingsRow: null });
    const { engine } = makeEngine({ token: null, transport });
    await expect(engine.sync()).resolves.toMatchObject({ phase: 'idle' });
    expect(transport.calls.fetchSettings).toBe(0);
  });

  it('reports unavailable and makes no call when no Data API URL is configured', async () => {
    const transport = fakeTransport({ settingsRow: null });
    const { engine } = makeEngine({ dataApiUrl: null, transport });
    const report = await engine.sync();
    expect(report.phase).toBe('unavailable');
    // Not a server failure: the UI must say the feature is not configured.
    expect(report.error).toBeUndefined();
    expect(transport.calls.fetchSettings).toBe(0);
  });

  it('builds no transport when signed out (no network attempt at all)', async () => {
    const makeTransport = vi.fn();
    const engine = new AccountsSyncEngine({
      getToken: async () => null,
      getConfig: () => ({ authBaseUrl: null, dataApiUrl: null }),
      makeTransport,
      state: fakeStateStore().store,
      settings: fakeSettingsPort(baseSettings()).port,
      signatures: fakeSignaturesPort().port,
      now: () => NOW,
    });
    const report = await engine.sync();
    expect(report.phase).toBe('idle');
    expect(makeTransport).not.toHaveBeenCalled();
  });

  it('builds no transport when the transport is unconfigured', async () => {
    const makeTransport = vi.fn();
    const engine = new AccountsSyncEngine({
      getToken: async () => 'jwt',
      getConfig: () => ({ authBaseUrl: null, dataApiUrl: null }),
      makeTransport,
      state: fakeStateStore().store,
      settings: fakeSettingsPort(baseSettings()).port,
      signatures: fakeSignaturesPort().port,
      now: () => NOW,
    });
    const report = await engine.sync();
    expect(report.phase).toBe('unavailable');
    expect(makeTransport).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Coordinator
// ---------------------------------------------------------------------------

describe('SyncCoordinator', () => {
  it('is single-flight: overlapping calls share one engine run', async () => {
    let resolveFn: ((r: { phase: 'synced' }) => void) | null = null;
    const engine = {
      sync: vi.fn(
        () => new Promise<{ phase: 'synced' }>((resolve) => { resolveFn = resolve; }),
      ),
    };
    const coordinator = new SyncCoordinator(engine, { debounceMs: 10 });

    const first = coordinator.syncNow();
    const second = coordinator.syncNow();
    expect(engine.sync).toHaveBeenCalledTimes(1);
    expect(first).toBe(second);

    resolveFn!({ phase: 'synced' });
    await expect(first).resolves.toEqual({ phase: 'synced' });
  });

  it('debounces requestSync into a single run', async () => {
    vi.useFakeTimers();
    try {
      const engine = { sync: vi.fn(async () => ({ phase: 'synced' as const })) };
      const coordinator = new SyncCoordinator(engine, { debounceMs: 100 });

      coordinator.requestSync();
      coordinator.requestSync();
      await vi.advanceTimersByTimeAsync(99);
      expect(engine.sync).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(2);
      expect(engine.sync).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('maps a rejected engine run to an error report instead of rejecting', async () => {
    const engine = { sync: vi.fn(async () => { throw new Error('kaput'); }) };
    const coordinator = new SyncCoordinator(engine);
    await expect(coordinator.syncNow()).resolves.toMatchObject({ phase: 'error' });
  });

  // The `accounts:syncReport` event is broadcast from the coordinator's
  // onReport callback, so these two tests cover the report stream's source:
  // both a renderer-triggered run and a debounced background run emit.
  it('emits every report through onReport on a triggered syncNow', async () => {
    const reports: SyncReport[] = [];
    const engine = { sync: vi.fn(async () => ({ phase: 'synced' as const, pushed: 1 })) };
    const coordinator = new SyncCoordinator(engine, { onReport: (r) => reports.push(r) });
    await coordinator.syncNow();
    expect(reports).toEqual([{ phase: 'synced', pushed: 1 }]);
  });

  it('emits a report for a debounced background run that no renderer triggered', async () => {
    vi.useFakeTimers();
    try {
      const reports: SyncReport[] = [];
      const engine = { sync: vi.fn(async () => ({ phase: 'idle' as const })) };
      const coordinator = new SyncCoordinator(engine, {
        debounceMs: 20,
        onReport: (r) => reports.push(r),
      });
      coordinator.requestSync();
      await vi.advanceTimersByTimeAsync(21);
      expect(reports).toEqual([{ phase: 'idle' }]);
      coordinator.dispose();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

describe('getAccountsConfig package.json resolution', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  it('reads the tflex block from package.json and lets the env override win', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tflex-cfg-'));
    dirs.push(dir);
    await writeFile(
      join(dir, 'package.json'),
      JSON.stringify({
        tflex: {
          neonAuthBaseUrl: 'https://pkg.test/auth',
          neonDataApiUrl: 'https://pkg.test/rest/v1',
        },
      }),
      'utf8',
    );

    expect(getAccountsConfig({} as NodeJS.ProcessEnv, dir)).toEqual({
      authBaseUrl: 'https://pkg.test/auth',
      dataApiUrl: 'https://pkg.test/rest/v1',
    });
    expect(
      getAccountsConfig(
        { TFLEX_DATA_API_URL: 'https://env.test/rest/v1' } as unknown as NodeJS.ProcessEnv,
        dir,
      ).dataApiUrl,
    ).toBe('https://env.test/rest/v1');
  });

  it('returns nulls for a missing package.json or missing block', async () => {
    const empty = await mkdtemp(join(tmpdir(), 'tflex-cfg-empty-'));
    dirs.push(empty);
    expect(getAccountsConfig({} as NodeJS.ProcessEnv, empty)).toEqual({
      authBaseUrl: null,
      dataApiUrl: null,
    });

    const dir = await mkdtemp(join(tmpdir(), 'tflex-cfg-'));
    dirs.push(dir);
    await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'x' }), 'utf8');
    expect(getAccountsConfig({} as NodeJS.ProcessEnv, dir)).toEqual({
      authBaseUrl: null,
      dataApiUrl: null,
    });
  });
});

// ---------------------------------------------------------------------------
// Concrete signatures port
// ---------------------------------------------------------------------------

describe('createSignaturesPort.applyRemote', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  it('upserts by id, removes soft-deleted ids, and preserves local order', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tflex-sig-port-'));
    dirs.push(dir);
    const service = new SignatureService(join(dir, 'signatures.json'));
    await service.save({ kind: 'typed', text: 'A', width: 1, height: 1 }, 'A');
    await service.save({ kind: 'typed', text: 'B', width: 1, height: 1 }, 'B');
    const port = createSignaturesPort(service);
    const list = await port.list();

    await port.applyRemote(
      [{ id: list[1].id, label: 'B2', createdAt: NOW, source: list[1].source }],
      [list[0].id],
    );

    const after = await port.list();
    expect(after).toHaveLength(1);
    expect(after[0].label).toBe('B2');
  });
});

// ---------------------------------------------------------------------------
// Local-edit stamping + end-to-end last-write-wins
// ---------------------------------------------------------------------------

describe('markLocalSettingsChanged', () => {
  it('does nothing on the first link (cloud remains authoritative)', async () => {
    const settings = fakeSettingsPort(baseSettings({ theme: 'dark' }));
    const state = fakeStateStore({});
    const { engine } = makeEngine({ settings: settings.port, stateWrapper: state });
    await engine.markLocalSettingsChanged();
    expect(state.state().localSettingsModifiedAt).toBeUndefined();
  });

  it('stamps the edit time when a synced preference changed', async () => {
    const settings = fakeSettingsPort(baseSettings({ theme: 'dark' }));
    const state = fakeStateStore({
      settingsSynced: pickSyncedSettings(baseSettings({ theme: 'light' })),
      settingsUpdatedAt: '2026-09-27T10:00:00.000Z',
      settingsRevision: 4,
    });
    const { engine } = makeEngine({ settings: settings.port, stateWrapper: state });
    await engine.markLocalSettingsChanged();
    expect(state.state().localSettingsModifiedAt).toBe(NOW);
  });

  it('does not stamp for a device-local-only change', async () => {
    const settings = fakeSettingsPort(
      baseSettings({ geometry: { x: 50, y: 60, width: 1, height: 1, maximized: true } }),
    );
    const state = fakeStateStore({
      settingsSynced: pickSyncedSettings(baseSettings()),
      settingsUpdatedAt: '2026-09-27T10:00:00.000Z',
      settingsRevision: 4,
    });
    const { engine } = makeEngine({ settings: settings.port, stateWrapper: state });
    await engine.markLocalSettingsChanged();
    expect(state.state().localSettingsModifiedAt).toBeUndefined();
  });

  it('keeps the first stamp once a local edit is pending', async () => {
    const settings = fakeSettingsPort(baseSettings({ theme: 'dark' }));
    const state = fakeStateStore({
      settingsSynced: pickSyncedSettings(baseSettings({ theme: 'light' })),
      settingsUpdatedAt: '2026-09-27T10:00:00.000Z',
      settingsRevision: 4,
      localSettingsModifiedAt: '2026-09-27T09:00:00.000Z',
    });
    const { engine } = makeEngine({ settings: settings.port, stateWrapper: state });
    await engine.markLocalSettingsChanged();
    expect(state.state().localSettingsModifiedAt).toBe('2026-09-27T09:00:00.000Z');
  });
});

describe('AccountsSyncEngine last-write-wins end to end', () => {
  it('pushes a newer local edit over an older cloud row', async () => {
    const settings = fakeSettingsPort(baseSettings({ theme: 'dark' }));
    const state = fakeStateStore({
      settingsSynced: pickSyncedSettings(baseSettings({ theme: 'light' })),
      settingsUpdatedAt: '2026-09-27T10:00:00.000Z',
      settingsRevision: 4,
      localSettingsModifiedAt: '2026-09-27T11:30:00.000Z',
    });
    const transport = fakeTransport({
      settingsRow: {
        settings: { theme: 'light' },
        revision: 4,
        device_id: 'dev-other',
        updated_at: '2026-09-27T11:00:00.000Z',
      },
    });
    const { engine } = makeEngine({ settings: settings.port, stateWrapper: state, transport });

    await engine.sync();

    expect(transport.calls.upsertSettings).toHaveLength(1);
    expect(transport.calls.upsertSettings[0].settings.theme).toBe('dark');
    expect(transport.calls.upsertSettings[0].revision).toBe(5);
  });

  it('pulls a newer cloud row over an older local edit', async () => {
    const settings = fakeSettingsPort(baseSettings({ theme: 'dark' }));
    const state = fakeStateStore({
      settingsSynced: pickSyncedSettings(baseSettings({ theme: 'light' })),
      settingsUpdatedAt: '2026-09-27T10:00:00.000Z',
      settingsRevision: 4,
      localSettingsModifiedAt: '2026-09-27T11:30:00.000Z',
    });
    const transport = fakeTransport({
      settingsRow: {
        settings: { theme: 'sepia' },
        revision: 4,
        device_id: 'dev-other',
        updated_at: '2026-09-27T11:45:00.000Z',
      },
    });
    const { engine } = makeEngine({ settings: settings.port, stateWrapper: state, transport });

    await engine.sync();

    expect(transport.calls.upsertSettings).toHaveLength(0);
    expect(settings.current().theme).toBe('sepia');
  });

  it('coordinator.requestSync stamps the local edit then schedules the run', async () => {
    const settings = fakeSettingsPort(baseSettings({ theme: 'dark' }));
    const state = fakeStateStore({
      settingsSynced: pickSyncedSettings(baseSettings({ theme: 'light' })),
      settingsUpdatedAt: '2026-09-27T10:00:00.000Z',
      settingsRevision: 4,
    });
    const { engine } = makeEngine({ settings: settings.port, stateWrapper: state });
    const coordinator = new SyncCoordinator(engine, { debounceMs: 10 });

    coordinator.requestSync();
    await Promise.resolve();
    // The async stamp runs before the debounce fires.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(state.state().localSettingsModifiedAt).toBe(NOW);
    coordinator.dispose();
  });
});
