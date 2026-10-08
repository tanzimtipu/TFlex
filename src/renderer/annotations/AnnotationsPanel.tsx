// Annotations panel — left navigator list of every annotation in the document.
// Phase 116 (TFL-1228 chunk D) migrated this surface onto the chunk-C Thread
// Stream primitives: a flat list, an All / type filter, the two empty states and
// selection retention across filtering. The row (author, kind, page, created
// time, comment chip, jump / delete) is owned by `ThreadStreamRow`; the panel
// only supplies data and handlers. The page grouping, kind-pill summary and the
// per-row colour swatch / inline text editor were retired — colour editing
// belongs to the inspector (chunk E).

import { useMemo, useState, type ReactElement } from "react";
import {
  countByKind,
  sortAnnotations,
  type Annotation,
  type AnnotationPatch,
} from "./model";
import {
  AnnotationEmptyState,
  AnnotationFilterBar,
  ThreadStreamRow,
  type AnnotationFilter,
} from "./ThreadStream";
import { PanelShell, ScopedHeader } from "../components/panels/PanelPrimitives";
import { Button } from "../components/Button";
import type { CommentThread } from "../../shared/types";

export interface AnnotationsPanelProps {
  annotations: Annotation[];
  onJumpTo: (page: number, id: string) => void;
  onEdit: (id: string, patch: AnnotationPatch) => void;
  onDelete: (id: string) => void;
  selectedAnnotationId?: string | null;
  onOpenTools?: () => void;
  comments?: readonly CommentThread[];
  /** Phase 116 (TFL-1228 chunk G) — the list-level FDF comment import / export
   *  actions. Optional; when absent the corresponding header button is disabled. */
  onExportComments?: () => void;
  onImportComments?: () => void;
}

export function AnnotationsPanel(props: AnnotationsPanelProps): ReactElement {
  const {
    annotations,
    onJumpTo,
    onDelete,
    selectedAnnotationId = null,
    onOpenTools,
    comments,
    onExportComments,
    onImportComments,
  } = props;
  const [filter, setFilter] = useState<AnnotationFilter>("all");

  const sorted = useMemo((): Annotation[] => sortAnnotations(annotations), [annotations]);
  const counts = useMemo(() => countByKind(annotations), [annotations]);
  const total = sorted.length;
  const visible =
    filter === "all" ? sorted : sorted.filter((a) => a.kind === filter);

  const commentCountFor = (id: string): number =>
    comments?.find((t) => t.annotationId === id)?.entries.length ?? 0;

  return (
    <PanelShell className="ann-panel" label="Annotations" data-annotation-panel>
      <ScopedHeader
        className="ann-panel-header"
        preferredHeight
        title="Annotations"
        actions={
          <>
            <span className="ann-panel-count">{total}</span>
            <Button
              intent="secondary"
              kind="action"
              density="compact"
              data-ann-io="export"
              onClick={onExportComments}
              disabled={onExportComments === undefined}
            >
              Export comments
            </Button>
            <Button
              intent="secondary"
              kind="action"
              density="compact"
              data-ann-io="import"
              onClick={onImportComments}
              disabled={onImportComments === undefined}
            >
              Import comments
            </Button>
          </>
        }
      />
      {annotations.length === 0 ? (
        <AnnotationEmptyState variant="document" onOpenTools={onOpenTools} />
      ) : (
        <>
          <AnnotationFilterBar
            value={filter}
            onChange={setFilter}
            counts={counts}
            total={total}
          />
          {visible.length === 0 ? (
            <AnnotationEmptyState variant="filter" />
          ) : (
            <ul className="tf-panel-scroll">
              {visible.map((a) => (
                <ThreadStreamRow
                  key={a.id}
                  annotation={a}
                  commentCount={commentCountFor(a.id)}
                  selected={a.id === selectedAnnotationId}
                  onJumpTo={onJumpTo}
                  onDelete={onDelete}
                />
              ))}
            </ul>
          )}
        </>
      )}
    </PanelShell>
  );
}
