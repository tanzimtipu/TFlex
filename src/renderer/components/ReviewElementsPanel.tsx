// Phase 90 (TFL-509-C1) — the unified review-element list.
//
// Both the REVIEW ContextPanel and the REVIEW Inspector re-parent this ONE
// component, so the four review categories (Annotations, Bates numbering,
// Watermarks, Signatures) have exactly one renderer and one set of hooks
// (Ruling 6 / Ruling 10). The Annotations category re-parents the shipped
// `AnnotationsPanel` unchanged; every other category renders its own rows with
// the stable `data-review-*` hooks plus a row-level fail-loud error slot
// (Ruling 9). The host owns all state and every handler; this component only
// renders and dispatches.

import type { ReactElement } from 'react';
import { Pencil } from 'lucide-react';
import { Icon } from '../icons/Icon';
import { Button, IconButton } from './Button';
import { AnnotationsPanel } from '../annotations/AnnotationsPanel';
import { PanelEmptyState, PanelSection } from './panels/PanelPrimitives';
import type { Annotation, AnnotationPatch } from '../annotations/model';
import type {
  BatesInfo,
  CommentThread,
  SignaturePlacement,
  WatermarkInfo,
} from '../../shared/types';

export type ReviewElementType = 'annotation' | 'bates' | 'watermark' | 'signature';

export interface ReviewElementRef {
  type: ReviewElementType;
  id: string;
  page: number;
  label: string;
}

export interface ReviewElementsPanelProps {
  annotations: readonly Annotation[];
  onJumpToAnnotation?: ((page: number, id: string) => void) | null;
  onEditAnnotation?: ((id: string, patch: AnnotationPatch) => void) | null;
  onDeleteAnnotation?: ((id: string) => void) | null;
  bates: readonly BatesInfo[];
  watermarks: readonly WatermarkInfo[];
  signatures: readonly SignaturePlacement[];
  onSelect?: ((el: ReviewElementRef) => void) | null;
  onEdit?: ((el: ReviewElementRef) => void) | null;
  onDelete?: ((el: ReviewElementRef) => void) | null;
  errorFor?: ((el: ReviewElementRef) => string | null) | null;
  /** Phase 112 (TFL-854 C4) — the Inspector's annotation scope. When supplied,
   *  the Annotations category renders this slot (the selected annotation's
   *  inspector, or a short hint) instead of the authoritative AnnotationsPanel
   *  list, so the LEFT navigator's list is never duplicated into the right
   *  panel. The LEFT navigator omits it and keeps the list. */
  renderAnnotations?: (() => ReactElement) | null;
  /** TFL-1116 C13 (R20) — which document-wide scope this renderer owns. The
   *  LEFT navigator renders `'document'` (the authoritative inventory: the four
   *  categories with their rows plus the select / edit / delete actions). The
   *  Inspector's REVIEW section renders `'selection'`: only the annotations
   *  category (the selected annotation's scope), so the document-wide Bates /
   *  watermark / signature summaries are never repeated on both sides — they
   *  have exactly ONE authoritative home (the LEFT navigator). Defaults to
   *  `'document'`, so every pre-existing caller is byte-for-byte unchanged. */
  scope?: 'document' | 'selection';
  /** Phase 116 (TFL-1228 chunk D) — the LEFT navigator's Thread Stream
   *  pass-throughs. Optional, so every pre-existing caller is unchanged. */
  selectedAnnotationId?: string | null;
  onOpenTools?: () => void;
  comments?: readonly CommentThread[];
  /** Phase 116 (TFL-1228 chunk G) — the list-level FDF comment import / export
   *  pass-throughs for the LEFT navigator's AnnotationsPanel. Optional. */
  onExportComments?: () => void;
  onImportComments?: () => void;
}

/** A row's display label + jump page, derived purely from its source record. */
interface ReviewRow {
  type: ReviewElementType;
  id: string;
  page: number;
  label: string;
}

/** Bates = the run's composed series: first..last label, or the prefix /
 *  suffix / start number when the run carries no labels. */
export function batesRowLabel(info: BatesInfo): string {
  const labels = info.labels;
  if (labels.length === 0) {
    const composed = `${info.prefix}${info.startNumber}${info.suffix}`;
    return composed.length > 0 ? composed : `Bates run ${info.id}`;
  }
  if (labels.length === 1) return labels[0];
  return `${labels[0]} \u2013 ${labels[labels.length - 1]}`;
}

/** Watermark = its type plus its text. */
export function watermarkRowLabel(info: WatermarkInfo): string {
  const text = info.text.trim();
  return text.length > 0 ? `${info.type} \u00b7 ${text}` : info.type;
}

/** Signature = the placement's page label. */
export function signatureRowLabel(placement: SignaturePlacement): string {
  return `Signature p${placement.page}`;
}

function firstPage(pages: readonly number[]): number {
  return pages.length > 0 ? pages[0] : 1;
}

