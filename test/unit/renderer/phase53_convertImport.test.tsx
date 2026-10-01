// @vitest-environment jsdom
//
// Phase 53 (feature I) — the renderer import surface.
//
// Covers: the routing branch (convert vs. the unchanged PDF path), the
// single-docId invariant (toDocument and getDocumentBytes must address the
// SAME engine doc), failure/cancel leaving no tab, progress forwarding +
// unsubscribe-on-settle, and the ConversionNotice / ConversionProgress DOM
// contract e2e asserts on.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  ConversionNotice,
  ConversionProgress,
} from "../../../src/renderer/components/ConversionNotice";
import {
  routeOpenPath,
  runConvertOpen,
  type ConvertOpenDeps,
  type ConvertProgressState,
} from "../../../src/renderer/state/convert";
import type {
  ConvertOpenResult,
  ConvertProgress,
  ConvertSourceInfo,
  ConvertWarning,
} from "../../../src/shared/convert";
import type { TFlexApiConvert } from "../../../src/shared/ipc";

const INFO: ConvertSourceInfo = { format: "text", label: "Text document", fidelity: "native" };

const RESULT: ConvertOpenResult = {
  docId: "doc-1",
  pageCount: 2,
  sourceFormat: "text",
  fidelity: "layout",
  warnings: [],
  title: "notes",
};

function unsupported(): { ok: false; error: { code: "unsupported-format"; message: string } } {
  return { ok: false, error: { code: "unsupported-format", message: "nope" } };
}

/** A minimal TFlexApiConvert fake: only the named members are real. */
function fakeApi(parts: Partial<TFlexApiConvert>): TFlexApiConvert {
  return {
    sourceInfo: parts.sourceInfo ?? (async () => ({ ok: true, value: INFO })),
    toDocument: parts.toDocument ?? (async () => ({ ok: true, value: RESULT })),
    cancel: parts.cancel ?? ((): void => undefined),
    onProgress: parts.onProgress ?? ((): (() => void) => () => undefined),
    // Phase 53 feature G / chunk C — not exercised here; the surface is
    // required by TFlexApiConvert, so the fake carries a stub.
    csvToDocumentFields:
      parts.csvToDocumentFields ??
      (async () => ({
        ok: false as const,
        error: { code: "unsupported-format", message: "not used in these tests" },
      })),
  };
}

/**
 * A bind-sensitive stand-in for `RealEngineAdapter` (DEF-374). Its
 * `getDocumentBytes` is a PROTOTYPE-STYLE method that reads `this.inner`:
 * extract it into a local and call it unbound and `this` is undefined, so it
 * throws exactly as the real adapter does in the app. A mock that is a plain
 * closure cannot express this — that is how DEF-374 slipped through.
 */
interface FakeEngine {
  inner: { read: (id: string) => Promise<{ ok: true; value: ArrayBuffer }> };
  getDocumentBytes(id: string): Promise<{ ok: true; value: ArrayBuffer }>;
}

function fakeEngine(): FakeEngine {
  return {
    inner: { read: async () => ({ ok: true as const, value: new ArrayBuffer(8) }) },
    async getDocumentBytes(id: string) {
      return this.inner.read(id);
    },
  };
}

function runDeps(overrides: Partial<ConvertOpenDeps>): ConvertOpenDeps {
  const engine = fakeEngine();
  return {
    path: "C:/docs/notes.txt",
    displayName: "notes.txt",
    api: fakeApi({}),
    // The deps seam carries the engine's method bound to the engine object:
    // the app must reach the bytes the same way (`engine.getDocumentBytes`).
    getDocumentBytes: (id) => engine.getDocumentBytes(id),
    createTab: async () => "tab-1",
    onOpened: (): void => undefined,
    onProgress: (): void => undefined,
    pushToast: (): void => undefined,
    mintDocId: () => "doc-1",
    ...overrides,
  };
}

