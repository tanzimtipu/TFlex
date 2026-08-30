// Annotations panel — left rail list of every annotation in the document.
// Sorted by page, then by creation time (matches the engine's flat
// `EngineState.annotations` array). Clicking a row jumps to its page and
// flashes a brief outline around the annotation. Each row exposes a
// colour swatch picker (for kinds that take a colour), an inline text
// editor (for markup / textbox / note kinds) and a delete button.

import { useState, type ReactElement } from "react";
import {
  ANNOTATION_COLORS,
  ANNOTATION_COLOR_HEX,
  annotationColorToCss,
  annotationSummary,
  countByKind,
  hasEditableText,
  isMarkup,
  kindLabel,
  sortAnnotations,
  type Annotation,
  type AnnotationColor,
  type AnnotationPatch,
} from "./model";
import {
  ChevronRight,
  Highlighter,
  Underline,
  Strikethrough,
  Pen,
  Type,
  Square,
  Circle,
  ArrowUpRight,
  StickyNote,
  Trash2,
  MessageCirclePlus,
} from "lucide-react";

export interface AnnotationsPanelProps {
  annotations: Annotation[];
  onJumpTo: (page: number, id: string) => void;
  onEdit: (id: string, patch: AnnotationPatch) => void;
  onDelete: (id: string) => void;
}

interface RowProps {
  annotation: Annotation;
  onJumpTo: (page: number, id: string) => void;
  onEdit: (id: string, patch: AnnotationPatch) => void;
  onDelete: (id: string) => void;
}

function rowIcon(a: Annotation): ReactElement {
  const size = 14;
  switch (a.kind) {
    case "highlight":
      return <Highlighter size={size} aria-hidden />;
    case "underline":
      return <Underline size={size} aria-hidden />;
    case "strikeout":
      return <Strikethrough size={size} aria-hidden />;
    case "ink":
      return <Pen size={size} aria-hidden />;
    case "textbox":
      return <Type size={size} aria-hidden />;
    case "rect":
      return <Square size={size} aria-hidden />;
    case "ellipse":
      return <Circle size={size} aria-hidden />;
    case "arrow":
      return <ArrowUpRight size={size} aria-hidden />;
    case "note":
      return <StickyNote size={size} aria-hidden />;
    case "callout":
      return <MessageCirclePlus size={size} aria-hidden />;
  }
}

function AnnotationRow(props: RowProps): ReactElement {
  const { annotation, onJumpTo, onEdit, onDelete } = props;
  const a = annotation;
  const editableText = hasEditableText(a) || isMarkup(a);
  const aText = "text" in a ? a.text : "";
  const [editing, setEditing] = useState(false);
  const [draftText, setDraftText] = useState(aText);

  const commitText = (): void => {
    const trimmed = draftText.trim();
    setEditing(false);
    if (trimmed === aText) return;
    onEdit(a.id, { text: trimmed });
  };

  return (
    <li className="ann-panel-row" data-annotation-row={a.id}>
      <div className="ann-panel-row-head">
        <button
          type="button"
          className="ann-panel-row-jump"
          onClick={(): void => onJumpTo(a.page, a.id)}
          aria-label={`Jump to ${kindLabel(a.kind)} on page ${a.page}`}
          title={`Jump to ${kindLabel(a.kind)} on page ${a.page}`}
        >
          <span className="ann-panel-row-icon" style={{ color: annotationColorToCss(a.color) }}>
            {rowIcon(a)}
          </span>
          <span className="ann-panel-row-text">
            <span className="ann-panel-row-kind">{kindLabel(a.kind)}</span>
            <span className="ann-panel-row-page">Page {a.page}</span>
          </span>
          <ChevronRight size={12} aria-hidden />
        </button>
        <button
          type="button"
          className="ann-panel-row-delete"
          onClick={(): void => onDelete(a.id)}
          aria-label={`Delete ${kindLabel(a.kind)} on page ${a.page}`}
          title="Delete annotation"
        >
          <Trash2 size={12} aria-hidden />
        </button>
      </div>

      <div className="ann-panel-row-body">
        <div className="ann-panel-color-row" role="group" aria-label="Color">
          {ANNOTATION_COLORS.map((c) => {
            const active = a.color === c;
            return (
              <button
                key={c}
                type="button"
                className={
                  active
                    ? "ann-panel-swatch ann-panel-swatch-active"
                    : "ann-panel-swatch"
                }
                style={{ background: ANNOTATION_COLOR_HEX[c as AnnotationColor] }}
                onClick={(): void => onEdit(a.id, { color: c })}
                aria-pressed={active}
                aria-label={`Color ${c}`}
                title={`Color: ${c}`}
                data-color={c}
              />
            );
          })}
        </div>

        {editableText ? (
          editing ? (
            <textarea
              className="ann-panel-text"
              value={draftText}
              autoFocus
              rows={2}
              onChange={(e): void => setDraftText(e.target.value)}
              onBlur={commitText}
              onKeyDown={(e): void => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  setDraftText(aText);
                  setEditing(false);
                } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  commitText();
                }
              }}
              placeholder={isMarkup(a) ? "Markup text" : "Note text"}
            />
          ) : (
            <button
              type="button"
              className="ann-panel-text ann-panel-text-display"
              onClick={(): void => {
                setDraftText(aText);
                setEditing(true);
              }}
              title="Click to edit"
            >
              {annotationSummary(a)}
            </button>
          )
        ) : (
          <span className="ann-panel-text ann-panel-text-readonly">{annotationSummary(a)}</span>
        )}
      </div>
    </li>
  );
}

export function AnnotationsPanel(props: AnnotationsPanelProps): ReactElement {
  const { annotations, onJumpTo, onEdit, onDelete } = props;
  const sorted = sortAnnotations(annotations);
  const counts = countByKind(annotations);
  const total = sorted.length;

  return (
    <div className="ann-panel" data-annotation-panel>
      <div className="ann-panel-header">
        <span className="ann-panel-title">Annotations</span>
        <span className="ann-panel-count">{total}</span>
      </div>
      {total === 0 ? (
        <div className="ann-panel-empty">
          <span>No annotations yet.</span>
          <span className="hint">
            Pick a tool from the toolbar, then click or drag on a page.
          </span>
        </div>
      ) : (
        <>
          <div className="ann-panel-summary">
            {Object.entries(counts)
              .filter(([, n]) => n > 0)
              .map(([k, n]) => (
                <span key={k} className="ann-panel-summary-pill">
                  {kindLabel(k as keyof typeof counts)} {n}
                </span>
              ))}
          </div>
          <ul className="ann-panel-list">
            {sorted.map((a) => (
              <AnnotationRow
                key={a.id}
                annotation={a}
                onJumpTo={onJumpTo}
                onEdit={onEdit}
                onDelete={onDelete}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
