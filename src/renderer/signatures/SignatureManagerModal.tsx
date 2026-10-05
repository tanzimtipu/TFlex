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
//
// Phase 20 — the three tab bodies have three different heights, so a tab
// switch is an animated context-window resize: `TfResize` measures the
// incoming pane and tweens the modal body's real height over the standard
// layout token, while the outgoing pane cross-fades into the incoming one
// (SigTabPane). Reduced motion keeps the same structure with a
// zero-duration swap.

import { Icon } from "../icons/Icon";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { DialogShell } from "../components/DialogShell";
import { TfResize, paneSwapFor } from "../components/motion/TfResize";
import { useLiveReducedMotion, useInstantMotion } from "../hooks/useAnimations";
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
  /** Phase 51 (item 2) — fired after a saved signature is added or deleted so
   *  the host can request an automatic sync. The modal owns no account state;
   *  the host decides whether a session is live. */
  onSignaturesChanged?: () => void;
}

export function SignatureManagerModal(props: SignatureManagerModalProps): ReactElement | null {
  const { open, onClose, onApply, savedSignatures, onToast, onSignaturesChanged } = props;
  const [tab, setTab] = useState<Tab>("draw");
  const [saved, setSaved] = useState<SavedSignature[]>(savedSignatures);

  // Resync the local list when the host's mirror changes (e.g. another
  // modal opened, signed, closed — we want this modal to see the new
  // entry without re-fetching).
  useEffect(() => {
    setSaved(savedSignatures);
  }, [savedSignatures]);

  const onPick = (id: string): void => {
    onApply(id);
    onClose();
  };

  const onDelete = async (id: string): Promise<void> => {
    const next = await getSignatureService().delete(id);
    setSaved(next);
    // Phase 51 (item 2) — a signature delete is an automatic sync trigger.
    onSignaturesChanged?.();
  };

  const footer = (
    <div className="modal-footer">
      <span className="modal-help-inline">
        Signatures are saved locally and can be reused on any page.
      </span>
      <button type="button" className="btn btn-secondary" onClick={onClose}>
        Close
      </button>
    </div>
  );

  return (
    <DialogShell
      open={open}
      title="Signature"
      titleId="sig-modal-title"
      className="sig-manager"
      onClose={onClose}
      footer={footer}
    >
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
      <TfResize className="sig-tab-stack" axes="height">
        <AnimatePresence initial={false}>
          {tab === "draw" && (
            <SigTabPane key="draw">
              <DrawTab
                onToast={onToast}
                onSaved={(next): void => {
                  // DEF-143 — adopt the service's returned list verbatim.
                  // `save` returns the FULL persisted list (the main
                  // service appends, the stub prepends), so the Saved tab
                  // renders exactly what was saved — never a stale
                  // duplicate of an earlier signature — and the count
                  // badge stays in sync with the rendered rows.
                  setSaved(next);
                  setTab("saved");
                  // Phase 51 (item 2) — a signature add is an automatic sync trigger.
                  onSignaturesChanged?.();
                }}
              />
            </SigTabPane>
          )}
          {tab === "type" && (
            <SigTabPane key="type">
              <TypeTab
                onToast={onToast}
                onSaved={(next): void => {
                  setSaved(next);
                  setTab("saved");
                  // Phase 51 (item 2) — a signature add is an automatic sync trigger.
                  onSignaturesChanged?.();
                }}
              />
            </SigTabPane>
          )}
          {tab === "saved" && (
            <SigTabPane key="saved">
              <SavedTab
                saved={saved}
                onPick={onPick}
                onDelete={onDelete}
              />
            </SigTabPane>
          )}
        </AnimatePresence>
      </TfResize>
    </DialogShell>
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

/**
 * Phase 20 — one tab body inside the modal's animated-size frame.
 *
 * The outgoing pane keeps its OWN element (a half-finished draw canvas or
 * typed name survives the swap, and no copy of it is ever mounted), and is
 * popped out of flow (`[data-tf-pane="out"]` in styles.css) while it
 * cross-fades away. Being out of flow, it contributes nothing to the
 * frame's measurement, so the animated target is always the INCOMING pane's
 * height — one size tween, never a two-step hop through the taller of the
 * two.
 */
function SigTabPane({ children }: { children: React.ReactNode }): ReactElement {
  const reduced = useLiveReducedMotion();
  // Phase 23 — the pane swap is instant when Animations is OFF too.
  const instant = useInstantMotion(reduced);
  const isPresent = useIsPresent();
  const swap = paneSwapFor(instant);
  return (
    <motion.div
      className="sig-tab-pane"
      data-tf-pane={isPresent ? "in" : "out"}
      initial={swap.initial}
      animate={swap.animate}
      exit={swap.exit}
    >
      {children}
    </motion.div>
  );
}

// ---- Draw tab ------------------------------------------------------------

function DrawTab({
  onSaved,
  onToast,
}: {
  /** DEF-143 — the updated FULL saved-signature list returned by
   *  `SignatureService.save`. The parent adopts it verbatim. */
  onSaved: (next: SavedSignature[]) => void;
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
      onSaved(next);
      onClear();
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
  /** DEF-143 — the updated FULL saved-signature list returned by
   *  `SignatureService.save`. The parent adopts it verbatim. */
  onSaved: (next: SavedSignature[]) => void;
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
      onSaved(next);
      setText("");
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
        <Icon name="sign" size="lg" />
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
            <Icon name="delete" size="sm" />
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