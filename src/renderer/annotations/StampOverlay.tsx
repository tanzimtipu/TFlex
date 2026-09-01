// B10 — Stamp ghost overlay. Renders a translucent preview of the
// armed stamp that follows the cursor on every page; clicking the
// page embeds the stamp at the click point.
//
// The overlay is a sibling of the existing signature / annotation
// overlays, sitting at the same z-index so the layer can coexist
// with the signatures overlay without one swallowing the other's
// clicks. The overlay is mounted only while `armedStamp` is
// non-null — when no stamp is armed it returns null so the per-
// page render cost is exactly zero.
//
// Pointer events:
//   - pointermove updates the ghost's `pt` so it tracks the cursor.
//   - pointerdown on the page (or on the ghost itself) places the
//     stamp at the cursor's page-space point. We let the page-bound
//     handler catch the click rather than the ghost itself, so the
//     user can drop a stamp anywhere on the page including over
//     other overlays (signatures, annotations) — the ghost just
//     previews the location.

import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import type { StampId } from "../../shared/types";

export interface ArmedStamp {
  stampId: StampId;
  pngBytes: Uint8Array;
  pngWidth: number;
  pngHeight: number;
}

export interface StampOverlayProps {
  page: number;
  pageWidthPt: number;
  pageHeightPt: number;
  cssScale: number;
  /** The active tab's `activePageSizes` map. Used to size the
   *  ghost so the preview matches the size of the stamp that
   *  would actually be embedded (the engine sizes the stamp
   *  by `min(80pt, 0.12 * pageHeight)` for height, etc.). */
  pageSize?: { widthPt: number; heightPt: number };
  armed: ArmedStamp | null;
  onPlace: (args: ArmedStamp & { page: number; atPt: { x: number; y: number } }) => void;
}

interface PagePoint { x: number; y: number; }

