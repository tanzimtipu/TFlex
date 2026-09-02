// Renderer-side types for the page-organization engine. These mirror the
// canonical shapes in `src/shared/types.ts` (owned by the backend IPC
// contract) but use 1-based indices in places the renderer cares about,
// and surface op kinds with friendly direction discriminators rather than
// the engine's `rotate-cw` / `rotate-ccw` strings.

import type { Result } from "../../shared/result";
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
  MoveSignaturePayload,
  OcrProgress,
  OcrRecognizeOptions,
  OcrSuspect,
  OptimizePreset,
  PageLabelEntry,
  SignaturePlacement,
  SpaceAudit,
  TextPage,
} from "../../shared/types";
import type { Annotation, AnnotationPatch } from "../annotations/model";

/** Renderer-facing rotation angle (multiples of 90 degrees). */
export type PageRotation = 0 | 90 | 180 | 270;

/** Where a merged document is inserted relative to the active one.
 *
 *  - `"before"` / `"after"` map to the engine's `merge()` IPC, which
 *    prepends / appends the picked PDF's pages wholesale.
 *  - `"afterPage"` is a renderer-level position the dialog surfaces
 *    when the active doc has at least one page. The renderer converts
 *    it to a per-page insert call (`insertFromPdf`) at the chosen
 *    1-based page (afterPage); the engine IPC stays the same
 *    `position: number` it already accepts.
 *
 *  Renderer-only — the engine IPC still receives `"before" | "after"`
 *  for the `merge` op, and the per-page case bypasses `merge` entirely. */
export type MergePosition = "before" | "after" | "afterPage";

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
 *  the engine does not expose them.
 *
 *  DEF-135/136 — `textBoxes?: TextBoxModel[]` is declared on the SHARED
 *  `EngineState` (Phase 14 contract, src/shared/types.ts); the renderer
 *  inherits it here and does NOT re-declare it. */
export interface EngineState extends SharedEngineState {
  annotations: Annotation[];
  /** Phase 4 — every form field on the active doc, with current values.
   *  Empty when the document has no AcroForm. */
  formFields?: FormField[];
  /** Phase 4 — every signature placement on the active doc. Empty when
   *  the user hasn't placed any. */
  signatures?: SignaturePlacement[];
}

