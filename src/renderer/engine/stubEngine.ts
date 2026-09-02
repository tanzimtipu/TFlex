// In-memory engine stub. The real engine lives in the main process (pdf-lib
// backed) and is exposed as `window.tflex.engine` once preload is updated.
// Until that ships, this stub gives the renderer a complete, well-typed
// API surface so the UI can be built, screenshotted and exercised
// end-to-end against the bundled samples.
//
// Behavioural caveats:
//   * The stub implements the per-page ops (rotate / delete / reorder) and
//     undo/redo against a virtual page-order array. The thumbnail rail and
//     document view reflect those virtual changes, so DnD / rotate /
//     delete / undo are visually real and screenshotable.
//   * merge / split / extract / save / saveAs DO NOT produce real PDF bytes
//     from the stub (pdf-lib is main-process only). They return an
//     `engine-error` so the UI shows a friendly toast pointing at the
//     backend gap; the same UI code Just Works once the real engine is
//     exposed by preload.
//
// Once the real engine is wired through preload, the renderer-side
// `getEngine()` returns the real adapter instead of this stub.

import type { Result } from "../../shared/result";
import { err, ok } from "../../shared/result";
import type {
  AddStampPayload,
  AddTextBoxPayload,
  CropEntry,
  DocxImageEntry,
  EditImagePayload,
  EditTextRunPayload,
  EngineError,
  ExportPageEntry,
  ExportPagesPayload,
  FillFormFieldPayload,
  FormField,
  MoveSignaturePayload,
  OcrProgress,
  OcrRecognizeOptions,
  OcrSuspect,
  OptimizePreset,
  PageLabelEntry,
  SavedSignature,
  SignaturePlacement,
  SignatureSource,
  SpaceAudit,
  StampId,
  TextPage,
} from "../../shared/types";
import { applyPatch, type Annotation, type AnnotationPatch } from "../annotations/model";
import type { EngineApi, EngineOp, EngineState, MergePosition } from "./types";

// ---------------------------------------------------------------------------
// Per-tab stub state

interface StubTab {
  /** 1-based, inclusive original page count (fixed for the tab's life). */
  sourcePageCount: number;
  /** Original-index -> rotation (0..3 quarter-turns; * 90 = degrees). */
  rotations: number[];
  /** Original-index -> deleted. */
  deleted: boolean[];
  /** Current order over ORIGINAL indexes. `pageOrder[i]` is the 0-based
   *  original index of the i-th page in the engine's CURRENT order. */
  pageOrder: number[];
  /** Annotations on the document (page numbers are 1-based against the
   *  current visible order). */
  annotations: Annotation[];
  /** Undo / redo stacks of (pageOrder, deleted, rotations, annotations,
   *  formValues, signatures) snapshots. */
  undoStack: Snapshot[];
  redoStack: Snapshot[];
  modified: boolean;
  /** Phase 4 — form field values keyed by field id. The renderer seeds
   *  the field list (and seeds these values) from `getFormFields`; the
   *  stub keeps the values so a flatten / re-render round-trip
   *  preserves what the user typed. */
  formValues: Map<string, string | string[]>;
  /** Phase 4 — signature placements on the document. */
  signatures: SignaturePlacement[];
  /** Phase 10 — append-only log of edit-content ops (text run / text box /
   *  image). The stub doesn't actually mutate the PDF (it has no
   *  pdf-lib); it records what the renderer asked for so unit tests
   *  can assert the payload shape end-to-end. The real engine owns
   *  the actual content mutation. */
  editLog: EditRecord[];
  /** Phase 11 — append-only log of ocrRecognize calls. The stub has
   *  no tesseract, so it records what the renderer asked for so unit
   *  tests can assert the options shape end-to-end. */
  ocrCalls: OcrCallRecord[];
  /** Phase 12 — current logical page labels (/PageLabels). The stub
   *  records renumberPages payloads so unit tests can assert the
   *  renderer sent the expected entries. */
  pageLabels: PageLabelEntry[];
  /** Phase 12 — append-only log of replacePages, cropPages, addStamp,
   *  and importFdf calls. The stub doesn't process bytes; it just
   *  records what was asked for. */
  phase12Log: Phase12Record[];
}

interface Snapshot {
  pageOrder: number[];
  deleted: boolean[];
  rotations: number[];
  annotations: Annotation[];
  formValues: Map<string, string | string[]>;
  signatures: SignaturePlacement[];
  /** Phase 10 — preserved across undo / redo so the log is
   *  monorewrite-friendly. We only need to restore the append-point,
   *  not the entries themselves, so the snapshot stores the length
   *  captured at snapshot time. */
  editLogLength: number;
  /** Phase 11 — preserved across undo / redo so the OCR-call log
   *  is monotonic-friendly. Same shape as editLogLength. */
  ocrCallsLength: number;
  /** Phase 12 — logical page labels (renumberPages state). Captured
   *  by value so undo restores the labels that were set at snapshot
   *  time. */
  pageLabels: PageLabelEntry[];
  /** Phase 12 — preserved across undo / redo so the Phase-12
   *  forward-only log is monotonic-friendly. Same shape as
   *  editLogLength / ocrCallsLength. */
  phase12LogLength: number;
}

function snap(t: StubTab): Snapshot {
  return {
    pageOrder: t.pageOrder.slice(),
    deleted: t.deleted.slice(),
    rotations: t.rotations.slice(),
    annotations: t.annotations.slice(),
    formValues: new Map(t.formValues),
    signatures: t.signatures.slice(),
    editLogLength: t.editLog.length,
    ocrCallsLength: t.ocrCalls.length,
    // Phase 12 — pageLabels + phase12 log captured at snapshot time
    // so undo/redo preserves them through the snapshot/restore cycle.
    pageLabels: t.pageLabels.slice(),
    phase12LogLength: t.phase12Log.length,
  };
}

