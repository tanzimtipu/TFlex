// @vitest-environment jsdom
// Phase 126 (chunk B1) — warning/error feedback is routed into the in-canvas
// `CanvasAlertNotice`; the warning/error toast popups are retired.
//
// The App reducer is the single routing point: `info` / `success` still render
// a toast, `warning` / `error` append to the active tab's alert arrays (deduped
// by exact string). This spec pins every half:
//   1. the pure reducer routing + dedupe (`errorReducer` is exported for tests);
//   2. the real App DEF-417 tear-out, which emits the warning
//      "This tab has no document to move." — that message now renders as
//      [data-canvas-alert-notice][data-canvas-alert-tone="warning"] (on Home,
//      because the empty tab keeps the canvas off), never `.toast-warning`;
//   3. the `DocumentSurfaceColumn` -> `canvasNotices` render path mounts the
//      boxes INSIDE the canvas; info/success still render `.toast-*` and no
//      alert.
// The harness mirrors phase58Def414_417.test.tsx (DocumentView / pdfjs /
// print raster stubbed).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, type ReactElement, type ReactNode } from "react";
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

import {
  App,
  DocumentSurfaceColumn,
  errorReducer,
  type AppErrorState,
} from "../../../src/renderer/App";
import { Toasts, type ToastKind } from "../../../src/renderer/components/Toasts";
import { DEFAULT_SETTINGS } from "../../../src/renderer/state/defaults";
import { setAnimationsEnabledPreference } from "../../../src/renderer/hooks/motionPolicy";

let detachMock: ReturnType<typeof vi.fn>;

function installStubs(): void {
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
      onAdopt: (): (() => void) => (): void => undefined,
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

/** The in-canvas notice enters as a collapsed "i" and commits to the expanded
 *  box on a double rAF (`useNoticeCollapse`). The App boots with animations ON
 *  (it reads `settings.animationsEnabled`), so give that hand-off real time to
 *  settle before asserting the box is mounted. */
async function settleNoticeEnter(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise<void>((resolve) => setTimeout(resolve, 60));
  });
  await flushAsync();
}

const INITIAL_STATE: AppErrorState = {
  toasts: [],
  alerts: { warning: [], error: [] },
  nextId: 1,
};

function push(state: AppErrorState, kind: ToastKind, text: string): AppErrorState {
  return errorReducer(state, { type: "push", toast: { kind, text } });
}

describe("phase 126 — errorReducer routes warning/error away from toasts", () => {
  it("appends a warning into alerts.warning, never toasts", () => {
    const next = push(INITIAL_STATE, "warning", "Watch out.");
    expect(next.alerts.warning).toEqual(["Watch out."]);
    expect(next.alerts.error).toEqual([]);
    expect(next.toasts).toEqual([]);
  });

  it("appends an error into alerts.error, never toasts", () => {
    const next = push(INITIAL_STATE, "error", "Broken.");
    expect(next.alerts.error).toEqual(["Broken."]);
    expect(next.alerts.warning).toEqual([]);
    expect(next.toasts).toEqual([]);
  });

  it("dedupes identical warning/error text by exact string", () => {
    const once = push(INITIAL_STATE, "error", "Broken.");
    const twice = push(once, "error", "Broken.");
    expect(twice.alerts.error).toEqual(["Broken."]);
    const other = push(twice, "error", "Different.");
    expect(other.alerts.error).toEqual(["Broken.", "Different."]);
  });

  it("still appends info/success toasts with increasing ids", () => {
    const info = push(INITIAL_STATE, "info", "Heads up.");
    expect(info.toasts).toEqual([{ id: 1, kind: "info", text: "Heads up." }]);
    expect(info.alerts).toEqual({ warning: [], error: [] });
    const success = push(info, "success", "Done.");
    expect(success.toasts).toEqual([
      { id: 1, kind: "info", text: "Heads up." },
      { id: 2, kind: "success", text: "Done." },
    ]);
  });

  it("dismiss removes only toasts, never alerts", () => {
    const withToast = push(INITIAL_STATE, "info", "Heads up.");
    const withBoth = push(withToast, "error", "Broken.");
    const dismissed = errorReducer(withBoth, { type: "dismiss", id: 1 });
    expect(dismissed.toasts).toEqual([]);
    expect(dismissed.alerts.error).toEqual(["Broken."]);
  });
});

/** Stands in for the real DocumentView: consumes the re-parenting prop and
 *  mounts the notice layer inside a `[data-canvas-overlay]` element. */
function StubDocument({ canvasNotices }: { canvasNotices?: ReactNode }): ReactElement {
  return createElement(
    "div",
    { className: "stub-document", "data-canvas-overlay": true },
    canvasNotices,
  );
}

