import { app, BrowserWindow, clipboard, dialog, ipcMain, safeStorage, session, shell } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { IPC } from '../shared/ipc';
import type { TabTransferPayload } from '../shared/ipc';
import type { OAuthCallbackOutcome, OAuthTraceEvent } from '../shared/accounts';
import type {
  AppSettings,
  AddStampPayload,
  AddTextBoxPayload,
  ApplyRedactionsPayload,
  CreateAnnotationPayload,
  CropEntry,
  DocxImageEntry,
  EditAnnotationPayload,
  EditImagePayload,
  EditTextRunPayload,
  ExportPagesPayload,
  FdfOpenError,
  FillFormFieldPayload,
  MenuEnabledState,
  MovePagesBetweenDocsPayload,
  MoveSignaturePayload,
  OpenFileDialogKind,
  OcrProgress,
  OcrRecognizeOptions,
  EncryptDocumentOptions,
  OpEntry,
  OptimizePreset,
  OutlineEntry,
  PageLabelEntry,
  PlaceSignaturePayload,
  PrintJobPayload,
  RecentFile,
  TextBoxStylePatch,
  WatermarkInfo,
  WatermarkSettings,
} from '../shared/types';
import type { SignatureSource } from '../shared/types';
import { DEFAULT_PDF_VALIDATION_DEFAULTS } from '../shared/types';
import { DEFAULT_OFFICE_CONVERT_DEFAULTS } from '../shared/types';
import { DEFAULT_IMAGE_IMPORT_DEFAULTS } from '../shared/types';
import type { ExportPptxPayload, ExportXlsxPayload } from '../shared/export';
import type { EngineError } from '../shared/types';
import type { Result } from '../shared/result';
import type {
  EngineSaveResult,
  ValidationReport,
  ValidationTarget,
} from '../shared/validation';
import type { ConvertOptions } from '../shared/convert';
import { openPdfDialog, openPdfDialogMulti, saveFormDataDialog, savePdfDialog } from './services/dialog';
import { readClipboardImage, type ClipboardLike } from './services/clipboard-image';
import { EngineService } from './services/engine';
import { OcrService } from './services/ocr';
import { DictionaryService } from './services/dictionary';
import { DocumentConversionService } from './services/convert';
import { exportXlsx } from './services/export/xlsx-export';
import { exportPptx } from './services/export/pptx-export';
import { DocumentValidationService, runExportGuard } from './services/validation';
import { loadPdfFile, loadFdfFile, loadFormDataFile, writeFormDataFile } from './services/pdf-file';
import { describePdfOpenError } from './services/error-text';
import { listPrinters, printJob } from './services/print';
import { setBundledFontDir } from './services/fonts';
import { SamplesService } from './services/samples';
import { DEFAULT_SETTINGS, SettingsService } from './services/settings';
import { SignatureService } from './services/signature-service';
import { AccountsVault } from './services/accounts/vault';
import { registerAccountsIpc } from './services/accounts/ipc';
import { getAccountsConfig } from './services/accounts/config';
import {
  completeOAuthExchange,
  type OAuthExchangeSession,
} from './services/accounts/oauth-exchange';
import { SyncStateStore } from './services/accounts/sync-state';
import { AccountsSyncEngine, SyncCoordinator } from './services/accounts/sync';
import { PostgrestSyncTransport } from './services/accounts/transport';
import { createSettingsPort, createSignaturesPort } from './services/accounts/ports';
import { OAuthCallbackService } from './services/accounts/oauth-callback';
import { registerOAuthCallbackIpc } from './services/accounts/oauth-callback-ipc';
import { clearAuthChallengeCookies } from './services/accounts/auth-cookies';
import { appendOAuthTraceLine } from './services/accounts/oauth-trace-file';
import { installAuthOriginHeader } from './services/accounts/origin-header';
import { openAuthUrlExternally, openDefaultAppsSettings } from './services/os-links';
import { UpdateService } from './services/update-service';
import { LEGACY_USERDATA_DIRNAME, migrateLegacyUserData } from './services/userdata-migration';
import { applyMenuEnabledState, buildAppMenu } from './menu';
import { createDetachedWindow, createMainWindow, deriveAuthHost, installAuthPopupHandler } from './window';
import { planCaptionMaximize } from './window-maximize';
import { closePrintWindow, notifyPrintDocumentGone, openPrintWindow } from './print-window';
import { createTabWindows } from './services/tabWindows';
import { extractFileArgument, looksLikeOpenablePath, looksLikePdfPath } from './open-path';

function mainModuleDir(): string {
  return __dirname;
}

// Phase 49 — the PRODUCT is Jovrel. Electron derives the default userData
// directory from the application name; the npm package name must stay `tflex`,
// and electron-builder's `productName` config alone does not change
// app.getName(), so the runtime name is set explicitly. This MUST run before
// requestSingleInstanceLock() below and before any getPath('userData') read,
// so the lock file and every store land under `%APPDATA%\Jovrel`;
// userdata-migration.ts then copies the pre-rename `%APPDATA%\tflex` state in.
app.setName('Jovrel');

// Test harness: export start() so unit tests can call it directly.
// In production the module-level init below calls start() automatically;
// during vitest runs that block is skipped and the test drives start().
const _isVitest = typeof process !== 'undefined' && process.env.VITEST === 'true';

// Phase 35 — paths the OS handed us (launch argv or a second instance) that
// arrived before the renderer was ready to receive them. Flushed once the
// window's webContents finishes loading (see createWindow below).
const pendingOpenPaths: string[] = [];

// DEF-300 — the main application window, held explicitly. An OS file-open is
// routed to THIS window, never to "whichever window is first" in
// getAllWindows(): with the standalone print window open, index 0 is the
// PRINT window, which does not subscribe to open-path requests, so the event
// was silently discarded.
let mainWindow: BrowserWindow | null = null;

// DEF-300 — set by start() once createWindow exists. A request that arrives
// with no live main window (a launch race before the window was created, or
// the window was closed while a print window kept the app alive) recreates a
// main window and the queued path is delivered on its did-finish-load.
let recreateMainWindow: (() => void) | null = null;

// DEF-303 — the maximised state a window was in BEFORE it was minimised.
// While minimised `isMaximized()` reports false and Windows does not emit
// `unmaximize` when a maximised window is minimised, so the caption-maximize
// handler cannot read the pre-minimise state off the window directly. The
// entry is created with the window and kept current by its own
// `maximize` / `unmaximize` events.
const wasMaximizedBeforeMinimize = new WeakMap<BrowserWindow, boolean>();

/** Flush paths queued before the main window's renderer was ready. */
function flushPendingOpenPaths(win: BrowserWindow): void {
  for (const path of pendingOpenPaths.splice(0)) {
    win.webContents.send(IPC.appOpenPathRequestEvent, path);
  }
}

/**
 * DEF-300 — deliver a validated OS-open request to the MAIN window, or queue
 * it. The main window is targeted by explicit reference, never by window
 * index, so the print window can never receive (or swallow) the request.
 *
 * Rules:
 * - A live, loaded main window receives the request immediately, even when a
 *   different window (the print window) is focused.
 * - A live but still-loading main window queues the request; it is flushed on
 *   did-finish-load.
 * - No live main window (startup race, or closed while a print window kept
 *   the app alive): queue the request and recreate the main window — never a
 *   silent no-op and never a delivery to a non-main window.
 *
 * Exported for the unit tests (the second-instance/second-launch path is not
 * registered under vitest, so the routing is driven directly there).
 */
