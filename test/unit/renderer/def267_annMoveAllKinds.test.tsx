// @vitest-environment jsdom
//
// DEF-267 (remaining half) — EVERY movable annotation kind persists a move
// as ONE `editAnnotation` geometry patch, with no delete + re-create
// fallback. Phase 30 covered the single-rect kinds (textbox / rect / ellipse
// / callout); the engine now accepts `points` (ink), `from`+`to` (arrow) and
// `at` (note icon / callout leader anchor), so the overlay's
// `geometryPatchFor` builder sends the right keys per kind and
// `issueMoveCommit` never re-creates.
//
//   (a) each kind's move -> exactly ONE `editAnnotation` with the right keys
//       (and NO onDeleteAnnotation / onCreate pair);
//   (b) a zero-gap burst of style clicks immediately after moving a NOTE, an
//       INK stroke and an ARROW composes every field on the SAME id;
//   (c) ONE undo restores each kind's geometry (the op pushes one snapshot);
//   (d) no-change drags emit no op at all.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act, createElement, useRef, useState, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { AnnotationOverlay } from "../../../src/renderer/annotations/AnnotationOverlay";
import { DocumentView, type PersistedViewer } from "../../../src/renderer/components/DocumentView";
import type { InspectorTextSelection } from "../../../src/renderer/components/Inspector";
import {
  applyPatch,
  geometryPatchFor,
  type Annotation,
  type AnnotationPatch,
  type AnnotationToolState,
} from "../../../src/renderer/annotations/model";
import { StubRendererEngine } from "../../../src/renderer/engine/stubEngine";
import type { EngineState } from "../../../src/renderer/engine/types";

if (typeof globalThis.IntersectionObserver === "undefined") {
  class NoopIntersectionObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  (globalThis as { IntersectionObserver: typeof IntersectionObserver }).IntersectionObserver =
    NoopIntersectionObserver as unknown as typeof IntersectionObserver;
}
if (typeof globalThis.ResizeObserver === "undefined") {
  class NoopResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    NoopResizeObserver as unknown as typeof ResizeObserver;
}
Element.prototype.setPointerCapture = function (this: Element): void {
  void this;
};
Element.prototype.releasePointerCapture = function (this: Element): void {
  void this;
};

const NOTE_ANN: Annotation = {
  id: "note-1",
  kind: "note",
  page: 1,
  color: "yellow",
  createdAt: "2026-01-01T00:00:00.000Z",
  at: { x: 60, y: 300 },
  text: "note text",
};

const INK_ANN: Annotation = {
  id: "ink-1",
  kind: "ink",
  page: 1,
  color: "red",
  createdAt: "2026-01-01T00:00:00.000Z",
  points: [
    { x: 10, y: 10 },
    { x: 20, y: 20 },
    { x: 30, y: 15 },
  ],
  width: 3,
};

const ARROW_ANN: Annotation = {
  id: "arrow-1",
  kind: "arrow",
  page: 1,
  color: "green",
  createdAt: "2026-01-01T00:00:00.000Z",
  from: { x: 50, y: 50 },
  to: { x: 200, y: 120 },
};

const CALLOUT_ANN: Annotation = {
  id: "callout-1",
  kind: "callout",
  page: 1,
  color: "blue",
  createdAt: "2026-01-01T00:00:00.000Z",
  rect: { x: 100, y: 100, width: 120, height: 36 },
  at: { x: 50, y: 60 },
  text: "callout text",
};

const SELECT_TOOL: AnnotationToolState = { tool: "select", color: "blue", penWidth: 2 };


// ---------------------------------------------------------------------------
// Harness A — the overlay alone, with a deterministic 800x600 page rect at
// cssScale 1, so a client-pixel drag delta IS the page-point delta (exact
// payload assertions, the same shape the DEF-153/154 and DEF-161 specs use).

interface OverlayHarness {
  host: HTMLElement;
  onEditAnnotation: ReturnType<typeof vi.fn>;
  onDeleteAnnotation: ReturnType<typeof vi.fn>;
  onCreate: ReturnType<typeof vi.fn>;
  cleanup: () => void;
}

