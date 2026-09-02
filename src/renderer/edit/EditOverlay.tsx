// Phase 10 — per-page Edit-content overlay.
//
// One overlay handles all three Edit tools (text / box / image).
// The active tool is the `tool` prop; the component switches its
// pointer handlers and renders the right chrome. The state model
// lives in App.tsx (so the App can keep the placement list and
// selection across page scrolls); this component is mostly
// pointer + render glue.
//
// Interactions:
//   tool === 'text': click on a text item from pdf.js -> open
//                    the inline editor pre-filled with the run's
//                    text at the run's rect.
//   tool === 'box':  drag on the page to create a rect -> open
//                    the inline editor at the new rect with empty
//                    text.
//   tool === 'image':
//                    drag on the page to create a placement
//                    (opens a "Pick image" file picker); the new
//                    placement is added to the registry. Click on
//                    an existing placement -> select; the handles
//                    appear; drag the body to move, drag a handle
//                    to resize, or click "Crop" to enter crop
//                    mode (drag a sub-rect to commit). Click
//                    "Replace" to open the file picker again.

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactElement } from "react";
import { Crop, Trash2 } from "lucide-react";
import type { TextItemGeom } from "../annotations/AnnotationOverlay";
import { overlayRectToCss } from "../annotations/geometry";
import {
  clamp,
  clampRectToPage,
  defaultTextBoxRect,
  type EditAction,
  type EditState,
  type EditTextStyle,
  type EditTool,
  type ImagePlacement,
} from "./model";
import {
  cropImageRect,
  moveImageRect,
  rectsClose,
  resizeImageRect,
  type ImageResizeHandle,
} from "./geometry";
import { EditInlineEditor } from "./EditInlineEditor";

export interface EditOverlayProps {
  page: number;
  pageWidthPt: number;
  pageHeightPt: number;
  cssScale: number;
  /** Active tool. `off` makes the layer pointer-transparent. */
  tool: EditTool;
  /** Snapshot of the page's text items (pdf.js). Used by the text
   *  tool to detect which run the user clicked. */
  getTextItems: () => TextItemGeom[];
  /** Per-tab edit state — placements, selection, crop flag. */
  edit: EditState;
  dispatch: (action: EditAction) => void;
  /** Open the OS file picker for an image (PNG/JPEG). Returns
   *  null when the user cancels. */
  pickImage: () => Promise<{ bytes: Uint8Array; format: "png" | "jpeg" } | null>;
  /** Default font for the next edit. Mirrors
   *  `AppSettings.editDefaultFont`. */
  defaultFont: EditTextStyle["font"];
  /** Commit a text-run edit. Called with the run's rect (page
   *  points, top-left origin) and the new text + style. */
  onCommitTextEdit: (args: {
    rect: { x: number; y: number; width: number; height: number };
    newText: string;
    style: EditTextStyle;
  }) => void;
  /** Commit a new text box. */
  onCommitTextBox: (args: {
    rect: { x: number; y: number; width: number; height: number };
    text: string;
    style: EditTextStyle;
    background: "white" | "none";
  }) => void;
  /** Commit an image edit. `bytes` are the transformed PNG/JPEG
   *  bytes the engine will draw. */
  onCommitImageEdit: (args: {
    op: "move" | "resize" | "replace" | "crop";
    oldRect: { x: number; y: number; width: number; height: number };
    newRect: { x: number; y: number; width: number; height: number };
    bytes: Uint8Array;
    format: "png" | "jpeg";
    id: string;
  }) => void;
}

// ---------------------------------------------------------------------------
// Editor state (local to the overlay). Two editors can be open at
// once in principle (text + image), but the tool picker at the App
// level keeps only one active at a time, so in practice this is one.

interface TextEditTarget {
  rect: { x: number; y: number; width: number; height: number };
  initialText: string;
}

interface BoxDragState {
  from: { x: number; y: number };
  to: { x: number; y: number };
}

