// @vitest-environment jsdom
//
// Phase 33 (chunk 4) — ONE shared workspace surface in Multi Mode.
//
// Phase 36 (chunk 7) MIGRATION: the shared toolbar ROW (`MultiToolbar`) was
// retired and replaced by the ONE shared Action Dock floating at the
// workspace's bottom-centre. The "exactly one set of controls, never one per
// pane" contract survives on the new surface, so this file keeps:
//   - the stage-level proof that NO shared toolbar row / pane toolbar exists
//     and that the shared dock is mounted once, in the stage's dock layer;
//   - the DOM-free `SharedToolController` fan-out contract, which is what makes
//     a tool armed from the shared surface apply to BOTH panes (and a pane's own
//     disarm reach the other pane).
// The dock's own arming / focus / verb-set behaviour is covered by
// `phase36MultiChrome.test.tsx`, which mounts the real panes.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { DocumentStage, type StageTab } from "../../../src/renderer/components/MultiPane";
import { SharedToolController } from "../../../src/renderer/components/multiToolController";
import type { MultiModeState } from "../../../src/renderer/state/multiMode";

const NOOP = (): void => undefined;

const TABS: StageTab[] = [
  { id: "a", title: "Alpha.pdf", pageCount: 3 },
  { id: "b", title: "Beta.pdf", pageCount: 3 },
];

const MULTI: MultiModeState = { enabled: true, paneA: "a", paneB: "b", focused: "A" };
const SINGLE: MultiModeState = { enabled: false, paneA: null, paneB: null, focused: "A" };

function mount(multi: MultiModeState, sharedDock: boolean): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(
      createElement(DocumentStage, {
        tabs: TABS,
        activeId: "a",
        showWelcome: false,
        welcomeKey: "welcome",
        welcome: null,
        multiMode: multi,
        splitFraction: 0.5,
        onSplitChange: NOOP,
        onFocusPane: NOOP,
        onClearPane: NOOP,
        onPickPane: NOOP,
        onOpenIntoPane: NOOP,
        renderDocument: (tabId: string): ReturnType<typeof createElement> =>
          createElement("div", { "data-doc": tabId }),
        sharedDock: sharedDock
          ? createElement("div", { "data-shared-dock-stub": true })
          : null,
      }),
    );
  });
  return host;
}

const count = (host: HTMLElement, selector: string): number =>
  host.querySelectorAll(selector).length;

describe("Phase 36 (chunk 7) — the workspace has ONE shared surface", () => {
  it("mounts the shared dock once and no toolbar row anywhere", () => {
    const host = mount(MULTI, true);
    expect(count(host, "[data-multi-dock-layer]")).toBe(1);
    expect(count(host, "[data-shared-dock-stub]")).toBe(1);
    // The retired row must not reappear (neither node nor selector).
    expect(count(host, "[data-shared-toolbar]")).toBe(0);
    expect(count(host, ".multi-toolbar-row")).toBe(0);
    expect(count(host, "[data-multi-toolbar]")).toBe(0);
    expect(count(host, ".toolbar")).toBe(0);
    // No pane hosts a dock: the surface belongs to the workspace, not a pane.
    expect(count(host, '.tab-pane[data-pane] [data-shared-dock-stub]')).toBe(0);
  });

  it("single mode renders no shared dock and no toolbar row", () => {
    const host = mount(SINGLE, true);
    expect(count(host, "[data-multi-dock-layer]")).toBe(0);
    expect(count(host, "[data-shared-toolbar]")).toBe(0);
    expect(count(host, "[data-multi-toolbar]")).toBe(0);
    expect(count(host, ".toolbar")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The controller's fan-out is a plain, DOM-free contract: it is what makes the
// ONE shared surface's annotation action reach BOTH panes.

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
    // From the shared dock / flyout (no origin): every registered pane receives it.
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

  it("a pane's dock context is published per pane and read by the focused one", () => {
    const controller = new SharedToolController();
    const stop = controller.registerPane("A", { dock: () => null });
    expect(controller.getDock("A")).toBeNull();
    expect(controller.getDock("B")).toBeNull();
    let selection: readonly number[] = [1, 2];
    const stopB = controller.registerPane("B", {
      dock: () => ({
        pageSelection: selection,
        clearPageSelection: NOOP,
        bulk: { onRotate: NOOP, onExtract: NOOP, onMerge: NOOP, onDelete: NOOP },
        isToolEnabled: () => true,
        disabledReasonFor: () => undefined,
        toolArmed: false,
        dragInProgress: false,
      }),
    });
    expect(controller.getDock("B")?.pageSelection).toEqual([1, 2]);
    // The live read follows the pane's current value.
    selection = [3];
    expect(controller.getDock("B")?.pageSelection).toEqual([3]);
    // Unregistering withdraws both registrations.
    stop();
    stopB();
    expect(controller.getDock("B")).toBeNull();
  });
});
