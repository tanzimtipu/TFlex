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
//   - `AnnotationsPanel` (annotations/AnnotationsPanel.tsx) is re-parented into
//     the REVIEW stage's document view; its `[data-annotation-panel]` contract
//     is untouched. The Inspector only REFERENCES that list (a count + the
//     jump), never a second copy. The OCR suspects view is entered from the
//     EDIT panel alone (section 3A ruling 4), so the Inspector mounts no copy.
//
// Sections are resolved by the pure `inspectorSections(stage, kind)` so the
// per-stage/per-selection contract is unit-testable without a DOM.

import { useMemo } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Hash, PanelRightClose, PanelRightOpen, X } from 'lucide-react';
import { GlassSidebarBody, GlassSidebarHeader } from './GlassSidebar';
import { TextPropertiesPanel } from '../edit/TextPropertiesPanel';
import type { TextPropertiesPanelProps } from '../edit/TextPropertiesPanel';
import { formatBytes } from '../utils/formatBytes';
import type { Annotation } from '../annotations/model';
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
  | 'cropbox'
  | 'signature'
  | 'comments'
  | 'annotations'
  | 'export';

/** The sections a (stage, selection) pair renders, in order. Pure, so the
 *  per-stage / per-selection contract is pinned by tests without a DOM.
 *
 *  Phase 37 (item 1) — these are the sections BELOW the text-manipulation
 *  block. When a text object is selected (EDIT or the REVIEW/annotate flow)
 *  `textPanel !== null` and the Inspector renders the re-parented
 *  `TextPropertiesPanel` at the TOP, above these sections, split by a subtle
 *  divider. The `text` section id is therefore retired from the returned lists
 *  (the panel is no longer one of the stage's sections).
 *
 *  Section 3A surface discipline:
 *   - The EDIT/page section is the CropBox ONLY (ruling 4: the OCR status is
 *     the EDIT ContextPanel's Recognition section, never repeated here).
 *   - The PAGES page section carries read-only Size / Rotation, the Label
 *     renumber affordance, and the annotations jump — no Crop row (ruling 3)
 *     and no rotate affordance (ruling 1). */