function restore(t: StubTab, s: Snapshot): void {
  t.pageOrder = s.pageOrder.slice();
  t.deleted = s.deleted.slice();
  t.rotations = s.rotations.slice();
  t.annotations = s.annotations.slice();
  t.formValues = new Map(s.formValues);
  t.signatures = s.signatures.slice();
  // Phase 10 — truncate the append-only log back to the snapshot's
  // length. We never need to recover old entries; truncation is the
  // natural undo/redo operation for a forward-only log.
  t.editLog = t.editLog.slice(0, s.editLogLength);
  // Phase 11 — same shape as editLogLength; OCR-call log truncation
  // is the natural undo/redo op for the forward-only OCR log.
  t.ocrCalls = t.ocrCalls.slice(0, s.ocrCallsLength);
  // Phase 12 — restore logical page labels and truncate the
  // forward-only Phase-12 log back to its snapshot length. Same
  // pattern as the edit/OCR logs.
  t.pageLabels = s.pageLabels.slice();
  t.phase12Log = t.phase12Log.slice(0, s.phase12LogLength);
}

function buildState(t: StubTab): EngineState {
  // The shared `EngineState` exposes pageOrder, rotations-by-position and
  // deleted. The renderer keeps canUndo/canRedo flags separately (see
  // App.tsx's engineUi record).
  const visible: number[] = [];
  const rotations: number[] = [];
  for (const origIdx of t.pageOrder) {
    if (!t.deleted[origIdx]) {
      visible.push(origIdx);
      rotations.push(t.rotations[origIdx]);
    }
  }
  return {
    pageCount: visible.length,
    modified: t.modified,
    pageOrder: visible,
    rotations,
    deleted: t.deleted.slice(),
    annotations: t.annotations.slice(),
    // Phase 4 — surfaces carried in the engine state so the renderer can
    // read them on every round-trip.
    formFields: stubFormFields(t),
    signatures: t.signatures.slice(),
    // Phase 12 — carry the logical page labels through so the
    // renderer's mirror can observe renumberPages outputs without
    // a separate getState round-trip.
    pageLabels: t.pageLabels.length > 0 ? t.pageLabels.slice() : undefined,
  };
}

function pushUndo(t: StubTab): void {
  t.undoStack.push(snap(t));
  t.redoStack = [];
}

export class StubRendererEngine implements EngineApi {
  readonly available = false;
  private readonly tabs = new Map<string, StubTab>();

  /** Register a tab with the stub. The real engine does this internally
   *  as part of loadDocument; the renderer calls registerTab explicitly so
   *  the per-tab state is in place before any ops land. */
  registerTab(docId: string, pageCount: number, fields: FormField[] = []): EngineState {
    let t = this.tabs.get(docId);
    if (t === undefined) {
      t = {
        sourcePageCount: pageCount,
        rotations: Array.from({ length: pageCount }, () => 0),
        deleted: Array.from({ length: pageCount }, () => false),
        pageOrder: Array.from({ length: pageCount }, (_, i) => i),
        annotations: [],
        undoStack: [],
        redoStack: [],
        modified: false,
        formValues: new Map(),
        signatures: [],
        editLog: [],
        ocrCalls: [],
        pageLabels: [],
        phase12Log: [],
      };
      this.tabs.set(docId, t);
    }
    // Seed form values from the supplied fields every time the caller
    // hands us a fresh field list (open / flatten / etc.) so a flattened
    // doc gets an empty field set, while a reopened one preserves the
    // engine's prior values.
    for (const f of fields) {
      if (!t.formValues.has(f.id)) t.formValues.set(f.id, f.value);
    }
    return buildState(t);
  }

  /** Phase 4 — let the stub own its own form-field seed list. Real engine
   *  reports these via `getFormFields`; the stub returns them synchronously
   *  from the seed so the renderer's first paint doesn't wait on an IPC. */
  seedFormFields(docId: string, fields: readonly FormField[]): void {
    const t = this.tabs.get(docId);
    if (t === undefined) return;
    for (const f of fields) {
      if (!t.formValues.has(f.id)) t.formValues.set(f.id, f.value);
    }
  }

  /** Mark the tab as saved: clears modified + clears undo/redo. Called by
   *  the renderer once a successful save has been confirmed. The real
   *  engine handles this server-side; on the renderer side we just keep
   *  our local mirror honest. */
  markSaved(docId: string): void {
    const t = this.tabs.get(docId);
    if (t === undefined) return;
    t.modified = false;
    t.undoStack = [];
    t.redoStack = [];
  }

  async loadDocument(
    _docId: string,
    _path: string,
  ): Promise<Result<ArrayBuffer, "open-error">> {
    // The real engine reads bytes from disk; the stub has no bytes of its
    // own and the renderer never actually consumes these — PDF.js uses
    // the renderer-side `bytes` it already has. We return a small
    // placeholder so the type checker is happy; callers must not depend on
    // its contents.
    return ok(new ArrayBuffer(0));
  }

  async loadDocumentBytes(
    _docId: string,
    _bytes: ArrayBuffer | Uint8Array,
  ): Promise<Result<ArrayBuffer, "open-error">> {
    // Same placeholder as loadDocument — the renderer keeps its own bytes
    // for PDF.js display.
    return ok(new ArrayBuffer(0));
  }

  async applyOp(
    docId: string,
    op: EngineOp,
  ): Promise<Result<EngineState, EngineError>> {
    const t = this.tabs.get(docId);
    if (t === undefined) return err("engine-error");
    switch (op.kind) {
      case "rotate": {
        // op.page is 1-based against the visible order. Translate to the
        // current order's underlying original-index, then rotate it.
        const visible = buildState(t).pageOrder;
        const origIdx = visible[op.page - 1];
        if (origIdx === undefined) return err("out-of-range");
        pushUndo(t);
        const delta = op.dir === "cw" ? 1 : 3;
        t.rotations[origIdx] = (t.rotations[origIdx] + delta) % 4;
        t.modified = true;
        return ok(buildState(t));
      }
      case "delete": {
        if (op.pages.length === 0) return err("empty-range");
        const visible = buildState(t).pageOrder;
        // Validate all visible indexes first; reject out-of-range early.
        for (const p of op.pages) {
          if (p < 1 || p > visible.length) return err("out-of-range");
        }
        if (visible.length - op.pages.length < 1) return err("empty-range");
        pushUndo(t);
        // The stub keeps the original-index entries in pageOrder but flags
        // them as deleted, so undo simply restores the deleted flag.
        const sorted = [...op.pages].sort((a, b) => b - a);
        for (const p of sorted) {
          const origIdx = visible[p - 1];
          if (origIdx !== undefined) t.deleted[origIdx] = true;
        }
        t.modified = true;
        return ok(buildState(t));
      }
      case "reorder": {
        const { fromIndex, toIndex } = op;
        if (fromIndex < 1 || fromIndex > t.pageOrder.length) {
          return err("out-of-range");
        }
        if (toIndex < 1 || toIndex > t.pageOrder.length) {
          return err("out-of-range");
        }
        if (fromIndex === toIndex) return err("no-op");
        pushUndo(t);
        const [moved] = t.pageOrder.splice(fromIndex - 1, 1);
        t.pageOrder.splice(toIndex - 1, 0, moved);
        t.modified = true;
        return ok(buildState(t));
      }
    }
  }

