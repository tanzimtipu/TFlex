import { contextBridge, ipcRenderer, webUtils } from "electron";
import {
  IPC,
  type ClipboardImageResult,
  type SavedSignaturesResult,
  type WindowMinimizedChange,
} from "../shared/ipc";
import type {
  AppInfo,
  AppSettings,
  AddStampPayload,
  AddTextBoxPayload,
  CreateAnnotationPayload,
  CropEntry,
  DocxImageEntry,
  EditAnnotationPayload,
  EditImagePayload,
  EditTextRunPayload,
  EngineError,
  EngineState,
  ExportPageEntry,
  ExportPagesPayload,
  FillFormFieldPayload,
  FormField,
  MovePagesBetweenDocsPayload,
  MovePagesBetweenDocsResult,
  MoveSignaturePayload,
  OpenFileDialogKind,
  OcrProgress,
  OcrRecognizeOptions,
  OcrSuspect,
  OpEntry,
  OptimizePreset,
  PageLabelEntry,
  PlaceSignaturePayload,
  PrintJobPayload,
  PrintJobResult,
  PrinterInfo,
  PrintWindowContext,
  PrintWindowOpenResult,
  RecentFile,
  SampleDocument,
  SpaceAudit,
  TextBoxStylePatch,
  TextPage,
  UpdateState,
  WatermarkInfo,
  WatermarkSettings,
} from "../shared/types";
import type { Result } from "../shared/result";
import type { FdfOpenError, PdfOpenError } from "../shared/types";
import type { SignatureSource } from "../shared/types";
import type { AccountStatusResult, AccountsClientConfig, SetSessionPayload, SyncReport } from "../shared/accounts";
import { normalizeArrayBuffer } from "./to-array-buffer";

