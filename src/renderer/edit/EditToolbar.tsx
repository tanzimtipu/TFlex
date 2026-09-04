// Phase 10 — Edit-mode toolbar.
//
// Rendered by App.tsx above the page when Edit mode is active. The
// user clicks one of the four tool buttons to switch the active
// tool. The selected tool drives the per-page EditOverlay.
//
// Why a separate component (vs. reusing the AnnotationToolbar):
// the annotation palette is centred on "create one annotation then
// return to select"; the edit palette is "drive a continuous
// interaction". The two share the tools-palette container so the
// user can move between them, but their internal layouts differ.

import { Image, MousePointer2, Plus, Type } from "lucide-react";
import type { ReactElement } from "react";
import type { EditFont } from "../../shared/types";
import { EDIT_DEFAULT_FONTS, DEFAULT_EDIT_DEFAULT_FONT } from "../state/preferences";
import type { EditTextStyle, EditTool } from "./model";

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
}

export function EditToolbar(props: EditToolbarProps): ReactElement {
  const { tool, onSelect, defaultFont, onDefaultFontChange, enabled, hint } = props;
  return (
    <div className="edit-toolbar" data-edit-toolbar role="toolbar" aria-label="Edit tools">
      <button
        type="button"
        className={tool === "off" ? "edit-toolbar-btn edit-toolbar-btn-active" : "edit-toolbar-btn"}
        aria-pressed={tool === "off"}
        disabled={!enabled}
        onClick={(): void => onSelect("off")}
        title="Edit mode off"
        data-edit-tool="off"
      >
        <MousePointer2 size={16} aria-hidden />
        <span>Off</span>
      </button>
      <button
        type="button"
        className={tool === "text" ? "edit-toolbar-btn edit-toolbar-btn-active" : "edit-toolbar-btn"}
        aria-pressed={tool === "text"}
        disabled={!enabled}
        onClick={(): void => onSelect("text")}
        title="Edit text: click a run to replace it"
        data-edit-tool="text"
      >
        <Type size={16} aria-hidden />
        <span>Edit text</span>
      </button>
      <button
        type="button"
        className={tool === "box" ? "edit-toolbar-btn edit-toolbar-btn-active" : "edit-toolbar-btn"}
        aria-pressed={tool === "box"}
        disabled={!enabled}
        onClick={(): void => onSelect("box")}
        title="Add a text box: drag on the page to place it"
        data-edit-tool="box"
      >
        <Plus size={16} aria-hidden />
        <span>Add box</span>
      </button>
      <button
        type="button"
        className={tool === "image" ? "edit-toolbar-btn edit-toolbar-btn-active" : "edit-toolbar-btn"}
        aria-pressed={tool === "image"}
        disabled={!enabled}
        onClick={(): void => onSelect("image")}
        title="Edit images: click an image to select, drag a rect to place a new one"
        data-edit-tool="image"
      >
        <Image size={16} aria-hidden />
        <span>Image</span>
      </button>
      <div className="edit-toolbar-divider" aria-hidden />
      <label className="edit-toolbar-font">
        <span className="edit-toolbar-font-label">Font</span>
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
      <div className="edit-toolbar-hint" data-edit-hint>
        {hint}
      </div>
    </div>
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
