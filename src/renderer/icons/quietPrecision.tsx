// Phase 103 — the Quiet Precision semantic icon registry.
//
// ONE source of truth mapping a stable command/affordance ID to the exact glyph
// the shared `Icon` wrapper renders. Geometry lives here as inline JSX so the
// runtime never loads a file or a network asset: this module imports only React
// (types) and the Lucide glyph components the "RETAIN lucide" rows keep.
//
// Two glyph kinds:
//   - `shapes`: Quiet Precision outline art authored on a 24x24 grid, 1.65
//     stroke, no fill, currentColor, round caps/joins (see
//     `Visual overhaul/Icons/Specifications/icon-design-spec.md`). The supplied
//     assets were inlined verbatim; the `NEW` rows were authored to the same
//     grammar.
//   - `lucide`: the existing Lucide metaphor for the "RETAIN lucide, normalize
//     to 1.65/24" rows, rendered by the wrapper at the normalized stroke.
//
// Keys match the Phase 103 `icon-inventory` IDs verbatim: the 108 command IDs in
// `state/toolsRegistry.ts` plus the 13 chrome/affordance IDs.

import type { LucideIcon } from "lucide-react";
import {
  ArrowRightToLine,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Circle,
  ClipboardPaste,
  Copy,
  Download,
  Ellipsis,
  FileInput,
  FolderInput,
  GripVertical,
  Highlighter,
  Info,
  ListX,
  Menu,
  MessageCirclePlus,
  MessageSquareText,
  Minimize,
  Minus,
  Palette,
  PanelRightDashed,
  Pen,
  Plus,
  RefreshCw,
  RotateCcw,
  SeparatorVertical,
  Slash,
  Square,
  SquareDashed,
  SquareX,
  StickyNote,
  Strikethrough,
  Underline,
  X,
} from "lucide-react";
import type { ReactNode } from "react";

/**
 * Every registry command ID plus every chrome/affordance ID the inventory
 * names. The string form of the AnimatedTab close control matches the
 * inventory's Control ID verbatim.
 */
export type QuietIconId =
  | "merge"
  | "split"
  | "extract"
  | "rotate"
  | "delete"
  | "insertPages"
  | "replacePages"
  | "renumberPages"
  | "cropPages"
  | "rotateCounterClockwise"
  | "pageThumbnails"
  | "outlinePanel"
  | "pageContextMenu"
  | "clearPageSelection"
  | "dragPage"
  | "editMode"
  | "editToolOff"
  | "editText"
  | "editTextBox"
  | "editImage"
  | "editDefaultFont"
  | "recognizeText"
  | "batchOcr"
  | "ocrSuspects"
  | "annotate"
  | "sign"
  | "forms"
  | "flatten"
  | "stamp"
  | "watermark"
  | "bates"
  | "redact"
  | "exportComments"
  | "importComments"
  | "fillFromCsv"
  | "exportFormData"
  | "importFormData"
  | "validateDocument"
  | "sanitize"
  | "engineeringLayers"
  | "documentInfo"
  | "annotationsPanel"
  | "annSelect"
  | "annHighlight"
  | "annUnderline"
  | "annStrikeout"
  | "annInk"
  | "annTextbox"
  | "annRect"
  | "annEllipse"
  | "annArrow"
  | "annCallout"
  | "annNote"
  | "annColor"
  | "annPenWidth"
  | "optimize"
  | "audit"
  | "createFromImages"
  | "exportPages"
  | "exportText"
  | "exportDocx"
  | "exportXlsx"
  | "exportPptx"
  | "encrypt"
  | "open"
  | "openRecent"
  | "openSample"
  | "removeRecent"
  | "createFromClipboard"
  | "save"
  | "saveAs"
  | "print"
  | "find"
  | "zoomIn"
  | "zoomOut"
  | "fitWidth"
  | "fitPage"
  | "prevPage"
  | "nextPage"
  | "pageJump"
  | "undo"
  | "redo"
  | "tabNew"
  | "tabClose"
  | "multi-mode"
  | "paneOpen"
  | "panePick"
  | "paneClear"
  | "paneResize"
  | "toggleTheme"
  | "preferences"
  | "checkForUpdate"
  | "updateDownload"
  | "updateInstall"
  | "about"
  | "appMenu"
  | "toolsPalette"
  | "panMode"
  | "railCollapse"
  | "stagePages"
  | "stageEdit"
  | "stageReview"
  | "stageDeliver"
  | "windowMinimize"
  | "windowMaximize"
  | "windowRestore"
  | "windowClose"
  | "menuCheck"
  | "openReadingView"
  | "openComicView"
  | "dialogClose"
  | "tabClose (AnimatedTab)"
  | "dockScrollLeft"
  | "dockScrollRight"
  | "dockOverflow"
  | "dockRemove"
  | "dockEditPencil"
  | "headerCommand"
  | "headerTheme"
  | "headerMenuDisclosure"
  | "layoutOnePage"
  | "layoutTwoPage"
  | "layoutFourPage";

