// @vitest-environment jsdom
//
// Phase 32 — Multi Mode: the two-pane workspace render contract.
//
// `DocumentStage` is the ONE workspace region. These tests pin the DOM
// contract the phase (and its e2e) depends on:
//
//   - Mode OFF: the pre-Phase-32 single-pane layout, and NO pane
//     attributes anywhere.
//   - Mode ON: two panes side by side, `data-pane="A"|"B"`, exactly one
//     `data-pane-focused="true"`, a `data-pane-header` per pane (name +
//     page count) and a `data-multi-divider`.
//   - Focus moves without remounting either DocumentView (the pane keys
//     are the tab ids), so a focus click cannot blank a canvas.
//   - An empty pane renders `data-pane-empty` with a `data-pane-pick` list
//     that EXCLUDES the other pane's document, plus `data-pane-open`.
//   - Assigning the other pane's document is refused with a visible
//     message (the App-shaped guard wiring).
//   - The CommandBar control and the All-tools entry read ONE state, so
//     toggling either flips both.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act, useCallback, useReducer, useState } from "react";
import type { ReactElement } from "react";
import { CommandBar } from "../../../src/renderer/components/CommandBar";
import { ToolsPalette } from "../../../src/renderer/components/ToolsPalette";
import { DocumentStage, type StageTab } from "../../../src/renderer/components/MultiPane";
import {
  initialMultiModeState,
  multiModeReducer,
  paneAssignError,
  type MultiModeState,
  type PaneId,
} from "../../../src/renderer/state/multiMode";

const TABS: StageTab[] = [
  { id: "a", title: "Alpha.pdf", pageCount: 3 },
  { id: "b", title: "Beta.pdf", pageCount: 5 },
  { id: "c", title: "Gamma.pdf", pageCount: 7 },
];

/** Handlers the test drives directly (the pick list cannot offer the
 *  other pane's document, so the guard is exercised through this seam). */
