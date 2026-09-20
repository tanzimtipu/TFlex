// Phase 19 — the annotation tool GROUP inside the CommandBar.
//
// The Phase 14.2 standalone `.ann-toolbar` row is retired. The tools
// render as the LAST GlassControlGroup capsule of the CommandBar
// (label "Annotate"): [five visible MRU tool buttons] [colour swatch]
// [all-tools dropdown arrow]. The group root keeps the `ann-toolbar`
// class + `data-annotation-toolbar` as inert hooks so the existing e2e
// selectors resolve, but it carries NO row chrome (the freed row
// height returns to the page view).
//
// The visible five are `visibleAnnotationTools(recent)` (MRU-first,
// canonical padding). Arming any tool (visible or from the menu)
// promotes it through `onAnnotationRecentToolsChange`. The menu is a
// portaled TfPopover (the DEF-175 lesson: the CommandBar's frosted
// backdrop-filter makes it a stacking context, so the menu must escape
// to document.body). The ink-only pen-width row lives inside the menu.

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
  ChevronDown,
  Check,
} from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent, ReactElement } from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence } from "motion/react";
import { useDragWindow } from "../components/useDragWindow";
import { GlassControlGroup } from "../components/GlassChrome";
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
import { markMenuDismissPointer } from "./menuDismissGuard";
import type { AnnotationColors } from "../state/colorPalette";
import { TfMorph, TfPopover } from "../components/motion/TfMotion";
import { useMorphPreset } from "../components/motion/useMorphPreset";
import {
  promoteAnnotationTool,
  visibleAnnotationTools,
} from "../state/preferences";
export interface AnnotationToolbarProps {
  state: AnnotationToolState;
  onAction: (action: AnnotationToolAction) => void;
  /** Disabled when no document is open (the group always renders so the
   *  rail panel can show its empty state, but the tools can't be armed). */
  disabled?: boolean;
  /** B1 — Phase 10 edit-content mode. When true the per-page
   *  EditOverlay is pointer-active and the EditToolbar is rendered
   *  above the document; arming an annotation tool would either
   *  silently lose its input to the EditOverlay or visually confuse
   *  the user (two parallel pointer-active layers). We mirror the
   *  host's gating here: while editModeOpen, every tool button is
   *  rendered with `aria-disabled` + a "disabled" treatment so the
   *  group reads as inert, and clicking a tool is a no-op. The
   *  "Select" tool stays enabled — it's a neutral viewer mode and
   *  harmless even when Edit is open. */
  editModeOpen?: boolean;
  /** Phase 13 — Hand (pan) mode. When true the document scroller is
   *  grab-and-drag panning; arming an annotation tool would fight the
   *  drag gesture for the same pointer input (two parallel
   *  pointer-active layers). While hand mode is on, EVERY tool button
   *  is rendered with `aria-disabled` + a "disabled" treatment so the
   *  group reads as inert, and clicking a tool is a no-op. */
  handModeOpen?: boolean;
  /** Phase 6 — custom annotation color palette, keyed by theme. */
  palette?: AnnotationColors;
  onPaletteChange?: (next: AnnotationColors) => void;
  /** The active theme. Drives which per-theme preset list the picker
   *  shows (and which bucket new presets land in). */
  theme?: 'light' | 'dark';
  /** Phase 19 — persisted MRU annotation tool order (most-recent-first,
   *  sanitised by the backend to known ids, deduped, capped at 6). An
   *  absent value behaves like an empty list (the canonical default
   *  five show). */
  annotationRecentTools?: string[];
  /** Phase 19 — reports a new MRU order after the user arms a tool, so
   *  the host can persist it. */
  onAnnotationRecentToolsChange?: (ids: string[]) => void;
  /** Phase 26 — the SELECTED committed annotation's colour (or null when
   *  nothing is selected). The in-canvas colour palette that a
   *  double-clicked shape used to open is gone: this toolbar's colour
   *  control is the shape / text colour path, so it stays visible (and
   *  reflects the annotation's actual colour) while an annotation is
   *  selected, even though the active tool is plain "select". */
  selectedColor?: AnnotationColorValue | null;
}

