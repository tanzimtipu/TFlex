import type { Result } from './result';

export type PdfOpenError = 'not-pdf' | 'corrupt' | 'encrypted' | 'io';

export type SaveFormat = 'nsis' | 'portable';

export interface RecentFile {
  path: string;
  name: string;
  openedAt: string; // ISO 8601
}

export interface SampleDocument {
  name: string;
  path: string; // relative to the app assets dir, e.g. 'samples/report.pdf'
}

export interface WindowGeometry {
  x: number;
  y: number;
  width: number;
  height: number;
  maximized: boolean;
}

export interface AppSettings {
  theme: 'light' | 'dark';
  geometry: WindowGeometry;
  recentFiles: RecentFile[];
}

export type LoadSettingsResult = Result<AppSettings, 'io' | 'corrupt-settings'>;

// ---- Phase 2: Page organization engine ----

export type PageOpKind = 'rotate-cw' | 'rotate-ccw' | 'delete' | 'reorder';

export interface EngineState {
  pageCount: number;
  modified: boolean;
  pageOrder: number[];
  rotations: number[];
  deleted: boolean[];
  /** AcroForm fields present in the document, if the document has a form.
   *  Populated by buildState so the renderer can seed form editors without
   *  a separate getFormFields call. Omitted when the document has no form. */
  formFields?: FormField[];
}

export interface OpEntry {
  kind: PageOpKind;
  page: number;
  param?: number;
}

export type EngineError =
  | 'engine-error'
  | 'nothing-to-undo'
  | 'nothing-to-redo'
  | 'cancelled'
  | 'open-error'
  | 'out-of-range'
  | 'empty-range'
  | 'no-op'
  | 'write-error'
  | 'not-found';

// ---- Phase 3: Annotations ----

export type AnnKind =
  | 'text-box'
  | 'rect'
  | 'ellipse'
  | 'note'
  | 'ink'
  | 'arrow'
  | 'highlight'
  | 'underline'
  | 'squiggly'
  | 'strikeout';

export type AnnColor =
  | 'yellow'
  | 'green'
  | 'blue'
  | 'red'
  | 'orange'
  | 'purple'
  | 'cyan'
  | 'magenta'
  | 'white';

export interface AnnRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AnnPoint {
  x: number;
  y: number;
}

export type AnnLineEnd = 'OpenArrow' | 'ClosedArrow' | 'None' | 'Square' | 'Circle' | 'Diamond';

export interface AnnModel {
  id: string;
  kind: AnnKind;
  page: number; // visible 1-based page index
  rects: AnnRect[];
  points?: AnnPoint[];
  color: AnnColor;
  content?: string;
  text?: string;
  opacity?: number; // 0..1
  width?: number; // stroke width for ink/arrow/rect/ellipse
  blendMode?: string;
  lineEnds?: AnnLineEnd[];
}

/** Payload the renderer sends over IPC for createAnnotation. Matches the
 *  renderer's Annotation union shape — the preload forwards it as-is. */
export interface CreateAnnotationPayload {
  id: string;
  page: number;
  kind: AnnKind | 'textbox';
  color: string;
  createdAt?: string;
  rects?: AnnRect[];
  rect?: AnnRect;
  points?: AnnPoint[];
  from?: AnnPoint;
  to?: AnnPoint;
  at?: AnnPoint;
  text?: string;
  content?: string;
  width?: number;
  opacity?: number;
  blendMode?: string;
  lineEnds?: AnnLineEnd[];
}

/** Payload the renderer sends over IPC for editAnnotation. */
export interface EditAnnotationPayload {
  color?: string;
  text?: string;
  content?: string;
}

// ---- Phase 4: Forms (AcroForm) ----

/** The set of AcroForm field kinds the renderer treats as fillable.
 *  Mirrors pdf-lib's PDFTextField / PDFCheckBox / PDFRadioGroup / PDFDropdown
 *  / PDFOptionList surface, flattened into a single union so a single
 *  engine call (`getFormFields`) returns them in a homogeneous list. */
