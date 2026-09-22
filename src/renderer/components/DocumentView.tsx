import type { PDFDocumentProxy } from "pdfjs-dist";
import { AnimatePresence } from "motion/react";
import { ChevronLeft, ChevronRight, GripVertical } from "lucide-react";
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  accumulateWheel,
  stepTowards,
  zoomReducer,
  type ZoomMode,
  type ZoomState,
} from "../state/zoom";
import {
  buildPageIndex,
  findPageHits,
  nextHitIndex,
  prevHitIndex,
  type PageTextIndex,
  type SearchHit,
} from "../search/searchIndex";
import {
  isPanBlockingTarget,
  panScrollPosition,
  type PanDragStart,
} from "../state/handPan";
import type { OutlineNode } from "../pdf/pdfjs";
import { PageView } from "./PageView";
import { SearchBar } from "./SearchBar";
import { SideRail } from "./SideRail";
import { PaneThumbStrip } from "./PaneThumbStrip";
import { usePageDragOptional } from "../state/PageDragContext";
import {
  buildDragSource,
  canvasDropIsAfter,
  canvasInsertIndex,
  dropEffectFor,
  dropModeFromEvent,
  resolveDrop,
  type PageDropOp,
} from "../state/pageDrag";
import { Toolbar } from "./Toolbar";
import { AnnotationToolbar } from "../annotations/AnnotationToolbar";
import { EditToolbar, defaultEditHint } from "../edit/EditToolbar";
import { TextPropertiesPanel, isTextPanelFocusTarget } from "../edit/TextPropertiesPanel";
import {
  annotationStyleFromPanelPatch,
  applyPatchToValues,
  defaultTextStyleValues,
  editColorToHex,
  editTextStyleFromValues,
  textStyleValuesFromStyle,
  type TextStyleValues,
} from "../edit/textStyle";
import { engineTextBoxesToPlacements, hexToEditColor, sameTextBoxes } from "../edit/model";
import type { TextBoxStylePatch } from "../../shared/types";
import type { EngineState } from "../engine/types";
import {
  annotationColorToCss,
  annotationToolReducer,
  initialAnnotationToolState,
  rectGeometryPatch,
  type Annotation,
  type AnnotationPatch,
  type AnnotationTool,
  type AnnotationToolAction,
} from "../annotations/model";
import { ANN_TEXT_FONT_CSS } from "../annotations/annTextStyle";
import { annTextMaxHeightPt, grownAnnTextRect } from "../annotations/annTextLayout";
import { measureTextWidthCss } from "../edit/rasterize";
import {
  CONTENT_PADDING_PX,
  mixedPageAtScrollTop,
  mixedSlotOffsetTop,
  mixedVisiblePageRange,
  resolvePageLabel,
  visibleToSourcePageForProxy,
  type MixedPageGeom,
} from "./pageGeometry";
import {
  createIdleCleanupCoordinator,
  type IdleCleanupCoordinator,
} from "../utils/idleCleanup";
import type {
  AppTheme,
  FormField,
  SavedSignature,
  SignaturePlacement,
} from "../../shared/types";
import type { PaneId } from "../state/multiMode";
import type {
  PaneToolbarCommands,
  PaneToolbarValues,
  SharedToolController,
} from "./multiToolController";

export interface PersistedViewer {
  zoomMode: ZoomMode;
  manualScale: number;
  currentPage: number;
  searchOpen: boolean;
  query: string;
  activeHitIndex: number;
}

export interface SearchIndexProgress {
  built: number;
  total: number;
}

export interface DocDiagnostics {
  pageCount: number;
  currentPage: number;
  zoom: number;
  mode: ZoomMode;
  searchQuery: string;
  searchHits: number;
  searchIndexProgress: SearchIndexProgress | null;
  // DEF-093 — the active annotation tool (null when no tool is armed,
  // i.e. when the user is in plain "select" mode). The renderer state
  // holds an `AnnotationTool` enum whose `"select"` value means "no
  // tool active"; e2e harnesses had been getting `undefined` for this
  // field because it was never reported through the diagnostics
  // channel. Mirroring the `"select"` -> `null` mapping here keeps the
  // contract uniform across the surface (every key is either a value
  // or `null`, never `undefined`). The previous behaviour — omitting
  // the key entirely — left harnesses with an `undefined` they had to
  // special-case.
  activeTool: AnnotationTool | null;
}

interface DocumentViewProps {
  doc: PDFDocumentProxy;
  pageCount: number;
  outline: OutlineNode[] | null;
  initial: PersistedViewer;
  onPersist: (v: PersistedViewer) => void;
  onDiagnostics: (d: DocDiagnostics) => void;
  onSearchIndexProgress?: (p: SearchIndexProgress | null) => void;
  /** Def-050 — register an imperative invalidator the host can call
   *  when the underlying doc's text content has changed (e.g. after
   *  OCR writes an invisible Tr=3 text layer to the engine's copy of
   *  the doc). The invalidator clears the cached per-page
   *  `PageTextIndex` entries and re-runs the search effect so the
   *  next `findPageHits` walks `pdf.js`'s `getTextContent()` afresh
   *  — picking up OCR words that the prior cache didn't have. The
   *  callback runs synchronously; no-op when the search bar isn't
   *  open. */
  registerSearchIndexInvalidator?: (invalidate: () => void) => void;
  onToast?: (kind: "error" | "info", text: string) => void;
  /** Live engine state for the active tab. Drives the rail pageCount,
   *  thumbnail rotations, and toolbar modified indicator. */
  engineState: EngineState;
  /** DEF-139 — true once the tab's pdf.js `doc` proxy was rebuilt from
   *  `engine.getDocumentBytes` bytes via `refreshDocProxyFor`. A
   *  re-serialized file is written in the engine's VISIBLE order (the
   *  `serializeDoc` `pageOrder` sequence), so the renderer must ask the
   *  proxy for `visiblePage` itself — NOT `pageOrder[visiblePage-1]+1`,
   *  which is a pdf-lib ORIGINAL page index and only addresses the
   *  original open bytes. Defaults to false (original proxy). */
  proxyVisibleOrder?: boolean;
  /** True when the active tab has unsaved engine changes. Phase 22 —
   *  the CommandBar no longer shows a Save control, so this view no
   *  longer reads it; the title bar (AppHeader) owns Save state. The
   *  prop is retained (optional) for host/harness compatibility. */
  modified?: boolean;
  /** Whether undo is currently possible for the active tab. */
  canUndo: boolean;
  /** False for sample documents (Save is gated to Save-As only).
   *  Phase 22 — no longer read here (Save moved to the title bar). */
  saveInPlaceEnabled?: boolean;
  /** Rail engine callbacks. Each is optional so the rail can degrade
   *  gracefully (e.g. tests can omit them to render the rail with no
   *  editing capability). */
  onRotate?: (op: { kind: "rotate"; page: number; dir: "cw" | "ccw" }) => void;
  onDelete?: (pages: number[]) => void;
  onReorder?: (fromIndex: number, toIndex: number) => void;
  onUndo?: () => void;
  /** Toolbar action callbacks. */
  /** Phase 14.1 — the command bar's accent Open button (the reference
   *  places Open in the command bar, not the title bar). Phase 22 —
   *  SUPERSEDED: Open / Save / Save As live in the caption strip
   *  (AppHeader's .titlebar-file group), so these props are no longer
   *  read here. They stay on the interface for host/harness
   *  compatibility; the real app wires the title bar directly. */
  onOpenFile?: () => void;
  onSave?: () => void;
  onSaveAs?: () => void;
  onMerge?: () => void;
  onSplit?: () => void;
  /** Phase 8 — Optimize / Audit Space dialogs. Both are toolbar
   *  actions that the host owns (the dialogs are mounted at the App
   *  level). The toolbar buttons are disabled when there's no active
   *  document, so the dialogs themselves don't need a guard. */
  onOptimize?: () => void;
  onAuditSpace?: () => void;
  /** DEF-041 — Rotate the current page clockwise. The host passes a
   *  callback that uses `engine.applyOp({kind:'rotate', page, dir:'cw'})`
   *  with the page the toolbar reports as currently visible. The
   *  toolbar button only renders when this is wired, so missing
   *  wiring (e.g. tests) doesn't surface a no-op button. */
  onRotateClockwise?: () => void;
  /** Phase 13 — Rotate the current page counter-clockwise. Same
   *  contract as `onRotateClockwise` with the engine op dir flipped
   *  to "ccw"; the toolbar button only renders when wired. */
  onRotateCounterClockwise?: () => void;
  /** B8 — Delete pages (current / custom range). The toolbar
   *  button only renders when this is wired, mirroring the
   *  `onRotateClockwise` opt-in. Disabled when there's only one
   *  page left. */
  onDeletePage?: () => void;
  canDeletePage?: boolean;
  /** Phase 3 — annotations. The host (App) holds the canonical list; this
   *  view threads it through to each PageView's overlay and the rail's
   *  annotations panel. */
  annotations?: Annotation[];
  /** DEF-166 — annotation ids whose overlay text must be drawn LIVE
   *  (created / edited since the current page-canvas bytes were
   *  loaded). Threaded to every PageView's AnnotationOverlay so a
   *  parsed-from-file textbox/callout (whose baked FreeText
   *  appearance pdf.js already paints into the page canvas) does not
   *  draw a duplicated overlay text on reopen. */
  liveAnnTextIds?: ReadonlySet<string>;
  onCreateAnnotation?: (annotation: Annotation) => void;
  onEditAnnotation?: (id: string, patch: AnnotationPatch) => void;
  onDeleteAnnotation?: (id: string) => void;
  /** Phase 28 — append a comment / reply to an annotation's thread. The
   *  host (App) routes it to the engine and mirrors the echoed state,
   *  which refreshes the comment box's list and flips the annotation's
   *  comment badge on. Threaded to every PageView's overlay. */
  onAddComment?: (annotationId: string, text: string) => void;
  // -- Phase 4: forms --
  formFields?: FormField[];
  onFormValueChange?: (id: string, value: string | string[]) => void;
  onFormListboxToggle?: (id: string, option: string) => void;
  // -- Phase 4: signatures --
  signatures?: SignaturePlacement[];
  savedSignatures?: SavedSignature[];
  armedSignatureId?: string | null;
  /** B10 — armed stamp. When non-null, every PageView shows a
   *  ghost preview following the cursor; clicking a page embeds
   *  the stamp at the click point. */
  armedStamp?: {
    stampId: import("../../shared/types").StampId;
    pngBytes: Uint8Array;
    pngWidth: number;
    pngHeight: number;
  } | null;
  /** B10 / DEF-101 — successfully placed stamps for this tab
   *  (recorded by the host on `addStamp` success). Rendered as
   *  `.stamp-annotation` DOM surfaces per page. */
  stampAnnotations?: import("../annotations/StampAnnotations").PlacedStamp[];
  /** Bug 6 — placed stamps are editable/movable/deletable like
   *  every annotation: the bar's Confirm / Delete / Edit route
   *  through these to the host, which re-bakes the page via the
   *  engine's editImage lever. */
  onMoveStamp?: (
    id: string,
    rect: { x: number; y: number; width: number; height: number },
  ) => void;
  onDeleteStamp?: (id: string) => void;
  onRetypeStamp?: (id: string, stampId: import("../../shared/types").StampId) => void;
  onPlaceStamp?: (args: {
    stampId: import("../../shared/types").StampId;
    pngBytes: Uint8Array;
    pngWidth: number;
    pngHeight: number;
    page: number;
    atPt: { x: number; y: number };
  }) => Promise<void> | void;
  /** Place a saved signature on a specific page at the given rect. The
   *  page number is threaded through so the host doesn't have to track
   *  which page the click landed on; SignaturesOverlay already knows
   *  it (it filters placements by `page`) and passes it along. */
  onPlaceSignature?: (signatureId: string, page: number, rect: SignaturePlacement["rect"]) => void;
  onMoveSignature?: (placementId: string, rect: SignaturePlacement["rect"]) => void;
  onDeleteSignature?: (placementId: string) => void;
  /** B1 — exit Sign mode. The host wires this to the same setter
   *  that the toolbar's Sign toggle uses; the pending action bar's
   *  Cancel button calls it through this callback so the overlay
   *  doesn't need a direct reference to App-level state. */
  onCancelSignatureArm?: () => void;
  /** Phase 13 — disarm the armed stamp ghost. Pan mode and the stamp
   *  ghost both own page-pointer input; when Hand is armed while a
   *  stamp is pending, the host drops the pending stamp so the pan
   *  drag is the only gesture that handles the press. */
  onDisarmStamp?: () => void;
  /** Phase 6 — Tools palette. App owns the open/closed state. The
   *  toolbar no longer carries the toggle: when `onToolsPaletteToggle`
   *  is wired, this view renders the floating badge on the page view's
   *  right edge (.tools-badge-tracker / data-tools-badge) that flips
   *  it. The palette is conditionally mounted, so the badge is a
   *  separate element that tracks the panel's slide via CSS (see the
   *  badge block in styles.css). */
  toolsPaletteOpen?: boolean;
  onToolsPaletteToggle?: () => void;
  /** Phase 6 — annotation color palette. The toolbar shows a
   *  single swatch that opens a popover picker; the host owns the
   *  saved presets (typically App.settings.annotationColors). The
   *  shape matches the shared `AppSettings.annotationColors` field:
   *  each bucket is an array of `{ id, hex }` preset objects. */
  annotationPalette?: { light?: Array<{ id: string; hex: string }>; dark?: Array<{ id: string; hex: string }> } | null;
  onAnnotationPaletteChange?: (next: { light?: Array<{ id: string; hex: string }>; dark?: Array<{ id: string; hex: string }> }) => void;
  /** Phase 19 — persisted MRU annotation tool order (most-recent-first,
   *  sanitised by the backend to known ids, deduped, capped at 6). App
   *  owns the value; DocumentView threads it to the annotation group so
   *  the visible five can be computed. */
  annotationRecentTools?: string[];
  /** Phase 19 — the host persists a new MRU order after the user arms a
   *  tool. Threaded through to the annotation group; App owns the write. */
  onAnnotationRecentToolsChange?: (ids: string[]) => void;
  /** Active theme ('light' | 'dark' | 'frosted'). Drives which
   *  per-theme preset bucket the picker shows. */
  themeName?: AppTheme;
  // -- Phase 10: Edit-content overlay --
  /** Edit mode is open. When true, the per-page EditOverlay
   *  becomes pointer-active and the EditToolbar renders above
   *  the document area. The overlay is layered on top of the
   *  existing annotation overlay (text selection / signing /
   *  forms), so a single mode is active at a time. */
  editModeOpen?: boolean;
  onEditModeToggle?: () => void;
  /** Phase 16 — the side-rail pages panel is collapsed to the ruler
   *  strip. The host (App) owns the persisted value; DocumentView
   *  only threads it to the SideRail. */
  pagesPanelCollapsed?: boolean;
  /** Phase 16 — asks the host to toggle the pages-panel collapsed
   *  state. Threaded to the SideRail, whose expand/collapse button
   *  calls it; the rail never owns the value itself. */
  onTogglePagesPanelCollapsed?: () => void;
  /** Phase 32 — the rail master switch. `false` suppresses the rail
   *  entirely and collapses the workspace grid to the page column
   *  (`data-rail="none"`), leaving no empty gutter. Defaults to `true`.
   *  Phase 33 — Multi Mode no longer suppresses it: each pane renders its
   *  own strip (see `multiRail`) instead of the full SideRail. */
  showRail?: boolean;
  /** Phase 33 — which side of the page area this view's rail occupies.
   *  Single mode keeps the default `'left'` (unchanged). Multi Mode renders
   *  pane A's strip on its RIGHT and pane B's on its LEFT, so the two
   *  strips meet side by side in the MIDDLE of the workspace:
   *  `[A pages | A thumbs || B thumbs | B pages]`. */
  railSide?: "left" | "right";
  /** Phase 33 — Multi Mode's per-pane thumbnail strip. When present the
   *  rail slot renders this pane's OWN strip (document header + the
   *  existing ThumbnailRail) at `railSide`, instead of the full SideRail.
   *  `null` (the single-mode default) renders the unchanged SideRail. */
  multiRail?: {
    /** Which pane this view fills (drives the strip's badge). */
    pane: "A" | "B";
    /** This view's document (the tab id) — the strip's drag identity. */
    tabId: string;
    /** The document name shown in the strip header. */
    title: string;
    /** How many documents are loaded across both strips (1 or 2). */
    documentCount: number;
    /** Focus this view's pane (the strip header's click target). */
    onFocusPane: () => void;
    /** Apply a resolved page drop (the cross-document drag seam). */
    onDrop: (op: PageDropOp) => void;
  } | null;
  /** Phase 32 — Multi Mode state for the CommandBar control. The host
   *  (App) owns the mode; this view only threads it to the toolbar. */
  multiModeEnabled?: boolean;
  onMultiModeToggle?: () => void;
  /** Phase 32 (chunk 2b) — an external page jump: a page drop reveals the
   *  landing page in the target pane. `seq` makes each request unique, so
   *  clicking the same thumbnail twice both land and a re-render never
   *  replays a stale request. `null` (the single-mode default) means this
   *  view is never driven from outside. */
  jumpRequest?: { page: number; seq: number } | null;
  /** Phase 33 (chunk 4) — Multi Mode's SHARED toolbar wiring. When supplied,
   *  this view suppresses its OWN toolbar rows (the shared bar in the stage
   *  renders the one toolbar) and instead:
   *    - publishes its toolbar model (page / zoom / search / hand values +
   *      commands) to the controller so the shared bar can drive it;
   *    - routes its annotation-tool reducer through the controller's
   *      fan-out, so arming / disarming from the bar or in either pane keeps
   *      BOTH panes coherent.
   *  `null` (the single-mode default) is the pre-Phase-33 behaviour exactly. */
  sharedTools?: {
    pane: PaneId;
    controller: SharedToolController;
  } | null;
  /** Phase 32 (chunk 2d) — canvas page drag and drop. Present only in Multi
   *  Mode: each page grows a hover-revealed grip (`data-page-drag-handle`)
   *  that starts a document-aware drag, and every page slot accepts a drop
   *  from the other document with an insertion indicator. Absent (the
   *  single-mode default) means this view renders exactly as before - no
   *  grip, no drop handlers. */
  pageDrag?: {
    /** This view's document (the tab id). */
    tabId: string;
    /** Apply a resolved drop; App owns the engine + refresh sequence. */
    onDrop: (op: PageDropOp) => void;
  } | null;
  /** Per-tab Edit state. DocumentView only forwards it to
   *  PageView; App owns the reducer. */
  edit?: {
    state: import("../edit/model").EditState;
    onAction: (action: import("../edit/model").EditAction) => void;
    defaultFont: import("../../shared/types").EditFont;
    onDefaultFontChange?: (font: import("../../shared/types").EditFont) => void;
    pickImage: () => Promise<{ bytes: Uint8Array; format: "png" | "jpeg" } | null>;
    onCommitTextEdit: (args: {
      rect: { x: number; y: number; width: number; height: number };
      newText: string;
      style: import("../edit/model").EditTextStyle;
      oldRect?: { x: number; y: number; width: number; height: number };
      /** DEF-232 — the page the committing overlay owns. */
      page: number;
    }) => void;
    onCommitTextBox: (args: {
      /** Phase 26 - the id the renderer already minted for a freshly
       *  dragged box (so the engine registers under the same id). */
      id?: string;
      rect: { x: number; y: number; width: number; height: number };
      text: string;
      style: import("../edit/model").EditTextStyle;
      background: "white" | "none";
      /** DEF-232 sibling — the page the committing overlay owns. */
      page: number;
    }) => void;
    onCommitImageEdit: (args: {
      op: "move" | "resize" | "replace" | "crop";
      oldRect: { x: number; y: number; width: number; height: number };
      newRect: { x: number; y: number; width: number; height: number };
      bytes: Uint8Array;
      format: "png" | "jpeg";
      id: string;
      /** DEF-232 sibling — the page the committing overlay owns. */
      page: number;
    }) => void;
    /** DEF-127 — commit a committed text box's drag (move/resize):
     *  the host re-bakes the box at `newRect` through the engine's
     *  existing editImage contract. */
    onCommitTextBoxMove: (args: {
      oldRect: { x: number; y: number; width: number; height: number };
      newRect: { x: number; y: number; width: number; height: number };
      text: string;
      style: import("../edit/model").EditTextStyle;
      background: "white" | "none";
      id: string;
      /** DEF-232 sibling — the page the committing overlay owns. */
      page: number;
    }) => void;
    /** DEF-135/136 — delete a committed text box through the engine's
     *  registry (engine.deleteTextBox). Wire → DocumentView → PageView
     *  → EditOverlay's box placement toolbar. */
    onDeleteTextBox?: (id: string) => void;
    /** Phase 21 — apply a style patch to the SELECTED committed box
     *  (App routes it to `engine.updateTextBox`). Absent when the host
     *  cannot target a registry box. */
    onTextStylePatch?: (patch: TextBoxStylePatch) => void;
    /** Phase 26 — apply a patch (the panel Text field's session commit)
     *  to a SPECIFIC committed box, by id. App routes it to
     *  `engine.updateTextBox`; absent when the host cannot target the
     *  registry. */
    onTextPatch?: (id: string, patch: TextBoxStylePatch) => void;
  } | null;
}

