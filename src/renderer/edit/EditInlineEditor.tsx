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
// DEF-140 — the editor is a FLOATING WINDOW: the toolbar row doubles
// as its drag handle (chrome only — a press on an actual control is
// left to that control), the window follows the cursor while dragging
// and is clamped within the viewport, and the blur-commit guard is
// untouched.
//
// The editor is a regular React component (not a class) — the
// outer overlay owns the open/closed state, the editor just renders
// when it's mounted.

import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent, PointerEvent as ReactPointerEvent, ReactElement } from "react";
import { Check, X } from "lucide-react";
import type { EditFont } from "../../shared/types";
import { clamp, type EditTextStyle } from "./model";

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

/** B5 — the CSS font-family that mirrors a PDF standard font so
 *  the live textarea preview reflects the chosen font immediately.
 *  The engine draws `Times` as Times-Roman and `Courier` as
 *  Courier (the PDF standard-14 families); the preview maps each to
 *  the nearest locally-installed font so picking Times/Courier in
 *  the Font select changes the on-screen glyphs right away. */
export function fontFamilyFor(font: EditFont): string {
  switch (font) {
    case "Times":
      return '"Times New Roman", Times, serif';
    case "Courier":
      return '"Courier New", Courier, monospace';
    case "Helvetica":
    default:
      return "Helvetica, Arial, sans-serif";
  }
}

