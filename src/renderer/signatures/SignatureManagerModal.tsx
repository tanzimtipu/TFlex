// Signature manager modal.
//
// Three tabs:
//   Draw   — pointer-canvas capture, freehand strokes (polyline list).
//            "Clear" resets the canvas; "Save" persists the strokes as
//            a saved signature and switches to the Saved tab.
//   Type   — single-line text input. The canvas previews the rendered
//            signature at a script-style font. "Save" persists.
//   Saved  — the user's saved-signature list, click a row to "arm" the
//            signature for placement: the toolbar's Sign tool stays
//            active, the next click on a page places the signature
//            there. Each row also has a Delete button.
//
// The modal is controlled: parent flips `open` and reads `onApply` /
// `onClose` to drive the rest of the UI. The modal itself owns local
// state for the draw canvas + type input so a half-finished signature
// survives a tab switch without leaving the modal.

import { Check, Eraser, FileSignature, Trash2 } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import type { SavedSignature, SignatureSource } from "../../shared/types";
import {
  DRAW_CANVAS_H,
  DRAW_CANVAS_W,
  DRAW_PEN_COLOR,
  DRAW_PEN_WIDTH,
  DRAW_SAMPLE_RADIUS,
  TYPED_CANVAS_H,
  TYPED_CANVAS_W,
  renderTypedSignature,
  type DrawStroke,
} from "./canvas";
import { getSignatureService } from "./service";
import { defaultSignatureLabel, signatureIsEmpty, signatureLabel } from "./model";

type Tab = "draw" | "type" | "saved";

interface SignatureManagerModalProps {
  open: boolean;
  onClose: () => void;
  /** Called when the user picks a saved signature to arm for placement.
   *  The host flips the toolbar's Sign tool on; the next click on a
   *  page places the signature there. */
  onApply: (signatureId: string) => void;
  /** Already-saved signatures (so the modal can pre-populate the Saved
   *  tab without waiting for the IPC round-trip). */
  savedSignatures: SavedSignature[];
  /** Push a toast (error/info) on edge cases (empty canvas, save
   *  failure). */
  onToast?: (kind: "error" | "info", text: string) => void;
}