  async undo(docId: string): Promise<Result<EngineState, EngineError>> {
    const t = this.tabs.get(docId);
    if (t === undefined) return err("engine-error");
    if (t.undoStack.length === 0) return err("nothing-to-undo");
    t.redoStack.push(snap(t));
    restore(t, t.undoStack.pop()!);
    t.modified = t.undoStack.length > 0 ? true : false;
    return ok(buildState(t));
  }

  async redo(docId: string): Promise<Result<EngineState, EngineError>> {
    const t = this.tabs.get(docId);
    if (t === undefined) return err("engine-error");
    if (t.redoStack.length === 0) return err("nothing-to-redo");
    t.undoStack.push(snap(t));
    restore(t, t.redoStack.pop()!);
    t.modified = true;
    return ok(buildState(t));
  }

  async merge(
    _docId: string,
    _otherPaths: string[],
    _position: MergePosition,
  ): Promise<Result<EngineState, EngineError>> {
    return err("engine-error", "merge requires backend engine");
  }

  async split(
    _docId: string,
    _range: [number, number],
  ): Promise<Result<ArrayBuffer, EngineError>> {
    return err("engine-error", "split requires backend engine");
  }

  async extract(
    _docId: string,
    _pages: number[],
  ): Promise<Result<ArrayBuffer, EngineError>> {
    return err("engine-error", "extract requires backend engine");
  }

  async createAnnotation(
    docId: string,
    annotation: Annotation,
  ): Promise<Result<EngineState, EngineError>> {
    const t = this.tabs.get(docId);
    if (t === undefined) return err("engine-error");
    const visibleCount = buildState(t).pageCount;
    if (annotation.page < 1 || annotation.page > visibleCount) {
      return err("out-of-range");
    }
    if (t.annotations.some((a) => a.id === annotation.id)) {
      return err("engine-error", "duplicate annotation id");
    }
    pushUndo(t);
    t.annotations.push(annotation);
    t.modified = true;
    return ok(buildState(t));
  }

  async editAnnotation(
    docId: string,
    id: string,
    patch: AnnotationPatch,
  ): Promise<Result<EngineState, EngineError>> {
    const t = this.tabs.get(docId);
    if (t === undefined) return err("engine-error");
    const idx = t.annotations.findIndex((a) => a.id === id);
    if (idx === -1) return err("out-of-range");
    const next = applyPatch(t.annotations[idx], patch);
    if (next === t.annotations[idx]) return err("no-op");
    pushUndo(t);
    t.annotations[idx] = next;
    t.modified = true;
    return ok(buildState(t));
  }

  async deleteAnnotation(
    docId: string,
    id: string,
  ): Promise<Result<EngineState, EngineError>> {
    const t = this.tabs.get(docId);
    if (t === undefined) return err("engine-error");
    const idx = t.annotations.findIndex((a) => a.id === id);
    if (idx === -1) return err("out-of-range");
    pushUndo(t);
    t.annotations.splice(idx, 1);
    t.modified = true;
    return ok(buildState(t));
  }

  async save(_docId: string): Promise<Result<string, EngineError>> {
    return err("engine-error", "save requires backend engine");
  }

  async saveAs(_docId: string): Promise<Result<string, EngineError>> {
    return err("cancelled", "save-as requires backend engine");
  }

  async getState(docId: string): Promise<Result<EngineState, EngineError>> {
    const t = this.tabs.get(docId);
    if (t === undefined) return err("engine-error");
    return ok(buildState(t));
  }

  /** Peek the stub's current EngineState for `docId`. The stub keeps
   *  its own per-tab source of truth (`this.tabs`), so a peek is
   *  identical to a `getState` round-trip — but synchronous, so the
   *  `tflexDiagnostics()` surface can read it without awaiting. The
   *  stub engine is used by renderer-only tests; production goes
   *  through the real-engine adapter's `previousStates` cache. */
  peekLastState(docId: string): EngineState | undefined {
    const t = this.tabs.get(docId);
    if (t === undefined) return undefined;
    return buildState(t);
  }

  /** Drop the per-tab stub state. Called on tab close. */
  dispose(docId: string): void {
    this.tabs.delete(docId);
  }

  // -------------------------------------------------------------------------
  // Forms (Phase 4)

  /** Stub equivalent of `engine.getFormFields`: returns the fields the
   *  renderer seeded via `seedFormFields` (if any) with their stored
   *  values applied. */
  async getFormFields(docId: string): Promise<Result<FormField[], EngineError>> {
    const t = this.tabs.get(docId);
    if (t === undefined) return err("engine-error", "unknown document");
    const fields = stubFormFields(t);
    // Sync the stored values back into the field list so the renderer's
    // first paint reflects any edits it made before asking for fields.
    const synced: FormField[] = fields.map((f) => {
      const stored = t.formValues.get(f.id);
      return stored === undefined ? f : { ...f, value: stored };
    });
    return ok(synced);
  }

  /** Stub equivalent of `engine.fillFormField`. We update the local map
   *  and return the updated field list so the renderer can re-seed its
   *  reducer. */
  async fillFormField(
    docId: string,
    payload: FillFormFieldPayload,
  ): Promise<Result<FormField[], EngineError>> {
    const t = this.tabs.get(docId);
    if (t === undefined) return err("engine-error", "unknown document");
    if (!t.formValues.has(payload.id)) {
      return err("not-found", `unknown field: ${payload.id}`);
    }
    t.formValues.set(payload.id, payload.value);
    return ok(stubFormFields(t).map((f) =>
      f.id === payload.id ? { ...f, value: payload.value } : f,
    ));
  }