export function sendOpenPath(path: string): void {
  const win = mainWindow;
  if (win === null || win.isDestroyed()) {
    pendingOpenPaths.push(path);
    // When start() has not reached createWindow yet the imminent window will
    // flush the queue; otherwise recreate the main window for the document.
    if (recreateMainWindow !== null) {
      recreateMainWindow();
    }
    return;
  }
  if (win.webContents.isLoading()) {
    pendingOpenPaths.push(path);
    return;
  }
  win.webContents.send(IPC.appOpenPathRequestEvent, path);
}

/**
 * Phase 35 — validate an OS-supplied path and hand it to the renderer's
 * existing open flow. A PDF is validated as a readable PDF exactly as before.
 * Phase 53 adds convertible documents: a `.txt`/`.md`/`.rtf`/`.csv`/`.html`
 * path is sent straight through `sendOpenPath` so the renderer's conversion
 * flow imports it. A genuinely unsupported path still fails LOUD (an error
 * box), never a silent no-op.
 */
async function handleOsOpenPath(path: string): Promise<void> {
  if (looksLikePdfPath(path)) {
    const check = await loadPdfFile(path);
    if (!check.ok) {
      dialog.showErrorBox('Cannot open PDF', `Could not open:\n${path}\n\n${describePdfOpenError(check.error)}`);
      return;
    }
    sendOpenPath(path);
    return;
  }
  if (looksLikeOpenablePath(path)) {
    sendOpenPath(path);
    return;
  }
  dialog.showErrorBox('Cannot open file', `Jovrel is a PDF app and cannot open:\n${path}`);
}

if (!_isVitest) {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
  } else {
    // Phase 35 — a second launch (e.g. double-clicking another PDF in
    // Explorer) focuses the running window AND opens the file it was
    // handed, instead of being ignored. The argv shape matches the launch
    // argv, so the same parser extracts the path.
    app.on('second-instance', (_event, argv) => {
      // DEF-300 — focus the MAIN window, not getAllWindows()[0] (which is the
      // print window while it is open).
      const win = mainWindow;
      if (win !== null && !win.isDestroyed()) {
        if (win.isMinimized()) {
          win.restore();
        }
        win.focus();
      }
      const path = extractFileArgument(argv, app.isPackaged);
      if (path !== null) {
        void handleOsOpenPath(path);
      }
    });
    void start();
  }
}

