// Renderer-side types for the page-organization engine. These mirror the
// canonical shapes in `src/shared/types.ts` (owned by the backend IPC
// contract) but use 1-based indices in places the renderer cares about,
// and surface op kinds with friendly direction discriminators rather than
// the engine's `rotate-cw` / `rotate-ccw` strings.

import type { Result } from "../../shared/result";
import type {
  EngineError,
  EngineState as SharedEngineState,
  FillFormFieldPayload,
  FormField,
  OptimizePreset,
  SignaturePlacement,
  SpaceAudit,
} from "../../shared/types";
import type { Annotation, AnnotationPatch } from "../annotations/model";

/** Renderer-facing rotation angle (multiples of 90 degrees). */
export type PageRotation = 0 | 90 | 180 | 270;

/** Where a merged document is inserted relative to the active one. */
export type MergePosition = "before" | "after";

/** A renderer-level engine op. Indexes are 1-based against the engine's
 *  CURRENT order. The engine client translates these into the IPC's
 *  0-based `OpEntry`. */
export type EngineOp =
  | { kind: "rotate"; page: number; dir: "cw" | "ccw" }
  | { kind: "delete"; pages: number[] }
  | { kind: "reorder"; fromIndex: number; toIndex: number };

/** Engine state, exactly as the engine reports it, plus the Phase 3
 *  annotation list and the Phase 4 form-field / signature lists. The
 *  shared IPC contract predates annotations, so the renderer declares
 *  those fields here and the engine client normalizes states that arrive
 *  without them (older preload) to safe defaults (empty arrays).
 *
 *  The renderer keeps its own canUndo/canRedo flags in app state because
 *  the engine does not expose them. */
export interface EngineState extends SharedEngineState {
  annotations: Annotation[];
  /** Phase 4 — every form field on the active doc, with current values.
   *  Empty when the document has no AcroForm. */
  formFields?: FormField[];
  /** Phase 4 — every signature placement on the active doc. Empty when
   *  the user hasn't placed any. */
  signatures?: SignaturePlacement[];
}

/** Result of a successful split/extract — the engine returns fresh
 *  ArrayBuffer bytes for a new document. The renderer hands them to the
 *  standard open-from-bytes flow. */
export type ExtractResult = Result<ArrayBuffer, EngineError>;

/** Engine API consumed by the renderer. Wraps the IPC surface (when
 *  preload exposes it) or the in-memory stub. */
export interface EngineApi {
  /** True when the renderer is talking to the real (main-process) engine. */
  readonly available: boolean;

  /** Load a PDF from disk and register it with the engine under `docId`. */
  loadDocument(
    docId: string,
    path: string,
  ): Promise<Result<ArrayBuffer, "open-error">>;

  /** Load a PDF from raw bytes (no on-disk path). Save is disabled until
   *  saveAs; rotation/delete/undo work normally. Accepts either an
   *  ArrayBuffer (raw PDF bytes) or a Uint8Array view. */
  loadDocumentBytes(
    docId: string,
    bytes: ArrayBuffer | Uint8Array,
  ): Promise<Result<ArrayBuffer, "open-error">>;

  /** Apply a single op (or a batched delete). */
  applyOp(docId: string, op: EngineOp): Promise<Result<EngineState, EngineError>>;

  undo(docId: string): Promise<Result<EngineState, EngineError>>;
  redo(docId: string): Promise<Result<EngineState, EngineError>>;

  /** Merge one or more other PDFs in. The bytes of the merged-in PDFs are
   *  loaded by the engine from `otherPaths`. */
  merge(
    docId: string,
    otherPaths: string[],
    position: MergePosition,
  ): Promise<Result<EngineState, EngineError>>;

  /** Split a contiguous range of pages out into a new document. Returns
   *  the new document's bytes. */
  split(
    docId: string,
    range: [number, number],
  ): Promise<Result<ArrayBuffer, EngineError>>;

  /** Extract an explicit list of pages (visible 1-based) into a new
   *  document. Returns the new document's bytes. */
  extract(docId: string, pages: number[]): Promise<Result<ArrayBuffer, EngineError>>;

  /** Add an annotation. The renderer generates the id and timestamps; the
   *  engine stores it and returns the new state (annotation ops are
   *  undoable, exactly like page ops). */
  createAnnotation(
    docId: string,
    annotation: Annotation,
  ): Promise<Result<EngineState, EngineError>>;

  /** Patch an existing annotation's color and/or text content. */
  editAnnotation(
    docId: string,
    id: string,
    patch: AnnotationPatch,
  ): Promise<Result<EngineState, EngineError>>;

  deleteAnnotation(
    docId: string,
    id: string,
  ): Promise<Result<EngineState, EngineError>>;

  save(docId: string): Promise<Result<string, EngineError>>;
  /** Pops an OS save dialog inside the engine; returns the new path or
   *  an error. `cancelled` is the only user-quiet code (the user dismissed
   *  the OS dialog); any other error indicates a real write failure and
   *  should surface as a toast. The IPC contract today only ships
   *  `cancelled` over the wire (the backend conflates write failures with
   *  user-cancel — see DEF-011 contract gap), but the renderer accepts
   *  the full `EngineError` set so it Just Works once the backend starts
   *  distinguishing write-failure codes. */
  saveAs(docId: string): Promise<Result<string, EngineError>>;

