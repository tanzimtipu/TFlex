// @vitest-environment jsdom
//
// Phase 32 (chunk 2b) — the shared rail inside the App-shaped stage.
//
// This harness wires the REAL `DocumentStage`, the REAL reducers, the REAL
// pure routing decisions and the REAL `MultiRail`, exactly as App does.
// It proves what a user sees:
//
//   - Multi Mode renders ONE rail inside the stage, with a section per
//     loaded document and the focused pane's section active;
//   - a thumbnail click in a section focuses that section's pane (the tab
//     strip's active tab follows) and navigates that pane to the page;
//   - neither pane's document is remounted by any of it;
//   - single mode is unchanged: no rail, no rail column, the same split.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act, useCallback, useReducer, useState } from "react";
import type { ReactElement } from "react";
import { DocumentStage, type StageTab } from "../../../src/renderer/components/MultiPane";
import { MultiRail } from "../../../src/renderer/components/MultiRail";
import {
  multiModeReducer,
  paneTabId,
  type MultiModeState,
  type PaneId,
} from "../../../src/renderer/state/multiMode";
import {
  resolvePaneFocus,
  resolveTabStripActivation,
} from "../../../src/renderer/state/multiModeRouting";
import { tabsReducer, type TabMeta } from "../../../src/renderer/state/tabs";

function tab(id: string): TabMeta {
  return { id, title: `${id}.pdf`, filePath: `${id}.pdf`, kind: "file", modified: false };
}

const THREE = [tab("a"), tab("b"), tab("c")];
const BOTH: MultiModeState = { enabled: true, paneA: "a", paneB: "b", focused: "A" };

function mount(element: ReactElement): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(element);
  });
  return host;
}

/** The App-shaped harness: routing helpers + the shared rail. */
function StageHarness(props: { initial: MultiModeState }): ReactElement {
  const { initial } = props;
  const [tabs, dispatchTabs] = useReducer(tabsReducer, { tabs: THREE, activeId: "a" });
  const [multi, dispatchMulti] = useReducer(multiModeReducer, initial);
  const [split, setSplit] = useState(0.5);
  const [jump, setJump] = useState<{ tabId: string; page: number; seq: number } | null>(null);

  const activateTab = useCallback((id: string): void => {
    dispatchTabs({ type: "activate", id });
  }, []);

  const onFocusPane = useCallback(
    (pane: PaneId): void => {
      if (!multi.enabled) return;
      const decision = resolvePaneFocus(multi, pane);
      dispatchMulti({ type: "focus", pane: decision.focus });
      if (decision.activate !== null) {
        if (decision.activate !== tabs.activeId) activateTab(decision.activate);
      }
    },
    [multi, tabs.activeId, activateTab],
  );

  // The App seam: a rail jump targets the pane's tab id; DocumentView's
  // `jumpRequest` prop is what lands it (rendered here as the stub's page).
  const onRailJump = useCallback(
    (pane: PaneId, page: number): void => {
      const tabId = paneTabId(multi, pane);
      if (tabId === null) return;
      setJump((prev) => ({ tabId, page, seq: (prev?.seq ?? 0) + 1 }));
    },
    [multi],
  );

  const sections = (["A", "B"] as const).flatMap((pane) => {
    const tabId = paneTabId(multi, pane);
    if (tabId === null) return [];
    const meta = tabs.tabs.find((t) => t.id === tabId);
    if (meta === undefined) return [];
    return [{ pane, tabId, title: meta.title, pageCount: tabId === "a" ? 3 : 5 }];
  });

  const stageTabs: StageTab[] = tabs.tabs.map((t) => ({
    id: t.id,
    title: t.title,
    pageCount: t.id === "a" ? 3 : 5,
  }));

  return (
    <div>
      <div className="strip">
        {tabs.tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            data-test-tab={t.id}
            data-active={tabs.activeId === t.id ? "true" : "false"}
            onClick={(): void => {
              const decision = resolveTabStripActivation(multi, t.id);
              if (decision.focus !== null) dispatchMulti({ type: "focus", pane: decision.focus });
              activateTab(decision.activate);
            }}
          >
            {t.title}
          </button>
        ))}
      </div>
      <DocumentStage
        tabs={stageTabs}
        activeId={tabs.activeId}
        showWelcome={false}
        welcomeKey="welcome"
        welcome={null}
        multiMode={multi}
        splitFraction={split}
        onSplitChange={setSplit}
        onFocusPane={onFocusPane}
        onClearPane={(): void => undefined}
        onPickPane={(): void => undefined}
        onOpenIntoPane={(): void => undefined}
        renderDocument={(tabId): ReactElement => (
          <div
            data-doc-stub={tabId}
            data-doc-page={jump !== null && jump.tabId === tabId ? jump.page : 1}
          >
            {tabId}
          </div>
        )}
        sharedRail={
          sections.length > 0 ? (
            <MultiRail
              sections={sections}
              activePane={multi.focused}
              onFocusPane={onFocusPane}
              onJump={onRailJump}
              renderSection={({ pane, onJump }): ReactElement => (
                <button
                  type="button"
                  data-thumb-stub={pane}
                  onClick={(): void => onJump(3)}
                >{`page 3 of ${pane}`}</button>
              )}
            />
          ) : null
        }
      />
    </div>
  );
}

