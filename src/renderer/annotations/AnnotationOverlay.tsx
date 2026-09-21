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
//   textbox                        click -> annotation placed immediately,
//                                  text edited in the panel's Text field
//   note                           click -> note placed immediately
// With the "select" tool the layer is pointer-transparent, so text
// selection and links behave exactly as before.
//
// Phase 26 — every in-canvas editor is retired. Double-clicking any
// committed surface opens NOTHING (it only selects, like a single
// click); placing a text element creates it immediately with empty
// text and asks the host to focus the text-properties panel's Text
// field, which is the single live editing surface. The shape colour
// palette that a double-clicked shape used to open is gone too — the
// annotation toolbar's `[data-ann-color]` control is the colour path.

import { MessageSquare } from "lucide-react";
import { Component, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  ReactElement,
  ReactNode,
} from "react";
import { AnimatePresence } from "motion/react";
import {
  ContentActionBar,
  useSelectableDrag,
} from "../components/selectableContent";
import { rectsClose, type ImageResizeHandle } from "../edit/geometry";
import { measureTextWidthCss } from "../edit/rasterize";
import {
  liveTextBandStyle,
  liveTextLineStyle,
  styledTextWidthPx,
  type LiveTextLayout,
} from "../edit/liveText";
import {
  annotationBounds,
  arrowHead,
  arrowHeadBase,
  calloutBoxFor,
  calloutEntryPoint,
  clientToPagePoint,
  dragMeetsMinimum,
  inkPathD,
  moveAnnotation,
  moveCalloutAnchor,
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
  annotationColorToCss,
  applyPatch,
  geometryPatchFor,
  type Annotation,
  type AnnotationColorValue,
  type AnnotationPatch,
  type AnnotationToolState,
  type PagePoint,
  type PageRect,
} from "./model";
import AnnColorBox from "./AnnColorBox";
import AnnCommentIcon from "./AnnCommentIcon";
import AnnotationCommentBox from "./AnnotationCommentBox";
import type { AnnTextStyle, CommentEntry, CommentThread } from "../../shared/types";
import type {
  AnnotationColors,
  AnnotationTheme,
} from "../state/colorPalette";
import { consumeMenuDismissPointer } from "./menuDismissGuard";
import { annTextCss, ANN_TEXT_FONT_CSS, type AnnTextCss } from "./annTextStyle";
import {
  annTextEditStyle,
  annTextInsetPt,
  annTextMaxHeightPt,
  layoutAnnTextBox,
} from "./annTextLayout";

// ---------------------------------------------------------------------------
// Constants

const TEXTBOX_FONT_PT = 12;
const TEXTBOX_LINE_HEIGHT = 1.35;
const TEXTBOX_PAD_PT = 5;
const TEXTBOX_MIN_WIDTH_PT = 90;
const TEXTBOX_MAX_WIDTH_PT = 320;
// The committed annotation text renders with the app's UI font (the
// `--font-sans` stack). The live layout measures with this family when the
// annotation stores no font; the div itself inherits the page font.
const ANNOTATION_TEXT_FONT_FAMILY = '"Inter", system-ui, sans-serif';
const NOTE_ICON_PT = 16;
export const ARROW_HEAD_PT = 9;
const MIN_INK_POINTS = 2;
/** Phase 28 — stable empty comment-thread list so the overlay's memo
 *  identity does not churn when the host passes no comments prop. */
const EMPTY_COMMENT_THREADS: readonly CommentThread[] = [];
/** Phase 28 — stable empty entry list for a selected annotation whose
 *  thread does not exist yet (the comment box's empty state). */
const EMPTY_COMMENT_ENTRIES: readonly CommentEntry[] = [];
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
  /** Bug 1 — disarm the annotation CREATION tool when an edit
   *  toolbox opens (double-click / the bar's Edit). With an armed
   *  creation tool (e.g. sticky note) and an edit toolbox open at
   *  the same time, the next page click would both create NEW
   *  content and edit EXISTING content. The host (DocumentView)
   *  wires this to its annotation-tool reducer's "select" action. */
  onDisarmTool?: () => void;
  /** Phase 21 (annotations) — report the overlay's selected committed
   *  annotation (or null) upward. The docked text-properties panel reads
   *  it so a selected annotation text object shows its ACTUAL colour
   *  while the annotation is the active target. */
  onSelectAnnotation?: (ann: Annotation | null) => void;
  /** Phase 26 — a text-bearing element was PLACED or CLICKED. The host
   *  focuses the text-properties panel's Text field and selects its
   *  content so the user can type immediately (the panel field is the
   *  single live text-editing surface; no in-canvas editor exists). */
  onTextFocusRequest?: (id: string) => void;
  /** DEF-166 — annotation ids whose text this overlay must draw LIVE.
   *  When provided, an annotation whose id is NOT in the set came from
   *  the document currently loaded into the page canvas (parsed from
   *  the saved file's /Annots): pdf.js renders its baked FreeText
   *  appearance (generating the glyphs from /Contents + /DA) into the
   *  page bitmap, so drawing the overlay text again doubles it with a
   *  slightly offset ghost copy. For such annotations only the
   *  textbox + callout TEXT node is suppressed (the box border + tint
   *  stay so the committed annotation keeps its box identity); the
   *  note label is never canvas-painted and always renders. When the
   *  prop is absent (unit tests, older consumers) every annotation
   *  draws its text exactly as before. */
  liveAnnTextIds?: ReadonlySet<string>;
  /** Phase 28 — the selected annotation's action bar owns its colour
   *  now, so the bar's colour box needs the same picker inputs the
   *  annotation toolbar's dropdown gets: which preset bucket to edit
   *  and the saved custom presets. Absent in tests / older consumers:
   *  the picker falls back to an empty palette. */
  paletteTheme?: AnnotationTheme;
  annotationPalette?: AnnotationColors;
  onAnnotationPaletteChange?: (next: AnnotationColors) => void;
  /** Phase 28 — the document's comment threads (one per commented
   *  annotation). The overlay renders the small comment badge on every
   *  annotation whose id has a thread and feeds the selected
   *  annotation's entries to the comment box. Absent / empty means
   *  "no comments anywhere" — no badge is drawn for any annotation. */
  comments?: readonly CommentThread[];
  /** Phase 28 — append a comment / reply to an annotation's thread.
   *  Creates the thread on the first call (the engine owns that rule);
   *  the echoed state refreshes `comments`, which flips the badge on
   *  and re-renders the box's list. */
  onAddComment?: (annotationId: string, text: string) => void;
}

interface DragState {
  from: PagePoint;
  to: PagePoint;
}

