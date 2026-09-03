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
import type { ChangeEvent, KeyboardEvent, ReactElement } from "react";
import type { EditFont } from "../../shared/types";
import type { EditTextStyle } from "./model";
import { useDragWindow } from "../components/useDragWindow";

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
  /** Commit the editor. `offset` is the floating window's CURRENT
   *  drag offset (CSS px) at the moment of commit — read from
   *  `useDragWindow.getOffset()`, the SYNCHRONOUS ref mirror written
   *  inline in the pointermove handler, so a dragged toolbox commits
   *  the content at its MOVED position even if the React state
   *  round-trip that drives the live box-mirror preview hasn't
   *  settled (DEF-151: the affordance could say "Confirm move"
   *  while the commit read a stale zero offset — the ref read makes
   *  the commit timing-independent). `offset` is `{x:0,y:0}` when
   *  the window was never dragged. */
  onCommit: (
    text: string,
    style: EditTextStyle,
    options: { background: "white" | "none" },
    offset: { x: number; y: number },
  ) => void;
  onCancel: () => void;
  /** Delete the placed text box being edited. Present ONLY when the
   *  editor re-opened an already-COMMITTED box from the registry:
   *  the overlay passes it, and the Delete button renders only while
   *  this callback exists (fail loud — a Delete button with no
   *  action is a click that does nothing). Omitted for text-run
   *  edits and freshly-dragged (uncommitted) boxes — those sessions
   *  have nothing to delete. The overlay closes the editor and
   *  routes the delete through engine.deleteTextBox. */
  onDelete?: () => void;
  /** DEF-149(b) / DEF-150 — fired whenever the floating window's
   *  drag offset changes (CSS px). The overlay (which owns the
   *  commit) uses it so a dragged toolbox commits the CONTENT at
   *  its moved position instead of the original anchor rect
   *  (AGENTS.md guardrail #4). */
  onDragOffsetChange?: (offset: { x: number; y: number }) => void;
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
  const { rect, cssScale, initialText, initialStyle, mode, onCommit, onCancel, onDelete, onDragOffsetChange } = props;
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
  //
  // The mechanics live in the shared `useDragWindow` hook (DEF-140
  // generalized to every floating window — DEF-147); this component
  // just names which elements are the window and the handle.
  const drag = useDragWindow({
    controlsSelector: "select, input, button, .edit-inline-toolbar-actions",
  });

  // DEF-149(b) / DEF-150 — report the window's drag offset up to the
  // overlay as it changes. The overlay adds `offset / cssScale` to the
  // anchor rect at commit time, so a dragged toolbox commits the
  // content at its NEW position (guardrail #4 — the window and its
  // committed content move as one).
  useEffect(() => {
    if (onDragOffsetChange === undefined) return;
    onDragOffsetChange(drag.offset);
  }, [drag.offset, onDragOffsetChange]);

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
    // DEF-151 — read the window's CURRENT drag offset from the
    // SYNCHRONOUS ref (`drag.getOffset()`), NEVER the `drag.offset`
    // state (a React render value that can lag one cycle behind the
    // click — the packaged-app race where a moved toolbox still
    // committed dx=0). The ref is written inline in the pointermove
    // handler, so this read is timing-independent: a Confirm click
    // that lands before the last move's re-render still commits at
    // the MOVED position. `drag.offset` state remains ONLY for the
    // mid-drag visual affordance (window position, "Confirm move"
    // label) — it never feeds a commit.
    onCommit(trimmed, style, { background }, drag.getOffset());
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
      ref={(el): void => {
        editorRef.current = el;
        drag.windowRef(el);
      }}
      className={`edit-inline-editor${drag.dragging ? " edit-inline-dragging" : ""}`}
      data-edit-editor={mode}
      style={{ left: leftCss + drag.offset.x, top: topCss + drag.offset.y, width: widthCss }}
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
        {...drag.handleProps}
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
            className="toolbox-action-btn toolbox-action-btn--cancel edit-inline-btn edit-inline-btn-cancel"
            // Bug 9 — keep focus on the textarea until the user
            // explicitly clicks a bar button. Without this guard
            // the textarea's `onBlur` would commit / cancel
            // before the click reaches the button.
            onMouseDown={(e): void => e.preventDefault()}
            onClick={onCancel}
            aria-label="Cancel edit"
            title="Cancel (Esc)"
          >
            Cancel
          </button>
          {onDelete !== undefined && (
            <button
              type="button"
              className="toolbox-action-btn toolbox-action-btn--delete edit-inline-btn edit-inline-btn-delete"
              // Bug 9 — same focus guard as the other bar buttons.
              onMouseDown={(e): void => e.preventDefault()}
              onClick={onDelete}
              aria-label="Delete text box"
              title="Delete text box"
              data-edit-action="delete"
            >
              Delete
            </button>
          )}
          <button
            type="button"
            className="toolbox-action-btn toolbox-action-btn--confirm edit-inline-btn edit-inline-btn-commit"
            // Bug 9 — same focus guard as the Cancel button.
            onMouseDown={(e): void => e.preventDefault()}
            onClick={commit}
            // DEF-150(b) — after the floating editor window has been
            // dragged, the Apply control becomes a visible "Confirm"
            // affordance: it commits the content at the MOVED rect
            // (the same commit call — the rect shift happens in the
            // overlay through `onDragOffsetChange`). `data-edit-confirm`
            // doubles as the stable selector for e2e.
            data-edit-confirm={drag.offset.x !== 0 || drag.offset.y !== 0 ? "true" : "false"}
            aria-label={drag.offset.x !== 0 || drag.offset.y !== 0 ? "Confirm move" : "Apply edit"}
            title={
              drag.offset.x !== 0 || drag.offset.y !== 0
                ? "Confirm the moved position (Ctrl+Enter)"
                : "Apply (Ctrl+Enter)"
            }
          >
            {drag.offset.x !== 0 || drag.offset.y !== 0 ? "Confirm" : "Apply"}
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
