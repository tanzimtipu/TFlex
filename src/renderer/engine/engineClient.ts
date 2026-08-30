// Renderer-side adapter for the page-organization engine. The real engine
// is exposed by the preload script as `window.tflex.engine`. When that
// object is present, this adapter proxies every renderer op through IPC;
// otherwise we fall back to the in-memory stub so the renderer can still
// build and unit-test in environments where the preload is not wired.
//
// Both surfaces implement the same RendererEngine API so the rest of the
// renderer is identical either way.

import type { Result } from "../../shared/result";
import { err } from "../../shared/result";
import type {
  AddStampPayload,
  AddTextBoxPayload,
  CropEntry,
  DocxImageEntry,
  EditImagePayload,
  EditTextRunPayload,
  EngineError,
  EngineState as SharedEngineState,
  ExportPageEntry,
  ExportPagesPayload,
  FillFormFieldPayload,
  FormField,
  OcrProgress,
  OcrRecognizeOptions,
  OcrSuspect,
  OpEntry,
  OptimizePreset,
  PageLabelEntry,
  SignaturePlacement,
  SpaceAudit,
  TextPage,
} from "../../shared/types";
import type { Annotation, AnnotationPatch, PagePoint, PageRect } from "../annotations/model";
import { toArrayBuffer } from "../utils/toArrayBuffer";
import { stubRendererEngine } from "./stubEngine";
import type {
  EngineApi,
  EngineOp,
  EngineState,
  MergeConfirm,
  SplitConfirm,
} from "./types";

// The renderer's in-memory Annotation model uses the kind tag "textbox" (one
// word) to match every other annotation kind (highlight, underline, ink,
// rect, ellipse, arrow, note). The shared IPC contract — see
// `AnnKind` and `CreateAnnotationPayload.kind` in src/shared/types.ts — uses
// "text-box" (hyphenated) as the canonical wire tag. We translate at the IPC
// boundary so the renderer's model stays uniform while the payload the engine
// receives matches the documented wire shape exactly. The backend's own
// tolerance for "textbox" becomes a redundant safety net rather than a
// requirement (DEF-015).

/** Build an IPC-shaped annotation payload from the renderer's Annotation.
 *  Today only the kind tag is translated; every other field already matches
 *  the wire shape (renderer rects/rect/points/from/to/at/text/content/width
 *  all line up with CreateAnnotationPayload). The returned object is cast
 *  to Annotation because TFlexApiEngine.createAnnotation declares that
 *  parameter type — the underlying IPC contract is the wider
 *  CreateAnnotationPayload, which the renderer doesn't import. */
function annotationToWire(a: Annotation): Annotation {
  if (a.kind === "textbox") {
    return { ...a, kind: "text-box" } as unknown as Annotation;
  }
  return a;
}

/** Translate a wire-shaped annotation back into the renderer's in-memory
 *  shape. The IPC contract uses the canonical AnnKind (text-box, etc.) and
 *  stores geometry under the backend's `rects` / `points` keys rather than the
 *  renderer's `rect` / `from`+`to` / `at` keys. We translate at the boundary so
 *  the rest of the renderer can keep its own per-kind shape and never see a
 *  field it doesn't know about.
 *
 *  Without these fallbacks, an annotation that survives an IPC round-trip
 *  (save-as / reopen / undo-redo) is missing the field the renderer's render
 *  code expects — e.g. an `arrow` annotation has `points: [{x,y}, {x,y}]` on
 *  the wire but the renderer reads `from` and `to`. A previous version of this
 *  file only translated the `text-box` -> `textbox` kind tag, which caused a
 *  hard `Cannot read properties of undefined (reading 'x')` in `arrowHead`
 *  the moment the renderer re-rendered the page after the first arrow was
 *  created — taking the entire React tree down with it (DEF-017). */