const MARKUP_TOOLS: AnnotationTool[] = ["highlight", "underline", "strikeout"];

/** Concise labels for the tool buttons and the menu rows. */
const TOOL_LABELS: Record<AnnotationTool, string> = {
  select: "Select",
  highlight: "Highlight",
  underline: "Underline",
  strikeout: "Strikethrough",
  ink: "Pen",
  textbox: "Text box",
  rect: "Rectangle",
  ellipse: "Ellipse",
  arrow: "Arrow",
  callout: "Callout",
  note: "Sticky note",
};

/** The dropdown sections, in the canonical order. */
const TOOL_GROUPS: readonly {
  label: string;
  tools: readonly AnnotationTool[];
}[] = [
  { label: "Select", tools: ["select"] },
  { label: "Text markup", tools: ["highlight", "underline", "strikeout"] },
  { label: "Pen", tools: ["ink"] },
  { label: "Text box", tools: ["textbox"] },
  { label: "Shapes", tools: ["rect", "ellipse", "arrow", "callout"] },
  { label: "Note", tools: ["note"] },
];

/** The flat menu order — the keyboard highlight walks this list. */
const MENU_TOOLS: readonly AnnotationTool[] = TOOL_GROUPS.flatMap(
  (g) => g.tools,
);

/** ADV-047 / DEF-228 — the tool id of the menu row that currently has
 *  DOM focus, when the keydown target sits inside one. Returns null
 *  when focus is elsewhere (the menu container itself, a pen-width
 *  swatch, ...), so those controls keep their own native activation. */
function focusedMenuRowTool(target: EventTarget | null): AnnotationTool | null {
  if (!(target instanceof Element)) return null;
  const row = target.closest(".ann-tool-menu-row");
  const id = row?.getAttribute("data-tool");
  if (id === null || id === undefined) return null;
  return MENU_TOOLS.find((t) => t === id) ?? null;
}

function toolIcon(tool: AnnotationTool, size: number): ReactElement {
  switch (tool) {
    case "select":
      return <MousePointer2 size={size} aria-hidden />;
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
    case "callout":
      return <MessageCirclePlus size={size} aria-hidden />;
    case "note":
      return <StickyNote size={size} aria-hidden />;
  }
}

