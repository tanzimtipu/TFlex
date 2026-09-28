import type { Result } from "./result";
import type { AccountStatusResult, AccountsClientConfig, OAuthCallbackOutcome, OAuthCallbackStartResult, OAuthTraceEvent, OpenAuthUrlResult, SetSessionPayload, SyncReport } from "./accounts";
import type {
  AddStampPayload,
  AddTextBoxPayload,
  AppInfo,
  AppSettings,
  CropEntry,
  DocxImageEntry,
  EditImagePayload,
  EditTextRunPayload,
  EngineState,
  ExportPageEntry,
  ExportPagesPayload,
  FdfOpenError,
  LoadSettingsResult,
  MovePagesBetweenDocsPayload,
  MovePagesBetweenDocsResult,
  OpenFileDialogKind,
  OcrProgress,
  OcrRecognizeOptions,
  OcrCancelResult,
  OcrSuspect,
  PageLabelEntry,
  PdfOpenError,
  PrintJobPayload,
  PrintJobResult,
  PrinterInfo,
  PrintWindowContext,
  PrintWindowOpenResult,
  RecentFile,
  SampleDocument,
  SavedSignature,
  SignatureSource,
  TextPage,
  UpdateState,
  WatermarkSettings,
} from "./types";

export const IPC = {
  windowMinimize: "window:minimize",
  windowMaximize: "window:maximize",
  windowClose: "window:close",
  // DEF-142 — close/quit gate. The main process intercepts the window's
  // 'close' event (caption X via window:close, OS Alt+F4, the Window menu's
  // Close role, and app.quit() which closes every window) and, when the
  // renderer has unsaved edits, preventDefaults the close and pushes
  // window:closeRequested so the renderer can show its existing
  // CloseTabPromptDialog. The renderer then calls window:confirmClose to
  // actually close (proceed=true, after Save succeeded / Don't save) or
  // abort (proceed=false / no call, on Cancel). A confirmed window is
  // re-closed via win.close(); the gate skips the second 'close' so the
  // window actually shuts. Covers both the whole-window close and the
  // per-tab closeTab path (which already gated on modified); the window
  // close bypassed that gate, silently discarding unsaved edits.
  windowCloseRequested: "window:closeRequested",
  windowConfirmClose: "window:confirmClose",
  // DEF-303 — main -> renderer pause/resume signal, driven from the main
  // process's `minimize` / `restore` events. Chromium suspends a minimised
  // window's frames regardless of `backgroundThrottling` (the option was
  // tried and reverted: qa measured ~1 rAF frame/s while minimised and no
  // latency gain), so the expensive PDF render/raster loop is parked by this
  // explicit signal. Payload is `WindowMinimizedChange` ({ minimized:
  // boolean }): true on minimize (pause), false on restore (resume).
  // Broadcast-only; the renderer consumer is wired separately.
  windowMinimizedChangedEvent: "window:minimizedChanged",
  openFileDialog: "dialog:openFile",
  // Phase 40 — multi-select sibling of `dialog:openFile`, for "Merge PDF
  // from scratch". Same filter set (via `specForKind`) with OS
  // multi-selection enabled; resolves to a NORMALIZED string[] (empty on
  // cancel), never null.
  openFilesDialog: "dialog:openFiles",
  pdfLoad: "pdf:load",
  // Phase 12 — separate FDF load path. FDF files start with %FDF- and would
  // be rejected by the PDF sniff; this channel uses the FDF signature check.
  fdfLoad: "fdf:load",
  samplesList: "samples:list",
  samplesLoad: "samples:load",
  samplesRead: "samples:read",
  settingsLoad: "settings:load",
  settingsSave: "settings:save",
  settingsAddRecent: "settings:addRecent",
  settingsChangedEvent: "settings:changed",
  settingsWriteErrorEvent: "settings:writeError",
  // Phase 7: application menu actions pushed from main to renderer
  menuActionEvent: "menu:action",
  // DEF-065: renderer -> main command that toggles the enabled state of
  // named application menu items (menu.save, menu.saveAs, ...) so the
  // native menu reflects doc-open / undo-stack state. Fire-and-forget
  // (ipcMain.on, not handle): the renderer does not await a reply.
  menuSetEnabled: "menu:setEnabled",
  // Phase 6 — About + preferences surface
  appGetInfo: "app:getInfo",
  appOpenPath: "app:openPath",
  // Phase 50 — OS integration: open Windows' Default-apps settings so the user
  // can make Jovrel the default PDF handler (which is what drives Explorer's
  // icon/type name; Windows does not let an installer set it silently). The URI
  // is a fixed, non-user-supplied constant in main — the renderer passes no
  // payload. Resolves `{ ok: true }` once the OS call was made, else
  // `{ ok: false, reason: 'failed' }`; never throws, never claims to have
  // changed the default itself.
  appOpenDefaultAppsSettings: "app:openDefaultAppsSettings",
  // Phase 35 — the OS asked TFlex to open a document: the app was launched
  // with a PDF path argument, a second launch handed one to the RUNNING
  // instance (single-instance), or (renderer half, separate dispatch) a PDF
  // was dropped on the window. Main validates the path is a readable PDF and
  // pushes it here; the renderer routes it through the SAME open flow it
  // uses for `openFileDialog` (it does not get a parallel opener).
  appOpenPathRequestEvent: "app:openPathRequest",
// Phase 2: page organization engine
  engineLoadDocument: "engine:loadDocument",
  engineLoadDocumentBytes: "engine:loadDocumentBytes",
  engineApplyOp: "engine:applyOp",
  engineUndo: "engine:undo",
  engineRedo: "engine:redo",
  engineMerge: "engine:merge",
  engineSplit: "engine:split",
  engineExtract: "engine:extract",
  engineSave: "engine:save",
  engineSaveAs: "engine:saveAs",
  engineGetState: "engine:getState",
  // DEF-085 (Bug 4): cheap dirty-check the renderer calls before closing a
  // tab so it can prompt "save unsaved changes?" without pulling a full
  // EngineState. Goes through the per-doc queue like getState so the
  // returned flag reflects every prior queued mutation (e.g. an in-flight
  // applyOp that hasn't resolved when the user clicks the tab close X).
  engineIsModified: "engine:isModified",
  // Phase 11 — return the current serialized document bytes so the renderer
  // can refresh its PDF.js proxy after a content-stream mutation that the
  // original load bytes no longer reflect (e.g. OCR's invisible text layer).
  engineGetDocumentBytes: "engine:getDocumentBytes",
 // Phase 3: annotations
  engineCreateAnnotation: "engine:createAnnotation",
  engineEditAnnotation: "engine:editAnnotation",
  engineDeleteAnnotation: "engine:deleteAnnotation",
  // Phase 28 — comment threads. One op for both the first comment and a
  // reply: `addComment` creates the thread on the first call for an
  // annotation and appends a reply entry on every later call. The thread
  // is persisted in the PDF (catalog `/TFlexComments`) and dropped when
  // its annotation is deleted.
  engineAddComment: "engine:addComment",
// Phase 4: forms
  engineGetFormFields: "engine:getFormFields",
  engineFillFormField: "engine:fillFormField",
  engineFlattenForms: "engine:flattenForms",
// Phase 4: signatures
  enginePlaceSignature: "engine:placeSignature",
  engineMoveSignature: "engine:moveSignature",
  engineDeleteSignature: "engine:deleteSignature",
  // Phase 8: optimize
  engineOptimize: "engine:optimize",
  engineAuditSpace: "engine:auditSpace",
  // Phase 9: create + export
  engineCreateFromImages: "engine:createFromImages",
  engineCreateFromClipboard: "engine:createFromClipboard",
  engineInsertBlankPage: "engine:insertBlankPage",
  engineInsertFromPdf: "engine:insertFromPdf",
  // Phase 32 (Multi Mode) — one atomic cross-document page move/copy. The
  // engine extracts the pages from the source, inserts them into the target
  // at the drop position and (for a move) removes them from the source as a
  // single unit; a failure leaves BOTH documents unchanged. Returns both
  // documents' states so the renderer can refresh both panes in one trip.
  engineMovePagesBetween: "engine:movePagesBetween",
  engineExportPages: "engine:exportPages",
  engineExportText: "engine:exportText",
  engineCreateDocxFromImages: "engine:createDocxFromImages",
  // DEF-060 — DOCX built from the loaded document's own text, with an
  // image fallback (from entries pngBuffer) for text-free pages.
  engineCreateDocxFromDoc: "engine:createDocxFromDoc",
  // Phase 10: edit content
  engineEditTextRun: "engine:editTextRun",
  engineAddTextBox: "engine:addTextBox",
  engineEditImage: "engine:editImage",
  // Phase 14 / DEF-135 / DEF-136 — text-box placement registry (move/delete).
  // addTextBox reuses engineAddTextBox above; these two are the move/delete
  // counterparts. Boxes are registry-only (drawn once at save time), so
  // moving a box updates its rect without masking the content under the old
  // rect (the root cause of DEF-135).
  engineMoveTextBox: "engine:moveTextBox",
  engineDeleteTextBox: "engine:deleteTextBox",
  // Phase 21 — apply a Word/Adobe-class style patch (font family/size,
  // bold/italic/underline, colour, highlight, alignment, line spacing,
  // super/subscript, list style, text) to a registry text box. Preserve-if-
  // valid / reject-if-invalid per field; unknown id or an unsupported font
  // returns a typed engine-error (never a silent fallback).
  engineUpdateTextBox: "engine:updateTextBox",
  // Phase 11: OCR
  engineOcrRecognize: "engine:ocrRecognize",
  engineOcrSuspects: "engine:ocrSuspects",
  engineOcrProgressEvent: "engine:ocrProgress",
  // Phase 51 — cancel an in-flight OCR run. Separate from ocrRecognize
  // because it must take effect while that invoke is still pending.
  engineOcrCancel: "engine:ocrCancel",
  // Phase 12: residual page-organize + annotate parity
  engineReplacePages: "engine:replacePages",
  engineRenumberPages: "engine:renumberPages",
  engineCropPages: "engine:cropPages",
  engineAddStamp: "engine:addStamp",
  engineExportFdf: "engine:exportFdf",
  engineImportFdf: "engine:importFdf",
  // Phase 18: watermark (text or image overlay). The engine bakes the
  // watermark into each selected page's content stream (undoable via the
  // per-doc queue). DEF-216: each application is an individually
  // addressable watermark (marker line in the page's content stream), so
  // applied watermarks can be listed and deleted by id.
  engineAddWatermark: "engine:addWatermark",
  engineGetWatermarks: "engine:getWatermarks",
  engineDeleteWatermark: "engine:deleteWatermark",
  signaturesList: "signatures:list",
  signaturesSave: "signatures:save",
  signaturesDelete: "signatures:delete",
  // Phase 6 — OTA updates
  updateStatus: "update:status",
  updateDownload: "update:download",
  updateInstall: "update:install",
  updateStatusChangedEvent: "update:statusChanged",
  // DEF-079 / DEF-080 — manual re-check IPC. The renderer fires
  // this from Help -> Check for Update (and the About dialog's
  // Check for Updates button). The backend re-runs
  // `autoUpdater.checkForUpdates()` with `autoDownload = false`
  // and the result lands via `update:statusChanged` exactly
  // like the launch-time auto-check.
  updateCheck: "update:check",
  // Phase 30 — print. The renderer asks for the OS printer list
  // (`print:listPrinters`), then hands the composed page images plus the
  // chosen settings to `print:job`; main mounts them in a hidden window and
  // calls `webContents.print`. `print:request` is the main -> renderer event
  // fired by File > Print / Ctrl+P so the renderer opens its print dialog
  // (the same one the title-bar Print icon opens).
  printListPrinters: "print:listPrinters",
  printJob: "print:job",
  printRequestEvent: "print:request",
  // Phase 35 - the print window lives OUTSIDE the app window. The renderer
  // asks main to open (or focus) its own top-level OS window with a small
  // validated `PrintWindowContext`; the print window then drives the same
  // print pipeline over the existing `print:listPrinters` / `print:job`
  // channels. `print:notifyDocumentGone` is the main-window renderer telling
  // main a document was closed; main pushes `print:documentGone` to the print
  // window only when it was opened for that document, so it never shows stale
  // data.
  printOpenWindow: "print:openWindow",
  printNotifyDocumentGone: "print:notifyDocumentGone",
  printDocumentGoneEvent: "print:documentGone",
  // Phase 44 — accounts session vault. `getStatus` resolves to status +
  // email only (never the session token); `setSession` is called by the
  // renderer after a successful sign-in and stores the JWT through
  // Electron safeStorage in the main process; `clearSession` signs out.
  // The network/sync transport is a later chunk.
  accountsGetStatus: "accounts:getStatus",
  accountsSetSession: "accounts:setSession",
  accountsClearSession: "accounts:clearSession",
  // Phase 44 — sync control. `accounts:syncNow` (renderer -> main, invoke)
  // triggers a sync and resolves with the resulting `SyncReport` (single-
  // flight and debounced in the coordinator). `accounts:syncReport` (main ->
  // renderer, broadcast) delivers every `SyncReport` the coordinator
  // produces — including the ones from debounced/triggered background runs
  // — so a renderer that never calls syncNow still sees state changes.
  accountsSyncNow: "accounts:syncNow",
  accountsSyncReportEvent: "accounts:syncReport",
  // Phase 44 — the non-secret accounts config for constructing the auth
  // client IN the renderer. `accounts:getConfig` (invoke, no payload)
  // resolves `{ authBaseUrl: string | null; configured: boolean }`; it never
  // throws and never returns the Data API URL, a token or a secret.
  accountsGetConfig: "accounts:getConfig",
  // Phase 46 - Google sign-in loopback callback. `accounts:startOAuthCallback`
  // (invoke, no payload) binds a 127.0.0.1-only HTTP listener on an ephemeral
  // port and resolves `{ callbackUrl }` - the absolute URL the renderer hands
  // the auth SDK (a `file://` origin is not absolute, which the provider
  // rejects). `accounts:oauthCallback` (main -> renderer, broadcast) delivers
  // `{ ok: true }` when the provider's browser redirect reaches the listener,
  // or `{ ok: false, reason }` on timeout / cancel / error. The listener is
  // single-use and never carries the OAuth code or the callback token back
  // over this event. `accounts:stopOAuthCallback` (invoke, no payload)
  // cancels and cleans up.
  accountsStartOAuthCallback: "accounts:startOAuthCallback",
  accountsStopOAuthCallback: "accounts:stopOAuthCallback",
  accountsOAuthCallbackEvent: "accounts:oauthCallback",
  // Phase 50 - browser-based sign-in. `accounts:openAuthUrl` (invoke) takes
  // the provider URL the auth SDK returned and opens it in the OS DEFAULT
  // BROWSER via `shell.openExternal` - but ONLY after validating it is
  // `https:` on exactly the configured auth host (never a literal; derived
  // from the accounts config). Any other URL is refused and reported as
  // `{ ok: false, reason: 'invalid-url' }` and is NEVER opened. Resolves
  // `{ ok: true }` on success or `{ ok: false, reason: 'failed' }` when the
  // OS call rejects; it never throws and never carries a token.
  accountsOpenAuthUrl: "accounts:openAuthUrl",
  // Phase 46 - dev-oriented observability for the Google sign-in chain. Main
  // (the popup handler and the loopback listener) broadcasts `OAuthTraceEvent`
  // steps over this channel so the renderer can log the popup's navigation /
  // redirect / fail-load, the loopback hit, the completion matcher firing, the
  // popup close and the post-flow cookie names. Always on, cheap, and never
  // carries a token, OAuth code or cookie value.
  accountsOAuthTraceEvent: "accounts:oauthTrace",
  // Phase 45 — main-side clipboard image reader. The renderer's async
  // clipboard API cannot see a FILE copied in Explorer (the CF_HDROP /
  // text/uri-list flavour) because the renderer has no `fs`. This channel
  // (invoke, no payload) resolves the best available clipboard image from
  // the native clipboard image OR a copied image file, and always resolves a
  // typed `ClipboardImageResult` — it never throws. Main only, read-only:
  // it never writes to disk.
  clipboardReadImage: "clipboard:readImage",
} as const;

