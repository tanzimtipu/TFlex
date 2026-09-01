// B10 / DEF-101 — placed-stamp DOM surface. The engine's `addStamp`
// op bakes the stamp PNG into the page content, so the placed stamp
// is part of the page bitmap after a proxy refresh. That baked
// representation has no DOM node, so the runtime could not
// demonstrate/verify a placement (and QA's e2e couldn't either:
// its `.stamp-annotation` locator timed out even though the pixels
// were on the page).
//
// This component renders a per-placement DOM annotation at the exact
// rect the engine embeds: a positioned div carrying the placed
// stamp's PNG (the same raster the engine bakes, so the overlay
// pixel-matches the bitmap and reads as a single stamp). It is
// pointer-transparent (`pointerEvents: none`) because the stamp is
// not an interactive entity — the surface makes the placement
// visible, measurable, and selectable by tests.
//
// The host (App) records each successful placement in per-tab
// state and threads it down; the list is renderer-side only and
// needs no engine change.
import { useEffect, useState } from "react";
import type { CSSProperties, ReactElement } from "react";
import type { StampId } from "../../shared/types";

export interface PlacedStamp {
  id: string;
  stampId: StampId;
  page: number;
  rect: { x: number; y: number; width: number; height: number };
  pngBytes: Uint8Array;
  pngWidth: number;
  pngHeight: number;
}

interface StampAnnotationsProps {
  cssScale: number;
  items: PlacedStamp[];
}

function StampPngImage({ bytes }: { bytes: Uint8Array }): ReactElement | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (typeof URL === "undefined" || typeof Blob === "undefined") return;
    const buf: ArrayBuffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const blob = new Blob([buf], { type: "image/png" });
    const u = URL.createObjectURL(blob);
    setUrl(u);
    return (): void => URL.revokeObjectURL(u);
  }, [bytes]);
  if (url === null) return null;
  return (
    <img
      src={url}
      alt="Placed stamp"
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

export function StampAnnotations(props: StampAnnotationsProps): ReactElement | null {
  const { cssScale, items } = props;
  if (items.length === 0) return null;
  return (
    <>
      {items.map((s) => {
        const style: CSSProperties = {
          position: "absolute",
          left: s.rect.x * cssScale,
          top: s.rect.y * cssScale,
          width: s.rect.width * cssScale,
          height: s.rect.height * cssScale,
          // DEF-101 — the surface paints above the textLayer (z:
          // auto) so it is never occluded, but below the
          // annotation layer (z: 2) so markup/selection stay on
          // top. Pointer-transparent: the stamp is baked content,
          // not an interactive entity.
          zIndex: 1,
          pointerEvents: "none",
          overflow: "hidden",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        };
        return (
          <div
            key={s.id}
            className="stamp-annotation"
            data-stamp-annotation={s.id}
            data-stamp-id={s.stampId}
            data-page={s.page}
            style={style}
          >
            <StampPngImage bytes={s.pngBytes} />
          </div>
        );
      })}
    </>
  );
}