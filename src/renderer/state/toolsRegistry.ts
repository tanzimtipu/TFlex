// Phase 36 — the SINGLE inventory of every tool in the renderer.
//
// This module replaces the All-tools palette's private entries array as the
// one canonical list of tools. Every tool the UI offers is described here
// EXACTLY ONCE, with its label, description, icon, shortcut, the stage of
// work it belongs to and the command it runs. Surfaces (the palette today,
// the ContextPanel / Action Dock / Inspector / CommandPalette in later
// chunks) reference these entries — they never invent their own list.
//
// Rules this registry encodes:
//
//   - ONE canonical home per command. A command that today appears on two
//     surfaces (the toolbar's Merge button and the palette's Merge entry)
//     is ONE entry; a control that introduces a command of its own gets its
//     own entry. So `merge` covers the File menu row, the command bar
//     button, the welcome button and the palette row.
//   - `stage` is the entry's canonical home: 'pages' | 'edit' | 'review' |
//     'deliver' are the four rail stages, 'global' is the bucket for
//     commands with no natural stage (they live in the title bar / File
//     menu and in the command palette).
//   - `action` NAMES the existing command the entry runs. Nothing here
//     reimplements a handler: the value is the existing menu-action /
//     handler vocabulary where one exists (`merge`, `exportDocx`,
//     `checkForUpdate`, ...) and the entry's own id where the command is
//     introduced by its control (`annHighlight`, `editToolText`, ...).
//   - `availability` DECLARES the precondition a surface must honour to
//     enable the entry. It is the registry's description of the gate; the
//     hosting surface still owns the actual gating against live props.
//   - `shortcut` is the keyboard accelerator TEXT the palette shows, or ''
//     when the command has none. Accelerators that exist are never changed.
//
// INVENTORY AUDIT (Phase 36 chunk 1b). Sources walked:
//   - components/ToolsPalette.tsx      26 palette entries
//   - components/CommandBar.tsx        navigation / zoom / tools / actions
//   - components/MultiToolbar.tsx      the shared Multi Mode bar (same controls)
//   - components/AppHeader.tsx         File actions, tabs, print, gear, theme
//   - components/TitleBar.tsx          app menu button + window controls
//   - App.tsx menuGroups               File / Edit / View / Tools / Help rows
//   - annotations/AnnotationToolbar.tsx 11 annotation tools + colour + pen
//   - edit/EditToolbar.tsx             4 edit tools + default font
//   - components/SideRail.tsx          rail view tabs, collapse, page verbs,
//                                      per-page actions menu
//   - components/Welcome.tsx           open / create-from-images / merge /
//                                      recents / samples
//   - components/ToolsBadge.tsx        the All-tools badge (palette toggle)
//   - components/UpdateIndicator.tsx   download / restart-to-update
//   - DocumentView.tsx                 pan mode, canvas page-drag handle
//   - CreateFromImagesDialog.tsx       create-from-clipboard
//
// INVENTORY AUDIT (Phase 36 chunk 1b, DEF-306 sweep). Sources the first pass
// missed, walked by the same rule (a control that introduces a command of its
// own gets an entry; a control whose command already has a home does not):
//   - components/MultiPane.tsx         Multi Mode pane chrome: clear the
//                                      pane, pick an open document into it,
//                                      open a PDF into it, resize the panes
//   - components/PaneThumbStrip.tsx    the per-pane thumbnail strip — the
//                                      rail's ThumbnailRail rendered at the
//                                      pane's inner edge, so its thumb rows
//                                      are the same per-item rows the rail
//                                      audit exempts and its drag is the
//                                      registered `dragPage`
//   - components/StageRail.tsx         the four stage buttons (Ctrl+1..4) and
//                                      the bottom gear (the SAME command as
//                                      the title-bar gear, so `preferences`
//                                      owns it — no second entry)
//
// Multi-Mode-only chrome states its scope in the label/description, exactly
// like the existing Multi-Mode-scoped entries (`multi-mode`, `dragPage`): the
// availability union has no multi-mode-only value, so the hosting surface owns
// the live gate against the current mode and the entry's `availability` is the
// precondition that does exist (an open document, or a second document for the
// pick list).
//
// Deliberately OUT of scope (they are item-level editors, not tools, and the
// Phase 36 contract exempts them): the object-level action bars (annotation
// place/confirm, signature confirm/cancel/delete, text-box confirm/edit/delete,
// image replace/crop/remove), the floating text-properties panel's style
// buttons, panel-internal rows (annotation list rows, OCR suspect rows, pane
// pick rows, outline tree rows, thumbnail rows and recent-file rows are the
// hosting entries' own data), the search bar's own stepper (its `find` entry
// already owns the whole surface — open, walk the hits, close), the toast
// stack's dismiss affordance (a per-item row of a transient notification that
// auto-dismisses) and dialog form fields.

import {
  ALargeSmall,
  ArrowDownToLine,
  ArrowLeftRight,
  ArrowUpRight,
  BadgeCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  ClipboardPaste,
  Columns2,
  Crop,
  Download,
  Ellipsis,
  Expand,
  FileImage,
  FileOutput,
  FilePlus2,
  FileStack,
  FileText,
  Files,
  FolderOpen,
  GitMerge,
  GripVertical,
  Hand,
  Hash,
  Highlighter,
  Image,
  Images,
  Info,
  Layers,
  LayoutGrid,
  List,
  Menu,
  MessageCirclePlus,
  MessagesSquare,
  MessageSquare,
  Minimize2,
  Minus,
  Moon,
  MousePointer2,
  MoveHorizontal,
  Palette,
  PanelLeftClose,
  Pen,
  Pencil,
  PieChart,
  Plus,
  Printer,
  Redo2,
  RefreshCw,
  Replace,
  RotateCcw,
  RotateCw,
  Save,
  SaveAll,
  ScanText,
  Scissors,
  Search,
  Settings,
  Sparkles,
  Square,
  Stamp,
  StickyNote,
  Strikethrough,
  Trash2,
  Type,
  Underline,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Stage } from './stages';

