import type { Result } from './result';
import type { ConvertDefaults } from './convert';

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
 *  `.fdf` files (the PDF-only filter hid them). Phase 53 adds `'document'`:
 *  the grouped universal-import filter set (Documents / Text and markup /
 *  Spreadsheets / All supported files). */
export type OpenFileDialogKind = 'pdf' | 'fdf' | 'document';

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
   *  stack (default); 'grid' is the icon tile layout.
   *  Phase 36: TOLERATED LEGACY key — no UI writes it after the All-tools
   *  palette is retired (see Phase 36), but the validator keeps accepting
   *  'list' | 'grid' for one release so an existing settings.json does
   *  not fail validation. The field is not removed this release. */
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
  /** Phase 36 — tool ids pinned to the Action Dock (max 4; oldest
   *  overflow into a "..." chip). Validated preserve-if-valid in
   *  settings.ts: only non-empty strings survive, duplicates are dropped
   *  (first occurrence wins), an over-long array is truncated to the
   *  first four after de-duplication, and a non-array rejects the field
   *  (consumer default `[]`). Unknown tool ids are dropped by the
   *  consumer, which owns the tools registry — main has no registry to
   *  check against. */
  dockPins?: string[];
  /** Phase 36 — per-tool run counts backing the command palette's
   *  frequency ranking. Validated preserve-if-valid in settings.ts: only
   *  non-empty string keys with finite, non-negative integer values
   *  survive (other entries dropped); the map is capped at its 200
   *  highest counts, ties keeping incoming order; a non-object rejects
   *  the field (consumer default `{}`). */
  toolUsage?: Record<string, number>;
  /** Phase 37 — tool ids the user has REMOVED from the Action Dock (the
   *  inverse of `dockPins`). Validated preserve-if-valid in settings.ts:
   *  only non-empty strings survive, duplicates are dropped (first
   *  occurrence wins), order is preserved, an over-long array is truncated
   *  to `DOCK_UNPINNED_CAP`, and a non-array rejects the field (consumer
   *  default `[]`). Unknown tool ids are dropped by the consumer, which
   *  owns the tools registry — main has no registry to check against. */
  dockUnpinned?: string[];
  /** Phase 44 — feature flag for accounts + cloud sync. Strict boolean;
   *  default `false` (hidden). Validated preserve-if-valid in settings.ts:
   *  a non-boolean rejects the field (consumer default `false`). */
  accountsEnabled?: boolean;
  /** Phase 44 — generated per-install id used for sync conflict notes.
   *  Non-empty string, capped at 64 chars; validated preserve-if-valid in
   *  settings.ts (a present-but-invalid value rejects the field). */
  syncDeviceId?: string;
  /** Phase 44 — ISO-8601 timestamp of the last successful sync, for display
   *  only. String capped at 32 chars; validated preserve-if-valid in
   *  settings.ts. The session/JWT is NOT a settings field — it lives only
   *  in the encrypted vault (`src/main/services/accounts/vault.ts`). */
  lastSyncedAt?: string;
  /** Phase 52 — remembered defaults for the Create-encrypted dialog:
   *  algorithm + the eight permission toggles. No password is ever a
   *  setting. Validated preserve-if-valid in settings.ts; a missing field
   *  resolves to AES-256 with all permissions allowed (consumer default). */
  encryptDefaults?: EncryptDefaults;
  /** Phase 53 — remembered import defaults for the conversion pipeline
   *  (page size, margins, text font family/size, CSV delimiter/form mapping,
   *  HTML print backgrounds). Validated preserve-if-valid in settings.ts; a
   *  missing field resolves to `DEFAULT_CONVERT_DEFAULTS`. */
  convertDefaults?: ConvertDefaults;
  /** Phase 54 — remembered defaults for raster/TIFF image import
   *  (page-size mode, fixed page size, fit, rotation). Validated
   *  preserve-if-valid in settings.ts; a missing field resolves to
   *  `DEFAULT_IMAGE_IMPORT_DEFAULTS`. */
  imageImportDefaults?: ImageImportDefaults;
  /** Phase 54 — remembered defaults for PDF/A + PDF/X validation (target
   *  level and violation handling). Validated preserve-if-valid in
   *  settings.ts; a missing field resolves to
   *  `DEFAULT_PDF_VALIDATION_DEFAULTS`. */
  pdfValidationDefaults?: PdfValidationDefaults;
  /** Phase 55 — remembered defaults for the office conversion program
   *  (spreadsheet gridlines/fit/orientation, presentation notes, export
   *  toggles). Validated preserve-if-valid in settings.ts; a missing field
   *  resolves to `DEFAULT_OFFICE_CONVERT_DEFAULTS`. */
  officeConvertDefaults?: OfficeConvertDefaults;
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
  | { kind: 'available'; version: string; releaseDate?: string; notes?: string[] }
  | { kind: 'downloading'; progress: number }
  | { kind: 'downloaded'; version: string; notes?: string[] }
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