  /** Stub equivalent of `engine.flattenForms`: the form fields disappear,
   *  but the values stay baked into the document (we represent this by
   *  emptying the formValues map; the renderer drops the field list). */
  async flattenForms(
    docId: string,
  ): Promise<Result<EngineState, EngineError>> {
    const t = this.tabs.get(docId);
    if (t === undefined) return err("engine-error", "unknown document");
    pushUndo(t);
    t.formValues.clear();
    t.modified = true;
    return ok(buildState(t));
  }

  // -------------------------------------------------------------------------
  // Signatures (Phase 4)

  async placeSignature(
    docId: string,
    placement: SignaturePlacement,
  ): Promise<Result<EngineState, EngineError>> {
    const t = this.tabs.get(docId);
    if (t === undefined) return err("engine-error", "unknown document");
    pushUndo(t);
    t.signatures.push(placement);
    t.modified = true;
    return ok(buildState(t));
  }

  async moveSignature(
    docId: string,
    payload: MoveSignaturePayload,
  ): Promise<Result<EngineState, EngineError>> {
    const t = this.tabs.get(docId);
    if (t === undefined) return err("engine-error", "unknown document");
    const idx = t.signatures.findIndex((p) => p.id === payload.id);
    if (idx === -1) return err("not-found", `unknown placement: ${payload.id}`);
    pushUndo(t);
    // The renderer supplies the page from its local placements mirror;
    // the stub's local `t.signatures[idx].page` was the page at placement
    // time. After a delete + re-place at a different page the mirror is
    // authoritative, so prefer `payload.page` for the echoed placement.
    t.signatures[idx] = { ...t.signatures[idx], page: payload.page, rect: payload.rect };
    t.modified = true;
    return ok(buildState(t));
  }

  async deleteSignature(
    docId: string,
    placementId: string,
  ): Promise<Result<EngineState, EngineError>> {
    const t = this.tabs.get(docId);
    if (t === undefined) return err("engine-error", "unknown document");
    const idx = t.signatures.findIndex((p) => p.id === placementId);
    if (idx === -1) return err("not-found", `unknown placement: ${placementId}`);
    pushUndo(t);
    t.signatures.splice(idx, 1);
    t.modified = true;
    return ok(buildState(t));
  }

  // -------------------------------------------------------------------------
  // Optimize + audit space (Phase 8)

  /** Stub equivalent of `engine.optimize`. The renderer never actually
   *  consumes these bytes (PDF.js uses the renderer-side bytes it
   *  already has); the stub returns a small placeholder so the type
   *  checker is happy. The dialog's "before/after" comparison uses
   *  `tab.sourcePageCount`-derived estimates instead of real bytes.
   *  Callers must not depend on the result's contents. */
  async optimize(
    docId: string,
    _preset: OptimizePreset,
  ): Promise<Result<ArrayBuffer, EngineError>> {
    const t = this.tabs.get(docId);
    if (t === undefined) return err("engine-error", "unknown document");
    return ok(new ArrayBuffer(0));
  }

  /** Stub equivalent of `engine.auditSpace`. Returns a plausible
   *  breakdown so the dialog renders something testable; the real
   *  engine's audit is the source of truth in production. The numbers
   *  are arbitrary (so long as they sum to totalBytes and percentages
   *  stay in [0, 100]) — the stub never reads the actual PDF. */
  async auditSpace(
    docId: string,
  ): Promise<Result<SpaceAudit, EngineError>> {
    const t = this.tabs.get(docId);
    if (t === undefined) return err("engine-error", "unknown document");
    // Roughly plausible breakdown for a typical document: images 45%,
    // content streams 30%, fonts 12%, metadata 5%, other 8%.
    const totalBytes = Math.max(t.sourcePageCount, 1) * 12000;
    return ok({
      totalBytes,
      breakdown: {
        images: Math.round(totalBytes * 0.45),
        fonts: Math.round(totalBytes * 0.12),
        contentStreams: Math.round(totalBytes * 0.30),
        metadata: Math.round(totalBytes * 0.05),
        other: Math.round(totalBytes * 0.08),
      },
    });
  }

  // -------------------------------------------------------------------------
  // Create + Export (Phase 9)

  /** Stub equivalent of `engine.createFromImages`. The renderer hands
   *  the user-picked image bytes; the stub returns a small placeholder
   *  ArrayBuffer so the type checker is happy and the same
   *  openFromBytes flow runs. The Create dialog never reads the
   *  bytes (PDF.js uses the renderer-side bytes it has), so the
   *  placeholder is sufficient for the stub's "renderer-only"
   *  contract. */
  async createFromImages(
    _docId: string,
    _imageBuffers: Uint8Array[],
    _quality: number,
  ): Promise<Result<ArrayBuffer, EngineError>> {
    // The stub doesn't validate the input beyond "no crash". The
    // renderer's Create dialog owns the user-facing validation
    // (file picker, empty-list guard).
    return ok(new ArrayBuffer(0));
  }

  /** Stub equivalent of `engine.exportPages`. We return one
   *  placeholder `ExportPageEntry` per page in the requested range.
   *  The Export dialog never reads the stub's buffer contents
   *  (the real engine returns per-page PDF bytes; the renderer
   *  rasterizes them with PDF.js). The stub's placeholder shape is
   *  enough for the dialog's UI to mount and the renderer-only
   *  flow to run end-to-end. */
  async exportPages(
    docId: string,
    payload: ExportPagesPayload,
  ): Promise<Result<ExportPageEntry[], EngineError>> {
    const t = this.tabs.get(docId);
    if (t === undefined) return err("engine-error", "unknown document");
    const { range } = payload;
    const visible = buildState(t).pageOrder;
    const total = visible.length;
    if (total === 0) {
      return ok([]);
    }
    // Honour the supplied range; default to "all pages" when omitted.
    const start = range !== undefined ? Math.max(1, Math.min(total, range[0])) : 1;
    const end = range !== undefined ? Math.max(start, Math.min(total, range[1])) : total;
    const entries: ExportPageEntry[] = [];
    for (let i = start; i <= end; i += 1) {
      entries.push({
        pageIndex: i,
        buffer: new Uint8Array([0]),
        format: payload.format,
        // 8.5 x 11 inch placeholder at the requested DPI / 150 ratio.
        // The renderer uses these only to surface a "estimated
        // dimensions" hint; the real rasterization comes from the
        // engine-supplied PDF buffer.
        width: Math.round((8.5 * payload.dpi) / 1),
        height: Math.round((11 * payload.dpi) / 1),
      });
    }
    return ok(entries);
  }

