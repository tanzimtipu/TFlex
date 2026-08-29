import type { Result } from "./result";
import type {
  AddTextBoxPayload,
  AppInfo,
  AppSettings,
  DocxImageEntry,
  EditImagePayload,
  EditTextRunPayload,
  EngineState,
  ExportPageEntry,
  ExportPagesPayload,
  LoadSettingsResult,
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
}

export interface TFlexApi {
  minimizeWindow(): void;
  maximizeWindow(): void;
  closeWindow(): void;
  openFileDialog(): Promise<string | null>;
  loadPdf(path: string): Promise<Result<ArrayBuffer, PdfOpenError>>;
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