/** DEF-135/136 — move a registered text box through the engine's
 *  registry. Signature matches the SHARED contract
 *  (src/shared/ipc.ts `moveTextBox(docId, id, rect)`): the engine
 *  looks the box up by `id` and re-targets its rect; there is NO
 *  `page` argument (the box's registry entry already knows its page).
 *
 *  Backend note: the op is NOT in the shared IPC contract at the
 *  time of the renderer change (backend ships it in parallel); the
 *  renderer's EngineApi declares it optional and degrades with a
 *  friendly engine-error until the preload exposes it. */

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
   *  the user sees. The renderer looks up the placement's current page
   *  from its local `openTabs[id].placements` mirror and passes it
   *  inside the payload — the engine doesn't have the lookup on its
   *  side and the IPC contract is `moveSignature(docId, payload)`. */
  moveSignature(
    docId: string,
    payload: MoveSignaturePayload,
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

  // -- Phase 9: create from images + export pages --

  /** Create a brand-new PDF document from a list of image byte buffers
   *  (PNG/JPEG). The engine wraps each image as a page sized to the
   *  image's intrinsic dimensions. Returns the new document's bytes;
   *  the renderer hands them to the same open-from-bytes flow split
   *  / extract use. `imageBuffers[i]` is the i-th image's raw file
   *  bytes; the engine infers format from the magic bytes.
   *  `quality` is the JPEG quality as a FRACTION in [0, 1] used when
   *  the engine re-encodes images for size; ignored for PNG inputs.
   *  This is the canonical persisted wire shape
   *  (`AppSettings.createImageQuality`); the dialog displays the
   *  value as a percentage (10..100) for the user.
   *
   *  Engine compliance with AppSettings.createImageQuality is the
   *  host's responsibility — the renderer passes the user-picked
   *  value here verbatim. */
  createFromImages(
    docId: string,
    imageBuffers: Uint8Array[],
    quality: number,
  ): Promise<Result<ArrayBuffer, EngineError>>;

  /** Export a page range of the active document as raster images.
   *  The renderer rasterizes the engine's per-page PDF buffers at the
   *  chosen DPI and format (see `rasterizeExportPage`). Each entry in
   *  the result is the encoded bytes for one page (PNG or JPEG). The
   *  `range` field is 1-based inclusive; omitted for all pages.
   *
   *  Backend note: the engine returns PER-PAGE PDF buffers (one
   *  single-page PDF per requested page). The renderer rasterizes each
   *  buffer with pdf.js at the requested DPI, then re-encodes to the
   *  requested format with canvas.toBlob(). This split keeps the main
   *  process free of canvas / DOM dependencies.
   *
   *  For TIFF: the browser canvas can't natively encode TIFF, so the
   *  renderer falls back to PNG-bytes-with-TIFF-extension when the
   *  engine doesn't supply proper TIFF bytes. This is documented in
   *  `rasterizePageToBlob` so the limitation is visible to the user. */
  exportPages(
    docId: string,
    payload: ExportPagesPayload,
  ): Promise<Result<ExportPageEntry[], EngineError>>;

  /** Phase 9 — extract per-page text from the document. The renderer
   *  composes the per-page strings into a plain-text or RTF
   *  document for download. Per-page granularity is preserved so the
   *  RTF pipeline can apply paragraph breaks at page boundaries. */
  exportText(
    docId: string,
  ): Promise<Result<TextPage[], EngineError>>;

  /** Phase 9 — assemble a .docx from rasterised page images. The
   *  renderer rasterizes every page of the active doc to PNG at the
   *  dialog's DPI and hands the buffers here; the engine assembles
   *  them into a single .docx ZIP and returns the bytes. The
   *  renderer triggers the per-page download via the standard
   *  anchor-download trick. */
  createDocxFromImages(
    entries: DocxImageEntry[],
  ): Promise<Result<Uint8Array, EngineError>>;
  /** DEF-060 (Bug 6) — assemble a .docx from the loaded document's
   *  OWN text, with an inline-image fallback (drawn from each
   *  `DocxImageEntry.pngBuffer`) for text-free pages. The engine
   *  reuses `exportText` to pull per-page text from its pdfDoc and
   *  emits real `w:p` / `w:r` / `w:t` paragraphs for text-bearing
   *  pages; pages with no extractable text fall back to an inline
   *  `wp:inline` drawing. The renderer rasterises every page ahead
   *  of time so the fallback always has pixels. The renderer picks
   *  THIS path when the source is a loaded doc — `createDocxFromImages`
   *  is retained for callers that only have image bytes (no
   *  docId). The two methods are mutually exclusive per call site
   *  but coexist on the engine so a pre-DEF-060 backend can still
   *  serve the image-only path. */
  createDocxFromDoc?(
    docId: string,
    entries: DocxImageEntry[],
  ): Promise<Result<Uint8Array, EngineError>>;

  /** Phase 9 — create a brand-new PDF from clipboard content. The
   *  renderer reads the OS clipboard (text or image bytes) and
   *  forwards the payload to the engine. The engine decides how to
   *  format the result (text becomes a single text page; images
   *  become single-page PDFs sized to the image). */
  createFromClipboard(
    docId: string,
    content: Uint8Array | string,
  ): Promise<Result<ArrayBuffer, EngineError>>;

  /** Phase 9 — insert a blank page after the given 0-based visible
   *  index (afterIndex=-1 appends after the last page — DEF-114;
   *  afterIndex=-2 PREPENDS, the blank becomes pageOrder[0] —
   *  DEF-129). Width and height are in PDF points. Returns the
   *  updated EngineState so the renderer's mirror can refresh
   *  pageCount + pageOrder. */
  insertBlankPage(
    docId: string,
    afterIndex: number,
    widthPx: number,
    heightPx: number,
  ): Promise<Result<EngineState, EngineError>>;

  /** Phase 9 — insert every page of another PDF at the given
   *  0-based position (position=-1 means "appended at the end").
   *  Other PDF bytes are passed through the IPC so the engine can
   *  parse + copy pages without a renderer-side round-trip. */
  insertFromPdf(
    docId: string,
    otherBytes: Uint8Array,
    position: number,
  ): Promise<Result<EngineState, EngineError>>;

  // -- Phase 10: edit content (text runs, text boxes, images) --

  /** Edit an existing text run: the engine masks `rect` (page points, top-left
   *  origin) with a white rectangle, then draws `payload.newText` at the
   *  rect's top-left baseline in the requested font / size / color. Returns
   *  the new EngineState so the mirror can refresh the modified flag.
   *
   *  Phase 10 feasibility limits (per backend's contract):
   *   - font metrics are NOT preserved: the source's font, weight, and
   *     stretch are lost. We replace with one of three pdf-lib Standard
   *     families (Helvetica / Times / Courier), which is the union of
   *     shapes that map cleanly to WinAnsiEncoding.
   *   - Latin-only: glyphs outside WinAnsiEncoding (CJK, RTL, most
   *     emoji) are substituted with a question mark.
   *   - visual redact-and-redraw: the original text remains in the
   *     content stream but is visually covered.
   *  The renderer treats this as a "good-enough" edit for v1 and shows
   *  a brief hint when the user enters non-Latin text. */
  editTextRun(
    docId: string,
    payload: EditTextRunPayload,
  ): Promise<Result<EngineState, EngineError>>;

  /** Add a new text box at `payload.rect` (page points, top-left origin).
   *  The engine wraps `payload.text` to the rect's width and draws it in
   *  the requested font / size / color. `background: 'white'` paints an
   *  opaque white fill behind the text so it's readable over existing
   *  content. */
  addTextBox(
    docId: string,
    payload: AddTextBoxPayload,
  ): Promise<Result<EngineState, EngineError>>;

  /** DEF-135/136 — move / resize a REGISTERED text box through the
   *  engine's text-box registry. The engine updates the box's rect in
   *  `EngineState.textBoxes` (and draws it at the FINAL rect at save
   *  time); the renderer's overlay mirrors the change from the echoed
   *  state. Signature matches the shared IPC contract exactly —
   *  `moveTextBox(docId, id, rect)` (no page: the registry entry
   *  knows the box's page). Optional because the backend ships the
   *  registry contract in parallel — pre-registry builds degrade with
   *  a friendly engine-error (the renderer falls back to the
   *  rasterize-and-editImage path for that period). */
  moveTextBox?(
    docId: string,
    id: string,
    rect: { x: number; y: number; width: number; height: number },
  ): Promise<Result<EngineState, EngineError>>;

  /** DEF-135/136 — delete a REGISTERED text box from the engine's
   *  registry. The box's baked content is removed with it (no
   *  white-mask needed). Optional for the same parallel-contract
   *  reason as `moveTextBox`. */
  deleteTextBox?(
    docId: string,
    id: string,
  ): Promise<Result<EngineState, EngineError>>;

  /** Edit an image's placement (move / resize / replace / crop). The engine
   *  visually masks `oldRect` with a white rectangle and draws
   *  `imageBytes` (PNG or JPEG) at `newRect`. The renderer is responsible
   *  for producing the transformed bytes (resize / crop happen in its
   *  canvas; the engine only composites). The original `Do` operator
   *  remains in the stream but is covered — same visual-redact-and-redraw
   *  pattern as `editTextRun`. */
  editImage(
    docId: string,
    payload: EditImagePayload,
  ): Promise<Result<EngineState, EngineError>>;

  // -- Phase 11: OCR --

  /** Run OCR over renderer-rasterised page images. The renderer is
   *  responsible for producing the per-page PNG bytes (see
   *  `pdf/rasterize.ts`'s `rasterizePageToBlob`) because pdf-lib
   *  has no rasteriser and the engine cannot do it itself. The
   *  engine writes an invisible Tr 3 text layer onto each matching
   *  page so the document becomes searchable. Progress events are
   *  pushed back via `onOcrProgress`. */
  ocrRecognize(
    docId: string,
    options: OcrRecognizeOptions,
  ): Promise<Result<EngineState, EngineError>>;

  /** Return the low-confidence words from the most recent
   *  `ocrRecognize` on this doc. Read-only — the renderer uses the
   *  result for the OCR Suspects panel. */
  ocrSuspects(
    docId: string,
  ): Promise<Result<OcrSuspect[], EngineError>>;

  /** Subscribe to per-page OCR progress pushed from the main process
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
   *  falls back to the existing search-index invalidator in that
   *  case. */
  getDocumentBytes?(
    docId: string,
  ): Promise<Result<ArrayBuffer, EngineError>>;

  // -- Phase 12: residual page-organize + annotate parity --

  /** Phase 12 — replace the visible page range `targetRange` (0-based
   *  inclusive [start, end]) with all pages of `otherBytes`. Surviving
   *  pages keep their annotations; the other PDF's annotations and
   *  outline (bookmarks) are carried across via a page-ref remap.
   *  Links are annotations and ride the per-page annotation carry.
   *  Optional so a pre-Phase-12 backend degrades with a friendly
   *  engine-error. */
  replacePages?(
    docId: string,
    otherBytes: Uint8Array,
    targetRange: [number, number],
  ): Promise<Result<EngineState, EngineError>>;

  /** Phase 12 — set logical page labels (/PageLabels number tree) from
   *  `{page, label}` entries. `page` is 1-based visible. Replaces any
   *  labels set by a previous call. Optional so a pre-Phase-12
   *  backend degrades with a friendly engine-error. */
  renumberPages?(
    docId: string,
    labels: PageLabelEntry[],
  ): Promise<Result<EngineState, EngineError>>;

  /** Phase 12 — set each listed page's CropBox AND TrimBox to `box`
   *  (top-left origin, PDF points; the engine converts to bottom-left).
   *  Optional so a pre-Phase-12 backend degrades with a friendly
   *  engine-error. */
  cropPages?(
    docId: string,
    entries: CropEntry[],
  ): Promise<Result<EngineState, EngineError>>;

  /** Phase 12 — embed a renderer-drawn stamp raster (`pngBytes`) at
   *  `rect` on `page`. `stampId` is validated against the built-in
   *  allowlist. Optional so a pre-Phase-12 backend degrades with a
   *  friendly engine-error. */
  addStamp?(
    docId: string,
    payload: AddStampPayload,
  ): Promise<Result<EngineState, EngineError>>;

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
  ): Promise<Result<EngineState, EngineError>>;

  /** Peek the renderer's most-recent normalized EngineState for `docId`
   *  without doing an IPC round-trip. The real-engine adapter populates
   *  this cache on every successful state-returning op
   *  (`applyOp`/`undo`/`getState`/etc.); the stub returns its current
   *  per-tab snapshot. Returns `undefined` when nothing is cached yet
   *  (e.g. immediately after `loadDocument`). The renderer's
   *  `tflexDiagnostics()` reads through this so a direct
   *  `window.tflex.engine.applyOp(...)` call "writes through" to the
   *  diagnostics surface without needing a separate UI action.
   *
   *  Optional only because pre-Phase-13 backends may not expose it; the
   *  renderer falls back to the React `engineUi` mirror when undefined. */
  peekLastState?(docId: string): EngineState | undefined;
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

/** Build a default "insert at" hint string for the Insert dialog.
 *  Empty docs render as "end" (always valid); non-empty docs render
 *  as the position immediately after the last page (e.g. "5" for a
 *  4-page doc) so the natural action is "append". */
export function defaultInsertPosition(totalPages: number): string {
  if (totalPages <= 0) {
    return "1";
  }
  return `${totalPages + 1}`;
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