function mountColumn(alert: { warning: string[]; error: string[] }): {
  host: HTMLElement;
  cleanup: () => void;
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(
      createElement(DocumentSurfaceColumn, {
        document: createElement(StubDocument),
        sourceFormat: undefined,
        conversion: undefined,
        validation: undefined,
        protection: undefined,
        pdf3d: [],
        alert,
        onDismissConversion: (): void => undefined,
        onDismissValidation: (): void => undefined,
        onDismissProtection: (): void => undefined,
        onOpenReadingView: (): void => undefined,
        onOpenComicView: (): void => undefined,
      }),
    );
  });
  return {
    host,
    cleanup(): void {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

describe("phase 126 — DocumentSurfaceColumn mounts the boxes in the canvas", () => {
  beforeEach((): void => {
    setAnimationsEnabledPreference(false);
  });
  afterEach((): void => {
    setAnimationsEnabledPreference(true);
  });

  it("renders the warning box inside [data-canvas-overlay] with its message", () => {
    const view = mountColumn({ warning: ["Watch out."], error: [] });
    try {
      const overlay = view.host.querySelector("[data-canvas-overlay]");
      const notice = view.host.querySelector(
        '[data-canvas-alert-notice][data-canvas-alert-tone="warning"]',
      );
      expect(notice).not.toBeNull();
      expect(overlay?.contains(notice)).toBe(true);
      expect(
        notice?.querySelector("[data-canvas-alert-message]")?.textContent,
      ).toBe("Watch out.");
      expect(view.host.querySelector('[data-canvas-alert-tone="error"]')).toBeNull();
    } finally {
      view.cleanup();
    }
  });

  it("renders deduped error text as exactly one message item for that tone", () => {
    const state = push(push(INITIAL_STATE, "error", "Broken."), "error", "Broken.");
    const view = mountColumn(state.alerts);
    try {
      const items = view.host.querySelectorAll(
        '[data-canvas-alert-tone="error"] [data-canvas-alert-message]',
      );
      expect(items.length).toBe(1);
      expect(items[0]?.textContent).toBe("Broken.");
      expect(view.host.querySelector('[data-canvas-alert-tone="warning"]')).toBeNull();
    } finally {
      view.cleanup();
    }
  });

  it("renders no alert box when both arrays are empty", () => {
    const view = mountColumn({ warning: [], error: [] });
    try {
      expect(view.host.querySelector("[data-canvas-alert-notice]")).toBeNull();
    } finally {
      view.cleanup();
    }
  });
});

describe("phase 126 — info/success toasts render and produce no alert", () => {
  it("renders .toast-info / .toast-success and no [data-canvas-alert-notice]", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    act((): void => {
      root.render(
        createElement(Toasts, {
          items: [
            { id: 1, kind: "info", text: "Heads up." },
            { id: 2, kind: "success", text: "Done." },
          ],
          onDismiss: (): void => undefined,
        }),
      );
    });
    try {
      expect(host.querySelector(".toast-info")).not.toBeNull();
      expect(host.querySelector(".toast-success")).not.toBeNull();
      expect(host.querySelector("[data-canvas-alert-notice]")).toBeNull();
      expect(host.querySelector(".toast-warning")).toBeNull();
      expect(host.querySelector(".toast-error")).toBeNull();
    } finally {
      act((): void => {
        root.unmount();
      });
      host.remove();
    }
  });
});

describe("phase 126 — DEF-417 warning renders the in-canvas alert on Home", () => {
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

  it("tearing out an empty tab shows the warning notice, never a warning toast", async () => {
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

    // Arm the tear-out gesture on the empty tab and release well below the
    // strip; `detachTab` refuses loudly with the DEF-417 warning.
    await act(async (): Promise<void> => {
      emptyTab?.dispatchEvent(pointer("pointerdown", 100, 10));
      window.dispatchEvent(pointer("pointermove", 100, 200));
      window.dispatchEvent(pointer("pointerup", 100, 200));
      await flushAsync();
    });
    await flushAsync();

    expect(detachMock).not.toHaveBeenCalled();
    await settleNoticeEnter();
    const notice = container.querySelector<HTMLElement>(
      '[data-canvas-alert-notice][data-canvas-alert-tone="warning"]',
    );
    expect(notice).not.toBeNull();
    expect(
      notice?.querySelector("[data-canvas-alert-message]")?.textContent,
    ).toBe("This tab has no document to move.");
    // The retired toast surface must not render for the warning.
    expect(container.querySelector(".toast-warning")).toBeNull();
    expect(container.querySelector(".toast-error")).toBeNull();
  });
});
