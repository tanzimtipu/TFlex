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
  EngineError,
  FillFormFieldPayload,
  FormField,
  SavedSignature,
  SignaturePlacement,
  SignatureSource,
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
}

interface Snapshot {
  pageOrder: number[];
  deleted: boolean[];
  rotations: number[];
  annotations: Annotation[];
  formValues: Map<string, string | string[]>;
  signatures: SignaturePlacement[];
}

function snap(t: StubTab): Snapshot {
  return {
    pageOrder: t.pageOrder.slice(),
    deleted: t.deleted.slice(),
    rotations: t.rotations.slice(),
    annotations: t.annotations.slice(),
    formValues: new Map(t.formValues),
    signatures: t.signatures.slice(),
  };
}

function restore(t: StubTab, s: Snapshot): void {
  t.pageOrder = s.pageOrder.slice();
  t.deleted = s.deleted.slice();
  t.rotations = s.rotations.slice();
  t.annotations = s.annotations.slice();
  t.formValues = new Map(s.formValues);
  t.signatures = s.signatures.slice();
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
    placementId: string,
    rect: SignaturePlacement["rect"],
  ): Promise<Result<EngineState, EngineError>> {
    const t = this.tabs.get(docId);
    if (t === undefined) return err("engine-error", "unknown document");
    const idx = t.signatures.findIndex((p) => p.id === placementId);
    if (idx === -1) return err("not-found", `unknown placement: ${placementId}`);
    pushUndo(t);
    t.signatures[idx] = { ...t.signatures[idx], rect };
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