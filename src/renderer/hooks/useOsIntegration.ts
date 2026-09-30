// Phase 35 — Windows integration for the renderer (DEF-295 + the OS-open
// path). Two hooks, both window-level, both routing through the ONE shared
// open path (`openRequestedPath`):
//
//   useOsFileDrop        — an OS file drop from Explorer opens the document.
//   useOsOpenPathRequests — main pushes a PDF path (launch argv / second
//                           instance) and the renderer opens it.
//
// The drop handler reacts ONLY to an OS file drag (`dataTransfer.types`
// includes "Files"). It never touches the in-app page-drag DnD (Phase 32/34)
// which uses `text/plain`: a non-Files drag/drop is left completely alone.
// Both `dragover` and `drop` are `preventDefault`ed for a file drag so
// Chromium can never navigate the window to the dropped file.

import { useEffect, useRef } from "react";

/** The slice of the preload bridge these hooks touch. Optional members so a
 *  preload that predates Phase 35 (or a jsdom test) degrades gracefully. */
export interface OsBridge {
  webUtils?: { getPathForFile?: (file: File) => string };
  onOpenPathRequest?: (cb: (path: string) => void) => () => void;
}

function getBridge(): OsBridge | undefined {
  return (window as unknown as { tflex?: OsBridge }).tflex;
}

/** True when a drag/drop event carries OS files (`dataTransfer.types`
 *  includes "Files"). The in-app page drag sets `text/plain` only, so this
 *  is the exact test that keeps the two DnD systems apart. */
export function isFileDragEvent(e: { dataTransfer: DataTransfer | null }): boolean {
  const dt = e.dataTransfer;
  if (dt === null || dt === undefined) return false;
  const types = dt.types as ArrayLike<string> | undefined;
  if (types === undefined || types === null) return false;
  return Array.from(types).includes("Files");
}

/** A dropped file is treated as a PDF when the OS types it as one or its
 *  name ends in `.pdf` (case-insensitive). */
export function isPdfFile(file: File): boolean {
  if (file.type === "application/pdf") return true;
  return /\.pdf$/i.test(file.name ?? "");
}

/** Resolve a dropped `File` to its absolute on-disk path through the
 *  preload's `webUtils.getPathForFile`. Null when the bridge is absent or the
 *  file has no real path (e.g. a synthetic File). */
export function resolveDroppedPath(file: File): string | null {
  const get = getBridge()?.webUtils?.getPathForFile;
  if (typeof get !== "function") return null;
  try {
    const path = get(file);
    return typeof path === "string" && path.length > 0 ? path : null;
  } catch {
    return null;
  }
}

export interface OsFileDropOptions {
  /** The shared renderer open path (Multi Mode routing included). */
  openPath: (path: string) => void | Promise<void>;
  /** The app's existing error toast. */
  onError: (message: string) => void;
  /** The app's existing info toast (used for the extra-files notice). */
  onNotice?: (message: string) => void;
}

/**
 * Window-level OS file-drop handler (DEF-295).
 *
 * Rule: open the FIRST dropped file through the shared, convert-aware path
 * (`openPath` -> `openFromRequest` -> `openPdfFromPath` -> `routeOpenPath`),
 * exactly like the Open dialog and the OS-open listener. A file the shared
 * path cannot open fails loud there with a truthful message; this handler
 * only reports a dropped file it cannot read or resolve. Extra files beyond
 * the first are reported once with the info toast (the app opens one
 * document per drop).
 */
export function useOsFileDrop(options: OsFileDropOptions): void {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const onDragOver = (e: DragEvent): void => {
      if (!isFileDragEvent(e)) return; // in-app page drag owns the rest
      e.preventDefault();
      if (e.dataTransfer !== null) e.dataTransfer.dropEffect = "copy";
    };
    const onDrop = (e: DragEvent): void => {
      if (!isFileDragEvent(e)) return; // never interfere with in-app DnD
      e.preventDefault();
      const { openPath, onError, onNotice } = optionsRef.current;
      const files = e.dataTransfer === null ? [] : Array.from(e.dataTransfer.files);
      const first = files[0];
      if (first === undefined) {
        onError("Jovrel could not read the dropped file.");
        return;
      }
      const path = resolveDroppedPath(first);
      if (path === null) {
        onError("Jovrel could not resolve the dropped file's location.");
        return;
      }
      void Promise.resolve(openPath(path)).catch(() => undefined);
      if (files.length > 1 && onNotice !== undefined) {
        onNotice(
          `Opened the first of ${files.length} dropped files. Drop one file at a time to open the others.`,
        );
      }
    };
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("drop", onDrop);
    return (): void => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("drop", onDrop);
    };
  }, []);
}

export interface OsOpenPathRequestOptions {
  /** The shared renderer open path (Multi Mode routing included). */
  openPath: (path: string) => void | Promise<void>;
  /** The app's existing error toast. */
  onError: (message: string) => void;
}

/**
 * Subscribe to `app:openPathRequest` (launch argv / second instance) and
 * route the path through the same shared open path a dialog open uses. A
 * malformed payload fails loud; an absent channel (older preload) is a
 * no-op, never a crash.
 */
export function useOsOpenPathRequests(options: OsOpenPathRequestOptions): void {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const subscribe = getBridge()?.onOpenPathRequest;
    if (typeof subscribe !== "function") return;
    return subscribe((path: unknown): void => {
      const { openPath, onError } = optionsRef.current;
      if (typeof path !== "string" || path.trim() === "") {
        onError("Jovrel received an invalid file path from Windows.");
        return;
      }
      void Promise.resolve(openPath(path)).catch(() => {
        onError("Jovrel could not open the requested file.");
      });
    });
  }, []);
}
