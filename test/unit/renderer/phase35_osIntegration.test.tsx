// @vitest-environment jsdom
// Phase 35 — Windows integration (DEF-295): the OS file-drop handler and the
// OS-open path listener. Both route through the ONE shared open path
// (`openRequestedPath`), so a dropped PDF behaves exactly like one opened
// from the dialog (a normal tab in single mode, ASSIGNED to the focused pane
// in Multi Mode — that assignment is pinned in
// phase35_openRequestedPath.test.ts).
//
// The drop handler reacts ONLY to an OS file drag (`dataTransfer.types`
// includes "Files") and never touches the in-app page-drag DnD (text/plain).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  useOsFileDrop,
  useOsOpenPathRequests,
  isFileDragEvent,
  isPdfFile,
} from "../../../src/renderer/hooks/useOsIntegration";

interface BridgeStub {
  webUtils?: { getPathForFile?: (file: File) => string };
  onOpenPathRequest?: (cb: (path: string) => void) => () => void;
}

function setBridge(bridge: BridgeStub | undefined): void {
  (window as unknown as { tflex?: BridgeStub }).tflex = bridge;
}

/** A DragEvent-shaped Event carrying a plain dataTransfer stub (jsdom does
 *  not implement DataTransfer). `cancelable: true` lets preventDefault land. */
function dragEvent(type: "dragover" | "drop", types: string[], files: File[]): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "dataTransfer", {
    value: { types, files, dropEffect: "none" },
  });
  return ev;
}

function pdf(name = "dropped.pdf"): File {
  return new File(["%PDF-1.4"], name, { type: "application/pdf" });
}
function txt(name = "notes.txt"): File {
  return new File(["hello"], name, { type: "text/plain" });
}

function mountDrop(options: {
  openPath: (p: string) => void | Promise<void>;
  onError: (m: string) => void;
  onNotice?: (m: string) => void;
}): { root: Root; host: HTMLElement } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(
      createElement(function DropHarness(): ReactElement {
        useOsFileDrop(options);
        return createElement("div", { "data-testid": "drop-host" });
      }),
    );
  });
  return { root, host };
}

function dispatch(ev: Event): void {
  act((): void => {
    window.dispatchEvent(ev);
  });
}

let host: HTMLElement | null = null;
let root: Root | null = null;

afterEach((): void => {
  if (root !== null) act((): void => root?.unmount());
  if (host !== null) host.remove();
  root = null;
  host = null;
  setBridge(undefined);
  vi.restoreAllMocks();
});