/** Result of `signatures:save` and `signatures:list`. The renderer treats
 *  the signature service as a flat list of saved entries. */
export type SavedSignaturesResult = SavedSignature[];

/** DEF-303 — payload of `window:minimizedChanged`. `minimized: true` means the
 *  window was minimised (pause expensive renderer work); `false` means it was
 *  restored from minimised (resume). */
export interface WindowMinimizedChange {
  minimized: boolean;
}

/** Phase 45 — MIME types `clipboard:readImage` can return. Only the two the
 *  engine's "Create from clipboard" path can consume, so a copied file whose
 *  magic bytes are some other image type is reported as unreadable rather
 *  than returned with a mime the renderer cannot use. */
export type ClipboardImageMime = "image/png" | "image/jpeg";

/** Phase 45 — why `clipboard:readImage` could not produce an image.
 *  `empty`: the clipboard held no usable content at all (nothing copied).
 *  `no-image`: the clipboard held content (text, or a copied file list with
 *  no image-extension path) but no image. `too-large`: an image was found
 *  but exceeded the size cap. `unreadable`: an image path was found but
 *  could not be stat'd/read, or its magic bytes were not PNG/JPEG. */
export type ClipboardImageReason = "empty" | "no-image" | "too-large" | "unreadable";

/** Phase 45 — result of `clipboard:readImage`. `ok: true` carries the raw
 *  image bytes and the sniffed MIME; `ok: false` carries a non-throwing
 *  reason. The handler never rejects. */
