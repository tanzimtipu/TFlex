// Phase 6 — tools palette right panel.
//
// A right-side overlay panel listing the major document tools: merge,
// split, extract, rotate, delete, sign, forms. The user opens it via
// the Tools button on the toolbar (or Ctrl+Shift+P from the menu).
//
// Layout toggle: list (one rich row per tool, the default) and grid
// (two-column cards). Phase 14 — BOTH layouts render the full
// icon + title + description triplet: the grid is never icon-only,
// it is a compact card form of the same row. The selection persists in
// AppSettings.toolsPaletteLayout, so the choice survives restart.
//
// Per the spec, every entry is a thin entry point that funnels into
// the same single-source handler the toolbar uses. The component
// does NOT contain action logic — it dispatches into the host App
// via callbacks, identical to how the toolbar works today.

import type { ReactElement } from 'react';
import { LayoutGrid, LayoutList, X } from 'lucide-react';
import { TfPanel } from './motion/TfMotion';
import { GlassSidebarBody, GlassSidebarHeader } from './GlassSidebar';
// Phase 36 (chunk 1b) — the palette no longer owns its own tool list: the
// single inventory lives in `state/toolsRegistry`, and this component reads
// label / description / icon / shortcut / order from it. Only the WIRING
// (which host callback each entry calls, and whether the host wired it at
// all) stays here, because that is the host's contract with the palette.
import {
  PALETTE_GROUPS,
  PALETTE_TOOL_IDS,
  toolById,
  type ToolEntry,
} from '../state/toolsRegistry';

export type ToolsPaletteLayout = 'list' | 'grid';

interface ToolsPaletteProps {
  layout: ToolsPaletteLayout;
  onLayoutChange: (next: ToolsPaletteLayout) => void;
  onMerge: () => void;
  onSplit: () => void;
  onExtract: () => void;
  onRotate: () => void;
  onDelete: () => void;
  onSign: () => void;
  onForms: () => void;
  onOptimize: () => void;
  onAudit: () => void;
  onClose: () => void;
  /** Phase 9 — Create-from-images. The user can invoke this from the
   *  welcome screen too; the palette entry is always enabled. */
  onCreateFromImages?: () => void;
  /** Phase 9 — Export pages. The button is enabled only when a real
   *  document is open. */
  onExportPages?: () => void;
  /** Phase 9 — Export text (TXT or RTF). */
  onExportText?: () => void;
  /** Phase 9 — Export the active document as a .docx. */
  onExportDocx?: () => void;
  /** Phase 9 — Insert blank page or pages from another PDF. */
  onInsertPages?: () => void;
  /** Phase 11 — Recognize Text (OCR) on the active document. */
  onRecognizeText?: () => void;
  /** Phase 11 — Batch OCR across every open tab. */
  onBatchOcr?: () => void;
  /** Phase 11 — Toggle the OCR suspects panel (lists low-confidence
   *  words from the most recent OCR run). The button is enabled
   *  whenever at least one tab has had OCR run on it; clicking
   *  opens the panel as a right-side overlay. */
  onOcrSuspects?: () => void;
  /** True when at least one tab has had an OCR run. Used to gate
   *  the OCR suspects button. */
  hasOcrSuspects: boolean;
  /** Phase 12 — Replace pages (swap a contiguous range with every
   *  page of another PDF, retaining the active doc's outline). */
  onReplacePages?: () => void;
  /** Phase 12 — Renumber pages (logical page labels, /PageLabels). */
  onRenumberPages?: () => void;
  /** Phase 12 — Crop pages (CropBox/TrimBox per page). */
  onCropPages?: () => void;
  /** Phase 12 — Stamp tool (built-in APPROVED / DRAFT /
   *  CONFIDENTIAL / FINAL stamps). Renders to canvas, drops on
   *  page click. */
  onStamp?: () => void;
  /** Flatten — bake filled form values into the page content.
   *  Enabled only when the active document has form fields (mirrors
   *  the toolbar's Flatten button). */
  onFlatten?: () => void;
  /** Phase 12 — Export comments to a local FDF file. */
  onExportComments?: () => void;
  /** Phase 12 — Import comments from a local FDF file. */
  onImportComments?: () => void;
  /** Phase 53 (feature G mode 2) — fill the active document's AcroForm
   *  fields from a CSV. Enabled only when the active document has form
   *  fields (the registry entry's `form-fields` precondition). */
  onFillFromCsv?: () => void;
  /** Phase 18 — Watermark (text or image overlay). Opens the
   *  watermark tool for the active document: text or image content
   *  with typography, position, opacity, tiling and page-range
   *  controls. */
  onWatermark?: () => void;
  /** True when a real document is open. The palette always renders,
   *  but every entry EXCEPT Sign is greyed out when no doc is open
   *  (Sign opens the manager modal regardless). */
  documentRequired: boolean;
  /** Whether the active document has form fields. The Forms entry is
   *  disabled when false (Flatten would no-op). */
  hasFormFields: boolean;
  /** Phase 32 — Multi Mode toggle. When wired, the Document section
   *  carries the entry; `multiModeEnabled` drives its pressed state so it
   *  always agrees with the CommandBar control. */
  onMultiMode?: () => void;
  multiModeEnabled?: boolean;
  /** Phase 14.2 FIX 5 — the layout mode the panel will EXIT with.
   *  TfPanel pins the exit transform to the mode's travel; App passes
   *  the persisted setting so the exit reads the mode the panel is
   *  actually closing in (a component-local `layout` prop goes stale
   *  for grid-mode exits). Defaults to 'list'. */
  exitLayout?: ToolsPaletteLayout;
}

