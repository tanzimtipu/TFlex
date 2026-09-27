// Phase 35 - the renderer entry branch.
//
// Main opens the standalone print window by loading the SAME renderer bundle
// with `?tfWindow=print&context=<url-encoded JSON>` (see
// `src/main/print-window.ts`). This module decides, purely, which entry the
// bundle boots: the normal app, the print-only UI, or a clear error state
// when the flag is present but the context is malformed. Keeping the decision
// pure means the branch is unit-tested without a live `location`.

import type { PrintSettings, PrintWindowContext, PrintWindowOpenResult } from "../../shared/types";
import type { Result } from "../../shared/result";
import { err } from "../../shared/result";

/** Mirrors `PRINT_WINDOW_ENTRY_FLAG` in the main-process module. */
export const PRINT_WINDOW_ENTRY_FLAG = "print";

/** Mirrors `PRINT_WINDOW_MAX_PAGES`; an absurd count is rejected, not shown. */
export const PRINT_WINDOW_MAX_PAGES = 50_000;

/** Mirrors `PRINT_WINDOW_TITLE` in the main-process module. */
export const PRINT_WINDOW_TITLE = "Print - Jovrel";

export type RendererEntry =
  | { kind: "app" }
  | { kind: "print"; context: PrintWindowContext }
  | { kind: "print-error"; reason: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validate the context payload the renderer received. Mirrors the
 * main-process validator (`parsePrintWindowContext` in print-window.ts) so a
 * hand-edited URL or a truncated query can never render a broken print UI -
 * it renders the error state instead.
 */
export function parsePrintWindowContext(
  raw: unknown,
): Result<PrintWindowContext, "invalid-context"> {
  if (!isPlainObject(raw)) {
    return err("invalid-context", "The print window context is not an object.");
  }
  const { docId, documentName, pageCount, settings } = raw;
  if (typeof docId !== "string" || docId.trim() === "") {
    return err("invalid-context", "The print window context has no document id.");
  }
  if (typeof documentName !== "string") {
    return err("invalid-context", "The print window context has no document name.");
  }
  if (typeof pageCount !== "number" || !Number.isInteger(pageCount) || pageCount < 0) {
    return err("invalid-context", "The print window context has an invalid page count.");
  }
  if (pageCount > PRINT_WINDOW_MAX_PAGES) {
    return err(
      "invalid-context",
      `The print window context has an invalid page count (over ${PRINT_WINDOW_MAX_PAGES}).`,
    );
  }
  if (!isPlainObject(settings)) {
    return err("invalid-context", "The print window context has no print settings.");
  }
  return {
    ok: true,
    value: { docId, documentName, pageCount, settings: settings as PrintSettings },
  };
}

/**
 * Resolve the entry from a location search string. No `tfWindow=print` flag
 * means the normal app; the flag with a missing/unreadable/invalid context
 * means the print window's error state (never a half-rendered UI).
 */
export function resolveRendererEntry(search: string): RendererEntry {
  const params = new URLSearchParams(search);
  if (params.get("tfWindow") !== PRINT_WINDOW_ENTRY_FLAG) {
    return { kind: "app" };
  }
  const raw = params.get("context");
  if (raw === null || raw === "") {
    return {
      kind: "print-error",
      reason: "This print window was opened without its document context.",
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      kind: "print-error",
      reason: "This print window's document context could not be read.",
    };
  }
  const result = parsePrintWindowContext(parsed);
  if (!result.ok) {
    return { kind: "print-error", reason: result.error.message };
  }
  return { kind: "print", context: result.value };
}

/**
 * The document title the renderer entry should carry, or null when the entry
 * must leave the document title alone.
 *
 * The print window loads the SAME index.html as the app, whose `<title>Jovrel</title>`
 * overrides the BrowserWindow `title` option - so unless the print entry sets
 * `document.title` itself, the OS title bar (and taskbar / Alt-Tab) shows
 * "Jovrel" for both windows (DEF-298). Both the print UI and its error state are
 * the standalone print window, so both carry the print title; the normal app
 * entry returns null and the main window's title is never touched.
 */
export function rendererEntryTitle(entry: RendererEntry): string | null {
  return entry.kind === "app" ? null : PRINT_WINDOW_TITLE;
}

/**
 * Map an `open` result to the toast copy the MAIN window must show, or null
 * when the open succeeded. A refusal (a malformed context, or a window that
 * could not be created) is never silent: the caller surfaces this through the
 * app's existing error toast. Pure, so the refusal copy is unit-tested
 * without the toast reducer.
 */
export function printWindowOpenFailureMessage(
  result: PrintWindowOpenResult,
): string | null {
  if (result.ok) return null;
  return `Could not open the print window: ${result.reason}`;
}
