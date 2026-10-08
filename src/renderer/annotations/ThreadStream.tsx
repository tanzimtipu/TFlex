// Phase 116 (TFL-1228 chunk C) - the Thread Stream presentational primitives.
//
// Framework-native, store-free building blocks for the annotation thread
// stream: a kind filter bar, one row per annotation and the two empty states.
// They own no state, no engine call and no IPC - a consumer wires the data and
// handlers. Styling lives in the ONE Thread Stream section of styles.css.

import type { ReactElement } from "react";
import { Icon } from "../icons/Icon";
import { Button, IconButton } from "../components/Button";
import { PanelEmptyState } from "../components/panels/PanelPrimitives";
import { formatCommentTime } from "./AnnotationCommentBox";
import { kindLabel, type Annotation, type AnnotationKind } from "./model";

export type AnnotationFilter = "all" | AnnotationKind;

/** The breadth-first kind order the filter bar walks. */
const KIND_ORDER: readonly AnnotationKind[] = [
  "highlight",
  "underline",
  "strikeout",
  "ink",
  "textbox",
  "rect",
  "ellipse",
  "arrow",
  "note",
  "callout",
];

/** The neutral kind glyph - mirrors AnnotationsPanel's `rowIcon` switch. */
function rowIcon(a: Annotation): ReactElement {
  switch (a.kind) {
    case "highlight":
      return <Icon name="annHighlight" size="sm" />;
    case "underline":
      return <Icon name="annUnderline" size="sm" />;
    case "strikeout":
      return <Icon name="annStrikeout" size="sm" />;
    case "ink":
      return <Icon name="annInk" size="sm" />;
    case "textbox":
      return <Icon name="annTextbox" size="sm" />;
    case "rect":
      return <Icon name="annRect" size="sm" />;
    case "ellipse":
      return <Icon name="annEllipse" size="sm" />;
    case "arrow":
      return <Icon name="annArrow" size="sm" />;
    case "note":
      return <Icon name="annNote" size="sm" />;
    case "callout":
      return <Icon name="annCallout" size="sm" />;
  }
}

/** All + one button per kind that has at least one annotation. */
export function AnnotationFilterBar(props: {
  value: AnnotationFilter;
  onChange: (f: AnnotationFilter) => void;
  counts: Record<AnnotationKind, number>;
  total: number;
}): ReactElement {
  const { value, onChange, counts, total } = props;
  return (
    <div className="ann-filter-bar" role="group" aria-label="Filter annotations">
      <button
        type="button"
        className="ann-filter-button"
        data-ann-filter="all"
        aria-pressed={value === "all"}
        title={`All annotations (${total})`}
        onClick={() => onChange("all")}
      >
        All
      </button>
      {KIND_ORDER.filter((k) => counts[k] > 0).map((k) => (
        <button
          key={k}
          type="button"
          className="ann-filter-button"
          data-ann-filter={k}
          aria-pressed={value === k}
          onClick={() => onChange(k)}
        >
          {kindLabel(k)}
        </button>
      ))}
    </div>
  );
}

/** One annotation in the stream: neutral icon, author (when the document
 *  provides one), kind + page + created time, a comment chip when there are
 *  comments, and the jump / delete actions. */
export function ThreadStreamRow(props: {
  annotation: Annotation;
  commentCount: number;
  selected: boolean;
  onJumpTo: (page: number, id: string) => void;
  onDelete: (id: string) => void;
}): ReactElement {
  const { annotation: a, commentCount, selected, onJumpTo, onDelete } = props;
  const author = typeof a.author === "string" && a.author.trim() !== "" ? a.author : null;
  return (
    <li
      className="thread-stream-row"
      data-annotation-row={a.id}
      data-ann-selected={selected ? "true" : "false"}
      aria-current={selected ? "true" : undefined}
    >
      <span className="thread-stream-row-meta">
        <span data-ann-icon>{rowIcon(a)}</span>
        {author !== null && <span data-ann-author>{author}</span>}
        <span data-ann-kind>{kindLabel(a.kind)}</span>
        <span data-ann-page>Page {a.page}</span>
        <span data-ann-time>{formatCommentTime(Date.parse(a.createdAt))}</span>
      </span>
      {commentCount > 0 && (
        <span data-ann-comment-count={commentCount}>{commentCount}</span>
      )}
      <Button
        intent="secondary"
        kind="action"
        density="standard"
        onClick={(): void => onJumpTo(a.page, a.id)}
        aria-label={`Jump to ${kindLabel(a.kind)} on page ${a.page}`}
        title={`Jump to ${kindLabel(a.kind)} on page ${a.page}`}
      >
        Jump
      </Button>
      <IconButton
        label={`Delete ${kindLabel(a.kind)} on page ${a.page}`}
        intent="destructive"
        kind="action"
        density="standard"
        onClick={(): void => onDelete(a.id)}
        icon={<Icon name="delete" size="sm" />}
      />
    </li>
  );
}

/** The stream's two empty states: an empty document (with an optional tools
 *  action) and a filter that matched nothing (no action). */
export function AnnotationEmptyState(props: {
  variant: "document" | "filter";
  onOpenTools?: () => void;
}): ReactElement {
  const { variant, onOpenTools } = props;
  if (variant === "filter") {
    return (
      <div className="ann-empty" data-ann-filtered-empty="">
        <PanelEmptyState headline="No annotations match this filter" />
      </div>
    );
  }
  return (
    <div className="ann-empty" data-annotation-empty="">
      <PanelEmptyState
        headline="No annotations"
        help="Use the annotation tools to mark up this document."
      />
      {onOpenTools !== undefined && (
        <Button
          data-ann-empty-action=""
          intent="secondary"
          kind="action"
          density="standard"
          onClick={onOpenTools}
        >
          Open annotation tools
        </Button>
      )}
    </div>
  );
}
