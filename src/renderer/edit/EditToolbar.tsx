// Phase 10 — Edit-mode toolbar.
//
// Rendered by App.tsx above the page when Edit mode is active. The
// user clicks one of the four tool buttons to switch the active
// tool. The selected tool drives the per-page EditOverlay.
//
// Phase 13 — the toolbar is icon-only: each button carries its
// action in `aria-label` + `title` (the shared a11y contract for
// icon-only chrome) and the one-line status hint beside the tools
// tells the user what the armed tool will do on the next click.
//
// Why a separate component (vs. reusing the AnnotationToolbar):
// the annotation palette is centred on "create one annotation then
// return to select"; the edit palette is "drive a continuous
// interaction". The two share the tools-palette container so the
// user can move between them, but their internal layouts differ.

import { ChevronLeft, ChevronRight, Image, MousePointer2, Plus, Type } from "lucide-react";
import { useRef, type ReactElement } from "react";
import type { EditFont } from "../../shared/types";
import { EDIT_DEFAULT_FONTS, DEFAULT_EDIT_DEFAULT_FONT } from "../state/preferences";
import type { EditTextStyle, EditTool } from "./model";
import type { DockLadder } from "../state/dockResponsive";
import { resolveSecondaryRowLadder } from "../state/secondaryRow";
import { useRowOverflow } from "../hooks/useRowOverflow";
import { TfBar } from "../components/motion/TfMotion";

/** How far one arrow click scrolls the single tool row (mirrors the dock). */
const EDIT_TOOLBAR_SCROLL_STEP = 160;

export interface EditToolbarProps {
  tool: EditTool;
  onSelect: (tool: EditTool) => void;
  /** Default font for the next edit. Rendered as a dropdown so the
   *  user can override per-session without opening Preferences. */
  defaultFont: EditFont;
  onDefaultFontChange: (font: EditFont) => void;
  /** When false the toolbar is rendered but the buttons are
   *  disabled. We never hide it outright so the user can see the
   *  mode is on (matches the annotation toolbar's "select" tool
   *  which is always available). */
  enabled: boolean;
  /** Status hint, e.g. "Click a text run to edit" or "Drag to place
   *  a new text box". The toolbar renders this as a one-line
   *  caption so the user always knows what the next click does. */
  hint: string;
  /** Phase 37 (item 3) — the ONE responsive ladder the host resolved. The
   *  EditToolbar is the secondary surface for the edit tools, so it hides its
   *  labels first and then shows scroll arrows exactly like the dock. */
  ladder?: DockLadder;
}

