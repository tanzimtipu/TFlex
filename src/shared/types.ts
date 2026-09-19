import type { Result } from './result';

export type PdfOpenError = 'not-pdf' | 'corrupt' | 'encrypted' | 'io';

/** Phase 12 — FDF (Forms Data Format) file-load errors. A separate load
 *  path from `loadPdfFile`: FDF files start with `%FDF-`, not `%PDF-`, so
 *  the PDF sniff would reject them. `not-fdf` covers a missing/invalid
 *  `%FDF-` header; `corrupt` covers empty or trailer-less files; `io`
 *  covers unreadable paths. */
export type FdfOpenError = 'not-fdf' | 'corrupt' | 'io';

/** Phase 12 — selects which file-type filter `openFileDialog` shows. `'pdf'`
 *  (default) is the usual Open-PDF picker; `'fdf'` shows the FDF comments
 *  filter used by the Import comments (FDF) flow so users can actually pick
 *  `.fdf` files (the PDF-only filter hid them). */
export type OpenFileDialogKind = 'pdf' | 'fdf';

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

/** Phase-15 frosted-acrylic migration — the application theme. Widened
 *  from `'light' | 'dark'` to add the third `'frosted'` theme (frosted-acrylic
 *  variant). Used by `AppSettings.theme` and validated preserve-if-valid
 *  against these three values in settings.ts; the default is `'frosted'`
 *  (operator-set). Re-exported here so both the renderer and the backend
 *  import the same union. */
export type AppTheme = 'light' | 'dark' | 'frosted';

