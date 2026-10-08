// test-fixtures/tfl1280-adversary/probe-restore-history.mjs
import { mkdtemp, readFile as readFile2, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// src/main/services/settings.ts
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

// src/shared/result.ts
function ok(value) {
  return { ok: true, value };
}
function err(code, message2) {
  return { ok: false, error: { code, message: message2 ?? code } };
}

// src/shared/convert.ts
var DEFAULT_CONVERT_DEFAULTS = {
  pageSize: "a4",
  marginMm: 20,
  textFontFamily: "Inter",
  textFontSizePt: 11,
  csvDelimiter: "auto",
  csvFormMapping: true,
  htmlPrintBackgrounds: true
};

// src/shared/types.ts
var DEFAULT_IMAGE_IMPORT_DEFAULTS = {
  pageSizeMode: "image",
  fixedPageSize: "a4",
  fit: "contain",
  rotationDeg: 0
};
var DEFAULT_PDF_VALIDATION_DEFAULTS = {
  target: "none",
  onViolation: "warn"
};
var DEFAULT_OFFICE_CONVERT_DEFAULTS = {
  spreadsheets: { gridlines: true, fitToWidth: true, orientation: "auto" },
  presentations: { includeNotes: false },
  exports: { includeImages: true }
};
var DEFAULT_READING_DEFAULTS = {
  epub: { fontSizePt: 16, lineHeight: 1.5, theme: "light" },
  comics: { layout: "single", fit: "height", rightToLeft: false }
};

// src/main/services/text-style.ts
var STANDARD_EDIT_FONTS = ["Helvetica", "Times", "Courier"];
var BUNDLED_EDIT_FONTS = [
  "Liberation Sans",
  "DejaVu Serif",
  "DejaVu Sans Mono"
];
var EDIT_FONTS = [...STANDARD_EDIT_FONTS, ...BUNDLED_EDIT_FONTS];
function isEditFont(v) {
  return typeof v === "string" && EDIT_FONTS.includes(v);
}

// src/shared/sanitize.ts
var SANITIZE_CLASSES = [
  "javascript",
  "launchActions",
  "embeddedFiles",
  "metadata"
];
var DEFAULT_SANITIZE_OPTIONS = {
  javascript: true,
  launchActions: true,
  embeddedFiles: true,
  metadata: true
};
function normalizeSanitizeOptions(raw) {
  const out = { ...DEFAULT_SANITIZE_OPTIONS };
  if (raw !== null && typeof raw === "object") {
    const obj = raw;
    for (const key of SANITIZE_CLASSES) {
      if (typeof obj[key] === "boolean") out[key] = obj[key];
    }
  }
  return out;
}

// src/shared/bates.ts
var MIN_BATES_PADDING = 1;
var MAX_BATES_PADDING = 64;
var BATES_POSITIONS = [
  "top-left",
  "top-center",
  "top-right",
  "center-left",
  "center",
  "center-right",
  "bottom-left",
  "bottom-center",
  "bottom-right"
];
var DEFAULT_BATES_DEFAULTS = {
  prefix: "",
  suffix: "",
  startNumber: 1,
  padding: 6,
  position: "bottom-right"
};
function validStartNumber(v) {
  return typeof v === "number" && Number.isInteger(v) && v >= 1;
}
function validPadding(v) {
  return typeof v === "number" && Number.isInteger(v) && v >= MIN_BATES_PADDING && v <= MAX_BATES_PADDING;
}
function validPosition(v) {
  return typeof v === "string" && BATES_POSITIONS.includes(v);
}
function normalizeBatesDefaults(raw) {
  const out = { ...DEFAULT_BATES_DEFAULTS };
  if (raw !== null && typeof raw === "object") {
    const r = raw;
    if (typeof r.prefix === "string") out.prefix = r.prefix;
    if (typeof r.suffix === "string") out.suffix = r.suffix;
    if (validStartNumber(r.startNumber)) out.startNumber = r.startNumber;
    if (validPadding(r.padding)) out.padding = r.padding;
    if (validPosition(r.position)) out.position = r.position;
  }
  return out;
}

// src/main/services/settings.ts
var RECENT_FILES_CAP = 10;
var MIN_WINDOW_WIDTH = 640;
var MIN_WINDOW_HEIGHT = 480;
var PANEL_LEFT_WIDTH_MIN = 240;
var PANEL_LEFT_WIDTH_MAX = 420;
var NAVIGATOR_LAYOUTS = ["stacked", "split"];
var NAVIGATOR_SPLIT_RATIO_MIN = 0.1;
var NAVIGATOR_SPLIT_RATIO_MAX = 0.9;
var PANEL_RIGHT_WIDTH_MIN = 260;
var PANEL_RIGHT_WIDTH_MAX = 380;
var OCR_LANGUAGES = [
  "eng",
  "deu",
  "fra",
  "spa",
  "ita",
  "por",
  "rus",
  "chi_sim",
  "jpn"
];
var STAMP_IDS = ["APPROVED", "DRAFT", "CONFIDENTIAL", "FINAL"];
var ANNOTATION_TOOL_IDS = [
  "select",
  "highlight",
  "underline",
  "strikeout",
  "ink",
  "textbox",
  "rect",
  "ellipse",
  "arrow",
  "note",
  "callout"
];
var ANNOTATION_RECENT_TOOLS_CAP = 6;
var DOCK_PINS_CAP = 200;
var TOOL_USAGE_CAP = 200;
var DOCK_UNPINNED_CAP = 200;
var DEFAULT_SETTINGS = {
  theme: "frosted",
  geometry: { x: 100, y: 100, width: 1440, height: 900, maximized: false },
  recentFiles: [],
  // Phase 44 (operator change): accounts ship ENABLED by default. This is the
  // single source of the default; `normalizeSettings` falls back to it for a
  // missing/invalid stored value, so a settings.json written before this
  // change (no `accountsEnabled` key) resolves to ON too.
  accountsEnabled: true,
  // Phase 58 (operator default): the Action Dock tabs ship COLORFUL. Single
  // source of the default; `normalizeSettings` resolves a missing/invalid
  // stored value to it (explicit-default, same shape as accountsEnabled).
  tabStyle: "colorful",
  // Phase 84 (True redaction) default mark colour. Single source of the
  // default; `normalizeSettings` resolves a missing/invalid stored value to
  // it (explicit-default, same shape as tabStyle).
  redactionColor: "#000000",
  // Phase 88 (FEA-037) sanitize class selection. Single source of the default;
  // `normalizeSettings` resolves a missing/invalid stored value to it
  // (explicit-default, same shape as redactionColor).
  sanitizeOptions: { ...DEFAULT_SANITIZE_OPTIONS },
  // Phase 89 (FEA-033) Bates-numbering defaults. Single source of the default;
  // `normalizeSettings` resolves a missing/invalid stored value to it
  // (explicit-default, same shape as sanitizeOptions).
  batesDefaults: { ...DEFAULT_BATES_DEFAULTS }
};
var SYNC_DEVICE_ID_MAX = 64;
var LAST_SYNCED_AT_MAX = 32;
var THEMES = ["light", "dark", "frosted"];
var TAB_STYLES = ["standard", "colorful"];
var HOME_TOOLS_CAP = 14;
var PRINT_PRESETS_CAP = 30;
var PRINT_PRESET_NAME_MAX = 40;
function normalizeGeometry(raw) {
  const d = DEFAULT_SETTINGS.geometry;
  if (raw === null || typeof raw !== "object") {
    return { ...d };
  }
  const g = raw;
  const num = (v, fallback) => typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return {
    x: num(g.x, d.x),
    y: num(g.y, d.y),
    width: Math.max(MIN_WINDOW_WIDTH, num(g.width, d.width)),
    height: Math.max(MIN_WINDOW_HEIGHT, num(g.height, d.height)),
    maximized: typeof g.maximized === "boolean" ? g.maximized : d.maximized
  };
}
function normalizeRecentFiles(raw, cap = RECENT_FILES_CAP) {
  if (!Array.isArray(raw)) {
    return [];
  }
  const files = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") {
      continue;
    }
    const r = entry;
    if (typeof r.path === "string" && typeof r.name === "string" && typeof r.openedAt === "string") {
      const file2 = { path: r.path, name: r.name, openedAt: r.openedAt };
      if (typeof r.sourceLabel === "string" && r.sourceLabel.length > 0) {
        file2.sourceLabel = r.sourceLabel;
      }
      if (typeof r.sourceKind === "string" && r.sourceKind.length > 0) {
        file2.sourceKind = r.sourceKind;
      }
      if (typeof r.converted === "boolean") {
        file2.converted = r.converted;
      }
      if (typeof r.pinned === "boolean") {
        file2.pinned = r.pinned;
      }
      if (r.workingFormat === "pdf") {
        file2.workingFormat = "pdf";
      }
      files.push(file2);
    }
  }
  const effectiveCap = Math.max(1, Math.min(50, cap));
  return files.slice(0, effectiveCap);
}
function normalizeAnnotationRecentTools(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    if (!ANNOTATION_TOOL_IDS.includes(entry)) continue;
    if (out.includes(entry)) continue;
    out.push(entry);
    if (out.length >= ANNOTATION_RECENT_TOOLS_CAP) break;
  }
  return out.length > 0 ? out : null;
}
function normalizeDockPins(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || entry.length === 0) continue;
    if (out.includes(entry)) continue;
    out.push(entry);
    if (out.length >= DOCK_PINS_CAP) break;
  }
  return out;
}
function normalizeDockUnpinned(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || entry.length === 0) continue;
    if (out.includes(entry)) continue;
    out.push(entry);
    if (out.length >= DOCK_UNPINNED_CAP) break;
  }
  return out;
}
function normalizeTabStyle(raw) {
  if (typeof raw !== "string") return null;
  return TAB_STYLES.includes(raw) ? raw : null;
}
var REDACTION_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
function normalizeRedactionColor(raw) {
  if (typeof raw !== "string") return null;
  return REDACTION_COLOR_PATTERN.test(raw) ? raw : null;
}
function normalizeBoundedWidth(raw, min, max) {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return raw >= min && raw <= max ? raw : null;
}
function normalizeHomeTools(raw) {
  if (!Array.isArray(raw)) return null;
  const out = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || entry.length === 0) continue;
    if (out.includes(entry)) continue;
    out.push(entry);
    if (out.length >= HOME_TOOLS_CAP) break;
  }
  return out;
}
function normalizeToolUsage(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const entries = [];
  for (const [key, value] of Object.entries(raw)) {
    if (key.length === 0) continue;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0) continue;
    entries.push([key, value]);
  }
  if (entries.length > TOOL_USAGE_CAP) {
    entries.sort((a, b) => b[1] - a[1]);
    entries.length = TOOL_USAGE_CAP;
  }
  const out = {};
  for (const [key, value] of entries) {
    out[key] = value;
  }
  return out;
}
var ENCRYPT_ALGORITHMS = ["aes-256", "aes-128"];
var ENCRYPT_PERMISSION_KEYS = [
  "print",
  "highResPrint",
  "copy",
  "accessibleCopy",
  "modify",
  "comment",
  "assemble",
  "fillForms"
];
var DEFAULT_ENCRYPT_PERMISSIONS = {
  print: true,
  highResPrint: true,
  copy: true,
  accessibleCopy: true,
  modify: true,
  comment: true,
  assemble: true,
  fillForms: true
};
function normalizeEncryptDefaults(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw;
  let algorithm;
  if (r.algorithm !== void 0) {
    if (typeof r.algorithm !== "string" || !ENCRYPT_ALGORITHMS.includes(r.algorithm)) {
      return null;
    }
    algorithm = r.algorithm;
  }
  let permissions;
  if (r.permissions !== void 0) {
    if (r.permissions === null || typeof r.permissions !== "object" || Array.isArray(r.permissions)) {
      return null;
    }
    const p = r.permissions;
    const out = { ...DEFAULT_ENCRYPT_PERMISSIONS };
    for (const key of ENCRYPT_PERMISSION_KEYS) {
      const value = p[key];
      if (value === void 0) continue;
      if (typeof value !== "boolean") return null;
      out[key] = value;
    }
    permissions = out;
  }
  if (algorithm === void 0 && permissions === void 0) return null;
  return {
    algorithm: algorithm ?? "aes-256",
    permissions: permissions ?? { ...DEFAULT_ENCRYPT_PERMISSIONS }
  };
}
var CONVERT_FONT_FAMILIES = [...EDIT_FONTS, "Inter"];
function normalizeConvertDefaults(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw;
  const out = { ...DEFAULT_CONVERT_DEFAULTS };
  let present = 0;
  if (r.pageSize !== void 0) {
    if (r.pageSize !== "a4" && r.pageSize !== "letter") return null;
    out.pageSize = r.pageSize;
    present += 1;
  }
  if (r.marginMm !== void 0) {
    if (typeof r.marginMm !== "number" || !Number.isFinite(r.marginMm) || r.marginMm < 5 || r.marginMm > 50) {
      return null;
    }
    out.marginMm = r.marginMm;
    present += 1;
  }
  if (r.textFontFamily !== void 0) {
    if (typeof r.textFontFamily !== "string" || !CONVERT_FONT_FAMILIES.includes(r.textFontFamily)) {
      return null;
    }
    out.textFontFamily = r.textFontFamily;
    present += 1;
  }
  if (r.textFontSizePt !== void 0) {
    if (typeof r.textFontSizePt !== "number" || !Number.isFinite(r.textFontSizePt) || r.textFontSizePt < 6 || r.textFontSizePt > 48) {
      return null;
    }
    out.textFontSizePt = r.textFontSizePt;
    present += 1;
  }
  if (r.csvDelimiter !== void 0) {
    if (typeof r.csvDelimiter !== "string" || !["auto", ",", ";", "	"].includes(r.csvDelimiter)) {
      return null;
    }
    out.csvDelimiter = r.csvDelimiter;
    present += 1;
  }
  for (const key of ["csvFormMapping", "htmlPrintBackgrounds"]) {
    if (r[key] !== void 0) {
      if (typeof r[key] !== "boolean") return null;
      out[key] = r[key];
      present += 1;
    }
  }
  if (present === 0) return null;
  return out;
}
var IMAGE_PAGE_SIZE_MODES = ["image", "fixed"];
var IMAGE_FITS = ["contain", "cover", "actual"];
var IMAGE_ROTATIONS = [0, 90, 180, 270];
function normalizeImageImportDefaults(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw;
  const out = { ...DEFAULT_IMAGE_IMPORT_DEFAULTS };
  let present = 0;
  if (r.pageSizeMode !== void 0) {
    if (typeof r.pageSizeMode !== "string" || !IMAGE_PAGE_SIZE_MODES.includes(r.pageSizeMode)) {
      return null;
    }
    out.pageSizeMode = r.pageSizeMode;
    present += 1;
  }
  if (r.fixedPageSize !== void 0) {
    if (r.fixedPageSize !== "a4" && r.fixedPageSize !== "letter") return null;
    out.fixedPageSize = r.fixedPageSize;
    present += 1;
  }
  if (r.fit !== void 0) {
    if (typeof r.fit !== "string" || !IMAGE_FITS.includes(r.fit)) {
      return null;
    }
    out.fit = r.fit;
    present += 1;
  }
  if (r.rotationDeg !== void 0) {
    if (typeof r.rotationDeg !== "number" || !IMAGE_ROTATIONS.includes(r.rotationDeg)) {
      return null;
    }
    out.rotationDeg = r.rotationDeg;
    present += 1;
  }
  if (present === 0) return null;
  return out;
}
var PDF_VALIDATION_TARGETS = [
  "none",
  "pdfa-1b",
  "pdfa-2b",
  "pdfa-3b",
  "pdfx-1a",
  "pdfx-3",
  "pdfx-4"
];
function normalizePdfValidationDefaults(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw;
  const out = { ...DEFAULT_PDF_VALIDATION_DEFAULTS };
  let present = 0;
  if (r.target !== void 0) {
    if (typeof r.target !== "string" || !PDF_VALIDATION_TARGETS.includes(r.target)) {
      return null;
    }
    out.target = r.target;
    present += 1;
  }
  if (r.onViolation !== void 0) {
    if (r.onViolation !== "warn" && r.onViolation !== "block") return null;
    out.onViolation = r.onViolation;
    present += 1;
  }
  if (present === 0) return null;
  return out;
}
var OFFICE_ORIENTATIONS = ["auto", "portrait", "landscape"];
function normalizeOfficeConvertDefaults(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw;
  const out = {
    spreadsheets: { ...DEFAULT_OFFICE_CONVERT_DEFAULTS.spreadsheets },
    presentations: { ...DEFAULT_OFFICE_CONVERT_DEFAULTS.presentations },
    exports: { ...DEFAULT_OFFICE_CONVERT_DEFAULTS.exports }
  };
  let present = 0;
  if (r.spreadsheets !== void 0) {
    if (r.spreadsheets === null || typeof r.spreadsheets !== "object" || Array.isArray(r.spreadsheets)) {
      return null;
    }
    const s = r.spreadsheets;
    if (s.gridlines !== void 0) {
      if (typeof s.gridlines !== "boolean") return null;
      out.spreadsheets.gridlines = s.gridlines;
    }
    if (s.fitToWidth !== void 0) {
      if (typeof s.fitToWidth !== "boolean") return null;
      out.spreadsheets.fitToWidth = s.fitToWidth;
    }
    if (s.orientation !== void 0) {
      if (typeof s.orientation !== "string" || !OFFICE_ORIENTATIONS.includes(s.orientation)) {
        return null;
      }
      out.spreadsheets.orientation = s.orientation;
    }
    present += 1;
  }
  if (r.presentations !== void 0) {
    if (r.presentations === null || typeof r.presentations !== "object" || Array.isArray(r.presentations)) {
      return null;
    }
    const p = r.presentations;
    if (p.includeNotes !== void 0) {
      if (typeof p.includeNotes !== "boolean") return null;
      out.presentations.includeNotes = p.includeNotes;
    }
    present += 1;
  }
  if (r.exports !== void 0) {
    if (r.exports === null || typeof r.exports !== "object" || Array.isArray(r.exports)) {
      return null;
    }
    const e = r.exports;
    if (e.includeImages !== void 0) {
      if (typeof e.includeImages !== "boolean") return null;
      out.exports.includeImages = e.includeImages;
    }
    present += 1;
  }
  if (present === 0) return null;
  return out;
}
var READING_EPUB_THEMES = ["light", "dark", "sepia"];
var READING_COMIC_LAYOUTS = ["single", "double"];
var READING_COMIC_FITS = ["width", "height"];
var READING_FONT_SIZE_PT_MIN = 10;
var READING_FONT_SIZE_PT_MAX = 32;
var READING_LINE_HEIGHT_MIN = 1;
var READING_LINE_HEIGHT_MAX = 2.5;
function normalizeReadingDefaults(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw;
  const out = {
    epub: { ...DEFAULT_READING_DEFAULTS.epub },
    comics: { ...DEFAULT_READING_DEFAULTS.comics }
  };
  let present = 0;
  if (r.epub !== void 0) {
    present += 1;
    if (r.epub !== null && typeof r.epub === "object" && !Array.isArray(r.epub)) {
      const e = r.epub;
      if (typeof e.fontSizePt === "number" && Number.isFinite(e.fontSizePt) && e.fontSizePt >= READING_FONT_SIZE_PT_MIN && e.fontSizePt <= READING_FONT_SIZE_PT_MAX) {
        out.epub.fontSizePt = e.fontSizePt;
      }
      if (typeof e.lineHeight === "number" && Number.isFinite(e.lineHeight) && e.lineHeight >= READING_LINE_HEIGHT_MIN && e.lineHeight <= READING_LINE_HEIGHT_MAX) {
        out.epub.lineHeight = e.lineHeight;
      }
      if (typeof e.theme === "string" && READING_EPUB_THEMES.includes(e.theme)) {
        out.epub.theme = e.theme;
      }
    }
  }
  if (r.comics !== void 0) {
    present += 1;
    if (r.comics !== null && typeof r.comics === "object" && !Array.isArray(r.comics)) {
      const c = r.comics;
      if (typeof c.layout === "string" && READING_COMIC_LAYOUTS.includes(c.layout)) {
        out.comics.layout = c.layout;
      }
      if (typeof c.fit === "string" && READING_COMIC_FITS.includes(c.fit)) {
        out.comics.fit = c.fit;
      }
      if (typeof c.rightToLeft === "boolean") {
        out.comics.rightToLeft = c.rightToLeft;
      }
    }
  }
  if (present === 0) return null;
  return out;
}
var PRINT_SCALINGS = ["fit", "actual", "shrink", "custom"];
var PRINT_DUPLEXES = ["simplex", "longEdge", "shortEdge"];
var PRINT_PAGES_PER_SHEET = [1, 2, 4, 6, 9, 16];
var PRINT_PAGE_ORDERS = [
  "horizontal",
  "horizontalReversed",
  "vertical",
  "verticalReversed"
];
var PRINT_ODD_EVEN = ["all", "odd", "even"];
var PRINT_LAYOUT_MODES = ["single", "booklet", "poster"];
var BOOKLET_SUBSETS = ["both", "front", "back"];
function normalizePrintPresetSettings(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw;
  const out = {};
  if (typeof r.copies === "number" && Number.isInteger(r.copies) && r.copies >= 1 && r.copies <= 99) {
    out.copies = r.copies;
  }
  for (const key of ["collate", "landscape", "color", "reverse", "printAnnotations"]) {
    if (typeof r[key] === "boolean") out[key] = r[key];
  }
  if (typeof r.scaling === "string" && PRINT_SCALINGS.includes(r.scaling)) {
    out.scaling = r.scaling;
  }
  if (typeof r.scalePercent === "number" && Number.isFinite(r.scalePercent) && r.scalePercent >= 1 && r.scalePercent <= 500) {
    out.scalePercent = r.scalePercent;
  }
  if (typeof r.duplex === "string" && PRINT_DUPLEXES.includes(r.duplex)) {
    out.duplex = r.duplex;
  }
  if (typeof r.pagesPerSheet === "number" && PRINT_PAGES_PER_SHEET.includes(r.pagesPerSheet)) {
    out.pagesPerSheet = r.pagesPerSheet;
  }
  if (typeof r.pageOrder === "string" && PRINT_PAGE_ORDERS.includes(r.pageOrder)) {
    out.pageOrder = r.pageOrder;
  }
  if (typeof r.oddEven === "string" && PRINT_ODD_EVEN.includes(r.oddEven)) {
    out.oddEven = r.oddEven;
  }
  if (typeof r.layoutMode === "string" && PRINT_LAYOUT_MODES.includes(r.layoutMode)) {
    out.layoutMode = r.layoutMode;
  }
  if (typeof r.bookletSubset === "string" && BOOKLET_SUBSETS.includes(r.bookletSubset)) {
    out.bookletSubset = r.bookletSubset;
  }
  if (typeof r.posterCutMarks === "boolean") out.posterCutMarks = r.posterCutMarks;
  for (const key of ["bookletGutterPt", "bookletCreepPt", "posterOverlapPt"]) {
    const max = key === "bookletCreepPt" ? 36 : 72;
    const value = r[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= max) {
      out[key] = value;
    }
  }
  if (typeof r.posterScalePercent === "number" && Number.isFinite(r.posterScalePercent) && r.posterScalePercent >= 10 && r.posterScalePercent <= 500) {
    out.posterScalePercent = r.posterScalePercent;
  }
  for (const key of ["posterRows", "posterCols"]) {
    const value = r[key];
    if (typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 10) {
      out[key] = value;
    }
  }
  return out;
}
function normalizePrintPresets(raw) {
  if (!Array.isArray(raw)) return null;
  const order = [];
  const byName = /* @__PURE__ */ new Map();
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry;
    if (typeof e.name !== "string") continue;
    const name = e.name.trim();
    if (name.length === 0 || name.length > PRINT_PRESET_NAME_MAX) continue;
    const settings = normalizePrintPresetSettings(e.settings);
    if (settings === null) continue;
    if (!byName.has(name)) order.push(name);
    byName.set(name, settings);
  }
  const out = [];
  for (const name of order) {
    out.push({ name, settings: byName.get(name) });
    if (out.length >= PRINT_PRESETS_CAP) break;
  }
  return out;
}
function normalizeSpellCheck(raw) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw;
  const enabled = typeof obj.enabled === "boolean" ? obj.enabled : true;
  const language = obj.language === "en-US" ? "en-US" : "en-US";
  return { enabled, language };
}
function normalizeAnnotationColorEntry(raw) {
  if (typeof raw === "string" && raw.length > 0) {
    return { id: raw, hex: raw };
  }
  if (raw !== null && typeof raw === "object") {
    const obj = raw;
    if (typeof obj.id === "string" && obj.id.length > 0 && typeof obj.hex === "string" && obj.hex.length > 0) {
      return { id: obj.id, hex: obj.hex };
    }
  }
  return null;
}
function normalizeSettings(raw) {
  const rawObj = raw !== null && typeof raw === "object" ? raw : {};
  const recentsCap = typeof rawObj.recentsCap === "number" && Number.isFinite(rawObj.recentsCap) && rawObj.recentsCap >= 1 && rawObj.recentsCap <= 50 ? rawObj.recentsCap : RECENT_FILES_CAP;
  const settings = {
    theme: typeof rawObj.theme === "string" && THEMES.includes(rawObj.theme) ? rawObj.theme : DEFAULT_SETTINGS.theme,
    geometry: normalizeGeometry(rawObj.geometry),
    recentFiles: normalizeRecentFiles(rawObj.recentFiles, recentsCap)
  };
  if (typeof rawObj.toolsPaletteLayout === "string" && (rawObj.toolsPaletteLayout === "list" || rawObj.toolsPaletteLayout === "grid")) {
    settings.toolsPaletteLayout = rawObj.toolsPaletteLayout;
  }
  if (typeof rawObj.themeDefault === "string" && (rawObj.themeDefault === "light" || rawObj.themeDefault === "dark" || rawObj.themeDefault === "system" || rawObj.themeDefault === "frosted")) {
    settings.themeDefault = rawObj.themeDefault;
  }
  if (typeof rawObj.recentsCap === "number" && Number.isFinite(rawObj.recentsCap) && rawObj.recentsCap >= 1 && rawObj.recentsCap <= 50) {
    settings.recentsCap = rawObj.recentsCap;
  }
  if (rawObj.annotationColors !== null && typeof rawObj.annotationColors === "object") {
    const ac = rawObj.annotationColors;
    const colors = {};
    if (Array.isArray(ac.light)) {
      const lightEntries = ac.light.map((c) => normalizeAnnotationColorEntry(c)).filter((c) => c !== null);
      if (lightEntries.length > 0) {
        colors.light = lightEntries;
      }
    }
    if (Array.isArray(ac.dark)) {
      const darkEntries = ac.dark.map((c) => normalizeAnnotationColorEntry(c)).filter((c) => c !== null);
      if (darkEntries.length > 0) {
        colors.dark = darkEntries;
      }
    }
    if (colors.light || colors.dark) {
      settings.annotationColors = colors;
    }
  }
  if (typeof rawObj.optimizePreset === "string" && (rawObj.optimizePreset === "none" || rawObj.optimizePreset === "compact" || rawObj.optimizePreset === "max")) {
    settings.optimizePreset = rawObj.optimizePreset;
  }
  if (typeof rawObj.exportImageFormat === "string" && (rawObj.exportImageFormat === "png" || rawObj.exportImageFormat === "jpeg" || rawObj.exportImageFormat === "tiff")) {
    settings.exportImageFormat = rawObj.exportImageFormat;
  }
  if (typeof rawObj.exportImageDpi === "number" && Number.isFinite(rawObj.exportImageDpi) && rawObj.exportImageDpi >= 72 && rawObj.exportImageDpi <= 600) {
    settings.exportImageDpi = rawObj.exportImageDpi;
  }
  if (typeof rawObj.createImageQuality === "number" && Number.isFinite(rawObj.createImageQuality) && rawObj.createImageQuality >= 0 && rawObj.createImageQuality <= 1) {
    settings.createImageQuality = rawObj.createImageQuality;
  }
  if (typeof rawObj.blankPageInkThreshold === "number" && Number.isFinite(rawObj.blankPageInkThreshold) && rawObj.blankPageInkThreshold >= 0 && rawObj.blankPageInkThreshold <= 1) {
    settings.blankPageInkThreshold = rawObj.blankPageInkThreshold;
  }
  if (rawObj.sanitizeOptions !== void 0) {
    settings.sanitizeOptions = normalizeSanitizeOptions(rawObj.sanitizeOptions);
  }
  if (rawObj.batesDefaults !== void 0) {
    settings.batesDefaults = normalizeBatesDefaults(rawObj.batesDefaults);
  }
  if (isEditFont(rawObj.editDefaultFont)) {
    settings.editDefaultFont = rawObj.editDefaultFont;
  }
  if (typeof rawObj.ocrLanguage === "string" && OCR_LANGUAGES.includes(rawObj.ocrLanguage)) {
    settings.ocrLanguage = rawObj.ocrLanguage;
  }
  if (typeof rawObj.ocrDownsample === "number" && Number.isFinite(rawObj.ocrDownsample) && rawObj.ocrDownsample >= 72 && rawObj.ocrDownsample <= 600) {
    settings.ocrDownsample = rawObj.ocrDownsample;
  }
  if (typeof rawObj.defaultStampId === "string" && STAMP_IDS.includes(rawObj.defaultStampId)) {
    settings.defaultStampId = rawObj.defaultStampId;
  }
  if (typeof rawObj.saveAsLinearize === "boolean") {
    settings.saveAsLinearize = rawObj.saveAsLinearize;
  }
  if (typeof rawObj.pagesPanelCollapsed === "boolean") {
    settings.pagesPanelCollapsed = rawObj.pagesPanelCollapsed;
  }
  const panelLeftWidthPx = normalizeBoundedWidth(
    rawObj.panelLeftWidthPx,
    PANEL_LEFT_WIDTH_MIN,
    PANEL_LEFT_WIDTH_MAX
  );
  if (panelLeftWidthPx !== null) {
    settings.panelLeftWidthPx = panelLeftWidthPx;
  }
  const panelRightWidthPx = normalizeBoundedWidth(
    rawObj.panelRightWidthPx,
    PANEL_RIGHT_WIDTH_MIN,
    PANEL_RIGHT_WIDTH_MAX
  );
  if (panelRightWidthPx !== null) {
    settings.panelRightWidthPx = panelRightWidthPx;
  }
  if (typeof rawObj.inspectorCollapsed === "boolean") {
    settings.inspectorCollapsed = rawObj.inspectorCollapsed;
  }
  if (typeof rawObj.navigatorLayout === "string" && NAVIGATOR_LAYOUTS.includes(rawObj.navigatorLayout)) {
    settings.navigatorLayout = rawObj.navigatorLayout;
  }
  const navigatorSplitRatio = normalizeBoundedWidth(
    rawObj.navigatorSplitRatio,
    NAVIGATOR_SPLIT_RATIO_MIN,
    NAVIGATOR_SPLIT_RATIO_MAX
  );
  if (navigatorSplitRatio !== null) {
    settings.navigatorSplitRatio = navigatorSplitRatio;
  }
  const annotationRecentTools = normalizeAnnotationRecentTools(rawObj.annotationRecentTools);
  if (annotationRecentTools !== null) {
    settings.annotationRecentTools = annotationRecentTools;
  }
  if (typeof rawObj.animationsEnabled === "boolean") {
    settings.animationsEnabled = rawObj.animationsEnabled;
  }
  if (typeof rawObj.homeMotionPaused === "boolean") {
    settings.homeMotionPaused = rawObj.homeMotionPaused;
  }
  const dockPins = normalizeDockPins(rawObj.dockPins);
  if (dockPins !== null) {
    settings.dockPins = dockPins;
  }
  const toolUsage = normalizeToolUsage(rawObj.toolUsage);
  if (toolUsage !== null) {
    settings.toolUsage = toolUsage;
  }
  const dockUnpinned = normalizeDockUnpinned(rawObj.dockUnpinned);
  if (dockUnpinned !== null) {
    settings.dockUnpinned = dockUnpinned;
  }
  const encryptDefaults = normalizeEncryptDefaults(rawObj.encryptDefaults);
  if (encryptDefaults !== null) {
    settings.encryptDefaults = encryptDefaults;
  }
  const convertDefaults = normalizeConvertDefaults(rawObj.convertDefaults);
  if (convertDefaults !== null) {
    settings.convertDefaults = convertDefaults;
  }
  const imageImportDefaults = normalizeImageImportDefaults(
    rawObj.imageImportDefaults
  );
  if (imageImportDefaults !== null) {
    settings.imageImportDefaults = imageImportDefaults;
  }
  const pdfValidationDefaults = normalizePdfValidationDefaults(
    rawObj.pdfValidationDefaults
  );
  if (pdfValidationDefaults !== null) {
    settings.pdfValidationDefaults = pdfValidationDefaults;
  }
  const officeConvertDefaults = normalizeOfficeConvertDefaults(
    rawObj.officeConvertDefaults
  );
  if (officeConvertDefaults !== null) {
    settings.officeConvertDefaults = officeConvertDefaults;
  }
  const readingDefaults = normalizeReadingDefaults(rawObj.readingDefaults);
  if (readingDefaults !== null) {
    settings.readingDefaults = readingDefaults;
  }
  settings.tabStyle = normalizeTabStyle(rawObj.tabStyle) ?? DEFAULT_SETTINGS.tabStyle;
  settings.redactionColor = normalizeRedactionColor(rawObj.redactionColor) ?? DEFAULT_SETTINGS.redactionColor;
  const homeTools = normalizeHomeTools(rawObj.homeTools);
  if (homeTools !== null) {
    settings.homeTools = homeTools;
  }
  const printPresets = normalizePrintPresets(rawObj.printPresets);
  if (printPresets !== null) {
    settings.printPresets = printPresets;
  }
  const spellCheck = normalizeSpellCheck(rawObj.spellCheck);
  if (spellCheck !== null) {
    settings.spellCheck = spellCheck;
  }
  settings.accountsEnabled = typeof rawObj.accountsEnabled === "boolean" ? rawObj.accountsEnabled : DEFAULT_SETTINGS.accountsEnabled;
  if (typeof rawObj.syncDeviceId === "string" && rawObj.syncDeviceId.length > 0 && rawObj.syncDeviceId.length <= SYNC_DEVICE_ID_MAX) {
    settings.syncDeviceId = rawObj.syncDeviceId;
  }
  if (typeof rawObj.lastSyncedAt === "string" && rawObj.lastSyncedAt.length > 0 && rawObj.lastSyncedAt.length <= LAST_SYNCED_AT_MAX && !Number.isNaN(Date.parse(rawObj.lastSyncedAt))) {
    settings.lastSyncedAt = rawObj.lastSyncedAt;
  }
  return settings;
}
var SettingsService = class {
  constructor(filePath, onChange, onWriteError) {
    this.filePath = filePath;
    this.onChange = onChange;
    this.onWriteError = onWriteError;
  }
  filePath;
  onChange;
  onWriteError;
  current = structuredClone(DEFAULT_SETTINGS);
  /** Last settings snapshot that actually reached disk. `current` is restored
   *  to this on a failed write so memory and disk never diverge (DEF-230). */
  persisted = structuredClone(DEFAULT_SETTINGS);
  _saveQueue = Promise.resolve();
  getCurrent() {
    return structuredClone(this.current);
  }
  async load() {
    let text;
    try {
      text = await readFile(this.filePath, "utf8");
    } catch (e) {
      if (e.code === "ENOENT") {
        this.current = structuredClone(DEFAULT_SETTINGS);
        this.persisted = structuredClone(DEFAULT_SETTINGS);
        return ok(structuredClone(DEFAULT_SETTINGS));
      }
      return err("io", message(e));
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      return err("corrupt-settings", "settings.json is not valid JSON");
    }
    if (parsed === null || typeof parsed !== "object") {
      return err("corrupt-settings", "settings.json does not contain an object");
    }
    this.current = normalizeSettings(parsed);
    this.persisted = structuredClone(this.current);
    return ok(structuredClone(this.current));
  }
  save(settings) {
    const snapshot = normalizeSettings(settings);
    this.current = snapshot;
    const task = this._saveQueue.then(() => this._doSave(snapshot));
    this._saveQueue = task.catch(() => {
    });
    return task;
  }
  /** Save the current in-memory settings at execution time (not enqueue time).
   *  This avoids the race where a caller snapshots `getCurrent()` before a
   *  pending renderer save has updated `this.current`.  The state is read when
   *  the queued task actually runs, after all prior saves have completed. */
  saveCurrent() {
    const task = this._saveQueue.then(() => this._doSave(structuredClone(this.current)));
    this._saveQueue = task.catch(() => {
    });
    return task;
  }
  /** DEF-303 — persist ONLY the OS window geometry (bounds + `maximized`)
   *  without echoing `settings:changed` back to the renderer.
   *
   *  Main owns the geometry: `src/main/window.ts` pushes every state
   *  transition immediately through its `onWindowStateChanged` callback, so
   *  by the time this debounced write lands the renderer already shows the
   *  correct caption. The renderer never reads geometry.x/y/width/height
   *  (only `geometry.maximized`, see App.tsx DEF-202), so an echo for a
   *  geometry-only write buys nothing and costs a full settings re-render
   *  ~300 ms after the maximize — exactly the lag DEF-303 measured. Chosen
   *  fix: emit nothing for a geometry-only write. Every other write
   *  (`save` / `saveCurrent` / `addRecentFile`) keeps the normal echo. */
  saveGeometryOnly(geometry) {
    this.current = normalizeSettings({ ...this.current, geometry });
    const snapshot = structuredClone(this.current);
    const task = this._saveQueue.then(() => this._doSave(snapshot, false));
    this._saveQueue = task.catch(() => {
    });
    return task;
  }
  async _doSave(settings, notify = true) {
    const tmp = `${this.filePath}.tmp`;
    try {
      const normalized = normalizeSettings(settings);
      await mkdir(dirname(this.filePath), { recursive: true });
      await writeFile(tmp, JSON.stringify(normalized, null, 2), "utf8");
      await rename(tmp, this.filePath);
      this.current = normalized;
      this.persisted = structuredClone(normalized);
      if (notify) {
        this.onChange?.(structuredClone(normalized));
      }
    } catch (e) {
      try {
        await unlink(tmp);
      } catch {
      }
      const msg = message(e);
      console.warn(`[settings] could not write settings.json: ${msg}`);
      this.current = structuredClone(this.persisted);
      this.onWriteError?.(msg);
    }
  }
  async addRecentFile(file2) {
    const rest = this.current.recentFiles.filter((f) => f.path !== file2.path);
    await this.save({ ...this.current, recentFiles: [file2, ...rest] });
  }
};
function message(e) {
  return e instanceof Error ? e.message : String(e);
}