/** A registry entry joined with the host's wiring for this mount. */
interface PaletteTool {
  entry: ToolEntry;
  action: () => void;
  /** Present only for toggle entries: the entry's pressed state. */
  pressed?: boolean;
}

export function ToolsPalette(props: ToolsPaletteProps): ReactElement {
  const {
    layout,
    onLayoutChange,
    onMerge,
    onSplit,
    onExtract,
    onRotate,
    onDelete,
    onSign,
    onForms,
    onOptimize,
    onAudit,
    onClose,
    onCreateFromImages,
    onExportPages,
    onExportText,
    onExportDocx,
    onInsertPages,
    onRecognizeText,
    onBatchOcr,
    onOcrSuspects,
    onReplacePages,
    onRenumberPages,
    onCropPages,
    onStamp,
    onFlatten,
    onExportComments,
    onImportComments,
    onFillFromCsv,
    onWatermark,
    hasOcrSuspects,
    documentRequired,
    hasFormFields,
    onMultiMode,
    multiModeEnabled = false,
    exitLayout = 'list',
  } = props;

  const isEntryEnabled = (id: ToolEntry['id']): boolean => {
    if (id === 'createFromImages') {
      // Create-from-images is available regardless of doc state.
      return onCreateFromImages !== undefined;
    }
    // B11 / DEF-102 — every document-required entry must bail
    // BEFORE its per-entry checks. The previous order evaluated
    // `ocrSuspects` / `batchOcr` before the `!documentRequired`
    // branch, so those two stayed enabled on doc-less tabs even
    // when the host correctly passed `documentRequired={false}`.
    // `sign` is the only entry that stays available without a
    // document (it opens the signature manager, which works
    // regardless of doc state).
    if (!documentRequired) {
      return id === 'sign';
    }
    if (id === 'ocrSuspects') {
      // OCR suspects panel needs at least one tab that has had
      // OCR run on it. The palette host owns the open flag and
      // gates availability through `hasOcrSuspects`.
      return hasOcrSuspects;
    }
    if (id === 'batchOcr') {
      // Batch OCR is reachable as long as the host wired the
      // callback; the host gates on open-tab count when the user
      // actually clicks.
      return onBatchOcr !== undefined;
    }
    if (id === 'forms') return hasFormFields;
    if (id === 'flatten') return hasFormFields && onFlatten !== undefined;
    if (id === 'exportPages') return onExportPages !== undefined;
    if (id === 'exportText') return onExportText !== undefined;
    if (id === 'exportDocx') return onExportDocx !== undefined;
    if (id === 'insertPages') return onInsertPages !== undefined;
    if (id === 'recognizeText') return onRecognizeText !== undefined;
    if (id === 'replacePages') return onReplacePages !== undefined;
    if (id === 'renumberPages') return onRenumberPages !== undefined;
    if (id === 'cropPages') return onCropPages !== undefined;
    if (id === 'stamp') return onStamp !== undefined;
    if (id === 'exportComments') return onExportComments !== undefined;
    if (id === 'importComments') return onImportComments !== undefined;
    if (id === 'fillFromCsv') return hasFormFields && onFillFromCsv !== undefined;
    if (id === 'watermark') return onWatermark !== undefined;
    return true;
  };

  // Phase 36 (chunk 1b) — the palette's WIRING table. Metadata (label,
  // description, icon, shortcut, order) comes from the registry; this table
  // only says which host callback each id runs, and an entry renders only
  // when the host actually wired it (fail loud: no dead entries).
  const wired = new Map<string, { action: () => void; pressed?: boolean }>();
  wired.set('merge', { action: onMerge });
  wired.set('split', { action: onSplit });
  wired.set('extract', { action: onExtract });
  wired.set('rotate', { action: onRotate });
  wired.set('delete', { action: onDelete });
  wired.set('sign', { action: onSign });
  wired.set('forms', { action: onForms });
  wired.set('optimize', { action: onOptimize });
  wired.set('audit', { action: onAudit });
  if (onFlatten !== undefined) wired.set('flatten', { action: onFlatten });
  if (onRecognizeText !== undefined) wired.set('recognizeText', { action: onRecognizeText });
  if (onBatchOcr !== undefined) wired.set('batchOcr', { action: onBatchOcr });
  if (onOcrSuspects !== undefined) wired.set('ocrSuspects', { action: onOcrSuspects });
  if (onCreateFromImages !== undefined) wired.set('createFromImages', { action: onCreateFromImages });
  if (onMultiMode !== undefined) {
    wired.set('multi-mode', { action: onMultiMode, pressed: multiModeEnabled });
  }
  if (onExportPages !== undefined) wired.set('exportPages', { action: onExportPages });
  if (onExportText !== undefined) wired.set('exportText', { action: onExportText });
  if (onExportDocx !== undefined) wired.set('exportDocx', { action: onExportDocx });
  if (onInsertPages !== undefined) wired.set('insertPages', { action: onInsertPages });
  if (onReplacePages !== undefined) wired.set('replacePages', { action: onReplacePages });
  if (onRenumberPages !== undefined) wired.set('renumberPages', { action: onRenumberPages });
  if (onCropPages !== undefined) wired.set('cropPages', { action: onCropPages });
  if (onStamp !== undefined) wired.set('stamp', { action: onStamp });
  if (onWatermark !== undefined) wired.set('watermark', { action: onWatermark });
  if (onExportComments !== undefined) wired.set('exportComments', { action: onExportComments });
  if (onImportComments !== undefined) wired.set('importComments', { action: onImportComments });
  if (onFillFromCsv !== undefined) wired.set('fillFromCsv', { action: onFillFromCsv });

  // The canonical palette order comes from the registry; an id the host did
  // not wire (or a stale id) simply does not render.
  const entries: PaletteTool[] = PALETTE_TOOL_IDS.flatMap((id) => {
    const wire = wired.get(id);
    const entry = toolById(id);
    if (wire === undefined || entry === undefined) return [];
    return [{ entry, action: wire.action, ...(wire.pressed === undefined ? {} : { pressed: wire.pressed }) }];
  });

  // Phase B — look up entries by id so the grouped render can lay
  // each tool under its section header without reordering the data.
  const entryById = new Map(entries.map((e) => [e.entry.id, e]));

  return (
    <TfPanel
      className={layout === 'grid' ? 'tools-palette tools-palette-grid' : 'tools-palette tools-palette-list'}
      data-tools-palette
      data-layout={layout}
      role="complementary"
      aria-label="Tools"
      // Phase 14.2 FIX 5 — the panel and the page view animate
      // TOGETHER. The page view's inset animates over a 150ms
      // cubic-bezier(0.16,1,0.3,1) ease-out (the --panel-slide-*
      // tokens); the panel used to ride the shared 280ms panel
      // SPRING, a different character and length than the page
      // slide. Overriding the transition with the same 150ms tween
      // pins both surfaces to one identical motion — they start on
      // the same frame (the open state is the same React state that
      // flips .app-main's data-tools-open attribute) and settle on
      // the same curve. Reduced motion keeps the TfMotion
      // opacity-only path (this override is bypassed there).
      transition={{ type: 'tween', duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
      exit={{
        opacity: 0,
        // TfPanel pins the exit transform to the mode's travel; the
        // persisted mode the panel is closing in decides which one.
        x: exitLayout === 'grid' ? 24 : 18,
        pointerEvents: 'none',
      }}
    >
      {/* Phase 14.1 — the shared GlassSidebar header: title left, layout
       * toggle + close right. The SAME 44px header component the Pages
       * rail uses, so both floating panels are one material system. The
       * legacy .tools-palette-header class stays for the CSS/e2e
       * contracts. */}
      <GlassSidebarHeader
        title="Tools"
        className="tools-palette-header"
        actions={
          <>
            <div className="tools-palette-toggle" role="group" aria-label="Layout">
              <button
                type="button"
                className={layout === 'list' ? 'tools-palette-toggle-btn tools-palette-toggle-active' : 'tools-palette-toggle-btn'}
                onClick={(): void => onLayoutChange('list')}
                aria-pressed={layout === 'list'}
                aria-label="List layout"
                title="List layout"
                data-tools-layout="list"
              >
                <LayoutList size={22} aria-hidden />
              </button>
              <button
                type="button"
                className={layout === 'grid' ? 'tools-palette-toggle-btn tools-palette-toggle-active' : 'tools-palette-toggle-btn'}
                onClick={(): void => onLayoutChange('grid')}
                aria-pressed={layout === 'grid'}
                aria-label="Grid layout"
                title="Grid layout"
                data-tools-layout="grid"
              >
                <LayoutGrid size={22} aria-hidden />
              </button>
            </div>
            <button
              type="button"
              className="tools-palette-close"
              onClick={onClose}
              aria-label="Close tools palette"
              title="Close"
            >
              <X size={22} aria-hidden />
            </button>
          </>
        }
      />
      <GlassSidebarBody className="tools-palette-body">
        {PALETTE_GROUPS.map((group) => {
          const groupEntries = group.entryIds
            .map((id) => entryById.get(id))
            .filter((e): e is PaletteTool => e !== undefined);
          if (groupEntries.length === 0) return null;
          return (
            <section
              key={group.id}
              className="tools-palette-group"
              data-tools-group={group.id}
            >
              <div
                className="tools-palette-group-label"
                role="heading"
                aria-level={2}
              >
                {group.label}
              </div>
              <div
                className={
                  layout === 'grid'
                    ? 'tools-palette-group-grid'
                    : 'tools-palette-group-list'
                }
              >
                {groupEntries.map((tool) => {
                  // Metadata comes from the single registry; only the
                  // wiring is local. The icon renders at the palette's
                  // established 22px ladder.
                  const { entry, action, pressed } = tool;
                  const Icon = entry.icon;
                  return (
                  <button
                    key={entry.id}
                    type="button"
                    className={
                      layout === 'grid'
                        ? 'tools-palette-entry tools-palette-entry-grid'
                        : 'tools-palette-entry tools-palette-entry-list'
                    }
                    disabled={!isEntryEnabled(entry.id)}
                    onClick={action}
                    aria-label={entry.label}
                    title={entry.description}
                    data-tool-id={entry.id}
                    {...(pressed === undefined
                      ? {}
                      : { 'aria-pressed': pressed })}
                  >
                    <span className="tools-palette-entry-icon">
                      <Icon size={22} aria-hidden />
                    </span>
                    <span className="tools-palette-entry-text">
                      <span className="tools-palette-entry-label">{entry.label}</span>
                      {/* Phase 14 — the description renders in BOTH layouts:
                       * the tools panel is never icon-only. The grid layout
                       * shows the same triplet as compact two-column cards;
                       * only the shortcut chip stays list-only. */}
                      <span className="tools-palette-entry-desc">{entry.description}</span>
                    </span>
                    {layout === 'list' && entry.shortcut !== '' && (
                      <span className="tools-palette-entry-shortcut">{entry.shortcut}</span>
                    )}
                  </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </GlassSidebarBody>
    </TfPanel>
  );
}