// @vitest-environment jsdom
//
// Phase 30 — the annotation GEOMETRY change rides `editAnnotation({ rect })`.
//
// DEF-262's auto-grow and the Phase-28 move used to persist geometry as
// delete + re-create. The re-create re-created the annotation and fired a
// fresh selection event asynchronously, so a zero-gap burst of style clicks
// on a just-grown annotation could read a stale (or already cleared)
// selection and drop a field. These tests mount the REAL DocumentView (same
// harness shape as def257) plus a queued engine-echo model so the async
// round-trip is deterministic:
//
//   (a) the grow commit is ONE `editAnnotation` carrying `text` + `rect`
//       (no delete + create pair);
//   (b) the committed MOVE does the same (one `rect` edit);
//   (c) a zero-gap burst of style clicks on a just-grown annotation composes
//       ALL four fields (the race is gone);
//   (d) ONE undo reverts the geometry change (the op pushes exactly one
//       snapshot).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it } from "vitest";
import { act, createElement, useRef, useState, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { DocumentView, type PersistedViewer } from "../../../src/renderer/components/DocumentView";
import {
  applyPatch,
  isPositiveAnnRect,
  rectGeometryPatch,
  type Annotation,
} from "../../../src/renderer/annotations/model";
import {
  annTextInsetPt,
  annTextMaxHeightPt,
  layoutAnnTextBox,
} from "../../../src/renderer/annotations/annTextLayout";
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
        render: (_args: unknown): { promise: Promise<void> } => ({
          promise: Promise.resolve(),
        }),
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

/** The committed annotation the panel grows. Its one-line rect cannot hold
 *  the multi-line text below, so the commit MUST carry a grown rect. */
const SHORT_TEXT = "one line";
const LONG_TEXT = "The quick brown fox jumps over the lazy dog and keeps running";

function makeAnn(overrides: Partial<Annotation> = {}): Annotation {
  return {
    id: "ann-1",
    kind: "textbox",
    page: 1,
    color: "blue",
    createdAt: "2026-01-01T00:00:00.000Z",
    rect: { x: 100, y: 100, width: 120, height: 40 },
    text: SHORT_TEXT,
    ...overrides,
  } as Annotation;
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

type OpType = "create" | "edit" | "delete";
interface EngineOpRecord {
  type: OpType;
  id: string;
  patch?: import("../../../src/renderer/annotations/model").AnnotationPatch;
}

/** The engine-echo view of an annotation, widened so the assertions can read
 *  the geometry / text / style the union's per-kind members carry. */
type StoredAnn = Annotation & {
  rect?: { x: number; y: number; width: number; height: number };
  text?: string;
  style?: import("../../../src/shared/types").AnnTextStyle;
};

interface HostApi {
  ops: EngineOpRecord[];
  /** Land the NEXT queued engine echo — the async IPC round-trip. */
  flushNext: () => void;
  /** The renderer's current annotation list (what the overlay draws). */
  annotations: () => StoredAnn[];
}

/** The tab host: owns the annotation list App would own AND a FIFO of
 *  pending engine echoes. Every handler queues its echo instead of applying
 *  it immediately, so the test controls exactly when the round-trip lands
 *  (the real race is "the user clicks faster than the IPC"). */
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
  const onEditAnnotation = (
    id: string,
    patch: import("../../../src/renderer/annotations/model").AnnotationPatch,
  ): void => {
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
  });
}

interface Harness {
  host: HTMLElement;
  api: HostApi;
  unmount: () => void;
}

async function mountView(initialAnn: Annotation): Promise<Harness> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const api: HostApi = { ops: [], flushNext: NOOP, annotations: (): StoredAnn[] => [] };
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

/** Land the next queued engine echo (inside act, like the IPC resolving). */
function flushNext(h: Harness): void {
  act((): void => {
    h.api.flushNext();
  });
}