function annotationFromWire(a: Annotation): Annotation {
  const kind = (a as { kind: string }).kind;
  let next: Annotation = a;
  if (kind === "text-box") {
    next = { ...a, kind: "textbox" } as Annotation;
  }
  // Arrow: the renderer uses `from`/`to` page points. The wire shape carries
  // the two endpoints in `points[0]`/`points[1]`. Backfill from points when
  // the per-arrow fields are missing so SvgAnnotation and annotationBounds
  // never see `undefined.x`.
  if (next.kind === "arrow") {
    const candidates = next as Annotation & {
      from?: PagePoint | undefined;
      to?: PagePoint | undefined;
      points?: PagePoint[] | undefined;
    };
    const p0 = candidates.points?.[0];
    const p1 = candidates.points?.[1];
    if ((candidates.from === undefined || candidates.to === undefined) &&
        p0 !== undefined && p1 !== undefined) {
      next = { ...next, from: { x: p0.x, y: p0.y }, to: { x: p1.x, y: p1.y } };
    }
  }
  // Shape (rect/ellipse) and textbox: the renderer carries the geometry in
  // `rect`; the wire shape carries `rects[0]`. Backfill so every code path
  // that reads `ann.rect` works after a round-trip.
  if (
    next.kind === "rect" ||
    next.kind === "ellipse" ||
    next.kind === "textbox" ||
    next.kind === "callout"
  ) {
    const candidates = next as Annotation & {
      rect?: PageRect | undefined;
      rects?: PageRect[] | undefined;
    };
    if (candidates.rect === undefined && candidates.rects?.[0] !== undefined) {
      next = { ...next, rect: candidates.rects[0] };
    }
  }
  // Note: the renderer carries the icon anchor in `at`; the wire shape stores
  // it in `rects[0]` (a 24×24 footprint). Backfill `at` to the rect's
  // top-left so DomAnnotation's existing fallback isn't doing the work.
  if (next.kind === "note") {
    const candidates = next as Annotation & {
      at?: PagePoint | undefined;
      rects?: PageRect[] | undefined;
    };
    if (candidates.at === undefined && candidates.rects?.[0] !== undefined) {
      const r0 = candidates.rects[0];
      next = { ...next, at: { x: r0.x, y: r0.y } };
    }
  }
  // Callout: the renderer carries both `rect` (text-box) and `at` (arrow
  // anchor). The wire shape carries `rects[0]` for the box. Backfill
  // `at` to the rect's top-left so DomAnnotation's fallback isn't doing
  // the work for an old serialized callout. The real engine emits
  // `at` directly so this is purely defensive.
  if (next.kind === "callout") {
    const candidates = next as Annotation & {
      at?: PagePoint | undefined;
      rects?: PageRect[] | undefined;
    };
    if (candidates.at === undefined && candidates.rects?.[0] !== undefined) {
      const r0 = candidates.rects[0];
      next = { ...next, at: { x: r0.x, y: r0.y } };
    }
  }
  return next;
}

/** Shape matching the `engine` field on `TFlexApi` in src/shared/ipc.ts.
 *  Annotation methods are optional: they were added to the preload
 *  contract for Phase 3, so a renderer built before the backend update
 *  must degrade (annotation ops fail with a friendly engine-error)
 *  instead of crashing. */