// ---- Phase 28: comment threads ----

/** Phase 28 — one entry in an annotation's comment thread. `entries[0]` is
 *  the original comment; every later entry is a reply. Order is oldest-first
 *  and is preserved through save/reopen. */
export interface CommentEntry {
  id: string;
  author: string;
  text: string;
  /** Epoch milliseconds. */
  createdAt: number;
}

/** Phase 28 — one comment thread per annotation (keyed by the annotation id).
 *  A thread is created by the first `addComment` for an annotation; later
 *  calls append replies to the same thread. An annotation with no thread has
 *  no comment icon in the UI. */
export interface CommentThread {
  annotationId: string;
  entries: CommentEntry[];
}

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
  /** Phase 28 — the document's comment threads (one per annotated element
   *  that has comments). Always present on a state built by the engine
   *  (empty array when the document has no comments). Persisted in the PDF
   *  under the private catalog key `/TFlexComments`, so threads survive
   *  save/reopen. Deleting an annotation drops its thread. */
  comments?: CommentThread[];
  /** DEF-292 — present only on the result of `undo`/`redo` of a JOINT
   *  cross-document move: the OTHER document's updated state, so the
   *  renderer can refresh both panes from one round-trip. Absent on every
   *  single-document op's state. */
  pairedState?: PairedEngineState;
}

/** DEF-292 — the other document's state carried alongside a joint
 *  cross-document undo/redo (see `EngineState.pairedState`). */
