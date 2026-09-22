// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so that
// `act` recognises the test env and stops spamming stderr.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// DEF-299 regression — clicking the caption "+" (new tab) must NEVER crash
// the renderer. An empty tab has an id but no `openTabs[id]` entry, so the
// App-level `activeTab` is `undefined` (not `null`); the Phase 35 detach
// prop read `activeTab.session` behind a `=== null` guard and threw
// `TypeError: Cannot read properties of undefined (reading 'session')`,
// unmounting the whole tree (blank window; only a relaunch recovered).
//
// This renders the REAL App (DocumentView + the PDF parser are the only
// stubs — the bug lives in App's own render path), opens one document, then
// clicks the "+" and asserts the app chrome survives.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// The document renderer and the PDF.js parse are irrelevant to the empty-tab
// path; stubbing them keeps jsdom out of canvas/pdfjs territory.
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

import { App } from "../../../src/renderer/App";
import { DEFAULT_SETTINGS } from "../../../src/renderer/state/defaults";

function installStubs(): void {
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

/** Flush pending microtasks and one macrotask tick. */
async function flushAsync(): Promise<void> {
  await act(async (): Promise<void> => {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
    await new Promise<void>((r) => setTimeout(r, 0));
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
  });
}

/** Find an element by trying several candidate selectors. */
function pick(container: HTMLElement, selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    const el = container.querySelector<HTMLElement>(selector);
    if (el !== null) return el;
  }
  return null;
}

describe("DEF-299 — caption '+' (new tab) on an empty tab must not crash", () => {
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

  it("opens a document, clicks [data-new-tab], and the app chrome survives", async () => {
    act((): void => {
      root.render(<App />);
    });
    await flushAsync();

    // Boot must have produced the real app chrome.
    expect(pick(container, [".titlebar"])).not.toBeNull();

    // Open one document through the title-bar Open control.
    const open = container.querySelector<HTMLElement>("[data-toolbar-open]");
    expect(open).not.toBeNull();
    await act(async (): Promise<void> => {
      open?.click();
      await flushAsync();
    });
    await flushAsync();

    // With one tab open the "+" affordance is rendered.
    const newTab = container.querySelector<HTMLElement>("[data-new-tab]");
    expect(newTab).not.toBeNull();

    // Click it: an empty tab becomes active. Before the fix this threw
    // `Cannot read properties of undefined (reading 'session')` and unmounted
    // the entire tree.
    await act(async (): Promise<void> => {
      newTab?.click();
      await flushAsync();
    });
    await flushAsync();

    // The renderer survived: the app shell and its controls are still here.
    expect(container.innerHTML.length).toBeGreaterThan(0);
    expect(pick(container, [".titlebar"])).not.toBeNull();
    expect(pick(container, [".app"])).not.toBeNull();
    // The "+" control is still clickable (no blank window).
    expect(container.querySelector("[data-new-tab]")).not.toBeNull();
  });
});