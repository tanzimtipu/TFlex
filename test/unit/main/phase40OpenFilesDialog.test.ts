// Phase 40 — shared-contract wiring for the "Merge PDF from scratch"
// multi-select file picker.
//
// The dialog service itself is covered by dialog.test.ts (several files,
// normalized order, empty-on-cancel). The main-process registration is
// asserted in index.test.ts. This file covers the PRELOAD half of the
// contract: the renderer-facing `window.tflex.openFilesDialog` exists and
// forwards the exact channel + optional `kind` to `ipcRenderer.invoke`.

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
}));

import '../../../src/preload/preload';

describe('Phase 40: openFilesDialog contract', () => {
  it('names the channel dialog:openFiles', () => {
    expect(IPC.openFilesDialog).toBe('dialog:openFiles');
  });

  it('preload exposes openFilesDialog as a function', () => {
    const api = holder.exposed.value;
    expect(api).not.toBeNull();
    expect(typeof api.openFilesDialog).toBe('function');
  });

  it('forward the kind to ipcRenderer.invoke on dialog:openFiles', async () => {
    const api = holder.exposed.value;
    holder.invokeMock.mockClear();
    const fn = api.openFilesDialog as (kind?: string) => Promise<unknown>;
    await fn('pdf');
    expect(holder.invokeMock).toHaveBeenCalledTimes(1);
    expect(holder.invokeMock).toHaveBeenCalledWith('dialog:openFiles', 'pdf');
  });

  it('forwards undefined kind when omitted (defaults to the PDF filter in main)', async () => {
    const api = holder.exposed.value;
    holder.invokeMock.mockClear();
    const fn = api.openFilesDialog as (kind?: string) => Promise<unknown>;
    await fn();
    expect(holder.invokeMock).toHaveBeenCalledWith('dialog:openFiles', undefined);
  });
});
