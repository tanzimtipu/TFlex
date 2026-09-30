// @vitest-environment jsdom
//
// DEF-418 — the OS file-drop handler must route EVERY dropped file with a
// resolvable path through the shared, convert-aware open path
// (`openFromRequest` -> `openPdfFromPath` -> `routeOpenPath`), never a
// PDF-only gate. A non-`.pdf` the convert route cannot take fails loud with a
// truthful message and opens NOTHING (the PDF loader is never called); a
// `.pdf` keeps today's exact fall-through behaviour.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi, afterEach } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useOsFileDrop } from "../../../src/renderer/hooks/useOsIntegration";
import {
  isPdfPath,
  routeOpenPath,
  unsupportedFileMessage,
} from "../../../src/renderer/state/convert";
import type { ConvertSourceInfo } from "../../../src/shared/convert";
import type { TFlexApiConvert } from "../../../src/shared/ipc";

interface BridgeStub {
  webUtils?: { getPathForFile?: (file: File) => string };
}

function setBridge(bridge: BridgeStub | undefined): void {
  (window as unknown as { tflex?: BridgeStub }).tflex = bridge;
}

/** A DragEvent-shaped Event carrying a plain dataTransfer stub (jsdom does
 *  not implement DataTransfer). */
function dragEvent(type: "drop", files: File[]): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "dataTransfer", { value: { types: ["Files"], files } });
  return ev;
}

const INFO: ConvertSourceInfo = { format: "text", label: "Text document", fidelity: "native" };

function fakeApi(
  sourceInfo: TFlexApiConvert["sourceInfo"],
): TFlexApiConvert {
  return {
    sourceInfo,
    toDocument: async () => ({
      ok: true as const,
      value: {
        docId: "doc-1",
        pageCount: 1,
        sourceFormat: "text" as const,
        fidelity: "native" as const,
        warnings: [],
        title: "x",
      },
    }),
    cancel: (): void => undefined,
    onProgress: (): (() => void) => () => undefined,
    csvToDocumentFields: async () => ({
      ok: false as const,
      error: { code: "unsupported-format" as const, message: "unused" },
    }),
  };
}

let root: Root | null = null;
let host: HTMLElement | null = null;

afterEach((): void => {
  if (root !== null) act((): void => root?.unmount());
  if (host !== null) host.remove();
  root = null;
  host = null;
  setBridge(undefined);
  vi.restoreAllMocks();
});

function mountDrop(options: {
  openPath: (p: string) => void | Promise<void>;
  onError: (m: string) => void;
}): void {
  const h = document.createElement("div");
  document.body.appendChild(h);
  const r = createRoot(h);
  act((): void => {
    r.render(
      createElement(function DropHarness(): ReactElement {
        useOsFileDrop(options);
        return createElement("div");
      }),
    );
  });
  root = r;
  host = h;
}

describe("DEF-418 — useOsFileDrop routes non-PDFs through the shared path", () => {
  it("resolves and opens a dropped .cbz via openPath, never the PDF-only error", () => {
    setBridge({ webUtils: { getPathForFile: (): string => "C:\\docs\\phase56-comic.cbz" } });
    const openPath = vi.fn();
    const onError = vi.fn();
    mountDrop({ openPath, onError });
    act((): void => {
      window.dispatchEvent(dragEvent("drop", [new File(["PK"], "phase56-comic.cbz")]));
    });
    expect(openPath).toHaveBeenCalledTimes(1);
    expect(openPath).toHaveBeenCalledWith("C:\\docs\\phase56-comic.cbz");
    expect(onError).not.toHaveBeenCalled();
  });

  it("resolves and opens a dropped .txt via openPath, never the PDF-only error", () => {
    setBridge({ webUtils: { getPathForFile: (): string => "C:\\docs\\sample.txt" } });
    const openPath = vi.fn();
    const onError = vi.fn();
    mountDrop({ openPath, onError });
    act((): void => {
      window.dispatchEvent(
        dragEvent("drop", [new File(["hello"], "sample.txt", { type: "text/plain" })]),
      );
    });
    expect(openPath).toHaveBeenCalledWith("C:\\docs\\sample.txt");
    expect(onError).not.toHaveBeenCalledWith(expect.stringMatching(/not a PDF/i));
  });
});

