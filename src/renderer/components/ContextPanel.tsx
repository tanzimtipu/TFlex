// Phase 36 (chunk 2 + chunk 6) — the STAGES ContextPanel.
//
// The STAGES information architecture replaces the rail's tab strip with one
// stage-owned panel per stage. Chunk 2 built the PAGES panel behind a dev flag;
// chunk 6 adds the other three stages and PROMOTES the panel to the real left
// slot (single mode), retiring the flag.
//
// RE-PARENTING (not reimplementation):
//   - ThumbnailRail (SideRail.tsx) owns the live-rendered previews, the
//     buffered-slot virtualization, the offscreen atomic swap (DEF-222/274),
//     the drag-reorder/drop indicators, the current-page highlight, the
//     scroll sync and the selection action bar. The panel only supplies the
//     same props the rail supplies, plus two OPTIONAL additions (the hover
//     verbs and the right-click hook) that render only when provided.
//   - OutlinePanel (SideRail.tsx) is the same tree, re-parented below the
//     thumbnails in a collapsible section.
//   - OcrSuspectsPanel / TextPropertiesPanel / AnnotationsPanel are NOT
//     re-implemented here. The EDIT panel shows the recognition SUMMARY and
//     the EXISTING batch-OCR entry; the annotations LIST has exactly ONE home
//     (the Inspector's REVIEW document view) and this panel shows only a
//     read-only reference to it (see the REVIEW section note).
//
// The panel owns exactly one piece of state of its own: which page's
// right-click menu is open and where, plus the outline section's own collapse
// toggle. Page state, selection, edit state, signatures and engine ops all
// belong to the host (DocumentView/App) and are threaded through.

import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  ReactElement,
} from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  FileWarning,
  Images,
  Lock,
  MoreHorizontal,
  MousePointerClick,
  PanelLeftClose,
  PanelRightOpen,
  ScanText,
  TextCursor,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Icon } from '../icons/Icon';
import type { QuietIconId } from '../icons/quietPrecision';
import { Button, IconButton } from './Button';
import { CommandMenu } from './CommandMenu';
import type { CommandMenuGroup, CommandMenuItem } from './CommandMenu';
import { clampMenuPosition } from './pageThumbMenu';
import { EmptyState } from './EmptyState';
import { OutlinePanel, OutlineEditorContext, RulerStrip, ThumbnailRail } from './SideRail';
import type { OutlineEditorConfig, RailTab, ThumbVerbs } from './SideRail';
import { usePageThumbMenu } from './pageThumbMenu';
import { GlassSidebarBody } from './GlassSidebar';
import { ActionList, PanelEmptyState, PanelSection, PanelShell, PropertyRow, ScopedHeader } from './panels/PanelPrimitives';
import { ReviewElementsPanel } from './ReviewElementsPanel';
import type { ReviewElementRef } from './ReviewElementsPanel';
import type { Annotation, AnnotationPatch } from '../annotations/model';
import { buildPageLabelMap } from './pageGeometry';
import { formatBytes } from '../utils/formatBytes';
import { protectionSummary } from '../security/protection';
import type { EngineState } from '../engine/types';
import type { OutlineNode } from '../pdf/pdfjs';
import type { PageDropOp } from '../state/pageDrag';
import { STAGE_LABELS, type Stage } from '../state/stages';
import { EDIT_DEFAULT_FONTS } from '../state/preferences';
import { EXPORT_FIDELITY_NOTES, type ExportFormat } from '../../shared/export';
import { countOutline } from '../../shared/outline';
import type { OutlineEntry } from '../../shared/outline';
import type {
  BatesInfo,
  DocumentProtectionState,
  EditFont,
  SavedSignature,
  SignaturePlacement,
  WatermarkInfo,
} from '../../shared/types';

/** Shape a pdf.js outline tree into the shared `OutlineEntry` shape purely for
 *  counting. The pdf.js nodes carry a `dest` instead of a resolved `page`, so
 *  this adapter maps only the fields `countOutline` reads (title + children);
 *  no destination is invented or resolved here. */
function outlineCountEntries(nodes: readonly OutlineNode[]): OutlineEntry[] {
  return nodes.map((node) => ({
    title: node.title,
    page: null,
    children: outlineCountEntries(node.children),
  }));
}

/** A single item in the EDIT stage's content outline: the text boxes and
 *  image placements the app already models for the CURRENT page. Built by the
 *  host from the edit model — the panel never reads the model itself. */
export interface ContextPanelEditContent {
  id: string;
  kind: 'text' | 'image';
  label: string;
  /** 1-based visible page the object lives on. */
  page: number;
  selected: boolean;
}

/** Phase 112 (C3) — the EDIT content navigator's state vocabulary. PURE, so
 *  the panel's diagnostic contract is pinned without mounting. `ready` is the
 *  only state that lists objects; every other state is a designed empty state
 *  and must never fabricate content the engine did not report. */
export type EditContentState =
  | 'ready'
  | 'no-selection'
  | 'no-content'
  | 'unsupported'
  | 'restricted';

/** Resolve the EDIT content state from the host's data. Precedence is
 *  deliberate: an explicit restriction/unsupported flag wins, then "no edit
 *  session data" reads as no-selection, then an empty page reads as no-content.
 *  A page with visible text is NOT claimed blank/scanned here — that verdict
 *  needs engine data the navigator does not carry. */
export function editContentState(args: {
  editContent: readonly ContextPanelEditContent[] | null | undefined;
  pageItemCount: number;
  unsupported?: boolean;
  restricted?: boolean;
}): EditContentState {
  if (args.restricted === true) return 'restricted';
  if (args.unsupported === true) return 'unsupported';
  if (args.editContent === null || args.editContent === undefined) return 'no-selection';
  return args.pageItemCount === 0 ? 'no-content' : 'ready';
}

/** The designed empty state for each non-ready EDIT content state. Copy is
 *  truthful: it never claims a page is blank/scanned without engine data. */
const EDIT_CONTENT_EMPTY: Record<
  Exclude<EditContentState, 'ready'>,
  { icon: LucideIcon; headline: string; help: string }
> = {
  'no-selection': {
    icon: MousePointerClick,
    headline: 'No selection',
    help: 'Select a page or an object to edit.',
  },
  'no-content': {
    icon: TextCursor,
    headline: 'No editable content detected',
    help: 'This page has no text or image objects to edit.',
  },
  unsupported: {
    icon: FileWarning,
    headline: 'Unsupported editing',
    help: 'This document cannot be edited.',
  },
  restricted: {
    icon: Lock,
    headline: 'Permission restricted',
    help: "This document's permissions do not allow editing.",
  },
};

export interface ContextPanelProps {
  /** The stage this panel belongs to. Defaults to PAGES so every pre-chunk-6
   *  mount (and the document-less harnesses) keep today's behaviour. */
  stage?: Stage;

