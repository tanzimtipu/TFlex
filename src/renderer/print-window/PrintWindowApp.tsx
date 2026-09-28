// Phase 35 item 8 - the standalone print window's UI.
//
// This is what the renderer boots when the entry flag says `tfWindow=print`
// (see `context.ts`). It renders ONLY the print surface - no app chrome, no
// tabs, no document view - and drives the SAME pipeline as the in-app dialog:
// the shared `usePrintControls` hook + `PrintPanel` markup, and the existing
// `rasterizePagesForPrint` helper. The one adapter is `loadDocument`: the
// window has no live pdf.js proxy, so it fetches the document's bytes from
// the engine by `docId` and parses them with the app's own `openPdfDocument`.
// Nothing about the print pipeline is re-implemented here.

import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { TriangleAlert } from "lucide-react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { PrintPanel } from "../components/PrintPanel";
import { BrandMark } from "../components/BrandMark";
import { BrandWordmark } from "../components/BrandWordmark";
import { usePrintControls } from "../components/usePrintControls";
import { openPdfDocument } from "../pdf/pdfjs";
import { getEngine } from "../engine/engineClient";
import { applyTheme } from "../state/theme";
import type { RendererEntry } from "./context";
import type {
  PrintJobPayload,
  PrintJobResult,
  PrinterInfo,
  PrintWindowContext,
} from "../../shared/types";

/** The seams this window needs. Defaults read the app's normal preload
 *  surface; tests pass a stub so no Electron API is required. */
export interface PrintWindowDeps {
  listPrinters: () => Promise<PrinterInfo[]>;
  printJob: (payload: PrintJobPayload) => Promise<PrintJobResult>;
  onDocumentGone: (cb: (docId: string) => void) => () => void;
  loadDocument: (
    docId: string,
  ) => Promise<{ doc: PDFDocumentProxy } | { error: string }>;
  closeWindow: () => void;
}

function buildDefaultDeps(): PrintWindowDeps {
  return {
    listPrinters: (): Promise<PrinterInfo[]> => window.tflex.listPrinters(),
    printJob: (payload: PrintJobPayload): Promise<PrintJobResult> =>
      window.tflex.printJob(payload),
    onDocumentGone: (cb: (docId: string) => void): (() => void) =>
      window.tflex.printWindow?.onDocumentGone(cb) ?? ((): void => undefined),
    loadDocument: async (docId: string) => {
      const engine = getEngine();
      if (engine.getDocumentBytes === undefined) {
        return { error: "This build cannot read the document for printing." };
      }
      const bytes = await engine.getDocumentBytes(docId);
      if (!bytes.ok) {
        return { error: bytes.error.message };
      }
      const opened = await openPdfDocument(bytes.value);
      if (!("doc" in opened)) {
        return { error: "This document could not be opened for printing." };
      }
      return { doc: opened.doc };
    },
    closeWindow: (): void => window.tflex.closeWindow(),
  };
}

export interface PrintWindowAppProps {
  entry: Exclude<RendererEntry, { kind: "app" }>;
  /** Test seam; omitted in the real window (the preload surface is used). */
  deps?: PrintWindowDeps;
}

export function PrintWindowApp({ entry, deps }: PrintWindowAppProps): ReactElement {
  const resolved = useMemo(() => deps ?? buildDefaultDeps(), [deps]);
  // The window is its own document, so the app's theme attribute has to be
  // applied here too - otherwise a dark-mode user gets a light standalone
  // window that looks torn out of the app. Best-effort: a settings read
  // failure just leaves the default light surface.
  useEffect(() => {
    let cancelled = false;
    try {
      void window.tflex
        .loadSettings()
        .then((result) => {
          if (!cancelled && result.ok) applyTheme(result.value.theme);
        })
        .catch(() => undefined);
    } catch {
      // No preload (a stray browser tab): keep the default light surface.
    }
    return (): void => {
      cancelled = true;
    };
  }, []);
  if (entry.kind === "print-error") {
    return <PrintWindowError reason={entry.reason} />;
  }
  return <PrintWindowSurface context={entry.context} deps={resolved} />;
}

/** A malformed/absent context: a clear, standalone message - never a broken
 *  print UI and never a blank window. */