const paneOf = (host: HTMLElement, id: string): HTMLElement => {
  const el = host.querySelector<HTMLElement>(`.tab-pane[data-pane="${id}"]`);
  if (el === null) throw new Error(`pane ${id} not found`);
  return el;
};
const stripActive = (host: HTMLElement, id: string): string | null =>
  host.querySelector(`[data-test-tab="${id}"]`)?.getAttribute("data-active") ?? null;
const sectionActive = (host: HTMLElement, pane: string): string | null =>
  host
    .querySelector(`[data-rail-section-pane="${pane}"]`)
    ?.getAttribute("data-rail-section-active") ?? null;

describe("the shared rail in the Multi Mode stage", () => {
  it("renders one section per loaded document inside the stage, A first", () => {
    const host = mount(<StageHarness initial={BOTH} />);
    const stage = host.querySelector(".tab-stage");
    expect(stage?.getAttribute("data-multi-mode")).toBe("true");
    expect(stage?.getAttribute("data-shared-rail")).toBe("true");
    expect(stage?.querySelector("[data-multi-rail]")).not.toBeNull();

    const docs = Array.from(host.querySelectorAll("[data-rail-section]")).map((el) =>
      el.getAttribute("data-rail-section-doc"),
    );
    expect(docs).toEqual(["a", "b"]);
    // The rail is a child of the stage, not of a pane.
    expect(stage?.querySelectorAll("[data-rail-section]")).toHaveLength(2);
    expect(paneOf(host, "A").querySelector("[data-rail-section]")).toBeNull();
    expect(paneOf(host, "B").querySelector("[data-rail-section]")).toBeNull();
  });

  it("marks the focused pane's section active, and follows a focus move", () => {
    const host = mount(<StageHarness initial={BOTH} />);
    expect(sectionActive(host, "A")).toBe("true");
    expect(sectionActive(host, "B")).toBe("false");

    act((): void => {
      paneOf(host, "B").dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(sectionActive(host, "A")).toBe("false");
    expect(sectionActive(host, "B")).toBe("true");
  });

  it("routes a thumbnail click to that section's pane and page", () => {
    const host = mount(<StageHarness initial={BOTH} />);
    const stubA = paneOf(host, "A").querySelector('[data-doc-stub="a"]');
    const stubB = paneOf(host, "B").querySelector('[data-doc-stub="b"]');
    expect(stubA?.getAttribute("data-doc-page")).toBe("1");
    expect(stubB?.getAttribute("data-doc-page")).toBe("1");

    act((): void => {
      host.querySelector<HTMLButtonElement>('[data-thumb-stub="B"]')?.click();
    });

    // Pane B is focused, so the strip's active tab is b, and only B's
    // document moved to the clicked page.
    expect(paneOf(host, "B").getAttribute("data-pane-focused")).toBe("true");
    expect(stripActive(host, "b")).toBe("true");
    expect(stripActive(host, "a")).toBe("false");
    expect(paneOf(host, "B").querySelector('[data-doc-stub="b"]')?.getAttribute("data-doc-page")).toBe(
      "3",
    );
    expect(paneOf(host, "A").querySelector('[data-doc-stub="a"]')?.getAttribute("data-doc-page")).toBe(
      "1",
    );
    // Neither document was remounted by the click.
    expect(paneOf(host, "A").querySelector('[data-doc-stub="a"]')).toBe(stubA);
    expect(paneOf(host, "B").querySelector('[data-doc-stub="b"]')).toBe(stubB);
  });

  it("routes a thumbnail click in the focused pane's own section the same way", () => {
    const host = mount(<StageHarness initial={BOTH} />);
    act((): void => {
      host.querySelector<HTMLButtonElement>('[data-thumb-stub="A"]')?.click();
    });
    expect(paneOf(host, "A").getAttribute("data-pane-focused")).toBe("true");
    expect(stripActive(host, "a")).toBe("true");
    expect(paneOf(host, "A").querySelector('[data-doc-stub="a"]')?.getAttribute("data-doc-page")).toBe(
      "3",
    );
    expect(paneOf(host, "B").querySelector('[data-doc-stub="b"]')?.getAttribute("data-doc-page")).toBe(
      "1",
    );
  });

  it("shows a single section while the other pane is empty", () => {
    const host = mount(
      <StageHarness initial={{ enabled: true, paneA: "a", paneB: null, focused: "A" }} />,
    );
    expect(host.querySelectorAll("[data-rail-section]")).toHaveLength(1);
    expect(host.querySelector("[data-rail-section]")?.getAttribute("data-rail-section-doc")).toBe(
      "a",
    );
  });
});

describe("the divider still tracks the pointer with the rail present", () => {
  it("measures the split across the pane region, not the whole stage", () => {
    // jsdom has no layout: give the stage a real box so the drag math runs.
    const spy = vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
      left: 0,
      top: 0,
      width: 1000,
      height: 600,
      right: 1000,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);
    try {
      const host = mount(<StageHarness initial={BOTH} />);
      const stage = host.querySelector<HTMLElement>(".tab-stage");
      expect(stage?.style.getPropertyValue("--tf-shared-rail-w")).toBe("220px");
      const divider = host.querySelector<HTMLElement>("[data-multi-divider]");
      const pointer = (type: string, clientX: number): void => {
        const event = new Event(type, { bubbles: true });
        Object.defineProperty(event, "clientX", { value: clientX });
        Object.defineProperty(event, "pointerId", { value: 1 });
        act((): void => {
          divider?.dispatchEvent(event);
        });
      };
      // (571 - 220 rail) / 780 usable = 0.45. Without the rail subtraction
      // the same pointer would report 57.1%.
      pointer("pointerdown", 571);
      expect(stage?.style.getPropertyValue("--tf-split")).toBe("45.000%");
      expect(stage?.style.getPropertyValue("--tf-split-frac")).toBe("0.45");
      // Near the rail edge the 320px pane minimum clamps: 320 / 780 =
      // 0.4103 (with no rail the floor would be 0.32 and the raw value
      // 0.359 would have been used instead).
      pointer("pointermove", 500);
      expect(stage?.style.getPropertyValue("--tf-split")).toBe("41.026%");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("single mode is unchanged by the shared rail", () => {
  it("renders no rail, no rail column and the same split value", () => {
    const host = mount(
      <StageHarness initial={{ enabled: false, paneA: null, paneB: null, focused: "A" }} />,
    );
    const stage = host.querySelector<HTMLElement>(".tab-stage");
    expect(stage?.getAttribute("data-multi-mode")).toBe("false");
    expect(stage?.getAttribute("data-shared-rail")).toBeNull();
    expect(stage?.getAttribute("data-multi-panes")).toBeNull();
    expect(host.querySelector("[data-multi-rail]")).toBeNull();
    expect(host.querySelectorAll("[data-rail-section]")).toHaveLength(0);
    expect(host.querySelectorAll(".tab-pane")).toHaveLength(3);
    // The pre-Phase-32 inline split contract is untouched.
    expect(stage?.style.getPropertyValue("--tf-split")).toBe("50.000%");
    expect(host.querySelector("[data-pane]")).toBeNull();
    expect(host.querySelector("[data-multi-divider]")).toBeNull();
  });
});