export function EditToolbar(props: EditToolbarProps): ReactElement {
  const { tool, onSelect, defaultFont, onDefaultFontChange, enabled, hint, ladder } = props;
  const { iconOnly, arrows: arrowsLane } = resolveSecondaryRowLadder(ladder);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // DEF-337 — the arrows render only when the row genuinely overflows, so a
  // row that already fits never offers a dead control.
  const arrows = useRowOverflow(scrollRef, arrowsLane);

  /** Phase 37 (item 3) — scroll the single row by one step (arrows rung). */
  const scrollRow = (direction: -1 | 1): void => {
    const el = scrollRef.current;
    if (el === null) return;
    const delta = direction * EDIT_TOOLBAR_SCROLL_STEP;
    if (typeof el.scrollBy === 'function') {
      el.scrollBy({ left: delta, behavior: 'smooth' });
    } else {
      el.scrollLeft += delta;
    }
  };

  return (
    <TfBar
      className="edit-toolbar"
      data-edit-toolbar
      data-edit-icon-only={iconOnly ? 'true' : 'false'}
      data-edit-arrows={arrows ? 'true' : 'false'}
      role="toolbar"
      aria-label="Edit tools"
    >
      {/* Phase 37 (item 3) — the row never wraps; at the ladder's last rung the
          arrows scroll it instead (mirrors the dock's single-row behaviour). */}
      {arrows && (
        <button
          type="button"
          className="edit-toolbar-arrow"
          data-edit-arrow="left"
          aria-label="Scroll edit tools left"
          title="Scroll left"
          onClick={(): void => scrollRow(-1)}
        >
          <ChevronLeft size={16} aria-hidden />
        </button>
      )}
      <div className="edit-toolbar-scroll" ref={scrollRef} data-edit-toolbar-scroll>
      <button
        type="button"
        className={tool === "off" ? "edit-toolbar-btn edit-toolbar-btn-active" : "edit-toolbar-btn"}
        aria-pressed={tool === "off"}
        aria-label="Edit mode off (plain viewer)"
        disabled={!enabled}
        onClick={(): void => onSelect("off")}
        title="Edit mode off: plain viewer"
        data-edit-tool="off"
      >
        <MousePointer2 size={20} aria-hidden />
      </button>
      <button
        type="button"
        className={tool === "text" ? "edit-toolbar-btn edit-toolbar-btn-active" : "edit-toolbar-btn"}
        aria-pressed={tool === "text"}
        aria-label="Edit text"
        disabled={!enabled}
        onClick={(): void => onSelect("text")}
        title="Edit text: click a run to replace it"
        data-edit-tool="text"
      >
        <Type size={20} aria-hidden />
      </button>
      <button
        type="button"
        className={tool === "box" ? "edit-toolbar-btn edit-toolbar-btn-active" : "edit-toolbar-btn"}
        aria-pressed={tool === "box"}
        aria-label="Add a text box"
        disabled={!enabled}
        onClick={(): void => onSelect("box")}
        title="Add a text box: drag on the page to place it"
        data-edit-tool="box"
      >
        <Plus size={20} aria-hidden />
      </button>
      <button
        type="button"
        className={tool === "image" ? "edit-toolbar-btn edit-toolbar-btn-active" : "edit-toolbar-btn"}
        aria-pressed={tool === "image"}
        aria-label="Edit images"
        disabled={!enabled}
        onClick={(): void => onSelect("image")}
        title="Edit images: click an image to select, drag a rect to place a new one"
        data-edit-tool="image"
      >
        <Image size={20} aria-hidden />
      </button>
      <div className="edit-toolbar-divider" aria-hidden />
      <label className="edit-toolbar-font">
        {/* Rung 3 — the label hides before anything scrolls. */}
        {!iconOnly && <span className="edit-toolbar-font-label">Font</span>}
        <select
          value={defaultFont}
          onChange={(e): void => {
            const v = e.target.value;
            if (EDIT_DEFAULT_FONTS.includes(v as EditFont)) {
              onDefaultFontChange(v as EditFont);
            }
          }}
          aria-label="Default font"
          disabled={!enabled}
        >
          {EDIT_DEFAULT_FONTS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </label>
      {/* Rung 3 — the status hint is a label; it hides with the font label. */}
      {!iconOnly && (
        <div className="edit-toolbar-hint" data-edit-hint>
          {hint}
        </div>
      )}
      </div>
      {arrows && (
        <button
          type="button"
          className="edit-toolbar-arrow"
          data-edit-arrow="right"
          aria-label="Scroll edit tools right"
          title="Scroll right"
          onClick={(): void => scrollRow(1)}
        >
          <ChevronRight size={16} aria-hidden />
        </button>
      )}
    </TfBar>
  );
}

/** Default hint text per tool. */
export function defaultEditHint(tool: EditTool): string {
  switch (tool) {
    case "off":
      return "Edit mode is off. Pick a tool to start editing.";
    case "text":
      return "Click a text run to replace it.";
    case "box":
      return "Drag on the page to place a new text box.";
    case "image":
      return "Click an image to select; drag a new rect to place one.";
  }
}

/** Build a default text style. Pulled out of the toolbar so the
 *  EditOverlay can use the same factory. */
export function defaultEditTextStyleFor(font: EditFont | undefined): EditTextStyle {
  return {
    font: font ?? DEFAULT_EDIT_DEFAULT_FONT,
    size: 12,
    color: { r: 0, g: 0, b: 0 },
  };
}
