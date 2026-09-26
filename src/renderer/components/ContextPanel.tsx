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

import { useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import {
  FilePlus2,
  FileSignature,
  GitMerge,
  Image as ImageIcon,
  PanelLeftClose,
  PanelRightOpen,
  ScanText,
  SquareChevronDown,
  SquareChevronRight,
  TextCursor,
} from 'lucide-react';
import { OutlinePanel, RulerStrip, ThumbnailRail } from './SideRail';
import type { ThumbVerbs } from './SideRail';
import { usePageThumbMenu } from './pageThumbMenu';
import { GlassSidebarBody, GlassSidebarHeader } from './GlassSidebar';
import { AnnotationsPanel } from '../annotations/AnnotationsPanel';
import type { Annotation, AnnotationPatch } from '../annotations/model';
import { buildPageLabelMap } from './pageGeometry';
import { formatBytes } from '../utils/formatBytes';
import type { EngineState } from '../engine/types';
import type { OutlineNode } from '../pdf/pdfjs';
import type { PageDropOp } from '../state/pageDrag';
import type { Stage } from '../state/stages';
import { EDIT_DEFAULT_FONTS } from '../state/preferences';
import type { EditFont, SavedSignature } from '../../shared/types';

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

  // --- REVIEW -----------------------------------------------------------
  /** The active document's annotations. The REVIEW body re-parents the SAME
   *  AnnotationsPanel the rail's annotations tab rendered — exactly ONE home
   *  for the list (the Inspector shows only a reference to it). */
  annotations?: readonly Annotation[];
  /** Jump to (and flash) an annotation (the host's existing handler). */
  onJumpToAnnotation?: ((page: number, id: string) => void) | null;
  onEditAnnotation?: ((id: string, patch: AnnotationPatch) => void) | null;
  onDeleteAnnotation?: ((id: string) => void) | null;
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
    onMerge,
    onExtractPages,
onInsertBlank,
    onReplacePages,
    onDeletePage,
    crossDoc = null,
    pageSelection = null,
    onPageSelectionChange = null,
    collapsed = false,
    onToggleCollapsed,
    editContent = null,
    onSelectEditContent = null,
    ocrStatus = null,
    ocrHasRun = false,
    ocrSuspectCount = 0,
    onRecognizeText,
    onOpenOcrSuspects,
    editDefaultFont,
    onEditDefaultFontChange = null,
    annotations = [],
    onJumpToAnnotation = null,
    onEditAnnotation = null,
    onDeleteAnnotation = null,
    savedSignatures = [],
    armedSignatureId = null,
    onSignSignature = null,
    onManageSignatures = null,
    fileSize = null,
    formFieldCount = 0,
    onOptimize,
    onCreateFromImages = null,
  } = props;