export interface PairedEngineState {
  docId: string;
  state: EngineState;
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
  | 'not-found'
  /** Phase 32 — the source and target of a cross-document move are the
   *  same document id (a document must never occupy both panes). */
  | 'same-document';

// ---------------------------------------------------------------------------
// Phase 52 — encrypted PDF support (engine half)
// ---------------------------------------------------------------------------

/** Phase 52 — typed password failures on the EDIT open path, mirroring
 *  pdf.js's `PasswordResponses.NEED_PASSWORD` / `INCORRECT_PASSWORD` so the
 *  display path (pdf.js) and the edit path (this engine) speak the same
 *  language. `need-password` means no/empty password was supplied and the
 *  document requires one; `incorrect-password` means the supplied password
 *  did not open the document. */
export type PasswordError = 'need-password' | 'incorrect-password';

/** Phase 52 — the EDIT open path's error codes: `open-error` covers every
 *  non-password failure (io/parse/0-page); the password codes are typed so
 *  the renderer can prompt and retry rather than showing a generic failure. */
export type EngineOpenError = 'open-error' | PasswordError;

/** Phase 52 — the cipher offered when CREATING an encrypted PDF. AES-256 is
 *  the default; AES-128 is the compatibility option. RC4 is never offered
 *  for writing (legacy RC4 files remain openable). */
export type EncryptAlgorithm = 'aes-256' | 'aes-128';

/** Phase 52 — the eight permission toggles the Create-encrypted dialog
 *  exposes. These are DISPLAY/WRITE metadata only: the app does not enforce
 *  them, it records what the document asks. */
export interface EncryptPermissions {
  print: boolean;
  highResPrint: boolean;
  copy: boolean;
  accessibleCopy: boolean;
  modify: boolean;
  comment: boolean;
  assemble: boolean;
  fillForms: boolean;
}

/** Phase 52 — the Create-encrypted dialog's remembered defaults. */
export interface EncryptDefaults {
  algorithm: EncryptAlgorithm;
  permissions: EncryptPermissions;
}

/** Phase 54 — remembered defaults for raster/TIFF image import. Mirrors the
 *  `ConvertOptions` image block one-for-one. */
export interface ImageImportDefaults {
  pageSizeMode: 'image' | 'fixed';
  fixedPageSize: 'a4' | 'letter';
  fit: 'contain' | 'cover' | 'actual';
  rotationDeg: 0 | 90 | 180 | 270;
}

/** Phase 54 — remembered defaults for PDF/A and PDF/X validation. This chunk
 *  only stores and validates the shape; the validation behaviour itself is a
 *  later chunk. */
export interface PdfValidationDefaults {
  target: 'none' | 'pdfa-1b' | 'pdfa-2b' | 'pdfa-3b' | 'pdfx-1a' | 'pdfx-3' | 'pdfx-4';
  onViolation: 'warn' | 'block';
}

/** Phase 55 — remembered defaults for the bidirectional office conversion
 *  program. Three nested blocks: spreadsheet pagination, presentation notes,
 *  and export toggles. `orientation` drives spreadsheet page orientation;
 *  `includeImages` drives image embedding on export. */
export interface OfficeConvertDefaults {
  spreadsheets: {
    gridlines: boolean;
    fitToWidth: boolean;
    orientation: 'auto' | 'portrait' | 'landscape';
  };
  presentations: {
    includeNotes: boolean;
  };
  exports: {
    includeImages: boolean;
  };
}

/** Phase 54 — the documented image-import defaults a missing
 *  `imageImportDefaults` resolves to. */
export const DEFAULT_IMAGE_IMPORT_DEFAULTS: ImageImportDefaults = {
  pageSizeMode: 'image',
  fixedPageSize: 'a4',
  fit: 'contain',
  rotationDeg: 0,
};

/** Phase 54 — the documented validation defaults a missing
 *  `pdfValidationDefaults` resolves to. */
export const DEFAULT_PDF_VALIDATION_DEFAULTS: PdfValidationDefaults = {
  target: 'none',
  onViolation: 'warn',
};

/** Phase 55 — the documented office-conversion defaults a missing
 *  `officeConvertDefaults` resolves to. */
export const DEFAULT_OFFICE_CONVERT_DEFAULTS: OfficeConvertDefaults = {
  spreadsheets: { gridlines: true, fitToWidth: true, orientation: 'auto' },
  presentations: { includeNotes: false },
  exports: { includeImages: true },
};

/** Phase 52 — payload for `encryptDocument`. `userPassword` is required (the
 *  file must prompt for something); `ownerPassword` is optional and defaults
 *  to the user password; `algorithm` defaults to `aes-256`; an omitted or
 *  partial `permissions` defaults every toggle to allowed. */
export interface EncryptDocumentOptions {
  userPassword: string;
  ownerPassword?: string;
  algorithm?: EncryptAlgorithm;
  permissions?: Partial<EncryptPermissions>;
}

/** Phase 52 — the cipher read back from an opened encrypted document, in the
 *  app's own vocabulary. */
export type ProtectionAlgorithm = 'AES-256' | 'AES-128' | 'RC4-128' | 'RC4-40' | 'unknown';

/** Phase 52 — the truthful protection state of an opened document: the raw
 *  encryption dictionary values (`/V`, `/R`, `/CFM`) plus the derived
 *  algorithm and the permission flags read from `/P`. Display-only. */
export interface DocumentProtectionState {
  encrypted: true;
  /** `/V` — encryption algorithm version (1, 2, 4 or 5). */
  v: number;
  /** `/R` — security handler revision. */
  r: number;
  /** `/CFM` from `/CF`/`/StmF` (e.g. `AESV3`, `AESV2`, `V2`); '' when the
   *  document predates crypt filters (`/V` 1-2). */
  cfm: string;
  algorithm: ProtectionAlgorithm;
  permissions: EncryptPermissions;
}

/** Phase 52 — `getDocumentProtection` returns the state for an encrypted
 *  document, `null` for an unencrypted one. */
export type DocumentProtection = DocumentProtectionState | null;


/**
 * Phase 32 (Multi Mode) — payload for one atomic cross-document page move
 * or copy. `pages` are 0-based VISIBLE-order indices in the SOURCE
 * document (`fromDocId`), i.e. indices into `EngineState.pageOrder`.
 * `atIndex` is the insertion index in the TARGET's visible order, with
 * `-1` meaning "append" (the same convention as `insertFromPdf`).
 * `mode` is `'move'` (source loses the pages) or `'copy'` (source is left
 * untouched). Multiple pages keep their relative order.
 */
export interface MovePagesBetweenDocsPayload {
  fromDocId: string;
  pages: number[];
  toDocId: string;
  atIndex: number;
  mode: 'move' | 'copy';
}

/**
 * Phase 32 — both documents' post-operation states from one round-trip so
 * the renderer can refresh both panes/proxies without a second call.
 */
export interface MovePagesBetweenDocsResult {
  from: EngineState;
  to: EngineState;
}

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
  | 'white'
  // DEF-260: the renderer palette's pink/teal/gray, now canonical so both
  // sides accept the same set. Membership + RGB live in
  // src/shared/annotationColors.ts; this union must mirror it.
  | 'pink'
  | 'teal'
  | 'gray';

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

/** Phase 24 follow-up — the annotation text style: the Phase-21
 *  `TextStyleFields` plus the font family + point size the text-box/callout
 *  tools expose. Kept as an extension ALIAS rather than widening
 *  `TextStyleFields` itself, so the edit-text-run / text-box contracts that
 *  share that interface are untouched. Absent `font`/`size` keep the legacy
 *  Helvetica 12 appearance, exactly like an absent style. */
export type AnnTextStyle = Omit<TextStyleFields, 'highlight'> & {
  /** StandardFont family. Validated against the `EditFont` allowlist. */
  font?: EditFont;
  /** Point size. Finite, `1..2000` (the Phase-21 text-size bounds). */
  size?: number;
  /** Band behind each line's ink. A colour draws/replaces the band; `null`
   *  explicitly REMOVES it (the annotation clear-highlight path); absent
   *  preserves the stored band. Mirrors `TextBoxStylePatch.highlight`. The
   *  base `TextStyleFields.highlight` stays `EditColor` for every other
   *  payload/model. */
  highlight?: EditColor | null;
};

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
  /** Phase 24 — text style fields for the text-bearing kinds (text-box,
   *  callout, note). Absent means the legacy appearance: Helvetica 12,
   *  left-aligned, default line height. The baked FreeText /AP stream and
   *  the round-trip sentinel on /Contents both read this. See
   *  `AnnTextStyle`. */
  style?: AnnTextStyle;
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
  /** Phase 24 — optional text style fields for text-bearing kinds.
   *  Validated preserve-if-valid / reject-if-invalid with the Phase-21
   *  `validateTextStyleFields` (plus the `font`/`size` extension); absent
   *  leaves the annotation unstyled. */
  style?: AnnTextStyle;
}