function newId(): string {
  return crypto.randomUUID();
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Phase 26 — the kinds whose text is edited in the panel's Text field. */
function isTextKind(kind: Annotation["kind"]): boolean {
  return kind === "textbox" || kind === "callout" || kind === "note";
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

/** Phase 24 — the live committed-text style, derived from the annotation's
 *  stored `AnnTextStyle`. Only the fields the annotation actually stores are
 *  applied, so an unstyled annotation keeps the pre-Phase-24 rendering
 *  exactly. The per-line fields (`list` prefixes, `baselineShift`) are not a
 *  flat CSS property — they are emitted per wrapped line by
 *  `AnnStyledLines` via `annTextLayout` / `liveText`. */
function annTextBoxCss(css: AnnTextCss, cssScale: number): CSSProperties {
  return {
    ...(css.fontFamily !== undefined ? { fontFamily: css.fontFamily } : {}),
    ...(css.fontWeight !== undefined ? { fontWeight: css.fontWeight } : {}),
    ...(css.fontStyle !== undefined ? { fontStyle: css.fontStyle } : {}),
    ...(css.textDecoration !== undefined ? { textDecoration: css.textDecoration } : {}),
    ...(css.textAlign !== undefined ? { textAlign: css.textAlign } : {}),
    ...(css.lineHeight !== undefined ? { lineHeight: css.lineHeight } : {}),
    ...(css.indentPt !== undefined
      ? { paddingLeft: TEXTBOX_PAD_PT * cssScale + css.indentPt * cssScale }
      : {}),
    // Phase 27 — tracking is drawn live so a panel change is visible
    // before the /AP stream is re-baked on save.
    ...(css.charSpacingPt !== undefined
      ? { letterSpacing: `${css.charSpacingPt * cssScale}px` }
      : {}),
  };
}

/** DEF-262 — the live layout for a committed textbox / callout. Wraps at the
 *  stored size and GROWS the box height (unless the wrapped block would exceed
 *  the page bound / cap, where it falls back to the engine's shrink-to-fit).
 *  The returned `layout` is in CSS px for the shared per-line helpers; the
 *  height is in page points so the commit path can persist the same value. */
function annLiveTextLayout(args: {
  kind: "textbox" | "callout";
  text: string;
  style: AnnTextStyle | undefined;
  rectPt: PageRect;
  cssScale: number;
  pageHeightPt: number;
  live: boolean;
}): { layout: LiveTextLayout; fontSizePx: number; heightPt: number } {
  const style = args.style;
  const sizePt = style?.size ?? TEXTBOX_FONT_PT;
  const indentPt = style?.indent ?? 0;
  const fontFamily =
    style?.font !== undefined
      ? ANN_TEXT_FONT_CSS[style.font]
      : ANNOTATION_TEXT_FONT_FAMILY;
  const measure = (t: string, s: number): number =>
    measureTextWidthCss(t, fontFamily, s);
  const indentPx = indentPt * args.cssScale;
  if (!args.live) {
    // A parsed annotation's glyphs are painted by pdf.js on the canvas; only
    // the box chrome is ours, so keep the stored rect exactly.
    return {
      fontSizePx: sizePt * args.cssScale,
      heightPt: args.rectPt.height,
      layout: {
        fontSizePx: sizePt * args.cssScale,
        lines: [],
        indentPx,
        contentWidthPx: Math.max(1, args.rectPt.width * args.cssScale),
      },
    };
  }
  const result = layoutAnnTextBox({
    text: args.text,
    style,
    boxWidthPt: args.rectPt.width,
    boxHeightPt: args.rectPt.height,
    insetPt: annTextInsetPt(args.kind),
    maxHeightPt: annTextMaxHeightPt(args.pageHeightPt, args.rectPt.y),
    measure,
  });
  return {
    fontSizePx: result.fontSizePt * args.cssScale,
    heightPt: result.heightPt,
    layout: {
      fontSizePx: result.fontSizePt * args.cssScale,
      lines: result.lines,
      indentPx,
      contentWidthPx: Math.max(1, (result.contentWidthPt - indentPt) * args.cssScale),
    },
  };
}

/** DEF-265 — the per-line text of a committed textbox / callout. Every
 *  wrapped line is its own row so the shared `liveText` emission can give it
 *  a list prefix (with the counter), the stored alignment, a highlight band,
 *  a per-line underline and the super/subscript baseline shift — matching the
 *  baked /AP stream (`drawStyledTextLines`). Before this the overlay rendered
 *  one flat text node, so `list` / `super` / `sub` were invisible live and the
 *  page changed only after save+reopen. */
function AnnStyledLines(props: {
  layout: LiveTextLayout;
  style: AnnTextStyle | undefined;
  cssScale: number;
}): ReactElement {
  const { layout, style, cssScale } = props;
  const editStyle = annTextEditStyle(style);
  return (
    <div className="ann-text-lines">
      {layout.lines.map((line) => (
        <div
          key={line.key}
          className="ann-text-line"
          data-ann-text-line={String(line.index)}
          style={{
            whiteSpace: "nowrap",
            ...liveTextLineStyle({ style: editStyle, layout, isLast: line.isLast }),
          }}
        >
          <span
            className="ann-text-content"
            style={liveTextBandStyle({ style: editStyle, cssScale })}
          >
            {line.prefix !== "" && (
              <span className="ann-text-prefix">{line.prefix}</span>
            )}
            {line.text}
          </span>
        </div>
      ))}
    </div>
  );
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
    onDeleteAnnotation,
    onEditAnnotation,
    onDisarmTool,
    onSelectAnnotation,
    onTextFocusRequest,
    paletteTheme,
    annotationPalette,
    onAnnotationPaletteChange,
    onAddComment,
  } = props;

  // Phase 28 — comment threads for THIS page's annotations. The host
  // threads the whole document's list; filter per page so the badge
  // lookup stays cheap and the overlay never re-renders because of an
  // unrelated page's thread. The lookup map is keyed by annotation id.
  const commentThreads = props.comments ?? EMPTY_COMMENT_THREADS;
  const threadByAnnId = useMemo(() => {
    const map = new Map<string, CommentThread>();
    for (const thread of commentThreads) map.set(thread.annotationId, thread);
    return map;
  }, [commentThreads]);

  // DEF-166 — the host tracks which annotation ids must keep their
  // live overlay text (created / edited since the current page-canvas
  // bytes were loaded). When the prop is absent we draw every
  // annotation's text (the historic behavior); when present, an id
  // missing from the set is a parsed-from-file annotation whose baked
  // FreeText appearance is already painted by pdf.js and the overlay
  // text is suppressed. Null semantics keep the 40+ unit tests that
  // mount the overlay without the prop green.
  const liveAnnTextIds = props.liveAnnTextIds ?? null;

  const rootRef = useRef<HTMLDivElement | null>(null);
  // In-progress interaction state. `drag` covers markup and shape tools;
  // `ink` collects freehand points; `textItemsSnap` caches the text layer
  // geometry for the duration of a markup drag.
  const [drag, setDrag] = useState<DragState | null>(null);
  const [ink, setInk] = useState<PagePoint[] | null>(null);
  // ---- DEF-153 / DEF-154: unified selectable-movable content --------
  // Committed annotations (shapes, ink, arrow, textbox, callout,
  // note) are SELECTABLE + MOVABLE from the page: hover -> grab
  // cursor; single click -> select + movable (Confirm / Delete bar +
  // resize handles). Phase 26 — double-click no longer opens an
  // in-canvas editor (there are none); it behaves like a single click
  // (select). The move/resize is renderer-local during the drag
  // (`annDraft`), and the ENGINE is only touched on Confirm:
  // delete + re-create with the same id and the moved geometry (the
  // shared IPC contract has no annotation move op).
  const [selectedAnnId, setSelectedAnnId] = useState<string | null>(null);
  /** Draft override while dragging or pending — `ann` may be absent
   *  from the `annotations` list (mid delete-then-recreate echo), so
   *  the render merges it back in. */
  const [annDraft, setAnnDraft] = useState<{ id: string; ann: Annotation } | null>(null);
  /** Phase 28 — LIVE EDITS. The ORIGINAL annotation for the current
   *  edit session on the selected annotation, snapshotted before the
   *  first applied move / resize / colour change. Every change applies
   *  to the engine immediately (a move commits on pointerup, a colour
   *  change patches right away); the bar's Cancel restores this
   *  snapshot (undo) and nothing else reverts an applied change. */
  const [editOriginal, setEditOriginal] = useState<{
    id: string;
    ann: Annotation;
  } | null>(null);
  /** Shared move/resize gesture tracker (identical drag math to the
   *  add-box overlay). */
  const selDrag = useSelectableDrag();
  /** True when the last pointerup on a committed surface was a REAL
   *  drag — suppresses the follow-up click from re-selecting. Reset by
   *  the next surface pointerdown. */
  const movedRef = useRef(false);
  const textItemsSnapRef = useRef<TextItemGeom[]>([]);
  // Markup drags keep their quads in a ref during pointermove (cheap) and
  // only push to state once per frame; for simplicity we compute quads in
  // render from `drag` (the drag rect changes at pointermove frequency,
  // which is already React-throttled by the event loop).
  const toolKind = tool.tool;

  /** Phase 21 regression fix — the id of the annotation this commit
   *  JUST placed. A one-shot text tool (textbox / note / callout)
   *  disarms itself in the same tick the annotation is committed
   *  (`onFinishedOneShot` -> the host sets the tool to "select"), which
   *  runs the tool-change reset below. Without this marker the reset
   *  cleared the freshly placed annotation's selection one tick after
   *  placement, the host's text-properties panel saw `selectedAnnText`
   *  flip false, closed, and its 248px reflow pulled the page out from
   *  under the user's follow-up click on the annotation they had just
   *  placed. The marker lets the reset honor the selection ONCE (the
   *  placement's own disarm) while a later, deliberate tool switch
   *  still deselects. */
  const placedSelectionRef = useRef<string | null>(null);

  /** DEF-253 — the previous render's tool kind, so the effect below can
   *  tell a DELIBERATE tool switch (which resets interaction + selection
   *  state) apart from a pure `cssScale` change (the text-properties
   *  panel's 248px reflow resizes the fit scale whenever a selection
   *  opens or closes it). Treating the reflow as a tool change cleared
   *  `selectedAnnId` on click-selection, which flipped `selectedAnnText`
   *  false and closed the panel ~40ms after it opened. */
  const prevToolKindRef = useRef(toolKind);

  // Cancel an in-progress CREATION gesture when the tool changes or the
  // page re-renders at a new scale mid-drag (zoom during a drag abandons
  // it). A scale change is NOT a tool change: it must not touch the
  // selection, a local draft or a pending move, because the panel's own
  // reflow causes it (DEF-253).
  useEffect(() => {
    const toolChanged = prevToolKindRef.current !== toolKind;
    prevToolKindRef.current = toolKind;
    if (!toolChanged) {
      setDrag(null);
      setInk(null);
      selDrag.endDrag();
      return;
    }
    setDrag(null);
    setInk(null);
    const keepPlacedId = placedSelectionRef.current;
    placedSelectionRef.current = null;
    setSelectedAnnId((prev) => (prev !== null && prev === keepPlacedId ? prev : null));
    // The just-placed annotation also keeps its local draft: it is not
    // in the engine's list yet, so dropping the draft here would blank
    // the annotation (and its selection) until the create echo lands.
    if (keepPlacedId === null) setAnnDraft(null);
    setEditOriginal(null);
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

  // Phase 21 (annotations) — report the selected committed annotation
  // upward. `selectedAnn` keeps a stable object identity while the
  // underlying annotation is unchanged, so this only fires on a real
  // selection change (the host passes a stable callback).
  useEffect(() => {
    onSelectAnnotation?.(selectedAnn);
  }, [selectedAnn, onSelectAnnotation]);

  /** Phase 28 — remember the annotation as it stood BEFORE the first
   *  live change of this selection session. A second change in the same
   *  session keeps the first snapshot, so Cancel undoes the whole
   *  session (the "change" the user made). */
  const noteEditOriginal = useCallback((ann: Annotation): void => {
    setEditOriginal((prev) =>
      prev !== null && prev.id === ann.id ? prev : { id: ann.id, ann },
    );
  }, []);

  /** Pin the optimistic draft to a just-committed patch and leave it up until
   *  the engine echo (same id + geometry in the list) drops it. Clearing the
   *  draft synchronously would revert the overlay to the engine list, which
   *  still holds the OLD geometry until the round-trip echoes back — the
   *  "content snaps back before landing at the new spot" artifact. A safety
   *  timer force-clears the draft if the engine op fails — gated on the
   *  geometry so a fresh drag of the same annotation within the grace window
   *  is never reverted. */
  const commitAnnPatch = useCallback(
    (id: string, nextAnn: Annotation, patch: AnnotationPatch): void => {
      onEditAnnotation?.(id, patch);
      setAnnDraft({ id, ann: nextAnn });
      window.setTimeout(() => {
        setAnnDraft((prev) => {
          if (prev?.id !== id) return prev;
          if (!sameAnnotationGeometry(prev.ann, nextAnn)) return prev;
          return null;
        });
      }, 500);
    },
    [onEditAnnotation],
  );

  /** Commit a MOVE / RESIZE while keeping the draft override visible until
   *  the echo lands. DEF-267 — EVERY movable kind now commits IN PLACE
   *  through ONE `editAnnotation` geometry patch built by `geometryPatchFor`
   *  (`rect` for textbox / rect / ellipse / callout, `points` for ink,
   *  `from`+`to` for arrow, `at` for a note or a callout anchor-only drag).
   *  The annotation keeps its id, so no fresh selection event fires and a
   *  zero-gap burst of style clicks after the move cannot read a stale
   *  selection. The old delete + re-create fallback is gone: it was the
   *  DEF-267 race. When the builder returns null (nothing changed, or a
   *  degenerate / non-finite geometry the engine would reject) the local
   *  draft is dropped and NO op is sent — a rejected edit is never retried. */
  const issueMoveCommit = useCallback(
    (oldAnn: Annotation, nextAnn: Annotation): void => {
      const patch = geometryPatchFor(oldAnn, nextAnn);
      if (patch === null || onEditAnnotation === undefined) {
        setAnnDraft((prev) => (prev?.id === oldAnn.id ? null : prev));
        return;
      }
      commitAnnPatch(oldAnn.id, nextAnn, patch);
    },
    [commitAnnPatch, onEditAnnotation],
  );

  /** Phase 28 — apply a colour to the selected annotation LIVE: the
   *  engine patch goes out immediately and the local draft shows the
   *  new colour at once (so the swatch + the shape update before the
   *  echo). The draft carries the CURRENT geometry, so a colour change
   *  right after a move keeps the move. */
  const applyAnnColor = useCallback(
    (color: AnnotationColorValue): void => {
      if (selectedAnn === null) return;
      if (selectedAnn.color === color) return;
      noteEditOriginal(selectedAnn);
      onEditAnnotation?.(selectedAnn.id, { color });
      setAnnDraft({ id: selectedAnn.id, ann: applyPatch(selectedAnn, { color }) });
    },
    [selectedAnn, noteEditOriginal, onEditAnnotation],
  );

  /** Phase 28 — the bar's Cancel: UNDO the session's changes by
   *  restoring the snapshot taken before the first one, then dismiss
   *  the selection. DEF-267 — the revert is ONE in-place `editAnnotation`
   *  patch: the geometry patch for the moved kind plus the original colour
   *  when the colour changed too (the old delete + re-create that used to
   *  carry a colour-only revert is gone). */
  const cancelLiveEdit = useCallback((): void => {
    const original = editOriginal;
    if (original !== null) {
      const current = effectiveAnnotations.find((a) => a.id === original.id) ?? null;
      if (current !== null) {
        const geometry = geometryPatchFor(current, original.ann);
        const patch: AnnotationPatch = {
          ...(geometry ?? {}),
          ...(current.color !== original.ann.color ? { color: original.ann.color } : {}),
        };
        if (Object.keys(patch).length > 0) {
          commitAnnPatch(original.id, applyPatch(current, patch), patch);
        }
      }
    }
    setEditOriginal(null);
    setSelectedAnnId(null);
  }, [editOriginal, effectiveAnnotations, commitAnnPatch]);

  const pagePoint = (e: React.PointerEvent): PagePoint => {
    const root = rootRef.current;
    if (root === null) return { x: 0, y: 0 };
    const rect = root.getBoundingClientRect();
    return clientToPagePoint(e.clientX, e.clientY, rect, cssScale);
  };

  /** Phase 26 — make a text-bearing annotation the active text target:
   *  select it, disarm any armed creation tool (Bug 1 — an armed tool
   *  plus a selected text target would make the next page click both
   *  create and edit), and ask the host to focus the panel's Text
   *  field (the single live editing surface). Nothing opens in the
   *  canvas. */
  const requestTextFocus = useCallback(
    (ann: Annotation): void => {
      onDisarmTool?.();
      setSelectedAnnId(ann.id);
      if (isTextKind(ann.kind)) onTextFocusRequest?.(ann.id);
    },
    [onDisarmTool, onTextFocusRequest],
  );

  /** Start a move (or corner-handle resize) drag on a committed
   *  annotation from its page surface. Stops propagation so the
   *  layer's create-drag can't also start. */
  const beginAnnSurfaceDrag = useCallback(
    (e: React.PointerEvent, ann: Annotation, handle?: ImageResizeHandle): void => {
      if (e.button !== 0) return;
      e.stopPropagation();
      setSelectedAnnId(ann.id);
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

  /** DEF-161 — start an ARROW-ONLY drag on a committed callout (a
   *  press on the arrow's hit shaft / head polygon). The box rect
   *  stays fixed while the anchor (`at`) follows the pointer; the
   *  move parks a pending commit exactly like the box drag. The
   *  gesture tracks through the same `selDrag` controller with the
   *  dedicated "anchor" kind. */
  const beginAnnAnchorDrag = useCallback(
    (e: React.PointerEvent, ann: Annotation): void => {
      if (e.button !== 0) return;
      if (ann.kind !== "callout") return;
      e.stopPropagation();
      setSelectedAnnId(ann.id);
      movedRef.current = false;
      const bounds = annotationBounds(effectiveAnnotations.find((a) => a.id === ann.id) ?? ann);
      selDrag.beginDrag({
        id: ann.id,
        kind: "anchor",
        originClient: { x: e.clientX, y: e.clientY },
        startRect: { ...bounds },
        pageWidthPt: widthPt,
        pageHeightPt: heightPt,
      });
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    },
    [effectiveAnnotations, selDrag, widthPt],
  );

  /** Phase 26 — place a text-bearing annotation immediately, with empty
   *  text, and make it the active text target. No in-canvas editor
   *  mounts: the panel's Text field is focused (through the host) and
   *  the user types there. An empty placement is cleaned up by the host
   *  when the edit session ends without any text. */
  const placeTextAnnotation = useCallback(
    (ann: Annotation): void => {
      selectPlacedAnnotation(ann);
      onCreate(ann);
      onFinishedOneShot?.();
      onTextFocusRequest?.(ann.id);
    },
    [onCreate, onFinishedOneShot, onTextFocusRequest],
  );

  /** Single click on a committed surface: select it and make it
   *  movable (the bar + handles render). Phase 26 — a click on a
   *  text-bearing annotation is also the "start typing" gesture: the
   *  panel's Text field takes focus with its content selected. A
   *  post-drag click (the browser fires `click` after a pointerup that
   *  moved) is ignored via `movedRef`. */
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
      // Phase 26 — a click on a text element enters its text-editing
      // session in the panel: disarm any armed creation tool (Bug 1 —
      // "edit existing" and "create new" stay mutually exclusive) and
      // ask the host to focus the panel's Text field.
      if (isTextKind(ann.kind)) {
        onDisarmTool?.();
        onTextFocusRequest?.(ann.id);
      }
    },
    [selDrag, onTextFocusRequest, onDisarmTool],
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
    // DEF-227 (ADV-046) — a pointerdown whose only job was to dismiss
    // the annotation tools menu must NOT also start a placement
    // gesture (sticky-note editor, rect/highlight drag, ...). The
    // toolbar's outside-dismiss handler (window capture) marked this
    // exact native event; consume the mark and bail out. No
    // preventDefault / stopPropagation: the click still completes for
    // the text layer and for any interactive surface (AGENTS.md
    // cross-bubbling rules). A different pointerdown never matches, so
    // a CommandBar dismiss can't swallow the next page gesture.
    if (consumeMenuDismissPointer(e.nativeEvent)) return;
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
        ".ann-editor, .ann-textbox-actions, .ann-textbox-wrap, .ann-note-editor, .ann-note, .ann-shape, .ann-ink-hit, .ann-arrow-hit, .ann-arrow-head-hit, .ann-callout-arrow-hit, .ann-callout-arrow-head-hit, .ann-textbox, .ann-callout, .content-action-bar, .content-resize-handle, .content-selection-bounds, .content-move-hint, .color-palette, .ann-comment-box, button, input, textarea, select, [role='button'], [role='menuitem'], [role='tab'], [contenteditable='true']",
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
      // Phase 26 — place the annotation immediately (empty text) and
      // hand the text entry to the panel's Text field. No editor mounts.
      placeTextAnnotation({
        id: newId(),
        kind: "textbox",
        page,
        color: tool.color,
        createdAt: nowIso(),
        rect: textBoxRectFor(pt, "", widthPt),
        text: "",
      });
      e.preventDefault();
    } else if (toolKind === "note") {
      placeTextAnnotation({
        id: newId(),
        kind: "note",
        page,
        color: tool.color,
        createdAt: nowIso(),
        at: pt,
        text: "",
      });
      e.preventDefault();
    } else if (toolKind === "callout") {
      // Callout creation is a drag from the anchor (where the callout
      // POINTS AT) to the text-box position. pointerdown captures the
      // anchor; pointerup places the annotation (empty text) and hands
      // text entry to the panel's Text field.
      setDrag({ from: pt, to: pt });
      e.currentTarget.setPointerCapture(e.pointerId);
      e.preventDefault();
    } else if (toolKind === "select" && selectedAnnId !== null) {
      // DESELECT on a blank-page press: the click reached the layer
      // background (not a committed surface / bar), so the selection
      // clears. Phase 28 — an already-applied move / colour change is
      // NOT reverted here: live edits stay applied (only the bar's
      // Cancel undoes them). The textLayer underneath still gets the
      // click (no preventDefault), so text selection keeps working.
      setEditOriginal(null);
      setSelectedAnnId(null);
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
        } else if (drag.kind === "anchor") {
          // DEF-161 — a callout arrow drag moves ONLY the anchor
          // (`at`); the box rect never leaves the engine's position.
          const delta = selDrag.deltaFor(e.clientX, e.clientY, cssScale);
          if (delta !== null) {
            setAnnDraft({ id: orig.id, ann: moveCalloutAnchor(orig, delta.x, delta.y) });
          }
        } else {
          const delta = selDrag.deltaFor(e.clientX, e.clientY, cssScale);
          if (delta !== null) {
            setAnnDraft({ id: orig.id, ann: moveAnnotation(orig, delta.x, delta.y) });
          }
        }
      }
      return;
    }
    const pt = pagePoint(e);
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
    // Phase 28 — end a committed-annotation move/resize drag. A real
    // movement COMMITS immediately (see below); a click (no movement)
    // just keeps the selection so the follow-up click / double-click
    // decides what opens.
    if (selDrag.drag !== null) {
      const drag = selDrag.drag;
      const orig = annotations.find((a) => a.id === drag.id);
      const delta = selDrag.deltaFor(e.clientX, e.clientY, cssScale);
      const newRect = selDrag.rectFor(e.clientX, e.clientY, cssScale);
      selDrag.endDrag();
      (e.target as Element).releasePointerCapture?.(e.pointerId);
      if (orig === undefined || delta === null) return;
      const moved =
        drag.kind === "anchor"
          ? Math.abs(delta.x) > 0.75 || Math.abs(delta.y) > 0.75
          : drag.kind === "move"
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
          : drag.kind === "anchor"
            ? moveCalloutAnchor(orig, delta.x, delta.y)
            : moveAnnotation(orig, delta.x, delta.y);
      // Phase 28 — the move/resize COMMITS here, on pointerup: the
      // engine gets the geometry op immediately (one undo entry), no
      // Confirm click is required. The snapshot is taken before the
      // change so the bar's Cancel can undo it. The selection STAYS so
      // the bar (and its colour box) remains available — picking a
      // colour right after a move must work.
      noteEditOriginal(orig);
      issueMoveCommit(orig, next);
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
        placeTextAnnotation({
          id: newId(),
          kind: "callout",
          page,
          color,
          createdAt: nowIso(),
          rect: { ...box },
          at: { ...from },
          text: "",
        });
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

  // ---- placement -----------------------------------------------------------

  /** Phase 21 regression fix — make a just-committed text annotation the
   *  selection IMMEDIATELY, in the same batched update as its creation.
   *  The local draft substitutes for the not-yet-echoed engine entry so
   *  `selectedAnn` (and therefore the `onSelectAnnotation` report the
   *  host's text-properties panel follows) resolves on this very render
   *  — the panel never sees a closed frame on placement, so its 248px
   *  close transition never reflows the page out from under the user's
   *  next click on the placed annotation. */
  const selectPlacedAnnotation = (ann: Annotation): void => {
    placedSelectionRef.current = ann.id;
    setAnnDraft({ id: ann.id, ann });
    setSelectedAnnId(ann.id);
  };

  const interactive =
    toolKind !== "select" ||
    // DEF-154 — while content is SELECTED (movable) the layer must be a
    // real hit surface: the blank-page press that deselects lands on
    // the layer's pointerdown, and the selection chrome is hosted
    // inside it.
    selectedAnnId !== null;

  /** Phase 26 — keyboard-activation path for a committed note icon
   *  (Enter / Space). Entering the note is the same gesture as clicking
   *  it: select it and focus the panel's Text field (there is no
   *  in-canvas editor). */
  const openNoteEditorFor = useCallback(
    (id: string): void => {
      const ann = effectiveAnnotations.find((a) => a.id === id);
      if (ann === undefined) return;
      requestTextFocus(ann);
    },
    [effectiveAnnotations, requestTextFocus],
  );

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
            // DEF-174 — same live-overlay rule as the DOM path gets
            // below: parsed-from-file highlights (id missing from the
            // set) suppress their SVG rect because pdf.js paints the
            // native /Highlight into the page canvas; live highlights
            // keep the overlay rect. `null` (no split known) draws
            // everything — matches DomAnnotation's fallback.
            liveAnnTextIds={liveAnnTextIds}
            // DEF-154 — committed shapes / ink / arrows are
            // page-interactive (hover grabs, click selects). Phase 26 —
            // double-click opens nothing (there is no in-canvas editor);
            // the annotation toolbar's colour control is the colour path.
            onPointerDown={(e): void => beginAnnSurfaceDrag(e, a)}
            onClick={(e): void => onAnnClickSurface(e, a)}
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
          pageHeightPt={heightPt}
          liveAnnTextIds={liveAnnTextIds}
          // B4/B5 — the committed note reads as "selected" while it is
          // SELECTED via a single click (accent ring around the icon,
          // Sign-like selection chrome).
          selected={selectedAnnId === a.id}
          onEditNote={(id): void => openNoteEditorFor(id)}
          // DEF-153/154 — the DOM surfaces (textbox, callout box,
          // note icon) are page-interactive like the SVG kinds.
          onSurfacePointerDown={(e, ann, handle): void => beginAnnSurfaceDrag(e, ann, handle)}
          onSurfaceClick={(e, ann): void => onAnnClickSurface(e, ann)}
          // DEF-161 — the callout ARROW is its own movable surface:
          // a press on the arrow hit shaft/head starts an anchor-only
          // drag; click selects.
          onAnchorPointerDown={(e, ann): void => beginAnnAnchorDrag(e, ann)}
          onAnchorClick={(e, ann): void => onAnnClickSurface(e, ann)}
          onAnchorPointerUp={(e): void => {
            (e.target as Element).releasePointerCapture?.(e.pointerId);
          }}
          onSurfacePointerUp={(e): void => {
            (e.target as Element).releasePointerCapture?.(e.pointerId);
          }}
          onDragSettled={(): void => {
            movedRef.current = false;
          }}
          dragging={selDrag.drag?.id === a.id}
        />
      ))}

      {/* Phase 28 — the comment badge. Rendered ONLY for an annotation
          that has a thread ("if not comment, no icon should be there").
          It is an indicator: pointer-events: none, no handler, so a
          press that lands on the badge still selects / drags the
          annotation underneath (spec "Icon behaviour"). */}
      {effectiveAnnotations.map((a) => {
        const thread = threadByAnnId.get(a.id);
        if (thread === undefined) return null;
        return (
          <AnnCommentIcon key={`comment-${a.id}`} ann={a} cssScale={cssScale} count={thread.entries.length} />
        );
      })}

      {/* DEF-154 — selection chrome for the selected (movable)
          annotation: a bounds ring, corner resize handles for
          rect-carrying kinds and a Confirm / [colour box] / Cancel /
          Delete bar beneath. Phase 28 — the Edit text is gone; the
          colour box is the colour path for a selected annotation. */}
      <AnimatePresence>
        {selectedAnn !== null && (
          <SelectedContentChrome
            ann={selectedAnn}
            cssScale={cssScale}
            widthPt={widthPt}
            paletteTheme={paletteTheme}
            annotationPalette={annotationPalette}
            onAnnotationPaletteChange={onAnnotationPaletteChange}
            onSurfacePointerDown={(e, ann, handle): void => beginAnnSurfaceDrag(e, ann, handle)}
            onColorChange={applyAnnColor}
            onConfirm={(): void => {
              // Phase 28 — Confirm is a plain dismiss: the move / colour
              // change already committed live, so there is nothing left
              // to apply.
              setEditOriginal(null);
              setSelectedAnnId(null);
            }}
            onCancel={cancelLiveEdit}
            onDelete={(): void => {
              setEditOriginal(null);
              setSelectedAnnId(null);
              onDeleteAnnotation?.(selectedAnn.id);
            }}
          />
        )}
      </AnimatePresence>

      {/* Phase 28 — the COMMENT BOX. "Selecting the annotation element
          will only show this comment box": it mounts for the selected
          annotation and is the single place to read / write the thread.
          Anchored to the annotation's rect, clamped to the page view
          (see `commentBoxPlacement`), and placed clear of the
          annotation surface and the action bar so neither gesture path
          is blocked. */}
      {selectedAnn !== null && onAddComment !== undefined && (
        <AnnotationCommentBox
          ann={selectedAnn}
          entries={threadByAnnId.get(selectedAnn.id)?.entries ?? EMPTY_COMMENT_ENTRIES}
          onAddComment={(text): void => onAddComment(selectedAnn.id, text)}
          cssScale={cssScale}
          widthPt={widthPt}
          heightPt={heightPt}
        />
      )}

      {flashId !== null &&
        effectiveAnnotations
          .filter((a) => a.id === flashId)
          .map((a) => (
            <FlashBox key={`flash-${a.id}`} rect={annotationBounds(a)} cssScale={cssScale} />
          ))}
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
  onPointerUp?: (e: React.PointerEvent) => void;
}