export interface TFlexApiEngine {
  loadDocument(
    docId: string,
    path: string,
  ): Promise<Result<ArrayBuffer, "open-error">>;
  loadDocumentBytes(
    docId: string,
    bytes: ArrayBuffer | Uint8Array,
  ): Promise<Result<ArrayBuffer, "open-error">>;
  applyOp(docId: string, op: OpEntry): Promise<Result<SharedEngineState, EngineError>>;
  undo(docId: string): Promise<Result<SharedEngineState, EngineError>>;
  redo(docId: string): Promise<Result<SharedEngineState, EngineError>>;
  merge(
    docId: string,
    otherPaths: string[],
    position: "before" | "after",
  ): Promise<Result<SharedEngineState, EngineError>>;
  split(docId: string, range: [number, number]): Promise<Result<ArrayBuffer, EngineError>>;
  extract(docId: string, pages: number[]): Promise<Result<ArrayBuffer, EngineError>>;
  createAnnotation?(
    docId: string,
    annotation: Annotation,
  ): Promise<Result<SharedEngineState, EngineError>>;
  editAnnotation?(
    docId: string,
    id: string,
    patch: AnnotationPatch,
  ): Promise<Result<SharedEngineState, EngineError>>;
  deleteAnnotation?(
    docId: string,
    id: string,
  ): Promise<Result<SharedEngineState, EngineError>>;
  save(docId: string): Promise<Result<string, EngineError>>;
  /** Pops an OS save dialog inside the engine; returns the new path or
   *  an error. `cancelled` is the only user-quiet code (the user dismissed
   *  the OS dialog); any other error indicates a real write failure and
   *  should surface as a toast. The contract today only ships `cancelled`
   *  over IPC, but we accept the full `EngineError` set so the renderer
   *  does not need to change when the backend starts distinguishing
   *  write-failure codes (DEF-011 follow-up). */
  saveAs(docId: string): Promise<Result<string, EngineError>>;
  getState(docId: string): Promise<Result<SharedEngineState, EngineError>>;
  // Phase 4 — optional; pre-Phase-4 backends won't have these. When the
  // method is missing the adapter degrades with a friendly engine-error
  // (same pattern as the Phase 3 annotation methods).
  getFormFields?(
    docId: string,
  ): Promise<Result<FormField[], EngineError>>;
  fillFormField?(
    docId: string,
    payload: FillFormFieldPayload,
  ): Promise<Result<FormField[], EngineError>>;
  flattenForms?(docId: string): Promise<Result<SharedEngineState, EngineError>>;
  placeSignature?(
    docId: string,
    placement: SignaturePlacement,
  ): Promise<Result<SharedEngineState, EngineError>>;
  moveSignature?(
    docId: string,
    placementId: string,
    rect: SignaturePlacement["rect"],
  ): Promise<Result<SharedEngineState, EngineError>>;
  deleteSignature?(
    docId: string,
    placementId: string,
  ): Promise<Result<SharedEngineState, EngineError>>;
  // Phase 8 — optimize + audit space. Optional: a pre-Phase-8 backend
  // doesn't expose them; the adapter degrades with a friendly
  // engine-error instead of crashing so the renderer keeps rendering
  // (same defensive pattern as the Phase 3 / Phase 4 method gating).
  optimize?(
    docId: string,
    preset: OptimizePreset,
  ): Promise<Result<ArrayBuffer, EngineError>>;
  auditSpace?(docId: string): Promise<Result<SpaceAudit, EngineError>>;
  // Phase 9 — create from images + export pages. Same optional +
  // degrade-with-engine-error pattern as Phase 8: pre-Phase-9 builds
  // surface a friendly error and the renderer keeps rendering.
  // `quality` is the JPEG re-encode fraction (0..1) — matches the
  // canonical AppSettings.createImageQuality wire shape so the value
  // survives the backend's preserve-if-valid pipeline.
  createFromImages?(
    docId: string,
    imageBuffers: Uint8Array[],
    quality: number,
  ): Promise<Result<ArrayBuffer, EngineError>>;
  /** Phase 9 — create from clipboard (text or image bytes). */
  createFromClipboard?(
    docId: string,
    content: Uint8Array | string,
  ): Promise<Result<ArrayBuffer, EngineError>>;
  /** Phase 9 — insert a blank page at the given 0-based visible
   *  position. Width / height are in PDF points. */
  insertBlankPage?(
    docId: string,
    afterIndex: number,
    widthPx: number,
    heightPx: number,
  ): Promise<Result<SharedEngineState, EngineError>>;
  /** Phase 9 — insert every page of another PDF at the given
   *  0-based position. */
  insertFromPdf?(
    docId: string,
    otherBytes: Uint8Array,
    position: number,
  ): Promise<Result<SharedEngineState, EngineError>>;
  exportPages?(
    docId: string,
    payload: ExportPagesPayload,
  ): Promise<Result<ExportPageEntry[], EngineError>>;
  /** Phase 9 — per-page text extraction. The renderer formats the
   *  result as plain text or RTF. */
  exportText?(
    docId: string,
  ): Promise<Result<TextPage[], EngineError>>;
  /** Phase 9 — assemble a .docx from rasterised page images. */
  createDocxFromImages?(
    entries: DocxImageEntry[],
  ): Promise<Result<Uint8Array, EngineError>>;
  /** Phase 10 — edit an existing text run by masking its rect and redrawing
   *  `newText` at the rect's top-left baseline. Optional so a pre-Phase-10
   *  backend degrades with a friendly engine-error. */
  editTextRun?(
    docId: string,
    payload: EditTextRunPayload,
  ): Promise<Result<SharedEngineState, EngineError>>;
  /** Phase 10 — add a new text box with wrapping. Same optional pattern as
   *  editTextRun. */
  addTextBox?(
    docId: string,
    payload: AddTextBoxPayload,
  ): Promise<Result<SharedEngineState, EngineError>>;
/** Phase 10 — edit an image (move / resize / replace / crop). The engine
   *  masks the original placement and draws the (renderer-supplied)
   *  transformed bytes at the new rect. Optional so a pre-Phase-10
   *  backend degrades with a friendly engine-error. */
  editImage?(
    docId: string,
    payload: EditImagePayload,
  ): Promise<Result<SharedEngineState, EngineError>>;
  /** Phase 11 — run OCR over renderer-rasterised page images and
   *  write an invisible text layer onto each matching page so the
   *  scanned document becomes searchable. Optional so a pre-Phase-11
   *  backend degrades with a friendly engine-error. */
  ocrRecognize?(
    docId: string,
    options: OcrRecognizeOptions,
  ): Promise<Result<SharedEngineState, EngineError>>;
  /** Phase 11 — return the low-confidence words from the most recent
   *  `ocrRecognize` on this doc. Optional so a pre-Phase-11 backend
   *  degrades with a friendly engine-error. */
  ocrSuspects?(
    docId: string,
  ): Promise<Result<OcrSuspect[], EngineError>>;
  /** Phase 11 — subscribe to per-page OCR progress pushed from main
   *  while `ocrRecognize` runs. Returns an unsubscribe function.
   *  Optional because pre-Phase-11 builds don't expose the channel. */
  onOcrProgress?(cb: (p: OcrProgress) => void): () => void;
  /** Phase 11 — return the engine's current serialized PDF bytes for
   *  `docId`. The renderer uses this to refresh its pdf.js proxy
   *  after a content-stream mutation (OCR's invisible text layer)
   *  that the original load bytes do not reflect. The hook is
   *  read-only — it does not flip `modified` or clear undo. Goes
   *  through the per-doc queue so the returned bytes reflect every
   *  queued mutation issued before the call. Optional so a pre-Phase-11
   *  backend degrades with a friendly engine-error; the renderer
   *  treats the absence as "no refresh possible" and lets the
   *  existing search invalidator handle the case. */
  getDocumentBytes?(
    docId: string,
  ): Promise<Result<ArrayBuffer, EngineError>>;
  /** Phase 12 — replace the visible page range `targetRange` (0-based
   *  inclusive [start, end]) with all pages of `otherBytes`. Surviving
   *  pages keep their annotations; the other PDF's annotations and
   *  outline (bookmarks) are carried across via a page-ref remap.
   *  Links are annotations and ride the per-page annotation carry.
   *  Optional so a pre-Phase-12 backend degrades with a friendly
   *  engine-error; the dialog surfaces a friendly toast. */
  replacePages?(
    docId: string,
    otherBytes: Uint8Array,
    targetRange: [number, number],
  ): Promise<Result<SharedEngineState, EngineError>>;
  /** Phase 12 — set logical page labels (/PageLabels number tree) from
   *  `{page, label}` entries. `page` is 1-based visible. Replaces any
   *  labels set by a previous call. Optional so a pre-Phase-12
   *  backend degrades with a friendly engine-error. */
  renumberPages?(
    docId: string,
    labels: PageLabelEntry[],
  ): Promise<Result<SharedEngineState, EngineError>>;
  /** Phase 12 — set each listed page's CropBox AND TrimBox to `box`
   *  (top-left origin, PDF points; the engine converts to bottom-left).
   *  Optional so a pre-Phase-12 backend degrades with a friendly
   *  engine-error. */
  cropPages?(
    docId: string,
    entries: CropEntry[],
  ): Promise<Result<SharedEngineState, EngineError>>;
  /** Phase 12 — embed a renderer-drawn stamp raster (`pngBytes`) at
   *  `rect` on `page`. `stampId` is validated against the built-in
   *  allowlist. Optional so a pre-Phase-12 backend degrades with a
   *  friendly engine-error. */
  addStamp?(
    docId: string,
    payload: AddStampPayload,
  ): Promise<Result<SharedEngineState, EngineError>>;
  /** Phase 12 — export the document's annotations as FDF (Forms Data
   *  Format) comment bytes. Round-trips with `importFdf`. Optional so
   *  a pre-Phase-12 backend degrades with a friendly engine-error. */
  exportFdf?(docId: string): Promise<Result<ArrayBuffer, EngineError>>;
  /** Phase 12 — import FDF comment bytes and merge the annotations
   *  into the document's annotation state. Optional so a pre-Phase-12
   *  backend degrades with a friendly engine-error. */
  importFdf?(
    docId: string,
    fdfBytes: Uint8Array,
  ): Promise<Result<SharedEngineState, EngineError>>;
}