// Stable empty-array reference: passed to PageView when a page has no search
// hits, so the prop's reference doesn't change between renders (which would
// retrigger PageView's measurement effect and cause a setState loop).
const EMPTY_HITS: SearchHit[] = [];

// How many pages to render in the initial synchronous mount on open, so the
// very first paint already shows real bitmaps without waiting for
// IntersectionObserver callbacks. The IO is unreliable in some real-world
// configurations (headless harnesses, certain driver/page-zoom combos); the
// geometry-based mount is the source of truth and the IO is just a progressive
// refinement that can extend the mounted range outward from the viewport.
//
// 3 pages: at fit-width only ~1 page fits the viewport, so 3 covers the
// visible page plus ~1 above for scroll smoothness and keeps the
// always-mounted count for the annotations panel and search overlays
// stable. Each mounted page pins ~3.5MB of GPU/CPU canvas memory at
// cssScale ~1.5x, alpha:false; dropping from 4 -> 3 frees ~3.5MB of
// idle GPU memory on the open canvas (DEF-016 exit target).
const INITIAL_MOUNT_PAGES = 3;

// Phase 29 — the canvas is flush. `.document-content` carries no
// top/bottom padding in ANY theme, so the scroll math's top pad is the
// (now zero) CONTENT_PADDING_PX everywhere; the frosted theme no longer
// adds a chrome-stack offset.

/** DEF-232 — compare two reported page-1 sizes by VALUE. A doc-proxy
 *  swap re-publishes an equal-but-new `{ w, h }` object; treating that
 *  as a geometry transition made the DEF-098 mount-sync effect yank
 *  the scroller back to the current-page readout on every refresh. */
function samePageSize(
  a: { w: number; h: number } | null,
  b: { w: number; h: number } | null,
): boolean {
  if (a === null || b === null) return a === b;
  return a.w === b.w && a.h === b.h;
}

// How many pages of buffer to keep mounted on each side of the viewport, on
// top of the IO rootMargin. The buffer covers the case where the user scrolls
// fast enough that IO callbacks have not yet caught up with the geometry.
//
// 1 page: same per-page bitmap cost as above. The geometry mount
// re-renders a page bitmap on demand when it scrolls into range, so a
// 1-page buffer trades a brief blank-slot flash on extreme fast
// scrolls for ~10 MB less idle GPU memory (was 2, dropped to 1 for
// DEF-016).
const PAGE_BUFFER_PAGES = 1;

// How long the document must be idle (no scroll, no IO change, no
// mounted-set change, no annotation op, no search op) before we ask
// pdf.js to flush its per-document worker-side caches via
// `doc.cleanup()`. The cleanup drops the font cache, the global image
// cache, and the page-tree / page-index lookup tables — the dominant
// idle-time memory contributors for long PDFs (DEF-016). 3 seconds is
// long enough that scroll-jitter and the qa 10-second idle window
// both see the cleaned state, short enough that the renderer settles
// quickly after the user stops interacting.
const DOC_IDLE_CLEANUP_MS = 3000;

// How many pages around the viewport we keep mounted. IntersectionObserver
// does the actual gating; this margin only sizes the buffer so fast scrolls
// don't reveal blank slots. The IO rootMargin is hard-coded in the IO
// useEffect below (800px top/bottom) — tight enough to keep the IO's
// effective intersection window within ~1 page above and below the
// viewport at fit-width, so the observer's internal entry table stays
// bounded instead of tracking hundreds of slot elements on long.pdf.

// How many pages to index before yielding back to the event loop. Keeps the
// UI thread responsive while building the search index on a 500+ page doc.
const SEARCH_CHUNK_PAGES = 8;

export interface DocumentViewHandle {
  /** Reset any active annotation tool to 'select' (no tool active). */
  disarmAnnotationTool(): void;
}

/**
 * DEF-254 — the annotation-selection conduit's page guard.
 *
 * Every mounted page's `AnnotationOverlay` reports its own selection upward:
 * `(null, ownPage)` while nothing on that page is selected, `(ann, ownPage)`
 * when the user selects one. The host keeps a SINGLE selection, so without
 * this guard a page that MOUNTS later (virtualization mounting page 5 while
 * page 4's overlay is selected, or a neighbour remounting during the panel's
 * reflow) reported `null` and clobbered the live selection — the text
 * properties panel opened and then closed on its own.
 *
 * Rule: a non-null report from ANY page is authoritative (it sets the
 * selection). A null report only clears when it comes from the page that
 * currently HOLDS the selection — a neighbouring page saying "nothing is
 * selected over here" is not a deselect gesture.
 */
export function applyAnnSelectionReport(
  prev: Annotation | null,
  report: Annotation | null,
  fromPage: number,
): Annotation | null {
  if (report !== null) return report;
  if (prev !== null && prev.page === fromPage) return null;
  return prev;
}

/**
 * The full document workspace: side rail (thumbnails / outline), toolbar,
 * search bar, and the virtualized continuous scroller. All per-document
 * view state (zoom, page, search) lives here and is persisted upwards.
 */