describe("Phase 35 — OS file drop (DEF-295)", () => {
  beforeEach((): void => {
    setBridge({ webUtils: { getPathForFile: (): string => "C:\\docs\\dropped.pdf" } });
  });

  it("prevents the OS file dragover so Chromium cannot navigate to the file", () => {
    const openPath = vi.fn();
    const m = mountDrop({ openPath, onError: vi.fn() });
    root = m.root;
    host = m.host;
    const ev = dragEvent("dragover", ["Files"], []);
    dispatch(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(openPath).not.toHaveBeenCalled();
  });

  it("leaves a non-file dragover alone (the in-app page drag is untouched)", () => {
    const openPath = vi.fn();
    const m = mountDrop({ openPath, onError: vi.fn() });
    root = m.root;
    host = m.host;
    const ev = dragEvent("dragover", ["text/plain"], []);
    dispatch(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it("prevents the drop, resolves the path and opens it through the shared path", () => {
    const openPath = vi.fn();
    const onError = vi.fn();
    const m = mountDrop({ openPath, onError });
    root = m.root;
    host = m.host;
    const ev = dragEvent("drop", ["Files"], [pdf()]);
    dispatch(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(openPath).toHaveBeenCalledTimes(1);
    expect(openPath).toHaveBeenCalledWith("C:\\docs\\dropped.pdf");
    expect(onError).not.toHaveBeenCalled();
  });

  it("never handles a non-Files drop (no interference with in-app DnD)", () => {
    const openPath = vi.fn();
    const m = mountDrop({ openPath, onError: vi.fn() });
    root = m.root;
    host = m.host;
    const ev = dragEvent("drop", ["text/plain"], [pdf()]);
    dispatch(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(openPath).not.toHaveBeenCalled();
  });

  it("routes a dropped non-PDF through the shared convert-aware path (DEF-418)", () => {
    const openPath = vi.fn();
    const onError = vi.fn();
    const m = mountDrop({ openPath, onError });
    root = m.root;
    host = m.host;
    const ev = dragEvent("drop", ["Files"], [txt()]);
    dispatch(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(openPath).toHaveBeenCalledTimes(1);
    expect(openPath).toHaveBeenCalledWith("C:\\docs\\dropped.pdf");
    expect(onError).not.toHaveBeenCalled();
  });

  it("opens the FIRST of multiple dropped files and reports the rest", () => {
    const openPath = vi.fn();
    const onNotice = vi.fn();
    const m = mountDrop({ openPath, onError: vi.fn(), onNotice });
    root = m.root;
    host = m.host;
    dispatch(dragEvent("drop", ["Files"], [pdf("one.pdf"), pdf("two.pdf"), pdf("three.pdf")]));
    expect(openPath).toHaveBeenCalledTimes(1);
    expect(openPath).toHaveBeenCalledWith("C:\\docs\\dropped.pdf");
    expect(onNotice).toHaveBeenCalledTimes(1);
    expect(String(onNotice.mock.calls[0]?.[0])).toMatch(/first of 3/i);
  });

  it("fails loud when the dropped file has no resolvable path", () => {
    setBridge({ webUtils: { getPathForFile: (): string => "" } });
    const openPath = vi.fn();
    const onError = vi.fn();
    const m = mountDrop({ openPath, onError });
    root = m.root;
    host = m.host;
    dispatch(dragEvent("drop", ["Files"], [pdf()]));
    expect(openPath).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0]?.[0])).toMatch(/resolve/i);
  });

  it("fails loud when the webUtils bridge is absent (older preload)", () => {
    setBridge({});
    const openPath = vi.fn();
    const onError = vi.fn();
    const m = mountDrop({ openPath, onError });
    root = m.root;
    host = m.host;
    dispatch(dragEvent("drop", ["Files"], [pdf()]));
    expect(openPath).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("removes both listeners on unmount", () => {
    const openPath = vi.fn();
    const m = mountDrop({ openPath, onError: vi.fn() });
    act((): void => m.root.unmount());
    root = null;
    host = m.host;
    dispatch(dragEvent("drop", ["Files"], [pdf()]));
    expect(openPath).not.toHaveBeenCalled();
  });
});

describe("Phase 35 — OS open path listener", () => {
  function mountListener(options: {
    openPath: (p: string) => void | Promise<void>;
    onError: (m: string) => void;
  }): { root: Root; host: HTMLElement; push: (path: unknown) => void; unsubscribe: ReturnType<typeof vi.fn> } {
    let captured: ((path: unknown) => void) | null = null;
    const unsubscribe = vi.fn();
    setBridge({
      onOpenPathRequest: (cb): (() => void) => {
        captured = cb as (path: unknown) => void;
        return unsubscribe;
      },
    });
    const h = document.createElement("div");
    document.body.appendChild(h);
    const r = createRoot(h);
    act((): void => {
      r.render(
        createElement(function ListenerHarness(): ReactElement {
          useOsOpenPathRequests(options);
          return createElement("div", { "data-testid": "listener-host" });
        }),
      );
    });
    return {
      root: r,
      host: h,
      push: (path: unknown): void => {
        act((): void => captured?.(path));
      },
      unsubscribe,
    };
  }

  it("routes a pushed path through the shared open path", () => {
    const openPath = vi.fn();
    const onError = vi.fn();
    const m = mountListener({ openPath, onError });
    root = m.root;
    host = m.host;
    m.push("C:\\docs\\from-os.pdf");
    expect(openPath).toHaveBeenCalledTimes(1);
    expect(openPath).toHaveBeenCalledWith("C:\\docs\\from-os.pdf");
    expect(onError).not.toHaveBeenCalled();
  });

  it("fails loud on a malformed payload", () => {
    const openPath = vi.fn();
    const onError = vi.fn();
    const m = mountListener({ openPath, onError });
    root = m.root;
    host = m.host;
    m.push(42);
    m.push("");
    m.push(undefined);
    expect(openPath).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(3);
  });

  it("is a no-op when the channel is absent (older preload)", () => {
    setBridge({});
    const openPath = vi.fn();
    const onError = vi.fn();
    const h = document.createElement("div");
    document.body.appendChild(h);
    const r = createRoot(h);
    expect((): void => {
      act((): void => {
        r.render(
          createElement(function ListenerHarness(): ReactElement {
            useOsOpenPathRequests({ openPath, onError });
            return createElement("div");
          }),
        );
      });
    }).not.toThrow();
    act((): void => r.unmount());
    h.remove();
    expect(openPath).not.toHaveBeenCalled();
  });

  it("unsubscribes on unmount", () => {
    const openPath = vi.fn();
    const m = mountListener({ openPath, onError: vi.fn() });
    act((): void => m.root.unmount());
    root = null;
    host = m.host;
    expect(m.unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe("Phase 35 — drop helpers", () => {
  it("isFileDragEvent is true only for a Files drag", () => {
    expect(isFileDragEvent({ dataTransfer: { types: ["Files"] } as unknown as DataTransfer })).toBe(true);
    expect(isFileDragEvent({ dataTransfer: { types: ["text/plain"] } as unknown as DataTransfer })).toBe(false);
    expect(isFileDragEvent({ dataTransfer: null })).toBe(false);
  });

  it("isPdfFile accepts the PDF mime type or a .pdf name (case-insensitive)", () => {
    expect(isPdfFile(pdf("x.pdf"))).toBe(true);
    expect(isPdfFile(new File(["x"], "REPORT.PDF", { type: "" }))).toBe(true);
    expect(isPdfFile(new File(["x"], "blob", { type: "application/pdf" }))).toBe(true);
    expect(isPdfFile(txt())).toBe(false);
  });
});
