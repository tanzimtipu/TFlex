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
  ApplyRedactionsPayload,
  CommentThread,
  CropEntry,
  DocxImageEntry,
  DocumentProtection,
  EditImagePayload,
  EditTextRunPayload,
  EncryptDocumentOptions,
  EngineError,
  EngineOpenError,
  EngineState as SharedEngineState,
  ExportPageEntry,
  ExportPagesPayload,
  FillFormFieldPayload,
  FormDataImportReport,
  FormField,
  MovePagesBetweenDocsPayload,
  MovePagesBetweenDocsResult,
  MoveSignaturePayload,
  OcrCancelResult,
  OcrProgress,
  OcrRecognizeOptions,
  OcrSuspect,
  OpEntry,
  OptimizePreset,
  OutlineEntry,
  PageLabelEntry,
  Pdf3dContent,
  PdfCadMetadata,
  PdfLayer,
  RedactionApplyResult,
  SignaturePlacement,
  SpaceAudit,
  TextPage,
  TextBoxStylePatch,
  WatermarkInfo,
  WatermarkSettings,
} from "../../shared/types";
import type { Annotation, AnnotationPatch, PagePoint, PageRect } from "../annotations/model";
import { toArrayBuffer } from "../utils/toArrayBuffer";
import { stubRendererEngine } from "./stubEngine";
import type {
  EngineApi,
  EngineOp,
  EngineState,
  MergeConfirm,
  MovePagesBetweenDocsOutcome,
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
export function annotationToWire(a: Annotation): Annotation {
  // The engine's create path prefers `content` over `text`
  // (`normalizeAnnotationPayload`). A renderer annotation that came back
  // through an IPC echo carries the wire's `content` field, which would then
  // shadow a NEWER `text` on the next create (DEF-262: a grown textbox
  // re-created with new text stored the stale empty content). Strip it so
  // `text` is always authoritative on the way out.
  const { content: _dropContent, ...rest } = a as Annotation & { content?: unknown };
  if (a.kind === "textbox") {
    return { ...rest, kind: "text-box" } as unknown as Annotation;
  }
  return rest as Annotation;
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
    password?: string,
  ): Promise<Result<ArrayBuffer, EngineOpenError>>;
  loadDocumentBytes(
    docId: string,
    bytes: ArrayBuffer | Uint8Array,
    password?: string,
  ): Promise<Result<ArrayBuffer, EngineOpenError>>;
  /** Phase 52 — the source document's encryption state (null when plain). */
  getDocumentProtection?(
    docId: string,
  ): Promise<Result<DocumentProtection, EngineError>>;
  /** Phase 52 — produce an encrypted copy of the current document. */
  encryptDocument?(
    docId: string,
    options: EncryptDocumentOptions,
  ): Promise<Result<ArrayBuffer, EngineError>>;
  /** Phase 52 — drop a document and clear its session password. */
  closeDocument?(docId: string): Promise<void>;
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
  /** Phase 28 — append a comment entry to an annotation's thread (creates
   *  the thread on the first call). Optional like the other annotation
   *  methods so a pre-Phase-28 preload degrades with a friendly
   *  engine-error instead of crashing. */
  addComment?(
    docId: string,
    annotationId: string,
    text: string,
    author?: string,
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
    payload: MoveSignaturePayload,
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
  /** Phase 32 (Multi Mode) — atomic cross-document page move/copy. The
   *  payload is forwarded as-is; the engine returns both documents'
   *  states from one round-trip. Optional like the other post-Phase-9
   *  methods so a preload without the channel degrades with a friendly
   *  engine-error. */
  movePagesBetweenDocs?(
    payload: MovePagesBetweenDocsPayload,
  ): Promise<Result<MovePagesBetweenDocsResult, EngineError>>;
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
  /** DEF-060 (Bug 6) — assemble a .docx from the loaded document's
   *  OWN text (with image fallback for text-free pages). Pre-DEF-060
   *  backends don't expose this; the renderer falls back to
   *  `createDocxFromImages` in that case (a degraded result, but no
   *  hard error). The renderer ALWAYS prefers this path for a
   *  loaded doc. */
  createDocxFromDoc?(
    docId: string,
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
  /** DEF-135/136 — move / resize a REGISTERED text box via the engine's
   *  text-box registry. Optional so a backend that predates the registry
   *  contract keeps degrading with a friendly engine-error; the renderer
   *  falls back to the rasterize + editImage path for that period. */
  moveTextBox?(
    docId: string,
    id: string,
    rect: { x: number; y: number; width: number; height: number },
  ): Promise<Result<SharedEngineState, EngineError>>;
  /** DEF-135/136 — delete a REGISTERED text box from the engine's
   *  registry. Optional for the same parallel-contract reason as
   *  `moveTextBox`. */
  deleteTextBox?(
    docId: string,
    id: string,
  ): Promise<Result<SharedEngineState, EngineError>>;
  /** Phase 21 — apply a Word/Adobe-class style patch to a REGISTERED
   *  text box. Preserve-if-valid per field; a supplied-but-invalid
   *  field, an unsupported font or an unknown id returns a typed
   *  engine-error. Optional so a pre-Phase-21 backend degrades with a
   *  friendly engine-error. */
  updateTextBox?(
    docId: string,
    id: string,
    patch: TextBoxStylePatch,
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
  /** Phase 51 (item 9) — flag an in-flight `ocrRecognize` on `docId`
   *  for cancellation. Optional so a pre-Phase-51 backend degrades with
   *  a friendly engine-error. */
  ocrCancel?(
    docId: string,
  ): Promise<Result<OcrCancelResult, EngineError>>;
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
  /** Phase 85 — replace the document outline with `entries`. Optional like
   *  the other post-Phase-12 methods so a preload without the channel
   *  degrades with a friendly engine-error. */
  setOutline?(
    docId: string,
    entries: OutlineEntry[],
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
  /** Phase 57 feature B — export the document's AcroForm field VALUES as
   *  FDF / XFDF form DATA (distinct from `exportFdf`, which carries
   *  annotations). Round-trips with `importFormData`. Optional so a
   *  pre-Phase-57 backend degrades with a friendly engine-error. */
  exportFormData?(
    docId: string,
    format: "fdf" | "xfdf",
  ): Promise<Result<ArrayBuffer, EngineError>>;
  /** Phase 57 feature B — import FDF / XFDF form values into the document
   *  and report which names matched (an unknown name is reported, never
   *  created). Returns the report; it carries no engine state, so there is
   *  nothing to normalize here (the host refreshes form state itself).
   *  Optional so a pre-Phase-57 backend degrades with a friendly
   *  engine-error. */
  importFormData?(
    docId: string,
    format: "fdf" | "xfdf",
    data: Uint8Array,
  ): Promise<Result<FormDataImportReport, EngineError>>;
  /** Phase 57 feature A — PDF/E engineering surfaces on the raw inner engine.
   *  Optional so a pre-Phase-57 backend degrades with a friendly
   *  engine-error. */
  getLayers?(docId: string): Promise<Result<PdfLayer[], EngineError>>;
  setLayerVisibility?(
    docId: string,
    index: number,
    visible: boolean,
  ): Promise<Result<SharedEngineState, EngineError>>;
  getCadMetadata?(
    docId: string,
  ): Promise<Result<PdfCadMetadata | null, EngineError>>;
  get3dContent?(docId: string): Promise<Result<Pdf3dContent[], EngineError>>;
  /** Phase 18 — bake a text or image watermark into the content
   *  streams of the selected pages. Optional so a pre-Phase-18
   *  backend degrades with a friendly engine-error. */
addWatermark?(
     docId: string,
     settings: WatermarkSettings,
   ): Promise<Result<SharedEngineState, EngineError>>;
  /** Phase 18 — report the watermarks applied to the document (one
   *  record per id, in first-seen order; `text` is '' for image
   *  watermarks; pages are 1-based visible, ascending). Optional so a
   *  pre-Phase-18 backend degrades with a friendly engine-error. */
  getWatermarks?(docId: string): Promise<Result<WatermarkInfo[], EngineError>>;
  /** Phase 18 — delete an applied watermark by id (see
   *  `getWatermarks`). Unknown or empty ids fail with 'engine-error'
   *  (never a silent success). Optional so a pre-Phase-18 backend
   *  degrades with a friendly engine-error. */
  deleteWatermark?(
    docId: string,
    watermarkId: string,
  ): Promise<Result<SharedEngineState, EngineError>>;
  /** Phase 84 (True redaction) — remove the glyphs covered by the marks on
   *  one page and draw an opaque fill. Optional so a pre-Phase-84 backend
   *  degrades with a friendly engine-error. */
  applyRedactions?(
    docId: string,
    payload: ApplyRedactionsPayload,
  ): Promise<Result<RedactionApplyResult, EngineError>>;
}

/** Normalize a wire EngineState into the renderer's EngineState: the Phase 3
 *  `annotations` field is guaranteed present (empty list when the preload
 *  predates annotations), and any annotation that came through with the
 *  wire-shape "text-box" kind is translated back to the renderer's
 *  "textbox" tag so the renderer's AnnotationKind union matches.
 *
 *  Wire-shape field-name note (DEF-022 + DEF-059 residual): the engine's
 *  `buildState` emits signature placements under the field name
 *  `placedSignatures`; the renderer surface (App.tsx mirror effect,
 *  DocumentView, stub engine) reads `signatures`. Without the rename
 *  below, every IPC round-trip for a signature op would return
 *  `{ placedSignatures: [...] }`, the renderer mirror would see
 *  `signatures === undefined`, and the placement list would be
 *  clobbered to `[]` — signatures would silently disappear from the
 *  UI right after placement. The bridge has two parts:
 *
 *    1. Read either name. `signatures` wins when both are present
 *       (forward-compat with the renderer's own StubRendererEngine
 *       and any future backend rename — a single-line drop here
 *       closes that gap).
 *    2. STRIP `placedSignatures` from the returned object. The naive
 *       `...maybe` spread would leak the wire field through to the
 *       renderer's `EngineState`, which the App.tsx mirror would
 *       then read as an unknown-typed extra property. Stripping it
 *       keeps the renderer surface clean and means future readers
 *       cannot accidentally bind to the wire shape.
 *
 *  The presence of a stripped `placedSignatures` is what the
 *  DEF-059-residual unit test pins: if a future refactor reintroduces
 *  the spread leak, the test fails immediately.
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
 *  The `_pre` parameter is consulted on the annotations path so the
 *  calling code in `RealEngineAdapter` can carry `annotations`
 *  forward across an op whose wire shape omits the key (DEF-068):
 *  the renderer tracks the per-doc previous state in
 *  `RealEngineAdapter.#previousStates`, and when the engine's
 *  createAnnotation / editAnnotation / deleteAnnotation response
 *  drops the annotations key entirely, we copy the previous list
 *  forward so a freshly-created annotation is never lost from
 *  the renderer's view.
 *
 *  Notes on the annotations carry-forward (DEF-068):
 *   - The carry is only consulted when `Array.isArray(maybe.annotations)`
 *     is false (the wire OMITTED the key). An empty array `[]` is
 *     a legitimate wire value — the engine explicitly cleared every
 *     annotation (reset / flatten / etc.) — and we respect it.
 *   - We merge by-id rather than by index: any annotation whose id is
 *     present in `_prev.annotations` but missing in the new list is
 *     preserved in the carry set. The new list still wins for ids
 *     that match — the engine is the source of truth for current
 *     shape (color, rect, text, ...) — so a "delete annotation" the
 *     engine echoed with an empty list correctly clears, while an
 *     "omitted annotations" response preserves the prior list.
 *   - On the merge, ids that exist in both lists appear once, in the
 *     order the engine emitted them (the new list's order is the
 *     source of truth); preserved prev-only ids are appended in
 *     their original order. */
function normalizeState(
  s: SharedEngineState,
  _prev: EngineState | undefined,
): EngineState {
  const maybe = s as SharedEngineState & {
    annotations?: Annotation[];
    formFields?: FormField[];
    signatures?: SignaturePlacement[];
    placedSignatures?: SignaturePlacement[];
    comments?: CommentThread[];
  };
  const hasIncomingAnnotations = Array.isArray(maybe.annotations);
  const incoming: Annotation[] = hasIncomingAnnotations ? maybe.annotations ?? [] : [];
  // DEF-068 — annotations carry-forward. When the wire OMITS the
  // `annotations` key, fall back to `_prev.annotations` so a
  // freshly-created annotation that the engine echoed under
  // `state.annotations` is never silently lost when a subsequent
  // round-trip drops the key. When the wire carries `annotations`
  // (even an empty array), we respect it verbatim — empty means
  // "engine explicitly cleared", which is a legitimate op result.
  let resolvedAnnotations: Annotation[];
  if (hasIncomingAnnotations) {
    resolvedAnnotations = incoming.map(annotationFromWire);
  } else if (_prev !== undefined && Array.isArray(_prev.annotations) && _prev.annotations.length > 0) {
    // Merge by id: keep the new list (here, empty) verbatim for any
    // ids it carries, then append prev-only ids in their original
    // order. When the new list is empty (the only realistic case
    // where the wire omits annotations), this degenerates to a copy
    // of the prev list.
    const newIds = new Set<string>();
    resolvedAnnotations = incoming.map(annotationFromWire);
    for (const a of resolvedAnnotations) newIds.add(a.id);
    for (const prevAnn of _prev.annotations) {
      if (!newIds.has(prevAnn.id)) {
        newIds.add(prevAnn.id);
        resolvedAnnotations.push(prevAnn);
      }
    }
  } else {
    resolvedAnnotations = [];
  }
  // Wire-shape field-name bridge (DEF-022 + DEF-059 residual): the
  // engine emits `placedSignatures`; the renderer reads `signatures`.
  // Accept either, prefer `signatures` when both are present, and
  // always emit a single `signatures` key in the returned state.
  // `placedSignacements` is STRIPPED below — it must not leak through
  // to the renderer's EngineState.
  const incomingSigs: SignaturePlacement[] = Array.isArray(maybe.signatures)
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
  // DEF-135/136 — text-box registry. Consume the wire value when it is
  // an array (incl. the empty array, a legitimate "no boxes" signal —
  // e.g. after the last delete). When the wire omits the key, leave
  // the renderer state's field undefined so App.tsx's mirror effect
  // short-circuits on `undefined` (an older backend that has no
  // registry must not clobber the renderer's local box list with
  // nothing). The shape is the shared `TextBoxModel` (Phase 14
  // contract) — no conversion needed at the boundary.
  const incomingTextBoxes = Array.isArray(maybe.textBoxes)
    ? maybe.textBoxes
    : undefined;
  // Phase 28 — comment threads. Consume the wire value when it is an
  // array (incl. the empty array, the legitimate "no comments" signal —
  // e.g. after deleting the last commented annotation). When the wire
  // omits the key (a pre-Phase-28 backend, or an op that does not echo
  // comments), carry the previous list forward so the icon and the
  // comment box never blank out on an unrelated round-trip.
  const incomingComments: CommentThread[] | undefined = Array.isArray(maybe.comments)
    ? maybe.comments
    : _prev?.comments;
  // Strip wire-shape-only keys (`placedSignatures`, and the DEF-292
  // `pairedState` blob) from the spread so the returned renderer state
  // never carries a raw wire sub-object. `placedSignatures` leaking
  // through `...maybe` would make the App.tsx mirror's
  // `ui?.state.signatures` lookup correct only by coincidence; the
  // `pairedState` blob would leak the WIRE-shaped other-document state
  // (annotations untranslated). The adapter re-attaches the NORMALIZED
  // paired state on the joint undo/redo path only (see
  // `finishUndoRedo`). Future refactors must not regress this — the
  // DEF-059-residual test pins the absence.
  const { placedSignatures: _stripPlaced, pairedState: _stripPaired, ...maybeStripped } = maybe;
  void _stripPlaced;
  void _stripPaired;
  return {
    ...maybeStripped,
    annotations: resolvedAnnotations,
    formFields: incomingFields,
    signatures: incomingSigs,
    textBoxes: incomingTextBoxes,
    comments: incomingComments,
  };
}

function missingAnnotations(): Result<never, EngineError> {
  return err("engine-error", "annotations require a backend engine update");
}

function missingComments(): Result<never, EngineError> {
  return err("engine-error", "comments require a backend engine update");
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

function missingTextBoxRegistry(): Result<never, EngineError> {
  return err(
    "engine-error",
    "text-box registry (moveTextBox / deleteTextBox) requires the Phase 13 backend update",
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

function missingPhase85(): Result<never, EngineError> {
  return err(
    "engine-error",
    "outline editing requires the Phase 85 backend update",
  );
}

function missingPhase18(): Result<never, EngineError> {
  return err(
    "engine-error",
    "watermark requires the Phase 18 backend update",
  );
}

function missingPhase32(): Result<never, EngineError> {
  return err(
    "engine-error",
    "cross-document page move/copy requires the Phase 32 backend update",
  );
}

function missingPhase52(): Result<never, EngineError> {
  return err(
    "engine-error",
    "encrypted-PDF support requires the Phase 52 backend update",
  );
}

function missingPhase57(): Result<never, EngineError> {
  return err(
    "engine-error",
    "form-data export/import requires the Phase 57 backend update",
  );
}

function missingPhase57Layers(): Result<never, EngineError> {
  return err(
    "engine-error",
    "PDF/E layers and 3D content require the Phase 57 backend update",
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
  /**
   * Per-doc previous EngineState cache (DEF-068). The renderer
   * tracks the most-recent normalized state per doc so the
   * `normalizeState` carry-forward path has something to consult
   * when the engine's response omits the `annotations` key (a
   * legitimate backend implementation choice — the spec doesn't
   * require every op to echo annotations). Without this cache,
   * `normalizeState(_prev = undefined)` would always drop the
   * previous annotation list, and the renderer's `engineState.
   * annotations` would lag behind the canonical engine state.
   *
   * The cache is best-effort: an IPC error path that bypasses
   * `normalizeAndCache` simply leaves the previous value alone,
   * which is the same behaviour as before the cache existed.
   *
   * Phase 13 — the cache is also the renderer-side source of truth
   * for `tflexDiagnostics().engineState` / `modified`. Because the
   * adapter wraps every preload-bound engine op, the cache is updated
   * on EVERY state-returning call (applyOp, undo, redo, getState,
   * merge, createAnnotation, placeSignature, etc.), regardless of
   * whether the caller reached the adapter via `engineRef.current.*`
   * (the renderer's own UI handlers) or via `window.tflex.engine.*`
   * (the preload passthrough that e2e harnesses drive). After
   * `getEngine()` rewrites `window.tflex.engine` to this adapter, a
   * direct `window.tflex.engine.applyOp(...)` round-trip lands in
   * the cache synchronously, and `tflexDiagnostics()` can read it
   * without waiting for a React re-render. The QA retest spec
   * (full_sweep_retest.spec.cjs) aligns with this: direct engine
   * calls assert via the call's return value (or a follow-up
   * `getState`), UI actions continue to drive the React mirror.
   */
  private readonly previousStates = new Map<string, EngineState>();
  constructor(inner: TFlexApiEngine) {
    this.inner = inner;
  }

  /** Run `normalizeState` against the cached previous state for
   *  `docId`, then refresh the cache with the result so the next
   *  round-trip has the right carry-forward source. Centralised
   *  so every op site applies the same treatment. */
  private normalizeAndCache(docId: string, raw: SharedEngineState): EngineState {
    const prev = this.previousStates.get(docId);
    const next = normalizeState(raw, prev);
    this.previousStates.set(docId, next);
    return next;
  }

  /** DEF-292 — finish a state-returning undo/redo. The ACTIVE document's
   *  state is normalized + cached exactly as before. When the engine
   *  echoed a JOINT cross-document move (`pairedState`), the OTHER
   *  document's state is normalized + cached too, from the same
   *  round-trip, so the other pane's renderer cache is current before
   *  the App refreshes its pdf.js proxy. The returned active state
   *  carries the NORMALIZED paired state (never the raw wire blob) so
   *  the App can mirror the other pane's `engineUi` without a second
   *  `getState` call. A single-document undo/redo has no `pairedState`
   *  and returns exactly the state it did before. */
  private finishUndoRedo(docId: string, raw: SharedEngineState): EngineState {
    const paired = raw.pairedState;
    const value = this.normalizeAndCache(docId, raw);
    if (paired === undefined) return value;
    const pairedState = this.normalizeAndCache(paired.docId, paired.state);
    const next: EngineState = {
      ...value,
      pairedState: { docId: paired.docId, state: pairedState },
    };
    // Keep the active document's cache identical to what the caller
    // receives (same invariant as `normalizeAndCache`).
    this.previousStates.set(docId, next);
    return next;
  }

  /** Read the renderer's most-recent normalized EngineState for
   *  `docId` without an IPC round-trip. Returns `undefined` when
   *  no op has populated the cache yet (e.g. right after
   *  `loadDocument`); `tflexDiagnostics()` falls back to the React
   *  `engineUi` mirror in that case. The mirror itself is kept in
   *  sync with this cache by `noteOpApplied()`, so the two reads
   *  converge once any UI-driven engine op completes. */
  peekLastState(docId: string): EngineState | undefined {
    return this.previousStates.get(docId);
  }

  async loadDocument(
    docId: string,
    path: string,
    password?: string,
  ): Promise<Result<ArrayBuffer, EngineOpenError>> {
    const r = await this.inner.loadDocument(docId, path, password);
    // Opening a fresh doc resets the carry-forward cache for that
    // doc — the previous annotations, if any, are no longer
    // authoritative. The next op's normalizeState will see
    // `undefined` from this cache.
    this.previousStates.delete(docId);
    return r;
  }

  async loadDocumentBytes(
    docId: string,
    bytes: ArrayBuffer | Uint8Array,
    password?: string,
  ): Promise<Result<ArrayBuffer, EngineOpenError>> {
    // The preload IPC channel takes a Uint8Array view (structured-cloned).
    // Normalise so the call site can hand us either shape.
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const r = await this.inner.loadDocumentBytes(docId, view, password);
    this.previousStates.delete(docId);
    return r;
  }

  /** Phase 52 — the opened document's encryption state. Degrades with a
   *  friendly engine-error when the preload predates the Phase-52 channels
   *  so the banner simply does not render. */
  async getDocumentProtection(
    docId: string,
  ): Promise<Result<DocumentProtection, EngineError>> {
    if (this.inner.getDocumentProtection === undefined) return missingPhase52();
    return this.inner.getDocumentProtection(docId);
  }

  /** Phase 52 — produce an encrypted copy of the current document. The
   *  returned bytes are handed to the existing save flow; the open document
   *  is untouched, so the adapter does not refresh the state cache. */
  async encryptDocument(
    docId: string,
    options: EncryptDocumentOptions,
  ): Promise<Result<ArrayBuffer, EngineError>> {
    if (this.inner.encryptDocument === undefined) return missingPhase52();
    return this.inner.encryptDocument(docId, options);
  }

  /** Phase 52 — drop a document and clear its session password on tab
   *  close. Best-effort: a missing channel / failed call never blocks the
   *  renderer-side close. */
  async closeDocument(docId: string): Promise<void> {
    this.previousStates.delete(docId);
    if (this.inner.closeDocument === undefined) return;
    try {
      await this.inner.closeDocument(docId);
    } catch {
      // The engine cleans up on its own; a failed close must not break the
      // renderer's tab close.
    }
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
      return final.ok ? { ok: true, value: this.normalizeAndCache(docId, final.value) } : final;
    }
    const r = await this.inner.applyOp(docId, toOpEntry(op));
    return r.ok ? { ok: true, value: this.normalizeAndCache(docId, r.value) } : r;
  }

  async undo(docId: string): Promise<Result<EngineState, EngineError>> {
    const r = await this.inner.undo(docId);
    return r.ok ? { ok: true, value: this.finishUndoRedo(docId, r.value) } : r;
  }

  async redo(docId: string): Promise<Result<EngineState, EngineError>> {
    const r = await this.inner.redo(docId);
    return r.ok ? { ok: true, value: this.finishUndoRedo(docId, r.value) } : r;
  }

  async merge(
    docId: string,
    otherPaths: string[],
    position: "before" | "after",
  ): Promise<Result<EngineState, EngineError>> {
    const r = await this.inner.merge(docId, otherPaths, position);
    return r.ok ? { ok: true, value: this.normalizeAndCache(docId, r.value) } : r;
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
    // Same 1-based -> 0-based translation as split above. The
    // engine IPC contract uses 0-based indices into the current
    // order; the renderer-facing dialog passes 1-based page numbers.
    // Without this translation extract("1") of a 3-page document
    // returned page 2 and any range touching the last page errored
    // "out of bounds" (DEF-167).
    return this.inner.extract(docId, pages.map((p) => p - 1));
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
    return r.ok ? { ok: true, value: this.normalizeAndCache(docId, r.value) } : r;
  }

  async editAnnotation(
    docId: string,
    id: string,
    patch: AnnotationPatch,
  ): Promise<Result<EngineState, EngineError>> {
    if (this.inner.editAnnotation === undefined) return missingAnnotations();
    const r = await this.inner.editAnnotation(docId, id, patch);
    return r.ok ? { ok: true, value: this.normalizeAndCache(docId, r.value) } : r;
  }

  async deleteAnnotation(
    docId: string,
    id: string,
  ): Promise<Result<EngineState, EngineError>> {
    if (this.inner.deleteAnnotation === undefined) return missingAnnotations();
    const r = await this.inner.deleteAnnotation(docId, id);
    return r.ok ? { ok: true, value: this.normalizeAndCache(docId, r.value) } : r;
  }

  /** Phase 28 — append a comment / reply to an annotation's thread. The
   *  engine creates the thread on the first call for an annotation and
   *  appends a reply thereafter (one op for both). The echoed state is
   *  normalized + cached so the renderer mirror picks up the new
   *  `comments` array and the icon / comment box refresh immediately. */
  async addComment(
    docId: string,
    annotationId: string,
    text: string,
    author?: string,
  ): Promise<Result<EngineState, EngineError>> {
    if (this.inner.addComment === undefined) return missingComments();
    const r = await this.inner.addComment(docId, annotationId, text, author);
    return r.ok ? { ok: true, value: this.normalizeAndCache(docId, r.value) } : r;
  }

  async getState(docId: string): Promise<Result<EngineState, EngineError>> {
    const r = await this.inner.getState(docId);
    return r.ok ? { ok: true, value: this.normalizeAndCache(docId, r.value) } : r;
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
    // Phase 59 item 4 — the main engine now returns the full EngineState from
    // this wire call (the native-fill report and the post-fill field list
    // travel together). Older fakes/backends still return a bare FormField[].
    // Detect the shape and NEVER discard the EngineState echo: normalize +
    // cache it (so `formFillReport`, `modified` and the authoritative field
    // list all reach the UI via the engine-state mirror) and hand back its
    // field list. The fallback preserves the pre-Phase-59 behavior.
    const value: unknown = r.value;
    if (isEngineStateLike(value)) {
      const state = this.normalizeAndCache(docId, value);
      return { ok: true, value: state.formFields ?? [] };
    }
    // The wire contract is documented as returning FormField[]; re-fetch the
    // canonical list so the renderer always sees the engine's authoritative
    // values (the echo may omit an unrelated field id). The App.tsx fill
    // paths follow up with a getState round-trip that carries the post-fill
    // `modified` flag and `formFillReport` through normalizeAndCache into the
    // engineUi mirror (DEF-069).
    return this.getFormFields(docId);
  }

  async flattenForms(
    docId: string,
  ): Promise<Result<EngineState, EngineError>> {
    if (this.inner.flattenForms === undefined) return missingPhase4();
    const r = await this.inner.flattenForms(docId);
    return r.ok ? { ok: true, value: this.normalizeAndCache(docId, r.value) } : r;
  }

  // -- Phase 4: signatures --

  async placeSignature(
    docId: string,
    placement: SignaturePlacement,
  ): Promise<Result<EngineState, EngineError>> {
    if (this.inner.placeSignature === undefined) return missingPhase4();
    const r = await this.inner.placeSignature(docId, placement);
    return r.ok ? { ok: true, value: this.normalizeAndCache(docId, r.value) } : r;
  }

  async moveSignature(
    docId: string,
    payload: MoveSignaturePayload,
  ): Promise<Result<EngineState, EngineError>> {
    if (this.inner.moveSignature === undefined) return missingPhase4();
    // The renderer is the source of truth for the placement's current
    // page (it tracks the placement in `openTabs[id].placements` and
    // builds the payload with the up-to-date page from that mirror).
    // The IPC contract takes the payload as a single arg — see
    // `MoveSignaturePayload` and `src/shared/ipc.ts`. The previous
    // adapter spread `{placementId, rect}` into three positional args,
    // which the real engine rejected (DEF-059).
    const r = await this.inner.moveSignature(docId, payload);
    return r.ok ? { ok: true, value: this.normalizeAndCache(docId, r.value) } : r;
  }

  async deleteSignature(
    docId: string,
    placementId: string,
  ): Promise<Result<EngineState, EngineError>> {
    if (this.inner.deleteSignature === undefined) return missingPhase4();
    const r = await this.inner.deleteSignature(docId, placementId);
    return r.ok ? { ok: true, value: this.normalizeAndCache(docId, r.value) } : r;
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

  /** DEF-060 (Bug 6) — text-first DOCX assembler. The renderer
   *  ALWAYS prefers this path for a loaded doc: the engine reuses
   *  its own `exportText` machinery to pull real per-page text from
   *  the pdfDoc and emits editable `w:t` runs for text-bearing pages
   *  (image fallback only for text-free pages). Pre-DEF-060 backends
   *  don't expose the method; we surface `missingPhase9Extended` so
   *  the host can detect and fall back to `createDocxFromImages`
   *  (a degraded result — one image per page with no editable text).
   *
   *  Unlike the per-doc queue ops (rotate / crop / etc.), DOCX
   *  assembly is a fire-and-read call against an opaque byte blob,
   *  so it intentionally does NOT route through `normalizeAndCache`
   *  — there is no `EngineState` to carry forward. */
  async createDocxFromDoc(
    docId: string,
    entries: DocxImageEntry[],
  ): Promise<Result<Uint8Array, EngineError>> {
    if (this.inner.createDocxFromDoc === undefined) return missingPhase9Extended();
    return this.inner.createDocxFromDoc(docId, entries);
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
    return r.ok ? { ok: true, value: this.normalizeAndCache(docId, r.value) } : r;
  }

  async insertFromPdf(
    docId: string,
    otherBytes: Uint8Array,
    position: number,
  ): Promise<Result<EngineState, EngineError>> {
    if (this.inner.insertFromPdf === undefined) return missingPhase9Extended();
    const r = await this.inner.insertFromPdf(docId, otherBytes, position);
    return r.ok ? { ok: true, value: this.normalizeAndCache(docId, r.value) } : r;
  }

  /** Phase 32 (Multi Mode) — atomically move or copy pages between two
   *  open documents. The renderer-facing API is 1-BASED for both `pages`
   *  (source visible page numbers, same as `extract`) and `atIndex` (the
   *  target insertion point); the IPC payload is 0-based, so translate
   *  here exactly like the sibling methods. `atIndex === -1` is the
   *  "append" sentinel and passes through unchanged. On success BOTH
   *  documents' echoed states are normalized + cached from the single
   *  round-trip so each pane's mirror refreshes without a follow-up
   *  `getState`. On failure the error is passed through unchanged. */
  async movePagesBetweenDocs(
    fromDocId: string,
    pages: number[],
    toDocId: string,
    atIndex: number,
    mode: "move" | "copy",
  ): Promise<Result<MovePagesBetweenDocsOutcome, EngineError>> {
    if (this.inner.movePagesBetweenDocs === undefined) return missingPhase32();
    const r = await this.inner.movePagesBetweenDocs({
      fromDocId,
      pages: pages.map((p) => p - 1),
      toDocId,
      atIndex: atIndex === -1 ? -1 : atIndex - 1,
      mode,
    });
    if (!r.ok) return r;
    return {
      ok: true,
      value: {
        from: this.normalizeAndCache(fromDocId, r.value.from),
        to: this.normalizeAndCache(toDocId, r.value.to),
      },
    };
  }

  // -- Phase 10: edit content --

  async editTextRun(
    docId: string,
    payload: EditTextRunPayload,
  ): Promise<Result<EngineState, EngineError>> {
    if (this.inner.editTextRun === undefined) return missingPhase10();
    const r = await this.inner.editTextRun(docId, payload);
    return r.ok ? { ok: true, value: this.normalizeAndCache(docId, r.value) } : r;
  }

  /** Phase 84 (True redaction) — apply the pending marks on one page through
   *  the real engine. The engine result embeds its own `state`, so normalize
   *  that state through the cache while preserving `removedGlyphs` / the
   *  warning list. Mirrors the `editTextRun` adapter shape. */
  async applyRedactions(
    docId: string,
    payload: ApplyRedactionsPayload,
  ): Promise<Result<RedactionApplyResult, EngineError>> {
    if (this.inner.applyRedactions === undefined) return missingPhase10();
    const r = await this.inner.applyRedactions(docId, payload);
    return r.ok
      ? {
          ok: true,
          value: { ...r.value, state: this.normalizeAndCache(docId, r.value.state) },
        }
      : r;
  }

  async addTextBox(
    docId: string,
    payload: AddTextBoxPayload,
  ): Promise<Result<EngineState, EngineError>> {
    if (this.inner.addTextBox === undefined) return missingPhase10();
    const r = await this.inner.addTextBox(docId, payload);
    return r.ok ? { ok: true, value: this.normalizeAndCache(docId, r.value) } : r;
  }

  /** DEF-135/136 — move / resize a REGISTERED text box through the
   *  engine's registry. When the backend hasn't shipped the registry
   *  contract yet, degrade with a friendly engine-error so the host
   *  can fall back to the rasterize + editImage path. */
  async moveTextBox(
    docId: string,
    id: string,
    rect: { x: number; y: number; width: number; height: number },
  ): Promise<Result<EngineState, EngineError>> {
    if (this.inner.moveTextBox === undefined) return missingTextBoxRegistry();
    const r = await this.inner.moveTextBox(docId, id, rect);
    return r.ok ? { ok: true, value: this.normalizeAndCache(docId, r.value) } : r;
  }

  /** DEF-135/136 — delete a REGISTERED text box from the engine's
   *  registry. Same parallel-contract degrade as `moveTextBox`. */
  async deleteTextBox(
    docId: string,
    id: string,
  ): Promise<Result<EngineState, EngineError>> {
    if (this.inner.deleteTextBox === undefined) return missingTextBoxRegistry();
    const r = await this.inner.deleteTextBox(docId, id);
    return r.ok ? { ok: true, value: this.normalizeAndCache(docId, r.value) } : r;
  }

  /** Phase 21 — apply a style patch to a REGISTERED text box. Same
   *  parallel-contract degrade as `moveTextBox`: a backend without the
   *  Phase-21 op surfaces a friendly engine-error. */
  async updateTextBox(
    docId: string,
    id: string,
    patch: TextBoxStylePatch,
  ): Promise<Result<EngineState, EngineError>> {
    if (this.inner.updateTextBox === undefined) return missingTextBoxRegistry();
    const r = await this.inner.updateTextBox(docId, id, patch);
    return r.ok ? { ok: true, value: this.normalizeAndCache(docId, r.value) } : r;
  }

  async editImage(
    docId: string,
    payload: EditImagePayload,
  ): Promise<Result<EngineState, EngineError>> {
    if (this.inner.editImage === undefined) return missingPhase10();
    const r = await this.inner.editImage(docId, payload);
    return r.ok ? { ok: true, value: this.normalizeAndCache(docId, r.value) } : r;
  }

  // -- Phase 11: OCR --

  async ocrRecognize(
    docId: string,
    options: OcrRecognizeOptions,
  ): Promise<Result<EngineState, EngineError>> {
    if (this.inner.ocrRecognize === undefined) return missingPhase11();
    const r = await this.inner.ocrRecognize(docId, options);
    return r.ok ? { ok: true, value: this.normalizeAndCache(docId, r.value) } : r;
  }

  async ocrSuspects(
    docId: string,
  ): Promise<Result<OcrSuspect[], EngineError>> {
    if (this.inner.ocrSuspects === undefined) return missingPhase11();
    return this.inner.ocrSuspects(docId);
  }

  /** Phase 51 (item 9) — forward the renderer's cancel request to the
   *  engine. The cancel flag the engine sets is checked between pages
   *  and before the text-layer commit, so the pending `ocrRecognize`
   *  resolves with `error.code === 'cancelled'` and the pre-run bytes
   *  are restored. Never throws; a pre-Phase-51 backend degrades with a
   *  friendly engine-error. */
  async ocrCancel(
    docId: string,
  ): Promise<Result<OcrCancelResult, EngineError>> {
    if (this.inner.ocrCancel === undefined) return missingPhase11();
    return this.inner.ocrCancel(docId);
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
    return r.ok ? { ok: true, value: this.normalizeAndCache(docId, r.value) } : r;
  }

  async renumberPages(
    docId: string,
    labels: PageLabelEntry[],
  ): Promise<Result<EngineState, EngineError>> {
    if (this.inner.renumberPages === undefined) return missingPhase12();
    const r = await this.inner.renumberPages(docId, labels);
    return r.ok ? { ok: true, value: this.normalizeAndCache(docId, r.value) } : r;
  }

  async cropPages(
    docId: string,
    entries: CropEntry[],
  ): Promise<Result<EngineState, EngineError>> {
    if (this.inner.cropPages === undefined) return missingPhase12();
    const r = await this.inner.cropPages(docId, entries);
    return r.ok ? { ok: true, value: this.normalizeAndCache(docId, r.value) } : r;
  }

  /** Phase 85 — replace the document outline (bookmarks). The engine
   *  applies nothing on a typed failure (`out-of-range` /
   *  `invalid-outline`), so a rejected edit leaves the previous outline
   *  intact. Optional so a pre-Phase-85 backend degrades with a friendly
   *  engine-error (mirrors the Phase 12 block above). */
  async setOutline(
    docId: string,
    entries: OutlineEntry[],
  ): Promise<Result<EngineState, EngineError>> {
    if (this.inner.setOutline === undefined) return missingPhase85();
    const r = await this.inner.setOutline(docId, entries);
    return r.ok ? { ok: true, value: this.normalizeAndCache(docId, r.value) } : r;
  }

  async addStamp(
    docId: string,
    payload: AddStampPayload,
  ): Promise<Result<EngineState, EngineError>> {
    if (this.inner.addStamp === undefined) return missingPhase12();
    const r = await this.inner.addStamp(docId, payload);
    return r.ok ? { ok: true, value: this.normalizeAndCache(docId, r.value) } : r;
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
    return r.ok ? { ok: true, value: this.normalizeAndCache(docId, r.value) } : r;
  }

  /** Phase 57 feature B — export the active document's AcroForm field
   *  VALUES as FDF / XFDF form DATA. The bytes carry no engine state, so
   *  this is a plain pass-through (mirrors `exportFdf`, not the cached
   *  mutations). Optional so a pre-Phase-57 backend degrades with a
   *  friendly engine-error. */
  async exportFormData(
    docId: string,
    format: "fdf" | "xfdf",
  ): Promise<Result<ArrayBuffer, EngineError>> {
    if (this.inner.exportFormData === undefined) return missingPhase57();
    const r = await this.inner.exportFormData(docId, format);
    if (!r.ok) return r;
    return { ok: true, value: toArrayBuffer(r.value) };
  }

  /** Phase 57 feature B — import FDF / XFDF form values. The engine
   *  applies every match as ONE undo entry and returns the
   *  matched/unmatched/empty report; it never creates an unmatched field.
   *  The report carries no engine state, so it is returned as-is (no
   *  `normalizeAndCache`); the host refreshes form state itself. Optional
   *  so a pre-Phase-57 backend degrades with a friendly engine-error. */
  async importFormData(
    docId: string,
    format: "fdf" | "xfdf",
    data: Uint8Array,
  ): Promise<Result<FormDataImportReport, EngineError>> {
    if (this.inner.importFormData === undefined) return missingPhase57();
    return this.inner.importFormData(docId, format, data);
  }

  // -- Phase 57 feature A: PDF/E engineering surfaces --

  /** Enumerate the document's layers. A layerless document is `ok([])`.
   *  Optional so a pre-Phase-57 backend degrades with a friendly
   *  engine-error. */
  async getLayers(docId: string): Promise<Result<PdfLayer[], EngineError>> {
    if (this.inner.getLayers === undefined) return missingPhase57Layers();
    return this.inner.getLayers(docId);
  }

  /** Toggle one layer. Undoable and marks the doc modified; the engine echoes
   *  the full state, so this goes through `normalizeAndCache` like every other
   *  state-returning mutation (mirrors `importFdf`). */
  async setLayerVisibility(
    docId: string,
    index: number,
    visible: boolean,
  ): Promise<Result<EngineState, EngineError>> {
    if (this.inner.setLayerVisibility === undefined) return missingPhase57Layers();
    const r = await this.inner.setLayerVisibility(docId, index, visible);
    return r.ok ? { ok: true, value: this.normalizeAndCache(docId, r.value) } : r;
  }

  /** The XMP `pdfe:` engineering block, or `null` when absent/undecodable.
   *  Carries no engine state, so it is returned as-is. */
  async getCadMetadata(
    docId: string,
  ): Promise<Result<PdfCadMetadata | null, EngineError>> {
    if (this.inner.getCadMetadata === undefined) return missingPhase57Layers();
    return this.inner.getCadMetadata(docId);
  }

  /** Every 3D annotation the app cannot render (`ok([])` when none). Carries
   *  no engine state, so it is returned as-is. */
  async get3dContent(
    docId: string,
  ): Promise<Result<Pdf3dContent[], EngineError>> {
    if (this.inner.get3dContent === undefined) return missingPhase57Layers();
    return this.inner.get3dContent(docId);
  }

  // -- Phase 18: watermark --

  /** Phase 18 — bake a text or image watermark into the selected
   *  pages' content streams. The engine echoes the new state so the
   *  renderer's `modified` / pageCount mirror refreshes through the
   *  standard `normalizeAndCache` path. The host refreshes the pdf.js
   *  proxy afterwards (the watermark is a content-stream mutation the
   *  original load bytes do not reflect — same as OCR / stamps). */
  async addWatermark(
    docId: string,
    settings: WatermarkSettings,
  ): Promise<Result<EngineState, EngineError>> {
    if (this.inner.addWatermark === undefined) return missingPhase18();
    const r = await this.inner.addWatermark(docId, settings);
    return r.ok ? { ok: true, value: this.normalizeAndCache(docId, r.value) } : r;
  }

  /** Phase 18 — list the watermarks applied to the document (one
   *  record per id, in first-seen order). The record list needs no
   *  state normalization, so the raw engine result is returned as-is. */
  async getWatermarks(docId: string): Promise<Result<WatermarkInfo[], EngineError>> {
    if (this.inner.getWatermarks === undefined) return missingPhase18();
    return this.inner.getWatermarks(docId);
  }

  /** Phase 18 — delete an applied watermark by id from every page
   *  that carries it. The engine echoes the new state so the
   *  renderer's mirror refreshes through the standard
   *  `normalizeAndCache` path (the host refreshes the pdf.js proxy
   *  afterwards, same as addWatermark). */
  async deleteWatermark(
    docId: string,
    watermarkId: string,
  ): Promise<Result<EngineState, EngineError>> {
    if (this.inner.deleteWatermark === undefined) return missingPhase18();
    const r = await this.inner.deleteWatermark(docId, watermarkId);
    return r.ok ? { ok: true, value: this.normalizeAndCache(docId, r.value) } : r;
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
  if (real !== undefined) {
    cached = new RealEngineAdapter(real);
    // Phase 13 — re-publish the adapter as `window.tflex.engine` so
    // direct calls (e.g. an e2e harness doing
    // `window.tflex.engine.applyOp(...)`) flow through the adapter and
    // update the per-doc `previousStates` cache. Pre-Phase-13 the
    // preload passthrough was exposed unchanged, which meant a direct
    // call bypassed the adapter and the renderer's `engineUi` mirror
    // only learned about the new state on the next React re-render
    // (often "never" in a test that asserts synchronously after the
    // call). With this re-publish, every state-returning engine op
    // keeps the cache fresh in real time, and `tflexDiagnostics()`
    // reads through it. The `TFlexApi` shape that preload exposes
    // (`window.tflex.engine.*`) is a structural subset of
    // `EngineApi.applyOp/undo/...`, so the swap is wire-compatible for
    // direct callers — they just get normalized state back instead of
    // the raw wire shape.
    //
    // DEF-078 — the assignment throws on Electron's contextBridge-
    // frozen `window.tflex` (TypeError: Cannot assign to read only
    // property 'engine'). The throw propagated through
    // `useRef(getEngine())` during the first render, triggering a
    // "Maximum update depth exceeded" / "There was an error during
    // concurrent rendering" recovery loop on every boot. Wrap the
    // assignment in try/catch so a frozen contextBridge (Electron's
    // default with `contextIsolation: true`) degrades to the
    // preload passthrough: direct callers still get the wire shape
    // back from `ipcRenderer.invoke`, the adapter cache is no longer
    // auto-updated by those direct calls. E2e tests that assert via
    // `tflexDiagnostics()` after a direct call must now call
    // `tflex.engine.getState(docId)` (or the equivalent React handler)
    // to refresh the mirror; the adapter's `previousStates` is only
    // populated when the renderer's React handlers call into it
    // (which is the supported flow).
    const w = window as unknown as { tflex?: { engine?: unknown } };
    if (w.tflex !== undefined) {
      try {
        w.tflex.engine = cached;
      } catch {
        // contextBridge-frozen `window.tflex` rejects the assignment.
        // The adapter is already cached in `cached` so React handlers
        // (which reach it via `engineRef.current`) keep working; the
        // re-publish is best-effort.
      }
    }
  } else {
    cached = stubRendererEngine;
  }
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

/** Phase 59 item 4 — distinguish the new full-EngineState wire response from
 *  the legacy bare FormField[] echo. The main engine's fill/save IPC now
 *  returns an EngineState (a non-array object carrying `pageCount`), so the
 *  adapter can normalize + cache it instead of throwing the native-fill
 *  report away. */
function isEngineStateLike(value: unknown): value is SharedEngineState {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { pageCount?: unknown }).pageCount === "number"
  );
}