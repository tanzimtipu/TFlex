// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so that
// `act` recognises the test env and stops spamming stderr.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Phase 118 (TFL-1246 / TFL-1230 chunk F) — async intake states, per-item
// errors, keyboard and adaptation.
//
// Pins the chunk-F contract:
//   1. validating -> ready -> converting -> done, driven by the REAL operation
//      (a deferred open), and validating -> failed for a bad input.
//   2. a partial failure keeps the good items `done` and only fails the bad one.
//   3. a cancelled conversion is QUIET: no toast, no tab, no error state.
//   4. Escape closes the transient Activity Shelf surface.
//   5. the tray reorders with Alt+Arrow and removes with Delete.
//   6. a failed row exposes an accessible name and a described error alert.
//   7. intake actions never mark a document dirty or mutate checked content.

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createIntakeModel, type IntakeItem } from "../../../src/renderer/intake/model";
import { detectIntakeItem, type IntakeDetectApi } from "../../../src/renderer/intake/detect";
import { IntakeTray } from "../../../src/renderer/intake/IntakeTray";
import { ActivityShelfPanel } from "../../../src/renderer/components/ActivityShelf";
import { createOperation } from "../../../src/renderer/state/activity";
import { runConvertOpen } from "../../../src/renderer/state/convert";
import { App } from "../../../src/renderer/App";
import { DEFAULT_SETTINGS } from "../../../src/renderer/state/defaults";
import type { ConvertErrorCode, ConvertSourceInfo } from "../../../src/shared/convert";
import type { TFlexApiConvert } from "../../../src/shared/ipc";

// The App-level completion-control spec boots the real App, so the heavy PDF
// surfaces are stubbed exactly as the sibling chunk-D home spec does.
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

function noopCreateFromImages(): Promise<unknown> {
  return Promise.resolve({});
}

function makeItem(overrides: Partial<IntakeItem> = {}): IntakeItem {
  const base: IntakeItem = {
    id: overrides.id ?? `id-${Math.random().toString(36).slice(2)}`,
    name: overrides.name ?? "report.pdf",
    pathOrFile: overrides.pathOrFile ?? "/docs/report.pdf",
    kind: overrides.kind ?? "pdf",
    state: overrides.state ?? "ready",
  };
  if (overrides.error !== undefined) base.error = overrides.error;
  return base;
}

describe("phase118 chunk F — intake states driven by the real operation", () => {
  it("moves validating -> ready -> converting -> done around a real open", async () => {
    const model = createIntakeModel({ mintId: (): string => "id-1" });
    const item = model.add({ pathOrFile: "/docs/report.pdf", name: "report.pdf" });
    expect(item.state).toBe("validating");
    expect(item.kind).toBe("unknown");

    // The caller's REAL detection result decides the kind, never the filename.
    model.classify(item.id, { kind: "pdf" });
    expect(item.state).toBe("ready");

    let release!: () => void;
    const openPdf = vi.fn(
      (): Promise<void> =>
        new Promise<void>((resolve): void => {
          release = resolve;
        }),
    );
    const running = model.dispatch({ openPdf, createFromImages: noopCreateFromImages });
    await Promise.resolve();
    expect(item.state).toBe("converting");
    release();
    await running;
    expect(item.state).toBe("done");
    expect(openPdf).toHaveBeenCalledWith("/docs/report.pdf");
  });

  it("moves a bad input to failed with its truthful error and no open", async () => {
    const model = createIntakeModel({ mintId: (): string => "id-2" });
    const item = model.add({ pathOrFile: "/docs/mystery.xyz", name: "mystery.xyz" });
    model.classify(item.id, {
      kind: "unknown",
      error: '"mystery.xyz" is not a file type Jovrel can open.',
    });
    expect(item.state).toBe("failed");
    expect(item.error).toContain("mystery.xyz");

    const openPdf = vi.fn(async (): Promise<void> => undefined);
    const result = await model.dispatch({ openPdf, createFromImages: noopCreateFromImages });
    expect(openPdf).not.toHaveBeenCalled();
    expect(item.state).toBe("failed");
    expect(result.skipped.map((entry) => entry.id)).toEqual([item.id]);
  });

  it("keeps the good items done through a partial failure", async () => {
    const model = createIntakeModel();
    const bad = model.add({ pathOrFile: "/docs/bad.pdf", name: "bad.pdf" });
    const good = model.add({ pathOrFile: "/docs/good.pdf", name: "good.pdf" });
    model.classify(bad.id, { kind: "pdf" });
    model.classify(good.id, { kind: "pdf" });

    const openPdf = vi.fn(async (path: string): Promise<void> => {
      if (path.includes("bad")) throw new Error("corrupt");
    });
    const result = await model.dispatch({ openPdf, createFromImages: noopCreateFromImages });

    expect(bad.state).toBe("failed");
    expect(bad.error).toBe("corrupt");
    expect(good.state).toBe("done");
    expect(result.opened.map((entry) => entry.id)).toEqual([good.id]);
    expect(result.skipped.map((entry) => entry.id)).toEqual([bad.id]);
    // The successful item stays visible in the queue through the failure.
    expect(model.items().map((entry) => entry.id)).toEqual([bad.id, good.id]);
  });
});

