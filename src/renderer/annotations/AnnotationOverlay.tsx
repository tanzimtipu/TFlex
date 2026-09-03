// Per-page annotation layer: renders committed annotations and hosts the
// pointer interactions that create new ones.
//
// The overlay is a child of the page wrapper (.pdf-page), sized exactly to
// the page. All committed geometry lives in PAGE POINTS (top-left origin,
// scale 1). Vector annotations render into a full-page <svg> whose viewBox
// is the page in points and whose CSS size is the scaled page, so zooming
// re-scales every vector annotation automatically via the pdf.js-driven
// wrapper size. Text boxes and note icons are absolutely-positioned divs
// whose offsets are computed with the current cssScale.
//
// Interaction model (one active tool at a time, from the toolbar):
//   highlight/underline/strikeout  drag over text -> quads from text items
//   ink                            drag -> freehand path
//   rect/ellipse/arrow             drag from-to
//   textbox                        click -> inline editor, commit on blur
//   note                           click -> note editor popover
// With the "select" tool the layer is pointer-transparent, so text
// selection and links behave exactly as before.

import { GripVertical, MessageSquare, X } from "lucide-react";
import { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  ReactElement,
  ReactNode,
} from "react";
import { useDragWindow } from "../components/useDragWindow";
import {
  ContentActionBar,
  ContentGrip,
  MoveHint,
  useSelectableDrag,
} from "../components/selectableContent";
import { rectsClose, rectShiftedByCssOffset, type ImageResizeHandle } from "../edit/geometry";
import {
  annotationBounds,
  arrowHead,
  calloutBoxFor,
  calloutEntryPoint,
  clientToPagePoint,
  dragMeetsMinimum,
  inkPathD,
  moveAnnotation,
  normalizeDragRect,
  overlayRectToCss,
  resizeAnnotation,
  sameAnnotationGeometry,
  textItemQuads,
  textUnderQuads,
  type TextItemGeom,
} from "./geometry";

// Re-export TextItemGeom so PageView can build it from pdf.js TextContent
// without having to know the geometry module's surface.
export type { TextItemGeom };
import {
  ANNOTATION_COLORS,
  ANNOTATION_COLOR_HEX,
  annotationColorToCss,
  type Annotation,
  type AnnotationColorValue,
  type AnnotationPatch,
  type AnnotationToolState,
  type PagePoint,
  type PageRect,
} from "./model";

// ---------------------------------------------------------------------------
// Constants

const TEXTBOX_FONT_PT = 12;
const TEXTBOX_LINE_HEIGHT = 1.35;
const TEXTBOX_PAD_PT = 5;
const TEXTBOX_MIN_WIDTH_PT = 90;
const TEXTBOX_MAX_WIDTH_PT = 320;
const NOTE_ICON_PT = 16;
const ARROW_HEAD_PT = 9;
const MIN_INK_POINTS = 2;
const INK_SAMPLE_PT = 0.75;

export interface AnnotationOverlayProps {
  page: number;
  widthPt: number;
  heightPt: number;
  cssScale: number;
  annotations: Annotation[];
  tool: AnnotationToolState;
  flashId: string | null;
  /** Snapshot of the page's text-item geometry (page points). Provided by
   *  PageView, which owns the pdf.js text layer. */
  getTextItems: () => TextItemGeom[];
  onCreate: (annotation: Annotation) => void;
  /** Called after a one-shot tool (textbox, note) commits so the host can
   *  return to the select tool. */
  onFinishedOneShot?: () => void;
  /** DEF-096 — edit / delete a COMMITTED annotation from the page.
   *  Clicking a committed sticky-note icon opens the note editor
   *  pre-filled with the note's existing text; Confirm routes here
   *  (same `AnnotationPatch` shape the AnnotationsPanel uses),
   *  Delete routes to `onDeleteAnnotation`. This is the actual
   *  click behavior the "note icon not clickable" report asked
   *  for — a click that only registered pointer-events but had no
   *  handler was a silent no-op. */
  onEditAnnotation?: (id: string, patch: AnnotationPatch) => void;
  onDeleteAnnotation?: (id: string) => void;
}

interface DragState {
  from: PagePoint;
  to: PagePoint;
}

interface EditorState {
  at: PagePoint;
  text: string;
}

