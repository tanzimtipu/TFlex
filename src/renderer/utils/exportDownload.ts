// Phase 9 — Save an exported image to disk.
//
// The Phase 9 export pipeline produces image blobs (PNG / JPEG) for
// each requested page. The save path lives in the renderer because
// there is no IPC handler for "write arbitrary bytes to disk yet".
// We use the browser-standard anchor-download trick:
//   URL.createObjectURL(blob) -> <a href download> -> click
// In Electron the renderer shares the file-system origin, so the
// download attribute prompts the user for a save location via the
// same OS save dialog they'd see for any other download.
//
// We intentionally do NOT extend `dialog.showSaveDialog` here: that's
// a backend IPC concern and we keep the renderer's save flow off the
// main process. The dialog UX is identical from the user's point of
// view.
//
// Returns `true` when the user accepted the download prompt, `false`
// when they cancelled. Throws on underlying DOM failures (rare).

/** Trigger a browser-style download of the supplied blob. Returns
 *  `true` when the user accepted the download prompt; `false` when
 *  they cancelled. The anchor element is appended, clicked, and
 *  removed in the same microtask so it doesn't show up in the
 *  renderer's DOM tree. */
export function downloadBlob(blob: Blob, filename: string): boolean {
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return true;
  } finally {
    // Revoke on the next tick so the browser has time to start the
    // download. Revoking synchronously can race the download in some
    // Electron builds.
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  }
}

/** MIME-type helper for the export dialog's per-page blobs. The
 *  PNG / JPEG values match the browser canvas encoder; TIFF has no
 *  native canvas support, so we emit image/png for the canvas path
 *  and rely on the dialog to give the file the .tif extension. The
 *  real TIFF-bytes path is owned by the backend. */
export function mimeForExportFormat(
  format: "png" | "jpeg" | "tiff",
): string {
  if (format === "jpeg") return "image/jpeg";
  if (format === "tiff") return "image/png"; // canvas fallback
  return "image/png";
}

/** Build a sensible default filename for an exported page. The user
 *  can override the name in the OS save dialog. */
export function defaultExportFilename(
  sourceName: string,
  pageIndex: number,
  format: "png" | "jpeg" | "tiff",
): string {
  const base = sourceName.replace(/\.pdf$/i, "");
  const ext = format === "jpeg" ? "jpg" : format === "tiff" ? "tif" : "png";
  // Sanitize the basename — strip any characters that the OS save
  // dialog would reject on Windows. Defensive; sample names already
  // conform but a recents-list entry may not.
  const safe = base.replace(/[\\/:*?"<>|]+/g, "_").trim();
  if (safe.length === 0 || safe === "_") {
    return `page-${pageIndex}.${ext}`;
  }
  return `${safe}-page-${pageIndex}.${ext}`;
}

/** Build a sensible default filename for an exported text file. The
 *  Renderer composes a single .txt or .rtf document from the
 *  per-page text returned by `engine.exportText`. */
export function defaultTextExportFilename(
  sourceName: string,
  format: "txt" | "rtf",
): string {
  const base = sourceName.replace(/\.pdf$/i, "");
  const safe = base.replace(/[\\/:*?"<>|]+/g, "_").trim();
  if (safe.length === 0 || safe === "_") {
    return `document.${format}`;
  }
  return `${safe}.${format}`;
}

/** Build a sensible default filename for an exported .docx file. */
export function defaultDocxExportFilename(sourceName: string): string {
  const base = sourceName.replace(/\.pdf$/i, "");
  const safe = base.replace(/[\\/:*?"<>|]+/g, "_").trim();
  if (safe.length === 0 || safe === "_") {
    return "document.docx";
  }
  return `${safe}.docx`;
}