/** The registry's stage vocabulary: the four rail stages plus the global
 *  bucket for commands with no natural stage. */
export type ToolStage = Stage | 'global';

/** The declared precondition a surface must honour to enable the entry. */
export type ToolAvailability =
  /** Works with or without an open document. */
  | 'always'
  /** Requires an open document. */
  | 'document'
  /** Requires at least one recent-file row. */
  | 'recents'
  /** Requires a document with AcroForm fields. */
  | 'form-fields'
  /** Requires a document that has had OCR run. */
  | 'ocr-run'
  /** Requires more than one open document (batch across tabs). */
  | 'multi-doc'
  /** Requires an open tab (an empty tab is not enough). */
  | 'tab'
  /** Requires a colour-capable annotation tool armed. */
  | 'colour-tool'
  /** Requires the ink (pen) tool armed. */
  | 'ink-tool'
  /** Requires a pending update (available or downloaded). */
  | 'update-pending'
  /** Requires a live page/thumbnail selection. */
  | 'selection';

/** Which surface renders this entry's own control. Exactly one surface owns
 *  a tool (one canonical home per tool):
 *
 *    'dock'    — the Action Dock lists it as a stage verb. The dock's curated
 *                set per stage is `DOCK_STAGE_IDS`; membership + ORDER is
 *                explicit there, so a dock tool that is not a concept verb
 *                (`rotateCounterClockwise`) stays out while a concept verb
 *                whose rail stage differs (`cropPages`) still renders.
 *    'flyout'  — the REVIEW annotations flyout hosts it (the dock references
 *                the whole set through its one `annotate` primary), so the
 *                dock never renders a second copy.
 *    'panel'   — a panel/rail/inspector/edit-layer/pill hosts the control
 *                (thumbnail verbs + menus, rail panel toggles, edit tools).
 *    'palette' — the browse-everything palette / title bar / menu hosts it.
 *
 *  Every registry entry is marked: `SURFACE_BY_ID` is a
 *  `Record<ToolId, ToolSurface>`, so the compiler refuses a missing id. */
export type ToolSurface = 'dock' | 'flyout' | 'panel' | 'palette';

export interface ToolEntry {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  /** Accelerator text shown by the palette, or '' when the command has
   *  none. Never invents an accelerator that is not already wired. */
  shortcut: string;
  stage: ToolStage;
  /** The command id the entry runs (an existing handler/dialog). */
  action: string;
  availability: ToolAvailability;
  /** The surface that hosts this entry's control. Defaults to 'dock'. */
  surface?: ToolSurface;
}

/** The palette's four section headers. Group and entry order is the
 *  canonical palette order the palette has always rendered; entry ids must
 *  match `data-tool-id`. Moved here verbatim from ToolsPalette so there is
 *  ONE list, not two. */
export const PALETTE_GROUPS: ReadonlyArray<{
  id: string;
  label: string;
  entryIds: readonly string[];
}> = [
  {
    id: 'organize',
    label: 'Organize Pages',
    entryIds: ['merge', 'split', 'extract', 'rotate', 'delete', 'insertPages', 'replacePages', 'renumberPages', 'cropPages'],
  },
  {
    id: 'document',
    label: 'Document',
    entryIds: ['sign', 'forms', 'flatten', 'optimize', 'audit', 'stamp', 'watermark', 'createFromImages', 'multi-mode'],
  },
  {
    id: 'recognition',
    label: 'Recognition',
    entryIds: ['recognizeText', 'batchOcr', 'ocrSuspects'],
  },
  {
    id: 'export',
    label: 'Export',
    entryIds: ['exportPages', 'exportText', 'exportDocx', 'exportComments', 'importComments'],
  },
];

/** The canonical id order of the palette's own entries (the ids the palette
 *  renders today). Kept as a derived constant so tests can pin the 26. */
export const PALETTE_TOOL_IDS: readonly string[] = PALETTE_GROUPS.flatMap(
  (group) => group.entryIds,
);