interface ImageDragState {
  kind: "create" | "move" | "resize";
  id?: string;
  handle?: ImageResizeHandle;
  origin: { x: number; y: number };
  startRect: { x: number; y: number; width: number; height: number };
}

interface CropDragState {
  /** Crop rect in the image's local coordinate system (0..1). */
  from: { x: number; y: number };
  to: { x: number; y: number };
}

export function EditOverlay(props: EditOverlayProps): ReactElement | null {
  const {
    page,
    pageWidthPt,
    pageHeightPt,
    cssScale,
    tool,
    getTextItems,
    edit,
    dispatch,
    pickImage,
    defaultFont,
    onCommitTextEdit,
    onCommitTextBox,
    onCommitImageEdit,
  } = props;

  const [textTarget, setTextTarget] = useState<TextEditTarget | null>(null);
  const [boxDrag, setBoxDrag] = useState<BoxDragState | null>(null);
  const [imageDrag, setImageDrag] = useState<ImageDragState | null>(null);
  const [cropDrag, setCropDrag] = useState<CropDragState | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  // Force a re-render after async image-byte operations; the
  // placement list lives in `edit` so the only thing that needs
  // a nudge is the local drag state.
  const [dragTick, setDragTick] = useState(0);

  // Text-run hover hint: when the text tool is active, underline the
  // run under the cursor so the user can see what's clickable. We
  // track the hover index in a ref + a state tick to avoid
  // re-rendering on every move.
  //
  // DEF-061 — every hook (useState / useEffect) MUST be called
  // before any early return. Earlier versions of this file declared
  // `hoverRect` after the `if (tool === "off") return null;` branch,
  // so on a render that hit the early return React saw fewer hooks
  // than the previous render and threw #310 ("Rendered fewer hooks
  // than expected"). Both `hoverRect` and its pointermove effect are
  // declared here, above the early return, so the hook count is
  // stable across tool/visibility transitions.
  const [hoverRect, setHoverRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  // Reset all transient state when the tool changes (so a stray
  // drag from one tool doesn't bleed into the next).
  useEffect(() => {
    setTextTarget(null);
    setBoxDrag(null);
    setImageDrag(null);
    setCropDrag(null);
  }, [tool, page]);

  // Helpers ----------------------------------------------------------------

  const pagePoint = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>): { x: number; y: number } => {
      const root = rootRef.current;
      if (root === null) return { x: 0, y: 0 };
      const rect = root.getBoundingClientRect();
      return {
        x: (e.clientX - rect.left) / cssScale,
        y: (e.clientY - rect.top) / cssScale,
      };
    },
    [cssScale],
  );

  const placementsForPage = edit.placements.filter((p) => p.page === page);
  const selectedPlacement = edit.selectedImage !== null
    ? placementsForPage.find((p) => p.id === edit.selectedImage?.id) ?? null
    : null;
  void dragTick; // referenced to keep React happy

  // Click on a text run (text tool) ---------------------------------------

  const onClickTextRun = useCallback(
    (pt: { x: number; y: number }): void => {
      const items = getTextItems();
      // Find the run whose rect contains the click point. Use a
      // small tolerance so a click on the line's vertical center
      // is forgiving.
      for (const item of items) {
        if (pt.x < item.x - 2) continue;
        if (pt.x > item.x + item.width + 2) continue;
        if (pt.y < item.y - 2) continue;
        if (pt.y > item.y + item.height + 2) continue;
        setTextTarget({ rect: { ...item }, initialText: item.text });
        return;
      }
    },
    [getTextItems],
  );

  // Text-run hover hint + B6 click handling. When the text tool is
  // active, underline the run under the cursor so the user can see
  // what's clickable, and open the inline editor on click. Both
  // listeners live at WINDOW level (the hover on pointermove, the
  // click on a capture-phase pointerdown) so a sibling layer that
  // swallows the pointerdown for the neutral select tool cannot
  // block the editor from mounting (B6).
  //
  // DEF-061 — every hook (useState / useEffect) MUST be called
  // before any early return. This effect sits after `onClickTextRun`
  // (which its deps reference — the deps array is evaluated during
  // render, so referencing a later `const` would throw a TDZ
  // ReferenceError) but still before the `if (tool === "off")
  // return null;` branch, so the hook count stays stable across
  // tool/visibility transitions.
  useEffect(() => {
    if (tool !== "text") {
      setHoverRect(null);
      return;
    }
    const onMove = (e: PointerEvent): void => {
      const root = rootRef.current;
      if (root === null) return;
      const rect = root.getBoundingClientRect();
      const x = (e.clientX - rect.left) / cssScale;
      const y = (e.clientY - rect.top) / cssScale;
      const items = getTextItems();
      const hit = items.find(
        (it) =>
          x >= it.x - 2 &&
          x <= it.x + it.width + 2 &&
          y >= it.y - 2 &&
          y <= it.y + it.height + 2,
      );
      setHoverRect(hit === undefined ? null : { ...hit });
    };
    window.addEventListener("pointermove", onMove);
    // B6 — text-run CLICK. The hover hint above works because it
    // listens at window level; the layer's own onPointerDown never
    // fired on a plain click in the installed app — a sibling
    // (the pdf.js textLayer's pointer-events: auto spans, or the
    // annotation layer) swallowed the pointerdown before it
    // reached the edit-layer, so the inline editor never mounted.
    // The same window-level pattern fixes the click: a capture-
    // phase pointerdown listener computes the page point and opens
    // the editor directly, exactly like the hover listener does
    // for the cursor position. Guards (AGENTS.md cross-bubbling
    // rule): bail out when the event target sits inside any
    // interactive control (the editor itself, an image placement /
    // toolbar, or a native control), and only treat left-button
    // presses inside the page bounds as text-run clicks. The
    // layer's own onPointerDown text branch stays as a fallback —
    // both paths converge on the same onClickTextRun and are
    // idempotent.
    const onDown = (e: PointerEvent): void => {
      if (e.button !== 0) return;
      const target = e.target as Element | null;
      if (target !== null && typeof target.closest === "function") {
        const interactive = target.closest(
          ".edit-inline-editor, .edit-image-toolbar, .edit-image-placement, .edit-image-crop-overlay, button, input, textarea, select, [role='button'], .ann-editor, .ann-note, .sig-action-bar, .sig-pending",
        );
        if (interactive !== null) return;
      }
      const root = rootRef.current;
      if (root === null) return;
      const rect = root.getBoundingClientRect();
      const x = (e.clientX - rect.left) / cssScale;
      const y = (e.clientY - rect.top) / cssScale;
      if (x < 0 || y < 0 || x > pageWidthPt || y > pageHeightPt) return;
      onClickTextRun({ x, y });
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [tool, cssScale, getTextItems, onClickTextRun, pageWidthPt, pageHeightPt]);

  // Pointer handlers -----------------------------------------------------

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    // Don't start a drag from inside the editor.
    if ((e.target as HTMLElement).closest(".edit-inline-editor") !== null) return;
    if (edit.cropping) {
      // The crop overlay handles its own pointer events; bail
      // before the main layer starts anything.
      return;
    }
    const pt = pagePoint(e);
    if (pt.x < 0 || pt.y < 0 || pt.x > pageWidthPt || pt.y > pageHeightPt) return;
    // Bug 9 — pointer capture is only meaningful for drag tools
    // (box / image), where it keeps the live drag preview
    // updating even when the cursor strays off the page. For
    // the text tool the gesture is a single click with no
    // follow-up drag; capturing the pointer here would redirect
    // the editor's own pointer events away from its handler
    // (the textarea's caret placement and the toolbar's
    // focus-guard both rely on the native event flow), so the
    // click would visually do nothing. Skip capture for text.
    if (tool !== "text") {
      e.currentTarget.setPointerCapture(e.pointerId);
    }

    if (tool === "text") {
      onClickTextRun(pt);
      return;
    }
    if (tool === "box") {
      setBoxDrag({ from: pt, to: pt });
      e.preventDefault();
      return;
    }
    if (tool === "image") {
      // Did the user click on an existing placement? If so, start
      // a move drag on it. Otherwise start a "create" drag that
      // prompts for a file on commit.
      const hit = hitPlacement(placementsForPage, pt);
      if (hit !== null) {
        dispatch({ type: "select-image", image: { id: hit.id } });
        setImageDrag({
          kind: "move",
          id: hit.id,
          origin: { x: e.clientX, y: e.clientY },
          startRect: { ...hit.rect },
        });
        return;
      }
      dispatch({ type: "select-image", image: null });
      setImageDrag({
        kind: "create",
        origin: { x: e.clientX, y: e.clientY },
        startRect: { x: pt.x, y: pt.y, width: 0, height: 0 },
      });
      e.preventDefault();
      return;
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (imageDrag !== null) {
      const dx = (e.clientX - imageDrag.origin.x) / cssScale;
      const dy = (e.clientY - imageDrag.origin.y) / cssScale;
      if (imageDrag.kind === "create") {
        const from = { x: imageDrag.startRect.x, y: imageDrag.startRect.y };
        const to = pagePoint(e);
        const x = Math.min(from.x, to.x);
        const y = Math.min(from.y, to.y);
        const width = Math.abs(to.x - from.x);
        const height = Math.abs(to.y - from.y);
        setImageDrag({
          ...imageDrag,
          startRect: { x, y, width, height },
        });
        return;
      }
      if (imageDrag.kind === "move" && imageDrag.id !== undefined) {
        const next = moveImageRect(
          imageDrag.startRect,
          { x: dx, y: dy },
          pageWidthPt,
          pageHeightPt,
        );
        dispatch({ type: "set-image-rect", id: imageDrag.id, rect: next });
        return;
      }
      if (imageDrag.kind === "resize" && imageDrag.id !== undefined && imageDrag.handle !== undefined) {
        const next = resizeImageRect(
          imageDrag.startRect,
          imageDrag.handle,
          { x: dx, y: dy },
          pageWidthPt,
          pageHeightPt,
        );
        dispatch({ type: "set-image-rect", id: imageDrag.id, rect: next });
        return;
      }
    }
    if (boxDrag !== null) {
      setBoxDrag({ from: boxDrag.from, to: pagePoint(e) });
      return;
    }
    if (cropDrag !== null) {
      setCropDrag({ ...cropDrag, to: pagePoint(e) });
      return;
    }
  };

  const onPointerUp = async (e: ReactPointerEvent<HTMLDivElement>): Promise<void> => {
    if (imageDrag !== null) {
      (e.target as Element).releasePointerCapture?.(e.pointerId);
      if (imageDrag.kind === "create") {
        // Drag-to-create: the user drew a rect; ask for an image
        // and commit the placement.
        const rect = clampRectToPage(imageDrag.startRect, pageWidthPt, pageHeightPt);
        setImageDrag(null);
        if (rect.width < 8 || rect.height < 8) {
          return; // ignore tiny drags
        }
        const picked = await pickImage();
        if (picked === null) return;
        const id = crypto.randomUUID();
        const placement: ImagePlacement = {
          id,
          page,
          rect,
          bytes: picked.bytes,
          format: picked.format,
        };
        dispatch({ type: "upsert-placement", placement });
        // Commit the engine op (replace because the original rect
        // is empty — there's no old image to mask).
        onCommitImageEdit({
          op: "replace",
          oldRect: rect,
          newRect: rect,
          bytes: picked.bytes,
          format: picked.format,
          id,
        });
        return;
      }
      if (imageDrag.kind === "move" && imageDrag.id !== undefined) {
        const id = imageDrag.id;
        const placement = placementsForPage.find((p) => p.id === id);
        setImageDrag(null);
        if (placement === undefined) return;
        const placementNow = edit.placements.find((p) => p.id === id);
        if (placementNow === undefined) return;
        const newRect = placementNow.rect;
        if (rectsClose(newRect, placement.rect)) return;
        onCommitImageEdit({
          op: "move",
          oldRect: placement.rect,
          newRect,
          bytes: placementNow.bytes,
          format: placementNow.format,
          id,
        });
        return;
      }
      if (imageDrag.kind === "resize" && imageDrag.id !== undefined) {
        const id = imageDrag.id;
        const placement = placementsForPage.find((p) => p.id === id);
        setImageDrag(null);
        if (placement === undefined) return;
        const placementNow = edit.placements.find((p) => p.id === id);
        if (placementNow === undefined) return;
        const newRect = placementNow.rect;
        if (rectsClose(newRect, placement.rect)) return;
        onCommitImageEdit({
          op: "resize",
          oldRect: placement.rect,
          newRect,
          bytes: placementNow.bytes,
          format: placementNow.format,
          id,
        });
        return;
      }
    }
    if (boxDrag !== null) {
      const from = boxDrag.from;
      const to = pagePoint(e);
      setBoxDrag(null);
      const x = Math.min(from.x, to.x);
      const y = Math.min(from.y, to.y);
      const width = Math.abs(to.x - from.x);
      const height = Math.abs(to.y - from.y);
      if (width < 16 || height < 16) {
        // Treat as a single click -> default-size box at the
        // click point.
        const r = defaultTextBoxRect(from, pageWidthPt, pageHeightPt);
        setTextTarget({ rect: r, initialText: "" });
        return;
      }
      const r = clampRectToPage(
        { x, y, width, height },
        pageWidthPt,
        pageHeightPt,
      );
      setTextTarget({ rect: r, initialText: "" });
      return;
    }
    if (cropDrag !== null && selectedPlacement !== null) {
      const crop = cropImageRect(
        selectedPlacement.rect,
        {
          x: clamp(Math.min(cropDrag.from.x, cropDrag.to.x) - selectedPlacement.rect.x, 0, selectedPlacement.rect.width) /
            Math.max(1, selectedPlacement.rect.width),
          y: clamp(Math.min(cropDrag.from.y, cropDrag.to.y) - selectedPlacement.rect.y, 0, selectedPlacement.rect.height) /
            Math.max(1, selectedPlacement.rect.height),
          width: Math.abs(cropDrag.to.x - cropDrag.from.x) /
            Math.max(1, selectedPlacement.rect.width),
          height: Math.abs(cropDrag.to.y - cropDrag.from.y) /
            Math.max(1, selectedPlacement.rect.height),
        },
      );
      setCropDrag(null);
      dispatch({ type: "set-cropping", cropping: false });
      const oldRect = selectedPlacement.rect;
      const newRect = crop;
      onCommitImageEdit({
        op: "crop",
        oldRect,
        newRect,
        bytes: selectedPlacement.bytes,
        format: selectedPlacement.format,
        id: selectedPlacement.id,
      });
      return;
    }
  };

  // Image-action buttons (replace / crop / delete) -----------------------

  const onClickReplace = useCallback(async (): Promise<void> => {
    if (selectedPlacement === null) return;
    const picked = await pickImage();
    if (picked === null) return;
    const oldRect = selectedPlacement.rect;
    const newRect = selectedPlacement.rect;
    onCommitImageEdit({
      op: "replace",
      oldRect,
      newRect,
      bytes: picked.bytes,
      format: picked.format,
      id: selectedPlacement.id,
    });
    // Update the local registry so the next crop / resize reads
    // the new bytes.
    dispatch({
      type: "upsert-placement",
      placement: {
        ...selectedPlacement,
        bytes: picked.bytes,
        format: picked.format,
      },
    });
  }, [selectedPlacement, pickImage, onCommitImageEdit, dispatch]);

  const onClickDelete = useCallback((): void => {
    if (selectedPlacement === null) return;
    dispatch({ type: "delete-placement", id: selectedPlacement.id });
  }, [selectedPlacement, dispatch]);

  const onClickCrop = useCallback((): void => {
    dispatch({ type: "set-cropping", cropping: !edit.cropping });
  }, [edit.cropping, dispatch]);

  // Render ----------------------------------------------------------------

  if (tool === "off") {
    return null;
  }

  // For the text tool, render the layer transparent over the page so
  // clicks land here first; the layer's pointer-events flip on
  // for the duration of the edit.
  const layerClass = "edit-layer edit-layer-active";
  const cursor = tool === "text" || tool === "box" || tool === "image" ? "crosshair" : undefined;

  // Image-create preview: the in-flight rect while the user is
  // dragging out a new image.
  const createPreviewRect =
    imageDrag !== null && imageDrag.kind === "create"
      ? clampRectToPage(imageDrag.startRect, pageWidthPt, pageHeightPt)
      : null;
  const boxPreviewRect =
    boxDrag !== null
      ? clampRectToPage(
          {
            x: Math.min(boxDrag.from.x, boxDrag.to.x),
            y: Math.min(boxDrag.from.y, boxDrag.to.y),
            width: Math.abs(boxDrag.to.x - boxDrag.from.x),
            height: Math.abs(boxDrag.to.y - boxDrag.from.y),
          },
          pageWidthPt,
          pageHeightPt,
        )
      : null;

  return (
    <div
      ref={rootRef}
      className={layerClass}
      data-page={page}
      data-tool={tool}
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e): void => {
        void onPointerUp(e);
      }}
    >
      {tool === "text" && hoverRect !== null && (
        <div
          className="edit-text-hover"
          style={overlayRectToCss(hoverRect, cssScale)}
        />
      )}

      {tool === "box" && boxPreviewRect !== null && (
        <div
          className="edit-box-preview"
          style={overlayRectToCss(boxPreviewRect, cssScale)}
        />
      )}

      {tool === "image" && (
        <>
          {placementsForPage.map((p) => (
            <PlacementView
              key={p.id}
              placement={p}
              cssScale={cssScale}
              selected={edit.selectedImage?.id === p.id}
              isResizing={
                imageDrag !== null && imageDrag.kind === "resize" && imageDrag.id === p.id
              }
              onPointerDownHandle={(e, handle): void => {
                e.stopPropagation();
                e.preventDefault();
                (e.target as Element).setPointerCapture(e.pointerId);
                setImageDrag({
                  kind: "resize",
                  id: p.id,
                  handle,
                  origin: { x: e.clientX, y: e.clientY },
                  startRect: { ...p.rect },
                });
                dispatch({ type: "select-image", image: { id: p.id } });
                setDragTick((v) => v + 1);
              }}
            />
          ))}
          {createPreviewRect !== null && (
            <div
              className="edit-image-create-preview"
              style={overlayRectToCss(createPreviewRect, cssScale)}
            />
          )}
          {selectedPlacement !== null && (
            <PlacementToolbar
              placement={selectedPlacement}
              cropping={edit.cropping}
              cssScale={cssScale}
              pageWidthPt={pageWidthPt}
              onReplace={(): void => {
                void onClickReplace();
              }}
              onCrop={onClickCrop}
              onDelete={onClickDelete}
            />
          )}
          {edit.cropping && selectedPlacement !== null && (
            <CropOverlay
              imageRect={selectedPlacement.rect}
              crop={cropDrag}
              cssScale={cssScale}
              onPointerDown={(e): void => {
                e.stopPropagation();
                e.preventDefault();
                (e.target as Element).setPointerCapture(e.pointerId);
                const pt = pagePoint(e);
                setCropDrag({
                  from: { x: pt.x, y: pt.y },
                  to: { x: pt.x, y: pt.y },
                });
              }}
              onPointerMove={(e): void => {
                if (cropDrag === null) return;
                const pt = pagePoint(e);
                setCropDrag({ ...cropDrag, to: { x: pt.x, y: pt.y } });
              }}
              onPointerUp={(e): void => {
                (e.target as Element).releasePointerCapture?.(e.pointerId);
                // Defer the commit to the layer's onPointerUp,
                // which is wired through the same handler. We just
                // keep the cropDrag state around.
              }}
            />
          )}
        </>
      )}

      {textTarget !== null && (
        <EditInlineEditor
          rect={textTarget.rect}
          cssScale={cssScale}
          initialText={textTarget.initialText}
          initialStyle={{
            font: defaultFont,
            size: Math.round(textTarget.rect.height * 0.8),
            color: { r: 0, g: 0, b: 0 },
          }}
          mode={textTarget.initialText.length > 0 ? "edit" : "box"}
          onCommit={(text, style, options): void => {
            setTextTarget(null);
            if (textTarget.initialText.length > 0) {
              onCommitTextEdit({
                rect: textTarget.rect,
                newText: text,
                style,
              });
            } else {
              onCommitTextBox({
                rect: textTarget.rect,
                text,
                style,
                background: options.background,
              });
            }
          }}
          onCancel={(): void => setTextTarget(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-views

function hitPlacement(
  placements: ImagePlacement[],
  pt: { x: number; y: number },
): ImagePlacement | null {
  // Hit-test in reverse so the most-recently-added placement wins
  // when two overlap.
  for (let i = placements.length - 1; i >= 0; i -= 1) {
    const p = placements[i];
    if (p === undefined) continue;
    if (
      pt.x >= p.rect.x &&
      pt.x <= p.rect.x + p.rect.width &&
      pt.y >= p.rect.y &&
      pt.y <= p.rect.y + p.rect.height
    ) {
      return p;
    }
  }
  return null;
}

interface PlacementViewProps {
  placement: ImagePlacement;
  cssScale: number;
  selected: boolean;
  isResizing: boolean;
  onPointerDownHandle: (e: ReactPointerEvent<HTMLDivElement>, handle: ImageResizeHandle) => void;
}

function PlacementView(props: PlacementViewProps): ReactElement {
  const { placement, cssScale, selected, isResizing, onPointerDownHandle } = props;
  const style: CSSProperties = {
    position: "absolute",
    left: placement.rect.x * cssScale,
    top: placement.rect.y * cssScale,
    width: placement.rect.width * cssScale,
    height: placement.rect.height * cssScale,
  };
  return (
    <div
      className={
        selected
          ? "edit-image-placement edit-image-placement-selected"
          : "edit-image-placement"
      }
      data-placement-id={placement.id}
      style={style}
    >
      <img
        className="edit-image-placement-img"
        src={bytesToObjectURL(placement.bytes, placement.format)}
        alt=""
        draggable={false}
      />
      {selected && (
        <>
          {(["nw", "ne", "sw", "se"] as const).map((h) => (
            <div
              key={h}
              className={`edit-image-handle edit-image-handle-${h}`}
              data-handle={h}
              onPointerDown={(e): void => onPointerDownHandle(e, h)}
            />
          ))}
        </>
      )}
      {/* Marker rendered during a resize drag so the user sees
          a thin border without the dashed selected border being
          misleading. */}
      {isResizing && <div className="edit-image-placement-resizing" />}
    </div>
  );
}

interface PlacementToolbarProps {
  placement: ImagePlacement;
  cropping: boolean;
  cssScale: number;
  pageWidthPt: number;
  onReplace: () => void;
  onCrop: () => void;
  onDelete: () => void;
}

function PlacementToolbar(props: PlacementToolbarProps): ReactElement {
  const { placement, cropping, cssScale, pageWidthPt, onReplace, onCrop, onDelete } = props;
  // Position the toolbar just under the placement, anchored to the
  // placement's left edge. Clamp inside the page.
  const topPt = placement.rect.y + placement.rect.height + 4;
  const leftPt = placement.rect.x;
  const topCss = topPt * cssScale;
  const leftCss = Math.max(0, Math.min(leftPt * cssScale, pageWidthPt * cssScale - 220));
  return (
    <div
      className="edit-image-toolbar"
      data-placement-id={placement.id}
      style={{ left: leftCss, top: topCss }}
      onPointerDown={(e): void => e.stopPropagation()}
    >
      <button
        type="button"
        className="edit-image-toolbar-btn"
        onClick={onReplace}
        aria-label="Replace image"
        title="Replace image"
      >
        Replace
      </button>
      <button
        type="button"
        className={cropping ? "edit-image-toolbar-btn edit-image-toolbar-btn-active" : "edit-image-toolbar-btn"}
        onClick={onCrop}
        aria-label="Crop image"
        title="Crop image"
        data-crop-toggle
      >
        <Crop size={13} aria-hidden />
        <span>Crop</span>
      </button>
      <button
        type="button"
        className="edit-image-toolbar-btn edit-image-toolbar-btn-danger"
        onClick={onDelete}
        aria-label="Remove image"
        title="Remove from edit list"
      >
        <Trash2 size={13} aria-hidden />
        <span>Remove</span>
      </button>
    </div>
  );
}

interface CropOverlayProps {
  imageRect: { x: number; y: number; width: number; height: number };
  crop: CropDragState | null;
  cssScale: number;
  onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => void;
}

function CropOverlay(props: CropOverlayProps): ReactElement {
  const { imageRect, crop, cssScale, onPointerDown, onPointerMove, onPointerUp } = props;
  const style: CSSProperties = {
    position: "absolute",
    left: imageRect.x * cssScale,
    top: imageRect.y * cssScale,
    width: imageRect.width * cssScale,
    height: imageRect.height * cssScale,
  };
  let marqueeStyle: CSSProperties | null = null;
  if (crop !== null) {
    const x = Math.min(crop.from.x, crop.to.x);
    const y = Math.min(crop.from.y, crop.to.y);
    const w = Math.abs(crop.to.x - crop.from.x);
    const h = Math.abs(crop.to.y - crop.from.y);
    marqueeStyle = {
      left: (x - imageRect.x) * cssScale,
      top: (y - imageRect.y) * cssScale,
      width: w * cssScale,
      height: h * cssScale,
    };
  }
  return (
    <div
      className="edit-image-crop-overlay"
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e): void => {
        onPointerUp(e);
      }}
    >
      {marqueeStyle !== null && <div className="edit-image-crop-marquee" style={marqueeStyle} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helper: bytes -> object URL (memoized per placement so the same
// placement doesn't churn through createObjectURL on every render).
//
// The URL is valid until the placement is removed (the GC will
// reclaim it then). createObjectURL leaks otherwise — the test
// suite would surface this as a growing `URL.createObjectURL` call
// count. We use a module-level cache keyed by the bytes' identity
// (we never have two distinct placements with the same bytes in
// practice; even if we did, reusing the URL is safe).

const urlCache = new WeakMap<Uint8Array, string>();

function bytesToObjectURL(bytes: Uint8Array, format: "png" | "jpeg"): string {
  const existing = urlCache.get(bytes);
  if (existing !== undefined) return existing;
  const blob = new Blob([bytes.slice().buffer as ArrayBuffer], {
    type: format === "png" ? "image/png" : "image/jpeg",
  });
  const url = URL.createObjectURL(blob);
  urlCache.set(bytes, url);
  return url;
}
