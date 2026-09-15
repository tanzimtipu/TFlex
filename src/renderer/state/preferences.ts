// Phase 6 — preferences reducer.
//
// The Preferences sheet writes to a stable slice of `AppSettings`. Most
// of these are "set a value" operations on optional fields; the reducer
// returns a new AppSettings object only when the requested change actually
// moves the value, so `saveSettings()` doesn't churn on every keystroke.
//
// The renderer treats these fields as authoritative — the backend's
// settings service normalises them on the way in (e.g. clamping the recents
// cap to [1, 50]), so the renderer doesn't re-validate at write time.

import type {
  AppSettings,
  EditFont,
  ExportImageFormat,
  OcrLanguage,
  OptimizePreset,
  StampId,
} from '../../shared/types';

export const MIN_RECENTS_CAP = 1;
export const MAX_RECENTS_CAP = 50;
export const DEFAULT_RECENTS_CAP = 10;

// DEF-212 — 'frosted' joins the theme-default set so the
// Preferences dropdown offers all three concrete themes plus the
// 'system' meta-option. Mirrors the AppSettings.themeDefault union
// in shared/types.ts.
export type ThemeDefault = 'light' | 'dark' | 'system' | 'frosted';

export type PreferencesAction =
  | { type: 'set-theme-default'; value: ThemeDefault }
  | { type: 'set-recents-cap'; value: number }
  | { type: 'set-tools-palette-layout'; value: 'list' | 'grid' }
  | { type: 'set-optimize-preset'; value: OptimizePreset }
  | { type: 'set-export-image-format'; value: ExportImageFormat }
  | { type: 'set-export-image-dpi'; value: number }
  | { type: 'set-create-image-quality'; value: number }
  | { type: 'set-edit-default-font'; value: EditFont }
  | { type: 'set-ocr-language'; value: OcrLanguage }
  | { type: 'set-ocr-downsample'; value: number }
  | { type: 'set-default-stamp-id'; value: StampId }
  | { type: 'set-save-as-linearize'; value: boolean };

/** Default compression preset used by the Optimize dialog when the
 *  user hasn't picked one yet. Matches the backend settings.ts default
 *  ('none' = linearized, no compression — the safest baseline so a
 *  first-time Optimize pass never accidentally downsamples images).
 *  The user's choice lives in AppSettings.optimizePreset and survives
 *  restarts via the settings.json preserve-if-valid pipeline. */
export const DEFAULT_OPTIMIZE_PRESET: OptimizePreset = 'none';

/** Render-side allowlist for OptimizePreset. Mirrors the shared type
 *  and the backend's settings.ts validation. Keeping the allowlist in
 *  one place lets the dialog pre-validate user input without importing
 *  the shared type's underlying Zod-style union machinery. */
export const OPTIMIZE_PRESETS: readonly OptimizePreset[] = ['none', 'compact', 'max'];

// ---- Phase 9: Create + Export ----

/** Default export image format. The backend's settings.ts validates
 *  the field against the same allowlist (preserve-if-valid). */
export const DEFAULT_EXPORT_IMAGE_FORMAT: ExportImageFormat = 'png';

/** Render-side allowlist for ExportImageFormat. Mirrors the shared
 *  type and the backend's settings.ts validation. Includes TIFF —
 *  the renderer encodes TIFF pages through the engine path (see
 *  `rasterizePageToBlob`); the canvas path falls back to PNG bytes
 *  with a `.tif` extension when the backend isn't ready. */
export const EXPORT_IMAGE_FORMATS: readonly ExportImageFormat[] = ['png', 'jpeg', 'tiff'];

/** Default export DPI. 150 DPI matches the spec's default and is the
 *  common baseline for screen + e-paper PDFs. The backend clamps the
 *  stored value to [MIN_EXPORT_IMAGE_DPI, MAX_EXPORT_IMAGE_DPI];
 *  the renderer mirrors the same range. */
export const DEFAULT_EXPORT_IMAGE_DPI = 150;
export const MIN_EXPORT_IMAGE_DPI = 72;
export const MAX_EXPORT_IMAGE_DPI = 600;

/** Clamp an export-image-DPI candidate to [72, 600]. Public so
 *  the Export dialog can pre-validate user input before dispatch. */
export function clampExportImageDpi(value: number): number {
  return Math.max(
    MIN_EXPORT_IMAGE_DPI,
    Math.min(MAX_EXPORT_IMAGE_DPI, Math.round(value)),
  );
}

/** Default JPEG quality for create-from-images (the engine's encode
 *  pass for non-PNG outputs). 0.85 is the spec's baseline and matches
 *  what most photo editors ship as a default. Stored as a fraction
 *  (0..1) so the wire shape matches the backend's
 *  `normalizeSettings` validation in `src/main/services/settings.ts`
 *  (preserve-if-valid rejects anything outside [0, 1] — see DEF-047
 *  for the regression this fixed). */
