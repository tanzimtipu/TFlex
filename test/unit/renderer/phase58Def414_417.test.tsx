// @vitest-environment jsdom
// Phase 58 — focused regression coverage for two tear-out defects.
//
// DEF-417 — tearing out an EMPTY placeholder tab used to be a silent no-op.
//   The tear-out affordance still arms on an empty tab, so `detachTab` must
//   FAIL LOUD: an in-canvas warning notice and no window call, tab kept.
//
// DEF-414 — tearing out a document with UNSAVED changes used to show the
//   detached window as CLEAN: `openFromBytes` parses the bytes fresh, so the
//   engine reports the adopted document as clean and the origin's dirty state
//   was dropped. The adopted tab must carry the dirty state on BOTH signals
//   the close gate / diagnostics read (tab meta + engineUi mirror).
//
// The pure decisions are pinned directly; the two integration paths are
// driven through the real App (DocumentView + pdf.js + print raster stubbed),
// mirroring def299_emptyTabNewTab.test.tsx.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("../../../src/renderer/components/DocumentView", () => ({
  DocumentView: (): unknown => null,
}));
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

import { adoptedModifiedPatch, App, detachRefusal } from "../../../src/renderer/App";
import { DEFAULT_SETTINGS } from "../../../src/renderer/state/defaults";
import type { TabTransferPayload } from "../../../src/shared/ipc";

type AdoptHandler = (payload: TabTransferPayload) => void;

let adoptHandler: AdoptHandler | null = null;
let detachMock: ReturnType<typeof vi.fn>;

function installStubs(): void {
  adoptHandler = null;
  detachMock = vi.fn(async (): Promise<unknown> => ({ ok: true, windowId: 2 }));
  const tflex = {
    loadSettings: async (): Promise<unknown> => ({
      ok: true,
      value: structuredClone(DEFAULT_SETTINGS),
    }),
    saveSettings: async (): Promise<unknown> => ({ ok: true }),
    addRecentFile: async (): Promise<unknown> => ({ ok: true }),
    listSamples: async (): Promise<unknown[]> => [],
    openFileDialog: async (): Promise<string> => "C:/fixtures/report.pdf",
    loadPdf: async (): Promise<unknown> => ({ ok: true, value: new Uint8Array([1, 2, 3]) }),
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
    tabs: {
      detach: detachMock,
      onAdopt: (cb: AdoptHandler): (() => void) => {
        adoptHandler = cb;
        return (): void => undefined;
      },
      adoptAck: async (): Promise<void> => undefined,
      onDetachResolved: (): (() => void) => (): void => undefined,
      returnToOrigin: async (): Promise<unknown> => ({ ok: true, windowId: 1 }),
      notifyEmpty: async (): Promise<void> => undefined,
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
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
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

function pointer(type: string, clientX: number, clientY: number, pointerId = 1): MouseEvent {
  const e = new MouseEvent(type, { bubbles: true, button: 0, clientX, clientY });
  Object.defineProperty(e, "pointerId", { value: pointerId });
  return e;
}

/** Phase 126 (chunk B1) — the in-canvas notice enters as a collapsed "i" and
 *  commits to the expanded box on a double rAF (`useNoticeCollapse`), so give
 *  that hand-off real time to settle before asserting the box is mounted. */
async function settleNoticeEnter(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise<void>((resolve) => setTimeout(resolve, 60));
  });
  await flushAsync();
}

describe("detachRefusal (DEF-417)", () => {
  it("returns a warning toast when the tab has no document to move", () => {
    expect(detachRefusal(false)).toEqual({
      kind: "warning",
      text: "This tab has no document to move.",
    });
  });

  it("returns null (detach may proceed) when the tab has a document", () => {
    expect(detachRefusal(true)).toBeNull();
  });
});

describe("adoptedModifiedPatch (DEF-414)", () => {
  it("carries BOTH dirty signals when the origin reported modified", () => {
    expect(adoptedModifiedPatch(true)).toEqual({ tabModified: true, engineModified: true });
  });

  it("stays clean for a clean origin tab", () => {
    expect(adoptedModifiedPatch(false)).toEqual({ tabModified: false, engineModified: false });
  });

  it("defaults to clean when the payload flag is missing", () => {
    expect(adoptedModifiedPatch(undefined)).toEqual({
      tabModified: false,
      engineModified: false,
    });
  });
});

describe("Phase 58 tear-out integration (real App)", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach((): void => {
    installDomShims();
    installStubs();
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

  async function bootAndOpenDocument(): Promise<void> {
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

  it("DEF-417: tearing out an empty tab toasts and never calls detach", async () => {
    await bootAndOpenDocument();

    const newTab = container.querySelector<HTMLElement>("[data-new-tab]");
    expect(newTab).not.toBeNull();
    await act(async (): Promise<void> => {
      newTab?.click();
      await flushAsync();
    });
    await flushAsync();

    const diag = (window as unknown as { tflexDiagnostics: () => { activeTabId: string } })
      .tflexDiagnostics();
    const emptyTab = container.querySelector<HTMLElement>(`[data-tab-id='${diag.activeTabId}']`);
    expect(emptyTab).not.toBeNull();
    if (emptyTab === null) return;

    // Arm the tear-out gesture on the empty tab and release well below the
    // strip. `detachTab` runs and must refuse loudly.
    await act(async (): Promise<void> => {
      emptyTab.dispatchEvent(pointer("pointerdown", 100, 10));
      window.dispatchEvent(pointer("pointermove", 100, 200));
      window.dispatchEvent(pointer("pointerup", 100, 200));
      await flushAsync();
    });
    await flushAsync();

    expect(detachMock).not.toHaveBeenCalled();
    // Phase 126 (chunk B1) — the DEF-417 warning now travels the reducer into
    // the in-canvas alert notice (mounted on Home here, since the empty tab
    // keeps the canvas off), never a warning toast.
    await settleNoticeEnter();
    const notice = container.querySelector<HTMLElement>(
      '[data-canvas-alert-notice][data-canvas-alert-tone="warning"]',
    );
    const message = notice?.querySelector<HTMLElement>("[data-canvas-alert-message]");
    expect(message?.textContent).toBe("This tab has no document to move.");
    expect(container.querySelector(".toast-warning")).toBeNull();
    expect(container.querySelector(".toast-error")).toBeNull();
    // The empty tab is kept.
    expect(container.querySelector(`[data-tab-id='${diag.activeTabId}']`)).not.toBeNull();
  });

  it("DEF-414: adopting a modified payload leaves the tab dirty and observable", async () => {
    act((): void => {
      root.render(<App />);
    });
    await flushAsync();
    expect(adoptHandler).not.toBeNull();
    if (adoptHandler === null) return;

    await act(async (): Promise<void> => {
      (adoptHandler as AdoptHandler)({
        title: "report.pdf",
        bytes: new Uint8Array([1, 2, 3]),
        modified: true,
      });
      await flushAsync();
    });
    await flushAsync();

    const diag = (window as unknown as {
      tflexDiagnostics: () => { modified: boolean; tabModified: boolean; openTabs: number };
    }).tflexDiagnostics();
    expect(diag.openTabs).toBe(1);
    expect(diag.tabModified).toBe(true);
    expect(diag.modified).toBe(true);
  });
});
