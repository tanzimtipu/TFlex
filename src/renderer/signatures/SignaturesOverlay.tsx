// Per-page signature placement overlay.
//
// Renders every SignaturePlacement for the page and hosts the move /
// resize / delete interactions:
//   - Click anywhere inside a placement (not on a handle) -> select it
//     so the resize handles appear and Delete-key removes it.
//   - Drag the body -> move (calls engine.moveSignature on pointerup).
//   - Drag a corner handle -> resize.
//   - Delete key when a placement is selected -> engine.deleteSignature.
//
// While the Sign tool is active in the toolbar, the overlay also shows a
// ghost placement that follows the cursor and places a new signature on
// click (driven by the App-level signature manager modal selecting a
// saved signature and arming the tool).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import type {
  SavedSignature,
  SignaturePlacement,
} from "../../shared/types";
import {
  clampPlacementToPage,
  movePlacement,
  resizePlacement,
} from "./model";
import { DRAW_PEN_COLOR, DRAW_PEN_WIDTH } from "./canvas";

export type SignatureDragMode =
  | { kind: "move"; origin: { x: number; y: number }; startRect: SignaturePlacement["rect"] }
  | { kind: "resize"; origin: { x: number; y: number }; startRect: SignaturePlacement["rect"]; handle: "nw" | "ne" | "sw" | "se" };

interface SignaturesOverlayProps {
  page: number;
  pageWidthPt: number;
  pageHeightPt: number;
  cssScale: number;
  placements: SignaturePlacement[];
  /** Saved signatures keyed by id, so we can render the right raster. */
  signatures: Record<string, SavedSignature>;
  /** When set, a ghost placement follows the cursor and a click places
   *  a new signature (Sign tool). */
  armedSignatureId: string | null;
  onPlace: (sigId: string, rect: SignaturePlacement["rect"]) => void;
  onMove: (placementId: string, rect: SignaturePlacement["rect"]) => void;
  onDelete: (placementId: string) => void;
}