  /** Read the current engine state for a tab. */
  getState(docId: string): Promise<Result<EngineState, EngineError>>;

  // -- Phase 4: forms --

  /** Read every AcroForm field on the active doc. Empty array when the
   *  doc has no AcroForm (the renderer hides the "forms" indicator in
   *  that case). */
  getFormFields(docId: string): Promise<Result<FormField[], EngineError>>;

  /** Update a single field's value. The engine validates against the
   *  field's kind (text string, checkbox "true"/"false", radio option
   *  value, dropdown option value, listbox option values). Returns the
   *  refreshed field list. */
  fillFormField(
    docId: string,
    payload: FillFormFieldPayload,
  ): Promise<Result<FormField[], EngineError>>;

  /** Bake every filled form value into the page content and remove the
   *  AcroForm widgets. The renderer calls this through the toolbar's
   *  Flatten action with a confirm step. */
  flattenForms(docId: string): Promise<Result<EngineState, EngineError>>;

  // -- Phase 4: signatures (placements, not the saved list) --

  /** Place a saved signature on a page at the given rect. The signature
   *  raster is read from the saved-signature service on the host side;
   *  the engine just records the placement + rect on the active doc. */
  placeSignature(
    docId: string,
    placement: SignaturePlacement,
  ): Promise<Result<EngineState, EngineError>>;

  /** Move / resize an existing placement. The renderer calls this on
   *  every pointerup after a drag so the engine stays in sync with what
   *  the user sees. */
  moveSignature(
    docId: string,
    placementId: string,
    rect: SignaturePlacement["rect"],
  ): Promise<Result<EngineState, EngineError>>;

  /** Delete a placement. */
  deleteSignature(
    docId: string,
    placementId: string,
  ): Promise<Result<EngineState, EngineError>>;

  // -- Phase 8: optimize / audit space --

  /** Reduce file size: the engine returns fresh PDF bytes for the
   *  optimized version of the current document state. The operation is
   *  read-only — it does not touch the engine's undo stack, modified
   *  flag, or page order. The renderer hands the returned bytes to the
   *  same open-from-bytes flow that split/extract use, so the user can
   *  inspect the result before saving. */
  optimize(
    docId: string,
    preset: OptimizePreset,
  ): Promise<Result<ArrayBuffer, EngineError>>;

  /** Read the per-element-type size breakdown for the current document
   *  (images / fonts / content streams / metadata / other). Returns the
   *  total bytes plus a per-category breakdown so the renderer can
   *  render a pie or bar chart with stable percentages. The operation is
   *  read-only and safe to call while other ops are queued. */
  auditSpace(docId: string): Promise<Result<SpaceAudit, EngineError>>;
}

/** Translate an engine error code into a user-friendly message. */
export function describeEngineError(code: EngineError, context?: string): string {
  const tail = context === undefined ? "" : `: ${context}`;
  switch (code) {
    case "engine-error":
      return `Engine error${tail}`;
    case "nothing-to-undo":
      return "Nothing to undo.";
    case "nothing-to-redo":
      return "Nothing to redo.";
    case "cancelled":
      return "Cancelled.";
    case "open-error":
      return `Could not open PDF${tail ? ` (${context})` : ""}.`;
    case "out-of-range":
      return "Page is out of range for this document.";
    case "empty-range":
      return "Specify at least one page in the range.";
    case "no-op":
      return "Nothing to do.";
    case "write-error":
      return `Could not write file${tail}`;
    case "not-found":
      return "Item not found.";
  }
}

// ---------------------------------------------------------------------------
// Page-range parsing (1-based, friendly string format)

/** Parse a page-range expression like "10-20" or "1,3,5-7" into an explicit
 *  sorted, deduped array of 1-based page numbers. Returns null when the
 *  input is invalid (empty, NaN, descending span). `totalPages` clamps and
 *  validates the resulting list. */
export function parsePageRange(input: string, totalPages: number): number[] | null {
  if (totalPages <= 0) {
    return null;
  }
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const set = new Set<number>();
  for (const raw of trimmed.split(",")) {
    const part = raw.trim();
    if (part.length === 0) {
      return null;
    }
    if (part.includes("-")) {
      const pieces = part.split("-");
      if (pieces.length !== 2) {
        return null;
      }
      const lo = Number.parseInt(pieces[0].trim(), 10);
      const hi = Number.parseInt(pieces[1].trim(), 10);
      if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
        return null;
      }
      if (lo < 1 || hi > totalPages || lo > hi) {
        return null;
      }
      for (let p = lo; p <= hi; p += 1) {
        set.add(p);
      }
    } else {
      const n = Number.parseInt(part, 10);
      if (!Number.isFinite(n) || n < 1 || n > totalPages) {
        return null;
      }
      set.add(n);
    }
  }
  if (set.size === 0) {
    return null;
  }
  return [...set].sort((a, b) => a - b);
}

/** Build a default page-range string for "all pages". */
export function defaultPageRange(totalPages: number): string {
  if (totalPages <= 0) {
    return "";
  }
  return `1-${totalPages}`;
}

// ---------------------------------------------------------------------------
// Convenience: arguments shaped for the merge / split dialogs

export interface MergeConfirm {
  otherPaths: string[];
  position: MergePosition;
}

export interface SplitConfirm {
  pages: number[];
  mode: "extract" | "split";
}