function newId(): string {
  return crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

function hexWithAlpha(hex: string, alpha: number): string {
  const a = Math.round(Math.min(Math.max(alpha, 0), 1) * 255);
  return `${hex}${a.toString(16).padStart(2, "0")}`;
}

/** Size a text box around its content. Width tracks the longest line;
 *  height tracks the line count. */
export function textBoxRectFor(
  at: PagePoint,
  text: string,
  pageWidthPt: number,
): PageRect {
  const lines = text.split("\n");
  const longest = lines.reduce((m, l) => Math.max(m, l.length), 0);
  const width = Math.min(
    Math.max(longest * TEXTBOX_FONT_PT * 0.52 + TEXTBOX_PAD_PT * 2, TEXTBOX_MIN_WIDTH_PT),
    TEXTBOX_MAX_WIDTH_PT,
    Math.max(pageWidthPt - at.x - 6, TEXTBOX_MIN_WIDTH_PT),
  );
  const height =
    Math.max(lines.length, 1) * TEXTBOX_FONT_PT * TEXTBOX_LINE_HEIGHT +
    TEXTBOX_PAD_PT * 2;
  return { x: at.x, y: at.y, width, height };
}

export function AnnotationOverlay(props: AnnotationOverlayProps): ReactElement {
  const {
    page,
    widthPt,
    heightPt,
    cssScale,
    annotations,
    tool,
    flashId,
    getTextItems,
    onCreate,
    onFinishedOneShot,
    onEditAnnotation,
    onDeleteAnnotation,
  } = props;

  const rootRef = useRef<HTMLDivElement | null>(null);
  // In-progress interaction state. `drag` covers markup and shape tools;
  // `ink` collects freehand points; `textItemsSnap` caches the text layer
  // geometry for the duration of a markup drag.
  const [drag, setDrag] = useState<DragState | null>(null);
  const [ink, setInk] = useState<PagePoint[] | null>(null);
  const [textboxEditor, setTextboxEditor] = useState<EditorState | null>(null);
  const [noteEditor, setNoteEditor] = useState<EditorState | null>(null);
  /** Phase 12 — callout creation in progress. `box` is the
   *  text-box rect; `at` is the anchor (the arrowhead target).
   *  Drives the inline editor + live preview while the user types. */
  const [calloutEditor, setCalloutEditor] = useState<
    { box: PageRect; at: PagePoint; text: string } | null
  >(null);
  /** DEF-096 — editing a COMMITTED note in place. Clicking the
   *  note's icon opens the same NoteEditor popover pre-filled with
   *  the note's existing text; Confirm applies the text via
   *  `onEditAnnotation`, Delete removes the note, Cancel closes
   *  without changes. Null when no committed note is being edited. */
  const [editingNote, setEditingNote] = useState<{
    id: string;
    text: string;
  } | null>(null);
  // ---- DEF-153 / DEF-154: unified selectable-movable content --------
  // Committed annotations (shapes, ink, arrow, textbox, callout,
  // note) are SELECTABLE + MOVABLE from the page, exactly like the
  // add-box: hover -> grab cursor; single click -> select + movable
  // (Confirm / Edit / Delete bar + resize handles); double click ->
  // the full edit toolbox; while selected a cursor-attached
  // "Double click to edit" hint. The move/resize is renderer-local
  // during the drag (`annDraft`), and the ENGINE is only touched on
  // Confirm: delete + re-create with the same id and the moved
  // geometry (the shared IPC contract has no annotation move op).
  const [selectedAnnId, setSelectedAnnId] = useState<string | null>(null);
  /** Draft override while dragging or pending — `ann` may be absent
   *  from the `annotations` list (mid delete-then-recreate echo), so
   *  the render merges it back in. */
  const [annDraft, setAnnDraft] = useState<{ id: string; ann: Annotation } | null>(null);
  /** A move/resize that happened on the page but was NOT confirmed
   *  yet. The bar's Confirm commits it (delete + re-create); clicking
   *  elsewhere / cancelling an open editor reverts it (the draft
   *  clears and the annotation returns to the engine's position). */
  const [annPending, setAnnPending] = useState<{
    id: string;
    oldAnn: Annotation;
    nextAnn: Annotation;
  } | null>(null);
  /** The edit toolbox for a COMMITTED textbox/callout (opened by
   *  double-click or the bar's Edit). Uses the shared editor chrome
   *  and commits text via onEditAnnotation, geometry (a toolbox
   *  drag) via delete + re-create. */
  const [editTarget, setEditTarget] = useState<{
    id: string;
    kind: "textbox" | "callout";
    rect: PageRect;
    text: string;
  } | null>(null);
  /** The color edit toolbox for committed shapes / ink / arrow
   *  (opened by double-click or the bar's Edit — the "existing
   *  floating editor" for kinds that have no text). */
  const [colorEditId, setColorEditId] = useState<string | null>(null);
  /** Shared move/resize gesture tracker (identical drag math to the
   *  add-box overlay). */
  const selDrag = useSelectableDrag();
  /** Cursor-attached "Double click to edit" hint position (client
   *  px). Null while no hint should be visible. */
  const [hintPos, setHintPos] = useState<{ x: number; y: number } | null>(null);
  /** True when the last pointerup on a committed surface was a REAL
   *  drag — suppresses the follow-up click from re-opening an editor
   *  / re-selecting. Reset by the next surface pointerdown. */
  const movedRef = useRef(false);
  const textItemsSnapRef = useRef<TextItemGeom[]>([]);
  // Markup drags keep their quads in a ref during pointermove (cheap) and
  // only push to state once per frame; for simplicity we compute quads in
  // render from `drag` (the drag rect changes at pointermove frequency,
  // which is already React-throttled by the event loop).
  const toolKind = tool.tool;

  // Cancel any in-progress interaction when the tool changes or the page
  // re-renders at a new scale mid-drag (zoom during a drag abandons it).
  useEffect(() => {
    setDrag(null);
    setInk(null);
    setTextboxEditor(null);
    setNoteEditor(null);
    setCalloutEditor(null);
    setEditingNote(null);
    setEditTarget(null);
    setColorEditId(null);
    setSelectedAnnId(null);
    setAnnDraft(null);
    setAnnPending(null);
    setHintPos(null);
    selDrag.endDrag();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toolKind, cssScale]);

  // ---- unified selection derived state (DEF-153/154) ----

  const effectiveAnnotations = useMemo((): Annotation[] => {
    if (annDraft === null) return annotations;
    const list = annotations.map((a) => (annDraft.id === a.id ? annDraft.ann : a));
    if (!list.some((a) => a.id === annDraft.id)) list.push(annDraft.ann);
    return list;
  }, [annotations, annDraft]);

  // When the engine's recreate-echo carries the moved annotation back
  // (same id + same geometry), the local draft is redundant — drop it
  // so the engine list becomes the single source of truth again.
  useEffect(() => {
    if (annDraft === null) return;
    const echoed = annotations.find((a) => a.id === annDraft.id);
    if (echoed !== undefined && sameAnnotationGeometry(echoed, annDraft.ann)) {
      setAnnDraft(null);
    }
  }, [annotations, annDraft]);

  const selectedAnn =
    selectedAnnId === null
      ? null
      : (effectiveAnnotations.find((a) => a.id === selectedAnnId) ?? null);

  const anyEditorOpen =
    textboxEditor !== null ||
    noteEditor !== null ||
    calloutEditor !== null ||
    editingNote !== null ||
    editTarget !== null ||
    colorEditId !== null;

  /** Revert a pending (unconfirmed) move/resize. The annotation was
   *  never sent to the engine, so clearing the draft returns it to
   *  the engine's position. `id` narrows the revert to one item. */
  const revertPendingAnn = useCallback(
    (id?: string): void => {
      if (annPending === null) return;
      if (id !== undefined && annPending.id !== id) return;
      setAnnDraft(null);
      setAnnPending(null);
      setHintPos(null);
    },
    [annPending],
  );

  /** Confirm a pending move/resize: delete the ORIGINAL annotation
   *  and re-create it with the moved geometry (same id, same
   *  createdAt — the shared contract's only annotation-move path). */
  const confirmPendingAnn = useCallback((): void => {
    if (annPending === null) return;
    const { oldAnn, nextAnn } = annPending;
    onDeleteAnnotation?.(oldAnn.id);
    onCreate({ ...nextAnn });
    setAnnDraft(null);
    setAnnPending(null);
    setSelectedAnnId(null);
    setHintPos(null);
  }, [annPending, onDeleteAnnotation, onCreate]);

  const pagePoint = (e: React.PointerEvent): PagePoint => {
    const root = rootRef.current;
    if (root === null) return { x: 0, y: 0 };
    const rect = root.getBoundingClientRect();
    return clientToPagePoint(e.clientX, e.clientY, rect, cssScale);
  };

  /** Open the full edit toolbox for a committed annotation. textbox /
   *  callout reopen the shared text editor pre-filled; note reopens
   *  the note editor; shapes / ink / arrow open the color editor (the
   *  only properties an annotation owns beyond geometry). */
  const openEditorFor = useCallback(
    (ann: Annotation): void => {
      setSelectedAnnId(ann.id);
      if (ann.kind === "textbox" || ann.kind === "callout") {
        const rect =
          ann.rect ??
          (ann as unknown as { rects?: { x: number; y: number; width: number; height: number }[] })
            .rects?.[0];
        if (rect === undefined) return;
        setEditTarget({ id: ann.id, kind: ann.kind, rect: { ...rect }, text: ann.text });
        return;
      }
      if (ann.kind === "note") {
        setEditingNote({ id: ann.id, text: ann.text });
        return;
      }
      // shapes / ink / arrow — the color edit toolbox.
      setColorEditId(ann.id);
    },
    [],
  );

  /** Start a move (or corner-handle resize) drag on a committed
   *  annotation from its page surface. Stops propagation so the
   *  layer's create-drag can't also start. */
  const beginAnnSurfaceDrag = useCallback(
    (e: React.PointerEvent, ann: Annotation, handle?: ImageResizeHandle): void => {
      if (e.button !== 0) return;
      e.stopPropagation();
      setSelectedAnnId(ann.id);
      setColorEditId(null);
      movedRef.current = false;
      const bounds = annotationBounds(effectiveAnnotations.find((a) => a.id === ann.id) ?? ann);
      selDrag.beginDrag({
        id: ann.id,
        kind: handle !== undefined ? "resize" : "move",
        handle,
        originClient: { x: e.clientX, y: e.clientY },
        startRect: { ...bounds },
        pageWidthPt: widthPt,
        pageHeightPt: heightPt,
      });
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    },
    [effectiveAnnotations, selDrag, widthPt],
  );

  /** Single click on a committed surface: select it and make it
   *  movable (the bar + handles render). NOT the toolbox — that is
   *  the double-click's job (DEF-153). A post-drag click (the
   *  browser fires `click` after a pointerup that moved) is ignored
   *  via `movedRef`. The NOTE keeps its accepted single-click
   *  behavior (DEF-096): a click on the icon opens its editor. */
  const onAnnClickSurface = useCallback(
    (e: React.MouseEvent, ann: Annotation): void => {
      e.stopPropagation();
      if (movedRef.current) {
        movedRef.current = false;
        return;
      }
      // A bare click with no drag: drop any stale gesture state.
      selDrag.endDrag();
      setSelectedAnnId(ann.id);
      setColorEditId(null);
      if (ann.kind === "note") {
        openEditorFor(ann);
      }
    },
    [openEditorFor, selDrag],
  );

  /** Double click on a committed surface opens the full edit toolbox. */
  const onAnnDoubleClickSurface = useCallback(
    (e: React.MouseEvent, ann: Annotation): void => {
      e.stopPropagation();
      movedRef.current = false;
      openEditorFor(ann);
    },
    [openEditorFor],
  );

  /** Commit the committed textbox/callout edit toolbox. Text-only
   *  changes route through the AnnotationPatch path; a toolbox drag
   *  (or a pending page move) routes through delete+re-create with
   *  the moved geometry (guardrail #4 — content moves with the
   *  toolbox, no duplicate bake). */
  const commitEditTarget = useCallback(
    (offset: { x: number; y: number }): void => {
      const t = editTarget;
      if (t === null) return;
      const engineAnn = annotations.find((a) => a.id === t.id);
      const draftAnn = annDraft?.id === t.id ? annDraft.ann : null;
      const base = draftAnn ?? engineAnn;
      setEditTarget(null);
      if (base === undefined) return;
      // The edit toolbox only opens for committed textbox / callout
      // annotations; narrow so the spread below stays type-safe.
      if (base.kind !== "textbox" && base.kind !== "callout") {
        setAnnDraft(null);
        setAnnPending(null);
        setSelectedAnnId(null);
        return;
      }
      const trimmed = t.text.trim();
      if (trimmed.length === 0) return;
      const baseRect = base.rect;
      if (engineAnn === undefined) {
        setAnnDraft(null);
        setAnnPending(null);
        setSelectedAnnId(null);
        return;
      }
      const engineRect =
        engineAnn.kind === "textbox" || engineAnn.kind === "callout" ? engineAnn.rect : undefined;
      if (engineRect === undefined) {
        setAnnDraft(null);
        setAnnPending(null);
        setSelectedAnnId(null);
        return;
      }
      const committedRect = rectShiftedByCssOffset(baseRect, offset, cssScale);
      const moved = !rectsClose(committedRect, engineRect, 1);
      if (moved) {
        onDeleteAnnotation?.(t.id);
        onCreate({ ...base, rect: committedRect, text: trimmed });
      } else if (trimmed !== base.text) {
        onEditAnnotation?.(t.id, { text: trimmed });
      }
      setAnnDraft(null);
      setAnnPending(null);
      setSelectedAnnId(null);
      setHintPos(null);
    },
    [editTarget, annotations, annDraft, cssScale, onDeleteAnnotation, onCreate, onEditAnnotation],
  );

  /** Apply a color to a committed shape / ink / arrow through the
   *  AnnotationPatch path. */
  const applyAnnColor = useCallback(
    (id: string, color: AnnotationColorValue): void => {
      onEditAnnotation?.(id, { color });
      setColorEditId(null);
      setSelectedAnnId(null);
    },
    [onEditAnnotation],
  );

  const isMarkupTool =
    toolKind === "highlight" || toolKind === "underline" || toolKind === "strikeout";
  const isShapeTool =
    toolKind === "rect" || toolKind === "ellipse" || toolKind === "arrow";
  const isDragTool = isMarkupTool || isShapeTool;

  // B2 / DEF-087-088-090 followup — bail out of pointerdown
  // when the target is inside any UI control (action bar, button,
  // editor wrapper, textarea, etc.). Calling `e.preventDefault()`
  // on a pointerdown that targets a button suppresses the
  // subsequent `click` event on that button (Pointer Events spec),
  // which is what made the textbox/callout Confirm / Cancel /
  // Delete buttons unresponsive. The old code only checked
  // `.ann-editor` (the textarea); the action bar sits outside the
  // textarea so clicks on the buttons fell through to the layer's
  // handler, which then called preventDefault and prevented the
  // click from firing. The fix walks the target's ancestor chain
  // for every interactive surface — same pattern SignaturesOverlay
  // and StampOverlay already use — and lets those events flow
  // through unchanged. Tool disarm still belongs on the bubble
  // phase `click` event (AGENTS.md cross-bubbling rule), never on
  // pointerdown capture.
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    const target = e.target as Element | null;
    if (target !== null && typeof target.closest === "function") {
      // DEF-096 — `.ann-note` is in the bail-out list: clicking a
      // COMMITTED note icon must not fall through to the page-canvas
      // pointerdown branches (which would open a blank CREATE editor
      // on top of the existing note). The icon's own onClick opens
      // the EDIT editor instead.
      // DEF-154 — committed shapes / ink / arrow / textbox / callout
      // surfaces and the selection chrome (action bar, resize
      // handles, selection ring, hint) are likewise interactive: a
      // press on them selects / drags the content, it never starts a
      // create-drag on the page behind it.
      const interactive = target.closest(
        ".ann-editor, .ann-textbox-actions, .ann-textbox-wrap, .ann-note-editor, .ann-note, .ann-shape, .ann-ink-hit, .ann-arrow-hit, .ann-arrow-head-hit, .ann-textbox, .ann-callout, .content-action-bar, .content-resize-handle, .content-selection-bounds, .content-move-hint, .color-palette, button, input, textarea, select, [role='button'], [role='menuitem'], [role='tab'], [contenteditable='true']",
      );
      if (interactive !== null) {
        // The click is on a UI control / committed surface — let the
        // original handler run. Do NOT preventDefault, do NOT
        // consume the event.
        return;
      }
    }
    const pt = pagePoint(e);
    if (pt.x < 0 || pt.y < 0 || pt.x > widthPt || pt.y > heightPt) return;
    // A press on the empty page (creation branch) reverts any
    // unconfirmed move: the annotation was only ever moved locally,
    // so it returns to the engine's position.
    if (annPending !== null) {
      revertPendingAnn();
      setSelectedAnnId(null);
      setHintPos(null);
    }
    if (isDragTool) {
      if (isMarkupTool) {
        textItemsSnapRef.current = getTextItems();
      }
      setDrag({ from: pt, to: pt });
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
    } else if (toolKind === "ink") {
      setInk([pt]);
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
    } else if (toolKind === "textbox") {
      setTextboxEditor({ at: pt, text: "" });
      e.preventDefault();
    } else if (toolKind === "note") {
      setNoteEditor({ at: pt, text: "" });
      e.preventDefault();
    } else if (toolKind === "callout") {
      // Callout creation is a drag from the anchor (where the callout
      // POINTS AT) to the text-box position. pointerdown captures the
      // anchor; pointerup commits the box and opens the inline editor.
      setDrag({ from: pt, to: pt });
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
    } else if (toolKind === "select" && (selectedAnnId !== null || annPending !== null)) {
      // DESELECT / revert on a blank-page press: the click reached
      // the layer background (not a committed surface / bar), so any
      // unconfirmed move is reverted and the selection clears. The
      // textLayer underneath still gets the click (no preventDefault),
      // so text selection keeps working.
      revertPendingAnn();
      setSelectedAnnId(null);
      setColorEditId(null);
      setHintPos(null);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    // DEF-154 — an in-flight move/resize of a committed annotation
    // (the drag started on the annotation's own surface) drives the
    // local draft override. The engine is untouched until Confirm.
    if (selDrag.drag !== null) {
      const drag = selDrag.drag;
      const orig = annotations.find((a) => a.id === drag.id);
      if (orig !== undefined) {
        if (drag.kind === "resize") {
          const r = selDrag.rectFor(e.clientX, e.clientY, cssScale);
          if (r !== null) {
            setAnnDraft({ id: orig.id, ann: resizeAnnotation(orig, r, widthPt, heightPt) });
          }
        } else {
          const delta = selDrag.deltaFor(e.clientX, e.clientY, cssScale);
          if (delta !== null) {
            setAnnDraft({ id: orig.id, ann: moveAnnotation(orig, delta.x, delta.y) });
          }
        }
      }
      setHintPos({ x: e.clientX, y: e.clientY });
      return;
    }
    const pt = pagePoint(e);
    // While content is selected/movable, the cursor-attached
    // "Double click to edit" hint follows the pointer (DEF-153).
    if (selectedAnnId !== null && !anyEditorOpen) {
      setHintPos({ x: e.clientX, y: e.clientY });
    }
    if (drag !== null) {
      setDrag({ from: drag.from, to: pt });
    } else if (ink !== null) {
      const last = ink[ink.length - 1];
      if (Math.hypot(pt.x - last.x, pt.y - last.y) >= INK_SAMPLE_PT) {
        setInk([...ink, pt]);
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>): void => {
    // DEF-154 — end a committed-annotation move/resize drag. A real
    // movement parks a PENDING move (the bar's Confirm commits it);
    // a click (no movement) just keeps the selection so the
    // follow-up click / double-click decides what opens.
    if (selDrag.drag !== null) {
      const drag = selDrag.drag;
      const orig = annotations.find((a) => a.id === drag.id);
      const delta = selDrag.deltaFor(e.clientX, e.clientY, cssScale);
      const newRect = selDrag.rectFor(e.clientX, e.clientY, cssScale);
      selDrag.endDrag();
      (e.target as Element).releasePointerCapture?.(e.pointerId);
      if (orig === undefined || delta === null) return;
      const moved =
        drag.kind === "move"
          ? Math.abs(delta.x) > 0.75 || Math.abs(delta.y) > 0.75
          : newRect !== null && !rectsClose(newRect, drag.startRect, 2);
      if (!moved) {
        // A click — the follow-up `click` event opens / reselects.
        movedRef.current = false;
        return;
      }
      movedRef.current = true;
      const next =
        drag.kind === "resize"
          ? newRect !== null
            ? resizeAnnotation(orig, newRect, widthPt, heightPt)
            : orig
          : moveAnnotation(orig, delta.x, delta.y);
      setAnnDraft({ id: orig.id, ann: next });
      setAnnPending({ id: orig.id, oldAnn: orig, nextAnn: next });
      setHintPos({ x: e.clientX, y: e.clientY });
      return;
    }
    if (drag !== null) {
      const { from } = drag;
      const to = pagePoint(e);
      setDrag(null);
      if (!dragMeetsMinimum(from, to)) return;
      const color = tool.color;
      if (isMarkupTool) {
        const items = textItemsSnapRef.current;
        const quads = textItemQuads(items, from, to);
        if (quads.length === 0) return;
        onCreate({
          id: newId(),
          kind: toolKind as "highlight" | "underline" | "strikeout",
          page,
          color,
          createdAt: nowIso(),
          rects: quads,
          text: textUnderQuads(items, quads),
        });
      } else if (toolKind === "arrow") {
        onCreate({
          id: newId(),
          kind: "arrow",
          page,
          color,
          createdAt: nowIso(),
          from,
          to,
        });
      } else if (toolKind === "rect" || toolKind === "ellipse") {
        onCreate({
          id: newId(),
          kind: toolKind,
          page,
          color,
          createdAt: nowIso(),
          rect: normalizeDragRect(from, to),
        });
      } else if (toolKind === "callout") {
        // Callout creation: drag from the anchor (the point the
        // callout points at) to the text-box position. The RELEASE
        // point becomes the box's top-left (the box is sized to the
        // default text-box geometry), so the anchor stays OUTSIDE
        // the box and the leader line is a visible non-zero shaft.
        // DEF-157 — the previous code placed the box at the drag-rect
        // corner, which equals the anchor for the natural down-right
        // drag; calloutEntryPoint then returned the anchor itself and
        // the arrow collapsed to a point. The box-at-release-point
        // geometry fixes the LIVE callout and, because `rect`+`at`
        // round-trip unchanged, the reloaded callout identically.
        const box = calloutBoxFor(
          to,
          TEXTBOX_MIN_WIDTH_PT,
          TEXTBOX_LINE_HEIGHT * TEXTBOX_FONT_PT + TEXTBOX_PAD_PT * 2,
          widthPt,
          heightPt,
        );
        setCalloutEditor({ box, at: from, text: "" });
        return;
      }
    } else if (ink !== null) {
      const points = ink;
      setInk(null);
      if (points.length >= MIN_INK_POINTS) {
        onCreate({
          id: newId(),
          kind: "ink",
          page,
          color: tool.color,
          createdAt: nowIso(),
          points,
          width: tool.penWidth,
        });
      }
    }
  };

  // ---- editors -------------------------------------------------------------

  // DEF-092 — the textbox editor's "Confirm" handler must clear
  // pending state AND unmount the editor. The unconditional
  // `setTextboxEditor(null)` at the top of the function takes care
  // of both: clearing the local state and (because the editor is
  // only rendered behind `textboxEditor !== null`) unmounting the
  // floating bar. The function is also defensive against double
  // invocations (e.g. a synthetic click racing a Ctrl+Enter
  // keydown) — once the state is null, the early `return` is a
  // no-op.
  const commitTextbox = (): void => {
    if (textboxEditor === null) return;
    const text = textboxEditor.text.trim();
    const at = textboxEditor.at;
    // Drop the editor first so the floating bar unmounts before any
    // further state work (tool switch via `onFinishedOneShot`,
    // engine op via `onCreate`). The conditional `{textboxEditor !==
    // null && <TextBoxEditor />}` evaluates false on the next
    // render and React removes the action bar from the DOM. If the
    // engine op fails or `onFinishedOneShot` is undefined the
    // unmount still happens — only the annotation persistence and
    // tool reset are skipped.
    setTextboxEditor(null);
    if (text.length === 0) {
      onFinishedOneShot?.();
      return;
    }
    onCreate({
      id: newId(),
      kind: "textbox",
      page,
      color: tool.color,
      createdAt: nowIso(),
      rect: textBoxRectFor(at, text, widthPt),
      text,
    });
    onFinishedOneShot?.();
  };

  const commitNote = (): void => {
    if (noteEditor === null) return;
    const at = noteEditor.at;
    const text = noteEditor.text.trim();
    setNoteEditor(null);
    // Empty notes are never useful — bail before sending the engine a
    // no-op (and before calling onFinishedOneShot) so the tool deactivates
    // regardless. Mirrors commitTextbox's empty-text guard.
    if (text.length === 0) {
      onFinishedOneShot?.();
      return;
    }
    onCreate({
      id: newId(),
      kind: "note",
      page,
      color: tool.color,
      createdAt: nowIso(),
      at,
      text,
    });
    onFinishedOneShot?.();
  };

  /** Phase 12 — commit the in-progress callout. The text-box rect is
   *  fixed at drag-release time; the user typed into the inline editor
   *  while the box was open. Empty-text callouts bail out like the
   *  textbox/note flows so a stray drag doesn't litter the doc with
   *  empty boxes. */
  const commitCallout = (): void => {
    if (calloutEditor === null) return;
    const text = calloutEditor.text.trim();
    const box = calloutEditor.box;
    const at = calloutEditor.at;
    setCalloutEditor(null);
    if (text.length === 0) {
      onFinishedOneShot?.();
      return;
    }
    onCreate({
      id: newId(),
      kind: "callout",
      page,
      color: tool.color,
      createdAt: nowIso(),
      rect: { ...box },
      at: { ...at },
      text,
    });
    onFinishedOneShot?.();
  };

  const interactive =
    toolKind !== "select" ||
    textboxEditor !== null ||
    noteEditor !== null ||
    calloutEditor !== null ||
    // DEF-096 — a committed-note edit popover is open; the layer
    // must stay pointer-active so the editor's textarea and action
    // bar receive interactions.
    editingNote !== null ||
    editTarget !== null ||
    colorEditId !== null ||
    // DEF-154 — while content is SELECTED (movable) the layer must
    // be a real hit surface: the blank-page press that deselects /
    // reverts lands on the layer's pointerdown, and the selection
    // chrome is hosted inside it.
    selectedAnnId !== null ||
    annPending !== null;

  // ---- previews ------------------------------------------------------------

  let markupPreview: PageRect[] = [];
  if (drag !== null && isMarkupTool) {
    markupPreview = textItemQuads(textItemsSnapRef.current, drag.from, drag.to);
  }
  const shapePreviewRect =
    drag !== null && isShapeTool ? normalizeDragRect(drag.from, drag.to) : null;

  const svgW = widthPt;
  const svgH = heightPt;

  return (
    <div
      ref={rootRef}
      className={interactive ? "annotation-layer annotation-layer-active" : "annotation-layer"}
      data-annotation-layer={page}
      data-tool={toolKind}
      style={{ cursor: toolKind === "select" ? undefined : "crosshair" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <svg
        className="annotation-svg"
        viewBox={`0 0 ${svgW} ${svgH}`}
        width={svgW * cssScale}
        height={svgH * cssScale}
        aria-hidden
      >
        {effectiveAnnotations.map((a) => (
          <SvgAnnotation
            key={a.id}
            ann={a}
            dimmed={false}
            // DEF-154 — committed shapes / ink / arrows are
            // page-interactive (hover grabs, click selects, dblclick
            // opens the color toolbox). The preview paths stay
            // pointer-transparent.
            onPointerDown={(e): void => beginAnnSurfaceDrag(e, a)}
            onClick={(e): void => onAnnClickSurface(e, a)}
            onDoubleClick={(e): void => onAnnDoubleClickSurface(e, a)}
            onPointerUp={(e): void => {
              (e.target as Element).releasePointerCapture?.(e.pointerId);
            }}
          />
        ))}
        {markupPreview.map((r, i) => (
          <MarkupPreviewRect key={i} kind={toolKind as "highlight"} rect={r} color={tool.color} />
        ))}
        {shapePreviewRect !== null && toolKind !== "arrow" && (
          <ShapePreview kind={toolKind as "rect" | "ellipse"} rect={shapePreviewRect} color={tool.color} />
        )}
        {drag !== null && toolKind === "arrow" && (
          <ArrowShape from={drag.from} to={drag.to} color={tool.color} preview />
        )}
        {drag !== null && toolKind === "callout" && dragMeetsMinimum(drag.from, drag.to) && (
          <CalloutShapePreview from={drag.from} to={drag.to} color={tool.color} />
        )}
        {ink !== null && ink.length > 0 && (
          <path
            className="ann-ink ann-preview"
            d={inkPathD(ink)}
            stroke={annotationColorToCss(tool.color)}
            strokeWidth={tool.penWidth}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}
      </svg>

      {effectiveAnnotations.map((a) => (
        <DomAnnotation
          key={a.id}
          ann={a}
          cssScale={cssScale}
          // B4/B5 — the committed note whose editor is open reads
          // as "selected" (Sign-like selection chrome: accent ring
          // on the icon while its floating Confirm / Cancel /
          // Delete action bar is up).
          selected={editingNote?.id === a.id}
          onEditNote={(id, text): void => setEditingNote({ id, text })}
          // DEF-153/154 — the DOM surfaces (textbox, callout box,
          // note icon) are page-interactive like the SVG kinds.
          onSurfacePointerDown={(e, ann, handle): void => beginAnnSurfaceDrag(e, ann, handle)}
          onSurfaceClick={(e, ann): void => onAnnClickSurface(e, ann)}
          onSurfaceDoubleClick={(e, ann): void => onAnnDoubleClickSurface(e, ann)}
          onSurfacePointerUp={(e): void => {
            (e.target as Element).releasePointerCapture?.(e.pointerId);
          }}
          onDragSettled={(): void => {
            movedRef.current = false;
          }}
          dragging={selDrag.drag?.id === a.id}
        />
      ))}

      {/* DEF-154 — selection chrome for the selected (movable)
          annotation: a bounds ring, corner resize handles for
          rect-carrying kinds, a Confirm / Edit / Delete bar beneath,
          and the cursor-attached hint. */}
      {selectedAnn !== null && !anyEditorOpen && (
        <SelectedContentChrome
          ann={selectedAnn}
          cssScale={cssScale}
          widthPt={widthPt}
          onSurfacePointerDown={(e, ann, handle): void => beginAnnSurfaceDrag(e, ann, handle)}
          onConfirm={(): void => {
            if (annPending !== null) {
              confirmPendingAnn();
            } else {
              setSelectedAnnId(null);
              setHintPos(null);
            }
          }}
          onEdit={(): void => openEditorFor(selectedAnn)}
          onDelete={(): void => {
            revertPendingAnn(selectedAnn.id);
            setSelectedAnnId(null);
            onDeleteAnnotation?.(selectedAnn.id);
            setHintPos(null);
          }}
        />
      )}

      {flashId !== null &&
        effectiveAnnotations
          .filter((a) => a.id === flashId)
          .map((a) => (
            <FlashBox key={`flash-${a.id}`} rect={annotationBounds(a)} cssScale={cssScale} />
          ))}

      {textboxEditor !== null && (
        <TextBoxEditor
          at={textboxEditor.at}
          text={textboxEditor.text}
          cssScale={cssScale}
          // Functional setter form — the closure previously read
          // `textboxEditor` from the surrounding render, which goes
          // stale when several keystrokes fire before React commits
          // the first update (e.g. paste, IME composition end). The
          // updater receives the latest committed state from React,
          // so the `at` is always the live value and the typed text
          // always appends onto the previous text rather than over-
          // writing the initial empty string.
          onChange={(text): void => setTextboxEditor((prev) => (prev === null ? null : { ...prev, text }))}
          onCommit={commitTextbox}
          onCancel={(): void => {
            setTextboxEditor(null);
            onFinishedOneShot?.();
          }}
        />
      )}
      {noteEditor !== null && (
        <NoteEditor
          at={noteEditor.at}
          text={noteEditor.text}
          cssScale={cssScale}
          pageWidthCss={widthPt * cssScale}
          onChange={(text): void => setNoteEditor({ ...noteEditor, text })}
          onCommit={commitNote}
          onCancel={(): void => {
            setNoteEditor(null);
            onFinishedOneShot?.();
          }}
          // B4 — explicit Discard / Delete path so the user can
          // drop the in-progress note without committing. The
          // Sign-like action bar requires a third button beside
          // Confirm / Cancel; this is it. Identical semantics to
          // Cancel today; the separate verb matches the textbox /
          // callout editor so every one-shot tool looks the same.
          onDelete={(): void => {
            setNoteEditor(null);
            onFinishedOneShot?.();
          }}
        />
      )}
      {calloutEditor !== null && (
        <CalloutBoxEditor
          box={calloutEditor.box}
          text={calloutEditor.text}
          cssScale={cssScale}
          onChange={(text): void => setCalloutEditor({ ...calloutEditor, text })}
          onCommit={commitCallout}
          onCancel={(): void => {
            setCalloutEditor(null);
            onFinishedOneShot?.();
          }}
        />
      )}
      {/* DEF-096 — editing a committed note. The committed icon's
       * onClick opens this editor pre-filled with the note's
       * existing text; Confirm routes through `onEditAnnotation`
       * (the same AnnotationPatch path the AnnotationsPanel uses),
       * Delete through `onDeleteAnnotation`, Cancel just closes.
       * DEF-154 — when a pending move exists for this note (the
       * icon was dragged before the editor opened), the editor's
       * Confirm commits the move together with the text
       * (delete + re-create with the moved anchor); Cancel reverts
       * the pending move. */}
      {editingNote !== null &&
        ((): ReactElement | null => {
          const target = effectiveAnnotations.find(
            (a) => a.id === editingNote.id && a.kind === "note",
          );
          if (target === undefined || target.kind !== "note") return null;
          const at =
            target.at ??
            (target as unknown as { rects?: { x: number; y: number }[] }).rects?.[0];
          if (at === undefined) return null;
          const pending = annPending?.id === target.id ? annPending : null;
          return (
            <NoteEditor
              at={at}
              text={editingNote.text}
              cssScale={cssScale}
              pageWidthCss={widthPt * cssScale}
              onChange={(text): void => setEditingNote({ ...editingNote, text })}
              onCommit={(): void => {
                const trimmed = editingNote.text.trim();
                setEditingNote(null);
                if (pending !== null && pending.nextAnn.kind === "note") {
                  // Move + text in one delete/re-create commit.
                  onDeleteAnnotation?.(target.id);
                  onCreate({ ...pending.nextAnn, text: trimmed });
                  setAnnDraft(null);
                  setAnnPending(null);
                  setSelectedAnnId(null);
                  setHintPos(null);
                  return;
                }
                if (trimmed === target.text) return;
                onEditAnnotation?.(target.id, { text: trimmed });
              }}
              onCancel={(): void => {
                setEditingNote(null);
                revertPendingAnn(target.id);
              }}
              onDelete={(): void => {
                setEditingNote(null);
                revertPendingAnn(target.id);
                setSelectedAnnId(null);
                onDeleteAnnotation?.(target.id);
              }}
            />
          );
        })()}

      {/* DEF-153/154 — the committed textbox/callout edit toolbox
       * (double-click / bar Edit). Same shared chrome as the create
       * editors: grip + textarea + Confirm/Cancel/Delete. */}
      {editTarget !== null && (
        <CommittedContentEditor
          id={editTarget.id}
          kind={editTarget.kind}
          rect={editTarget.rect}
          text={editTarget.text}
          cssScale={cssScale}
          onChange={(text): void => setEditTarget({ ...editTarget, text })}
          onCommit={(offset): void => commitEditTarget(offset)}
          onCancel={(): void => {
            revertPendingAnn(editTarget.id);
            setEditTarget(null);
            setSelectedAnnId(null);
            setHintPos(null);
          }}
          onDelete={(): void => {
            revertPendingAnn(editTarget.id);
            setSelectedAnnId(null);
            onDeleteAnnotation?.(editTarget.id);
            setEditTarget(null);
            setHintPos(null);
          }}
        />
      )}

      {/* DEF-153/154 — the shape / ink / arrow color edit toolbox
       * (double-click / bar Edit — the only properties these kinds
       * own beyond geometry). */}
      {colorEditId !== null &&
        ((): ReactElement | null => {
          const target = effectiveAnnotations.find((a) => a.id === colorEditId);
          if (target === undefined) return null;
          const b = annotationBounds(target);
          const left = Math.min(b.x * cssScale, Math.max(0, widthPt * cssScale - 220));
          const top = (b.y + b.height) * cssScale + 6;
          return (
            <ShapeColorEditor
              left={left}
              top={top}
              active={target.color}
              onPick={(c): void => applyAnnColor(target.id, c)}
              onClose={(): void => {
                setColorEditId(null);
                setSelectedAnnId(null);
              }}
            />
          );
        })()}

      {/* DEF-153(c) — the cursor-attached "Double click to edit" hint
        while content is selected/movable. Converted from client
        coords to the layer's own box. */}
      {!anyEditorOpen && (selectedAnnId !== null || annPending !== null) && hintPos !== null && (
        <MoveHint
          at={{
            x: hintPos.x - (rootRef.current?.getBoundingClientRect().left ?? 0),
            y: hintPos.y - (rootRef.current?.getBoundingClientRect().top ?? 0),
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-annotation error boundary
//
// A render exception inside one annotation's render (e.g. a malformed
// ArrowShape geometry that survived an IPC round-trip) must not take the
// entire React tree down with it. The orchestrator's diagnosis of DEF-017 was
// exactly this: an arrow annotation came back from the engine with `to`
// undefined, `arrowHead(from, to, …)` threw on `to.x`, and React's render
// crash left the whole workspace black. Two layers of defense:
//
//   1. `engineClient.annotationFromWire` backfills `from`/`to` from
//      `points[0]`/`points[1]` so the renderer code path never sees undefined.
//   2. `AnnotationErrorBoundary` catches any other render exception that
//      somehow slips through (engine upgrade, new annotation kind, transient
//      geometry) and renders a tiny visible "!" marker in the annotation's
//      place instead of crashing the tree. The boundary is reset on
//      `annotationId` change so a single broken annotation can't poison every
//      future render of its siblings.
interface AnnotationErrorBoundaryProps {
  annotationId: string;
  children: ReactNode;
}
interface AnnotationErrorBoundaryState {
  error: Error | null;
}
class AnnotationErrorBoundary extends Component<
  AnnotationErrorBoundaryProps,
  AnnotationErrorBoundaryState
> {
  state: AnnotationErrorBoundaryState = { error: null };
  static getDerivedStateFromError(error: Error): AnnotationErrorBoundaryState {
    return { error };
  }
  componentDidCatch(error: Error): void {
    // Surface to the dev console so the consumer (or QA) can find the
    // offending annotation, but do not re-throw — that would bubble back
    // into React's unmount-the-tree failure mode.
    console.error(
      `[AnnotationOverlay] render failed for ${this.props.annotationId}:`,
      error,
    );
  }
  componentDidUpdate(prev: AnnotationErrorBoundaryProps): void {
    // A different annotation id means a new render target; reset the
    // boundary so a transient failure on annotation N does not silently
    // mask annotation N+1.
    if (prev.annotationId !== this.props.annotationId && this.state.error !== null) {
      this.setState({ error: null });
    }
  }
  render(): ReactNode {
    if (this.state.error !== null) {
      // Tiny "!" marker so the user can still see that an annotation is
      // there (and the panel row links to it by id), but its geometry did
      // not render. Diagnostic-only — zero functional impact.
      return (
        <g className="ann ann-error" data-annotation-id={this.props.annotationId} data-kind="error">
          <title>Annotation failed to render</title>
          <circle cx={0} cy={0} r={4} fill="#ef4444" />
        </g>
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Committed annotations — SVG kinds

export interface AnnotationSurfaceHandlers {
  /** pointerdown on the committed surface — starts the move/resize
   *  drag (DEF-154). */
  onPointerDown?: (e: React.PointerEvent, ann: Annotation) => void;
  onClick?: (e: React.MouseEvent, ann: Annotation) => void;
  onDoubleClick?: (e: React.MouseEvent, ann: Annotation) => void;
  onPointerUp?: (e: React.PointerEvent) => void;
}

interface SvgAnnotationProps extends AnnotationSurfaceHandlers {
  ann: Annotation;
  dimmed: boolean;
}

function SvgAnnotation({
  ann,
  dimmed,
  onPointerDown,
  onClick,
  onDoubleClick,
  onPointerUp,
}: SvgAnnotationProps): ReactElement | null {
  return (
    <AnnotationErrorBoundary annotationId={ann.id}>
      <SvgAnnotationInner
        ann={ann}
        dimmed={dimmed}
        onPointerDown={onPointerDown}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onPointerUp={onPointerUp}
      />
    </AnnotationErrorBoundary>
  );
}

function SvgAnnotationInner({
  ann,
  dimmed: _dimmed,
  onPointerDown,
  onClick,
  onDoubleClick,
  onPointerUp,
}: SvgAnnotationProps): ReactElement | null {
  void _dimmed;
  const hex = annotationColorToCss(ann.color);
  const surfaceProps = {
    onPointerDown:
      onPointerDown === undefined
        ? undefined
        : (e: React.PointerEvent): void => onPointerDown(e, ann),
    onClick: onClick === undefined ? undefined : (e: React.MouseEvent): void => onClick(e, ann),
    onDoubleClick:
      onDoubleClick === undefined
        ? undefined
        : (e: React.MouseEvent): void => onDoubleClick(e, ann),
    onPointerUp,
  };
  switch (ann.kind) {
    case "highlight":
      return (
        <g className="ann ann-markup" data-annotation-id={ann.id} data-kind={ann.kind}>
          {ann.rects.map((r, i) => (
            <rect
              key={i}
              className="ann-highlight"
              x={r.x}
              y={r.y}
              width={r.width}
              height={r.height}
              fill={hex}
            />
          ))}
        </g>
      );
    case "underline":
    case "strikeout":
      return (
        <g className="ann ann-markup" data-annotation-id={ann.id} data-kind={ann.kind}>
          {ann.rects.map((r, i) => {
            const y =
              ann.kind === "underline" ? r.y + r.height - 1 : r.y + r.height / 2;
            return (
              <line
                key={i}
                x1={r.x}
                y1={y}
                x2={r.x + r.width}
                y2={y}
                stroke={hex}
                strokeWidth={1.4}
              />
            );
          })}
        </g>
      );
    case "ink":
      return (
        <g
          className="ann ann-ink ann-content"
          data-annotation-id={ann.id}
          data-kind="ink"
          {...surfaceProps}
        >
          <path
            className="ann-ink-hit"
            d={inkPathD(ann.points)}
            stroke="transparent"
            strokeWidth={Math.max(ann.width, 10)}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d={inkPathD(ann.points)}
            stroke={hex}
            strokeWidth={ann.width}
            fill="none"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </g>
      );
    case "rect":
    case "ellipse": {
      // The renderer creates shapes with a `rect` property, but the
      // backend normalizes them into `rects[0]`. Fall back to rects[0]
      // when rendering annotations that came through the IPC round-trip.
      const r = ann.rect ?? (ann as unknown as { rects?: { x: number; y: number; width: number; height: number }[] }).rects?.[0];
      if (r === undefined) return null;
      const common = {
        "data-annotation-id": ann.id,
        "data-kind": ann.kind,
        className: "ann ann-shape ann-content",
        ...surfaceProps,
      } as const;
      return ann.kind === "rect" ? (
        <rect
          {...common}
          x={r.x}
          y={r.y}
          width={r.width}
          height={r.height}
          fill={hexWithAlpha(hex, 0.1)}
          stroke={hex}
          strokeWidth={1.5}
        />
      ) : (
        <ellipse
          {...common}
          cx={r.x + r.width / 2}
          cy={r.y + r.height / 2}
          rx={r.width / 2}
          ry={r.height / 2}
          fill={hexWithAlpha(hex, 0.1)}
          stroke={hex}
          strokeWidth={1.5}
        />
      );
    }
    case "arrow": {
      // The wire shape stores the two endpoints in `points[0]` / `points[1]`;
      // the renderer carries them in `from` / `to`. We backfill in
      // engineClient.annotationFromWire so by the time we get here both
      // forms should be present — but a malformed annotation coming through
      // any other path (legacy state, a future engine upgrade, an undo
      // against a different shape) can still land here without `from`/`to`.
      // Bail to the boundary rather than crash on `undefined.x`.
      const arrow = ann as typeof ann & {
        points?: PagePoint[] | undefined;
      };
      const from = ann.from ?? arrow.points?.[0];
      const to = ann.to ?? arrow.points?.[1];
      if (from === undefined || to === undefined) return null;
      return (
        <ArrowShape
          from={from}
          to={to}
          color={ann.color}
          id={ann.id}
          {...surfaceProps}
        />
      );
    }
    case "textbox":
    case "note":
    case "callout":
      // textbox + note + callout render as DOM (so the textbox +
      // callout inline editor can host a real <textarea>). The SVG
      // arrow portion of a callout is rendered separately by the
      // CalloutShape SVG component below for committed annotations;
      // the in-progress editor shows it as part of the preview.
      return null;
    default:
      // Exhaustiveness: never
      return null;
  }
}

function ArrowShape({
  from,
  to,
  color,
  id,
  preview,
  onPointerDown,
  onClick,
  onDoubleClick,
  onPointerUp,
}: {
  from: PagePoint;
  to: PagePoint;
  color: AnnotationColorValue;
  id?: string;
  preview?: boolean;
  /** Ann-bound surface handlers (passed through from SvgAnnotation
   *  for committed arrows; undefined for previews). */
  onPointerDown?: (e: React.PointerEvent) => void;
  onClick?: (e: React.MouseEvent) => void;
  onDoubleClick?: (e: React.MouseEvent) => void;
  onPointerUp?: (e: React.PointerEvent) => void;
}): ReactElement {
  const hex = annotationColorToCss(color);
  const [w1, w2] = arrowHead(from, to, ARROW_HEAD_PT);
  return (
    <g
      className={preview === true ? "ann ann-arrow ann-preview" : "ann ann-arrow"}
      data-annotation-id={id}
      data-kind="arrow"
      onPointerDown={preview === true ? undefined : onPointerDown}
      onClick={preview === true ? undefined : onClick}
      onDoubleClick={preview === true ? undefined : onDoubleClick}
      onPointerUp={preview === true ? undefined : onPointerUp}
    >
      {/* DEF-154 — a fat invisible hit line (10pt, transparent) gives
          the thin 2pt arrow a real grab target along its shaft, and a
          wide transparent head hit polygon (filled + 10pt stroked)
          covers the arrowhead so hovering near the tip selects the
          arrow too. The visual line + arrowhead stay
          pointer-transparent. */}
      {preview !== true && (
        <>
          <line
            className="ann-arrow-hit"
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke="transparent"
            strokeWidth={10}
          />
          <polygon
            className="ann-arrow-head-hit"
            points={`${to.x},${to.y} ${w1.x},${w1.y} ${w2.x},${w2.y}`}
            fill="transparent"
            stroke="transparent"
            strokeWidth={10}
            strokeLinejoin="round"
          />
        </>
      )}
      <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={hex} strokeWidth={2} />
      <polygon
        points={`${to.x},${to.y} ${w1.x},${w1.y} ${w2.x},${w2.y}`}
        fill={hex}
      />
    </g>
  );
}

/** Phase 12 — preview the in-progress callout while the user drags.
 *  Renders a placeholder text-box at the drag endpoint and an arrow
 *  from the anchor (`from`) to the box. Used only as a preview
 *  (semi-transparent); the committed annotation lives on the DOM
 *  layer for proper text editing. */
function CalloutShapePreview({
  from,
  to,
  color,
}: {
  from: PagePoint;
  to: PagePoint;
  color: AnnotationColorValue;
}): ReactElement {
  const hex = annotationColorToCss(color);
  const box = normalizeDragRect(to, to);
  // Match the default text-box dimensions the create flow applies
  // so the preview lines up with what the user is about to see.
  if (box.width < TEXTBOX_MIN_WIDTH_PT) box.width = TEXTBOX_MIN_WIDTH_PT;
  box.height = TEXTBOX_LINE_HEIGHT * TEXTBOX_FONT_PT + TEXTBOX_PAD_PT * 2;
  return (
    <g className="ann ann-callout ann-preview" data-kind="callout">
      <ArrowShape from={from} to={to} color={color} preview />
      <rect
        x={box.x}
        y={box.y}
        width={box.width}
        height={box.height}
        fill={hexWithAlpha(hex, 0.08)}
        stroke={hex}
        strokeDasharray="4 3"
        strokeWidth={1.5}
      />
    </g>
  );
}

function MarkupPreviewRect({
  kind,
  rect,
  color,
}: {
  kind: "highlight" | "underline" | "strikeout";
  rect: PageRect;
  color: AnnotationColorValue;
}): ReactElement {
  const hex = annotationColorToCss(color);
  if (kind === "highlight") {
    return (
      <rect
        className="ann-highlight ann-preview"
        x={rect.x}
        y={rect.y}
        width={rect.width}
        height={rect.height}
        fill={hex}
      />
    );
  }
  const y = kind === "underline" ? rect.y + rect.height - 1 : rect.y + rect.height / 2;
  return (
    <line
      className="ann-preview"
      x1={rect.x}
      y1={y}
      x2={rect.x + rect.width}
      y2={y}
      stroke={hex}
      strokeWidth={1.4}
    />
  );
}

function ShapePreview({
  kind,
  rect,
  color,
}: {
  kind: "rect" | "ellipse";
  rect: PageRect;
  color: AnnotationColorValue;
}): ReactElement {
  const hex = annotationColorToCss(color);
  const common = {
    fill: "none",
    stroke: hex,
    strokeWidth: 1.5,
    strokeDasharray: "4 3",
    className: "ann-preview",
  } as const;
  return kind === "rect" ? (
    <rect x={rect.x} y={rect.y} width={rect.width} height={rect.height} {...common} />
  ) : (
    <ellipse
      cx={rect.x + rect.width / 2}
      cy={rect.y + rect.height / 2}
      rx={rect.width / 2}
      ry={rect.height / 2}
      {...common}
    />
  );
}

// ---------------------------------------------------------------------------
// Committed annotations — DOM kinds (textbox, note)

interface DomAnnotationProps extends AnnotationSurfaceHandlers {
  ann: Annotation;
  cssScale: number;
  /** DEF-096 — Clicking a committed note icon opens the editor
   *  pre-filled with the note's text. The overlay owns the editor
   *  state; the icon just reports the click + current text. */
  onEditNote?: (id: string, text: string) => void;
  /** B4/B5 — Sign-like selection state. True while this note's
   *  floating editor (Confirm / Cancel / Delete action bar) is
   *  open; the icon renders an accent ring so the selection is
   *  visible on the page. */
  selected?: boolean;
  /** Posted AFTER a real page drag of this surface settles (the
   *  pointerup computed a non-click movement) so the overlay can
   *  suppress the follow-up click. */
  onDragSettled?: () => void;
  /** True while THIS surface is the in-flight drag target (paints
   *  the grabbing cursor). */
  dragging?: boolean;
  /** Handlers taking the annotation themselves (surface-bound). */
  onSurfacePointerDown?: (e: React.PointerEvent, ann: Annotation, handle?: ImageResizeHandle) => void;
  onSurfaceClick?: (e: React.MouseEvent, ann: Annotation) => void;
  onSurfaceDoubleClick?: (e: React.MouseEvent, ann: Annotation) => void;
  onSurfacePointerUp?: (e: React.PointerEvent) => void;
}

function DomAnnotation({
  ann,
  cssScale,
  onEditNote,
  selected = false,
  onSurfacePointerDown,
  onSurfaceClick,
  onSurfaceDoubleClick,
  onSurfacePointerUp,
}: DomAnnotationProps): ReactElement | null {
  if (ann.kind === "textbox") {
    const r = ann.rect ?? (ann as unknown as { rects?: { x: number; y: number; width: number; height: number }[] }).rects?.[0];
    if (r === undefined) return null;
    const box = overlayRectToCss(r, cssScale);
    const hex = annotationColorToCss(ann.color);
    const style: CSSProperties = {
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
      fontSize: TEXTBOX_FONT_PT * cssScale,
      lineHeight: TEXTBOX_LINE_HEIGHT,
      padding: TEXTBOX_PAD_PT * cssScale,
      borderColor: hex,
      background: hexWithAlpha(hex, 0.08),
    };
    return (
      <div
        className="ann ann-textbox ann-content"
        data-annotation-id={ann.id}
        data-kind="textbox"
        style={style}
        onPointerDown={
          onSurfacePointerDown === undefined
            ? undefined
            : (e: React.PointerEvent<HTMLDivElement>): void => onSurfacePointerDown(e, ann)
        }
        onClick={
          onSurfaceClick === undefined
            ? undefined
            : (e: React.MouseEvent<HTMLDivElement>): void => onSurfaceClick(e, ann)
        }
        onDoubleClick={
          onSurfaceDoubleClick === undefined
            ? undefined
            : (e: React.MouseEvent<HTMLDivElement>): void => onSurfaceDoubleClick(e, ann)
        }
        onPointerUp={onSurfacePointerUp}
      >
        {ann.text}
      </div>
    );
  }
  if (ann.kind === "note") {
    // The renderer creates notes with an `at` point, but the backend
    // normalizes that into `rects[0]` so the wire format is uniform.
    // Fall back to rects[0] for annotations that came through the IPC
    // round-trip (re-open from save-as, etc.).
    const at = ann.at ?? (ann as unknown as { rects?: { x: number; y: number }[] }).rects?.[0];
    if (at === undefined) return null;
    const size = NOTE_ICON_PT * cssScale;
    const hex = annotationColorToCss(ann.color);
    const hasText = ann.text.trim().length > 0;
    // B4/B5 — sticky-note content must be visible on the page, not
    // hidden behind a `title` tooltip. The popover mirrors the
    // NoteEditor's shape (a small box anchored next to the icon)
    // and stays pointer-transparent so the page underneath still
    // scrolls / text-selects. The icon stays clickable so the
    // user can flash the annotation through the panel without
    // jumping through it.
    //
    // B4/B5 — the text is positioned relative to the NOTE ICON
    // div (which is already translated to `at`), NOT in page
    // coords. The previous `left: (at.x + NOTE_ICON_PT) * cssScale`
    // double-offset the text: the `.ann-note` wrapper sits at
    // `at.x` and the inner text added `at.x` AGAIN, pushing the
    // note text far to the right of its icon. Anchoring to the
    // icon's own box (`left: NOTE_ICON_PT * cssScale + 4`) keeps
    // icon + text co-located at every zoom.
    // DEF-104 (B4/B5) — the text must lay out horizontally beside
    // the icon. The earlier fix anchored it to the icon box but left
    // the width `auto`: an absolutely-positioned child with only
    // `left` set shrink-fits against its containing block (the
    // ~48px icon box), so the usable width collapsed to
    // `iconWidth - leftOffset` (~one glyph) and the note rendered
    // as a 48px-wide x 431px-tall vertical column, one character
    // per line. An explicit `width: max-content` breaks that
    // shrink-fit: the box is exactly as wide as the unwrapped
    // text needs, capped by `maxWidth`. `whiteSpace: "normal"`
    // lets a multi-word note keep words on the same line up to
    // that cap (pre-wrap's preferred width is the widest word, so
    // the box would have re-wrapped mid-phrase); the cap still
    // wraps long notes. The text overflows the icon's box to the
    // right — `.ann-note` has no `overflow: hidden`, and the
    // note label is a floating annotation surface, so that is the
    // intended "text visible inside / alongside the marker" look.
    const noteTextStyle: CSSProperties = {
      position: "absolute",
      left: NOTE_ICON_PT * cssScale + 4,
      top: 0,
      width: "max-content",
      maxWidth: Math.max(140 * cssScale, 160),
      whiteSpace: "normal",
      // DEF-104 — long tokens (URLs etc.) still need to wrap
      // inside the maxWidth cap rather than pushing the label past
      // the page edge.
      overflowWrap: "break-word",
      padding: `${4 * cssScale}px ${8 * cssScale}px`,
      borderRadius: "var(--radius-1)",
      background: hexWithAlpha(hex, 0.18),
      border: `1px solid ${hexWithAlpha(hex, 0.55)}`,
      // DEF-158 — the note label floats OVER the paper-white page
      // (never inverted in dark mode), so its ink must be the
      // theme-independent dark-on-page color. The UI-theme
      // `--fg-strong` flips to near-white in dark mode and made the
      // text invisible against the page + tint.
      color: "var(--fg-on-page)",
      fontSize: 11 * cssScale + 2,
      lineHeight: 1.4,
      pointerEvents: "none",
      boxShadow: "0 1px 2px rgba(15, 23, 42, 0.06)",
    };
    return (
      <div
        className={
          selected
            ? "ann ann-note ann-note-selected"
            : "ann ann-note"
        }
        data-annotation-id={ann.id}
        data-kind="note"
        data-note-selected={selected ? "true" : "false"}
        title={ann.text.length > 0 ? ann.text : "Note"}
        role="button"
        tabIndex={0}
        // DEF-154 — the note icon is now also DRAGGABLE: a press on
        // the icon starts a move drag (the overlay's surface
        // handler), a plain click opens the editor (DEF-096). The
        // overlay's click handler suppresses the post-drag click.
        onPointerDown={
          onSurfacePointerDown === undefined
            ? undefined
            : (e: React.PointerEvent<HTMLDivElement>): void => onSurfacePointerDown(e, ann)
        }
        onPointerUp={onSurfacePointerUp}
        // DEF-096 — the actual click behavior behind the
        // "note icon not clickable" report. The icon's
        // pointer-events/z-index were already fixed; what was
        // still missing was a handler that does something on
        // click. Opening the editor pre-filled with the note's
        // existing text makes the icon a real annotation surface:
        // the user can re-read the note, correct it (Confirm →
        // `onEditAnnotation`), or drop it (Delete →
        // `onDeleteAnnotation`).
        onClick={
          onSurfaceClick === undefined
            ? undefined
            : (e: React.MouseEvent<HTMLDivElement>): void => onSurfaceClick(e, ann)
        }
        onDoubleClick={
          onSurfaceDoubleClick === undefined
            ? undefined
            : (e: React.MouseEvent<HTMLDivElement>): void => onSurfaceDoubleClick(e, ann)
        }
        onKeyDown={(e): void => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onEditNote?.(ann.id, ann.text);
          }
        }}
        style={{
          left: at.x * cssScale,
          top: at.y * cssScale,
          width: size,
          height: size,
          color: hex,
        }}
      >
        <MessageSquare size={size} strokeWidth={2} aria-hidden />
        {hasText && (
          <div className="ann-note-text" data-ann-note-text style={noteTextStyle}>
            {ann.text}
          </div>
        )}
      </div>
    );
  }
  if (ann.kind === "callout") {
    // Callout = text box + arrow to anchor. Render the text box as
    // a styled div (same chrome as textbox) and the arrow as an SVG
    // overlay on top of the page. Wire-shape fallback uses rects[0]
    // and the rects[0].x/y as the anchor (the engine normalises the
    // anchor to rects[0]'s top-left when there's no separate anchor
    // surface — the renderer-side fallback avoids a hard crash on
    // older serialized shapes).
    const r = ann.rect ?? (ann as unknown as { rects?: { x: number; y: number; width: number; height: number }[] }).rects?.[0];
    if (r === undefined) return null;
    const anchor =
      ann.at ??
      (ann as unknown as { rects?: { x: number; y: number }[] }).rects?.[0];
    if (anchor === undefined) return null;
    const box = overlayRectToCss(r, cssScale);
    const hex = annotationColorToCss(ann.color);
    const style: CSSProperties = {
      left: box.left,
      top: box.top,
      width: box.width,
      height: box.height,
      fontSize: TEXTBOX_FONT_PT * cssScale,
      lineHeight: TEXTBOX_LINE_HEIGHT,
      padding: TEXTBOX_PAD_PT * cssScale,
      borderColor: hex,
      background: hexWithAlpha(hex, 0.08),
    };
    const anchorCss = {
      x: anchor.x * cssScale,
      y: anchor.y * cssScale,
    };
    // Arrow from the nearest box edge to the anchor. Compute the
    // entry point as the closest corner of the box to the anchor,
    // then draw a stroked line + small arrowhead.
    const entry = calloutEntryPoint(r, anchor);
    const arrowScale = cssScale;
    return (
      <>
        <svg
          className="ann ann-callout-arrow"
          data-annotation-id={ann.id}
          data-kind="callout"
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            width: "100%",
            height: "100%",
            overflow: "visible",
          }}
        >
          <line
            x1={entry.x * arrowScale}
            y1={entry.y * arrowScale}
            x2={anchorCss.x}
            y2={anchorCss.y}
            stroke={hex}
            strokeWidth={1.5}
          />
          {(() => {
            const [w1, w2] = arrowHead(entry, anchor, ARROW_HEAD_PT);
            return (
              <polygon
                points={`${anchorCss.x},${anchorCss.y} ${w1.x * arrowScale},${w1.y * arrowScale} ${w2.x * arrowScale},${w2.y * arrowScale}`}
                fill={hex}
              />
            );
          })()}
        </svg>
        <div
          className="ann ann-callout ann-content"
          data-annotation-id={ann.id}
          data-kind="callout"
          style={style}
          onPointerDown={
            onSurfacePointerDown === undefined
              ? undefined
              : (e: React.PointerEvent<HTMLDivElement>): void => onSurfacePointerDown(e, ann)
          }
          onClick={
            onSurfaceClick === undefined
              ? undefined
              : (e: React.MouseEvent<HTMLDivElement>): void => onSurfaceClick(e, ann)
          }
          onDoubleClick={
            onSurfaceDoubleClick === undefined
              ? undefined
              : (e: React.MouseEvent<HTMLDivElement>): void => onSurfaceDoubleClick(e, ann)
          }
          onPointerUp={onSurfacePointerUp}
        >
          {ann.text}
        </div>
      </>
    );
  }
  return null;
}

// ---------------------------------------------------------------------------
// Flash highlight (panel "scroll to" feedback)

function FlashBox({ rect, cssScale }: { rect: PageRect; cssScale: number }): ReactElement {
  const box = overlayRectToCss(rect, cssScale);
  const pad = 3 * cssScale;
  return (
    <div
      className="ann-flash"
      style={{
        left: box.left - pad,
        top: box.top - pad,
        width: box.width + pad * 2,
        height: box.height + pad * 2,
      }}
      aria-hidden
    />
  );
}

// ---------------------------------------------------------------------------
// Editors

interface TextBoxEditorProps {
  at: PagePoint;
  text: string;
  cssScale: number;
  onChange: (text: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

export function TextBoxEditor(props: TextBoxEditorProps): ReactElement {
  const { at, text, cssScale, onChange, onCommit, onCancel } = props;
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  // DEF-147 — the whole editor window moves when the user grabs its
  // chrome. The WINDOW is the wrapper (bar + textarea are siblings
  // under it) so the offset re-anchors both; the HANDLE is the
  // wrapper itself (same pattern as NoteEditor / EditInlineEditor):
  // a press anywhere on the wrapper that is NOT a control starts the
  // drag, so the wrapper's flex padding/gaps AND the action bar's
  // chrome both move the window. The textarea and the bar buttons
  // are excluded by the hook's controls selector (and the textarea's
  // own stopPropagation keeps typing/dragging inside it from ever
  // reaching the wrapper), so their presses keep their own behavior.
  const drag = useDragWindow({ controlsSelector: "button, textarea, input, select, [role='button']" });
  // B2 — textbox / callout floating action bar (Confirm / Cancel /
  // Delete). Mirrors the sig-pending pattern: the user explicitly
  // commits via Confirm (or Ctrl+Enter, or click-outside), and can
  // also delete the in-progress box without committing via the
  // Delete button. Without these buttons an accidental page click
  // would create a stray empty textbox on commit; the user had no
  // affordance to drop the in-flight placement. The bar renders
  // below the textarea, positioned in a small floating surface
  // that is itself positioned absolutely inside the editor wrapper
  // so it doesn't scroll the textarea out of view as the user
  // types.
  const widthCss = Math.max(
    TEXTBOX_MIN_WIDTH_PT * cssScale,
    Math.max(text.length, 6) * TEXTBOX_FONT_PT * 0.6 * cssScale + TEXTBOX_PAD_PT * 2 * cssScale,
  );
  return (
    <div
      ref={drag.windowRef}
      className={drag.dragging ? "ann-textbox-wrap ann-textbox-wrap-dragging" : "ann-textbox-wrap"}
      data-annotation-editor-wrap="textbox"
      data-annotation-editor="textbox"
      style={{
        position: "absolute",
        left: at.x * cssScale + drag.offset.x,
        top: at.y * cssScale + drag.offset.y,
        minWidth: TEXTBOX_MIN_WIDTH_PT * cssScale,
      }}
      onPointerDown={(e): void => {
        e.stopPropagation();
        drag.handleProps.onPointerDown(e);
      }}
    >
      {/* DEF-147 — real draggable chrome: a thin grip strip above the
          textarea. The textarea AND the action bar move as one window when
          this strip is dragged (it hangs off the wrapper, which is the
          hook's handle). The grip is NOT a control, so a press here starts
          the window move; the textarea (typing surface, its caret/select
          drags) and the bar buttons stay excluded by the hook's controls
          selector. `[data-annotation-editor="textbox"]` now identifies this
          WRAPPER (the window) — same pattern as the note editor — so a
          chrome scan of the editor's rect finds the grip strip and the bar
          chrome as draggable, not only the textarea's interactive surface. */}
      <div className="ann-textbox-grip" data-annotation-editor-handle="textbox" aria-hidden>
        <GripVertical size={12} strokeWidth={2} />
        <span className="ann-textbox-grip-label">Drag to move</span>
      </div>
      <textarea
        ref={ref}
        className="ann-editor ann-textbox-editor"
        value={text}
        placeholder="Type text..."
        onChange={(e): void => onChange(e.target.value)}
        // Removed onBlur commit — Confirm button is now the explicit
        // commit affordance. The textarea losing focus to the
        // Confirm button (or anywhere else outside the editor) would
        // otherwise fire onBlur and commit before the user clicked
        // Cancel / Delete. We keep keyboard shortcuts for
        // power-users (Ctrl+Enter = commit, Esc = cancel).
        onKeyDown={(e): void => {
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            onCommit();
          }
        }}
        onPointerDown={(e): void => e.stopPropagation()}
        style={{
          width: widthCss,
          fontSize: TEXTBOX_FONT_PT * cssScale,
          lineHeight: TEXTBOX_LINE_HEIGHT,
          padding: TEXTBOX_PAD_PT * cssScale,
          // DEF-095 — the textarea must participate in the wrapper's
          // flex column. The shared `.ann-editor` rule (position:
          // absolute, z-index: 3) applies to this textarea too; pulled
          // out of flow it lands its box over the action bar below and
          // intercepts every click on Confirm / Cancel / Delete. The
          // inline `position: static` pins the flow layout regardless
          // of the stylesheet, so the bar is a separate hit surface
          // beneath the textarea.
          position: "static",
        }}
      />
      {/* DEF-095 — render the floating action bar through a
       * dedicated component. The bar shares the same unmount
       * lifetime as the editor (both are siblings under
       * `textboxEditor !== null`), but extracting it into its own
       * component makes the conditional explicit: a future refactor
       * that hoists the bar out of the editor wrapper (or pins it
       * to a different state slot) would leave the conditional on
       * the bar's own mount, not on a shared wrapper. The previous
       * shape was implicitly correct only because both DOM nodes
       * happened to live inside the same conditional block; a
       * refactor that broke that alignment would silently leave
       * the bar visible after Confirm while the textarea
       * unmounted. The fix pins the unmount to the bar's own
       * component identity, so each surface tears down
       * independently when its owning state flips.
       *
       * DEF-147 — the bar carries no drag handle of its own: the
       * wrapper above is the single drag source for the window, and
       * bar-chrome presses bubble up to it (the bar's buttons stay
       * excluded by the wrapper's hook controls selector). */}
      <TextBoxActionBar onCommit={onCommit} onCancel={onCancel} />
    </div>
  );
}

/**
 * DEF-095 — dedicated floating action bar component for the textbox
 * editor. Lives as a sibling of the textarea inside
 * `<TextBoxEditor>` but is a separate component so its lifecycle is
 * pinned to its own mount/unmount. When the editor commits, this
 * bar's parent unmounts alongside the textarea — and because the
 * bar is a child component rather than inline JSX, a future
 * refactor cannot accidentally promote it to App-level state and
 * leave it visible after Confirm.
 */
interface TextBoxActionBarProps {
  onCommit: () => void;
  onCancel: () => void;
}

function TextBoxActionBar(props: TextBoxActionBarProps): ReactElement {
  const { onCommit, onCancel } = props;
  return (
    <div
      className="ann-textbox-actions"
      data-annotation-action-bar="textbox"
      // DEF-095 — pointer-events on the action bar must remain
      // auto (the layer above the bar can otherwise swallow clicks
      // on the Confirm / Cancel / Delete buttons). Belt-and-braces
      // against a future refactor that disables pointer-events on
      // the bar's parent. `position: relative` + `zIndex: 5` also
      // pin the bar ABOVE the textarea inside the wrapper's
      // stacking context — the buttons are the topmost hit
      // surfaces regardless of any future overlap.
      style={{
        pointerEvents: "auto",
        position: "relative",
        zIndex: 5,
      }}
    >
      <button
        type="button"
        className="toolbox-action-btn toolbox-action-btn--confirm ann-textbox-action-btn ann-textbox-action-confirm"
        onClick={onCommit}
        data-annotation-action="textbox-confirm"
        aria-label="Confirm text box"
        title="Confirm (Ctrl+Enter)"
      >
        Confirm
      </button>
      <button
        type="button"
        className="toolbox-action-btn toolbox-action-btn--cancel ann-textbox-action-btn ann-textbox-action-cancel"
        onClick={onCancel}
        data-annotation-action="textbox-cancel"
        aria-label="Cancel text box"
        title="Cancel (Esc)"
      >
        Cancel
      </button>
      <button
        type="button"
        className="toolbox-action-btn toolbox-action-btn--delete ann-textbox-action-btn ann-textbox-action-delete"
        onClick={onCancel}
        data-annotation-action="textbox-delete"
        aria-label="Discard text box"
        title="Discard without saving"
      >
        Delete
      </button>
    </div>
  );
}

interface NoteEditorProps {
  at: PagePoint;
  text: string;
  cssScale: number;
  pageWidthCss: number;
  onChange: (text: string) => void;
  onCommit: () => void;
  onCancel: () => void;
  /** B4 — discard the in-progress note (drops the editor without
   *  creating an annotation). Mirrors the textbox / callout
   *  Delete button so the user has the same affordance for every
   *  one-shot tool. */
  onDelete: () => void;
}

const NOTE_POPOVER_W = 240;

function NoteEditor(props: NoteEditorProps): ReactElement {
  const { at, text, cssScale, pageWidthCss, onChange, onCommit, onCancel, onDelete } = props;
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  // DEF-147 — the note editor floats and is draggable from its
  // chrome (padding / the note icon / gaps between actions); the
  // textarea and the action buttons are controls and keep their own
  // presses.
  const drag = useDragWindow({ controlsSelector: "textarea, button, input, select, [role='button']" });
  // B4 — sticky-note floating selector. The icon and the textarea
  // are co-located in the same wrapper (the icon on the left, the
  // textarea on the right), so the user sees them together as a
  // single visual unit instead of two disconnected surfaces.
  // Width was bumped from 210 -> 240 to accommodate the icon +
  // 3 action buttons without crowding.
  const left = Math.min(at.x * cssScale, Math.max(pageWidthCss - NOTE_POPOVER_W - 8, 0)) + drag.offset.x;
  const top = at.y * cssScale + drag.offset.y;
  return (
    <div
      ref={drag.windowRef}
      className={drag.dragging ? "ann-editor ann-note-editor ann-note-editor-dragging" : "ann-editor ann-note-editor"}
      data-annotation-editor="note"
      style={{ left, top, width: NOTE_POPOVER_W }}
      onPointerDown={(e): void => {
        e.stopPropagation();
        drag.handleProps.onPointerDown(e);
      }}
    >
      {/* DEF-153(d) — the note editor now carries the SAME labelled
          "Drag to move" grip strip as the textbox / callout editors
          (it was invisible drag chrome before). The strip is NOT a
          control, so a press here moves the window. */}
      <ContentGrip handleName="note" />
      <div className="ann-note-editor-row">
        <MessageSquare
          size={NOTE_ICON_PT * cssScale}
          strokeWidth={2}
          aria-hidden
          className="ann-note-editor-icon"
          style={{ color: "var(--accent)" }}
        />
        <textarea
          ref={ref}
          value={text}
          placeholder="Add a note..."
          rows={3}
          onChange={(e): void => onChange(e.target.value)}
          onKeyDown={(e): void => {
            e.stopPropagation();
            if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              onCommit();
            }
          }}
          onPointerDown={(e): void => e.stopPropagation()}
        />
      </div>
      {/* B4 — Sign-like floating action bar. Three buttons (Confirm
        / Cancel / Delete) — the same affordance every other
        one-shot tool exposes. Confirm commits the annotation,
        Cancel drops the editor without saving, Delete discards
        the note (alias of Cancel but matches the textbox/callout
        action bar vocabulary so the user sees one consistent set
        of buttons regardless of the tool). */}
      <div className="ann-note-editor-actions">
        <button
          type="button"
          className="toolbox-action-btn toolbox-action-btn--confirm ann-textbox-action-btn ann-textbox-action-confirm ann-note-btn"
          onClick={onCommit}
          data-annotation-action="note-confirm"
          title="Confirm (Ctrl+Enter)"
        >
          Confirm
        </button>
        <button
          type="button"
          className="toolbox-action-btn toolbox-action-btn--cancel ann-textbox-action-btn ann-textbox-action-cancel ann-note-btn"
          onClick={onCancel}
          data-annotation-action="note-cancel"
          title="Cancel (Esc)"
        >
          Cancel
        </button>
        <button
          type="button"
          className="toolbox-action-btn toolbox-action-btn--delete ann-textbox-action-btn ann-textbox-action-delete ann-note-btn"
          onClick={onDelete}
          data-annotation-action="note-delete"
          title="Discard without saving"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

/** Phase 12 — inline editor for the in-progress callout. Positioned
 *  at the callout's text-box rect (the box dimensions are fixed at
 *  drag-release time, so the user can immediately type into the box
 *  without re-positioning). Chrome matches the textbox editor so
 *  the user sees the same input affordance across the two tools. */
interface CalloutBoxEditorProps {
  box: PageRect;
  text: string;
  cssScale: number;
  onChange: (text: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}

function CalloutBoxEditor(
  props: CalloutBoxEditorProps,
): ReactElement {
  const { box, text, cssScale, onChange, onCommit, onCancel } = props;
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  // DEF-147 — same drag wiring as the textbox editor: the callout
  // window (wrapper) is the drag handle, so a press on the wrapper's
  // chrome OR the action bar's chrome moves the whole window; the
  // textarea and the bar buttons stay controls.
  const drag = useDragWindow({ controlsSelector: "button, textarea, input, select, [role='button']" });
  // B2 — callout floating action bar. Same affordance as the
  // textbox editor (see TextBoxEditor for the rationale): Confirm
  // commits, Cancel / Delete drop the in-flight callout without
  // touching the engine. Ctrl+Enter / Esc keyboard shortcuts
  // remain for power users.
  return (
    <div
      ref={drag.windowRef}
      className={drag.dragging ? "ann-textbox-wrap ann-textbox-wrap-dragging" : "ann-textbox-wrap"}
      data-annotation-editor-wrap="callout"
      data-annotation-editor="callout"
      style={{
        position: "absolute",
        left: box.x * cssScale + drag.offset.x,
        top: box.y * cssScale + drag.offset.y,
        minWidth: TEXTBOX_MIN_WIDTH_PT * cssScale,
      }}
      onPointerDown={(e): void => {
        e.stopPropagation();
        drag.handleProps.onPointerDown(e);
      }}
    >
      {/* DEF-147 — same grip-strip chrome as the textbox editor (see
          TextBoxEditor): the callout window (textarea + action bar) moves
          as one unit when the grip strip above the textarea is dragged. */}
      <div className="ann-textbox-grip" data-annotation-editor-handle="callout" aria-hidden>
        <GripVertical size={12} strokeWidth={2} />
        <span className="ann-textbox-grip-label">Drag to move</span>
      </div>
      <textarea
        ref={ref}
        className="ann-editor ann-textbox-editor"
        value={text}
        placeholder="Type callout text..."
        onChange={(e): void => onChange(e.target.value)}
        onKeyDown={(e): void => {
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            onCommit();
          }
        }}
        onPointerDown={(e): void => e.stopPropagation()}
        style={{
          width: Math.max(
            box.width * cssScale,
            TEXTBOX_MIN_WIDTH_PT * cssScale,
          ),
          fontSize: TEXTBOX_FONT_PT * cssScale,
          lineHeight: TEXTBOX_LINE_HEIGHT,
          padding: TEXTBOX_PAD_PT * cssScale,
          // DEF-095 — same flow fix as the textbox editor: the
          // textarea must stay in the wrapper's flex column so the
          // action bar below is a separate, clickable hit surface.
          position: "static",
        }}
      />
      <div
        className="ann-textbox-actions"
        data-annotation-action-bar="callout"
        style={{
          // DEF-095 — the bar is a real hit target, stacked above
          // the textarea (see TextBoxActionBar). DEF-147 — the bar
          // carries no drag handle of its own; chrome presses
          // bubble up to the wrapper, which is the window's single
          // drag source.
          pointerEvents: "auto",
          position: "relative",
          zIndex: 5,
        }}
      >
        <button
          type="button"
          className="toolbox-action-btn toolbox-action-btn--confirm ann-textbox-action-btn ann-textbox-action-confirm"
          onClick={onCommit}
          data-annotation-action="callout-confirm"
          aria-label="Confirm callout"
          title="Confirm (Ctrl+Enter)"
        >
          Confirm
        </button>
        <button
          type="button"
          className="toolbox-action-btn toolbox-action-btn--cancel ann-textbox-action-btn ann-textbox-action-cancel"
          onClick={onCancel}
          data-annotation-action="callout-cancel"
          aria-label="Cancel callout"
          title="Cancel (Esc)"
        >
          Cancel
        </button>
        <button
          type="button"
          className="toolbox-action-btn toolbox-action-btn--delete ann-textbox-action-btn ann-textbox-action-delete"
          onClick={onCancel}
          data-annotation-action="callout-delete"
          aria-label="Discard callout"
          title="Discard without saving"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DEF-153/154 — selection chrome for a selected (movable) committed
// annotation: bounds ring + corner handles + the shared Confirm /
// Edit / Delete bar + (rendered by the overlay) the move hint.

interface SelectedContentChromeProps {
  ann: Annotation;
  cssScale: number;
  widthPt: number;
  onSurfacePointerDown: (e: React.PointerEvent, ann: Annotation, handle?: ImageResizeHandle) => void;
  onConfirm: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

const RESIZABLE_KINDS: ReadonlySet<Annotation["kind"]> = new Set([
  "textbox",
  "rect",
  "ellipse",
  "callout",
  // DEF-154 — ink and arrow are resizable too: a resize scales their
  // geometry (points / endpoints) into the new bounds
  // (`resizeAnnotation` handles the affine map). Notes stay fixed —
  // the icon is a constant-size marker, resizing it has no meaning.
  "ink",
  "arrow",
]);

function SelectedContentChrome(props: SelectedContentChromeProps): ReactElement {
  const { ann, cssScale, widthPt, onSurfacePointerDown, onConfirm, onEdit, onDelete } = props;
  const bounds = annotationBounds(ann);
  const ring = overlayRectToCss(bounds, cssScale);
  const resizable = RESIZABLE_KINDS.has(ann.kind);
  const topCss = (bounds.y + bounds.height) * cssScale + 4;
  const leftCss = Math.max(0, Math.min(bounds.x * cssScale, widthPt * cssScale - 240));
  return (
    <>
      {/* DEF-154 — the frame positions the ring + handles as ONE unit
          at the annotation's bounds. The handles use the same -5px
          corner offsets as the edit-box handles, so they MUST be
          children of a positioned frame at the ring rect (as
          siblings of the ring, anchored to the page layer, they
          collapsed onto the page's corners instead of the shape). */}
      <div
        className="content-selection-frame"
        data-content-selection-frame
        style={{
          left: ring.left - 2,
          top: ring.top - 2,
          width: ring.width + 4,
          height: ring.height + 4,
        }}
        aria-hidden
      >
        <div
          className="content-selection-bounds"
          data-content-selection-bounds
          aria-hidden
        />
        {resizable &&
          (["nw", "ne", "sw", "se"] as const).map((h) => (
            <div
              key={h}
              className={`content-resize-handle content-resize-handle-${h}`}
              data-annotation-resize-handle={h}
              onPointerDown={(e): void => {
                e.stopPropagation();
                onSurfacePointerDown(e, ann, h);
              }}
            />
          ))}
      </div>
      <ContentActionBar
        className="content-action-bar ann-content-action"
        dataBar={`ann-${ann.kind}`}
        left={leftCss}
        top={topCss}
        onConfirm={onConfirm}
        onEdit={onEdit}
        onDelete={onDelete}
        confirmLabel="Confirm"
        editLabel="Edit"
        deleteLabel="Delete"
        confirmTitle="Confirm the move"
        editTitle={ann.kind === "textbox" || ann.kind === "callout" || ann.kind === "note" ? "Edit content" : "Edit color"}
        deleteTitle="Delete annotation"
        confirmAria="Confirm annotation move"
        editAria="Edit annotation"
        deleteAria="Delete annotation"
        dataActionPrefix={`ann-${ann.kind}`}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// DEF-153/154 — the committed textbox / callout edit toolbox. Same
// shared chrome as the create editors (grip + textarea + Confirm /
// Cancel / Delete). Commit routes through the overlay's
// `commitEditTarget`: text-only -> AnnotationPatch; a toolbox drag ->
// delete + re-create at the moved rect (guardrail #4).

interface CommittedContentEditorProps {
  id: string;
  kind: "textbox" | "callout";
  rect: PageRect;
  text: string;
  cssScale: number;
  onChange: (text: string) => void;
  /** Commit with the toolbox's current drag offset (CSS px) so a
   *  dragged toolbox commits the CONTENT at the moved rect. */
  onCommit: (offset: { x: number; y: number }) => void;
  onCancel: () => void;
  onDelete: () => void;
}

function CommittedContentEditor(props: CommittedContentEditorProps): ReactElement {
  const { id, kind, rect, text, cssScale, onChange, onCommit, onCancel, onDelete } = props;
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.setSelectionRange(0, text.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const drag = useDragWindow({ controlsSelector: "button, textarea, input, select, [role='button']" });
  const widthCss = Math.max(
    rect.width * cssScale,
    TEXTBOX_MIN_WIDTH_PT * cssScale,
    Math.max(text.length, 6) * TEXTBOX_FONT_PT * 0.6 * cssScale + TEXTBOX_PAD_PT * 2 * cssScale,
  );
  return (
    <div
      ref={drag.windowRef}
      className={drag.dragging ? "ann-textbox-wrap ann-textbox-wrap-dragging" : "ann-textbox-wrap"}
      data-annotation-editor-wrap={`edit-${kind}`}
      data-annotation-editor={`edit-${kind}`}
      data-edit-annotation-id={id}
      style={{
        position: "absolute",
        left: rect.x * cssScale + drag.offset.x,
        top: rect.y * cssScale + drag.offset.y,
        minWidth: TEXTBOX_MIN_WIDTH_PT * cssScale,
      }}
      onPointerDown={(e): void => {
        e.stopPropagation();
        drag.handleProps.onPointerDown(e);
      }}
    >
      <ContentGrip handleName={kind === "textbox" ? "edit-textbox" : "edit-callout"} />
      <textarea
        ref={ref}
        className="ann-editor ann-textbox-editor"
        value={text}
        placeholder={kind === "textbox" ? "Edit text..." : "Edit callout text..."}
        onChange={(e): void => onChange(e.target.value)}
        onKeyDown={(e): void => {
          e.stopPropagation();
          if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            onCommit(drag.getOffset());
          }
        }}
        onPointerDown={(e): void => e.stopPropagation()}
        style={{
          width: widthCss,
          fontSize: TEXTBOX_FONT_PT * cssScale,
          lineHeight: TEXTBOX_LINE_HEIGHT,
          padding: TEXTBOX_PAD_PT * cssScale,
          position: "static",
        }}
      />
      <div
        className="ann-textbox-actions"
        data-annotation-action-bar={`edit-${kind}`}
        style={{ pointerEvents: "auto", position: "relative", zIndex: 5 }}
      >
        <button
          type="button"
          className="toolbox-action-btn toolbox-action-btn--confirm ann-textbox-action-btn ann-textbox-action-confirm"
          onClick={(): void => onCommit(drag.getOffset())}
          data-annotation-action={`edit-${kind}-confirm`}
          aria-label={`Confirm ${kind}`}
          title="Confirm (Ctrl+Enter)"
        >
          Confirm
        </button>
        <button
          type="button"
          className="toolbox-action-btn toolbox-action-btn--cancel ann-textbox-action-btn ann-textbox-action-cancel"
          onClick={onCancel}
          data-annotation-action={`edit-${kind}-cancel`}
          aria-label={`Cancel ${kind}`}
          title="Cancel (Esc)"
        >
          Cancel
        </button>
        <button
          type="button"
          className="toolbox-action-btn toolbox-action-btn--delete ann-textbox-action-btn ann-textbox-action-delete"
          onClick={onDelete}
          data-annotation-action={`edit-${kind}-delete`}
          aria-label={`Delete ${kind}`}
          title="Delete annotation"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DEF-153/154 — the shape / ink / arrow color edit toolbox (opened by
// double-click or the bar's Edit). A compact swatch row over the
// built-in palette + a custom hex input; commits through the
// AnnotationPatch path.

interface ShapeColorEditorProps {
  left: number;
  top: number;
  active: AnnotationColorValue;
  onPick: (color: AnnotationColorValue) => void;
  onClose: () => void;
}

function ShapeColorEditor(props: ShapeColorEditorProps): ReactElement {
  const { left, top, active, onPick, onClose } = props;
  const activeHex = annotationColorToCss(active);
  const [draft, setDraft] = useState<string>(activeHex);
  return (
    <div
      className="content-action-bar shape-color-editor"
      data-annotation-color-editor
      role="dialog"
      aria-label="Edit annotation color"
      style={{ left, top }}
      onPointerDown={(e): void => e.stopPropagation()}
    >
      {ANNOTATION_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          className={
            annotationColorToCss(c) === activeHex
              ? "content-color-swatch content-color-swatch-active"
              : "content-color-swatch"
          }
          style={{ background: ANNOTATION_COLOR_HEX[c] }}
          onClick={(): void => onPick(c)}
          aria-label={`Color ${c}`}
          title={`Color: ${c}`}
          data-ann-color-edit={c}
        />
      ))}
      <label className="content-color-hex" title="Custom hex">
        <span className="visually-hidden">Custom color hex</span>
        <input
          type="text"
          value={draft}
          spellCheck={false}
          autoComplete="off"
          onChange={(e): void => setDraft(e.target.value)}
          onBlur={(): void => {
            const c = annotationColorToCss(draft);
            if (c !== "currentColor") {
              onPick(c);
            } else {
              setDraft(activeHex);
            }
          }}
          onKeyDown={(e): void => {
            if (e.key === "Enter") {
              e.preventDefault();
              const c = annotationColorToCss(draft);
              if (c !== "currentColor") {
                onPick(c);
              } else {
                setDraft(activeHex);
              }
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
          aria-label="Custom color hex"
          placeholder="#rrggbb"
          data-ann-color-hex
        />
      </label>
      <button
        type="button"
        className="toolbox-action-btn content-color-close"
        onClick={onClose}
        aria-label="Close color editor"
        title="Close (Esc)"
      >
        <X size={12} strokeWidth={2} aria-hidden />
      </button>
    </div>
  );
}
