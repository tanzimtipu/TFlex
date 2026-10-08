// Phase 35 — Windows integration for the renderer (DEF-295 + the OS-open
// path); Phase 118 routes every OS file drop through the ONE intake model.
// Two hooks, both window-level:
//
//   useOsFileDrop        — an OS file drop from Explorer: every dropped file
//                          is handed to the host's `onIntake` (the Phase 118
//                          intake model) in drop order, never opened directly.
//   useOsOpenPathRequests — main pushes a PDF path (launch argv / second
//                           instance) and the renderer opens it.
//
// The drop handler reacts ONLY to an OS file drag (`dataTransfer.types`
// includes "Files"). It never touches the in-app page-drag DnD (Phase 32/34)
// which uses `text/plain`: a non-Files drag/drop is left completely alone.
// Both `dragover` and `drop` are `preventDefault`ed for a file drag so
// Chromium can never navigate the window to the dropped file.
//
// Phase 118 also exposes the eligible-drag state (`onDragActiveChange`) with a
// leave-depth guard so the intake surface can show its subtle drop
// indication; the indication clears on drop, leave or a non-Files drag.

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

/** One resolvable dropped OS file: the dropped `File` plus the absolute
 *  on-disk path `resolveDroppedPath` resolved for it. DEF-657 — the path must
 *  survive to dispatch so the drop route opens the real file, not the bare
 *  basename (a same-named file elsewhere would otherwise be opened). */
export interface OsDropEntry {
  path: string;
  file: File;
}

export interface OsFileDropOptions {
  /** Phase 118 — hand EVERY dropped OS file to the ONE intake model, in drop
   *  order, carrying both the dropped `File` and its resolved absolute path.
   *  The production host (App) always provides this; the drop handler then
   *  never opens a document directly. */
  onIntake?: (files: OsDropEntry[]) => void;
  /** Legacy direct-open path, used ONLY when `onIntake` is absent so a caller
   *  that predates Phase 118 keeps its "open the first file" behaviour. */
  openPath?: (path: string) => void | Promise<void>;
  /** The app's existing error toast. */
  onError: (message: string) => void;
  /** The app's existing info toast (legacy extra-files notice only). */
  onNotice?: (message: string) => void;
  /** Phase 118 — reports whether an eligible OS file drag is over the app, so
   *  the intake surface can show (and clear) its subtle drop indication. */
  onDragActiveChange?: (active: boolean) => void;
}

/**
 * Window-level OS file-drop handler (DEF-295, Phase 118).
 *
 * Rule: every file the OS drag carries is handed to the host's `onIntake` in
 * drop order, so the ONE intake model classifies it by real content and routes
 * the real existing operation. The handler never opens a document itself. A
 * dropped file whose on-disk path cannot be resolved (a synthetic / pathless
 * `File`) fails loud with a truthful message instead of throwing; `onIntake`
 * only receives the files that were actually resolvable, still in order.
 *
 * `onIntake` is the Phase 118 contract; the legacy `openPath` first-file path
 * is kept only as a fallback for callers that do not supply `onIntake`.
 */
export function useOsFileDrop(options: OsFileDropOptions): void {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    // Leave-depth guard: dragenter bubbles for every nested element, so count
    // them and clear the indication only when the last one leaves.
    let depth = 0;
    let active = false;
    const setActive = (next: boolean): void => {
      if (active === next) return;
      active = next;
      optionsRef.current.onDragActiveChange?.(next);
    };

    const onDragOver = (e: DragEvent): void => {
      if (!isFileDragEvent(e)) return; // in-app page drag owns the rest
      e.preventDefault();
      if (e.dataTransfer !== null) e.dataTransfer.dropEffect = "copy";
    };
    const onDragEnter = (e: DragEvent): void => {
      if (!isFileDragEvent(e)) {
        // A non-Files drag over the app must never leave a stale indication.
        depth = 0;
        setActive(false);
        return;
      }
      depth += 1;
      if (depth === 1) setActive(true);
    };
    const onDragLeave = (): void => {
      if (depth === 0) {
        setActive(false);
        return;
      }
      depth -= 1;
      if (depth === 0) setActive(false);
    };
    const onDrop = (e: DragEvent): void => {
      if (!isFileDragEvent(e)) {
        // Never interfere with the in-app page-drag DnD.
        depth = 0;
        setActive(false);
        return;
      }
      e.preventDefault();
      depth = 0;
      setActive(false);
      const { openPath, onIntake, onError, onNotice } = optionsRef.current;
      const files = e.dataTransfer === null ? [] : Array.from(e.dataTransfer.files);
      if (files.length === 0) {
        onError("Jovrel could not read the dropped file.");
        return;
      }
      if (onIntake !== undefined) {
        const resolvable: OsDropEntry[] = [];
        for (const file of files) {
          const path = resolveDroppedPath(file);
          if (path === null) {
            onError(`Jovrel could not resolve the dropped file "${file.name}".`);
            continue;
          }
          resolvable.push({ path, file });
        }
        if (resolvable.length > 0) onIntake(resolvable);
        return;
      }
      // Legacy fallback for a caller that does not route through the intake.
      if (openPath === undefined) return;
      const first = files[0];
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
    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return (): void => {
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragleave", onDragLeave);
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
