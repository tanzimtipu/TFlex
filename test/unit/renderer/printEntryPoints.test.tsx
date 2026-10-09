// @vitest-environment jsdom
//
// Phase 37 item 17 - the print entry points open the STANDALONE print window.
//
// The in-app print modal was removed: the title-bar Print icon (`onPrint`),
// File > Print and Ctrl+P all open the standalone print window directly
// (`window.tflex.printWindow.open(context)`). File > Print and Ctrl+P share
// the ONE main-process `print:request` channel (`onPrintRequest`), so this
// file exercises both the header control and that subscription.
//
// Retired here: `printDialogDetach.test.tsx` (its "hand the host the active
// document plus the current settings" contract is now the DEFAULT entry-point
// behaviour pinned below), `printDialogMove.test.tsx` and
// `def283_dialogResizeClamp.test.tsx` (the movable modal chrome and its
// `printDialogDrag` module were deleted with the modal).
//
// This mounts the REAL App; only DocumentView and the PDF parser/renderer are
// stubbed (the same harness as def299_emptyTabNewTab.test.tsx).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("../../../src/renderer/components/DocumentView", async () => {
  const { createElement } = await import("react");
  return {
    // Phase 126 — warning/error feedback renders as the in-canvas
    // `CanvasAlertNotice`. For a document tab the box is handed to DocumentView
    // as `canvasNotices`, so this stand-in must mount them for the assertion
    // (the retired `.toast-text` surface is never produced for an error).
    DocumentView: ({ canvasNotices }: { canvasNotices?: unknown }): unknown =>
      createElement(
        "div",
        { className: "stub-document", "data-canvas-overlay": true },
        canvasNotices as never,
      ),
  };
});
vi.mock("../../../src/renderer/pdf/pdfjs", () => ({
  openPdfDocument: async (): Promise<unknown> => ({
    doc: {
      numPages: 3,
      getPage: async (): Promise<unknown> => ({}),
      destroy: async (): Promise<unknown> => undefined,
    },
  }),
  readOutline: async (): Promise<null> => null,
}));
vi.mock("../../../src/renderer/pdf/printRaster", () => ({
  PRINT_DPI: 200,
  MAX_PRINT_PIXELS: 12000000,
  rasterizePagesForPrint: async (): Promise<unknown[]> => [],
}));

import { App } from "../../../src/renderer/App";
import { DEFAULT_SETTINGS } from "../../../src/renderer/state/defaults";
import { defaultPrintSettings } from "../../../src/renderer/pdf/printSettings";
import type { PrintWindowContext } from "../../../src/shared/types";

type OpenResult = { ok: true; created: boolean } | { ok: false; reason: string };

let printOpen: ReturnType<typeof vi.fn>;
let printRequestCb: (() => void) | null = null;

function installStubs(): void {
  printOpen = vi.fn(async (): Promise<OpenResult> => ({ ok: true, created: true }));
  const tflex = {
    loadSettings: async (): Promise<unknown> => ({
      ok: true,
      value: structuredClone(DEFAULT_SETTINGS),
    }),
    saveSettings: async (): Promise<unknown> => ({ ok: true }),
    addRecentFile: async (): Promise<unknown> => ({ ok: true }),
    listSamples: async (): Promise<unknown[]> => [],
    openFileDialog: async (): Promise<string> => "C:/fixtures/report.pdf",
    loadPdf: async (): Promise<unknown> => ({
      ok: true,
      value: new Uint8Array([1, 2, 3]),
    }),
    listPrinters: async (): Promise<unknown[]> => [],
    closeWindow: (): void => undefined,
    minimizeWindow: (): void => undefined,
    maximizeWindow: (): void => undefined,
    confirmClose: async (): Promise<void> => undefined,
    settings: { changed: (): (() => void) => (): void => undefined },
    menu: {
      onAction: (): (() => void) => (): void => undefined,
      setEnabled: (): void => undefined,
    },
    onPrintRequest: (cb: () => void): (() => void) => {
      printRequestCb = cb;
      return (): void => undefined;
    },
    printWindow: {
      open: printOpen,
      onDocumentGone: (): (() => void) => (): void => undefined,
      notifyDocumentGone: (): void => undefined,
    },
  };
  (window as unknown as { tflex: unknown }).tflex = tflex;
}

function installDomShims(): void {
  if (typeof window.matchMedia !== "function") {
    (window as unknown as { matchMedia: unknown }).matchMedia = (
      query: string,
    ): MediaQueryList =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: (): void => undefined,
        removeListener: (): void => undefined,
        addEventListener: (): void => undefined,
        removeEventListener: (): void => undefined,
        dispatchEvent: (): boolean => false,
      }) as unknown as MediaQueryList;
  }
  if (typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver !== "function") {
    (globalThis as { ResizeObserver: unknown }).ResizeObserver = class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    };
  }
}

async function flushAsync(): Promise<void> {
  await act(async (): Promise<void> => {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
    await new Promise<void>((r) => setTimeout(r, 0));
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
  });
}