/** Normalize a wire EngineState into the renderer's EngineState: the Phase 3
 *  `annotations` field is guaranteed present (empty list when the preload
 *  predates annotations), and any annotation that came through with the
 *  wire-shape "text-box" kind is translated back to the renderer's
 *  "textbox" tag so the renderer's AnnotationKind union matches.
 *
 *  Wire-shape field-name note (DEF-022): the engine's `buildState` emits
 *  signature placements under the field name `placedSignatures`; the
 *  renderer surface (App.tsx mirror effect, DocumentView, stub engine)
 *  reads `signatures`. Without the rename below, every IPC round-trip
 *  for a signature op would return `{ placedSignatures: [...] }`, the
 *  renderer mirror would see `signatures === undefined`, and the
 *  placement list would be clobbered to `[]`. Accept both names —
 *  `signatures` wins when both are present, since the renderer's own
 *  StubRendererEngine already uses `signatures` and a future backend
 *  rename to `signatures` should be a one-line drop here.
 *
 *  Phase 4 form-fields wire-shape (DEF-025): the engine's `buildState`
 *  is being updated to include `formFields` in every state echo, so
 *  the renderer can mirror the engine's authoritative field list
 *  without a separate `getFormFields` round-trip. While the backend
 *  ships that change, however, an op (rotate / delete / reorder /
 *  fillFormField / placeSignature / etc.) returns an EngineState that
 *  omits the `formFields` key entirely — `Array.isArray(undefined)`
 *  is false, and the previous version of this function defaulted to
 *  `[]`. That `[]` then flowed into App.tsx's mirror effect at line
 *  ~1150 (the `engineUi -> openTabs.forms` mirror), which saw
 *  `fromEngine === []` (defined, just empty), ran
 *  `replaceFields(tab.forms, [])`, and clobbered every field value the
 *  user had typed. Same shape of regression as DEF-022 for signatures.
 *
 *  The fix is intentionally a one-line change of the default branch:
 *  when the wire omits `formFields`, leave the field `undefined` on
 *  the renderer state instead of substituting `[]`. App.tsx's mirror
 *  effect already short-circuits on `fromEngine === undefined` (it
 *  treats that as "the engine didn't carry fields this round-trip,
 *  don't touch my locally-edited values"). Empty arrays are a
 *  legitimate wire value meaning "this doc has no AcroForm" and are
 *  consumed verbatim, so a post-flatten / form-free document correctly
 *  empties the local list once the backend starts emitting the key.
 *  The `_pre` parameter is accepted (and ignored on the
 *  fields-carrying path) so the calling code in `RealEngineAdapter`
 *  has a uniform signature; it exists for future expansion (e.g.
 *  carrying `annotations` forward across an op whose wire shape
 *  omits the key) without forcing a second refactor pass. */