export function EditInlineEditor(props: EditInlineEditorProps): ReactElement {
  const { rect, cssScale, initialText, initialStyle, mode, onCommit, onCancel } = props;
  const [text, setText] = useState<string>(initialText);
  const [style, setStyle] = useState<EditTextStyle>(initialStyle);
  const [background, setBackground] = useState<"white" | "none">(
    mode === "box" ? "white" : "none",
  );
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const editorRef = useRef<HTMLDivElement | null>(null);
  // DEF-110 — the toolbar's label spans and bar chrome are
  // non-focusable: mousedown on them moves focus to the body, so the
  // textarea's onBlur sees `relatedTarget === null` and wrongly
  // treated the bar press as an outside click, committing/cancelling
  // and unmounting the editor. This ref records pointer presses that
  // START inside the editor window so onTextareaBlur can tell a bar
  // press from a genuine outside click.
  const insidePressRef = useRef(false);

  // DEF-140 — the floating editor window is draggable so it stops
  // covering the text box / page content. The drag handle is the
  // toolbar header row: a press on its CHROME (label spans, gap,
  // padding — anything that isn't a control) records the pointer and
  // the editor's current viewport rect; a window pointermove then
  // repositions the window via a state offset applied on top of the
  // anchored left/top, and pointerup ends the drag. Drags that start
  // on a <select> / <input> / button belong to that control and never
  // start a move. The window is clamped within the viewport so it
  // can't be dragged off-screen. The existing blur guard and
  // click-to-edit / commit paths are untouched.
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{
    startClientX: number;
    startClientY: number;
    startOffsetX: number;
    startOffsetY: number;
    viewLeft: number;
    viewTop: number;
    width: number;
    height: number;
  } | null>(null);

  const onToolbarPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return; // left button only
    const target = e.target as Element | null;
    // A drag starting on a control belongs to that control (the
    // native select dropdown / number spinner / picker / button); it
    // must never initiate a window move.
    if (
      target !== null &&
      typeof target.closest === "function" &&
      target.closest("select, input, button, .edit-inline-toolbar-actions") !== null
    ) {
      return;
    }
    const el = editorRef.current;
    if (el === null) return;
    const rect = el.getBoundingClientRect();
    dragRef.current = {
      startClientX: e.clientX,
      startClientY: e.clientY,
      startOffsetX: dragOffset.x,
      startOffsetY: dragOffset.y,
      viewLeft: rect.left,
      viewTop: rect.top,
      width: rect.width,
      height: rect.height,
    };
    setDragging(true);
    // Prevent the browser's text-selection / native drag-ghost while
    // dragging the toolbar chrome (labels are non-focusable, so no
    // focus or click behaviour relies on the default action here).
    e.preventDefault();
  };

  // DEF-140 — while a drag is active the editor window follows the
  // cursor via window-level listeners (so it keeps moving even when
  // the pointer strays off the toolbar), and is clamped within the
  // viewport on every move.
  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent): void => {
      const d = dragRef.current;
      if (d === null) return;
      const propLeft = d.viewLeft + (e.clientX - d.startClientX);
      const propTop = d.viewTop + (e.clientY - d.startClientY);
      const maxLeft = Math.max(0, window.innerWidth - d.width);
      const maxTop = Math.max(0, window.innerHeight - d.height);
      const clampedLeft = clamp(propLeft, 0, maxLeft);
      const clampedTop = clamp(propTop, 0, maxTop);
      setDragOffset({
        x: d.startOffsetX + (clampedLeft - d.viewLeft),
        y: d.startOffsetY + (clampedTop - d.viewTop),
      });
    };
    const onUp = (): void => {
      dragRef.current = null;
      setDragging(false);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    // A cancelled pointer (OS gesture steal / window deactivation)
    // must also end the drag so the window never stays stuck in
    // "dragging" state waiting for a pointerup that won't come.
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [dragging]);

  // Focus on mount so the user can type immediately. The overlay's
  // pointerdown handler ignores clicks inside the editor surface, so
  // stealing focus is safe.
  //
  // DEF-105 (B6) — the focus is DEFERRED to the next animation frame.
  // The editor mounts synchronously DURING the opening gesture's
  // pointerdown dispatch (the window-capture listener flushes React
  // synchronously), and Chromium's mousedown focus-clearing fires
  // right after on the non-focusable page target. If the textarea is
  // focused at that instant, the browser blurs it (relatedTarget
  // null), onTextareaBlur commits/cancels, and the editor closes the
  // moment it opened — the B6 "click is inert" report: the editor
  // flashed open and auto-committed the original run text (the doc
  // went modified with a no-op edit). Waiting for the next frame
  // means the gesture (pointerdown/up/click + the browser's focus
  // fixup) has fully finished before the textarea takes focus, so
  // nothing blurs it. The typing latency is one frame (~16ms) —
  // imperceptible, and the same API every editor uses to avoid
  // mount-during-gesture focus races.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.setSelectionRange(0, text.length);
    });
    // Only on mount — `text` is captured at mount time, the user
    // can edit it freely. The rAF id is cleared on unmount so a
    // closed editor never steals focus back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => cancelAnimationFrame(frame);
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

  // B16 — inside-editor blur guard. The Font / Background selects
  // no longer call preventDefault on mousedown (that blocked the
  // native dropdown from opening — the B16 report). Without the
  // guard, clicking a select moves focus off the textarea, its
  // onBlur fires, and the editor commits/cancels before the user
  // has chosen anything. The guard checks where focus is going:
  // if it stays INSIDE the editor (a select / input / button),
  // the editor stays mounted — the focus-lock behaviour is now
  // enforced at the blur site, exactly where it is needed, instead
  // of suppressing the native control's mousedown. Blurring to
  // the page / outside still commits (or cancels for empty text).
  const onTextareaBlur = (e: React.FocusEvent<HTMLTextAreaElement>): void => {
    const related = e.relatedTarget as Element | null;
    if (
      related !== null &&
      typeof related.closest === "function" &&
      related.closest(".edit-inline-editor") !== null
    ) {
      return;
    }
    // DEF-110 — a pointer press that STARTED inside the editor (on a
    // non-focusable label, the toolbar bar, or the editor's own
    // padding) moved focus to the body: Chromium reports
    // `relatedTarget === null` although the press never left the
    // window. That is an inside click, not an outside click — keep
    // the editor mounted. The flag is cleared a tick after the press
    // so the NEXT (genuinely outside) press commits normally.
    if (insidePressRef.current) {
      return;
    }
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
      ref={editorRef}
      className={`edit-inline-editor${dragging ? " edit-inline-dragging" : ""}`}
      data-edit-editor={mode}
      style={{ left: leftCss + dragOffset.x, top: topCss + dragOffset.y, width: widthCss }}
      onPointerDown={(e): void => {
        e.stopPropagation();
        // DEF-110 — remember that this press started inside the
        // editor. onTextareaBlur uses the flag to keep the editor
        // mounted when a non-focusable label / bar press blurs the
        // textarea to the body (relatedTarget null). Cleared a tick
        // after the press so a later genuine outside click commits
        // normally.
        insidePressRef.current = true;
        window.setTimeout(() => {
          insidePressRef.current = false;
        }, 0);
      }}
    >
      <div
        className="edit-inline-toolbar"
        data-edit-drag-handle
        onPointerDown={onToolbarPointerDown}
      >
        <label className="edit-inline-field edit-inline-field-font">
          <span className="edit-inline-label">Font</span>
          <select
            value={style.font}
            // B16 — NO preventDefault on mousedown. The old Bug-9
            // focus guard blocked the native dropdown from opening
            // (the select never expanded). Focus-lock is now
            // enforced by the textarea's onBlur guard (see
            // onTextareaBlur): clicking the select moves focus but
            // the editor stays mounted because the new focus
            // target is inside the editor.
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
            // DEF-109 — NO preventDefault on mousedown. The old
            // Bug-9 focus guard on this number input suppressed the
            // native spinner/arrow auto-increment (and Chromium's
            // arrow-up on a focused number input), so the size
            // control was inert — only direct typing changed it.
            // The input is focusable and lives inside the editor, so
            // the textarea's onBlur guard keeps the editor mounted
            // when focus moves here.
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
            // Bug 9 — see comment on the font select above.
            onMouseDown={(e): void => e.preventDefault()}
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
              // B16 — NO preventDefault on mousedown (same fix as
              // the Font select: the old focus guard blocked the
              // native dropdown). The textarea's onBlur guard
              // keeps the editor mounted while focus is inside.
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
            // Bug 9 — keep focus on the textarea until the user
            // explicitly clicks Apply / Cancel. Without this guard
            // the textarea's `onBlur` would commit / cancel
            // before the click reaches the button.
            onMouseDown={(e): void => e.preventDefault()}
            onClick={onCancel}
            aria-label="Cancel edit"
            title="Cancel (Esc)"
          >
            <X size={13} aria-hidden />
          </button>
          <button
            type="button"
            className="edit-inline-btn edit-inline-btn-commit"
            // Bug 9 — same focus guard as the Cancel button.
            onMouseDown={(e): void => e.preventDefault()}
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
        onBlur={onTextareaBlur}
        style={{
          height: heightCss,
          color: colorToHex(style.color),
          fontSize: `${style.size * cssScale}px`,
          // B5 — the preview must reflect the chosen font live.
          // The previous style omitted fontFamily, so picking
          // Times/Courier in the Font select changed nothing on
          // screen until commit.
          fontFamily: fontFamilyFor(style.font),
        }}
        placeholder={mode === "edit" ? "Replace text..." : "Add text..."}
      />
    </div>
  );
}
