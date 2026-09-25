// @vitest-environment jsdom
//
// Phase 36 (chunk 7) â€” Multi Mode integration: the ONE shared Action Dock, the
// per-pane stage + view controls, and the shared Inspector's focus rule.
//
// The workspace keeps its Phase 32-34 layout exactly: the centred inner-edge
// thumbnail strips flanking the divider, ONE composite tab, the per-pane
// headers and the strips' own verbs. What this chunk adds is the shared chrome
// the phase contract promises:
//
//   - exactly ONE Action Dock for the workspace, at the workspace's
//     bottom-centre, showing the FOCUSED pane's stage verbs;
//   - each pane's OWN stage (which decides what that dock shows when the pane
//     is focused) and its OWN floating page / zoom / pan pills, inside its own
//     canvas bounds;
//   - the REVIEW annotations flyout as ONE surface driven by the focused pane;
//   - the shared Inspector fed by the FOCUSED pane's selection.
//
// The harness mounts the REAL `DocumentStage`, the REAL `MultiActionDock`, two
// REAL `DocumentView` panes wired through the REAL `SharedToolController`, and
// a verb runner shaped exactly like App's (`focusedViewCommands` first, then
// the app-level handlers).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { act, createElement, useMemo, useReducer, useRef, useState } from "react";
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  clampSplitFraction,
  effectiveToolsInset,
  multiPaneGeometry,
} from "../../../src/renderer/components/multiPaneLayout";
import {
  DOCK_DEFAULT_RESERVE,
  DOCK_PILL_GAP,
  DOCK_PILL_INSET,
} from "../../../src/renderer/state/dockFit";
import { DocumentStage, type StageTab } from "../../../src/renderer/components/MultiPane";
import { DocumentView } from "../../../src/renderer/components/DocumentView";
import { MultiActionDock } from "../../../src/renderer/components/MultiActionDock";
import { SharedToolController } from "../../../src/renderer/components/multiToolController";
import {
  initialStageState,
  stageForPane,
  stageReducer,
  type Stage,
  type StageState,
} from "../../../src/renderer/state/stages";
import { toolById } from "../../../src/renderer/state/toolsRegistry";
import { resolvePaneSelection } from "../../../src/renderer/state/multiChrome";
import type { MultiModeState, PaneId } from "../../../src/renderer/state/multiMode";
import type { EngineState } from "../../../src/renderer/engine/types";

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
        getViewport: (): { width: number; height: number } => ({ width: 612, height: 792 }),
        render: (): { promise: Promise<void> } => ({ promise: Promise.resolve() }),
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

const APP_PATH = resolve(__dirname, "../../../src/renderer/App.tsx");

const TABS: StageTab[] = [
  { id: "a", title: "Alpha.pdf", pageCount: 3 },
  { id: "b", title: "Beta.pdf", pageCount: 3 },
];

const INITIAL_VIEWER = {
  zoomMode: "fit-width" as const,
  manualScale: 1,
  currentPage: 1,
  searchOpen: false,
  query: "",
  activeHitIndex: -1,
};

/** Live observations the harness records from each pane's DocumentView. */
interface Probes {
  pageA: number;
  pageB: number;
  toolA: string | null;
  toolB: string | null;
}

interface HarnessApi {
  setStage?: (pane: PaneId, stage: Stage) => void;
}

