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
import {
  ArrowDownToLine,
  ArrowLeftRight,
  Crop,
  FileImage,
  FilePlus2,
  FileStack,
  FileText,
  GitMerge,
  Layers,
  LayoutGrid,
  LayoutList,
  MessagesSquare,
  Minimize2,
  Pen,
  PieChart,
  Replace,
  RotateCw,
  ScanText,
  Scissors,
  Stamp,
  Trash2,
  Type,
  X,
} from 'lucide-react';
import { TfPanel } from './motion/TfMotion';
import { GlassSidebarBody, GlassSidebarHeader } from './GlassSidebar';

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
  /** Phase 14.2 FIX 5 — the layout mode the panel will EXIT with.
   *  TfPanel pins the exit transform to the mode's travel; App passes
   *  the persisted setting so the exit reads the mode the panel is
   *  actually closing in (a component-local `layout` prop goes stale
   *  for grid-mode exits). Defaults to 'list'. */
  exitLayout?: ToolsPaletteLayout;
}

interface ToolEntry {
  id: string;
  label: string;
  description: string;
  icon: ReactElement;
  shortcut: string;
  action: () => void;
}

/** The palette's section headers. Entries are grouped into four
 *  quiet uppercase sections (ORGANIZE PAGES / DOCUMENT /
 *  RECOGNITION / EXPORT) so the dense tool list scans like a
 *  professional toolbox. Group and entry order is the canonical
 *  palette order (the screenshot's ORGANIZE PAGES -> DOCUMENT ->
 *  RECOGNITION ladder first, toolbelt extras after); entry ids must
 *  match `data-tool-id`. */
