// Toolbar for selecting an annotation tool, with color and pen-width pickers
// for markup and ink tools. One tool is active at a time; clicking the active
// tool clears the selection (back to plain viewer / "select"). Tool / color /
// width changes flow through the AnnotationToolReducer in model.ts; the
// overlay reads them via AnnotationToolState.

import {
  Highlighter,
  Underline,
  Strikethrough,
  Pen,
  Type,
  Square,
  Circle,
  ArrowUpRight,
  StickyNote,
  MousePointer2,
  Minus,
} from "lucide-react";
import type { ReactElement } from "react";
import {
  ANNOTATION_COLORS,
  ANNOTATION_COLOR_HEX,
  PEN_WIDTHS,
  annotationToolReducer,
  toggleTool,
  type AnnotationColor,
  type AnnotationTool,
  type AnnotationToolAction,
  type AnnotationToolState,
} from "./model";
export interface AnnotationToolbarProps {
  state: AnnotationToolState;
  onAction: (action: AnnotationToolAction) => void;
  /** Disabled when no document is open (the toolbar always renders so the
   *  rail panel can show its empty state, but the tools can't be armed). */
  disabled?: boolean;
}

const MARKUP_TOOLS: AnnotationTool[] = ["highlight", "underline", "strikeout"];

export function AnnotationToolbar(props: AnnotationToolbarProps): ReactElement {
  const { state, onAction, disabled = false } = props;
  const dispatch = (a: AnnotationToolAction): void => onAction(a);
  const armTool = (tool: AnnotationTool): void =>
    dispatch({ type: "set-tool", tool: toggleTool(state, tool) });
  const setColor = (color: AnnotationColor): void => dispatch({ type: "set-color", color });
  const setPenWidth = (width: number): void => dispatch({ type: "set-pen-width", width });

  const isMarkup = MARKUP_TOOLS.includes(state.tool as AnnotationTool);
  const isInk = state.tool === "ink";

  const toolBtn = (
    tool: AnnotationTool,
    icon: ReactElement,
    label: string,
  ): ReactElement => {
    const active = state.tool === tool;
    return (
      <button
        key={tool}
        type="button"
        className={active ? "tool-btn tool-btn-active ann-tool-btn" : "tool-btn ann-tool-btn"}
        onClick={(): void => armTool(tool)}
        disabled={disabled}
        aria-pressed={active}
        aria-label={label}
        title={label}
        data-tool={tool}
      >
        {icon}
      </button>
    );
  };

  return (
    <div className="ann-toolbar" data-annotation-toolbar>
      {toolBtn("select", <MousePointer2 size={15} aria-hidden />, "Select (no annotation tool)")}

      <span className="toolbar-sep" aria-hidden />

      <div className="ann-toolbar-group" role="group" aria-label="Text markup">
        {toolBtn("highlight", <Highlighter size={15} aria-hidden />, "Highlight")}
        {toolBtn("underline", <Underline size={15} aria-hidden />, "Underline")}
        {toolBtn("strikeout", <Strikethrough size={15} aria-hidden />, "Strikethrough")}
      </div>

      <span className="toolbar-sep" aria-hidden />

      <div className="ann-toolbar-group" role="group" aria-label="Pen">
        {toolBtn("ink", <Pen size={15} aria-hidden />, "Pen")}
      </div>

      <span className="toolbar-sep" aria-hidden />

      <div className="ann-toolbar-group" role="group" aria-label="Text box">
        {toolBtn("textbox", <Type size={15} aria-hidden />, "Text box")}
      </div>

      <span className="toolbar-sep" aria-hidden />

      <div className="ann-toolbar-group" role="group" aria-label="Shapes">
        {toolBtn("rect", <Square size={15} aria-hidden />, "Rectangle")}
        {toolBtn("ellipse", <Circle size={15} aria-hidden />, "Ellipse")}
        {toolBtn("arrow", <ArrowUpRight size={15} aria-hidden />, "Arrow")}
      </div>

      <span className="toolbar-sep" aria-hidden />

      <div className="ann-toolbar-group" role="group" aria-label="Note">
        {toolBtn("note", <StickyNote size={15} aria-hidden />, "Sticky note")}
      </div>

      {/* Color picker — only meaningful for markup / ink; harmless for other
          tools because the next ink / markup op uses the new color. We hide
          it entirely for non-markup, non-ink tools to keep the chrome calm. */}
      {(isMarkup || isInk) && !disabled && (
        <>
          <span className="toolbar-sep" aria-hidden />
          <div className="ann-color-row" role="group" aria-label="Annotation color">
            {ANNOTATION_COLORS.map((c) => {
              const active = state.color === c;
              return (
                <button
                  key={c}
                  type="button"
                  className={active ? "ann-color-swatch ann-color-swatch-active" : "ann-color-swatch"}
                  style={{ background: ANNOTATION_COLOR_HEX[c] }}
                  onClick={(): void => setColor(c)}
                  aria-pressed={active}
                  aria-label={`Color ${c}`}
                  title={`Color: ${c}`}
                  data-color={c}
                />
              );
            })}
          </div>
        </>
      )}

      {isInk && !disabled && (
        <>
          <span className="toolbar-sep" aria-hidden />
          <div className="ann-pen-row" role="group" aria-label="Pen width">
            {PEN_WIDTHS.map((w) => {
              const active = state.penWidth === w;
              return (
                <button
                  key={w}
                  type="button"
                  className={active ? "ann-pen-swatch ann-pen-swatch-active" : "ann-pen-swatch"}
                  onClick={(): void => setPenWidth(w)}
                  aria-pressed={active}
                  aria-label={`Pen width ${w}`}
                  title={`Pen width: ${w} pt`}
                  data-pen-width={w}
                >
                  <Minus
                    size={Math.max(8, Math.min(18, w * 2.5))}
                    strokeWidth={Math.max(2, Math.min(6, w))}
                    aria-hidden
                  />
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

// re-export the reducer so callers don't need to import from model.ts
// separately when wiring the toolbar.
export { annotationToolReducer };