interface HarnessApi {
  pick?: (pane: PaneId, tabId: string) => void;
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

/** The App-shaped stage wiring: one reducer, the same assign guard. */
function StageHarness(props: {
  initial: MultiModeState;
  activeId?: string;
  showWelcome?: boolean;
  api?: HarnessApi;
  onFocusSpy?: () => void;
}): ReactElement {
  const { initial, activeId = "a", showWelcome = false, api, onFocusSpy } = props;
  const [multiMode, dispatchMultiMode] = useReducer(multiModeReducer, initial);
  const [message, setMessage] = useState<string | null>(null);
  const [splitFraction, setSplitFraction] = useState(0.5);

  const onPickPane = useCallback(
    (pane: PaneId, tabId: string): void => {
      const error = paneAssignError(multiMode, pane, tabId);
      if (error !== null) {
        setMessage(error);
        return;
      }
      dispatchMultiMode({ type: "assign", pane, tabId });
    },
    [multiMode],
  );
  if (api !== undefined) api.pick = onPickPane;

  return (
    <div>
      {message !== null && <p data-test-message>{message}</p>}
      <DocumentStage
        tabs={TABS}
        activeId={activeId}
        showWelcome={showWelcome}
        welcomeKey="welcome"
        welcome={<div data-test-welcome />}
        multiMode={multiMode}
        splitFraction={splitFraction}
        onSplitChange={setSplitFraction}
        onFocusPane={(pane): void => {
          onFocusSpy?.();
          dispatchMultiMode({ type: "focus", pane });
        }}
        onClearPane={(pane): void => dispatchMultiMode({ type: "clear", pane })}
        onPickPane={onPickPane}
        onOpenIntoPane={(): void => undefined}
        renderDocument={(tabId): ReactElement => <div data-doc-stub={tabId} />}
      />
    </div>
  );
}

const paneOf = (host: HTMLElement, id: string): HTMLElement => {
  const el = host.querySelector<HTMLElement>(`[data-pane="${id}"]`);
  if (el === null) throw new Error(`pane ${id} not found`);
  return el;
};

describe("DocumentStage — single mode is unchanged", () => {
  it("renders the single-pane layout with no pane attributes", () => {
    const host = mount(<StageHarness initial={initialMultiModeState} />);
    expect(host.querySelector(".tab-stage")?.getAttribute("data-multi-mode")).toBe("false");
    expect(host.querySelectorAll("[data-pane]")).toHaveLength(0);
    expect(host.querySelector("[data-multi-divider]")).toBeNull();
    expect(host.querySelector("[data-pane-empty]")).toBeNull();
    expect(host.querySelector("[data-pane-header]")).toBeNull();
    // The active tab is the visible pane; the other tabs stay mounted
    // but hidden (the pre-Phase-32 contract).
    const panes = [...host.querySelectorAll<HTMLElement>(".tab-pane")];
    expect(panes).toHaveLength(3);
    expect(panes.map((p) => p.getAttribute("aria-hidden"))).toEqual([
      "false",
      "true",
      "true",
    ]);
    expect(panes[0].querySelector('[data-doc-stub="a"]')).not.toBeNull();
  });
});

describe("DocumentStage — two panes", () => {
  const BOTH: MultiModeState = {
    enabled: true,
    paneA: "a",
    paneB: "b",
    focused: "A",
  };

  it("splits into pane A and pane B with headers and one focused pane", () => {
    const host = mount(<StageHarness initial={BOTH} />);
    expect(host.querySelector(".tab-stage")?.getAttribute("data-multi-mode")).toBe("true");
    const paneA = paneOf(host, "A");
    const paneB = paneOf(host, "B");
    expect(paneA.getAttribute("data-pane-focused")).toBe("true");
    expect(paneB.getAttribute("data-pane-focused")).toBe("false");
    // Each pane's own DocumentView is the same element it was in single
    // mode — the stub is rendered once per pane.
    expect(paneA.querySelector('[data-doc-stub="a"]')).not.toBeNull();
    expect(paneB.querySelector('[data-doc-stub="b"]')).not.toBeNull();
    const headerA = paneA.querySelector("[data-pane-header]");
    expect(headerA?.textContent).toContain("Alpha.pdf");
    expect(headerA?.textContent).toContain("3 pages");
    const headerB = paneB.querySelector("[data-pane-header]");
    expect(headerB?.textContent).toContain("Beta.pdf");
    expect(headerB?.textContent).toContain("5 pages");
    expect(host.querySelector("[data-multi-divider]")).not.toBeNull();
    expect(host.querySelector("[data-pane-empty]")).toBeNull();
    expect(host.querySelector(".tab-stage")?.getAttribute("data-multi-panes")).toBe("2");
  });

  it("moves focus on a pane click without remounting either document", () => {
    const host = mount(<StageHarness initial={BOTH} />);
    const stubA = paneOf(host, "A").querySelector('[data-doc-stub="a"]');
    const stubB = paneOf(host, "B").querySelector('[data-doc-stub="b"]');
    const paneB = paneOf(host, "B");
    act((): void => {
      paneB.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(paneOf(host, "B").getAttribute("data-pane-focused")).toBe("true");
    expect(paneOf(host, "A").getAttribute("data-pane-focused")).toBe("false");
    // Same DOM nodes: the DocumentViews were never remounted.
    expect(paneOf(host, "A").querySelector('[data-doc-stub="a"]')).toBe(stubA);
    expect(paneOf(host, "B").querySelector('[data-doc-stub="b"]')).toBe(stubB);
  });

  it("clears a pane through its header control", () => {
    const host = mount(<StageHarness initial={BOTH} />);
    const clearB = paneOf(host, "B").querySelector<HTMLButtonElement>("[data-pane-clear]");
    act((): void => {
      clearB?.click();
    });
    expect(host.querySelector('[data-pane="B"][data-pane-empty]')).not.toBeNull();
    expect(host.querySelector(".tab-stage")?.getAttribute("data-multi-panes")).toBe("1");
  });
});

describe("DocumentStage — the empty pane", () => {
  const EMPTY_B: MultiModeState = {
    enabled: true,
    paneA: "a",
    paneB: null,
    focused: "A",
  };

  it("offers the other open tabs (excluding pane A) and an Open action", () => {
    const host = mount(<StageHarness initial={EMPTY_B} />);
    const empty = host.querySelector<HTMLElement>('[data-pane="B"][data-pane-empty]');
    expect(empty).not.toBeNull();
    const picks = [...(empty?.querySelectorAll("[data-pane-pick]") ?? [])].map((el) =>
      el.getAttribute("data-pane-pick"),
    );
    expect(picks).toEqual(["b", "c"]);
    expect(empty?.querySelector("[data-pane-open]")).not.toBeNull();
    expect(empty?.querySelector("[data-pane-header]")).toBeNull();
    expect(host.querySelector(".tab-stage")?.getAttribute("data-multi-panes")).toBe("1");
  });

  it("makes the chosen document a real pane immediately", () => {
    const host = mount(<StageHarness initial={EMPTY_B} />);
    const pick = host.querySelector<HTMLButtonElement>('[data-pane-pick="c"]');
    act((): void => {
      pick?.click();
    });
    expect(host.querySelector("[data-pane-empty]")).toBeNull();
    expect(paneOf(host, "B").querySelector('[data-doc-stub="c"]')).not.toBeNull();
    expect(paneOf(host, "B").querySelector("[data-pane-header]")?.textContent).toContain(
      "Gamma.pdf",
    );
    expect(host.querySelector(".tab-stage")?.getAttribute("data-multi-panes")).toBe("2");
  });

  it("REFUSES the other pane's document with a visible message", () => {
    const api: HarnessApi = {};
    const host = mount(<StageHarness initial={EMPTY_B} api={api} />);
    expect(api.pick).toBeDefined();
    act((): void => {
      api.pick?.("B", "a");
    });
    expect(host.querySelector("[data-test-message]")?.textContent).toBe(
      "That document is already shown in the other pane.",
    );
    // The refused assign left pane B empty and pane A untouched.
    expect(host.querySelector("[data-pane-empty]")).not.toBeNull();
    expect(paneOf(host, "A").querySelector('[data-doc-stub="a"]')).not.toBeNull();
  });
});

describe("DocumentStage — the divider", () => {
  const BOTH: MultiModeState = {
    enabled: true,
    paneA: "a",
    paneB: "b",
    focused: "A",
  };

  it("reports a clamped split fraction while dragging", () => {
    const host = mount(<StageHarness initial={BOTH} />);
    const stage = host.querySelector<HTMLElement>(".tab-stage");
    const divider = host.querySelector<HTMLElement>("[data-multi-divider]");
    expect(divider).not.toBeNull();
    // jsdom has no layout: the stage measures 0px wide, so the drag parks
    // the split at the centred fallback instead of dividing by zero.
    const down = new Event("pointerdown", { bubbles: true });
    Object.defineProperty(down, "clientX", { value: 120 });
    Object.defineProperty(down, "pointerId", { value: 1 });
    act((): void => {
      divider?.dispatchEvent(down);
    });
    expect(stage?.style.getPropertyValue("--tf-split")).toBe("50.000%");
  });

  it("focuses the other pane when the empty pane is clicked", () => {
    const onFocusSpy = vi.fn();
    const host = mount(
      <StageHarness
        initial={{ enabled: true, paneA: "a", paneB: null, focused: "A" }}
        onFocusSpy={onFocusSpy}
      />,
    );
    const empty = host.querySelector<HTMLElement>('[data-pane="B"][data-pane-empty]');
    act((): void => {
      empty?.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(onFocusSpy).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[data-pane="B"]')?.getAttribute("data-pane-focused")).toBe(
      "true",
    );
  });
});

describe("Multi Mode entry points stay in sync", () => {
  function EntryHarness(): ReactElement {
    const [multiMode, dispatchMultiMode] = useReducer(
      multiModeReducer,
      initialMultiModeState,
    );
    const toggle = useCallback((): void => {
      dispatchMultiMode(
        multiMode.enabled
          ? { type: "disable" }
          : { type: "enable", activeTabId: "a" },
      );
    }, [multiMode.enabled]);
    return (
      <div>
        <CommandBar
          page={1}
          pageCount={3}
          zoomPercent={100}
          zoomMode="fit-width"
          onJump={(): void => undefined}
          onZoomIn={(): void => undefined}
          onZoomOut={(): void => undefined}
          onFitWidth={(): void => undefined}
          onFitPage={(): void => undefined}
          searchOpen={false}
          onToggleSearch={(): void => undefined}
          onMerge={(): void => undefined}
          onSplit={(): void => undefined}
          signToolActive={false}
          onSignClick={(): void => undefined}
          hasFormFields={false}
          onFlattenClick={(): void => undefined}
          onOptimize={(): void => undefined}
          onAuditSpace={(): void => undefined}
          multiModeEnabled={multiMode.enabled}
          onMultiModeToggle={toggle}
        />
        <ToolsPalette
          layout="list"
          onLayoutChange={(): void => undefined}
          onMerge={(): void => undefined}
          onSplit={(): void => undefined}
          onExtract={(): void => undefined}
          onRotate={(): void => undefined}
          onDelete={(): void => undefined}
          onSign={(): void => undefined}
          onOptimize={(): void => undefined}
          onAudit={(): void => undefined}
          onClose={(): void => undefined}
          hasOcrSuspects={false}
          documentRequired
          hasFormFields={false}
          onMultiMode={toggle}
          multiModeEnabled={multiMode.enabled}
        />
      </div>
    );
  }

  const barControl = (host: HTMLElement): HTMLButtonElement => {
    const el = host.querySelector<HTMLButtonElement>("[data-toolbar-multi-mode]");
    if (el === null) throw new Error("multi-mode toolbar control missing");
    return el;
  };
  const paletteEntry = (host: HTMLElement): HTMLButtonElement => {
    const el = host.querySelector<HTMLButtonElement>('[data-tool-id="multi-mode"]');
    if (el === null) throw new Error("multi-mode palette entry missing");
    return el;
  };

  it("toggling from the CommandBar flips the All-tools entry too", () => {
    const host = mount(<EntryHarness />);
    expect(barControl(host).getAttribute("aria-pressed")).toBe("false");
    expect(paletteEntry(host).getAttribute("aria-pressed")).toBe("false");
    act((): void => {
      barControl(host).click();
    });
    expect(barControl(host).getAttribute("aria-pressed")).toBe("true");
    expect(paletteEntry(host).getAttribute("aria-pressed")).toBe("true");
  });

  it("toggling from the All-tools entry flips the CommandBar control too", () => {
    const host = mount(<EntryHarness />);
    act((): void => {
      paletteEntry(host).click();
    });
    expect(paletteEntry(host).getAttribute("aria-pressed")).toBe("true");
    expect(barControl(host).getAttribute("aria-pressed")).toBe("true");
    act((): void => {
      paletteEntry(host).click();
    });
    expect(paletteEntry(host).getAttribute("aria-pressed")).toBe("false");
    expect(barControl(host).getAttribute("aria-pressed")).toBe("false");
  });
});
