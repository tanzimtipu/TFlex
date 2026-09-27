// Phase 47 / DEF-365 - the auth popup completion rule once the loopback
// listener has served its one valid request.
//
// The listener clears its `active` state the instant a valid callback lands,
// but Electron fires the popup's `did-navigate` a tick after the response
// flushes. This pins the rule that closed the operator's blocker: the minted
// URL stays available to the completion matcher (retained by
// OAuthCallbackService), so the popup closes on the real landing; and the
// popup's `closed` event drops the retained URL.
import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  BrowserWindow: class {},
  screen: { getAllDisplays: vi.fn().mockReturnValue([]) },
}));

import { installAuthPopupHandler } from '../../../src/main/window';
import type { OAuthTraceEvent } from '../../../src/shared/accounts';

class FakeEmitter {
  private listeners: Record<string, Array<(...a: unknown[]) => void>> = {};
  on(event: string, cb: (...a: unknown[]) => void): this {
    (this.listeners[event] ??= []).push(cb);
    return this;
  }
  emit(event: string, ...args: unknown[]): void {
    for (const cb of this.listeners[event] ?? []) cb(...args);
  }
}

class FakeWebContents extends FakeEmitter {
  session = { cookies: { get: vi.fn().mockResolvedValue([]) } };
  openHandler: ((d: { url: string }) => unknown) | null = null;
  setWindowOpenHandler(fn: (d: { url: string }) => unknown): void {
    this.openHandler = fn;
  }
}

class FakeWindow extends FakeEmitter {
  webContents = new FakeWebContents();
  close = vi.fn((): void => {
    this.emit('closed');
  });
  isDestroyed = vi.fn().mockReturnValue(false);
}

function setup(loopback: string | null): {
  win: FakeWindow;
  trace: OAuthTraceEvent[];
  onPopupClosed: ReturnType<typeof vi.fn>;
} {
  const win = new FakeWindow();
  const trace: OAuthTraceEvent[] = [];
  const onPopupClosed = vi.fn();
  installAuthPopupHandler(win as never, {
    getAuthHost: () => 'auth.example.com',
    getAppUrl: () => null,
    getLoopbackUrl: () => loopback,
    onPopupClosed,
    onTrace: (event) => trace.push(event),
  });
  return { win, trace, onPopupClosed };
}

const MINTED = 'http://localhost:41234/oauth/callback?token=secret-token';

describe('installAuthPopupHandler completion (DEF-365)', () => {
  it('closes the popup and traces completion when did-navigate lands on the retained URL', () => {
    const { win, trace, onPopupClosed } = setup(MINTED);
    const child = new FakeWindow();
    win.webContents.emit('did-create-window', child);

    // The provider appends code/state; the matcher compares origin+path only.
    child.webContents.emit('did-navigate', {}, `${MINTED}&code=abc&state=xyz`);

    expect(child.close).toHaveBeenCalledTimes(1);
    const complete = trace.find((event) => event.kind === 'popup-complete');
    expect(complete).toBeDefined();
    expect(complete?.url).toBe('http://localhost:41234/oauth/callback');
    expect(JSON.stringify(trace)).not.toContain('token=');
    // The popup closed (its `closed` event fires on close in this fake), so the
    // retained URL is dropped at once.
    expect(onPopupClosed).toHaveBeenCalledTimes(1);
  });

  it('leaves the popup open when did-navigate does not match the completion URL', () => {
    const { win, trace, onPopupClosed } = setup(MINTED);
    const child = new FakeWindow();
    win.webContents.emit('did-create-window', child);

    child.webContents.emit('did-navigate', {}, 'https://accounts.google.com/signin/oauth');

    expect(child.close).not.toHaveBeenCalled();
    expect(onPopupClosed).not.toHaveBeenCalled();
    expect(trace.map((event) => event.kind)).not.toContain('popup-complete');
  });
});
