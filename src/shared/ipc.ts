import type { Result } from "./result";
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
  OpenFileDialogKind,
  OcrProgress,
  OcrRecognizeOptions,
  OcrSuspect,
  PageLabelEntry,
  PdfOpenError,
  RecentFile,
  SampleDocument,
  SavedSignature,
  SignatureSource,
  TextPage,
  UpdateState,
} from "./types";

export const IPC = {
  windowMinimize: "window:minimize",
  windowMaximize: "window:maximize",
  windowClose: "window:close",
  openFileDialog: "dialog:openFile",
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
  // Phase 7: application menu actions pushed from main to renderer
  menuActionEvent: "menu:action",
  // Phase 6 — About + preferences surface
  appGetInfo: "app:getInfo",
  appOpenPath: "app:openPath",
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
  // Phase 11 — return the current serialized document bytes so the renderer
  // can refresh its PDF.js proxy after a content-stream mutation that the
  // original load bytes no longer reflect (e.g. OCR's invisible text layer).
  engineGetDocumentBytes: "engine:getDocumentBytes",
 // Phase 3: annotations
  engineCreateAnnotation: "engine:createAnnotation",
  engineEditAnnotation: "engine:editAnnotation",
  engineDeleteAnnotation: "engine:deleteAnnotation",
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
  engineExportPages: "engine:exportPages",
  engineExportText: "engine:exportText",
  engineCreateDocxFromImages: "engine:createDocxFromImages",
  // Phase 10: edit content
  engineEditTextRun: "engine:editTextRun",
  engineAddTextBox: "engine:addTextBox",
  engineEditImage: "engine:editImage",
  // Phase 11: OCR
  engineOcrRecognize: "engine:ocrRecognize",
  engineOcrSuspects: "engine:ocrSuspects",
  engineOcrProgressEvent: "engine:ocrProgress",
  // Phase 12: residual page-organize + annotate parity
  engineReplacePages: "engine:replacePages",
  engineRenumberPages: "engine:renumberPages",
  engineCropPages: "engine:cropPages",
  engineAddStamp: "engine:addStamp",
  engineExportFdf: "engine:exportFdf",
  engineImportFdf: "engine:importFdf",
  signaturesList: "signatures:list",
  signaturesSave: "signatures:save",
  signaturesDelete: "signatures:delete",
  // Phase 6 — OTA updates
  updateStatus: "update:status",
  updateDownload: "update:download",
  updateInstall: "update:install",
  updateStatusChangedEvent: "update:statusChanged",
} as const;

/** Result of `signatures:save` and `signatures:list`. The renderer treats
 *  the signature service as a flat list of saved entries. */
export type SavedSignaturesResult = SavedSignature[];

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
  exportPages?(
    docId: string,
    payload: ExportPagesPayload,
  ): Promise<Result<ExportPageEntry[], import("./types").EngineError>>;
  exportText?(docId: string): Promise<Result<TextPage[], import("./types").EngineError>>;
  createDocxFromImages?(
    entries: DocxImageEntry[],
  ): Promise<Result<Uint8Array, import("./types").EngineError>>;
  /** Phase 10 — edit existing text run: mask the run's rect with a white
   *  rectangle and draw `newText` at the rect's top-left. */
  editTextRun?(
    docId: string,
    payload: EditTextRunPayload,
  ): Promise<Result<EngineState, import("./types").EngineError>>;
  /** Phase 10 — add a new text box with wrapping inside `rect`. */
  addTextBox?(
    docId: string,
    payload: AddTextBoxPayload,
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
}

export interface TFlexApi {
  minimizeWindow(): void;
  maximizeWindow(): void;
  closeWindow(): void;
  openFileDialog(kind?: OpenFileDialogKind): Promise<string | null>;
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
  };
  /** Phase 6 — OTA updates. Backend manages the update lifecycle
   *  through electron-updater; the renderer polls status and can
   *  trigger download/install. Status changes are pushed as events. */
  update?: {
    getStatus(): Promise<UpdateState>;
    download(): Promise<UpdateState>;
    install(): Promise<void>;
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