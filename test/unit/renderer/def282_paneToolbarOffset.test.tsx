// @vitest-environment jsdom
//
// DEF-282 (restated by Phase 36 chunk 7) — no workspace chrome may cover the
// pane headers, and no offset may arrive after a paint.
//
// History: DEF-282 was the ONE shared toolbar ROW overlapping both pane headers
// — the panes kept `top: 0` while the absolutely-positioned bar sat over them,
// so `[data-pane-header]`, `[data-pane-clear]` and the strip header were
// clipped and unreachable. The fix offset the panes by the row's MEASURED
// height (`--tf-multi-toolbar-h`).
//
// Phase 36 (chunk 7) RETIRED that row: the shared dock replaces it, the
// measured offset is gone with it, and the panes own the stage from its top
// edge. The invariant is unchanged in substance — nothing may overlap the pane
// headers and no offset may be applied after a paint — and it is pinned here in
// its new form:
//
//   runtime — each pane's header is that pane's FIRST flow child; no shared row
//             node exists; the stage writes NO top-offset variable at all (so
//             there is nothing to apply late); the ONE shared dock lives in a
//             sibling layer pinned to the stage's bottom, never inside a pane.
//   static  — the pane rule and the divider start at `top: 0` (no offset is
//             consumed); `--tf-multi-toolbar-h` and `.multi-toolbar-row` are
//             gone; `.multi-dock-layer` is a zero-height box at the stage's
//             bottom, so workspace chrome cannot reach the header band.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { DocumentStage, type StageTab } from "../../../src/renderer/components/MultiPane";
import type { MultiModeState } from "../../../src/renderer/state/multiMode";

const STYLES_PATH = resolve(__dirname, "../../../src/renderer/styles.css");

const NOOP = (): void => undefined;

const TABS: StageTab[] = [
  { id: "a", title: "Alpha.pdf", pageCount: 3 },
  { id: "b", title: "Beta.pdf", pageCount: 3 },
];

interface FakeResizeObserver {
  observe(): void;
  unobserve(): void;
  disconnect(): void;
}

let roCallbacks: Array<() => void> = [];

class CapturingResizeObserver implements FakeResizeObserver {
  public constructor(cb: () => void) {
    roCallbacks.push(cb);
  }
  public observe(): void {}
  public unobserve(): void {}
  public disconnect(): void {}
}

function renderStage(multi: MultiModeState, sharedDock: boolean): HTMLElement {
  roCallbacks = [];
  (globalThis as { ResizeObserver?: unknown }).ResizeObserver = CapturingResizeObserver;
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
        sharedDock: sharedDock ? createElement("div", { "data-shared-dock-stub": true }) : null,
      }),
    );
  });
  return host;
}

/** Flush every captured ResizeObserver callback (a late measurement pass). */
function flushObservers(): void {
  act((): void => {
    for (const cb of [...roCallbacks]) cb();
  });
}

const stageEl = (host: HTMLElement): HTMLElement => {
  const el = host.querySelector<HTMLElement>(".tab-stage");
  if (el === null) throw new Error("stage missing");
  return el;
};

const MULTI: MultiModeState = { enabled: true, paneA: "a", paneB: "b", focused: "A" };
const SINGLE: MultiModeState = { enabled: false, paneA: null, paneB: null, focused: "A" };

