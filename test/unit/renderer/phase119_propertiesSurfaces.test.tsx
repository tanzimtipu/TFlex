// @vitest-environment jsdom
// TFL-1318 (chunk E) - Phase 119 properties surfaces, navigator recovery, and
// the ONE breakpoint source.
//
// Proves: (a) the workspace ladder thresholds are sourced from the ONE layout
// foundation; (b) the Inspector / Context Panel preference semantics and their
// below-rung recovery (drawer) paths; (c) the navigator + inspector collapse
// controls exist, are labelled, and expose the CONTROL-INDEX hooks; and (d) the
// DocumentView `.workspace-main` host publishes the measured
// document-viewport class as the measurement source of record.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { LAYOUT_LADDER } from "../../../src/renderer/design/layout";
import {
  DOCK_LADDER_BREAKPOINTS,
  resolveInspectorSurface,
  resolveContextPanelSurface,
  collapsePreferenceAfterToggle,
} from "../../../src/renderer/state/dockResponsive";
import { ContextPanel } from "../../../src/renderer/components/ContextPanel";
import { Inspector } from "../../../src/renderer/components/Inspector";
import { DocumentView } from "../../../src/renderer/components/DocumentView";
import type { EngineState } from "../../../src/renderer/engine/types";

const NOOP = (): void => undefined;

let roots: Root[] = [];
let hosts: HTMLElement[] = [];

function mount(ui: ReactElement): HTMLElement {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  act((): void => {
    root.render(ui);
  });
  roots.push(root);
  hosts.push(host);
  return host;
}

beforeEach((): void => {
  roots = [];
  hosts = [];
});

afterEach((): void => {
  const rs = roots;
  const hs = hosts;
  roots = [];
  hosts = [];
  for (const root of rs) {
    act((): void => {
      root.unmount();
    });
  }
  for (const h of hs) h.remove();
  document.body.innerHTML = "";
});

function makeDocStub(numPages: number): PDFDocumentProxy {
  return {
    numPages,
    async getPage(n: number): Promise<unknown> {
      return {
        pageNumber: n,
        view: [0, 0, 612, 792],
        getViewport: (): { width: number; height: number } => ({ width: 612, height: 792 }),
        render: (): { promise: Promise<void>; cancel: () => void } => ({
          promise: Promise.resolve(),
          cancel: (): void => undefined,
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
    rotations: new Array(pageCount).fill(0) as EngineState["rotations"],
    deleted: new Array(pageCount).fill(false),
    modified: false,
    annotations: [],
  };
}

function labelled(host: HTMLElement, selector: string): string {
  const el = host.querySelector(selector);
  if (el === null) throw new Error(`missing ${selector}`);
  return el.getAttribute("aria-label") ?? "";
}

describe("Phase 119 chunk E - ONE breakpoint source", () => {
  it("sources every ladder rung from LAYOUT_LADDER", () => {
    expect(DOCK_LADDER_BREAKPOINTS.inspector).toBe(LAYOUT_LADDER.inspectorPx);
    expect(DOCK_LADDER_BREAKPOINTS.panel).toBe(LAYOUT_LADDER.panelPx);
    expect(DOCK_LADDER_BREAKPOINTS.labels).toBe(LAYOUT_LADDER.labelsPx);
    expect(DOCK_LADDER_BREAKPOINTS.arrows).toBe(LAYOUT_LADDER.arrowsPx);
  });

  it("keeps the shipped values (1200 / 1000 / 880 / 720)", () => {
    expect(DOCK_LADDER_BREAKPOINTS).toEqual({
      inspector: 1200,
      panel: 1000,
      labels: 880,
      arrows: 720,
    });
  });

  it("preserves the preference and keeps a below-rung recovery path", () => {
    expect(resolveInspectorSurface(1300, true, false)).toBe("collapsed");
    expect(resolveInspectorSurface(1100, false, false)).toBe("collapsed");
    expect(resolveInspectorSurface(1100, false, true)).toBe("drawer");

    expect(resolveContextPanelSurface(1050, false, false)).toBe("expanded");
    expect(resolveContextPanelSurface(1050, true, false)).toBe("collapsed");
    expect(resolveContextPanelSurface(950, false, false)).toBe("collapsed");
    expect(resolveContextPanelSurface(950, false, true)).toBe("drawer");
  });

  it("records expand intent when the effective state is collapsed", () => {
    expect(collapsePreferenceAfterToggle(true)).toBe(false);
    expect(collapsePreferenceAfterToggle(false)).toBe(true);
  });
});

describe("Phase 119 chunk E - properties-surface recovery controls", () => {
  it("renders the navigator collapse hook with an Expand label when collapsed", () => {
    const host = mount(
      <ContextPanel
        stage="edit"
        doc={makeDocStub(3)}
        currentPage={1}
        defaultWidthPt={612}
        defaultHeightPt={792}
        pageSizes={null}
        engineState={makeEngineState(3)}
        proxyVisibleOrder={false}
        canUndo={false}
        onUndo={NOOP}
        onJump={NOOP}
        outline={null}
        collapsed
        onToggleCollapsed={NOOP}
      />,
    );
    const button = host.querySelector("[data-rail-collapse]");
    expect(button).not.toBeNull();
    expect(labelled(host, "[data-rail-collapse]")).toContain("Expand");
    expect(button?.getAttribute("data-collapse-direction")).toBe("expand");
  });

  it("renders the inspector collapse hook and collapsed strip with an Expand label", () => {
    const host = mount(
      <Inspector
        stage="edit"
        selection={{ kind: "none" }}
        ocrSuspects={null}
        collapsed
        onToggleCollapsed={NOOP}
      />,
    );
    expect(host.querySelector("[data-inspector-collapse]")).not.toBeNull();
    expect(labelled(host, "[data-inspector-collapse]")).toContain("Expand");
    expect(host.querySelector("[data-inspector-collapsed-strip]")).not.toBeNull();
  });
});

describe("Phase 119 chunk E - measured document viewport", () => {
  it("publishes the measured layout class on .workspace-main", async () => {
    const g = globalThis as unknown as {
      IntersectionObserver?: unknown;
      ResizeObserver?: unknown;
    };
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
    const proto = Element.prototype as unknown as { scrollTo?: unknown };
    if (proto.scrollTo === undefined) proto.scrollTo = (): void => undefined;

    const host = document.body.appendChild(document.createElement("div"));
    const root = createRoot(host);
    roots.push(root);
    hosts.push(host);
    await act(async (): Promise<void> => {
      root.render(
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
          onDiagnostics: NOOP,
          engineState: makeEngineState(3),
          canUndo: false,
          saveInPlaceEnabled: false,
          annotations: [],
          formFields: [],
          signatures: [],
          savedSignatures: [],
          stampAnnotations: [],
          railSide: "left",
          multiRail: null,
        }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const main = host.querySelector(".workspace-main");
    expect(main).not.toBeNull();
    expect(main?.hasAttribute("data-layout-width")).toBe(true);
    expect(main?.hasAttribute("data-layout-class")).toBe(true);
    expect(["wide", "narrow", "compact", "tight"]).toContain(
      main?.getAttribute("data-layout-class"),
    );
  });
});