/** Payload the renderer sends over IPC for editAnnotation. */
export interface EditAnnotationPayload {
  color?: string;
  text?: string;
  content?: string;
  /** Phase 28 — geometry patch. When supplied, the engine regenerates
   *  `rects[0]` from it (exactly like `CreateAnnotationPayload.rect` does on
   *  the create path, preserving any extra rects beyond [0] for multi-rect
   *  kinds) so a move / auto-grow is ONE op with ONE undo snapshot instead of
   *  delete + re-create. Validated with the same positive-size rule as create;
   *  a malformed rect rejects the whole edit with a typed `engine-error`.
   *  Absent preserves the stored geometry. */
  rect?: AnnRect;
  /** DEF-267 — ink stroke geometry patch. When supplied, the engine replaces
   *  the stored `points` and regenerates `rects[0]` from the points' min/max
   *  extent (exactly like `normalizeAnnotationPayload`'s ink branch on the
   *  create path, preserving any extra rects beyond [0]) so an ink move is
   *  ONE op with ONE undo snapshot instead of delete + re-create. Only valid
   *  for `kind === 'ink'`: a `points` patch on any other kind rejects the
   *  whole edit with a typed `engine-error`. Validated like the create path
   *  (every point finite non-negative, at least two points) plus a bounded
   *  length of `MAX_EDIT_INK_POINTS`. Absent preserves the stored geometry. */
  points?: AnnPoint[];
  /** DEF-267 — the note icon anchor AND the callout leader anchor patch.
   *  For a note the engine also regenerates `rects[0]` as the 24x24 icon rect
   *  at `at` (exactly like the create path's `at` branch, preserving any
   *  extra rects beyond [0]); for a callout it updates the stored `at` and,
   *  when the annotation carries an explicit leader, re-aims its last point.
   *  Only valid for `kind === 'note'` or `kind === 'callout'`; on any other
   *  kind it rejects the whole edit with a typed `engine-error`. A finite
   *  `{ x, y }` point. Absent preserves the stored anchor. */
  at?: AnnPoint;
  /** DEF-267 — arrow start endpoint. Must be supplied together with `to`,
   *  and only on `kind === 'arrow'`; the engine replaces the stored `points`
   *  with `[from, to]` and regenerates `rects[0]` from the endpoints' bbox
   *  (mirroring the create path's arrow branch). A lone `from`/`to`, or
   *  either on a non-arrow kind, rejects the whole edit with a typed
   *  `engine-error`. Absent preserves the stored geometry. */
  from?: AnnPoint;
  /** DEF-267 — arrow end endpoint. See `from`. */
  to?: AnnPoint;
  /** Phase 24 — partial text-style patch. Every supplied field is validated
   *  (reject-if-invalid) and merged onto the stored `AnnModel.style`; absent
   *  fields preserve the stored value (same semantics as the Phase-21
   *  `updateTextBox` patch). Carries the `font`/`size` extension too. */
  style?: AnnTextStyle;
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
 *  the Phase 10 report for the feasibility limit.
 *
 *  Phase 27 — the allowlist grows with the OFL font families bundled under
 *  `assets/fonts/` (see `src/main/services/fonts.ts`). A bundled family is
 *  embedded as a subset on demand; an unreadable font file fails loud with
 *  a typed engine-error (never a silent substitution). */
export type EditFont =
  | 'Helvetica'
  | 'Times'
  | 'Courier'
  | 'Liberation Sans'
  | 'DejaVu Serif'
  | 'DejaVu Sans Mono';

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
  /** Phase 27 — character spacing (tracking): extra space inserted between
   *  glyphs, in points, emitted as the `Tc` text-state operator inside the
   *  text object. Default `0` = no extra tracking (the operator is not
   *  emitted, so legacy streams stay byte-identical). Positive loosens,
   *  negative tightens. Validated to `-5..20`. */
  charSpacing?: number;
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

/** Phase 51 — result of `engine.ocrCancel`. `cancelled` is true when an
 *  in-flight OCR run on the doc was flagged for cancellation; false when
 *  there was no run in flight (cancel-before-start or cancel-after-finish),
 *  which is a harmless no-op. A cancelled run makes the pending
 *  `ocrRecognize` resolve with `error.code === 'cancelled'` after restoring
 *  the pre-run snapshot. */
export interface OcrCancelResult {
  cancelled: boolean;
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
  | 'menu.print'
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

// ---- Phase 30: print ----

/** Phase 30 — one OS printer as reported to the print dialog. `name` is the
 *  SYSTEM device name (what `webContents.print({ deviceName })` expects);
 *  `displayName` is the friendly name shown in the picker. `status` is the
 *  raw Electron/OS status code, present only when the platform reports one. */
export interface PrinterInfo {
  name: string;
  displayName: string;
  isDefault: boolean;
  status?: number;
}

/** Phase 30 — page scaling mode: 'fit' scales the page to the paper (up or
 *  down), 'actual' prints at 100%, 'shrink' only downscales oversized pages,
 *  'custom' applies `scalePercent`. */
export type PrintScaling = 'fit' | 'actual' | 'shrink' | 'custom';

/** Phase 30 — duplex mode mapped to Electron's `duplexMode`. */
export type PrintDuplex = 'simplex' | 'shortEdge' | 'longEdge';

/** Phase 30 — N-up page order within a sheet. */
export type PrintPageOrder =
  | 'horizontal'
  | 'horizontalReversed'
  | 'vertical'
  | 'verticalReversed';

/** Phase 30 — per-print settings chosen in the print dialog (never persisted;
 *  presets are session-level). `pageRanges` are 0-based inclusive, matching
 *  Electron's `pageRanges`. `oddEven` / `reverse` / `printAnnotations` /
 *  `pageOrder` are applied by the RENDERER when it composes the ordered image
 *  list; `paperSource` is carried for the driver but has no Electron print
 *  option (see print.ts). */
export interface PrintSettings {
  deviceName?: string;
  copies?: number;
  collate?: boolean;
  pageRanges?: { from: number; to: number }[];
  scaling?: PrintScaling;
  scalePercent?: number;
  landscape?: boolean;
  duplex?: PrintDuplex;
  color?: boolean;
  pagesPerSheet?: number;
  pageOrder?: PrintPageOrder;
  oddEven?: 'all' | 'odd' | 'even';
  reverse?: boolean;
  printAnnotations?: boolean;
  paperSource?: string;
}

/** Phase 30 — one print request. `images` are data URLs (one per composed
 *  page), already ordered/selected by the renderer (page range, odd/even,
 *  reverse and N-up order applied there). Main composes them into a print
 *  document and sends it to the chosen device. */
export interface PrintJobPayload {
  images: string[];
  settings: PrintSettings;
}

/**
 * Phase 30 / Phase 35 — result of a print request.
 *
 *  - `{ ok: true }` / `{ ok: true, outcome: 'printed' }` — sent to a real
 *    (non-PDF) printer. An absent `outcome` means 'printed' (backward
 *    compatible with pre-Phase-35 callers/tests).
 *  - `{ ok: true, outcome: 'saved', path }` — the virtual-PDF destination:
 *    TFlex produced the PDF itself and wrote it to `path` via the app's own
 *    Save-As dialog. No OS/Chromium print window appeared.
 *  - `{ ok: false, reason }` — a real failure, OR a user cancellation. A
 *    cancel is reported as a reason matching `/cancel/i` (Phase 35 uses
 *    `'save-cancelled'`), which the dialog treats as a quiet no-op. The
 *    renderer should distinguish printed vs saved via `outcome`, and a cancel
 *    via the existing cancel-reason rule. A failure always carries a reason
 *    (a typed `PrintErrorReason` literal or the OS `failureReason` string) —
 *    never a silent no-op.
 */
export type PrintJobResult =
  | { ok: true; outcome?: 'printed' }
  | { ok: true; outcome: 'saved'; path: string }
  | { ok: false; reason: string };

/**
 * Phase 35 - the small context the standalone print window is opened with
 * (`?tfWindow=print&context=...`). Main validates it before creating the
 * window: a malformed payload fails loud (`PrintWindowOpenResult.ok = false`)
 * rather than rendering a broken print UI. The payload deliberately carries
 * only what the print window needs to fetch the document and seed its
 * controls - the print settings travel as the SAME `PrintSettings` shape the
 * in-app dialog and `printJob` already use, so the two paths cannot drift.
 */
export interface PrintWindowContext {
  /** The engine document id the print window prints. */
  docId: string;
  /** Display name shown in the window heading. */
  documentName: string;
  /** Total page count (validated to a sane, non-negative integer). */
  pageCount: number;
  /** The current print dialog settings, as a JSON payload. */
  settings: PrintSettings;
}

/** Phase 35 - result of asking main to open (or focus) the print window. */
export type PrintWindowOpenResult =
  | { ok: true; /** true when a new window was created, false when focused. */ created: boolean }
  | { ok: false; /** human-readable validation/creation failure. */ reason: string };