// The renderer's engineClient.ts declares `window.tflex?.engine` with its own
// TFlexApiEngine type. We expose the engine methods at runtime under that key
// without adding `engine` to the shared TFlexApi (which would conflict with
// the renderer's own Window augmentation).
const engineApi = {
  loadDocument(docId: string, path: string): Promise<Result<ArrayBuffer, 'open-error'>> {
    return ipcRenderer.invoke(IPC.engineLoadDocument, docId, path);
  },
  async loadDocumentBytes(docId: string, bytes: Uint8Array): Promise<Result<ArrayBuffer, 'open-error'>> {
    const result = (await ipcRenderer.invoke(IPC.engineLoadDocumentBytes, docId, bytes)) as Result<ArrayBuffer, 'open-error'>;
    if (!result.ok) {
      return result;
    }
    return { ok: true, value: normalizeArrayBuffer(result.value) };
  },
  applyOp(docId: string, op: OpEntry): Promise<Result<EngineState, EngineError>> {
    return ipcRenderer.invoke(IPC.engineApplyOp, docId, op);
  },
  undo(docId: string): Promise<Result<EngineState, EngineError>> {
    return ipcRenderer.invoke(IPC.engineUndo, docId);
  },
  redo(docId: string): Promise<Result<EngineState, EngineError>> {
    return ipcRenderer.invoke(IPC.engineRedo, docId);
  },
  merge(docId: string, otherPaths: string[], position: 'before' | 'after'): Promise<Result<EngineState, EngineError>> {
    return ipcRenderer.invoke(IPC.engineMerge, docId, otherPaths, position);
  },
  split(docId: string, range: [number, number]): Promise<Result<ArrayBuffer, EngineError>> {
    return ipcRenderer.invoke(IPC.engineSplit, docId, range);
  },
  extract(docId: string, pages: number[]): Promise<Result<ArrayBuffer, EngineError>> {
    return ipcRenderer.invoke(IPC.engineExtract, docId, pages);
  },
  save(docId: string): Promise<Result<string, EngineError>> {
    return ipcRenderer.invoke(IPC.engineSave, docId);
  },
  saveAs(docId: string): Promise<Result<string, EngineError>> {
    // The engine Save-As path can fail with 'write-error' (disk full,
    // read-only target, permission denied) in addition to 'cancelled'
    // when the user dismisses the OS save dialog. The shared IPC contract
    // (shared/ipc.ts) types this as EngineError; the previous narrow
    // `'cancelled'` here hid the write-error branch from the renderer and
    // was the root of DEF-011's residual missing toast (DEF-067).
    return ipcRenderer.invoke(IPC.engineSaveAs, docId);
  },
  getState(docId: string): Promise<Result<EngineState, EngineError>> {
    return ipcRenderer.invoke(IPC.engineGetState, docId);
  },
  // DEF-085 (Bug 4) — cheap dirty-check the renderer calls before closing
  // a tab to decide whether to prompt "save unsaved changes?". Avoids a
  // full getState/buildState round-trip; queue-ordered like getState.
  isModified(docId: string): Promise<Result<boolean, EngineError>> {
    return ipcRenderer.invoke(IPC.engineIsModified, docId);
  },
  // Phase 11 — current serialized bytes so the renderer can refresh its
  // PDF.js proxy after OCR (or any content-stream mutation). Normalised
  // to a fresh ArrayBuffer, matching loadDocumentBytes.
  async getDocumentBytes(docId: string): Promise<Result<ArrayBuffer, EngineError>> {
    const result = (await ipcRenderer.invoke(IPC.engineGetDocumentBytes, docId)) as Result<ArrayBuffer, EngineError>;
    if (!result.ok) {
      return result;
    }
    return { ok: true, value: normalizeArrayBuffer(result.value) };
  },
  // Phase 3: annotations — payloads are forwarded from the renderer as-is
  createAnnotation(
    docId: string,
    payload: CreateAnnotationPayload,
  ): Promise<Result<EngineState, EngineError>> {
    return ipcRenderer.invoke(IPC.engineCreateAnnotation, docId, payload);
  },
  editAnnotation(
    docId: string,
    annId: string,
    payload: EditAnnotationPayload,
  ): Promise<Result<EngineState, EngineError>> {
    return ipcRenderer.invoke(IPC.engineEditAnnotation, docId, annId, payload);
  },
  deleteAnnotation(
    docId: string,
    annId: string,
  ): Promise<Result<EngineState, EngineError>> {
    return ipcRenderer.invoke(IPC.engineDeleteAnnotation, docId, annId);
  },
  // Phase 28 — comment threads: appends an entry to the annotation's thread
  // (creating the thread on the first call). `author` is optional and
  // defaults to 'You' in the engine.
  addComment(
    docId: string,
    annotationId: string,
    text: string,
    author?: string,
  ): Promise<Result<EngineState, EngineError>> {
    return ipcRenderer.invoke(IPC.engineAddComment, docId, annotationId, text, author);
  },
  // Phase 4: forms
  getFormFields(docId: string): Promise<Result<FormField[], EngineError>> {
    return ipcRenderer.invoke(IPC.engineGetFormFields, docId);
  },
  fillFormField(
    docId: string,
    payload: FillFormFieldPayload,
  ): Promise<Result<EngineState, EngineError>> {
    return ipcRenderer.invoke(IPC.engineFillFormField, docId, payload);
  },
  flattenForms(docId: string): Promise<Result<EngineState, EngineError>> {
    return ipcRenderer.invoke(IPC.engineFlattenForms, docId);
  },
  // Phase 4: signatures
  placeSignature(
    docId: string,
    payload: PlaceSignaturePayload,
  ): Promise<Result<EngineState, EngineError>> {
    return ipcRenderer.invoke(IPC.enginePlaceSignature, docId, payload);
  },
  moveSignature(
    docId: string,
    payload: MoveSignaturePayload,
  ): Promise<Result<EngineState, EngineError>> {
    return ipcRenderer.invoke(IPC.engineMoveSignature, docId, payload);
  },
  deleteSignature(
    docId: string,
    sigPlacementId: string,
  ): Promise<Result<EngineState, EngineError>> {
    return ipcRenderer.invoke(IPC.engineDeleteSignature, docId, sigPlacementId);
  },
  // Phase 8: optimize — file size reduction and space audit
  optimize(
    docId: string,
    preset: OptimizePreset,
  ): Promise<Result<ArrayBuffer, EngineError>> {
    return ipcRenderer.invoke(IPC.engineOptimize, docId, preset);
  },
  auditSpace(
    docId: string,
  ): Promise<Result<SpaceAudit, EngineError>> {
    return ipcRenderer.invoke(IPC.engineAuditSpace, docId);
  },
  // Phase 9: create + export
  createFromImages(
    docId: string,
    imageBuffers: Uint8Array[],
  ): Promise<Result<ArrayBuffer, EngineError>> {
    return ipcRenderer.invoke(IPC.engineCreateFromImages, docId, imageBuffers);
  },
  createFromClipboard(
    docId: string,
    content: Uint8Array | string,
  ): Promise<Result<ArrayBuffer, EngineError>> {
    return ipcRenderer.invoke(IPC.engineCreateFromClipboard, docId, content);
  },
  insertBlankPage(
    docId: string,
    afterIndex: number,
    widthPx: number,
    heightPx: number,
  ): Promise<Result<EngineState, EngineError>> {
    return ipcRenderer.invoke(IPC.engineInsertBlankPage, docId, afterIndex, widthPx, heightPx);
  },
  insertFromPdf(
    docId: string,
    otherBytes: Uint8Array,
    position: number,
  ): Promise<Result<EngineState, EngineError>> {
    return ipcRenderer.invoke(IPC.engineInsertFromPdf, docId, otherBytes, position);
  },
  // Phase 32 (Multi Mode) — atomic cross-document page move/copy. The
  // payload is forwarded as-is; the engine returns both documents' states.
  movePagesBetweenDocs(
    payload: MovePagesBetweenDocsPayload,
  ): Promise<Result<MovePagesBetweenDocsResult, EngineError>> {
    return ipcRenderer.invoke(IPC.engineMovePagesBetween, payload);
  },
  exportPages(
    docId: string,
    payload: ExportPagesPayload,
  ): Promise<Result<ExportPageEntry[], EngineError>> {
    return ipcRenderer.invoke(IPC.engineExportPages, docId, payload);
  },
  exportText(
    docId: string,
  ): Promise<Result<TextPage[], EngineError>> {
    return ipcRenderer.invoke(IPC.engineExportText, docId);
  },
  createDocxFromImages(
    entries: DocxImageEntry[],
  ): Promise<Result<Uint8Array, EngineError>> {
    return ipcRenderer.invoke(IPC.engineCreateDocxFromImages, entries);
  },
  // DEF-060 — build a .docx from the loaded document's own text, with an
  // image fallback (from entries pngBuffer) for text-free pages.
  createDocxFromDoc(
    docId: string,
    entries: DocxImageEntry[],
  ): Promise<Result<Uint8Array, EngineError>> {
    return ipcRenderer.invoke(IPC.engineCreateDocxFromDoc, docId, entries);
  },
  // Phase 10: edit content
  editTextRun(
    docId: string,
    payload: EditTextRunPayload,
  ): Promise<Result<EngineState, EngineError>> {
    return ipcRenderer.invoke(IPC.engineEditTextRun, docId, payload);
  },
  addTextBox(
    docId: string,
    payload: AddTextBoxPayload,
  ): Promise<Result<EngineState, EngineError>> {
    return ipcRenderer.invoke(IPC.engineAddTextBox, docId, payload);
  },
  editImage(
    docId: string,
    payload: EditImagePayload,
  ): Promise<Result<EngineState, EngineError>> {
    return ipcRenderer.invoke(IPC.engineEditImage, docId, payload);
  },
  // Phase 14 / DEF-135 / DEF-136 — text-box registry move/delete. Boxes are
  // registry-only (drawn once at save time); move updates the rect without
  // masking the content under the old rect, delete removes the box.
  moveTextBox(
    docId: string,
    id: string,
    rect: import("../shared/types").AnnRect,
  ): Promise<Result<EngineState, EngineError>> {
    return ipcRenderer.invoke(IPC.engineMoveTextBox, docId, id, rect);
  },
  deleteTextBox(
    docId: string,
    id: string,
  ): Promise<Result<EngineState, EngineError>> {
    return ipcRenderer.invoke(IPC.engineDeleteTextBox, docId, id);
  },
  // Phase 21 — apply a style patch to a registry text box. Preserve-if-valid
  // per field; a supplied-but-invalid field, an unsupported font or an
  // unknown id returns a typed engine-error.
  updateTextBox(
    docId: string,
    id: string,
    patch: TextBoxStylePatch,
  ): Promise<Result<EngineState, EngineError>> {
    return ipcRenderer.invoke(IPC.engineUpdateTextBox, docId, id, patch);
  },
  // Phase 11: OCR — recognize text + suspects + progress
  ocrRecognize(
    docId: string,
    options: OcrRecognizeOptions,
  ): Promise<Result<EngineState, EngineError>> {
    return ipcRenderer.invoke(IPC.engineOcrRecognize, docId, options);
  },
  ocrSuspects(
    docId: string,
  ): Promise<Result<OcrSuspect[], EngineError>> {
    return ipcRenderer.invoke(IPC.engineOcrSuspects, docId);
  },
  onOcrProgress(cb: (p: OcrProgress) => void): () => void {
    const listener = (_event: unknown, p: OcrProgress): void => cb(p);
    ipcRenderer.on(IPC.engineOcrProgressEvent, listener);
    return () => {
      ipcRenderer.removeListener(IPC.engineOcrProgressEvent, listener);
    };
  },
  // Phase 12: residual page-organize + annotate parity
  replacePages(
    docId: string,
    otherBytes: Uint8Array,
    targetRange: [number, number],
  ): Promise<Result<EngineState, EngineError>> {
    return ipcRenderer.invoke(IPC.engineReplacePages, docId, otherBytes, targetRange);
  },
  renumberPages(
    docId: string,
    labels: PageLabelEntry[],
  ): Promise<Result<EngineState, EngineError>> {
    return ipcRenderer.invoke(IPC.engineRenumberPages, docId, labels);
  },
  cropPages(
    docId: string,
    entries: CropEntry[],
  ): Promise<Result<EngineState, EngineError>> {
    return ipcRenderer.invoke(IPC.engineCropPages, docId, entries);
  },
  addStamp(
    docId: string,
    payload: AddStampPayload,
  ): Promise<Result<EngineState, EngineError>> {
    return ipcRenderer.invoke(IPC.engineAddStamp, docId, payload);
  },
  // Phase 18 / DEF-216: watermarks — apply, list, delete by id
  addWatermark(
    docId: string,
    settings: WatermarkSettings,
  ): Promise<Result<EngineState, EngineError>> {
    return ipcRenderer.invoke(IPC.engineAddWatermark, docId, settings);
  },
  getWatermarks(
    docId: string,
  ): Promise<Result<WatermarkInfo[], EngineError>> {
    return ipcRenderer.invoke(IPC.engineGetWatermarks, docId);
  },
  deleteWatermark(
    docId: string,
    watermarkId: string,
  ): Promise<Result<EngineState, EngineError>> {
    return ipcRenderer.invoke(IPC.engineDeleteWatermark, docId, watermarkId);
  },
  exportFdf(
    docId: string,
  ): Promise<Result<ArrayBuffer, EngineError>> {
    return ipcRenderer.invoke(IPC.engineExportFdf, docId);
  },
  importFdf(
    docId: string,
    fdfBytes: Uint8Array,
  ): Promise<Result<EngineState, EngineError>> {
    return ipcRenderer.invoke(IPC.engineImportFdf, docId, fdfBytes);
  },
};