export type FormFieldKind =
  | "text"
  | "checkbox"
  | "radio"
  | "dropdown"
  | "listbox";

/** One fillable option inside a `radio`, `dropdown`, or `listbox`. The
 *  `value` is the canonical export value (what pdf-lib writes into the
 *  /V entry); the `label` is what the renderer shows in the editor.
 *  They may be the same string for radio groups. */
export interface FormFieldOption {
  value: string;
  label: string;
}

/** Rect on a page, in PDF points, top-left origin (mirrors the renderer's
 *  `PageRect` so the UI can map field positions onto PageView without
 *  coordinate translation). */
export interface FormFieldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A single AcroForm field as the engine returns it from `getFormFields`.
 *  The renderer seeds field editors from `value` and sends user edits back
 *  through `fillFormField`. Field positions are in PAGE POINTS with a
 *  TOP-LEFT origin, matching the annotation geometry model.
 *
 *  Notes on per-kind fields:
 *    - `text`         -> `value` is a string (possibly empty / multi-line)
 *    - `checkbox`     -> `value` is "true" when checked, "false" otherwise
 *    - `radio`        -> `value` is the selected option's `value`, or empty
 *    - `dropdown`     -> `value` is the chosen option's `value`, or empty
 *    - `listbox`      -> `value` is an array of selected option values
 *                        (empty array = nothing selected)
 */
export interface FormField {
  id: string;
  name: string;
  page: number;
  kind: FormFieldKind;
  rect: FormFieldRect;
  value: string | string[];
  /** Available options, present for radio / dropdown / listbox only. */
  options?: FormFieldOption[];
  /** True for multi-select listboxes (engine sets this from
   *  pdf-lib's PDFOptionList.isMultiselect). */
  multi?: boolean;
}

/** Payload for `fillFormField`. The renderer sends only the field id and
 *  the new value; the engine validates against the field's kind. */
export interface FillFormFieldPayload {
  id: string;
  value: string | string[];
}

// ---- Phase 4: Signatures ----

/** Source of a signature's raster. A drawn signature is a list of pointer
 *  points (polyline strokes); a typed signature is rendered to a canvas
 *  by the renderer before being sent to the engine. The engine stores
 *  either kind as a PNG buffer keyed by `data` for retrieval.
 *
 *  `points` coordinates are in the SIGNATURE'S OWN PIXEL SPACE (the
 *  drawing canvas), not the page. The renderer scales them when placing.
 *  `text` is the typed name for typed signatures (renderer only). */
export type SignatureSource =
  | { kind: "drawn"; points: { x: number; y: number }[][]; width: number; height: number }
  | { kind: "typed"; text: string; width: number; height: number };

/** A saved signature returned by the signature list service. Saved
 *  signatures persist across sessions (the engine persists them via
 *  the signature service) and can be re-placed without redrawing. */
export interface SavedSignature {
  id: string;
  label: string; // user-visible label, derived from typed text or "Signature N"
  createdAt: string; // ISO 8601
  source: SignatureSource;
}

/** Placement of a signature on a specific page. Rect is in PAGE POINTS
 *  with a top-left origin. `signatureId` references a `SavedSignature`.
 *  The engine composites the raster onto the page on save (no
 *  /Sig widget — values baked as content). */
export interface SignaturePlacement {
  id: string;
  signatureId: string;
  page: number;
  rect: FormFieldRect;
  /** The rasterised PNG bytes (rendered by the renderer from
   *  SavedSignature.source and sent to the engine at placement time).
   *  The engine embeds these bytes into the PDF on save. */
  pngBytes: ArrayBuffer | Uint8Array;
}

/** Payload from the renderer for `enginePlaceSignature`. */
export interface PlaceSignaturePayload {
  id: string;
  signatureId: string;
  page: number;
  rect: FormFieldRect;
  pngBytes: ArrayBuffer | Uint8Array;
}

/** Payload from the renderer for `engineMoveSignature`. */
export interface MoveSignaturePayload {
  id: string;
  page: number;
  rect: FormFieldRect;
}