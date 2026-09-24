// @vitest-environment jsdom
//
// DEF-287 (residual, frontend) — the stored split fraction must be re-clamped
// whenever the available geometry changes while Multi Mode is on, so each
// pane's page area keeps its usable minimum at every supported window width
// with the panel open WITHOUT requiring a drag. Same class as DEF-283 (a
// stored geometry not re-clamped when the viewport changes).
//
// The re-clamp reuses the divider drag's ONE pure rule
// (`clampSplitFraction` in multiPaneLayout.ts): the drag, the geometry-change
// re-clamp and these tests all read it. The drag path itself is untouched —
// the re-clamp is inert while a pointer drag is in flight.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, useCallback, useState, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { DocumentStage, type StageTab } from "../../../src/renderer/components/MultiPane";
import {
  MIN_PAGE_WIDTH_PX,
  MIN_PANE_PANE_PX,
  INSPECTOR_W_PX,
  clampSplitFraction,
  multiPaneGeometry,
} from "../../../src/renderer/components/multiPaneLayout";
import type { MultiModeState } from "../../../src/renderer/state/multiMode";

const NOOP = (): void => undefined;

const TABS: StageTab[] = [
  { id: "a", title: "Alpha.pdf", pageCount: 3 },
  { id: "b", title: "Beta.pdf", pageCount: 5 },
];

const BOTH: MultiModeState = { enabled: true, paneA: "a", paneB: "b", focused: "A" };

/** jsdom has no layout: `clientWidth` is 0 and ResizeObserver never fires.
 *  This stub captures the observer callback so a test can drive a resize. */
type ROCallback = () => void;
let roCallbacks: ROCallback[] = [];
class CapturingResizeObserver {
  private readonly cb: ROCallback;
  constructor(cb: ROCallback) {
    this.cb = cb;
  }
  observe(): void {
    roCallbacks.push(this.cb);
  }
  unobserve(): void {}
  disconnect(): void {}
}
(globalThis as unknown as { ResizeObserver: typeof CapturingResizeObserver }).ResizeObserver =
  CapturingResizeObserver;

beforeEach((): void => {
  roCallbacks = [];
});

interface Ctl {
  /** Every fraction `onSplitChange` received, in order. */
  calls: number[];
}

function Harness(props: {
  ctl: Ctl;
  initial: number;
  initialTarget: number;
  multi?: MultiModeState;
}): ReactElement {
  const { ctl, initial, initialTarget } = props;
  const [split, setSplit] = useState(initial);
  const [target, setTarget] = useState(initialTarget);
  const onChange = useCallback(
    (f: number): void => {
      ctl.calls.push(f);
      setSplit(f);
    },
    [ctl],
  );
  return (
    <div>
      <button
        type="button"
        data-open-panel
        onClick={(): void => setTarget(INSPECTOR_W_PX)}
      >
        open panel
      </button>
      <button type="button" data-close-panel onClick={(): void => setTarget(0)}>
        close panel
      </button>
      <DocumentStage
        tabs={TABS}
        activeId="a"
        showWelcome={false}
        welcomeKey="welcome"
        welcome={null}
        multiMode={props.multi ?? BOTH}
        splitFraction={split}
        onSplitChange={onChange}
        toolsInsetTarget={target}
        onFocusPane={NOOP}
        onClearPane={NOOP}
        onPickPane={NOOP}
        onOpenIntoPane={NOOP}
        renderDocument={(): ReactElement => <div />}
      />
    </div>
  );
}