interface SvgAnnotationProps extends AnnotationSurfaceHandlers {
  ann: Annotation;
  dimmed: boolean;
  /** DEF-174 — null or Set<id>, the same live-overlay rule the DOM
   *  path uses for textbox/callout text (DEF-166). Null (no live/id
   *  split known): every highlight draws its overlay rect (historic
   *  behavior). Set<id>: draw the rect only for ids IN the set — a
   *  highlight parsed from the saved file (id missing) has its baked
   *  /Highlight appearance painted by pdf.js into the page canvas,
   *  so drawing the overlay rect again stacks a second translucent
   *  wash on top (~0.58 total). Only the "highlight" case reads the
   *  prop; underline/strikeout are solid strokes (no translucent
   *  canvas partner) and never suppress. */
  liveAnnTextIds?: ReadonlySet<string> | null;
}

function SvgAnnotation({
  ann,
  dimmed,
  liveAnnTextIds = null,
  onPointerDown,
  onClick,
  onPointerUp,
}: SvgAnnotationProps): ReactElement | null {
  return (
    <AnnotationErrorBoundary annotationId={ann.id}>
      <SvgAnnotationInner
        ann={ann}
        dimmed={dimmed}
        liveAnnTextIds={liveAnnTextIds}
        onPointerDown={onPointerDown}
        onClick={onClick}
        onPointerUp={onPointerUp}
      />
    </AnnotationErrorBoundary>
  );
}

