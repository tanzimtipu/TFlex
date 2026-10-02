// Phase 84 (True redaction) — renderer surface, first slice.
//
// A minimal, self-contained overlay that owns the PENDING redaction marks
// and commits them through `engine.applyRedactions`. Region drag, the
// configurable mark colour, the unsupported-affordance surface and the
// engine-client wiring live here; text mode is the NEXT continuation on
// this issue. This slice proves the layer + pending-mark lifecycle
// (clear / one-step undo / apply), the colour persistence hook and the
// stub apply path so the rest can build on a tested base.
//
// Cross-bubbling rule: the layer is a plain container; every verb is a
// real <button>. Nothing calls preventDefault/stopPropagation here.
import { useCallback, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, ReactElement } from "react";
import type {
  AnnRect,
  ApplyRedactionsPayload,
  EngineError,
  RedactionApplyResult,
} from "../../shared/types";
import type { Result } from "../../shared/result";
import type { PagePoint } from "../annotations/model";
import type { TextItemGeom } from "../annotations/geometry";
import {
  clientToPagePoint,
  dragMeetsMinimum,
  normalizeDragRect,
  overlayRectToCss,
  textItemQuads,
} from "../annotations/geometry";
import { stubRendererEngine } from "../engine/stubEngine";

/** A mark the user has drawn but not yet committed. `page` is 1-based
 *  VISIBLE page; `rect` is page points with a TOP-LEFT origin. */
export interface PendingRedactionMark {
  page: number;
  rect: AnnRect;
}

export interface RedactionOverlayProps {
  /** Active document id; defaults to the stub tab id used in tests. */
  docId?: string;
  /** Seed pending marks (tests / a future region-drag slice). */
  initialMarks?: readonly PendingRedactionMark[];
  /** Apply hook; defaults to the stub engine's `applyRedactions`. */
  applyRedactions?: ApplyRedactions;
  /** Notified after each page's apply succeeds. */
  onApplied?: (result: RedactionApplyResult) => void;
  /** 1-based VISIBLE page this overlay is mounted on. A drag appends a
   *  pending mark for this page. Defaults to 1. */
  page?: number;
  /** Page size in points, used for clamping / future placement. */
  pageWidthPt?: number;
  pageHeightPt?: number;
  /** CSS scale of the page wrapper (client px per page point). */
  cssScale?: number;
  /** The Redact tool is armed: the layer captures region drags and
   *  exposes `data-redact-tool`. Defaults to false (controls only). */
  armed?: boolean;
  /** Fill colour for pending marks and the colour sent with the apply
   *  call. A six-digit hex; defaults to opaque black. */
  markColor?: string;
  /** The host persists the chosen mark colour (settings round-trip). */
  onMarkColorChange?: (hex: string) => void;
  /** Page text items for text marking mode. Returns the current page's
   *  text geometry; text mode marks one rect per covered line. */
  getTextItems?: () => readonly TextItemGeom[];
}

/** The bounded swatch set for the mark colour control. */
export const REDACT_MARK_COLORS: readonly string[] = [
  "#000000",
  "#d21f3c",
  "#1f6feb",
];

/** The apply hook shape threaded from the host / page wrapper. */
export type ApplyRedactions = (
  docId: string,
  payload: ApplyRedactionsPayload,
) => Promise<Result<RedactionApplyResult, EngineError>>;

