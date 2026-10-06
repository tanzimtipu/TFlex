// Annotations panel — left rail list of every annotation in the document.
// Sorted by page, then by creation time (matches the engine's flat
// `EngineState.annotations` array). Clicking a row jumps to its page and
// flashes a brief outline around the annotation. Each row exposes a
// colour swatch picker (for kinds that take a colour), an inline text
// editor (for markup / textbox / note kinds) and a delete button.

import { useMemo, useState, type ReactElement } from "react";
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
import { Icon } from "../icons/Icon";
import {
  PanelEmptyState,
  PanelSection,
  PanelShell,
  ScopedHeader,
} from "../components/panels/PanelPrimitives";

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
          <Icon name="nextPage" size="sm" />
        </button>
        <button
          type="button"
          className="ann-panel-row-delete"
          onClick={(): void => onDelete(a.id)}
          aria-label={`Delete ${kindLabel(a.kind)} on page ${a.page}`}
          title="Delete annotation"
        >
          <Icon name="delete" size="sm" />
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

/** One page's worth of annotations, in the sorted order. */
interface AnnotationPageGroup {
  page: number;
  items: Annotation[];
}

/** Group the page-ordered annotations by page, preserving their order. */
function groupByPage(sorted: readonly Annotation[]): AnnotationPageGroup[] {
  const groups: AnnotationPageGroup[] = [];
  for (const a of sorted) {
    const last = groups[groups.length - 1];
    if (last !== undefined && last.page === a.page) {
      last.items.push(a);
    } else {
      groups.push({ page: a.page, items: [a] });
    }
  }
  return groups;
}

export function AnnotationsPanel(props: AnnotationsPanelProps): ReactElement {
  const { annotations, onJumpTo, onEdit, onDelete } = props;
  const sorted = useMemo((): Annotation[] => sortAnnotations(annotations), [annotations]);
  const groups = useMemo((): AnnotationPageGroup[] => groupByPage(sorted), [sorted]);
  const counts = useMemo(() => countByKind(annotations), [annotations]);
  const total = sorted.length;

  return (
    <PanelShell className="ann-panel" label="Annotations" data-annotation-panel>
      <ScopedHeader
        className="ann-panel-header"
        preferredHeight
        title="Annotations"
        actions={<span className="ann-panel-count">{total}</span>}
      />
      {total === 0 ? (
        <div className="ann-panel-empty">
          <PanelEmptyState
            className="ann-panel-empty-state"
            data-annotation-empty
            headline="No annotations"
          />
          <span className="hint">
            Pick an annotation tool from the toolbar, then click or drag on a page.
          </span>
        </div>
      ) : (
        <>
          <div className="ann-panel-summary" data-annotation-summary>
            {Object.entries(counts)
              .filter(([, n]) => n > 0)
              .map(([k, n]) => (
                <span key={k} className="ann-panel-summary-pill">
                  {kindLabel(k as keyof typeof counts)} {n}
                </span>
              ))}
          </div>
          <div className="ann-panel-list">
            {groups.map((group) => (
              <PanelSection
                key={group.page}
                className="ann-panel-group"
                titleClassName="ann-panel-group-title"
                bodyClassName="ann-panel-group-body"
                data-annotation-page={group.page}
                title={`Page ${group.page}`}
              >
                <ul className="ann-panel-group-list">
                  {group.items.map((a) => (
                    <AnnotationRow
                      key={a.id}
                      annotation={a}
                      onJumpTo={onJumpTo}
                      onEdit={onEdit}
                      onDelete={onDelete}
                    />
                  ))}
                </ul>
              </PanelSection>
            ))}
          </div>
        </>
      )}
    </PanelShell>
  );
}
