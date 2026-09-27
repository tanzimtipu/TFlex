// @vitest-environment jsdom
// Phase 45 (item 3 / feature D) â€” the MULTI MODE activation animation.
//
// Pins the three things the fix promises:
//   1. the PURE geometry rule (`modeFlipDelta`) â€” a visible pane FLIPs from
//      its previous box, a newly-appearing pane slides in from its outer edge,
//      and equal rects animate nothing;
//   2. the RENDERED wiring â€” a mode toggle arms the stage's `data-mode-anim`
//      band and every pane carries `data-pane-tab` (the panes are the SAME
//      mounted elements; nothing is remounted);
//   3. the CENTRALISED motion contract â€” the `tf-mode-split` rule resolves
//      from the LAYOUT token (no hardcoded duration/easing), is
//      transform-only (the PDF bitmap is moved, never recoloured/faded), and
//      the reduced-motion path arms NO band (an immediate switch).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act, useReducer } from "react";
import type { ReactElement } from "react";
import { DocumentStage, type StageTab } from "../../../src/renderer/components/MultiPane";
import {
  initialMultiModeState,
  multiModeReducer,
} from "../../../src/renderer/state/multiMode";
import { modeFlipDelta } from "../../../src/renderer/components/modeTransition";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const STYLES = readFileSync(join(REPO_ROOT, "src", "renderer", "styles.css"), "utf8");

const TABS: StageTab[] = [
  { id: "a", title: "Alpha.pdf", pageCount: 3 },
  { id: "b", title: "Beta.pdf", pageCount: 5 },
];

function mount(element: ReactElement): HTMLElement {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(element);
  });
  return host;
}

/** A stage driven by the real reducer, with an imperative toggle handle. */
function StageHarness(props: { onReady: (toggle: () => void) => void }): ReactElement {
  const [multiMode, dispatch] = useReducer(multiModeReducer, initialMultiModeState);
  props.onReady((): void => dispatch({ type: "enable", activeTabId: "a" }));
  return (
    <DocumentStage
      tabs={TABS}
      activeId="a"
      showWelcome={false}
      welcomeKey="welcome"
      welcome={<div data-test-welcome />}
      multiMode={multiMode}
      splitFraction={0.5}
      onSplitChange={(): void => undefined}
      onFocusPane={(): void => undefined}
      onClearPane={(): void => undefined}
      onPickPane={(): void => undefined}
      onOpenIntoPane={(): void => undefined}
      renderDocument={(tabId): ReactElement => <div data-doc-stub={tabId} />}
    />
  );
}

describe("Phase 45 item 3 â€” modeFlipDelta (the pure FLIP rule)", () => {
  it("preserves the pane CENTRE when the pane re-sizes in place", () => {
    // A full-width pane becomes the left half: the centre moves from the
    // stage centre to the left quarter, so the start offset is +halfWidth.
    const first = { left: 0, top: 0, width: 1000, height: 600 };
    const last = { left: 0, top: 0, width: 500, height: 600 };
    const d = modeFlipDelta(first, last, "A");
    expect(d).not.toBeNull();
    expect(d?.dx).toBeCloseTo(250, 5); // 500 - 250
    expect(d?.dy).toBeCloseTo(0, 5);
  });

  it("slides an APPEARING pane in from its outer edge (A from the left, B from the right)", () => {
    const last = { left: 0, top: 0, width: 500, height: 600 };
    expect(modeFlipDelta(null, last, "A")?.dx).toBeCloseTo(-500, 5);
    expect(modeFlipDelta(null, last, "B")?.dx).toBeCloseTo(500, 5);
  });

  it("returns null when the pane already sits where it should (nothing to animate)", () => {
    const same = { left: 10, top: 5, width: 400, height: 300 };
    expect(modeFlipDelta(same, { ...same }, "A")).toBeNull();
  });

  it("returns null for a non-finite measurement (never writes a bad transform)", () => {
    const first = { left: Number.NaN, top: 0, width: 500, height: 600 };
    const last = { left: 0, top: 0, width: 500, height: 600 };
    expect(modeFlipDelta(first, last, "A")).toBeNull();
  });
});

