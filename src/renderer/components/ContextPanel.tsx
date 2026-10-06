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

import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  FileSignature,
  FileWarning,
  Images,
  Lock,
  MousePointerClick,
  PanelLeftClose,
  PanelRightOpen,
  ScanText,
  SquareChevronDown,
  SquareChevronRight,
  TextCursor,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Icon } from '../icons/Icon';
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
import type { Stage } from '../state/stages';
import { EDIT_DEFAULT_FONTS } from '../state/preferences';
import { EXPORT_FIDELITY_NOTES, type ExportFormat } from '../../shared/export';
import type {
  BatesInfo,
  DocumentProtectionState,
  EditFont,
  SavedSignature,
  SignaturePlacement,
  WatermarkInfo,
} from '../../shared/types';

/** The panel's migrated glyphs. Declared with an `icon:` property so the Phase 43
 *  icon-identity guard still attributes each glyph to this surface. */
const CONTEXT_PANEL_GLYPHS = {
  signature: { icon: FileSignature },
  outlineOpen: { icon: SquareChevronDown },
  outlineClosed: { icon: SquareChevronRight },
} as const satisfies Record<string, { icon: LucideIcon }>;

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

  // --- Host-owned rail tab (Phase 59 item 7 follow-up) -------------------
  /** The host's active rail tab (App's `railTab`). The PAGES body lives in
   *  this panel, so the "Page thumbnails" / "Bookmarks" palette commands land
   *  here: `'outline'` expands the outline section, `'thumbs'` collapses it
   *  back to the thumbnail stack. Absent = the legacy local behaviour (the
   *  panel keeps its own `outlineOpen`, default expanded) — every pre-existing
   *  caller and test is unchanged. */
  railTab?: RailTab;
  /** Phase 59 (item 7 follow-up) — the outline section's toggle reports here,
   *  so the panel's own control and the palette command write the SAME host
   *  state and can never disagree. */
  onRailTabChange?: (tab: RailTab) => void;

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
    railTab,
    onRailTabChange,
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
  const [outlineOpen, setOutlineOpen] = useState(true);

  // Phase 85 — an explicit `outlineEditor` prop wins, else the config App
  // publishes through the context. Null keeps the outline view-only.
  const contextOutlineEditor = useContext(OutlineEditorContext);
  const effectiveOutlineEditor = outlineEditor ?? contextOutlineEditor;

  // Phase 59 (item 7 follow-up) — the host's `railTab` drives the PAGES body's
  // outline section. The command "Bookmarks" (`railTab: 'outline'`) expands it;
  // "Page thumbnails" (`railTab: 'thumbs'`) collapses it back to the thumbnail
  // stack. The panel is only CONTROLLED once the host tab actually CHANGES from
  // its mount value, so the default (expanded) visual and every document-open
  // flow are untouched; an explicit switch then takes effect.
  const prevRailTabRef = useRef<RailTab | undefined>(railTab);
  useEffect((): void => {
    if (railTab === undefined) return;
    if (prevRailTabRef.current === railTab) return;
    prevRailTabRef.current = railTab;
    setOutlineOpen(railTab === 'outline');
  }, [railTab]);

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

  // Phase 37 (item 4) — the collapse control is the RAIL's affordance,
  // re-homed to this header. The glyph FLIPS with the state: expanded shows
  // PanelLeftClose (press to collapse toward the edge), collapsed shows
  // PanelRightOpen (press to expand). Phase 43 replaced the retired chevrons
  // here so the glyph matches the rail's own collapse/expand affordance.
  // `data-rail-collapse` and the two titles/aria-labels are unchanged, so the
  // existing e2e contract resolves in both states.
  const collapseButton = (
    <button
      type="button"
      className="rail-tab rail-tab-collapse context-panel-collapse"
      onClick={(): void => onToggleCollapsed?.()}
      title={collapsed ? 'Expand panel' : 'Collapse panel'}
      aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
      data-rail-collapse
      data-collapse-direction={collapsed ? 'expand' : 'collapse'}
    >
      {collapsed ? <Icon icon={PanelRightOpen} size="md" aria-hidden /> : <Icon icon={PanelLeftClose} size="md" aria-hidden />}
    </button>
  );

  // ---- PAGES -----------------------------------------------------------
  const renderPages = (): ReactElement => (
    <>
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
            crossDoc={crossDoc}
            thumbVerbs={verbs}
            onThumbContextMenu={openMenu}
            pageSelection={pageSelection}
            onPageSelectionChange={onPageSelectionChange}
          />
        )}
      </div>
      <div className="context-panel-actions-row">
        <button
          type="button"
          className="btn btn-secondary btn-sm context-panel-action"
          data-blank-scan-open
          onClick={(): void => onRemoveBlankPages?.()}
          aria-label="Remove blank pages"
        >
          Remove blank pages
        </button>
      </div>
      {/* Phase 112 (TFL-854 C2) — the thumbnail multi-select summary. The
       *  host owns the set (DocumentView) and threads it here; the section
       *  renders ONLY when more than one page is selected, so a single-page
       *  navigation stays uncluttered. Count + range are read straight off
       *  the set, never a fabricated badge. */}
      {pageSelection !== null && pageSelection.length > 1 && (
        <PanelSection
          className="context-panel-selection"
          data-context-panel-selection
          title="Selection"
          aria-label="Selection"
        >
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
        </PanelSection>
      )}
      {(outline !== null || effectiveOutlineEditor !== null) && (
        <section className="context-panel-outline" data-context-panel-outline aria-label="Outline" data-outline-open={outlineOpen ? 'true' : 'false'}>
          <button
            type="button"
            className="btn btn-ghost context-panel-section-toggle"
            onClick={(): void => {
              const next = !outlineOpen;
              setOutlineOpen(next);
              // Phase 59 (item 7 follow-up) — the toggle writes the SAME host
              // state the palette command does, so the two can never disagree.
              onRailTabChange?.(next ? 'outline' : 'thumbs');
            }}
            aria-expanded={outlineOpen}
            aria-controls="context-panel-outline-body"
            data-outline-toggle
          >
            {outlineOpen ? <Icon icon={CONTEXT_PANEL_GLYPHS.outlineOpen.icon} size="md" aria-hidden /> : <Icon icon={CONTEXT_PANEL_GLYPHS.outlineClosed.icon} size="md" aria-hidden />}
            <span>Outline</span>
          </button>
          {outlineOpen && (
            <div className="context-panel-outline-body" id="context-panel-outline-body" data-context-panel-outline-body>
              {outline !== null && outline.length === 0 && effectiveOutlineEditor === null ? (
                // Phase 112 (TFL-854 C2) — the no-bookmarks state is the shared
                // designed empty state. No Add action is fabricated: a
                // view-only outline (no editor config) cannot add bookmarks.
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
          )}
        </section>
      )}
    </>
  );

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
              <button
                key={item.id}
                type="button"
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
              </button>
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
          <button
            type="button"
            className="btn btn-secondary btn-sm context-panel-action"
            data-context-panel-action="recognize"
            onClick={(): void => onRecognizeText?.()}
            disabled={onRecognizeText === undefined}
          >
            <Icon name="recognizeText" size="md" aria-hidden />
            <span>Recognize text</span>
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm context-panel-action"
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
          </button>
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
                Observations, not blockers: they describe the document and never stop an export.
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
          : renderPages();

const headerTitle = contextPanelTitle(stage, pageCount);

  return (
    <PanelShell
      className="context-panel"
      label="Context panel"
      data-context-panel={stage}
      data-context-panel-stage={stage}
      data-context-panel-collapsed={collapsed ? 'true' : undefined}
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
              <button
                type="button"
                className="btn btn-secondary context-panel-combine"
                onClick={(): void => onMerge?.()}
                title="Combine with another PDF"
                aria-label="Combine with another PDF"
                data-context-panel-combine
              >
                <Icon name="merge" size="md" aria-hidden />
                <span>Combine</span>
              </button>
            )}
            {collapseButton}
          </div>
        }
      />
      <GlassSidebarBody className="context-panel-body">
        {collapsed ? (
          <div className="context-panel-ruler" data-context-panel-ruler>
            <RulerStrip pageCount={pageCount} currentPage={currentPage} onJump={onJump} />
          </div>
        ) : (
          body
        )}
        {menuNode}
      </GlassSidebarBody>
    </PanelShell>
  );
}