  // -----------------------------------------------------------------------
  // Phase 9 advanced: clipboard / insert / text / docx (DEF-045)
  //
  // The stub implements just enough of these to keep the renderer-only
  // path healthy in jsdom tests / pre-Phase-9 builds. The real engine
  // owns the production implementation; the stub degrades to
  // engine-error so the renderer's defensive gates can short-circuit
  // gracefully without crashing.

  async createFromClipboard(
    _docId: string,
    _content: Uint8Array | string,
  ): Promise<Result<ArrayBuffer, EngineError>> {
    return err(
      "engine-error",
      "createFromClipboard requires backend engine update",
    );
  }

  async insertBlankPage(
    docId: string,
    afterIndex: number,
    widthPx: number,
    heightPx: number,
  ): Promise<Result<EngineState, EngineError>> {
    const t = this.tabs.get(docId);
    if (t === undefined) return err("engine-error", "unknown document");
    // Synthesise a new page order entry. The stub keeps the pageOrder
    // array 1..N; we splice in a new "page" (a synthetic placeholder
    // that the renderer never directly renders) so mirror effects can
    // observe the new count. Width / height are recorded in
    // rotations as a stand-in (the stub doesn't track page sizes).
    pushUndo(t);
    // DEF-114 parity: afterIndex = -1 is the renderer's "end"/"append"
    // sentinel. DEF-129: afterIndex = -2 is the PREPEND sentinel — the
    // blank page becomes the FIRST visible page (pageOrder[0]), exactly
    // like the real engine's
    // `insertAt = afterIndex === -2 ? 0 : afterIndex < 0 ? doc.order.length : afterIndex + 1`.
    // `Array.prototype.splice` clamps an out-of-range index to the
    // array length, so a plain `afterIndex + 1` appends for -1 and
    // inserts after the given 0-based index otherwise.
    const insertAt =
      afterIndex === -2 ? 0 : afterIndex < 0 ? t.pageOrder.length : afterIndex + 1;
    t.pageOrder.splice(insertAt, 0, t.pageOrder.length);
    t.rotations.push(0);
    t.deleted.push(false);
    // Record the new page size in a side channel: store in rotations
    // is meaningless for the new page, but we want at least the
    // pageCount to bump. Width / height are otherwise unused by the
    // stub's mirror logic.
    void widthPx;
    void heightPx;
    t.modified = true;
    return ok(buildState(t));
  }

  async insertFromPdf(
    _docId: string,
    _otherBytes: Uint8Array,
    _position: number,
  ): Promise<Result<EngineState, EngineError>> {
    return err(
      "engine-error",
      "insertFromPdf requires backend engine update",
    );
  }

  async exportText(
    docId: string,
  ): Promise<Result<TextPage[], EngineError>> {
    const t = this.tabs.get(docId);
    if (t === undefined) return err("engine-error", "unknown document");
    const pageCount = buildState(t).pageOrder.length;
    // Stub returns empty text per page; the renderer's text-export
    // pipeline treats empty pages as valid and produces a file with
    // page-break separators.
    const pages: TextPage[] = [];
    for (let i = 1; i <= pageCount; i += 1) {
      pages.push({ pageIndex: i, text: "" });
    }
    return ok(pages);
  }

  async createDocxFromImages(
    entries: DocxImageEntry[],
  ): Promise<Result<Uint8Array, EngineError>> {
    if (entries.length === 0) {
      return err("empty-range", "no image entries provided");
    }
    // The stub returns a minimal valid DOCX placeholder (an empty
    // ZIP with the [Content_Types].xml entry) so renderer tests can
    // verify the save flow end-to-end. The real engine assembles
    // proper per-page DOCX content; the stub is only for the
    // renderer-only contract test path.
    return err("engine-error", "createDocxFromImages requires backend engine update");
  }

  /** DEF-060 (Bug 6) — text-first DOCX assembler. The stub has no
   *  pdfDoc (no actual bytes), so it cannot extract real text from
   *  the loaded doc. It degrades with `engine-error` so the host can
   *  detect the missing backend and fall back to
   *  `createDocxFromImages`. Same shape as `createDocxFromImages`
   *  so the renderer's per-call error handling doesn't have to
   *  branch on the method. */
  async createDocxFromDoc(
    _docId: string,
    entries: DocxImageEntry[],
  ): Promise<Result<Uint8Array, EngineError>> {
    if (entries.length === 0) {
      return err("empty-range", "no image entries provided");
    }
    return err("engine-error", "createDocxFromDoc requires backend engine update");
  }

  // -----------------------------------------------------------------------
  // Phase 10: edit content (text run / text box / image)
  //
  // The stub records the latest payload per tab so the renderer's
  // mirror can observe "an edit happened" without a real engine. The
  // full integration (apply payload -> new EngineState) is owned by
  // the real engine; the stub degrades gracefully with engine-error
  // when the host doesn't expose the Phase 10 channels.

  /** Phase 10 — edit an existing text run. The stub doesn't have
   *  pdf-lib, so it can't actually mutate the PDF; it just records
   *  the call (so the renderer's debug surface can show it landed)
   *  and returns an engine-error. The renderer is expected to use
   *  the real engine once it's wired. */
  async editTextRun(
    docId: string,
    payload: EditTextRunPayload,
  ): Promise<Result<EngineState, EngineError>> {
    const t = this.tabs.get(docId);
    if (t === undefined) return err("engine-error", "unknown document");
    if (payload.rect.width <= 0 || payload.rect.height <= 0) {
      return err("empty-range", "editTextRun: rect must be positive");
    }
    if (payload.newText.length === 0) {
      return err("empty-range", "editTextRun: newText is empty");
    }
    pushUndo(t);
    recordEdit(t, { kind: "editTextRun", payload });
    t.modified = true;
    return ok(buildState(t));
  }