export function inspectorSections(
  stage: Stage,
  kind: InspectorSelectionKind,
): InspectorSectionId[] {
  switch (stage) {
    case 'pages':
      return kind === 'page' ? ['page', 'on-page', 'document'] : ['document'];
    case 'edit':
      // EDIT + text: the text panel rides ABOVE; the document facts stay below.
      if (kind === 'text') return ['document'];
      if (kind === 'page') return ['cropbox'];
      return ['document'];
    case 'review':
      // A selected signature inspects the signature; the document view
      // hosts the comments + the re-parented annotations list. Phase 37
      // (item 1): a selected TEXT object keeps those same below-sections and
      // lifts the text panel to the top.
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

/** DEF-329 — the PAGES Rotation row's text. `EngineState.rotations` is a
 *  QUARTER-TURN index (`(rot + delta) % 4`, see `stubEngine`), so the degrees
 *  every other consumer shows are `index * 90` (`PageView`'s `pdf-page-rot-N`
 *  class, `SideRail`'s thumbnails). The raw index with a degree sign ("1°" for
 *  a 90° page) was misinformation; the read-only value must be the real angle. */
export function rotationDegreesText(rotation: number | null): string {
  if (rotation === null || !Number.isFinite(rotation)) return '\u2014';
  const quarter = ((Math.round(rotation) % 4) + 4) % 4;
  return `${quarter * 90}\u00b0`;
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
  // Phase 37 (item 1) — the text-manipulation panel is integrated into the
  // Inspector for BOTH flows: the EDIT flow (stage `edit`) and the ANNOTATE
  // flow (stage `review`, where a text annotation is selected).
  if ((args.stage === 'edit' || args.stage === 'review') && args.text !== null) {
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

/** DEF-345 — the text-manipulation panel is shown ONLY while the RESOLVED
 *  selection is a text target. `inspectorTextPanelFor` alone returns a panel
 *  whenever a snapshot exists, independent of the stage: leaving EDIT for PAGES
 *  kept an enabled field whose own selection line read "page", and typing into
 *  it was silently discarded (a fail-loud violation). Gating on the selection
 *  kind keeps the panel and its header in agreement, and the legitimate EDIT /
 *  REVIEW-annotate flows are unchanged (they resolve kind `text`). */
export function inspectorTextPanelForSelection(
  selection: InspectorSelection,
  text: InspectorTextSelection | null,
): TextPropertiesPanelProps | null {
  return selection.kind === 'text' ? inspectorTextPanelFor(text) : null;
}


/** DEF-321 — the single-instance rule for the text-properties UI.
 *  TextPropertiesPanel has TWO mount points by design (the Phase-36 contract:
 *  "one component, two mount points — never a second properties UI"): the
 *  Inspector's EDIT/text section (the CANONICAL home) and the floating card in
 *  the DocumentView. For a GIVEN selection exactly ONE may be visible.
 *
 *  The Inspector owns the panel when its text block will actually render: the
 *  view publishes the selection upward (`onTextSelectionChange` is wired —
 *  single mode only), the stage is one of the two text flows — EDIT or the
 *  REVIEW annotate flow (Phase 37 item 1) — and a text target exists
 *  (`inspectorSelectionFor` yields kind `text`). In every other case the
 *  floating card is the only properties UI and must stay: an armed text tool
 *  with nothing selected yet (pre-placement style defaults), or Multi Mode
 *  (where the host withdraws the published selection). */
export function inspectorOwnsTextPanel(args: {
  /** True when the view publishes its selection to the Inspector (single
   *  mode). False in Multi Mode, where the host withdraws it. */
  publishesSelection: boolean;
  /** The pane's active stage; `undefined` for a DocumentView with no stage. */
  stage: Stage | undefined;
  /** True when a text target (object / run / annotation) is selected. */
  hasTextTarget: boolean;
}): boolean {
  return (
    args.publishesSelection &&
    (args.stage === 'edit' || args.stage === 'review') &&
    args.hasTextTarget
  );
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
  /** Phase 37 (items 3 + 6) — the responsive collapse signal. `true` when the
   *  Inspector is collapsed, either by the user or by the Action Dock's ladder.
   *  The host owns the state and resolves it as `userCollapsed || rung` (see
   *  `inspectorCollapsedFor`); the control below toggles ONLY the user's own
   *  preference, so a manual expand can never fight the ladder. */
  collapsed?: boolean;
  onToggleCollapsed?: () => void;


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
  /** Section 3A ruling 5: File size is a READ-ONLY value here; the Optimize /
   *  Audit affordances live ONLY in the DELIVER stage (the dock + the panel's
   *  pre-flight), so the Inspector wires no handler for them. */
  /** The `renumber…` affordance (opens the existing dialog). The Inspector's
   *  `Label · renumber…` is its ONLY home (ruling 2). */
  onRenumberPages?: () => void;
  /** Section 3A ruling 6: the "Annotations: N" count is read-only but JUMPS
   *  to the REVIEW stage when clicked — the host switches the focused pane's
   *  stage (`stageReducer` `set`). The ONE documented exception to the
   *  no-affordance rule for inspector values. */
  onJumpToReview?: () => void;

  // --- EDIT ------------------------------------------------------------
  /** The re-parented Phase-21/25 text-properties component. */
  textPanel?: TextPropertiesPanelProps | null;

  // --- REVIEW ----------------------------------------------------------
  signatureStyle?: string | null;
  signatureHint?: string | null;
  /** The annotations list, REFERENCED here as a read-only count (the list's one
   *  home is the REVIEW panel; section 3A ruling 6). */
  annotations?: readonly Annotation[];
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
    collapsed = false,
    onToggleCollapsed,
    pageCount = 0,
    pageSize = null,
    pageRotation = null,
    pageLabel = null,
    cropBox = null,
    annotationCount = 0,
    formFieldCount = 0,
fileSize = null,
    documentTitle = null,
    onRenumberPages,
    onJumpToReview,
    textPanel = null,
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

  const sections = useMemo(
    () => inspectorSections(stage, selection.kind),
    [stage, selection.kind],
  );

  const pageSizeText =
    pageSize === null
      ? '\u2014'
      : `${Math.round(pageSize.widthPt)} x ${Math.round(pageSize.heightPt)} pt`;
  const rotationText = rotationDegreesText(pageRotation);
  const fileSizeText = fileSize === null ? '\u2014' : formatBytes(fileSize);

/** The page (PAGES) section: read-only Size / Rotation + the Label
   *  renumber affordance. Section 3A: Rotation is a VALUE (no ↻ — ruling 1),
   *  there is no Crop row (ruling 3), and Label · renumber… is its only home
   *  (ruling 2). */
  const renderPageSection = (): ReactElement => (
    <Section id="page" title="Page">
      <Row id="size" label="Size">
        {pageSizeText}
      </Row>
      <Row id="rotation" label="Rotation">
        <span data-inspector-value="rotation">{rotationText}</span>
      </Row>
      <Row id="label" label="Label">
        <span className="inspector-inline">
          <span data-inspector-value="label">{pageLabel ?? '\u2014'}</span>
          <Action
            id="renumber"
            label={'rename\u2026'}
            onClick={onRenumberPages}
            icon={<Hash size={12} aria-hidden />}
          />
        </span>
      </Row>
    </Section>
  );
  /** PAGES - the counts that apply to the selected page. The annotations
   *  count is read-only but JUMPS to the REVIEW stage on click (section 3A
   *  ruling 6 — the ONE documented inspector-value exception); Form fields
   *  stays a plain value. */
  const renderOnPageSection = (): ReactElement => (
    <Section id="on-page" title="On this page">
      <Row id="annotations" label="Annotations">
        <button
          type="button"
          className="inspector-link"
          data-inspector-action="jump-to-review"
          onClick={onJumpToReview}
          disabled={onJumpToReview === undefined}
          title="Show the annotations list in the REVIEW panel"
        >
          <span data-inspector-annotations-count>{annotationCount}</span>
        </button>
      </Row>
      <Row id="form-fields" label="Form fields">
        {formFieldCount}
      </Row>
    </Section>
  );

  /** The DOCUMENT section: read-only facts. Section 3A ruling 5 — File size
   *  is a VALUE with NO "▾" affordance, and Optimize / Audit live only in the
   *  DELIVER stage (the dock + the panel's pre-flight). */
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
        <span data-inspector-value="file-size">{fileSizeText}</span>
      </Row>
    </Section>
  );
  /** Phase 37 (item 1) — the text-manipulation block, rendered at the TOP of
   *  the Inspector for both flows (EDIT and the REVIEW/annotate flow). The
   *  re-parented component keeps every selector; a subtle divider separates it
   *  from the stage sections below, and the whole body column scrolls. */
  const renderTextBlock = (): ReactElement | null =>
    textPanel === null ? null : (
      <>
        <div className="inspector-text-panel" data-inspector-text-panel data-inspector-text-top>
          <TextPropertiesPanel {...textPanel} open />
        </div>
        <div
          className="inspector-divider"
          data-inspector-divider
          role="separator"
          aria-orientation="horizontal"
        />
      </>
    );

  /** EDIT - the selected page's CropBox values. Section 3A ruling 4: no OCR
   *  status here — the EDIT ContextPanel's Recognition section is its home. */
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
      case 'cropbox':
        return renderCropBoxSection();
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

  /** Phase 37 (item 3) — the expand/collapse control. ONE control, rendered in
   *  both states (the header when expanded, the strip when collapsed), wired to
   *  the host's `onToggleCollapsed`. It toggles the USER's preference only; the
   *  ladder's rung 1 is OR-ed by the host, so a manual expand can never fight
   *  the ladder. */
  const collapseControl = (
    <button
      type="button"
      className="inspector-collapse-toggle"
      data-inspector-collapse
      onClick={onToggleCollapsed}
      disabled={onToggleCollapsed === undefined}
      aria-expanded={!collapsed}
      aria-label={collapsed ? 'Expand inspector' : 'Collapse inspector'}
      title={collapsed ? 'Expand inspector' : 'Collapse inspector'}
    >
      {collapsed ? (
        <PanelRightOpen size={16} aria-hidden />
      ) : (
        <PanelRightClose size={16} aria-hidden />
      )}
    </button>
  );

  return (
    <div
      className="inspector"
      data-inspector
      data-inspector-stage={stage}
      data-inspector-selection={selection.kind}
      data-inspector-collapsed={collapsed ? 'true' : 'false'}
      role="complementary"
      aria-label="Inspector"
    >
      {collapsed ? (
        // Phase 37 (item 3) — the collapsed Inspector is a narrow strip that
        // keeps the expand control reachable (mirrors the pages panel's ruler
        // strip). The host gives it its own inset width, so it never overlaps
        // the canvas.
        <div className="inspector-collapsed-strip" data-inspector-collapsed-strip>
          {collapseControl}
        </div>
      ) : (
        <>
          <GlassSidebarHeader
            className="inspector-header"
            title={`Inspector \u00b7 ${inspectorSelectionLabel(selection)}`}
            actions={
              <div className="inspector-header-actions">
                {collapseControl}
                {onClose !== undefined ? (
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
                ) : null}
              </div>
            }
          />
          <GlassSidebarBody className="inspector-body">
            {/* Phase 37 (item 1) — the text-manipulation block leads the column,
                with the stage sections below the divider. */}
            {renderTextBlock()}
            {sections.map((id) => (
              <div key={id} className="inspector-slot" data-inspector-slot={id}>
                {sectionBody(id)}
              </div>
            ))}
          </GlassSidebarBody>
        </>
      )}
    </div>
  );
}