export function AnnotationToolbar(props: AnnotationToolbarProps): ReactElement {
  const {
    state,
    onAction,
    disabled = false,
    editModeOpen = false,
    handModeOpen = false,
    palette,
    onPaletteChange,
    theme = 'dark',
    annotationRecentTools,
    onAnnotationRecentToolsChange,
  } = props;
  const dispatch = (a: AnnotationToolAction): void => onAction(a);
  const recentTools = annotationRecentTools ?? [];
  const visibleTools = visibleAnnotationTools(recentTools) as AnnotationTool[];
  // B1 — when Edit mode is open, every annotation tool except "select"
  // is inert (selecting a tool would clash with the per-page
  // EditOverlay, which is also pointer-active). We gate per-button
  // rather than globally so the Select button still works.
  const editBlocksTool = (tool: AnnotationTool): boolean =>
    editModeOpen && tool !== "select";
  // Phase 13 — hand (pan) mode blocks EVERY tool including select.
  const handBlocksTool = (): boolean => handModeOpen;
  const armTool = (tool: AnnotationTool): void => {
    if (handBlocksTool()) return;
    if (editBlocksTool(tool)) return;
    dispatch({ type: "set-tool", tool: toggleTool(state, tool) });
    // Phase 19 — arming any tool (visible or from the menu) promotes it
    // to the front of the persisted MRU order.
    onAnnotationRecentToolsChange?.(promoteAnnotationTool(recentTools, tool));
  };
  const setColor = (color: AnnotationColorValue): void => dispatch({ type: "set-color", color });
  const setPenWidth = (width: number): void => dispatch({ type: "set-pen-width", width });

  // Phase 19 — all-tools dropdown. The toggle opens a portaled menu
  // (the CommandBar is a frosted stacking context — DEF-175), the
  // keyboard highlight walks MENU_TOOLS, Enter arms, Escape / outside
  // click / re-click close.
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuIndex, setMenuIndex] = useState(0);
  const toggleRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (menuOpen) {
      const idx = MENU_TOOLS.indexOf(state.tool as AnnotationTool);
      setMenuIndex(idx < 0 ? 0 : idx);
    }
  }, [menuOpen, state.tool]);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (e: PointerEvent): void => {
      const t = e.target as Node | null;
      if (t === null) return;
      if (toggleRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      // DEF-227 (ADV-046) — this pointerdown is the dismiss gesture.
      // Mark the exact native event so the page overlay can consume it
      // and skip the placement gesture. CAPTURE phase is required: the
      // overlay's React pointerdown runs at the root (deeper in the
      // tree) and would otherwise fire before this window listener.
      // Closing a portal in capture does not disturb the target's own
      // click (the menu is not an ancestor of the target), so the
      // measured "CommandBar button closes the menu AND activates"
      // behaviour is preserved.
      markMenuDismissPointer(e);
      setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setMenuOpen(false);
        toggleRef.current?.focus();
      }
    };
    window.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('keydown', onKey);
    return (): void => {
      window.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  // The menu is placed in viewport coordinates under the arrow,
  // right-aligned and clamped — the same placement contract as the
  // colour popover (DEF-175 / DEF-147).
  useLayoutEffect(() => {
    if (!menuOpen) return;
    const place = (): void => {
      const el = menuRef.current;
      const anchorEl = toggleRef.current;
      if (el === null || anchorEl === null) return;
      const anchor = anchorEl.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const maxLeft = Math.max(0, window.innerWidth - w);
      const maxTop = Math.max(0, window.innerHeight - h);
      el.style.position = "fixed";
      el.style.left = `${Math.min(Math.max(anchor.right - w, 0), maxLeft)}px`;
      // Phase 20 — flush under the toggle (was anchor.bottom + 6): the
      // morph's first frame is the toggle's own box, so the anchored edge
      // must touch it with no seam.
      el.style.top = `${Math.min(Math.max(anchor.bottom, 0), maxTop)}px`;
    };
    place();
    // Keyboard: move focus into the menu so ArrowUp/Down + Enter reach
    // the menu's key handler (the spec's keyboard contract).
    menuRef.current?.focus();
    window.addEventListener("resize", place);
    return (): void => window.removeEventListener("resize", place);
  }, [menuOpen]);

  // Phase 20 — the all-tools dropdown MORPHS out of its arrow button. The
  // measurement runs AFTER the placement effect above (hook order), so the
  // rect it reads is the final, clamped one.
  const menuMorph = useMorphPreset({
    open: menuOpen,
    triggerRef: toggleRef,
    surfaceRef: menuRef,
    anchorCorner: "top-right",
  });

  const selectFromMenu = (tool: AnnotationTool): void => {
    armTool(tool);
    setMenuOpen(false);
    toggleRef.current?.focus();
  };

  const onToggleKeyDown = (e: ReactKeyboardEvent): void => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setMenuOpen(true);
    }
  };

  const onMenuKeyDown = (e: ReactKeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setMenuIndex((i) => (i + 1) % MENU_TOOLS.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setMenuIndex((i) => (i - 1 + MENU_TOOLS.length) % MENU_TOOLS.length);
    } else if (e.key === 'Enter' || e.key === ' ') {
      // ADV-047 / DEF-228 — Enter and Space must arm the row that has
      // DOM focus (the Tab model), falling back to the arrow-key
      // highlight (menuIndex) when the container itself is focused.
      // Any other focused control (e.g. a pen-width swatch) keeps its
      // own native activation.
      const focused = focusedMenuRowTool(e.target);
      if (focused === null && e.target !== menuRef.current) return;
      e.preventDefault();
      const tool = focused ?? MENU_TOOLS[menuIndex];
      if (tool !== undefined) selectFromMenu(tool);
    } else if (e.key === 'Escape') {
      setMenuOpen(false);
      toggleRef.current?.focus();
    }
  };

  // Phase 6 — color palette popover. Lives in its own component so
  // DocumentView can hand the toolbar the saved palette without
  // threading every preset down the tree.
  const [paletteOpen, setPaletteOpen] = useState(false);
  const swatchRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  // DEF-147 — the color palette popover is a floating window: it can
  // be dragged by its chrome. The pad, the hue slider, the individual
  // swatch BUTTONS and the inputs are controls and keep their own
  // presses. `[role='group']` must NOT be in the selector.
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
  // hit-test ABOVE the page in every theme. The popover therefore
  // PORTALS to document.body and is placed here in viewport
  // coordinates: right-aligned under the swatch, flush to its bottom
  // edge, clamped within the viewport like every other DEF-147 floating
  // window, and re-placed on window resize while it is open. Phase 22
  // (DEF-248) — the old +6px offset left a visible seam between the
  // swatch and the palette; the joined edge is now gap 0 (the surface's
  // top hairline is removed in CSS, so the pair reads as one box).
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
      el.style.top = `${Math.min(Math.max(anchor.bottom, 0), maxTop)}px`;
    };
    place();
    window.addEventListener("resize", place);
    return (): void => window.removeEventListener("resize", place);
  }, [paletteOpen]);

  const isMarkup = MARKUP_TOOLS.includes(state.tool as AnnotationTool);
  const isInk = state.tool === "ink";
  // B3 — color picker now surfaces for markup, ink, AND the shape
  // / textbox / callout tools. The pen-width row stays ink-only.
  const isColorTool =
    isMarkup ||
    isInk ||
    state.tool === "rect" ||
    state.tool === "ellipse" ||
    state.tool === "arrow" ||
    state.tool === "textbox" ||
    state.tool === "callout" ||
    state.tool === "note";
  const showColorRow = (isColorTool || (props.selectedColor ?? null) !== null) && !disabled;

  const activeCssColor = annotationColorToCss(props.selectedColor ?? state.color);
  const isBuiltInActive = isAnnotationColor(state.color);

  const toolTitle = (tool: AnnotationTool, isBlocked: boolean, isHandBlocked: boolean): string =>
    isHandBlocked
      ? "Pan mode is on — click the toolbar's Pan button (or press Escape) to use annotation tools"
      : isBlocked
        ? "Edit mode is open — close Edit to use annotation tools"
        : TOOL_LABELS[tool];

  const toolBtn = (tool: AnnotationTool): ReactElement => {
    const active = state.tool === tool;
    const isBlocked = editBlocksTool(tool);
    const isHandBlocked = handBlocksTool();
    const isDisabled = disabled || isBlocked || isHandBlocked;
    const label = tool === "select" ? "Select (no annotation tool)" : TOOL_LABELS[tool];
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
        title={toolTitle(tool, isBlocked, isHandBlocked)}
        data-tool={tool}
      >
        {toolIcon(tool, 22)}
      </button>
    );
  };

  // Phase 19 — the group is the CommandBar's LAST capsule: the five
  // MRU tool buttons, the colour swatch (colour-capable tools only),
  // then the all-tools dropdown arrow. `ann-toolbar` is an inert hook
  // (no row styling); `data-annotation-toolbar` keeps the e2e address.
  return (
    <GlassControlGroup
      label="Annotate"
      className="toolbar-group commandbar-group-annotate ann-toolbar"
      data-annotation-toolbar=""
    >
      <div
        className="ann-tools-visible"
        role="group"
        aria-label="Recent annotation tools"
        data-ann-tools-visible
      >
        {visibleTools.map((tool) => toolBtn(tool))}
      </div>

      {/* Color picker — single rounded-square swatch under the active
          colour-capable tool. Opens the existing palette popover. */}
      {showColorRow && (
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
            data-ann-color
            data-color-current={activeCssColor}
          />
          {/* DEF-175 (release blocker) — the popover must escape the
              frosted CommandBar stacking context (see the placement
              effect above), so the WHOLE AnimatePresence is portaled to
              document.body — AnimatePresence needs a real motion element
              child (a portal is opaque to it), so the portal wraps the
              presence boundary, not the other way round. */}
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
      )}

      {/* The all-tools dropdown arrow. Rotation uses a motion token in
          CSS; the menu itself is a portaled TfPopover (DEF-175). */}
      <button
        ref={toggleRef}
        type="button"
        className={
          menuOpen
            ? "tool-btn ann-dropdown-toggle ann-dropdown-toggle-open"
            : "tool-btn ann-dropdown-toggle"
        }
        onClick={(): void => setMenuOpen((v) => !v)}
        onKeyDown={onToggleKeyDown}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label="All annotation tools"
        title="All annotation tools"
        data-ann-dropdown-toggle
      >
        <ChevronDown size={22} aria-hidden />
      </button>

      {createPortal(
        <AnimatePresence>
          {menuOpen && (
            <TfMorph
              morph={menuMorph}
              ref={(el): void => {
                menuRef.current = el;
              }}
              className="ann-tool-menu"
              role="menu"
              aria-label="Annotation tools"
              tabIndex={-1}
              data-ann-dropdown-menu
              onKeyDown={onMenuKeyDown}
            >
              {TOOL_GROUPS.map((group) => (
                <div
                  key={group.label}
                  className="ann-tool-menu-group"
                  role="group"
                  aria-label={group.label}
                >
                  <div className="ann-tool-menu-label" aria-hidden>
                    {group.label}
                  </div>
                  {group.tools.map((tool) => {
                    const active = state.tool === tool;
                    const highlighted = MENU_TOOLS.indexOf(tool) === menuIndex;
                    const isBlocked = editBlocksTool(tool);
                    const isHandBlocked = handBlocksTool();
                    const isDisabled = disabled || isBlocked || isHandBlocked;
                    return (
                      <button
                        key={tool}
                        type="button"
                        role="menuitemradio"
                        aria-checked={active}
                        className={
                          highlighted
                            ? "ann-tool-menu-row ann-tool-menu-row-highlight"
                            : "ann-tool-menu-row"
                        }
                        onClick={(): void => selectFromMenu(tool)}
                        disabled={isDisabled}
                        aria-disabled={isDisabled}
                        aria-label={TOOL_LABELS[tool]}
                        title={toolTitle(tool, isBlocked, isHandBlocked)}
                        data-tool={tool}
                      >
                        <span className="ann-tool-menu-icon">{toolIcon(tool, 18)}</span>
                        <span className="ann-tool-menu-text">{TOOL_LABELS[tool]}</span>
                        {active && <Check size={14} aria-hidden className="ann-tool-menu-check" />}
                      </button>
                    );
                  })}
                </div>
              ))}

              {/* Pen width — ink-only, moved into the dropdown panel. */}
              {isInk && !disabled && (
                <div
                  className="ann-pen-row ann-tool-menu-pen"
                  role="group"
                  aria-label="Pen width"
                  data-pen-width-row
                >
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
              )}
            </TfMorph>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </GlassControlGroup>
  );
}

// re-export the reducer so callers don't need to import from model.ts
// separately when wiring the toolbar.
export { annotationToolReducer };