export const DEFAULT_CREATE_IMAGE_QUALITY = 0.85;
export const MIN_CREATE_IMAGE_QUALITY = 0;
export const MAX_CREATE_IMAGE_QUALITY = 1;

/** Clamp a create-image-quality candidate to [0, 1]. Public so
 *  the Create dialog can pre-validate user input before dispatch.
 *  Values are rounded to 3 decimal places so the renderer never
 *  persists a noisy floating-point approximation (e.g. 0.8499999...). */
export function clampCreateImageQuality(value: number): number {
  const clamped = Math.max(
    MIN_CREATE_IMAGE_QUALITY,
    Math.min(MAX_CREATE_IMAGE_QUALITY, value),
  );
  // Round to 3 decimal places — fine enough for any JPEG quality
  // slider, coarse enough to keep settings.json readable.
  return Math.round(clamped * 1000) / 1000;
}

/** Convert a quality fraction (0..1) to a 0..100 percentage for
 *  display in the Create dialog's input. The persisted value is the
 *  fraction; the UI shows the percentage so the user understands
 *  "85" the way photo apps usually render it. */
export function qualityFractionToPercent(value: number): number {
  return Math.round(clampCreateImageQuality(value) * 100);
}

/** Inverse of `qualityFractionToPercent`. Clamps + rounds so the
 *  round-trip through display -> edit -> display stays stable. */
export function qualityPercentToFraction(value: number): number {
  return clampCreateImageQuality(value / 100);
}

export function preferencesReducer(
  state: AppSettings,
  action: PreferencesAction,
): AppSettings {
  switch (action.type) {
    case 'set-theme-default': {
      const current: ThemeDefault = state.themeDefault ?? 'dark';
      if (current === action.value) return state;
      return { ...state, themeDefault: action.value };
    }
    case 'set-recents-cap': {
      const clamped = Math.max(
        MIN_RECENTS_CAP,
        Math.min(MAX_RECENTS_CAP, Math.floor(action.value)),
      );
      const current = state.recentsCap ?? DEFAULT_RECENTS_CAP;
      if (current === clamped) return state;
      return { ...state, recentsCap: clamped };
    }
    case 'set-tools-palette-layout': {
      const current = state.toolsPaletteLayout ?? 'list';
      if (current === action.value) return state;
      return { ...state, toolsPaletteLayout: action.value };
    }
    case 'set-optimize-preset': {
      const current: OptimizePreset = state.optimizePreset ?? DEFAULT_OPTIMIZE_PRESET;
      if (current === action.value) return state;
      return { ...state, optimizePreset: action.value };
    }
    case 'set-export-image-format': {
      // Allowlist guard: an unknown value is dropped (preserve-if-valid).
      if (!EXPORT_IMAGE_FORMATS.includes(action.value)) return state;
      // Compare against the actual stored value (undefined when the
      // user hasn't picked one). The default lives in AppSettings
      // reads, not in persistence — the first user-driven write
      // always materialises the field, even when the value matches
      // the default.
      const current = state.exportImageFormat;
      if (current === action.value) return state;
      return { ...state, exportImageFormat: action.value };
    }
    case 'set-export-image-dpi': {
      const clamped = clampExportImageDpi(action.value);
      const current = state.exportImageDpi;
      if (current === clamped) return state;
      return { ...state, exportImageDpi: clamped };
    }
    case 'set-create-image-quality': {
      const clamped = clampCreateImageQuality(action.value);
      const current = state.createImageQuality;
      if (current === clamped) return state;
      return { ...state, createImageQuality: clamped };
    }
    case 'set-edit-default-font': {
      // Allowlist guard: drop anything the backend wouldn't accept.
      // Mirrors the backend's settings.ts EditFont validation; the
      // wire shape is `'Helvetica' | 'Times' | 'Courier'`.
      if (!EDIT_DEFAULT_FONTS.includes(action.value)) return state;
      const current = state.editDefaultFont;
      if (current === action.value) return state;
      return { ...state, editDefaultFont: action.value };
    }
    case 'set-ocr-language': {
      // Allowlist guard: drop anything the backend wouldn't accept.
      // Mirrors the backend's settings.ts OCR_LANGUAGES allowlist.
      if (!OCR_LANGUAGES.includes(action.value)) return state;
      const current = state.ocrLanguage;
      if (current === action.value) return state;
      return { ...state, ocrLanguage: action.value };
    }
    case 'set-ocr-downsample': {
      const clamped = clampOcrDownsample(action.value);
      const current = state.ocrDownsample;
      if (current === clamped) return state;
      return { ...state, ocrDownsample: clamped };
    }
    case 'set-default-stamp-id': {
      // Allowlist guard: drop anything the backend wouldn't accept.
      // Mirrors the backend's settings.ts STAMP_IDS allowlist; the
      // wire shape is `StampId = 'APPROVED' | 'DRAFT' | 'CONFIDENTIAL' | 'FINAL'`.
      if (!STAMP_IDS.includes(action.value)) return state;
      const current = state.defaultStampId;
      if (current === action.value) return state;
      return { ...state, defaultStampId: action.value };
    }
    case 'set-save-as-linearize': {
      // DEF-073 — Save-As linearize choice now lives on its own
      // boolean field rather than piggy-backing on `optimizePreset`
      // (which the Optimize dialog owns). The reducer treats
      // `undefined` as the default (linearize off) so the equality
      // guard correctly short-circuits the first-time write when
      // the user starts with the field absent and toggles to the
      // same value the default already produces.
      const current = state.saveAsLinearize ?? false;
      if (current === action.value) return state;
      return { ...state, saveAsLinearize: action.value };
    }
  }
}