export async function start(): Promise<void> {
  await app.whenReady();

  // Phase 49 — one-time migration of the operator's per-user state from the
  // pre-rename `%APPDATA%\tflex` directory into the new `%APPDATA%\Jovrel`
  // userData directory. Runs before any store is constructed below. Gated
  // inside migrateLegacyUserData: old dir absent, same dir, or new dir
  // already holding settings.json all skip; the old directory is never
  // modified or deleted.
  const userDataMigration = await migrateLegacyUserData(
    app.getPath('userData'),
    join(app.getPath('appData'), LEGACY_USERDATA_DIRNAME),
  );
  if (userDataMigration.kind === 'migrated' && userDataMigration.copied.length > 0) {
    console.log(`[userdata] migrated TFlex per-user state: ${userDataMigration.copied.join(', ')}`);
  }

  // Phase 6: build the application menu. The menu sends actions to the
  // focused window's renderer via IPC, where the same handlers as toolbar
  // buttons pick them up.
  buildAppMenu({
    sendToFocused(_action: string, ...args: unknown[]): void {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      if (win !== undefined && !win.isDestroyed()) {
        win.webContents.send(IPC.menuActionEvent, ...args);
      }
    },
    // Phase 30 — File > Print / Ctrl+P pushes the dedicated print:request
    // event (not a menu:action) so the renderer opens its print dialog.
    sendPrintRequest(): void {
      const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
      if (win !== undefined && !win.isDestroyed()) {
        win.webContents.send(IPC.printRequestEvent);
      }
    },
  });

  // DEF-065 — renderer -> main: toggle named menu items' enabled state so
  // the native menu reflects doc-open / undo-stack / modified state. Uses
  // `on` (not handle) because the renderer fire-and-forgets; main applies
  // the partial map via applyMenuEnabledState, which is a no-op when no
  // application menu is set.
  ipcMain.on(IPC.menuSetEnabled, (_event, state: MenuEnabledState) => {
    applyMenuEnabledState(state);
  });

  // Phase 30 — print. The renderer asks for the OS printer list (via the
  // invoking webContents, since getPrintersAsync lives on it), then hands the
  // composed page images + settings to the hidden-window print pipeline.
  // printJob never rejects: a failure resolves with a reason for the dialog.
  ipcMain.handle(IPC.printListPrinters, (event) => listPrinters(event.sender));
  ipcMain.handle(IPC.printJob, (_event, payload: PrintJobPayload) => printJob(payload));

  // Phase 44 - assigned once the accounts services exist below; the settings
  // broadcast closes over it so a settings write can request a debounced sync.
  let accountsSync: SyncCoordinator | null = null;

  const broadcast = (settings: AppSettings): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.settingsChangedEvent, settings);
      }
    }
    // Phase 44 - a settings write is the natural sync trigger. The
    // coordinator is debounced and single-flight, and the engine makes no
    // network call while the flag is off or no session is held, so this
    // stays off the UI path and off the network on startup.
    accountsSync?.requestSync();
  };

  // DEF-230 — a failed settings write no longer rejects the IPC call; the
  // renderer learns about it here instead.
  const broadcastWriteError = (message: string): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.settingsWriteErrorEvent, message);
      }
    }
  };

  const settings = new SettingsService(join(app.getPath('userData'), 'settings.json'), broadcast, broadcastWriteError);
  const samples = new SamplesService(join(app.getAppPath(), 'assets', 'samples'));
  // Phase 11 — OCR runs tesseract.js with language data loaded from the
  // bundled `assets/tessdata` directory so recognition is fully offline.
  // The directory is resolved from the app root (`assets/tessdata`) in both
  // dev and packaged builds (electron-builder ships `assets/**`).
  const ocr = new OcrService(join(app.getAppPath(), 'assets', 'tessdata'));
  // Phase 82 — offline spell-check word list, read from the bundled
  // `assets/dictionary` directory (electron-builder ships `assets/**`).
  const dictionary = new DictionaryService(join(app.getAppPath(), 'assets', 'dictionary'));
  // Phase 27 — the bundled OFL font families are read from `assets/fonts`
  // (electron-builder ships `assets/**`) and embedded on demand. Resolved
  // from the app root in both dev and packaged builds, like the samples and
  // tessdata directories above.
  setBundledFontDir(join(app.getAppPath(), 'assets', 'fonts'));
  const engine = new EngineService(ocr);
  // Phase 53 — DocumentConversionService. Adapters are imported lazily by the
  // registry (cold-start budget), so constructing the service is cheap.
  // Progress is broadcast to every window; the renderer filters by jobId.
  const convert = new DocumentConversionService({
    engine,
    // DEF-388 — the stored office import defaults are resolved HERE (the
    // import entry) the same way the export handlers resolve
    // `officeConvertDefaults.exports.includeImages`: the renderer sends no
    // options for the spreadsheet/presentation keys, so the service must read
    // the settings itself. A caller-supplied option still wins.
    getOfficeConvertDefaults: () =>
      settings.getCurrent().officeConvertDefaults ?? DEFAULT_OFFICE_CONVERT_DEFAULTS,
    // Same wiring for the Phase 54 image import defaults: the renderer sends no
    // options for the image keys, so the service must read the settings itself.
    // A caller-supplied option still wins.
    getImageImportDefaults: () =>
      settings.getCurrent().imageImportDefaults ?? DEFAULT_IMAGE_IMPORT_DEFAULTS,
    emitProgress: (progress) => {
      for (const window of BrowserWindow.getAllWindows()) {
        if (!window.isDestroyed()) {
          window.webContents.send(IPC.convertProgressEvent, progress);
        }
      }
    },
  });
  const signatures = new SignatureService(join(app.getPath('userData'), 'signatures.json'));
  // Phase 54 features D + E — PDF/A + PDF/X validation service. Pure and
  // stateless; one instance is enough.
  const validation = new DocumentValidationService();

  /** A short, non-certification message for a blocked save. */
  const blockedSaveMessage = (report: ValidationReport): string => {
    const count = report.violations.filter((v) => v.severity === 'error').length;
    return `Save blocked: the document does not meet ${report.target} (${count} error(s)). No file was written.`;
  };

  /**
   * Phase 54 — the export guard hook. With the default `target: 'none'` it
   * does NOTHING but call `saveFn`: no bytes are read, no validation runs, no
   * interception. Only when the setting names a profile does it validate the
   * serialized document and honour `onViolation` ('warn' writes and returns the
   * report; 'block' refuses to write and returns the report).
   */
  const guardedSave = async (
    docId: string,
    saveFn: () => Promise<Result<string, EngineError>>,
  ): Promise<EngineSaveResult> => {
    const defaults =
      settings.getCurrent().pdfValidationDefaults ?? DEFAULT_PDF_VALIDATION_DEFAULTS;
    if (defaults.target === 'none') {
      return saveFn();
    }
    const bytesRes = await engine.getDocumentBytes(docId);
    if (!bytesRes.ok) {
      return bytesRes;
    }
    const guarded = await runExportGuard(
      defaults.target,
      defaults.onViolation,
      new Uint8Array(bytesRes.value),
      () => saveFn(),
      (bytes, target) => validation.validateBytes(bytes, target),
    );
    if (!guarded.ok) {
      return {
        ok: false,
        error: { code: 'engine-error', message: guarded.error.message },
      };
    }
    if (guarded.value.action === 'blocked') {
      return {
        ok: false,
        error: { code: 'engine-error', message: blockedSaveMessage(guarded.value.report) },
        validation: guarded.value.report,
      };
    }
    const saved = guarded.value.writeResult;
    if (!saved.ok) {
      return saved;
    }
    return { ...saved, validation: guarded.value.report ?? undefined };
  };

  // Phase 44 — encrypted session vault + its three IPC channels. The JWT is
  // stored via Electron safeStorage under userData and never enters
  // settings.json. When encryption is unavailable the vault degrades to an
  // in-memory session for this run (see the vault module).
  const accountsVault = new AccountsVault(
    join(app.getPath('userData'), 'accounts-session.bin'),
    safeStorage,
  );

  // Phase 44 - the sync engine. The transport is built per sync from the
  // current config (env override, else the shipped package.json `tflex`
  // block). It only reaches the network once a session is held and the
  // feature flag is on; `sync()` maps every failure to a SyncReport.
  const accountsSyncEngine = new AccountsSyncEngine({
    getToken: () => accountsVault.getSessionToken(),
    getConfig: () => getAccountsConfig(process.env, app.getAppPath()),
    makeTransport: ({ dataApiUrl, functionApiUrl, getToken }) =>
      new PostgrestSyncTransport({ dataApiUrl, functionApiUrl, getToken }),
    state: new SyncStateStore(join(app.getPath('userData'), 'accounts-sync.json')),
    settings: createSettingsPort(settings),
    signatures: createSignaturesPort(signatures),
  });
  // Every report the coordinator produces - including debounced/background
  // runs a renderer did not trigger - is broadcast, so any window sees sync
  // state changes without having called accounts:syncNow.
  accountsSync = new SyncCoordinator(accountsSyncEngine, {
    onReport: (report) => {
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC.accountsSyncReportEvent, report);
        }
      }
    },
  });
  // Session channels + the syncNow trigger. Registered after the coordinator
  // exists so accounts:syncNow can delegate to it. The config provider backs
  // accounts:getConfig (env override, else the shipped package.json block).
  registerAccountsIpc(ipcMain, accountsVault, accountsSync, () =>
    getAccountsConfig(process.env, app.getAppPath()),
  );

  // Phase 46 - the loopback callback listener for Google sign-in. The
  // renderer runs from `file://`, so its origin is not an absolute URL and the
  // provider rejects the callback; main binds a 127.0.0.1-only listener on an
  // ephemeral port and hands its absolute URL to the renderer. Every outcome
  // is broadcast so any window sees it, mirroring accounts:syncReport. The
  // listener is disposed on window-all-closed / before-quit below, so it can
  // never outlive the app.
  //
  // Phase 46 - the dev-oriented `accounts:oauthTrace` broadcast: main is the
  // only place that can see the popup's navigation events and the shared
  // session's auth-host cookies, so it reports redaction-safe steps (no token,
  // OAuth code or cookie value) for the renderer to log when a sign-in sticks.
  const broadcastOAuthTrace = (event: OAuthTraceEvent): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.accountsOAuthTraceEvent, event);
      }
    }
  };
  const broadcastOAuthOutcome = (outcome: OAuthCallbackOutcome): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.accountsOAuthCallbackEvent, outcome);
      }
    }
  };
  // Phase 46 - main completes the exchange the renderer cannot. The renderer
  // runs cross-site from `file://`, so Chromium will not attach the provider's
  // SameSite=Lax session cookie; main's session holds it and its request
  // helper attaches it. Bound once here so product code never spells the raw
  // network primitive (the conventions gate forbids it in src/).
  const authSessionRequest = session.defaultSession.fetch.bind(session.defaultSession);
  const authExchangeSession: OAuthExchangeSession = {
    cookies: session.defaultSession.cookies,
    request: (url, init) => authSessionRequest(url, init),
  };
  const oauthCallback = new OAuthCallbackService({
    onOutcome: (outcome) => {
      // Non-landing outcomes (timeout / cancelled / listener error) are
      // reported as-is. `{ ok: true }` means the provider redirect landed, so
      // main now finishes the exchange and only THEN reports success - the
      // renderer learns the result by re-querying accounts:getStatus().
      if (!outcome.ok) {
        broadcastOAuthOutcome(outcome);
        return;
      }
      void completeOAuthExchange({
        session: authExchangeSession,
        vault: accountsVault,
        authBaseUrl: getAccountsConfig(process.env, app.getAppPath()).authBaseUrl,
        // Phase 47 - the hosted callback appends its one-time session verifier
        // to the loopback URL; consume it now (the popup closes a tick later)
        // so the exchange can mint the session cookie. Never logged.
        sessionVerifier: oauthCallback.takeVerifier(),
        onTrace: broadcastOAuthTrace,
        // Phase 47 - one compact, secret-free failure line, persisted so the
        // operator can read the exact failing step without a debugger.
        onDiagnostic: (detail) =>
          appendOAuthTraceLine({ dir: app.getPath('userData'), line: detail }),
      })
        .then(broadcastOAuthOutcome)
        // The exchange resolves on every path; this guard only exists so an
        // unexpected rejection still reports an honest outcome to the renderer
        // instead of leaving the sign-in waiting forever.
        .catch(() =>
          broadcastOAuthOutcome({
            ok: false,
            reason: 'error',
            message: 'The Google sign-in could not be completed after the redirect (unexpected exchange failure).',
          }),
        );
    },
    onTrace: broadcastOAuthTrace,
  });
  // Phase 51 - a challenge cookie left over from an earlier attempt is a
  // DIFFERENT server-side challenge, so the provider rejects the exchange with
  // "Session challenge cookie not found" even though a cookie with that name is
  // present. Clearing the challenge cookies when a flow STARTS (before the
  // renderer's `signIn.social` issues a fresh one) closes that failure mode.
  // The session token is deliberately left alone so a signed-in user is never
  // signed out by starting a new flow.
  const oauthCallbackController = {
    start: async () => {
      await clearAuthChallengeCookies(
        session.defaultSession.cookies,
        getAccountsConfig(process.env, app.getAppPath()).authBaseUrl,
      );
      return oauthCallback.start();
    },
    stop: () => oauthCallback.stop(),
  };
  registerOAuthCallbackIpc(ipcMain, oauthCallbackController);

  // Phase 46 - the packaged renderer is loaded from `file://` and therefore
  // sends no Origin header, so the provider refuses every Origin-checked
  // route (Google social sign-in, email sign-in, password reset). The auth
  // branch already trusts localhost origins, so for requests to the
  // configured auth host ONLY we present the dev origin the branch trusts,
  // and only when the request carries no Origin of its own. The Data API and
  // Function hosts are deliberately NOT covered - neither needs it, so no
  // forged origin is handed out there. The host is derived from the accounts
  // config on every request, never a literal.
  installAuthOriginHeader(session.defaultSession, () =>
    deriveAuthHost(getAccountsConfig(process.env, app.getAppPath()).authBaseUrl),
  );

  ipcMain.handle(IPC.windowMinimize, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  ipcMain.handle(IPC.windowMaximize, (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win !== null) {
      // DEF-303 — a maximize arriving while the window is still minimised
      // used to call `win.maximize()` blind, which on Windows stacks a
      // restore + maximise (two DWM transitions, ~152 ms to the event versus
      // ~51 ms from the restored state). `win.restore()` returns the window
      // to its pre-minimise state in ONE transition, so when it was maximised
      // before minimising a single `restore()` is the whole job. Rule:
      //   minimised + previously maximised -> restore()
      //   minimised + previously normal     -> restore(), then maximize()
      //   not minimised                     -> the existing single-action
      //                                        toggle (maximize / unmaximize)
      const minimized = win.isMinimized();
      const maximized = win.isMaximized();
      const steps = planCaptionMaximize({
        minimized,
        maximized,
        previouslyMaximized: wasMaximizedBeforeMinimize.get(win) ?? maximized,
      });
      for (const step of steps) {
        if (step === 'restore') {
          win.restore();
        } else if (step === 'unmaximize') {
          win.unmaximize();
        } else {
          win.maximize();
        }
      }
    }
  });
  ipcMain.handle(IPC.windowClose, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close();
  });

  // DEF-142 — close/quit gate. The window's 'close' event fires for every
  // close path (caption X via window:close, OS Alt+F4, the Window menu's
  // Close role, and app.quit() which closes every window). The per-tab
  // closeTab path already gated on `modified`; the whole-window close
  // bypassed it and silently discarded unsaved edits. We intercept here:
  // on every 'close', if the window is not already close-confirmed we
  // preventDefault and push window:closeRequested so the renderer can
  // show its existing CloseTabPromptDialog (it knows which tabs are
  // modified — it is the source of truth for unsaved state). The renderer
  // calls window:confirmClose(true) once the user has chosen Save (after
  // it succeeded) / Don't save; Cancel means it does nothing and the
  // window stays open. A confirmed window is re-closed via win.close();
  // the gate sees the WeakSet entry and skips the preventDefault so the
  // window actually shuts (the geometry report in window.ts still runs).
  const closeConfirmedWindows = new WeakSet<BrowserWindow>();
  const onWindowCloseRequested = (
    win: BrowserWindow,
    event: { preventDefault(): void },
  ): void => {
    if (closeConfirmedWindows.has(win)) return;
    if (win.isDestroyed()) return;
    // Abort this close — the renderer decides whether to proceed. The
    // geometry report in window.ts already ran, so the last window
    // position is persisted even if the user later cancels.
    event.preventDefault();
    if (!win.webContents.isDestroyed()) {
      win.webContents.send(IPC.windowCloseRequested);
    }
  };
  ipcMain.handle(IPC.windowConfirmClose, (event, proceed: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (win === null || win.isDestroyed()) return;
    if (!proceed) return;
    // Mark confirmed so the re-entrant win.close() 'close' event skips
    // the gate, then actually close. The WeakSet entry is collectable
    // once the window is destroyed (Electron releases its ref).
    closeConfirmedWindows.add(win);
    win.close();
  });

  ipcMain.handle(IPC.openFileDialog, (_event, kind?: OpenFileDialogKind) => openPdfDialog(kind));
  // Phase 40 — multi-select sibling for "Merge PDF from scratch"; resolves to
  // a normalized string[] (empty on cancel).
  ipcMain.handle(IPC.openFilesDialog, (_event, kind?: OpenFileDialogKind) => openPdfDialogMulti(kind));
  // Phase 45 — best available clipboard image (native image, or an image FILE
  // copied in Explorer read through `fs`). Always resolves a typed
  // ClipboardImageResult; never throws. Read-only: writes nothing to disk.
  // Electron 44 removed the synchronous clipboard API (readImage/readBuffer/
  // availableFormats are undefined at runtime), so the service uses the async
  // read()/readText() methods and the handler awaits its Promise.
  ipcMain.handle(IPC.clipboardReadImage, () =>
    readClipboardImage(clipboard as unknown as ClipboardLike),
  );
  // Phase 53 — Universal file handling. sourceInfo reports the detected
  // format/fidelity before conversion; toDocument converts, opens the result
  // in the existing engine (same process, no ipcMain hop) and resolves a
  // typed ConvertOpenResult; cancel aborts the in-flight job by id. None of
  // these throw across IPC.
  ipcMain.handle(IPC.convertSourceInfo, (_event, path: string) =>
    convert.sourceInfo(path),
  );
  // Phase 56 feature A — the EPUB reading payload (chapters in spine order,
  // sanitized XHTML). Always resolves a typed Result; never throws.
  ipcMain.handle(IPC.convertReadingDocument, (_event, path: string) =>
    convert.readingDocument(path),
  );
  ipcMain.handle(
    IPC.convertToDocument,
    (_event, docId: string, path: string, options?: ConvertOptions) =>
      convert.toDocument(docId, path, options),
  );
  // Phase 54 — N files into ONE document, in order. Rejects the whole request
  // with `unsupported-format` when any path cannot participate.
  ipcMain.handle(
    IPC.convertToDocumentMany,
    (_event, docId: string, paths: string[], options?: ConvertOptions) =>
      convert.toDocumentMany(docId, paths, options),
  );
  // Phase 53 feature G mode 2 — CSV headers onto the open document's fields,
  // through the engine's existing forms reader/writer.
  ipcMain.handle(
    IPC.convertCsvToFields,
    (_event, docId: string, path: string, options?: ConvertOptions) =>
      convert.csvToDocumentFields(docId, path, options),
  );
  ipcMain.handle(IPC.convertCancel, (_event, jobId: string) =>
    convert.cancel(jobId),
  );
  // Phase 55 feature D — PDF -> office export writers. Both call the engine's
  // existing exportText inside main (awaited, renderer never blocks) and
  // resolve a typed Result. The includeImages default comes from the stored
  // officeConvertDefaults.exports when the caller does not override it.
  ipcMain.handle(IPC.exportXlsx, (_event, docId: string, payload?: ExportXlsxPayload) => {
    const defaults = settings.getCurrent().officeConvertDefaults ?? DEFAULT_OFFICE_CONVERT_DEFAULTS;
    return exportXlsx(engine, docId, {
      ...payload,
      includeImages: payload?.includeImages ?? defaults.exports.includeImages,
    });
  });
  ipcMain.handle(IPC.exportPptx, (_event, docId: string, payload?: ExportPptxPayload) => {
    const defaults = settings.getCurrent().officeConvertDefaults ?? DEFAULT_OFFICE_CONVERT_DEFAULTS;
    return exportPptx(engine, docId, {
      ...payload,
      includeImages: payload?.includeImages ?? defaults.exports.includeImages,
    });
  });
  ipcMain.handle(IPC.pdfLoad, (_event, path: string) => loadPdfFile(path));
  ipcMain.handle(IPC.fdfLoad, (_event, path: string) => loadFdfFile(path));
  // Phase 57 feature B — FDF/XFDF form-DATA load path (distinct from the
  // Phase-12 comment FDF path above).
  ipcMain.handle(IPC.formDataLoad, (_event, path: string) => loadFormDataFile(path));
  ipcMain.handle(IPC.samplesList, () => samples.list());
  ipcMain.handle(IPC.samplesLoad, (_event, name: string) => samples.load(name));
  ipcMain.handle(IPC.samplesRead, (_event, name: string) => samples.read(name));
  ipcMain.handle(IPC.settingsLoad, () => settings.load());
  // Phase 82 — bundled offline spell-check dictionary.
  ipcMain.handle(IPC.dictionaryLoad, (_event, language) => dictionary.load(language));
  ipcMain.handle(IPC.settingsSave, (_event, s: AppSettings) => settings.save(s));
  ipcMain.handle(IPC.settingsAddRecent, (_event, f: RecentFile) => settings.addRecentFile(f));

  // Phase 2: page organization engine
  ipcMain.handle(IPC.engineLoadDocument, (_event, docId: string, path: string, password?: string) =>
    engine.loadDocument(docId, path, password),
  );
  ipcMain.handle(IPC.engineLoadDocumentBytes, (_event, docId: string, bytes: ArrayBuffer | Uint8Array, password?: string) => {
    // Electron structured-clone preserves Uint8Array vs ArrayBuffer types,
    // but we accept both for renderer flexibility. Normalise to a view
    // against the underlying buffer before handing to pdf-lib.
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    return engine.loadDocumentBytes(docId, view, password);
  });
  ipcMain.handle(IPC.engineApplyOp, (_event, docId: string, op: OpEntry) =>
    engine.applyOp(docId, op),
  );
  ipcMain.handle(IPC.engineUndo, (_event, docId: string) =>
    engine.undo(docId),
  );
  ipcMain.handle(IPC.engineRedo, (_event, docId: string) =>
    engine.redo(docId),
  );
  ipcMain.handle(IPC.engineMerge, (_event, docId: string, otherPaths: string[], position: 'before' | 'after') =>
    engine.merge(docId, otherPaths, position),
  );
  ipcMain.handle(IPC.engineSplit, (_event, docId: string, range: [number, number]) =>
    engine.split(docId, range),
  );
  ipcMain.handle(IPC.engineExtract, (_event, docId: string, pages: number[]) =>
    engine.extract(docId, pages),
  );
  // Phase 54 — the save path runs through the export guard. `target: 'none'`
  // (the default) short-circuits inside `guardedSave` to the unchanged save.
  ipcMain.handle(IPC.engineSave, (_event, docId: string) =>
    guardedSave(docId, () => engine.save(docId)),
  );
  ipcMain.handle(IPC.engineSaveAs, async (_event, docId: string) => {
    // Phase 35 — the Save-As destination picker is shared with the
    // virtual-PDF print path (`savePdfDialog`), so the app has one dialog.
    const filePath = await savePdfDialog();
    if (filePath === null) {
      return { ok: false, error: { code: 'cancelled' as const, message: 'save cancelled' } };
    }
    return guardedSave(docId, () => engine.saveAs(docId, filePath));
  });
  ipcMain.handle(IPC.engineGetState, (_event, docId: string) =>
    engine.getState(docId),
  );
  // DEF-085 (Bug 4) — dirty-check the renderer calls before closing a tab
  // to decide whether to prompt "save unsaved changes?". Cheap (no
  // buildState) and queue-ordered so it reflects every prior mutation.
  ipcMain.handle(IPC.engineIsModified, (_event, docId: string) =>
    engine.isModified(docId),
  );
  ipcMain.handle(IPC.engineGetDocumentBytes, (_event, docId: string) =>
    engine.getDocumentBytes(docId),
  );

  // Phase 54 features D + E — validation channels. `target` defaults to the
  // stored `pdfValidationDefaults.target`; 'none' is not a valid target to
  // validate against and resolves `unknown-target`.
  ipcMain.handle(
    IPC.validationValidate,
    (_event, docId: string, target?: ValidationTarget) => {
      const resolved =
        target ?? (settings.getCurrent().pdfValidationDefaults ?? DEFAULT_PDF_VALIDATION_DEFAULTS).target;
      return validation.validateDocument(docId, (id) => engine.getDocumentBytes(id), resolved as ValidationTarget);
    },
  );
  ipcMain.handle(
    IPC.validationValidateBytes,
    (_event, bytes: ArrayBuffer | Uint8Array, target: ValidationTarget) => {
      const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      return validation.validateBytes(view, target);
    },
  );

  // Phase 3: annotations
  ipcMain.handle(IPC.engineCreateAnnotation, (_event, docId: string, payload: CreateAnnotationPayload) =>
    engine.createAnnotation(docId, payload),
  );
  ipcMain.handle(IPC.engineEditAnnotation, (_event, docId: string, annId: string, payload: EditAnnotationPayload) =>
    engine.editAnnotation(docId, annId, payload),
  );
  ipcMain.handle(IPC.engineDeleteAnnotation, (_event, docId: string, annId: string) =>
    engine.deleteAnnotation(docId, annId),
  );
  // Phase 28 — comment threads: creates the thread on the first call and
  // appends a reply on every later call (one op for both). Persisted in the
  // PDF catalog and dropped when the annotation is deleted.
  ipcMain.handle(IPC.engineAddComment, (_event, docId: string, annotationId: string, text: string, author?: string) =>
    engine.addComment(docId, annotationId, text, author),
  );

  // Phase 4: forms
  ipcMain.handle(IPC.engineGetFormFields, (_event, docId: string) =>
    engine.getFormFields(docId),
  );
  ipcMain.handle(IPC.engineFillFormField, (_event, docId: string, payload: FillFormFieldPayload) =>
    engine.fillFormField(docId, payload),
  );
  ipcMain.handle(IPC.engineFlattenForms, (_event, docId: string) =>
    engine.flattenForms(docId),
  );

  // Phase 4: signatures (page placements)
  ipcMain.handle(IPC.enginePlaceSignature, (_event, docId: string, payload: PlaceSignaturePayload) =>
    engine.placeSignature(docId, payload),
  );
  ipcMain.handle(IPC.engineMoveSignature, (_event, docId: string, payload: MoveSignaturePayload) =>
    engine.moveSignature(docId, payload),
  );
  ipcMain.handle(IPC.engineDeleteSignature, (_event, docId: string, sigPlacementId: string) =>
    engine.deleteSignature(docId, sigPlacementId),
  );

  // Phase 8: optimize — file size reduction and space audit
  ipcMain.handle(IPC.engineOptimize, (_event, docId: string, preset: OptimizePreset) =>
    engine.optimize(docId, preset),
  );
  ipcMain.handle(IPC.engineAuditSpace, (_event, docId: string) =>
    engine.auditSpace(docId),
  );

  // Phase 9: create + export
  ipcMain.handle(IPC.engineCreateFromImages, (_event, docId: string, imageBuffers: Uint8Array[]) =>
    engine.createFromImages(docId, imageBuffers),
  );
  ipcMain.handle(IPC.engineCreateFromClipboard, (_event, docId: string, content: Uint8Array | string) =>
    engine.createFromClipboard(docId, content),
  );
  ipcMain.handle(IPC.engineInsertBlankPage, (_event, docId: string, afterIndex: number, widthPx: number, heightPx: number) =>
    engine.insertBlankPage(docId, afterIndex, widthPx, heightPx),
  );
  ipcMain.handle(IPC.engineInsertFromPdf, (_event, docId: string, otherBytes: Uint8Array, position: number) =>
    engine.insertFromPdf(docId, otherBytes, position),
  );
  // Phase 32 (Multi Mode) — one atomic cross-document page move/copy. The
  // payload carries both doc ids, the source pages and the target position;
  // the engine returns both documents' states.
  ipcMain.handle(IPC.engineMovePagesBetween, (_event, payload: MovePagesBetweenDocsPayload) =>
    engine.movePagesBetweenDocs(payload),
  );
  ipcMain.handle(IPC.engineExportPages, (_event, docId: string, payload: ExportPagesPayload) =>
    engine.exportPages(docId, payload),
  );
  ipcMain.handle(IPC.engineExportText, (_event, docId: string) =>
    engine.exportText(docId),
  );
  ipcMain.handle(IPC.engineCreateDocxFromImages, (_event, entries: DocxImageEntry[]) =>
    engine.createDocxFromImages(entries),
  );
  // DEF-060 — DOCX from the loaded document's own text (image fallback for
  // text-free pages). The renderer rasterises every page ahead of time so
  // the fallback always has pixels; the engine picks text where present.
  ipcMain.handle(IPC.engineCreateDocxFromDoc, (_event, docId: string, entries: DocxImageEntry[]) =>
    engine.createDocxFromDoc(docId, entries),
  );

  // Phase 10: edit content (text run, text box, image)
  ipcMain.handle(IPC.engineEditTextRun, (_event, docId: string, payload: EditTextRunPayload) =>
    engine.editTextRun(docId, payload),
  );
  // Phase 84 (True redaction) — remove the covered glyphs and draw the marks.
  ipcMain.handle(IPC.engineApplyRedactions, (_event, docId: string, payload: ApplyRedactionsPayload) =>
    engine.applyRedactions(docId, payload),
  );
  ipcMain.handle(IPC.engineAddTextBox, (_event, docId: string, payload: AddTextBoxPayload) =>
    engine.addTextBox(docId, payload),
  );
  ipcMain.handle(IPC.engineEditImage, (_event, docId: string, payload: EditImagePayload) =>
    engine.editImage(docId, payload),
  );
  // Phase 14 / DEF-135 / DEF-136 — text-box registry move/delete. Boxes are
  // registry-only (drawn once at save time), so move updates the rect without
  // masking the content under the old rect (the root cause of DEF-135); delete
  // removes the box from the registry (DEF-136).
  ipcMain.handle(IPC.engineMoveTextBox, (_event, docId: string, id: string, rect: import('../shared/types').AnnRect) =>
    engine.moveTextBox(docId, id, rect),
  );
  ipcMain.handle(IPC.engineDeleteTextBox, (_event, docId: string, id: string) =>
    engine.deleteTextBox(docId, id),
  );
  // Phase 21 — apply a Word/Adobe-class style patch to a registry text box
  // (font family/size, bold/italic/underline, colour, highlight, alignment,
  // line spacing, super/subscript, list style, text). Preserve-if-valid /
  // reject-if-invalid; unknown id or unsupported font -> typed engine-error.
  ipcMain.handle(IPC.engineUpdateTextBox, (_event, docId: string, id: string, patch: TextBoxStylePatch) =>
    engine.updateTextBox(docId, id, patch),
  );

  // Phase 11: OCR — recognize text (build invisible text layer) + suspects.
  // Progress is forwarded only to the window that issued the request. The
  // sender WebContents is captured once and re-checked on every emit: a long
  // OCR run can outlive the invoking renderer, and `event.sender` becomes
  // null/destroyed after the window closes. Calling `.send` (or even
  // `.isDestroyed()`) on a null sender throws "sendWithPromise null" inside
  // Electron, so both states must be guarded.
  ipcMain.handle(IPC.engineOcrRecognize, (event, docId: string, options: OcrRecognizeOptions) => {
    const sender = event.sender;
    return engine.ocrRecognize(docId, options, (p: OcrProgress) => {
      if (sender && !sender.isDestroyed()) {
        sender.send(IPC.engineOcrProgressEvent, p);
      }
    });
  });
  ipcMain.handle(IPC.engineOcrSuspects, (_event, docId: string) =>
    engine.ocrSuspects(docId),
  );
  // Phase 51 — cancel an in-flight OCR run. Deliberately NOT queued behind
  // the per-doc operation queue: `_ocrRecognizeImpl` is mid-await on
  // tesseract, so a queued cancel would only run after it finished. This
  // flips the run's cancel flag and resolves immediately; the pending
  // `ocrRecognize` then resolves with a typed `cancelled` error.
  ipcMain.handle(IPC.engineOcrCancel, (_event, docId: string) =>
    engine.ocrCancel(docId),
  );

  // Phase 12: residual page-organize + annotate parity
  ipcMain.handle(IPC.engineReplacePages, (_event, docId: string, otherBytes: Uint8Array, targetRange: [number, number]) =>
    engine.replacePages(docId, otherBytes, targetRange),
  );
  ipcMain.handle(IPC.engineRenumberPages, (_event, docId: string, labels: PageLabelEntry[]) =>
    engine.renumberPages(docId, labels),
  );
  ipcMain.handle(IPC.engineCropPages, (_event, docId: string, entries: CropEntry[]) =>
    engine.cropPages(docId, entries),
  );
  ipcMain.handle(IPC.engineSetOutline, (_event, docId: string, entries: OutlineEntry[]) =>
    engine.setOutline(docId, entries),
  );
  ipcMain.handle(IPC.engineAddStamp, (_event, docId: string, payload: AddStampPayload) =>
    engine.addStamp(docId, payload),
  );
  ipcMain.handle(IPC.engineExportFdf, (_event, docId: string) =>
    engine.exportFdf(docId),
  );
  ipcMain.handle(IPC.engineImportFdf, (_event, docId: string, fdfBytes: Uint8Array) =>
    engine.importFdf(docId, fdfBytes),
  );
  // Phase 57 feature B — AcroForm form-DATA interchange. exportFormData
  // returns FDF/XFDF bytes; importFormData matches them onto existing fields
  // and returns the matched/unmatched/empty report. formDataSave picks a
  // destination, writes the renderer-supplied bytes, and reports the path
  // (or null on cancel).
  ipcMain.handle(IPC.engineExportFormData, (_event, docId: string, format: 'fdf' | 'xfdf') =>
    engine.exportFormData(docId, format),
  );
  ipcMain.handle(IPC.engineImportFormData, (_event, docId: string, format: 'fdf' | 'xfdf', data: Uint8Array) =>
    engine.importFormData(docId, format, data),
  );
  // Phase 57 feature A — PDF/E engineering documents: layer enumeration and
  // visibility toggle, the XMP pdfe block, and 3D-content detection.
  ipcMain.handle(IPC.engineGetLayers, (_event, docId: string) =>
    engine.getLayers(docId),
  );
  ipcMain.handle(IPC.engineSetLayerVisibility, (_event, docId: string, index: number, visible: boolean) =>
    engine.setLayerVisibility(docId, index, visible),
  );
  ipcMain.handle(IPC.engineGetCadMetadata, (_event, docId: string) =>
    engine.getCadMetadata(docId),
  );
  ipcMain.handle(IPC.engineGet3dContent, (_event, docId: string) =>
    engine.get3dContent(docId),
  );
  ipcMain.handle(
    IPC.formDataSave,
    async (
      _event,
      format: 'fdf' | 'xfdf',
      bytes: Uint8Array,
      defaultName?: string,
    ): Promise<Result<{ path: string } | null, FdfOpenError>> => {
      const filePath = await saveFormDataDialog(format, defaultName);
      if (filePath === null) {
        return { ok: true, value: null };
      }
      try {
        await writeFormDataFile(filePath, bytes);
      } catch {
        return { ok: false, error: { code: 'io' as const, message: `could not write: ${filePath}` } };
      }
      return { ok: true, value: { path: filePath } };
    },
  );
  // Phase 18 / DEF-216: watermarks — apply, list (by the marker baked
  // into each page's content stream), delete by id.
  ipcMain.handle(IPC.engineAddWatermark, (_event, docId: string, settings: WatermarkSettings) =>
    engine.addWatermark(docId, settings),
  );
  ipcMain.handle(
    IPC.engineGetWatermarks,
    (_event, docId: string): Promise<import('../shared/result').Result<WatermarkInfo[], import('../shared/types').EngineError>> =>
      engine.getWatermarks(docId),
  );
  ipcMain.handle(IPC.engineDeleteWatermark, (_event, docId: string, watermarkId: string) =>
    engine.deleteWatermark(docId, watermarkId),
  );

  // Phase 52 — encrypted PDF support
  ipcMain.handle(IPC.engineGetDocumentProtection, (_event, docId: string) =>
    engine.getDocumentProtection(docId),
  );
  ipcMain.handle(
    IPC.engineEncryptDocument,
    (_event, docId: string, options: EncryptDocumentOptions) =>
      engine.encryptDocument(docId, options),
  );
  // Drops the document and clears its session password. Fire-and-forget.
  ipcMain.handle(IPC.engineCloseDocument, (_event, docId: string) =>
    engine.closeDocument(docId),
  );

  // Phase 4: saved signatures service
  ipcMain.handle(IPC.signaturesList, () => signatures.list());
  ipcMain.handle(IPC.signaturesSave, (_event, source: SignatureSource, label?: string) =>
    signatures.save(source, label),
  );
  ipcMain.handle(IPC.signaturesDelete, (_event, id: string) => signatures.delete(id));

  // Phase 6: About / preferences — app info
  ipcMain.handle(IPC.appGetInfo, () => {
    return {
      version: app.getVersion(),
      electronVersion: process.versions.electron ?? 'unknown',
      nodeVersion: process.versions.node ?? 'unknown',
      storagePaths: {
        userData: app.getPath('userData'),
        settings: join(app.getPath('userData'), 'settings.json'),
        signatures: join(app.getPath('userData'), 'signatures.json'),
        cache: app.getPath('sessionData'),
      },
    };
  });

  // Phase 6: open a folder or file in the OS shell
  ipcMain.handle(IPC.appOpenPath, async (_event, path: string) => {
    const error = await shell.openPath(path);
    if (error) {
      throw new Error(error);
    }
  });

  // Phase 50 - browser-based sign-in. Open the provider URL the auth SDK
  // returned in the OS DEFAULT BROWSER, but only after validating it is https
  // on exactly the configured auth host (derived from the accounts config on
  // every call - never a literal). A refused URL is never handed to the OS;
  // the handler resolves a typed result and never throws.
  ipcMain.handle(IPC.accountsOpenAuthUrl, (_event, url: unknown) =>
    openAuthUrlExternally(
      url,
      deriveAuthHost(getAccountsConfig(process.env, app.getAppPath()).authBaseUrl),
      shell,
    ),
  );

  // Phase 50 - open Windows' Default-apps settings so the user can make Jovrel
  // the default PDF handler. Fixed, non-user-supplied URI; the app does not
  // change the default itself.
  ipcMain.handle(IPC.appOpenDefaultAppsSettings, () => openDefaultAppsSettings(shell));

  // Phase 6: OTA updates via electron-updater
  const updateService = new UpdateService();
  updateService.init();

  ipcMain.handle(IPC.updateStatus, () => {
    return updateService.getStatus();
  });

  ipcMain.handle(IPC.updateDownload, async () => {
    return updateService.download();
  });

  ipcMain.handle(IPC.updateInstall, () => {
    updateService.install();
  });

  // DEF-079 / DEF-080 — manual re-check (Help -> Check for Update).
  // Re-runs autoUpdater.checkForUpdates() with autoDownload=false (the
  // same semantics as the start-path check in updateService.init()) and
  // resolves with the resulting UpdateState. Routed from the
  // `checkForUpdate` menu action the renderer dispatches to
  // `tflex.update.check()` -> this `update:check` channel.
  ipcMain.handle(IPC.updateCheck, () => {
    return updateService.checkForUpdates();
  });

  // Push update status changes to all windows
  updateService.onStatusChanged((state) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.updateStatusChangedEvent, state);
      }
    }
  });

  let currentSettings: AppSettings = DEFAULT_SETTINGS;
  const loaded = await settings.load();
  if (loaded.ok) {
    currentSettings = loaded.value;
  }

  const rendererHtml = join(mainModuleDir(), '../renderer/index.html');
  const rendererDevUrl = app.isPackaged
    ? undefined
    : (process.env.ELECTRON_RENDERER_URL ?? 'http://localhost:5173');
  // Phase 44 - the app's own URL, used only to detect the auth popup landing
  // back on the app after the provider flow so it can be closed automatically.
  const rendererAuthUrl = rendererDevUrl ?? pathToFileURL(rendererHtml).href;

  // Phase 35 - the standalone print window. `print:openWindow` validates the
  // context in main (openPrintWindow) and creates/focuses its own top-level OS
  // window; `print:notifyDocumentGone` forwards "document closed" to the print
  // window when it belongs to that document. The print window then drives the
  // SAME print:listPrinters / print:job pipeline as the in-app dialog.
  const printWindowSource = { rendererHtml, rendererDevUrl };
  ipcMain.handle(IPC.printOpenWindow, (_event, context: unknown) =>
    openPrintWindow(context, printWindowSource),
  );
  ipcMain.handle(IPC.printNotifyDocumentGone, (_event, docId: string) => {
    notifyPrintDocumentGone(docId);
  });

  // Phase 58 — detach a document tab into a SECOND app window and return it.
  // The service owns the parent map + detached set; index.ts only registers
  // the four invoke channels. The detached window is a real full app window
  // (same preload + renderer HTML) but is never `mainWindow`, never persists
  // geometry, and is not recreated by the main-window lifecycle.
  const tabWindows = createTabWindows({
    rendererHtml,
    rendererDevUrl,
    // DEF-415 — detached windows get the SAME close gate as the main window
    // (one implementation in window.ts), so a detached window holding
    // unsaved edits prompts before it closes. DEF-416 — the handle defers
    // `load()` so the adopt listener is attached first.
    createWindow: () =>
      createDetachedWindow({
        rendererHtml,
        rendererDevUrl,
        onCloseRequested: onWindowCloseRequested,
      }),
  });
  ipcMain.handle(IPC.tabDetach, (event, payload: TabTransferPayload) =>
    tabWindows.openDetached(event.sender, payload),
  );
  ipcMain.handle(IPC.tabAdoptAck, (event, ok: boolean) => {
    tabWindows.handleAdoptAck(event.sender, ok);
  });
  ipcMain.handle(IPC.tabReturn, (event, payload: TabTransferPayload) =>
    tabWindows.handleReturn(event.sender, payload),
  );
  ipcMain.handle(IPC.tabEmpty, (event) => {
    tabWindows.handleEmpty(event.sender);
  });

  // DEF-303 — the debounced geometry persist is a DISK-ONLY write. The
  // renderer already received the state at the moment of the transition
  // (see `onWindowStateChanged` below), and it never reads geometry
  // x/y/width/height, so echoing this write would only force a settings
  // re-render ~300 ms after the maximize — the lag DEF-303 measured.
  // Chosen fix: a geometry-only write emits nothing.
  const onGeometryChanged = (geometry: AppSettings['geometry']): void => {
    void settings.saveGeometryOnly(geometry);
  };

  // DEF-303 — push the window-state change IMMEDIATELY (no debounce) so the
  // caption / controls reflect a maximize / unmaximize / minimize / restore
  // within a frame. Broadcast-only: the geometry is still persisted later,
  // once per burst, by the debounced onGeometryChanged above. Uses the
  // existing `settings:changed` transport, which is the renderer's only
  // window-state source (App.tsx DEF-202), so no IPC contract changes.
  const onWindowStateChanged = (geometry: AppSettings['geometry']): void => {
    broadcast({ ...settings.getCurrent(), geometry });
  };

  // DEF-303 — the renderer's PDF render/raster work must be paused while the
  // window is minimised. Chromium suspends the minimised window's frames
  // anyway (`backgroundThrottling: false` was tried and reverted — it did not
  // unblock rAF, and it cost ~62 timer ticks/s of CPU), so this explicit
  // signal is the mechanism that parks the work. It is driven from the MAIN
  // process's window `minimize` / `restore` events (wired through the
  // onMinimizedChanged dep below), broadcast to every live window on the
  // dedicated `window:minimizedChanged` channel. The renderer consumer is a
  // separate dispatch.
  const broadcastMinimizedChanged = (minimized: boolean): void => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.windowMinimizedChangedEvent, { minimized });
      }
    }
  };

  const createWindow = (): void => {
    const win = createMainWindow(currentSettings, {
      rendererHtml,
      rendererDevUrl,
      onGeometryChanged,
      onWindowStateChanged,
      onMinimizedChanged: broadcastMinimizedChanged,
      // DEF-142 — gate the whole-window close on unsaved edits.
      onCloseRequested: onWindowCloseRequested,
    });
    // Phase 44 - the auth popup: a real child window for the provider flow,
    // sharing the app session, allowed only for the configured auth host and
    // closed once it returns to the callback/app URL. Main forwards no token.
    installAuthPopupHandler(win, {
      getAuthHost: () =>
        deriveAuthHost(getAccountsConfig(process.env, app.getAppPath()).authBaseUrl),
      getAppUrl: () => rendererAuthUrl,
      // Phase 46 - so the popup closes when the flow lands on the exact
      // loopback URL this flow minted (query ignored), and every popup step is
      // observable over accounts:oauthTrace.
      getLoopbackUrl: () => oauthCallback.currentCallbackUrl(),
      // DEF-365 - drop the retained minted URL as soon as its popup is gone.
      onPopupClosed: () => oauthCallback.clearCompletionUrl(),
      onTrace: broadcastOAuthTrace,
    });
    // Phase 35 / DEF-300 — track the main window explicitly so OS file-opens
    // are routed to it, and flush any path that was queued before its
    // renderer was ready.
    if (win !== undefined) {
      mainWindow = win;
      // DEF-303 — keep the pre-minimise maximised state current so the
      // caption-maximize handler can pick the single-transition path.
      wasMaximizedBeforeMinimize.set(win, win.isMaximized());
      win.on('maximize', () => {
        wasMaximizedBeforeMinimize.set(win, true);
      });
      win.on('unmaximize', () => {
        wasMaximizedBeforeMinimize.set(win, false);
      });
      win.webContents.once('did-finish-load', () => {
        flushPendingOpenPaths(win);
      });
      // Phase 35 — the print window is independent, but must never outlive
      // the app (no orphan window / zombie process). Closing the main window
      // closes it; with it gone `window-all-closed` then fires as before.
      win.on('closed', () => {
        if (mainWindow === win) {
          mainWindow = null;
        }
        closePrintWindow();
      });
    }
  };
  recreateMainWindow = createWindow;
  createWindow();

  // Phase 35 — a PDF path passed on the launch command line opens that
  // document (the `.pdf` file association / "Open with" path). Skipped
  // under vitest, where process.argv belongs to the test runner.
  if (!_isVitest) {
    const initialPath = extractFileArgument(process.argv, app.isPackaged);
    if (initialPath !== null) {
      void handleOsOpenPath(initialPath);
    }
  }

  app.on('window-all-closed', async () => {
    oauthCallback.dispose();
    await settings.saveCurrent();
    await ocr.terminate();
    app.quit();
  });
  // Phase 35 — belt-and-braces quit path: any app.quit() (menu Exit, update
  // install) closes the print window so it can never survive the app.
  app.on('before-quit', () => {
    oauthCallback.dispose();
    closePrintWindow();
  });
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}
