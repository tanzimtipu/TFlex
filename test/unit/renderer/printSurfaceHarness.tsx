// Phase 37 item 17 - the shared print surface harness.
//
// The in-app print modal (`src/renderer/components/PrintDialog.tsx`) was
// REMOVED: every print entry point now opens the standalone print window,
// which renders the shared `PrintPanel` + `usePrintControls` surface. These
// tests drive that SAME surface directly, so the control surface, the live
// preview and every result state stay pinned without the retired modal
// chrome. This is the replacement for mounting `PrintDialog`.
import type { ReactElement } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { PrintPanel } from "../../../src/renderer/components/PrintPanel";
import { usePrintControls } from "../../../src/renderer/components/usePrintControls";
import type {
  PrintJobPayload,
  PrintJobResult,
  PrinterInfo,
  PrintSettings,
} from "../../../src/shared/types";

export interface PrintSurfaceProps {
  active: boolean;
  totalPages: number;
  currentPage: number;
  resolveActiveDoc: () => PDFDocumentProxy | null;
  listPrinters: () => Promise<PrinterInfo[]>;
  printJob: (payload: PrintJobPayload) => Promise<PrintJobResult>;
  onClose: () => void;
  seed?: PrintSettings | null;
  blockedReason?: string | null;
}

/** The shared control surface, exactly as the standalone window renders it. */
export function PrintSurface(props: PrintSurfaceProps): ReactElement {
  const print = usePrintControls({
    active: props.active,
    totalPages: props.totalPages,
    currentPage: props.currentPage,
    resolveActiveDoc: props.resolveActiveDoc,
    listPrinters: props.listPrinters,
    printJob: props.printJob,
    onClose: props.onClose,
    seed: props.seed,
    blockedReason: props.blockedReason,
  });
  return <PrintPanel print={print} />;
}