describe("DEF-282 restated — the panes own the stage from its top edge", () => {
  it("writes NO top-offset variable on the first paint (nothing is measured)", () => {
    const host = renderStage(MULTI, true);
    expect(stageEl(host).style.getPropertyValue("--tf-multi-toolbar-h")).toBe("");
    // A late measurement pass must not introduce one either.
    flushObservers();
    expect(stageEl(host).style.getPropertyValue("--tf-multi-toolbar-h")).toBe("");
  });

  it("renders no shared row node of any kind in Multi Mode", () => {
    const host = renderStage(MULTI, true);
    expect(host.querySelector("[data-shared-toolbar]")).toBeNull();
    expect(host.querySelector(".multi-toolbar-row")).toBeNull();
    expect(host.querySelector("[data-multi-toolbar]")).toBeNull();
    expect(host.querySelector(".toolbar")).toBeNull();
  });

  it("makes each pane's header its FIRST flow child (nothing is laid over it)", () => {
    const host = renderStage(MULTI, true);
    for (const pane of ["A", "B"] as const) {
      const paneEl = host.querySelector<HTMLElement>(`.tab-pane[data-pane="${pane}"]`);
      const header = paneEl?.querySelector("[data-pane-header]");
      expect(header).not.toBeNull();
      expect(paneEl?.firstElementChild).toBe(header);
      // The clear affordance rides inside that header, so it cannot be covered.
      expect(header?.querySelector("[data-pane-clear]")).not.toBeNull();
    }
  });

  it("puts the ONE shared dock in a sibling layer pinned to the stage's bottom", () => {
    const host = renderStage(MULTI, true);
    const layers = host.querySelectorAll("[data-multi-dock-layer]");
    expect(layers).toHaveLength(1);
    const layer = layers[0] as HTMLElement;
    // Exactly one dock node, and it is NOT inside either pane.
    expect(layer.querySelectorAll("[data-shared-dock-stub]")).toHaveLength(1);
    expect(host.querySelectorAll("[data-shared-dock-stub]")).toHaveLength(1);
    expect(host.querySelector('.tab-pane[data-pane] [data-shared-dock-stub]')).toBeNull();
    // The layer is a direct child of the stage, after the panes and the divider,
    // so its bottom-anchored box can never sit over a pane header.
    expect(layer.parentElement).toBe(stageEl(host));
    const stage = stageEl(host);
    expect(stage.lastElementChild).toBe(layer);
    expect(host.querySelector("[data-multi-divider]")).not.toBeNull();
  });

  it("renders no dock layer in single mode, or when no dock is supplied", () => {
    expect(renderStage(SINGLE, true).querySelector("[data-multi-dock-layer]")).toBeNull();
    const noDock = renderStage(MULTI, false);
    expect(noDock.querySelector("[data-multi-dock-layer]")).toBeNull();
    expect(noDock.querySelector("[data-pane-header]")).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Static CSS guard: the removed offset must not reappear, and the dock layer's
// geometry must stay bottom-only.

function stripCssComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "");
}

function extractRuleBody(src: string, selectorIndex: number): string {
  const braceOpen = src.indexOf("{", selectorIndex);
  if (braceOpen === -1) return "";
  let depth = 0;
  for (let i = braceOpen; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(braceOpen + 1, i);
    }
  }
  return "";
}

function findRuleBody(src: string, selector: string): string | null {
  const stripped = stripCssComments(src);
  let from = 0;
  for (;;) {
    const idx = stripped.indexOf(selector, from);
    if (idx === -1) return null;
    let cursor = idx + selector.length;
    while (cursor < stripped.length && /\s/.test(stripped[cursor] ?? "")) cursor += 1;
    if (stripped[cursor] === "{") return extractRuleBody(stripped, idx);
    from = idx + selector.length;
  }
}

describe("DEF-282 restated — the stylesheet keeps the header band clear", () => {
  const src = readFileSync(STYLES_PATH, "utf8");

  it("the Multi Mode panes start at the stage top with no consumed offset", () => {
    const body = findRuleBody(src, '.tab-stage[data-multi-mode="true"] .tab-pane[data-pane]');
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(/top:\s*0\s*;/);
    expect(body ?? "").not.toMatch(/--tf-multi-toolbar-h/);
    // Phase 39 (DEF-348b/c) — the panes stop above the dock's reserved band
    // instead of running to the stage bottom; the top-band invariant is
    // unchanged.
    expect(body ?? "").toMatch(/bottom:\s*var\(--tf-multi-dock-band/);
  });

  it("the divider starts at the stage top too (panes and divider stay consistent)", () => {
    const body = findRuleBody(src, ".multi-divider");
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(/top:\s*0\s*;/);
    expect(body ?? "").not.toMatch(/--tf-multi-toolbar-h/);
  });

  it("the retired row and its variable are gone from the stylesheet", () => {
    // Comments may name the retired token (the retirement is documented); only
    // a real declaration / selector is a regression.
    const rules = stripCssComments(src);
    expect(rules).not.toMatch(/--tf-multi-toolbar-h/);
    expect(rules).not.toMatch(/\.multi-toolbar-row/);
  });

  it("the dock layer is a zero-height box pinned to the stage's bottom", () => {
    const body = findRuleBody(src, ".multi-dock-layer");
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(/position:\s*absolute\s*;/);
    expect(body ?? "").toMatch(/bottom:\s*0\s*;/);
    expect(body ?? "").toMatch(/height:\s*0\s*;/);
    expect(body ?? "").toMatch(/pointer-events:\s*none\s*;/);
    // No top anchor: the layer's box cannot extend upward past the bottom edge.
    expect(body ?? "").not.toMatch(/top:\s*/);
    // The dock itself is bottom-anchored, never top-anchored. Phase 104
    // (commit 7f0f605) moved the inset onto the `--dock-bottom-inset` token
    // (16px) so the token form proves the same bottom pin.
    const dock = findRuleBody(src, ".action-dock");
    expect(dock).not.toBeNull();
    expect(dock ?? "").toMatch(/bottom:\s*var\(--dock-bottom-inset\)\s*;/);
    expect(dock ?? "").not.toMatch(/top:\s*\d/);
  });
});
