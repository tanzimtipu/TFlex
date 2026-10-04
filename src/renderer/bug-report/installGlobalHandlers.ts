// Phase 101 (chunk 2) - renderer-side global error capture.
//
// Installs two window listeners that forward uncaught renderer failures to the
// main-process bug-report service built in chunk 1. Capture is SILENT: nothing
// is shown to the user, and a missing/malformed preload bridge is a no-op, never
// a thrown error (the handler must not recursively fail).
//
//   window 'error'               -> category 'renderer-error'
//   window 'unhandledrejection'  -> category 'renderer-rejection'
//
// React render crashes are covered separately by `BugReportErrorBoundary`.

import type { BugReportCaptureResult, BugReportInput } from "../../shared/bugReport";

/** The bugReport subset of the preload bridge. */
export interface BugReportBridge {
  capture(input: BugReportInput): Promise<BugReportCaptureResult>;
}

/** Read the bugReport bridge off `window.tflex`, or null when absent/malformed. */
export function bugReportBridge(): BugReportBridge | null {
  const w = window as unknown as { tflex?: { bugReport?: BugReportBridge } };
  const api = w.tflex?.bugReport;
  if (api === undefined) return null;
  if (typeof api.capture !== "function") return null;
  return api;
}

/** Fire-and-forget forward of one captured failure. Never throws. */
export function captureRendererBug(input: BugReportInput): void {
  try {
    const api = bugReportBridge();
    if (api === null) return;
    const result = api.capture(input) as Promise<BugReportCaptureResult> | undefined;
    if (result !== undefined && typeof result.catch === "function") {
      void result.catch(() => undefined);
    }
  } catch {
    // A broken bridge must never surface its own failure.
  }
}

/**
 * Install the window-level error/rejection listeners. Returns an uninstall
 * function that removes exactly the handlers it added.
 */
export function installBugReportGlobalHandlers(): () => void {
  const onError = (event: ErrorEvent): void => {
    try {
      const error = event.error;
      const errorObj = error instanceof Error ? error : null;
      const message =
        errorObj !== null && errorObj.message !== ""
          ? errorObj.message
          : event.message !== ""
            ? event.message
            : "Unknown renderer error";
      const input: BugReportInput = {
        level: "error",
        category: "renderer-error",
        component: "renderer",
        message,
        handled: false,
      };
      if (errorObj !== null) {
        input.errorName = errorObj.name;
        if (typeof errorObj.stack === "string") input.stackTrace = errorObj.stack;
      }
      captureRendererBug(input);
    } catch {
      // never throw out of an error listener
    }
  };

  const onRejection = (event: PromiseRejectionEvent): void => {
    try {
      const reason = (event as { reason?: unknown }).reason;
      const reasonObj = reason instanceof Error ? reason : null;
      const message = reasonObj !== null ? reasonObj.message : String(reason);
      const input: BugReportInput = {
        level: "error",
        category: "renderer-rejection",
        component: "renderer",
        message,
        handled: false,
      };
      if (reasonObj !== null) {
        input.errorName = reasonObj.name;
        if (typeof reasonObj.stack === "string") input.stackTrace = reasonObj.stack;
      }
      captureRendererBug(input);
    } catch {
      // never throw out of a rejection listener
    }
  };

  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  return () => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
  };
}
