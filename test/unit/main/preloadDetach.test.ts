// B9 — DOCX detached-method: preload detach-safety.
//
// The renderer's RealEngineAdapter wraps `window.tflex.engine` (the preload's
// exposed engineApi). A known renderer bug detaches an engine method
// (`const fn = engineRef.current.createDocxFromDoc; await fn(...)`) before
// calling it, so `this` is undefined inside the adapter and `this.inner`
// throws "Cannot read properties of undefined (reading 'inner')". The
// proper fix is renderer-side (call the method on the object, not
// detached), but that conflicts with upstream renderer code the backend
// cannot touch.
//
// What the backend CAN guarantee is that the PRELOAD layer itself never
// introduces an "inner null" error: every engineApi method is a shorthand
// object method that forwards to `ipcRenderer.invoke` and does not read
// any property off `this`. Detaching a preload method and calling it (so
// `this === undefined` in strict module mode) therefore resolves the IPC
// promise instead of throwing. These tests pin that invariant: they
// import the real preload module (with `electron` mocked), capture the
// object `contextBridge.exposeInMainWorld` received, detach each DOCX
// engine method, and assert the call reaches `ipcRenderer.invoke` with
// the correct channel + args — no inner-null throw.
//
// The engine side of B9 is already verified by bugSweep2.test.ts
// (B9: createDocxFromDoc — engine round-trip); this file covers the
// preload half of the same bug.

import { describe, expect, it, vi } from 'vitest';

const holder = vi.hoisted(() => ({
  // The object the preload hands to contextBridge.exposeInMainWorld.
  exposed: { value: null as unknown as Record<string, unknown> },
  // Mock for ipcRenderer.invoke — captures every IPC call the preload makes.
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

// Importing the preload module runs its top-level
// `contextBridge.exposeInMainWorld('tflex', api)` side effect, which the
// mock above captures into `holder.exposed.value`. vi.mock is hoisted
// above this import by vitest, so the mock is in place before the import
// executes.
import '../../../src/preload/preload';

function engineApi(): Record<string, unknown> {
  const api = holder.exposed.value;
  if (api === null || api === undefined) {
    throw new Error('preload did not expose an api via contextBridge');
  }
  const engine = api.engine;
  if (engine === undefined || engine === null) {
    throw new Error('preload api has no .engine surface');
  }
  return engine as Record<string, unknown>;
}

describe('B9: preload engineApi — detach-safe (no inner-null error)', () => {
  it('preload exposes the engine surface', () => {
    const engine = engineApi();
    expect(typeof engine.createDocxFromDoc).toBe('function');
    expect(typeof engine.createDocxFromImages).toBe('function');
  });

  it('createDocxFromDoc is detach-safe and forwards the docId + entries verbatim', async () => {
    const engine = engineApi();
    holder.invokeMock.mockClear();
    // The exact detach pattern the renderer's runAssembleDocx uses:
    //   const docxFn = engine.createDocxFromDoc; await docxFn(docId, entries);
    const docxFn = engine.createDocxFromDoc as (
      docId: string,
      entries: unknown[],
    ) => Promise<unknown>;
    // Must NOT throw "Cannot read properties of undefined (reading 'inner')".
    let threw: unknown = null;
    let result: unknown = undefined;
    try {
      result = await docxFn('doc-9', [{ pageNumber: 1 }]);
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeNull();
    expect(result).toBeUndefined(); // ipcRenderer.invoke resolves to undefined
    expect(holder.invokeMock).toHaveBeenCalledTimes(1);
    expect(holder.invokeMock).toHaveBeenCalledWith(
      'engine:createDocxFromDoc',
      'doc-9',
      [{ pageNumber: 1 }],
    );
  });

  it('createDocxFromImages is detach-safe and forwards entries verbatim', async () => {
    const engine = engineApi();
    holder.invokeMock.mockClear();
    const fn = engine.createDocxFromImages as (
      entries: unknown[],
    ) => Promise<unknown>;
    let threw: unknown = null;
    let result: unknown = undefined;
    try {
      result = await fn([{ pageNumber: 1 }]);
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeNull();
    expect(result).toBeUndefined();
    expect(holder.invokeMock).toHaveBeenCalledTimes(1);
    expect(holder.invokeMock).toHaveBeenCalledWith('engine:createDocxFromImages', [
      { pageNumber: 1 },
    ]);
  });

  it('insertBlankPage is detach-safe (B15 surface shares the same preload shape)', async () => {
    const engine = engineApi();
    holder.invokeMock.mockClear();
    const fn = engine.insertBlankPage as (
      docId: string,
      afterIndex: number,
      widthPx: number,
      heightPx: number,
    ) => Promise<unknown>;
    let threw: unknown = null;
    try {
      await fn('doc-15', 0, 612, 792);
    } catch (e) {
      threw = e;
    }
    expect(threw).toBeNull();
    expect(holder.invokeMock).toHaveBeenCalledWith(
      'engine:insertBlankPage',
      'doc-15',
      0,
      612,
      792,
    );
  });

  it('no engineApi method reads a property off `this` (detach-safe source)', () => {
    // Belt-and-braces: every engineApi method must be callable with
    // `this === undefined` (the detach scenario, strict mode) without
    // throwing a TypeError. The preload defines these as shorthand object
    // methods, so they technically have their own `this` binding — but the
    // guarantee that detaching never throws "Cannot read properties of
    // undefined (reading 'inner')" is that the body never reads a
    // property off `this`. Pin that by inspecting each method's source:
    // it must not contain a `this.` member access. (The four empirical
    // detach tests above already prove this at runtime; this asserts the
    // source-level invariant so a future refactor that introduces a
    // `this.something` access fails here before it reaches a user.)
    const engine = engineApi();
    const names = Object.keys(engine).filter(
      (k) => typeof engine[k] === 'function',
    );
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) {
      const src = (engine[name] as { toString(): string }).toString();
      expect(src).not.toMatch(/\bthis\s*\./);
    }
  });
});
