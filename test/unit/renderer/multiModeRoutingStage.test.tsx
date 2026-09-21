// @vitest-environment jsdom
//
// Phase 32 (chunk 2c) — the App-shaped routing composition, in the DOM.
//
// This harness wires the REAL `DocumentStage` with the REAL reducers and the
// REAL pure routing decisions, exactly as App does (the App wiring itself is
// source-scanned in multiModeRouting.test.ts). It proves the end-to-end
// behaviour a user sees:
//
//   - a focus change makes the focused pane's tab the strip's active tab,
//     and remounts neither pane's DocumentView;
//   - the two tab-strip rules;
//   - a document-scoped operation (read through the active-tab seam) changes
//     only the focused pane's document;
//   - closing a tab empties its pane, and closing the last tab falls back to
//     single mode.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act, useCallback, useReducer, useState } from "react";
import type { ReactElement } from "react";
import { DocumentStage, type StageTab } from "../../../src/renderer/components/MultiPane";
import {
  multiModeReducer,
  type MultiModeState,
  type PaneId,
} from "../../../src/renderer/state/multiMode";
import {
  resolvePaneClear,
  resolvePaneFocus,
  resolveTabStripActivation,
} from "../../../src/renderer/state/multiModeRouting";
import {
  tabsReducer,
  type TabMeta,
} from "../../../src/renderer/state/tabs";

function tab(id: string): TabMeta {
  return { id, title: `${id}.pdf`, filePath: `${id}.pdf`, kind: "file", modified: false };
}

const THREE = [tab("a"), tab("b"), tab("c")];

const BOTH: MultiModeState = { enabled: true, paneA: "a", paneB: "b", focused: "A" };

interface Api {
  /** A document-scoped operation, applied through the active-tab seam. */
  op: () => void;
  /** A tab close: the tabs reducer plus the same-commit pane reconcile. */
  close: (id: string) => void;
  pages: () => Record<string, number>;
}

function mount(element: ReactElement): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(element);
  });
  return host;
}