  doc: PDFDocumentProxy;
  /** The 1-based VISIBLE page the canvas is showing (scroll sync). The LIVE
   *  page count comes from `engineState.pageCount` — one source of truth, so
   *  the header's `Pages · N` can never drift from the thumbnails. */
  currentPage: number;
  defaultWidthPt: number;
  defaultHeightPt: number;
  /** DEF-148 — per-visible-page sizes reported by the mounted PageViews. */
  pageSizes?: Map<number, { w: number; h: number }> | null;
  /** Live engine state: pageCount, pageOrder (reorder), rotations,
   *  deleted, pageLabels. The panel and the rail read the SAME object. */
  engineState: EngineState;
  /** DEF-139 — the proxy is in visible file order after a bytes refresh. */
  proxyVisibleOrder?: boolean;
  canUndo: boolean;
  /** The rail's engine callbacks: the panel adds no op of its own. */
  onOp?: (op: { kind: 'rotate'; page: number; dir: 'cw' | 'ccw' }) => void;
  onDelete?: (pages: number[]) => void;
  onReorder?: (fromIndex: number, toIndex: number) => void;
  onUndo?: () => void;
  onJump: (page: number) => void;
  /** TFL-1116 R04 — the document-scoped committed-navigation counter the host
   *  bumps on every jump; the panel forwards it to the pages navigator so a
   *  ViewStrip / Next / external jump reveals the viewed thumb. */
  revealSeq?: number;
  outline: OutlineNode[] | null;
  onError?: (message: string) => void;
  /** Phase 85 — the editable outline configuration (doc id, seeded entries,
   *  visible page count, commit). Normally published through
   *  `OutlineEditorContext` by App; an explicit value lets a harness (or a
   *  future direct mount) supply it without a provider. `null` keeps the
   *  outline view-only. */
  outlineEditor?: OutlineEditorConfig | null;
  /** Header — the EXISTING merge entry (the CommandBar's handler). */
  onMerge?: () => void;
  /** Right-click menu verbs — the host's EXISTING surfaces for each. Each
   *  receives the VISIBLE 1-based page the gesture landed on. */
  onExtractPages?: (page: number) => void;
  /** "Insert blank after" — an IMMEDIATE action: the host inserts a blank
   *  page directly after the clicked visible page (engine `insertBlankPage`
   *  with afterIndex = page - 1). No dialog. */
onInsertBlank?: (page: number) => void;
  onReplacePages?: (page: number) => void;
  /** Section 3A ruling 2: Renumber is NOT a thumbnail-menu verb. The
   *  Inspector's `Label · renumber…` is its ONLY affordance, so this panel
   *  exposes no renumber handler. */
  /** "Delete…" — the ellipsis promises a dialog, so this opens the host's
   *  EXISTING delete-pages dialog seeded with the clicked page. The thumbnail
   *  hover trash verb is a DIFFERENT path: it stays an immediate per-page
   *  delete through `onDelete([page])`. */
  onDeletePage?: (page: number) => void;
  /** Phase 87 (FEA-039) — opens the Remove blank pages scan dialog. The
   *  control only renders when the host wires it. */
  onRemoveBlankPages?: () => void;
  /** Phase 32's cross-document drag wiring, threaded exactly as the Multi
   *  Mode strips thread it. `null` in single mode, where ThumbnailRail keeps
   *  its pre-Phase-32 intra-document drag semantics byte-for-byte. */
  crossDoc?: { tabId: string; onDrop: (op: PageDropOp) => void } | null;
  /** Phase 36 (chunk 3a) — the thumbnail MULTI-SELECT, threaded straight to
   *  the re-parented ThumbnailRail. The SET is host-owned (DocumentView). */
  pageSelection?: readonly number[] | null;
  onPageSelectionChange?: ((pages: number[]) => void) | null;

  // --- Header collapse (the rail's collapse affordance, re-homed) --------
  /** Phase 16 — true while the panel is collapsed to the ruler strip. The
   *  host (App) owns the value; the panel only renders it. */
  collapsed?: boolean;
  /** Phase 16 — asks the host to toggle the collapsed state. */
  onToggleCollapsed?: () => void;
  /** TFL-1116 C11 (R16) — render as the compact OVERLAY drawer instead of the
   *  docked panel. Below the panel threshold the panel cannot reserve a grid
   *  column, so the compact stage launcher opens the ACTIVE stage's context as
   *  an overlay drawer. Pages keeps its page-number ruler; Edit/Review/Deliver
   *  open their stage content here. */
  drawer?: boolean;
  /** TFL-1116 C11 (R16) — closes the compact drawer (Escape / the close
   *  control). The host owns the drawer intent; this only reports the close. */
  onClose?: () => void;

  // --- Host-owned rail tab (Phase 59 item 7 follow-up; Phase 111 chunk A) --
  /** The host's active rail tab (App's `railTab`). The PAGES body lives in
   *  this panel, so the "Page thumbnails" / "Bookmarks" palette commands land
   *  here: `'outline'` selects the full-height Outline view, anything else
   *  (`'thumbs'`, `'annotations'` or undefined) shows the Pages view. Absent =
   *  the Pages view (the default), so every pre-existing caller is unchanged. */
  railTab?: RailTab;
  /** Phase 111 (chunk A) — the view selector reports here, so the panel's own
   *  tabs and the palette commands write the SAME host state and can never
   *  disagree. `'thumbs'` selects Pages, `'outline'` selects Outline. */
  onRailTabChange?: (tab: RailTab) => void;

  // --- Split Navigator (Phase 111 chunk D1) -----------------------------
  /** The host-owned navigator layout. `'stacked'` (default) keeps the
   *  full-height tabbed view; `'split'` stacks Pages above Outline when the
   *  panel is tall enough, else it falls back to `'stacked'`. */
  navigatorLayout?: 'stacked' | 'split';
  /** The host-owned Pages share of the split body (initial 0.6). Clamped to
   *  0.1-0.9; a non-finite value resolves to 0.6. */
  navigatorSplitRatio?: number;
  /** Report a new layout choice from the panel More menu. */
  onNavigatorLayoutChange?: (layout: 'stacked' | 'split') => void;
  /** Report the settled split ratio (pointer release / keyboard step); the host
   *  persists it. Live drag frames are held locally, never reported here. */
  onNavigatorSplitRatioChange?: (ratio: number) => void;

  // --- EDIT -------------------------------------------------------------
  /** The current page's modelled text boxes + image placements (built by the
   *  host from the edit model). `null`/absent renders the empty state. */
  editContent?: readonly ContextPanelEditContent[] | null;
  /** Select one edit object (the host's existing edit-model selection). */
  onSelectEditContent?: ((id: string, kind: 'text' | 'image') => void) | null;
  /** The OCR status line for the active document ("Recognized" / null). */
  ocrStatus?: string | null;
  /** True once at least one OCR run has completed on the active doc. */
  ocrHasRun?: boolean;
  /** The low-confidence suspect count from the last run (0 when none). */
  ocrSuspectCount?: number;
  /** The EXISTING batch-OCR entry (App's `onOcrClick`). */
  onRecognizeText?: () => void;
  /** The EXISTING suspects-panel entry (App's own gated open handler). */
  onOpenOcrSuspects?: () => void;
  /** Phase 41 (item 2) — the DEFAULT FONT for new / replaced text, the one
   *  control the retired edit toolbar still owned. Its home is now this EDIT
   *  panel (the palette's own refusal copy already points here: "Pick the font
   *  in the Edit panel"). The host threads the existing edit-session values. */
  editDefaultFont?: EditFont;
  onEditDefaultFontChange?: ((font: EditFont) => void) | null;
  /** Phase 112 (C3) — the host's edit-availability flags for the CONTENT
   *  navigator. Both default false so the panel never fabricates a
   *  restricted/unsupported state without engine data; when true they replace
   *  the content list with the matching diagnostic PanelEmptyState. */
  editUnsupported?: boolean;
  editPermissionRestricted?: boolean;

  // --- REVIEW -----------------------------------------------------------
  /** The active document's annotations. The REVIEW body re-parents the SAME
   *  AnnotationsPanel the rail's annotations tab rendered — exactly ONE home
   *  for the list (the Inspector shows only a reference to it). */
  annotations?: readonly Annotation[];
  /** Jump to (and flash) an annotation (the host's existing handler). */
  onJumpToAnnotation?: ((page: number, id: string) => void) | null;
  onEditAnnotation?: ((id: string, patch: AnnotationPatch) => void) | null;
  onDeleteAnnotation?: ((id: string) => void) | null;
  /** Phase 90 (TFL-509-C1) — the unified review list's non-annotation sources
   *  and handlers. The annotation fields above feed its Annotations category;
   *  `signatures` is the PLACED-signature list (`EngineState.signatures`). */
  bates?: readonly BatesInfo[];
  watermarks?: readonly WatermarkInfo[];
  signatures?: readonly SignaturePlacement[];
  onSelectReviewElement?: ((el: ReviewElementRef) => void) | null;
  onEditReviewElement?: ((el: ReviewElementRef) => void) | null;
  onDeleteReviewElement?: ((el: ReviewElementRef) => void) | null;
  reviewErrorFor?: ((el: ReviewElementRef) => string | null) | null;
  /** The saved signatures mirror (App state). */
  savedSignatures?: readonly SavedSignature[];
  /** The currently armed signature id, if any (App state). */
  armedSignatureId?: string | null;
  /** Arm a saved signature for placement (the EXISTING manager-apply path). */
  onSignSignature?: ((signatureId: string) => void) | null;
  /** Open the EXISTING signature manager modal. */
  onManageSignatures?: (() => void) | null;

