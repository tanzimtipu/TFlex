// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so that
// `act` recognises the test env and stops spamming stderr.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Phase 118 (Drag Drop and Import) - chunk C: every OS file drop routes through
// the ONE intake model instead of opening its first file. Covers:
//   1. a 3-file drop (2 pdf + 1 png) delivers all 3 to `onIntake` in drop order,
//   2. a `text/plain` (in-app page) drag is ignored entirely,
//   3. a pathless / synthetic File fails loud with a truthful error, never throws,
//   4. the drag-active indication toggles on dragenter and clears on
//      drop / leave / a non-Files drag (with the leave-depth guard).

import { describe, expect, it, vi, afterEach } from "vitest";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useOsFileDrop, type OsDropEntry } from "../../../src/renderer/hooks/useOsIntegration";

interface BridgeStub {
  webUtils?: { getPathForFile?: (file: File) => string };
}

function setBridge(bridge: BridgeStub | undefined): void {
  (window as unknown as { tflex?: BridgeStub }).tflex = bridge;
}

/** A DragEvent-shaped Event carrying a plain dataTransfer stub (jsdom does
 *  not implement DataTransfer). `cancelable` lets preventDefault land. */
function dragEvent(
  type: "dragover" | "dragenter" | "dragleave" | "drop",
  types: string[],
  files: File[] = [],
): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "dataTransfer", {
    value: { types, files, dropEffect: "none" },
  });
  return ev;
}

function pdf(name: string): File {
  return new File(["%PDF-1.4"], name, { type: "application/pdf" });
}

function png(name: string): File {
  return new File(["PNG"], name, { type: "image/png" });
}

interface Options {
  onIntake?: (files: OsDropEntry[]) => void;
  onError?: (message: string) => void;
  onDragActiveChange?: (active: boolean) => void;
}

let root: Root | null = null;
let host: HTMLElement | null = null;

function mount(options: Options): void {
  const h = document.createElement("div");
  document.body.appendChild(h);
  const r = createRoot(h);
  act((): void => {
    r.render(
      createElement(function DropHarness(): ReactElement {
        useOsFileDrop({
          onIntake: options.onIntake,
          onError: options.onError ?? ((): void => undefined),
          onDragActiveChange: options.onDragActiveChange,
        });
        return createElement("div", { "data-testid": "drop-host" });
      }),
    );
  });
  root = r;
  host = h;
}

function dispatch(ev: Event): void {
  act((): void => {
    window.dispatchEvent(ev);
  });
}

afterEach((): void => {
  if (root !== null) act((): void => root?.unmount());
  if (host !== null) host.remove();
  root = null;
  host = null;
  setBridge(undefined);
  vi.restoreAllMocks();
});

describe("Phase 118 - OS drop routes every file into the intake model", () => {
  it("delivers 3 dropped files (2 pdf + 1 png) to onIntake in drop order", () => {
    setBridge({
      webUtils: { getPathForFile: (file): string => `C:\\docs\\${file.name}` },
    });
    const onIntake = vi.fn();
    const onError = vi.fn();
    mount({ onIntake, onError });
    const ev = dragEvent("drop", ["Files"], [
      pdf("one.pdf"),
      pdf("two.pdf"),
      png("scan.png"),
    ]);
    dispatch(ev);
    expect(ev.defaultPrevented).toBe(true);
    expect(onIntake).toHaveBeenCalledTimes(1);
    const delivered = onIntake.mock.calls[0]?.[0] as OsDropEntry[];
    expect(delivered.map((entry) => entry.file.name)).toEqual([
      "one.pdf",
      "two.pdf",
      "scan.png",
    ]);
    // DEF-657 - the resolved absolute path travels with each dropped File.
    expect(delivered.map((entry) => entry.path)).toEqual([
      "C:\\docs\\one.pdf",
      "C:\\docs\\two.pdf",
      "C:\\docs\\scan.png",
    ]);
    expect(onError).not.toHaveBeenCalled();
  });

  it("ignores a text/plain (in-app page) drag entirely", () => {
    setBridge({ webUtils: { getPathForFile: (): string => "C:\\docs\\x.pdf" } });
    const onIntake = vi.fn();
    const onError = vi.fn();
    mount({ onIntake, onError });
    const over = dragEvent("dragover", ["text/plain"]);
    const drop = dragEvent("drop", ["text/plain"], [pdf("page.pdf")]);
    dispatch(over);
    dispatch(drop);
    expect(over.defaultPrevented).toBe(false);
    expect(drop.defaultPrevented).toBe(false);
    expect(onIntake).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("surfaces a truthful error for a pathless / synthetic File without throwing", () => {
    setBridge({ webUtils: { getPathForFile: (): string => "" } });
    const onIntake = vi.fn();
    const onError = vi.fn();
    mount({ onIntake, onError });
    const ev = dragEvent("drop", ["Files"], [new File(["x"], "blob")]);
    expect((): void => dispatch(ev)).not.toThrow();
    expect(ev.defaultPrevented).toBe(true);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(String(onError.mock.calls[0]?.[0])).toMatch(/resolve/i);
    expect(onIntake).not.toHaveBeenCalled();
  });
});

describe("Phase 118 - eligible-drag drop indication", () => {
  it("toggles active on file dragenter and clears on the outer dragleave", () => {
    const onDragActiveChange = vi.fn();
    mount({ onIntake: vi.fn(), onDragActiveChange });
    dispatch(dragEvent("dragenter", ["Files"]));
    expect(onDragActiveChange).toHaveBeenLastCalledWith(true);
    // A nested child enter keeps it active; its leave does not clear it yet...
    dispatch(dragEvent("dragenter", ["Files"]));
    dispatch(dragEvent("dragleave", ["Files"]));
    expect(onDragActiveChange).toHaveBeenLastCalledWith(true);
    // ...only the outer leave clears it.
    dispatch(dragEvent("dragleave", ["Files"]));
    expect(onDragActiveChange).toHaveBeenLastCalledWith(false);
  });

  it("clears the indication on drop and on a non-Files drag", () => {
    setBridge({
      webUtils: { getPathForFile: (file): string => `C:\\docs\\${file.name}` },
    });
    const onDragActiveChange = vi.fn();
    const onIntake = vi.fn();
    mount({ onIntake, onDragActiveChange });
    dispatch(dragEvent("dragenter", ["Files"]));
    dispatch(dragEvent("drop", ["Files"], [pdf("a.pdf")]));
    expect(onDragActiveChange).toHaveBeenLastCalledWith(false);
    expect(onIntake).toHaveBeenCalledTimes(1);

    onDragActiveChange.mockClear();
    dispatch(dragEvent("dragenter", ["Files"]));
    expect(onDragActiveChange).toHaveBeenLastCalledWith(true);
    dispatch(dragEvent("dragenter", ["text/plain"]));
    expect(onDragActiveChange).toHaveBeenLastCalledWith(false);
  });
});
