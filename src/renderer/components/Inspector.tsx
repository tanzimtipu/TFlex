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

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { ChevronLeft, ChevronRight, MousePointerClick, X } from 'lucide-react';
import { Icon } from '../icons/Icon';
import { Button, IconButton } from './Button';
import { EmptyState } from './EmptyState';
import { GlassSidebarBody } from './GlassSidebar';
import { ActionList, PanelEmptyState, PanelSection, PanelShell, PropertyRow, ScopedHeader } from './panels/PanelPrimitives';
import {
  DEFAULT_EXPORT_CONFIG_FORMAT,
  EXPORT_CONFIG_FORMATS,
  exportConfigGate,
  exportDefaultName,
  exportFidelityNotes,
  exportFormatOption,
  exportImageOutputSummary,
  exportPrimaryLabel,
  exportRangeText,
  exportScopeLabel,
  validateExportRange,
  type ExportConfigFormat,
  type ExportPageScope,
} from './exportConfig';
import { ExportFidelityNotes } from './ExportFidelityNotes';
import type { ExportDraft } from '../state/exportDraft';
import {
  clampExportImageDpi,
  DEFAULT_EXPORT_IMAGE_DPI,
} from '../state/preferences';
import type { ExportFormat } from '../../shared/export';
import { TextPropertiesPanel } from '../edit/TextPropertiesPanel';
import type { TextPropertiesPanelProps } from '../edit/TextPropertiesPanel';
import type { SpellCheckState } from '../spell/useSpellCheck';
import { OcrSuspectsPanel } from './OcrSuspectsPanel';
import type { OcrSuspectsPanelProps } from './OcrSuspectsPanel';
import { formatBytes } from '../utils/formatBytes';
import { kindLabel, type Annotation, type AnnotationPatch, type PageRect } from '../annotations/model';
import AnnColorBox from '../annotations/AnnColorBox';
import type {
  BatesInfo,
  SignaturePlacement,
  TextBoxStylePatch,
  FormFillReport,
  WatermarkInfo,
} from '../../shared/types';
import type { ReviewElementRef } from './ReviewElementsPanel';
import { ReviewElementsPanel } from './ReviewElementsPanel';
import { FormFillReportSummary } from '../forms/FormsOverlay';
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
  /** Phase 80 (F1) — the Format Painter state + gestures published by the
   *  DocumentView that owns the text session. Optional so existing snapshot
   *  builders and tests stay valid. */
  painterArmed?: boolean;
  painterHint?: string | null;
  canPickUpPainter?: boolean;
  onArmPainter?: () => void;
  onCancelPainter?: () => void;
  /** Phase 82 — the offline spell-check state carried from the DocumentView
   *  that owns the text session, so the re-parented text panel renders the
   *  underline toggle. Optional so existing snapshot builders stay valid. */
  spellCheck?: SpellCheckState;
  /** Phase 117 (chunk D) — the selected object's LIVE page-point geometry, so
   *  the Inspector can expose numeric X / Y / width / height fields (page
   *  points) plus keyboard nudge that route to the SAME overlay move / resize
   *  handler the drag path uses. Optional: the host publishes it for a text
   *  box / image selection when a real rect exists. When the rect is absent
   *  the geometry row renders DISABLED with a truthful reason — the Inspector
   *  never invents geometry. */
  geometry?: InspectorEditGeometry;
}

/** Phase 117 (chunk D) — the kinds whose numeric geometry the Inspector can
 *  expose. Text runs are deliberately NOT here: they have no engine rect the
 *  Inspector may move numerically (their edit op is text-only). */
export type InspectorEditGeometryKind = 'textBox' | 'image';

export interface InspectorEditGeometry {
  kind: InspectorEditGeometryKind;
  /** The live page-point rect, or absent when the host has no live rect for
   *  this kind (the row then renders disabled, never fabricated). */
  rect?: { x: number; y: number; width: number; height: number };
  /** Route a committed numeric change to the SAME overlay handler the drag
   *  path uses (page points, never rounded to screen pixels). */
  onChange?: (rect: { x: number; y: number; width: number; height: number }) => void;
}

/** Phase 117 (chunk D) — the numeric fields the geometry row exposes. */
export type InspectorGeometryField = 'x' | 'y' | 'width' | 'height';

/** Phase 117 (chunk D) — apply a keyboard nudge (page points) to one field.
 *  A position field shifts x / y; a size field grows / shrinks the side,
 *  clamped to a 1 pt minimum so a nudge can never invert the rect. Pure, so
 *  the keyboard alternative is unit-testable without a DOM. */
export function applyGeometryNudge(
  rect: { x: number; y: number; width: number; height: number },
  field: InspectorGeometryField,
  delta: number,
): { x: number; y: number; width: number; height: number } {
  const next = { ...rect };
  if (field === 'x') next.x += delta;
  else if (field === 'y') next.y += delta;
  else if (field === 'width') next.width = Math.max(1, next.width + delta);
  else next.height = Math.max(1, next.height + delta);
  return next;
}

export type InspectorSectionId =
  | 'page'
  | 'on-page'
  | 'document'
  | 'cropbox'
  | 'signature'
  | 'annotations'
  | 'review-elements'
  | 'export'
  | 'ocr-suspects';

/** TFL-1116 C11 (R17) — the Inspector's explicit render STATE, resolved from
 *  the stage, the live selection and the two session signals. The state — not
 *  the raw selection kind — decides which sections render, so entering EDIT
 *  with Select (a `page` selection, no crop session) can no longer inherit an
 *  empty CropBox. */
export type InspectorStateKind =
  | 'none'
  | 'page'
  | 'text'
  | 'signature'
  | 'crop'
  | 'ocr-review'
  | 'export';

/** TFL-1116 C11 (R17) — resolve the explicit Inspector state. Precedence is
 *  deliberate and documented: an OPEN OCR review surface wins (it is a scoped
 *  working state), then an ACTIVE crop session (its geometry is what the user
 *  is manipulating), then a selected object (text / image / annotation or a
 *  signature), then the DELIVER export surface, then page facts for a page
 *  selection, and finally the document-only `none`. Pure, so the truth table is
 *  pinned without a DOM. */
export function resolveInspectorState(args: {
  stage: Stage;
  selection: InspectorSelection;
  cropActive?: boolean;
  ocrSuspectsOpen?: boolean;
}): InspectorStateKind {
  if (args.ocrSuspectsOpen === true) return 'ocr-review';
  // The crop session belongs to EDIT only: a cropBox published while another
  // stage is active must never hijack that stage's sections.
  if (args.cropActive === true && args.stage === 'edit') return 'crop';
  if (args.selection.kind === 'text') return 'text';
  if (args.selection.kind === 'signature') return 'signature';
  if (args.stage === 'deliver') return 'export';
  if (args.selection.kind === 'page') return 'page';
  return 'none';
}

