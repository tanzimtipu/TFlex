// @vitest-environment jsdom
//
// DEF-282 — in Multi Mode the ONE shared toolbar row overlapped the pane
// headers: the panes kept `top: 0` while the absolutely-positioned bar sat on
// top of them, so `[data-pane-header]`, `[data-pane-clear]` and the strip
// header were clipped and unreachable.
//
// The fix: the stage's measured toolbar height (`--tf-multi-toolbar-h`, written
// inline by DocumentStage) offsets the panes exactly as it already offset the
// divider. These tests pin the runtime contract (the offset is DERIVED from the
// measured row height, never a hardcoded pixel value) and the static CSS
// contract (the panes and the divider both read that variable; the bar sits at
// the top).

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

function renderStage(multi: MultiModeState, shared: boolean): HTMLElement {
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
        sharedToolbar: shared ? createElement("div", { className: "toolbar" }, "bar") : null,
      }),
    );
  });
  return host;
}

/** Give the shared row a measured height and let the observer re-measure. */
function measureRow(host: HTMLElement, px: number): void {
  const row = host.querySelector<HTMLElement>("[data-shared-toolbar]");
  if (row === null) throw new Error("shared toolbar row did not render");
  Object.defineProperty(row, "offsetHeight", { configurable: true, get: () => px });
  act((): void => {
    for (const cb of roCallbacks) cb();
  });
}

const stageVar = (host: HTMLElement): string =>
  host.querySelector<HTMLElement>(".tab-stage")?.style.getPropertyValue("--tf-multi-toolbar-h") ?? "";

const MULTI: MultiModeState = { enabled: true, paneA: "a", paneB: "b", focused: "A" };
const SINGLE: MultiModeState = { enabled: false, paneA: null, paneB: null, focused: "A" };

describe("DEF-282 — the stage offsets the panes by the measured toolbar height", () => {
  it("derives the offset from the row's measured height (not a hardcoded value)", () => {
    const host = renderStage(MULTI, true);
    // jsdom has no layout: unmeasured = 0, the pre-chunk-4 baseline.
    expect(stageVar(host)).toBe("0px");
    measureRow(host, 41);
    expect(stageVar(host)).toBe("41px");
    // A different measurement must move the offset too: proof it is read
    // from the element rather than baked in.
    measureRow(host, 61);
    expect(stageVar(host)).toBe("61px");
  });

  it("follows the row height when the bar wraps at a narrow window", () => {
    const host = renderStage(MULTI, true);
    measureRow(host, 53);
    expect(stageVar(host)).toBe("53px");
    // The same bar wrapped to two rows: the panes must move down with it.
    measureRow(host, 105);
    expect(stageVar(host)).toBe("105px");
  });

  it("applies the offset to BOTH panes' CSS variable source (one stage value)", () => {
    const host = renderStage(MULTI, true);
    measureRow(host, 53);
    // Both panes are present and the stage carries the single value their
    // CSS `top` reads, so neither can start above the bar.
    expect(host.querySelectorAll('.tab-pane[data-pane="A"]').length).toBe(1);
    expect(host.querySelectorAll('.tab-pane[data-pane="B"]').length).toBe(1);
    expect(stageVar(host)).toBe("53px");
    // The panes are siblings of the bar inside the same stage.
    const stage = host.querySelector(".tab-stage");
    expect(stage?.querySelector("[data-shared-toolbar]")).not.toBeNull();
  });

  it("keeps single mode at zero offset with no toolbar row", () => {
    const host = renderStage(SINGLE, false);
    expect(host.querySelector("[data-shared-toolbar]")).toBeNull();
    expect(stageVar(host)).toBe("0px");
  });

  it("has no toolbar row in single mode even when one is supplied", () => {
    const host = renderStage(SINGLE, true);
    expect(host.querySelector("[data-shared-toolbar]")).toBeNull();
    expect(stageVar(host)).toBe("0px");
  });
});

// ---------------------------------------------------------------------------
// Static CSS guard: the offset the runtime writes must actually be consumed by
// the panes (the divider already consumed it). Removing the panes' `top` rule
// fails this assertion — the exact DEF-282 regression.

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

describe("DEF-282 — CSS consumes the measured offset for panes and divider", () => {
  const src = readFileSync(STYLES_PATH, "utf8");

  it("the Multi Mode panes start at the measured toolbar offset, not top: 0", () => {
    const body = findRuleBody(src, '.tab-stage[data-multi-mode="true"] .tab-pane[data-pane]');
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(/top:\s*var\(--tf-multi-toolbar-h,\s*0px\)/);
    // `top: 0` here is precisely DEF-282: it let the bar cover the headers.
    expect(body ?? "").not.toMatch(/top:\s*0\s*;/);
    expect(body ?? "").toMatch(/bottom:\s*0\s*;/);
  });

  it("the divider keeps the same measured offset (panes and divider stay consistent)", () => {
    const body = findRuleBody(src, ".multi-divider");
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(/top:\s*var\(--tf-multi-toolbar-h,\s*0px\)/);
  });

  it("the shared toolbar row is anchored at the stage top", () => {
    const body = findRuleBody(src, ".multi-toolbar-row");
    expect(body).not.toBeNull();
    expect(body ?? "").toMatch(/position:\s*absolute\s*;/);
    expect(body ?? "").toMatch(/top:\s*0\s*;/);
  });
});