  // --- DELIVER ----------------------------------------------------------
  /** The active document's file size in bytes. */
  fileSize?: number | null;
  /** The active document's form-field count (0 = none or already flattened;
   *  the app has no separate "flattened" flag — see the pre-flight note). */
  formFieldCount?: number;
  /** Phase 112 (C5) — the document's REAL encryption state, when the host has
   *  read it. Null/undefined renders the distinct "Not analysed" observation
   *  (never a fabricated "unencrypted"). */
  protection?: DocumentProtectionState | null;
  /** Phase 112 (C5) — the office format whose mandatory fidelity limits the
   *  output checks should surface, when a format is being prepared. Null shows
   *  the distinct "Not analysed" observation. */
  exportFidelityFormat?: ExportFormat | null;
  /** The EXISTING Optimize entry (the document-size disclosure's action). */
  onOptimize?: () => void;
  /** The EXISTING "create from images" dialog entry. */
  onCreateFromImages?: (() => void) | null;
}

// Phase 37 (chunk 5, item 19) — the menu machinery has ONE home now: the
// shared `pageThumbMenu` module, which the Multi Mode strips re-parent. The
// historical named exports stay on this module so the pre-chunk-5 tests and
// callers keep resolving unchanged.
export { buildPageMenuItems, clampMenuPosition } from './pageThumbMenu';
export type { PageMenuHandlers, PageMenuItem } from './pageThumbMenu';

/** TFL-1116 C11 (R16) — the compact stage launcher's glyph per non-pages
 *  stage. Pages keeps the page-number ruler; Edit/Review/Deliver open their
 *  stage context instead. */
const CONTEXT_STAGE_ICONS: Record<Exclude<Stage, 'pages'>, QuietIconId> = {
  edit: 'stageEdit',
  review: 'stageReview',
  deliver: 'stageDeliver',
};

/** The header title per stage. Phase 37 (item 15) REMOVED the PAGES title:
 *  the panel header is now just the Combine entry + the collapse control,
 *  which is why the panel narrowed (see --tf-rail-w). The other stages keep
 *  their single-word titles. */
export function contextPanelTitle(stage: Stage, _pageCount: number): string {
  switch (stage) {
    case 'pages':
      return '';
    case 'edit':
      return 'Edit';
    case 'review':
      return 'Review';
    case 'deliver':
      return 'Deliver';
  }
}

/** Phase 112 (TFL-854 C2) — the thumbnail selection's range label. A
 *  contiguous run reads "Pages 2-4"; a sparse set lists its pages. Pure so
 *  the summary text is pinned by tests. */
export function pageRangeText(pages: readonly number[]): string {
  if (pages.length === 0) return 'No pages';
  let contiguous = true;
  for (let i = 1; i < pages.length; i += 1) {
    if (pages[i] !== pages[i - 1] + 1) {
      contiguous = false;
      break;
    }
  }
  if (contiguous) {
    const first = pages[0];
    const last = pages[pages.length - 1];
    return first === last ? `Page ${first}` : `Pages ${first}-${last}`;
  }
  return `Pages ${pages.join(', ')}`;
}

/* ---------------------------------------------------------------------------
 * Phase 111 (chunk D1) — the Split Navigator's pure layout contract.
 *
 * The navigator can render Pages above Outline with a resizable horizontal
 * separator and independent scroll regions, or fall back to the full-height
 * tabbed view. These helpers are exported so the contract can be pinned without
 * a DOM (mirroring `PanelResizeHandle`'s `panelWidthAfterKey` / `clampPanelWidth`).
 * ------------------------------------------------------------------------- */

/** The smallest an expanded section may become before the split layout gives up
 *  and falls back to the tabbed view (design-decisions.md line 53). */
export const NAVIGATOR_MIN_SECTION_PX = 180;
/** The divider's own height, reserved when deciding whether the split fits. */
export const NAVIGATOR_SPLIT_DIVIDER_PX = 12;
/** The default Pages share of the navigator body (initial 60 / 40). */
export const NAVIGATOR_SPLIT_RATIO_DEFAULT = 0.6;
/** The persisted ratio band (mirrors NAVIGATOR_SPLIT_RATIO_MIN/MAX in settings). */
export const NAVIGATOR_SPLIT_RATIO_MIN = 0.1;
export const NAVIGATOR_SPLIT_RATIO_MAX = 0.9;

/** Clamp the persisted split ratio into 0.1-0.9; a non-finite value falls back
 *  to the documented 0.6 default rather than an out-of-band number. */
export function clampSplitRatio(value: number): number {
  if (!Number.isFinite(value)) return NAVIGATOR_SPLIT_RATIO_DEFAULT;
  return Math.min(NAVIGATOR_SPLIT_RATIO_MAX, Math.max(NAVIGATOR_SPLIT_RATIO_MIN, value));
}

/** Resolve the effective navigator layout for a measured body height. `'stacked'`
 *  is always `'stacked'`; `'split'` survives only when both sections plus the
 *  divider fit, else it falls back to the full-height tabbed view. */
export function resolveNavigatorLayout(
  layout: 'stacked' | 'split',
  bodyHeightPx: number,
  minSectionPx: number = NAVIGATOR_MIN_SECTION_PX,
): 'stacked' | 'split' {
  if (layout !== 'split') return 'stacked';
  if (!Number.isFinite(bodyHeightPx)) return 'stacked';
  return bodyHeightPx >= 2 * minSectionPx + NAVIGATOR_SPLIT_DIVIDER_PX ? 'split' : 'stacked';
}

/** The ratio a keyboard key produces on the split separator, or `null` when the
 *  key is not a resize control. ArrowUp grows the Pages share, ArrowDown shrinks
 *  it, Home / End jump to the bounds; every result is clamped. */
export function splitRatioAfterKey(
  current: number,
  key: string,
  step: number = 0.05,
): number | null {
  // Round the step result so `0.6 - 0.05` lands on the exact 0.55 a keyboard
  // user (and the pinned spec) expects, not 0.5499999999999999.
  const round = (value: number): number => Math.round(value * 1e6) / 1e6;
  switch (key) {
    case 'ArrowUp':
      return clampSplitRatio(round(current + step));
    case 'ArrowDown':
      return clampSplitRatio(round(current - step));
    case 'Home':
      return NAVIGATOR_SPLIT_RATIO_MIN;
    case 'End':
      return NAVIGATOR_SPLIT_RATIO_MAX;
    default:
      return null;
  }
}

/**
 * The STAGES left panel. One component, four stage bodies:
 *   PAGES   — the header's Combine entry, the SAME live thumbnail stack the
 *             rail renders, then the collapsible outline section.
 *   EDIT    — the current page's modelled content outline + the Recognition
 *             section (OCR status, the suspects count, the batch entry).
 *   REVIEW  — the saved-signatures section (arm / manage) + a read-only
 *             annotations reference (the list itself is the Inspector's).
 *   DELIVER — the pre-flight checklist (OCR / file size + optimize / forms)
 *             + the "New document: From images…" entry.
 * All document state is owned by the host; this component only routes it.
 */