const REGISTRY = [
  // ---- PAGES ---------------------------------------------------------
  // get pages in, shuffle them into shape, get them out.
  {
    id: 'merge',
    label: 'Merge PDFs',
    description: 'Combine another PDF with the active document.',
    icon: GitMerge,
    shortcut: 'Ctrl+Shift+O',
    stage: 'pages',
    action: 'merge',
    availability: 'document',
  },
  {
    id: 'split',
    label: 'Split pages',
    description: 'Split a range of pages into a new document.',
    icon: Scissors,
    shortcut: '',
    stage: 'pages',
    action: 'split',
    availability: 'document',
  },
  {
    id: 'extract',
    label: 'Extract pages',
    description: 'Pull specific pages into a new document.',
    icon: ArrowDownToLine,
    shortcut: '',
    stage: 'pages',
    action: 'extract',
    availability: 'document',
  },
  {
    id: 'rotate',
    label: 'Rotate pages',
    description: 'Rotate the selected page clockwise or counter-clockwise.',
    icon: RotateCw,
    shortcut: '',
    stage: 'pages',
    action: 'rotateClockwise',
    availability: 'document',
  },
  {
    id: 'delete',
    label: 'Delete pages',
    description: 'Remove the selected page from the document.',
    icon: Trash2,
    shortcut: '',
    stage: 'pages',
    action: 'deletePages',
    availability: 'document',
  },
  {
    id: 'insertPages',
    label: 'Insert pages',
    description: 'Insert a blank page, or import pages from another PDF.',
    icon: FilePlus2,
    shortcut: '',
    stage: 'pages',
    action: 'insertPages',
    availability: 'document',
  },
  {
    id: 'replacePages',
    label: 'Replace pages',
    description: 'Swap a contiguous range with another PDF; outline and links survive.',
    icon: Replace,
    shortcut: '',
    stage: 'pages',
    action: 'replacePages',
    availability: 'document',
  },
  {
    id: 'renumberPages',
    label: 'Renumber pages',
    description: 'Set logical page labels (e.g. i, ii, iii).',
    icon: ArrowLeftRight,
    shortcut: '',
    stage: 'pages',
    action: 'renumberPages',
    availability: 'document',
  },
  {
    id: 'cropPages',
    label: 'Crop pages',
    description: 'Set the CropBox/TrimBox for every page.',
    icon: Crop,
    shortcut: '',
    stage: 'pages',
    action: 'cropPages',
    availability: 'document',
  },
  {
    id: 'rotateCounterClockwise',
    label: 'Rotate counter-clockwise',
    description: 'Rotate the visible page counter-clockwise.',
    icon: RotateCcw,
    shortcut: '',
    stage: 'pages',
    action: 'rotateCounterClockwise',
    availability: 'document',
  },
  {
    id: 'pageThumbnails',
    label: 'Page thumbnails',
    description: 'Show the rail\u2019s live page-preview stack.',
    icon: Images,
    shortcut: '',
    stage: 'pages',
    action: 'railTabThumbnails',
    availability: 'document',
  },
  {
    id: 'outlinePanel',
    label: 'Bookmarks',
    description: 'Show the document outline in the rail.',
    icon: List,
    shortcut: '',
    stage: 'pages',
    action: 'railTabOutline',
    availability: 'document',
  },
  {
    id: 'pageContextMenu',
    label: 'Page actions',
    description: 'Open the per-page actions menu (rotate, delete, merge into this page).',
    icon: Ellipsis,
    shortcut: '',
    stage: 'pages',
    action: 'pageContextMenu',
    availability: 'document',
  },
  {
    id: 'clearPageSelection',
    label: 'Clear page selection',
    description: 'Drop the current thumbnail selection.',
    icon: X,
    shortcut: '',
    stage: 'pages',
    action: 'clearPageSelection',
    availability: 'selection',
  },
  {
    id: 'dragPage',
    label: 'Drag page',
    description: 'Drag a page onto another pane to move or copy it.',
    icon: GripVertical,
    shortcut: '',
    stage: 'pages',
    action: 'dragPageToDocument',
    availability: 'document',
  },

  // ---- EDIT ----------------------------------------------------------
  // change what the page says: content, text, images, recognition.
  {
    id: 'editMode',
    label: 'Edit content',
    description: 'Replace text, add text boxes and edit images on the page.',
    icon: Pencil,
    shortcut: '',
    stage: 'edit',
    action: 'editModeToggle',
    availability: 'document',
  },
  {
    id: 'editToolOff',
    label: 'Edit mode off',
    description: 'Return the edit layer to the plain viewer.',
    icon: MousePointer2,
    shortcut: '',
    stage: 'edit',
    action: 'editToolOff',
    availability: 'document',
  },
  {
    id: 'editText',
    label: 'Edit text',
    description: 'Click a text run to replace it.',
    icon: Type,
    shortcut: '',
    stage: 'edit',
    action: 'editToolText',
    availability: 'document',
  },
  {
    id: 'editTextBox',
    label: 'Add a text box',
    description: 'Drag on the page to place a new text box.',
    icon: Plus,
    shortcut: '',
    stage: 'edit',
    action: 'editToolBox',
    availability: 'document',
  },
  {
    id: 'editImage',
    label: 'Edit images',
    description: 'Click an image to select it, or drag a rectangle to place a new one.',
    icon: Image,
    shortcut: '',
    stage: 'edit',
    action: 'editToolImage',
    availability: 'document',
  },
  {
    id: 'editDefaultFont',
    label: 'Default font',
    description: 'Choose the font new and replaced text uses.',
    icon: ALargeSmall,
    shortcut: '',
    stage: 'edit',
    action: 'editDefaultFont',
    availability: 'always',
  },
  {
    id: 'recognizeText',
    label: 'Recognize text (OCR)',
    description: 'Add a searchable text layer to a scanned PDF.',
    icon: ScanText,
    // DEF-049 — the renderer-side accelerator, surfaced in both the
    // palette and the Application > Tools menu row.
    shortcut: 'Ctrl+Shift+R',
    stage: 'edit',
    action: 'recognizeText',
    availability: 'document',
  },
  {
    id: 'batchOcr',
    label: 'Batch OCR all tabs',
    description: 'Run OCR on every open document, sequentially.',
    icon: ScanText,
    shortcut: '',
    stage: 'edit',
    action: 'batchOcr',
    availability: 'multi-doc',
  },
  {
    id: 'ocrSuspects',
    label: 'OCR suspects',
    description: 'Browse low-confidence words from the last OCR run.',
    icon: ScanText,
    shortcut: '',
    stage: 'edit',
    action: 'ocrSuspects',
    availability: 'ocr-run',
  },

  // ---- REVIEW --------------------------------------------------------
  // sign it off, comment on it, mark it up.
  //
  // Phase 36 (chunk 3b) — `annotate` is the REVIEW dock's primary: it opens
  // the ONE annotations flyout that hosts the existing AnnotationToolbar. The
  // annotation tool entries below carry `surface: 'flyout'`, so the flyout is
  // their canonical home and the dock does not render a duplicated set.
  {
    id: 'annotate',
    label: 'Annotate',
    description: 'Show the annotation tools: markup, shapes, ink and notes.',
    icon: Highlighter,
    shortcut: '',
    stage: 'review',
    action: 'annotate',
    availability: 'document',
  },
  {
    id: 'sign',
    label: 'Sign',
    description: 'Draw, type, or place a saved signature.',
    icon: Pen,
    shortcut: '',
    stage: 'review',
    action: 'sign',
    availability: 'always',
  },
  {
    id: 'forms',
    label: 'Forms',
    description: 'Fill AcroForm fields. Flatten when finished.',
    icon: Layers,
    shortcut: '',
    stage: 'review',
    action: 'forms',
    availability: 'form-fields',
  },
  {
    id: 'flatten',
    label: 'Flatten',
    description: 'Bake filled form values into the page content.',
    icon: FileStack,
    shortcut: '',
    stage: 'review',
    action: 'flatten',
    availability: 'form-fields',
  },
  {
    id: 'stamp',
    label: 'Stamp',
    description: 'Drop an APPROVED, DRAFT, CONFIDENTIAL or FINAL stamp.',
    icon: Stamp,
    shortcut: '',
    stage: 'review',
    action: 'stamp',
    availability: 'document',
  },
  {
    id: 'watermark',
    label: 'Watermark',
    description: 'Overlay text or an image across the selected pages.',
    icon: Type,
    shortcut: '',
    stage: 'review',
    action: 'watermark',
    availability: 'document',
  },
  {
    id: 'exportComments',
    label: 'Export comments (FDF)',
    description: 'Save every annotation to a local .fdf file.',
    icon: MessagesSquare,
    shortcut: '',
    stage: 'review',
    action: 'exportComments',
    availability: 'document',
  },
  {
    id: 'importComments',
    label: 'Import comments (FDF)',
    description: 'Merge a local .fdf file into the active document.',
    icon: MessagesSquare,
    shortcut: '',
    stage: 'review',
    action: 'importComments',
    availability: 'document',
  },
  {
    id: 'annotationsPanel',
    label: 'Annotations',
    description: 'Show the document\u2019s annotations in the rail.',
    icon: MessageSquare,
    shortcut: '',
    stage: 'review',
    action: 'railTabAnnotations',
    availability: 'document',
  },
  {
    id: 'annSelect',
    label: 'Select',
    description: 'Select and move existing annotations (no tool armed).',
    icon: MousePointer2,
    shortcut: '',
    stage: 'review',
    action: 'annotationSelect',
    availability: 'document',
    surface: 'flyout',
  },
  {
    id: 'annHighlight',
    label: 'Highlight',
    description: 'Highlight text runs.',
    icon: Highlighter,
    shortcut: '',
    stage: 'review',
    action: 'annotationHighlight',
    availability: 'document',
    surface: 'flyout',
  },
  {
    id: 'annUnderline',
    label: 'Underline',
    description: 'Underline text runs.',
    icon: Underline,
    shortcut: '',
    stage: 'review',
    action: 'annotationUnderline',
    availability: 'document',
    surface: 'flyout',
  },
  {
    id: 'annStrikeout',
    label: 'Strikethrough',
    description: 'Strike text runs through.',
    icon: Strikethrough,
    shortcut: '',
    stage: 'review',
    action: 'annotationStrikeout',
    availability: 'document',
    surface: 'flyout',
  },
  {
    id: 'annInk',
    label: 'Pen',
    description: 'Draw freehand ink.',
    icon: Pen,
    shortcut: '',
    stage: 'review',
    action: 'annotationInk',
    availability: 'document',
    surface: 'flyout',
  },
  {
    id: 'annTextbox',
    label: 'Text box',
    description: 'Place a text box annotation.',
    icon: Type,
    shortcut: '',
    stage: 'review',
    action: 'annotationTextbox',
    availability: 'document',
    surface: 'flyout',
  },
  {
    id: 'annRect',
    label: 'Rectangle',
    description: 'Draw a rectangle annotation.',
    icon: Square,
    shortcut: '',
    stage: 'review',
    action: 'annotationRect',
    availability: 'document',
    surface: 'flyout',
  },
  {
    id: 'annEllipse',
    label: 'Ellipse',
    description: 'Draw an ellipse annotation.',
    icon: Circle,
    shortcut: '',
    stage: 'review',
    action: 'annotationEllipse',
    availability: 'document',
    surface: 'flyout',
  },
  {
    id: 'annArrow',
    label: 'Arrow',
    description: 'Draw an arrow annotation.',
    icon: ArrowUpRight,
    shortcut: '',
    stage: 'review',
    action: 'annotationArrow',
    availability: 'document',
    surface: 'flyout',
  },
  {
    id: 'annCallout',
    label: 'Callout',
    description: 'Place a callout annotation.',
    icon: MessageCirclePlus,
    shortcut: '',
    stage: 'review',
    action: 'annotationCallout',
    availability: 'document',
    surface: 'flyout',
  },
  {
    id: 'annNote',
    label: 'Sticky note',
    description: 'Place a sticky note annotation.',
    icon: StickyNote,
    shortcut: '',
    stage: 'review',
    action: 'annotationNote',
    availability: 'document',
    surface: 'flyout',
  },
  {
    id: 'annColor',
    label: 'Annotation color',
    description: 'Choose the colour applied to the armed annotation tool.',
    icon: Palette,
    shortcut: '',
    stage: 'review',
    action: 'annotationColor',
    availability: 'colour-tool',
    surface: 'flyout',
  },
  {
    id: 'annPenWidth',
    label: 'Pen width',
    description: 'Choose the ink stroke width.',
    icon: Minus,
    shortcut: '',
    stage: 'review',
    action: 'annotationPenWidth',
    availability: 'ink-tool',
    surface: 'flyout',
  },

  // ---- DELIVER -------------------------------------------------------
  // shrink it, audit it, get it out of TFlex in the format the user needs.
  {
    id: 'optimize',
    label: 'Reduce file size',
    description: 'Re-serialise the document with a compression preset.',
    icon: Minimize2,
    shortcut: '',
    stage: 'deliver',
    action: 'optimize',
    availability: 'document',
  },
  {
    id: 'audit',
    label: 'Audit space usage',
    description: 'See a per-element breakdown of the file size.',
    icon: PieChart,
    shortcut: '',
    stage: 'deliver',
    action: 'auditSpace',
    availability: 'document',
  },
  {
    id: 'createFromImages',
    label: 'Create PDF from images',
    description: 'Combine picked images into a new PDF document.',
    icon: FileImage,
    shortcut: '',
    stage: 'deliver',
    action: 'createFromImages',
    availability: 'always',
  },
  {
    id: 'exportPages',
    label: 'Export pages as images',
    description: 'Save selected pages as PNG, JPEG, or TIFF files.',
    icon: ArrowDownToLine,
    shortcut: '',
    stage: 'deliver',
    action: 'exportPages',
    availability: 'document',
  },
  {
    id: 'exportText',
    label: 'Export text',
    description: 'Save extracted text as .txt or .rtf.',
    icon: FileText,
    shortcut: '',
    stage: 'deliver',
    action: 'exportText',
    availability: 'document',
  },
  {
    id: 'exportDocx',
    label: 'Export to Word (.docx)',
    description: 'Render every page to a single .docx document.',
    icon: ArrowDownToLine,
    shortcut: '',
    stage: 'deliver',
    action: 'exportDocx',
    availability: 'document',
  },

  // ---- GLOBAL --------------------------------------------------------
  // No natural stage: these live in the title bar / File menu and in the
  // command palette. Multi Mode's canonical home is here (title bar +
  // palette), per the operator-approved placement.
  {
    id: 'open',
    label: 'Open PDF',
    description: 'Open a PDF from disk.',
    icon: FolderOpen,
    shortcut: 'Ctrl+O',
    stage: 'global',
    action: 'open',
    availability: 'always',
  },
  {
    id: 'openRecent',
    label: 'Open recent file',
    description: 'Reopen a document from the Recent list.',
    icon: FileText,
    shortcut: '',
    stage: 'global',
    action: 'openRecent',
    availability: 'recents',
  },
  {
    id: 'openSample',
    label: 'Open sample document',
    description: 'Open one of the bundled sample PDFs.',
    icon: Sparkles,
    shortcut: '',
    stage: 'global',
    action: 'openSample',
    availability: 'always',
  },
  {
    id: 'removeRecent',
    label: 'Remove from Recents',
    description: 'Drop one entry from the Recent list.',
    icon: X,
    shortcut: '',
    stage: 'global',
    action: 'removeRecent',
    availability: 'recents',
  },
  {
    id: 'createFromClipboard',
    label: 'Create PDF from clipboard',
    description: 'Build a new PDF from the image currently on the clipboard.',
    icon: ClipboardPaste,
    shortcut: '',
    stage: 'global',
    action: 'createFromClipboard',
    availability: 'always',
  },
  {
    id: 'save',
    label: 'Save',
    description: 'Write the pending engine changes back to the open file.',
    icon: Save,
    shortcut: 'Ctrl+S',
    stage: 'global',
    action: 'save',
    availability: 'tab',
  },
  {
    id: 'saveAs',
    label: 'Save a copy',
    description: 'Save the active document to a new file.',
    icon: SaveAll,
    shortcut: 'Ctrl+Shift+S',
    stage: 'global',
    action: 'saveAs',
    availability: 'tab',
  },
  {
    id: 'print',
    label: 'Print',
    description: 'Open the print dialog for the active document.',
    icon: Printer,
    shortcut: 'Ctrl+P',
    stage: 'global',
    action: 'print',
    availability: 'document',
  },
  {
    id: 'find',
    label: 'Find in document',
    description: 'Search the active document and walk the hits.',
    icon: Search,
    shortcut: 'Ctrl+F',
    stage: 'global',
    action: 'find',
    availability: 'document',
  },
  {
    id: 'zoomIn',
    label: 'Zoom in',
    description: 'Increase the canvas zoom level.',
    icon: ZoomIn,
    shortcut: 'Ctrl+=',
    stage: 'global',
    action: 'zoomIn',
    availability: 'document',
  },
  {
    id: 'zoomOut',
    label: 'Zoom out',
    description: 'Decrease the canvas zoom level.',
    icon: ZoomOut,
    shortcut: 'Ctrl+-',
    stage: 'global',
    action: 'zoomOut',
    availability: 'document',
  },
  {
    id: 'fitWidth',
    label: 'Fit width',
    description: 'Scale the page to the width of the canvas.',
    icon: MoveHorizontal,
    shortcut: '',
    stage: 'global',
    action: 'fitWidth',
    availability: 'document',
  },
  {
    id: 'fitPage',
    label: 'Fit page',
    description: 'Scale the page to fit the whole canvas.',
    icon: Expand,
    shortcut: '',
    stage: 'global',
    action: 'fitPage',
    availability: 'document',
  },
  {
    id: 'prevPage',
    label: 'Previous page',
    description: 'Step back one page.',
    icon: ChevronLeft,
    shortcut: '',
    stage: 'global',
    action: 'prevPage',
    availability: 'document',
  },
  {
    id: 'nextPage',
    label: 'Next page',
    description: 'Step forward one page.',
    icon: ChevronRight,
    shortcut: '',
    stage: 'global',
    action: 'nextPage',
    availability: 'document',
  },
  {
    id: 'pageJump',
    label: 'Go to page',
    description: 'Jump to a page number (or a logical page label).',
    icon: Hash,
    shortcut: '',
    stage: 'global',
    action: 'pageJump',
    availability: 'document',
  },
  {
    id: 'undo',
    label: 'Undo',
    description: 'Undo the last document change.',
    icon: Undo2,
    shortcut: 'Ctrl+Z',
    stage: 'global',
    action: 'undo',
    availability: 'document',
  },
  {
    id: 'redo',
    label: 'Redo',
    description: 'Redo the last undone change.',
    icon: Redo2,
    shortcut: 'Ctrl+Shift+Z',
    stage: 'global',
    action: 'redo',
    availability: 'document',
  },
  {
    id: 'tabNew',
    label: 'New empty tab',
    description: 'Open an empty tab to drop a document into.',
    icon: Plus,
    shortcut: '',
    stage: 'global',
    action: 'tabNew',
    availability: 'tab',
  },
  {
    id: 'tabClose',
    label: 'Close Tab',
    description: 'Close the active tab (prompting when there are unsaved changes).',
    icon: X,
    shortcut: 'Ctrl+W',
    stage: 'global',
    action: 'closeTab',
    availability: 'tab',
  },
  {
    id: 'multi-mode',
    label: 'Multi Mode',
    description: 'View two documents side by side in one workspace.',
    icon: Columns2,
    shortcut: '',
    stage: 'global',
    action: 'multiModeToggle',
    availability: 'document',
  },
  // DEF-306 — the Multi Mode pane chrome (components/MultiPane.tsx). The
  // command each entry names is the control's own, run by App's existing
  // handler (`onOpenIntoPane` / `onPickPane` -> `assignPaneDocument` /
  // `onClearPane` -> `resolvePaneClear` + the multiMode reducer /
  // `onSplitChange` -> `setSplitFraction`); nothing here reimplements them.
  // One entry per command, not one per pane: A and B render the same control.
  {
    id: 'paneOpen',
    label: 'Open a PDF into a pane',
    description: 'Open a document from disk straight into an empty Multi Mode pane.',
    icon: FolderOpen,
    shortcut: '',
    stage: 'global',
    action: 'paneOpen',
    availability: 'document',
  },
  {
    id: 'panePick',
    label: 'Show a document in a pane',
    description: 'Pick one of the open documents to fill a Multi Mode pane.',
    icon: FileText,
    shortcut: '',
    stage: 'global',
    action: 'panePick',
    // The pick list only renders while a SECOND document is open (the pane's
    // own document and the other pane's are excluded); its rows are per-item
    // rows of this command, not entries of their own.
    availability: 'multi-doc',
  },
  {
    id: 'paneClear',
    label: 'Clear a pane',
    description: 'Empty a Multi Mode pane and choose another document for it.',
    icon: X,
    shortcut: '',
    stage: 'global',
    action: 'paneClear',
    availability: 'document',
  },
  {
    id: 'paneResize',
    label: 'Resize panes',
    description: 'Drag the divider to give one Multi Mode pane more of the workspace.',
    icon: GripVertical,
    shortcut: '',
    stage: 'global',
    action: 'paneResize',
    availability: 'document',
  },
  {
    id: 'toggleTheme',
    label: 'Toggle Theme',
    description: 'Switch between Light, Dark and Frosted Glass.',
    icon: Moon,
    shortcut: 'Ctrl+Shift+T',
    stage: 'global',
    action: 'toggleTheme',
    availability: 'always',
  },
  {
    id: 'preferences',
    label: 'Preferences',
    description: 'Open the preferences sheet.',
    icon: Settings,
    shortcut: 'Ctrl+,',
    stage: 'global',
    action: 'preferences',
    availability: 'always',
  },
  {
    id: 'checkForUpdate',
    label: 'Check for Update',
    description: 'Ask the updater whether a newer TFlex exists.',
    icon: RefreshCw,
    shortcut: 'Ctrl+Shift+U',
    stage: 'global',
    action: 'checkForUpdate',
    availability: 'always',
  },
  {
    id: 'updateDownload',
    label: 'Download update',
    description: 'Start downloading the update the indicator announced.',
    icon: Download,
    shortcut: '',
    stage: 'global',
    action: 'updateDownload',
    availability: 'update-pending',
  },
  {
    id: 'updateInstall',
    label: 'Restart to update',
    description: 'Install the downloaded update and relaunch TFlex.',
    icon: Check,
    shortcut: '',
    stage: 'global',
    action: 'updateInstall',
    availability: 'update-pending',
  },
  {
    id: 'about',
    label: 'About TFlex',
    description: 'Version, credits and the changelog.',
    icon: Info,
    shortcut: '',
    stage: 'global',
    action: 'about',
    availability: 'always',
  },
  {
    id: 'appMenu',
    label: 'Application menu',
    description: 'Open the File / Edit / View / Tools / Help menu.',
    icon: Menu,
    shortcut: '',
    stage: 'global',
    action: 'appMenu',
    availability: 'always',
  },
  {
    // Phase 36 (chunk 4) — this entry now opens the COMMAND PALETTE: the
    // browse-everything surface that supersedes the All-tools panel. The
    // `Ctrl+Shift+P` accelerator stays its legacy alias, and the panel itself
    // is retired in the next chunk (its badge keeps it reachable until then),
    // so nothing is unreachable in between.
    id: 'toolsPalette',
    label: 'Browse all tools',
    description:
      'Open the command palette and search every tool, recent file and view action.',
    icon: LayoutGrid,
    shortcut: 'Ctrl+Shift+P',
    stage: 'global',
    action: 'openCommandPalette',
    availability: 'always',
  },
  {
    id: 'panMode',
    label: 'Pan mode',
    description: 'Drag anywhere to scroll the document.',
    icon: Hand,
    shortcut: '',
    stage: 'global',
    action: 'handToggle',
    availability: 'document',
  },
  {
    id: 'railCollapse',
    label: 'Collapse panel',
    description: 'Collapse or expand the left rail.',
    icon: PanelLeftClose,
    shortcut: '',
    stage: 'global',
    action: 'railCollapse',
    availability: 'document',
  },
  // DEF-306 — the Stage Rail's four stage buttons (components/StageRail.tsx).
  // Each names the command its button runs (App's `onStageChange`), with the
  // `Ctrl+1..4` accelerator that is already wired. The rail's bottom gear
  // opens the SAME Preferences sheet as the title-bar gear, so the existing
  // `preferences` entry owns that command — no second entry.
  {
    id: 'stagePages',
    label: 'Pages stage',
    description: 'Switch the workspace to the PAGES stage.',
    icon: Files,
    shortcut: 'Ctrl+1',
    stage: 'global',
    action: 'stagePages',
    availability: 'always',
  },
  {
    id: 'stageEdit',
    label: 'Edit stage',
    description: 'Switch the workspace to the EDIT stage.',
    icon: Pencil,
    shortcut: 'Ctrl+2',
    stage: 'global',
    action: 'stageEdit',
    availability: 'always',
  },
  {
    id: 'stageReview',
    label: 'Review stage',
    description: 'Switch the workspace to the REVIEW stage.',
    icon: BadgeCheck,
    shortcut: 'Ctrl+3',
    stage: 'global',
    action: 'stageReview',
    availability: 'always',
  },
  {
    id: 'stageDeliver',
    label: 'Deliver stage',
    description: 'Switch the workspace to the DELIVER stage.',
    icon: FileOutput,
    shortcut: 'Ctrl+4',
    stage: 'global',
    action: 'stageDeliver',
    availability: 'always',
  },
  {
    id: 'windowMinimize',
    label: 'Minimize window',
    description: 'Minimize the TFlex window.',
    icon: Minus,
    shortcut: '',
    stage: 'global',
    action: 'windowMinimize',
    availability: 'always',
  },
  {
    id: 'windowMaximize',
    label: 'Maximize window',
    description: 'Maximize or restore the TFlex window.',
    icon: Square,
    shortcut: '',
    stage: 'global',
    action: 'windowMaximize',
    availability: 'always',
  },
  {
    id: 'windowClose',
    label: 'Close window',
    description: 'Close the TFlex window.',
    icon: X,
    shortcut: '',
    stage: 'global',
    action: 'windowClose',
    availability: 'always',
  },

] as const satisfies readonly ToolEntry[];