/** The sections a resolved Inspector STATE renders, in order, for a stage.
 *  Pure, so the contract is pinned by tests without a DOM.
 *
 *  Phase 37 (item 1) — these are the sections BELOW the text-manipulation
 *  block. When a text object is selected (EDIT or the REVIEW/annotate flow)
 *  `textPanel !== null` and the Inspector renders the re-parented
 *  `TextPropertiesPanel` at the TOP, above these sections, split by a subtle
 *  divider. The `text` section id is therefore retired from the returned lists
 *  (the panel is no longer one of the stage's sections).
 *
 *  R17 surface discipline:
 *   - The CropBox section renders ONLY in the `crop` state (an active crop
 *     session). The default EDIT `page` state offers page facts + guidance.
 *   - The PAGES page state carries read-only Size / Rotation, the Label
 *     renumber affordance, and the annotations jump — no Crop row (ruling 3)
 *     and no rotate affordance (ruling 1). */
export function inspectorSectionsForState(
  state: InspectorStateKind,
  stage: Stage,
): InspectorSectionId[] {
  switch (state) {
    case 'ocr-review':
      // The suspects view is rendered separately (its own slot) so it can be
      // absent when the host has no review open; no stage sections accompany
      // it — the review IS the current scoped state.
      return [];
    case 'crop':
      return ['cropbox'];
    case 'text':
      // The text panel rides ABOVE; the stage content stays below.
      return stage === 'review' ? ['review-elements'] : ['document'];
    case 'signature':
      return ['signature'];
    case 'export':
      return ['export', 'document'];
    case 'page':
      return stage === 'pages' ? ['page', 'on-page', 'document'] : ['page', 'document'];
    case 'none':
      return stage === 'review' ? ['review-elements'] : ['document'];
  }
}

/** The sections a (stage, selection) pair renders, in order. A thin wrapper
 *  over the explicit-state model with no session signals: it resolves to the
 *  default state for that pair (no active crop, no OCR review). Kept as the
 *  documented pure per-stage/per-selection contract. */
export function inspectorSections(
  stage: Stage,
  kind: InspectorSelectionKind,
): InspectorSectionId[] {
  return inspectorSectionsForState(
    resolveInspectorState({ stage, selection: { kind } }),
    stage,
  );
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

/** Phase 112 (TFL-854 C2) — the header scope name. A multi-page thumbnail
 *  selection names the SCOPE ("N pages selected") instead of the single page
 *  the canvas happens to show; every other selection keeps the Phase-36
 *  label. Pure, so the scope contract is pinned without a DOM. */
export function inspectorScopeLabel(
  selection: InspectorSelection,
  pageSelection: readonly number[] | null | undefined,
): string {
  if (pageSelection !== null && pageSelection !== undefined && pageSelection.length > 1) {
    return `${pageSelection.length} pages selected`;
  }
  return inspectorSelectionLabel(selection);
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
  /** Phase 116 (TFL-1228) — true when a REVIEW annotation (ANY kind) is
   *  selected. A shape annotation (ink / rect) publishes no text-panel
   *  snapshot, so without this signal the selection fell back to `page` and
   *  the review-elements section (and its annotation scope) never rendered.
   *  Optional so every existing caller/test stays valid. */
  annotationSelected?: boolean;
}): InspectorSelection {
  // Phase 37 (item 1) — the text-manipulation panel is integrated into the
  // Inspector for BOTH flows: the EDIT flow (stage `edit`) and the ANNOTATE
  // flow (stage `review`, where a text annotation is selected).
  if ((args.stage === 'edit' || args.stage === 'review') && args.text !== null) {
    return { kind: 'text', name: args.text.name };
  }
  // Phase 116 (TFL-1228) — a selected annotation without a text snapshot still
  // resolves to the text scope so the review-elements annotation panel renders
  // (the text-properties block stays absent: `text` is null).
  if (args.stage === 'review' && args.annotationSelected === true) {
    return { kind: 'text', name: 'Text annotation' };
  }
  if (args.stage === 'review' && args.signatureLabel !== null) {
    return { kind: 'signature', name: args.signatureLabel };
  }
  return { kind: 'page', page: args.page };
}

/** Phase 112 (TFL-854 C4) — the annotation the REVIEW inspector inspects.
 *  Phase 116 (TFL-1228) — the host publishes the selected annotation's REAL id
 *  on a dedicated `selectedAnnotationId` prop for EVERY annotation kind (the
 *  shape kinds publish no text-panel snapshot), and still publishes a
 *  text-panel snapshot (mode `annotation`) for the text kinds. Either source
 *  resolves the REAL annotation from the document list; the Inspector never
 *  guesses a row. `null` when nothing is selected (the section then shows a
 *  short hint, not a duplicate list). Pure, so the contract is pinned without
 *  mounting App. */
export function selectedReviewAnnotation(
  selection: InspectorSelection,
  textPanel: ReviewAnnotationSelectionSource | null,
  annotations: readonly Annotation[],
  selectedAnnotationId?: string | null,
): Annotation | null {
  // The host's dedicated selected-annotation publish is authoritative when it
  // supplies one: it names the REAL annotation id for ANY kind, including the
  // shape annotations (ink / rect) that publish no text-panel snapshot. The
  // published id may carry the `annotation:` target-key prefix, so it is
  // normalized before the lookup.
  if (selectedAnnotationId !== undefined && selectedAnnotationId !== null) {
    const id = stripAnnotationKeyPrefix(selectedAnnotationId);
    return annotations.find((a) => a.id === id) ?? null;
  }
  if (selection.kind !== 'text') return null;
  if (textPanel === null || textPanel.mode !== 'annotation') return null;
  const targetKey = textPanel.targetKey;
  if (targetKey === undefined) return null;
  // Phase 116 (TFL-1228) — the host publishes the text-annotation snapshot's
  // target key as `annotation:<id>`; the raw document id has no prefix. Strip
  // the optional prefix so the annotation resolves (the hand-built unit
  // snapshots use the raw id and stay valid).
  return annotations.find((a) => a.id === stripAnnotationKeyPrefix(targetKey)) ?? null;
}

/** Phase 116 (TFL-1228) — strip the optional `annotation:` target-key prefix
 *  from a published selection key, yielding the raw document annotation id. */
