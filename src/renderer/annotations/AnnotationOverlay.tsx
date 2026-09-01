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

import { MessageSquare } from "lucide-react";
import { Component, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import {
  annotationBounds,
  arrowHead,
  calloutEntryPoint,
  clientToPagePoint,
  dragMeetsMinimum,
  inkPathD,
  normalizeDragRect,
  overlayRectToCss,
  textItemQuads,
  textUnderQuads,
  type TextItemGeom,
} from "./geometry";

// Re-export TextItemGeom so PageView can build it from pdf.js TextContent
// without having to know the geometry module's surface.
export type { TextItemGeom };
import {
  annotationColorToCss,
  type Annotation,
  type AnnotationColorValue,
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
  }, [toolKind, cssScale]);

  const pagePoint = (e: React.PointerEvent): PagePoint => {
    const root = rootRef.current;
    if (root === null) return { x: 0, y: 0 };
    const rect = root.getBoundingClientRect();
    return clientToPagePoint(e.clientX, e.clientY, rect, cssScale);
  };

  const isMarkupTool =
    toolKind === "highlight" || toolKind === "underline" || toolKind === "strikeout";
  const isShapeTool =
    toolKind === "rect" || toolKind === "ellipse" || toolKind === "arrow";
  const isDragTool = isMarkupTool || isShapeTool;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    // Let editors handle their own events.
    if ((e.target as HTMLElement).closest(".ann-editor") !== null) return;
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
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>): void => {
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
        // callout points at) to the text-box position. The release
        // point becomes the box's top-left; the box is sized to the
        // default text-box geometry. We open the inline text editor
        // here rather than committing a zero-text callout, mirroring
        // the textbox flow.
        const box = normalizeDragRect(from, to);
        if (box.width < TEXTBOX_MIN_WIDTH_PT) box.width = TEXTBOX_MIN_WIDTH_PT;
        if (box.height < TEXTBOX_LINE_HEIGHT * TEXTBOX_FONT_PT + TEXTBOX_PAD_PT * 2) {
          box.height = TEXTBOX_LINE_HEIGHT * TEXTBOX_FONT_PT + TEXTBOX_PAD_PT * 2;
        }
        // Clamp inside the page bounds.
        if (box.x < 0) box.x = 0;
        if (box.y < 0) box.y = 0;
        if (box.x + box.width > widthPt) box.width = widthPt - box.x;
        if (box.y + box.height > heightPt) box.height = heightPt - box.y;
        setCalloutEditor({ box: box as PageRect, at: from, text: "" });
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

  const commitTextbox = (): void => {
    if (textboxEditor === null) return;
    const text = textboxEditor.text.trim();
    const at = textboxEditor.at;
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
    toolKind !== "select" || textboxEditor !== null || noteEditor !== null || calloutEditor !== null;

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
        {annotations.map((a) => (
          <SvgAnnotation key={a.id} ann={a} dimmed={false} />
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

      {annotations.map((a) => (
        <DomAnnotation key={a.id} ann={a} cssScale={cssScale} />
      ))}

      {flashId !== null &&
        annotations
          .filter((a) => a.id === flashId)
          .map((a) => (
            <FlashBox key={`flash-${a.id}`} rect={annotationBounds(a)} cssScale={cssScale} />
          ))}

      {textboxEditor !== null && (
        <TextBoxEditor
          at={textboxEditor.at}
          text={textboxEditor.text}
          cssScale={cssScale}
          onChange={(text): void => setTextboxEditor({ ...textboxEditor, text })}
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

function SvgAnnotation({ ann, dimmed }: { ann: Annotation; dimmed: boolean }): ReactElement | null {
  return (
    <AnnotationErrorBoundary annotationId={ann.id}>
      <SvgAnnotationInner ann={ann} dimmed={dimmed} />
    </AnnotationErrorBoundary>
  );
}

function SvgAnnotationInner({ ann }: { ann: Annotation; dimmed: boolean }): ReactElement | null {
  const hex = annotationColorToCss(ann.color);
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
        <path
          className="ann ann-ink"
          data-annotation-id={ann.id}
          data-kind="ink"
          d={inkPathD(ann.points)}
          stroke={hex}
          strokeWidth={ann.width}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
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
        className: "ann ann-shape",
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
}: {
  from: PagePoint;
  to: PagePoint;
  color: AnnotationColorValue;
  id?: string;
  preview?: boolean;
}): ReactElement {
  const hex = annotationColorToCss(color);
  const [w1, w2] = arrowHead(from, to, ARROW_HEAD_PT);
  return (
    <g
      className={preview === true ? "ann ann-arrow ann-preview" : "ann ann-arrow"}
      data-annotation-id={id}
      data-kind="arrow"
    >
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

function DomAnnotation({
  ann,
  cssScale,
}: {
  ann: Annotation;
  cssScale: number;
}): ReactElement | null {
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
        className="ann ann-textbox"
        data-annotation-id={ann.id}
        data-kind="textbox"
        style={style}
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
    // B4 — sticky-note content must be visible on the page, not
    // hidden behind a `title` tooltip. The popover mirrors the
    // NoteEditor's shape (a small box anchored next to the icon)
    // and stays pointer-transparent so the page underneath still
    // scrolls / text-selects. The icon stays clickable so the
    // user can flash the annotation through the panel without
    // jumping through it.
    const noteTextStyle: CSSProperties = {
      position: "absolute",
      left: (at.x + NOTE_ICON_PT) * cssScale + 4,
      top: at.y * cssScale,
      maxWidth: Math.max(140 * cssScale, 160),
      padding: `${4 * cssScale}px ${8 * cssScale}px`,
      borderRadius: "var(--radius-1)",
      background: hexWithAlpha(hex, 0.18),
      border: `1px solid ${hexWithAlpha(hex, 0.55)}`,
      color: "var(--fg-strong)",
      fontSize: 11 * cssScale + 2,
      lineHeight: 1.4,
      whiteSpace: "pre-wrap",
      wordBreak: "break-word",
      pointerEvents: "none",
      boxShadow: "0 1px 2px rgba(15, 23, 42, 0.06)",
    };
    return (
      <div
        className="ann ann-note"
        data-annotation-id={ann.id}
        data-kind="note"
        title={ann.text.length > 0 ? ann.text : "Note"}
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
          className="ann ann-callout"
          data-annotation-id={ann.id}
          data-kind="callout"
          style={style}
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

function TextBoxEditor(props: TextBoxEditorProps): ReactElement {
  const { at, text, cssScale, onChange, onCommit, onCancel } = props;
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
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
      className="ann-textbox-wrap"
      data-annotation-editor-wrap="textbox"
      style={{
        position: "absolute",
        left: at.x * cssScale,
        top: at.y * cssScale,
        minWidth: TEXTBOX_MIN_WIDTH_PT * cssScale,
      }}
      onPointerDown={(e): void => e.stopPropagation()}
    >
      <textarea
        ref={ref}
        className="ann-editor ann-textbox-editor"
        data-annotation-editor="textbox"
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
        }}
      />
      <div className="ann-textbox-actions" data-annotation-action-bar="textbox">
        <button
          type="button"
          className="ann-textbox-action-btn ann-textbox-action-confirm"
          onClick={onCommit}
          data-annotation-action="textbox-confirm"
          aria-label="Confirm text box"
          title="Confirm (Ctrl+Enter)"
        >
          Confirm
        </button>
        <button
          type="button"
          className="ann-textbox-action-btn ann-textbox-action-cancel"
          onClick={onCancel}
          data-annotation-action="textbox-cancel"
          aria-label="Cancel text box"
          title="Cancel (Esc)"
        >
          Cancel
        </button>
        <button
          type="button"
          className="ann-textbox-action-btn ann-textbox-action-delete"
          onClick={onCancel}
          data-annotation-action="textbox-delete"
          aria-label="Discard text box"
          title="Discard without saving"
        >
          Delete
        </button>
      </div>
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
}

const NOTE_POPOVER_W = 210;

function NoteEditor(props: NoteEditorProps): ReactElement {
  const { at, text, cssScale, pageWidthCss, onChange, onCommit, onCancel } = props;
  const ref = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  const left = Math.min(at.x * cssScale, Math.max(pageWidthCss - NOTE_POPOVER_W - 8, 0));
  const top = at.y * cssScale + NOTE_ICON_PT * cssScale + 4;
  return (
    <div
      className="ann-editor ann-note-editor"
      data-annotation-editor="note"
      style={{ left, top, width: NOTE_POPOVER_W }}
      onPointerDown={(e): void => e.stopPropagation()}
    >
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
      />
      <div className="ann-note-editor-actions">
        <button type="button" className="btn btn-secondary ann-note-btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary ann-note-btn" onClick={onCommit}>
          Add note
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
  // B2 — callout floating action bar. Same affordance as the
  // textbox editor (see TextBoxEditor for the rationale): Confirm
  // commits, Cancel / Delete drop the in-flight callout without
  // touching the engine. Ctrl+Enter / Esc keyboard shortcuts
  // remain for power users.
  return (
    <div
      className="ann-textbox-wrap"
      data-annotation-editor-wrap="callout"
      style={{
        position: "absolute",
        left: box.x * cssScale,
        top: box.y * cssScale,
        minWidth: TEXTBOX_MIN_WIDTH_PT * cssScale,
      }}
      onPointerDown={(e): void => e.stopPropagation()}
    >
      <textarea
        ref={ref}
        className="ann-editor ann-textbox-editor"
        data-annotation-editor="callout"
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
        }}
      />
      <div className="ann-textbox-actions" data-annotation-action-bar="callout">
        <button
          type="button"
          className="ann-textbox-action-btn ann-textbox-action-confirm"
          onClick={onCommit}
          data-annotation-action="callout-confirm"
          aria-label="Confirm callout"
          title="Confirm (Ctrl+Enter)"
        >
          Confirm
        </button>
        <button
          type="button"
          className="ann-textbox-action-btn ann-textbox-action-cancel"
          onClick={onCancel}
          data-annotation-action="callout-cancel"
          aria-label="Cancel callout"
          title="Cancel (Esc)"
        >
          Cancel
        </button>
        <button
          type="button"
          className="ann-textbox-action-btn ann-textbox-action-delete"
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
