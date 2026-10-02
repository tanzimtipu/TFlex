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
  PrintPreset,
  PrinterInfo,
  PrintSettings,
} from "../../../src/shared/types";

/** Stable no-op preset seams: the hook's load effect is keyed on the
 *  `loadPresets` identity, so a fresh inline default each render would loop. */
const NO_PRESETS = async (): Promise<PrintPreset[]> => [];
const NOOP_SAVE_PRESETS = async (): Promise<void> => undefined;

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
  loadPresets?: () => Promise<PrintPreset[]>;
  savePresets?: (presets: PrintPreset[]) => Promise<void>;
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
    loadPresets: props.loadPresets ?? NO_PRESETS,
    savePresets: props.savePresets ?? NOOP_SAVE_PRESETS,
  });
  return <PrintPanel print={print} />;
}