export function ContextPanel(props: ContextPanelProps): ReactElement {
  const {
    stage = 'pages',
    doc,
    currentPage,
    defaultWidthPt,
    defaultHeightPt,
    pageSizes = null,
    engineState,
    proxyVisibleOrder = false,
    canUndo,
    onOp,
    onDelete,
    onReorder,
    onUndo,
    onJump,
    revealSeq = 0,
    outline,
    onError,
    outlineEditor = null,
    onMerge,
    onExtractPages,
onInsertBlank,
    onReplacePages,
    onDeletePage,
    onRemoveBlankPages,
    crossDoc = null,
    pageSelection = null,
    onPageSelectionChange = null,
    collapsed = false,
    onToggleCollapsed,
    drawer = false,
    onClose,
    railTab,
    onRailTabChange,
    navigatorLayout = 'stacked',
    navigatorSplitRatio = NAVIGATOR_SPLIT_RATIO_DEFAULT,
    onNavigatorLayoutChange,
    onNavigatorSplitRatioChange,
    editContent = null,
    onSelectEditContent = null,
    ocrStatus = null,
    ocrHasRun = false,
    ocrSuspectCount = 0,
    onRecognizeText,
    onOpenOcrSuspects,
    editDefaultFont,
    onEditDefaultFontChange = null,
    editUnsupported = false,
    editPermissionRestricted = false,
    annotations = [],
    onJumpToAnnotation = null,
    onEditAnnotation = null,
    onDeleteAnnotation = null,
    bates = [],
    watermarks = [],
    signatures = [],
    onSelectReviewElement = null,
    onEditReviewElement = null,
    onDeleteReviewElement = null,
    reviewErrorFor = null,
    fileSize = null,
    formFieldCount = 0,
    protection = null,
    exportFidelityFormat = null,
    onOptimize,
    onCreateFromImages = null,
  } = props;

const pageCount = engineState.pageCount;

  // R16 — Escape closes the compact drawer. Bound only while it is the open
  // surface (the host passes `onClose` only then), so the wide panel keeps its
  // existing keyboard behaviour unchanged.
  useEffect((): (() => void) | undefined => {
    if (!drawer || onClose === undefined) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return (): void => window.removeEventListener('keydown', onKey);
  }, [drawer, onClose]);

  // AR-02 (TFL-1184) — the compact drawer's opener (the collapse control) and a
  // record of the previous drawer state so a close returns focus to it. Mirrors
  // Inspector's TFL-1117 (R01) pattern: the ref re-attaches to the control when
  // the collapsed strip remounts after the drawer closes, and the effect then
  // moves focus back to that fresh node (Escape and the close control both route
  // through the host's `onClose`).
  const collapseOpenerRef = useRef<HTMLButtonElement | null>(null);
  const drawerWasOpenRef = useRef(false);
  useEffect((): void => {
    const wasOpen = drawerWasOpenRef.current;
    drawerWasOpenRef.current = drawer;
    if (wasOpen && !drawer && collapsed) {
      const opener = collapseOpenerRef.current;
      if (opener !== null && document.contains(opener)) opener.focus();
    }
  }, [drawer, collapsed]);

  // Phase 85 — an explicit `outlineEditor` prop wins, else the config App
  // publishes through the context. Null keeps the outline view-only.
  const contextOutlineEditor = useContext(OutlineEditorContext);
  const effectiveOutlineEditor = outlineEditor ?? contextOutlineEditor;

  // Phase 111 (chunk A) — the host's `railTab` selects the navigator VIEW.
  // `'outline'` shows the full-height Outline view; anything else ('thumbs',
  // 'annotations' or undefined) shows the Pages view. The two tabs are a real
  // tablist: the panel never holds view state of its own, it only reports the
  // chosen tab back through `onRailTabChange`.
  const outlineView = railTab === 'outline';
  const outlineCount = countOutline(outlineCountEntries(outline ?? []));

  const selectView = (tab: RailTab): void => {
    onRailTabChange?.(tab);
  };

  // Roving tabindex + Left/Right between the two tabs (ARIA tabs pattern): the
  // arrow moves focus AND selects, so a single press switches the view.
  const onViewTabsKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const next: RailTab = outlineView ? 'thumbs' : 'outline';
    selectView(next);
    const dataTab = next === 'outline' ? 'outline' : 'pages';
    event.currentTarget
      .querySelector<HTMLButtonElement>(`[data-context-panel-view-tab="${dataTab}"]`)
      ?.focus();
  };

  // The same visible -> source mapping and label map the rail builds, so a
  // reordered or renumbered document renders identically here.
  const visibleToSource = useMemo((): Map<number, number> => {
    const m = new Map<number, number>();
    const order = engineState.pageOrder;
    for (let i = 0; i < order.length; i += 1) {
      m.set(i + 1, order[i] + 1);
    }
    return m;
  }, [engineState.pageOrder]);

  const pageLabelMap = useMemo(
    () => buildPageLabelMap(engineState.pageLabels),
    [engineState.pageLabels],
  );

  // The three inline hover verbs: the EXISTING per-page rotate / extract /
  // delete handlers, called with this thumbnail's visible 1-based page.
  const verbs = useMemo<ThumbVerbs>(
    () => ({
      onRotateCw: (page: number): void => {
        onOp?.({ kind: 'rotate', page, dir: 'cw' });
      },
      onExtract: (page: number): void => {
        onExtractPages?.(page);
      },
      onDelete: (page: number): void => {
        onDelete?.([page]);
      },
    }),
    [onOp, onExtractPages, onDelete],
  );