const api = {
  minimizeWindow(): void {
    void ipcRenderer.invoke(IPC.windowMinimize);
  },
  maximizeWindow(): void {
    void ipcRenderer.invoke(IPC.windowMaximize);
  },
  closeWindow(): void {
    void ipcRenderer.invoke(IPC.windowClose);
  },
  // DEF-142 — main pushes window:closeRequested when the user tries to
  // close the window (caption X, Alt+F4, Window menu Close, app.quit)
  // and the main-side gate forwards the decision to the renderer. The
  // renderer checks its open tabs for unsaved edits and either calls
  // confirmClose(true) immediately (nothing modified) or shows the
  // existing CloseTabPromptDialog and calls confirmClose(true) on Save
  // success / Don't save (or nothing on Cancel).
  onCloseRequested(cb: () => void): () => void {
    const listener = (): void => cb();
    ipcRenderer.on(IPC.windowCloseRequested, listener);
    return () => {
      ipcRenderer.removeListener(IPC.windowCloseRequested, listener);
    };
  },
  // DEF-142 — proceed=true marks the window close-confirmed and re-closes
  // it (the gate skips the second 'close'); proceed=false / no call aborts.
  confirmClose(proceed: boolean): Promise<void> {
    return ipcRenderer.invoke(IPC.windowConfirmClose, proceed);
  },
  // DEF-303 — main's minimize/restore pause signal. Chromium suspends a
  // minimised window's frames regardless of `backgroundThrottling`, so the
  // renderer's PDF render/raster loop pauses on `{ minimized: true }` and
  // resumes on `{ minimized: false }` (the consumer is wired separately).
  onMinimizedChanged(cb: (state: WindowMinimizedChange) => void): () => void {
    const listener = (_event: unknown, state: WindowMinimizedChange): void => cb(state);
    ipcRenderer.on(IPC.windowMinimizedChangedEvent, listener);
    return () => {
      ipcRenderer.removeListener(IPC.windowMinimizedChangedEvent, listener);
    };
  },
  openFileDialog(kind?: OpenFileDialogKind): Promise<string | null> {
    return ipcRenderer.invoke(IPC.openFileDialog, kind);
  },
  // Phase 40 — multi-select sibling of `openFileDialog` ("Merge PDF from
  // scratch"). Forwards the same optional `kind`; resolves to the picked
  // paths (normalized by main) or an empty array on cancel.
  openFilesDialog(kind?: OpenFileDialogKind): Promise<string[]> {
    return ipcRenderer.invoke(IPC.openFilesDialog, kind);
  },
  async loadPdf(path: string): Promise<Result<ArrayBuffer, PdfOpenError>> {
    const result = (await ipcRenderer.invoke(IPC.pdfLoad, path)) as Result<ArrayBuffer, PdfOpenError>;
    if (!result.ok) {
      return result;
    }
    return { ok: true, value: normalizeArrayBuffer(result.value) };
  },
  // Phase 12 — separate FDF load path. FDF files start with %FDF- and would
  // be rejected by the PDF sniff on loadPdf.
  async loadFdf(path: string): Promise<Result<ArrayBuffer, FdfOpenError>> {
    const result = (await ipcRenderer.invoke(IPC.fdfLoad, path)) as Result<ArrayBuffer, FdfOpenError>;
    if (!result.ok) {
      return result;
    }
    return { ok: true, value: normalizeArrayBuffer(result.value) };
  },
  loadSample(name: string): Promise<Result<SampleDocument & { path: `samples/${string}` }, "not-found">> {
    return ipcRenderer.invoke(IPC.samplesLoad, name);
  },
  async readSample(name: string): Promise<Result<ArrayBuffer, "not-found">> {
    const result = (await ipcRenderer.invoke(IPC.samplesRead, name)) as Result<ArrayBuffer, "not-found">;
    if (!result.ok) {
      return result;
    }
    return { ok: true, value: normalizeArrayBuffer(result.value) };
  },
  listSamples(): Promise<SampleDocument[]> {
    return ipcRenderer.invoke(IPC.samplesList);
  },
  loadSettings() {
    return ipcRenderer.invoke(IPC.settingsLoad);
  },
  saveSettings(s: AppSettings): Promise<void> {
    return ipcRenderer.invoke(IPC.settingsSave, s);
  },
  addRecentFile(f: RecentFile): Promise<void> {
    return ipcRenderer.invoke(IPC.settingsAddRecent, f);
  },
  settings: {
    changed(cb: (s: AppSettings) => void): () => void {
      const listener = (_event: unknown, s: AppSettings): void => cb(s);
      ipcRenderer.on(IPC.settingsChangedEvent, listener);
      return () => {
        ipcRenderer.removeListener(IPC.settingsChangedEvent, listener);
      };
    },
    writeError(cb: (message: string) => void): () => void {
      const listener = (_event: unknown, message: string): void => cb(message);
      ipcRenderer.on(IPC.settingsWriteErrorEvent, listener);
      return () => {
        ipcRenderer.removeListener(IPC.settingsWriteErrorEvent, listener);
      };
    },
  },
  // Phase 7: application menu actions pushed from main to renderer
  menu: {
    onAction(cb: (action: string) => void): () => void {
      const listener = (_event: unknown, payload: { action: string }): void => cb(payload.action);
      ipcRenderer.on(IPC.menuActionEvent, listener);
      return () => {
        ipcRenderer.removeListener(IPC.menuActionEvent, listener);
      };
    },
    // DEF-065 — fire-and-forget: toggle named menu items' enabled state.
    setEnabled(state: import("../shared/types").MenuEnabledState): void {
      void ipcRenderer.send(IPC.menuSetEnabled, state);
    },
  },
  // Phase 30: print. listPrinters -> OS printer list; printJob -> composed
  // page images + settings to the hidden-window print pipeline;
  // onPrintRequest -> File > Print / Ctrl+P event from main.
  listPrinters(): Promise<PrinterInfo[]> {
    return ipcRenderer.invoke(IPC.printListPrinters);
  },
  printJob(payload: PrintJobPayload): Promise<PrintJobResult> {
    return ipcRenderer.invoke(IPC.printJob, payload);
  },
  onPrintRequest(cb: () => void): () => void {
    const listener = (): void => cb();
    ipcRenderer.on(IPC.printRequestEvent, listener);
    return () => {
      ipcRenderer.removeListener(IPC.printRequestEvent, listener);
    };
  },
  // Phase 35 - the standalone print window. `open` asks main to create (or
  // focus/refresh) its own top-level OS window with a validated context;
  // `notifyDocumentGone` tells main the document was closed (main forwards it
  // to the print window); `onDocumentGone` is how the print window receives
  // that notification. All three are used by the same preload surface, since
  // the print window is just another renderer.
  printWindow: {
    open(context: PrintWindowContext): Promise<PrintWindowOpenResult> {
      return ipcRenderer.invoke(IPC.printOpenWindow, context);
    },
    notifyDocumentGone(docId: string): Promise<void> {
      return ipcRenderer.invoke(IPC.printNotifyDocumentGone, docId);
    },
    onDocumentGone(cb: (docId: string) => void): () => void {
      const listener = (_event: unknown, docId: string): void => cb(docId);
      ipcRenderer.on(IPC.printDocumentGoneEvent, listener);
      return () => {
        ipcRenderer.removeListener(IPC.printDocumentGoneEvent, listener);
      };
    },
  },
  // Phase 35 — OS file-open request pushed by main: a PDF path from the
  // launch argv, a second launch (single instance), or a resolved drop.
  // The renderer routes it through its existing open flow.
  onOpenPathRequest(cb: (path: string) => void): () => void {
    const listener = (_event: unknown, path: string): void => cb(path);
    ipcRenderer.on(IPC.appOpenPathRequestEvent, listener);
    return () => {
      ipcRenderer.removeListener(IPC.appOpenPathRequestEvent, listener);
    };
  },
  // Phase 35 (DEF-295) — resolve a dropped `File` to its absolute path.
  // `webUtils.getPathForFile` only exists in the isolated preload world,
  // so the renderer reaches it through this bridge.
  webUtils: {
    getPathForFile(file: File): string {
      return webUtils.getPathForFile(file);
    },
  },
  // Phase 45 — main-side clipboard image reader. The renderer cannot see an
  // image FILE copied in Explorer (CF_HDROP / text/uri-list) because it has
  // no `fs`; this bridge asks main, which resolves the native clipboard image
  // or opens the copied file. Never rejects: an absent image resolves
  // `{ ok: false, reason }`.
  clipboard: {
    readImage(): Promise<ClipboardImageResult> {
      return ipcRenderer.invoke(IPC.clipboardReadImage);
    },
  },
  engine: engineApi,
  signatures: {
    list(): Promise<SavedSignaturesResult> {
      return ipcRenderer.invoke(IPC.signaturesList);
    },
    save(source: SignatureSource, label?: string): Promise<SavedSignaturesResult> {
      return ipcRenderer.invoke(IPC.signaturesSave, source, label);
    },
    delete(id: string): Promise<SavedSignaturesResult> {
      return ipcRenderer.invoke(IPC.signaturesDelete, id);
    },
  },
  // Phase 6: About / preferences
  app: {
    getInfo(): Promise<AppInfo> {
      return ipcRenderer.invoke(IPC.appGetInfo);
    },
    openPath(path: string): Promise<void> {
      return ipcRenderer.invoke(IPC.appOpenPath, path);
    },
  },
  // Phase 44 — accounts session vault. The renderer calls `setSession`
  // after a successful sign-in with the user's identity + session JWT;
  // `getStatus` returns status + email only (never the token); `clearSession`
  // signs out. The token never comes back over this bridge.
  accounts: {
    getStatus(): Promise<AccountStatusResult> {
      return ipcRenderer.invoke(IPC.accountsGetStatus);
    },
    // Phase 44 — the non-secret config the renderer needs to construct the
    // Neon auth client. Resolves { authBaseUrl, configured }; never the
    // session token or the Data API URL.
    getConfig(): Promise<AccountsClientConfig> {
      return ipcRenderer.invoke(IPC.accountsGetConfig);
    },
    setSession(payload: SetSessionPayload): Promise<void> {
      return ipcRenderer.invoke(IPC.accountsSetSession, payload);
    },
    clearSession(): Promise<void> {
      return ipcRenderer.invoke(IPC.accountsClearSession);
    },
    // Phase 44 — sync control. `syncNow` triggers a sync and resolves with
    // its SyncReport; `onSyncReport` receives every report the coordinator
    // produces (debounced background runs included), not just the one this
    // renderer triggered.
    syncNow(): Promise<SyncReport> {
      return ipcRenderer.invoke(IPC.accountsSyncNow);
    },
    onSyncReport(cb: (report: SyncReport) => void): () => void {
      const listener = (_event: unknown, report: SyncReport): void => cb(report);
      ipcRenderer.on(IPC.accountsSyncReportEvent, listener);
      return () => {
        ipcRenderer.removeListener(IPC.accountsSyncReportEvent, listener);
      };
    },
  },
  // Phase 6: OTA updates
  update: {
    getStatus(): Promise<UpdateState> {
      return ipcRenderer.invoke(IPC.updateStatus);
    },
    download(): Promise<UpdateState> {
      return ipcRenderer.invoke(IPC.updateDownload);
    },
    install(): Promise<void> {
      return ipcRenderer.invoke(IPC.updateInstall);
    },
    // DEF-079 / DEF-080 — manual re-check (Help -> Check for Update).
    // The backend re-runs autoUpdater.checkForUpdates() with
    // autoDownload=false and resolves with the resulting state; the
    // next state also arrives over onStatusChanged like the launch
    // check. Routed from the `update.check` menu action.
    check(): Promise<UpdateState> {
      return ipcRenderer.invoke(IPC.updateCheck);
    },
    onStatusChanged(cb: (state: UpdateState) => void): () => void {
      const listener = (_event: unknown, state: UpdateState): void => cb(state);
      ipcRenderer.on(IPC.updateStatusChangedEvent, listener);
      return () => {
        ipcRenderer.removeListener(IPC.updateStatusChangedEvent, listener);
      };
    },
  },
};

contextBridge.exposeInMainWorld("tflex", api);