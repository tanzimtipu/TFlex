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
import { useEffect, useRef, useState } from "react";
import {
  PEN_WIDTHS,
  annotationColorToCss,
  isAnnotationColor,
  annotationToolReducer,
  toggleTool,
  type AnnotationColor,
  type AnnotationColorValue,
  type AnnotationTool,
  type AnnotationToolAction,
  type AnnotationToolState,
} from "./model";
import ColorPalette, {
  paletteEqual,
} from "./ColorPalette";
import type { AnnotationColors } from "../state/colorPalette";
export interface AnnotationToolbarProps {
  state: AnnotationToolState;
  onAction: (action: AnnotationToolAction) => void;
  /** Disabled when no document is open (the toolbar always renders so the
   *  rail panel can show its empty state, but the tools can't be armed). */
  disabled?: boolean;
  /** Phase 6 — custom annotation color palette, keyed by theme. The
   *  picker surfaces the saved colors alongside the built-ins; new
   *  presets added through the picker flow back through `onPaletteChange`
   *  so the host can persist them via settings.json. */
  palette?: AnnotationColors;
  onPaletteChange?: (next: AnnotationColors) => void;
  /** The active theme. Drives which per-theme preset list the picker
   *  shows (and which bucket new presets land in). */
  theme?: 'light' | 'dark';
}

const MARKUP_TOOLS: AnnotationTool[] = ["highlight", "underline", "strikeout"];

export function AnnotationToolbar(props: AnnotationToolbarProps): ReactElement {
  const { state, onAction, disabled = false, palette, onPaletteChange, theme = 'dark' } = props;
  const dispatch = (a: AnnotationToolAction): void => onAction(a);
  const armTool = (tool: AnnotationTool): void =>
    dispatch({ type: "set-tool", tool: toggleTool(state, tool) });
  const setColor = (color: AnnotationColorValue): void => dispatch({ type: "set-color", color });
  const setPenWidth = (width: number): void => dispatch({ type: "set-pen-width", width });

  // Phase 6 — color palette popover. Lives in its own component so
  // DocumentView can hand the toolbar the saved palette without
  // threading every preset down the tree. The popover anchor is the
  // single rounded-square swatch under the active markup / ink
  // tool — clicking it opens the picker to the right of the toolbar.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const swatchRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  // Click-outside dismissal: same pattern DocumentView uses for the
  // its menus. The picker owns no global click handler so we keep
  // it side-effect-free when closed.
  useEffect(() => {
    if (!paletteOpen) return;
    const onPointer = (e: PointerEvent): void => {
      const t = e.target as Node | null;
      if (t === null) return;
      if (swatchRef.current?.contains(t)) return;
      if (popoverRef.current?.contains(t)) return;
      setPaletteOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setPaletteOpen(false);
    };
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return (): void => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [paletteOpen]);

  const isMarkup = MARKUP_TOOLS.includes(state.tool as AnnotationTool);
  const isInk = state.tool === "ink";
  const showColorRow = (isMarkup || isInk) && !disabled;

  // The active color: built-in name or custom hex. The swatch paints
  // the resolved CSS color so the picker surface matches what the
  // overlay will draw.
  const activeCssColor = annotationColorToCss(state.color);
  const isBuiltInActive = isAnnotationColor(state.color);

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

      {/* Color picker — single rounded-square swatch under the active
          markup / ink tool. Opens a popover palette to the right of
          the toolbar with built-in swatches, per-theme custom
          presets, and a full hex / RGB picker. Hidden for
          non-markup / non-ink tools so the chrome stays calm. */}
      {showColorRow && (
        <>
          <span className="toolbar-sep" aria-hidden />
          <div className="ann-color-anchor">
            <button
              ref={swatchRef}
              type="button"
              className={paletteOpen ? 'ann-color-swatch-main ann-color-swatch-main-active' : 'ann-color-swatch-main'}
              style={{ background: activeCssColor }}
              onClick={(): void => setPaletteOpen((v) => !v)}
              aria-pressed={paletteOpen}
              aria-haspopup="dialog"
              aria-label={`Annotation color. Open color picker. Current: ${activeCssColor}`}
              title={`Color: ${activeCssColor}`}
              data-color-current={activeCssColor}
            />
            {paletteOpen && (
              <div
                ref={popoverRef}
                className="color-popover"
                role="presentation"
                data-color-popover
              >
                <ColorPalette
                  theme={theme}
                  activeColor={isBuiltInActive ? (state.color as AnnotationColor) : 'yellow'}
                  activeCustomHex={isBuiltInActive ? null : state.color}
                  presets={palette ?? { light: [], dark: [] }}
                  onChange={(next): void => {
                    if (!paletteEqual(palette ?? { light: [], dark: [] }, next)) {
                      onPaletteChange?.(next);
                    }
                  }}
                  onApplyBuiltIn={setColor}
                  onApplyCustom={setColor}
                />
              </div>
            )}
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