export type ToolId = (typeof REGISTRY)[number]['id'];
export type ToolActionId = (typeof REGISTRY)[number]['action'];

/** Every entry's hosting surface, keyed by id. A `Record<ToolId, ToolSurface>`
 *  so the compiler forces a value for EVERY registry entry — a new tool must
 *  declare where its control lives, or this map fails to compile. */
const SURFACE_BY_ID: Record<ToolId, ToolSurface> = {
  // PAGES — the curated dock set is rotate/extract/insertPages/replacePages/
  // split/delete; the rest keep a panel or palette home.
  merge: 'palette',
  split: 'dock',
  extract: 'dock',
  rotate: 'dock',
  delete: 'dock',
  insertPages: 'dock',
  replacePages: 'dock',
  renumberPages: 'panel',
  cropPages: 'dock',
  rotateCounterClockwise: 'panel',
  pageThumbnails: 'panel',
  outlinePanel: 'panel',
  pageContextMenu: 'panel',
  clearPageSelection: 'panel',
  dragPage: 'panel',
  // EDIT — the curated dock set is editMode/editText/editImage/editTextBox/
  // recognizeText/cropPages; the edit layer itself hosts the tool toggles.
  editMode: 'dock',
  editToolOff: 'panel',
  editText: 'dock',
  editTextBox: 'dock',
  editImage: 'dock',
  editDefaultFont: 'panel',
  recognizeText: 'dock',
  batchOcr: 'palette',
  ocrSuspects: 'palette',
  // REVIEW — the curated dock set is annotate/sign/stamp/flatten; the
  // annotation set lives in the flyout; forms/watermark/comments are palette.
  annotate: 'dock',
  sign: 'dock',
  forms: 'palette',
  flatten: 'dock',
  stamp: 'dock',
  watermark: 'palette',
  exportComments: 'palette',
  importComments: 'palette',
  annotationsPanel: 'panel',
  annSelect: 'flyout',
  annHighlight: 'flyout',
  annUnderline: 'flyout',
  annStrikeout: 'flyout',
  annInk: 'flyout',
  annTextbox: 'flyout',
  annRect: 'flyout',
  annEllipse: 'flyout',
  annArrow: 'flyout',
  annCallout: 'flyout',
  annNote: 'flyout',
  annColor: 'flyout',
  annPenWidth: 'flyout',
  // DELIVER — the curated dock set is optimize/audit/exportPages/exportText/
  // exportDocx; create-from-images lives in the palette + welcome.
  optimize: 'dock',
  audit: 'dock',
  createFromImages: 'palette',
  exportPages: 'dock',
  exportText: 'dock',
  exportDocx: 'dock',
  // GLOBAL — no dock verb: the title bar / File menu / palette (and the
  // floating pills for the view controls) own these.
  open: 'palette',
  openRecent: 'palette',
  openSample: 'palette',
  removeRecent: 'palette',
  createFromClipboard: 'palette',
  save: 'palette',
  saveAs: 'palette',
  print: 'palette',
  find: 'palette',
  zoomIn: 'panel',
  zoomOut: 'panel',
  fitWidth: 'panel',
  fitPage: 'panel',
  prevPage: 'panel',
  nextPage: 'panel',
  pageJump: 'panel',
  undo: 'palette',
  redo: 'palette',
  tabNew: 'palette',
  tabClose: 'palette',
  'multi-mode': 'palette',
  paneOpen: 'panel',
  panePick: 'panel',
  paneClear: 'panel',
  paneResize: 'panel',
  toggleTheme: 'palette',
  preferences: 'palette',
  checkForUpdate: 'palette',
  updateDownload: 'palette',
  updateInstall: 'palette',
  about: 'palette',
  appMenu: 'palette',
  toolsPalette: 'palette',
  panMode: 'panel',
  railCollapse: 'panel',
  stagePages: 'palette',
  stageEdit: 'palette',
  stageReview: 'palette',
  stageDeliver: 'palette',
  windowMinimize: 'palette',
  windowMaximize: 'palette',
  windowClose: 'palette',
};