export function StampOverlay(props: StampOverlayProps): ReactElement | null {
  const { page, pageWidthPt, pageHeightPt, cssScale, pageSize, armed, onPlace } = props;
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [pt, setPt] = useState<PagePoint | null>(null);
  // The dialog is "armed" for as long as `armed` is non-null. The
  // effect below installs a window-level pointermove listener so
  // the ghost follows the cursor even when it briefly moves off
  // the page canvas (over the rail, the toolbar, etc.). The ghost
  // stays anchored to its last on-page position in that case so
  // the preview doesn't snap to (0, 0) when the cursor exits.

  // Compute the ghost size the same way `onPlaceStamp` in App.tsx
  // does, so the preview is exactly the size of the embedded
  // stamp. Falls back to the page size if the host hasn't seeded
  // `activePageSizes` yet (lazy seed on dialog open).
  const size = pageSize ?? { widthPt: pageWidthPt, heightPt: pageHeightPt };
  const aspect = armed?.pngHeight === 0 || armed === null ? 1 : armed.pngWidth / armed.pngHeight;
  const targetHeightPt = Math.min(80, size.heightPt * 0.12);
  const targetWidthPt = Math.max(
    120,
    Math.min(size.widthPt * 0.4, targetHeightPt * aspect),
  );

  useEffect(() => {
    if (armed === null) {
      setPt(null);
      return;
    }
    const layer = layerRef.current;
    if (layer === null) return;
    const onMove = (e: PointerEvent): void => {
      const rect = layer.getBoundingClientRect();
      const x = (e.clientX - rect.left) / cssScale;
      const y = (e.clientY - rect.top) / cssScale;
      // Only update the ghost when the cursor is inside the page
      // bounds; otherwise we keep the last on-page position so the
      // preview doesn't snap to (0,0) when the cursor moves over a
      // sibling panel.
      if (
        x < 0 ||
        y < 0 ||
        x > pageWidthPt ||
        y > pageHeightPt
      ) {
        return;
      }
      setPt({ x, y });
    };
    // B10-followup — disarm logic. The previous implementation
    // listened on `pointerdown` capture and disarmed as soon as
    // a click landed outside the page bounds. That raced with the
    // host's click handlers: the React `onClick` on the theme
    // toggle / toolbar buttons needs the full pointerdown →
    // pointerup → click chain to fire. Disarming on `pointerdown`
    // re-rendered the React tree (armedStamp: non-null → null)
    // between pointerdown and click, which meant the click
    // element was either gone (component unmounted) or the React
    // synthetic click was suppressed — the user had to click
    // the theme toggle twice.
    //
    // Fix: route the disarm through the `click` event phase
    // (after pointerup, when the click is fully resolved), AND
    // only disarm when the click target is NOT an interactive
    // UI control. The previous inside-editor/action-bar guard
    // stays on the pointerdown handler (so clicking those still
    // suppresses the embed), but the disarm itself is deferred
    // to the click event so the host's own click handlers run
    // first.
    //
    // Two listeners:
    //   - onDown (pointerdown): suppress the embed if the target
    //     sits inside an editor / action bar; do NOT disarm.
    //   - onClick (click): place the stamp if the click is on
    //     the page; otherwise disarm (only when the target is not
    //     an interactive UI control — so toolbar buttons receive
    //     their click handler before we tear down the arming).
    const isInteractive = (target: EventTarget | null): boolean => {
      if (target === null) return false;
      if (!(target instanceof Element)) return false;
      const t = target as Element & {
        closest?: (sel: string) => Element | null;
      };
      if (typeof t.closest !== "function") return false;
      return (
        t.closest(
          ".ann-editor, .sig-action-bar, .ann-textbox-wrap, .ann-note-editor, button, input, textarea, select, a[href], [role='button'], [role='menuitem'], [role='tab'], [contenteditable='true']",
        ) !== null
      );
    };
    const onDown = (e: PointerEvent): void => {
      // Bail if the click target is a textbox/callout editor,
      // the signature action bar, or any interactive UI control.
      // These have their own pointer handling and shouldn't
      // trigger a stamp embed.
      //
      // We do NOT call stopPropagation / preventDefault here.
      // Doing so used to swallow every click while the stamp
      // was armed — including toolbar / rail / dialog clicks,
      // which meant the user couldn't even dismiss a pending
      // signature bar after arming a stamp. The placement
      // check below decides what to do; everything else passes
      // through unchanged so the rest of the UI keeps working.
      if (isInteractive(e.target)) {
        return;
      }
      // For page-canvas clicks we do the placement math on the
      // pointerdown event itself: the layer's getBoundingClientRect
      // and cssScale are stable, the host's `onPlace` only needs
      // the resolved atPt, and routing through pointerdown keeps
      // a single fast feedback loop. The user can disarm after
      // (Esc / outside-page click).
      const rect = layer.getBoundingClientRect();
      const x = (e.clientX - rect.left) / cssScale;
      const y = (e.clientY - rect.top) / cssScale;
      if (
        x < 0 ||
        y < 0 ||
        x > pageWidthPt ||
        y > pageHeightPt
      ) {
        // Click landed outside the page — toolbar / rail /
        // dialog / window chrome. We do NOT disarm here on
        // pointerdown (the disarming used to fire on this
        // branch and swallow toolbar clicks). The disarm is
        // deferred to the `click` event below.
        return;
      }
      onPlace({ ...armed, page, atPt: { x, y } });
    };
    const onClick = (e: MouseEvent): void => {
      // Disarm on click — fires AFTER pointerup so the host's
      // React click handlers run first. We disarm only when the
      // target is NOT an interactive UI control (toolbar
      // buttons, etc.): those should receive their click handler
      // before we tear down the arming. For inside-editor /
      // action-bar targets the placement was already suppressed
      // by onDown, so we don't disarm here either.
      if (isInteractive(e.target)) {
        return;
      }
      const rect = layer.getBoundingClientRect();
      const x = (e.clientX - rect.left) / cssScale;
      const y = (e.clientY - rect.top) / cssScale;
      if (
        x >= 0 &&
        y >= 0 &&
        x <= pageWidthPt &&
        y <= pageHeightPt
      ) {
        // On-page click — placement already fired via onDown;
        // the stamp is now committed and armedStamp will be
        // cleared by the host. Don't re-fire disarm here.
        return;
      }
      // Outside-page click on a non-interactive target — safe
      // to disarm now (the original target already finished its
      // click chain, if any).
      window.dispatchEvent(new CustomEvent("tflex:stamp-disarm"));
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        // B10 — Esc disarms the stamp. We can't clear the host's
        // state from here directly, but the host listens for the
        // DOM event below and resets `armedStamp` accordingly.
        window.dispatchEvent(new CustomEvent("tflex:stamp-disarm"));
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("click", onClick, true);
    window.addEventListener("keydown", onKey);
    return (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("click", onClick, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [armed, cssScale, pageWidthPt, pageHeightPt, onPlace, page]);

  if (armed === null) return null;

  // Anchor the ghost at the cursor's page-space top-left minus a
  // small inset so the click point sits inside the stamp body
  // rather than on its top-left edge. We don't clamp here —
  // `onPlace` clamps to the page bounds when it computes the
  // embed rect. Without the inset, the cursor would land on the
  // very corner of the embedded stamp, which feels off.
  const ghostLeft = pt === null ? -10000 : pt.x - 6;
  const ghostTop = pt === null ? -10000 : pt.y - 6;
  const style: CSSProperties = {
    position: "absolute",
    left: ghostLeft * cssScale,
    top: ghostTop * cssScale,
    width: targetWidthPt * cssScale,
    height: targetHeightPt * cssScale,
    border: "1.5px dashed var(--accent)",
    background: "var(--accent-soft)",
    borderRadius: "var(--radius-1)",
    opacity: 0.55,
    pointerEvents: "none",
    boxShadow: "0 1px 4px rgba(15, 23, 42, 0.10)",
    // B10 — the ghost's z-index mirrors the .stamp-layer CSS
    // (z-index: 6) so the inline style stays in lockstep with
    // the stylesheet. Promoting the layer above forms / edit /
    // annotations was the fix for the "stamp behind background"
    // report; without the inline bump the ghost would still
    // paint at z-index 4 even though its parent is at 6 (the
    // inline style on the ghost overrides the parent, since the
    // ghost's own stacking context is at 4 inside the layer's 6).
    zIndex: 6,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  };

  // Render the stamp's PNG bytes (if decodeable) as the ghost
  // body so the user sees the actual stamp they'll place. jsdom
  // can't decode PNG; in that case the ghost renders just the
  // border + a label. The PNG decode runs in a side-effect so a
  // failure (jsdom / corrupted bytes) doesn't crash the overlay.
  return (
    <div ref={layerRef} className="stamp-layer" data-stamp-layer={page} data-armed="true">
      <div className="stamp-ghost" data-stamp-ghost style={style}>
        {pt !== null && armed.pngBytes.byteLength > 0 && (
          <StampGhostImage
            pngBytes={armed.pngBytes}
            width={targetWidthPt * cssScale}
            height={targetHeightPt * cssScale}
          />
        )}
      </div>
    </div>
  );
}

/** Renders the stamp's PNG bytes as a transparent <img> so the
 *  ghost preview matches the actual stamp. The bytes are already
 *  a PNG (renderStampToPng produced them), so we drop them into
 *  a Blob URL. The URL is revoked when the bytes change or the
 *  component unmounts. */
function StampGhostImage({
  pngBytes,
  width,
  height,
}: {
  pngBytes: Uint8Array;
  width: number;
  height: number;
}): ReactElement {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (typeof URL === "undefined" || typeof Blob === "undefined") return;
    // Cast through ArrayBuffer to satisfy the BlobPart type —
    // Uint8Array's `.buffer` may be SharedArrayBuffer, which is
    // not assignable to ArrayBuffer.
    const buf: ArrayBuffer = pngBytes.buffer.slice(
      pngBytes.byteOffset,
      pngBytes.byteOffset + pngBytes.byteLength,
    ) as ArrayBuffer;
    const blob = new Blob([buf], { type: "image/png" });
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return (): void => URL.revokeObjectURL(u);
  }, [pngBytes]);
  if (url === null) return <div style={{ width, height }} />;
  return (
    <img
      src={url}
      alt="Stamp preview"
      draggable={false}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "contain",
        pointerEvents: "none",
        userSelect: "none",
      }}
    />
  );
}