function RoutingHarness(props: { initial: MultiModeState; api: Api }): ReactElement {
  const { initial, api } = props;
  const [tabs, dispatchTabs] = useReducer(tabsReducer, { tabs: THREE, activeId: "a" });
  const [multi, dispatchMulti] = useReducer(multiModeReducer, initial);
  const [split, setSplit] = useState(0.5);
  const [pages, setPages] = useState<Record<string, number>>({ a: 3, b: 5, c: 7 });

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
      } else if (tabs.activeId !== null) {
        dispatchTabs({ type: "deactivate" });
      }
    },
    [multi, tabs.activeId, activateTab],
  );

  const assignPaneDocument = useCallback(
    (pane: PaneId, tabId: string): void => {
      dispatchMulti({ type: "assign", pane, tabId });
      dispatchMulti({ type: "focus", pane });
      if (tabs.activeId !== tabId) activateTab(tabId);
    },
    [tabs.activeId, activateTab],
  );

  const onTabStripActivate = useCallback(
    (id: string): void => {
      const decision = resolveTabStripActivation(multi, id);
      if (decision.assign !== null) {
        assignPaneDocument(decision.assign, id);
        return;
      }
      if (decision.focus !== null) dispatchMulti({ type: "focus", pane: decision.focus });
      activateTab(decision.activate);
    },
    [multi, assignPaneDocument, activateTab],
  );

  const onClearPane = useCallback(
    (pane: PaneId): void => {
      const nextActive = resolvePaneClear(multi, pane, tabs.activeId);
      dispatchMulti({ type: "clear", pane });
      if (nextActive === null && tabs.activeId !== null) {
        dispatchTabs({ type: "deactivate" });
      }
    },
    [multi, tabs.activeId],
  );

  api.op = (): void => {
    const id = tabs.activeId;
    if (id === null) return;
    setPages((prev) => ({ ...prev, [id]: (prev[id] ?? 0) + 1 }));
  };
  api.close = (id: string): void => {
    dispatchTabs({ type: "close", id });
    dispatchMulti({
      type: "reconcile",
      tabIds: tabs.tabs.filter((t) => t.id !== id).map((t) => t.id),
    });
  };
  api.pages = (): Record<string, number> => pages;

  const stageTabs: StageTab[] = tabs.tabs.map((t) => ({
    id: t.id,
    title: t.title,
    pageCount: pages[t.id] ?? 0,
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
            onClick={(): void => onTabStripActivate(t.id)}
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
        onClearPane={onClearPane}
        onPickPane={assignPaneDocument}
        onOpenIntoPane={(): void => undefined}
        renderDocument={(tabId): ReactElement => (
          <div data-doc-stub={tabId}>
            {pages[tabId] ?? 0} pages
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
const stubOf = (host: HTMLElement, tabId: string): HTMLElement | null =>
  host.querySelector<HTMLElement>(`[data-doc-stub="${tabId}"]`);
const stripActive = (host: HTMLElement, id: string): string | null =>
  host.querySelector(`[data-test-tab="${id}"]`)?.getAttribute("data-active") ?? null;

describe("focus drives the active tab and the strip highlight", () => {
  it("focusing pane B makes b the active tab, with no remount of either document", () => {
    const api = {} as Api;
    const host = mount(<RoutingHarness initial={BOTH} api={api} />);
    expect(stripActive(host, "a")).toBe("true");
    const stubA = stubOf(host, "a");
    const stubB = stubOf(host, "b");

    act((): void => {
      paneOf(host, "B").dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });

    expect(paneOf(host, "B").getAttribute("data-pane-focused")).toBe("true");
    expect(stripActive(host, "b")).toBe("true");
    expect(stripActive(host, "a")).toBe("false");
    // Same DOM nodes: the DocumentViews were never remounted.
    expect(stubOf(host, "a")).toBe(stubA);
    expect(stubOf(host, "b")).toBe(stubB);
  });
});

describe("the two tab-strip rules", () => {
  it("rule 1: a tab in a pane focuses that pane", () => {
    const api = {} as Api;
    const host = mount(<RoutingHarness initial={BOTH} api={api} />);
    act((): void => {
      host.querySelector<HTMLButtonElement>('[data-test-tab="b"]')?.click();
    });
    expect(paneOf(host, "B").getAttribute("data-pane-focused")).toBe("true");
    expect(paneOf(host, "A").getAttribute("data-pane-focused")).toBe("false");
    expect(stripActive(host, "b")).toBe("true");
  });

  it("rule 2: a tab outside the panes is assigned to the focused pane", () => {
    const api = {} as Api;
    const host = mount(<RoutingHarness initial={BOTH} api={api} />);
    act((): void => {
      host.querySelector<HTMLButtonElement>('[data-test-tab="c"]')?.click();
    });
    // Pane A now shows c; pane B is untouched.
    expect(stubOf(host, "c")).not.toBeNull();
    expect(paneOf(host, "A").querySelector('[data-doc-stub="c"]')).not.toBeNull();
    expect(paneOf(host, "B").querySelector('[data-doc-stub="b"]')).not.toBeNull();
    expect(stripActive(host, "c")).toBe("true");
    expect(paneOf(host, "A").getAttribute("data-pane-focused")).toBe("true");
  });

  it("rule 2: the other pane's tab focuses that pane instead of assigning", () => {
    const api = {} as Api;
    const host = mount(<RoutingHarness initial={BOTH} api={api} />);
    act((): void => {
      host.querySelector<HTMLButtonElement>('[data-test-tab="b"]')?.click();
    });
    // No duplicate: pane A still shows a, pane B still shows b.
    expect(paneOf(host, "A").querySelector('[data-doc-stub="a"]')).not.toBeNull();
    expect(paneOf(host, "B").querySelector('[data-doc-stub="b"]')).not.toBeNull();
    expect(paneOf(host, "B").getAttribute("data-pane-focused")).toBe("true");
  });
});

describe("a document-scoped operation targets only the focused pane", () => {
  it("changes only pane B's document while pane B is focused", () => {
    const api = {} as Api;
    const host = mount(<RoutingHarness initial={BOTH} api={api} />);
    act((): void => {
      paneOf(host, "B").dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    act((): void => {
      api.op();
    });
    expect(api.pages()).toEqual({ a: 3, b: 6, c: 7 });
    expect(paneOf(host, "B").querySelector('[data-doc-stub="b"]')?.textContent).toContain(
      "6 pages",
    );
    expect(paneOf(host, "A").querySelector('[data-doc-stub="a"]')?.textContent).toContain(
      "3 pages",
    );
  });

  it("is a clean no-op while an empty focused pane has no active tab", () => {
    const api = {} as Api;
    const host = mount(
      <RoutingHarness
        initial={{ enabled: true, paneA: "a", paneB: null, focused: "A" }}
        api={api}
      />,
    );
    act((): void => {
      paneOf(host, "B").dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    act((): void => {
      api.op();
    });
    expect(api.pages()).toEqual({ a: 3, b: 5, c: 7 });
  });
});

describe("tab close reconciles the panes", () => {
  it("empties the pane whose document closed and leaves the other pane alone", () => {
    const api = {} as Api;
    const host = mount(<RoutingHarness initial={BOTH} api={api} />);
    act((): void => {
      api.close("b");
    });
    expect(host.querySelector('.tab-pane[data-pane="B"][data-pane-empty]')).not.toBeNull();
    expect(paneOf(host, "A").querySelector('[data-doc-stub="a"]')).not.toBeNull();
    expect(host.querySelector(".tab-stage")?.getAttribute("data-multi-mode")).toBe("true");
  });

  it("falls back to single mode when the last tab is closed", () => {
    const api = {} as Api;
    const host = mount(
      <RoutingHarness
        initial={{ enabled: true, paneA: "a", paneB: null, focused: "A" }}
        api={api}
      />,
    );
    act((): void => {
      api.close("a");
    });
    act((): void => {
      api.close("b");
    });
    act((): void => {
      api.close("c");
    });
    expect(host.querySelector(".tab-stage")?.getAttribute("data-multi-mode")).toBe("false");
    expect(host.querySelector("[data-pane]")).toBeNull();
  });

  it("never leaves a stale pane after a close", () => {
    const api = {} as Api;
    const host = mount(<RoutingHarness initial={BOTH} api={api} />);
    act((): void => {
      api.close("b");
    });
    // The closed tab's pane shows its empty state, not a stale document.
    expect(stubOf(host, "b")).toBeNull();
    expect(host.querySelectorAll("[data-doc-stub]")).toHaveLength(2);
  });
});