describe("DEF-418 — routeOpenPath truthful unsupported boundary", () => {
  const failure = (): { ok: false; error: { code: "unsupported-format"; message: string } } => ({
    ok: false,
    error: { code: "unsupported-format", message: "nope" },
  });

  it("a non-PDF whose sourceInfo fails reports unsupported and NEVER calls the PDF loader", async () => {
    const openPdf = vi.fn(async (): Promise<string | null> => "pdf-tab");
    const openConverted = vi.fn(async (): Promise<string | null> => "conv-tab");
    const onUnsupported = vi.fn();
    const api = fakeApi(async () => failure());
    await expect(
      routeOpenPath("C:\\docs\\sample.txt", { api, openPdf, openConverted, onUnsupported }),
    ).resolves.toBeNull();
    expect(openPdf).not.toHaveBeenCalled();
    expect(openConverted).not.toHaveBeenCalled();
    expect(onUnsupported).toHaveBeenCalledWith("C:\\docs\\sample.txt");
  });

  it("a .pdf whose sourceInfo fails still invokes the PDF loader (behaviour unchanged)", async () => {
    const openPdf = vi.fn(async (): Promise<string | null> => "pdf-tab");
    const openConverted = vi.fn(async (): Promise<string | null> => "conv-tab");
    const onUnsupported = vi.fn();
    const api = fakeApi(async () => failure());
    await expect(
      routeOpenPath("C:\\docs\\report.pdf", { api, openPdf, openConverted, onUnsupported }),
    ).resolves.toBe("pdf-tab");
    expect(openPdf).toHaveBeenCalledWith("C:\\docs\\report.pdf");
    expect(onUnsupported).not.toHaveBeenCalled();
  });

  it("an absent convert bridge treats a non-PDF as unsupported and a .pdf via the loader", async () => {
    const openPdf = vi.fn(async (): Promise<string | null> => "pdf-tab");
    const openConverted = vi.fn(async (): Promise<string | null> => "conv-tab");
    const onUnsupported = vi.fn();
    const deps = { api: undefined, openPdf, openConverted, onUnsupported };
    await expect(routeOpenPath("C:\\docs\\x.pptx", deps)).resolves.toBeNull();
    expect(onUnsupported).toHaveBeenCalledWith("C:\\docs\\x.pptx");
    await expect(routeOpenPath("C:\\docs\\x.pdf", deps)).resolves.toBe("pdf-tab");
    expect(openPdf).toHaveBeenCalledWith("C:\\docs\\x.pdf");
  });

  it("a recognised convertible still takes the convert route", async () => {
    const openPdf = vi.fn(async (): Promise<string | null> => "pdf-tab");
    const openConverted = vi.fn(async (): Promise<string | null> => "conv-tab");
    const onUnsupported = vi.fn();
    const api = fakeApi(async () => ({ ok: true, value: INFO }));
    await expect(
      routeOpenPath("C:\\docs\\notes.txt", { api, openPdf, openConverted, onUnsupported }),
    ).resolves.toBe("conv-tab");
    expect(openPdf).not.toHaveBeenCalled();
    expect(onUnsupported).not.toHaveBeenCalled();
  });

  it("isPdfPath is case-insensitive and the unsupported message is truthful", () => {
    expect(isPdfPath("a.pdf")).toBe(true);
    expect(isPdfPath("C:\\x\\REPORT.PDF")).toBe(true);
    expect(isPdfPath("a.txt")).toBe(false);
    expect(unsupportedFileMessage("sample.txt")).toBe(
      '"sample.txt" is not a file type Jovrel can open.',
    );
  });
});
