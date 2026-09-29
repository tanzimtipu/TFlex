import { BrowserWindow, type WebContents } from 'electron';
import { IPC } from '../../shared/ipc';
import type {
  TabTransferPayload,
  TabTransferResult,
} from '../../shared/ipc';
import type { DetachedWindowHandle } from '../window';

/**
 * Phase 58 — detaching a document tab into a SECOND app window and returning
 * it. This service owns the parent map (child window id -> parent window id)
 * and the detached set (the map's keys); index.ts only registers the four
 * invoke channels against it. A detached window is NEVER treated as THE main
 * window, never persists `settings.geometry`, and is never recreated by the
 * main-window lifecycle — those concerns stay in index.ts / window.ts.
 */

export interface TabWindowDeps {
  rendererHtml: string;
  rendererDevUrl?: string;
  /** Builds the detached app window. index.ts passes a closure over
   *  `createDetachedWindow`; the `{ detached: true }` marker keeps the
   *  contract explicit at the call site. DEF-416 — the handle separates
   *  creation from `load()` so the adopt listener is attached before the
   *  page starts loading. */
  createWindow: (opts: { detached: true }) => DetachedWindowHandle;
}

export interface TabWindowsHandlers {
  openDetached(sender: WebContents, payload: TabTransferPayload): TabTransferResult;
  handleAdoptAck(sender: WebContents, ok: boolean): void;
  handleReturn(sender: WebContents, payload: TabTransferPayload): TabTransferResult;
  handleEmpty(sender: WebContents): void;
}

/**
 * Pure target resolution for `tab:return`, exported for the unit tests.
 * The parent wins when it is still live; otherwise the LOWEST-id live window
 * that is not itself detached; otherwise null. `parentOf`'s keys are the
 * detached windows, so they are ignored by the fallback.
 */
export function resolveReturnTarget(
  senderWindowId: number,
  parentOf: ReadonlyMap<number, number>,
  liveWindowIds: readonly number[],
): number | null {
  const parent = parentOf.get(senderWindowId);
  if (parent !== undefined && liveWindowIds.includes(parent)) {
    return parent;
  }
  const detached = new Set(parentOf.keys());
  let best: number | null = null;
  for (const id of liveWindowIds) {
    if (detached.has(id)) {
      continue;
    }
    if (best === null || id < best) {
      best = id;
    }
  }
  return best;
}

export function createTabWindows(deps: TabWindowDeps): TabWindowsHandlers {
  // Child window id -> parent (sender) window id. The keys are exactly the
  // detached windows; a `closed` listener drops the entry.
  const parentOf = new Map<number, number>();

  const openDetached = (
    sender: WebContents,
    payload: TabTransferPayload,
  ): TabTransferResult => {
    const origin = BrowserWindow.fromWebContents(sender);
    if (origin === null || origin.isDestroyed()) {
      return { ok: false, reason: 'failed' };
    }
    const child = deps.createWindow({ detached: true });
    const win = child.window;
    parentOf.set(win.id, origin.id);
    // DEF-416 — attach the adopt listener BEFORE `load()` starts the page, so
    // `did-finish-load` can never fire before the listener exists. The
    // once-guard makes delivery idempotent; the `isLoading()` check delivers
    // immediately to a window that has already finished loading. A blank
    // adopt payload is therefore impossible.
    let delivered = false;
    const deliver = (): void => {
      if (delivered) {
        return;
      }
      delivered = true;
      if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
        win.webContents.send(IPC.tabAdoptEvent, payload);
      }
    };
    win.webContents.once('did-finish-load', deliver);
    win.on('closed', () => {
      parentOf.delete(win.id);
    });
    child.load();
    if (!win.webContents.isLoading()) {
      deliver();
    }
    return { ok: true, windowId: win.id };
  };

  const handleAdoptAck = (sender: WebContents, ok: boolean): void => {
    const child = BrowserWindow.fromWebContents(sender);
    if (child === null) {
      return;
    }
    const parentId = parentOf.get(child.id);
    if (parentId === undefined) {
      return;
    }
    const parent = BrowserWindow.fromId(parentId);
    if (parent !== null && !parent.isDestroyed() && !parent.webContents.isDestroyed()) {
      parent.webContents.send(IPC.tabDetachResolvedEvent, { ok, windowId: child.id });
    }
  };

  const handleReturn = (
    sender: WebContents,
    payload: TabTransferPayload,
  ): TabTransferResult => {
    const senderWindow = BrowserWindow.fromWebContents(sender);
    if (senderWindow === null) {
      return { ok: false, reason: 'failed' };
    }
    const liveWindowIds = BrowserWindow.getAllWindows()
      .filter((win) => !win.isDestroyed())
      .map((win) => win.id);
    const targetId = resolveReturnTarget(senderWindow.id, parentOf, liveWindowIds);
    if (targetId === null) {
      return { ok: false, reason: 'failed' };
    }
    const target = BrowserWindow.fromId(targetId);
    if (target === null || target.isDestroyed() || target.webContents.isDestroyed()) {
      return { ok: false, reason: 'failed' };
    }
    target.webContents.send(IPC.tabAdoptEvent, payload);
    return { ok: true, windowId: target.id };
  };

  const handleEmpty = (sender: WebContents): void => {
    const win = BrowserWindow.fromWebContents(sender);
    if (win === null || win.isDestroyed()) {
      return;
    }
    // Only a tracked detached window may be closed this way.
    if (parentOf.has(win.id)) {
      win.close();
    }
  };

  return { openDetached, handleAdoptAck, handleReturn, handleEmpty };
}