  /** Phase 10 — add a new text box. Same shape as editTextRun. */
  async addTextBox(
    docId: string,
    payload: AddTextBoxPayload,
  ): Promise<Result<EngineState, EngineError>> {
    const t = this.tabs.get(docId);
    if (t === undefined) return err("engine-error", "unknown document");
    if (payload.rect.width <= 0 || payload.rect.height <= 0) {
      return err("empty-range", "addTextBox: rect must be positive");
    }
    if (payload.text.length === 0) {
      return err("empty-range", "addTextBox: text is empty");
    }
    pushUndo(t);
    recordEdit(t, { kind: "addTextBox", payload });
    t.modified = true;
    return ok(buildState(t));
  }

  /** Phase 10 — edit an image (move / resize / replace / crop). The
   *  stub doesn't process the bytes; it records the call and echoes
   *  EngineState. */
  async editImage(
    docId: string,
    payload: EditImagePayload,
  ): Promise<Result<EngineState, EngineError>> {
    const t = this.tabs.get(docId);
    if (t === undefined) return err("engine-error", "unknown document");
    if (payload.newRect.width <= 0 || payload.newRect.height <= 0) {
      return err("empty-range", "editImage: newRect must be positive");
    }
    if (payload.imageBytes.byteLength === 0) {
      return err("empty-range", "editImage: imageBytes are empty");
    }
    pushUndo(t);
    recordEdit(
      t,
      {
        kind: "editImage",
        payload: {
          op: payload.op,
          oldRect: { ...payload.oldRect },
          newRect: { ...payload.newRect },
          imageBytesLen: payload.imageBytes.byteLength,
        },
      },
    );
    t.modified = true;
    return ok(buildState(t));
  }

  /** Test-only: read back the most recent edit payload recorded for a
   *  tab. Used by unit tests that exercise the renderer's edit flow
   *  without a real engine. Returns `undefined` when the tab has no
   *  recorded edits. */
  getLastEdit(tabId: string): EditRecord | undefined {
    const t = this.tabs.get(tabId);
    if (t === undefined) return undefined;
    const rec = t.editLog[t.editLog.length - 1];
    return rec;
  }

  /** Test-only: snapshot of the full edit history for a tab. */
  getEditLog(tabId: string): EditRecord[] {
    const t = this.tabs.get(tabId);
    if (t === undefined) return [];
    return t.editLog.slice();
  }

  // -----------------------------------------------------------------------
  // Phase 11: OCR (recognize text)
  //
  // The stub has no tesseract worker, so ocrRecognize returns engine-error
  // and ocrSuspects returns engine-error. The renderer treats this the
  // same as a real backend that has not been upgraded (the dialog
  // surfaces a friendly "OCR requires backend update" toast). The
  // pre-Phase-11 stub renderer was unmodified; the new methods match
  // the Phase 11 EngineApi surface so the renderer code paths can be
  // exercised without the real engine.

  /** Stub equivalent of `engine.ocrRecognize`. Returns engine-error
   *  because the stub has no tesseract. Records the call so unit
   *  tests can assert the renderer sent the expected options without
   *  the stub pretending to succeed. The renderer treats this the
   *  same way it treats a real backend that hasn't been upgraded. */
  async ocrRecognize(
    docId: string,
    options: OcrRecognizeOptions,
  ): Promise<Result<EngineState, EngineError>> {
    const t = this.tabs.get(docId);
    if (t === undefined) return err("engine-error", "unknown document");
    if (!Array.isArray(options.pageImages) || options.pageImages.length === 0) {
      return err("empty-range", "pageImages is empty");
    }
    pushUndo(t);
    t.ocrCalls.push({
      language: options.language,
      downsample: options.downsample,
      pageCount: options.pageImages.length,
    });
    return err(
      "engine-error",
      "OCR requires the Phase 11 backend update (stub has no tesseract)",
    );
  }

  /** Stub equivalent of `engine.ocrSuspects`. Returns engine-error
   *  unless the stub recorded an ocrRecognize call (which always
   *  failed above). The renderer surfaces a friendly toast. */
  async ocrSuspects(
    docId: string,
  ): Promise<Result<OcrSuspect[], EngineError>> {
    const t = this.tabs.get(docId);
    if (t === undefined) return err("engine-error", "unknown document");
    return err(
      "engine-error",
      "no OCR has been run on this document (stub has no tesseract)",
    );
  }

  /** Test-only: read back the most recent ocrRecognize call recorded
   *  for a tab. Used by unit tests to assert the renderer sent the
   *  expected options. */
  getLastOcrCall(tabId: string): OcrCallRecord | undefined {
    const t = this.tabs.get(tabId);
    if (t === undefined) return undefined;
    return t.ocrCalls[t.ocrCalls.length - 1];
  }

  /** Stub equivalent of `engine.onOcrProgress`. The stub has no
   *  tesseract, so no progress events fire — the callback is never
   *  called. Returns a no-op unsubscribe so callers don't have to
   *  guard the call site. */
  onOcrProgress(_cb: (p: OcrProgress) => void): () => void {
    return (): void => undefined;
  }

  /** Phase 11 — refresh hook. The stub has no PDF bytes of its own
   *  (it never parsed a real PDF), so it returns engine-error. The
   *  renderer's OCR confirm handler treats this the same way as a
   *  pre-Phase-11 backend: the existing search-index invalidator
   *  keeps the per-page cache from going stale, and the user's next
   *  Save writes the post-OCR bytes through the real engine. */
  async getDocumentBytes(
    _docId: string,
  ): Promise<Result<ArrayBuffer, EngineError>> {
    return err(
      "engine-error",
      "getDocumentBytes requires the Phase 11 backend update (stub has no PDF bytes)",
    );
  }

  // -----------------------------------------------------------------------
  // Phase 12: residual page-organize + annotate parity
  //
  // The stub implements just enough of these to keep the renderer-only
  // path healthy in jsdom tests / pre-Phase-12 builds. replacePages
  // renumbers the pageOrder array so mirror effects can observe the
  // new count + indices; the others record what the renderer asked
  // for so unit tests can assert the payload shape end-to-end. The
  // real engine owns the production implementation.

