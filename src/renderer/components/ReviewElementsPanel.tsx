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
import { AnnotationsPanel } from '../annotations/AnnotationsPanel';
import type { Annotation, AnnotationPatch } from '../annotations/model';
import type {
  BatesInfo,
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
      <button
        type="button"
        className="review-elements-row-select"
        data-review-element-select
        onClick={(): void => onSelect?.(ref)}
        disabled={onSelect === null}
        aria-label={`Jump to ${row.label} on page ${row.page}`}
        title={`Jump to page ${row.page}`}
      >
        <span className="review-elements-row-label">{row.label}</span>
        <span className="review-elements-row-page">Page {row.page}</span>
      </button>
      <button
        type="button"
        className="review-elements-row-edit"
        data-review-element-edit
        onClick={(): void => onEdit?.(ref)}
        disabled={onEdit === null}
        aria-label={`Edit ${row.label}`}
        title={onEdit === null ? 'Editing is not available yet' : `Edit ${row.label}`}
      >
        <Icon icon={Pencil} size="sm" />
      </button>
      <button
        type="button"
        className="review-elements-row-delete"
        data-review-element-delete
        onClick={(): void => onDelete?.(ref)}
        disabled={onDelete === null}
        aria-label={`Delete ${row.label}`}
        title="Delete"
      >
        <Icon name="delete" size="sm" />
      </button>
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
    <section
      className="review-elements-category"
      data-review-category={category}
      aria-label={title}
    >
      <div className="review-elements-category-title">{title}</div>
      {rows.length === 0 ? (
        <p className="context-panel-empty" data-review-empty>
          {emptyText}
        </p>
      ) : (
        <ul className="review-elements-list">
          {rows.map((row): ReactElement => renderRow(row, props))}
        </ul>
      )}
    </section>
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

  return (
    <div className="review-elements" data-review-elements>
      <section
        className="review-elements-category"
        data-review-category="annotations"
        aria-label="Annotations"
      >
        <div className="review-elements-category-title">Annotations</div>
        <div className="context-panel-annotations" data-context-panel-annotations>
          <AnnotationsPanel
            annotations={[...annotations]}
            onJumpTo={(page, id): void => onJumpToAnnotation?.(page, id)}
            onEdit={(id, patch): void => onEditAnnotation?.(id, patch)}
            onDelete={(id): void => onDeleteAnnotation?.(id)}
          />
        </div>
      </section>
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