function normalizeState(
  s: SharedEngineState,
  _prev: EngineState | undefined,
): EngineState {
  const maybe = s as SharedEngineState & {
    annotations?: Annotation[];
    formFields?: FormField[];
    signatures?: SignaturePlacement[];
    placedSignatures?: SignaturePlacement[];
  };
  const incoming = Array.isArray(maybe.annotations) ? maybe.annotations : [];
  const incomingSigs = Array.isArray(maybe.signatures)
    ? maybe.signatures
    : Array.isArray(maybe.placedSignatures)
      ? maybe.placedSignatures
      : [];
  // formFields: consume the wire value when it's an array (incl. the
  // empty array, which is a legitimate "doc has no AcroForm" signal).
  // When the wire omits the key entirely, leave the renderer state's
  // field undefined so App.tsx's mirror effect short-circuits on
  // `fromEngine === undefined` rather than clobbering the user's
  // locally-edited fields (DEF-025).
  const incomingFields: FormField[] | undefined = Array.isArray(maybe.formFields)
    ? maybe.formFields
    : undefined;
  return {
    ...maybe,
    annotations: incoming.map(annotationFromWire),
    formFields: incomingFields,
    signatures: incomingSigs,
  };
}

function missingAnnotations(): Result<never, EngineError> {
  return err("engine-error", "annotations require a backend engine update");
}

function missingPhase4(): Result<never, EngineError> {
  return err("engine-error", "forms/signatures require a backend engine update");
}

function missingPhase8(): Result<never, EngineError> {
  return err("engine-error", "optimize requires a backend engine update");
}

function missingPhase9(): Result<never, EngineError> {
  return err("engine-error", "create/export requires a backend engine update");
}

function missingPhase9Extended(): Result<never, EngineError> {
  return err(
    "engine-error",
    "advanced create/export (clipboard / insert / text / docx) requires the Phase 9 backend update",
  );
}

function missingPhase10(): Result<never, EngineError> {
  return err(
    "engine-error",
    "edit-content (text run / text box / image) requires the Phase 10 backend update",
  );
}

function missingPhase11(): Result<never, EngineError> {
  return err(
    "engine-error",
    "OCR requires the Phase 11 backend update",
  );
}

function missingPhase12(): Result<never, EngineError> {
  return err(
    "engine-error",
    "replacePages / renumberPages / cropPages / addStamp / exportFdf / importFdf require the Phase 12 backend update",
  );
}

/** Map a renderer-level `EngineOp` into the IPC-shaped `OpEntry`. The
 *  IPC op index convention is 0-based against the engine's current order,
 *  matching the rest of the renderer. */
function toOpEntry(op: EngineOp): OpEntry {
  switch (op.kind) {
    case "rotate":
      return {
        kind: op.dir === "cw" ? "rotate-cw" : "rotate-ccw",
        page: op.page - 1, // 1-based visible -> 0-based for engine
      };
    case "delete":
      // The IPC op shape `OpEntry` is a single page. The renderer batches
      // multi-page deletes into sequential engine calls.
      return { kind: "delete", page: op.pages[0] - 1 };
    case "reorder":
      return { kind: "reorder", page: op.fromIndex - 1, param: op.toIndex - 1 };
  }
}

class RealEngineAdapter implements EngineApi {
  readonly available = true;
  private readonly inner: TFlexApiEngine;
  constructor(inner: TFlexApiEngine) {
    this.inner = inner;
  }

  async loadDocument(
    docId: string,
    path: string,
  ): Promise<Result<ArrayBuffer, "open-error">> {
    return this.inner.loadDocument(docId, path);
  }

  async loadDocumentBytes(
    docId: string,
    bytes: ArrayBuffer | Uint8Array,
  ): Promise<Result<ArrayBuffer, "open-error">> {
    // The preload IPC channel takes a Uint8Array view (structured-cloned).
    // Normalise so the call site can hand us either shape.
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    return this.inner.loadDocumentBytes(docId, view);
  }

  async applyOp(
    docId: string,
    op: EngineOp,
  ): Promise<Result<EngineState, EngineError>> {
    if (op.kind === "delete" && op.pages.length > 1) {
      // Multi-page delete: apply sequentially so each deletion's undo
      // stack entry is preserved (per-page granularity).
      let last: Result<SharedEngineState, EngineError> | null = null;
      for (const p of op.pages) {
        const r = await this.inner.applyOp(docId, { kind: "delete", page: p - 1 });
        if (!r.ok) return r;
        last = r;
      }
      const final = last ?? (await this.inner.getState(docId));
      return final.ok ? { ok: true, value: normalizeState(final.value, undefined) } : final;
    }
    const r = await this.inner.applyOp(docId, toOpEntry(op));
    return r.ok ? { ok: true, value: normalizeState(r.value, undefined) } : r;
  }