export const TOOL_REGISTRY: readonly ToolEntry[] = REGISTRY.map((entry) => ({
  ...entry,
  surface: SURFACE_BY_ID[entry.id],
}));

const BY_ID: ReadonlyMap<string, ToolEntry> = new Map(
  TOOL_REGISTRY.map((entry) => [entry.id as string, entry]),
);

/** The registry entry for a tool id, or `undefined`. */
export function toolById(id: string): ToolEntry | undefined {
  return BY_ID.get(id);
}

/** Every entry whose canonical home is `stage` (rail stages plus global). */
export function toolsForStage(stage: ToolStage): readonly ToolEntry[] {
  return TOOL_REGISTRY.filter((entry) => entry.stage === stage);
}

/** The Action Dock's CURATED verb set per stage, in render order. The
 *  concept "Action Dock" shows 5-7 verbs per stage, NOT every registry entry
 *  whose rail stage matches: panel/section/view controls (thumbnails, outline,
 *  per-page menus, clear, drag) and the non-concept commands (merge, renumber,
 *  rotate-counter-clockwise, watermark, the extra exports, every GLOBAL entry)
 *  keep a panel/palette home and must not crowd the dock (DEF-313). `|` in the
 *  concept's table separates visual groups; the dock renders one row.
 *
 *  PAGES:  rotate · extract · insertPages · replacePages | split · delete
 *  EDIT:   editMode (the toggle/primary) · editText · editImage · editTextBox
 *          | recognizeText · cropPages
 *  REVIEW: annotate (the flyout primary) · sign · stamp | flatten
 *  DELIVER: optimize · audit | exportPages · exportText · exportDocx
 *
 *  `editMode` is the EDIT primary and the ONLY control that turns Edit mode on
 *  (DEF-314): it is enabled whenever a document is open and shows its pressed
 *  state while Edit mode is on. */
