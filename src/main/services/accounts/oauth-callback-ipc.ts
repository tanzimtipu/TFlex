/**
 * Phase 46 - loopback callback IPC registration (main process).
 *
 * Registers the two request channels against an `OAuthCallbackService`; the
 * matching main -> renderer outcome stream (`accounts:oauthCallback`) is
 * broadcast from the wiring layer (index.ts), so it lands even when the
 * listener was reached after the renderer that started it changed windows.
 *
 * Kept separate from `registerAccountsIpc` so the existing session/sync
 * registration and its tests are untouched.
 */

import type { IpcMain } from 'electron';
import { IPC } from '../../../shared/ipc';
import type { OAuthCallbackController } from './oauth-callback';

export function registerOAuthCallbackIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  service: OAuthCallbackController,
): void {
  // Renderer -> main: bind the listener and resolve `{ callbackUrl }`. Only
  // the invoking renderer receives the URL (and therefore the one-time token).
  ipcMain.handle(IPC.accountsStartOAuthCallback, () => service.start());
  // Renderer -> main: cancel and clean up. Never rejects.
  ipcMain.handle(IPC.accountsStopOAuthCallback, () => service.stop());
}