  async undo(docId: string): Promise<Result<EngineState, EngineError>> {
    const r = await this.inner.undo(docId);
    return r.ok ? { ok: true, value: normalizeState(r.value, undefined) } : r;
  }

  async redo(docId: string): Promise<Result<EngineState, EngineError>> {
    const r = await this.inner.redo(docId);
    return r.ok ? { ok: true, value: normalizeState(r.value, undefined) } : r;
  }

  async merge(
    docId: string,
    otherPaths: string[],
    position: "before" | "after",
  ): Promise<Result<EngineState, EngineError>> {
    const r = await this.inner.merge(docId, otherPaths, position);
    return r.ok ? { ok: true, value: normalizeState(r.value, undefined) } : r;
  }

  async split(
    docId: string,
    range: [number, number],
  ): Promise<Result<ArrayBuffer, EngineError>> {
    // The engine IPC contract uses 0-based indices into the current order
    // (same convention as applyOp). The renderer-facing API is 1-based, so
    // translate here.
    const [start1, end1] = range;
    return this.inner.split(docId, [start1 - 1, end1 - 1]);
  }

  async extract(
    docId: string,
    pages: number[],
  ): Promise<Result<ArrayBuffer, EngineError>> {
    return this.inner.extract(docId, pages);
  }

  save(docId: string): Promise<Result<string, EngineError>> {
    return this.inner.save(docId);
  }

  async saveAs(docId: string): Promise<Result<string, EngineError>> {
    return this.inner.saveAs(docId);
  }

  async createAnnotation(
    docId: string,
    annotation: Annotation,
  ): Promise<Result<EngineState, EngineError>> {
    if (this.inner.createAnnotation === undefined) return missingAnnotations();
    // Translate the renderer's "textbox" tag to the wire-shape "text-box"
    // tag before handing the annotation to the engine. Every other kind
    // passes through unchanged. See annotationToWire above.
    const r = await this.inner.createAnnotation(
      docId,
      annotationToWire(annotation),
    );
    return r.ok ? { ok: true, value: normalizeState(r.value, undefined) } : r;
  }

  async editAnnotation(
    docId: string,
    id: string,
    patch: AnnotationPatch,
  ): Promise<Result<EngineState, EngineError>> {
    if (this.inner.editAnnotation === undefined) return missingAnnotations();
    const r = await this.inner.editAnnotation(docId, id, patch);
    return r.ok ? { ok: true, value: normalizeState(r.value, undefined) } : r;
  }

  async deleteAnnotation(
    docId: string,
    id: string,
  ): Promise<Result<EngineState, EngineError>> {
    if (this.inner.deleteAnnotation === undefined) return missingAnnotations();
    const r = await this.inner.deleteAnnotation(docId, id);
    return r.ok ? { ok: true, value: normalizeState(r.value, undefined) } : r;
  }

  async getState(docId: string): Promise<Result<EngineState, EngineError>> {
    const r = await this.inner.getState(docId);
    return r.ok ? { ok: true, value: normalizeState(r.value, undefined) } : r;
  }

  // -- Phase 4: forms --

  async getFormFields(
    docId: string,
  ): Promise<Result<FormField[], EngineError>> {
    if (this.inner.getFormFields === undefined) return missingPhase4();
    const r = await this.inner.getFormFields(docId);
    return r.ok ? { ok: true, value: r.value } : r;
  }

  async fillFormField(
    docId: string,
    payload: FillFormFieldPayload,
  ): Promise<Result<FormField[], EngineError>> {
    if (this.inner.fillFormField === undefined) return missingPhase4();
    const r = await this.inner.fillFormField(docId, payload);
    if (!r.ok) return r;
    // The real backend returns EngineState (not the typed FormField[]
    // the renderer contract advertises). Re-fetch the canonical field
    // list so the renderer gets the post-fill values without a
    // shape-mismatch. Without this, `r.value.formFields` would be
    // undefined and the renderer's `replaceFields(existing, value)`
    // would blow up on the first `.map`.
    return this.getFormFields(docId);
  }

  async flattenForms(
    docId: string,
  ): Promise<Result<EngineState, EngineError>> {
    if (this.inner.flattenForms === undefined) return missingPhase4();
    const r = await this.inner.flattenForms(docId);
    return r.ok ? { ok: true, value: normalizeState(r.value, undefined) } : r;
  }

  // -- Phase 4: signatures --

  async placeSignature(
    docId: string,
    placement: SignaturePlacement,
  ): Promise<Result<EngineState, EngineError>> {
    if (this.inner.placeSignature === undefined) return missingPhase4();
    const r = await this.inner.placeSignature(docId, placement);
    return r.ok ? { ok: true, value: normalizeState(r.value, undefined) } : r;
  }