const TOOL_GROUPS: ReadonlyArray<{ id: string; label: string; entryIds: readonly string[] }> = [
  {
    id: 'organize',
    label: 'Organize Pages',
    entryIds: ['merge', 'split', 'extract', 'rotate', 'delete', 'insertPages', 'replacePages', 'renumberPages', 'cropPages'],
  },
  {
    id: 'document',
    label: 'Document',
    entryIds: ['sign', 'forms', 'flatten', 'optimize', 'audit', 'stamp', 'watermark', 'createFromImages'],
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
    onWatermark,
    hasOcrSuspects,
    documentRequired,
    hasFormFields,
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
    if (id === 'watermark') return onWatermark !== undefined;
    return true;
  };

  const entries: ToolEntry[] = [
    {
      id: 'merge',
      label: 'Merge PDFs',
      description: 'Combine another PDF with the active document.',
      icon: <GitMerge size={22} aria-hidden />,
      shortcut: 'Ctrl+Shift+O',
      action: onMerge,
    },
    {
      id: 'split',
      label: 'Split pages',
      description: 'Split a range of pages into a new document.',
      icon: <Scissors size={22} aria-hidden />,
      shortcut: '',
      action: onSplit,
    },
    {
      id: 'extract',
      label: 'Extract pages',
      description: 'Pull specific pages into a new document.',
      icon: <ArrowDownToLine size={22} aria-hidden />,
      shortcut: '',
      action: onExtract,
    },
    {
      id: 'rotate',
      label: 'Rotate pages',
      description: 'Rotate the selected page clockwise or counter-clockwise.',
      icon: <RotateCw size={22} aria-hidden />,
      shortcut: '',
      action: onRotate,
    },
    {
      id: 'delete',
      label: 'Delete pages',
      description: 'Remove the selected page from the document.',
      icon: <Trash2 size={22} aria-hidden />,
      shortcut: '',
      action: onDelete,
    },
    {
      id: 'sign',
      label: 'Sign',
      description: 'Draw, type, or place a saved signature.',
      icon: <Pen size={22} aria-hidden />,
      shortcut: '',
      action: onSign,
    },
    {
      id: 'forms',
      label: 'Forms',
      description: 'Fill AcroForm fields. Flatten when finished.',
      icon: <Layers size={22} aria-hidden />,
      shortcut: '',
      action: onForms,
    },
    ...(onFlatten !== undefined
      ? [{
          id: 'flatten' as const,
          label: 'Flatten',
          description: 'Bake filled form values into the page content.',
          icon: <FileStack size={22} aria-hidden />,
          shortcut: '',
          action: onFlatten,
        }]
      : []),
    {
      id: 'optimize',
      label: 'Reduce file size',
      description: 'Re-serialise the document with a compression preset.',
      icon: <Minimize2 size={22} aria-hidden />,
      shortcut: '',
      action: onOptimize,
    },
    {
      id: 'audit',
      label: 'Audit space usage',
      description: 'See a per-element breakdown of the file size.',
      icon: <PieChart size={22} aria-hidden />,
      shortcut: '',
      action: onAudit,
    },
    ...(onRecognizeText !== undefined
      ? [{
          id: 'recognizeText' as const,
          label: 'Recognize text (OCR)',
          description: 'Add a searchable text layer to a scanned PDF.',
          icon: <ScanText size={22} aria-hidden />,
          // DEF-049 — surface the renderer-side keyboard shortcut in
          // the palette so users can discover it without opening the
          // native menu. The accelerator is also wired on the menu
          // (Tools -> Recognize Text...), but Electron's menu
          // accelerator occasionally races the focused renderer and
          // drops the keystroke; the renderer handler in App.tsx is
          // the reliable path.
          shortcut: 'Ctrl+Shift+R',
          action: onRecognizeText,
        }]
      : []),
    ...(onBatchOcr !== undefined
      ? [{
          id: 'batchOcr' as const,
          label: 'Batch OCR all tabs',
          description: 'Run OCR on every open document, sequentially.',
          icon: <ScanText size={22} aria-hidden />,
          shortcut: '',
          action: onBatchOcr,
        }]
      : []),
    ...(onOcrSuspects !== undefined
      ? [{
          id: 'ocrSuspects' as const,
          label: 'OCR suspects',
          description: 'Browse low-confidence words from the last OCR run.',
          icon: <ScanText size={22} aria-hidden />,
          shortcut: '',
          action: onOcrSuspects,
        }]
      : []),
    ...(onCreateFromImages !== undefined
      ? [{
          id: 'createFromImages' as const,
          label: 'Create PDF from images',
          description: 'Combine picked images into a new PDF document.',
          icon: <FileImage size={22} aria-hidden />,
          shortcut: '',
          action: onCreateFromImages,
        }]
      : []),
    ...(onExportPages !== undefined
      ? [{
          id: 'exportPages' as const,
          label: 'Export pages as images',
          description: 'Save selected pages as PNG, JPEG, or TIFF files.',
          icon: <ArrowDownToLine size={22} aria-hidden />,
          shortcut: '',
          action: onExportPages,
        }]
      : []),
    ...(onExportText !== undefined
      ? [{
          id: 'exportText' as const,
          label: 'Export text',
          description: 'Save extracted text as .txt or .rtf.',
          icon: <FileText size={22} aria-hidden />,
          shortcut: '',
          action: onExportText,
        }]
      : []),
    ...(onExportDocx !== undefined
      ? [{
          id: 'exportDocx' as const,
          label: 'Export to Word (.docx)',
          description: 'Render every page to a single .docx document.',
          icon: <ArrowDownToLine size={22} aria-hidden />,
          shortcut: '',
          action: onExportDocx,
        }]
      : []),
    ...(onInsertPages !== undefined
      ? [{
          id: 'insertPages' as const,
          label: 'Insert pages',
          description: 'Insert a blank page, or import pages from another PDF.',
          icon: <FilePlus2 size={22} aria-hidden />,
          shortcut: '',
          action: onInsertPages,
        }]
      : []),
    ...(onReplacePages !== undefined
      ? [{
          id: 'replacePages' as const,
          label: 'Replace pages',
          description: 'Swap a contiguous range with another PDF; outline and links survive.',
          icon: <Replace size={22} aria-hidden />,
          shortcut: '',
          action: onReplacePages,
        }]
      : []),
    ...(onRenumberPages !== undefined
      ? [{
          id: 'renumberPages' as const,
          label: 'Renumber pages',
          description: 'Set logical page labels (e.g. i, ii, iii).',
          icon: <ArrowLeftRight size={22} aria-hidden />,
          shortcut: '',
          action: onRenumberPages,
        }]
      : []),
    ...(onCropPages !== undefined
      ? [{
          id: 'cropPages' as const,
          label: 'Crop pages',
          description: 'Set the CropBox/TrimBox for every page.',
          icon: <Crop size={22} aria-hidden />,
          shortcut: '',
          action: onCropPages,
        }]
      : []),
    ...(onStamp !== undefined
      ? [{
          id: 'stamp' as const,
          label: 'Stamp',
          description: 'Drop an APPROVED, DRAFT, CONFIDENTIAL or FINAL stamp.',
          icon: <Stamp size={22} aria-hidden />,
          shortcut: '',
          action: onStamp,
        }]
      : []),
    ...(onWatermark !== undefined
      ? [{
          id: 'watermark' as const,
          label: 'Watermark',
          description: 'Overlay text or an image across the selected pages.',
          icon: <Type size={22} aria-hidden />,
          shortcut: '',
          action: onWatermark,
        }]
      : []),
    ...(onExportComments !== undefined
      ? [{
          id: 'exportComments' as const,
          label: 'Export comments (FDF)',
          description: 'Save every annotation to a local .fdf file.',
          icon: <MessagesSquare size={22} aria-hidden />,
          shortcut: '',
          action: onExportComments,
        }]
      : []),
    ...(onImportComments !== undefined
      ? [{
          id: 'importComments' as const,
          label: 'Import comments (FDF)',
          description: 'Merge a local .fdf file into the active document.',
          icon: <MessagesSquare size={22} aria-hidden />,
          shortcut: '',
          action: onImportComments,
        }]
      : []),
  ];

  // Phase B — look up entries by id so the grouped render can lay
  // each tool under its section header without reordering the data.
  const entryById = new Map(entries.map((e) => [e.id, e]));

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
        {TOOL_GROUPS.map((group) => {
          const groupEntries = group.entryIds
            .map((id) => entryById.get(id))
            .filter((e): e is ToolEntry => e !== undefined);
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
                {groupEntries.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    className={
                      layout === 'grid'
                        ? 'tools-palette-entry tools-palette-entry-grid'
                        : 'tools-palette-entry tools-palette-entry-list'
                    }
                    disabled={!isEntryEnabled(entry.id)}
                    onClick={entry.action}
                    aria-label={entry.label}
                    title={entry.description}
                    data-tool-id={entry.id}
                  >
                    <span className="tools-palette-entry-icon">{entry.icon}</span>
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
                ))}
              </div>
            </section>
          );
        })}
      </GlassSidebarBody>
    </TfPanel>
  );
}