function SvgAnnotationInner({
  ann,
  dimmed: _dimmed,
  liveAnnTextIds = null,
  onPointerDown,
  onClick,
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
    onPointerUp,
  };
  switch (ann.kind) {
    case "highlight": {
      // DEF-174 — the SAME live-overlay rule as the DEF-166 textbox /
      // callout text suppression, applied to the highlight rect: a
      // highlight PARSED from the saved file (id missing from
      // `liveAnnTextIds`) has its native /Highlight appearance (the
      // backend bakes only QuadPoints — no /OP, no /AP) synthesized
      // by pdf.js into the page canvas at full opacity; drawing the
      // <rect class="ann-highlight"> again on top stacks a second
      // 0.35 wash over it (~0.58 total — the reported heavy block).
      // Only LIVE highlights (ids in the set) keep the overlay rect;
      // `null` (no live/id split known) keeps the historic
      // always-draw. The highlight <g> carries NO pointer/selection
      // handlers (highlights are selected via the AnnotationsPanel,
      // never page clicks), so suppressing the rect loses no
      // interaction — the panel's flash / scroll-to reads the engine
      // list geometry, not this SVG node.
      const showOverlayRect = liveAnnTextIds === null || liveAnnTextIds.has(ann.id);
      if (!showOverlayRect) return null;
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
    }
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
  onPointerUp?: (e: React.PointerEvent) => void;
}): ReactElement {
  const hex = annotationColorToCss(color);
  const [w1, w2] = arrowHead(from, to, ARROW_HEAD_PT);
  // Phase 28 — the VISIBLE leader line stops at the head's base, so the
  // shaft never crosses or pokes past the pointer. The invisible hit
  // line below still spans the full from -> to length, and the head
  // polygon is unchanged.
  const base = arrowHeadBase(from, to, ARROW_HEAD_PT);
  return (
    <g
      className={preview === true ? "ann ann-arrow ann-preview" : "ann ann-arrow"}
      data-annotation-id={id}
      data-kind="arrow"
      onPointerDown={preview === true ? undefined : onPointerDown}
      onClick={preview === true ? undefined : onClick}
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
      <line x1={from.x} y1={from.y} x2={base.x} y2={base.y} stroke={hex} strokeWidth={2} />
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
  /** DEF-262 — the page height in points, so the live textbox / callout
   *  growth can be clamped to the page bottom. */
  pageHeightPt: number;
  /** DEF-166 — null or Set<id>. Null: draw every annotation's text
   *  (historic behavior). Set<id>: draw text only for ids IN the set;
   *  a textbox/callout id missing from the set is a parsed-from-file
   *  annotation whose baked FreeText appearance pdf.js already paints
   *  into the page canvas — the overlay text node stays empty so the
   *  canvas render is the single visible copy. */
  liveAnnTextIds?: ReadonlySet<string> | null;
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
  onSurfacePointerUp?: (e: React.PointerEvent) => void;
  /** DEF-161 — the callout ARROW's own hit surfaces (transparent
   *  shaft + head polygon) get their own handlers: a pointerdown
   *  starts an anchor-only drag; click/double-click mirror the box's
   *  select / open-editor behavior. */
  onAnchorPointerDown?: (e: React.PointerEvent, ann: Annotation) => void;
  onAnchorClick?: (e: React.MouseEvent, ann: Annotation) => void;
  onAnchorPointerUp?: (e: React.PointerEvent) => void;
}

function DomAnnotation({
  ann,
  cssScale,
  pageHeightPt,
  liveAnnTextIds = null,
  onEditNote,
  selected = false,
  onSurfacePointerDown,
  onSurfaceClick,
  onSurfacePointerUp,
  onAnchorPointerDown,
  onAnchorClick,
  onAnchorPointerUp,
}: DomAnnotationProps): ReactElement | null {
  if (ann.kind === "textbox") {
    const r = ann.rect ?? (ann as unknown as { rects?: { x: number; y: number; width: number; height: number }[] }).rects?.[0];
    if (r === undefined) return null;
    const box = overlayRectToCss(r, cssScale);
    const hex = annotationColorToCss(ann.color);
    // DEF-166 — the overlay text node renders only for LIVE annotations
    // (created/edited in this session). A parsed-from-file textbox has its
    // baked FreeText appearance painted by pdf.js on the page canvas, so the
    // text is suppressed here to avoid the doubled ghost copy on reopen. The
    // box chrome stays.
    const showOverlayText = liveAnnTextIds === null || liveAnnTextIds.has(ann.id);
    // DEF-262 — the committed text no longer shrinks to a fixed one-line box
    // (the old auto-fit collapsed multi-line text to the 4pt floor and made
    // the Size control a no-op). The box GROWS its height to the wrapped block
    // at the requested size, computed by the shared `layoutAnnTextBox`; only
    // when the block would exceed the page bound / sane cap does it fall back
    // to the engine's shrink-to-fit. Phase 24 — the layout reads the STORED
    // size / line step / font / list / indent / tracking, so a panel change is
    // live immediately.
    const annCss = annTextCss(ann.style);
    const lineHeight = annCss.lineHeight ?? TEXTBOX_LINE_HEIGHT;
    const live = annLiveTextLayout({
      kind: "textbox",
      text: ann.text,
      style: ann.style,
      rectPt: r,
      cssScale,
      pageHeightPt,
      live: showOverlayText,
    });
    const style: CSSProperties = {
      left: box.left,
      top: box.top,
      width: box.width,
      height: live.heightPt * cssScale,
      fontSize: live.fontSizePx,
      lineHeight,
      padding: TEXTBOX_PAD_PT * cssScale,
      borderColor: hex,
      background: hexWithAlpha(hex, 0.08),
      ...annTextBoxCss(annCss, cssScale),
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
        onPointerUp={onSurfacePointerUp}
      >
        {showOverlayText && (
          <AnnStyledLines layout={live.layout} style={ann.style} cssScale={cssScale} />
        )}
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
    // hidden behind a `title` tooltip. The label is a small box
    // anchored next to the icon and stays pointer-transparent so the
    // page underneath still scrolls / text-selects. The icon stays
    // clickable so the user can select the note (and hand text entry
    // to the panel's Text field) without jumping through it.
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
    // DEF-264 — the note label now reflects the FULL stored style set live
    // (font, size, bold, italic, underline, align, line-height, list,
    // indent, character spacing, super/subscript, highlight), through the
    // same shared per-line emission as the textbox / callout. The note's
    // colour stays its tint (the icon + label background/border), the
    // stored style is persisted by the panel's `editAnnotation({style})`
    // path. LIMITATION: a PDF `Text` annotation has no baked text
    // appearance, so nothing here is baked — the /Contents is shown by each
    // viewer's own popup, whose styling is viewer-controlled.
    const noteCss = annTextCss(ann.style);
    const fontPx =
      ann.style?.size !== undefined ? ann.style.size * cssScale : 11 * cssScale + 2;
    const noteCapPx = Math.max(140 * cssScale, 160);
    const notePadX = 8 * cssScale;
    const noteIndentPx = (ann.style?.indent ?? 0) * cssScale;
    const noteFamily =
      ann.style?.font !== undefined
        ? ANN_TEXT_FONT_CSS[ann.style.font]
        : ANNOTATION_TEXT_FONT_FAMILY;
    const noteMeasure = (t: string, s: number): number =>
      measureTextWidthCss(t, noteFamily, s);
    // Wrap at the size / indent, then take the widest line as the label's
    // natural width so a short note stays compact and alignment is visible
    // on a multi-line one.
    const noteLayout = layoutAnnTextBox({
      text: ann.text,
      style: { ...ann.style, size: fontPx },
      boxWidthPt: Math.max(1, noteCapPx - noteIndentPx),
      boxHeightPt: 0,
      insetPt: 0,
      maxHeightPt: 1_000_000,
      measure: noteMeasure,
    });
    const noteCharSpacingPx = (ann.style?.charSpacing ?? 0) * cssScale;
    const noteNaturalPx = Math.min(
      Math.max(1, noteCapPx - noteIndentPx),
      Math.max(
        1,
        ...noteLayout.lines.map((l) =>
          styledTextWidthPx(noteMeasure, l.prefix + l.text, fontPx, noteCharSpacingPx),
        ),
      ),
    );
    const noteTextStyle: CSSProperties = {
      position: "absolute",
      left: NOTE_ICON_PT * cssScale + 4,
      top: 0,
      width: noteNaturalPx + notePadX * 2 + noteIndentPx,
      maxWidth: noteCapPx,
      whiteSpace: "normal",
      // DEF-104 — long tokens (URLs etc.) still need to wrap
      // inside the maxWidth cap rather than pushing the label past
      // the page edge.
      overflowWrap: "break-word",
      padding: `${4 * cssScale}px ${notePadX}px`,
      paddingLeft: notePadX + noteIndentPx,
      borderRadius: "var(--radius-1)",
      background: hexWithAlpha(hex, 0.18),
      border: `1px solid ${hexWithAlpha(hex, 0.55)}`,
      // DEF-158 — the note label floats OVER the paper-white page
      // (never inverted in dark mode), so its ink must be the
      // theme-independent dark-on-page color. The UI-theme
      // `--fg-strong` flips to near-white in dark mode and made the
      // text invisible against the page + tint.
      color: "var(--fg-on-page)",
      fontSize: fontPx,
      lineHeight: noteCss.lineHeight ?? 1.4,
      ...(noteCss.fontFamily !== undefined ? { fontFamily: noteCss.fontFamily } : {}),
      ...(noteCss.fontWeight !== undefined ? { fontWeight: noteCss.fontWeight } : {}),
      ...(noteCss.fontStyle !== undefined ? { fontStyle: noteCss.fontStyle } : {}),
      ...(noteCss.textDecoration !== undefined
        ? { textDecoration: noteCss.textDecoration }
        : {}),
      ...(noteCss.textAlign !== undefined ? { textAlign: noteCss.textAlign } : {}),
      ...(noteCss.charSpacingPt !== undefined
        ? { letterSpacing: `${noteCss.charSpacingPt * cssScale}px` }
        : {}),
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
            <AnnStyledLines
              layout={{
                fontSizePx: fontPx,
                lines: noteLayout.lines,
                indentPx: noteIndentPx,
                contentWidthPx: noteNaturalPx,
              }}
              style={ann.style}
              cssScale={cssScale}
            />
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
    // DEF-166 — same live-text rule as the textbox: a callout parsed
    // from the saved file has its baked FreeText appearance (glyphs
    // from /Contents + /DA) painted by pdf.js into the page canvas,
    // so the overlay text node is suppressed on reopen; the box
    // chrome and the arrow (never canvas-painted) stay.
    const showOverlayText = liveAnnTextIds === null || liveAnnTextIds.has(ann.id);
    // DEF-262 — the callout text GROWS its box height to the wrapped block
    // at the requested size, the same rule as the textbox branch above; the
    // `overflow: "hidden"` guard only bites on the clamped fallback.
    const annCss = annTextCss(ann.style);
    const lineHeight = annCss.lineHeight ?? TEXTBOX_LINE_HEIGHT;
    const live = annLiveTextLayout({
      kind: "callout",
      text: ann.text,
      style: ann.style,
      rectPt: r,
      cssScale,
      pageHeightPt,
      live: showOverlayText,
    });
    const style: CSSProperties = {
      left: box.left,
      top: box.top,
      width: box.width,
      height: live.heightPt * cssScale,
      fontSize: live.fontSizePx,
      lineHeight,
      padding: TEXTBOX_PAD_PT * cssScale,
      borderColor: hex,
      background: hexWithAlpha(hex, 0.08),
      overflow: "hidden",
      ...annTextBoxCss(annCss, cssScale),
    };
    const anchorCss = {
      x: anchor.x * cssScale,
      y: anchor.y * cssScale,
    };
    // Arrow from the nearest box edge to the anchor. Compute the
    // entry point as the closest corner of the box to the anchor,
    // then draw a stroked line + small arrowhead. The entry uses the
    // GROWN rect so the leader still touches the visible box edge
    // (DEF-262) instead of the pre-growth one-line rect.
    const entryRect: PageRect = showOverlayText
      ? { ...r, height: live.heightPt }
      : r;
    const entry = calloutEntryPoint(entryRect, anchor);
    const arrowScale = cssScale;
    const [w1, w2] = arrowHead(entry, anchor, ARROW_HEAD_PT);
    const headPoints = `${anchorCss.x},${anchorCss.y} ${w1.x * arrowScale},${w1.y * arrowScale} ${w2.x * arrowScale},${w2.y * arrowScale}`;
    // Phase 28 — the callout's visible leader line also stops at the
    // head's base (the hit shaft above still spans the full entry ->
    // anchor length).
    const base = arrowHeadBase(entry, anchor, ARROW_HEAD_PT);
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
          {/* DEF-161 — the callout arrow gets the SAME fat invisible
              hit surfaces as the standalone arrow (DEF-154): a 10pt
              transparent stroke along the shaft + a wide transparent
              head polygon. The svg container stays pointer-events
              none (its empty box never blocks the page); the hit
              shapes override to stroke/all and carry the arrow's own
              surface handlers — pressing the arrow here drags ONLY
              the anchor, never the box. Draw order mirrors the
              standalone arrow: hit shaft, hit head, visual shaft,
              visual head. */}
          <line
            className="ann-callout-arrow-hit"
            x1={entry.x * arrowScale}
            y1={entry.y * arrowScale}
            x2={anchorCss.x}
            y2={anchorCss.y}
            stroke="transparent"
            strokeWidth={10}
            onPointerDown={
              onAnchorPointerDown === undefined
                ? undefined
                : (e: React.PointerEvent<SVGLineElement>): void => onAnchorPointerDown(e, ann)
            }
            onClick={
              onAnchorClick === undefined
                ? undefined
                : (e: React.MouseEvent<SVGLineElement>): void => onAnchorClick(e, ann)
            }
            onPointerUp={onAnchorPointerUp}
          />
          <polygon
            className="ann-callout-arrow-head-hit"
            points={headPoints}
            fill="transparent"
            stroke="transparent"
            strokeWidth={10}
            strokeLinejoin="round"
            onPointerDown={
              onAnchorPointerDown === undefined
                ? undefined
                : (e: React.PointerEvent<SVGPolygonElement>): void => onAnchorPointerDown(e, ann)
            }
            onClick={
              onAnchorClick === undefined
                ? undefined
                : (e: React.MouseEvent<SVGPolygonElement>): void => onAnchorClick(e, ann)
            }
            onPointerUp={onAnchorPointerUp}
          />
          <line
            x1={entry.x * arrowScale}
            y1={entry.y * arrowScale}
            x2={base.x * arrowScale}
            y2={base.y * arrowScale}
            stroke={hex}
            strokeWidth={1.5}
          />
          <polygon points={headPoints} fill={hex} />
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
          onPointerUp={onSurfacePointerUp}
        >
          {showOverlayText && (
            <AnnStyledLines layout={live.layout} style={ann.style} cssScale={cssScale} />
          )}
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
// DEF-153/154 — selection chrome for a selected (movable) committed
// annotation: bounds ring + corner handles + the shared Confirm /
// Delete bar. Phase 26 — no Edit button (the panel Text field and the
// annotation toolbar own editing) and no cursor hint.

interface SelectedContentChromeProps {
  ann: Annotation;
  cssScale: number;
  widthPt: number;
  paletteTheme?: AnnotationTheme;
  annotationPalette?: AnnotationColors;
  onAnnotationPaletteChange?: (next: AnnotationColors) => void;
  onSurfacePointerDown: (e: React.PointerEvent, ann: Annotation, handle?: ImageResizeHandle) => void;
  onConfirm: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onColorChange: (color: AnnotationColorValue) => void;
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
  const {
    ann,
    cssScale,
    widthPt,
    paletteTheme,
    annotationPalette,
    onAnnotationPaletteChange,
    onSurfacePointerDown,
    onConfirm,
    onCancel,
    onDelete,
    onColorChange,
  } = props;
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
        onCancel={onCancel}
        onDelete={onDelete}
        // Phase 28 — the Edit text is replaced by the colour box, which
        // sits BETWEEN Confirm and Delete. A single click on the swatch
        // expands the shared ColorPalette; picking a colour applies it
        // to this annotation live.
        showEdit={false}
        middle={
          <AnnColorBox
            color={ann.color}
            theme={paletteTheme ?? "light"}
            presets={annotationPalette}
            onPaletteChange={onAnnotationPaletteChange}
            onApply={onColorChange}
          />
        }
        confirmLabel="Confirm"
        cancelLabel="Cancel"
        deleteLabel="Delete"
        confirmTitle="Done"
        cancelTitle="Cancel (revert the change)"
        deleteTitle="Delete annotation"
        confirmAria="Done editing annotation"
        cancelAria="Cancel annotation changes"
        deleteAria="Delete annotation"
        dataActionPrefix={`ann-${ann.kind}`}
      />
    </>
  );
}


