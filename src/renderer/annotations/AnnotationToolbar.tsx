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
  MessageCirclePlus,
} from "lucide-react";
import type { ReactElement } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence } from "motion/react";
import { useDragWindow } from "../components/useDragWindow";
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
import { TfPopover } from "../components/motion/TfMotion";
export interface AnnotationToolbarProps {
  state: AnnotationToolState;
  onAction: (action: AnnotationToolAction) => void;
  /** Disabled when no document is open (the toolbar always renders so the
   *  rail panel can show its empty state, but the tools can't be armed). */
  disabled?: boolean;
  /** B1 — Phase 10 edit-content mode. When true the per-page
   *  EditOverlay is pointer-active and the EditToolbar is rendered
   *  above the document; arming an annotation tool would either
   *  silently lose its input to the EditOverlay or visually confuse
   *  the user (two parallel pointer-active layers). We mirror the
   *  host's gating here: while editModeOpen, every tool button is
   *  rendered with `aria-disabled` + a "disabled" treatment so the
   *  toolbar reads as inert, and clicking a tool is a no-op. The
   *  host also disables the EditOverlay's pointer-events when an
   *  annotation tool is armed, so the two surfaces don't
   *  double-handle the same click. The "Select" tool stays
   *  enabled — it's a neutral viewer mode and harmless even when
   *  Edit is open. */
  editModeOpen?: boolean;
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
  const { state, onAction, disabled = false, editModeOpen = false, palette, onPaletteChange, theme = 'dark' } = props;
  const dispatch = (a: AnnotationToolAction): void => onAction(a);
  // B1 — when Edit mode is open, every annotation tool except "select"
  // is inert (selecting a tool would clash with the per-page
  // EditOverlay, which is also pointer-active). We gate per-button
  // rather than globally so the Select button still works — that's
  // a neutral viewer mode and harmless to leave active while editing.
  const editBlocksTool = (tool: AnnotationTool): boolean =>
    editModeOpen && tool !== "select";
  const armTool = (tool: AnnotationTool): void => {
    if (editBlocksTool(tool)) return;
    dispatch({ type: "set-tool", tool: toggleTool(state, tool) });
  };
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
  // DEF-147 — the color palette popover is a floating window: it can
  // be dragged by its chrome (section labels / swatch rows / gaps
  // between controls), clamped within the viewport, exactly like the
  // DEF-140 inline editor. The pad, the hue slider, the individual
  // swatch BUTTONS and the inputs are controls and keep their own
  // presses. Note: `[role='group']` must NOT be in the selector —
  // the palette's swatch rows are `role="group"` containers, so
  // matching it bailed out every press that landed on a row's
  // chrome (padding / gaps between swatches) and the popover never
  // moved when grabbed by its row; only the swatch buttons
  // themselves are excluded via `button`.
  const paletteDrag = useDragWindow({
    controlsSelector:
      "button, input, select, textarea, .color-pad, .color-hue-slider, [role='slider'], [role='button']",
  });

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

  // DEF-175 (release blocker) — the color popover must paint and
  // hit-test ABOVE the page in every theme. The frosted theme applies
  // backdrop-filter to .ann-toolbar, which makes the toolbar a
  // stacking context AND the containing block for its absolutely
  // positioned descendants: the popover's z-index: 50 used to rank
  // only inside that context, so the whole toolbar subtree (popover
  // included) stacked under the later-sibling .document-scroller —
  // invisible AND click-through (clicks fired the armed ink tool into
  // the document). The popover therefore PORTALS to document.body and
  // is placed here in viewport coordinates: right-aligned under the
  // swatch, 6px below it, clamped within the viewport like every
  // other DEF-147 floating window, and re-placed on window resize
  // while it is open. The `position: fixed` + root-context z-index 50
  // escape any frosted ancestor's stacking context, so the popover
  // floats above the scroller in all three themes while keeping its
  // own 20px acrylic blur surface (it stays in the 14-surface frosted
  // set — no chrome contract change).
  useLayoutEffect(() => {
    if (!paletteOpen) return;
    const place = (): void => {
      const el = popoverRef.current;
      const swatch = swatchRef.current;
      if (el === null || swatch === null) return;
      const anchor = swatch.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const maxLeft = Math.max(0, window.innerWidth - w);
      const maxTop = Math.max(0, window.innerHeight - h);
      el.style.position = "fixed";
      el.style.left = `${Math.min(Math.max(anchor.right - w, 0), maxLeft)}px`;
      el.style.top = `${Math.min(Math.max(anchor.bottom + 6, 0), maxTop)}px`;
    };
    place();
    window.addEventListener("resize", place);
    return (): void => window.removeEventListener("resize", place);
  }, [paletteOpen]);