describe("Phase 45 item 3 â€” the centralised motion contract (CSS)", () => {
  it("the mode-split keyframe is transform-only (PDF pixels are moved, never faded)", () => {
    const start = STYLES.indexOf("@keyframes tf-mode-split");
    expect(start, "tf-mode-split keyframe missing").toBeGreaterThan(-1);
    const body = STYLES.slice(start, STYLES.indexOf("}", STYLES.indexOf("to", start)));
    expect(body).toContain("translate(var(--tf-mode-dx");
    expect(body).toContain("var(--tf-mode-dy");
    for (const banned of ["opacity", "color", "filter", "background", "scale("]) {
      expect(body, `mode split must not animate ${banned}`).not.toContain(banned);
    }
  });

  it("the armed rule resolves from the LAYOUT token â€” no hardcoded duration/easing", () => {
    const idx = STYLES.indexOf(
      '.tab-stage[data-mode-anim] .tab-pane[data-pane-tab][aria-hidden="false"] {',
    );
    expect(idx, "armed mode rule missing").toBeGreaterThan(-1);
    const rule = STYLES.slice(idx, STYLES.indexOf("}", idx));
    expect(rule).toContain("animation: tf-mode-split");
    expect(rule).toContain("var(--motion-duration-layout)");
    expect(rule).toContain("var(--motion-ease-layout)");
    expect(rule).not.toMatch(/\d+(?:\.\d+)?m?s\b/);
    expect(rule).not.toContain("cubic-bezier(");
  });

  it("the stage clips the pane travel so a mid-animation pane cannot paint outside the workspace", () => {
    // Match the STANDALONE `.tab-stage` rule (compound selectors such as
    // `.app-main[...] .tab-stage` also exist and are not the base rule).
    const m = /(?:^|\n)\.tab-stage \{([^}]*)\}/.exec(STYLES);
    expect(m, "base .tab-stage rule missing").not.toBeNull();
    expect(m?.[1] ?? "").toContain("overflow: hidden");
  });
});

describe("Phase 45 item 3 â€” the rendered toggle", () => {
  it("arms the data-mode-anim band and keeps the panes as the same mounted elements", () => {
    let toggle: () => void = (): void => undefined;
    const host = mount(<StageHarness onReady={(fn): void => { toggle = fn; }} />);
    const stage = host.querySelector<HTMLElement>(".tab-stage");
    expect(stage).not.toBeNull();
    // No band before the toggle.
    expect(stage?.hasAttribute("data-mode-anim")).toBe(false);
    // Every pane carries the stable tab identity the FLIP keys on; the
    // document stub element survives the toggle (no remount).
    const before = host.querySelector('[data-doc-stub="a"]');
    act((): void => toggle());
    expect(stage?.getAttribute("data-multi-mode")).toBe("true");
    expect(stage?.hasAttribute("data-mode-anim")).toBe(true);
    expect(host.querySelectorAll(".tab-pane[data-pane-tab]").length).toBeGreaterThanOrEqual(2);
    expect(host.querySelector('[data-doc-stub="a"]')).toBe(before);
  });

  it("reduced motion arms NO band (an immediate switch)", () => {
    const original = window.matchMedia;
    (window as { matchMedia?: typeof window.matchMedia }).matchMedia = ((query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      onchange: null,
      addEventListener: (): void => undefined,
      removeEventListener: (): void => undefined,
      addListener: (): void => undefined,
      removeListener: (): void => undefined,
      dispatchEvent: (): boolean => false,
    })) as unknown as typeof window.matchMedia;
    try {
      let toggle: () => void = (): void => undefined;
      const host = mount(<StageHarness onReady={(fn): void => { toggle = fn; }} />);
      act((): void => toggle());
      const stage = host.querySelector<HTMLElement>(".tab-stage");
      expect(stage?.getAttribute("data-multi-mode")).toBe("true");
      expect(stage?.hasAttribute("data-mode-anim")).toBe(false);
    } finally {
      (window as { matchMedia?: typeof window.matchMedia }).matchMedia = original;
    }
  });
});