function mountOverlay(annotations: Annotation[]): OverlayHarness {
  const host = document.createElement("div");
  host.style.position = "absolute";
  host.style.left = "0px";
  host.style.top = "0px";
  host.style.width = "800px";
  host.style.height = "600px";
  document.body.appendChild(host);
  const root = createRoot(host);
  host.getBoundingClientRect = (): DOMRect => ({
    x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600,
    toJSON: () => ({}),
  });
  const onEditAnnotation = vi.fn();
  const onDeleteAnnotation = vi.fn();
  const onCreate = vi.fn();
  act((): void => {
    root.render(
      createElement(AnnotationOverlay, {
        page: 1,
        widthPt: 612,
        heightPt: 792,
        cssScale: 1,
        annotations,
        tool: SELECT_TOOL,
        flashId: null,
        getTextItems: (): never[] => [],
        onCreate,
        onEditAnnotation,
        onDeleteAnnotation,
        onDisarmTool: (): void => undefined,
      }),
    );
  });
  return {
    host,
    onEditAnnotation,
    onDeleteAnnotation,
    onCreate,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function layerOf(host: HTMLElement): HTMLElement {
  const layer = host.querySelector<HTMLElement>("[data-annotation-layer='1']");
  if (layer === null) throw new Error("annotation layer not found");
  return layer;
}

function pressOn(el: Element, x: number, y: number): void {
  act((): void => {
    el.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1 }),
    );
  });
}

function moveOn(el: Element, x: number, y: number): void {
  act((): void => {
    el.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: x, clientY: y, pointerId: 1 }));
  });
}

function releaseOn(el: Element, x: number, y: number): void {
  act((): void => {
    el.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1 }));
  });
}

function dragSurface(layer: HTMLElement, surface: Element, from: [number, number], to: [number, number]): void {
  pressOn(surface, from[0], from[1]);
  moveOn(layer, to[0], to[1]);
  releaseOn(layer, to[0], to[1]);
}