  async moveSignature(
    docId: string,
    placementId: string,
    rect: SignaturePlacement["rect"],
  ): Promise<Result<EngineState, EngineError>> {
    if (this.inner.moveSignature === undefined) return missingPhase4();
    const r = await this.inner.moveSignature(docId, placementId, rect);
    return r.ok ? { ok: true, value: normalizeState(r.value, undefined) } : r;
  }

  async deleteSignature(
    docId: string,
    placementId: string,
  ): Promise<Result<EngineState, EngineError>> {
    if (this.inner.deleteSignature === undefined) return missingPhase4();
    const r = await this.inner.deleteSignature(docId, placementId);
    return r.ok ? { ok: true, value: normalizeState(r.value, undefined) } : r;
  }

  // -- Phase 8: optimize / audit space --

  async optimize(
    docId: string,
    preset: OptimizePreset,
  ): Promise<Result<ArrayBuffer, EngineError>> {
    if (this.inner.optimize === undefined) return missingPhase8();
    return this.inner.optimize(docId, preset);
  }

  async auditSpace(
    docId: string,
  ): Promise<Result<SpaceAudit, EngineError>> {
    if (this.inner.auditSpace === undefined) return missingPhase8();
    return this.inner.auditSpace(docId);
  }

  // -- Phase 9: create + export --

  async createFromImages(
    docId: string,
    imageBuffers: Uint8Array[],
    quality: number,
  ): Promise<Result<ArrayBuffer, EngineError>> {
    if (this.inner.createFromImages === undefined) return missingPhase9();
    return this.inner.createFromImages(docId, imageBuffers, quality);
  }

  async exportPages(
    docId: string,
    payload: ExportPagesPayload,
  ): Promise<Result<ExportPageEntry[], EngineError>> {
    if (this.inner.exportPages === undefined) return missingPhase9();
    return this.inner.exportPages(docId, payload);
  }

  async exportText(
    docId: string,
  ): Promise<Result<TextPage[], EngineError>> {
    if (this.inner.exportText === undefined) return missingPhase9Extended();
    return this.inner.exportText(docId);
  }

  async createDocxFromImages(
    entries: DocxImageEntry[],
  ): Promise<Result<Uint8Array, EngineError>> {
    if (this.inner.createDocxFromImages === undefined) return missingPhase9Extended();
    return this.inner.createDocxFromImages(entries);
  }

  async createFromClipboard(
    docId: string,
    content: Uint8Array | string,
  ): Promise<Result<ArrayBuffer, EngineError>> {
    if (this.inner.createFromClipboard === undefined) return missingPhase9Extended();
    return this.inner.createFromClipboard(docId, content);
  }

  async insertBlankPage(
    docId: string,
    afterIndex: number,
    widthPx: number,
    heightPx: number,
  ): Promise<Result<EngineState, EngineError>> {
    if (this.inner.insertBlankPage === undefined) return missingPhase9Extended();
    const r = await this.inner.insertBlankPage(docId, afterIndex, widthPx, heightPx);
    return r.ok ? { ok: true, value: normalizeState(r.value, undefined) } : r;
  }

  async insertFromPdf(
    docId: string,
    otherBytes: Uint8Array,
    position: number,
  ): Promise<Result<EngineState, EngineError>> {
    if (this.inner.insertFromPdf === undefined) return missingPhase9Extended();
    const r = await this.inner.insertFromPdf(docId, otherBytes, position);
    return r.ok ? { ok: true, value: normalizeState(r.value, undefined) } : r;
  }

  // -- Phase 10: edit content --

  async editTextRun(
    docId: string,
    payload: EditTextRunPayload,
  ): Promise<Result<EngineState, EngineError>> {
    if (this.inner.editTextRun === undefined) return missingPhase10();
    const r = await this.inner.editTextRun(docId, payload);
    return r.ok ? { ok: true, value: normalizeState(r.value, undefined) } : r;
  }

  async addTextBox(
    docId: string,
    payload: AddTextBoxPayload,
  ): Promise<Result<EngineState, EngineError>> {
    if (this.inner.addTextBox === undefined) return missingPhase10();
    const r = await this.inner.addTextBox(docId, payload);
    return r.ok ? { ok: true, value: normalizeState(r.value, undefined) } : r;
  }

  async editImage(
    docId: string,
    payload: EditImagePayload,
  ): Promise<Result<EngineState, EngineError>> {
    if (this.inner.editImage === undefined) return missingPhase10();
    const r = await this.inner.editImage(docId, payload);
    return r.ok ? { ok: true, value: normalizeState(r.value, undefined) } : r;
  }

  // -- Phase 11: OCR --

  async ocrRecognize(
    docId: string,
    options: OcrRecognizeOptions,
  ): Promise<Result<EngineState, EngineError>> {
    if (this.inner.ocrRecognize === undefined) return missingPhase11();
    const r = await this.inner.ocrRecognize(docId, options);
    return r.ok ? { ok: true, value: normalizeState(r.value, undefined) } : r;
  }