function mount(element: ReactElement): { host: HTMLElement; unmount: () => void } {
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

const stageOf = (host: HTMLElement): HTMLElement => {
  const stage = host.querySelector<HTMLElement>(".tab-stage");
  if (stage === null) throw new Error("stage missing");
  return stage;
};

/** The stored fraction as DocumentStage renders it (`--tf-split-frac`). */
const fractionOf = (host: HTMLElement): number =>
  Number.parseFloat(stageOf(host).style.getPropertyValue("--tf-split-frac"));

/** Drive the captured ResizeObserver after setting the stage's clientWidth. */
function resizeStage(host: HTMLElement, width: number): void {
  const stage = stageOf(host);
  Object.defineProperty(stage, "clientWidth", { configurable: true, value: width });
  act((): void => {
    for (const cb of [...roCallbacks]) cb();
  });
}


// ---------------------------------------------------------------------------
// The pure rule: the re-clamp reuses the drag's arithmetic verbatim.
// ---------------------------------------------------------------------------

describe("DEF-287 residual — clampSplitFraction is the ONE rule", () => {
  it("is the identity for a fraction already inside the bounds", () => {
    expect(clampSplitFraction(1600, INSPECTOR_W_PX, 0.5)).toBe(0.5);
    expect(clampSplitFraction(1200, 0, 0.5)).toBe(0.5);
  });

  it("clamps a carried fraction up to the pane minimum", () => {
    // Phase 36 (chunk 5) — the Inspector's 264px replaces the palette's 344px.
    // min = (MIN_PANE_WIDTH_PX + inset/2) / W = (320 + 132) / 1000.
    expect(clampSplitFraction(1000, INSPECTOR_W_PX, 0.35)).toBeCloseTo(0.452, 9);
  });

  it("pins to 0.5 when even 0.5 cannot satisfy the minimum", () => {
    expect(clampSplitFraction(640, INSPECTOR_W_PX, 0.35)).toBe(0.5);
    expect(clampSplitFraction(500, INSPECTOR_W_PX, 0.9)).toBe(0.5);
    expect(clampSplitFraction(0, INSPECTOR_W_PX, 0.35)).toBe(0.5);
  });

  it("is idempotent — a re-clamp can never oscillate", () => {
    const cases: Array<[number, number, number]> = [
      [640, INSPECTOR_W_PX, 0.2],
      [1000, INSPECTOR_W_PX, 0.35],
      [1600, 0, 0.7],
      [480, INSPECTOR_W_PX, 0.5],
    ];
    for (const [w, inset, f] of cases) {
      const once = clampSplitFraction(w, inset, f);
      expect(clampSplitFraction(w, inset, once)).toBe(once);
    }
  });
});

// ---------------------------------------------------------------------------
// The trigger points: a window resize and the panel open/close.
// ---------------------------------------------------------------------------

describe("DEF-287 residual — the stored fraction is re-clamped on geometry change", () => {
  it("re-clamps a wide-window fraction when the window narrows, panel open", () => {
    const ctl: Ctl = { calls: [] };
    const { host, unmount } = mount(
      <Harness ctl={ctl} initial={0.35} initialTarget={INSPECTOR_W_PX} />,
    );
    try {
      // Carried in from a wide window: under budget at 640 with the panel open.
      const before = multiPaneGeometry(640, INSPECTOR_W_PX, 0.35);
      expect(before.paneA.width).toBeLessThan(MIN_PANE_PANE_PX);

      resizeStage(host, 640);

      expect(ctl.calls).toEqual([0.5]);
      const f = fractionOf(host);
      expect(f).toBe(0.5);
      const g = multiPaneGeometry(640, INSPECTOR_W_PX, f);
      expect(g.paneA.width).toBeGreaterThanOrEqual(MIN_PANE_PANE_PX);
      expect(g.paneB.width).toBeGreaterThanOrEqual(MIN_PANE_PANE_PX);
      expect(g.paneA.page).toBeGreaterThanOrEqual(MIN_PAGE_WIDTH_PX);
      expect(g.paneB.page).toBeGreaterThanOrEqual(MIN_PAGE_WIDTH_PX);
    } finally {
      unmount();
    }
  });

  it("re-clamps the same way when the panel OPENS at a fixed width", () => {
    const ctl: Ctl = { calls: [] };
    const { host, unmount } = mount(<Harness ctl={ctl} initial={0.35} initialTarget={0} />);
    try {
      resizeStage(host, 1000);
      // Closed at 1000 the carried fraction is valid: no churn on the resize.
      expect(ctl.calls).toEqual([]);
      expect(fractionOf(host)).toBeCloseTo(0.35, 6);

      act((): void => {
        host.querySelector<HTMLButtonElement>("[data-open-panel]")?.click();
      });

      expect(ctl.calls).toHaveLength(1);
      const f = fractionOf(host);
      expect(f).toBeCloseTo(clampSplitFraction(1000, INSPECTOR_W_PX, 0.35), 6);
      expect(f).toBeGreaterThan(0.35);
      const g = multiPaneGeometry(1000, INSPECTOR_W_PX, f);
      expect(g.paneA.width).toBeGreaterThanOrEqual(MIN_PANE_PANE_PX);
      expect(g.paneA.page).toBeGreaterThanOrEqual(MIN_PAGE_WIDTH_PX);
      expect(g.paneB.page).toBeGreaterThanOrEqual(MIN_PAGE_WIDTH_PX);

      // Closing the panel is also a geometry change: the (now wider) panes
      // still satisfy the rule, so nothing is written and the fraction holds.
      const opened = fractionOf(host);
      act((): void => {
        host.querySelector<HTMLButtonElement>("[data-close-panel]")?.click();
      });
      expect(ctl.calls).toHaveLength(1);
      expect(fractionOf(host)).toBeCloseTo(opened, 9);
    } finally {
      unmount();
    }
  });

  it("leaves a valid fraction untouched on a resize with the panel CLOSED", () => {
    const ctl: Ctl = { calls: [] };
    const { host, unmount } = mount(<Harness ctl={ctl} initial={0.5} initialTarget={0} />);
    try {
      resizeStage(host, 1600);
      resizeStage(host, 1200);
      expect(ctl.calls).toEqual([]);
      expect(fractionOf(host)).toBe(0.5);
    } finally {
      unmount();
    }
  });

  it("pins to 0.5 below the supported minimum without oscillating", () => {
    const ctl: Ctl = { calls: [] };
    const { host, unmount } = mount(
      <Harness ctl={ctl} initial={0.35} initialTarget={INSPECTOR_W_PX} />,
    );
    try {
      resizeStage(host, 500);
      expect(ctl.calls).toEqual([0.5]);
      resizeStage(host, 500);
      resizeStage(host, 480);
      expect(ctl.calls).toEqual([0.5]);
      expect(fractionOf(host)).toBe(0.5);
      const g = multiPaneGeometry(480, INSPECTOR_W_PX, 0.5);
      // The DEF-287 inset cap keeps the page areas usable there.
      expect(g.inset).toBeLessThan(INSPECTOR_W_PX);
      expect(g.paneA.page).toBeGreaterThanOrEqual(MIN_PAGE_WIDTH_PX);
      expect(g.paneB.page).toBeGreaterThanOrEqual(MIN_PAGE_WIDTH_PX);
    } finally {
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// The drag path is unchanged (the re-clamp never fights the pointer).
// ---------------------------------------------------------------------------

const rect = (width: number, height = 600): DOMRect =>
  ({
    left: 0,
    top: 0,
    width,
    height,
    right: width,
    bottom: height,
    x: 0,
    y: 0,
    toJSON: (): Record<string, number> => ({}),
  }) as DOMRect;

/** Drive one divider pointerdown with a stubbed stage rect + inset token. */
function dragDivider(
  host: HTMLElement,
  stageWidth: number,
  clientX: number,
  inset: string,
): string {
  const stage = stageOf(host);
  Object.defineProperty(stage, "getBoundingClientRect", {
    configurable: true,
    value: (): DOMRect => rect(stageWidth),
  });
  const realGCS = window.getComputedStyle.bind(window);
  const fake = {
    getPropertyValue: (p: string): string => (p === "--tf-tools-inset" ? inset : ""),
  } as unknown as CSSStyleDeclaration;
  vi.spyOn(window, "getComputedStyle").mockImplementation(
    (el: Element): CSSStyleDeclaration => (el === stage ? fake : realGCS(el)),
  );
  const divider = host.querySelector<HTMLElement>("[data-multi-divider]");
  const down = new Event("pointerdown", { bubbles: true });
  Object.defineProperty(down, "clientX", { value: clientX });
  Object.defineProperty(down, "pointerId", { value: 1 });
  act((): void => {
    divider?.dispatchEvent(down);
  });
  vi.restoreAllMocks();
  return stage.style.getPropertyValue("--tf-split");
}

describe("DEF-287 residual — the drag path is unchanged", () => {
  it("keeps the pre-change 1:1 tracking (inset participates, pointer->fraction)", () => {
    const ctl: Ctl = { calls: [] };
    const { host, unmount } = mount(
      <Harness ctl={ctl} initial={0.5} initialTarget={INSPECTOR_W_PX} />,
    );
    try {
      expect(dragDivider(host, 2000, 800, "400px")).toBe("50.000%");
      expect(dragDivider(host, 2000, 800, "0px")).toBe("40.000%");
    } finally {
      unmount();
    }
  });

  it("writes exactly once per drag and is never overridden by the re-clamp", () => {
    const ctl: Ctl = { calls: [] };
    const { host, unmount } = mount(
      <Harness ctl={ctl} initial={0.5} initialTarget={INSPECTOR_W_PX} />,
    );
    try {
      // A narrow, panel-open stage: the drag parks at 0.5 (below two minimum
      // panes), exactly as before.
      expect(dragDivider(host, 640, 100, "344px")).toBe("50.000%");
      expect(ctl.calls).toEqual([0.5]);
    } finally {
      unmount();
    }
  });
});