export function SignaturesOverlay(props: SignaturesOverlayProps): ReactElement | null {
  const {
    page,
    pageWidthPt,
    pageHeightPt,
    cssScale,
    placements,
    signatures,
    armedSignatureId,
    onPlace,
    onMove,
    onDelete,
  } = props;
  const pagePlacements = useMemo(
    () => placements.filter((p) => p.page === page),
    [placements, page],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const dragRef = useRef<SignatureDragMode | null>(null);

  // Drop the selection when the page changes — no point keeping a
  // selection across pages.
  useEffect(() => {
    setSelectedId(null);
  }, [page]);

  // Esc clears the selection; Delete removes it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (selectedId === null) return;
      if (e.key === "Escape") {
        setSelectedId(null);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        onDelete(selectedId);
        setSelectedId(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, onDelete]);

  const onPointerDownPlacement = useCallback(
    (
      e: React.PointerEvent<HTMLDivElement>,
      placement: SignaturePlacement,
      handle?: "nw" | "ne" | "sw" | "se",
    ): void => {
      e.stopPropagation();
      e.preventDefault();
      (e.target as Element).setPointerCapture(e.pointerId);
      setSelectedId(placement.id);
      dragRef.current = {
        kind: handle === undefined ? "move" : "resize",
        origin: { x: e.clientX, y: e.clientY },
        startRect: { ...placement.rect },
        ...(handle !== undefined ? { handle } : {}),
      } as SignatureDragMode;
    },
    [],
  );

  const onPointerMovePlacement = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      const drag = dragRef.current;
      if (drag === null) return;
      const dx = (e.clientX - drag.origin.x) / cssScale;
      const dy = (e.clientY - drag.origin.y) / cssScale;
      if (drag.kind === "move") {
        const next = movePlacement(drag.startRect, { x: dx, y: dy });
        // Live preview only — the engine sees the move on pointerup. We
        // mutate the local rect via a CSS transform so the user sees a
        // smooth drag, not a step per frame.
        const target = e.currentTarget;
        target.style.transform = `translate(${dx * cssScale}px, ${dy * cssScale}px)`;
        void next;
      } else {
        const next = resizePlacement(drag.startRect, drag.handle, { x: dx, y: dy });
        const target = e.currentTarget;
        target.style.width = `${next.width * cssScale}px`;
        target.style.height = `${next.height * cssScale}px`;
      }
    },
    [cssScale],
  );

  const onPointerUpPlacement = useCallback(
    (e: React.PointerEvent<HTMLDivElement>, placement: SignaturePlacement): void => {
      const drag = dragRef.current;
      if (drag === null) return;
      (e.target as Element).releasePointerCapture?.(e.pointerId);
      const dx = (e.clientX - drag.origin.x) / cssScale;
      const dy = (e.clientY - drag.origin.y) / cssScale;
      const target = e.currentTarget;
      target.style.transform = "";
      target.style.width = `${drag.startRect.width * cssScale}px`;
      target.style.height = `${drag.startRect.height * cssScale}px`;
      let nextRect: SignaturePlacement["rect"];
      if (drag.kind === "move") {
        nextRect = clampPlacementToPage(movePlacement(drag.startRect, { x: dx, y: dy }), pageWidthPt, pageHeightPt);
      } else {
        nextRect = clampPlacementToPage(resizePlacement(drag.startRect, drag.handle, { x: dx, y: dy }), pageWidthPt, pageHeightPt);
      }
      dragRef.current = null;
      onMove(placement.id, nextRect);
    },
    [cssScale, onMove, pageWidthPt, pageHeightPt],
  );

  const onGhostClick = useCallback(
    (e: React.PointerEvent<HTMLDivElement>): void => {
      if (armedSignatureId === null) return;
      // Translate the click into page points and place at a default
      // size anchored at that point.
      const root = e.currentTarget.getBoundingClientRect();
      const x = (e.clientX - root.left) / cssScale;
      const y = (e.clientY - root.top) / cssScale;
      const w = Math.min(180, pageWidthPt - x);
      const h = Math.min(48, pageHeightPt - y);
      const rect = clampPlacementToPage(
        { x, y, width: Math.max(w, 60), height: Math.max(h, 24) },
        pageWidthPt,
        pageHeightPt,
      );
      e.preventDefault();
      onPlace(armedSignatureId, rect);
    },
    [armedSignatureId, cssScale, onPlace, pageWidthPt, pageHeightPt],
  );

  const interactive = armedSignatureId !== null || pagePlacements.length > 0;

  return (
    <div
      className={interactive ? "signatures-layer signatures-layer-active" : "signatures-layer"}
      data-page={page}
      data-armed={armedSignatureId !== null ? "true" : "false"}
      onPointerDown={onGhostClick}
    >
      {pagePlacements.map((p) => {
        const sig = signatures[p.signatureId];
        return (
          <SignaturePlacementView
            key={p.id}
            placement={p}
            signature={sig}
            cssScale={cssScale}
            selected={selectedId === p.id}
            onPointerDown={(e, h): void => onPointerDownPlacement(e, p, h)}
            onPointerMove={onPointerMovePlacement}
            onPointerUp={(e): void => onPointerUpPlacement(e, p)}
            onSelect={(): void => setSelectedId(p.id)}
          />
        );
      })}
    </div>
  );
}

interface SignaturePlacementViewProps {
  placement: SignaturePlacement;
  signature: SavedSignature | undefined;
  cssScale: number;
  selected: boolean;
  onPointerDown: (e: React.PointerEvent<HTMLDivElement>, handle?: "nw" | "ne" | "sw" | "se") => void;
  onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => void;
  onSelect: () => void;
}

