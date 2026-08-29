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

/** Phase 6 — per-theme annotation color overrides. Each entry is a
 *  custom color preset the user added; the picker shows these
 *  alongside the built-in swatches. Keys are 'light' | 'dark' so
 *  the palette can be tuned per theme. Two storage shapes are
 *  accepted for backwards-compatibility with the backend's existing
 *  settings.json migration:
 *
 *   - Legacy: `string[]` — each entry is the raw hex string.
 *   - Current: `AnnotationColorPreset[]` — `{ id, hex }` so removals
 *     can target by id even if the user adds the same hex twice.
 *
 *  The renderer normalises on read (see `annotations/ColorPalette.tsx`)
 *  and writes the current shape through `state/colorPalette.ts`.
 *  Backend migration only needs to survive a re-read; we keep the
 *  legacy shape accepted so existing settings.json files don't
 *  crash the migration path while backend-dev ships the matching
 *  normalisation. */
export interface AnnotationColorPreset {
  id: string;
  hex: string;
}

export interface AnnotationColors {
  light?: AnnotationColorPreset[] | string[];
  dark?: AnnotationColorPreset[] | string[];
}

export interface AppSettings {
  theme: 'light' | 'dark';
  geometry: WindowGeometry;
  recentFiles: RecentFile[];
  /** Phase 6 — default theme the user picks on first boot. When the
   *  preference sheet changes this, the live theme flips too. */
  themeDefault?: 'light' | 'dark' | 'system';
  /** Phase 6 — cap for the recent-files list (1..50). The backend
   *  enforces a matching cap on its side; this is what the renderer
   *  asks for next save. */
  recentsCap?: number;
  /** Phase 6 — tools palette layout. 'list' is the dense icon+label
   *  stack (default); 'grid' is the icon tile layout. */
  toolsPaletteLayout?: 'list' | 'grid';
  /** Phase 6 — per-theme annotation color overrides. See
   *  `AnnotationColors`. The picker reads + writes this list. */
  annotationColors?: AnnotationColors;
  /** Phase 8 — optimize preset for file size reduction. Controls
   *  compression level when the engine.optimize action is called.
   *  'none' = linearized no compression, 'compact' = moderate
   *  compression, 'max' = aggressive compression + metadata strip.
   *  Default 'none'. Validated preserve-if-valid in settings.ts.
   *
   *  Also stores the Save-As "Fast web view (linearize)" choice
   *  (DEF-040): the toggle writes preset='none' when ON (linearized
   *  output) and preset='compact' when OFF (default compression).
   *  This piggy-backs on the existing persist path so the user's
   *  Save-As linearize choice survives across launches without
   *  adding a new backend-validated field. The Optimize dialog
   *  reads the same field, so the two flows stay in sync — if the
   *  user picks 'max' in Optimize then opens Save-As, the toggle
   *  starts OFF (any non-'none' preset is "not linearized"). */
  optimizePreset?: OptimizePreset;
  /** Phase 9 — image export format for `exportPages`. */
  exportImageFormat?: ExportImageFormat;
  /** Phase 9 — export image DPI (72–600). */
  exportImageDpi?: number;
  /** Phase 9 — create-from-images JPEG quality (0.0–1.0). */
  createImageQuality?: number;
  /** Phase 10 — default font for the Edit-content text tools. Allowlist
   *  is the three pdf-lib StandardFonts families that map cleanly to
   *  WinAnsiEncoding (Helvetica/Times/Courier). Validated
   *  preserve-if-valid in settings.ts; default 'Helvetica'. */
  editDefaultFont?: EditFont;
}

/** Phase 6 — what the renderer gets back from `app:getInfo`. The
 *  backend fills this in `start()` and exposes it over IPC. The
 *  About dialog reads `version` and the preferences sheet reads
 *  `storagePaths`. The OTA work backend-dev is building in parallel
 *  will surface `updateState` (not consumed by the renderer here —
 *  that's a future addition). */
export interface AppInfo {
  version: string;
  electronVersion: string;
  nodeVersion: string;
  storagePaths: {
    userData: string;
    settings: string;
    signatures: string;
    cache: string;
  };
}

export type LoadSettingsResult = Result<AppSettings, 'io' | 'corrupt-settings'>;

// ---- Phase 6: OTA updates ----

