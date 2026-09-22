// @vitest-environment jsdom
//
// Phase 33 (chunk 3) — the stage hands each pane's DocumentView its context.
//
// The phase-32 shared rail is retired: the stage no longer renders a rail
// (the strips live INSIDE each pane's DocumentView, at the pane's inner
// edge). This harness wires the REAL DocumentStage, the REAL reducers and
// the REAL pure routing decisions, exactly as App does, and proves:
//
//   - the stage passes the pane (A / B, or null in single mode) to
//     `renderDocument`, so App can give each pane its own strip on the
//     correct side and its own document;
//   - no rail node / rail column exists in the stage any more;
//   - the divider clamps against the whole stage width (the panes own it);
//   - pane focus and thumbnail-driven navigation still route to the right
//     pane, with neither document remounted;
//   - single mode is unchanged: three panes, no pane attributes, the same
//     split value.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act, useCallback, useReducer, useState } from "react";
import type { ReactElement } from "react";
import { DocumentStage, type StageTab } from "../../../src/renderer/components/MultiPane";
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

/** The App-shaped harness: routing helpers + a pane-aware document stub. */
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

  // The App seam: a strip click targets the pane's tab id; DocumentView's
  // `jumpRequest` prop is what lands it (rendered here as the stub's page).
  const onStripJump = useCallback(
    (pane: PaneId, page: number): void => {
      const tabId = paneTabId(multi, pane);
      if (tabId === null) return;
      setJump((prev) => ({ tabId, page, seq: (prev?.seq ?? 0) + 1 }));
    },
    [multi],
  );

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
        // App builds a DocumentView per tab; the STAGE supplies the pane,
        // which is what selects this pane's strip side and document.
        renderDocument={(tabId, pane): ReactElement => (
          <div
            data-doc-stub={tabId}
            data-doc-pane={pane ?? "single"}
            data-rail-side={pane === "A" ? "right" : "left"}
            data-doc-page={jump !== null && jump.tabId === tabId ? jump.page : 1}
          >
            {tabId}
            {pane !== null && (
              // Stands in for this pane's strip: the real strip focuses its
              // pane and then jumps it (proven in paneThumbStrip.test /
              // documentViewRailSide.test); the stage test pins the routing
              // that click produces.
              <button
                type="button"
                data-thumb-stub={pane}
                onClick={(): void => {
                  onFocusPane(pane);
                  onStripJump(pane, 3);
                }}
              >{`page 3 of ${pane}`}</button>
            )}
          </div>
        )}
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

describe("DocumentStage — the pane context handed to each view", () => {
  it("gives pane A and pane B their own view context (and no shared rail)", () => {
    const host = mount(<StageHarness initial={BOTH} />);
    const stage = host.querySelector(".tab-stage");
    expect(stage?.getAttribute("data-multi-mode")).toBe("true");
    expect(stage?.getAttribute("data-multi-panes")).toBe("2");
    // The phase-32 shared rail is retired: no rail node, no rail column.
    expect(host.querySelector("[data-multi-rail]")).toBeNull();
    expect(host.querySelector("[data-rail-section]")).toBeNull();
    expect(stage?.getAttribute("data-shared-rail")).toBeNull();

    // Each pane's document stub was told which pane it fills, and therefore
    // which rail side its strip uses (A right, B left).
    const docA = paneOf(host, "A").querySelector('[data-doc-stub="a"]');
    const docB = paneOf(host, "B").querySelector('[data-doc-stub="b"]');
    expect(docA?.getAttribute("data-doc-pane")).toBe("A");
    expect(docA?.getAttribute("data-rail-side")).toBe("right");
    expect(docB?.getAttribute("data-doc-pane")).toBe("B");
    expect(docB?.getAttribute("data-rail-side")).toBe("left");
  });

  it("routes a strip click to that pane and page without remounting either document", () => {
    const host = mount(<StageHarness initial={BOTH} />);
    const stubA = paneOf(host, "A").querySelector('[data-doc-stub="a"]');
    const stubB = paneOf(host, "B").querySelector('[data-doc-stub="b"]');
    expect(stubA?.getAttribute("data-doc-page")).toBe("1");
    expect(stubB?.getAttribute("data-doc-page")).toBe("1");

    act((): void => {
      host.querySelector<HTMLButtonElement>('[data-thumb-stub="B"]')?.click();
    });

    expect(paneOf(host, "B").getAttribute("data-pane-focused")).toBe("true");
    expect(stripActive(host, "b")).toBe("true");
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

  it("gives an empty pane no document context at all", () => {
    const host = mount(
      <StageHarness initial={{ enabled: true, paneA: "a", paneB: null, focused: "A" }} />,
    );
    expect(host.querySelector('[data-pane="B"][data-pane-empty]')).not.toBeNull();
    expect(paneOf(host, "A").querySelector('[data-doc-pane="A"]')).not.toBeNull();
    expect(host.querySelector('[data-doc-pane="B"]')).toBeNull();
  });
});

describe("the divider measures the whole stage (the panes own it)", () => {
  it("clamps the split against the stage width, with no rail offset", () => {
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
      const divider = host.querySelector<HTMLElement>("[data-multi-divider]");
      const pointer = (type: string, clientX: number): void => {
        const event = new Event(type, { bubbles: true });
        Object.defineProperty(event, "clientX", { value: clientX });
        Object.defineProperty(event, "pointerId", { value: 1 });
        act((): void => {
          divider?.dispatchEvent(event);
        });
      };
      // 571 / 1000 = 57.1%: no rail column is subtracted any more.
      pointer("pointerdown", 571);
      expect(stage?.style.getPropertyValue("--tf-split")).toBe("57.100%");
      expect(stage?.style.getPropertyValue("--tf-split-frac")).toBe("0.571");
      // The 320px pane minimum clamps: 320 / 1000 = 0.32.
      pointer("pointermove", 100);
      expect(stage?.style.getPropertyValue("--tf-split")).toBe("32.000%");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("single mode is unchanged by the per-pane strips", () => {
  it("renders no pane attributes, no divider and the same split value", () => {
    const host = mount(
      <StageHarness initial={{ enabled: false, paneA: null, paneB: null, focused: "A" }} />,
    );
    const stage = host.querySelector<HTMLElement>(".tab-stage");
    expect(stage?.getAttribute("data-multi-mode")).toBe("false");
    expect(stage?.getAttribute("data-multi-panes")).toBeNull();
    expect(host.querySelectorAll(".tab-pane")).toHaveLength(3);
    // The pre-Phase-32 inline split contract is untouched.
    expect(stage?.style.getPropertyValue("--tf-split")).toBe("50.000%");
    expect(host.querySelector("[data-pane]")).toBeNull();
    expect(host.querySelector("[data-multi-divider]")).toBeNull();
    expect(host.querySelector("[data-multi-rail]")).toBeNull();
    // Single mode hands `null` as the pane: no strip context.
    expect(host.querySelector('[data-doc-pane="single"]')).not.toBeNull();
    expect(host.querySelector("[data-thumb-stub]")).toBeNull();
  });
});