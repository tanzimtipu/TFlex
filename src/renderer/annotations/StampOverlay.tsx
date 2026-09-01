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
      // preview doesn't snap to (0,0) when the user moves the
      // cursor over a sibling panel.
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
    const onDown = (e: PointerEvent): void => {
      // Catch pointerdown at the window level so the user can
      // place the stamp anywhere on the page (including over
      // other overlays). We bail if the click target is a
      // textbox/callout editor or the action bar — those have
      // their own pointer handling and shouldn't trigger a
      // stamp embed.
      const t = e.target;
      if (t instanceof Element) {
        if (t.closest(".ann-editor, .sig-action-bar, .ann-textbox-wrap, .ann-note-editor") !== null) {
          return;
        }
      }
      const rect = layer.getBoundingClientRect();
      const x = (e.clientX - rect.left) / cssScale;
      const y = (e.clientY - rect.top) / cssScale;
      if (
        x < 0 ||
        y < 0 ||
        x > pageWidthPt ||
        y > pageHeightPt
      ) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      onPlace({ ...armed, page, atPt: { x, y } });
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
    window.addEventListener("keydown", onKey);
    return (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerdown", onDown, true);
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
    zIndex: 4,
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