// The right-click menu's verbs, threaded to the shared controller (the
  // same machinery the Multi Mode strips use — one home, no fork).
  const { openMenu, menuNode } = usePageThumbMenu({
    onRotateCw: (page: number): void => onOp?.({ kind: 'rotate', page, dir: 'cw' }),
    onRotateCcw: (page: number): void => onOp?.({ kind: 'rotate', page, dir: 'ccw' }),
    onExtract: (page: number): void => onExtractPages?.(page),
    onInsertBlank: (page: number): void => onInsertBlank?.(page),
    onReplace: (page: number): void => onReplacePages?.(page),
    onDeletePage: (page: number): void => onDeletePage?.(page),
  });

  // Phase 111 (chunk B) — the panel More menu. The header's standalone
  // Combine entry and the Pages view's standalone Remove blank pages button
  // move here: Combine in the Document group, Remove blank pages in a clearly
  // separated destructive group. The ActionDock remains the owner of batch
  // Rotate / Extract / Delete, so this is NOT a second action toolbar.
  const [panelMoreOpen, setPanelMoreOpen] = useState(false);
  const [panelMorePos, setPanelMorePos] = useState<{ left: number; top: number } | null>(null);
  const panelMoreBtnRef = useRef<HTMLButtonElement | null>(null);
  const closePanelMore = (): void => setPanelMoreOpen(false);
  const openPanelMore = (): void => {
    const rect = panelMoreBtnRef.current?.getBoundingClientRect();
    if (rect !== undefined) {
      setPanelMorePos(
        clampMenuPosition(rect.left, rect.bottom + 4, 220, 140, window.innerWidth, window.innerHeight),
      );
    }
    setPanelMoreOpen(true);
  };
  const panelMoreGroups = useMemo<CommandMenuGroup[]>(() => {
    const documentRows: CommandMenuItem[] = [];
    if (onMerge !== undefined) {
      documentRows.push({
        id: 'combine',
        label: 'Combine with another PDF',
        intent: 'secondary',
        density: 'compact',
        rowClassName: 'context-menu-item',
        rowDataAttrs: { 'data-context-panel-combine': 'true' },
        onSelect: (): void => onMerge(),
      });
    }
    const destructiveRows: CommandMenuItem[] = [];
    if (onRemoveBlankPages !== undefined) {
      destructiveRows.push({
        id: 'remove-blank',
        label: 'Remove blank pages',
        intent: 'destructive',
        variant: 'danger',
        density: 'compact',
        rowClassName: 'context-menu-item context-menu-item-danger',
        rowDataAttrs: { 'data-blank-scan-open': 'true' },
        onSelect: (): void => onRemoveBlankPages(),
      });
    }
    // Phase 111 (chunk D1) — the FIRST group is the navigator layout toggle.
    // One row, always present; its label flips with the CURRENT layout, and its
    // selection persists through the host (never a second header button).
    const layoutRow: CommandMenuItem =
      navigatorLayout === 'split'
        ? {
            id: 'navigator-layout',
            label: 'Use stacked layout',
            intent: 'secondary',
            density: 'compact',
            rowClassName: 'context-menu-item',
            rowDataAttrs: { 'data-context-panel-layout-split': 'true' },
            onSelect: (): void => onNavigatorLayoutChange?.('stacked'),
          }
        : {
            id: 'navigator-layout',
            label: 'Use split layout',
            intent: 'secondary',
            density: 'compact',
            rowClassName: 'context-menu-item',
            rowDataAttrs: { 'data-context-panel-layout-split': 'true' },
            onSelect: (): void => onNavigatorLayoutChange?.('split'),
          };
    const groups: CommandMenuGroup[] = [
      { id: 'panel-layout', label: 'Layout', entries: [layoutRow] },
    ];
    if (documentRows.length > 0) groups.push({ id: 'panel-document', label: 'Document', entries: documentRows });
    if (destructiveRows.length > 0) {
      groups.push({ id: 'panel-destructive', label: 'Destructive', entries: destructiveRows });
    }
    return groups;
  }, [navigatorLayout, onMerge, onNavigatorLayoutChange, onRemoveBlankPages]);
  const panelMoreNode =
    panelMoreOpen && panelMoreGroups.length > 0 ? (
      <CommandMenu
        open
        groups={panelMoreGroups}
        ariaLabel="More actions"
        onClose={closePanelMore}
        align="end"
        position={panelMorePos ?? undefined}
        openerRef={panelMoreBtnRef}
        popoverDataAttrs={{ 'data-context-panel-more-menu': 'true' }}
      />
    ) : null;

  // ---- Split Navigator (Phase 111 chunk D1) ----------------------------
  // The panel body's live height decides whether the split layout fits. A
  // `ResizeObserver` (no new dependency) plus a window-resize listener keep it
  // fresh; the ref sits on the body wrapper so the measurement is the space the
  // navigator actually has, never the whole panel.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [bodyHeight, setBodyHeight] = useState(0);

  useLayoutEffect((): (() => void) | undefined => {
    const el = bodyRef.current;
    if (el === null) return undefined;
    const measure = (): void => setBodyHeight(el.clientHeight);
    measure();
    window.addEventListener('resize', measure);
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      observer = new ResizeObserver(measure);
      observer.observe(el);
    }
    return (): void => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
  }, [collapsed, stage]);

  const resolvedNavigatorLayout = resolveNavigatorLayout(navigatorLayout, bodyHeight);
  const splitActive = stage === 'pages' && resolvedNavigatorLayout === 'split';

  // Live drag updates local state only; the host is told once the gesture
  // settles (pointerup) or on a keyboard step, so no per-frame settings write.
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const splitRatio = dragRatio ?? clampSplitRatio(navigatorSplitRatio);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const splitDragRef = useRef<{ startY: number; startRatio: number } | null>(null);
  const splitFrameRef = useRef<number | null>(null);
  const splitPendingRef = useRef<number | null>(null);

  const ratioAt = useCallback(
    (clientY: number): number => {
      const drag = splitDragRef.current;
      if (drag === null) return clampSplitRatio(splitRatio);
      const height = splitContainerRef.current?.clientHeight ?? 0;
      if (height <= 0) return clampSplitRatio(splitRatio);
      return clampSplitRatio(drag.startRatio + (clientY - drag.startY) / height);
    },
    [splitRatio],
  );

  const flushSplitPending = useCallback((): void => {
    splitFrameRef.current = null;
    if (splitPendingRef.current !== null) {
      setDragRatio(splitPendingRef.current);
      splitPendingRef.current = null;
    }
  }, []);

  const onSplitPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      if (e.button !== undefined && e.button !== 0) return;
      splitDragRef.current = { startY: e.clientY, startRatio: splitRatio };
      if (typeof e.currentTarget.setPointerCapture === 'function') {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // capture is an optimization; the drag still works without it
        }
      }
      e.preventDefault();
    },
    [splitRatio],
  );

  const onSplitPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      if (splitDragRef.current === null) return;
      splitPendingRef.current = ratioAt(e.clientY);
      if (splitFrameRef.current === null && typeof requestAnimationFrame === 'function') {
        splitFrameRef.current = requestAnimationFrame(flushSplitPending);
      } else if (splitFrameRef.current === null) {
        flushSplitPending();
      }
    },
    [flushSplitPending, ratioAt],
  );

  const onSplitPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      if (splitDragRef.current === null) return;
      const next = ratioAt(e.clientY);
      splitDragRef.current = null;
      splitPendingRef.current = null;
      if (splitFrameRef.current !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(splitFrameRef.current);
      }
      splitFrameRef.current = null;
      setDragRatio(null);
      onNavigatorSplitRatioChange?.(next);
    },
    [onNavigatorSplitRatioChange, ratioAt],
  );

  const onSplitKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>): void => {
      const next = splitRatioAfterKey(splitRatio, e.key);
      if (next === null) return;
      e.preventDefault();
      onNavigatorSplitRatioChange?.(next);
    },
    [onNavigatorSplitRatioChange, splitRatio],
  );

  // Phase 37 (item 4) — the collapse control is the RAIL's affordance,
  // re-homed to this header. The glyph FLIPS with the state: expanded shows
  // PanelLeftClose (press to collapse toward the edge), collapsed shows
  // PanelRightOpen (press to expand). Phase 43 replaced the retired chevrons
  // here so the glyph matches the rail's own collapse/expand affordance.
  // `data-rail-collapse` and the two titles/aria-labels are unchanged, so the
  // existing e2e contract resolves in both states.
  const collapseButton = (
    <IconButton
      ref={collapseOpenerRef}
      label={collapsed ? 'Expand panel' : 'Collapse panel'}
      intent="tertiary"
      kind="toggle"
      density="standard"
      className="rail-tab rail-tab-collapse context-panel-collapse"
      onClick={(): void => onToggleCollapsed?.()}
      expanded={!collapsed}
      data-rail-collapse
      data-collapse-direction={collapsed ? 'expand' : 'collapse'}
      icon={collapsed ? <Icon icon={PanelRightOpen} size="md" aria-hidden /> : <Icon icon={PanelLeftClose} size="md" aria-hidden />}
    />
  );

  // ---- PAGES -----------------------------------------------------------
  // Phase 111 (chunk A) — one full-height navigator with two views. The 40px
  // selector under the header picks the view; only ONE view is mounted at a
  // time (Pages by default, Outline when `railTab === 'outline'`). The
  // segmented buttons mirror the PageLayoutControl chrome; the selected state
  // rides the canonical `.btn-toggle[aria-pressed]` / `tool-btn-active` pair.
  const pagesViewTabClass = outlineView
    ? 'btn btn-toolbar btn-toggle tool-btn context-panel-view-tab'
    : 'btn btn-toolbar btn-toggle tool-btn tool-btn-active context-panel-view-tab';
  const outlineViewTabClass = outlineView
    ? 'btn btn-toolbar btn-toggle tool-btn tool-btn-active context-panel-view-tab'
    : 'btn btn-toolbar btn-toggle tool-btn context-panel-view-tab';
  // The view-only outline with no nodes reads as the designed empty state; a
  // document with an editor config always renders the tree (so the very first
  // bookmark can be added - DEF-492).
  const outlineEmpty =
    (outline === null || outline === undefined || outline.length === 0) &&
    effectiveOutlineEditor === null;

  const renderPages = (): ReactElement => (
    <>
      <div
        className="context-panel-view-tabs"
        data-context-panel-view-tabs
        role="tablist"
        aria-label="Navigator view"
        onKeyDown={onViewTabsKeyDown}
      >
        <button
          type="button"
          role="tab"
          id="context-panel-view-tab-pages"
          className={pagesViewTabClass}
          data-context-panel-view-tab="pages"
          aria-controls="context-panel-view-pages"
          aria-selected={!outlineView}
          tabIndex={outlineView ? -1 : 0}
          onClick={(): void => selectView('thumbs')}
        >
          {`Pages \u00B7 ${pageCount}`}
        </button>
        <button
          type="button"
          role="tab"
          id="context-panel-view-tab-outline"
          className={outlineViewTabClass}
          data-context-panel-view-tab="outline"
          aria-controls="context-panel-view-outline"
          aria-selected={outlineView}
          tabIndex={outlineView ? 0 : -1}
          onClick={(): void => selectView('outline')}
        >
          {`Outline \u00B7 ${outlineCount}`}
        </button>
      </div>
      {outlineView ? (
        <div
          className="context-panel-outline context-panel-view-body"
          id="context-panel-view-outline"
          role="tabpanel"
          aria-labelledby="context-panel-view-tab-outline"
          aria-label="Outline"
          data-context-panel-outline
          data-context-panel-view="outline"
        >
          <div className="context-panel-outline-body" id="context-panel-outline-body" data-context-panel-outline-body>
            {outlineEmpty ? (
              // The no-bookmarks state is the shared designed empty state. No
              // Add action is fabricated: a view-only outline (no editor config)
              // cannot add bookmarks.
              <PanelEmptyState
                className="context-panel-outline-empty"
                headline="No bookmarks"
                help="This document has no bookmark outline."
                data-context-panel-outline-empty
              />
            ) : (
              <OutlinePanel doc={doc} outline={outline ?? []} onJump={onJump} onError={onError} editor={effectiveOutlineEditor} />
            )}
          </div>
        </div>
      ) : (
        <div
          className="context-panel-view-body"
          id="context-panel-view-pages"
          role="tabpanel"
          aria-labelledby="context-panel-view-tab-pages"
          data-context-panel-view="pages"
        >
          {/* Phase 111 (chunk B) — the compact selection summary sits ABOVE
           *  the scrolling list and renders for ANY real selection (>= 1),
           *  not just multi-page. Count + range read straight off the host
           *  set; Clear routes to the host clear path and never navigates. */}
          {pageSelection !== null && pageSelection.length >= 1 && (
            <PanelSection
              className="context-panel-selection"
              data-context-panel-selection
              title="Selection"
              aria-label="Selection"
            >
              <span
                className="visually-hidden"
                data-context-panel-selection-live
                role="status"
                aria-live="polite"
              >{`${pageSelection.length} selected`}</span>
              <PropertyRow
                label="Pages"
                value={`${pageSelection.length} selected`}
                data-context-panel-selection-count
              />
              <PropertyRow
                label="Range"
                value={pageRangeText(pageSelection)}
                data-context-panel-selection-range
              />
              <div className="context-panel-selection-actions">
                <Button
                  intent="tertiary"
                  kind="action"
                  density="compact"
                  className="context-panel-selection-clear"
                  data-context-panel-selection-clear
                  onClick={(): void => onPageSelectionChange?.([])}
                  aria-label="Clear page selection"
                >
                  Clear
                </Button>
              </div>
            </PanelSection>
          )}
          <div className="context-panel-thumbs" data-context-panel-thumbs>
            {pageCount === 0 ? (
              <EmptyState
                icon={Images}
                headline="No pages to show"
                help="Open a PDF to see its page thumbnails."
                data-context-panel-thumbs-empty
              />
            ) : (
              <ThumbnailRail
                doc={doc}
                pageCount={pageCount}
                currentPage={currentPage}
                aspectRatio={defaultHeightPt / defaultWidthPt}
                pageSizes={pageSizes}
                rotations={engineState.rotations}
                visibleToSource={visibleToSource}
                proxyVisibleOrder={proxyVisibleOrder}
                pageLabelMap={pageLabelMap}
                canUndo={canUndo}
                onOp={onOp}
                onDelete={onDelete}
                onReorder={onReorder}
                onUndo={onUndo}
                onJump={onJump}
                revealSeq={revealSeq}
                crossDoc={crossDoc}
                thumbVerbs={verbs}
                onThumbContextMenu={openMenu}
                pageSelection={pageSelection}
                onPageSelectionChange={onPageSelectionChange}
              />
            )}
          </div>
        </div>
      )}
    </>
  );

  // Phase 111 (chunk D1) — the Split Navigator. Both views are mounted at once,
  // Pages above Outline, each its own bounded scroll region with a compact
  // count title. The divider between them is the keyboard-accessible separator
  // that edits the persisted ratio (pointer commit on settle + keyboard steps).
  const renderPagesSplit = (): ReactElement => {
    const pagesBasis = `${Math.round(splitRatio * 100)}%`;
    const outlineBasis = `${Math.round((1 - splitRatio) * 100)}%`;
    return (
      <div className="context-panel-split" data-context-panel-split ref={splitContainerRef}>
        <div
          className="context-panel-split-section"
          data-context-panel-split-section="pages"
          style={{ flexBasis: pagesBasis, minHeight: NAVIGATOR_MIN_SECTION_PX }}
        >
          <div className="context-panel-split-title" data-context-panel-split-title="pages">
            {`Pages \u00B7 ${pageCount}`}
          </div>
          <div className="context-panel-view-body" data-context-panel-view="pages">
            {pageSelection !== null && pageSelection.length >= 1 && (
              <PanelSection
                className="context-panel-selection"
                data-context-panel-selection
                title="Selection"
                aria-label="Selection"
              >
                <span
                  className="visually-hidden"
                  data-context-panel-selection-live
                  role="status"
                  aria-live="polite"
                >{`${pageSelection.length} selected`}</span>
                <PropertyRow
                  label="Pages"
                  value={`${pageSelection.length} selected`}
                  data-context-panel-selection-count
                />
                <PropertyRow
                  label="Range"
                  value={pageRangeText(pageSelection)}
                  data-context-panel-selection-range
                />
                <div className="context-panel-selection-actions">
                  <Button
                    intent="tertiary"
                    kind="action"
                    density="compact"
                    className="context-panel-selection-clear"
                    data-context-panel-selection-clear
                    onClick={(): void => onPageSelectionChange?.([])}
                    aria-label="Clear page selection"
                  >
                    Clear
                  </Button>
                </div>
              </PanelSection>
            )}
            <div className="context-panel-thumbs" data-context-panel-thumbs>
              {pageCount === 0 ? (
                <EmptyState
                  icon={Images}
                  headline="No pages to show"
                  help="Open a PDF to see its page thumbnails."
                  data-context-panel-thumbs-empty
                />
              ) : (
                <ThumbnailRail
                  doc={doc}
                  pageCount={pageCount}
                  currentPage={currentPage}
                  aspectRatio={defaultHeightPt / defaultWidthPt}
                  pageSizes={pageSizes}
                  rotations={engineState.rotations}
                  visibleToSource={visibleToSource}
                  proxyVisibleOrder={proxyVisibleOrder}
                  pageLabelMap={pageLabelMap}
                  canUndo={canUndo}
                  onOp={onOp}
                  onDelete={onDelete}
                  onReorder={onReorder}
                  onUndo={onUndo}
                  onJump={onJump}
                  revealSeq={revealSeq}
                  crossDoc={crossDoc}
                  thumbVerbs={verbs}
                  onThumbContextMenu={openMenu}
                  pageSelection={pageSelection}
                  onPageSelectionChange={onPageSelectionChange}
                />
              )}
            </div>
          </div>
        </div>
        <div
          className="context-panel-split-divider"
          data-context-panel-split-divider
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize navigator sections"
          aria-valuenow={Math.round(splitRatio * 100)}
          aria-valuemin={10}
          aria-valuemax={90}
          tabIndex={0}
          onPointerDown={onSplitPointerDown}
          onPointerMove={onSplitPointerMove}
          onPointerUp={onSplitPointerUp}
          onPointerCancel={onSplitPointerUp}
          onKeyDown={onSplitKeyDown}
        >
          <span className="context-panel-split-grip" aria-hidden="true" />
        </div>
        <div
          className="context-panel-split-section"
          data-context-panel-split-section="outline"
          style={{ flexBasis: outlineBasis, minHeight: NAVIGATOR_MIN_SECTION_PX }}
        >
          <div className="context-panel-split-title" data-context-panel-split-title="outline">
            {`Outline \u00B7 ${outlineCount}`}
          </div>
          <div
            className="context-panel-outline context-panel-view-body"
            data-context-panel-outline
            data-context-panel-view="outline"
          >
            <div className="context-panel-outline-body" data-context-panel-outline-body>
              {outlineEmpty ? (
                <PanelEmptyState
                  className="context-panel-outline-empty"
                  headline="No bookmarks"
                  help="This document has no bookmark outline."
                  data-context-panel-outline-empty
                />
              ) : (
                <OutlinePanel
                  doc={doc}
                  outline={outline ?? []}
                  onJump={onJump}
                  onError={onError}
                  editor={effectiveOutlineEditor}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ---- EDIT ------------------------------------------------------------
  // The content outline of the CURRENT page: the text boxes + image
  // placements the app already models. The host builds the items from the
  // edit model; selecting one routes to the host's existing edit selection.
  const pageEditContent = editContent === null ? [] : editContent.filter((i) => i.page === currentPage);
  const contentState = editContentState({
    editContent,
    pageItemCount: pageEditContent.length,
    unsupported: editUnsupported,
    restricted: editPermissionRestricted,
  });
  const contentEmpty = contentState === 'ready' ? null : EDIT_CONTENT_EMPTY[contentState];
  const renderEdit = (): ReactElement => (
    <>
      <PanelSection
        className="context-panel-section"
        titleClassName="context-panel-section-title"
        data-context-panel-section="content"
        aria-label="Content"
        title="Content"
      >
        {/* Phase 41 (item 2) — the retired edit toolbar's last control. New /
            replaced text uses this font; the host persists it like before. */}
        <PropertyRow
          className="context-panel-row"
          labelClassName="context-panel-row-label"
          valueClassName="context-panel-row-value"
          data-edit-default-font-row
          label="Default font"
        >
          <select
            className="context-panel-select"
            data-edit-default-font
            aria-label="Default font"
            value={editDefaultFont ?? ''}
            disabled={onEditDefaultFontChange === null}
            onChange={(e): void => {
              const v = e.target.value;
              if (EDIT_DEFAULT_FONTS.includes(v as EditFont)) {
                onEditDefaultFontChange?.(v as EditFont);
              }
            }}
          >
            {editDefaultFont === undefined && <option value="">—</option>}
            {EDIT_DEFAULT_FONTS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </PropertyRow>
        {contentState === 'ready' ? (
          <div className="context-panel-list" data-edit-content-list>
            {pageEditContent.map((item) => (
              <Button
                key={item.id}
                intent="secondary"
                kind="toggle"
                density="standard"
                className={
                  item.selected
                    ? 'context-panel-item context-panel-item-selected'
                    : 'context-panel-item'
                }
                aria-pressed={item.selected}
                data-edit-content-item={item.id}
                data-edit-content-kind={item.kind}
                onClick={(): void => onSelectEditContent?.(item.id, item.kind)}
              >
                {item.kind === 'image' ? (
                  <Icon name="editImage" size="md" aria-hidden />
                ) : (
                  <Icon name="editText" size="md" aria-hidden />
                )}
                <span className="context-panel-item-label">{item.label}</span>
              </Button>
            ))}
          </div>
        ) : contentState === 'no-content' ? (
          // A real, empty page. The Phase-96 shared designed empty state keeps
          // its `empty-state` hooks (phase96_design_system e2e) and its exact
          // copy; no Blank/Scanned claim is made without engine data.
          <EmptyState
            icon={TextCursor}
            className="context-panel-empty"
            data-edit-content-empty
            headline="No editable content on this page."
          />
        ) : (
          // Phase 112 (C3) — the remaining diagnostics (no selection /
          // unsupported / permission restricted) are the shared PanelEmptyState.
          <PanelEmptyState
            icon={contentEmpty?.icon ?? TextCursor}
            className="context-panel-empty"
            data-edit-content-empty
            data-edit-content-state={contentState}
            headline={contentEmpty?.headline ?? 'No editable content detected'}
            help={contentEmpty?.help}
          />
        )}
      </PanelSection>
      <PanelSection
        className="context-panel-section"
        titleClassName="context-panel-section-title"
        data-context-panel-section="recognition"
        aria-label="Recognition"
        title="Recognition"
      >
        {!ocrHasRun && (
          // Phase 112 (C3) — before a run the recognition section states it
          // plainly, then still offers the EXISTING recognize entry below.
          <PanelEmptyState
            icon={ScanText}
            className="context-panel-empty"
            data-ocr-empty
            headline="Recognition not run"
            help="Run Recognize text to detect text on scanned pages."
          />
        )}
        <PropertyRow
          className="context-panel-row"
          labelClassName="context-panel-row-label"
          valueClassName="context-panel-row-value"
          data-ocr-status-row
          label="OCR status"
        >
          <span data-ocr-status>{ocrStatus ?? 'Not run'}</span>
        </PropertyRow>
        <PropertyRow
          className="context-panel-row"
          labelClassName="context-panel-row-label"
          valueClassName="context-panel-row-value"
          data-ocr-suspects-row
          label="Suspects"
        >
          <span
            className={
              ocrHasRun && ocrSuspectCount > 0
                ? 'context-panel-badge context-panel-badge-alert'
                : 'context-panel-badge'
            }
            data-ocr-suspect-count
          >
            {ocrHasRun ? ocrSuspectCount : '\u2014'}
          </span>
        </PropertyRow>
        <div className="context-panel-actions-row">
          <Button
            intent="secondary"
            kind="action"
            density="compact"
            className="context-panel-action"
            data-context-panel-action="recognize"
            onClick={(): void => onRecognizeText?.()}
            disabled={onRecognizeText === undefined}
          >
            <Icon name="recognizeText" size="md" aria-hidden />
            <span>Recognize text</span>
          </Button>
          <Button
            intent="secondary"
            kind="action"
            density="compact"
            className="context-panel-action"
            data-context-panel-action="suspects"
            onClick={(): void => onOpenOcrSuspects?.()}
            // DEF-328 — the SAME gate as the palette's `ocrSuspects` row and
            // the SAME refusal copy: the suspects view only exists after a run
            // produced a list, so the control is disabled (never an enabled
            // no-op) until then.
            disabled={onOpenOcrSuspects === undefined || !ocrHasRun}
            title={ocrHasRun ? undefined : 'Run Recognize text first'}
          >
            <span>Review suspects</span>
          </Button>
        </div>
      </PanelSection>
    </>
  );

  // ---- REVIEW ----------------------------------------------------------
  // Phase 90 (TFL-509-C1) — the unified review-element list has exactly ONE
  // renderer (`ReviewElementsPanel`), re-parented here AND by the Inspector's
  // REVIEW section (Ruling 6). Its Annotations category re-parents the shipped
  // AnnotationsPanel unchanged; the Bates / Watermarks / Signatures categories
  // read the host's lists and dispatch select / edit / delete back to the host.
  const renderReview = (): ReactElement => (
    <ReviewElementsPanel
      annotations={annotations}
      onJumpToAnnotation={onJumpToAnnotation}
      onEditAnnotation={onEditAnnotation}
      onDeleteAnnotation={onDeleteAnnotation}
      bates={bates}
      watermarks={watermarks}
      signatures={signatures}
      onSelect={onSelectReviewElement}
      onEdit={onEditReviewElement}
      onDelete={onDeleteReviewElement}
      errorFor={reviewErrorFor}
    />
  );

  // ---- DELIVER ---------------------------------------------------------
  // The output checks are FACTUAL OBSERVATIONS read from the existing state,
  // never blockers and never a readiness score: the OCR status (not-run is not
  // an error), the real file size, the interactive form-field count (a nonzero
  // count is not a problem to flatten), the document's actual encryption
  // dictionary when the host read it, and an office format's mandatory fidelity
  // limits when one is being prepared. Unknown/not-analysed reads distinctly.
  const renderDeliver = (): ReactElement => {
    const protectionText =
      protection === null ? 'Not analysed' : protectionSummary(protection);
    const fidelityNotes =
      exportFidelityFormat === null ? null : EXPORT_FIDELITY_NOTES[exportFidelityFormat];
    const fidelityText =
      fidelityNotes === null ? 'Not analysed' : fidelityNotes.join(' ');
    const checkActions = [
      {
        id: 'optimize',
        label: 'Optimize',
        icon: <Icon name="optimize" size="md" aria-hidden />,
        onClick: onOptimize,
        dataAttrs: { 'data-context-panel-action': 'optimize' },
      },
    ];
    const newDocumentActions = [
      {
        id: 'from-images',
        label: 'From images',
        icon: <Icon name="insertPages" size="md" aria-hidden />,
        onClick: onCreateFromImages ?? undefined,
        dataAttrs: { 'data-context-panel-action': 'from-images' },
      },
    ];
    return (
      <>
        <PanelSection
          className="context-panel-section"
          titleClassName="context-panel-section-title"
          bodyClassName="context-panel-section-body"
          data-context-panel-section="preflight"
          title="Output checks"
        >
          {pageCount === 0 ? (
            <PanelEmptyState
              className="context-panel-empty"
              data-deliver-empty
              headline="No document to check"
              help="Open a PDF to see its output checks."
            />
          ) : (
            <>
              <p className="tf-panel-section-note" data-deliver-observation-legend>
                Observations, not blockers.
              </p>
              <PropertyRow
                className="context-panel-row"
                data-preflight="ocr"
                data-deliver-observation
                label="OCR"
              >
                <span data-deliver-observation-value>{ocrStatus ?? 'Not run'}</span>
              </PropertyRow>
              <PropertyRow
                className="context-panel-row"
                data-preflight="file-size"
                data-deliver-observation
                label="File size"
              >
                <span data-file-size>
                  {fileSize === null ? '\u2014' : formatBytes(fileSize)}
                </span>
              </PropertyRow>
              <PropertyRow
                className="context-panel-row"
                data-preflight="forms"
                data-deliver-observation
                label="Form fields"
              >
                <span data-form-fields>
                  {formFieldCount > 0 ? `${formFieldCount} interactive` : 'None'}
                </span>
              </PropertyRow>
              <PropertyRow
                className="context-panel-row"
                data-preflight="protection"
                data-deliver-observation
                label="Protection"
              >
                <span data-deliver-protection>{protectionText}</span>
              </PropertyRow>
              <PropertyRow
                className="context-panel-row"
                data-preflight="fidelity"
                data-deliver-observation
                label="Export fidelity"
              >
                <span data-deliver-fidelity>{fidelityText}</span>
              </PropertyRow>
            </>
          )}
          <ActionList
            className="context-panel-actions-row"
            data-deliver-actions
            actions={checkActions}
          />
        </PanelSection>
        <PanelSection
          className="context-panel-section"
          titleClassName="context-panel-section-title"
          bodyClassName="context-panel-section-body"
          data-context-panel-section="new-document"
          title="New document"
        >
          <ActionList
            className="context-panel-actions-row"
            data-deliver-actions="new-document"
            actions={newDocumentActions}
          />
        </PanelSection>
      </>
    );
  };

  const body =
    stage === 'edit'
      ? renderEdit()
      : stage === 'review'
        ? renderReview()
        : stage === 'deliver'
          ? renderDeliver()
          : splitActive
            ? renderPagesSplit()
            : renderPages();

const headerTitle = contextPanelTitle(stage, pageCount);

  return (
    <PanelShell
      className={drawer ? 'context-panel context-panel-drawer' : 'context-panel'}
      label="Context panel"
      data-context-panel={stage}
      data-context-panel-stage={stage}
      data-context-panel-collapsed={collapsed ? 'true' : undefined}
      data-context-panel-drawer={drawer ? 'true' : undefined}
    >
      <ScopedHeader
        className="context-panel-header"
        preferredHeight
        /* Phase 37 (item 15) — the PAGES title is GONE (empty title = no
         * title span). EDIT / REVIEW / DELIVER keep their word. */
        title={headerTitle === '' ? undefined : headerTitle}
        actions={
          <div className="context-panel-actions">
            {!collapsed && stage === 'pages' && (
              <Button
                intent="secondary"
                kind="action"
                density="standard"
                className="context-panel-more"
                ref={panelMoreBtnRef}
                onClick={openPanelMore}
                title="More actions"
                aria-label="More actions"
                aria-haspopup="menu"
                aria-expanded={panelMoreOpen}
                data-context-panel-more
              >
                <Icon icon={MoreHorizontal} size="md" aria-hidden />
                <span>More</span>
              </Button>
            )}
            {collapseButton}
            {/* R16 — the compact drawer's explicit close control. The wide
                panel keeps exactly its existing header (no close control). */}
            {drawer && onClose !== undefined && (
              <IconButton
                label="Close context panel"
                intent="tertiary"
                kind="action"
                density="standard"
                className="context-panel-close"
                data-context-panel-close
                onClick={onClose}
                icon={<Icon icon={X} size="md" aria-hidden />}
              />
            )}
          </div>
        }
      />
      <GlassSidebarBody className="context-panel-body tf-panel-body tf-panel-scroll">
        {collapsed ? (
          stage === 'pages' ? (
            <div className="context-panel-ruler" data-context-panel-ruler>
              <RulerStrip pageCount={pageCount} currentPage={currentPage} onJump={onJump} />
            </div>
          ) : (
            /* R16 — the compact stage launcher. Pages keeps the page-number
               ruler above; Edit/Review/Deliver open the ACTIVE stage's context
               as the overlay drawer instead of inheriting a generic page list. */
            <div
              className="context-panel-launcher"
              data-context-panel-launcher
              data-context-panel-launcher-stage={stage}
            >
              <button
                type="button"
                className="btn btn-ghost context-panel-launcher-btn"
                data-context-panel-launcher-open
                aria-label={`Open ${STAGE_LABELS[stage]} context`}
                title={`Open ${STAGE_LABELS[stage]} context`}
                onClick={(): void => onToggleCollapsed?.()}
              >
                <span className="context-panel-launcher-icon" aria-hidden>
                  <Icon name={CONTEXT_STAGE_ICONS[stage]} size="lg" />
                </span>
                <span className="context-panel-launcher-label" aria-hidden>
                  {STAGE_LABELS[stage]}
                </span>
              </button>
            </div>
          )
        ) : (
          <div className="context-panel-body-fill" ref={bodyRef}>
            {body}
          </div>
        )}
        {menuNode}
        {panelMoreNode}
      </GlassSidebarBody>
    </PanelShell>
  );
}