function MultiHarness(props: { probes: Probes; api?: HarnessApi }): ReactElement {
  const { probes, api } = props;
  const controller = useMemo(() => new SharedToolController(), []);
  const [multi, setMulti] = useState<MultiModeState>({
    enabled: true,
    paneA: "a",
    paneB: "b",
    focused: "A",
  });
  // The panes open on DIFFERENT stages, so a focus switch changes the dock's
  // contents observably.
  const [stages, dispatchStages] = useReducer(stageReducer, {
    ...initialStageState,
    panes: { A: "pages", B: "edit" },
  } as StageState);
  if (api !== undefined) {
    api.setStage = (pane, stage): void => dispatchStages({ type: "set", pane, stage });
  }

  // The pane view-command registry + the app-level verb map, shaped like App's
  // (`focusedViewCommands` first, then the app handlers).
  const viewCommandsRef = useRef(new Map<PaneId, Record<string, () => void>>());
  const appActions: Record<string, () => void> = {
    deletePages: NOOP,
    insertPages: NOOP,
    replacePages: NOOP,
    split: NOOP,
    extract: NOOP,
    merge: NOOP,
    sign: NOOP,
    stamp: NOOP,
    flatten: NOOP,
    optimize: NOOP,
    auditSpace: NOOP,
    exportPages: NOOP,
    exportText: NOOP,
    exportDocx: NOOP,
    recognizeText: NOOP,
    cropPages: NOOP,
    renumberPages: NOOP,
    watermark: NOOP,
  };
  const onRunTool = (id: string): void => {
    const entry = toolById(id);
    if (entry === undefined) return;
    const run =
      viewCommandsRef.current.get(multi.focused)?.[entry.action] ?? appActions[entry.action];
    run?.();
  };

  const paneView = (pane: PaneId): ReactElement =>
    createElement(DocumentView, {
      doc: makeDocStub(3),
      pageCount: 3,
      outline: null,
      initial: INITIAL_VIEWER,
      onPersist: NOOP,
      onDiagnostics: (d): void => {
        if (pane === "A") {
          probes.pageA = d.currentPage;
          probes.toolA = d.activeTool;
        } else {
          probes.pageB = d.currentPage;
          probes.toolB = d.activeTool;
        }
      },
      engineState: makeEngineState(3),
      canUndo: false,
      annotations: [],
      formFields: [],
      activeStage: stageForPane(stages, pane),
      // The Phase 33/34 per-pane strip: A's on its right (its inner edge), B's
      // on its left, so the two strips flank the divider.
      railSide: pane === "A" ? "right" : "left",
      multiRail: {
        pane,
        tabId: pane === "A" ? "a" : "b",
        title: pane === "A" ? "Alpha.pdf" : "Beta.pdf",
        documentCount: 2,
        onFocusPane: NOOP,
        onDrop: NOOP,
      },
      sharedTools: { pane, controller },
      multiPane: pane,
      paneFocused: pane === multi.focused,
      chromeIdle: false,
      registerViewCommands: (commands): void => {
        if (commands === null) viewCommandsRef.current.delete(pane);
        else viewCommandsRef.current.set(pane, commands);
      },
      isDockToolEnabled: (): boolean => true,
    });

  return createElement(
    "div",
    null,
    createElement(
      "button",
      { "data-focus": "B", onClick: (): void => setMulti({ ...multi, focused: "B" }) },
      "focus B",
    ),
    createElement(
      "button",
      { "data-focus": "A", onClick: (): void => setMulti({ ...multi, focused: "A" }) },
      "focus A",
    ),
    createElement(DocumentStage, {
      tabs: TABS,
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
      renderDocument: (_tabId: string, pane: PaneId | null): ReactElement =>
        pane === null ? createElement("div", { "data-single-doc": true }) : paneView(pane),
      sharedDock: createElement(MultiActionDock, {
        controller,
        pane: multi.focused,
        activeStage: stageForPane(stages, multi.focused),
        dockPins: [],
        onPinTool: NOOP,
        onUnpinTool: NOOP,
        onRunTool,
      }),
    }),
  );
}

