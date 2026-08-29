// Phase 10 — the Edit-mode inline editor.
//
// Opened by either the text-run click ("edit") or the text-box drag
// ("add"). The editor pre-fills the run's text (when editing) or
// starts empty (when adding a new box) and exposes font, size, and
// color pickers so the user can override the per-tab default.
//
// Commit: a Ctrl/Cmd+Enter or a click outside the editor fires
// `onCommit(text)`. Escape cancels. The text is trimmed before
// commit so a stray whitespace-only edit doesn't round-trip to the
// engine.
//
// The editor is a regular React component (not a class) — the
// outer overlay owns the open/closed state, the editor just renders
// when it's mounted.

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent, ReactElement } from "react";
import { Check, X } from "lucide-react";
import type { EditFont } from "../../shared/types";
import type { EditTextStyle } from "./model";

export interface EditInlineEditorProps {
  /** Anchor rect in page points (top-left origin). The editor
   *  renders as an absolutely positioned div whose top-left matches
   *  this point. The width/height define the editable area. */
  rect: { x: number; y: number; width: number; height: number };
  cssScale: number;
  /** Initial text. Pre-filled for text-run edits; empty for new
   *  text boxes. */
  initialText: string;
  /** Style applied to the committed op. The editor shows the
   *  current values and lets the user tweak them before commit. */
  initialStyle: EditTextStyle;
  /** "edit" hides the opacity / background controls (text-run
   *  replacements always overwrite); "box" shows a background-fill
   *  toggle so the user can decide whether the new text is
   *  readable over existing content. */
  mode: "edit" | "box";
  onCommit: (text: string, style: EditTextStyle, options: { background: "white" | "none" }) => void;
  onCancel: () => void;
}

const ALLOWED_FONTS: readonly EditFont[] = ["Helvetica", "Times", "Courier"];
const SIZE_MIN = 6;
const SIZE_MAX = 72;

/** Convert an `EditColor` to a `#rrggbb` string. Centralised so
 *  both the input + swatch use the same rounding. */
export function colorToHex(c: { r: number; g: number; b: number }): string {
  const r = Math.round(Math.min(1, Math.max(0, c.r)) * 255);
  const g = Math.round(Math.min(1, Math.max(0, c.g)) * 255);
  const b = Math.round(Math.min(1, Math.max(0, c.b)) * 255);
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

/** Convert a `#rrggbb` string back to an `EditColor`. Returns
 *  black on parse failure so the editor never lands in an
 *  invalid state. */
export function hexToColor(hex: string): { r: number; g: number; b: number } {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
    return { r: 0, g: 0, b: 0 };
  }
  return {
    r: parseInt(hex.slice(1, 3), 16) / 255,
    g: parseInt(hex.slice(3, 5), 16) / 255,
    b: parseInt(hex.slice(5, 7), 16) / 255,
  };
}

