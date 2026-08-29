import { contextBridge, ipcRenderer } from "electron";
import { IPC, type SavedSignaturesResult } from "../shared/ipc";
import type {
  AppInfo,
  AppSettings,
  AddTextBoxPayload,
  CreateAnnotationPayload,
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
  MoveSignaturePayload,
  OpEntry,
  OptimizePreset,
  PlaceSignaturePayload,
  RecentFile,
  SampleDocument,
  SpaceAudit,
  TextPage,
  UpdateState,
} from "../shared/types";
import type { Result } from "../shared/result";
import type { PdfOpenError } from "../shared/types";
import type { SignatureSource } from "../shared/types";
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
  saveAs(docId: string): Promise<Result<string, 'cancelled'>> {
    return ipcRenderer.invoke(IPC.engineSaveAs, docId);
  },
  getState(docId: string): Promise<Result<EngineState, EngineError>> {
    return ipcRenderer.invoke(IPC.engineGetState, docId);
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
  openFileDialog(): Promise<string | null> {
    return ipcRenderer.invoke(IPC.openFileDialog);
  },
  async loadPdf(path: string): Promise<Result<ArrayBuffer, PdfOpenError>> {
    const result = (await ipcRenderer.invoke(IPC.pdfLoad, path)) as Result<ArrayBuffer, PdfOpenError>;
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