  async ocrSuspects(
    docId: string,
  ): Promise<Result<OcrSuspect[], EngineError>> {
    if (this.inner.ocrSuspects === undefined) return missingPhase11();
    return this.inner.ocrSuspects(docId);
  }

  /** Subscribe to per-page OCR progress pushed from main while
   *  `ocrRecognize` runs. Returns a no-op unsubscribe function when
   *  the backend doesn't expose the channel — this keeps callers
   *  from having to guard the call site. */
  onOcrProgress(cb: (p: OcrProgress) => void): () => void {
    if (this.inner.onOcrProgress === undefined) {
      return (): void => undefined;
    }
    return this.inner.onOcrProgress(cb);
  }

  /** Phase 11 — refresh hook. Returns the engine's current serialized
   *  bytes for `docId` so the renderer can rebuild its pdf.js proxy
   *  after a content-stream mutation the original load bytes do not
   *  reflect (primarily OCR's invisible Tr=3 text layer). The
   *  preload's typed signature declares `ArrayBuffer`; we normalize
   *  the result through `toArrayBuffer` so downstream code always
   *  sees a real `ArrayBuffer` even when the IPC layer hands us a
   *  `Uint8Array` view. Returns engine-error when the backend predates
   *  Phase 11 — the renderer falls back to its existing search-index
   *  invalidator in that case. */
  async getDocumentBytes(
    docId: string,
  ): Promise<Result<ArrayBuffer, EngineError>> {
    if (this.inner.getDocumentBytes === undefined) {
      return err(
        "engine-error",
        "getDocumentBytes requires the Phase 11 backend update",
      );
    }
    const r = await this.inner.getDocumentBytes(docId);
    if (!r.ok) return r;
    return { ok: true, value: toArrayBuffer(r.value) };
  }

  // -- Phase 12: residual page-organize + annotate parity --

  async replacePages(
    docId: string,
    otherBytes: Uint8Array,
    targetRange: [number, number],
  ): Promise<Result<EngineState, EngineError>> {
    if (this.inner.replacePages === undefined) return missingPhase12();
    const r = await this.inner.replacePages(docId, otherBytes, targetRange);
    return r.ok ? { ok: true, value: normalizeState(r.value, undefined) } : r;
  }

  async renumberPages(
    docId: string,
    labels: PageLabelEntry[],
  ): Promise<Result<EngineState, EngineError>> {
    if (this.inner.renumberPages === undefined) return missingPhase12();
    const r = await this.inner.renumberPages(docId, labels);
    return r.ok ? { ok: true, value: normalizeState(r.value, undefined) } : r;
  }

  async cropPages(
    docId: string,
    entries: CropEntry[],
  ): Promise<Result<EngineState, EngineError>> {
    if (this.inner.cropPages === undefined) return missingPhase12();
    const r = await this.inner.cropPages(docId, entries);
    return r.ok ? { ok: true, value: normalizeState(r.value, undefined) } : r;
  }

  async addStamp(
    docId: string,
    payload: AddStampPayload,
  ): Promise<Result<EngineState, EngineError>> {
    if (this.inner.addStamp === undefined) return missingPhase12();
    const r = await this.inner.addStamp(docId, payload);
    return r.ok ? { ok: true, value: normalizeState(r.value, undefined) } : r;
  }

  async exportFdf(
    docId: string,
  ): Promise<Result<ArrayBuffer, EngineError>> {
    if (this.inner.exportFdf === undefined) return missingPhase12();
    const r = await this.inner.exportFdf(docId);
    if (!r.ok) return r;
    return { ok: true, value: toArrayBuffer(r.value) };
  }

  async importFdf(
    docId: string,
    fdfBytes: Uint8Array,
  ): Promise<Result<EngineState, EngineError>> {
    if (this.inner.importFdf === undefined) return missingPhase12();
    const r = await this.inner.importFdf(docId, fdfBytes);
    return r.ok ? { ok: true, value: normalizeState(r.value, undefined) } : r;
  }
}

// ---------------------------------------------------------------------------
// Resolver: returns the real engine when preload exposes it, else the stub.
// Cached on first call.

let cached: EngineApi | undefined;

function readWindowEngine(): TFlexApiEngine | undefined {
  const tflex = (window as unknown as { tflex?: { engine?: TFlexApiEngine } }).tflex;
  return tflex?.engine;
}

export function getEngine(): EngineApi {
  if (cached !== undefined) return cached;
  const real = readWindowEngine();
  cached = real !== undefined ? new RealEngineAdapter(real) : stubRendererEngine;
  return cached;
}

/** Test-only: drop the cache so the next call re-resolves. */
export function _resetEngineForTests(): void {
  cached = undefined;
}

// Re-export the renderer-side types / helpers for callers.
export type {
  EngineApi,
  EngineOp,
  MergeConfirm,
  SplitConfirm,
};
export { describeEngineError, defaultPageRange, parsePageRange } from "./types";