  const isMarkup = MARKUP_TOOLS.includes(state.tool as AnnotationTool);
  const isInk = state.tool === "ink";
  // B3 — color picker now surfaces for markup, ink, AND the shape
  // / textbox / callout tools. Every annotation kind respects the
  // `color` field, so the picker is the same affordance regardless
  // of tool — hiding it for non-markup tools was an unnecessary
  // limitation that left rect/ellipse/arrow/callout/textbox users
  // unable to customise their accent. The pen-width row stays ink-
  // only (no other tool consumes penWidth).
  const isColorTool =
    isMarkup ||
    isInk ||
    state.tool === "rect" ||
    state.tool === "ellipse" ||
    state.tool === "arrow" ||
    state.tool === "textbox" ||
    state.tool === "callout" ||
    state.tool === "note";
  const showColorRow = isColorTool && !disabled;

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
    const isBlocked = editBlocksTool(tool);
    const isDisabled = disabled || isBlocked;
    return (
      <button
        key={tool}
        type="button"
        className={active ? "tool-btn tool-btn-active ann-tool-btn" : "tool-btn ann-tool-btn"}
        onClick={(): void => armTool(tool)}
        disabled={isDisabled}
        aria-pressed={active}
        aria-disabled={isDisabled}
        aria-label={label}
        title={isBlocked ? "Edit mode is open — close Edit to use annotation tools" : label}
        data-tool={tool}
      >
        {icon}
      </button>
    );
  };

  return (
    <div className="ann-toolbar" data-annotation-toolbar>
      {toolBtn("select", <MousePointer2 size={16} aria-hidden />, "Select (no annotation tool)")}

      <span className="toolbar-sep" aria-hidden />

      <div className="ann-toolbar-group" role="group" aria-label="Text markup">
        {toolBtn("highlight", <Highlighter size={16} aria-hidden />, "Highlight")}
        {toolBtn("underline", <Underline size={16} aria-hidden />, "Underline")}
        {toolBtn("strikeout", <Strikethrough size={16} aria-hidden />, "Strikethrough")}
      </div>

      <span className="toolbar-sep" aria-hidden />

      <div className="ann-toolbar-group" role="group" aria-label="Pen">
        {toolBtn("ink", <Pen size={16} aria-hidden />, "Pen")}
      </div>

      <span className="toolbar-sep" aria-hidden />

      <div className="ann-toolbar-group" role="group" aria-label="Text box">
        {toolBtn("textbox", <Type size={16} aria-hidden />, "Text box")}
      </div>

      <span className="toolbar-sep" aria-hidden />

      <div className="ann-toolbar-group" role="group" aria-label="Shapes">
        {toolBtn("rect", <Square size={16} aria-hidden />, "Rectangle")}
        {toolBtn("ellipse", <Circle size={16} aria-hidden />, "Ellipse")}
        {toolBtn("arrow", <ArrowUpRight size={16} aria-hidden />, "Arrow")}
        {toolBtn(
          "callout",
          <MessageCirclePlus size={16} aria-hidden />,
          "Callout",
        )}
      </div>

      <span className="toolbar-sep" aria-hidden />

      <div className="ann-toolbar-group" role="group" aria-label="Note">
        {toolBtn("note", <StickyNote size={16} aria-hidden />, "Sticky note")}
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
            {/* DEF-175 (release blocker) — the popover must escape the
                frosted .ann-toolbar stacking context (see the
                placement effect above), so the WHOLE AnimatePresence
                is portaled to document.body — AnimatePresence needs a
                real motion element child (a portal is opaque to it),
                so the portal wraps the presence boundary, not the
                other way round. Exit animations still play and the
                popover paints/hit-tests above the page in every
                theme. */}
            {createPortal(
              <AnimatePresence>
                {paletteOpen && (
                  <TfPopover
                    ref={(el): void => {
                      popoverRef.current = el;
                      paletteDrag.windowRef(el);
                    }}
                    className={
                      paletteDrag.dragging
                        ? "color-popover color-popover-dragging"
                        : "color-popover"
                    }
                    role="presentation"
                    data-color-popover
                    // Phase C — the drag offset folds into motion x/y so
                    // the popover's own enter spring composes with the
                    // drag transform instead of fighting an inline
                    // `transform:` (the CSS popover-enter travel is
                    // preserved when the offset is 0,0). The exit pins
                    // the drag position too, so a dragged popover fades
                    // out where it was dragged instead of snapping back.
                    animate={{ x: paletteDrag.offset.x, y: paletteDrag.offset.y }}
                    exit={{ x: paletteDrag.offset.x, y: paletteDrag.offset.y - 3 }}
                    {...paletteDrag.handleProps}
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
                  </TfPopover>
                )}
              </AnimatePresence>,
              document.body,
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
