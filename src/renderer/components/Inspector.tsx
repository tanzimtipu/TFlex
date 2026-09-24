// Phase 36 (chunk 5) — the INSPECTOR: the workspace's right panel.
//
// The Inspector replaces the retired All-tools palette as the right-hand
// surface. It is a PROP-DRIVEN presentational panel (like the PAGES
// ContextPanel): the host owns the document state, the selection and every
// handler, and this component only resolves which sections the current
// (stage, selection) pair shows and renders them.
//
// RE-PARENTING (not reimplementation):
//   - `TextPropertiesPanel` (edit/TextPropertiesPanel.tsx) is rendered
//     VERBATIM in the EDIT stage's text-object section, so every one of its
//     selectors (`[data-text-panel]`, `[data-txt-font]`, ...) and its specs
//     keep working. The inspector's stylesheet neutralises its floating-card
//     geometry while it is mounted inline (see `.inspector .text-props-float`).
//   - `OcrSuspectsPanel` (components/OcrSuspectsPanel.tsx) is re-parented into
//     the EDIT stage when the host supplies suspects; its `[data-ocr-suspects-panel]`
//     contract is untouched.
//   - `AnnotationsPanel` (annotations/AnnotationsPanel.tsx) is re-parented into
//     the REVIEW stage's document view; its `[data-annotation-panel]` contract
//     is untouched.
//
// Sections are resolved by the pure `inspectorSections(stage, kind)` so the
// per-stage/per-selection contract is unit-testable without a DOM.