export const DOCK_STAGE_IDS: Readonly<Record<Stage, readonly string[]>> = {
  pages: ['rotate', 'extract', 'insertPages', 'replacePages', 'split', 'delete'],
  edit: ['editMode', 'editText', 'editImage', 'editTextBox', 'recognizeText', 'cropPages'],
  review: ['annotate', 'sign', 'stamp', 'flatten'],
  deliver: ['optimize', 'audit', 'exportPages', 'exportText', 'exportDocx'],
};

/** True when the Action Dock hosts this entry as a verb. Entries the REVIEW
 *  flyout hosts (`surface: 'flyout'`) and every panel/palette entry are
 *  skipped: the dock renders only the curated `DOCK_STAGE_IDS` set. */
export function isDockSurfaceEntry(entry: ToolEntry): boolean {
  return (entry.surface ?? 'dock') === 'dock';
}

/** The registry ACTIONS the curated Action Dock hosts in some stage. DEF-327 —
 *  the Command Palette asks the dock's own gate about exactly these actions and
 *  keeps its host-level availability for everything else, so the two surfaces
 *  can never disagree about a verb they both show. */
const DOCK_HOSTED_ACTIONS: ReadonlySet<string> = new Set(
  Object.values(DOCK_STAGE_IDS)
    .flat()
    .map((id) => BY_ID.get(id)?.action)
    .filter((action): action is string => action !== undefined),
);

/** True when the Action Dock hosts this registry ACTION in any stage. */
export function isDockHostedAction(action: string): boolean {
  return DOCK_HOSTED_ACTIONS.has(action);
}

/** The Action Dock's curated verb set for a stage, resolved from the registry
 *  by id so each verb reuses the registry's own icon/label/gate. A stage with
 *  no curated list (or `global`) renders no dock verbs. */
export function dockToolsForStage(stage: ToolStage): readonly ToolEntry[] {
  if (stage === 'global') return [];
  return DOCK_STAGE_IDS[stage].flatMap((id) => {
    const entry = BY_ID.get(id);
    return entry === undefined || !isDockSurfaceEntry(entry) ? [] : [entry];
  });
}

/** The canonical entry order the All-tools palette renders. */
export function paletteEntries(): readonly ToolEntry[] {
  return PALETTE_TOOL_IDS.flatMap((id) => {
    const entry = BY_ID.get(id);
    return entry === undefined ? [] : [entry];
  });
}
