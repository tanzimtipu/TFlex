import { vi, describe, it, expect } from 'vitest';

// tabWindows.ts imports BrowserWindow at module load; the pure
// `resolveReturnTarget` under test never touches it, but the import must
// resolve. Mirrors the electron mock style of window.test.ts. `vi.fn()`
// so the delivery tests can control `fromWebContents`.
vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: vi.fn(() => null),
    fromId: vi.fn(() => null),
    getAllWindows: vi.fn(() => []),
  },
}));

import { BrowserWindow, type WebContents } from 'electron';
import { createTabWindows } from '../../../src/main/services/tabWindows';
import { resolveReturnTarget } from '../../../src/main/services/tabWindows';
import { createAdoptBuffer } from '../../../src/preload/adoptBuffer';
import type { DetachedWindowHandle } from '../../../src/main/window';
import { IPC } from '../../../src/shared/ipc';
import type {
  TabDetachResolved,
  TabTransferPayload,
  TabTransferResult,
} from '../../../src/shared/ipc';

describe('Phase 58 resolveReturnTarget', () => {
  it('returns the live parent when it is still alive', () => {
    const parentOf = new Map<number, number>([[10, 9]]);
    expect(resolveReturnTarget(10, parentOf, [2, 9, 10])).toBe(9);
  });

  it('falls back to the lowest-id live non-detached window when the parent is gone', () => {
    const parentOf = new Map<number, number>([[10, 9]]);
    // 9 is gone; 7 and 2 survive, neither detached -> lowest id wins.
    expect(resolveReturnTarget(10, parentOf, [7, 2, 10])).toBe(2);
  });

  it('returns null when no live app window remains', () => {
    const parentOf = new Map<number, number>([
      [10, 9],
      [11, 9],
    ]);
    // Both survivors are detached; the parent 9 is gone.
    expect(resolveReturnTarget(10, parentOf, [10, 11])).toBeNull();
  });

  it('ignores detached windows in the fallback', () => {
    const parentOf = new Map<number, number>([
      [10, 99],
      [5, 99],
    ]);
    // 99 is gone; 5 is detached (a key in parentOf), so no target remains.
    expect(resolveReturnTarget(10, parentOf, [5, 10])).toBeNull();
  });

  it('prefers the parent over a lower-id live window', () => {
    const parentOf = new Map<number, number>([[10, 9]]);
    expect(resolveReturnTarget(10, parentOf, [2, 9, 10])).toBe(9);
  });
});

describe('Phase 58 shared contract', () => {
  it('exposes the tab channels', () => {
    expect(IPC.tabDetach).toBe('tab:detach');
    expect(IPC.tabAdoptEvent).toBe('tab:adopt');
    expect(IPC.tabAdoptAck).toBe('tab:adoptAck');
    expect(IPC.tabDetachResolvedEvent).toBe('tab:detachResolved');
    expect(IPC.tabReturn).toBe('tab:return');
    expect(IPC.tabEmpty).toBe('tab:empty');
  });

  it('carries the payload/result/resolved shapes', () => {
    const payload: TabTransferPayload = {
      title: 'a.pdf',
      bytes: new Uint8Array([1, 2, 3]),
      modified: true,
    };
    expect(payload.bytes.length).toBe(3);

    const ok: TabTransferResult = { ok: true, windowId: 42 };
    const failed: TabTransferResult = { ok: false, reason: 'failed' };
    expect(ok).toEqual({ ok: true, windowId: 42 });
    expect(failed.ok).toBe(false);

    const resolved: TabDetachResolved = { ok: false, windowId: 42 };
    expect(resolved.windowId).toBe(42);
  });
});

