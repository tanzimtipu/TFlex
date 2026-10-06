// Phase 112 (TFL-986) — Home Recent panel preload contract.
//
// The main-process handlers are covered in index.test.ts and the RecentFile
// normalisation in settings.test.ts. This file covers the PRELOAD half: the
// renderer-facing bridge exists and forwards the exact channel + payload to
// `ipcRenderer.invoke` for `showInFolder` / `locateMissing`.

import { describe, expect, it, vi } from 'vitest';
import { IPC } from '../../../src/shared/ipc';

const holder = vi.hoisted(() => ({
  exposed: { value: null as unknown as Record<string, unknown> },
  invokeMock: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld(_name: string, api: unknown): void {
      holder.exposed.value = api as Record<string, unknown>;
    },
  },
  ipcRenderer: {
    invoke: holder.invokeMock,
    on(): void {},
    removeListener(): void {},
    send(): void {},
  },
  webUtils: { getPathForFile: () => '' },
}));

import '../../../src/preload/preload';

describe('Phase 112: recent-files preload contract', () => {
  it('names the two channels', () => {
    expect(IPC.recentShowInFolder).toBe('recent:showInFolder');
    expect(IPC.recentLocateMissing).toBe('recent:locateMissing');
    expect(IPC.recentCheckMissing).toBe('recent:checkMissing');
  });

  it('exposes showInFolder and locateMissing as functions', () => {
    const api = holder.exposed.value;
    expect(api).not.toBeNull();
    expect(typeof api.showInFolder).toBe('function');
    expect(typeof api.locateMissing).toBe('function');
    expect(typeof api.checkMissing).toBe('function');
  });

  it('showInFolder forwards the path on recent:showInFolder', async () => {
    const api = holder.exposed.value;
    holder.invokeMock.mockClear();
    holder.invokeMock.mockResolvedValueOnce({ ok: true });
    const fn = api.showInFolder as (path: string) => Promise<unknown>;
    await expect(fn('/a/b.pdf')).resolves.toEqual({ ok: true });
    expect(holder.invokeMock).toHaveBeenCalledTimes(1);
    expect(holder.invokeMock).toHaveBeenCalledWith('recent:showInFolder', '/a/b.pdf');
  });

  it('locateMissing forwards on recent:locateMissing and passes the result through', async () => {
    const api = holder.exposed.value;
    holder.invokeMock.mockClear();
    holder.invokeMock.mockResolvedValueOnce('/picked.pdf');
    const fn = api.locateMissing as () => Promise<unknown>;
    await expect(fn()).resolves.toBe('/picked.pdf');
    expect(holder.invokeMock).toHaveBeenCalledTimes(1);
    expect(holder.invokeMock).toHaveBeenCalledWith('recent:locateMissing');
  });

  it('checkMissing forwards the path array on recent:checkMissing and passes the result through', async () => {
    const api = holder.exposed.value;
    holder.invokeMock.mockClear();
    holder.invokeMock.mockResolvedValueOnce(['/gone.pdf']);
    const fn = api.checkMissing as (paths: readonly string[]) => Promise<unknown>;
    await expect(fn(['/a/b.pdf', '/c/d.pdf'])).resolves.toEqual(['/gone.pdf']);
    expect(holder.invokeMock).toHaveBeenCalledTimes(1);
    expect(holder.invokeMock).toHaveBeenCalledWith('recent:checkMissing', ['/a/b.pdf', '/c/d.pdf']);
  });
});