export interface AppSettings {
  theme: AppTheme;
  geometry: WindowGeometry;
  recentFiles: RecentFile[];
  /** Phase 6 — default theme the user picks on first boot. When the
   *  preference sheet changes this, the live theme flips too.
   *  DEF-212 — widened to include `'frosted'` so the Preferences
   *  theme-default dropdown offers all three concrete themes plus
   *  `'system'`. The backend settings service must preserve the
   *  same four values (preserve-if-valid). */
  themeDefault?: 'light' | 'dark' | 'system' | 'frosted';
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
   *  Default 'none'. Validated preserve-if-valid in settings.ts. */
  optimizePreset?: OptimizePreset;
  /** Phase 13 / DEF-073 — Save-As "Fast web view (linearize)"
   *  toggle state. Independent of `optimizePreset`: the previous
   *  implementation piggy-backed on the Optimize dialog's preset
   *  field, which silently overwrote the user's compression
   *  choice whenever they toggled linearize (and vice versa). The
   *  Save-As toggle now owns its own boolean field so the two
   *  features no longer collide. Validated preserve-if-valid in
   *  settings.ts (backend-dev task); default `false`. */
  saveAsLinearize?: boolean;
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
  /** Phase 11 — OCR language code. Allowlist is a bundled ISO-639 set
   *  (see `OCR_LANGUAGES` in settings.ts). Validated preserve-if-valid;
   *  default 'eng'. The engine re-validates the value before recognising. */
  ocrLanguage?: OcrLanguage;
  /** Phase 11 — OCR render/downsample DPI used when the renderer
   *  rasterises pages for recognition. Range 72..600; default 300.
   *  Higher DPI improves accuracy at the cost of slower recognition. */
  ocrDownsample?: number;
  /** Phase 12 — default built-in stamp id used when the user opens the
   *  Stamp tool without picking one. Allowlist APPROVED/DRAFT/CONFIDENTIAL/
   *  FINAL; validated preserve-if-valid in settings.ts. Default 'APPROVED'
   *  is applied by the consumer (the renderer's Stamp tool) when the field
   *  is absent — same pattern as editDefaultFont/ocrLanguage. */
  defaultStampId?: StampId;
  /** Phase 16 — left page panel collapsed state. When true the thumbnails
   *  rail renders as a narrow ruler strip showing only page numbers.
   *  Validated preserve-if-valid in settings.ts; default `false`. */
  pagesPanelCollapsed?: boolean;
  /** Phase 19 - the annotation tools' most-recently-used order, most recent first (capped, deduped). */
  annotationRecentTools?: string[];
  /** Phase 23 - when false, every app animation runs the instant path (see Phase 23). Default true. */
  animationsEnabled?: boolean;
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
  /** Phase 11 — per-page OCR failures accumulated by `ocrRecognize` when
   *  recognition/writing of individual pages failed but at least one page
   *  succeeded (partial success). Populated only on the OCR success path
   *  when there were failures; absent otherwise. A batch caller can read
   *  this to report which pages were skipped without the whole run
   *  aborting (DEF-051). See `OcrPageFailure`. */
  ocrFailures?: OcrPageFailure[];
  /** Phase 12 — logical page labels set by `renumberPages`, in visible order.
   *  Absent when no labels have been set. The engine applies these to the
   *  serialized document's /PageLabels number tree so a viewer shows the
   *  custom labels instead of raw page numbers. */
  pageLabels?: PageLabelEntry[];
  /** Phase 14 / DEF-135 / DEF-136 — text boxes held in the engine-side
   *  placement registry (mirrors `placedSignatures`). Boxes are NOT baked
   *  into the page at add time; they are drawn once at their FINAL rect at
   *  save time (serializeDoc), so moving a box never masks the content
   *  under its old rect. `page` is the 1-based VISIBLE page; `rect` is a
   *  top-left origin in PDF points. Absent when the doc has no boxes. */
  textBoxes?: TextBoxModel[];
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
  | 'strikeout'
  | 'callout';

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

/** An annotation color value: either one of the named presets above, or a
 *  free-form hex string (#rgb / #rrggbb). The engine preserves a custom hex
 *  exactly through create -> save -> reparse (it is carried verbatim in a
 *  private /TFlexColor entry on the annotation dict); named presets continue
 *  to round-trip by name. `AnnColor` is the named-preset union used by the
 *  palette map; `AnnColorValue` is the full wire shape stored on AnnModel. */
export type AnnColorValue = AnnColor | string;

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
  // Callout arrow anchor (the point the leader line points at) / note icon
  // anchor. The renderer reads `at` for callout; the engine must preserve it
  // through create -> save -> reparse instead of backfilling it from rects[0].
  at?: AnnPoint;
  color: AnnColorValue;
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

/** Phase 21 — paragraph alignment for the text-properties panel. `justify`
 *  distributes the extra inter-word space on every wrapped line except the
 *  last. Default (field absent) is `'left'`. */
export type TextAlign = 'left' | 'center' | 'right' | 'justify';

/** Phase 21 — per-line list prefix. `'bullet'` prepends a bullet glyph plus
 *  a gap; `'number'` prepends an incrementing `N.` prefix. The prefix is part
 *  of the line's measured width for alignment. Default (absent) is `'none'`. */
export type TextListStyle = 'none' | 'bullet' | 'number';

/** Phase 21 — the Word/Adobe-class text style fields shared by the text-box
 *  model, the edit-text-run payload and the `updateTextBox` patch. Every
 *  field is optional; an absent field keeps the object's current value (or
 *  the documented default). */
export interface TextStyleFields {
  /** Paragraph alignment. Default `'left'`. */
  align?: TextAlign;
  /** Line step as a multiplier of the font size. Default `1.2`. Validated
   *  to `0.5..5`. */
  lineHeight?: number;
  /** Use the bold StandardFont variant. Default `false`. */
  bold?: boolean;
  /** Use the italic StandardFont variant. Default `false`. */
  italic?: boolean;
  /** Draw a rule under each line's ink. Default `false`. */
  underline?: boolean;
  /** Baseline offset in points; positive = superscript, negative =
   *  subscript. Default `0`. Validated to `-200..200`. */
  baselineShift?: number;
  /** Band drawn behind each line's ink, BEFORE the glyphs. Absent = no
   *  highlight. */
  highlight?: EditColor;
  /** Per-line list prefix. Default `'none'`. */
  list?: TextListStyle;
  /** Left inset of the paragraph inside the box rect, in points. Every line
   *  (including the first) starts at `rect.x + indent`, wrapping and
   *  alignment operate inside the indented content box, and a `list` prefix
   *  sits AT the indent. Default `0`. Validated to `0..200`. */
  indent?: number;
}

/** Phase 10 — payload for `engine.editTextRun`. Replaces the text run
 *  covering `rect` by masking the region with a white rectangle and
 *  drawing `newText` at the rect's top-left baseline. `rect` is in
 *  PAGE POINTS with a TOP-LEFT origin (same convention as annotations).
 *  `page` is the 1-based VISIBLE page index.
 *
 *  DEF-151 — `oldRect` is present when the renderer is committing a MOVE
 *  of an already-edited run (the user dragged the edit toolbox). In that
 *  case the engine must white-mask `oldRect` (erase the ORIGINAL run's
 *  position, so the old glyphs do not survive alongside the moved copy)
 *  AND draw `newText` at `rect` (the moved position). When `oldRect` is
 *  absent (a plain in-place edit), the engine keeps the original
 *  behaviour: mask `rect` + draw `newText` at `rect`. `oldRect` uses the
 *  same top-left/PDF-points convention as `rect`. */
export interface EditTextRunPayload extends TextStyleFields {
  page: number;
  rect: AnnRect;
  newText: string;
  font?: EditFont;
  size?: number;
  color?: EditColor;
  /** DEF-151 — the ORIGINAL rect of the run being moved. When present,
   *  the engine masks `oldRect` (not `rect`) and draws `newText` at
   *  `rect`. Omit for a plain in-place edit. */
  oldRect?: AnnRect;
}

/** Phase 10 — payload for `engine.addTextBox`. As of Phase 14 / DEF-135 /
 *  DEF-136 this pushes a `TextBoxModel` into the engine-side placement
 *  registry (NO immediate draw); the box is drawn once at its FINAL rect at
 *  save time (serializeDoc), so moving it never masks the content under its
 *  old rect. The old baking-into-page behaviour is gone — the payload shape
 *  is preserved for backward compatibility, but the engine now stores the
 *  box in the registry and returns it on `EngineState.textBoxes`.
 *
 *  `id` is optional: the renderer may pass its own uuid; if absent the
 *  engine generates one and returns it in the state. `color` is the legacy
 *  `EditColor` ({r,g,b} in [0,1]); the engine normalises it to a hex string
 *  (`#rrggbb`) for the stored `TextBoxModel.color`. */
export interface AddTextBoxPayload extends TextStyleFields {
  id?: string;
  page: number;
  rect: AnnRect;
  text: string;
  font?: EditFont;
  size?: number;
  color?: EditColor;
  background?: 'white' | 'none';
}

/** Phase 14 / DEF-135 / DEF-136 — a placed text box held in the engine-side
 *  placement registry (mirrors `SignaturePlacement`). Boxes are only
 *  serialized at save time, drawn once at their FINAL rect, so moving a box
 *  never masks the content under its old rect (the root cause of DEF-135).
 *  `id` is a uuid; `page` is the 1-based VISIBLE page; `rect` is a top-left
 *  origin in PDF points; `color` is a hex string (#rrggbb); `background`
 *  'white' draws an opaque white fill behind the text at save time so it
 *  stays readable over existing content. */
export interface TextBoxModel extends TextStyleFields {
  id: string;
  page: number;
  rect: AnnRect;
  text: string;
  font: EditFont;
  size: number;
  color?: string;
  background?: 'white' | 'none';
}

/** Phase 21 — patch for `engine.updateTextBox`. Every field is optional; an
 *  absent field leaves the box's current value unchanged. `text` replaces the
 *  box's text. `color`/`highlight` use `EditColor` ({r,g,b} in [0,1]) like the
 *  other text ops; the engine normalises `color` to the stored hex string.
 *  A supplied-but-invalid field rejects the WHOLE patch with a typed
 *  `engine-error` (mirrors the watermark contract).
 *
 *  `highlight` is widened on the PATCH ONLY: `null` REMOVES the band (the
 *  stored model loses its `highlight`, and save draws no band); an ABSENT
 *  `highlight` PRESERVES the existing band. The model/payload fields
 *  (`TextBoxModel`, `AddTextBoxPayload`, `EditTextRunPayload`) keep
 *  `EditColor` — removal is a patch operation, not a drawable state. */
export interface TextBoxStylePatch extends Omit<TextStyleFields, 'highlight'> {
  /** Replacement text (may contain explicit newlines). */
  text?: string;
  font?: EditFont;
  size?: number;
  color?: EditColor;
  /** Band behind each line's ink. A colour sets/replaces it; `null` removes
   *  it; absent preserves it. */
  highlight?: EditColor | null;
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

// ---- Phase 11: OCR ----

/** Phase 11 — OCR language allowlist. These are the ISO-639 codes for which
 *  traineddata can be bundled offline in `assets/tessdata/`. Only `eng` is
 *  shipped by default (size budget — see the Phase 11 report); the other
 *  codes are accepted by the settings/engine validation so a build that
 *  drops the matching `<code>.traineddata.gz` into `assets/tessdata/` works
 *  without a code change. */
export type OcrLanguage = 'eng' | 'deu' | 'fra' | 'spa' | 'ita' | 'por' | 'rus' | 'chi_sim' | 'jpn';

/** Phase 11 — one rasterised page image sent to the engine for OCR. The
 *  renderer produces these with PDF.js (it already renders pages for
 *  display) at the requested `dpi` (= the `ocrDownsample` setting).
 *
 *  Why the renderer rasterises and not the engine: pdf-lib has no
 *  rasteriser, and running pdf.js in the main process crashed the native
 *  canvas backend (heap corruption) during feasibility testing. The
 *  renderer's DOM-canvas PDF.js render is the existing, reliable path.
 *  This is the documented Phase 11 architecture — see the report. */
export interface OcrPageImage {
  /** 1-based VISIBLE page index (matches EngineState.pageOrder). */
  page: number;
  pngBytes: Uint8Array;
  /** Render DPI used to produce this image (72..600). The engine uses this
   *  to map OCR pixel bboxes back to PDF points (pt = px * 72 / dpi). */
  dpi: number;
  widthPx: number;
  heightPx: number;
}

/** Phase 11 — options for `engine.ocrRecognize`. The `pageImages` array
 *  carries the renderer-rasterised pages; the engine runs tesseract on
 *  each, builds an invisible text layer (pdf-lib Tr 3) on the matching
 *  PDF page, and stores the recognised words for `ocrSuspects`.
 *
 *  CONTRACT NOTE: the original Phase 11 spec read
 *    `ocrRecognize(docId, {language, downsample, pages?})`
 *  That signature is incomplete for an offline engine — pdf-lib cannot
 *  rasterise a page, so the engine has no pixel input to run OCR on. The
 *  `pages?` selector is therefore handled renderer-side (the renderer only
 *  sends `pageImages` for the pages it wants OCR'd), and `pageImages`
 *  replaces `pages?` on the engine boundary. `downsample` is retained as
 *  the intended DPI (the renderer matches it when rasterising) but the
 *  authoritative value for coordinate mapping is each `OcrPageImage.dpi`.
 *  See the Phase 11 report for the full rationale. */
export interface OcrRecognizeOptions {
  language: string; // OcrLanguage; engine validates against OCR_LANGUAGES
  downsample: number; // 72..600
  pageImages: OcrPageImage[];
}

/** Phase 11 — one low-confidence word returned by `engine.ocrSuspects`.
 *  `page` is the 1-based VISIBLE page. `rect` is in PAGE POINTS with a
 *  TOP-LEFT origin (same convention as annotations). `confidence` is the
 *  tesseract per-word score in [0, 100]. */
export interface OcrSuspect {
  word: string;
  page: number;
  rect: AnnRect;
  confidence: number;
}

/** Phase 11 — a per-page OCR failure accumulated by `ocrRecognize` when an
 *  individual page's recognition or text-layer write failed but the run
 *  continued (other pages may still have succeeded). `page` is the 1-based
 *  VISIBLE page. `message` is a short reason suitable for a toast. Listed
 *  on the returned `EngineState.ocrFailures` so a batch caller can see
 *  which pages were skipped (DEF-051). */
export interface OcrPageFailure {
  page: number;
  message: string;
}

/** Phase 11 — the tesseract confidence threshold the engine uses to
 *  decide which words are "low confidence". Re-exported here so the
 *  renderer can colour-code the suspect panel without re-importing
 *  the backend module (the renderer and the engine must agree on the
 *  same number or the panel would render the wrong colour for a
 *  borderline word). Matches `SUSPECT_CONFIDENCE_THRESHOLD` in
 *  `src/main/services/ocr.ts`. */
export const SUSPECT_CONFIDENCE_THRESHOLD = 60;

/** Phase 11 — progress pushed from main to the requesting renderer while
 *  `engine.ocrRecognize` runs, one message per page. `phase` is
 *  'recognizing' (tesseract on the page image) or 'writing' (drawing the
 *  invisible text layer into the PDF page). */
export interface OcrProgress {
  docId: string;
  page: number; // 1-based visible
  totalPages: number;
  phase: 'recognizing' | 'writing';
}

// ---- Phase 9 / DEF-060: menu enable-state ----

/** DEF-065 — stable ids assigned to application menu items whose enabled
 *  state the renderer can toggle (e.g. disable Save / Save As / Close Tab /
 *  Undo / Redo when no document is open). The renderer pushes a
 *  `MenuEnabledState` over `menu:setEnabled`; main looks each id up via
 *  `Menu.getApplicationMenu()?.getMenuItemById(id)` and flips `.enabled`.
 *  Adding a new toggle-able menu item means adding its id here AND assigning
 *  the same `id:` in `src/main/menu.ts` — the two lists must stay in sync. */
export type MenuItemId =
  | 'menu.save'
  | 'menu.saveAs'
  | 'menu.closeTab'
  | 'menu.undo'
  | 'menu.redo';

/** DEF-065 — a partial map of menu-item id -> enabled. Only the ids present
 *  are touched; omitted ids keep their current state. Sent from the
 *  renderer whenever the doc-open / undo-stack / modified state changes. */
export type MenuEnabledState = Partial<Record<MenuItemId, boolean>>;

// ---- Phase 12: residual page-organize + annotate parity ----

/** Phase 12 — built-in stamp id allowlist. The renderer draws each id as a
 *  raster (text + border on a canvas) and sends the PNG to the engine; the
 *  engine embeds it (pdf-lib has no rasteriser). Validated against this
 *  allowlist in settings.ts (defaultStampId) and in the addStamp engine op. */
export type StampId = 'APPROVED' | 'DRAFT' | 'CONFIDENTIAL' | 'FINAL';

/** Phase 12 — one logical page label entry for `renumberPages`. `page` is the
 *  1-based VISIBLE page index; `label` is the display string the engine writes
 *  into the document's /PageLabels number tree (as a pure-prefix label so a
 *  viewer shows the string verbatim with no appended number). */
export interface PageLabelEntry {
  page: number;
  label: string;
}

/** Phase 12 — one crop entry for `cropPages`. `page` is the 1-based VISIBLE
 *  page; `box` is the crop rectangle in PAGE POINTS with a TOP-LEFT origin
 *  (matching the renderer's AnnRect convention). The engine converts it to the
 *  bottom-left CropBox/TrimBox convention used by PDF. */
export interface CropEntry {
  page: number;
  box: AnnRect;
}

/** Phase 12 — payload for `addStamp`. `stampId` is one of the built-in stamp
 *  allowlist; `name` is the user-visible label; `pngBytes` is the renderer-
 *  drawn stamp raster the engine embeds at `rect` (top-left origin, PDF points).
 *  Mirrors `PlaceSignaturePayload` — the renderer composites the stamp text +
 *  border to a canvas and sends the PNG, exactly like signature placement. */
export interface AddStampPayload {
  page: number;
  rect: AnnRect;
  stampId: StampId;
  name: string;
  pngBytes: ArrayBuffer | Uint8Array;
}

// ---- Phase 18: Watermark (text or image overlay) ----

/** Phase 18 — watermark content kind. `'text'` draws `text` with the chosen
 *  standard-font typography; `'image'` embeds `imageBytes` (PNG or JPEG —
 *  pdf-lib has no rasteriser, same pattern as stamps/signatures). */
export type WatermarkType = 'text' | 'image';

/** Phase 18 — predefined watermark positions: a 3x3 grid on the page. The
 *  watermark's center is placed at the slot (with a margin of 10% of the
 *  page dimension from the edges). Explicit `WatermarkSettings.x`/`y`
 *  (top-left origin, PDF points) take precedence over `position` and place
 *  the watermark's TOP-LEFT corner at those coordinates. */
export type WatermarkPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center-left'
  | 'center'
  | 'center-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

/** Phase 18 — payload for `engine.addWatermark`. The engine bakes the
 *  watermark into each selected page's content stream at apply time
 *  (pixels survive the save round-trip). Each application is an
 *  individually addressable watermark: the marker baked into each page's
 *  content stream stays individually addressable — `getWatermarks` lists
 *  the applied watermarks and `deleteWatermark` removes one by id, and
 *  the identity survives a save/reopen round-trip.
 *
 *  Text watermark: `text` is required; `font`/`bold`/`italic` select among
 *  the bundled standard fonts, `size` is the font size in points, `color`
 *  is the glyph color. The glyph box is measured via the embedded font.
 *  Image watermark: `imageBytes` is required (PNG or JPEG); `size` is the
 *  drawn HEIGHT in PDF points and the width scales to the image's aspect
 *  ratio (default height is 33% of the page's shorter dimension).
 *
 *  `position` selects one of the nine grid slots (default 'center');
 *  explicit `x`/`y` override it. `opacity` is 0..1 (default 0.5).
 *  `tile: true` repeats the watermark in a staggered grid across the whole
 *  page (position/x/y are ignored when tiling). `range` is a 1-based
 *  inclusive visible-page range; omitted means all pages.
 *
 *  Validation lives in `normalizeWatermarkSettings` (settings.ts,
 *  preserve-if-valid): unknown types, missing/empty text or image bytes,
 *  and malformed optional fields are rejected with 'engine-error'. */
export interface WatermarkSettings {
  type: WatermarkType;
  /** Text watermark content. Required when `type` is 'text'. */
  text?: string;
  /** Image watermark bytes (PNG or JPEG). Required when `type` is 'image'. */
  imageBytes?: ArrayBuffer | Uint8Array;
  /** Typography: font family (text watermark only). Default 'Helvetica'. */
  font?: EditFont;
  /** Typography: bold style (text watermark only). */
  bold?: boolean;
  /** Typography: italic style (text watermark only). */
  italic?: boolean;
  /** Typography: underline style (text watermark only). */
  underline?: boolean;
  /** Font size in points (text) / drawn height in points (image). */
  size?: number;
  /** Text glyph color, components in [0,1]. Default is light gray. */
  color?: EditColor;
  /** Watermark opacity in [0,1]. Default 0.5. */
  opacity?: number;
  /** Predefined grid slot; overridden when both `x` and `y` are present. */
  position?: WatermarkPosition;
  /** Explicit top-left placement in PDF points (top-left origin). */
  x?: number;
  y?: number;
  /** Repeat the watermark in a staggered grid across the whole page. */
  tile?: boolean;
  /** 1-based inclusive visible-page range; omitted = all pages. */
  range?: [number, number];
}

/** Phase 18 — one applied watermark as reported by `engine.getWatermarks`. */
export interface WatermarkInfo {
  id: string;
  type: WatermarkType;
  text: string;
  pages: number[];
}