export const DocumentView = forwardRef<DocumentViewHandle, DocumentViewProps>(function DocumentView({
  doc,
  pageCount,
  outline,
  initial,
  onPersist,
  onDiagnostics,
  onSearchIndexProgress,
  registerSearchIndexInvalidator,
  onToast,
  engineState,
  proxyVisibleOrder = false,
  canUndo,
  onRotate,
  onDelete,
  onReorder,
  onUndo,
  onMerge,
  onSplit,
  onOptimize,
  onAuditSpace,
  onRotateClockwise,
  onRotateCounterClockwise,
  onDeletePage,
  canDeletePage = true,
  annotations = [],
  onCreateAnnotation,
  onEditAnnotation,
  onDeleteAnnotation,
  onAddComment,
  /** DEF-166 — annotation ids whose overlay text must be drawn LIVE
   *  (created / edited since the current page-canvas bytes were
   *  loaded). Threaded to every PageView's AnnotationOverlay so a
   *  parsed-from-file textbox/callout (whose baked FreeText
   *  appearance pdf.js already paints into the page canvas) does not
   *  draw a duplicated overlay text on reopen. */
  liveAnnTextIds,
  formFields = [],
  onFormValueChange,
  onFormListboxToggle,
  signatures = [],
  savedSignatures = [],
  armedSignatureId = null,
  armedStamp = null,
  onPlaceStamp,
  stampAnnotations = [],
  onMoveStamp,
  onDeleteStamp,
  onRetypeStamp,
  onPlaceSignature,
  onMoveSignature,
  onDeleteSignature,
  onCancelSignatureArm,
  onDisarmStamp,
  toolsPaletteOpen = false,
  onToolsPaletteToggle,
  annotationPalette,
  onAnnotationPaletteChange,
  annotationRecentTools,
  onAnnotationRecentToolsChange,
  themeName = 'frosted',
  editModeOpen = false,
  edit = null,
  onEditModeToggle,
  pagesPanelCollapsed,
  onTogglePagesPanelCollapsed,
  showRail = true,
  railSide = "left",
  multiRail = null,
  multiModeEnabled,
  onMultiModeToggle,
  jumpRequest = null,
  pageDrag = null,
  sharedTools = null,
}: DocumentViewProps,
  ref,
) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // Phase-C frosted layering — the full-bleed scroller needs the
  // measured chrome stack height so .document-content pads down by
  // exactly the toolbar rows that float above it (see the
  // measurement effect below).
  const mainRef = useRef<HTMLDivElement | null>(null);
  const slotRefsRef = useRef(new Map<number, HTMLDivElement>());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const wheelRemainderRef = useRef(0);
  const scrollRafRef = useRef(0);
  // pdf.js per-page render tasks are owned by PageView, but the
  // DocumentView-level idle-cleanup coordinator needs a single
  // document-wide "is anything in flight" probe. PageView calls the
  // stable onRenderStart / onRenderEnd callbacks below; we keep a
  // counter here so the coordinator can see all in-flight renders in
  // one place.
  const inFlightRendersRef = useRef(0);
  // Stable callbacks for PageView to report render lifecycle. useCallback
  // with empty deps so the render effect's dep array doesn't churn and
  // re-fire the entire getPage → render → TextLayer pipeline on every
  // DocumentView re-render.
  const onPageRenderStart = useCallback((): void => {
    inFlightRendersRef.current += 1;
  }, []);
  const onPageRenderEnd = useCallback((): void => {
    // Never go negative — a cancelled effect that ended without firing
    // its beginRender() (e.g. shouldRender flipped false before any
    // page was actually rendered) should not underflow the counter.
    inFlightRendersRef.current = Math.max(0, inFlightRendersRef.current - 1);
  }, []);
  // Idle-cleanup coordinator. Rebuilt per `doc` identity (so a tab
  // change cancels any pending cleanup against the obsolete document
  // and installs a fresh one for the new one).
  const idleCleanupRef = useRef<IdleCleanupCoordinator | null>(null);

  const [firstPageSize, setFirstPageSize] = useState<{ w: number; h: number } | null>(null);

  // Phase 3 — annotation tool state. Declared ahead of the Phase-21
  // text-properties panel block below, which reads the armed annotation
  // text tool (`textbox` / `callout` / `note`) to decide whether the
  // panel opens in annotation mode and which colour it reflects.
  const [annTool, rawDispatchAnnTool] = useReducer(
    annotationToolReducer,
    initialAnnotationToolState,
  );

  // Phase 33 (chunk 4) — when the SHARED Multi Mode toolbar is wired, an
  // annotation action from this pane is fanned out to every pane's reducer
  // through the controller, so both panes arm / disarm together. `self` is
  // passed so this pane's own reducer runs exactly once. Single mode keeps
  // the raw per-view reducer untouched.
  const dispatchAnnTool = useCallback(
    (action: AnnotationToolAction): void => {
      const shared = sharedTools;
      if (shared === null) {
        rawDispatchAnnTool(action);
        return;
      }
      shared.controller.annToolAction(action, rawDispatchAnnTool);
    },
    [sharedTools, rawDispatchAnnTool],
  );

  // Phase 21 — text-properties panel state. The panel is selection-aware:
  // a selected committed box shows its ACTUAL values, otherwise the
  // per-tool defaults (with any not-yet-committed tweaks kept locally).
  const [pendingTextStyle, setPendingTextStyle] = useState<TextStyleValues | null>(null);
  const textPanelDefaults = useMemo(
    () => defaultTextStyleValues(edit?.defaultFont ?? "Helvetica"),
    [edit?.defaultFont],
  );
  const selectedTextBox = useMemo(() => {
    if (edit === null || edit.state.selectedTextBox === null) return null;
    return edit.state.textBoxes.find((b) => b.id === edit.state.selectedTextBox) ?? null;
  }, [edit?.state.selectedTextBox, edit?.state.textBoxes]);
  // Phase 21 (annotations) — the committed annotation the page overlay
  // reports as selected, if any. The overlay owns per-page selection; it
  // reports upward so the panel can reflect a selected annotation text
  // object's ACTUAL colour without a second selection model. The reported
  // OBJECT is kept (not just its id): a just-placed annotation is not in
  // the engine's `annotations` list yet (the create round-trips over IPC),
  // and looking the id up in that list alone made `selectedAnnText` flip
  // false for a frame — the panel closed, reflowed 248px, and the user's
  // follow-up click on the placed annotation landed on a moving origin.
  const [selectedAnn, setSelectedAnn] = useState<Annotation | null>(null);
  // DEF-254 — the report carries the reporting page's number. `page` is the
  // VISIBLE page index, the same space `Annotation.page` uses, so the guard
  // can compare them. See `applyAnnSelectionReport`.
  const onSelectAnnotation = useCallback((ann: Annotation | null, fromPage: number): void => {
    setSelectedAnn((prev) => applyAnnSelectionReport(prev, ann, fromPage));
  }, []);

  // ---- Phase 26: the panel Text field ---------------------------------
  // The panel's Text field is the single text-editing surface for
  // annotation text and Edit-mode text. A session starts on the first
  // keystroke and is committed as ONE engine op when it ends (field blur
  // / Escape / target change), so one edit session is exactly one undo
  // entry. Mid-typing the page is painted from the renderer-local draft
  // (`renderedAnnotations`) or the box registry — never an op per
  // keystroke.
  const [textEdit, setTextEdit] = useState<{
    target: TextTarget;
    text: string;
    original: string;
    /** A just-placed annotation: an empty session drops it again. */
    justPlaced: boolean;
  } | null>(null);
  const textEditRef = useRef<typeof textEdit>(null);
  textEditRef.current = textEdit;
  const [textFocusToken, setTextFocusToken] = useState(0);
  const [textCommitToken, setTextCommitToken] = useState(0);
  /** Phase 26 — the Edit overlay's selected text target (box or run). */
  const [editTextTarget, setEditTextTarget] = useState<EditTextTarget | null>(null);
  /** The id of a text annotation placed this gesture with empty text. */
  const justPlacedTextRef = useRef<string | null>(null);
  /** Phase 26 — paint the session's live text over the engine list so
   *  the page follows every keystroke (the annotation overlay renders
   *  exactly what the host hands it). */
  const renderedAnnotations = useMemo((): Annotation[] => {
    if (textEdit === null || textEdit.target.kind !== "annotation") return annotations;
    const id = textEdit.target.id;
    const next = textEdit.text;
    return annotations.map((a) => (a.id === id ? { ...a, text: next } : a));
  }, [annotations, textEdit]);
  const selectedAnnotation = useMemo(
    () =>
      selectedAnn === null
        ? null
        : (renderedAnnotations.find((a) => a.id === selectedAnn.id) ?? selectedAnn),
    [selectedAnn, renderedAnnotations],
  );
  const selectedAnnText =
    selectedAnnotation !== null &&
    (selectedAnnotation.kind === "textbox" ||
      selectedAnnotation.kind === "note" ||
      selectedAnnotation.kind === "callout");
  /** The text target the panel currently edits. An annotation selection
   *  wins (Edit mode and the annotation tools are mutually exclusive). */
  const textTarget = useMemo<TextTarget | null>(() => {
    if (selectedAnnText && selectedAnnotation !== null) {
      return { kind: "annotation", id: selectedAnnotation.id };
    }
    return editTextTarget;
  }, [selectedAnnText, selectedAnnotation, editTextTarget]);
  const textTargetKeyNow = textTargetKey(textTarget);
  /** The target's committed text (the session draft overrides it while
   *  one is open). */
  const textTargetBase =
    textTarget === null
      ? ""
      : textTarget.kind === "annotation"
        ? selectedAnnotation !== null && "text" in selectedAnnotation
          ? selectedAnnotation.text
          : ""
        : textTarget.kind === "box"
          ? (selectedTextBox?.text ?? "")
          : textTarget.text;
  const textEditKey = textEdit === null ? null : textTargetKey(textEdit.target);
  const panelText =
    textTarget === null
      ? null
      : textEdit !== null && textEditKey === textTargetKeyNow
        ? textEdit.text
        : textTargetBase;
  // Phase 26 — the Edit overlay reported its selected text target (a
  // committed box or a text run). The report arrives through the editProp
  // memo below; it focuses the panel field so clicking a text element in
  // Edit mode starts typing immediately.
  const onEditTextTargetChange = useCallback((target: EditTextTarget | null): void => {
    setEditTextTarget(target);
    if (target !== null) setTextFocusToken((n) => n + 1);
  }, []);
  /** Phase 26 — the annotation overlay placed or clicked a text element:
   *  focus the panel's Text field with its content selected. */
  const onAnnTextFocusRequest = useCallback((): void => {
    setTextFocusToken((n) => n + 1);
  }, []);
  // The previous text target (and its key) the target-change effect below
  // compares against. Declared here so `commitTextSession` can clear a
  // committed box's `isNew` flag on the ref the cleanup reads (DEF-257).
  const prevTextTargetKeyRef = useRef<string | null>(null);
  const prevTextTargetRef = useRef<TextTarget | null>(null);
  // DEF-262 — mirrors so the stable commit / style callbacks read the latest
  // annotation list and per-page sizes without becoming unstable.
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;
  const pageSizesRef = useRef<Map<number, { w: number; h: number }>>(new Map());
  /** DEF-262 — the rect a textbox / callout must be persisted at to hold its
   *  current text + (optionally merged) style legibly. Null when the stored
   *  rect already fits. This is the SAME growth rule the live overlay renders,
   *  so the persisted rect and the on-screen height agree. */
  const annGrownRect = useCallback(
    (
      ann: Annotation,
      text: string,
      style: import("../../shared/types").AnnTextStyle | undefined,
    ): import("../annotations/model").PageRect | null => {
      if (ann.kind !== "textbox" && ann.kind !== "callout") return null;
      const rect = ann.rect;
      if (rect === undefined) return null;
      const font = style?.font ?? ann.style?.font ?? "Helvetica";
      const measure = (t: string, s: number): number =>
        measureTextWidthCss(t, ANN_TEXT_FONT_CSS[font], s);
      const pageHeightPt = pageSizesRef.current.get(ann.page)?.h ?? 792;
      return grownAnnTextRect({
        kind: ann.kind,
        rect,
        text,
        style,
        maxHeightPt: annTextMaxHeightPt(pageHeightPt, rect.y),
        measure,
      });
    },
    [],
  );
  /** DEF-262 / Phase 30 — persist a text commit. When the text needs a taller
   *  box the new rect rides `editAnnotation`'s in-place `rect` patch, so the
   *  annotation keeps its id and the panel's selection survives the commit
   *  (the old delete + re-create re-created it and fired a fresh selection
   *  event asynchronously, which a zero-gap burst of style clicks could read
   *  as a stale selection). Otherwise the plain text patch is enough. */
  const persistAnnText = useCallback(
    (ann: Annotation, text: string): void => {
      const grown = annGrownRect(ann, text, ann.style);
      const rect =
        grown === null ? null : rectGeometryPatch(ann, { ...ann, rect: grown } as Annotation);
      onEditAnnotation?.(ann.id, rect === null ? { text } : { text, rect });
    },
    [annGrownRect, onEditAnnotation],
  );
  /** Phase 26 — end the edit session and commit it as ONE engine op.
   *  Phase 29 (DEF-266) — `relatedTarget` is the focus target the panel's
   *  Text field reported on blur. When it is a control INSIDE the panel the
   *  session must stay open (the user is composing styles on the still-active
   *  run), so no commit happens and the run is not deselected. */
  const commitTextSession = useCallback(
    (relatedTarget?: EventTarget | null): void => {
      if (isTextPanelFocusTarget(relatedTarget)) return;
      const session = textEditRef.current;
    textEditRef.current = null;
    setTextEdit(null);
    if (session === null) return;
    // A session means the placement was USED — it is no longer an
    // abandoned empty placement (so the stray-placement cleanup below
    // must not delete it).
    justPlacedTextRef.current = null;
    const { target } = session;
    if (target.kind === "annotation") {
      if (session.text.trim() === "") {
        // An empty text annotation carries no content — a fresh
        // placement is dropped again (the old empty-text guard).
        onDeleteAnnotation?.(target.id);
        return;
      }
      if (session.text === session.original) return;
      const ann = annotationsRef.current.find((a) => a.id === target.id);
      if (ann !== undefined) {
        persistAnnText(ann, session.text);
        return;
      }
      onEditAnnotation?.(target.id, { text: session.text });
      return;
    }
    if (target.kind === "box") {
      if (session.text === session.original) return;
      const editApi = editRef.current;
      if (editApi === null) return;
      if (target.isNew === true) {
        // A freshly dragged box lives only in the renderer registry: the
        // commit IS its first engine op (addTextBox), registered under
        // the same id so the local mirror and the engine agree.
        const box = textBoxesRef.current.find((b) => b.id === target.id);
        if (box === undefined) return;
        editApi.onCommitTextBox({
          id: box.id,
          rect: { ...box.rect },
          text: session.text,
          style: box.style,
          background: box.background,
          page: box.page,
        });
        // DEF-257 — the box is in the engine registry now, so it is no
        // longer a renderer-only placement. Clear `isNew` on the live
        // target (state + the ref the target-change cleanup reads), else
        // that cleanup treats the committed box as an abandoned empty
        // placement and drops it from the mirror when the target clears
        // (Edit mode close/reopen), leaving the engine's box with no
        // `.edit-box` surface.
        const committed: TextTarget = { ...target, isNew: false };
        prevTextTargetRef.current = committed;
        setEditTextTarget((prev) =>
          prev !== null && prev.kind === "box" && prev.id === target.id ? committed : prev,
        );
        return;
      }
      editApi.onTextPatch?.(target.id, { text: session.text });
      return;
    }
    // A text run: the Edit overlay owns the run's rect AND the white
    // mask cover, so it performs the commit when the token flips.
    setTextCommitToken((n) => n + 1);
  }, [onEditAnnotation, onDeleteAnnotation, persistAnnText]);
  /** Phase 26 — a keystroke in the panel's Text field. The page follows
   *  immediately (annotation draft / box registry); the engine is
   *  untouched until the session commits. */
  const handlePanelTextChange = useCallback(
    (next: string): void => {
      const target = textTargetRef.current;
      if (target === null) return;
      const key = textTargetKey(target);
      const current = textEditRef.current;
      const base = textBaseRef.current;
      const justPlaced =
        target.kind === "annotation" && justPlacedTextRef.current === target.id;
      if (current !== null && textTargetKey(current.target) === key) {
        textEditRef.current = { ...current, text: next };
        setTextEdit(textEditRef.current);
      } else {
        textEditRef.current = { target, text: next, original: base, justPlaced };
        setTextEdit(textEditRef.current);
      }
      if (target.kind === "box") {
        // Live registry update: the box mirror on the page repaints on
        // every keystroke (no engine op until the session commits).
        const box = textBoxesRef.current.find((b) => b.id === target.id);
        if (box !== undefined) {
          editRef.current?.onAction({
            type: "upsert-text-box",
            placement: { ...box, text: next },
          });
        }
      }
    },
    [],
  );
  // The panel's Text field value / target, mirrored into refs so the
  // stable session callbacks always read the latest values.
  const textTargetRef = useRef<TextTarget | null>(null);
  const textBaseRef = useRef<string>("");
  const textBoxesRef = useRef<readonly import("../edit/model").TextBoxPlacement[]>([]);
  const editRef = useRef(edit);
  textTargetRef.current = textTarget;
  textBaseRef.current = textTargetBase;
  textBoxesRef.current = edit?.state.textBoxes ?? [];
  editRef.current = edit;
  // Commit when the target changes (another element selected) or clears
  // (tool change / panel close) so no edit is lost and each session stays
  // one undo entry. The two refs live above `commitTextSession` so the
  // commit can clear a new box's `isNew` flag on the ref the cleanup
  // below reads (DEF-257).
  useEffect(() => {
    if (prevTextTargetKeyRef.current === textTargetKeyNow) return;
    prevTextTargetKeyRef.current = textTargetKeyNow;
    const previous = prevTextTargetRef.current;
    prevTextTargetRef.current = textTarget;
    const hadSession = textEditRef.current !== null;
    commitTextSession();
    if (hadSession) return;
    // A placement that was never typed into leaves no session behind —
    // drop the stray empty surface when the target moves away.
    const abandoned = justPlacedTextRef.current;
    if (abandoned !== null) {
      if (textTargetKeyNow !== `annotation:${abandoned}`) {
        justPlacedTextRef.current = null;
        onDeleteAnnotation?.(abandoned);
      }
      return;
    }
    // Phase 26 — a freshly dragged Edit-mode box that never received text
    // is dropped from the renderer registry (it never reached the engine).
    if (previous !== null && previous.kind === "box" && previous.isNew === true) {
      editRef.current?.onAction({ type: "delete-text-box", id: previous.id });
    }
  }, [textTargetKeyNow, textTarget, commitTextSession, onDeleteAnnotation]);
  // The annotation text tools (text box, callout, sticky note) open the
  // SAME panel instance; the annotation colour state it reflects is the
  // selected annotation's colour when one is selected, else the armed
  // tool's colour (the existing annotation colour path).
  const annTextToolArmed =
    annTool.tool === "textbox" || annTool.tool === "callout" || annTool.tool === "note";
  // Text-bearing TFlex-owned tools: the edit-text run editor ("text") and
  // the text box tool ("box"). A selected committed box keeps the panel
  // open regardless of the tool, per the "selection-aware" contract.
  const tfTextPanelOpen =
    edit !== null &&
    editModeOpen &&
    (selectedTextBox !== null || edit.state.tool === "text" || edit.state.tool === "box");
  const textPanelMode: "text" | "annotation" = tfTextPanelOpen ? "text" : "annotation";
  const textPanelOpen = tfTextPanelOpen || annTextToolArmed || selectedAnnText;
  // The full control set is live only for TFlex-owned text objects; the
  // annotation panel values are the per-tool defaults with the colour
  // swapped for the annotation's actual colour.
  const textPanelTextValues =
    selectedTextBox !== null
      ? textStyleValuesFromStyle(selectedTextBox.style)
      : pendingTextStyle ?? textPanelDefaults;
  const annotationPanelColor = hexToEditColor(
    annotationColorToCss(
      selectedAnnText && selectedAnnotation !== null ? selectedAnnotation.color : annTool.color,
    ),
  );
  const textPanelValues: TextStyleValues =
    textPanelMode === "text"
      ? textPanelTextValues
      : {
          // Phase 24 — the annotation panel reflects the SELECTED
          // annotation's STORED style (font/size/bold/italic/underline/
          // highlight/align/lineHeight/baselineShift/list/indent), falling
          // back to the per-tool defaults for any field the annotation has
          // never set (absent fields never overwrite the default). The
          // colour is always the annotation's ACTUAL colour, or the armed
          // tool's colour while nothing is selected yet.
          ...textPanelDefaults,
          ...selectedAnnotation?.style,
          color: annotationPanelColor,
        };
  const handleTextPanelPatch = useCallback(
    (patch: TextBoxStylePatch): void => {
      if (textPanelMode === "annotation") {
        // Phase 24 — a selected annotation text object now takes the FULL
        // patch. Every non-colour field rides `editAnnotation`'s `style`
        // payload (the engine validates + merges it and re-bakes the /AP
        // stream); colour keeps its own path. A colour-only patch never
        // reaches the style route, and a style-only patch never re-sends
        // colour — a mixed patch (clear formatting) goes out as ONE call
        // so it is a single undo step.
        const { color: patchColor, ...rest } = patch;
        const style = annotationStyleFromPanelPatch(rest);
        const hasStyle = Object.keys(style).length > 0;
        const hasColor = patchColor !== undefined;
        if (selectedAnnText && selectedAnnotation !== null) {
          if (!hasStyle && !hasColor) return;
          // DEF-262 / Phase 30 — a style control that needs a TALLER box (a
          // bigger size, a list prefix, more indent, a longer line-height)
          // must persist the grown rect too, else save + reopen shrinks the
          // text back into the old one-line box. The grown rect and the new
          // style ride ONE `editAnnotation` op (the engine applies the rect
          // IN PLACE and merges the style), so the panel change is one undo
          // step, the annotation keeps its id, and the selection the next
          // control in a burst reads cannot go stale.
          let grownRect: import("../../shared/types").AnnRect | null = null;
          if (hasStyle) {
            const mergedStyle = { ...selectedAnnotation.style, ...style };
            const grown = annGrownRect(selectedAnnotation, selectedAnnotation.text, mergedStyle);
            grownRect =
              grown === null
                ? null
                : rectGeometryPatch(selectedAnnotation, {
                    ...selectedAnnotation,
                    rect: grown,
                  } as Annotation);
          }
          onEditAnnotation?.(selectedAnnotation.id, {
            ...(grownRect === null ? {} : { rect: grownRect }),
            ...(hasStyle ? { style } : {}),
            ...(hasColor ? { color: editColorToHex(patchColor) } : {}),
          });
          return;
        }
        // Nothing selected yet: only the armed tool's colour is real
        // state. A style gesture before placement would have no target.
        if (hasColor) {
          dispatchAnnTool({ type: "set-color", color: editColorToHex(patchColor) });
        }
        return;
      }
      if (selectedTextBox !== null) {
        edit?.onTextStylePatch?.(patch);
        return;
      }
      setPendingTextStyle((prev) => applyPatchToValues(prev ?? textPanelDefaults, patch));
    },
    [
      textPanelMode,
      selectedAnnText,
      selectedAnnotation,
      onEditAnnotation,
      annGrownRect,
      selectedTextBox,
      edit?.onTextStylePatch,
      textPanelDefaults,
    ],
  );
  // The page-1 dimensions the fit modes (fit-width / fit-page) anchor
  // their scale to. Deliberately decoupled from the LIVE `firstPageSize`
  // layout reference above: the live size must track the current bytes
  // (slots, rail ratios, wrapper dims), while the fit anchor must NOT
  // move when a proxy refresh merely shrinks page 1 in place. Before
  // this split, a crop committed through `refreshDocProxyFor` re-fetched
  // page 1's (smaller) dims, the fit recomputed from them, and every
  // OTHER uncropped page re-rendered at a bigger absolute scale — the
  // "zoom jump after crop" defect (crop undo showed the reverse jump).
  // The anchor only moves on:
  //   - first resolution (open),
  //   - an explicit user fit action (fit-width / fit-page button),
  //   - a doc refresh whose page-1 size is NOT an inset of the anchor
  //     (a genuine page identity change — delete / reorder / insert —
  //     which legitimately re-fits to the new first page).
  const [fitAnchor, setFitAnchor] = useState<{ w: number; h: number } | null>(null);
  // `mountedPages` are the only pages that get a real PageView (canvas +
  // TextLayer + search-hit overlays). Every other page is just a fixed-height
  // slot that reserves scroll space. This is what keeps a 520-page doc from
  // freezing the renderer on open.
  const [mountedPages, setMountedPages] = useState<Set<number>>(new Set());
  const [viewportBox, setViewportBox] = useState({ w: 0, h: 0 });
  const [currentPage, setCurrentPage] = useState(initial.currentPage);
  // DEF-141 — per-page sizes (un-rotated pt dims) reported by each
  // mounted PageView's `onPageSize`. The scroller renders every slot
  // at ITS OWN page's size so a per-page crop of page 1 no longer
  // collapses pages 2..N into the crop box. The map survives a doc
  // proxy refresh (same DocumentView instance — App keys the tab-pane
  // by tab id), so the OTHER pages keep their pre-refresh sizes the
  // moment `refreshDocProxyFor` swaps in the re-serialized bytes; each
  // slot re-reports its size when it re-renders, correcting any page
  // whose size actually changed (the cropped page itself).
  const [pageSizes, setPageSizes] = useState<Map<number, { w: number; h: number }>>(new Map());
  // DEF-262 — the commit path reads the latest page sizes through this ref
  // (declared above `commitTextSession`, which must stay stable).
  pageSizesRef.current = pageSizes;

  const [zoom, dispatchZoom] = useReducer(zoomReducer, {
    mode: initial.zoomMode,
    manualScale: initial.manualScale,
  } as ZoomState);

  // Phase 3 — per-annotation flash highlight. The annotation tool state
  // itself is declared above (the Phase-21 panel block reads it).
  // DEF-211 — imperative handle so the host can disarm the annotation
  // tool before opening a dialog overlaying the workspace.
  useImperativeHandle(ref, () => ({
    disarmAnnotationTool: (): void => {
      dispatchAnnTool({ type: "set-tool", tool: "select" });
    },
  }), []);
  const [flashId, setFlashId] = useState<string | null>(null);
  const flashTimerRef = useRef<number | null>(null);

  const [searchOpen, setSearchOpen] = useState(initial.searchOpen);
  const [query, setQuery] = useState(initial.query);
  const [activeHitIndex, setActiveHitIndex] = useState(initial.activeHitIndex);
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchIndexProgress, setSearchIndexProgress] = useState<SearchIndexProgress | null>(null);
  const searchTokenRef = useRef(0);
  const indexesRef = useRef(new Map<number, PageTextIndex>());

  // Phase 13 — Hand (pan) mode. Transient viewer state (never persisted):
  // when armed, the scroller handles pointer drags as grab-and-drag
  // scrolling, annotation tools are inert (see AnnotationToolbar's
  // `handModeOpen` gate), and every other pointer-active overlay is
  // disarmed on the rising edge below.
  const [handActive, setHandActive] = useState(false);
  const panDragRef = useRef<PanDragStart | null>(null);
  const toggleHand = useCallback((): void => {
    setHandActive((v) => !v);
  }, []);
  // DEF-050 — invalidation bump. The host (App) calls the imperative
  // search-index invalidator after OCR completes; this tick state is
  // bumped so the search effect re-runs even though `query`, `doc`,
  // and `pageCount` are unchanged. `indexesRef` is reset at the same
  // moment so the rebuild path calls `pdf.js`'s `getTextContent()`
  // fresh on every page — which is where OCR-injected text becomes
  // visible to the indexer.
  const [searchInvalidationTick, setSearchInvalidationTick] = useState(0);

  // Keep the latest `onSearchIndexProgress` in a ref so the search effect can
  // call it without making the callback itself a dependency (which would
  // re-fire the effect on every parent re-render that produced a fresh
  // callback identity).
  const onSearchIndexProgressRef = useRef(onSearchIndexProgress);
  onSearchIndexProgressRef.current = onSearchIndexProgress;

  // DEF-050 — wire the host's imperative search-index invalidator. The
  // registered callback (a) clears `indexesRef` so the next search
  // walks every page and re-fetches `getTextContent()`, and (b) bumps
  // `searchInvalidationTick` to trigger the search effect's re-run
  // even when `query` / `doc` / `pageCount` are unchanged. The
  // invalidator is a no-op while the search bar isn't open — there
  // is no in-flight search to invalidate.
  //
  // Note: we do not include `registerSearchIndexInvalidator` in the
  // effect's dep array because the host passes a fresh function on
  // every render (the App.tsx factory allocates one per tab, but it
  // may re-render before pinning). The ref pattern below keeps the
  // latest value and registers exactly once.
  const registerSearchIndexInvalidatorRef = useRef(registerSearchIndexInvalidator);
  registerSearchIndexInvalidatorRef.current = registerSearchIndexInvalidator;
  const hasRegisteredInvalidatorRef = useRef(false);
  useEffect(() => {
    if (hasRegisteredInvalidatorRef.current) {
      return;
    }
    const register = registerSearchIndexInvalidatorRef.current;
    if (register === undefined) {
      return;
    }
    const invalidate = (): void => {
      // Drop every cached page index so the next search re-fetches
      // getTextContent() from pdf.js. Clearing the map alone is not
      // enough — the search effect's deps (`query`, `doc`,
      // `pageCount`) are unchanged after OCR, so React would not
      // re-run the effect. Bumping `searchInvalidationTick` is the
      // explicit "kick" that forces a rebuild.
      indexesRef.current = new Map();
      setSearchInvalidationTick((prev) => prev + 1);
    };
    register(invalidate);
    hasRegisteredInvalidatorRef.current = true;
  }, []);

  // ---- Phase C — frosted chrome-over-document measurement ----------------
  //
  // The frosted theme floats the workspace chrome rows (toolbar /
  // annotation toolbar / search bar / edit toolbar) OVER a full-bleed
  // .document-scroller, so the page visibly scrolls under the
  // translucent frosted sheets. The stack height is not static: the
  // command toolbar wraps when the window is narrow, the search bar
  // adds a row while open, the edit toolbar adds a row in edit mode.
  // This effect measures the rows' real heights and publishes the sum
  // as `--tf-chrome-y` on .workspace-main for the floating text panel
  // (`top: calc(var(--tf-chrome-y) + 8px)`).
  //
  // Phase 29 — the page view is FLUSH: `.document-content` has no
  // top/bottom padding in any theme, so `contentTopPadRef` is the zero
  // CONTENT_PADDING_PX everywhere and the scroll geometry helpers track
  // the flush DOM exactly. `--tf-chrome-y` no longer feeds any content
  // padding; it survives only for the floating panel placement.
  //
  // `contentTopPadRef` stays the single source of the top pad the CSS
  // paints; every scroll-geometry helper reads this ref so a future
  // padding change can never drift from the math.
  const contentTopPadRef = useRef(CONTENT_PADDING_PX);
  useEffect(() => {
    const recompute = (): void => {
      const main = mainRef.current;
      if (main === null) return;
      let chromePx = 0;
      for (const el of Array.from(
        main.querySelectorAll<HTMLElement>(
          ".toolbar, .search-bar, .edit-toolbar",
        ),
      )) {
        chromePx += el.offsetHeight;
      }
      // Phase 29 — flush canvas: the content top pad is 0 in every
      // theme, so the scroll math never adds a chrome offset.
      contentTopPadRef.current = CONTENT_PADDING_PX;
      if (chromePx > 0) {
        main.style.setProperty("--tf-chrome-y", `${chromePx}px`);
      }
    };
    recompute();
    // The toolbar wraps (grows) when the window narrows; re-measure
    // on resize so the content padding tracks the real stack.
    window.addEventListener("resize", recompute);
    return (): void => {
      window.removeEventListener("resize", recompute);
    };
  }, [editModeOpen, searchOpen, themeName]);

  // ---- effective scale ----------------------------------------------------
  //
  // Fit modes anchor to `fitAnchor` (see its declaration) instead of the
  // live `firstPageSize`. This is what keeps a crop from re-scaling every
  // uncropped page: the refresh re-fetches the cropped page-1 dims into
  // `firstPageSize` (so slots / wrappers track reality), but the fit scale
  // stays anchored to the pre-crop reference until the user explicitly
  // re-fits or the first page genuinely changes identity.
  const effectiveScale = useMemo(() => {
    if (fitAnchor === null) {
      return 1;
    }
    const availW = Math.max(viewportBox.w - CONTENT_PADDING_PX * 2, 50);
    const availH = Math.max(viewportBox.h - CONTENT_PADDING_PX * 2, 50);
    if (zoom.mode === "fit-width") {
      return availW / fitAnchor.w;
    }
    if (zoom.mode === "fit-page") {
      return Math.min(availW / fitAnchor.w, availH / fitAnchor.h);
    }
    return zoom.manualScale;
  }, [zoom, viewportBox, fitAnchor]);
  const effectiveScaleRef = useRef(effectiveScale);
  effectiveScaleRef.current = effectiveScale;

  // ---- per-page slot geometry (DEF-141) ----------------------------------
  //
  // PageView reports each mounted page's own dimensions through
  // `onPageSize`; the scroller lays every slot out at that page's own
  // size (mixed-size document), instead of deriving every slot from
  // page 1's size. Before this split a per-page crop of page 1 shrank
  // `firstPageSize` and EVERY slot collapsed to the crop box (DEF-141);
  // the full pages rendered clipped into crop-sized squares.
  //
  // `pageSizes` stores the un-rotated pt dims as reported by PageView.
  // The MEMO below derives, per visible page:
  //   - the pt dims passed to PageView as its placeholder sizing, and
  //   - the CSS slot dimensions (rotation-aware, matching PageView's
  //     own wrapper-size math) the scroller reserves scroll space with.
  //
  // Fallback for pages whose size has not been reported yet: the LARGEST
  // known size (page 1's live size on first open, then the biggest page
  // reported so far). Too-big placeholder shows a larger paper rectangle
  // briefly (corrected the moment the page mounts and reports its own
  // size) instead of clipping content into a too-small slot — the
  // DEF-141 failure mode. Page 1 always uses `firstPageSize` (the live
  // size of the current proxy — authoritative on refresh; a stale
  // `pageSizes` entry from before a crop must not win).
  const onPageSize = useCallback((page: number, widthPt: number, heightPt: number): void => {
    setPageSizes((prev) => {
      const cur = prev.get(page);
      if (cur !== undefined && cur.w === widthPt && cur.h === heightPt) {
        return prev;
      }
      const next = new Map(prev);
      next.set(page, { w: widthPt, h: heightPt });
      return next;
    });
  }, []);

  const fallbackSize = useMemo(() => {
    let best = firstPageSize ?? { w: 612, h: 792 };
    for (const s of pageSizes.values()) {
      if (s.w * s.h > best.w * best.h) {
        best = s;
      }
    }
    return best;
  }, [firstPageSize, pageSizes]);

  const pageLayouts = useMemo(() => {
    const geom: MixedPageGeom[] = [];
    const pt: Array<{ w: number; h: number }> = [];
    for (let p = 1; p <= pageCount; p += 1) {
      const own = pageSizes.get(p);
      const wPt = p === 1 && firstPageSize !== null ? firstPageSize.w : own?.w ?? fallbackSize.w;
      const hPt = p === 1 && firstPageSize !== null ? firstPageSize.h : own?.h ?? fallbackSize.h;
      pt.push({ w: wPt, h: hPt });
      // The slot math must match PageView's wrapper dims (DEF-057):
      // at 90/270 the visible width / height swap.
      const rotForLayout = ((engineState.rotations[p - 1] ?? 0) % 4 + 4) % 4;
      const isQuarterTurn = rotForLayout === 1 || rotForLayout === 3;
      geom.push({
        widthCss: (isQuarterTurn ? hPt : wPt) * effectiveScale,
        heightCss: (isQuarterTurn ? wPt : hPt) * effectiveScale,
      });
    }
    return { geom, pt };
  }, [pageSizes, fallbackSize, firstPageSize, engineState.rotations, effectiveScale, pageCount]);
  const pageGeomRef = useRef(pageLayouts.geom);
  pageGeomRef.current = pageLayouts.geom;

  // ---- first page dims (placeholder sizing for all pages) -------------------
  //
  // `doc.getPage(1)` materializes page 1's per-page state in the worker
  // (commonObjs, page tree cache entry for index 0). We only need its
  // view[] for layout sizing — release the proxy immediately so the
  // page-1 state doesn't stay resident before the initial mount's
  // PageView re-fetches it (page 1 is in the INITIAL_MOUNT_PAGES range
  // anyway, so the small re-parse cost is irrelevant) (DEF-016).
  useEffect(() => {
    let disposed = false;
    void doc.getPage(1).then((page) => {
      if (disposed) {
        return;
      }
      const size = {
        w: page.view[2] - page.view[0],
        h: page.view[3] - page.view[1],
      };
      setFirstPageSize(size);
      // Fit-anchor rule: a proxy refresh (crop / OCR / undo) whose new
      // page-1 size is an INSET of the current anchor (same physical
      // page, just smaller — a crop) must NOT re-anchor the fit, or
      // every uncropped page re-scales with the refresh. A refresh that
      // is not an inset is a genuine page identity change (delete /
      // reorder / insert / a new file) and legitimately re-fits. First
      // resolution (anchor null) always anchors.
      setFitAnchor((prev) => {
        if (prev === null) {
          return size;
        }
        if (size.w <= prev.w && size.h <= prev.h) {
          return prev;
        }
        return size;
      });
      // Drop page 1's per-page worker state right after we read the
      // dims. The next time page 1 is touched (the initial mount's
      // PageView) pdfjs re-parses from the document stream — a few
      // ms cost in exchange for not pinning page 1's state on the
      // critical-path open.
      try {
        page.cleanup();
      } catch {
        // ignore: cleanup can throw if pdf.js already destroyed the page
      }
    });
    return () => {
      disposed = true;
    };
  }, [doc]);

  // ---- viewport size tracking -------------------------------------------------
  useEffect(() => {
    const el = scrollerRef.current;
    if (el === null) {
      return;
    }
    const ro = new ResizeObserver(() => {
      setViewportBox({ w: el.clientWidth, h: el.clientHeight });
      computeGeometryMountRef.current();
    });
    ro.observe(el);
    setViewportBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // ---- page slot registry + IntersectionObserver ---------------------------
  //
  // Slots are the always-mounted, fixed-height placeholders that reserve
  // scroll space for every page. The IO observes them; pages the IO reports
  // as intersecting are added to a separate "extras" set so the geometry
  // mount can pull them in if they're close enough to the viewport.
  //
  // The geometry-based mount (below) is the SOURCE OF TRUTH for which pages
  // get a real PageView. The IO is treated as a progressive refinement: it
  // can ADD pages to the union when (and only when) the browser actually
  // fires IO callbacks for them. It cannot REMOVE pages — the geometry
  // mount owns removal. This is robust against environments where IO
  // callbacks are dropped or never fire (headless harnesses, certain
  // page-zoom configs): in those cases the geometry mount still works, and
  // the IO simply contributes nothing.
  const ioExtraPagesRef = useRef<Set<number>>(new Set());

  const registerSlot = useCallback((page: number, el: HTMLDivElement | null) => {
    if (el === null) {
      const prev = slotRefsRef.current.get(page);
      // unobserve the DOM element we were tracking for this slot, so the
      // IntersectionObserver's internal map doesn't keep a reference to a
      // node React has already removed. Without this, IO instances leak
      // one slot's HTMLElement per scroll-driven remount cycle (DEF-016
      // — DOM-counted headroom, but a real retention path for any code
      // that walks up from the IO).
      if (prev !== undefined) {
        observerRef.current?.unobserve(prev);
      }
      slotRefsRef.current.delete(page);
      return;
    }
    slotRefsRef.current.set(page, el);
    observerRef.current?.observe(el);
  }, []);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) {
      return;
    }
    // IntersectionObserver is used as a PROGRESSIVE ENHANCEMENT on top of
    // the geometry-based mount: pages the IO reports as intersecting are
    // added to the visible set so fast scrolls don't reveal blank slots
    // before the geometry mount catches up. The geometry mount owns
    // removal, so the IO cannot keep dead pages mounted.
    //
    // We keep the rootMargin tight (800px / 0px) so the IO's effective
    // intersection window stays within ~1 page above and below the
    // viewport at fit-width. Anything outside that window has nothing to
    // contribute over the geometry mount.
    //
    // Critically we DO NOT pre-observe every slot at mount: that would
    // add 520 entries to the IO's internal tracking table up front, which
    // on long.pdf kept a non-trivial amount of native memory resident in
    // the renderer for elements the geometry mount never cared about
    // (DEF-016). Slots are observed lazily inside registerSlot, and
    // unobserved again on unmount via registerSlot's null branch.
    const io = new IntersectionObserver(
      (entries) => {
        let changed = false;
        for (const entry of entries) {
          const page = Number((entry.target as HTMLElement).dataset.page);
          if (entry.isIntersecting && !ioExtraPagesRef.current.has(page)) {
            ioExtraPagesRef.current.add(page);
            changed = true;
          }
        }
        if (changed) {
          // IO is touching the visible range — push out any pending
          // idle cleanup so it doesn't fire mid-render.
          idleCleanupRef.current?.noteActivity();
          // Re-run the geometry mount so the IO additions become visible
          // through the state — the state IS the union of geometry + IO.
          computeGeometryMountRef.current();
        }
      },
      { root: scroller, rootMargin: "800px 0px", threshold: 0 },
    );
    observerRef.current = io;
    // No pre-observe: registerSlot will observe each slot the first time
    // it mounts. The geometry mount will still pick up the visible
    // range synchronously on the first paint (INITIAL_MOUNT_PAGES), so
    // the user never sees a blank workspace while waiting for the IO.
    return () => {
      io.disconnect();
      observerRef.current = null;
    };
  }, []);

  // ---- geometry-based mount: synchronous on open, recomputed on scroll ----
  //
  // The IO-driven mount above is unreliable in some real-world configurations
  // (headless harnesses, certain window/page-zoom combos); the Intersection
  // callbacks can simply never fire for page slots, leaving nothing mounted.
  // To guarantee a working mount regardless of IO behavior, we compute the
  // visible page range from scrollTop + slot geometry in JS (using
  // `mixedVisiblePageRange` from pageGeometry.ts, the per-page-size
  // variant — DEF-141). The mounted set is the geometry range, UNION'd
  // with IO extras that are still close enough to the viewport to be
  // useful. Far-out IO extras are pruned so the mounted set stays bounded.
  const computeGeometryMountRef = useRef<() => void>(() => undefined);
  computeGeometryMountRef.current = (): void => {
    const scroller = scrollerRef.current;
    if (firstPageSize === null) {
      return;
    }
    const range = mixedVisiblePageRange(
      scroller?.scrollTop ?? 0,
      scroller?.clientHeight ?? 0,
      pageGeomRef.current,
      pageCount,
      PAGE_BUFFER_PAGES,
      // Phase 29 — flush canvas: the content top pad is 0 in every
      // theme (CONTENT_PADDING_PX), and the mount's "fully above the
      // viewport" math subtracts exactly that real padding.
      contentTopPadRef.current,
    );
    const rangeStart = range.start;
    const rangeEnd = range.end;
    setMountedPages((prev) => {
      // Drop IO extras that have scrolled far from the current viewport so
      // the union can't grow without bound. We keep anything within
      // PRUNE_DISTANCE_PAGES of the geometry range; farther entries are
      // pruned (and their bitmap is dropped via PageView's unmount +
      // shouldRender=false clear). A smaller buffer keeps idle memory
      // lower at the cost of a slightly slower first scroll into a far
      // page — the rail re-renders from scratch on demand.
      const PRUNE_DISTANCE_PAGES = 4;
      const keepLow = rangeStart - PRUNE_DISTANCE_PAGES;
      const keepHigh = rangeEnd + PRUNE_DISTANCE_PAGES;
      for (const page of ioExtraPagesRef.current) {
        if (page < keepLow || page > keepHigh) {
          ioExtraPagesRef.current.delete(page);
        }
      }
      let changed = false;
      const next = new Set<number>();
      for (let p = rangeStart; p <= rangeEnd; p += 1) {
        next.add(p);
      }
      // IO extras within range are included.
      for (const page of ioExtraPagesRef.current) {
        if (page >= rangeStart && page <= rangeEnd) {
          next.add(page);
        }
      }
      if (next.size !== prev.size) {
        changed = true;
      } else {
        for (const p of next) {
          if (!prev.has(p)) {
            changed = true;
            break;
          }
        }
      }
      return changed ? next : prev;
    });
  };

  // Initial synchronous mount: as soon as the document opens and the first
  // page's dimensions are known, mount the first INITIAL_MOUNT_PAGES slots so
  // the very first paint already shows real bitmaps. No IO round-trip, no
  // async — by definition available on the first paint.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    // DEF-098 — the mount-sync block must ONLY land a *pending*
    // jump (one whose scrollTo bailed for lack of geometry). The
    // previous shape — `jumpTargetRef.current ?? currentPage` —
    // re-ran this effect on EVERY `currentPage` change and
    // INSTANT-scrolled the scroller to whatever page the heuristic
    // last computed. Mid-smooth-scroll that dragged `currentPage`
    // to an intermediate page (the DEF-058 lock only holds while
    // scroll events flow), so this effect snapped the scroller back
    // to that intermediate page — the "jump starts then snaps
    // back" failure. With the pending-flag gate the effect only
    // ever applies a jump the user clicked but the scroller has not
    // yet landed, and it clears itself afterwards: after a jump
    // completes (or a user scroll runs), `currentPage` changes
    // never touch the scroll position again.
    const pending = jumpTargetRef.current;
    if (pending !== null && pendingJumpLandingRef.current && firstPageSize !== null) {
      const top =
        mixedSlotOffsetTop(pending, pageGeomRef.current, contentTopPadRef.current) -
        contentTopPadRef.current;
      if (Math.abs(scroller.scrollTop - top) > 1) {
        scroller.scrollTo({ top: Math.max(top, 0), behavior: "instant" });
      }
      pendingJumpLandingRef.current = false;
    } else if (
      pending === null &&
      firstPageSize !== null &&
      (!samePageSize(syncGuardRef.current.firstPageSize, firstPageSize) ||
        syncGuardRef.current.pageCount !== pageCount)
    ) {
      // No jump in flight, but the geometry (or page count) just
      // changed — e.g. the doc opened and `firstPageSize` finally
      // resolved, or a delete/reorder changed `pageCount`. Keep the
      // scroller on the currently-active page. This runs only on
      // the transition (guarded by the ref), never on `currentPage`
      // changes driven by the heuristic.
      //
      // DEF-232 — the comparison is by VALUE, not object identity. A
      // doc-proxy swap (`refreshDocProxyFor`: edit / annotation /
      // crop / OCR bakes re-serialize the engine doc) publishes a NEW
      // `{ w, h }` object for the SAME page size, and an identity
      // compare treated that as a geometry change: every refresh
      // instantly re-scrolled to `currentPage`, which the heuristic
      // can report as the PREVIOUS page while the target page's top
      // is still below the chrome line. The result was a viewport
      // yank (page 2 at scrollTop 1439 jumped to 0 on Confirm) plus
      // a wrong `currentPage`-derived jump. A byte-identical swap
      // must leave the scroll position untouched; a real size change
      // (page-1 crop, re-laid-out page) still re-syncs.
      const top =
        mixedSlotOffsetTop(currentPage, pageGeomRef.current, contentTopPadRef.current) -
        contentTopPadRef.current;
      if (Math.abs(scroller.scrollTop - top) > 1) {
        scroller.scrollTo({ top: Math.max(top, 0), behavior: "instant" });
      }
    }
    syncGuardRef.current = { firstPageSize, pageCount };
    if (!mountSeededRef.current) {
      mountSeededRef.current = true;
      const initialEnd = Math.min(pageCount, INITIAL_MOUNT_PAGES);
      setMountedPages((prev) => {
        let changed = false;
        const next = new Set(prev);
        for (let p = 1; p <= initialEnd; p += 1) {
          if (!next.has(p)) {
            next.add(p);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
      // Also seed the IO extras with the initial range so the geometry mount
      // doesn't immediately prune what we just added.
      for (let p = 1; p <= initialEnd; p += 1) {
        ioExtraPagesRef.current.add(p);
      }
    }
    // Run a geometry mount so the state converges with the IO extras.
    computeGeometryMountRef.current();
  }, [firstPageSize, pageCount, currentPage]);

  // ---- scroll -> current page --------------------------------------------------
  //
  // DEF-058 — track an in-flight jump target so the scroll-event
  // heuristic (which fires repeatedly during a smooth scroll) cannot
  // drag `currentPage` back to an intermediate page while the scroll
  // animation is still mid-flight. Without the guard, a jump from
  // page 1 to page 10 in a 10-page doc would briefly put
  // `currentPage` on the value the scroller is currently passing
  // through (e.g. 2 or 3 mid-scroll) and the SideRail highlight
  // would visibly flicker / land on the wrong slot. We freeze the
  // jump target in a ref so the scroll handler can compare against
  // it without making the ref a dep of any effect.
  //
  // The target is cleared in three ways:
  //   1. `scrollend` (browsers that fire it) — definitive end of
  //      the smooth scroll.
  //   2. The scroll handler notices the scroller is now AT or PAST
  //      the target page's top edge — same math as the initial
  //      `jumpToPage` target — and clears the lock.
  //   3. A fallback timer (`JUMP_LOCK_FALLBACK_MS`) — covers
  //      browsers / harnesses that never fire `scrollend` and
  //      that may interrupt the smooth scroll before reaching the
  //      target.
  const jumpTargetRef = useRef<number | null>(null);
  const jumpLockTimerRef = useRef<number | null>(null);
  // DEF-098 — a queued jump whose `scrollTo` bailed because the
  // geometry (`firstPageSize`) wasn't ready yet. Set inside
  // `jumpToPage` when it returns early; the mount-sync effect below
  // lands the scroller on the jump target the moment the geometry
  // arrives, then clears the flag. The flag is what stops the
  // mount-sync effect from INSTANT-killing an in-flight smooth
  // scroll: a click that *did* scroll must never be re-applied.
  const pendingJumpLandingRef = useRef(false);
  // DEF-098 — gates the initial-page-restore effect to a single run
  // per DocumentView mount (see the effect for the why).
  const didInitialRestoreRef = useRef(false);
  // DEF-098 — last `{firstPageSize, pageCount}` pair the mount-sync
  // effect synced against. The effect's post-open / post-delete
  // "keep the current page in view" re-sync must fire only on those
  // transitions, never on `currentPage` changes (which the
  // scroll-heuristic drives). Without the guard, every heuristic
  // update re-triggered the sync and INSTANT-snapped the scroller.
  const syncGuardRef = useRef<{ firstPageSize: { w: number; h: number } | null; pageCount: number }>({
    firstPageSize: null,
    pageCount: 0,
  });
  // DEF-098 — the mount-sync effect's INITIAL_MOUNT_PAGES seeding
  // (pages 1..3 + IO extras) is an open-time one-shot. Previously it
  // re-ran on every `currentPage` change, re-adding the first pages
  // to the mounted set on every page turn — the geometry mount then
  // pruned them again, churning PageView mount/unmount cycles (each
  // a pdf.js getPage render) on every jump.
  const mountSeededRef = useRef(false);
  // DEF-058 — last scrollTop we successfully validated as "past
  // the jump target". When the user lands on the target we clear
  // the lock; if a subsequent user-driven scroll moves away the
  // heuristic must take over again immediately.
  const JUMP_LOCK_FALLBACK_MS = 1200;

  const computeCurrentPage = useCallback(() => {
    const scroller = scrollerRef.current;
    if (scroller === null || firstPageSize === null) {
      return;
    }
    const page = mixedPageAtScrollTop(
      scroller.scrollTop,
      pageGeomRef.current,
      pageCount,
      contentTopPadRef.current,
    );
    setCurrentPage((prev) => (prev === page ? prev : page));
  }, [firstPageSize, pageCount]);

  const onScroll = useCallback(() => {
    if (scrollRafRef.current !== 0) {
      return;
    }
    scrollRafRef.current = window.requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      // Touching the document — push out any pending idle cleanup so
      // it doesn't fire mid-render. Resets the 5s window from "now".
      idleCleanupRef.current?.noteActivity();
      // DEF-058 — while a jump is in flight, suppress the scroll-driven
      // currentPage update UNLESS the scroller has reached the target
      // (in which case we let the heuristic run, then clear the lock).
      const target = jumpTargetRef.current;
      if (target !== null && firstPageSize !== null) {
        const targetTop =
          mixedSlotOffsetTop(target, pageGeomRef.current, contentTopPadRef.current) -
        contentTopPadRef.current;
        const scroller = scrollerRef.current;
        if (scroller !== null && scroller.scrollTop >= targetTop - 1) {
          jumpTargetRef.current = null;
          if (jumpLockTimerRef.current !== null) {
            window.clearTimeout(jumpLockTimerRef.current);
            jumpLockTimerRef.current = null;
          }
          // The heuristic below will recompute from the final
          // scrollTop; fall through to it.
        } else {
          // Still mid-jump. Re-arm the fallback timer in case the
          // smooth scroll never fires `scrollend` (some harnesses).
          if (jumpLockTimerRef.current === null) {
            jumpLockTimerRef.current = window.setTimeout(() => {
              jumpTargetRef.current = null;
              jumpLockTimerRef.current = null;
              // DEF-098 — release the lock WITHOUT recomputing
              // `currentPage`. The scroller may still be advancing
              // toward the jump target on a throttled main thread;
              // forcing a recompute from the mid-flight scrollTop
              // here would flick `currentPage` to the page the
              // view is currently passing and let the mount-sync
              // effect snap the scroller back to it. The jump
              // target stays sticky: the next real scroll event
              // (or `scrollend`) resumes the heuristic.
            }, JUMP_LOCK_FALLBACK_MS);
          }
          computeGeometryMountRef.current();
          return;
        }
      }
      computeCurrentPage();
      computeGeometryMountRef.current();
    });
  }, [computeCurrentPage, firstPageSize]);

  useEffect(
    () => () => {
      if (scrollRafRef.current !== 0) {
        window.cancelAnimationFrame(scrollRafRef.current);
      }
      if (jumpLockTimerRef.current !== null) {
        window.clearTimeout(jumpLockTimerRef.current);
        jumpLockTimerRef.current = null;
      }
    },
    [],
  );

  // `scrollend` is the definitive "smooth scroll finished" event on
  // modern browsers; attach it once and use it to drop the jump
  // lock immediately. If the browser doesn't support `scrollend`
  // (older Chromium, some WebKit), the fallback timer above covers
  // us — see the JUMP_LOCK_FALLBACK_MS branch.
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    const onScrollEnd = (): void => {
      if (jumpTargetRef.current !== null) {
        jumpTargetRef.current = null;
        if (jumpLockTimerRef.current !== null) {
          window.clearTimeout(jumpLockTimerRef.current);
          jumpLockTimerRef.current = null;
        }
        computeCurrentPage();
      }
    };
    scroller.addEventListener("scrollend", onScrollEnd);
    return () => {
      scroller.removeEventListener("scrollend", onScrollEnd);
    };
  }, [computeCurrentPage]);

  // ---- jump ----------------------------------------------------------------------
  const jumpToPage = useCallback(
    (page: number, smooth = true) => {
      const scroller = scrollerRef.current;
      // B6 — always update `currentPage` so the SideRail highlight
      // and the toolbar page indicator reflect the new active page
      // even when the scroller geometry isn't ready yet (e.g. the
      // user clicks a thumb before the first page has reported its
      // viewport size, which happens when firstPageSize is still
      // null on the very first render after tab open). The previous
      // implementation returned early in that case, leaving the
      // click visually a no-op (the rail highlight stayed on page
      // 1, the toolbar indicator stayed on page 1). We still defer
      // the actual `scrollTo` call until `firstPageSize` resolves
      // (the geometry-based offset is meaningless without it); a
      // later render after the size arrives will run the scroll via
      // the fallback path below. The optimistic currentPage update
      // is what makes the click feel responsive at first paint.
      setCurrentPage(page);
      jumpTargetRef.current = page;
      if (jumpLockTimerRef.current !== null) {
        window.clearTimeout(jumpLockTimerRef.current);
      }
      jumpLockTimerRef.current = window.setTimeout(() => {
        jumpTargetRef.current = null;
        jumpLockTimerRef.current = null;
        // DEF-098 — release-only. No forced recompute from whatever
        // scrollTop the scroller happens to hold now (it may still
        // be gliding toward the target on a busy main thread). The
        // jump target stays sticky; the heuristic resumes on the
        // next real scroll event or `scrollend`.
      }, JUMP_LOCK_FALLBACK_MS);
      if (scroller === null || firstPageSize === null) {
        // Geometry not ready yet — currentPage is set, but the
        // scrollTo call has nothing to land on. The
        // `firstPageSize`-dependent effect above will trigger a
        // re-render and the next interaction will scroll normally.
        // DEF-098 — flag the queued jump so the mount-sync effect
        // lands the scroller the moment the geometry arrives (and
        // so it does NOT try to re-apply a click that *did* scroll).
        pendingJumpLandingRef.current = true;
        return;
      }
      const target = mixedSlotOffsetTop(page, pageGeomRef.current, contentTopPadRef.current);
      // DEF-098 — the click's own scroll runs now; make sure the
      // mount-sync effect does not re-apply it as a queued jump
      // (which would INSTANT-kill this smooth scroll). A subsequent
      // bail (geometry missing) re-flags it above.
      pendingJumpLandingRef.current = false;
      scroller.scrollTo({
        top: Math.max(target - contentTopPadRef.current, 0),
        behavior: smooth ? "smooth" : "instant",
      });
      // DEF-058 — set the jump target FIRST so the scroll heuristic
      // sees the lock the moment the first scroll event fires (the
      // browser may begin animating before the next microtask).
      // Set the optimistic currentPage too so the SideRail highlight
      // moves to the destination immediately, not after the smooth
      // scroll lands.
      void target;
    },
    // DEF-098 — `computeCurrentPage` is no longer called from this
    // body (the fallback timer is release-only), so it is not a dep
    // anymore. `firstPageSize` alone drives the identity: the body
    // closes over it for the scroll target.
    [firstPageSize],
  );

  // ---- initial page restore -------------------------------------------------------
  useEffect(() => {
    // DEF-098 — this effect must fire at most ONCE per DocumentView
    // mount. The previous deps (`[jumpToPage, initial.currentPage]`)
    // re-ran it on every App persist round-trip: `jumpToPage`
    // recreated its identity whenever `firstPageSize`/`pageCount`
    // changed, and `initial.currentPage` changed the moment the
    // optimistic page update round-tripped through the host
    // (`onPersist` -> App -> `initial` prop). Each re-run re-armed
    // the 60ms timer and re-issued `jumpToPage`, re-arming the
    // jump lock and fighting the user's actual navigation target.
    if (didInitialRestoreRef.current) {
      return;
    }
    didInitialRestoreRef.current = true;
    const target = initial.currentPage;
    if (target <= 1) {
      return;
    }
    const timer = window.setTimeout(() => jumpToPage(target, false), 60);
    return () => window.clearTimeout(timer);
  }, [jumpToPage, initial.currentPage]);

  // ---- external jump (Phase 32: the shared Multi Mode rail) ------------------
  //
  // The rail lives outside this view, so it cannot call `jumpToPage`
  // directly. A new `seq` is the only trigger: re-renders (a focus move, a
  // sibling section re-rendering) must never replay the last request.
  const lastJumpSeqRef = useRef(0);
  useEffect(() => {
    const request = jumpRequest;
    if (request === null || request === undefined) return;
    if (request.seq === lastJumpSeqRef.current) return;
    lastJumpSeqRef.current = request.seq;
    jumpToPage(request.page, true);
  }, [jumpRequest, jumpToPage]);

  // ---- zoom controls -----------------------------------------------------------------
  const zoomTo = useCallback((direction: 1 | -1) => {
    const next = stepTowards(effectiveScaleRef.current, direction);
    dispatchZoom({ type: "set-manual-scale", scale: next });
  }, []);
  const setMode = useCallback(
    (mode: ZoomMode) => {
      if ((mode === "fit-width" || mode === "fit-page") && firstPageSize !== null) {
        // Explicit user fit: re-anchor the fit to the LIVE page-1 size.
        // A prior crop kept the old anchor so the refresh didn't jump;
        // an explicit fit click means "fit now" and must use the current
        // bytes (post-crop), restoring the pre-split semantics for
        // deliberate fit actions.
        setFitAnchor(firstPageSize);
      }
      dispatchZoom({ type: "set-mode", mode });
    },
    [firstPageSize],
  );

  // ---- ctrl+wheel zoom -----------------------------------------------------------------
  useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) {
      return;
    }
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) {
        return;
      }
      e.preventDefault();
      const { remainder, steps } = accumulateWheel(wheelRemainderRef.current, e.deltaY);
      wheelRemainderRef.current = remainder;
      if (steps !== 0) {
        let scale = effectiveScaleRef.current;
        for (let i = 0; i < Math.abs(steps); i += 1) {
          scale = stepTowards(scale, steps > 0 ? 1 : -1);
        }
        dispatchZoom({ type: "set-manual-scale", scale });
      }
    };
    scroller.addEventListener("wheel", onWheel, { passive: false });
    return () => scroller.removeEventListener("wheel", onWheel);
  }, []);

  // ---- search ---------------------------------------------------------------------------
  //
  // Lazy + incremental: the index is built per-page on first use and cached in
  // `indexesRef`. Subsequent searches reuse cached entries. The build loop
  // yields back to the event loop every SEARCH_CHUNK_PAGES pages so the
  // renderer (scrolling, UI interactions) stays responsive on a 500+ page
  // doc. `searchIndexProgress` reports { built, total } so the diagnostics
  // snapshot in tflexDiagnostics can show what's going on.
  //
  // DEF-050 (OCR + stale cache): OCR writes an invisible Tr=3 text layer
  // to the engine's copy of the doc — but the renderer's `doc` proxy is
  // unchanged, so any cached `PageTextIndex` entries built before OCR
  // still reflect pre-OCR content. The host registers an invalidator via
  // `registerSearchIndexInvalidator`; on OCR completion (or any other
  // mutation the host considers "text-content changed") it calls the
  // invalidator, which clears `indexesRef` and bumps
  // `searchInvalidationTick` (a dep of this effect). On the next run
  // we walk every page, call `pdf.js`'s `getTextContent()` afresh, and
  // rebuild the index — including any OCR-injected text items, since
  // pdf.js returns TextItem-like objects regardless of rendering mode.
  //
  // DEF-050 (hang after OCR): the original "stuck on Searching..."
  // symptom was caused by `pdf/ocrRasterize.ts` calling `doc.destroy()`
  // per page (terminating pdf.js's worker); subsequent `doc.getPage(...)`
  // calls in this loop rejected and left the UI stuck on "Searching..."
  // because no catch block existed. The fix lives in `ocrRasterize.ts`;
  // this loop is additionally hardened with a try/catch so any future
  // pdf.js failure surfaces as "No results" instead of a permanent
  // spinner.
  useEffect(() => {
    const token = ++searchTokenRef.current;
    const q = query.trim();
    if (q.length === 0) {
      setHits([]);
      setSearching(false);
      setActiveHitIndex(-1);
      setSearchIndexProgress(null);
      onSearchIndexProgressRef.current?.(null);
      return;
    }
    setSearching(true);
    setSearchIndexProgress({ built: 0, total: pageCount });
    onSearchIndexProgressRef.current?.({ built: 0, total: pageCount });
    // Search walks every page, calling doc.getPage() and getTextContent
    // for the un-indexed ones. Treat that as document activity so the
    // idle cleanup doesn't fire mid-index.
    idleCleanupRef.current?.noteActivity();
    let cancelled = false;
    const collected: SearchHit[] = [];
    const run = async (): Promise<void> => {
      let built = 0;
      const total = pageCount;
      try {
        for (let page = 1; page <= pageCount; page += 1) {
          let index = indexesRef.current.get(page);
          if (index === undefined) {
            const pdfPage = await doc.getPage(page);
            const textContent = await pdfPage.getTextContent();
            // pdf.js returns TextItem-like objects regardless of the
            // page's text rendering mode — visible text and OCR-injected
            // invisible text (Tr=3) share the same `{ str, transform, ... }`
            // shape. The map below collapses both to the same string
            // representation so `buildPageIndex` doesn't need to know
            // which mode produced each item.
            const items = textContent.items.map((item) =>
              "str" in item && typeof item.str === "string" ? item.str : "",
            );
            index = buildPageIndex(items);
            indexesRef.current.set(page, index);
            built += 1;
          }
          collected.push(...findPageHits(index, page, q));
          if (cancelled || token !== searchTokenRef.current) {
            return;
          }
          if (page % SEARCH_CHUNK_PAGES === 0) {
            const snapshot = { built, total };
            setSearchIndexProgress(snapshot);
            onSearchIndexProgressRef.current?.(snapshot);
            // Still mid-walk — push the idle window out so cleanup doesn't
            // fire while the search loop is iterating pages.
            idleCleanupRef.current?.noteActivity();
            await new Promise<void>((r) => setTimeout(r, 0));
            if (cancelled || token !== searchTokenRef.current) {
              return;
            }
          }
        }
      } catch (err) {
        // DEF-050: any pdf.js failure (worker torn down, destroyed
        // doc, transient parse error) must clear "Searching..." so the
        // UI doesn't sit on an indefinite spinner. We surface the
        // collected hits up to the point of failure and report zero
        // progress so the status text shows "No results" rather than
        // claiming the loop is still mid-walk.
        if (!cancelled && token === searchTokenRef.current) {
          setHits(collected);
          setSearching(false);
          setActiveHitIndex(collected.length > 0 ? 0 : -1);
          setSearchIndexProgress({ built, total });
          onSearchIndexProgressRef.current?.({ built, total });
        }
        const message = err instanceof Error ? err.message : String(err);
        // Best-effort diagnostic; the toast surface is owned by the
        // host (`onToast`) and may not be wired for every DocumentView
        // instance. Swallow if absent.
        try {
          onToast?.("error", `Search failed: ${message}`);
        } catch {
          // ignore: onToast may not be provided
        }
        return;
      }
      if (!cancelled && token === searchTokenRef.current) {
        setHits(collected);
        setSearching(false);
        setActiveHitIndex(collected.length > 0 ? 0 : -1);
        const snapshot = { built, total };
        setSearchIndexProgress(snapshot);
        onSearchIndexProgressRef.current?.(snapshot);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [query, doc, pageCount, searchInvalidationTick]);

  // Reset the cached search index when the document changes (different `doc`
  // reference). The `doc` identity changes whenever a new PDF is opened.
  useEffect(() => {
    indexesRef.current = new Map();
  }, [doc]);

  // ---- idle document cleanup -----------------------------------------------
  //
  // pdf.js keeps per-document worker-side caches alive for the entire
  // lifetime of the `PDFDocumentProxy`:
  //
  //   - font cache (loaded TrueType / OpenType data, cmaps)
  //   - global image cache (decoded JPEG / JPX / JBig2 bitmaps)
  //   - pageDictCache / pageIndexCache / pageKidsCountCache
  //   - standardFontDataCache / builtInCMapCache / systemFontCache
  //
  // On long.pdf these dominate the renderer idle footprint (DEF-016
  // exit target: <=150 MB idle). `doc.cleanup()` flushes them all in
  // one async call, but only when no render is in flight — pdf.js
  // refuses cleanup during active renders.
  //
  // The coordinator is rebuilt per `doc` identity: a pending cleanup
  // against an obsolete document is cancelled when the user opens a
  // new tab, and a fresh coordinator is installed for the new
  // document.
  useEffect(() => {
    const coord = createIdleCleanupCoordinator(
      () => {
        // pdf.js cleanup is async. Swallow rejection — a failed
        // cleanup is a memory miss, not a correctness issue, and the
        // next idle window will try again.
        return Promise.resolve(doc.cleanup()).catch(() => undefined);
      },
      () => inFlightRendersRef.current > 0,
      { idleMs: DOC_IDLE_CLEANUP_MS },
    );
    idleCleanupRef.current = coord;
    // Reset the in-flight counter on document change so a counter
    // from the previous tab doesn't gate cleanup on the new one.
    inFlightRendersRef.current = 0;
    coord.requestCleanup();
    return () => {
      coord.cancel();
      idleCleanupRef.current = null;
    };
  }, [doc]);

  // ---- Forms / signatures (Phase 4) ----
  // Phase 4: derived per-page groups so each PageView's overlays only see
  // their own fields / placements (avoids re-rendering every page on
  // every fill or move).
  const formFieldsByPage = useMemo(() => {
    const map = new Map<number, FormField[]>();
    for (const f of formFields) {
      const list = map.get(f.page);
      if (list === undefined) {
        map.set(f.page, [f]);
      } else {
        list.push(f);
      }
    }
    return map;
  }, [formFields]);

  const signaturesByPage = useMemo(() => {
    const map = new Map<number, SignaturePlacement[]>();
    for (const p of signatures) {
      const list = map.get(p.page);
      if (list === undefined) {
        map.set(p.page, [p]);
      } else {
        list.push(p);
      }
    }
    return map;
  }, [signatures]);

  // Lookup map: saved signature id -> SavedSignature. The signatures
  // overlay reads from this so the SVG render path can resolve any
  // placement back to its source bytes / points / text.
  const savedSignatureMap = useMemo(() => {
    const map: Record<string, SavedSignature> = {};
    for (const s of savedSignatures) map[s.id] = s;
    return map;
  }, [savedSignatures]);

  const onFormValueChangeStable = useCallback(
    (id: string, value: string | string[]): void => {
      onFormValueChange?.(id, value);
    },
    [onFormValueChange],
  );
  const onFormListboxToggleStable = useCallback(
    (id: string, option: string): void => {
      onFormListboxToggle?.(id, option);
    },
    [onFormListboxToggle],
  );
  const onPlaceSignatureStable = useCallback(
    (signatureId: string, page: number, rect: SignaturePlacement["rect"]): void => {
      onPlaceSignature?.(signatureId, page, rect);
    },
    [onPlaceSignature],
  );
  const onMoveSignatureStable = useCallback(
    (placementId: string, rect: SignaturePlacement["rect"]): void => {
      onMoveSignature?.(placementId, rect);
    },
    [onMoveSignature],
  );
  const onDeleteSignatureStable = useCallback(
    (placementId: string): void => {
      onDeleteSignature?.(placementId);
    },
    [onDeleteSignature],
  );
  // B1 — stable wrapper for the host's "exit Sign mode" setter.
  // The pending action bar's Cancel button calls through this.
  const onCancelSignatureArmStable = useCallback((): void => {
    onCancelSignatureArm?.();
  }, [onCancelSignatureArm]);

  // Phase 10 — pass the edit state through to PageView with a
  // stable callback so child re-renders are isolated. The host
  // (App) owns the reducer + IPC.
  //
  // Phase 21 — the panel's CURRENT values (the selected box's actual
  // formatting, or the pending per-tool defaults when nothing is
  // selected) ride along as `textStyle`. The inline editor no longer
  // owns style controls: it reads this prop for its live preview AND
  // for the creation / run-edit payload, so a panel edit made with no
  // object selected is what the NEXT created box actually uses.
  const editProp = useMemo(() => {
    if (!editModeOpen || edit === null) return null;
    return {
      ...edit,
      textStyle: editTextStyleFromValues(textPanelTextValues),
      // Phase 26 — the panel's Text field drives Edit-mode text too: the
      // overlay reports its selected text target up, receives the live
      // session text for its run preview, and commits a run when the
      // session's token flips.
      onTextTargetChange: onEditTextTargetChange,
      textLive:
        textEdit !== null && textEdit.target.kind === "run" ? textEdit.text : null,
      textCommitToken,
    };
  }, [
    editModeOpen,
    edit,
    textPanelTextValues,
    onEditTextTargetChange,
    textEdit,
    textCommitToken,
  ]);

  // B5 / B14 — when Edit mode opens, force the annotation tool
  // back to "select". The toolbar's `editBlocksTool` gate already
  // prevents arming shape / markup tools while Edit is open, but
  // it does NOT reset a tool that was already active when the
  // user opened Edit. Without this effect, the user could leave
  // a rectangle armed, open Edit mode, and the AnnotationOverlay
  // would still respond to shape drags — over the Edit overlay
  // (B14). Forcing the reducer to "select" on the rising edge
  // of `editModeOpen` keeps the AnnotationOverlay inert while
  // Edit is open.
  const prevEditModeOpenRef = useRef<boolean>(editModeOpen);
  useEffect(() => {
    if (editModeOpen && !prevEditModeOpenRef.current) {
      dispatchAnnTool({ type: "set-tool", tool: "select" });
    }
    prevEditModeOpenRef.current = editModeOpen;
  }, [editModeOpen]);

  // DEF-257 — opening Edit mode (and any later engine registry echo)
  // rehydrates the renderer's text-box mirror from the engine registry.
  // The mirror (`edit.state.textBoxes`) is what every page's EditOverlay
  // draws its `.edit-box` surfaces from; App adopts the engine list on
  // every state echo, but a re-open with no new echo left a committed box
  // in the engine and absent from the mirror — so it had no surface and
  // could not be selected or moved.
  //
  // `sameTextBoxes` keeps it idempotent — an unchanged registry
  // dispatches nothing, so no duplicate surfaces and no openTabs churn —
  // and an ABSENT or EMPTY `textBoxes` list (the engine reports `[]` for
  // a document with no boxes) leaves a renderer-local draft untouched.
  useEffect(() => {
    if (!editModeOpen || edit === null) return;
    const fromEngine = engineState.textBoxes;
    if (fromEngine === undefined || fromEngine.length === 0) return;
    const placements = engineTextBoxesToPlacements(fromEngine, edit.defaultFont);
    if (sameTextBoxes(edit.state.textBoxes, placements)) return;
    edit.onAction({ type: "replace-text-boxes", boxes: placements });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editModeOpen, engineState.textBoxes]);

  const editToolbarHint = edit !== null ? defaultEditHint(edit.state.tool) : defaultEditHint("off");

  const hitsByPage = useMemo(() => {
    const map = new Map<number, SearchHit[]>();
    for (const hit of hits) {
      const list = map.get(hit.page);
      if (list === undefined) {
        map.set(hit.page, [hit]);
      } else {
        list.push(hit);
      }
    }
    return map;
  }, [hits]);

  const activeHit =
    activeHitIndex >= 0 && activeHitIndex < hits.length ? hits[activeHitIndex] : null;

  const cycleHits = useCallback(
    (direction: 1 | -1) => {
      setActiveHitIndex((prev) => {
        if (hits.length === 0) {
          return -1;
        }
        const current = prev < 0 ? (direction === 1 ? -1 : 0) : prev;
        return direction === 1
          ? nextHitIndex(current, hits.length)
          : prevHitIndex(current, hits.length);
      });
    },
    [hits.length],
  );

  const onActiveHitTop = useCallback(
    (page: number, cssTop: number) => {
      const scroller = scrollerRef.current;
      if (scroller === null || firstPageSize === null) {
        return;
      }
      const pageTop = mixedSlotOffsetTop(page, pageGeomRef.current, contentTopPadRef.current);
      const target = pageTop + cssTop - scroller.clientHeight / 2;
      scroller.scrollTo({ top: Math.max(target, 0), behavior: "smooth" });
    },
    [firstPageSize],
  );

  // ---- annotations (Phase 3) -----------------------------------------------
  // Hand the toolbar's actions straight through the reducer. The toolbar is
  // disabled when there is no document (always-disabled prop is false here
  // because a tab is mounted only when a document is open).
  /** Phase 28 — the toolbar's dropdown colour drives the ARMED tool
   *  only. The selected annotation's colour is owned by the in-canvas
   *  action bar's colour box (it patches THAT annotation live), so this
   *  no longer intercepts `set-color` to patch the selection. */
  const onAnnToolAction = useCallback(
    (a: AnnotationToolAction): void => {
      dispatchAnnTool(a);
    },
    [],
  );

  // When the rail's annotations panel jumps to an annotation, scroll to its
  // page and pulse a flash highlight on the matching overlay. The flash is
  // purely visual — it does not move focus or selection.
  const flashAnnotation = useCallback((id: string): void => {
    setFlashId(id);
    if (flashTimerRef.current !== null) {
      window.clearTimeout(flashTimerRef.current);
    }
    flashTimerRef.current = window.setTimeout(() => {
      setFlashId(null);
      flashTimerRef.current = null;
    }, 1700);
  }, []);

  useEffect(
    () => () => {
      if (flashTimerRef.current !== null) {
        window.clearTimeout(flashTimerRef.current);
      }
    },
    [],
  );

  const onAnnJump = useCallback(
    (page: number, id: string): void => {
      jumpToPage(page, true);
      flashAnnotation(id);
    },
    [jumpToPage, flashAnnotation],
  );

  // Group annotations by page so each PageView only sees its own (avoids
  // re-rendering every page on every annotation create/edit).
  const annotationsByPage = useMemo(() => {
    const map = new Map<number, Annotation[]>();
    for (const a of renderedAnnotations) {
      const list = map.get(a.page);
      if (list === undefined) {
        map.set(a.page, [a]);
      } else {
        list.push(a);
      }
    }
    return map;
  }, [renderedAnnotations]);

  // After a one-shot tool (textbox, note) commits, return to plain select so
  // the next page click doesn't accidentally open another editor.
  const onAnnFinishedOneShot = useCallback((): void => {
    dispatchAnnTool({ type: "set-tool", tool: "select" });
  }, []);

  // Phase 21 regression fix — a text-bearing annotation is selected the
  // instant it is placed, in the SAME batched update as the one-shot
  // disarm above. The panel then stays open on the selection branch
  // (`selectedAnnText`) instead of the armed-tool branch. Before this,
  // the disarm dropped the last open branch on placement: the panel
  // closed, reflowed the page 248px, and the user's follow-up click on
  // the annotation they had just placed landed on a moving origin.
  // Only the annotation text kinds take part — the panel is theirs;
  // shape / ink / arrow placement is unchanged.
  const onAnnCreate = useCallback(
    (ann: Annotation): void => {
      if (ann.kind === "textbox" || ann.kind === "note" || ann.kind === "callout") {
        setSelectedAnn(ann);
        // Phase 26 — a text element is placed EMPTY and its text is typed
        // in the panel's Text field. Remember it so an untouched
        // placement is dropped again when the session ends empty.
        if (ann.text === "") justPlacedTextRef.current = ann.id;
      }
      onCreateAnnotation?.(ann);
    },
    [onCreateAnnotation],
  );

  // ---- Bug 1 / cross-disarm: an external tool surface must disarm the ----
  // annotation creation tool. When Edit-content mode opens, the Sign tool
  // is armed, or the Stamp tool is armed, the page has (or is about to
  // have) a second pointer-active layer; leaving an annotation tool armed
  // meant the next page click could both create an annotation AND place a
  // signature / stamp / edit-box. The annotation tool state lives in this
  // component, so the transition into "some external tool is active" is
  // watched here and resets the tool to plain select. The ref keeps the
  // effect firing only on the rising edge, never on every re-render.
  const anyExternalToolActive =
    editModeOpen || armedSignatureId !== null || armedStamp !== null;
  const prevExternalToolActiveRef = useRef(anyExternalToolActive);
  useEffect(() => {
    const prev = prevExternalToolActiveRef.current;
    if (anyExternalToolActive && !prev) {
      dispatchAnnTool({ type: "set-tool", tool: "select" });
      // Phase 13 — hand (pan) mode is a viewer mode and loses to every
      // external tool surface: opening Edit / Sign / Stamp while pan is
      // armed drops pan first, so the two never share the pointer.
      setHandActive(false);
    }
    prevExternalToolActiveRef.current = anyExternalToolActive;
  }, [anyExternalToolActive]);

  // ---- Phase 13: hand (pan) mode disarm cascade --------------------------
  // Hand mode owns the scroller pointer, so on its rising edge every
  // other pointer-active surface is dismissed: armed annotation tools
  // go to select, Edit mode closes, the pending signature placement
  // and the armed stamp ghost drop. The ref keeps this on the rising
  // edge only (arming hand twice is a no-op).
  const prevHandActiveRef = useRef(handActive);
  useEffect(() => {
    const prev = prevHandActiveRef.current;
    if (handActive && !prev) {
      dispatchAnnTool({ type: "set-tool", tool: "select" });
      if (editModeOpen) onEditModeToggle?.();
      if (armedSignatureId !== null) onCancelSignatureArm?.();
      if (armedStamp !== null) onDisarmStamp?.();
    }
    prevHandActiveRef.current = handActive;
  }, [
    handActive,
    editModeOpen,
    armedSignatureId,
    armedStamp,
    onEditModeToggle,
    onCancelSignatureArm,
    onDisarmStamp,
  ]);

  // ---- Phase 13: grab-and-drag panning ------------------------------------
  // While hand mode is armed the scroller owns pointer presses: press
  // anywhere that is NOT interactive chrome (links, buttons, inputs —
  // isPanBlockingTarget bails first so their native click still lands),
  // capture the pointer, and invert the drag delta into scrollLeft /
  // scrollTop. preventDefault on the press keeps the text layer from
  // starting a selection mid-drag; it happens only AFTER the bail-out,
  // per the cross-bubbling contract (AGENTS.md).
  const onScrollerPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>): void => {
    if (!handActive || e.button !== 0) return;
    const scroller = scrollerRef.current;
    if (scroller === null) return;
    if (isPanBlockingTarget(e.target)) return;
    e.preventDefault();
    try {
      scroller.setPointerCapture(e.pointerId);
    } catch {
      // jsdom (and some odd drivers) have no pointer capture; panning
      // still works through the plain move/up handlers on the scroller.
    }
    panDragRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      scrollLeft: scroller.scrollLeft,
      scrollTop: scroller.scrollTop,
    };
    scroller.dataset.handDragging = "true";
  }, [handActive]);

  const onScrollerPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>): void => {
    const start = panDragRef.current;
    const scroller = scrollerRef.current;
    if (start === null || scroller === null) return;
    const next = panScrollPosition(start, e.clientX - start.clientX, e.clientY - start.clientY);
    scroller.scrollLeft = next.left;
    scroller.scrollTop = next.top;
  }, []);

  const onScrollerPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>): void => {
    if (panDragRef.current === null) return;
    panDragRef.current = null;
    const scroller = scrollerRef.current;
    if (scroller !== null) {
      delete scroller.dataset.handDragging;
      try {
        scroller.releasePointerCapture(e.pointerId);
      } catch {
        // The capture may already be gone (pointer left the window,
        // test harness without a real pointer). Nothing to restore.
      }
    }
  }, []);

  // ---- Phase 32 (chunk 2d): canvas page drag and drop ---------------------
  //
  // The rail path and this path share ONE document-aware drag model (the
  // PageDragContext). Here the drag SOURCE is a hover-revealed grip on the
  // page (`data-page-drag-handle`) - a dedicated affordance that never
  // collides with text selection or the annotation overlays - and the drop
  // TARGET is the whole page slot, with an insertion indicator between
  // pages (`data-drop-indicator`). Present only in Multi Mode: `pageDrag`
  // is null in single mode, so nothing here renders or fires.
  const drag = usePageDragOptional();
  const canvasDragOn = pageDrag !== null && drag !== null;
  const canvasTarget = canvasDragOn ? drag.target : null;
  // The hovered insertion slot in THIS document, or null when the drag is
  // not over this view.
  const canvasTargetHere =
    canvasDragOn && canvasTarget !== null && pageDrag !== null && canvasTarget.tabId === pageDrag.tabId
      ? canvasTarget
      : null;

  const onGripDragStart = (visiblePage: number) => (e: React.DragEvent<HTMLButtonElement>): void => {
    if (drag === null || pageDrag === null) return;
    e.dataTransfer.effectAllowed = 'copyMove';
    e.dataTransfer.setData('text/plain', String(visiblePage));
    drag.begin(buildDragSource(pageDrag.tabId, visiblePage, null));
  };
  const onGripDragEnd = (): void => {
    drag?.end();
  };
  const onCanvasDragOver = (visiblePage: number) => (e: React.DragEvent<HTMLDivElement>): void => {
    if (drag === null || pageDrag === null) return;
    if (drag.source === null) return;
    // The page slot is a drop target for any active drag (a same-document
    // drop resolves to the EXISTING reorder path; a cross-document drop to
    // the atomic engine call). preventDefault here only enables the drop -
    // it never swallows a pointer/click gesture.
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const after = canvasDropIsAfter(e.clientY, rect.top, rect.height);
    const mode = dropModeFromEvent(e);
    e.dataTransfer.dropEffect = dropEffectFor(mode);
    drag.hover({
      tabId: pageDrag.tabId,
      atIndex: canvasInsertIndex(visiblePage, pageCount, after),
      mode,
    });
  };
  const onCanvasDrop = (visiblePage: number) => (e: React.DragEvent<HTMLDivElement>): void => {
    if (drag === null || pageDrag === null) return;
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const after = canvasDropIsAfter(e.clientY, rect.top, rect.height);
    const op = resolveDrop(
      drag.source,
      {
        tabId: pageDrag.tabId,
        atIndex: canvasInsertIndex(visiblePage, pageCount, after),
      },
      dropModeFromEvent(e),
      pageCount,
    );
    drag.end();
    if (op !== null) pageDrag.onDrop(op);
  };
  const onCanvasDragLeave = (e: React.DragEvent<HTMLDivElement>): void => {
    if (drag === null) return;
    const related = e.relatedTarget as Node | null;
    const scroller = scrollerRef.current;
    if (related !== null && scroller !== null && scroller.contains(related)) return;
    drag.hover(null);
  };

  // ---- keyboard: Ctrl+F opens search, Escape closes / disarms -------------
  // Bug 4 — Escape disarms ANY armed annotation tool first, then closes
  // search. Previously Escape only closed the search bar, so an armed
  // sticky-note / ink / shape tool stayed hot after the user pressed
  // Escape (the next page click created unexpected content).
  // Phase 13 — Escape also exits hand (pan) mode, ahead of the
  // annotation tool check: hand mode is the outermost viewer mode and
  // its toolbar gate makes the annotation buttons inert, so Escape
  // must leave pan first.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === "Escape") {
        if (handActive) {
          e.preventDefault();
          setHandActive(false);
        } else if (annTool.tool !== "select") {
          e.preventDefault();
          dispatchAnnTool({ type: "set-tool", tool: "select" });
        } else if (searchOpen) {
          setSearchOpen(false);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [searchOpen, annTool.tool, handActive]);

  // ---- persistence + diagnostics ------------------------------------------------------------
  useEffect(() => {
    onPersist({
      zoomMode: zoom.mode,
      manualScale: zoom.manualScale,
      currentPage,
      searchOpen,
      query,
      activeHitIndex,
    });
  }, [zoom, currentPage, searchOpen, query, activeHitIndex, onPersist]);

  useEffect(() => {
    onDiagnostics({
      pageCount,
      currentPage,
      zoom: Math.round(effectiveScale * 100) / 100,
      mode: zoom.mode,
      searchQuery: query,
      searchHits: hits.length,
      searchIndexProgress,
      // DEF-093 — expose the annotation tool through the diagnostics
      // surface. `"select"` is the renderer's "no tool" sentinel; map
      // it to `null` so e2e harnesses see the same shape every other
      // field uses (value or null, never undefined).
      activeTool: annTool.tool === "select" ? null : annTool.tool,
    });
  }, [
    pageCount,
    currentPage,
    effectiveScale,
    zoom.mode,
    query,
    hits.length,
    searchIndexProgress,
    annTool.tool,
    onDiagnostics,
  ]);

  const pageJump = useCallback(
    (input: string) => {
      const n = Number.parseInt(input, 10);
      if (Number.isFinite(n) && n >= 1 && n <= pageCount) {
        jumpToPage(n);
      }
    },
    [jumpToPage, pageCount],
  );

  const railError = useCallback(
    (msg: string) => {
      onToast?.("error", msg);
    },
    [onToast],
  );

  // Phase 33 — the rail slot's content. Single mode keeps the unchanged
  // SideRail; Multi Mode renders this pane's OWN thumbnail strip, which the
  // workspace places at `railSide` (pane A right, pane B left) so the two
  // strips meet side by side in the middle of the workspace.
  const railNode = multiRail === null ? (
    <SideRail
      doc={doc}
      pageCount={pageCount}
      outline={outline}
      currentPage={currentPage}
      defaultWidthPt={firstPageSize?.w ?? 612}
      defaultHeightPt={firstPageSize?.h ?? 792}
      // DEF-148 — the per-VISIBLE-page sizes the mounted PageViews
      // report. The rail sizes each thumb wrap from ITS OWN page's
      // aspect ratio (never a single page-1-derived ratio), so a
      // per-page crop of page 1 no longer collapses pages 2..N into
      // the crop square.
      pageSizes={pageSizes}
      engineState={engineState}
      // DEF-139 — the thumb bitmap source must follow the same
      // slot -> proxy-page rule as the main view (visible order
      // when the proxy was rebuilt from getDocumentBytes).
      proxyVisibleOrder={proxyVisibleOrder}
      canUndo={canUndo}
      onOp={onRotate}
      onDelete={onDelete}
      onReorder={onReorder}
      onUndo={onUndo}
      onJump={(p): void => jumpToPage(p)}
      onError={railError}
      annotations={annotations}
      onEditAnnotation={onEditAnnotation}
      onDeleteAnnotation={onDeleteAnnotation}
      onJumpToAnnotation={onAnnJump}
      // Phase 16 — pages-panel collapsed state is App-owned
      // (persisted in settings); the rail only renders it and
      // reports toggles through the callback.
      pagesPanelCollapsed={pagesPanelCollapsed}
      onTogglePagesPanelCollapsed={onTogglePagesPanelCollapsed}
    />
  ) : (
    <PaneThumbStrip
      pane={multiRail.pane}
      tabId={multiRail.tabId}
      title={multiRail.title}
      documentCount={multiRail.documentCount}
      onFocusPane={multiRail.onFocusPane}
      crossDoc={{ tabId: multiRail.tabId, onDrop: multiRail.onDrop }}
      doc={doc}
      pageCount={pageCount}
      currentPage={currentPage}
      defaultWidthPt={firstPageSize?.w ?? 612}
      defaultHeightPt={firstPageSize?.h ?? 792}
      pageSizes={pageSizes}
      engineState={engineState}
      proxyVisibleOrder={proxyVisibleOrder}
      canUndo={canUndo}
      onOp={onRotate}
      onDelete={onDelete}
      onReorder={onReorder}
      onUndo={onUndo}
      onJump={(p): void => jumpToPage(p)}
    />
  );

  // ---- Phase 33 (chunk 4): the shared Multi Mode toolbar wiring ----------
  //
  // Values and commands live in refs so the controller registration is
  // stable (one per pane per mode session) while every read returns the
  // CURRENT state. In single mode `sharedTools` is null: no registration,
  // no effects, no change.
  const sharedValuesRef = useRef<PaneToolbarValues | null>(null);
  const sharedCommandsRef = useRef<PaneToolbarCommands | null>(null);
  sharedValuesRef.current = {
    page: currentPage,
    pageCount,
    pageLabel: resolvePageLabel(currentPage, engineState.pageLabels),
    zoomPercent: Math.round(effectiveScale * 100),
    zoomMode: zoom.mode,
    searchOpen,
    handActive,
  };
  sharedCommandsRef.current = {
    onJump: pageJump,
    onZoomIn: (): void => zoomTo(1),
    onZoomOut: (): void => zoomTo(-1),
    onFitWidth: (): void => setMode("fit-width"),
    onFitPage: (): void => setMode("fit-page"),
    onToggleSearch: (): void => setSearchOpen((v) => !v),
    onHandToggle: toggleHand,
  };

  useEffect((): (() => void) | undefined => {
    const shared = sharedTools;
    if (shared === null) return undefined;
    const offToolbar = shared.controller.registerToolbar(shared.pane, {
      values: (): PaneToolbarValues | null => sharedValuesRef.current,
      commands: (): PaneToolbarCommands | null => sharedCommandsRef.current,
    });
    const offSink = shared.controller.registerAnnSink(shared.pane, rawDispatchAnnTool);
    return (): void => {
      offToolbar();
      offSink();
    };
  }, [sharedTools, rawDispatchAnnTool]);

  // Publish this pane's armed annotation tool so the shared bar can show the
  // FOCUSED pane's state (both panes converge through the fan-out above).
  useEffect((): void => {
    const shared = sharedTools;
    if (shared === null) return;
    shared.controller.publishAnn(shared.pane, annTool);
  }, [sharedTools, annTool]);

  // The bar re-reads this pane's values on every value change.
  useEffect((): void => {
    const shared = sharedTools;
    if (shared === null) return;
    shared.controller.notifyToolbar();
  }, [sharedTools, currentPage, pageCount, effectiveScale, zoom.mode, searchOpen, handActive]);

  // Multi Mode suppresses this pane's own toolbar rows (the stage renders
  // the single shared bar instead).
  const suppressToolbar = sharedTools !== null;

  return (
    // Phase 25 — `data-text-panel-open` is now a PURE STATE MARKER (the
    // panel's open/close truth for tests and e2e); it no longer drives any
    // layout. The old --tf-text-w grid column and its page reflow are gone:
    // the panel floats inside .workspace-main, so the page never moves.
    <div
      className="workspace"
      data-text-panel-open={textPanelOpen ? "true" : "false"}
      data-rail={showRail ? undefined : "none"}
      // Phase 33 — the rail side. The rail node is placed BEFORE the page
      // area on the left (single mode, unchanged) and AFTER it on the right
      // (Multi Mode's pane A), so the DOM order matches the geometry.
      data-rail-side={showRail ? railSide : undefined}
    >
      {showRail && railSide === "left" ? railNode : null}
      <div ref={mainRef} className="workspace-main">
        {/* Phase 33 (chunk 4) — in Multi Mode the ONE toolbar lives in the
            stage (the shared bar); this pane suppresses its own rows so the
            workspace never shows two toolbars. */}
        {suppressToolbar ? null : (
        <Toolbar
          page={currentPage}
          pageCount={pageCount}
          pageLabel={resolvePageLabel(currentPage, engineState.pageLabels)}
          zoomPercent={Math.round(effectiveScale * 100)}
          zoomMode={zoom.mode}
          onJump={pageJump}
          onZoomIn={(): void => zoomTo(1)}
          onZoomOut={(): void => zoomTo(-1)}
          onFitWidth={(): void => setMode("fit-width")}
          onFitPage={(): void => setMode("fit-page")}
          searchOpen={searchOpen}
          onToggleSearch={(): void => setSearchOpen((v) => !v)}
          onMerge={(): void => onMerge?.()}
          onSplit={(): void => onSplit?.()}
          signToolActive={armedSignatureId !== null}
          onSignClick={(): void => {
            // The toolbar's Sign button toggles the modal at the App
            // level. We don't open the modal here; we just notify App so
            // it can decide to open the manager or clear the armed id.
            // The actual action lives on App (wires the modal open +
            // passes onApply). The toolbar's button click event is
            // synthesised below via window.dispatchEvent so App can
            // catch it cleanly.
            window.dispatchEvent(new CustomEvent("tflex:sign-button"));
          }}
          hasFormFields={formFields.length > 0}
          onFlattenClick={(): void => {
            window.dispatchEvent(new CustomEvent("tflex:flatten-button"));
          }}
          editModeOpen={editModeOpen}
          onEditModeToggle={onEditModeToggle}
          onOptimize={(): void => onOptimize?.()}
          onAuditSpace={(): void => onAuditSpace?.()}
          onRotateClockwise={onRotateClockwise}
          onRotateCounterClockwise={onRotateCounterClockwise}
          handActive={handActive}
          onHandToggle={toggleHand}
          onDeletePage={onDeletePage}
          canDeletePage={canDeletePage}
          // Phase 32 — the CommandBar's Multi Mode toggle. App owns the
          // mode; this view only forwards it (the same state drives the
          // All-tools entry, so both entry points always agree).
          multiModeEnabled={multiModeEnabled}
          onMultiModeToggle={onMultiModeToggle}
          /* Phase 19 — the annotation tools are the CommandBar's LAST
             capsule. The group element is built here (DocumentView is
             the prop conduit for the annotation state) and handed to
             the bar, which only places it. */
          annotationTools={
            <AnnotationToolbar
              state={annTool}
              onAction={onAnnToolAction}
              editModeOpen={editModeOpen}
              handModeOpen={handActive}
              palette={
                annotationPalette === undefined || annotationPalette === null
                  ? undefined
                  : {
                      light: annotationPalette.light ?? [],
                      dark: annotationPalette.dark ?? [],
                    }
              }
              onPaletteChange={
                onAnnotationPaletteChange === undefined
                  ? undefined
                  : (next): void => onAnnotationPaletteChange(next)
              }
              /* Phase-15 — frosted is a dark acrylic variant, so the
                 annotation palette treats it as the 'dark' preset bucket
                 (the shared AnnotationColors contract has no frosted key). */
              theme={themeName === 'light' ? 'light' : 'dark'}
              annotationRecentTools={annotationRecentTools}
              onAnnotationRecentToolsChange={onAnnotationRecentToolsChange}
              /* Phase 28 — the toolbar's dropdown colour drives the
                 ARMED tool only. It neither patches nor mirrors a
                 SELECTED annotation's colour: that colour is owned by
                 the in-canvas action bar's colour box. */
            />
          }
        />
        )}
        <AnimatePresence>
          {!suppressToolbar && editModeOpen && edit !== null && (
            <EditToolbar
              tool={edit.state.tool}
              onSelect={(t): void => edit.onAction({ type: "set-tool", tool: t })}
              defaultFont={edit.defaultFont}
              onDefaultFontChange={
                edit.onDefaultFontChange === undefined
                  ? (): void => undefined
                  : (f): void => edit.onDefaultFontChange?.(f)
              }
              enabled
              hint={editToolbarHint}
            />
          )}
        </AnimatePresence>
        <AnimatePresence>
          {searchOpen && (
            <SearchBar
              query={query}
              onQuery={setQuery}
              resultCount={hits.length}
              activeIndex={activeHitIndex}
              searching={searching}
              onNext={(): void => cycleHits(1)}
              onPrev={(): void => cycleHits(-1)}
              onClose={(): void => setSearchOpen(false)}
            />
          )}
        </AnimatePresence>
        <div
          ref={scrollerRef}
          className={handActive ? "document-scroller document-scroller-hand" : "document-scroller"}
          data-hand={handActive ? "true" : "false"}
          data-page-drop-pane={canvasTargetHere !== null ? "true" : undefined}
          onScroll={onScroll}
          onPointerDown={onScrollerPointerDown}
          onPointerMove={onScrollerPointerMove}
          onPointerUp={onScrollerPointerUp}
          onPointerCancel={onScrollerPointerUp}
          onDragLeave={canvasDragOn ? onCanvasDragLeave : undefined}
        >
          <div className="document-content">
            {Array.from({ length: pageCount }, (_, i) => i + 1).map((visiblePage) => {
              // DEF-064 — after a delete / reorder the visual scroller
              // used to keep its original `doc.numPages` slots while
              // the rail correctly shrank to `engineState.pageCount`,
              // so the scroller showed phantom slots for the deleted
              // page. `pageCount` is now derived from the engine state
              // (see App.tsx -> DocumentView), so the slot count
              // agrees with the rail. The slot still has to map the
              // visible page (the user-facing index) to the source
              // page the underlying pdf.js document is asked to load:
              // after deleting visible page 3, the new visible
              // position 3 is the original source page 4. Without
              // this translation, every PageView after a delete
              // would render the same source page and the document
              // would appear unchanged. `visibleToSourcePage` is
              // the pure helper that does the translation (tested
              // independently in pageGeometry.test.ts).
              //
              // DEF-139 — the translation must respect which proxy
              // family the tab currently holds. `engineState.pageOrder`
              // entries are pdf-lib ORIGINAL page indices; they address
              // the ORIGINAL open bytes (identity file order) but NOT a
              // proxy rebuilt from `getDocumentBytes`, whose file pages
              // are the engine's VISIBLE order. After such a refresh
              // (`proxyVisibleOrder === true`) the slot asks the proxy
              // for `visiblePage` itself; before it (or after a refresh
              // failure) it keeps the pageOrder translation.
              const sourcePage = visibleToSourcePageForProxy(
                visiblePage,
                engineState.pageOrder,
                proxyVisibleOrder,
              );
              // DEF-057 — read the engine-applied quarter-turn rotation
              // for this visible page slot and thread it down to the
              // PageView. The engine's `rotations` array is indexed by
              // VISIBLE position (the same order DocumentView's slots
              // enumerate), so we use the visible page number to look
              // it up. The PageView applies the rotation to pdf.js's
              // viewport so the bitmap is rendered at the rotated
              // orientation. Without this, rotate ops updated
              // `engineState.rotations` but the main view kept
              // rendering the un-rotated bitmap (the side rail's
              // thumb CSS class flipped, the main view did not).
              const pageRotation = engineState.rotations[visiblePage - 1] ?? 0;
              const isMounted = mountedPages.has(visiblePage);
              // DEF-141 — per-page slot geometry. Each slot reserves
              // space for ITS OWN page (mixed-size document): a crop of
              // page 1 must not shrink pages 2..N. `pageLayouts.geom`
              // holds the rotation-aware CSS dims; `pageLayouts.pt` the
              // un-rotated pt dims PageView uses for its wrapper.
              const slotGeom = pageLayouts.geom[visiblePage - 1];
              const pagePt = pageLayouts.pt[visiblePage - 1];
              return (
                <div
                  key={visiblePage}
                  ref={(el) => registerSlot(visiblePage, el)}
                  className="page-slot"
                  data-page={visiblePage}
                  data-source-page={sourcePage}
                  onDragOver={canvasDragOn ? onCanvasDragOver(visiblePage) : undefined}
                  onDrop={canvasDragOn ? onCanvasDrop(visiblePage) : undefined}
                  style={{
                    height:
                      slotGeom !== undefined && slotGeom.heightCss > 0
                        ? `${slotGeom.heightCss}px`
                        : 0,
                    width:
                      slotGeom !== undefined && slotGeom.widthCss > 0
                        ? `${slotGeom.widthCss}px`
                        : undefined,
                  }}
                >
                  {isMounted && (
                    <PageView
                      doc={doc}
                      // DEF-133 — thread BOTH page spaces into
                      // PageView. `page` is the VISIBLE index every
                      // overlay uses when it creates content
                      // (annotations / forms / signatures / stamps /
                      // text boxes all carry `page` in their
                      // engine payloads, and the engine interprets
                      // it against the CURRENT pageOrder). `sourcePage`
                      // is the index into the pdf.js proxy, which
                      // stays in SOURCE order after a delete /
                      // reorder / insert — only PageView's
                      // `doc.getPage(sourcePage)` render uses it.
                      page={visiblePage}
                      sourcePage={sourcePage}
                      widthPt={pagePt?.w ?? 612}
                      heightPt={pagePt?.h ?? 792}
                      cssScale={effectiveScale}
                      rotation={pageRotation}
                      shouldRender={true}
                      hits={hitsByPage.get(visiblePage) ?? EMPTY_HITS}
                      activeHit={activeHit?.page === visiblePage ? activeHit : null}
                      registerPage={NOOP_REGISTER}
                      onPageSize={onPageSize}
                      onActiveHitTop={onActiveHitTop}
                      annotations={annotationsByPage.get(visiblePage) ?? EMPTY_ANNOTATIONS}
                      annotationTool={annTool}
                      flashId={flashId}
                      liveAnnTextIds={liveAnnTextIds}
                      onCreateAnnotation={onAnnCreate}
                      onFinishedOneShot={onAnnFinishedOneShot}
                      // DEF-096 — committed note icons open their
                      // editor; Confirm/Delete route through these
                      // (same AnnotationPatch path as the panel).
                      onEditAnnotation={onEditAnnotation}
                      onDeleteAnnotation={onDeleteAnnotation}
                      // Phase 21 (annotations) — report the overlay's
                      // committed-annotation selection upward so the
                      // text-properties panel can reflect a selected
                      // annotation text object's actual colour.
                      onSelectAnnotation={onSelectAnnotation}
                      // Phase 26 — placing or clicking a text element
                      // focuses the panel's Text field (the single live
                      // text-editing surface; no in-canvas editor).
                      onTextFocusRequest={onAnnTextFocusRequest}
                      // Phase 28 — the selection bar's colour box reuses
                      // the toolbar's picker, so it needs the same
                      // preset bucket + saved custom presets.
                      annotationPaletteTheme={themeName === 'light' ? 'light' : 'dark'}
                      annotationPalette={
                        annotationPalette === undefined || annotationPalette === null
                          ? undefined
                          : {
                              light: annotationPalette.light ?? [],
                              dark: annotationPalette.dark ?? [],
                            }
                      }
                      onAnnotationPaletteChange={
                        onAnnotationPaletteChange === undefined
                          ? undefined
                          : (next): void => onAnnotationPaletteChange(next)
                      }
                      // Phase 28 — comment threads + the append op. The
                      // threads ride on the engine state mirror; the
                      // overlay draws one badge per commented element and
                      // the comment box for the selected annotation.
                      comments={engineState.comments}
                      onAddComment={onAddComment}
                      // Bug 1 — opening an edit toolbox disarms the
                      // annotation creation tool (select). Without
                      // this, an armed sticky-note / ink / shape
                      // tool stays hot while the toolbox is open,
                      // and the next page click both creates AND
                      // edits.
                      onDisarmAnnTool={onAnnFinishedOneShot}
                      onRenderStart={onPageRenderStart}
                      onRenderEnd={onPageRenderEnd}
                      formFields={formFieldsByPage.get(visiblePage) ?? EMPTY_FIELDS}
                      onFormValueChange={onFormValueChangeStable}
                      onFormListboxToggle={onFormListboxToggleStable}
                      signatures={signaturesByPage.get(visiblePage) ?? EMPTY_PLACEMENTS}
                      savedSignatures={savedSignatureMap}
                      armedSignatureId={armedSignatureId}
                      onPlaceSignature={onPlaceSignatureStable}
                      onMoveSignature={onMoveSignatureStable}
                      onDeleteSignature={onDeleteSignatureStable}
                      // B1 — exit Sign mode. Wired to the pending
                      // action bar's Cancel button (and to the
                      // overlay's Esc handler for a pending
                      // placement). Delete drops only the
                      // pending placement; Confirm commits and
                      // leaves the Sign tool armed for the next
                      // page click.
                      onCancelSignatureArm={onCancelSignatureArmStable}
                      // B10 — armed stamp ghost + click-to-embed.
                      // The stamp ghost follows the cursor on
                      // every page; clicking embeds the stamp at
                      // the click point.
                      armedStamp={armedStamp}
                      onPlaceStamp={onPlaceStamp}
                      stampAnnotations={stampAnnotations.filter(
                        (s) => s.page === visiblePage,
                      )}
                      // Bug 6 — stamp select/move/delete/retype
                      // handlers (the same page-level callbacks the
                      // user-facing stamp surfaces use).
                      onMoveStamp={onMoveStamp}
                      onDeleteStamp={onDeleteStamp}
                      onRetypeStamp={onRetypeStamp}
                      editModeOpen={editModeOpen}
                      edit={editProp}
                    />
                  )}
                  {canvasDragOn && isMounted && (
                    <button
                      type="button"
                      className="page-drag-handle"
                      data-page-drag-handle={visiblePage}
                      draggable
                      onDragStart={onGripDragStart(visiblePage)}
                      onDragEnd={onGripDragEnd}
                      aria-label={`Drag page ${visiblePage} to another document`}
                      title="Drag this page to another document (Ctrl to copy)"
                    >
                      <GripVertical size={14} aria-hidden />
                    </button>
                  )}
                  {canvasTargetHere !== null && canvasTargetHere.atIndex === visiblePage && (
                    <div
                      className="page-drop-indicator page-drop-indicator-before"
                      data-drop-indicator="before"
                      data-drop-page={visiblePage}
                      data-drop-copy={canvasTargetHere.mode === "copy" ? "true" : undefined}
                    >
                      {canvasTargetHere.mode === "copy" && (
                        <span className="page-drop-copy-hint">Copy</span>
                      )}
                    </div>
                  )}
                  {canvasTargetHere !== null &&
                    (canvasTargetHere.atIndex === visiblePage + 1 ||
                      (canvasTargetHere.atIndex === -1 && visiblePage === pageCount)) && (
                      <div
                        className="page-drop-indicator page-drop-indicator-after"
                        data-drop-indicator="after"
                        data-drop-page={visiblePage}
                        data-drop-copy={canvasTargetHere.mode === "copy" ? "true" : undefined}
                      >
                        {canvasTargetHere.mode === "copy" && (
                          <span className="page-drop-copy-hint">Copy</span>
                        )}
                      </div>
                    )}
                </div>
              );
            })}
          </div>
        </div>
        {/* Tools palette badge — the arrow-shaped tab on the page
            view's right edge (moved out of the command bar). The
            Tools palette is conditionally mounted (AnimatePresence),
            so the badge is a SEPARATE element that tracks it via
            CSS: a `position: fixed` arrow tab pinned to the window's
            right edge while closed, whose `right` property
            transitions to the open panel's width (--tools-panel-w,
            the same token the page-view inset consumes) on the same
            150ms curve — badge, panel and page move together. The
            chevron glyph flips with the state (ChevronLeft closed,
            ChevronRight open) via the icon swap itself. Kept below modal
            sheets in styles.css. data-tools-toggle is kept alongside
            data-tools-badge so the long-standing e2e selector still
            resolves on the moved control. */}
        {onToolsPaletteToggle !== undefined && (
          <button
            type="button"
            className={`tools-badge-tracker ${toolsPaletteOpen ? "tools-badge-tracker-open" : ""}`}
            onClick={onToolsPaletteToggle}
            aria-pressed={toolsPaletteOpen}
            aria-label={toolsPaletteOpen ? "Close tools palette" : "Open tools palette"}
            title={
              toolsPaletteOpen
                ? "Close tools palette (Ctrl+Shift+P)"
                : "Open tools palette (Ctrl+Shift+P)"
            }
            data-tools-badge
            data-tools-toggle
          >
            <span className="tools-badge-chevron" aria-hidden="true">
              {toolsPaletteOpen ? (
                <ChevronRight size={12} aria-hidden />
              ) : (
                <ChevronLeft size={12} aria-hidden />
              )}
            </span>
            <span className="tools-badge-label">All Tools</span>
          </button>
        )}
        {/* Phase 25 — the text-properties panel is a FLOATING card over
            the page view (absolutely positioned inside .workspace-main),
            NOT a workspace grid column. It has no header, is draggable by
            its grip, and opening/closing it never reflows the page. */}
        <TextPropertiesPanel
          open={textPanelOpen}
          values={textPanelValues}
          defaults={textPanelDefaults}
          mode={textPanelMode}
          onPatch={handleTextPanelPatch}
          text={panelText}
          onTextChange={handlePanelTextChange}
          onTextCommit={commitTextSession}
          focusToken={textFocusToken}
        />
      </div>
      {/* Phase 33 — the rail's RIGHT-side slot (Multi Mode's pane A): the
          strip sits immediately after the page area, so A's strip and B's
          (on the left of its own page area) meet in the middle. */}
      {showRail && railSide === "right" ? railNode : null}
    </div>
  );
});

