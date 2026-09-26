/**
 * Phase 44 — accounts IPC registration (main process).
 *
 * Registers the session channels against an `AccountsVault` and, when a sync
 * coordinator is supplied, the `accounts:syncNow` trigger. Kept in its own
 * module so the wiring is unit-testable with a fake ipcMain, and so the sync
 * transport does not have to be touched by window setup.
 *
 * The matching main -> renderer report stream (`accounts:syncReport`) is
 * broadcast from the coordinator's `onReport` callback in the wiring layer
 * (index.ts), so every produced report reaches the renderer even when no
 * renderer call triggered it.
 *
 * SECURITY: no handler ever returns the session token. `setSession` accepts
 * it, `getStatus` returns status + email, `clearSession` drops it.
 */

import type { IpcMain } from 'electron';
import { IPC } from '../../../shared/ipc';
import type {
  AccountsClientConfig,
  SetSessionPayload,
  SyncReport,
} from '../../../shared/accounts';
import type { AccountsConfig } from './config';
import type { AccountsVault } from './vault';

/** The slice of `SyncCoordinator` this module needs: the syncNow trigger.
 *  `syncNow` is single-flight and never rejects. */
export interface AccountsSyncTrigger {
  syncNow(): Promise<SyncReport>;
}

export function registerAccountsIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  vault: AccountsVault,
  sync?: AccountsSyncTrigger | null,
  getConfig?: (() => AccountsConfig) | null,
): void {
  ipcMain.handle(IPC.accountsGetStatus, () => vault.status());
  // Renderer -> main: the non-secret accounts config used to construct the
  // auth client in the renderer. Never throws: a missing provider or an
  // accessor failure resolves the unconfigured shape. The Data API URL and
  // the session token are never part of this response.
  ipcMain.handle(IPC.accountsGetConfig, (): AccountsClientConfig => {
    let authBaseUrl: string | null = null;
    try {
      authBaseUrl = getConfig ? getConfig().authBaseUrl : null;
    } catch {
      authBaseUrl = null;
    }
    return { authBaseUrl, configured: authBaseUrl !== null };
  });
  ipcMain.handle(IPC.accountsSetSession, async (_event, payload: unknown) => {
    await vault.setSession(payload as SetSessionPayload);
  });
  ipcMain.handle(IPC.accountsClearSession, () => vault.clearSession());
  if (sync) {
    // Renderer -> main: trigger a sync and resolve with its report. Never
    // rejects (the coordinator maps failures), so the renderer always gets a
    // `SyncReport` to branch on.
    ipcMain.handle(IPC.accountsSyncNow, () => sync.syncNow());
  }
}
