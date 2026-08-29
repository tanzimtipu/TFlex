import type { Result } from "./result";
import type {
  AppInfo,
  AppSettings,
  LoadSettingsResult,
  PdfOpenError,
  RecentFile,
  SampleDocument,
  SavedSignature,
  SignatureSource,
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
}