function stripAnnotationKeyPrefix(key: string): string {
  const prefix = 'annotation:';
  return key.startsWith(prefix) ? key.slice(prefix.length) : key;
}

/** Phase 112 (TFL-854 C2 follow-up) — resolve the Inspector's page size for a
 *  1-based page number. It prefers the host's LIVE measured sizes (published
 *  upward by the mounted PageViews, so a normally-opened document has them
 *  without opening the Crop dialog), then falls back to the seeded
 *  `activePageSizes` map (the Crop path). Unknown stays `null` so the Size row
 *  reads "Not available" — never a guessed A4 and never 0. Pure, so the host
 *  wiring is pinned without mounting App. */
export function resolveInspectorPageSize(
  pageNumber: number,
  liveSizes: ReadonlyMap<number, { w: number; h: number }> | null | undefined,
  seededSizes: Readonly<Record<number, { widthPt: number; heightPt: number }>>,
): { widthPt: number; heightPt: number } | null {
  const live = liveSizes?.get(pageNumber);
  if (live !== undefined) return { widthPt: live.w, heightPt: live.h };
  return seededSizes[pageNumber] ?? null;
}

/** Phase 112 (TFL-854 C4) — the text-panel props plus the selection identity
 *  the REVIEW inspector needs. The identity rides the SAME snapshot the host
 *  already publishes upward (`InspectorTextSelection`), so the Inspector can
 *  resolve the REAL selected annotation from the document list without a second
 *  selection model and without the host changing its wiring. Both extras are
 *  optional so an existing hand-built props literal stays valid. */
export type InspectorTextPanel = TextPropertiesPanelProps & {
  targetKey?: string;
  name?: string;
  /** Phase 117 (chunk D) — the selected object's live geometry, threaded
   *  through from the published text snapshot so the Inspector renders the
   *  numeric geometry rows for a selected text box. */
  geometry?: InspectorEditGeometry;
};

/** The minimal selected-target shape the REVIEW inspector resolves an
 *  annotation from: the panel mode plus the stable target key. */
export interface ReviewAnnotationSelectionSource {
  mode?: 'text' | 'annotation';
  targetKey?: string;
}

/** Phase 36 (chunk 6) — map the published text-object snapshot onto the
 *  re-parented text-properties component's props (the view's OWN handlers
 *  ride the snapshot, so the Inspector never re-implements the edit path). */