/** Phase 126 — the in-canvas notice enters as a collapsed "i" and commits to
 *  the expanded box on a double rAF (`useNoticeCollapse`). The App boots with
 *  animations ON (`DEFAULT_SETTINGS.animationsEnabled`), so give that hand-off
 *  real time to settle before asserting the message is mounted. */
async function settleNoticeEnter(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise<void>((resolve) => setTimeout(resolve, 60));
  });
  await flushAsync();
}

describe("Phase 37 item 17 - print entry points open the standalone window", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach((): void => {
    installDomShims();
    installStubs();
    printRequestCb = null;
    container = document.createElement("div");
    container.id = "root";
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach((): void => {
    act((): void => {
      root.unmount();
    });
    container.remove();
  });

  /** Boot the app and open one real document through the title-bar Open. */
  async function bootWithDocument(): Promise<void> {
    act((): void => {
      root.render(<App />);
    });
    await flushAsync();
    const open = container.querySelector<HTMLElement>("[data-toolbar-open]");
    expect(open).not.toBeNull();
    await act(async (): Promise<void> => {
      open?.click();
      await flushAsync();
    });
    await flushAsync();
  }

  it("opens the standalone window for the title-bar icon and the print:request route", async () => {
    await bootWithDocument();

    // The in-app modal is gone - neither its shell nor its class is mounted.
    expect(container.querySelector("[data-print-dialog]")).toBeNull();
    expect(container.querySelector("[data-print-dialog-shell]")).toBeNull();
    expect(container.querySelector(".print-dialog")).toBeNull();

    // Entry point 1 - the title-bar Print icon.
    const print = container.querySelector<HTMLButtonElement>("[data-print]");
    expect(print).not.toBeNull();
    expect(print?.disabled).toBe(false);
    await act(async (): Promise<void> => {
      print?.click();
      await flushAsync();
    });
    expect(printOpen).toHaveBeenCalledTimes(1);
    const first = printOpen.mock.calls[0]?.[0] as PrintWindowContext;
    expect(first.docId).toEqual(expect.any(String));
    expect(first.docId.length).toBeGreaterThan(0);
    expect(first.documentName).toMatch(/report\.pdf$/i);
    expect(first.pageCount).toBe(3);
    expect(first.settings).toEqual(defaultPrintSettings());

    // Entry points 2 + 3 - File > Print / Ctrl+P arrive on `print:request`.
    expect(printRequestCb).not.toBeNull();
    await act(async (): Promise<void> => {
      printRequestCb?.();
      await flushAsync();
    });
    expect(printOpen).toHaveBeenCalledTimes(2);
    expect(printOpen.mock.calls[1]?.[0]).toEqual(first);

    // Still no in-app modal after two opens.
    expect(container.querySelector("[data-print-dialog-shell]")).toBeNull();
  });

  it("surfaces a window-open refusal through the app's existing error toast", async () => {
    await bootWithDocument();
    printOpen.mockResolvedValueOnce({
      ok: false,
      reason: "The print window context is invalid.",
    });

    const print = container.querySelector<HTMLButtonElement>("[data-print]");
    await act(async (): Promise<void> => {
      print?.click();
      await flushAsync();
    });

    await settleNoticeEnter();
    const toast = container.querySelector<HTMLElement>(
      '[data-canvas-alert-tone="error"] [data-canvas-alert-message]',
    );
    expect(toast).not.toBeNull();
    expect(toast?.textContent).toContain("Could not open the print window");
    expect(toast?.textContent).toContain("The print window context is invalid.");
  });

  it("does nothing when no document is open", async () => {
    act((): void => {
      root.render(<App />);
    });
    await flushAsync();
    await act(async (): Promise<void> => {
      printRequestCb?.();
      await flushAsync();
    });
    expect(printOpen).not.toHaveBeenCalled();
  });

  it("removes Print on an empty placeholder tab and fails loud on a direct request", async () => {
    await bootWithDocument();

    // The "+" makes an EMPTY placeholder tab active while the document tab
    // stays open in the strip.
    const newTab = container.querySelector<HTMLElement>("[data-new-tab]");
    expect(newTab).not.toBeNull();
    await act(async (): Promise<void> => {
      newTab?.click();
      await flushAsync();
    });
    await flushAsync();

    // TFL-1116 R05 — on the Home surface (no document on the active tab) the
    // document-only Print command is ABSENT from the title row, not merely
    // disabled. Its menu / Ctrl+P route still runs, but must fail loud.
    expect(container.querySelector("[data-print]")).toBeNull();

    // A direct Ctrl+P / menu request must still fail loud, not silently no-op.
    await act(async (): Promise<void> => {
      printRequestCb?.();
      await flushAsync();
    });
    expect(printOpen).not.toHaveBeenCalled();
    await settleNoticeEnter();
    const toast = container.querySelector<HTMLElement>(
      '[data-canvas-alert-tone="error"] [data-canvas-alert-message]',
    );
    expect(toast).not.toBeNull();
    expect(toast?.textContent).toContain("Open a document to print");
  });
});