// Stable no-op for PageView's `registerPage` prop. With virtualization, slot
// mounting is driven by DocumentView's own IntersectionObserver; PageView no
// longer needs to register itself with the parent.
const NOOP_REGISTER = (): void => undefined;

// Stable empty annotations array — passed to PageView when a page has no
// annotations, so the prop's reference doesn't change between renders.
const EMPTY_ANNOTATIONS: Annotation[] = [];

// ---- Phase 26 — the panel Text field's target model -----------------------
/** A text target reported up by the Edit overlay (Phase 26 — the inline
 *  editor is retired, so Edit-mode text is edited in the panel's Text
 *  field). */
export type EditTextTarget =
  | { kind: "box"; id: string; isNew?: boolean }
  | {
      kind: "run";
      page: number;
      rect: { x: number; y: number; width: number; height: number };
      text: string;
    };

/** Everything the panel's Text field can edit. */
type TextTarget = EditTextTarget | { kind: "annotation"; id: string };

/** Stable identity for a text target — used to tell "same target, next
 *  keystroke" (same session) from "new target" (commit the old session). */
function textTargetKey(t: TextTarget | null): string | null {
  if (t === null) return null;
  if (t.kind === "run") {
    return `run:${t.page}:${t.rect.x}:${t.rect.y}:${t.rect.width}:${t.rect.height}`;
  }
  return `${t.kind}:${t.id}`;
}
const EMPTY_FIELDS: FormField[] = [];
const EMPTY_PLACEMENTS: SignaturePlacement[] = [];
