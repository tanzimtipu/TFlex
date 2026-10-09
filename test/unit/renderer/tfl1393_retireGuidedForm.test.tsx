// @vitest-environment jsdom
//
// TFL-1436 (C2) - regression spec for the guided-form retirement.
//
// The dock "Forms" tile, the Command Palette "forms" row and the fixed
// right-hand guided form-fill panel (`[data-form-panel]`) are gone. The
// on-canvas overlay (FormsOverlay + FormFieldControl) stays and remains the
// only way to view or change a form field.
//
// This mounts the REAL App (DocumentView + PDF.js are the only stubs) and
// drives the check through the DOM:
//   (a) after opening a document, no palette "forms" row and no form panel;
//   (b) opening a new tab leaves the app chrome intact with no React
//       "Maximum update depth" error (the C1 freeze must stay fixed).
//
// It MUST fail on the pre-change tree (the palette "forms" row existed) and
// pass after the retirement.

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
      numPages: 2,
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
import {
  stubRendererEngine,
  stubSeedFormFields,
} from "../../../src/renderer/engine/stubEngine";
import type { FormField } from "../../../src/shared/types";

const SEED_FIELDS: FormField[] = [
  {
    id: "f1",
    name: "Full name",
    page: 1,
    kind: "text",
    rect: { x: 40, y: 40, width: 180, height: 16 },
    value: "",
  },
];

function installStubs(): void {
  const tflex = {
    loadSettings: async (): Promise<unknown> => ({
      ok: true,
      value: structuredClone(DEFAULT_SETTINGS),
    }),
    saveSettings: async (): Promise<unknown> => ({ ok: true }),
    addRecentFile: async (): Promise<unknown> => ({ ok: true }),
    listSamples: async (): Promise<unknown[]> => [],
    openFileDialog: async (): Promise<string> => "C:/fixtures/form.pdf",
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

describe("TFL-1436 - guided form entry points are retired", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach((): void => {
    installDomShims();
    installStubs();
    stubSeedFormFields(SEED_FIELDS);
    const origLoad = stubRendererEngine.loadDocument.bind(stubRendererEngine);
    vi.spyOn(stubRendererEngine, "loadDocument").mockImplementation(
      async (docId, path, password) => {
        stubRendererEngine.registerTab(docId, 2, SEED_FIELDS);
        return origLoad(docId, path, password);
      },
    );
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
    vi.restoreAllMocks();
  });

  it("has no palette forms row, no form panel, and survives a new tab", async () => {
    const errorSpy = vi.spyOn(console, "error");
    act((): void => {
      root.render(<App />);
    });
    await flushAsync();

    // Open the form-bearing document.
    const open = container.querySelector<HTMLElement>("[data-toolbar-open]");
    expect(open).not.toBeNull();
    await act(async (): Promise<void> => {
      open?.click();
      await flushAsync();
    });
    await flushAsync();

    // Open the Command Palette: before the retirement its "forms" row lived
    // here (the tile inside the stubbed DocumentView is not mountable).
    const search = container.querySelector<HTMLElement>("[data-header-tool-search]");
    expect(search).not.toBeNull();
    await act(async (): Promise<void> => {
      search?.click();
      await flushAsync();
    });
    await flushAsync();

    // (a) the guided-form entry points are gone.
    expect(container.querySelector('[data-palette-tool-id="forms"]')).toBeNull();
    expect(container.querySelector('[data-form-panel="true"]')).toBeNull();

    // (b) opening a new tab leaves the app chrome intact.
    const newTab = container.querySelector<HTMLElement>("[data-new-tab]");
    expect(newTab).not.toBeNull();
    await act(async (): Promise<void> => {
      newTab?.click();
      await flushAsync();
    });
    await flushAsync();

    expect(container.querySelector(".app")).not.toBeNull();
    expect(container.querySelector(".titlebar")).not.toBeNull();
    expect(container.innerHTML.length).toBeGreaterThan(0);

    const maxDepth = errorSpy.mock.calls
      .map((c) => String(c[0] ?? ""))
      .filter((m) => /Maximum update depth/i.test(m));
    expect(maxDepth).toEqual([]);
  });
});
