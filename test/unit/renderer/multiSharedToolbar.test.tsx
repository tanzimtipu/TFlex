// @vitest-environment jsdom
//
// Phase 33 (chunk 4) — ONE shared toolbar in Multi Mode.
//
// The workspace shows a single toolbar (the same CommandBar + annotation
// group single mode shows) instead of one per pane. These tests pin the
// contract:
//   - exactly ONE set of toolbar controls renders in the stage, and the
//     per-pane rows are absent (assert counts, not per-pane duplicates);
//   - arming a tool in the shared bar arms BOTH panes;
//   - an interaction in pane A applies the tool to A and one in pane B to B;
//   - disarming (from the bar OR from a pane's own Escape) disarms both;
//   - the armed-state display follows the focused pane;
//   - single mode still renders its own toolbar exactly as before.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act, createElement, useMemo, useState } from "react";
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { DocumentView } from "../../../src/renderer/components/DocumentView";
import { DocumentStage, type StageTab } from "../../../src/renderer/components/MultiPane";
import { MultiToolbar } from "../../../src/renderer/components/MultiToolbar";
import { SharedToolController } from "../../../src/renderer/components/multiToolController";
import { type MultiModeState, type PaneId } from "../../../src/renderer/state/multiMode";
import type { EngineState } from "../../../src/renderer/engine/types";
import type { Annotation, AnnotationTool } from "../../../src/renderer/annotations/model";

function stubObservers(): void {
  const g = globalThis as unknown as { IntersectionObserver?: unknown; ResizeObserver?: unknown };
  if (g.IntersectionObserver === undefined) {
    class NoopIntersectionObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    g.IntersectionObserver = NoopIntersectionObserver;
  }
  if (g.ResizeObserver === undefined) {
    class NoopResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    g.ResizeObserver = NoopResizeObserver;
  }
  const proto = Element.prototype as unknown as {
    scrollTo?: unknown;
    setPointerCapture?: unknown;
    releasePointerCapture?: unknown;
    hasPointerCapture?: unknown;
  };
  if (proto.scrollTo === undefined) proto.scrollTo = (): void => undefined;
  if (proto.setPointerCapture === undefined) proto.setPointerCapture = (): void => undefined;
  if (proto.releasePointerCapture === undefined) proto.releasePointerCapture = (): void => undefined;
  if (proto.hasPointerCapture === undefined) proto.hasPointerCapture = (): boolean => false;
}

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

const NOOP = (): void => undefined;

// ---------------------------------------------------------------------------
// (1) The stage renders exactly ONE toolbar and suppresses the per-pane rows.

const NOOP_BAR: Omit<Parameters<typeof MultiToolbar>[0], "controller" | "pane"> = {
  theme: "dark",
  editModeOpen: false,
  onEditModeToggle: NOOP,
  multiModeEnabled: true,
  onMultiModeToggle: NOOP,
  signToolActive: false,
  onSignClick: NOOP,
  hasFormFields: false,
  onFlattenClick: NOOP,
  onMerge: NOOP,
  onSplit: NOOP,
  onOptimize: NOOP,
  onAuditSpace: NOOP,
  onRotateClockwise: NOOP,
  onRotateCounterClockwise: NOOP,
  onDeletePage: NOOP,
  canDeletePage: true,
  editTool: "off",
  editDefaultFont: "Helvetica",
  onEditSelect: NOOP,
  onEditDefaultFontChange: NOOP,
};

function paneView(_tabId: string, pane: PaneId, controller: SharedToolController): ReactElement {
  return createElement(DocumentView, {
    doc: makeDocStub(3),
    pageCount: 3,
    outline: null,
    initial: {
      zoomMode: "fit-width",
      manualScale: 1,
      currentPage: 1,
      searchOpen: false,
      query: "",
      activeHitIndex: -1,
    },
    onPersist: NOOP,
    onDiagnostics: NOOP,
    engineState: makeEngineState(3),
    canUndo: false,
    annotations: [],
    formFields: [],
    sharedTools: { pane, controller },
  });
}

function StageHarness(props: { initial: MultiModeState }): ReactElement {
  const controller = useMemo(() => new SharedToolController(), []);
  const [multi, setMulti] = useState<MultiModeState>(props.initial);
  const tabs: StageTab[] = [
    { id: "a", title: "Alpha.pdf", pageCount: 3 },
    { id: "b", title: "Beta.pdf", pageCount: 3 },
  ];
  return createElement(
    "div",
    null,
    createElement(
      "button",
      { "data-focus": "B", onClick: (): void => setMulti({ ...multi, focused: "B" }) },
      "B",
    ),
    createElement(DocumentStage, {
      tabs,
      activeId: "a",
      showWelcome: false,
      welcomeKey: "welcome",
      welcome: null,
      multiMode: multi,
      splitFraction: 0.5,
      onSplitChange: NOOP,
      onFocusPane: (pane: PaneId): void => setMulti({ ...multi, focused: pane }),
      onClearPane: NOOP,
      onPickPane: NOOP,
      onOpenIntoPane: NOOP,
      renderDocument: (tabId: string, pane: PaneId | null): ReactElement =>
        pane === null
          ? paneViewSingle(tabId)
          : paneView(tabId, pane, controller),
      sharedToolbar: multi.enabled
        ? createElement(MultiToolbar, { ...NOOP_BAR, controller, pane: multi.focused })
        : null,
    }),
  );
}