describe('Phase 58 deterministic detached delivery (DEF-416)', () => {
  const payload: TabTransferPayload = {
    title: 'a.pdf',
    bytes: new Uint8Array([1, 2, 3]),
    modified: true,
  };

  function makeOrigin(): BrowserWindow {
    return { id: 9, isDestroyed: () => false } as unknown as BrowserWindow;
  }

  function makeChild(opts: { isLoading: () => boolean }): {
    handle: DetachedWindowHandle;
    order: string[];
    send: ReturnType<typeof vi.fn>;
    fire: () => void;
  } {
    const order: string[] = [];
    let done: (() => void) | null = null;
    const send = vi.fn();
    const webContents = {
      once: vi.fn((event: string, cb: () => void) => {
        if (event === 'did-finish-load') {
          order.push('attach');
          done = cb;
        }
        return webContents;
      }),
      send,
      isDestroyed: () => false,
      isLoading: opts.isLoading,
    };
    const win = {
      id: 77,
      isDestroyed: () => false,
      webContents,
      on: vi.fn(),
    };
    const load = vi.fn(() => {
      order.push('load');
    });
    return {
      handle: { window: win, load } as unknown as DetachedWindowHandle,
      order,
      send,
      fire: () => done?.(),
    };
  }

  it('attaches the adopt listener before load and sends once it finishes loading', () => {
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(makeOrigin());
    const child = makeChild({ isLoading: () => true });
    const handlers = createTabWindows({
      rendererHtml: 'index.html',
      createWindow: () => child.handle,
    });

    const result = handlers.openDetached({} as WebContents, payload);

    expect(result).toEqual({ ok: true, windowId: 77 });
    // The listener is attached BEFORE load() runs, so the event cannot be missed.
    expect(child.order).toEqual(['attach', 'load']);
    expect(child.send).not.toHaveBeenCalled();

    child.fire();
    expect(child.send).toHaveBeenCalledTimes(1);
    expect(child.send).toHaveBeenCalledWith(IPC.tabAdoptEvent, payload);

    // Once-guard: a repeated did-finish-load never double-sends.
    child.fire();
    expect(child.send).toHaveBeenCalledTimes(1);
  });

  it('delivers immediately to a window that already finished loading', () => {
    vi.mocked(BrowserWindow.fromWebContents).mockReturnValue(makeOrigin());
    const child = makeChild({ isLoading: () => false });
    const handlers = createTabWindows({
      rendererHtml: 'index.html',
      createWindow: () => child.handle,
    });

    handlers.openDetached({} as WebContents, payload);

    expect(child.order).toEqual(['attach', 'load']);
    expect(child.send).toHaveBeenCalledTimes(1);
    expect(child.send).toHaveBeenCalledWith(IPC.tabAdoptEvent, payload);

    // A later did-finish-load must not send a second payload.
    child.fire();
    expect(child.send).toHaveBeenCalledTimes(1);
  });
});

describe('Phase 58 preload adopt buffer (DEF-416 late-subscription delivery)', () => {
  const first: TabTransferPayload = {
    title: 'a.pdf',
    bytes: new Uint8Array([1]),
    modified: false,
  };
  const second: TabTransferPayload = {
    title: 'b.pdf',
    bytes: new Uint8Array([2]),
    modified: true,
  };
  const third: TabTransferPayload = {
    title: 'c.pdf',
    bytes: new Uint8Array([3]),
    modified: false,
  };

  it('replays a payload pushed before subscribe exactly once, then streams straight through', () => {
    const buffer = createAdoptBuffer<TabTransferPayload>();

    // Main's `tab:adopt` can arrive before the renderer's useEffect runs.
    buffer.push(first);
    const seen: TabTransferPayload[] = [];
    const unsubscribe = buffer.subscribe((p) => seen.push(p));
    expect(seen).toEqual([first]); // replayed, exactly once

    // Subsequent pushes go straight to the live consumer, no replay.
    buffer.push(second);
    expect(seen).toEqual([first, second]);

    // A gap without a consumer buffers again and replays once on resubscribe.
    unsubscribe();
    buffer.push(third);
    expect(seen).toEqual([first, second]);
    const resubscribed: TabTransferPayload[] = [];
    buffer.subscribe((p) => resubscribed.push(p));
    expect(resubscribed).toEqual([third]);
  });
});