export function inspectorTextPanelFor(
  text: InspectorTextSelection | null,
): InspectorTextPanel | null {
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
    painterArmed: text.painterArmed,
    painterHint: text.painterHint,
    canPickUpPainter: text.canPickUpPainter,
    onArmPainter: text.onArmPainter,
    onCancelPainter: text.onCancelPainter,
    spellCheck: text.spellCheck,
    targetKey: text.targetKey,
    name: text.name,
    geometry: text.geometry,
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
): InspectorTextPanel | null {
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

/** Phase 112 (C5) — the export configuration the panel has prepared. The host
 *  routes it to the EXISTING export flow (the raster dialog, the text/docx
 *  dialog or the office writer); the panel never reimplements export. */
export interface InspectorExportRequest {
  format: ExportConfigFormat;
  /** The validated, parsed 1-based pages (empty when the flow exports all). */
  range: number[];
  dpi: number;
  /** The prepared output name derived from the real source name. */
  outputName: string;
}

/** Live status reported by the host's running export, rendered honestly. */
export interface InspectorExportStatus {
  state: 'running' | 'error' | 'success';
  message?: string;
  current?: number;
  total?: number;
}

/** Per-format availability of the optional `window.tflex.export` members. */
export interface InspectorExportBridge {
  xlsx: boolean;
  pptx: boolean;
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
  /** TFL-1117 (R01) — render as the compact OVERLAY drawer instead of the
   *  docked panel. The host resolves this below the ladder's Inspector
   *  threshold; the drawer overlays the canvas (no reserved inset), closes on
   *  Escape and on the existing `onClose` control, and returns focus to its
   *  Expand opener once the collapsed strip remounts. */
  drawer?: boolean;


  // --- PAGES / DOCUMENT ------------------------------------------------
  pageCount?: number;
  pageSize?: { widthPt: number; heightPt: number } | null;
  pageRotation?: number | null;
  pageLabel?: string | null;
  /** Phase 112 (TFL-854 C2) — the host's thumbnail multi-select (VISIBLE
   *  1-based pages). More than one entry switches the header scope to
   *  "N pages selected" and lets the mixed flags below render "Mixed". */
  pageSelection?: readonly number[] | null;
  /** True when the selected pages DISAGREE on that value. The host computes
   *  it from the authoritative per-page sources; the Inspector never guesses. */
  pageSizeMixed?: boolean;
  pageRotationMixed?: boolean;
  pageLabelMixed?: boolean;
  cropBox?: { x: number; y: number; width: number; height: number } | null;
  /** TFL-1116 C11 (R17) — true while a crop SESSION is active (the host's crop
   *  workflow is engaged). The CropBox section renders ONLY in this state; a
   *  plain page selection in EDIT shows page facts + selection guidance, never
   *  an empty CropBox. A non-null `cropBox` also counts as an active crop (the
   *  geometry is present), so existing hosts that publish the box keep working. */
  cropActive?: boolean;
  annotationCount?: number;
  formFieldCount?: number;
  /** Phase 59 item 4 — the most recent native-fill report. When present and
   *  non-empty, the Inspector renders a compact dismissible summary naming
   *  each skipped field and the reason. */
  formFillReport?: FormFillReport[];
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
  /** The re-parented Phase-21/25 text-properties component. Phase 112 (C4)
   *  carries the selection identity (targetKey/name) so the REVIEW inspector
   *  resolves the selected annotation without a second selection model. */
  textPanel?: InspectorTextPanel | null;
  /** Phase 117 (chunk D) — the numeric geometry of a selected IMAGE placement
   *  (an image has no text-panel snapshot, so it travels on its own prop).
   *  The host publishes it when a live rect exists; the same `data-edit-geometry`
   *  row renders and routes a change to the overlay's move / resize handler. */
  editGeometry?: InspectorEditGeometry | null;
  /** Phase 51 (item 10) — the re-parented OCR suspects view. Non-null only
   *  while the host has the suspects panel open; it renders as an Inspector
   *  section (the product home) instead of the retired top bar. */
  ocrSuspects?: OcrSuspectsPanelProps | null;

  // --- REVIEW ----------------------------------------------------------
  signatureStyle?: string | null;
  signatureHint?: string | null;
  /** The active document's annotations. Phase 90 (TFL-509-C1) — the REVIEW
   *  stage re-parents the unified `ReviewElementsPanel`, whose Annotations
   *  category consumes this list plus the three handlers below. */
  annotations?: readonly Annotation[];
  /** Phase 116 (TFL-1228) — the REAL id of the selected REVIEW annotation
   *  (ANY kind), published by the owning DocumentView. Shape annotations
   *  (ink / rect) publish no text-panel snapshot, so this is the only source
   *  that can resolve them; it also carries the text kinds. Optional so every
   *  existing host/test stays valid. */
  selectedAnnotationId?: string | null;
  onJumpToAnnotation?: ((page: number, id: string) => void) | null;
  onEditAnnotation?: ((id: string, patch: AnnotationPatch) => void) | null;
  onDeleteAnnotation?: ((id: string) => void) | null;
  /** Phase 116 (chunk E) — the active theme bucket the selected annotation's
   *  colour box edits. Optional; absent falls back to 'light'. */
  annotationTheme?: 'light' | 'dark';
  /** Phase 90 (TFL-509-C1) — the unified review list's non-annotation sources
   *  and handlers (Ruling 6: BOTH panels render it). */
  bates?: readonly BatesInfo[];
  watermarks?: readonly WatermarkInfo[];
  signatures?: readonly SignaturePlacement[];
  onSelectReviewElement?: ((el: ReviewElementRef) => void) | null;
  onEditReviewElement?: ((el: ReviewElementRef) => void) | null;
  onDeleteReviewElement?: ((el: ReviewElementRef) => void) | null;
  reviewErrorFor?: ((el: ReviewElementRef) => string | null) | null;

  // --- DELIVER / EXPORT CONFIGURATION ---------------------------------
  /** Phase 112 (C5) — the format the export surface opens on. The shipped
   *  default is the persisted image format; the panel lets the user switch. */
  exportFormat?: ExportConfigFormat | null;
  /** Legacy display values, preserved for the Phase-36 contract. */
  exportPages?: string | null;
  exportPreset?: string | null;
  /** The active document's display name (for the prepared output name). */
  exportSourceName?: string | null;
  /** The persisted image DPI the options default to. */
  exportDpi?: number;
  /** TFL-1119 (TFL-1116 C2) - the document-scoped export draft. When provided,
   *  this CONTROLLED value is the source of truth for the Deliver export
   *  surface, so a collapse remount, a stage switch or a tab switch re-renders
   *  from the stored draft instead of resetting to the persisted default. */
  exportDraft?: ExportDraft;
  /** Fired with the changed fields when the user edits the controlled draft. */
  onExportDraftChange?: (patch: Partial<ExportDraft>) => void;
  /** The page the "Current page" scope targets. */
  exportCurrentPage?: number;
  /** Per-format office bridge availability (`window.tflex.export`). */
  exportBridge?: InspectorExportBridge | null;
  /** Fired when the user changes the prepared format. */
  onExportFormatChange?: (format: ExportConfigFormat) => void;
  /** Launches the host's EXISTING export flow for the prepared configuration. */
  onExportRun?: (request: InspectorExportRequest) => void;
  /** Legacy DELIVER submit (the Phase-36 hook); used when `onExportRun` is
   *  absent so the existing spec keeps calling the same handler. */
  onExport?: () => void;
  /** Live progress / failure / success from the host's running export. */
  exportStatus?: InspectorExportStatus | null;
}

/** A label-left / value-right property row. Phase 112 (C2) — the shape is the
 *  shared PropertyRow primitive; the legacy `inspector-row*` classes and the
 *  `data-inspector-row` hook are kept so existing CSS/specs resolve. */
function Row(props: { id: string; label: string; children: ReactNode }): ReactElement {
  return (
    <PropertyRow
      className="inspector-row"
      labelClassName="inspector-row-label"
      valueClassName="inspector-row-value"
      data-inspector-row={props.id}
      label={props.label}
    >
      {props.children}
    </PropertyRow>
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
    <Button
      intent="secondary"
      kind="action"
      density="standard"
      className="inspector-action"
      data-inspector-action={props.id}
      onClick={props.onClick}
      disabled={props.onClick === undefined}
      title={props.label}
    >
      {props.icon}
      <span>{props.label}</span>
    </Button>
  );
}

/** A titled inspector section. Phase 105+ (C1) — the shape is the shared
 *  PanelSection primitive; the legacy inspector classes and the
 *  `data-inspector-section` hook are kept so existing CSS/specs resolve. */
function Section(props: {
  id: InspectorSectionId;
  title: string;
  children: ReactNode;
}): ReactElement {
  return (
    <PanelSection
      className="inspector-section"
      titleClassName="inspector-section-title"
      bodyClassName="inspector-section-body"
      data-inspector-section={props.id}
      title={props.title}
    >
      {props.children}
    </PanelSection>
  );
}

/** Phase 117 (chunk D) — the numeric geometry row for a selected text box /
 *  image. Page points, never rounded. Each field commits a typed value and an
 *  arrow-key nudge through the SAME `onChange` the overlay's drag path uses;
 *  when the host publishes no live rect the row renders DISABLED with the
 *  truthful reason instead of inventing values. */
function EditGeometryFields(props: { geometry: InspectorEditGeometry }): ReactElement {
  const { geometry } = props;
  const rect = geometry.rect;
  const onChange = geometry.onChange;
  const kindWord = geometry.kind === 'image' ? 'image' : 'text box';
  if (rect === undefined || onChange === undefined) {
    return (
      <PanelSection
        className="inspector-section"
        titleClassName="inspector-section-title"
        bodyClassName="inspector-section-body"
        title="Geometry"
        data-inspector-section="edit-geometry"
        data-edit-geometry
        data-edit-geometry-kind={geometry.kind}
        data-edit-geometry-disabled
      >
        <p className="inspector-note" data-edit-geometry-reason>
          {`No live selection rectangle is available for this ${kindWord}, so X / Y / width / height cannot be shown.`}
        </p>
      </PanelSection>
    );
  }
  const fields: readonly { field: InspectorGeometryField; label: string }[] = [
    { field: 'x', label: 'X' },
    { field: 'y', label: 'Y' },
    { field: 'width', label: 'Width' },
    { field: 'height', label: 'Height' },
  ];
  const setField = (field: InspectorGeometryField, value: number): void => {
    const next = { ...rect };
    if (field === 'x') next.x = value;
    else if (field === 'y') next.y = value;
    else if (field === 'width') next.width = value;
    else next.height = value;
    onChange(next);
  };
  return (
    <PanelSection
      className="inspector-section"
      titleClassName="inspector-section-title"
      bodyClassName="inspector-section-body"
      title="Geometry"
      data-inspector-section="edit-geometry"
      data-edit-geometry
      data-edit-geometry-kind={geometry.kind}
    >
      {fields.map(({ field, label }) => (
        <Row key={field} id={`edit-geometry-${field}`} label={label}>
          <input
            className="inspector-geometry-input"
            data-edit-geometry-field={field}
            type="number"
            step={1}
            value={rect[field]}
            aria-label={`${label} (page points)`}
            title={`${label} in page points. Arrow keys nudge by 1 pt, Shift+Arrow by 10 pt.`}
            onChange={(e): void => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) setField(field, n);
            }}
            onKeyDown={(e): void => {
              const step = e.shiftKey ? 10 : 1;
              let delta = 0;
              if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') delta = -step;
              else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') delta = step;
              else return;
              e.preventDefault();
              onChange(applyGeometryNudge(rect, field, delta));
            }}
          />
        </Row>
      ))}
    </PanelSection>
  );
}