export type ClipboardImageResult =
  | { ok: true; bytes: Uint8Array; mime: ClipboardImageMime }
  | { ok: false; reason: ClipboardImageReason };

/** Phase 50 — result of `app:openDefaultAppsSettings`. `ok: true` means the
 *  fixed `ms-settings:defaultapps` URI was handed to the OS; `failed` means
 *  `shell.openExternal` rejected. The handler never throws. */
export type OpenDefaultAppsSettingsResult =
  | { ok: true }
  | { ok: false; reason: "failed" };

/** Phase 9 — engine surface exposed to the renderer. Each method
 *  routes over the matching `engine:*` IPC channel through preload.
 *  Optional methods: a pre-Phase-9 backend won't expose them; the
 *  renderer's `RealEngineAdapter` degrades with a friendly
 *  `engine-error` so the UI keeps rendering (same defensive pattern
 *  as the earlier phases). */
export interface TFlexApiEngine {
  loadDocument(
    docId: string,
    path: string,
  ): Promise<Result<ArrayBuffer, "open-error">>;
  loadDocumentBytes(
    docId: string,
    bytes: ArrayBuffer | Uint8Array,
  ): Promise<Result<ArrayBuffer, "open-error">>;
  applyOp(
    docId: string,
    op: import("./types").OpEntry,
  ): Promise<Result<EngineState, import("./types").EngineError>>;
  undo(docId: string): Promise<Result<EngineState, import("./types").EngineError>>;
  redo(docId: string): Promise<Result<EngineState, import("./types").EngineError>>;
  merge(
    docId: string,
    otherPaths: string[],
    position: "before" | "after",
  ): Promise<Result<EngineState, import("./types").EngineError>>;
  split(
    docId: string,
    range: [number, number],
  ): Promise<Result<ArrayBuffer, import("./types").EngineError>>;
  extract(
    docId: string,
    pages: number[],
  ): Promise<Result<ArrayBuffer, import("./types").EngineError>>;
  save(docId: string): Promise<Result<string, import("./types").EngineError>>;
  saveAs(docId: string): Promise<Result<string, import("./types").EngineError>>;
  getState(docId: string): Promise<Result<EngineState, import("./types").EngineError>>;
  /** DEF-085 (Bug 4) — cheap dirty-check used by the renderer's tab-close
   *  path to decide whether to prompt "save unsaved changes?" without
   *  pulling a full EngineState. Returns the engine's `modified` flag for
   *  the doc: true after any mutating op (applyOp, annotations, form fill,
   *  signature placement, crop, stamp, OCR, content edit), false after a
   *  loadDocument/loadDocumentBytes, after save/saveAs, and after undo
   *  back to an empty undo stack. Goes through the per-doc queue like
   *  `getState` so the flag reflects every prior queued mutation; an
   *  unknown docId resolves to `engine-error` (the renderer only calls
   *  this for an open doc). */
  isModified(docId: string): Promise<Result<boolean, import("./types").EngineError>>;
  /** Phase 11 — return the current serialized document bytes (the same bytes
   *  a `save` would write) so the renderer can rebuild its PDF.js proxy after
   *  an operation that mutated page content streams the original load bytes
   *  do not reflect — primarily OCR's invisible text layer, but it is a
   *  generic refresh hook and works for any doc state. Read-only: does not
   *  flip `modified` or clear the undo stack (unlike `save`/`saveAs`). Goes
   *  through the per-doc queue so the returned bytes reflect every queued
   *  mutation issued before it. */
  getDocumentBytes(
    docId: string,
  ): Promise<Result<ArrayBuffer, import("./types").EngineError>>;
  createAnnotation?(
    docId: string,
    annotation: unknown,
  ): Promise<Result<EngineState, import("./types").EngineError>>;
  editAnnotation?(
    docId: string,
    id: string,
    patch: unknown,
  ): Promise<Result<EngineState, import("./types").EngineError>>;
  deleteAnnotation?(
    docId: string,
    id: string,
  ): Promise<Result<EngineState, import("./types").EngineError>>;
  /** Phase 28 — append a comment entry to an annotation's thread. Creates
   *  the thread on the first call and appends a reply thereafter (one op
   *  for both). `text` must be a non-empty string (trimmed, max 4000
   *  chars) and `annotationId` must name an annotation in the document;
   *  otherwise the call rejects with a typed `engine-error`. `author`
   *  defaults to 'You' when omitted/blank. The returned state carries the
   *  updated `comments` array. */
  addComment?(
    docId: string,
    annotationId: string,
    text: string,
    author?: string,
  ): Promise<Result<EngineState, import("./types").EngineError>>;
  getFormFields?(
    docId: string,
  ): Promise<Result<unknown[], import("./types").EngineError>>;
  fillFormField?(
    docId: string,
    payload: unknown,
  ): Promise<Result<unknown[], import("./types").EngineError>>;
  flattenForms?(
    docId: string,
  ): Promise<Result<EngineState, import("./types").EngineError>>;
  placeSignature?(
    docId: string,
    payload: unknown,
  ): Promise<Result<EngineState, import("./types").EngineError>>;
  moveSignature?(
    docId: string,
    payload: unknown,
  ): Promise<Result<EngineState, import("./types").EngineError>>;
  deleteSignature?(
    docId: string,
    id: string,
  ): Promise<Result<EngineState, import("./types").EngineError>>;
  optimize?(
    docId: string,
    preset: import("./types").OptimizePreset,
  ): Promise<Result<ArrayBuffer, import("./types").EngineError>>;
  auditSpace?(
    docId: string,
  ): Promise<Result<import("./types").SpaceAudit, import("./types").EngineError>>;
  /** Phase 9 — create + export. `quality` is the JPEG re-encode
   *  fraction in [0, 1] — matches `AppSettings.createImageQuality`
   *  so the persisted value survives the backend's preserve-if-valid
   *  pipeline. */
  createFromImages?(
    docId: string,
    imageBuffers: Uint8Array[],
    quality: number,
  ): Promise<Result<ArrayBuffer, import("./types").EngineError>>;
  createFromClipboard?(
    docId: string,
    content: Uint8Array | string,
  ): Promise<Result<ArrayBuffer, import("./types").EngineError>>;
  insertBlankPage?(
    docId: string,
    afterIndex: number,
    widthPx: number,
    heightPx: number,
  ): Promise<Result<EngineState, import("./types").EngineError>>;
  insertFromPdf?(
    docId: string,
    otherBytes: Uint8Array,
    position: number,
  ): Promise<Result<EngineState, import("./types").EngineError>>;
  /** Phase 32 (Multi Mode) — move/copy pages between two open documents as
   *  ONE atomic operation. `pages` are 0-based visible indices in the
   *  source; `atIndex` is the target's visible insertion index (-1 =
   *  append). Returns both documents' states. Optional so a pre-Phase-32
   *  backend degrades with a friendly engine-error instead of crashing. */
  movePagesBetweenDocs?(
    payload: MovePagesBetweenDocsPayload,
  ): Promise<Result<MovePagesBetweenDocsResult, import("./types").EngineError>>;
  exportPages?(
    docId: string,
    payload: ExportPagesPayload,
  ): Promise<Result<ExportPageEntry[], import("./types").EngineError>>;
  exportText?(docId: string): Promise<Result<TextPage[], import("./types").EngineError>>;
  createDocxFromImages?(
    entries: DocxImageEntry[],
  ): Promise<Result<Uint8Array, import("./types").EngineError>>;
  /** DEF-060 — build a .docx from the loaded document's own text. The
   *  engine extracts per-page text from its pdfDoc (reusing the exportText
   *  machinery) and emits real `w:p`/`w:r`/`w:t` paragraphs in
   *  word/document.xml for text-bearing pages. Pages with no extractable
   *  text fall back to an inline image (`wp:inline`) taken from the matching
   *  `DocxImageEntry` (by `pageNumber`) — the renderer rasterises every page
   *  with PDF.js ahead of time so the fallback always has pixels. Kept
   *  alongside `createDocxFromImages` for compat; the renderer picks this
   *  path when the source is a loaded doc (editable text where possible). */
  createDocxFromDoc?(
    docId: string,
    entries: DocxImageEntry[],
  ): Promise<Result<Uint8Array, import("./types").EngineError>>;
  /** Phase 10 — edit existing text run: mask the run's rect with a white
   *  rectangle and draw `newText` at the rect's top-left. */
  editTextRun?(
    docId: string,
    payload: EditTextRunPayload,
  ): Promise<Result<EngineState, import("./types").EngineError>>;
  /** Phase 10 — add a new text box with wrapping inside `rect`. As of
   *  Phase 14 / DEF-135 / DEF-136 this pushes a `TextBoxModel` into the
   *  engine-side placement registry (NO immediate draw); the box is drawn
   *  once at its FINAL rect at save time so moving it never masks the
   *  content under its old rect. `payload.id` is optional (the engine
   *  generates a uuid if absent); the returned `EngineState.textBoxes`
   *  carries the assigned id so the renderer can move/delete it. */
  addTextBox?(
    docId: string,
    payload: AddTextBoxPayload,
  ): Promise<Result<EngineState, import("./types").EngineError>>;
  /** Phase 14 / DEF-135 / DEF-136 — move a registry text box to `rect`
   *  (top-left origin, PDF points). Updates the box's rect in the registry;
   *  the box is redrawn at its new rect on the next save/getDocumentBytes.
   *  No masking of the old rect — underlying content is never erased. */
  moveTextBox?(
    docId: string,
    id: string,
    rect: import("./types").AnnRect,
  ): Promise<Result<EngineState, import("./types").EngineError>>;
  /** Phase 14 / DEF-135 / DEF-136 — delete a registry text box by id.
   *  Removes it from the registry so it is no longer drawn at save time. */
  deleteTextBox?(
    docId: string,
    id: string,
  ): Promise<Result<EngineState, import("./types").EngineError>>;
  /** Phase 21 — apply a style patch to a registry text box. Every patch field
   *  is optional and preserve-if-valid; a supplied-but-invalid field (or an
   *  unsupported font) rejects the whole patch with a typed `engine-error`.
   *  An unknown id also returns `engine-error`. On success the box is updated
   *  in the registry, the doc is marked modified, the per-doc undo snapshot is
   *  pushed, and the new state is returned. */
  updateTextBox?(
    docId: string,
    id: string,
    patch: import("./types").TextBoxStylePatch,
  ): Promise<Result<EngineState, import("./types").EngineError>>;
  /** Phase 10 — edit an image (move/resize/replace/crop). The engine
   *  masks `oldRect` and draws `imageBytes` at `newRect`; the renderer
   *  produces the transformed bytes. */
  editImage?(
    docId: string,
    payload: EditImagePayload,
  ): Promise<Result<EngineState, import("./types").EngineError>>;
  /** Phase 11 — run OCR over renderer-rasterised page images and write an
   *  invisible text layer (Tr 3) onto each matching page so the scanned
   *  document becomes searchable. The renderer rasterises pages with
   *  PDF.js and sends the PNGs in `options.pageImages`; the engine cannot
   *  rasterise (pdf-lib has no rasteriser). Progress is pushed back via
   *  `engine.onOcrProgress`. See OcrRecognizeOptions for the contract note. */
  ocrRecognize?(
    docId: string,
    options: OcrRecognizeOptions,
  ): Promise<Result<EngineState, import("./types").EngineError>>;
  /** Phase 51 — cancel an in-flight `ocrRecognize` on this doc. Not queued
   *  behind the per-doc operation queue: it flips a per-doc cancel flag the
   *  recognition loop checks before each page and before the text-layer
   *  commit, restores the pre-run snapshot, and resolves the pending
   *  `ocrRecognize` with `error.code === 'cancelled'` (no partial text, no
   *  modified flag). A cancel with no run in flight (before start / after
   *  finish) is a no-op returning `{ cancelled: false }`. Never throws. */
  ocrCancel?(
    docId: string,
  ): Promise<Result<OcrCancelResult, import("./types").EngineError>>;
  /** Phase 11 — return the low-confidence words from the most recent
   *  `ocrRecognize` on this doc. Read-only. */
  ocrSuspects?(
    docId: string,
  ): Promise<Result<OcrSuspect[], import("./types").EngineError>>;
  /** Phase 11 — subscribe to per-page OCR progress pushed from the main
   *  process while `ocrRecognize` runs. Returns an unsubscribe function. */
  onOcrProgress?(cb: (p: OcrProgress) => void): () => void;
  /** Phase 12 — replace the visible page range `targetRange` (0-based,
   *  inclusive [start, end]) with all pages of `otherBytes`. Surviving
   *  pages keep their annotations; the other PDF's annotations and outline
   *  (bookmarks) are carried across via a page-ref remap. Links are
   *  annotations and ride the per-page annotation carry. */
  replacePages?(
    docId: string,
    otherBytes: Uint8Array,
    targetRange: [number, number],
  ): Promise<Result<EngineState, import("./types").EngineError>>;
  /** Phase 12 — set logical page labels (/PageLabels number tree) from
   *  `{page, label}` entries. `page` is 1-based visible. Replaces any
   *  labels set by a previous call. */
  renumberPages?(
    docId: string,
    labels: PageLabelEntry[],
  ): Promise<Result<EngineState, import("./types").EngineError>>;
  /** Phase 12 — set each listed page's CropBox AND TrimBox to `box`
   *  (top-left origin, PDF points; the engine converts to bottom-left). */
  cropPages?(
    docId: string,
    entries: CropEntry[],
  ): Promise<Result<EngineState, import("./types").EngineError>>;
  /** Phase 12 — embed a renderer-drawn stamp raster (`pngBytes`) at `rect`
   *  on `page`. `stampId` is validated against the built-in allowlist. The
   *  stamp is baked into the page content (one-way: not re-editable as a
   *  stamp entity after save, though the pixels survive). */
  addStamp?(
    docId: string,
    payload: AddStampPayload,
  ): Promise<Result<EngineState, import("./types").EngineError>>;
  /** Phase 12 — export the document's annotations as FDF (Forms Data Format)
   *  comment bytes. Round-trips with `importFdf`. */
  exportFdf?(
    docId: string,
  ): Promise<Result<ArrayBuffer, import("./types").EngineError>>;
  /** Phase 12 — import FDF comment bytes and merge the annotations into the
   *  document's annotation state (mapped to visible pages via /Page). */
  importFdf?(
    docId: string,
    fdfBytes: Uint8Array,
  ): Promise<Result<EngineState, import("./types").EngineError>>;
  /** Phase 18 — bake a text or image watermark into the content streams
   *  of the selected pages. Each application is an individually
   *  addressable watermark (id `wm-N`): the marker baked into each page's
   *  content stream survives the save round-trip, so `getWatermarks` can
   *  still report it after a reopen and `deleteWatermark` can remove it by
   *  id. Undo via the per-doc queue also removes it. `settings` is the
   *  shared `WatermarkSettings` payload — type, text / imageBytes,
   *  typography, color, opacity, position (or explicit x/y), tile, and
   *  the 1-based inclusive page range. Optional so a pre-Phase-18
   *  backend degrades with a friendly engine-error. */
  addWatermark?(
    docId: string,
    settings: WatermarkSettings,
  ): Promise<Result<EngineState, import("./types").EngineError>>;
  /** Phase 18 / DEF-216 — report the watermarks applied to the document:
   *  one record per applied watermark (ids like `wm-1`, in first-seen
   *  order), each listing the 1-based visible page numbers that carry it
   *  (ascending). `text` is '' for image watermarks. Identity is read
   *  from the marker line baked into each page's content stream, so the
   *  records survive a save/reopen. */
  getWatermarks?(docId: string): Promise<Result<import("./types").WatermarkInfo[], import("./types").EngineError>>;
  /** Phase 18 / DEF-216 — delete an applied watermark by id (see
   *  `getWatermarks`): its content stream is removed from every page that
   *  carries it. Unknown or empty ids, and ids with no matching stream,
   *  fail with 'engine-error' (never a silent success). */
  deleteWatermark?(
    docId: string,
    watermarkId: string,
  ): Promise<Result<EngineState, import("./types").EngineError>>;
}