function SignaturePlacementView(props: SignaturePlacementViewProps): ReactElement | null {
  const { placement, signature, cssScale, selected, onPointerDown, onPointerMove, onPointerUp, onSelect } = props;
  const style: CSSProperties = {
    position: "absolute",
    left: placement.rect.x * cssScale,
    top: placement.rect.y * cssScale,
    width: placement.rect.width * cssScale,
    height: placement.rect.height * cssScale,
    pointerEvents: "auto",
  };
  if (signature === undefined) return null;
  return (
    <div
      className={selected ? "sig-placement sig-placement-selected" : "sig-placement"}
      data-placement-id={placement.id}
      data-signature-id={placement.signatureId}
      style={style}
      onPointerDown={(e): void => {
        e.stopPropagation();
        onSelect();
        onPointerDown(e);
      }}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <SignatureRaster signature={signature} rect={placement.rect} cssScale={cssScale} />
      {selected && (
        <>
          <div className="sig-handle sig-handle-nw" data-handle="nw" onPointerDown={(e) => onPointerDown(e, "nw")} />
          <div className="sig-handle sig-handle-ne" data-handle="ne" onPointerDown={(e) => onPointerDown(e, "ne")} />
          <div className="sig-handle sig-handle-sw" data-handle="sw" onPointerDown={(e) => onPointerDown(e, "sw")} />
          <div className="sig-handle sig-handle-se" data-handle="se" onPointerDown={(e) => onPointerDown(e, "se")} />
        </>
      )}
    </div>
  );
}

// Render the signature's vector source into a fitted <svg>. Drawn sigs
// use polyline points; typed sigs are rendered as a <text> at a fitted
// script-style font. We deliberately avoid canvas here so the SVG is
// DPI-independent and pixel-crisp at any zoom.
function SignatureRaster({
  signature,
  rect,
  cssScale,
}: {
  signature: SavedSignature;
  rect: SignaturePlacement["rect"];
  cssScale: number;
}): ReactElement {
  const svgW = rect.width;
  const svgH = rect.height;
  const source = signature.source;
  if (source.kind === "drawn") {
    const sx = svgW / source.width;
    const sy = svgH / source.height;
    return (
      <svg
        className="sig-raster"
        viewBox={`0 0 ${svgW} ${svgH}`}
        width={svgW * cssScale}
        height={svgH * cssScale}
        aria-hidden
      >
        {source.points.map((stroke, i) => {
          if (stroke.length === 0) return null;
          const d = stroke
            .map((p, idx) => `${idx === 0 ? "M" : "L"} ${(p.x * sx).toFixed(2)} ${(p.y * sy).toFixed(2)}`)
            .join(" ");
          return (
            <path
              key={i}
              d={d}
              fill="none"
              stroke={DRAW_PEN_COLOR}
              strokeWidth={DRAW_PEN_WIDTH / Math.min(sx, sy)}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}
      </svg>
    );
  }
  // Typed signature — render as a fitted <text>. The engine persisted the
  // rendered width/height as a bbox; the renderer scales the font so the
  // text fits the placement rect with a small inset.
  const padding = 4;
  const targetW = svgW - padding * 2;
  const targetH = svgH - padding * 2;
  // Source was rendered at source.width × source.height. We chose a font
  // size that approximately fills that box, so scale accordingly.
  const fontSize = Math.min(targetH, (targetW / Math.max(source.text.length * 0.55, 1)));
  const text = source.text;
  return (
    <svg
      className="sig-raster"
      viewBox={`0 0 ${svgW} ${svgH}`}
      width={svgW * cssScale}
      height={svgH * cssScale}
      aria-hidden
    >
      <text
        x={padding}
        y={svgH - padding}
        fontFamily="'Brush Script MT', 'Lucida Handwriting', 'Apple Chancery', cursive"
        fontSize={fontSize}
        fontStyle="italic"
        fill={DRAW_PEN_COLOR}
      >
        {text}
      </text>
    </svg>
  );
}