function renderRow(
  row: ReviewRow,
  props: Pick<ReviewElementsPanelProps, 'onSelect' | 'onEdit' | 'onDelete' | 'errorFor'>,
): ReactElement {
  const { onSelect = null, onEdit = null, onDelete = null, errorFor = null } = props;
  const ref: ReviewElementRef = {
    type: row.type,
    id: row.id,
    page: row.page,
    label: row.label,
  };
  const error = errorFor === null ? null : errorFor(ref);
  return (
    <li
      key={`${row.type}:${row.id}`}
      className="review-elements-row"
      data-review-element-type={row.type}
      data-review-element-id={row.id}
    >
      <Button
        intent="secondary"
        kind="action"
        density="standard"
        className="review-elements-row-select"
        data-review-element-select
        onClick={(): void => onSelect?.(ref)}
        disabled={onSelect === null}
        aria-label={`Jump to ${row.label} on page ${row.page}`}
        title={`Jump to page ${row.page}`}
      >
        <span className="review-elements-row-label">{row.label}</span>
        <span className="review-elements-row-page">Page {row.page}</span>
      </Button>
      <IconButton
        label={`Edit ${row.label}`}
        intent="tertiary"
        kind="action"
        density="standard"
        className="review-elements-row-edit"
        data-review-element-edit
        onClick={(): void => onEdit?.(ref)}
        disabled={onEdit === null}
        icon={<Icon icon={Pencil} size="sm" />}
      />
      <IconButton
        label={`Delete ${row.label}`}
        intent="destructive"
        kind="action"
        density="standard"
        className="review-elements-row-delete"
        data-review-element-delete
        onClick={(): void => onDelete?.(ref)}
        disabled={onDelete === null}
        icon={<Icon name="delete" size="sm" />}
      />
      {error !== null && (
        <p className="review-elements-row-error" data-review-element-error>
          {error}
        </p>
      )}
    </li>
  );
}

function renderCategory(args: {
  category: 'bates' | 'watermarks' | 'signatures';
  title: string;
  emptyText: string;
  rows: ReviewRow[];
  props: Pick<ReviewElementsPanelProps, 'onSelect' | 'onEdit' | 'onDelete' | 'errorFor'>;
}): ReactElement {
  const { category, title, emptyText, rows, props } = args;
  return (
    <PanelSection
      className="review-elements-category"
      titleClassName="review-elements-category-title"
      bodyClassName="review-elements-category-body"
      data-review-category={category}
      aria-label={title}
      title={title}
    >
      {rows.length === 0 ? (
        <PanelEmptyState
          className="context-panel-empty"
          data-review-empty
          data-review-empty-category={category}
          headline={emptyText}
        />
      ) : (
        <ul className="review-elements-list">
          {rows.map((row): ReactElement => renderRow(row, props))}
        </ul>
      )}
    </PanelSection>
  );
}

export function ReviewElementsPanel(props: ReviewElementsPanelProps): ReactElement {
  const {
    annotations,
    onJumpToAnnotation = null,
    onEditAnnotation = null,
    onDeleteAnnotation = null,
    bates,
    watermarks,
    signatures,
    onSelect = null,
    onEdit = null,
    onDelete = null,
    errorFor = null,
    renderAnnotations = null,
    scope = 'document',
    selectedAnnotationId = null,
    onOpenTools,
    comments,
    onExportComments,
    onImportComments,
  } = props;

  const rowProps = { onSelect, onEdit, onDelete, errorFor };

  const batesRows: ReviewRow[] = bates.map((info): ReviewRow => ({
    type: 'bates',
    id: info.id,
    page: firstPage(info.pages),
    label: batesRowLabel(info),
  }));
  const watermarkRows: ReviewRow[] = watermarks.map((info): ReviewRow => ({
    type: 'watermark',
    id: info.id,
    page: firstPage(info.pages),
    label: watermarkRowLabel(info),
  }));
  const signatureRows: ReviewRow[] = signatures.map((placement): ReviewRow => ({
    type: 'signature',
    id: placement.id,
    page: placement.page,
    label: signatureRowLabel(placement),
  }));

  // R20 — the Annotations category is the one section the Inspector's selection
  // scope keeps; it renders the list on the LEFT (no slot) and the selected
  // annotation scope on the RIGHT (the slot). Built once, mounted in whichever
  // scope this renderer owns.
  const annotationsSection = (
    <PanelSection
      className="review-elements-category"
      titleClassName="review-elements-category-title"
      bodyClassName="review-elements-category-body"
      data-review-category="annotations"
      aria-label="Annotations"
      title="Annotations"
    >
      {renderAnnotations === null ? (
        <div className="context-panel-annotations" data-context-panel-annotations>
          <AnnotationsPanel
            annotations={[...annotations]}
            onJumpTo={(page, id): void => onJumpToAnnotation?.(page, id)}
            onEdit={(id, patch): void => onEditAnnotation?.(id, patch)}
            onDelete={(id): void => onDeleteAnnotation?.(id)}
            selectedAnnotationId={selectedAnnotationId}
            onOpenTools={onOpenTools}
            comments={comments}
            onExportComments={onExportComments}
            onImportComments={onImportComments}
          />
        </div>
      ) : (
        renderAnnotations()
      )}
    </PanelSection>
  );

  // R20 — the selection scope stops at the annotations category: the
  // document-wide summaries live in exactly ONE place (the LEFT navigator), so
  // the Inspector never re-renders them. The document scope renders the full
  // authoritative inventory with its actions.
  if (scope === 'selection') {
    return (
      <div className="review-elements" data-review-elements data-review-elements-scope="selection">
        {annotationsSection}
      </div>
    );
  }

  return (
    <div className="review-elements" data-review-elements data-review-elements-scope="document">
      {annotationsSection}
      {renderCategory({
        category: 'bates',
        title: 'Bates numbering',
        emptyText: 'No Bates numbering applied.',
        rows: batesRows,
        props: rowProps,
      })}
      {renderCategory({
        category: 'watermarks',
        title: 'Watermarks',
        emptyText: 'No watermarks applied.',
        rows: watermarkRows,
        props: rowProps,
      })}
      {renderCategory({
        category: 'signatures',
        title: 'Signatures',
        emptyText: 'No signatures placed.',
        rows: signatureRows,
        props: rowProps,
      })}
    </div>
  );
}