describe("phase118 chunk F — truthful detection, never extension trust", () => {
  const okApi = (value: ConvertSourceInfo): IntakeDetectApi => ({
    sourceInfo: async (): Promise<{ ok: true; value: ConvertSourceInfo }> => ({
      ok: true,
      value,
    }),
  });
  const failApi = (code: ConvertErrorCode): IntakeDetectApi => ({
    sourceInfo: async (): Promise<{
      ok: false;
      error: { code: ConvertErrorCode; message: string };
    }> => ({ ok: false, error: { code, message: code } }),
  });

  it("classifies by real content through sourceInfo, not the extension", async () => {
    const pdf = await detectIntakeItem({ path: "C:\\docs\\a.pdf", name: "a.pdf" });
    expect(pdf.kind).toBe("pdf");

    const image = await detectIntakeItem({
      path: "/x/photo.png",
      name: "photo.png",
      api: okApi({ format: "png", label: "PNG image", fidelity: "native" }),
    });
    expect(image.kind).toBe("image");

    const convertible = await detectIntakeItem({
      path: "/x/notes.docx",
      name: "notes.docx",
      api: okApi({ format: "docx", label: "Document", fidelity: "layout" }),
    });
    expect(convertible.kind).toBe("convertible");
  });

  it("reports a truthful per-item error for an unsupported / unreadable input", async () => {
    const unsupported = await detectIntakeItem({
      path: "/x/blob.xyz",
      name: "blob.xyz",
      api: failApi("unsupported-format"),
    });
    expect(unsupported.kind).toBe("unknown");
    expect(unsupported.error).toContain("blob.xyz");

    const unreadable = await detectIntakeItem({
      path: "/x/scan.png",
      name: "scan.png",
      api: failApi("corrupt"),
    });
    expect(unreadable.kind).toBe("unknown");
    expect(unreadable.error).toContain("scan.png");

    const pathless = await detectIntakeItem({ path: null, name: "dropped.bin" });
    expect(pathless.kind).toBe("unknown");
    expect(pathless.error).toContain("dropped.bin");
  });

  it("keeps a real pdf as pdf even when sourceInfo cannot convert it", async () => {
    const detection = await detectIntakeItem({
      path: "/x/report.pdf",
      name: "report.pdf",
      api: failApi("unsupported-format"),
    });
    expect(detection.kind).toBe("pdf");
    expect(detection.error).toBeUndefined();
  });
});

describe("phase118 chunk F — a cancelled conversion is quiet", () => {
  const cancelledApi = (): TFlexApiConvert =>
    ({
      sourceInfo: async () => ({
        ok: true,
        value: { format: "docx", label: "Document", fidelity: "layout" },
      }),
      toDocument: async () => ({ ok: false, error: { code: "cancelled", message: "cancelled" } }),
      csvToDocumentFields: async () => ({
        ok: false,
        error: { code: "internal", message: "n/a" },
      }),
      cancel: (): void => undefined,
      onProgress: (): (() => void) => (): void => undefined,
    }) as unknown as TFlexApiConvert;

  it("pushes no toast, creates no tab and clears progress on cancel", async () => {
    const pushToast = vi.fn();
    const createTab = vi.fn(async (): Promise<string | null> => "tab-1");
    const onOpened = vi.fn();
    const onProgress = vi.fn();

    const outcome = await runConvertOpen({
      path: "/docs/notes.docx",
      displayName: "notes.docx",
      api: cancelledApi(),
      getDocumentBytes: async () => ({ ok: true, value: new ArrayBuffer(8) }),
      createTab,
      onOpened,
      onProgress,
      pushToast,
    });

    expect(outcome).toEqual({ kind: "cancelled" });
    expect(pushToast).not.toHaveBeenCalled();
    expect(createTab).not.toHaveBeenCalled();
    expect(onOpened).not.toHaveBeenCalled();
    expect(onProgress).toHaveBeenLastCalledWith(null);
  });
});

