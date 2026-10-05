// @vitest-environment jsdom
//
// DEF-348a — with ONE document in Multi Mode, focusing the EMPTY pane must not
// make the shared Action Dock disappear. The operator's ruling: the dock is
// workspace-level; it is present and functional whenever a document exists in
// the workspace, whichever pane is focused. This mounts the REAL DocumentStage
// and the REAL MultiActionDock; the dock's pane comes from `resolveDockPane`
// (the App's rule), so removing the fallback fails this test.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it } from "vitest";
import { act, createElement } from "react";
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { DocumentStage, type StageTab } from "../../../src/renderer/components/MultiPane";
import { MultiActionDock } from "../../../src/renderer/components/MultiActionDock";
import { SharedToolController } from "../../../src/renderer/components/multiToolController";
import { resolveDockPane } from "../../../src/renderer/state/multiChrome";
import type { MultiModeState } from "../../../src/renderer/state/multiMode";

const NOOP = (): void => undefined;

const TABS: StageTab[] = [{ id: "a", title: "Alpha.pdf", pageCount: 3 }];

function mount(element: ReactElement): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(element);
  });
  return host;
}

function harness(multi: MultiModeState): HTMLElement {
  const controller = new SharedToolController();
  controller.registerPane("A", {
    dock: () => ({
      pageSelection: [],
      clearPageSelection: NOOP,
      bulk: { onRotate: NOOP, onExtract: NOOP, onDelete: NOOP },
      isToolEnabled: (): boolean => true,
      disabledReasonFor: (): undefined => undefined,
      toolArmed: false,
      dragInProgress: false,
    }),
  });
  return mount(
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
      renderDocument: (): ReactElement => createElement("div", { "data-doc": true }),
      sharedDock: createElement(MultiActionDock, {
        controller,
        pane: resolveDockPane(multi, multi.focused),
        activeStage: "pages",
        dockPins: [],
        onPinTool: NOOP,
        onUnpinTool: NOOP,
        onRunTool: NOOP,
      }),
    }),
  );
}

describe("Multi Mode dock presence with an empty pane focused (DEF-348a)", () => {
  it("renders the dock when the EMPTY pane is focused and the other pane owns a document", () => {
    const host = harness({ enabled: true, paneA: "a", paneB: null, focused: "B" });
    const dock = host.querySelector("[data-action-dock]");
    expect(dock).not.toBeNull();
    // Phase 104 (chunk 2) — the visible row is the five curated PAGES primaries.
    expect(host.querySelectorAll('[data-dock-group="primary"] [data-dock-verb]').length).toBe(5);
  });

  it("still renders the dock when the document pane is focused", () => {
    const host = harness({ enabled: true, paneA: "a", paneB: null, focused: "A" });
    expect(host.querySelector("[data-action-dock]")).not.toBeNull();
  });

  it("renders no dock when neither pane owns a document (nothing to show)", () => {
    const host = harness({ enabled: true, paneA: null, paneB: null, focused: "B" });
    expect(host.querySelector("[data-action-dock]")).toBeNull();
  });
});