const pageCount = engineState.pageCount;
  const [outlineOpen, setOutlineOpen] = useState(true);

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
      {collapsed ? <PanelRightOpen size={16} aria-hidden /> : <PanelLeftClose size={16} aria-hidden />}
    </button>
  );

  // ---- PAGES -----------------------------------------------------------
  const renderPages = (): ReactElement => (
    <>
      <div className="context-panel-thumbs" data-context-panel-thumbs>
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
      </div>
      {outline !== null && (
        <section className="context-panel-outline" data-context-panel-outline aria-label="Outline" data-outline-open={outlineOpen ? 'true' : 'false'}>
          <button
            type="button"
            className="context-panel-section-toggle"
            onClick={(): void => setOutlineOpen((v) => !v)}
            aria-expanded={outlineOpen}
            aria-controls="context-panel-outline-body"
            data-outline-toggle
          >
            {outlineOpen ? <SquareChevronDown size={14} aria-hidden /> : <SquareChevronRight size={14} aria-hidden />}
            <span>Outline</span>
          </button>
          {outlineOpen && (
            <div className="context-panel-outline-body" id="context-panel-outline-body" data-context-panel-outline-body>
              <OutlinePanel doc={doc} outline={outline} onJump={onJump} onError={onError} />
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
  const renderEdit = (): ReactElement => (
    <>
      <section className="context-panel-section" data-context-panel-section="content" aria-label="Content">
        <div className="context-panel-section-title">Content</div>
        {/* Phase 41 (item 2) — the retired edit toolbar's last control. New /
            replaced text uses this font; the host persists it like before. */}
        <div className="context-panel-row" data-edit-default-font-row>
          <span className="context-panel-row-label">Default font</span>
          <span className="context-panel-row-value">
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
          </span>
        </div>
        {pageEditContent.length === 0 ? (
          <p className="context-panel-empty" data-edit-content-empty>
            No editable content on this page.
          </p>
        ) : (
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
                  <ImageIcon size={14} aria-hidden />
                ) : (
                  <TextCursor size={14} aria-hidden />
                )}
                <span className="context-panel-item-label">{item.label}</span>
              </button>
            ))}
          </div>
        )}
      </section>
      <section className="context-panel-section" data-context-panel-section="recognition" aria-label="Recognition">
        <div className="context-panel-section-title">Recognition</div>
        <div className="context-panel-row" data-ocr-status-row>
          <span className="context-panel-row-label">OCR status</span>
          <span className="context-panel-row-value" data-ocr-status>
            {ocrStatus ?? 'Not run'}
          </span>
        </div>
        <div className="context-panel-row" data-ocr-suspects-row>
          <span className="context-panel-row-label">Suspects</span>
          <span className="context-panel-row-value">
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
          </span>
        </div>
        <div className="context-panel-actions-row">
          <button
            type="button"
            className="context-panel-action"
            data-context-panel-action="recognize"
            onClick={(): void => onRecognizeText?.()}
            disabled={onRecognizeText === undefined}
          >
            <ScanText size={13} aria-hidden />
            <span>Recognize text…</span>
          </button>
          <button
            type="button"
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
          </button>
        </div>
      </section>
    </>
  );

  // ---- REVIEW ----------------------------------------------------------
  // The annotations LIST has exactly ONE home: this panel's REVIEW body — it
  // re-parents the SAME AnnotationsPanel the rail's annotations tab rendered
  // (the rail leaves the single-mode slot with this chunk). The Inspector's
  // REVIEW section shows only a read-only reference to the count, never a
  // second copy of the list. The saved-signatures section follows.
  const renderReview = (): ReactElement => (
    <>
      <section className="context-panel-section" data-context-panel-section="annotations" aria-label="Annotations">
        <div className="context-panel-section-title">Annotations</div>
        <div className="context-panel-annotations" data-context-panel-annotations>
          <AnnotationsPanel
            annotations={[...annotations]}
            onJumpTo={(page, id): void => onJumpToAnnotation?.(page, id)}
            onEdit={(id, patch): void => onEditAnnotation?.(id, patch)}
            onDelete={(id): void => onDeleteAnnotation?.(id)}
          />
        </div>
      </section>
      <section className="context-panel-section" data-context-panel-section="signatures" aria-label="Signatures">
        <div className="context-panel-section-title">Signatures</div>
        {savedSignatures.length === 0 ? (
          <p className="context-panel-empty" data-signatures-empty>
            No saved signatures yet.
          </p>
        ) : (
          <div className="context-panel-list" data-saved-signatures-list>
            {savedSignatures.map((sig) => {
              const armed = armedSignatureId === sig.id;
              return (
                <button
                  key={sig.id}
                  type="button"
                  className={
                    armed
                      ? 'context-panel-item context-panel-item-selected'
                      : 'context-panel-item'
                  }
                  aria-pressed={armed}
                  data-saved-signature={sig.id}
                  onClick={(): void => onSignSignature?.(sig.id)}
                  disabled={onSignSignature === null}
                  title={armed ? 'Placing this signature' : 'Click a page to place this signature'}
                >
                  <FileSignature size={14} aria-hidden />
                  <span className="context-panel-item-label">{sig.label}</span>
                </button>
              );
            })}
          </div>
        )}
        <div className="context-panel-actions-row">
          <button
            type="button"
            className="context-panel-action"
            data-context-panel-action="manage-signatures"
            onClick={(): void => onManageSignatures?.()}
            disabled={onManageSignatures === null}
          >
            <FileSignature size={13} aria-hidden />
            <span>Manage signatures…</span>
          </button>
        </div>
      </section>
    </>
  );

  // ---- DELIVER ---------------------------------------------------------
  // The pre-flight checklist READS the existing state only: the OCR status
  // (the same flag the EDIT panel shows), the file size (the session's
  // byte count, with the Optimize entry) and the form-field count. The app
  // keeps no separate "flattened" flag — a flattened document and a
  // form-less document both report zero fields, so both read "None" here.
  const renderDeliver = (): ReactElement => (
    <>
      <section className="context-panel-section" data-context-panel-section="preflight" aria-label="Pre-flight">
        <div className="context-panel-section-title">Pre-flight</div>
        <div className="context-panel-row" data-preflight="ocr">
          <span className="context-panel-row-label">OCR</span>
          <span className="context-panel-row-value">{ocrStatus ?? 'Not run'}</span>
        </div>
        <div className="context-panel-row" data-preflight="file-size">
          <span className="context-panel-row-label">File size</span>
          <span className="context-panel-row-value">
            <span data-file-size>{fileSize === null ? '\u2014' : formatBytes(fileSize)}</span>
          </span>
        </div>
        <div className="context-panel-row" data-preflight="optimize">
          <span className="context-panel-row-label">Optimize</span>
          <span className="context-panel-row-value">
            <button
              type="button"
              className="context-panel-action"
              data-context-panel-action="optimize"
              onClick={(): void => onOptimize?.()}
              disabled={onOptimize === undefined}
            >
              <span>Optimize…</span>
            </button>
          </span>
        </div>
        <div className="context-panel-row" data-preflight="forms">
          <span className="context-panel-row-label">Form fields</span>
          <span className="context-panel-row-value" data-form-fields>
            {formFieldCount > 0 ? `${formFieldCount} to flatten` : 'None'}
          </span>
        </div>
      </section>
      <section className="context-panel-section" data-context-panel-section="new-document" aria-label="New document">
        <div className="context-panel-section-title">New document</div>
        <div className="context-panel-actions-row">
          <button
            type="button"
            className="context-panel-action"
            data-context-panel-action="from-images"
            onClick={(): void => onCreateFromImages?.()}
            disabled={onCreateFromImages === null}
          >
            <FilePlus2 size={13} aria-hidden />
            <span>From images…</span>
          </button>
        </div>
      </section>
    </>
  );

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
    <div
      className="context-panel"
      data-context-panel={stage}
      data-context-panel-stage={stage}
      data-context-panel-collapsed={collapsed ? 'true' : undefined}
    >
      <GlassSidebarHeader
        className="context-panel-header"
        /* Phase 37 (item 15) — the PAGES title is GONE (empty title = no
         * title span). EDIT / REVIEW / DELIVER keep their word. */
        title={headerTitle === '' ? undefined : headerTitle}
        actions={
          <div className="context-panel-actions">
            {!collapsed && stage === 'pages' && (
              <button
                type="button"
                className="context-panel-combine"
                onClick={(): void => onMerge?.()}
                title="Combine with another PDF"
                aria-label="Combine with another PDF"
                data-context-panel-combine
              >
                <GitMerge size={12} aria-hidden />
                <span>Combine…</span>
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
    </div>
  );
}
