// DEF-592 (from ADV-223) — honest Home sample previews.
//
// The bundled sample cards previously showed ONE per-TASK glyph on an identical
// gradient, so `long.pdf` and `report.pdf` were fully indistinguishable and the
// section read as broken/duplicate tiles. Each card now renders the REAL first
// page of its bundled sample: the bytes come over the existing `readSample` IPC
// and pdf.js rasterizes page 1 once per sample, cached for the app lifetime.
//
// While the raster is pending — or when it cannot be produced (no bridge, no
// canvas backend, unreadable/encrypted page) — the card shows an honest
// per-sample fallback that keeps form / long / report / scanned distinct, never
// the same generic sparkle rectangle.
//
// Pure classification + a narrow raster surface so the honesty rules are
// unit-testable without a real pdf.js worker.

import { useEffect, useState } from "react";
import type { QuietIconId } from "../../icons/quietPrecision";

/** The raster is produced at this width (px) and scaled down by CSS; it is
 *  device-pixel aware enough for the small card without decoding a full page. */
export const SAMPLE_PREVIEW_WIDTH = 480;
const PREVIEW_CACHE_LIMIT = 24;

export type SamplePreviewTone = "form" | "reading" | "report" | "scan" | "general";

export interface SamplePreviewFallback {
  /** Honest nature of the sample, kept distinct per real basename. */
  tone: SamplePreviewTone;
  /** A real registry glyph that names that nature (never a sparkle). */
  icon: QuietIconId;
}

const FALLBACK_ICONS: Readonly<Record<SamplePreviewTone, QuietIconId>> = {
  form: "forms",
  reading: "find",
  report: "audit",
  scan: "recognizeText",
  general: "openSample",
};

/** Classify a sample by its real basename. `long` and `report` MUST stay
 *  distinct — that is the exact DEF-592 gap the per-task mapping collapsed. */
export function samplePreviewTone(name: string): SamplePreviewTone {
  const lower = name.toLowerCase();
  if (lower.includes("form")) return "form";
  if (lower.includes("scan")) return "scan";
  if (lower.includes("report")) return "report";
  if (lower.includes("long")) return "reading";
  return "general";
}

/** The honest fallback descriptor for a sample. */
export function samplePreviewFallback(name: string): SamplePreviewFallback {
  const tone = samplePreviewTone(name);
  return { tone, icon: FALLBACK_ICONS[tone] };
}

/** The raster canvas size for a page's intrinsic point size, clamped so a very
 *  wide page cannot produce an unbounded bitmap. */
export function samplePreviewSize(
  pageWidthPt: number,
  pageHeightPt: number,
): { width: number; height: number } {
  const safeWidth = pageWidthPt > 0 ? pageWidthPt : 1;
  const scale = SAMPLE_PREVIEW_WIDTH / safeWidth;
  return {
    width: Math.max(1, Math.round(pageWidthPt * scale)),
    height: Math.max(1, Math.round(pageHeightPt * scale)),
  };
}

const previewCache = new Map<string, Promise<string | null>>();

/** Test hook: drop the memoized rasters. */
export function resetSamplePreviewCache(): void {
  previewCache.clear();
}

async function renderFirstPage(name: string): Promise<string | null> {
  try {
    const bridge = window.tflex as typeof window.tflex | undefined;
    if (bridge === undefined || typeof bridge.readSample !== "function") return null;
    const res = await bridge.readSample(name);
    if (!res.ok) return null;
    const bytes = new Uint8Array(res.value);
    // Deferred import: the Home screen must not pull the pdf.js worker into its
    // initial chunk; it loads only when a sample actually renders.
    const { openPdfDocument } = await import("../../pdf/pdfjs");
    const opened = await openPdfDocument(bytes.buffer as ArrayBuffer);
    if (!("doc" in opened)) return null;
    const doc = opened.doc;
    try {
      const page = await doc.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const size = samplePreviewSize(base.width, base.height);
      const scale = size.width / base.width;
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = size.width;
      canvas.height = size.height;
      const ctx = canvas.getContext("2d");
      if (ctx === null) return null;
      // Paper is white in every theme (same contract as .pdf-page); a page with
      // transparent areas must not leak a dark card background through.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, size.width, size.height);
      await page.render({ canvasContext: ctx as never, viewport }).promise;
      if (typeof canvas.toDataURL !== "function") return null;
      const url = canvas.toDataURL("image/png");
      return url.startsWith("data:image/png") && url.length > 64 ? url : null;
    } finally {
      try {
        await doc.destroy();
      } catch {
        // ignore: the proxy may already be gone
      }
    }
  } catch {
    return null;
  }
}

/** The cached first-page raster data URL for a sample, or null when it cannot
 *  be produced. Concurrent callers share one in-flight raster. */
export function samplePreviewDataUrl(name: string): Promise<string | null> {
  const existing = previewCache.get(name);
  if (existing !== undefined) return existing;
  const pending = renderFirstPage(name);
  if (previewCache.size >= PREVIEW_CACHE_LIMIT) {
    const oldest = previewCache.keys().next().value;
    if (oldest !== undefined) previewCache.delete(oldest);
  }
  previewCache.set(name, pending);
  return pending;
}

export type SamplePreviewState =
  | { status: "loading" }
  | { status: "ready"; src: string }
  | { status: "unavailable" };

/** Resolve a sample's real first-page raster for a card, settling to the honest
 *  fallback when it is unavailable. */
export function useSamplePreview(name: string): SamplePreviewState {
  const [state, setState] = useState<SamplePreviewState>({ status: "loading" });
  useEffect((): (() => void) => {
    let cancelled = false;
    setState({ status: "loading" });
    void samplePreviewDataUrl(name).then((url) => {
      if (cancelled) return;
      setState(url === null ? { status: "unavailable" } : { status: "ready", src: url });
    });
    return (): void => {
      cancelled = true;
    };
  }, [name]);
  return state;
}