export type UpdateState =
  | { kind: 'unsupported'; reason: string }
  | { kind: 'checking' }
  | { kind: 'up-to-date'; version: string }
  | { kind: 'available'; version: string; releaseDate?: string }
  | { kind: 'downloading'; progress: number }
  | { kind: 'downloaded'; version: string }
  | { kind: 'error'; message: string };

// ---- Phase 8: Optimize ----

export type OptimizePreset = 'none' | 'compact' | 'max';

export interface SpaceAudit {
  totalBytes: number;
  breakdown: {
    images: number;
    fonts: number;
    contentStreams: number;
    metadata: number;
    other: number;
  };
}

// ---- Phase 9: Create + Export ----

export type ExportImageFormat = 'png' | 'jpeg' | 'tiff';
/** Payload for `engine.exportPages`. range is 1‑based inclusive, or
 *  omitted/undefined for all pages. */
export interface ExportPagesPayload {
  range?: [number, number];
  format: ExportImageFormat;
  dpi: number;
}

/** One exported page image returned by `engine.exportPages`. */
export interface ExportPageEntry {
  pageIndex: number; // 1‑based
  buffer: Uint8Array;
  format: ExportImageFormat;
  width: number;
  height: number;
}

// ---- Phase 9: Clipboard, insert, text export, DOCX ----

/** Per-page text extracted by `engine.exportText`.
 *  The renderer formats this as plain text or RTF. */
export interface TextPage {
  pageIndex: number; // 1‑based
  text: string;
}

/** One rasterised page image entry for `engine.createDocxFromImages`.
 *  The renderer renders each page to PNG and sends the buffers here;
 *  the engine assembles them into a .docx ZIP. */
export interface DocxImageEntry {
  pageNumber: number;    // 1‑based
  pngBuffer: Uint8Array; // PNG bytes
  width: number;         // image width in pixels
  height: number;        // image height in pixels
  pageWidth: number;     // page width in PDF points
  pageHeight: number;    // page height in PDF points
}

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

// ---- Phase 10: Edit content ----

/** Phase 10 — font allowlist for the Edit-content text tools. These are
 *  the three pdf-lib StandardFonts families whose WinAnsiEncoding maps
 *  cleanly to Latin text, so round-trip extraction is reliable. Embedded
 *  subset fonts in the source document cannot be matched exactly — see
 *  the Phase 10 report for the feasibility limit. */
export type EditFont = 'Helvetica' | 'Times' | 'Courier';

/** Phase 10 — RGB color for drawn text, components in [0,1]. Matches
 *  pdf-lib's `rgb()` helper range. */
export interface EditColor {
  r: number;
  g: number;
  b: number;
}

/** Phase 10 — payload for `engine.editTextRun`. Replaces the text run
 *  covering `rect` by masking the region with a white rectangle and
 *  drawing `newText` at the rect's top-left baseline. `rect` is in
 *  PAGE POINTS with a TOP-LEFT origin (same convention as annotations).
 *  `page` is the 1-based VISIBLE page index. */
export interface EditTextRunPayload {
  page: number;
  rect: AnnRect;
  newText: string;
  font?: EditFont;
  size?: number;
  color?: EditColor;
}

/** Phase 10 — payload for `engine.addTextBox`. Draws `text` wrapped
 *  inside `rect` (top-left origin, PDF points). `background` controls
 *  whether an opaque white fill is drawn behind the text so it is
 *  readable over existing content; default 'none'. */
export interface AddTextBoxPayload {
  page: number;
  rect: AnnRect;
  text: string;
  font?: EditFont;
  size?: number;
  color?: EditColor;
  background?: 'white' | 'none';
}

/** Phase 10 — payload for `engine.editImage`. All four ops reduce to
 *  the same engine work: mask the original placement (`oldRect`) with
 *  a white rectangle, then draw `imageBytes` (PNG or JPEG) at `newRect`.
 *  The renderer is responsible for producing the transformed image
 *  bytes (resize/crop happen in its canvas; the engine only composites).
 *
 *  Feasibility note: true in-place content-stream editing of the
 *  image's `cm` transform is not done — the original `Do` operator
 *  remains in the stream but is visually covered. This is the
 *  documented Phase 10 limitation. */
export interface EditImagePayload {
  page: number;
  op: 'move' | 'resize' | 'replace' | 'crop';
  oldRect: AnnRect;
  newRect: AnnRect;
  imageBytes: Uint8Array;
}