export function RedactionOverlay({
  docId = "stub",
  initialMarks = [],
  applyRedactions,
  onApplied,
  page = 1,
  pageWidthPt = 0,
  pageHeightPt = 0,
  cssScale = 1,
  armed = false,
  markColor = "#000000",
  onMarkColorChange,
  getTextItems,
}: RedactionOverlayProps): ReactElement {
  const [marks, setMarks] = useState<PendingRedactionMark[]>(() => [...initialMarks]);
  const [mode, setMode] = useState<"region" | "text">("region");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const startRef = useRef<PagePoint | null>(null);
  const [draft, setDraft] = useState<AnnRect | null>(null);

  const apply = useMemo(
    () =>
      applyRedactions ??
      ((id: string, payload: ApplyRedactionsPayload) =>
        stubRendererEngine.applyRedactions(id, payload)),
    [applyRedactions],
  );

  const clear = useCallback((): void => {
    setMarks([]);
    setWarnings([]);
    setError(null);
  }, []);

  const undo = useCallback((): void => {
    setMarks((prev) => prev.slice(0, -1));
    setError(null);
  }, []);

  const commit = useCallback(async (): Promise<void> => {
    if (marks.length === 0) return;
    setBusy(true);
    setError(null);
    const byPage = new Map<number, AnnRect[]>();
    for (const mark of marks) {
      const rects = byPage.get(mark.page) ?? [];
      rects.push(mark.rect);
      byPage.set(mark.page, rects);
    }
    const allWarnings: string[] = [];
    try {
      for (const [page, rects] of byPage) {
        const result = await apply(docId, {
          page,
          marks: rects.map((rect) => ({ rect })),
          color: markColor,
        });
        if (!result.ok) {
          setError(result.error.message);
          return;
        }
        allWarnings.push(...result.value.warnings);
        onApplied?.(result.value);
      }
      setWarnings(allWarnings);
      setMarks([]);
    } finally {
      setBusy(false);
    }
  }, [marks, apply, docId, onApplied, markColor]);

  const pointFromEvent = useCallback(
    (clientX: number, clientY: number): PagePoint | null => {
      const layer = layerRef.current;
      if (layer === null) return null;
      const rect = layer.getBoundingClientRect();
      return clientToPagePoint(clientX, clientY, rect, cssScale);
    },
    [cssScale],
  );

  const clampRect = useCallback(
    (r: AnnRect): AnnRect => {
      if (pageWidthPt <= 0 || pageHeightPt <= 0) return r;
      const x = Math.max(0, Math.min(r.x, pageWidthPt));
      const y = Math.max(0, Math.min(r.y, pageHeightPt));
      const width = Math.max(0, Math.min(r.width, pageWidthPt - x));
      const height = Math.max(0, Math.min(r.height, pageHeightPt - y));
      return { x, y, width, height };
    },
    [pageWidthPt, pageHeightPt],
  );

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      if (!armed) return;
      if ((e.target as HTMLElement).closest("button") !== null) return;
      const p = pointFromEvent(e.clientX, e.clientY);
      if (p === null) return;
      startRef.current = p;
      setDraft({ x: p.x, y: p.y, width: 0, height: 0 });
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    [armed, pointFromEvent],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      const start = startRef.current;
      if (start === null) return;
      const p = pointFromEvent(e.clientX, e.clientY);
      if (p === null) return;
      setDraft(clampRect(normalizeDragRect(start, p)));
    },
    [clampRect, pointFromEvent],
  );

  const onPointerUp = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>): void => {
      const start = startRef.current;
      startRef.current = null;
      if (start === null) return;
      const p = pointFromEvent(e.clientX, e.clientY);
      setDraft(null);
      if (p === null) return;
      if (!dragMeetsMinimum(start, p)) return;
      if (mode === "text") {
        const quads = textItemQuads(getTextItems?.() ?? [], start, p);
        setMarks((prev) => [...prev, ...quads.map((rect) => ({ page, rect: clampRect(rect) }))]);
      } else {
        setMarks((prev) => [...prev, { page, rect: clampRect(normalizeDragRect(start, p)) }]);
      }
    },
    [clampRect, page, pointFromEvent, mode, getTextItems],
  );

  const draftBox = draft === null ? null : overlayRectToCss(draft, cssScale);

  return (
    <div
      ref={layerRef}
      data-redact-layer
      data-redact-mode={mode}
      data-redact-tool={armed ? "" : undefined}
      className="redact-layer"
      aria-label="Redaction"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div data-redact-marks className="redact-marks">
        {marks.map((mark, index) => {
          const box = overlayRectToCss(mark.rect, cssScale);
          return (
            <div
              key={`${mark.page}-${index}`}
              data-redact-mark
              data-page={mark.page}
              className="redact-mark"
              style={{
                position: "absolute",
                left: box.left,
                top: box.top,
                width: box.width,
                height: box.height,
                background: markColor,
              }}
            />
          );
        })}
        {draftBox !== null && (
          <div
            data-redact-draft
            className="redact-draft"
            style={{
              position: "absolute",
              left: draftBox.left,
              top: draftBox.top,
              width: draftBox.width,
              height: draftBox.height,
            }}
          />
        )}
      </div>
      <div className="redact-actions">
        <div className="redact-modes" role="group" aria-label="Marking mode">
          <button
            type="button"
            data-redact-mode
            data-mode="region"
            aria-pressed={mode === "region"}
            className="redact-mode"
            onClick={() => setMode("region")}
          >
            Region
          </button>
          <button
            type="button"
            data-redact-mode
            data-mode="text"
            aria-pressed={mode === "text"}
            className="redact-mode"
            onClick={() => setMode("text")}
          >
            Text
          </button>
        </div>
        <div className="redact-swatches" role="group" aria-label="Mark colour">
          {REDACT_MARK_COLORS.map((hex) => (
            <button
              key={hex}
              type="button"
              data-redact-swatch
              data-color={hex}
              aria-label={`Mark colour ${hex}`}
              aria-pressed={markColor === hex}
              className="redact-swatch"
              style={{ background: hex }}
              onClick={() => onMarkColorChange?.(hex)}
            />
          ))}
        </div>
        <button
          type="button"
          data-redact-clear
          onClick={clear}
          disabled={marks.length === 0 && warnings.length === 0 && error === null}
        >
          Clear
        </button>
        <button type="button" data-redact-undo onClick={undo} disabled={marks.length === 0}>
          Undo
        </button>
        <button
          type="button"
          data-redact-apply
          onClick={() => void commit()}
          disabled={marks.length === 0 || busy}
        >
          Apply redactions
        </button>
        <button
          type="button"
          data-redact-unsupported
          disabled
          title="Removing images and vector objects is not supported in this version."
        >
          Remove images/vector (unsupported)
        </button>
      </div>
      {error !== null ? (
        <div data-redact-warning role="alert" className="redact-error">
          {error}
        </div>
      ) : warnings.length > 0 ? (
        <div data-redact-warning role="status" className="redact-warning">
          {warnings.join(" ")}
        </div>
      ) : null}
    </div>
  );
}