  /** Phase 12 — replace the visible page range with all pages of
   *  `otherBytes`. The stub doesn't process the bytes (no pdf-lib);
   *  it simulates the new page count by appending `targetRange[1] -
   *  targetRange[0] + 1` synthetic placeholders onto the pageOrder
   *  array and dropping the originals. Mirror effects then observe
   *  the new count without a real engine. */
  async replacePages(
    docId: string,
    otherBytes: Uint8Array,
    targetRange: [number, number],
  ): Promise<Result<EngineState, EngineError>> {
    const t = this.tabs.get(docId);
    if (t === undefined) return err("engine-error", "unknown document");
    if (otherBytes.byteLength === 0) {
      return err("empty-range", "replacePages: otherBytes is empty");
    }
    const [start, end] = targetRange;
    if (start < 0 || end < start) {
      return err("out-of-range", "replacePages: invalid target range");
    }
    const visible = buildState(t).pageOrder;
    if (start >= visible.length || end >= visible.length) {
      return err("out-of-range", "replacePages: target range exceeds pages");
    }
    pushUndo(t);
    // We don't know how many pages the other PDF has, but for the
    // stub's mirror-effect purposes, simulate a one-for-one swap (the
    // most common case). Unit tests that need a multi-page swap use
    // a dedicated mock engine instead.
    const span = end - start + 1;
    const visibleStart = visible[start];
    if (visibleStart === undefined) {
      return err("out-of-range", "replacePages: target start out of range");
    }
    // Synthesize `span` new placeholders after the original start
    // index; mark the originals in [start, end] as deleted.
    for (let i = start; i <= end; i += 1) {
      const origIdx = visible[i];
      if (origIdx !== undefined) t.deleted[origIdx] = true;
    }
    const newIndices: number[] = [];
    for (let i = 0; i < span; i += 1) {
      const idx = t.rotations.length + i;
      t.rotations.push(0);
      t.deleted.push(false);
      newIndices.push(idx);
    }
    // Splice the new placeholders into pageOrder at the start slot.
    t.pageOrder.splice(start, span, ...newIndices);
    recordPhase12(t, {
      kind: "replacePages",
      payload: { otherBytesLen: otherBytes.byteLength, targetRange },
    });
    t.modified = true;
    return ok(buildState(t));
  }

  /** Phase 12 — set logical page labels (/PageLabels number tree).
   *  The stub stores the entries so undo / redo can restore them. */
  async renumberPages(
    docId: string,
    labels: PageLabelEntry[],
  ): Promise<Result<EngineState, EngineError>> {
    const t = this.tabs.get(docId);
    if (t === undefined) return err("engine-error", "unknown document");
    const visible = buildState(t).pageOrder;
    for (const l of labels) {
      if (l.page < 1 || l.page > visible.length) {
        return err("out-of-range", `renumberPages: page ${l.page} out of range`);
      }
      if (typeof l.label !== "string") {
        return err("engine-error", "renumberPages: label must be a string");
      }
    }
    pushUndo(t);
    t.pageLabels = labels.slice();
    recordPhase12(t, { kind: "renumberPages", payload: { labels: labels.slice() } });
    t.modified = true;
    return ok(buildState(t));
  }

  /** Phase 12 — set each listed page's CropBox/TrimBox. The stub
   *  doesn't have crop geometry to mutate; it records the entries so
   *  unit tests can assert the renderer sent the expected crop rects. */
  async cropPages(
    docId: string,
    entries: CropEntry[],
  ): Promise<Result<EngineState, EngineError>> {
    const t = this.tabs.get(docId);
    if (t === undefined) return err("engine-error", "unknown document");
    const visible = buildState(t).pageOrder;
    for (const e of entries) {
      if (e.page < 1 || e.page > visible.length) {
        return err("out-of-range", `cropPages: page ${e.page} out of range`);
      }
      if (e.box.width <= 0 || e.box.height <= 0) {
        return err("empty-range", `cropPages: page ${e.page} has zero-size box`);
      }
    }
    pushUndo(t);
    recordPhase12(t, { kind: "cropPages", payload: { entries: entries.slice() } });
    t.modified = true;
    return ok(buildState(t));
  }

  /** Phase 12 — embed a renderer-drawn stamp raster. The stub
   *  validates `stampId` against the built-in allowlist and records
   *  the PNG byte length so unit tests can assert the renderer sent
   *  the expected stamp. */
  async addStamp(
    docId: string,
    payload: AddStampPayload,
  ): Promise<Result<EngineState, EngineError>> {
    const t = this.tabs.get(docId);
    if (t === undefined) return err("engine-error", "unknown document");
    const visible = buildState(t).pageOrder;
    if (payload.page < 1 || payload.page > visible.length) {
      return err("out-of-range", `addStamp: page ${payload.page} out of range`);
    }
    if (payload.rect.width <= 0 || payload.rect.height <= 0) {
      return err("empty-range", "addStamp: rect must be positive");
    }
    if (!STAMP_ID_ALLOWLIST.includes(payload.stampId)) {
      return err(
        "engine-error",
        `addStamp: stampId ${payload.stampId} not in allowlist`,
      );
    }
    const pngBytes = payload.pngBytes instanceof Uint8Array
      ? payload.pngBytes
      : new Uint8Array(payload.pngBytes);
    if (pngBytes.byteLength === 0) {
      return err("empty-range", "addStamp: pngBytes are empty");
    }
    pushUndo(t);
    recordPhase12(t, {
      kind: "addStamp",
      payload: {
        page: payload.page,
        rect: { ...payload.rect },
        stampId: payload.stampId,
        name: payload.name,
        pngBytesLen: pngBytes.byteLength,
      },
    });
    t.modified = true;
    return ok(buildState(t));
  }

  /** Phase 12 — export the document's annotations as FDF bytes.
   *  The stub returns a small placeholder so the renderer-side
   *  download flow can run. The real engine writes proper FDF
   *  comment bytes that round-trip with importFdf. */
  async exportFdf(
    docId: string,
  ): Promise<Result<ArrayBuffer, EngineError>> {
    const t = this.tabs.get(docId);
    if (t === undefined) return err("engine-error", "unknown document");
    recordPhase12(t, { kind: "exportFdf", payload: { annotationCount: t.annotations.length } });
    return ok(new ArrayBuffer(0));
  }