export function EditInlineEditor(props: EditInlineEditorProps): ReactElement {
  const { rect, cssScale, initialText, initialStyle, mode, onCommit, onCancel } = props;
  const [text, setText] = useState<string>(initialText);
  const [style, setStyle] = useState<EditTextStyle>(initialStyle);
  const [background, setBackground] = useState<"white" | "none">(
    mode === "box" ? "white" : "none",
  );
  const ref = useRef<HTMLTextAreaElement | null>(null);

  // Focus on mount so the user can type immediately. The overlay's
  // pointerdown handler ignores clicks inside the editor surface, so
  // stealing focus is safe.
  useEffect(() => {
    ref.current?.focus();
    ref.current?.setSelectionRange(0, text.length);
    // Only on mount — `text` is captured at mount time, the user
    // can edit it freely.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>): void => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      commit();
    }
  };

  const commit = (): void => {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      onCancel();
      return;
    }
    onCommit(trimmed, style, { background });
  };

  // The edit textarea is sized to the rect in CSS px. The font-size
  // is the user-picked size in pt, scaled. We honour the rect's
  // width so a long text box wraps within the user's intended area.
  const widthCss = Math.max(120, rect.width * cssScale);
  const heightCss = Math.max(80, rect.height * cssScale);
  const topCss = rect.y * cssScale;
  const leftCss = rect.x * cssScale;

  return (
    <div
      className="edit-inline-editor"
      data-edit-editor={mode}
      style={{ left: leftCss, top: topCss, width: widthCss }}
      onPointerDown={(e): void => e.stopPropagation()}
    >
      <div className="edit-inline-toolbar">
        <label className="edit-inline-field edit-inline-field-font">
          <span className="edit-inline-label">Font</span>
          <select
            value={style.font}
            onChange={(e: ChangeEvent<HTMLSelectElement>): void => {
              const next = e.target.value;
              if (ALLOWED_FONTS.includes(next as EditFont)) {
                setStyle({ ...style, font: next as EditFont });
              }
            }}
            aria-label="Font"
          >
            {ALLOWED_FONTS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="edit-inline-field edit-inline-field-size">
          <span className="edit-inline-label">Size</span>
          <input
            type="number"
            min={SIZE_MIN}
            max={SIZE_MAX}
            step={1}
            value={style.size}
            onChange={(e: ChangeEvent<HTMLInputElement>): void => {
              const n = Number.parseFloat(e.target.value);
              if (Number.isFinite(n)) {
                setStyle({ ...style, size: Math.min(SIZE_MAX, Math.max(SIZE_MIN, n)) });
              }
            }}
            aria-label="Font size (pt)"
          />
        </label>
        <label className="edit-inline-field edit-inline-field-color">
          <span className="edit-inline-label">Color</span>
          <input
            type="color"
            value={colorToHex(style.color)}
            onChange={(e: ChangeEvent<HTMLInputElement>): void => {
              setStyle({ ...style, color: hexToColor(e.target.value) });
            }}
            aria-label="Text color"
          />
        </label>
        {mode === "box" && (
          <label className="edit-inline-field edit-inline-field-bg">
            <span className="edit-inline-label">Background</span>
            <select
              value={background}
              onChange={(e: ChangeEvent<HTMLSelectElement>): void => {
                const v = e.target.value;
                if (v === "white" || v === "none") {
                  setBackground(v);
                }
              }}
              aria-label="Text box background"
            >
              <option value="white">White fill</option>
              <option value="none">Transparent</option>
            </select>
          </label>
        )}
        <div className="edit-inline-toolbar-actions">
          <button
            type="button"
            className="edit-inline-btn edit-inline-btn-cancel"
            onClick={onCancel}
            aria-label="Cancel edit"
            title="Cancel (Esc)"
          >
            <X size={13} aria-hidden />
          </button>
          <button
            type="button"
            className="edit-inline-btn edit-inline-btn-commit"
            onClick={commit}
            aria-label="Apply edit"
            title="Apply (Ctrl+Enter)"
          >
            <Check size={13} aria-hidden />
          </button>
        </div>
      </div>
      <textarea
        ref={ref}
        className="edit-inline-textarea"
        data-edit-textarea
        value={text}
        onChange={(e: ChangeEvent<HTMLTextAreaElement>): void => setText(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={(): void => {
          // Defer to next tick so a click on Cancel/Apply (which
          // unmounts the editor anyway) doesn't fire a duplicate
          // commit. The overlay's own pointerdown handler will see
          // the editor's mousedown via stopPropagation and won't
          // start a new drag.
          if (text.trim().length > 0) {
            commit();
          } else {
            onCancel();
          }
        }}
        style={{
          height: heightCss,
          color: colorToHex(style.color),
          fontSize: `${style.size * cssScale}px`,
        }}
        placeholder={mode === "edit" ? "Replace text..." : "Add text..."}
      />
    </div>
  );
}