export interface TFlexApi {
  minimizeWindow(): void;
  maximizeWindow(): void;
  closeWindow(): void;
  /** DEF-142 — subscribe to whole-window close requests pushed from the
   *  main process. Main fires this when the user clicks the window X,
   *  presses Alt+F4, picks the Window menu's Close role, or triggers
   *  app.quit() (Exit menu) AND the main-side gate could not prove the
   *  close was safe — the renderer is the source of truth for unsaved
   *  edits, so main always forwards the close request here. The renderer
   *  checks its open tabs for unsaved state: if none are modified it
   *  immediately calls `confirmClose(true)`; otherwise it shows the
   *  existing CloseTabPromptDialog (iterating every modified tab) and
   *  calls `confirmClose(true)` on Save success / Don't save, or does
   *  nothing on Cancel (the window stays open). Returns an unsubscribe. */
  onCloseRequested?(cb: () => void): () => void;
  /** DEF-142 — tell the main process to actually close the window after
   *  the renderer's unsaved-changes prompt has resolved. `proceed=true`
   *  marks the window as close-confirmed and re-calls `win.close()`; the
   *  gate skips the second 'close' (and the geometry report still runs)
   *  so the window shuts. `proceed=false` (or no call) aborts — the window
   *  stays open. The renderer awaits this to know the close proceeded. */
  confirmClose?(proceed: boolean): Promise<void>;
  /** DEF-303 — subscribe to the main process's pause/resume signal, fired on
   *  the window's `minimize` (minimized=true) and `restore` (minimized=false)
   *  events. Chromium suspends a minimised window's frames regardless of
   *  `backgroundThrottling`, so the expensive PDF render/raster loop is
   *  parked by this explicit signal rather than by `visibilitychange`.
   *  Returns an unsubscribe. Optional so a preload without the signal
   *  degrades gracefully (jsdom tests, older builds). */
  onMinimizedChanged?(cb: (state: WindowMinimizedChange) => void): () => void;
  openFileDialog(kind?: OpenFileDialogKind): Promise<string | null>;
  /** Phase 40 — multi-select file picker for "Merge PDF from scratch".
   *  Same `OpenFileDialogKind` filter set as `openFileDialog` (default
   *  `'pdf'`), with OS multi-selection enabled. Resolves to the NORMALIZED
   *  picked paths in selection order, or an EMPTY ARRAY when the user
   *  cancels — never `null`. The single-file `openFileDialog` is unchanged. */
  openFilesDialog(kind?: OpenFileDialogKind): Promise<string[]>;
  loadPdf(path: string): Promise<Result<ArrayBuffer, PdfOpenError>>;
  /** Phase 12 — load an FDF (Forms Data Format) comment file from disk.
   *  Separate from `loadPdf` because FDF files start with `%FDF-`, not
   *  `%PDF-`, and would be rejected by the PDF header sniff. Validates
   *  the `%FDF-` signature and returns the raw bytes (no parsing — the
   *  engine's `importFdf` does the structural parse). */
  loadFdf(path: string): Promise<Result<ArrayBuffer, FdfOpenError>>;
  loadSample(name: string): Promise<Result<SampleDocument & { path: `samples/${string}` }, "not-found">>;
  readSample(name: string): Promise<Result<ArrayBuffer, "not-found">>;
  listSamples(): Promise<SampleDocument[]>;
  loadSettings(): Promise<LoadSettingsResult>;
  saveSettings(s: AppSettings): Promise<void>;
  addRecentFile(f: RecentFile): Promise<void>;
  settings: {
    changed(cb: (s: AppSettings) => void): () => void;
    /** DEF-230 — fired when a settings write fails (e.g. EPERM on rename).
     *  The save promise still resolves; this is the only signal the renderer
     *  gets that the value did not persist. Message is non-empty. */
    writeError(cb: (message: string) => void): () => void;
  };
  /** Phase 4 — saved-signatures service. The signature list lives in the
   *  renderer's localStorage cache (one entry per user) and is exposed via
   *  this service so the host can also persist a server-side mirror
   *  without changing the IPC shape. `list` / `save` / `delete` all return
   *  the full updated list so the renderer doesn't have to merge. */
  signatures: {
    list(): Promise<SavedSignaturesResult>;
    save(source: SignatureSource, label?: string): Promise<SavedSignaturesResult>;
    delete(id: string): Promise<SavedSignaturesResult>;
  };
  /** Phase 7 — application menu. Menu actions are pushed from main
   *  to the renderer via IPC; the renderer listens with onAction and
   *  dispatches to the same handlers as toolbar/button interactions.
   *  The callback receives the action name (e.g. 'open', 'saveAs'). */
  menu: {
    onAction(cb: (action: string) => void): () => void;
    /** DEF-065 — toggle the enabled state of named menu items
     *  (menu.save, menu.saveAs, menu.closeTab, menu.undo, menu.redo) to
     *  match the renderer's doc-open / undo-stack state. Fire-and-forget:
     *  the renderer does not await a reply; main flips `.enabled` on the
     *  matching `MenuItem`. Omitted ids keep their current state. */
setEnabled(state: import("./types").MenuEnabledState): void;
  };
  /** Phase 30 — print surface. `listPrinters` returns the OS printer list
   *  (system device names, with the default flagged). `printJob` sends the
   *  composed page images (data URLs) plus the chosen settings to the
   *  hidden-window print pipeline; a failure resolves with a reason the
   *  dialog surfaces. `onPrintRequest` subscribes to the main -> renderer
   *  event fired by File > Print / Ctrl+P (returns an unsubscribe). */
  listPrinters(): Promise<PrinterInfo[]>;
  printJob(payload: PrintJobPayload): Promise<PrintJobResult>;
  onPrintRequest(cb: () => void): () => void;
  /** Phase 35 - the standalone print window. `open` asks main to create (or
   *  focus/refresh) its own top-level OS window, movable anywhere on the
   *  desktop including beyond the app window, seeded with a validated
   *  `PrintWindowContext`. `notifyDocumentGone` lets the main-window renderer
   *  tell main a document was closed; main pushes the matching
   *  `onDocumentGone` event to the print window (the print window also uses
   *  `onDocumentGone` to react). Returns an unsubscribe. */
  printWindow?: {
    open(context: PrintWindowContext): Promise<PrintWindowOpenResult>;
    notifyDocumentGone(docId: string): Promise<void>;
    onDocumentGone(cb: (docId: string) => void): () => void;
  };
  /** Phase 6 — About + preferences. Backend fills `AppInfo` from
   *  `app.getVersion()` and the user-data path so the About dialog
   *  can show a version badge and the preferences sheet can show
   *  storage locations. `openPath` is best-effort — the renderer
   *  treats rejection as a non-error (it falls back to a toast).
   *  Optional because preload wiring is being added in parallel
   *  by backend-dev; the renderer guards with a runtime check. */
  app?: {
    getInfo(): Promise<AppInfo>;
    openPath(path: string): Promise<void>;
    /** Phase 50 — open Windows' Default-apps settings so the user can make
     *  Jovrel the default PDF handler. Main opens the fixed
     *  `ms-settings:defaultapps` URI; resolves `{ ok: true }` once the OS call
     *  was made, else `{ ok: false, reason: 'failed' }`. The app does NOT
     *  change the default itself and must not claim to. Never throws. */
    openDefaultAppsSettings(): Promise<OpenDefaultAppsSettingsResult>;
  };
  /**
   * Phase 44 — accounts session surface. `getStatus` returns the coarse
   * account status plus the signed-in identity (email, display name and
   * avatar image — avatar/name null when unknown; NEVER the session token);
   * `setSession` hands the main process the user identity and the session
   * JWT after a successful sign-in, which the main process encrypts with
   * Electron safeStorage; `clearSession` signs out and deletes the stored
   * session. Optional so a preload without the accounts bridge degrades
   * gracefully (jsdom tests, older builds) — the renderer gates on the
   * `accountsEnabled` flag anyway.
   */
  accounts?: {
    getStatus(): Promise<AccountStatusResult>;
    /** Resolve the non-secret accounts config the renderer needs to construct
     *  the auth client (`{ authBaseUrl, configured }`). Never rejects;
     *  unconfigured resolves `{ authBaseUrl: null, configured: false }`. */
    getConfig(): Promise<AccountsClientConfig>;
    setSession(payload: SetSessionPayload): Promise<void>;
    clearSession(): Promise<void>;
    /** Trigger a sync now and resolve with its `SyncReport`. Single-flight:
     *  overlapping calls join the in-flight attempt. Never rejects. A run
     *  with the feature off or no session resolves `idle`; a run with no
     *  configured transport resolves `unavailable` — neither makes a
     *  network call. */
    syncNow(): Promise<SyncReport>;
    /** Subscribe to every `SyncReport` the coordinator produces, including
     *  the debounced/background runs a caller did not request. Returns an
     *  unsubscribe. */
    onSyncReport(cb: (report: SyncReport) => void): () => void;
    /** Phase 46 — bind the loopback callback listener and resolve its
     *  absolute URL (`{ callbackUrl }`) to hand the auth SDK as
     *  `callbackURL`. Starting again replaces any in-flight listener.
     *  Rejects only when the listener could not bind at all. */
    startOAuthCallback(): Promise<OAuthCallbackStartResult>;
    /** Phase 46 — cancel and clean up the loopback callback listener. The
     *  matching `onOAuthCallback` event reports `{ ok: false, reason:
     *  'cancelled' }`. Never rejects. */
    stopOAuthCallback(): Promise<void>;
    /** Phase 46 — subscribe to the single outcome of the loopback listener:
     *  `{ ok: true }` when the provider's redirect lands, else a reason.
     *  Returns an unsubscribe. Never carries the OAuth code or token. */
    onOAuthCallback(cb: (outcome: OAuthCallbackOutcome) => void): () => void;
    /** Phase 46 — subscribe to dev-oriented `OAuthTraceEvent` steps of the
     *  popup / loopback chain, for logging a stuck sign-in. Returns an
     *  unsubscribe. Never carries a token, OAuth code or cookie value. */
    onOAuthTrace(cb: (event: OAuthTraceEvent) => void): () => void;
    /** Phase 50 — open the provider sign-in URL in the OS DEFAULT BROWSER.
     *  `url` is the provider URL the auth SDK returned. Main validates it is
     *  `https:` on exactly the configured auth host before calling
     *  `shell.openExternal`; any other URL is refused and never opened.
     *  Resolves `{ ok: true }`, `{ ok: false, reason: 'invalid-url' }` (refused)
     *  or `{ ok: false, reason: 'failed' }` (OS call rejected). Never throws;
     *  never carries a token. */
    openAuthUrl(url: string): Promise<OpenAuthUrlResult>;
  };
  /**
   * Phase 35 (DEF-295) — resolve a `File` from a drag-and-drop (or any
   * renderer-created File) to its absolute on-disk path. Electron 30+
   * exposes this only through `webUtils.getPathForFile`, which must be
   * called from the isolated preload world; this bridge forwards it. The
   * renderer then feeds the path to the existing `app.openPath` /
   * `loadPdf` flow. Optional so a preload without the bridge degrades
   * gracefully (jsdom tests, older builds).
   */
  webUtils?: {
    getPathForFile(file: File): string;
  };
  /**
   * Phase 45 — main-side clipboard image reader. `readImage()` (invoke, no
   * payload) resolves the best available clipboard image — the native
   * clipboard image, or an image FILE copied in Explorer (CF_HDROP /
   * text/uri-list) — as `ClipboardImageResult`. It never rejects: an absent
   * or unusable image resolves `{ ok: false, reason }`. Optional so a preload
   * without the bridge degrades gracefully (jsdom tests, older builds).
   */
  clipboard?: {
    readImage(): Promise<ClipboardImageResult>;
  };
  /**
   * Phase 35 — subscribe to an OS file-open request pushed by main
   * (`app:openPathRequest`). Fired when the app is launched with a PDF
   * path argument, when a second launch hands a path to the running
   * instance, or when the drop path resolves one. The renderer opens the
   * path through its existing open flow. Returns an unsubscribe.
   */
  onOpenPathRequest?(cb: (path: string) => void): () => void;
  /** Phase 6 — OTA updates. Backend manages the update lifecycle
   *  through electron-updater; the renderer polls status and can
   *  trigger download/install. Status changes are pushed as events.
   *
   *  `check()` (DEF-079 / DEF-080) is the manual re-check entry
   *  point — Help -> Check for Update emits the `update.check` menu
   *  action, which the renderer routes to this call. The backend
   *  re-runs `autoUpdater.checkForUpdates()` with `autoDownload =
   *  false` (the same semantics as the start-path check) and the
   *  result lands via `onStatusChanged` exactly like the launch-time
   *  auto-check. */
  update?: {
    getStatus(): Promise<UpdateState>;
    download(): Promise<UpdateState>;
    install(): Promise<void>;
    check(): Promise<UpdateState>;
    onStatusChanged(cb: (state: UpdateState) => void): () => void;
  };
  /** Phase 9 — engine surface (matches `window.tflex.engine` at
   *  runtime). Optional because the renderer also falls back to an
   *  in-memory stub when preload doesn't expose the engine (jsdom
   *  tests, older builds). The renderer's `RealEngineAdapter`
   *  enforces per-method `engine-error` degradation when an
   *  individual engine.* method is missing. */
  engine?: TFlexApiEngine;
}