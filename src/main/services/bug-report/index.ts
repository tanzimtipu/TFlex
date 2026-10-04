/**
 * Phase 101 - bug-report service factory + IPC wiring (main process only).
 *
 * `createBugReportService` builds the persisted queue and the unauthenticated
 * Function transport (or none when the Function API URL is not configured) and
 * kicks off the single startup flush. `registerBugReportIpc` exposes the
 * renderer's `bugReport:capture` channel on the SAME service used by the
 * main-process handlers. `installIpcHandlerCapture` wraps `ipcMain.handle`
 * once so a rejected handler is captured without changing any handler's
 * behaviour.
 */

import { join } from 'node:path';
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { IPC } from '../../../shared/ipc';
import type { BugReportInput } from '../../../shared/bugReport';
import type { AccountsConfig } from '../accounts/config';
import { BugReportService } from './capture';
import { BugReportQueue } from './queue';
import { FunctionBugReportTransport } from './transport';
import type { BugReportTransport } from './types';

export { BugReportService } from './capture';
export { BugReportQueue, BreadcrumbRing } from './queue';
export { FunctionBugReportTransport } from './transport';

export interface CreateBugReportServiceOptions {
  userDataDir: string;
  config: AccountsConfig;
  getSessionUserId: () => string | null | Promise<string | null>;
  appVersion: string;
  build?: string | null;
  environment?: string;
  locale?: string | null;
  transport?: BugReportTransport | null;
  fetchImpl?: typeof globalThis.fetch;
  now?: () => string;
  debounceMs?: number;
}

export function createBugReportService(
  options: CreateBugReportServiceOptions,
): BugReportService {
  const queue = new BugReportQueue({
    filePath: join(options.userDataDir, 'bug-reports-queue.json'),
  });
  const transport =
    options.transport !== undefined
      ? options.transport
      : options.config.functionApiUrl === null
        ? null
        : new FunctionBugReportTransport({
            functionApiUrl: options.config.functionApiUrl,
            fetchImpl: options.fetchImpl,
          });
  const service = new BugReportService({
    queue,
    transport,
    getSessionUserId: options.getSessionUserId,
    appVersion: options.appVersion,
    build: options.build,
    environment: options.environment,
    locale: options.locale,
    now: options.now,
    debounceMs: options.debounceMs,
  });
  // One opportunistic flush at startup; fire-and-forget and never throwing.
  void service.flush();
  return service;
}

export function registerBugReportIpc(
  ipcMain: Pick<IpcMain, 'handle'>,
  service: BugReportService,
): void {
  ipcMain.handle(IPC.bugReportCapture, (_event, input: BugReportInput) =>
    service.capture(input),
  );
}

/** Install the once-only wrapper that captures a rejected `ipcMain.handle`
 *  result and RE-THROWS it, so the renderer still sees the original failure.
 *  Handlers that return a plain value are untouched. */
export function installIpcHandlerCapture(
  ipcMain: Pick<IpcMain, 'handle'>,
  capture: (channel: string, error: unknown) => void,
): void {
  type Listener = (event: IpcMainInvokeEvent, ...args: never[]) => unknown;
  const target = ipcMain as unknown as {
    handle: (channel: string, listener: Listener) => void;
  };
  const original = target.handle.bind(ipcMain);
  target.handle = (channel: string, listener: Listener): void => {
    const wrapped: Listener = (event, ...args) => {
      const result = listener(event, ...args);
      if (
        result !== null &&
        typeof result === 'object' &&
        typeof (result as PromiseLike<unknown>).then === 'function'
      ) {
        return Promise.resolve(result as PromiseLike<unknown>).catch((error: unknown) => {
          capture(channel, error);
          throw error;
        });
      }
      return result;
    };
    original(channel, wrapped);
  };
}