/** Phase 112 (C5) — the Deliver export-configuration surface. In LEGACY mode
 *  (no `onRun`) it renders the Phase-36 format/pages/preset rows + the legacy
 *  submit so the existing spec is untouched. In CONFIG mode (`onRun` wired) it
 *  prepares a real format, a page scope validated by the shipped parser, an
 *  output name and the format-specific options, and hands the request to the
 *  host's EXISTING export flow. It never reimplements export. */
function ExportConfigSection(props: {
  format: ExportConfigFormat | null;
  legacyPages: string | null;
  legacyPreset: string | null;
  sourceName: string | null;
  initialDpi: number;
  currentPage: number;
  totalPages: number;
  bridge: InspectorExportBridge | null;
  onFormatChange?: (format: ExportConfigFormat) => void;
  onRun?: (request: InspectorExportRequest) => void;
  legacyExport?: () => void;
  status: InspectorExportStatus | null;
  /** TFL-1119 - the controlled document-scoped draft (source of truth). */
  exportDraft?: ExportDraft;
  onExportDraftChange?: (patch: Partial<ExportDraft>) => void;
}): ReactElement {
  const {
    format: formatProp,
    legacyPages,
    legacyPreset,
    sourceName,
    initialDpi,
    currentPage,
    totalPages,
    bridge,
    onFormatChange,
    onRun,
    legacyExport,
    status,
    exportDraft,
    onExportDraftChange,
  } = props;

  const controlled = exportDraft !== undefined;
  const [formatState, setFormatState] = useState<ExportConfigFormat>(
    formatProp ?? DEFAULT_EXPORT_CONFIG_FORMAT,
  );
  const [scopeState, setScopeState] = useState<ExportPageScope>('all');
  const [customRangeState, setCustomRangeState] = useState<string>('');
  const [dpiState, setDpiState] = useState<number>(clampExportImageDpi(initialDpi));

  // The controlled draft wins; the local state is only the uncontrolled
  // (LEGACY / no draft) fallback, so nothing else changes.
  const format = controlled ? exportDraft.format : formatState;
  const scope = controlled ? exportDraft.scope : scopeState;
  const customRange = controlled ? exportDraft.customRange : customRangeState;
  const dpi = controlled ? exportDraft.dpi : dpiState;

  const option = exportFormatOption(format);
  const group = option?.group ?? 'image';
  const effectiveRangeText = exportRangeText(scope, customRange, totalPages, currentPage);
  const validation = validateExportRange(effectiveRangeText, totalPages);
  const bridgePresent =
    format === 'xlsx' ? bridge?.xlsx === true : format === 'pptx' ? bridge?.pptx === true : false;
  const gate = exportConfigGate(format, { hasDocument: totalPages > 0, bridgePresent });
  const running = status?.state === 'running';
  const canRun = gate.enabled && validation.valid && !running;
  const outputName = exportDefaultName(sourceName ?? 'document', format);
  // DEF-633 (ER20) — an image format writes one file per selected page. Resolve
  // the real count and naming example from the SAME filename helper the save
  // flow uses; null for office formats (single file) or an empty/invalid range.
  const imageOutput =
    group === 'image' && validation.valid && validation.parsed !== null
      ? exportImageOutputSummary(sourceName ?? 'document', validation.parsed, format)
      : null;
  const fidelity = exportFidelityNotes(format);

  const selectFormat = (next: ExportConfigFormat): void => {
    if (controlled) onExportDraftChange?.({ format: next });
    else setFormatState(next);
    // Optional extra notification; the draft is now authoritative.
    onFormatChange?.(next);
  };

  const selectScope = (next: ExportPageScope): void => {
    if (controlled) onExportDraftChange?.({ scope: next });
    else setScopeState(next);
  };

  const changeCustomRange = (next: string): void => {
    if (controlled) onExportDraftChange?.({ customRange: next });
    else setCustomRangeState(next);
  };

  const changeDpi = (next: number): void => {
    const clamped = clampExportImageDpi(next);
    if (controlled) onExportDraftChange?.({ dpi: clamped });
    else setDpiState(clamped);
  };

  const run = (): void => {
    if (onRun === undefined) {
      legacyExport?.();
      return;
    }
    if (!canRun) return;
    onRun({ format, range: validation.parsed ?? [], dpi, outputName });
  };
  const exportDisabled = onRun !== undefined ? !canRun : legacyExport === undefined;

  // LEGACY MODE — the Phase-36 rows + submit, unchanged.
  if (onRun === undefined) {
    return (
      <>
        <Row id="export-format" label="Format">
          {format}
        </Row>
        <Row id="export-pages" label="Pages">
          {legacyPages ?? 'All'}
        </Row>
        <Row id="export-preset" label="Preset">
          {legacyPreset ?? 'Default'}
        </Row>
        <Action id="export" label={'Export'} onClick={legacyExport} />
      </>
    );
  }

  return (
    <div className="export-config" data-export-config data-export-config-format={format}>
      <fieldset className="export-config-group" data-export-config-formats>
        <legend className="export-config-group-title">Format</legend>
        {EXPORT_CONFIG_FORMATS.map((o) => (
          <label key={o.id} className="export-config-option">
            <input
              type="radio"
              name="export-config-format"
              checked={o.id === format}
              onChange={(): void => selectFormat(o.id)}
              data-export-config-format-option={o.id}
            />
            <span>{o.label}</span>
          </label>
        ))}
      </fieldset>

      <div className="export-config-group" data-export-config-pages>
        <div className="export-config-group-title">Pages</div>
        <div className="export-config-options" role="radiogroup" aria-label="Page scope">
          {(['all', 'current', 'custom'] as const).map((s) => (
            <label key={s} className="export-config-option">
              <input
                type="radio"
                name="export-config-scope"
                checked={s === scope}
                onChange={(): void => selectScope(s)}
                data-export-config-scope={s}
              />
              <span>{exportScopeLabel(s)}</span>
            </label>
          ))}
        </div>
        {scope === 'custom' && (
          <input
            type="text"
            className="export-config-input"
            value={customRange}
            onChange={(e): void => changeCustomRange(e.target.value)}
            placeholder={totalPages > 0 ? `1-${totalPages}` : ''}
            spellCheck={false}
            data-export-config-range
          />
        )}
        {!validation.valid && (
          <span className="export-config-error" role="alert" data-export-config-range-error>
            {validation.error}
          </span>
        )}
        <span className="export-config-value" data-export-config-range-summary>
          {effectiveRangeText.length > 0 ? effectiveRangeText : '\u2014'}
        </span>
      </div>

      <div className="export-config-group" data-export-config-output>
        <span className="export-config-group-title">Output name</span>
        {group === 'image' ? (
          <>
            <span className="export-config-value" data-export-config-output-value>
              {imageOutput === null
                ? '\u2014'
                : `${imageOutput.count} ${imageOutput.count === 1 ? 'file' : 'files'}`}
            </span>
            {imageOutput !== null && (
              <span className="export-config-status" data-export-config-output-scheme>
                {imageOutput.example}
              </span>
            )}
          </>
        ) : (
          <span className="export-config-value" data-export-config-output-value>
            {outputName}
          </span>
        )}
      </div>

      {group === 'image' && (
        <label className="export-config-group" data-export-config-dpi>
          <span className="export-config-group-title">Resolution (DPI)</span>
          <input
            type="number"
            min={72}
            max={600}
            step={1}
            className="export-config-input"
            value={dpi}
            onChange={(e): void => {
              const next = Number.parseInt(e.target.value, 10);
              if (Number.isFinite(next)) changeDpi(next);
            }}
            data-export-config-dpi-input
          />
        </label>
      )}

      {group === 'office' && fidelity !== null && (
        <ExportFidelityNotes format={format as ExportFormat} />
      )}

      {!gate.enabled && gate.reason !== undefined && (
        <span className="export-config-error" role="status" data-export-config-gate-reason>
          {gate.reason}
        </span>
      )}

      {status?.state === 'running' && (
        <div className="export-config-status" role="status" data-export-config-progress>
          Exporting {status.current ?? 0} of {status.total ?? 0}&hellip;
        </div>
      )}
      {status?.state === 'error' && (
        <div className="export-config-error" role="alert" data-export-config-error>
          {status.message ?? 'Export failed.'}
        </div>
      )}
      {status?.state === 'success' && (
        <div className="export-config-status" role="status" data-export-config-success>
          {status.message ?? 'Export complete.'}
        </div>
      )}

      <Button
        intent="primary"
        kind="action"
        density="standard"
        className="export-config-action"
        data-inspector-action="export"
        onClick={run}
        disabled={exportDisabled}
        title={gate.reason ?? exportPrimaryLabel(format)}
      >
        <Icon name="exportPages" size="sm" aria-hidden />
        <span>{exportPrimaryLabel(format)}</span>
      </Button>
    </div>
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
    drawer = false,
    pageCount = 0,
    pageSize = null,
    pageRotation = null,
    pageLabel = null,
    pageSelection = null,
    pageSizeMixed = false,
    pageRotationMixed = false,
    pageLabelMixed = false,
    cropBox = null,
    cropActive = false,
    annotationCount = 0,
    formFieldCount = 0,
    formFillReport,
fileSize = null,
    documentTitle = null,
    onRenumberPages,
    onJumpToReview,
    textPanel = null,
    editGeometry = null,
    ocrSuspects = null,
    signatureStyle = null,
    signatureHint = null,
    annotations = [],
    selectedAnnotationId,
    onJumpToAnnotation = null,
    onEditAnnotation = null,
    onDeleteAnnotation = null,
    annotationTheme,
    bates = [],
    watermarks = [],
    signatures = [],
    onSelectReviewElement = null,
    onEditReviewElement = null,
    onDeleteReviewElement = null,
    reviewErrorFor = null,
    exportFormat = null,
    exportPages = null,
    exportPreset = null,
    exportSourceName = null,
    exportDpi = DEFAULT_EXPORT_IMAGE_DPI,
    exportDraft,
    onExportDraftChange,
    exportCurrentPage = 1,
    exportBridge = null,
    onExportFormatChange,
    onExportRun,
    onExport,
    exportStatus = null,
  } = props;

  // TFL-1116 C11 (R17) — the EXPLICIT Inspector state. Precedence lives in the
  // pure resolver; the component only feeds the session signals. A published
  // `cropBox` counts as an active crop so the geometry is never hidden when a
  // host supplies it without the explicit flag.
  const ocrSuspectsOpen = ocrSuspects !== null;
  const inspectorState = useMemo(
    () =>
      resolveInspectorState({
        stage,
        selection,
        cropActive: cropActive || cropBox !== null,
        ocrSuspectsOpen,
      }),
    [stage, selection, cropActive, cropBox !== null, ocrSuspectsOpen],
  );
  const sections = useMemo(
    () => inspectorSectionsForState(inspectorState, stage),
    [inspectorState, stage],
  );

  // TFL-1117 (R01) — the compact drawer's opener (the collapse control) and a
  // record of the previous drawer state so a close can return focus. The
  // control is unmounted while the drawer is open, so the ref is re-attached
  // to the strip control once the drawer closes and the strip remounts; the
  // effect below restores focus to that fresh node.
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

  // TFL-1117 (R01) — Escape closes the compact drawer. Bound only while it is
  // the open surface (the host passes `onClose` only then), so the wide panel
  // keeps its existing keyboard behaviour unchanged.
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

  // Phase 59 item 4 — the fill-report summary is dismissible. Dismissal is
  // keyed by the report's content, so a NEW report re-appears even after the
  // user dismissed the previous one.
  const [dismissedReportKey, setDismissedReportKey] = useState<string | null>(null);
  const reportKey =
    formFillReport === undefined
      ? ''
      : formFillReport.map((r) => `${r.name}:${r.status}`).join('|');
  const showFillReport =
    formFillReport !== undefined &&
    formFillReport.length > 0 &&
    reportKey !== dismissedReportKey;


  const pageSizeText = pageSizeMixed
    ? 'Mixed'
    : pageSize === null
      ? 'Not available'
      : `${Math.round(pageSize.widthPt)} x ${Math.round(pageSize.heightPt)} pt`;
  // DEF-329 — the rotation value keeps its em-dash for an unknown index (the
  // real angle is never fabricated); a mixed selection reads "Mixed".
  const rotationText = pageRotationMixed ? 'Mixed' : rotationDegreesText(pageRotation);
  const pageLabelText = pageLabelMixed ? 'Mixed' : pageLabel ?? 'Not available';
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
          <span data-inspector-value="label">{pageLabelText}</span>
          <Action
            id="renumber"
            // Phase 59 (item 9) — the visible label is the bare action name
            // (no trailing ellipsis); the dialog it opens is described by the
            // button's own title (the action label).
            label={'rename'}
            onClick={onRenumberPages}
            icon={<Icon name="bates" size="xs" />}
          />
        </span>
      </Row>
      {/* R17 — the default EDIT state (no crop session, no object selected)
       *  offers selection guidance + these page facts instead of an empty
       *  CropBox. */}
      {stage === 'edit' && inspectorState === 'page' && (
        <p className="inspector-note" data-inspector-edit-guidance>
          Select a text or image object on the page to edit its properties.
        </p>
      )}
    </Section>
  );
  /** PAGES - the counts that apply to the selected page. The annotations
   *  count is read-only but JUMPS to the REVIEW stage on click (section 3A
   *  ruling 6 — the ONE documented inspector-value exception); Form fields
   *  stays a plain value. */
  const renderOnPageSection = (): ReactElement => (
    <Section id="on-page" title="On this page">
      <Row id="annotations" label="Annotations">
        <Button
          intent="tertiary"
          kind="action"
          density="compact"
          className="inspector-link"
          data-inspector-action="jump-to-review"
          onClick={onJumpToReview}
          disabled={onJumpToReview === undefined}
          title="Show the annotations list in the REVIEW panel"
        >
          <span data-inspector-annotations-count>{annotationCount}</span>
        </Button>
      </Row>
      <Row id="form-fields" label="Form fields">
        {formFieldCount}
      </Row>
    </Section>
  );

  /** The DOCUMENT section: read-only facts. Section 3A ruling 5 — File size
   *  is a VALUE with NO "▾" affordance, and Optimize / Audit live only in the
   *  DELIVER stage (the dock + the panel's pre-flight).
   *
   *  Nothing selected AND no document open is the Inspector's no-selection
   *  state: a designed empty state replaces the bare "Pages 0" / "File size —"
   *  rows. With a document open the facts render exactly as before. */
  const renderDocumentSection = (): ReactElement => {
    if (
      selection.kind === 'none' &&
      pageCount === 0 &&
      fileSize === null &&
      documentTitle === null
    ) {
      return (
        <Section id="document" title="Document">
          <EmptyState
            icon={MousePointerClick}
            headline="No document open"
            help="Open a PDF to inspect its details here."
            data-inspector-empty
          />
        </Section>
      );
    }
    return (
      <details
        className="inspector-document-details"
        data-inspector-document-details
        data-inspector-section="document"
      >
        <summary className="inspector-section-title inspector-document-summary">
          Document details
        </summary>
        <PanelSection className="inspector-section" bodyClassName="inspector-section-body">
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
        </PanelSection>
      </details>
    );
  };
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

  /** Phase 117 (chunk D) — the numeric geometry block for a selected text box
   *  or image. A text box's geometry rides its published text snapshot; an
   *  image has no text snapshot, so the host passes the dedicated
   *  `editGeometry` prop. When neither publishes a rect the block still
   *  renders (when a kind is known) DISABLED with the truthful reason. */
  const resolvedEditGeometry = editGeometry ?? textPanel?.geometry ?? null;
  const renderEditGeometryBlock = (): ReactElement | null =>
    resolvedEditGeometry === null ? null : (
      <div className="inspector-slot" data-inspector-slot="edit-geometry">
        <EditGeometryFields geometry={resolvedEditGeometry} />
      </div>
    );

  /** EDIT — the active crop session's bounds. R17: this section exists ONLY in
   *  the `crop` state, so the default EDIT (Select, no crop workflow) shows page
   *  facts + selection guidance below instead of an empty CropBox. Section 3A
   *  ruling 4: no OCR status here — the EDIT ContextPanel owns the Recognition
   *  summary. */
  const renderCropBoxSection = (): ReactElement => (
    <Section id="cropbox" title="Crop bounds">
      {cropBox === null ? (
        <p className="inspector-note" data-inspector-crop-empty>
          Drag the crop rectangle in the Crop pages dialog to set the crop bounds.
        </p>
      ) : (
        <>
          <Row id="cropbox-x" label="X">
            {`${Math.round(cropBox.x)} pt`}
          </Row>
          <Row id="cropbox-y" label="Y">
            {`${Math.round(cropBox.y)} pt`}
          </Row>
          <Row id="cropbox-w" label="Width">
            {`${Math.round(cropBox.width)} pt`}
          </Row>
          <Row id="cropbox-h" label="Height">
            {`${Math.round(cropBox.height)} pt`}
          </Row>
          <Row id="cropbox-units" label="Units">
            pt
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

  /** Phase 112 (TFL-854 C4) — the Annotations category's RIGHT-panel body.
   *  The Inspector resolves the selected annotation from the published
   *  text-panel snapshot (so the host wiring is unchanged) and renders its
   *  content facts + supported actions; with nothing selected it is a short
   *  designed hint. The authoritative list stays in the LEFT navigator. */
  const renderAnnotationInspector = (): ReactElement => {
    const selected = selectedReviewAnnotation(selection, textPanel, annotations, selectedAnnotationId);
    if (selected === null) {
      return (
        <PanelEmptyState
          className="inspector-review-empty context-panel-empty"
          data-inspector-review-empty
          headline="No annotation selected"
          help="Select an annotation on a page or in the review list to inspect it."
        />
      );
    }
    const author = selected.author;
    const hasAuthor = typeof author === 'string' && author.trim() !== '';
    const geometry = selected as { rect?: PageRect; rects?: PageRect[] };
    const r = geometry.rect ?? geometry.rects?.[0];
    return (
      <>
        {hasAuthor && (
          <Row id="annotation-author" label="Author">
            {author}
          </Row>
        )}
        <Row id="annotation-type" label="Type">
          {kindLabel(selected.kind)}
        </Row>
        <Row id="annotation-page" label="Page">
          {selected.page}
        </Row>
        {r !== undefined && (
          <Row id="annotation-position" label="Position">
            {`${Math.round(r.x)}, ${Math.round(r.y)} \u00b7 ${Math.round(r.width)}\u00d7${Math.round(r.height)} pt`}
          </Row>
        )}
        <Row id="annotation-color" label="Color">
          <span data-ann-prop="color">
            <AnnColorBox
              color={selected.color}
              theme={annotationTheme ?? 'light'}
              onApply={(c): void => {
                onEditAnnotation?.(selected.id, { color: c });
              }}
            />
          </span>
        </Row>
        <ActionList
          className="inspector-quick-actions"
          data-inspector-review-actions
          actions={[
            {
              id: 'annotation-jump',
              label: `Jump to page ${selected.page}`,
              icon: <Icon name="nextPage" size="sm" />,
              onClick:
                onJumpToAnnotation === null
                  ? undefined
                  : (): void => onJumpToAnnotation(selected.page, selected.id),
            },
            {
              id: 'annotation-delete',
              label: 'Delete annotation',
              intent: 'destructive',
              icon: <Icon name="delete" size="sm" />,
              onClick:
                onDeleteAnnotation === null
                  ? undefined
                  : (): void => onDeleteAnnotation(selected.id),
            },
          ]}
        />
      </>
    );
  };

  const renderReviewElementsSection = (): ReactElement => (
    // Phase 112 (TFL-854 C4) — the review-elements section keeps the shared
    // marks categories (one renderer, one set of `data-review-*` hooks) but the
    // Annotations category renders the Inspector's annotation scope, never a
    // second copy of the LEFT navigator's list.
    // TFL-1116 C13 (R20) — the section now owns the SELECTION scope only: the
    // document-wide Bates / watermark / signature summaries have exactly ONE
    // authoritative home (the LEFT review navigator), so the Inspector never
    // repeats them. The selected-annotation scope stays here.
    <Section id="review-elements" title="Review elements">
      <ReviewElementsPanel
        scope="selection"
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
        renderAnnotations={renderAnnotationInspector}
      />
    </Section>
  );

  const renderExportSection = (): ReactElement => (
    <Section id="export" title="Export">
      <ExportConfigSection
        format={exportFormat}
        legacyPages={exportPages}
        legacyPreset={exportPreset}
        sourceName={exportSourceName}
        initialDpi={exportDpi}
        currentPage={exportCurrentPage}
        totalPages={pageCount}
        bridge={exportBridge}
        onFormatChange={onExportFormatChange}
        onRun={onExportRun}
        legacyExport={onExport}
        status={exportStatus}
        exportDraft={exportDraft}
        onExportDraftChange={onExportDraftChange}
      />
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
      case 'annotations':
        return renderAnnotationsSection();
      case 'review-elements':
        return renderReviewElementsSection();
      case 'export':
        return renderExportSection();
      case 'ocr-suspects':
        // Rendered separately (like the text block) so it can be absent when
        // the host has no suspects view open; never part of `sections`.
        return null;
    }
  };

  /** Phase 37 (item 3) — the expand/collapse control. ONE control, rendered in
   *  both states (the header when expanded, the strip when collapsed), wired to
   *  the host's `onToggleCollapsed`. At wide widths it toggles the USER's
   *  preference only (the ladder's rung 1 is OR-ed by the host, so a manual
   *  expand can never fight the ladder); at compact widths the host routes it
   *  to the overlay drawer. The ref lets the drawer return focus to this
   *  control once the collapsed strip remounts on close. */
  const collapseControl = (
    <IconButton
      ref={collapseOpenerRef}
      label={collapsed ? 'Expand inspector' : 'Collapse inspector'}
      intent="tertiary"
      kind="toggle"
      density="standard"
      className="inspector-collapse-toggle"
      data-inspector-collapse
      onClick={onToggleCollapsed}
      disabled={onToggleCollapsed === undefined}
      expanded={!collapsed}
      icon={
        collapsed ? (
          <Icon icon={ChevronLeft} size="sm" />
        ) : (
          <Icon icon={ChevronRight} size="sm" />
        )
      }
    />
  );

  return (
    <PanelShell
      className={drawer ? 'inspector inspector-drawer' : 'inspector'}
      role="complementary"
      label="Inspector"
      data-inspector
      data-inspector-drawer={drawer ? 'true' : 'false'}
      data-inspector-stage={stage}
      data-inspector-selection={selection.kind}
      data-inspector-state={inspectorState}
      data-inspector-collapsed={collapsed ? 'true' : 'false'}
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
          <ScopedHeader
            className="inspector-header"
            preferredHeight
            title={`Inspector \u00b7 ${inspectorScopeLabel(selection, pageSelection)}`}
            actions={
              <div className="inspector-header-actions">
                {collapseControl}
                {onClose !== undefined ? (
                  <IconButton
                    label="Close inspector"
                    intent="tertiary"
                    kind="action"
                    density="standard"
                    className="inspector-close"
                    data-inspector-close
                    onClick={onClose}
                    icon={<Icon icon={X} size="sm" />}
                  />
                ) : null}
              </div>
            }
          />
          <GlassSidebarBody className="inspector-body tf-panel-body tf-panel-scroll">
            {/* Phase 37 (item 1) — the text-manipulation block leads the column,
                with the stage sections below the divider. */}
            {renderTextBlock()}
            {/* Phase 117 (chunk D) — numeric geometry for a selected text box
                or image (Inspector First). */}
            {renderEditGeometryBlock()}
            {/* Phase 59 item 4 — the native-fill outcome. Compact and
                dismissible; sits above the stage sections and never covers
                the page. */}
            {showFillReport && formFillReport !== undefined && (
              <div className="inspector-slot" data-inspector-slot="form-fill-report">
                <FormFillReportSummary
                  report={formFillReport}
                  onDismiss={(): void => setDismissedReportKey(reportKey)}
                />
              </div>
            )}
            {/* Phase 51 (item 10) — the OCR suspects view lives HERE now
                (moved out of the workspace top bar / context panel). */}
            {ocrSuspects !== null && (
              <div className="inspector-slot" data-inspector-slot="ocr-suspects">
                <OcrSuspectsPanel {...ocrSuspects} layout="inspector" />
              </div>
            )}
            {sections.map((id) => (
              <div key={id} className="inspector-slot" data-inspector-slot={id}>
                {sectionBody(id)}
              </div>
            ))}
          </GlassSidebarBody>
        </>
      )}
    </PanelShell>
  );
}