/** Default for the Save-As "Fast web view (linearize)" toggle.
 *  Matches the default the Save-As dialog seeds its checkbox with
 *  when the AppSettings field is absent. The backend
 *  `normalizeSettings` mirrors the same default for new installs. */
export const DEFAULT_SAVE_AS_LINEARIZE = false;

// ---- Phase 10: Edit-content default font ----
//
// The Phase 10 Edit tools (text run edit, text box) need a default
// font to seed the inline editor. The backend's settings.ts
// preserves only the three pdf-lib Standard fonts that map cleanly
// to WinAnsiEncoding (see shared/types.ts `EditFont`). Anything
// else is dropped on save — the renderer mirrors the same allowlist
// so the Edit toolbar never shows a font choice the backend would
// reject.
export const EDIT_DEFAULT_FONTS: readonly EditFont[] = ['Helvetica', 'Times', 'Courier'];
export const DEFAULT_EDIT_DEFAULT_FONT: EditFont = 'Helvetica';

/** Clamp a recents-cap candidate to the supported range. Public so the
 *  Preferences sheet can pre-validate the input before dispatch. */
export function clampRecentsCap(value: number): number {
  return Math.max(
    MIN_RECENTS_CAP,
    Math.min(MAX_RECENTS_CAP, Math.floor(value)),
  );
}

// ---- Phase 11: OCR ----

/** Render-side allowlist for OCR languages. Mirrors the shared
 *  `OcrLanguage` union and the backend's `OCR_LANGUAGES` list in
 *  `src/main/services/settings.ts`. The renderer uses this to populate
 *  the language picker; the reducer uses it for preserve-if-valid
 *  validation. The full allowlist is nine ISO-639 codes for which
 *  traineddata can be bundled offline in `assets/tessdata/`. Only
 *  `eng` ships by default (size budget). */
export const OCR_LANGUAGES: readonly OcrLanguage[] = [
  'eng',
  'deu',
  'fra',
  'spa',
  'ita',
  'por',
  'rus',
  'chi_sim',
  'jpn',
];

/** Default OCR language. Matches the backend's settings.ts default. */
export const DEFAULT_OCR_LANGUAGE: OcrLanguage = 'eng';

/** Default OCR downsample DPI. Matches the backend's settings.ts default. */
export const DEFAULT_OCR_DOWNSAMPLE = 300;
export const MIN_OCR_DOWNSAMPLE = 72;
export const MAX_OCR_DOWNSAMPLE = 600;

/** Clamp an OCR-downsample candidate to [72, 600]. Public so the
 *  OCR dialog can pre-validate user input before dispatch. */
export function clampOcrDownsample(value: number): number {
  return Math.max(
    MIN_OCR_DOWNSAMPLE,
    Math.min(MAX_OCR_DOWNSAMPLE, Math.round(value)),
  );
}

// ---- Phase 12: Stamp default id ----

/** Render-side allowlist for built-in stamp ids. Mirrors the shared
 *  `StampId` union and the backend's STAMP_IDS list in
 *  `src/main/services/settings.ts`. The renderer uses this to
 *  populate the stamp picker and the preferences reducer uses it
 *  for preserve-if-valid validation. Matches `STAMP_IDS` in
 *  `src/renderer/annotations/stampRender.ts` (the latter is the
 *  visual-config side; this is the preferences-allowlist side). */
export const STAMP_IDS: readonly StampId[] = [
  'APPROVED',
  'DRAFT',
  'CONFIDENTIAL',
  'FINAL',
];

/** Default stamp id used by the Stamp tool when the user hasn't
 *  picked one. Matches the backend's settings.ts default. */
export const DEFAULT_STAMP_ID: StampId = 'APPROVED';