export function SignatureManagerModal(props: SignatureManagerModalProps): ReactElement | null {
  const { open, onClose, onApply, savedSignatures, onToast } = props;
  const [tab, setTab] = useState<Tab>("draw");
  const [saved, setSaved] = useState<SavedSignature[]>(savedSignatures);

  // Resync the local list when the host's mirror changes (e.g. another
  // modal opened, signed, closed — we want this modal to see the new
  // entry without re-fetching).
  useEffect(() => {
    setSaved(savedSignatures);
  }, [savedSignatures]);

  if (!open) return null;

  const closeOnBackdrop = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (e.target === e.currentTarget) onClose();
  };

  const onPick = (id: string): void => {
    onApply(id);
    onClose();
  };

  const onDelete = async (id: string): Promise<void> => {
    const next = await getSignatureService().delete(id);
    setSaved(next);
  };

  return (
    <div className="modal-backdrop" onClick={closeOnBackdrop}>
      <div
        className="modal-dialog sig-manager"
        role="dialog"
        aria-modal="true"
        aria-labelledby="sig-modal-title"
      >
        <div className="modal-header">
          <h2 id="sig-modal-title" className="modal-title">
            Signature
          </h2>
          <button
            type="button"
            className="modal-close"
            onClick={onClose}
            aria-label="Close dialog"
          >
            <span aria-hidden style={{ fontSize: 14 }}>{"\u2715"}</span>
          </button>
        </div>
        <div className="modal-tabs">
          <TabButton active={tab === "draw"} onClick={(): void => setTab("draw")}>
            Draw
          </TabButton>
          <TabButton active={tab === "type"} onClick={(): void => setTab("type")}>
            Type
          </TabButton>
          <TabButton active={tab === "saved"} onClick={(): void => setTab("saved")}>
            Saved ({saved.length})
          </TabButton>
        </div>
        <div className="modal-body">
          {tab === "draw" && (
            <DrawTab
              onToast={onToast}
              onSaved={(sig): void => {
                setSaved([sig, ...saved]);
                setTab("saved");
              }}
            />
          )}
          {tab === "type" && (
            <TypeTab
              onToast={onToast}
              onSaved={(sig): void => {
                setSaved([sig, ...saved]);
                setTab("saved");
              }}
            />
          )}
          {tab === "saved" && (
            <SavedTab
              saved={saved}
              onPick={onPick}
              onDelete={onDelete}
            />
          )}
        </div>
        <div className="modal-footer">
          <span className="modal-help-inline">
            Signatures are saved locally and can be reused on any page.
          </span>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): ReactElement {
  return (
    <button
      type="button"
      className={active ? "sig-tab sig-tab-active" : "sig-tab"}
      onClick={onClick}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

// ---- Draw tab ------------------------------------------------------------

function DrawTab({
  onSaved,
  onToast,
}: {
  onSaved: (sig: SavedSignature) => void;
  onToast?: (kind: "error" | "info", text: string) => void;
}): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const strokesRef = useRef<DrawStroke[]>([]);
  const currentRef = useRef<DrawStroke | null>(null);
  const [hasStrokes, setHasStrokes] = useState(false);
  const [saving, setSaving] = useState(false);

  // Resize the canvas's backing bitmap to match its CSS size for
  // crisp 1:1 rendering at typical DPI.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    canvas.width = DRAW_CANVAS_W;
    canvas.height = DRAW_CANVAS_H;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, DRAW_CANVAS_W, DRAW_CANVAS_H);
  }, []);

  const repaint = useCallback((): void => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.strokeStyle = DRAW_PEN_COLOR;
    ctx.lineWidth = DRAW_PEN_WIDTH;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const stroke of strokesRef.current) {
      if (stroke.points.length === 0) continue;
      ctx.beginPath();
      const [first, ...rest] = stroke.points;
      ctx.moveTo(first.x, first.y);
      for (const p of rest) ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    if (currentRef.current !== null) {
      const stroke = currentRef.current;
      if (stroke.points.length > 0) {
        ctx.beginPath();
        const [first, ...rest] = stroke.points;
        ctx.moveTo(first.x, first.y);
        for (const p of rest) ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }
    }
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    currentRef.current = { points: [{ x, y }] };
    e.currentTarget.setPointerCapture(e.pointerId);
    setHasStrokes(true);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const cur = currentRef.current;
    if (cur === null) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const last = cur.points[cur.points.length - 1];
    if (Math.hypot(x - last.x, y - last.y) < DRAW_SAMPLE_RADIUS) return;
    cur.points.push({ x, y });
    repaint();
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const cur = currentRef.current;
    if (cur === null) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (cur.points.length > 0) {
      strokesRef.current.push(cur);
    }
    currentRef.current = null;
    setHasStrokes(true);
    repaint();
  };

  const onClear = (): void => {
    strokesRef.current = [];
    currentRef.current = null;
    setHasStrokes(false);
    repaint();
  };

  const onSave = async (): Promise<void> => {
    const strokes = strokesRef.current.slice();
    const points = strokes.map((s) => s.points.slice());
    if (points.every((p) => p.length === 0)) {
      onToast?.("error", "Draw a signature first.");
      return;
    }
    setSaving(true);
    try {
      const source: SignatureSource = {
        kind: "drawn",
        points,
        width: DRAW_CANVAS_W,
        height: DRAW_CANVAS_H,
      };
      const next = await getSignatureService().save(source);
      const sig = next[0];
      if (sig !== undefined) {
        onSaved(sig);
        onClear();
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="sig-tab-body">
      <p className="modal-help">
        Sign in the canvas below with your pointer. Drag for a smooth
        stroke; release to commit.
      </p>
      <canvas
        ref={canvasRef}
        className="sig-canvas"
        width={DRAW_CANVAS_W}
        height={DRAW_CANVAS_H}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        aria-label="Draw your signature"
      />
      <div className="sig-tab-actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={onClear}
          disabled={!hasStrokes || saving}
        >
          <Eraser size={14} aria-hidden />
          Clear
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={(): void => {
            void onSave();
          }}
          disabled={!hasStrokes || saving}
        >
          <Check size={14} aria-hidden />
          {saving ? "Saving\u2026" : "Save"}
        </button>
      </div>
    </div>
  );
}

// ---- Type tab ------------------------------------------------------------

function TypeTab({
  onSaved,
  onToast,
}: {
  onSaved: (sig: SavedSignature) => void;
  onToast?: (kind: "error" | "info", text: string) => void;
}): ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const fontSize = 64;
  const fontFamily = "'Brush Script MT', 'Lucida Handwriting', 'Apple Chancery', cursive";

  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    canvas.width = TYPED_CANVAS_W;
    canvas.height = TYPED_CANVAS_H;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, TYPED_CANVAS_W, TYPED_CANVAS_H);
    if (text.trim().length > 0) {
      const bbox = renderTypedSignature(ctx, text, fontFamily, fontSize, TYPED_CANVAS_W, TYPED_CANVAS_H);
      // Use the bbox as the canonical "source" width / height so the
      // placement overlay scales the raster to the placement rect without
      // including blank margins.
      canvas.dataset.sourceWidth = String(bbox.width);
      canvas.dataset.sourceHeight = String(bbox.height);
    }
  }, [text, fontSize, fontFamily]);

  const onSave = async (): Promise<void> => {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      onToast?.("error", "Type your name first.");
      return;
    }
    setSaving(true);
    try {
      const source: SignatureSource = {
        kind: "typed",
        text: trimmed,
        width: TYPED_CANVAS_W,
        height: TYPED_CANVAS_H,
      };
      const next = await getSignatureService().save(source, trimmed);
      const sig = next[0];
      if (sig !== undefined) {
        onSaved(sig);
        setText("");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="sig-tab-body">
      <p className="modal-help">
        Type your name. We'll render it as a script-style signature for
        you to place on the page.
      </p>
      <input
        type="text"
        className="modal-input sig-type-input"
        placeholder="Type your name"
        value={text}
        onChange={(e): void => setText(e.target.value)}
        autoFocus
        aria-label="Type your signature"
      />
      <canvas
        ref={canvasRef}
        className="sig-canvas sig-typed-canvas"
        width={TYPED_CANVAS_W}
        height={TYPED_CANVAS_H}
        aria-label="Signature preview"
      />
      <div className="sig-tab-actions">
        <button
          type="button"
          className="btn btn-secondary"
          onClick={(): void => setText("")}
          disabled={text.length === 0 || saving}
        >
          <Eraser size={14} aria-hidden />
          Clear
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={(): void => {
            void onSave();
          }}
          disabled={text.trim().length === 0 || saving}
        >
          <Check size={14} aria-hidden />
          {saving ? "Saving\u2026" : "Save"}
        </button>
      </div>
    </div>
  );
}