/** A registry glyph: authored Quiet Precision shapes, or a retained Lucide icon. */
export type QuietGlyph =
  | { kind: "shapes"; shapes: ReactNode }
  | { kind: "lucide"; icon: LucideIcon };

/** The geometry baseline, in one place. */
export const QUIET_ICON_VIEWBOX = 24;
export const QUIET_ICON_STROKE = 1.65;
export const QUIET_ICON_STROKE_SMALL = 1.8;

export const QUIET_ICONS: Record<QuietIconId, QuietGlyph> = {
  // ---- PAGES ---------------------------------------------------------
  merge: {
    kind: "shapes",
    shapes: (
      <>
        <path d="M4 4v5a4 4 0 0 0 4 4h4" />
        <path d="M20 4v5a4 4 0 0 1-4 4h-4" />
        <path d="M12 13v8" />
        <path d="m9 18 3 3 3-3" />
      </>
    ),
  },
  split: {
    kind: "shapes",
    shapes: (
      <>
        <path d="M12 4v4" />
        <path d="M12 11v2" />
        <path d="M12 16v4" />
        <path d="M8 8H4v9h4" />
        <path d="M16 8h4v9h-4" />
      </>
    ),
  },
  extract: {
    kind: "shapes",
    shapes: (
      <>
        <path d="M12 4H5a1.5 1.5 0 0 0-1.5 1.5v13A1.5 1.5 0 0 0 5 20h10a1.5 1.5 0 0 0 1.5-1.5V8.5L12 4Z" />
        <path d="M12 4v4.5h4.5" />
        <path d="M12 14h9" />
        <path d="m18 11 3 3-3 3" />
      </>
    ),
  },
  rotate: {
    kind: "shapes",
    shapes: (
      <>
        <path d="M5 9a7.5 7.5 0 1 1 .5 8" />
        <path d="M5 4v5h5" />
      </>
    ),
  },
  delete: {
    kind: "shapes",
    shapes: (
      <>
        <path d="M4 6h16" />
        <path d="M9 6V3.5h6V6" />
        <path d="M6 6l1 14.5h10L18 6" />
        <path d="M10 10v6" />
        <path d="M14 10v6" />
      </>
    ),
  },
  insertPages: {
    kind: "shapes",
    shapes: (
      <>
        <path d="M12 4H5a1.5 1.5 0 0 0-1.5 1.5v13A1.5 1.5 0 0 0 5 20h10a1.5 1.5 0 0 0 1.5-1.5V8.5L12 4Z" />
        <path d="M12 4v4.5h4.5" />
        <path d="M17 14h6" />
        <path d="M20 11v6" />
      </>
    ),
  },
  replacePages: {
    kind: "shapes",
    shapes: (
      <>
        <path d="M4 6h14" />
        <path d="m15 3 3 3-3 3" />
        <path d="M20 18H6" />
        <path d="m9 15-3 3 3 3" />
        <rect x="5" y="9" width="5" height="5" rx="0.8" />
        <rect x="14" y="9" width="5" height="5" rx="0.8" />
      </>
    ),
  },
  // NEW — set logical page labels: a page with a two-segment label field.
  renumberPages: {
    kind: "shapes",
    shapes: (
      <>
        <rect x="4.5" y="3.5" width="15" height="17" rx="1.5" />
        <rect x="7.5" y="13" width="9" height="4.5" rx="0.8" />
        <path d="M7.5 15.25h9" />
      </>
    ),
  },
  cropPages: {
    kind: "shapes",
    shapes: (
      <>
        <path d="M7 3v14h14" />
        <path d="M3 7h14v14" />
      </>
    ),
  },
  rotateCounterClockwise: { kind: "lucide", icon: RotateCcw },
  // NEW — page-preview rail: a viewer frame with a rail divider and a preview page.
  pageThumbnails: {
    kind: "shapes",
    shapes: (
      <>
        <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
        <path d="M8.5 4.5v15" />
        <rect x="11.5" y="8.5" width="6" height="7.5" rx="0.8" />
      </>
    ),
  },
  // NEW — document outline tree: a spine with two levels of branches.
  outlinePanel: {
    kind: "shapes",
    shapes: (
      <>
        <path d="M5 4v16" />
        <path d="M5 9h5" />
        <path d="M5 15h5" />
        <path d="M10 9h9" />
        <path d="M10 15h6" />
      </>
    ),
  },
  pageContextMenu: { kind: "lucide", icon: Ellipsis },
  clearPageSelection: { kind: "lucide", icon: SquareDashed },
  dragPage: { kind: "lucide", icon: GripVertical },
  editMode: {
    kind: "shapes",
    shapes: (
      <>
        <path d="m5 15 10.5-10.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
        <path d="M13.5 6.5l3 3" />
      </>
    ),
  },
  editToolOff: {
    kind: "shapes",
    shapes: <path d="m5 3 14 9-7 1.5-3.5 7L5 3Z" />,
  },
  editText: {
    kind: "shapes",
    shapes: (
      <>
        <path d="M5 5h14" />
        <path d="M12 5v14" />
        <path d="M8 19h8" />
      </>
    ),
  },
  editTextBox: {
    kind: "shapes",
    shapes: (
      <>
        <rect x="3.5" y="4.5" width="14" height="15" rx="1.5" />
        <path d="M7 8h7" />
        <path d="M10.5 8v8" />
        <path d="M8.5 16h4" />
        <path d="M17 15h6" />
        <path d="M20 12v6" />
      </>
    ),
  },
  editImage: {
    kind: "shapes",
    shapes: (
      <>
        <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
        <path d="m4 17 5.5-6 4 4 3-3 4 4" />
        <circle cx="16" cy="8.5" r="1" />
      </>
    ),
  },
  // NEW — typeface / default font: an "A" over a baseline.
  editDefaultFont: {
    kind: "shapes",
    shapes: (
      <>
        <path d="M4 17 9 5l5 12" />
        <path d="M6 13h6" />
        <path d="M4 20h16" />
      </>
    ),
  },
  recognizeText: {
    kind: "shapes",
    shapes: (
      <>
        <path d="M3.5 8V3.5H8" />
        <path d="M16 3.5h4.5V8" />
        <path d="M20.5 16v4.5H16" />
        <path d="M8 20.5H3.5V16" />
        <path d="M8 8h8" />
        <path d="M12 8v8" />
        <path d="M9.5 16h5" />
      </>
    ),
  },
  batchOcr: {
    kind: "shapes",
    shapes: (
      <>
        <path d="M3 7V3h4" />
        <path d="M17 3h4v4" />
        <path d="M21 17v4h-4" />
        <path d="M7 21H3v-4" />
        <rect x="7" y="6" width="8" height="10" rx="1" />
        <path d="M9 9h4" />
        <path d="M11 9v4" />
        <path d="M15 8h2v10h-8" />
      </>
    ),
  },
  ocrSuspects: {
    kind: "shapes",
    shapes: (
      <>
        <path d="m12 3 9.5 17H2.5L12 3Z" />
        <path d="M12 9v5" />
        <path d="M12 17v.2" />
      </>
    ),
  },
  annotate: {
    kind: "shapes",
    shapes: (
      <>
        <path d="M5 4.5h14v12H10l-5 4v-16Z" />
        <path d="M8.5 8h7" />
        <path d="M8.5 11.5h5" />
      </>
    ),
  },
  sign: {
    kind: "shapes",
    shapes: (
      <>
        <path d="M3 17c3-7 5-11 7-10s-1 7-3 9 1 3 3 1l3-3c1-1 1 3 2 3s2-3 3-2 1 2 3 1" />
        <path d="M3 21h18" />
      </>
    ),
  },
  forms: {
    kind: "shapes",
    shapes: (
      <>
        <rect x="4" y="3.5" width="16" height="17" rx="1.5" />
        <rect x="7" y="7" width="2" height="2" rx="0.4" />
        <rect x="7" y="12" width="2" height="2" rx="0.4" />
        <path d="M12 8h5" />
        <path d="M12 13h5" />
        <path d="M7 18h10" />
      </>
    ),
  },
  flatten: {
    kind: "shapes",
    shapes: (
      <>
        <path d="M12 3v8" />
        <path d="m9 8 3 3 3-3" />
        <path d="m4 15 8 4 8-4" />
        <path d="M4 21h16" />
      </>
    ),
  },
  stamp: {
    kind: "shapes",
    shapes: (
      <>
        <path d="M9 11V6a3 3 0 0 1 6 0v5l3 4v2H6v-2l3-4Z" />
        <path d="M5 21h14" />
      </>
    ),
  },
  // NEW — overlay watermark text or image: a page with layered water lines.
  watermark: {
    kind: "shapes",
    shapes: (
      <>
        <rect x="4.5" y="3.5" width="15" height="17" rx="1.5" />
        <path d="M7 10c1.4-1.4 2.8-1.4 4.2 0s2.8 1.4 4.2 0" />
        <path d="M7 14c1.4-1.4 2.8-1.4 4.2 0s2.8 1.4 4.2 0" />
      </>
    ),
  },
  bates: {
    kind: "shapes",
    shapes: (
      <>
        <path d="m10 3-3 18" />
        <path d="M17 3l-3 18" />
        <path d="M4 9h17" />
        <path d="M3 15h17" />
      </>
    ),
  },
  // NEW — permanently remove marked content: a page with a crossed-out region.
  redact: {
    kind: "shapes",
    shapes: (
      <>
        <rect x="5" y="3.5" width="14" height="17" rx="1.5" />
        <rect x="8" y="9" width="8" height="5" rx="0.8" />
        <path d="m8 14 8-5" />
      </>
    ),
  },
  exportComments: {
    kind: "shapes",
    shapes: (
      <>
        <path d="M3 4h14v11H8l-5 4V4Z" />
        <path d="M14 18h8" />
        <path d="m19 15 3 3-3 3" />
      </>
    ),
  },
  importComments: {
    kind: "shapes",
    shapes: (
      <>
        <path d="M3 4h14v11H8l-5 4V4Z" />
        <path d="M22 18h-8" />
        <path d="m17 15-3 3 3 3" />
      </>
    ),
  },
  // NEW — map CSV columns to fields: a labelled table with an incoming arrow.
  fillFromCsv: {
    kind: "shapes",
    shapes: (
      <>
        <rect x="3.5" y="3.5" width="13" height="17" rx="1.5" />
        <path d="M3.5 9h13" />
        <path d="M3.5 14.5h13" />
        <path d="M10 3.5v17" />
        <path d="M19 10v7" />
        <path d="m16.5 14.5 2.5 2.5 2.5-2.5" />
      </>
    ),
  },
  // NEW — export field values as data: a form sheet with an outgoing arrow.
  exportFormData: {
    kind: "shapes",
    shapes: (
      <>
        <rect x="3.5" y="4.5" width="11" height="15" rx="1.5" />
        <path d="M3.5 9h11" />
        <path d="M3.5 13h7" />
        <path d="M16 12h5" />
        <path d="m18.5 9.5 2.5 2.5-2.5 2.5" />
      </>
    ),
  },
  // NEW — import FDF/XFDF field values: a form sheet with an incoming arrow.
  importFormData: {
    kind: "shapes",
    shapes: (
      <>
        <rect x="3.5" y="4.5" width="11" height="15" rx="1.5" />
        <path d="M3.5 9h11" />
        <path d="M3.5 13h7" />
        <path d="M21 12h-5" />
        <path d="m18.5 9.5-2.5 2.5 2.5 2.5" />
      </>
    ),
  },
  validateDocument: {
    kind: "shapes",
    shapes: (
      <>
        <path d="M14 3H6a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 6 21h12a1.5 1.5 0 0 0 1.5-1.5V8.5L14 3Z" />
        <path d="M14 3v5.5h5.5" />
        <path d="m8 14 2.5 2.5 5-5" />
      </>
    ),
  },
  sanitize: {
    kind: "shapes",
    shapes: (
      <>
        <path d="m12 3 8 3v6c0 4-3.5 7-8 9-4.5-2-8-5-8-9V6l8-3Z" />
        <path d="M8.5 12l2.5 2.5 4.5-4.5" />
      </>
    ),
  },
  engineeringLayers: {
    kind: "shapes",
    shapes: (
      <>
        <path d="m3 7 9-4 9 4-9 4-9-4Z" />
        <path d="M3 12l9 4 9-4" />
        <path d="M3 17l9 4 9-4" />
      </>
    ),
  },
  // NEW — document metadata report: a page with an info mark.
  documentInfo: {
    kind: "shapes",
    shapes: (
      <>
        <rect x="4.5" y="3.5" width="15" height="17" rx="1.5" />
        <circle cx="12" cy="11.5" r="3.5" />
        <path d="M12 10.5v4" />
        <path d="M12 8.5v.3" />
      </>
    ),
  },
  annotationsPanel: { kind: "lucide", icon: MessageSquareText },
  annSelect: {
    kind: "shapes",
    shapes: <path d="m5 3 14 9-7 1.5-3.5 7L5 3Z" />,
  },
  annHighlight: { kind: "lucide", icon: Highlighter },
  annUnderline: { kind: "lucide", icon: Underline },
  annStrikeout: { kind: "lucide", icon: Strikethrough },
  annInk: { kind: "lucide", icon: Pen },
  // NEW — place a text-box annotation: a box with a "T".
  annTextbox: {
    kind: "shapes",
    shapes: (
      <>
        <rect x="4" y="6" width="16" height="12" rx="1.5" />
        <path d="M8.5 10h7" />
        <path d="M12 10v5" />
        <path d="M10 15h4" />
      </>
    ),
  },
  annRect: { kind: "lucide", icon: Square },
  annEllipse: { kind: "lucide", icon: Circle },
  annArrow: { kind: "lucide", icon: ArrowUpRight },
  annCallout: { kind: "lucide", icon: MessageCirclePlus },
  annNote: { kind: "lucide", icon: StickyNote },
  annColor: { kind: "lucide", icon: Palette },
  annPenWidth: { kind: "lucide", icon: Slash },
  optimize: {
    kind: "shapes",
    shapes: (
      <>
        <path d="M3 8h5V3" />
        <path d="M8 8 3 3" />
        <path d="M21 16h-5v5" />
        <path d="m16 16 5 5" />
        <path d="M14 4v6h6" />
        <path d="M10 20v-6H4" />
      </>
    ),
  },
  audit: {
    kind: "shapes",
    shapes: (
      <>
        <path d="M10.5 3.5a8.5 8.5 0 1 0 10 10h-10v-10Z" />
        <path d="M14 3.5v7h7a8.5 8.5 0 0 0-7-7Z" />
      </>
    ),
  },
  createFromImages: {
    kind: "shapes",
    shapes: (
      <>
        <path d="M12 4H5a1.5 1.5 0 0 0-1.5 1.5v13A1.5 1.5 0 0 0 5 20h10a1.5 1.5 0 0 0 1.5-1.5V8.5L12 4Z" />
        <path d="M12 4v4.5h4.5" />
        <path d="m6 16 3-4 3 4" />
        <circle cx="10" cy="9" r=".8" />
        <path d="M17 16h6" />
        <path d="M20 13v6" />
      </>
    ),
  },
  exportPages: {
    kind: "shapes",
    shapes: (
      <>
        <path d="M12 4H5a1.5 1.5 0 0 0-1.5 1.5v13A1.5 1.5 0 0 0 5 20h10a1.5 1.5 0 0 0 1.5-1.5V8.5L12 4Z" />
        <path d="M12 4v4.5h4.5" />
        <path d="m6 15 3-3 4 5" />
        <circle cx="11" cy="9" r=".8" />
        <path d="M17 16h6" />
        <path d="m20 13 3 3-3 3" />
      </>
    ),
  },
  exportText: {
    kind: "shapes",
    shapes: (
      <>
        <path d="M12 4H5a1.5 1.5 0 0 0-1.5 1.5v13A1.5 1.5 0 0 0 5 20h10a1.5 1.5 0 0 0 1.5-1.5V8.5L12 4Z" />
        <path d="M12 4v4.5h4.5" />
        <path d="M7 11h5" />
        <path d="M9.5 11v5" />
        <path d="M17 16h6" />
        <path d="m20 13 3 3-3 3" />
      </>
    ),
  },
  exportDocx: {
    kind: "shapes",
    shapes: (
      <>
        <path d="M12 4H5a1.5 1.5 0 0 0-1.5 1.5v13A1.5 1.5 0 0 0 5 20h10a1.5 1.5 0 0 0 1.5-1.5V8.5L12 4Z" />
        <path d="M12 4v4.5h4.5" />
        <path d="m6 11 1.2 5 2.3-3 2.3 3 1.2-5" />
        <path d="M17 16h6" />
        <path d="m20 13 3 3-3 3" />
      </>
    ),
  },
  exportXlsx: {
    kind: "shapes",
    shapes: (
      <>
        <rect x="3" y="4" width="14" height="16" rx="1.5" />
        <path d="M3 9h14" />
        <path d="M3 14h10" />
        <path d="M8 4v16" />
        <path d="M17 16h6" />
        <path d="m20 13 3 3-3 3" />
      </>
    ),
  },
  exportPptx: {
    kind: "shapes",
    shapes: (
      <>
        <path d="M3 4h18" />
        <path d="M5 4v12h14V4" />
        <path d="M12 16v5" />
        <path d="M8 21h8" />
        <path d="M8 8h8" />
        <path d="M8 11h5" />
      </>
    ),
  },
  encrypt: {
    kind: "shapes",
    shapes: (
      <>
        <rect x="5" y="10" width="14" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
        <path d="M12 14v3" />
      </>
    ),
  },
  open: {
    kind: "shapes",
    shapes: (
      <>
        <path d="M3.5 8V5.5A1.5 1.5 0 0 1 5 4h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5V8" />
        <path d="M3.5 9.5h17l-2 10h-17l2-10Z" />
      </>
    ),
  },
  // NEW — recent-file history: a page with a clock.
  openRecent: {
    kind: "shapes",
    shapes: (
      <>
        <rect x="4" y="3.5" width="12" height="16" rx="1.5" />
        <path d="M4 9h12" />
        <circle cx="17.5" cy="16.5" r="4.5" />
        <path d="M17.5 14v2.5l1.6 1" />
      </>
    ),
  },
  // NEW — bundled sample documents: a neutral document with a template swatch.
  openSample: {
    kind: "shapes",
    shapes: (
      <>
        <rect x="4.5" y="3.5" width="15" height="17" rx="1.5" />
        <rect x="8" y="7.5" width="4" height="4" rx="0.8" />
        <path d="M8 15h8" />
        <path d="M8 18h5" />
      </>
    ),
  },
  removeRecent: { kind: "lucide", icon: ListX },
  createFromClipboard: { kind: "lucide", icon: ClipboardPaste },
  save: {
    kind: "shapes",
    shapes: (
      <>
        <path d="M5 3.5h12l3.5 3.5v13.5h-17v-17H5Z" />
        <path d="M7.5 3.5v6h9v-6" />
        <rect x="7.5" y="14" width="9" height="6.5" rx="1" />
      </>
    ),
  },
  // NEW — save a copy: a floppy with a second (copy) sheet behind it.
  saveAs: {
    kind: "shapes",
    shapes: (
      <>
        <path d="M7 3.5h10l3 3v13H7v-16Z" />
        <path d="M9.5 3.5v5h7v-5" />
        <rect x="9.5" y="12" width="6" height="4.5" rx="0.8" />
        <path d="M4 7v13.5h10" />
      </>
    ),
  },
  print: {
    kind: "shapes",
    shapes: (
      <>
        <rect x="6" y="3" width="12" height="6" rx="1" />
        <path d="M6 17H3.5V9h17v8H18" />
        <rect x="6" y="14" width="12" height="7" rx="1" />
        <path d="M17 11h.2" />
      </>
    ),
  },
  find: {
    kind: "shapes",
    shapes: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m15.5 15.5 5 5" />
      </>
    ),
  },
  zoomIn: {
    kind: "shapes",
    shapes: (
      <>
        <circle cx="10" cy="10" r="6.5" />
        <path d="m15 15 6 6" />
        <path d="M7 10h6" />
        <path d="M10 7v6" />
      </>
    ),
  },
  zoomOut: {
    kind: "shapes",
    shapes: (
      <>
        <circle cx="10" cy="10" r="6.5" />
        <path d="m15 15 6 6" />
        <path d="M7 10h6" />
      </>
    ),
  },
  fitWidth: {
    kind: "shapes",
    shapes: (
      <>
        <path d="M3 5v14" />
        <path d="M21 5v14" />
        <path d="M4 12h16" />
        <path d="m7 9-3 3 3 3" />
        <path d="m17 9 3 3-3 3" />
      </>
    ),
  },
  fitPage: {
    kind: "shapes",
    shapes: (
      <>
        <path d="M3 8V3h5" />
        <path d="M16 3h5v5" />
        <path d="M21 16v5h-5" />
        <path d="M8 21H3v-5" />
        <rect x="8" y="6" width="8" height="12" rx="0.8" />
      </>
    ),
  },
  prevPage: { kind: "lucide", icon: ChevronLeft },
  nextPage: { kind: "lucide", icon: ChevronRight },
  pageJump: { kind: "lucide", icon: ArrowRightToLine },
  undo: {
    kind: "shapes",
    shapes: (
      <>
        <path d="M8 5 3 10l5 5" />
        <path d="M3 10h10a7 7 0 0 1 7 7v2" />
      </>
    ),
  },
  // NEW — redo the last undone change: the mirror of undo.
  redo: {
    kind: "shapes",
    shapes: (
      <>
        <path d="m16 5 5 5-5 5" />
        <path d="M21 10H11a7 7 0 0 0-7 7v2" />
      </>
    ),
  },
  tabNew: { kind: "lucide", icon: Plus },
  tabClose: { kind: "lucide", icon: SquareX },
  // NEW — two documents side by side (distinct from the two-page layout).
  "multi-mode": {
    kind: "shapes",
    shapes: (
      <>
        <rect x="3" y="4.5" width="7.5" height="15" rx="1.5" />
        <rect x="13.5" y="4.5" width="7.5" height="15" rx="1.5" />
        <path d="M5.5 8.5h2.5" />
        <path d="M16 8.5h2.5" />
      </>
    ),
  },
  paneOpen: { kind: "lucide", icon: FolderInput },
  panePick: { kind: "lucide", icon: FileInput },
  paneClear: { kind: "lucide", icon: PanelRightDashed },
  paneResize: { kind: "lucide", icon: SeparatorVertical },
  toggleTheme: {
    kind: "shapes",
    shapes: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 3.5v17" />
      </>
    ),
  },
  preferences: {
    kind: "shapes",
    shapes: (
      <>
        <path d="m9 3 .8 2.5h4.4L15 3l3 1.8-1.5 2.1 2.2 3.8 2.6-.5v3.6l-2.6-.5-2.2 3.8 1.5 2.1-3 1.8-.8-2.5H9.8L9 21l-3-1.8 1.5-2.1-2.2-3.8-2.6.5v-3.6l2.6.5 2.2-3.8L6 4.8 9 3Z" />
        <circle cx="12" cy="12" r="3" />
      </>
    ),
  },
  checkForUpdate: { kind: "lucide", icon: RefreshCw },
  updateDownload: { kind: "lucide", icon: Download },
  updateInstall: { kind: "lucide", icon: Check },
  about: { kind: "lucide", icon: Info },
  appMenu: { kind: "lucide", icon: Menu },
  // NEW — browse all tools: a panel with a tool list.
  toolsPalette: {
    kind: "shapes",
    shapes: (
      <>
        <rect x="3.5" y="4" width="17" height="16" rx="2" />
        <path d="M8 9h8" />
        <path d="M8 12.5h8" />
        <path d="M8 16h4" />
      </>
    ),
  },
  panMode: {
    kind: "shapes",
    shapes: (
      <path d="M8 11V6a1.5 1.5 0 0 1 3 0v5-7a1.5 1.5 0 0 1 3 0v7-5a1.5 1.5 0 0 1 3 0v5-2a1.5 1.5 0 0 1 3 0v6c0 4-2 7-6 7h-2c-2 0-3-1-4-3l-4-6a1.5 1.5 0 0 1 2-2l2 2v-2Z" />
    ),
  },
  railCollapse: {
    kind: "shapes",
    shapes: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M9 4v16" />
        <path d="m6 10-2 2 2 2" />
      </>
    ),
  },
  stagePages: {
    kind: "shapes",
    shapes: (
      <>
        <path d="M8 3h7l4 4v10H8V3Z" />
        <path d="M15 3v4h4" />
        <path d="M5 7H3.5v13H14v-1" />
      </>
    ),
  },
  stageEdit: {
    kind: "shapes",
    shapes: (
      <>
        <path d="m5 15 10.5-10.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z" />
        <path d="M13.5 6.5l3 3" />
      </>
    ),
  },
  stageReview: {
    kind: "shapes",
    shapes: (
      <>
        <path d="M5.5 4.5h13a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H10L5 22v-3.5a2 2 0 0 1-1.5-2v-10a2 2 0 0 1 2-2Z" />
        <path d="m8.5 11.5 2.5 2.5 4.5-4.5" />
      </>
    ),
  },
  stageDeliver: {
    kind: "shapes",
    shapes: (
      <>
        <path d="M12 4H5a1.5 1.5 0 0 0-1.5 1.5v13A1.5 1.5 0 0 0 5 20h10a1.5 1.5 0 0 0 1.5-1.5V8.5L12 4Z" />
        <path d="M12 4v4.5h4.5" />
        <path d="M12 13h9" />
        <path d="m18 10 3 3-3 3" />
      </>
    ),
  },
  windowMinimize: { kind: "lucide", icon: Minimize },
  // Caption alignment (Phase 103 chunk 3a): the rendered conventional caption
  // glyphs are Minus / Square / Copy / X, so maximize is the single square and
  // restore (the maximized state) is the distinct two-overlapping-squares Copy.
  windowMaximize: { kind: "lucide", icon: Square },
  windowRestore: { kind: "lucide", icon: Copy },
  windowClose: { kind: "lucide", icon: X },
  menuCheck: { kind: "lucide", icon: Check },
  openReadingView: {
    kind: "shapes",
    shapes: (
      <>
        <path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Z" />
        <path d="M12 5v15" />
      </>
    ),
  },
  // NEW — page-by-page comic viewport: a page divided into panels.
  openComicView: {
    kind: "shapes",
    shapes: (
      <>
        <rect x="4" y="3.5" width="16" height="17" rx="1.5" />
        <rect x="6.5" y="6" width="11" height="7" rx="0.8" />
        <path d="M6.5 16.5h4" />
        <path d="M13 16.5h4.5" />
      </>
    ),
  },
  // ---- CHROME / AFFORDANCE ------------------------------------------
  dialogClose: { kind: "lucide", icon: X },
  "tabClose (AnimatedTab)": { kind: "lucide", icon: X },
  dockScrollLeft: { kind: "lucide", icon: ChevronsLeft },
  dockScrollRight: { kind: "lucide", icon: ChevronsRight },
  dockOverflow: { kind: "lucide", icon: Ellipsis },
  dockRemove: { kind: "lucide", icon: Minus },
  // NEW — customise the dock verb set: a sliders/customization glyph.
  dockEditPencil: {
    kind: "shapes",
    shapes: (
      <>
        <path d="M4 7h16" />
        <path d="M4 12h16" />
        <path d="M4 17h16" />
        <circle cx="9" cy="7" r="1.7" />
        <circle cx="15" cy="12" r="1.7" />
        <circle cx="8" cy="17" r="1.7" />
      </>
    ),
  },
  // NEW — open the command palette: a search field with a magnifier.
  headerCommand: {
    kind: "shapes",
    shapes: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="3" />
        <circle cx="10.5" cy="12" r="3.2" />
        <path d="m12.8 14.3 3 3" />
      </>
    ),
  },
  headerTheme: {
    kind: "shapes",
    shapes: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 3.5v17" />
      </>
    ),
  },
  headerMenuDisclosure: { kind: "lucide", icon: ChevronDown },
  layoutOnePage: {
    kind: "shapes",
    shapes: <rect x="6" y="3" width="12" height="18" rx="1.5" />,
  },
  layoutTwoPage: {
    kind: "shapes",
    shapes: (
      <>
        <rect x="3" y="4" width="8" height="16" rx="1" />
        <rect x="13" y="4" width="8" height="16" rx="1" />
      </>
    ),
  },
  layoutFourPage: {
    kind: "shapes",
    shapes: (
      <>
        <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
        <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
        <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
        <rect x="13.5" y="13.5" width="7" height="7" rx="1" />
      </>
    ),
  },
};