/** Select the committed textbox: a press on its surface selects it and the
 *  host's selection report opens the panel in annotation mode. */
function selectAnn(h: Harness): void {
  const surface = h.host.querySelector<Element>(".ann-textbox[data-annotation-id='ann-1']");
  if (surface === null) throw new Error("textbox surface not found");
  act((): void => {
    surface.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 110, clientY: 110, pointerId: 1 }),
    );
  });
}

function panelMode(h: Harness): string | null {
  return h.host.querySelector("[data-text-panel]")?.getAttribute("data-text-panel-mode") ?? null;
}

function setTextarea(el: HTMLTextAreaElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  act((): void => {
    setter?.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Type into the panel's Text field, then blur it: the session commits. */
function typeAndCommit(h: Harness, text: string): void {
  const ta = h.host.querySelector<HTMLTextAreaElement>("[data-txt-text]");
  if (ta === null) throw new Error("[data-txt-text] not found");
  setTextarea(ta, text);
  act((): void => {
    ta.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

function clickControl(h: Harness, selector: string): void {
  const btn = h.host.querySelector<HTMLButtonElement>(selector);
  if (btn === null) throw new Error(`${selector} not found`);
  act((): void => {
    btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  });
  act((): void => {
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function editsOf(h: Harness): EngineOpRecord[] {
  return h.api.ops.filter((o) => o.type === "edit");
}

/** The deterministic jsdom measure fallback (`measureTextWidthCss`). */
const jsdomMeasure = (t: string, s: number): number => t.length * s * 0.55;

describe("Phase 30 (a) — the auto-grow persists with ONE editAnnotation carrying `rect`", () => {
  it("the commit sends text + the grown rect, never a delete + create pair", async () => {
    const h = await mountView(makeAnn());
    try {
      selectAnn(h);
      expect(panelMode(h), "the panel opened on the selected annotation").toBe("annotation");
      typeAndCommit(h, LONG_TEXT);

      // ONE op, and it is an edit of the SAME id.
      expect(h.api.ops.filter((o) => o.type === "delete")).toHaveLength(0);
      expect(h.api.ops.filter((o) => o.type === "create")).toHaveLength(0);
      const edits = editsOf(h);
      expect(edits).toHaveLength(1);
      expect(edits[0]?.id).toBe("ann-1");
      const patch = edits[0]?.patch ?? {};
      expect(patch.text).toBe(LONG_TEXT);
      const rect = patch.rect;
      expect(rect, "the commit carries the grown rect").toBeDefined();
      if (rect === undefined) return;
      // The box's x/y/width are preserved; only the height grows.
      expect({ x: rect.x, y: rect.y, width: rect.width }).toEqual({ x: 100, y: 100, width: 120 });
      // The persisted height is exactly the documented layout rule's.
      const layout = layoutAnnTextBox({
        text: LONG_TEXT,
        style: undefined,
        boxWidthPt: 120,
        boxHeightPt: 40,
        insetPt: annTextInsetPt("textbox"),
        maxHeightPt: annTextMaxHeightPt(792, 100),
        measure: jsdomMeasure,
      });
      expect(rect.height).toBeCloseTo(layout.heightPt, 6);
      expect(rect.height).toBeGreaterThan(40);

      // The echo lands: the annotation is still the SAME id, with the new
      // text and geometry (an in-place op, not a re-created copy).
      flushNext(h);
      expect(h.api.annotations().map((a) => a.id)).toEqual(["ann-1"]);
      expect(h.api.annotations()[0]?.text).toBe(LONG_TEXT);
      expect(h.api.annotations()[0]?.rect?.height).toBeCloseTo(layout.heightPt, 6);
    } finally {
      h.unmount();
    }
  });
});

describe("Phase 30 (b) — the committed MOVE is the same single `rect` edit", () => {
  it("dragging the committed textbox sends one rect edit and no delete + create", async () => {
    const h = await mountView(makeAnn());
    try {
      selectAnn(h);
      const surface = h.host.querySelector<Element>(".ann-textbox[data-annotation-id='ann-1']");
      const layer = h.host.querySelector<HTMLElement>("[data-annotation-layer='1']");
      if (surface === null || layer === null) throw new Error("overlay surface not found");
      act((): void => {
        surface.dispatchEvent(
          new PointerEvent("pointerdown", { bubbles: true, button: 0, clientX: 110, clientY: 110, pointerId: 1 }),
        );
      });
      act((): void => {
        layer.dispatchEvent(
          new PointerEvent("pointermove", { bubbles: true, clientX: 150, clientY: 130, pointerId: 1 }),
        );
      });
      act((): void => {
        layer.dispatchEvent(
          new PointerEvent("pointerup", { bubbles: true, button: 0, clientX: 150, clientY: 130, pointerId: 1 }),
        );
      });
      const edits = editsOf(h);
      expect(edits).toHaveLength(1);
      expect(edits[0]?.id).toBe("ann-1");
      const rect = edits[0]?.patch?.rect;
      expect(rect, "the move carries the rect").toBeDefined();
      if (rect === undefined) return;
      // The box keeps its size and shifts by the drag delta (the harness's
      // page scale makes the absolute delta scale-dependent, so the shape
      // of the move is asserted: same 2:1 ratio as the +40/+20 drag).
      expect({ width: rect.width, height: rect.height }).toEqual({ width: 120, height: 40 });
      expect(rect.x).toBeGreaterThan(100);
      expect(rect.y).toBeGreaterThan(100);
      expect(rect.x - 100).toBeCloseTo((rect.y - 100) * 2, 3);
      expect(h.api.ops.filter((o) => o.type !== "edit")).toHaveLength(0);
      // The selection (and therefore the panel) survives the commit.
      expect(panelMode(h)).toBe("annotation");
    } finally {
      h.unmount();
    }
  });
});

describe("Phase 30 (c) — a zero-gap burst of style clicks after a grow composes ALL fields", () => {
  it("bold + align + list + indent all stick, with no re-create in the burst", async () => {
    const h = await mountView(makeAnn());
    try {
      selectAnn(h);
      typeAndCommit(h, LONG_TEXT);
      // The grow commit's echo lands. With the old delete + re-create this
      // was the DELETE echo: the annotation vanished, the selection report
      // cleared, and the panel (and every follow-up click's route) went
      // with it.
      flushNext(h);
      expect(panelMode(h), "the panel is still on the annotation").toBe("annotation");

      // Four style clicks back-to-back, with each op's echo landing before
      // the next click (the real race window) and no settle delay.
      clickControl(h, "[data-txt-bold]");
      flushNext(h);
      clickControl(h, "[data-txt-align-center]");
      flushNext(h);
      clickControl(h, "[data-txt-list-bullet]");
      flushNext(h);
      clickControl(h, "[data-txt-indent-inc]");
      flushNext(h);

      // Every click reached the engine, all for the SAME annotation, and
      // the composed style carries ALL four fields.
      const edits = editsOf(h);
      const composed: Record<string, unknown> = {};
      for (const e of edits.slice(1)) Object.assign(composed, e.patch?.style ?? {});
      expect(composed, "all four fields composed").toEqual({
        bold: true,
        align: "center",
        list: "bullet",
        indent: 12,
      });
      expect(edits).toHaveLength(5); // the grow commit + the four clicks
      for (const e of edits) expect(e.id).toBe("ann-1");
      expect(
        h.api.ops.filter((o) => o.type === "delete" || o.type === "create"),
        "no re-create anywhere in the session",
      ).toHaveLength(0);
      // Every geometry patch sent is a positive-size rect that keeps the
      // box's width (a degenerate drag / NaN never leaves the renderer).
      for (const e of edits) {
        const r = e.patch?.rect;
        if (r === undefined) continue;
        expect(isPositiveAnnRect(r)).toBe(true);
        expect(r.width).toBe(120);
      }
      // The stored annotation kept its grown geometry and the composed
      // style, and the panel is still open on it.
      const stored = h.api.annotations()[0];
      expect(stored?.style).toEqual(composed);
      expect(stored?.rect?.height).toBeGreaterThan(40);
      expect(panelMode(h)).toBe("annotation");
    } finally {
      h.unmount();
    }
  });
});

describe("Phase 30 (d) — ONE undo reverts the geometry change", () => {
  it("the in-place rect edit pushes exactly one snapshot", async () => {
    const engine = new StubRendererEngine();
    engine.registerTab("doc-1", 1);
    const created = await engine.createAnnotation("doc-1", makeAnn());
    expect(created.ok).toBe(true);
    const grown = { x: 100, y: 100, width: 120, height: 180 };
    const edited = await engine.editAnnotation("doc-1", "ann-1", { text: LONG_TEXT, rect: grown });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    expect((edited.value.annotations[0] as StoredAnn | undefined)?.rect).toEqual(grown);

    // ONE undo restores the pre-edit geometry AND the pre-edit text — and
    // the annotation is still there (the op never deleted it).
    const undone = await engine.undo("doc-1");
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(undone.value.annotations.map((a) => a.id)).toEqual(["ann-1"]);
    const stored = undone.value.annotations[0] as StoredAnn | undefined;
    expect(stored?.rect).toEqual({ x: 100, y: 100, width: 120, height: 40 });
    expect(stored?.text).toBe(SHORT_TEXT);
  });
});

describe("Phase 30 — the geometry patch is validated before it is sent", () => {
  it("rejects a degenerate / NaN rect and a kind whose geometry is not one rect", () => {
    const ann = makeAnn();
    const moved = { ...ann, rect: { x: 140, y: 120, width: 120, height: 40 } } as Annotation;
    expect(rectGeometryPatch(ann, moved)).toEqual({ x: 140, y: 120, width: 120, height: 40 });
    // Unchanged geometry: nothing to send.
    expect(rectGeometryPatch(ann, { ...ann } as Annotation)).toBeNull();
    // Zero / negative / NaN sizes are never forwarded.
    expect(rectGeometryPatch(ann, { ...ann, rect: { x: 1, y: 1, width: 0, height: 40 } } as Annotation)).toBeNull();
    expect(rectGeometryPatch(ann, { ...ann, rect: { x: 1, y: 1, width: 120, height: 0 } } as Annotation)).toBeNull();
    expect(rectGeometryPatch(ann, { ...ann, rect: { x: 1, y: 1, width: -5, height: 40 } } as Annotation)).toBeNull();
    expect(rectGeometryPatch(ann, { ...ann, rect: { x: Number.NaN, y: 1, width: 120, height: 40 } } as Annotation)).toBeNull();
    expect(isPositiveAnnRect({ x: 0, y: 0, width: 1, height: 1 })).toBe(true);
    expect(isPositiveAnnRect({ x: 0, y: 0, width: 0, height: 1 })).toBe(false);
    // A note's geometry is its `at` anchor and an ink stroke's is `points`:
    // neither is expressible as one rect, so no patch is produced.
    const note = { id: "n", kind: "note", page: 1, color: "yellow", createdAt: "x", at: { x: 1, y: 2 }, text: "t" } as Annotation;
    const movedNote = { ...note, at: { x: 11, y: 12 } } as Annotation;
    expect(rectGeometryPatch(note, movedNote)).toBeNull();
    const ink = { id: "i", kind: "ink", page: 1, color: "red", createdAt: "x", points: [{ x: 1, y: 1 }, { x: 2, y: 2 }], width: 3 } as Annotation;
    expect(rectGeometryPatch(ink, { ...ink, points: [{ x: 5, y: 5 }, { x: 6, y: 6 }] } as Annotation)).toBeNull();
  });
});