function paneViewSingle(_tabId: string): ReactElement {
  return createElement(DocumentView, {
    doc: makeDocStub(3),
    pageCount: 3,
    outline: null,
    initial: {
      zoomMode: "fit-width",
      manualScale: 1,
      currentPage: 1,
      searchOpen: false,
      query: "",
      activeHitIndex: -1,
    },
    onPersist: NOOP,
    onDiagnostics: NOOP,
    engineState: makeEngineState(3),
    canUndo: false,
    annotations: [],
    formFields: [],
    multiModeEnabled: false,
    onMultiModeToggle: NOOP,
  });
}

function mount(element: ReactElement): HTMLElement {
  stubObservers();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(element);
  });
  return host;
}

const count = (host: HTMLElement, selector: string): number =>
  host.querySelectorAll(selector).length;

describe("Phase 33 (chunk 4) — the workspace has ONE toolbar", () => {
  it("renders one set of controls and none of the per-pane rows", () => {
    const host = mount(
      createElement(StageHarness, { initial: { enabled: true, paneA: "a", paneB: "b", focused: "A" } }),
    );
    // The single shared bar is in the stage.
    expect(count(host, "[data-shared-toolbar]")).toBe(1);
    expect(count(host, "[data-multi-toolbar]")).toBe(1);
    // Each selector the spec calls out appears EXACTLY once, not per pane.
    expect(count(host, "[data-annotation-toolbar]")).toBe(1);
    expect(count(host, "[data-toolbar-multi-mode]")).toBe(1);
    expect(count(host, "[data-toolbar-edit-toggle]")).toBe(1);
    expect(count(host, "[data-toolbar-rotate-cw]")).toBe(1);
    expect(count(host, "[data-toolbar-rotate-ccw]")).toBe(1);
    expect(count(host, "[data-toolbar-delete-pages]")).toBe(1);
    expect(count(host, "[data-toolbar-optimize]")).toBe(1);
    expect(count(host, "[data-toolbar-audit]")).toBe(1);
    // The annotation group's own controls (all-tools dropdown) also
    // appear exactly once.
    expect(count(host, "[data-ann-dropdown-toggle]")).toBe(1);
    expect(count(host, ".toolbar")).toBe(1);
    // The per-pane rows are gone: neither pane contains a toolbar.
    const paneA = host.querySelector('.tab-pane[data-pane="A"]');
    const paneB = host.querySelector('.tab-pane[data-pane="B"]');
    expect(paneA?.querySelectorAll(".toolbar").length).toBe(0);
    expect(paneB?.querySelectorAll(".toolbar").length).toBe(0);
    expect(paneA?.querySelector("[data-shared-toolbar]")).toBeNull();
    expect(paneB?.querySelector("[data-shared-toolbar]")).toBeNull();
  });

  it("single mode still renders its own untouched toolbar", () => {
    const host = mount(
      createElement(StageHarness, { initial: { enabled: false, paneA: null, paneB: null, focused: "A" } }),
    );
    expect(count(host, "[data-shared-toolbar]")).toBe(0);
    expect(count(host, "[data-multi-toolbar]")).toBe(0);
    const single = host.querySelector('.tab-pane');
    expect(single?.querySelectorAll(".toolbar").length).toBe(1);
    expect(single?.querySelectorAll("[data-annotation-toolbar]").length).toBe(1);
    expect(single?.querySelector("[data-toolbar-multi-mode]")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (2) The shared bar arms BOTH panes; using the tool applies to the pane used.

interface Probes {
  toolA: AnnotationTool | null;
  toolB: AnnotationTool | null;
  created: string[];
}

function SharedHarness(props: { probes: Probes }): ReactElement {
  const controller = useMemo(() => new SharedToolController(), []);
  const [focused, setFocused] = useState<PaneId>("A");
  const probes = props.probes;
  const view = (pane: PaneId): ReactElement =>
    createElement(DocumentView, {
      doc: makeDocStub(3),
      pageCount: 3,
      outline: null,
      initial: {
        zoomMode: "fit-width",
        manualScale: 1,
        currentPage: 1,
        searchOpen: false,
        query: "",
        activeHitIndex: -1,
      },
      onPersist: NOOP,
      onDiagnostics: (d): void => {
        if (pane === "A") probes.toolA = d.activeTool;
        else probes.toolB = d.activeTool;
      },
      engineState: makeEngineState(3),
      canUndo: false,
      annotations: [],
      formFields: [],
      onCreateAnnotation: (a: Annotation): void => {
        probes.created.push(`${pane}:${a.kind}`);
      },
      sharedTools: { pane, controller },
    });
  return createElement(
    "div",
    null,
    createElement(
      "button",
      { "data-focus": "B", onClick: (): void => setFocused("B") },
      "focus B",
    ),
    createElement(MultiToolbar, { ...NOOP_BAR, controller, pane: focused }),
    createElement("div", { "data-view": "A" }, view("A")),
    createElement("div", { "data-view": "B" }, view("B")),
  );
}

function armTool(host: HTMLElement, tool: string): void {
  const btn = host.querySelector<HTMLButtonElement>(`[data-multi-toolbar] [data-tool="${tool}"]`);
  if (btn === null) throw new Error(`shared-bar tool ${tool} not found`);
  act((): void => {
    btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function dragOn(layer: HTMLElement, from: [number, number], to: [number, number]): void {
  const fire = (type: string, x: number, y: number): void => {
    act((): void => {
      layer.dispatchEvent(
        new PointerEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y, pointerId: 1 }),
      );
    });
  };
  fire("pointerdown", from[0], from[1]);
  fire("pointermove", to[0], to[1]);
  fire("pointerup", to[0], to[1]);
}

function paneLayer(host: HTMLElement, pane: "A" | "B"): HTMLElement {
  const view = host.querySelector<HTMLElement>(`[data-view="${pane}"]`);
  const layer = view?.querySelector<HTMLElement>("[data-annotation-layer='1']");
  if (layer === null || layer === undefined) throw new Error(`pane ${pane} annotation layer missing`);
  layer.getBoundingClientRect = (): DOMRect => ({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 800,
    bottom: 600,
    width: 800,
    height: 600,
    toJSON: () => ({}),
  });
  return layer;
}

describe("Phase 33 (chunk 4) — arming and applying across both panes", () => {
  it("arms BOTH panes from the shared bar and keeps them coherent", () => {
    const probes: Probes = { toolA: null, toolB: null, created: [] };
    const host = mount(createElement(SharedHarness, { probes }));
    armTool(host, "ink");
    expect(probes.toolA).toBe("ink");
    expect(probes.toolB).toBe("ink");
    // The shared bar shows the armed tool for the FOCUSED pane.
    act((): void => {
      host.querySelector<HTMLButtonElement>('[data-focus="B"]')?.click();
    });
    const inkBtn = host.querySelector<HTMLElement>('[data-multi-toolbar] [data-tool="ink"]');
    expect(inkBtn?.getAttribute("aria-pressed")).toBe("true");
    // Disarming in the shared bar disarms both.
    armTool(host, "select");
    expect(probes.toolA).toBeNull();
    expect(probes.toolB).toBeNull();
  });

  it("applies the armed tool to the pane the user works in", () => {
    const probes: Probes = { toolA: null, toolB: null, created: [] };
    const host = mount(createElement(SharedHarness, { probes }));
    // Arm in the shared bar, draw in pane A: A gets the ink, B does not.
    armTool(host, "ink");
    dragOn(paneLayer(host, "A"), [100, 100], [140, 140]);
    expect(probes.created).toEqual(["A:ink"]);
    // The armed tool is still shared: draw in pane B and B gets the ink.
    dragOn(paneLayer(host, "B"), [120, 120], [170, 170]);
    expect(probes.created).toEqual(["A:ink", "B:ink"]);
  });

  it("a pane's own disarm (Escape) disarms the other pane too", () => {
    const probes: Probes = { toolA: null, toolB: null, created: [] };
    const host = mount(createElement(SharedHarness, { probes }));
    armTool(host, "ink");
    expect(probes.toolA).toBe("ink");
    expect(probes.toolB).toBe("ink");
    act((): void => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(probes.toolA).toBeNull();
    expect(probes.toolB).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// (3) The controller's fan-out is a plain, DOM-free contract.

describe("Phase 33 (chunk 4) — SharedToolController fan-out", () => {
  it("invokes the origin sink once and the other panes once each", () => {
    const controller = new SharedToolController();
    const a = vi.fn();
    const b = vi.fn();
    controller.registerAnnSink("A", a);
    controller.registerAnnSink("B", b);
    const action = { type: "set-tool", tool: "ink" } as const;
    controller.annToolAction(action, a);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    // From the bar (no origin): every registered pane receives it.
    controller.annToolAction(action);
    expect(a).toHaveBeenCalledTimes(2);
    expect(b).toHaveBeenCalledTimes(2);
  });

  it("reset drops every registration and the published arm state", () => {
    const controller = new SharedToolController();
    const sink = vi.fn();
    controller.registerAnnSink("A", sink);
    controller.publishAnn("A", { tool: "ink", color: "#2563eb", penWidth: 2 });
    controller.reset();
    controller.annToolAction({ type: "set-tool", tool: "select" });
    expect(sink).not.toHaveBeenCalled();
    expect(controller.getAnn("A")).toBeNull();
  });
});