describe("phase 53 — routing: convert vs. the unchanged PDF path", () => {
  it("sourceInfo ok takes the convert route and never calls loadPdf", async () => {
    const openPdf = vi.fn(async (): Promise<string | null> => "pdf-tab");
    const openConverted = vi.fn(async (): Promise<string | null> => "conv-tab");
    const api = fakeApi({});
    await expect(routeOpenPath("a.txt", { api, openPdf, openConverted })).resolves.toBe("conv-tab");
    expect(openPdf).not.toHaveBeenCalled();
    expect(openConverted).toHaveBeenCalledWith("a.txt", INFO, api);
  });

  it("unsupported-format falls through to the PDF path", async () => {
    const openPdf = vi.fn(async (): Promise<string | null> => "pdf-tab");
    const openConverted = vi.fn(async (): Promise<string | null> => "conv-tab");
    const api = fakeApi({ sourceInfo: async () => unsupported() });
    await expect(routeOpenPath("a.pdf", { api, openPdf, openConverted })).resolves.toBe("pdf-tab");
    expect(openConverted).not.toHaveBeenCalled();
  });

  it("any other sourceInfo error also falls through (no double toast)", async () => {
    const openPdf = vi.fn(async (): Promise<string | null> => "pdf-tab");
    const openConverted = vi.fn(async (): Promise<string | null> => "conv-tab");
    const api = fakeApi({
      sourceInfo: async () => ({ ok: false, error: { code: "internal", message: "boom" } }),
    });
    await expect(routeOpenPath("a.pdf", { api, openPdf, openConverted })).resolves.toBe("pdf-tab");
    expect(openConverted).not.toHaveBeenCalled();
  });

  it("an absent convert bridge goes straight to the PDF path", async () => {
    const openPdf = vi.fn(async (): Promise<string | null> => "pdf-tab");
    const openConverted = vi.fn(async (): Promise<string | null> => "conv-tab");
    await expect(
      routeOpenPath("a.pdf", { api: undefined, openPdf, openConverted }),
    ).resolves.toBe("pdf-tab");
    expect(openConverted).not.toHaveBeenCalled();
  });
});

describe("phase 53 — runConvertOpen", () => {
  it("mints ONE docId and addresses both IPC calls with it", async () => {
    const seenDocIds: string[] = [];
    const toDocument = vi.fn(async (docId: string, path: string) => {
      seenDocIds.push(docId, path);
      return { ok: true as const, value: RESULT };
    });
    const getDocumentBytes = vi.fn(async (docId: string) => {
      seenDocIds.push(docId);
      return { ok: true as const, value: new ArrayBuffer(8) };
    });
    const api = fakeApi({ toDocument });
    const out = await runConvertOpen(
      runDeps({ api, getDocumentBytes, mintDocId: () => "doc-1" }),
    );
    expect(out).toEqual({ tabId: "tab-1" });
    expect(toDocument).toHaveBeenCalledTimes(1);
    expect(getDocumentBytes).toHaveBeenCalledTimes(1);
    // The engine doc id is the SAME value for the conversion and the bytes
    // read-back: a second id would name no live engine document.
    expect(seenDocIds).toEqual(["doc-1", "C:/docs/notes.txt", "doc-1"]);
  });

  it("subscribes to progress, forwards it filtered by jobId, and unsubscribes on settle", async () => {
    const unsub = vi.fn();
    const seen: (ConvertProgressState | null)[] = [];
    let emit: ((p: ConvertProgress) => void) | null = null;
    const api = fakeApi({
      onProgress: (cb): (() => void) => {
        emit = cb;
        return unsub;
      },
      toDocument: async () => {
        // Emit mid-flight: the matching job, then a foreign one.
        emit?.({ jobId: "doc-1", phase: "Parsing", ratio: 0.5 });
        emit?.({ jobId: "other", phase: "Ignored", ratio: 0.9 });
        return { ok: true as const, value: RESULT };
      },
    });
    await runConvertOpen(runDeps({ api, onProgress: (p) => seen.push(p) }));
    expect(seen).toContainEqual({ docId: "doc-1", phase: "Parsing", ratio: 0.5 });
    expect(seen.some((p) => p !== null && p.phase === "Ignored")).toBe(false);
    expect(seen[seen.length - 1]).toBeNull(); // settled
    expect(unsub).toHaveBeenCalledTimes(1);
  });

  it("a toDocument failure creates no tab and toasts exactly once", async () => {
    const createTab = vi.fn(async () => "tab-1");
    const onOpened = vi.fn();
    const pushToast = vi.fn();
    const api = fakeApi({
      toDocument: async () => ({ ok: false, error: { code: "decode-failed", message: "bad" } }),
    });
    const out = await runConvertOpen(runDeps({ api, createTab, onOpened, pushToast }));
    expect(out).toBeNull();
    expect(createTab).not.toHaveBeenCalled();
    expect(onOpened).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledTimes(1);
    expect(pushToast.mock.calls[0]?.[0]).toBe("error");
    expect(pushToast.mock.calls[0]?.[1]).toContain("notes.txt");
  });

  it("a cancelled conversion is quiet and leaves no tab", async () => {
    const createTab = vi.fn(async () => "tab-1");
    const pushToast = vi.fn();
    const api = fakeApi({
      toDocument: async () => ({ ok: false, error: { code: "cancelled", message: "x" } }),
    });
    await expect(runConvertOpen(runDeps({ api, createTab, pushToast }))).resolves.toBeNull();
    expect(createTab).not.toHaveBeenCalled();
    expect(pushToast).not.toHaveBeenCalled();
  });

  it("bytes that cannot be read fail loud and create no tab", async () => {
    const createTab = vi.fn(async () => "tab-1");
    const pushToast = vi.fn();
    const out = await runConvertOpen(
      runDeps({
        createTab,
        pushToast,
        getDocumentBytes: async () => ({
          ok: false as const,
          error: { code: "engine-error", message: "nope" },
        }),
      }),
    );
    expect(out).toBeNull();
    expect(createTab).not.toHaveBeenCalled();
    expect(pushToast).toHaveBeenCalledTimes(1);
  });

  it("a createTab refusal yields no opened result", async () => {
    const onOpened = vi.fn();
    const out = await runConvertOpen(
      runDeps({ createTab: async () => null, onOpened }),
    );
    expect(out).toBeNull();
    expect(onOpened).not.toHaveBeenCalled();
  });

  it("DEF-374: an UNBOUND engine bytes method throws, the bound call does not", async () => {
    const engine = fakeEngine();
    // Bound (the App pattern): the method keeps `this` -> `this.inner.read`.
    await expect(
      runConvertOpen(runDeps({ getDocumentBytes: (id) => engine.getDocumentBytes(id) })),
    ).resolves.toEqual({ tabId: "tab-1" });
    // Unbound (the bug App.tsx shipped): extracting the prototype method into a
    // local loses `this` and throws, exactly as RealEngineAdapter does.
    const unbound = engine.getDocumentBytes;
    await expect(
      runConvertOpen(runDeps({ getDocumentBytes: (id) => unbound(id) })),
    ).rejects.toThrow(/inner/);
  });
});