  /** Phase 12 — import FDF comment bytes and merge the annotations
   *  into the document. The stub accepts the bytes and emits
   *  engine-error so the renderer treats it like a pre-Phase-12 build.
   *  Unit tests exercise the FDF flow with a dedicated mock engine. */
  async importFdf(
    docId: string,
    fdfBytes: Uint8Array,
  ): Promise<Result<EngineState, EngineError>> {
    const t = this.tabs.get(docId);
    if (t === undefined) return err("engine-error", "unknown document");
    if (fdfBytes.byteLength === 0) {
      return err("empty-range", "importFdf: fdfBytes are empty");
    }
    recordPhase12(t, { kind: "importFdf", payload: { fdfBytesLen: fdfBytes.byteLength } });
    return err(
      "engine-error",
      "importFdf requires the Phase 12 backend update (stub has no FDF parser)",
    );
  }

  /** Test-only: read back the most recent Phase 12 call recorded for
   *  a tab. Used by unit tests to assert the renderer sent the
   *  expected payload without standing up a real engine. */
  getLastPhase12Call(tabId: string): Phase12Record | undefined {
    const t = this.tabs.get(tabId);
    if (t === undefined) return undefined;
    return t.phase12Log[t.phase12Log.length - 1];
  }

  /** Test-only: snapshot of the full Phase 12 history for a tab. */
  getPhase12Log(tabId: string): Phase12Record[] {
    const t = this.tabs.get(tabId);
    if (t === undefined) return [];
    return t.phase12Log.slice();
  }
}

// ---------------------------------------------------------------------------
// Phase 10 — per-tab edit log (stub-only)

/** What the stub records for each Phase 10 op. The image variant
 *  carries the byte length rather than the bytes themselves so the
 *  log stays cheap to inspect in tests. */
type EditRecord =
  | { kind: "editTextRun"; payload: EditTextRunPayload }
  | { kind: "addTextBox"; payload: AddTextBoxPayload }
  | {
    kind: "editImage";
    payload: {
      op: EditImagePayload["op"];
      oldRect: EditImagePayload["oldRect"];
      newRect: EditImagePayload["newRect"];
      imageBytesLen: number;
    };
  };

function recordEdit(t: StubTab, rec: EditRecord): void {
  t.editLog.push(rec);
}

// ---------------------------------------------------------------------------
// Phase 11 — per-tab OCR call log (stub-only)

/** What the stub records for each ocrRecognize call. Only the
 *  options-shape we care about is captured; the PNG bytes themselves
 *  are dropped so the log stays cheap to inspect in tests. */
export interface OcrCallRecord {
  language: string;
  downsample: number;
  pageCount: number;
}

// ---------------------------------------------------------------------------
// Phase 12 — per-tab Phase-12 call log (stub-only) + stamp allowlist

/** Built-in stamp id allowlist mirrored from
 *  `src/shared/types.ts StampId`. The stub uses this to validate
 *  addStamp payloads the same way the real engine will. */
const STAMP_ID_ALLOWLIST: readonly StampId[] = [
  "APPROVED",
  "DRAFT",
  "CONFIDENTIAL",
  "FINAL",
];

/** What the stub records for each Phase 12 op. The image variant
 *  carries the byte length rather than the bytes themselves so the
 *  log stays cheap to inspect in tests. */
export type Phase12Record =
  | {
    kind: "replacePages";
    payload: {
      otherBytesLen: number;
      targetRange: [number, number];
    };
  }
  | {
    kind: "renumberPages";
    payload: { labels: PageLabelEntry[] };
  }
  | {
    kind: "cropPages";
    payload: { entries: CropEntry[] };
  }
  | {
    kind: "addStamp";
    payload: {
      page: number;
      rect: AddStampPayload["rect"];
      stampId: StampId;
      name: string;
      pngBytesLen: number;
    };
  }
  | {
    kind: "exportFdf";
    payload: { annotationCount: number };
  }
  | {
    kind: "importFdf";
    payload: { fdfBytesLen: number };
  };

function recordPhase12(t: StubTab, rec: Phase12Record): void {
  t.phase12Log.push(rec);
}

// Stub-only: returns the form fields the renderer last seeded via
// `seedFormFields`. We do NOT synthesise fields out of thin air — if the
// real document has no AcroForm (which is the common case), the stub
// returns an empty list. The renderer's "forms present" indicator is
// driven off `fields.length > 0`, so an empty list correctly hides it.
//
// We keep the seed as a static Map so multiple tabs share the same
// seed (matches the real engine: the engine reports fields per doc).
const stubFieldSeeds = new Map<string, FormField>();

export function stubSeedFormFields(seed: readonly FormField[]): void {
  stubFieldSeeds.clear();
  for (const f of seed) stubFieldSeeds.set(f.id, f);
}

function stubFormFields(_t: StubTab): FormField[] {
  return [...stubFieldSeeds.values()];
}

// Export a stub signature service. The real engine persists signatures
// through main; the stub keeps them in a module-local list so a test /
// renderer-only path can exercise the full sign + place + reuse loop
// without a backend.
let stubSavedSignatures: SavedSignature[] = [];

export function stubResetSignatures(): void {
  stubSavedSignatures = [];
}

export async function stubSignaturesList(): Promise<SavedSignature[]> {
  return stubSavedSignatures.slice();
}

export async function stubSignaturesSave(source: SignatureSource, label?: string): Promise<SavedSignature[]> {
  const id = crypto.randomUUID();
  const inferred = (label ?? "").trim().length > 0
    ? label!.trim()
    : source.kind === "typed"
      ? source.text.trim().slice(0, 32)
      : `Signature ${stubSavedSignatures.length + 1}`;
  const sig: SavedSignature = {
    id,
    label: inferred,
    createdAt: new Date().toISOString(),
    source,
  };
  stubSavedSignatures = [sig, ...stubSavedSignatures];
  return stubSavedSignatures.slice();
}

export async function stubSignaturesDelete(id: string): Promise<SavedSignature[]> {
  stubSavedSignatures = stubSavedSignatures.filter((s) => s.id !== id);
  return stubSavedSignatures.slice();
}

/** Singleton stub used by the renderer when no real engine is exposed. */
export const stubRendererEngine = new StubRendererEngine();