// src/renderer/security/protection.ts
var ALL_PERMISSIONS_ALLOWED = {
  print: true,
  highResPrint: true,
  copy: true,
  accessibleCopy: true,
  modify: true,
  comment: true,
  assemble: true,
  fillForms: true
};

// src/renderer/security/encrypt.ts
var DEFAULT_ENCRYPT_ALGORITHM = "aes-256";
var DEFAULT_ENCRYPT_DEFAULTS = {
  algorithm: DEFAULT_ENCRYPT_ALGORITHM,
  permissions: { ...ALL_PERMISSIONS_ALLOWED }
};

// src/renderer/state/preferences.ts
var DEFAULT_RECENTS_CAP = 10;
var DEFAULT_TAB_STYLE = "colorful";

// src/renderer/state/defaults.ts
function restoreDefaultSettings(current2) {
  return {
    ...current2,
    theme: "frosted",
    themeDefault: "frosted",
    animationsEnabled: true,
    tabStyle: DEFAULT_TAB_STYLE,
    recentsCap: DEFAULT_RECENTS_CAP,
    convertDefaults: { ...DEFAULT_CONVERT_DEFAULTS }
  };
}

// test-fixtures/tfl1280-adversary/probe-restore-history.mjs
var dir = await mkdtemp(join(tmpdir(), "tflex-adv1280-"));
var file = join(dir, "settings.json");
var errors = [];
var svc = new SettingsService(file, void 0, (m) => errors.push(m));
var mkRecent = (i) => ({
  path: `C:/docs/report-${i}.pdf`,
  name: `report-${i}.pdf`,
  openedAt: new Date(2024, 0, 1 + i).toISOString()
});
var HISTORY = 15;
var CAP = 20;
await svc.save({
  ...DEFAULT_SETTINGS,
  recentsCap: CAP,
  recentFiles: Array.from({ length: HISTORY }, (_, i) => mkRecent(i))
});
var before = JSON.parse(await readFile2(file, "utf8"));
console.log("=== seeded ===");
console.log("  recentsCap         :", before.recentsCap);
console.log("  recentFiles on disk:", before.recentFiles.length);
var current = svc.getCurrent();
var reset = restoreDefaultSettings(current);
console.log("=== restoreDefaultSettings (pure) ===");
console.log("  recentsCap         :", reset.recentsCap);
console.log("  recentFiles in obj :", reset.recentFiles.length, "(pure reset keeps them)");
await svc.save(reset);
var after = JSON.parse(await readFile2(file, "utf8"));
console.log("=== after Restore defaults (disk) ===");
console.log("  recentsCap         :", after.recentsCap);
console.log("  recentFiles on disk:", after.recentFiles.length);
console.log("  errors             :", errors.length);
var lost = before.recentFiles.length - after.recentFiles.length;
console.log(
  lost > 0 ? `RESULT: LOSS \u2014 ${lost} recent-files history entries silently dropped, contradicting the scope promise.` : "RESULT: history kept as promised."
);
await rm(dir, { recursive: true, force: true });