// ---------------------------------------------------------------------------
// The card / progress DOM contract e2e asserts on.
// ---------------------------------------------------------------------------

const liveMounts: Root[] = [];

function mount(node: ReturnType<typeof createElement>): HTMLElement {
  while (liveMounts.length > 0) {
    const prev = liveMounts.pop();
    if (prev === undefined) continue;
    act((): void => prev.unmount());
  }
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  liveMounts.push(root);
  act((): void => root.render(node));
  return host;
}

/** Phase 78 (DEF-465): the icon-first notice enter commits to the expanded
 *  card on a double rAF after the icon paint; let those real frames run before
 *  inspecting the mounted DOM. */
async function settleNoticeEnter(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => resolve());
      });
    });
  });
}

const WARNINGS: ConvertWarning[] = [
  { code: "generic-fallback", message: "Rendered with a generic layout." },
  { code: "links-not-live", message: "Links are not clickable.", detail: "https://example.com/x" },
  { code: "no-text-layer", message: "No selectable text layer." },
];

describe("phase 53 — the conversion card DOM contract", () => {
  it("renders every warning (message and detail), never behind a hover", async () => {
    const host = mount(
      createElement(ConversionNotice, {
        notice: {
          sourceLabel: "Text document",
          sourceFormat: "text",
          fidelity: "layout",
          warnings: WARNINGS,
        },
      }),
    );
    await settleNoticeEnter();
    expect(host.querySelector("[data-conversion-notice]")).not.toBeNull();
    expect(host.querySelector("[data-conversion-source]")?.textContent).toBe("Text document");
    expect(host.querySelectorAll("[data-conversion-warning]")).toHaveLength(3);
    expect(host.querySelectorAll("[data-conversion-warning-detail]")).toHaveLength(1);
    expect(host.textContent).toContain("Links are not clickable.");
    expect(host.textContent).toContain("https://example.com/x");
  });

  it("renders a degraded fidelity distinguishably from layout", async () => {
    const degraded = mount(
      createElement(ConversionNotice, {
        notice: {
          sourceLabel: "Comma-separated values",
          sourceFormat: "csv",
          fidelity: "degraded",
          warnings: [],
        },
      }),
    );
    await settleNoticeEnter();
    const el = degraded.querySelector("[data-conversion-notice]");
    expect(el?.getAttribute("data-conversion-fidelity")).toBe("degraded");
    expect(el?.hasAttribute("data-conversion-degraded")).toBe(true);

    const layout = mount(
      createElement(ConversionNotice, {
        notice: {
          sourceLabel: "Text document",
          sourceFormat: "text",
          fidelity: "layout",
          warnings: [],
        },
      }),
    );
    await settleNoticeEnter();
    const el2 = layout.querySelector("[data-conversion-notice]");
    expect(el2?.getAttribute("data-conversion-fidelity")).toBe("layout");
    expect(el2?.hasAttribute("data-conversion-degraded")).toBe(false);
  });

  it("the collapse control replaces the dismiss and never invokes onDismiss", async () => {
    const onDismiss = vi.fn();
    const withHandler = mount(
      createElement(ConversionNotice, {
        notice: {
          sourceLabel: "Text document",
          sourceFormat: "text",
          fidelity: "native",
          warnings: [],
        },
        onDismiss,
      }),
    );
    await settleNoticeEnter();
    // Phase 67: the session-dismiss "×" is gone; a collapse control replaces it.
    expect(withHandler.querySelector("[data-conversion-dismiss]")).toBeNull();
    const collapse = withHandler.querySelector<HTMLElement>("[data-conversion-collapse]");
    expect(collapse).not.toBeNull();
    act((): void => {
      collapse?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    // onDismiss is retained on the interface but no longer invoked.
    expect(onDismiss).not.toHaveBeenCalled();
    expect(withHandler.querySelector("[data-conversion-dismiss]")).toBeNull();
  });
});

describe("phase 53 — the progress affordance", () => {
  it("renders the phase and the ratio, and cancel reports the SAME docId", () => {
    const onCancel = vi.fn();
    const host = mount(
      createElement(ConversionProgress, {
        progress: { docId: "doc-7", phase: "Parsing", ratio: 0.42 },
        onCancel,
      }),
    );
    expect(host.querySelector("[data-conversion-progress]")?.getAttribute("data-conversion-job")).toBe("doc-7");
    expect(host.querySelector("[data-conversion-phase]")?.textContent).toContain("Parsing");
    expect(host.querySelector("[data-conversion-ratio]")?.getAttribute("data-conversion-ratio")).toBe("0.42");
    act((): void => {
      host
        .querySelector<HTMLElement>("[data-conversion-cancel]")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledWith("doc-7");
  });

  it("an unknown ratio shows the indeterminate bar, not a fake percent", () => {
    const host = mount(
      createElement(ConversionProgress, {
        progress: { docId: "doc-8", phase: "Rendering" },
        onCancel: (): void => undefined,
      }),
    );
    const track = host.querySelector(".conversion-progress-track");
    expect(track?.hasAttribute("data-conversion-ratio")).toBe(false);
    expect(host.querySelector(".conversion-progress-bar--indeterminate")).not.toBeNull();
  });
});

describe("phase 53 — App wiring and motion tokens", () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "src", "renderer", "App.tsx"),
    "utf8",
  );
  const cssSource = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "src", "renderer", "styles.css"),
    "utf8",
  );

  it("openPdfFromPath routes through routeOpenPath, PDF body unchanged", () => {
    expect(appSource).toMatch(/routeOpenPath\(path, \{\s*api: window\.tflex\.convert,/);
    expect(appSource).toMatch(/openPdf: openPdfBytesFromPath,/);
    // The unchanged PDF path still begins with the same loadPdf call.
    const idx = appSource.indexOf("const openPdfBytesFromPath = useCallback(");
    expect(idx).toBeGreaterThan(-1);
    expect(appSource.slice(idx, idx + 1200)).toMatch(/const result = await window\.tflex\.loadPdf\(path\);/);
  });

  it("DEF-374: openConvertedFromPath calls the engine bytes method BOUND", () => {
    const start = appSource.indexOf("const openConvertedFromPath = useCallback(");
    expect(start).toBeGreaterThan(-1);
    const end = appSource.indexOf("const openPdfFromPath = useCallback(");
    expect(end).toBeGreaterThan(start);
    const block = appSource.slice(start, end);
    // The getter must call the method ON the engine object. The DEF-374 bug
    // extracted it into a local alias and called it unbound, losing `this`.
    expect(block).toMatch(/engineRef\.current\.getDocumentBytes\(id\)/);
    expect(block).not.toMatch(/=\s*engineRef\.current\.getDocumentBytes\b/);
  });

  it("the cancel control calls convert.cancel with the job id", () => {
    expect(appSource).toMatch(/window\.tflex\.convert\?\.cancel\(docId\)/);
  });

  it("the card's mount animation uses the shared motion tokens", () => {
    const start = cssSource.indexOf(".conversion-notice {");
    expect(start).toBeGreaterThan(-1);
    // Phase 67 grows the box rule (margin / border / radius); widen the window
    // so the shared-token animation declaration is still captured.
    const block = cssSource.slice(start, start + 900);
    expect(block).toMatch(/animation: conversion-notice-in var\(--motion-duration-standard\) var\(--motion-ease-enter\)/);
  });
});