// ---- Saved tab -----------------------------------------------------------

function SavedTab({
  saved,
  onPick,
  onDelete,
}: {
  saved: SavedSignature[];
  onPick: (id: string) => void;
  onDelete: (id: string) => Promise<void>;
}): ReactElement {
  if (saved.length === 0) {
    return (
      <div className="sig-empty">
        <FileSignature size={20} aria-hidden />
        <p>No saved signatures yet.</p>
        <p className="hint">
          Draw or type a signature in the other tabs, then Save it. Saved
          signatures can be reused on any page without redrawing.
        </p>
      </div>
    );
  }
  return (
    <ul className="sig-saved-list">
      {saved.map((sig) => (
        <li key={sig.id} className="sig-saved-row">
          <button
            type="button"
            className="sig-saved-pick"
            onClick={(): void => onPick(sig.id)}
            disabled={signatureIsEmpty(sig)}
          >
            <SavedThumbnail signature={sig} />
            <span className="sig-saved-label">{signatureLabel(sig)}</span>
          </button>
          <button
            type="button"
            className="sig-saved-delete"
            onClick={(): void => {
              void onDelete(sig.id);
            }}
            aria-label={`Delete ${signatureLabel(sig)}`}
            title="Delete"
          >
            <Trash2 size={14} aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  );
}

function SavedThumbnail({ signature }: { signature: SavedSignature }): ReactElement {
  const w = 120;
  const h = 40;
  const source = signature.source;
  if (source.kind === "drawn") {
    const sx = w / source.width;
    const sy = h / source.height;
    return (
      <svg
        className="sig-thumb"
        viewBox={`0 0 ${w} ${h}`}
        width={w}
        height={h}
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
              strokeWidth={1.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          );
        })}
      </svg>
    );
  }
  return (
    <svg className="sig-thumb" viewBox={`0 0 ${w} ${h}`} width={w} height={h} aria-hidden>
      <text
        x={6}
        y={h - 8}
        fontFamily="'Brush Script MT', 'Lucida Handwriting', 'Apple Chancery', cursive"
        fontSize={28}
        fontStyle="italic"
        fill={DRAW_PEN_COLOR}
      >
        {source.text.slice(0, 14)}
      </text>
    </svg>
  );
}

// Re-export so the parent can pull a label without depending on the model.
export { defaultSignatureLabel };