describe("phase118 chunk F — intake never mutates checked content", () => {
  it("keeps every File instance and its bytes intact through the queue", async () => {
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const file = new File([bytes], "scan.png", { type: "image/png" });
    const model = createIntakeModel();
    const item = model.add({ pathOrFile: file });
    model.classify(item.id, { kind: "image" });

    const received: Array<string | File> = [];
    await model.dispatch({
      openPdf: async (): Promise<void> => undefined,
      createFromImages: async (files): Promise<unknown> => {
        received.push(...files);
        return {};
      },
    });

    // Identity and bytes are byte-for-byte the same instance the user picked.
    expect(received[0]).toBe(file);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
    expect(file.name).toBe("scan.png");

    // Reorder + re-queue never rewrites the File either.
    model.add({ pathOrFile: new File([new Uint8Array([9])], "b.png", { type: "image/png" }) });
    model.reorder(0, 1);
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
  });
});

describe("phase118 chunk F — keyboard and screen-reader surface", () => {
  let cleanup: (() => void) | null = null;

  afterEach((): void => {
    cleanup?.();
    cleanup = null;
  });

  function mount(node: ReactElement): HTMLElement {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    act((): void => {
      root.render(node);
    });
    cleanup = (): void => {
      act((): void => {
        root.unmount();
      });
      container.remove();
    };
    return container;
  }

  it("reorders a focused row with Alt+Arrow and removes with Delete", () => {
    const onMove = vi.fn();
    const onRemove = vi.fn();
    const host = mount(
      <IntakeTray
        items={[makeItem({ id: "one", name: "one.pdf" }), makeItem({ id: "two", name: "two.pdf" })]}
        onMove={onMove}
        onRemove={onRemove}
      />,
    );
    const row = host.querySelector<HTMLLIElement>("[data-intake-row='0']");
    act((): void => {
      row?.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "ArrowDown",
          altKey: true,
          bubbles: true,
          cancelable: true,
        }),
      );
      row?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }),
      );
    });
    expect(onMove).toHaveBeenCalledWith(0, 1);
    expect(onRemove).toHaveBeenCalledWith("one");
  });

  it("exposes an accessible name on a failed row and its described error", () => {
    const host = mount(
      <IntakeTray
        items={[
          makeItem({
            id: "bad",
            name: "bad.xyz",
            kind: "unknown",
            state: "failed",
            error: '"bad.xyz" is not a file type Jovrel can open.',
          }),
        ]}
      />,
    );
    const row = host.querySelector("[data-intake-row='0']");
    expect(row?.getAttribute("aria-label")).toContain("bad.xyz");
    expect(row?.getAttribute("aria-label")).toContain("Failed");
    const error = host.querySelector("[data-intake-error='0']");
    expect(error?.getAttribute("role")).toBe("alert");
    expect(error?.textContent).toContain("bad.xyz");
    expect(row?.getAttribute("aria-describedby")).toBe(error?.id);
  });

  it("marks the tray busy while a row is validating or converting", () => {
    const host = mount(
      <IntakeTray items={[makeItem({ id: "c", name: "c.pdf", state: "converting" })]} />,
    );
    expect(host.querySelector("[data-intake-tray]")?.getAttribute("aria-busy")).toBe("true");
  });

  it("closes the transient Activity surface on Escape", () => {
    const onClose = vi.fn();
    const operation = createOperation({
      id: "op-1",
      document: { docId: "op-1", tabId: "op-1", path: null, displayName: "Intake" },
      task: { name: "Import files", scope: "2 files" },
    });
    mount(
      <ActivityShelfPanel
        operations={[operation]}
        onClose={onClose}
        onCancel={(): void => undefined}
        onAction={(): void => undefined}
      />,
    );
    act((): void => {
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("phase118 chunk F — the ONE completion control (ruling 12)", () => {
  interface TrayRender {
    container: HTMLElement;
    cleanup: () => void;
  }

  function renderTray(
    items: readonly IntakeItem[],
    props: { onOpen?: () => void } = {},
  ): TrayRender {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root: Root = createRoot(container);
    act((): void => {
      root.render(<IntakeTray items={items} onOpen={props.onOpen} />);
    });
    return {
      container,
      cleanup: (): void => {
        act((): void => {
          root.unmount();
        });
        container.remove();
      },
    };
  }

  const openButton = (host: HTMLElement): HTMLButtonElement | null =>
    host.querySelector<HTMLButtonElement>("[data-intake-open]");

  it("renders no completion control on the empty queue", () => {
    const rendered = renderTray([]);
    expect(openButton(rendered.container)).toBeNull();
    rendered.cleanup();
  });

  it("disables the control with no ready item and while the queue is busy", () => {
    const failed = renderTray([makeItem({ id: "f", kind: "unknown", state: "failed" })]);
    expect(openButton(failed.container)?.disabled).toBe(true);
    failed.cleanup();

    const busy = renderTray([
      makeItem({ id: "r", state: "ready" }),
      makeItem({ id: "c", state: "converting" }),
    ]);
    expect(openButton(busy.container)?.disabled).toBe(true);
    busy.cleanup();
  });

  it("enables the control with a ready item and dispatches on click", () => {
    const onOpen = vi.fn();
    const rendered = renderTray([makeItem({ id: "r", state: "ready" })], { onOpen });
    const button = openButton(rendered.container);
    expect(button?.disabled).toBe(false);
    act((): void => {
      button?.click();
    });
    expect(onOpen).toHaveBeenCalledTimes(1);
    rendered.cleanup();
  });
});

function flushMicrotasks(): Promise<void> {
  return act(async (): Promise<void> => {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
  });
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

function installAppStubs(paths: string[]): void {
  (window as unknown as { tflex: unknown }).tflex = {
    loadSettings: async (): Promise<unknown> => ({
      ok: true,
      value: structuredClone(DEFAULT_SETTINGS),
    }),
    saveSettings: async (): Promise<unknown> => ({ ok: true }),
    addRecentFile: async (): Promise<unknown> => ({ ok: true }),
    listSamples: async (): Promise<unknown[]> => [],
    openFilesDialog: async (): Promise<string[]> => paths,
    openFileDialog: async (): Promise<string | null> => null,
    loadPdf: async (): Promise<unknown> => ({ ok: true, value: new Uint8Array([1, 2, 3]) }),
    listPrinters: async (): Promise<unknown[]> => [],
    showInFolder: async (): Promise<unknown> => ({ ok: true }),
    checkMissing: async (): Promise<string[]> => [],
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
}

async function mountApp(): Promise<{ host: HTMLElement; unmount: () => void }> {
  installDomShims();
  const host = document.createElement("div");
  host.id = "root";
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(<App />);
  });
  await flushMicrotasks();
  return {
    host,
    unmount: (): void => {
      act((): void => root.unmount());
      host.remove();
    },
  };
}

describe("phase118 chunk F — the Tray completion control is the ONE dispatch trigger", () => {
  afterEach((): void => {
    (window as unknown as { tflex?: unknown }).tflex = undefined;
    vi.restoreAllMocks();
  });

  it("stages on Open, then opens the queued PDF and clears it on the Tray Open", async () => {
    installAppStubs(["C:\\docs\\one.pdf"]);
    const { host, unmount } = await mountApp();
    try {
      await act(async (): Promise<void> => {
        host.querySelector<HTMLButtonElement>("[data-toolbar-open]")?.click();
      });
      await flushMicrotasks();
      // Staged: the entry point queued the file and did NOT open it.
      expect(host.querySelectorAll("[data-intake-row]").length).toBe(1);
      const open = host.querySelector<HTMLButtonElement>("[data-intake-open]");
      expect(open).not.toBeNull();
      expect(open?.disabled).toBe(false);
      // The ONE completion control dispatches the real open; the success leaves
      // the queue.
      await act(async (): Promise<void> => {
        open?.click();
      });
      await flushMicrotasks();
      expect(host.querySelectorAll("[data-intake-row]").length).toBe(0);
    } finally {
      unmount();
    }
  });
});




