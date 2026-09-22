import { describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Phase 35 - the standalone print window's preload bridge. Mirrors
// preloadDetach.test.ts: the real preload module runs its top-level
// contextBridge.exposeInMainWorld side effect against a mocked electron, and
// the captured api is exercised directly.
// ---------------------------------------------------------------------------

const holder = vi.hoisted(() => ({
  exposed: { value: null as unknown as Record<string, unknown> },
  invokeMock: vi.fn(),
  onMock: vi.fn(),
  removeListenerMock: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld(_name: string, api: unknown): void {
      holder.exposed.value = api as Record<string, unknown>;
    },
  },
  ipcRenderer: {
    invoke: holder.invokeMock,
    on: holder.onMock,
    removeListener: holder.removeListenerMock,
    send: vi.fn(),
  },
  webUtils: { getPathForFile: vi.fn() },
}));

import '../../../src/preload/preload';
import { IPC } from '../../../src/shared/ipc';
import type { PrintWindowContext } from '../../../src/shared/types';

function printWindowApi(): Record<string, unknown> {
  const api = holder.exposed.value;
  if (api === null || api === undefined) {
    throw new Error('preload did not expose an api via contextBridge');
  }
  return api.printWindow as Record<string, unknown>;
}

const CONTEXT: PrintWindowContext = {
  docId: 'doc-9',
  documentName: 'Doc.pdf',
  pageCount: 2,
  settings: {},
};

describe('Phase 35 - preload printWindow bridge', () => {
  it('exposes the printWindow surface', () => {
    const bridge = printWindowApi();
    expect(typeof bridge.open).toBe('function');
    expect(typeof bridge.notifyDocumentGone).toBe('function');
    expect(typeof bridge.onDocumentGone).toBe('function');
  });

  it('open() invokes print:openWindow with the context', async () => {
    holder.invokeMock.mockResolvedValue({ ok: true, created: true });
    const result = await (printWindowApi().open as (c: unknown) => Promise<unknown>)(CONTEXT);
    expect(holder.invokeMock).toHaveBeenCalledWith(IPC.printOpenWindow, CONTEXT);
    expect(result).toEqual({ ok: true, created: true });
  });

  it('notifyDocumentGone() invokes print:notifyDocumentGone with the doc id', async () => {
    holder.invokeMock.mockResolvedValue(undefined);
    await (printWindowApi().notifyDocumentGone as (id: string) => Promise<void>)('doc-9');
    expect(holder.invokeMock).toHaveBeenCalledWith(IPC.printNotifyDocumentGone, 'doc-9');
  });

  it('onDocumentGone() subscribes to print:documentGone and returns an unsubscribe', () => {
    const cb = vi.fn();
    const unsubscribe = (printWindowApi().onDocumentGone as (cb: (id: string) => void) => () => void)(cb);

    expect(holder.onMock).toHaveBeenCalledWith(IPC.printDocumentGoneEvent, expect.any(Function));
    const listener = holder.onMock.mock.calls[holder.onMock.mock.calls.length - 1][1] as (
      event: unknown,
      id: string,
    ) => void;
    listener({}, 'doc-9');
    expect(cb).toHaveBeenCalledWith('doc-9');

    unsubscribe();
    expect(holder.removeListenerMock).toHaveBeenCalledWith(IPC.printDocumentGoneEvent, listener);
  });
});