import { useMemo, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { ChevronDown, Crop, Hash, RotateCw, X } from 'lucide-react';
import { GlassSidebarBody, GlassSidebarHeader } from './GlassSidebar';
import { OcrSuspectsPanel } from './OcrSuspectsPanel';
import { TextPropertiesPanel } from '../edit/TextPropertiesPanel';
import type { TextPropertiesPanelProps } from '../edit/TextPropertiesPanel';
import { formatBytes } from '../utils/formatBytes';
import type { Annotation, AnnotationPatch } from '../annotations/model';
import type { OcrSuspect } from '../../shared/types';
import type { TextBoxStylePatch } from '../../shared/types';
import type { TextStyleValues } from '../edit/textStyle';
import type { Stage } from '../state/stages';

/** What the Inspector is currently showing. `none` is the DOCUMENT
 *  inspector: nothing is selected, so the panel falls back to the
 *  document-level facts and quick actions. */
export type InspectorSelectionKind = 'none' | 'page' | 'text' | 'signature';

export interface InspectorSelection {
  kind: InspectorSelectionKind;
  /** The selection's display name, rendered after the `Inspector ·` prefix. */
  name?: string;
  /** The 1-based page a `page` selection points at. */
  page?: number;
}

/** Phase 36 (chunk 6) — the live text-object selection the host publishes to
 *  the Inspector. It carries the view's OWN handlers plus the selected
 *  object's actual style / text, so the EDIT/text section renders (and edits)
 *  the REAL selection without a second selection model. The host builds it
 *  from the DocumentView that owns the text-edit session. */
export interface InspectorTextSelection {
  /** Stable per-target key (box id / run rect / annotation id). */
  targetKey: string;
  /** Header name for the selection ("Text object" / "Text annotation"). */
  name: string;
  values: TextStyleValues;
  defaults: TextStyleValues;
  mode: 'text' | 'annotation';
  text: string | null;
  onPatch: (patch: TextBoxStylePatch) => void;
  onTextChange: (text: string) => void;
  onTextCommit: (relatedTarget?: EventTarget | null) => void;
  focusToken: number;
}

export type InspectorSectionId =
  | 'page'
  | 'on-page'
  | 'document'
  | 'text'
  | 'cropbox'
  | 'ocr'
  | 'signature'
  | 'comments'
  | 'annotations'
  | 'export';

/** The sections a (stage, selection) pair renders, in order. Pure, so the
 *  per-stage / per-selection contract is pinned by tests without a DOM. */
export function inspectorSections(
  stage: Stage,
  kind: InspectorSelectionKind,
): InspectorSectionId[] {
  switch (stage) {
    case 'pages':
      return kind === 'page' ? ['page', 'on-page', 'document'] : ['document'];
    case 'edit':
      if (kind === 'text') return ['text'];
      if (kind === 'page') return ['cropbox', 'ocr'];
      return ['document'];
    case 'review':
      // A selected signature inspects the signature; the document view
      // hosts the comments + the re-parented annotations list.
      return kind === 'signature' ? ['signature'] : ['comments', 'annotations'];
    case 'deliver':
      return ['export', 'document'];
  }
}

/** The header's selection label. */
export function inspectorSelectionLabel(selection: InspectorSelection): string {
  switch (selection.kind) {
    case 'page':
      return selection.name ?? `Page ${selection.page ?? 1}`;
    case 'text':
      return selection.name ?? 'Text object';
    case 'signature':
      return selection.name ?? 'Signature';
    case 'none':
      return selection.name ?? 'Document';
  }
}

/** Phase 36 (chunk 6) — resolve the Inspector's LIVE selection from the host's
 *  three sources: the published text-object snapshot, the armed signature and
 *  the active page. Pure, so the host wiring is pinned without mounting App. */
export function inspectorSelectionFor(args: {
  stage: Stage;
  text: InspectorTextSelection | null;
  signatureLabel: string | null;
  page: number;
}): InspectorSelection {
  if (args.stage === 'edit' && args.text !== null) {
    return { kind: 'text', name: args.text.name };
  }
  if (args.stage === 'review' && args.signatureLabel !== null) {
    return { kind: 'signature', name: args.signatureLabel };
  }
  return { kind: 'page', page: args.page };
}

/** Phase 36 (chunk 6) — map the published text-object snapshot onto the
 *  re-parented text-properties component's props (the view's OWN handlers
 *  ride the snapshot, so the Inspector never re-implements the edit path). */
export function inspectorTextPanelFor(
  text: InspectorTextSelection | null,
): TextPropertiesPanelProps | null {
  if (text === null) return null;
  return {
    open: true,
    values: text.values,
    defaults: text.defaults,
    onPatch: text.onPatch,
    mode: text.mode,
    text: text.text,
    onTextChange: text.onTextChange,
    onTextCommit: text.onTextCommit,
    focusToken: text.focusToken,
  };
}

/** DEF-321 — the single-instance rule for the text-properties UI.
 *
 *  TextPropertiesPanel has TWO mount points by design (the Phase-36 contract:
 *  "one component, two mount points — never a second properties UI"): the
 *  Inspector's EDIT/text section (the CANONICAL home) and the floating card in
 *  the DocumentView. For a GIVEN selection exactly ONE may be visible.
 *
 *  The Inspector owns the panel when its EDIT/text section will actually
 *  render: the view publishes the selection upward (`onTextSelectionChange` is
 *  wired — single mode only), the stage is EDIT (the section's only stage; see
 *  `inspectorSections`), and a text target exists (`inspectorSelectionFor`
 *  yields kind `text`). In every other case the floating card is the only
 *  properties UI and must stay: an armed text tool with nothing selected yet
 *  (pre-placement style defaults), a text annotation selected in REVIEW, or
 *  Multi Mode (where the host withdraws the published selection). */
export function inspectorOwnsTextPanel(args: {
  /** True when the view publishes its selection to the Inspector (single
   *  mode). False in Multi Mode, where the host withdraws it. */
  publishesSelection: boolean;
  /** The pane's active stage; `undefined` for a DocumentView with no stage. */
  stage: Stage | undefined;
  /** True when a text target (object / run / annotation) is selected. */
  hasTextTarget: boolean;
}): boolean {
  return args.publishesSelection && args.stage === 'edit' && args.hasTextTarget;
}

/** DEF-321 — the floating card's `open` state. The card is the pop-out of the
 *  same component, so it is MUTUALLY EXCLUSIVE with the Inspector's copy for
 *  the same selection: it opens only when the host's panel state says so AND
 *  the Inspector is not the one showing that selection. */
export function floatingTextPanelOpen(args: {
  textPanelOpen: boolean;
  inspectorOwns: boolean;
}): boolean {
  return args.textPanelOpen && !args.inspectorOwns;
}

export interface InspectorProps {
  stage: Stage;
  selection?: InspectorSelection;
  /** Optional close affordance; the host owns the panel's visibility. */
  onClose?: () => void;


  // --- PAGES / DOCUMENT ------------------------------------------------
  pageCount?: number;
  pageSize?: { widthPt: number; heightPt: number } | null;
  pageRotation?: number | null;
  pageLabel?: string | null;
  cropBox?: { x: number; y: number; width: number; height: number } | null;
  annotationCount?: number;
  formFieldCount?: number;
  fileSize?: number | null;
  documentTitle?: string | null;
  /** The page's inline rotate affordance. */
  onRotatePage?: () => void;
  /** The `renumber...` affordance (opens the existing dialog). */
  onRenumberPages?: () => void;
  /** The `crop...` affordance (opens the existing dialog). */
  onCropPages?: () => void;
  /** The document-size disclosure's two entries. */
  onOptimize?: () => void;
  onAudit?: () => void;
  onExportPages?: () => void;
  onRecognizeText?: () => void;

  // --- EDIT ------------------------------------------------------------
  /** The re-parented Phase-21/25 text-properties component. */
  textPanel?: TextPropertiesPanelProps | null;
  /** The OCR status line for the EDIT stage's page view. */
  ocrStatus?: string | null;
  /** The re-parented Phase-11 OCR-suspects component (EDIT stage). */
  ocrSuspects?: {
    suspects: readonly OcrSuspect[];
    hasRun: boolean;
    onNavigate: (suspect: OcrSuspect) => void;
    onClose: () => void;
  } | null;

  // --- REVIEW ----------------------------------------------------------
  signatureStyle?: string | null;
  signatureHint?: string | null;
  annotations?: readonly Annotation[];
  onAnnotationJump?: (page: number, id: string) => void;
  onAnnotationEdit?: (id: string, patch: AnnotationPatch) => void;
  onAnnotationDelete?: (id: string) => void;
  onExportComments?: () => void;
  onImportComments?: () => void;

  // --- DELIVER ---------------------------------------------------------
  exportFormat?: string | null;
  exportPages?: string | null;
  exportPreset?: string | null;
  onExport?: () => void;
}

/** A label-left / value-right property row. */
function Row(props: { id: string; label: string; children: ReactNode }): ReactElement {
  return (
    <div className="inspector-row" data-inspector-row={props.id}>
      <span className="inspector-row-label">{props.label}</span>
      <span className="inspector-row-value">{props.children}</span>
    </div>
  );
}

/** An inline affordance attached to a property row. `onClick` omitted means
 *  the control renders disabled (the host did not wire it) - never a silent
 *  no-op. */
function Action(props: {
  id: string;
  label: string;
  onClick?: (() => void) | undefined;
  icon?: ReactElement;
}): ReactElement {
  return (
    <button
      type="button"
      className="inspector-action"
      data-inspector-action={props.id}
      onClick={props.onClick}
      disabled={props.onClick === undefined}
      title={props.label}
    >
      {props.icon}
      <span>{props.label}</span>
    </button>
  );
}

/** A titled inspector section. */
function Section(props: {
  id: InspectorSectionId;
  title: string;
  children: ReactNode;
}): ReactElement {
  return (
    <section className="inspector-section" data-inspector-section={props.id}>
      <div className="inspector-section-title" role="heading" aria-level={2}>
        {props.title}
      </div>
      <div className="inspector-section-body">{props.children}</div>
    </section>
  );
}

/**
 * The workspace Inspector. Header (`Inspector - <selection>`), then the
 * sections the current stage/selection pair resolves to. Every control routes
 * through the host's EXISTING handler - nothing here owns document state.
 */
export function Inspector(props: InspectorProps): ReactElement {
  const {
    stage,
    selection = { kind: 'none' },
    onClose,
    pageCount = 0,
    pageSize = null,
    pageRotation = null,
    pageLabel = null,
    cropBox = null,
    annotationCount = 0,
    formFieldCount = 0,
    fileSize = null,
    documentTitle = null,
    onRotatePage,
    onRenumberPages,
    onCropPages,
    onOptimize,
    onAudit,
    onExportPages,
    onRecognizeText,
    textPanel = null,
    ocrStatus = null,
    ocrSuspects = null,
    signatureStyle = null,
    signatureHint = null,
    annotations = [],
    onExportComments,
    onImportComments,
    exportFormat = null,
    exportPages = null,
    exportPreset = null,
    onExport,
  } = props;

  // The document-size `?` disclosure (Optimize / Audit space). Local UI
  // state only - the actions themselves are the host's existing dialogs.
  const [docMenuOpen, setDocMenuOpen] = useState(false);

  const sections = useMemo(
    () => inspectorSections(stage, selection.kind),
    [stage, selection.kind],
  );

  const pageSizeText =
    pageSize === null
      ? '\u2014'
      : `${Math.round(pageSize.widthPt)} x ${Math.round(pageSize.heightPt)} pt`;
  const rotationText = pageRotation === null ? '\u2014' : `${pageRotation}\u00b0`;
  const fileSizeText = fileSize === null ? '\u2014' : formatBytes(fileSize);

  /** The page (PAGES) section: size / rotation / label / crop. */
  const renderPageSection = (): ReactElement => (
    <Section id="page" title="Page">
      <Row id="size" label="Size">
        {pageSizeText}
      </Row>
      <Row id="rotation" label="Rotation">
        <span className="inspector-inline">
          <span data-inspector-value="rotation">{rotationText}</span>
          <Action
            id="rotate"
            label="Rotate"
            onClick={onRotatePage}
            icon={<RotateCw size={12} aria-hidden />}
          />
        </span>
      </Row>
      <Row id="label" label="Label">
        <span className="inspector-inline">
          <span data-inspector-value="label">{pageLabel ?? '\u2014'}</span>
          <Action
            id="renumber"
            label={'renumber\u2026'}
            onClick={onRenumberPages}
            icon={<Hash size={12} aria-hidden />}
          />
        </span>
      </Row>
      <Row id="crop" label="Crop">
        <Action
          id="crop"
          label={'crop\u2026'}
          onClick={onCropPages}
          icon={<Crop size={12} aria-hidden />}
        />
      </Row>
    </Section>
  );
  /** PAGES - the counts that apply to the selected page. */
  const renderOnPageSection = (): ReactElement => (
    <Section id="on-page" title="On this page">
      <Row id="annotations" label="Annotations">
        {annotationCount}
      </Row>
      <Row id="form-fields" label="Form fields">
        {formFieldCount}
      </Row>
    </Section>
  );

  /** The DOCUMENT section: file size + the Optimize / Audit disclosure. */
  const renderDocumentSection = (): ReactElement => (
    <Section id="document" title="Document">
      {documentTitle !== null && (
        <Row id="title" label="Title">
          {documentTitle}
        </Row>
      )}
      <Row id="page-count" label="Pages">
        {pageCount}
      </Row>
      <Row id="file-size" label="File size">
        <span className="inspector-inline">
          <span data-inspector-value="file-size">{fileSizeText}</span>
          <button
            type="button"
            className="inspector-action inspector-disclosure"
            data-inspector-action="document-menu"
            aria-expanded={docMenuOpen}
            aria-label="Document actions"
            title="Optimize / Audit space"
            onClick={(): void => setDocMenuOpen((v) => !v)}
          >
            <ChevronDown size={12} aria-hidden />
          </button>
        </span>
      </Row>
      {docMenuOpen && (
        <div className="inspector-menu" data-inspector-menu="document" role="menu">
          <button
            type="button"
            role="menuitem"
            className="inspector-menu-item"
            data-inspector-action="optimize"
            onClick={onOptimize}
            disabled={onOptimize === undefined}
          >
            {'Optimize\u2026'}
          </button>
          <button
            type="button"
            role="menuitem"
            className="inspector-menu-item"
            data-inspector-action="audit"
            onClick={onAudit}
            disabled={onAudit === undefined}
          >
            {'Audit space\u2026'}
          </button>
        </div>
      )}
      <div className="inspector-quick-actions" data-inspector-quick-actions>
        <Action id="quick-optimize" label={'Optimize\u2026'} onClick={onOptimize} />
        <Action id="quick-audit" label={'Audit space\u2026'} onClick={onAudit} />
        <Action id="quick-export" label={'Export\u2026'} onClick={onExportPages} />
      </div>
    </Section>
  );
  /** EDIT - the re-parented text-properties component (text object selected). */
  const renderTextSection = (): ReactElement => (
    <Section id="text" title="Text">
      {textPanel !== null ? (
        <div className="inspector-text-panel" data-inspector-text-panel>
          <TextPropertiesPanel {...textPanel} open />
        </div>
      ) : null}
    </Section>
  );

  /** EDIT - the selected page's CropBox values + OCR status. */
  const renderCropBoxSection = (): ReactElement => (
    <Section id="cropbox" title="CropBox">
      {cropBox === null ? (
        <Row id="cropbox" label="Box">
          {'\u2014'}
        </Row>
      ) : (
        <>
          <Row id="cropbox-x" label="X">
            {Math.round(cropBox.x)}
          </Row>
          <Row id="cropbox-y" label="Y">
            {Math.round(cropBox.y)}
          </Row>
          <Row id="cropbox-w" label="Width">
            {Math.round(cropBox.width)}
          </Row>
          <Row id="cropbox-h" label="Height">
            {Math.round(cropBox.height)}
          </Row>
        </>
      )}
    </Section>
  );

  const renderOcrSection = (): ReactElement => (
    <Section id="ocr" title="Recognition">
      <Row id="ocr-status" label="OCR status">
        {ocrStatus ?? 'Not run'}
      </Row>
      <Action
        id="recognize"
        label={'Recognize text\u2026'}
        onClick={onRecognizeText}
      />
    </Section>
  );

  const renderSignatureSection = (): ReactElement => (
    <Section id="signature" title="Signature">
      <Row id="signature-style" label="Style">
        {signatureStyle ?? '\u2014'}
      </Row>
      <Row id="signature-hint" label="Placement">
        {signatureHint ?? 'Click a page to place'}
      </Row>
    </Section>
  );

  const renderCommentsSection = (): ReactElement => (
    <Section id="comments" title="Comments">
      <div className="inspector-quick-actions">
        <Action
          id="export-comments"
          label={'Export FDF\u2026'}
          onClick={onExportComments}
        />
        <Action
          id="import-comments"
          label={'Import FDF\u2026'}
          onClick={onImportComments}
        />
      </div>
    </Section>
  );

  const renderAnnotationsSection = (): ReactElement => (
    // Phase 36 (chunk 6) — the annotations LIST has exactly ONE home: the
    // REVIEW stage's ContextPanel body (it re-parents AnnotationsPanel). This
    // section REFERENCES that list (count + where it lives) instead of
    // rendering a second copy — never the same panel twice.
    <Section id="annotations" title="Annotations">
      <Row id="annotations-count" label="On this document">
        <span data-inspector-annotations-count>{annotations.length}</span>
      </Row>
      <p className="inspector-note" data-inspector-annotations-reference>
        The annotations list lives in the REVIEW panel.
      </p>
    </Section>
  );

  const renderExportSection = (): ReactElement => (
    <Section id="export" title="Export">
      <Row id="export-format" label="Format">
        {exportFormat ?? '\u2014'}
      </Row>
      <Row id="export-pages" label="Pages">
        {exportPages ?? 'All'}
      </Row>
      <Row id="export-preset" label="Preset">
        {exportPreset ?? 'Default'}
      </Row>
      <Action id="export" label={'Export\u2026'} onClick={onExport} />
    </Section>
  );
  const sectionBody = (id: InspectorSectionId): ReactElement | null => {
    switch (id) {
      case 'page':
        return renderPageSection();
      case 'on-page':
        return renderOnPageSection();
      case 'document':
        return renderDocumentSection();
      case 'text':
        return renderTextSection();
      case 'cropbox':
        return renderCropBoxSection();
      case 'ocr':
        return renderOcrSection();
      case 'signature':
        return renderSignatureSection();
      case 'comments':
        return renderCommentsSection();
      case 'annotations':
        return renderAnnotationsSection();
      case 'export':
        return renderExportSection();
    }
  };

  return (
    <div
      className="inspector"
      data-inspector
      data-inspector-stage={stage}
      data-inspector-selection={selection.kind}
      role="complementary"
      aria-label="Inspector"
    >
      <GlassSidebarHeader
        className="inspector-header"
        title={`Inspector \u00b7 ${inspectorSelectionLabel(selection)}`}
        actions={
          onClose !== undefined ? (
            <button
              type="button"
              className="inspector-close"
              data-inspector-close
              onClick={onClose}
              aria-label="Close inspector"
              title="Close"
            >
              <X size={16} aria-hidden />
            </button>
          ) : undefined
        }
      />
      <GlassSidebarBody className="inspector-body">
        {sections.map((id) => (
          <div key={id} className="inspector-slot" data-inspector-slot={id}>
            {sectionBody(id)}
          </div>
        ))}
        {stage === 'edit' && ocrSuspects !== null && (
          <div className="inspector-slot" data-inspector-slot="ocr-suspects">
            <OcrSuspectsPanel
              suspects={ocrSuspects.suspects}
              hasRun={ocrSuspects.hasRun}
              onNavigate={ocrSuspects.onNavigate}
              onClose={ocrSuspects.onClose}
            />
          </div>
        )}
      </GlassSidebarBody>
    </div>
  );
}