function PrintWindowError({ reason }: { reason: string }): ReactElement {
  const onClose = (): void => {
    try {
      window.tflex?.closeWindow();
    } catch {
      // No preload (a stray browser tab): nothing to close.
    }
  };
  return (
    <div className="print-window print-window-error" data-print-window-error>
      <TriangleAlert size={28} aria-hidden className="print-window-error-icon" />
      <h1 className="print-window-error-title">Print window unavailable</h1>
      <p className="print-window-error-text" role="alert">
        {reason}
      </p>
      <button type="button" className="btn btn-secondary" onClick={onClose} data-print-window-error-close>
        Close window
      </button>
    </div>
  );
}


interface PrintWindowSurfaceProps {
  context: PrintWindowContext;
  deps: PrintWindowDeps;
}

/** The print-only surface: window heading, status banners, then the SHARED
 *  control panel. */
function PrintWindowSurface({ context, deps }: PrintWindowSurfaceProps): ReactElement {
  const { docId, documentName, pageCount } = context;
  const seed = context.settings;

  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);

  // Fetch the document's bytes from the engine and parse them with the app's
  // own pdf.js loader. This is the ONE adapter the window needs; the parsed
  // proxy is then handed to the shared print surface exactly like the in-app
  // dialog hands over its live proxy.
  useEffect(() => {
    let cancelled = false;
    let loaded: PDFDocumentProxy | null = null;
    setDoc(null);
    setLoadError(null);
    setGone(false);
    void (async (): Promise<void> => {
      const result = await deps.loadDocument(docId);
      if (cancelled) {
        if ("doc" in result) void result.doc.destroy().catch(() => undefined);
        return;
      }
      if ("error" in result) {
        setLoadError(result.error);
        return;
      }
      loaded = result.doc;
      setDoc(result.doc);
    })();
    return (): void => {
      cancelled = true;
      if (loaded !== null) void loaded.destroy().catch(() => undefined);
    };
  }, [docId, deps]);

  // Main tells the window when the document it was opened for is gone (the
  // tab closed). Never leave stale pages on screen: show the state and block
  // the print action.
  useEffect(
    () =>
      deps.onDocumentGone((id: string): void => {
        if (id === docId) setGone(true);
      }),
    [deps, docId],
  );

  // Identity changes when the proxy arrives so the shared preview effect
  // re-runs against it.
  const resolveActiveDoc = useCallback((): PDFDocumentProxy | null => doc, [doc]);
  const closeWindow = useCallback((): void => deps.closeWindow(), [deps]);

  const blockedReason = gone
    ? "The document was closed in Jovrel, so it can no longer be printed."
    : loadError !== null
      ? loadError
      : doc === null
        ? "The document is still loading."
        : null;

  const print = usePrintControls({
    active: true,
    totalPages: doc?.numPages ?? pageCount,
    currentPage: 1,
    resolveActiveDoc,
    listPrinters: deps.listPrinters,
    printJob: deps.printJob,
    onClose: closeWindow,
    seed,
    blockedReason,
  });

  return (
    <div className="print-window" data-print-window>
      <header className="print-window-header">
        <div className="print-window-brand">
          <BrandMark size={18} className="print-window-brand-mark" />
          <BrandWordmark className="print-window-brand-name" />
        </div>
        <div className="print-window-heading">
          <h1 className="print-window-title">Print</h1>
          <span className="print-window-doc" data-print-window-doc title={documentName}>
            {documentName}
          </span>
        </div>
        <span className="print-window-pages">
          {doc?.numPages ?? pageCount} page{(doc?.numPages ?? pageCount) === 1 ? "" : "s"}
        </span>
      </header>

      {gone && (
        <div className="print-window-banner" role="alert" data-print-document-gone>
          <TriangleAlert size={16} aria-hidden />
          <span>
            This document was closed in Jovrel. Its pages can no longer be printed from
            this window.
          </span>
        </div>
      )}

      {!gone && loadError !== null && (
        <div className="print-window-banner" role="alert" data-print-window-load-error>
          <TriangleAlert size={16} aria-hidden />
          <span>{loadError}</span>
        </div>
      )}

      {!gone && loadError === null && doc === null && (
        <div className="print-window-banner print-window-banner-quiet" data-print-window-loading>
          <span>Loading the document…</span>
        </div>
      )}

      <div className="print-window-panel">
        <PrintPanel print={print} />
      </div>
    </div>
  );
}