function mount(element: ReactElement): { host: HTMLElement; unmount: () => void } {
  stubObservers();
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(element);
  });
  return {
    host,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

const freshProbes = (): Probes => ({ pageA: 1, pageB: 1, toolA: null, toolB: null });

const paneEl = (host: HTMLElement, pane: PaneId): HTMLElement => {
  const el = host.querySelector<HTMLElement>(`.tab-pane[data-pane="${pane}"]`);
  if (el === null) throw new Error(`pane ${pane} missing`);
  return el;
};

/** The dock's rendered verb ids, in DOM order (inline verbs only). Phase 37
 *  item 6 wraps the groups in `.action-dock-scroll`, so the query is a
 *  descendant, not a direct child. */
const dockVerbIds = (host: HTMLElement): string[] =>
  [...host.querySelectorAll<HTMLElement>("[data-action-dock] .action-dock-group > [data-dock-verb]")].map(
    (el) => el.dataset.dockVerb ?? "",
  );

const click = (el: Element | null): void => {
  act((): void => {
    (el as HTMLElement | null)?.click();
  });
};

const focusPane = (host: HTMLElement, pane: PaneId): void => {
  click(host.querySelector(`[data-focus="${pane}"]`));
};

// ---------------------------------------------------------------------------
// (1) ONE shared dock, driven by the FOCUSED pane's stage.

describe("Phase 36 (chunk 7) ï¿½ the ONE shared Action Dock", () => {
  it("renders exactly one dock for the workspace, never one per pane", () => {
    const { host, unmount } = mount(createElement(MultiHarness, { probes: freshProbes() }));
    try {
      expect(host.querySelectorAll("[data-action-dock]")).toHaveLength(1);
      expect(paneEl(host, "A").querySelector("[data-action-dock]")).toBeNull();
      expect(paneEl(host, "B").querySelector("[data-action-dock]")).toBeNull();
      // The retired row must not reappear.
      expect(host.querySelector("[data-shared-toolbar]")).toBeNull();
      expect(host.querySelector(".multi-toolbar-row")).toBeNull();
      expect(host.querySelector(".toolbar")).toBeNull();
      // It lives in the stage's bottom-anchored layer.
      const layer = host.querySelector("[data-multi-dock-layer]");
      expect(layer).not.toBeNull();
      expect(layer?.querySelectorAll("[data-action-dock]")).toHaveLength(1);
      expect(layer?.parentElement).toBe(host.querySelector(".tab-stage"));
    } finally {
      unmount();
    }
  });

  it("shows the focused pane's stage verbs and swaps them on a focus switch", () => {
    const { host, unmount } = mount(createElement(MultiHarness, { probes: freshProbes() }));
    try {
      // Focused A -> A's PAGES stage verbs, in registry order (Phase 37 item 21
      // widened the set).
      expect(dockVerbIds(host)).toEqual([
        "rotate",
        "extract",
        "insertPages",
        "replacePages",
        "split",
        "delete",
        "merge",
        "cropPages",
      ]);
      focusPane(host, "B");
      // Focused B -> B's EDIT stage verbs: the same ONE dock, new contents.
      expect(dockVerbIds(host)).toEqual([
        "editText",
        "editImage",
        "editTextBox",
        "recognizeText",
        "batchOcr",
        "ocrSuspects",
      ]);
      focusPane(host, "A");
      expect(dockVerbIds(host)).toEqual([
        "rotate",
        "extract",
        "insertPages",
        "replacePages",
        "split",
        "delete",
        "merge",
        "cropPages",
      ]);
      expect(host.querySelectorAll("[data-action-dock]")).toHaveLength(1);
    } finally {
      unmount();
    }
  });

  it("follows a pane CLICK (the focus routing) without a second dock", () => {
    const { host, unmount } = mount(createElement(MultiHarness, { probes: freshProbes() }));
    try {
      const paneB = paneEl(host, "B");
      act((): void => {
        paneB.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      });
      expect(paneEl(host, "B").getAttribute("data-pane-focused")).toBe("true");
      expect(dockVerbIds(host)).toEqual([
        "editText",
        "editImage",
        "editTextBox",
        "recognizeText",
        "batchOcr",
        "ocrSuspects",
      ]);
      expect(host.querySelectorAll("[data-action-dock]")).toHaveLength(1);
    } finally {
      unmount();
    }
  });

  it("promotes the focused pane's stage verb set when its stage changes", () => {
    const api: HarnessApi = {};
    const { host, unmount } = mount(createElement(MultiHarness, { probes: freshProbes(), api }));
    try {
      expect(dockVerbIds(host)).toContain("delete");
      act((): void => {
        api.setStage?.("A", "review");
      });
      expect(dockVerbIds(host)).toEqual([
        "annotate",
        "sign",
        "stamp",
        "flatten",
        "forms",
        "watermark",
        "exportComments",
        "importComments",
      ]);
      // The UNFOCUSED pane's stage change never leaks into the dock.
      act((): void => {
        api.setStage?.("B", "deliver");
      });
      expect(dockVerbIds(host)).toEqual([
        "annotate",
        "sign",
        "stamp",
        "flatten",
        "forms",
        "watermark",
        "exportComments",
        "importComments",
      ]);
    } finally {
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// (2) Per-pane stage + per-pane view controls (the pills).

describe("Phase 36 (chunk 7) ï¿½ each pane keeps its own stage and its own pills", () => {
  it("gives each pane its own pills, inside its own canvas bounds", () => {
    const { host, unmount } = mount(createElement(MultiHarness, { probes: freshProbes() }));
    try {
      expect(host.querySelectorAll("[data-canvas-pills]")).toHaveLength(2);
      expect(paneEl(host, "A").querySelector('[data-canvas-pills][data-pill-pane="A"]')).not.toBeNull();
      expect(paneEl(host, "B").querySelector('[data-canvas-pills][data-pill-pane="B"]')).not.toBeNull();
      // Pane A's pills stay in A's subtree and B's in B's: no cross-pane chrome.
      expect(paneEl(host, "A").querySelector('[data-pill-pane="B"]')).toBeNull();
      expect(paneEl(host, "B").querySelector('[data-pill-pane="A"]')).toBeNull();
      // Each pane's pills carry the page / zoom / pan controls.
      for (const pane of ["A", "B"] as const) {
        const pills = paneEl(host, pane).querySelector("[data-canvas-pills]");
        expect(pills?.querySelector('[data-page-pill]')).not.toBeNull();
        expect(pills?.querySelector('[data-zoom-pill] [aria-label="Zoom in"]')).not.toBeNull();
        expect(pills?.querySelector('[data-hand-toggle]')).not.toBeNull();
      }
    } finally {
      unmount();
    }
  });

  it("applies a pane's page navigation to THAT pane only", () => {
    const probes = freshProbes();
    const { host, unmount } = mount(createElement(MultiHarness, { probes }));
    try {
      expect(probes.pageA).toBe(1);
      expect(probes.pageB).toBe(1);
      click(paneEl(host, "A").querySelector('[data-pill-pane="A"] [aria-label="Next page"]'));
      expect(probes.pageA).toBe(2);
      expect(probes.pageB).toBe(1);
      click(paneEl(host, "B").querySelector('[data-pill-pane="B"] [aria-label="Next page"]'));
      expect(probes.pageB).toBe(2);
      expect(probes.pageA).toBe(2);
    } finally {
      unmount();
    }
  });

  it("arms the annotation tools for BOTH panes from the focused pane's flyout", () => {
    const api: HarnessApi = {};
    const probes = freshProbes();
    const { host, unmount } = mount(createElement(MultiHarness, { probes, api }));
    try {
      act((): void => {
        api.setStage?.("A", "review");
      });
      // The dock's Annotate primary opens the ONE flyout in the focused pane.
      click(host.querySelector('[data-action-dock] [data-dock-verb="annotate"]'));
      expect(paneEl(host, "A").querySelector("[data-annotation-flyout]")).not.toBeNull();
      expect(host.querySelectorAll("[data-annotation-flyout]")).toHaveLength(1);
      click(paneEl(host, "A").querySelector('[data-annotation-flyout] [data-tool="ink"]'));
      // The fan-out arms both panes (the Phase 33 contract, on the new surface).
      expect(probes.toolA).toBe("ink");
      expect(probes.toolB).toBe("ink");
      act((): void => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });
      expect(probes.toolA).toBeNull();
      expect(probes.toolB).toBeNull();
    } finally {
      unmount();
    }
  });

  it("keeps the flyout ONE surface: a focus switch closes it", () => {
    const api: HarnessApi = {};
    const { host, unmount } = mount(createElement(MultiHarness, { probes: freshProbes(), api }));
    try {
      act((): void => {
        api.setStage?.("A", "review");
      });
      click(host.querySelector('[data-action-dock] [data-dock-verb="annotate"]'));
      expect(host.querySelectorAll("[data-annotation-flyout]")).toHaveLength(1);
      // B is on EDIT: focusing it closes A's flyout and opens nothing.
      focusPane(host, "B");
      expect(host.querySelectorAll("[data-annotation-flyout]")).toHaveLength(0);
      // Put B on REVIEW and open it there: still exactly one surface, in B.
      act((): void => {
        api.setStage?.("B", "review");
      });
      click(host.querySelector('[data-action-dock] [data-dock-verb="annotate"]'));
      expect(paneEl(host, "B").querySelector("[data-annotation-flyout]")).not.toBeNull();
      expect(paneEl(host, "A").querySelector("[data-annotation-flyout]")).toBeNull();
      expect(host.querySelectorAll("[data-annotation-flyout]")).toHaveLength(1);
    } finally {
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// (3) The shared Inspector's focus rule (the pure decision App wires).

describe("Phase 36 (chunk 7) ï¿½ the shared Inspector follows the FOCUSED pane", () => {
  it("single mode always applies the publish (the unchanged path)", () => {
    expect(resolvePaneSelection(null, "A", "sel")).toEqual({ apply: true, value: "sel" });
    expect(resolvePaneSelection(null, "B", null)).toEqual({ apply: true, value: null });
  });

  it("Multi Mode applies the FOCUSED pane's publish and ignores the background's", () => {
    expect(resolvePaneSelection("A", "A", "a-sel")).toEqual({ apply: true, value: "a-sel" });
    expect(resolvePaneSelection("B", "A", "b-sel")).toEqual({ apply: false, value: null });
    // A background pane can never CLEAR the shared selection either.
    expect(resolvePaneSelection("B", "A", null)).toEqual({ apply: false, value: null });
    expect(resolvePaneSelection("B", "B", "b-sel")).toEqual({ apply: true, value: "b-sel" });
  });
});

// ---------------------------------------------------------------------------
// (4) The Phase 32-34 layout is unchanged and the dock floats over its centre.

describe("Phase 36 (chunk 7) ï¿½ the workspace layout", () => {
  it("keeps rail | pane A (pages + strip) | divider | pane B (strip + pages) | inspector", () => {
    const { host, unmount } = mount(createElement(MultiHarness, { probes: freshProbes() }));
    try {
      const stage = host.querySelector<HTMLElement>(".tab-stage");
      const children = [...(stage?.children ?? [])];
      const paneA = paneEl(host, "A");
      const paneB = paneEl(host, "B");
      const divider = host.querySelector("[data-multi-divider]");
      const dockLayer = host.querySelector("[data-multi-dock-layer]");
      expect(children.filter((el) => el.matches("[data-pane]"))).toHaveLength(2);
      // DOM order: both panes, then the divider, then the dock layer.
      expect(children.indexOf(paneA)).toBeLessThan(children.indexOf(divider as Element));
      expect(children.indexOf(paneB)).toBeLessThan(children.indexOf(divider as Element));
      expect(children.indexOf(divider as Element)).toBeLessThan(
        children.indexOf(dockLayer as Element),
      );
      // Each pane's header keeps the name + page count above its document.
      expect(paneA.querySelector("[data-pane-header]")?.textContent).toContain("Alpha.pdf");
      expect(paneA.querySelector("[data-pane-header]")?.textContent).toContain("3 pages");
      expect(paneB.querySelector("[data-pane-header]")?.textContent).toContain("Beta.pdf");
      // The centred inner-edge strips: A's strip on its RIGHT, B's on its LEFT.
      expect(
        paneA.querySelector('.workspace[data-rail-side="right"]'),
      ).not.toBeNull();
      expect(paneB.querySelector('.workspace[data-rail-side="left"]')).not.toBeNull();
      // The retired row's reclaimed height: the panes start at the stage's top.
      expect(stage?.style.getPropertyValue("--tf-multi-toolbar-h")).toBe("");
    } finally {
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// (5) The invariants, with their numbers.

describe("Phase 36 (chunk 7) ï¿½ DEF-282 / DEF-286 / DEF-287 hold", () => {
  it("DEF-282: no chrome can reach the pane headers (dock layer is bottom-only)", () => {
    const { host, unmount } = mount(createElement(MultiHarness, { probes: freshProbes() }));
    try {
      for (const pane of ["A", "B"] as const) {
        expect(paneEl(host, pane).firstElementChild).toBe(
          paneEl(host, pane).querySelector("[data-pane-header]"),
        );
      }
      const layer = host.querySelector("[data-multi-dock-layer]");
      // A zero-height box at the stage's bottom: the dock inside it is anchored
      // 12px above that edge, so the header band is unreachable.
      expect(layer?.classList.contains("multi-dock-layer")).toBe(true);
      expect(host.querySelectorAll("[data-pane] [data-action-dock]")).toHaveLength(0);
    } finally {
      unmount();
    }
  });

  it("DEF-286: the Inspector inset splits EQUALLY across the two panes", () => {
    const inset = 264;
    for (const frac of [0.35, 0.5, 0.65]) {
      const before = multiPaneGeometry(1000, 0, frac);
      const after = multiPaneGeometry(1000, inset, frac);
      expect(before.paneA.width - after.paneA.width).toBeCloseTo(inset / 2, 6);
      expect(before.paneB.width - after.paneB.width).toBeCloseTo(inset / 2, 6);
      // The divider stays exactly between them, and the total adds up.
      expect(after.dividerLeft).toBeCloseTo(after.paneA.right, 6);
      expect(after.paneA.width + 8 + after.paneB.width).toBeCloseTo(1000 - inset, 6);
    }
  });

  it("DEF-287: the page-area floor holds, the cap engages, the clamp re-clamps", () => {
    // The Inspector's 264px inset at the 640px minimum window: both page areas
    // keep the 44px floor (the strip yields first).
    const g = multiPaneGeometry(640, 264, 0.5);
    expect(g.inset).toBe(264);
    expect(g.paneA.page).toBe(44);
    expect(g.paneB.page).toBe(44);
    expect(g.paneA.strip).toBeLessThan(220);
    // A requested inset that would starve the panes is capped (640 - 296).
    expect(effectiveToolsInset(640, 700)).toBe(344);
    // The stored fraction re-clamps to the pane minimum with the panel open:
    // (320 + 132) / 1000 = 0.452.
    expect(clampSplitFraction(1000, 264, 0.35)).toBeCloseTo(0.452, 9);
    // Idempotent, so a geometry change can never oscillate.
    expect(clampSplitFraction(1000, 264, clampSplitFraction(1000, 264, 0.35))).toBeCloseTo(
      0.452,
      9,
    );
  });

  it("keeps the composite tab and the strips untouched (still wired by App)", () => {
    const app = readFileSync(APP_PATH, "utf8");
    expect(app).toContain("compositeHeaderTab(");
    expect(app).toContain("COMPOSITE_TAB_ID");
    // The stage still hands each pane its own strip context.
    expect(app).toContain("multiRail={");
    expect(app).toContain('railSide={pane === "A" ? "right" : "left"}');
  });
});

// ---------------------------------------------------------------------------
// (6) The per-pane pill stack vs the shared dock's band, with the numbers.

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");

/** The DEF-315 measured zoom pill width (the widest pill; documented in
 *  `state/dockFit.ts`). The widest STACKED footprint a pane's pills produce. */
const ZOOM_PILL_MAX_W = 218;

function cssRuleBody(src: string, selector: string): string | null {
  const stripped = src.replace(/\/\*[\s\S]*?\*\//g, "");
  let from = 0;
  for (;;) {
    const idx = stripped.indexOf(selector, from);
    if (idx === -1) return null;
    let cursor = idx + selector.length;
    while (cursor < stripped.length && /\s/.test(stripped[cursor] ?? "")) cursor += 1;
    if (stripped[cursor] === "{") {
      const open = stripped.indexOf("{", idx);
      let depth = 0;
      for (let i = open; i < stripped.length; i += 1) {
        if (stripped[i] === "{") depth += 1;
        else if (stripped[i] === "}") {
          depth -= 1;
          if (depth === 0) return stripped.slice(open + 1, i);
        }
      }
      return "";
    }
    from = idx + selector.length;
  }
}

describe("Phase 36 (chunk 7) — the pane pills never reach the shared dock", () => {
  it("the symmetric dock reserve clears the widest single pill footprint", () => {
    // The dock is centred with a symmetric reserve, so its half-width band is
    // `DOCK_DEFAULT_RESERVE / 2` from each workspace edge. The reserve basis is
    // the widest SINGLE pill footprint (12px inset + the 218px zoom pill) plus
    // the 8px clearance; the two numbers must match (238 >= 230 + 8). Phase 40
    // keeps the panes' pills clear of the dock structurally (the pane bottom
    // band, `--tf-multi-dock-band`), so this constant identity is unchanged.
    expect(DOCK_DEFAULT_RESERVE / 2).toBe(DOCK_PILL_INSET + ZOOM_PILL_MAX_W + DOCK_PILL_GAP);
    expect(DOCK_DEFAULT_RESERVE / 2).toBeGreaterThanOrEqual(
      DOCK_PILL_INSET + ZOOM_PILL_MAX_W + DOCK_PILL_GAP,
    );
  });

  it("Phase 40: places each pane's pills HORIZONTALLY, page left / zoom right", () => {
    const css = readFileSync(STYLES_PATH, "utf8");
    // Both panes read ONE inset token: the page pill anchors to the layer's
    // left and the zoom pill to its right, in pane A and pane B alike (the old
    // per-pane outer-edge stack is retired).
    const page = cssRuleBody(
      css,
      '.tab-stage[data-multi-mode="true"] .canvas-pills[data-pill-pane] .canvas-pill-page',
    );
    expect(page ?? "").toMatch(/left:\s*var\(--tf-multi-pill-inset, 12px\)\s*;/);
    expect(page ?? "").toMatch(/right:\s*auto\s*;/);
    const zoom = cssRuleBody(
      css,
      '.tab-stage[data-multi-mode="true"] .canvas-pills[data-pill-pane] .canvas-pill-zoom',
    );
    expect(zoom ?? "").toMatch(/right:\s*var\(--tf-multi-pill-inset, 12px\)\s*;/);
    expect(zoom ?? "").toMatch(/left:\s*auto\s*;/);
    // The pills share ONE row: no raised placement survives in Multi Mode.
    expect(zoom ?? "").toMatch(/bottom:\s*12px\s*;/);
    expect(zoom ?? "").not.toMatch(/bottom:\s*58px/);
  });
});
