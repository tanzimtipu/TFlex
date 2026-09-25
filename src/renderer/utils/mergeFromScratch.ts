// Phase 40 item 4 — Merge PDF from scratch (no document open).
//
// The Welcome screen's "Merge PDFs" entry is reachable with zero tabs
// open. In that state there is no active document for the doc-bound
// MergeDialog to merge INTO, so the flow is different:
//
//   1. One multi-select OS picker (`window.tflex.openFilesDialog('pdf')`)
//      returns the picked NORMALIZED paths in selection order, or an
//      empty array on cancel.
//   2. One picked file  -> open it as a normal document (the user
//      effectively just opened a PDF).
//   3. Two+ picked files -> open the FIRST as a brand-new in-memory
//      document, then merge the REST (by path) into it, producing a
//      single combined document in a new tab.
//
// The sequencing lives in this pure, dependency-injected helper so it
// can be unit-tested without mounting App.tsx. `App.tsx` supplies the
// real deps (picker, engine, openFromBytes, toasts).

export interface MergeFromScratchOpenedDoc {
  /** Tab id of the freshly opened first document. */
  tabId: string;
  /** Engine doc id registered for that tab (ready for `merge`). */
  engineDocId: string;
}

export interface MergeFromScratchMergeResult {
  ok: boolean;
  /** Present when `ok` is false — a human-readable reason. */
  message?: string;
}

export interface MergeFromScratchDeps {
  /** `window.tflex.openFilesDialog('pdf')`. Must return an array;
   *  an empty array means the user cancelled. */
  pickPdfPaths: () => Promise<string[]>;
  /** Open a single picked path as a normal on-disk document. */
  openSinglePdf: (path: string) => Promise<unknown>;
  /** Load the first picked file and open it in memory (no on-disk
   *  path, so a from-scratch merge can never overwrite a source
   *  file). Returns null when the load/open failed (already
   *  toasted by the caller). */
  openFirstAsCombined: (
    firstPath: string,
    totalPicked: number,
  ) => Promise<MergeFromScratchOpenedDoc | null>;
  /** Merge `otherPaths` (by path) into the opened document. Receives
   *  both ids so the host can update the tab's engine mirror and
   *  refresh its PDF.js proxy in one place. */
  mergeRest: (
    tabId: string,
    engineDocId: string,
    otherPaths: string[],
  ) => Promise<MergeFromScratchMergeResult>;
  /** Called when a step fails after the picker returned. */
  onError: (message: string) => void;
  /** Called once the combined document is ready. */
  onMerged: (tabId: string, totalPicked: number) => void;
}

/**
 * Run the from-scratch merge flow. A cancelled picker (empty array)
 * performs NO operation and reports nothing. A thrown picker / merge
 * error is surfaced through `onError`.
 */
export async function runMergeFromScratch(
  deps: MergeFromScratchDeps,
): Promise<void> {
  let paths: string[];
  try {
    paths = await deps.pickPdfPaths();
  } catch (e) {
    deps.onError(
      `Could not open the file picker: ${e instanceof Error ? e.message : String(e)}`,
    );
    return;
  }
  // Contract: always an array; [] means the user cancelled.
  if (!Array.isArray(paths) || paths.length === 0) return;

  // A single pick is just an open — no merge, no combined document.
  if (paths.length === 1) {
    await deps.openSinglePdf(paths[0]);
    return;
  }

  const opened = await deps.openFirstAsCombined(paths[0], paths.length);
  if (opened === null) return;

  let result: MergeFromScratchMergeResult;
  try {
    result = await deps.mergeRest(
      opened.tabId,
      opened.engineDocId,
      paths.slice(1),
    );
  } catch (e) {
    deps.onError(
      `Could not merge PDFs: ${e instanceof Error ? e.message : String(e)}`,
    );
    return;
  }
  if (!result.ok) {
    deps.onError(result.message ?? "Could not merge the picked PDFs.");
    return;
  }
  deps.onMerged(opened.tabId, paths.length);
}

/** Phase 40 item 4 — routing decision for a Merge click. With no
 *  active document the flow starts from scratch (multi-select
 *  picker); otherwise it opens the existing doc-bound dialog. */
export function mergeClickStartsFromScratch(
  activeTabId: string | null,
): boolean {
  return activeTabId === null;
}