function clickEl(el: Element): void {
  act((): void => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

/** Open the action bar's colour popover (if it is not already open) and pick
 *  a built-in swatch. Used for the ink / arrow post-move burst: the colour
 *  box is the only per-annotation style patch those kinds have. */
function pickBuiltIn(h: OverlayHarness, name: string): void {
  const selector = `.color-popover [data-palette-built-in='${name}']`;
  let swatch = document.body.querySelector(selector);
  if (swatch === null) {
    const box = h.host.querySelector("[data-ann-color-box]");
    if (box === null) throw new Error("colour box not found");
    clickEl(box);
    swatch = document.body.querySelector(selector);
  }
  if (swatch === null) throw new Error(`swatch ${name} not found`);
  clickEl(swatch);
}

/** All engine ops the overlay issued, in order. */
function opsOf(h: OverlayHarness): Array<{ type: "edit" | "delete" | "create"; id: string; patch?: AnnotationPatch }> {
  const ops: Array<{ type: "edit" | "delete" | "create"; id: string; patch?: AnnotationPatch }> = [];
  for (const c of h.onEditAnnotation.mock.calls) {
    ops.push({ type: "edit", id: c[0] as string, patch: c[1] as AnnotationPatch });
  }
  for (const c of h.onDeleteAnnotation.mock.calls) ops.push({ type: "delete", id: c[0] as string });
  for (const c of h.onCreate.mock.calls) ops.push({ type: "create", id: (c[0] as Annotation).id });
  return ops;
}

// ---------------------------------------------------------------------------
// Harness B — the REAL DocumentView (so the text-properties panel is live)
// plus a queued engine-echo model, copied from the Phase-30 spec: every
// handler queues its echo so the test controls exactly when the IPC
// round-trip lands (the DEF-267 race is "the user clicks faster than IPC").

function makeDocStub(numPages: number): PDFDocumentProxy {
  return {
    numPages,
    async getPage(): Promise<unknown> {
      return {
        view: [0, 0, 612, 792],
        getViewport: (_args: { scale: number }): { width: number; height: number } => ({
          width: 612,
          height: 792,
        }),
        render: (_args: unknown): { promise: Promise<void> } => ({ promise: Promise.resolve() }),
        cleanup: async (): Promise<void> => undefined,
      };
    },
    destroy: async (): Promise<void> => undefined,
  } as unknown as PDFDocumentProxy;
}

const INITIAL_VIEWER: PersistedViewer = {
  zoomMode: "fit-width",
  manualScale: 1,
  currentPage: 1,
  searchOpen: false,
  query: "",
  activeHitIndex: -1,
};

const NOOP = (): void => undefined;

type OpType = "create" | "edit" | "delete";
interface EngineOpRecord {
  type: OpType;
  id: string;
  patch?: AnnotationPatch;
}

type StoredAnn = Annotation & { rect?: { x: number; y: number; width: number; height: number }; text?: string };

interface HostApi {
  ops: EngineOpRecord[];
  flushNext: () => void;
  annotations: () => StoredAnn[];
  /** Phase 38 — the latest text surface the view published upward (the
   *  Inspector's snapshot; the view no longer mounts a panel of its own). */
  latestTextSelection: InspectorTextSelection | null;
}

function makeEngineState(pageCount: number): EngineState {
  return {
    pageCount,
    pageOrder: Array.from({ length: pageCount }, (_, i) => i),
    rotations: Array.from({ length: pageCount }, () => 0),
    deleted: Array.from({ length: pageCount }, () => false),
    modified: false,
    annotations: [],
  };
}

function Host(props: { api: HostApi; initialAnn: Annotation }): ReactElement {
  const [anns, setAnns] = useState<StoredAnn[]>(() => [props.initialAnn]);
  const queueRef = useRef<Array<() => void>>([]);
  const api = props.api;
  api.annotations = (): StoredAnn[] => anns;
  api.flushNext = (): void => {
    const fn = queueRef.current.shift();
    if (fn !== undefined) fn();
  };
  const onCreateAnnotation = (a: Annotation): void => {
    api.ops.push({ type: "create", id: a.id });
    queueRef.current.push(() => setAnns((prev) => [...prev.filter((x) => x.id !== a.id), a]));
  };
  const onEditAnnotation = (id: string, patch: AnnotationPatch): void => {
    api.ops.push({ type: "edit", id, patch });
    queueRef.current.push(() =>
      setAnns((prev) => prev.map((x) => (x.id === id ? applyPatch(x, patch) : x))),
    );
  };
  const onDeleteAnnotation = (id: string): void => {
    api.ops.push({ type: "delete", id });
    queueRef.current.push(() => setAnns((prev) => prev.filter((x) => x.id !== id)));
  };
  return createElement(DocumentView, {
    doc: makeDocStub(1),
    pageCount: 1,
    outline: null,
    initial: INITIAL_VIEWER,
    onPersist: NOOP,
    onDiagnostics: (): void => undefined,
    engineState: makeEngineState(1),
    modified: false,
    canUndo: false,
    saveInPlaceEnabled: false,
    annotations: anns,
    onCreateAnnotation,
    onEditAnnotation,
    onDeleteAnnotation,
    formFields: [],
    signatures: [],
    savedSignatures: [],
    stampAnnotations: [],
    editModeOpen: false,
    onEditModeToggle: NOOP,
    edit: null,
    onTextSelectionChange: (selection): void => {
      api.latestTextSelection = selection as InspectorTextSelection | null;
    },
  });
}

interface ViewHarness {
  host: HTMLElement;
  api: HostApi;
  unmount: () => void;
}

async function mountView(initialAnn: Annotation): Promise<ViewHarness> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const api: HostApi = {
    ops: [],
    flushNext: NOOP,
    annotations: (): StoredAnn[] => [],
    latestTextSelection: null,
  };
  await act(async (): Promise<void> => {
    root.render(createElement(Host, { api, initialAnn }));
    await Promise.resolve();
    await Promise.resolve();
  });
  return {
    host,
    api,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function flushNext(h: ViewHarness): void {
  act((): void => {
    h.api.flushNext();
  });
}

function panelMode(h: ViewHarness): string | null {
  // Phase 38 — the DocumentView publishes the text surface; the Inspector
  // renders it. The harness reads the published snapshot.
  return h.api.latestTextSelection?.mode ?? null;
}

/** Map a panel control hook to the patch it emits (the Inspector instance
 *  renders the SAME component; the harness drives its `onPatch` directly). */
const CONTROL_PATCHES: Record<string, Record<string, unknown>> = {
  "[data-txt-bold]": { bold: true },
  "[data-txt-align-center]": { align: "center" },
  "[data-txt-indent-inc]": { indent: 12 },
};

function clickControl(h: ViewHarness, selector: string): void {
  const snap = h.api.latestTextSelection;
  const patch = CONTROL_PATCHES[selector];
  if (snap === null || patch === undefined) throw new Error(`${selector} not found`);
  act((): void => {
    snap.onPatch(patch as never);
  });
}

// ---------------------------------------------------------------------------
// (a) each kind's move -> ONE editAnnotation with the right keys

describe("DEF-267 (a) — every movable kind persists its move as ONE geometry edit", () => {
  it("NOTE: one `{ at }` edit, no delete + create", () => {
    const h = mountOverlay([NOTE_ANN]);
    try {
      const icon = h.host.querySelector<Element>(".ann-note[data-annotation-id='note-1']");
      if (icon === null) throw new Error("note icon not found");
      dragSurface(layerOf(h.host), icon, [65, 305], [95, 335]);
      expect(opsOf(h)).toEqual([
        { type: "edit", id: "note-1", patch: { at: { x: 90, y: 330 } } },
      ]);
      expect(h.onEditAnnotation).toHaveBeenCalledTimes(1);
      expect(h.onDeleteAnnotation).not.toHaveBeenCalled();
      expect(h.onCreate).not.toHaveBeenCalled();
    } finally {
      h.cleanup();
    }
  });

  it("INK: one `{ points }` edit carrying the shifted stroke, no delete + create", () => {
    const h = mountOverlay([INK_ANN]);
    try {
      const ink = h.host.querySelector<Element>("g.ann-ink[data-annotation-id='ink-1']");
      if (ink === null) throw new Error("ink not found");
      // Press inside the stroke's hit path and drag +10/+10.
      dragSurface(layerOf(h.host), ink, [20, 20], [30, 30]);
      expect(h.onEditAnnotation).toHaveBeenCalledTimes(1);
      expect(h.onEditAnnotation.mock.calls[0]?.[0]).toBe("ink-1");
      expect(h.onEditAnnotation.mock.calls[0]?.[1]).toEqual({
        points: [
          { x: 20, y: 20 },
          { x: 30, y: 30 },
          { x: 40, y: 25 },
        ],
      });
      expect(h.onDeleteAnnotation).not.toHaveBeenCalled();
      expect(h.onCreate).not.toHaveBeenCalled();
    } finally {
      h.cleanup();
    }
  });

  it("ARROW: one `{ from, to }` edit carrying both moved endpoints, no delete + create", () => {
    const h = mountOverlay([ARROW_ANN]);
    try {
      const arrow = h.host.querySelector<Element>("g.ann-arrow[data-annotation-id='arrow-1']");
      if (arrow === null) throw new Error("arrow not found");
      dragSurface(layerOf(h.host), arrow, [100, 80], [110, 90]);
      expect(h.onEditAnnotation).toHaveBeenCalledTimes(1);
      expect(h.onEditAnnotation.mock.calls[0]?.[0]).toBe("arrow-1");
      expect(h.onEditAnnotation.mock.calls[0]?.[1]).toEqual({
        from: { x: 60, y: 60 },
        to: { x: 210, y: 130 },
      });
      expect(h.onDeleteAnnotation).not.toHaveBeenCalled();
      expect(h.onCreate).not.toHaveBeenCalled();
    } finally {
      h.cleanup();
    }
  });

  it("CALLOUT anchor drag: one `{ at }` edit with NO rect (the box stays)", () => {
    const h = mountOverlay([CALLOUT_ANN]);
    try {
      const shaft = h.host.querySelector<Element>(".ann-callout-arrow-hit");
      if (shaft === null) throw new Error("callout arrow hit not found");
      dragSurface(layerOf(h.host), shaft, [75, 80], [95, 100]);
      expect(h.onEditAnnotation).toHaveBeenCalledTimes(1);
      expect(h.onEditAnnotation.mock.calls[0]?.[1]).toEqual({ at: { x: 70, y: 80 } });
      expect(h.onDeleteAnnotation).not.toHaveBeenCalled();
      expect(h.onCreate).not.toHaveBeenCalled();
    } finally {
      h.cleanup();
    }
  });

  it("CALLOUT box drag: one `{ rect }` edit with NO at (the leader stays)", () => {
    const h = mountOverlay([CALLOUT_ANN]);
    try {
      const box = h.host.querySelector<Element>(".ann-callout[data-annotation-id='callout-1']");
      if (box === null) throw new Error("callout box not found");
      dragSurface(layerOf(h.host), box, [120, 120], [150, 140]);
      expect(h.onEditAnnotation).toHaveBeenCalledTimes(1);
      expect(h.onEditAnnotation.mock.calls[0]?.[1]).toEqual({
        rect: { x: 130, y: 120, width: 120, height: 36 },
      });
      expect(h.onDeleteAnnotation).not.toHaveBeenCalled();
      expect(h.onCreate).not.toHaveBeenCalled();
    } finally {
      h.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// (b) a zero-gap burst of style clicks right after a move

describe("DEF-267 (b) — a zero-gap style burst after a move composes on the SAME id", () => {
  it("NOTE: bold + align + indent right after the move all stick, no re-create", async () => {
    const h = await mountView(NOTE_ANN);
    try {
      const icon = h.host.querySelector<Element>(".ann-note[data-annotation-id='note-1']");
      const layer = h.host.querySelector<HTMLElement>("[data-annotation-layer='1']");
      if (icon === null || layer === null) throw new Error("note / layer not found");
      act((): void => {
        icon.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 65, clientY: 305, pointerId: 1 }),
        );
      });
      act((): void => {
        layer.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: 95, clientY: 335, pointerId: 1 }));
      });
      act((): void => {
        layer.dispatchEvent(
          new PointerEvent("pointerup", { bubbles: true, button: 0, clientX: 95, clientY: 335, pointerId: 1 }),
        );
      });
      // The move echo lands (the old delete echo would have cleared the
      // selection and taken the panel with it).
      flushNext(h);
      expect(panelMode(h), "the panel is still on the note").toBe("annotation");

      // Three style clicks back-to-back, each echo landing before the next.
      clickControl(h, "[data-txt-bold]");
      flushNext(h);
      clickControl(h, "[data-txt-align-center]");
      flushNext(h);
      clickControl(h, "[data-txt-indent-inc]");
      flushNext(h);

      const edits = h.api.ops.filter((o) => o.type === "edit");
      expect(edits.length).toBe(4); // the move + the three style clicks
      for (const e of edits) expect(e.id).toBe("note-1");
      // The move is the first op and it is an `at` patch (the exact value is
      // asserted in (a) at cssScale 1; this harness fits the page, so only
      // the move's shape is checked: both axes shifted by the same delta).
      const movedAt = (edits[0]?.patch as { at?: { x: number; y: number } } | undefined)?.at;
      expect(movedAt, "the move sent an `at` patch").toBeDefined();
      if (movedAt === undefined) return;
      expect(movedAt.x).toBeGreaterThan(60);
      expect(movedAt.y).toBeGreaterThan(300);
      expect(movedAt.x - 60).toBeCloseTo(movedAt.y - 300, 3);
      const composed: Record<string, unknown> = {};
      for (const e of edits.slice(1)) Object.assign(composed, e.patch?.style ?? {});
      expect(composed, "all three style fields composed").toEqual({
        bold: true,
        align: "center",
        indent: 12,
      });
      expect(
        h.api.ops.filter((o) => o.type === "delete" || o.type === "create"),
        "no re-create anywhere in the session",
      ).toHaveLength(0);
      // The stored note kept the MOVED anchor and the composed style.
      const stored = h.api.annotations()[0] as StoredAnn & { at?: { x: number; y: number } };
      expect(stored?.at).toEqual(movedAt);
      expect(stored?.style).toEqual(composed);
    } finally {
      h.unmount();
    }
  });

  it("INK: colour clicks right after the move patch the same id and keep the moved stroke", () => {
    const h = mountOverlay([INK_ANN]);
    try {
      const ink = h.host.querySelector<Element>("g.ann-ink[data-annotation-id='ink-1']");
      if (ink === null) throw new Error("ink not found");
      dragSurface(layerOf(h.host), ink, [20, 20], [30, 30]);
      // Zero-gap: the colour clicks fire before any echo could land.
      pickBuiltIn(h, "green");
      pickBuiltIn(h, "blue");

      expect(h.onEditAnnotation).toHaveBeenCalledTimes(3);
      expect(h.onEditAnnotation.mock.calls[0]?.[1]).toEqual({
        points: [
          { x: 20, y: 20 },
          { x: 30, y: 30 },
          { x: 40, y: 25 },
        ],
      });
      expect(h.onEditAnnotation.mock.calls[1]?.[1]).toEqual({ color: "green" });
      expect(h.onEditAnnotation.mock.calls[2]?.[1]).toEqual({ color: "blue" });
      for (const c of h.onEditAnnotation.mock.calls) expect(c[0]).toBe("ink-1");
      expect(h.onDeleteAnnotation).not.toHaveBeenCalled();
      expect(h.onCreate).not.toHaveBeenCalled();
      // The draft still carries the MOVED stroke (the colour click read the
      // moved geometry, not a stale engine copy) and the latest colour.
      const path = h.host.querySelector<SVGPathElement>(
        "g.ann-ink[data-annotation-id='ink-1'] path:not(.ann-ink-hit)",
      );
      expect(path?.getAttribute("d")).toMatch(/^M 20 20/);
      expect(path?.getAttribute("stroke")).toBe("#3b82f6");
    } finally {
      h.cleanup();
    }
  });

  it("ARROW: colour clicks right after the move patch the same id and keep both moved endpoints", () => {
    const h = mountOverlay([ARROW_ANN]);
    try {
      const arrow = h.host.querySelector<Element>("g.ann-arrow[data-annotation-id='arrow-1']");
      if (arrow === null) throw new Error("arrow not found");
      dragSurface(layerOf(h.host), arrow, [100, 80], [110, 90]);
      pickBuiltIn(h, "blue");

      expect(h.onEditAnnotation).toHaveBeenCalledTimes(2);
      expect(h.onEditAnnotation.mock.calls[0]?.[1]).toEqual({
        from: { x: 60, y: 60 },
        to: { x: 210, y: 130 },
      });
      expect(h.onEditAnnotation.mock.calls[1]?.[1]).toEqual({ color: "blue" });
      for (const c of h.onEditAnnotation.mock.calls) expect(c[0]).toBe("arrow-1");
      expect(h.onDeleteAnnotation).not.toHaveBeenCalled();
      expect(h.onCreate).not.toHaveBeenCalled();
      const hit = h.host.querySelector<SVGLineElement>("g.ann-arrow[data-annotation-id='arrow-1'] .ann-arrow-hit");
      expect(hit?.getAttribute("x1")).toBe("60");
      expect(hit?.getAttribute("y1")).toBe("60");
      expect(hit?.getAttribute("x2")).toBe("210");
      expect(hit?.getAttribute("y2")).toBe("130");
    } finally {
      h.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// (c) ONE undo restores each kind's geometry

describe("DEF-267 (c) — ONE undo restores each kind's geometry", () => {
  it("NOTE: the in-place `at` edit pushes exactly one snapshot", async () => {
    const engine = new StubRendererEngine();
    engine.registerTab("doc-1", 1);
    expect((await engine.createAnnotation("doc-1", NOTE_ANN)).ok).toBe(true);
    const edited = await engine.editAnnotation("doc-1", "note-1", { at: { x: 90, y: 330 } });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect((edited.value.annotations[0] as StoredAnn & { at?: { x: number; y: number } })?.at).toEqual({ x: 90, y: 330 });
    const undone = await engine.undo("doc-1");
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(undone.value.annotations.map((a) => a.id)).toEqual(["note-1"]);
    expect((undone.value.annotations[0] as StoredAnn & { at?: { x: number; y: number } })?.at).toEqual({ x: 60, y: 300 });
  });

  it("INK: the in-place `points` edit pushes exactly one snapshot", async () => {
    const engine = new StubRendererEngine();
    engine.registerTab("doc-1", 1);
    expect((await engine.createAnnotation("doc-1", INK_ANN)).ok).toBe(true);
    const moved = [
      { x: 20, y: 20 },
      { x: 30, y: 30 },
      { x: 40, y: 25 },
    ];
    const edited = await engine.editAnnotation("doc-1", "ink-1", { points: moved });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect((edited.value.annotations[0] as StoredAnn & { points?: Array<{ x: number; y: number }> })?.points).toEqual(moved);
    const undone = await engine.undo("doc-1");
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(undone.value.annotations.map((a) => a.id)).toEqual(["ink-1"]);
    expect((undone.value.annotations[0] as StoredAnn & { points?: Array<{ x: number; y: number }> })?.points).toEqual(
      INK_ANN.kind === "ink" ? INK_ANN.points : [],
    );
  });

  it("ARROW: the in-place `from`/`to` edit pushes exactly one snapshot", async () => {
    const engine = new StubRendererEngine();
    engine.registerTab("doc-1", 1);
    expect((await engine.createAnnotation("doc-1", ARROW_ANN)).ok).toBe(true);
    const edited = await engine.editAnnotation("doc-1", "arrow-1", {
      from: { x: 60, y: 60 },
      to: { x: 210, y: 130 },
    });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    const afterEdit = edited.value.annotations[0] as StoredAnn & { from?: { x: number; y: number }; to?: { x: number; y: number } };
    expect(afterEdit?.from).toEqual({ x: 60, y: 60 });
    expect(afterEdit?.to).toEqual({ x: 210, y: 130 });
    const undone = await engine.undo("doc-1");
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(undone.value.annotations.map((a) => a.id)).toEqual(["arrow-1"]);
    const restored = undone.value.annotations[0] as StoredAnn & { from?: { x: number; y: number }; to?: { x: number; y: number } };
    expect(restored?.from).toEqual({ x: 50, y: 50 });
    expect(restored?.to).toEqual({ x: 200, y: 120 });
  });
});

// ---------------------------------------------------------------------------
// (d) no-change drags emit no op

describe("DEF-267 (d) — a no-change drag emits no op", () => {
  it("a click-sized press/release on a note, ink stroke and arrow sends nothing", () => {
    for (const [selector, ann] of [
      [".ann-note[data-annotation-id='note-1']", NOTE_ANN],
      ["g.ann-ink[data-annotation-id='ink-1']", INK_ANN],
      ["g.ann-arrow[data-annotation-id='arrow-1']", ARROW_ANN],
    ] as const) {
      const h = mountOverlay([ann]);
      try {
        const surface = h.host.querySelector<Element>(selector);
        if (surface === null) throw new Error(`${selector} not found`);
        pressOn(surface, 60, 60);
        // Sub-threshold (0.75pt) movement: the gesture is a click, not a move.
        releaseOn(layerOf(h.host), 60.2, 60.2);
        expect(h.onEditAnnotation, `${selector}: no edit`).not.toHaveBeenCalled();
        expect(h.onDeleteAnnotation, `${selector}: no delete`).not.toHaveBeenCalled();
        expect(h.onCreate, `${selector}: no create`).not.toHaveBeenCalled();
      } finally {
        h.cleanup();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// The builder itself: the right keys per kind, and nothing degenerate

describe("DEF-267 — geometryPatchFor returns the per-kind payload (or null)", () => {
  it("box kinds return `{ rect }` only when the rect really changed and is positive", () => {
    const box = CALLOUT_ANN as Annotation & { rect: { x: number; y: number; width: number; height: number } };
    const moved = { ...box, rect: { x: 140, y: 120, width: 120, height: 36 } } as Annotation;
    expect(geometryPatchFor(box, moved)).toEqual({ rect: { x: 140, y: 120, width: 120, height: 36 } });
    expect(geometryPatchFor(box, { ...box } as Annotation)).toBeNull();
    expect(geometryPatchFor(box, { ...box, rect: { x: 1, y: 1, width: 0, height: 36 } } as Annotation)).toBeNull();
    expect(geometryPatchFor(box, { ...box, rect: { x: 1, y: 1, width: 120, height: Number.NaN } } as Annotation)).toBeNull();
  });

  it("ink returns `{ points }` when the stroke changed; a degenerate / NaN stroke is refused", () => {
    const moved = { ...INK_ANN, points: [{ x: 20, y: 20 }, { x: 30, y: 30 }] } as Annotation;
    expect(geometryPatchFor(INK_ANN, moved)).toEqual({ points: [{ x: 20, y: 20 }, { x: 30, y: 30 }] });
    expect(geometryPatchFor(INK_ANN, { ...INK_ANN } as Annotation)).toBeNull();
    expect(geometryPatchFor(INK_ANN, { ...INK_ANN, points: [{ x: 1, y: 1 }] } as Annotation)).toBeNull();
    expect(
      geometryPatchFor(INK_ANN, { ...INK_ANN, points: [{ x: Number.NaN, y: 1 }, { x: 2, y: 2 }] } as Annotation),
    ).toBeNull();
  });

  it("arrow returns `{ from, to }` when either endpoint changed; note returns `{ at }`", () => {
    expect(
      geometryPatchFor(ARROW_ANN, { ...ARROW_ANN, to: { x: 210, y: 130 } } as Annotation),
    ).toEqual({ from: { x: 50, y: 50 }, to: { x: 210, y: 130 } });
    expect(geometryPatchFor(ARROW_ANN, { ...ARROW_ANN } as Annotation)).toBeNull();
    expect(geometryPatchFor(NOTE_ANN, { ...NOTE_ANN, at: { x: 90, y: 330 } } as Annotation)).toEqual({
      at: { x: 90, y: 330 },
    });
    expect(geometryPatchFor(NOTE_ANN, { ...NOTE_ANN } as Annotation)).toBeNull();
    expect(geometryPatchFor(NOTE_ANN, { ...NOTE_ANN, at: { x: 90, y: Number.NaN } } as Annotation)).toBeNull();
  });

  it("callout combines `{ rect, at }` when both moved, and stays kind-strict", () => {
    const both = { ...CALLOUT_ANN, rect: { x: 130, y: 120, width: 120, height: 36 }, at: { x: 70, y: 80 } } as Annotation;
    expect(geometryPatchFor(CALLOUT_ANN, both)).toEqual({
      rect: { x: 130, y: 120, width: 120, height: 36 },
      at: { x: 70, y: 80 },
    });
    expect(geometryPatchFor(CALLOUT_ANN, { ...CALLOUT_ANN, at: { x: 70, y: 80 } } as Annotation)).toEqual({
      at: { x: 70, y: 80 },
    });
    // Markup geometry is multi-rect with no move surface: never expressible.
    const highlight = {
      id: "hl-1", kind: "highlight", page: 1, color: "yellow", createdAt: "x",
      rects: [{ x: 1, y: 1, width: 10, height: 10 }], text: "t",
    } as Annotation;
    expect(geometryPatchFor(highlight, highlight)).toBeNull();
    // A kind swap is never a geometry move.
    expect(geometryPatchFor(NOTE_ANN, INK_ANN)).toBeNull();
  });
});
