// @vitest-environment jsdom
// Phase 113 (Quiet Actions) — migration wave F3: rails, viewer chrome and the
// title-bar / viewer leftovers.
//
// Pins the wave-F3 call sites onto the Phase 113 axes (`intent` / `kind` /
// `density`) via the chunk-B `Button` / `IconButton` primitive and the
// canonical class contract in docs/BUTTON-SYSTEM.md. Every assertion reads the
// shipped classes / ARIA the primitive emits; no behaviour (label, handler,
// data-* hook, role, shortcut, disabled predicate) is re-derived here.
//
// DELIBERATE NATIVE EXCEPTIONS (documented in docs/BUTTON-SYSTEM.md):
//   - the RulerStrip page number is a `motion.button` bound to the
//     `useLiftAnimation` gesture, so it keeps its native markup and adopts the
//     canonical axes directly (`btn btn-ghost btn-compact`);
//   - the thumbnail hover verbs are `role="button"` spans nested inside the
//     thumb's own button (invalid HTML as real buttons), so they too keep their
//     native markup and adopt the axes directly;
//   - the thumbnail button itself (`draggable` + drag/select gesture), the
//     `role="separator"` MultiDivider and the HTML5-draggable page-drag-handle
//     keep their native markup untouched.
// Only the class axis is asserted for the native adopters; their element,
// role, tabIndex and data-* hooks are unchanged.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";
import { UpdateIndicator } from "../../../src/renderer/components/UpdateIndicator";
import { MultiPaneHeader } from "../../../src/renderer/components/MultiPane";
import { RulerStrip } from "../../../src/renderer/components/SideRail";

const NOOP = (): void => undefined;

let roots: Root[] = [];
let hosts: HTMLElement[] = [];

function mount(ui: ReactElement): HTMLElement {
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  act((): void => {
    root.render(ui);
  });
  roots.push(root);
  hosts.push(host);
  return host;
}

function cls(el: Element | null): string {
  if (el === null) throw new Error("expected element");
  return el.getAttribute("class") ?? "";
}

beforeEach((): void => {
  roots = [];
  hosts = [];
});

afterEach((): void => {
  const rs = roots;
  const hs = hosts;
  roots = [];
  hosts = [];
  for (const root of rs) {
    act((): void => {
      root.unmount();
    });
  }
  for (const h of hs) h.remove();
  document.body.innerHTML = "";
});

describe("Phase 113 — wave F3 UpdateIndicator controls", () => {
  it("renders 'available' as a canonical primary action and keeps every hook", () => {
    const host = mount(
      <UpdateIndicator externalState={{ kind: "available", version: "1.6.0" }} />,
    );
    const btn = host.querySelector('[data-update-indicator-kind="available"]');
    expect(btn).not.toBeNull();
    expect(btn?.tagName.toLowerCase()).toBe("button");
    expect(cls(btn)).toContain("btn");
    expect(cls(btn)).toContain("btn-primary");
    expect(cls(btn)).toContain("update-indicator");
    expect(cls(btn)).toContain("update-indicator-available");
    expect(btn?.getAttribute("data-update-indicator")).not.toBeNull();
    expect(btn?.getAttribute("data-update-indicator-version")).toBe("1.6.0");
    expect(btn?.getAttribute("aria-label")).toContain("1.6.0");
    expect(btn?.getAttribute("title")).toBe(btn?.getAttribute("aria-label"));
    expect(btn?.textContent).toContain("Update v1.6.0");
  });

  it("renders 'downloaded' as a canonical primary action (Restart to update)", () => {
    const host = mount(
      <UpdateIndicator externalState={{ kind: "downloaded", version: "2.0.0" }} />,
    );
    const btn = host.querySelector('[data-update-indicator-kind="downloaded"]');
    expect(btn).not.toBeNull();
    expect(cls(btn)).toContain("btn-primary");
    expect(cls(btn)).toContain("update-indicator-downloaded");
    expect(btn?.getAttribute("data-update-indicator-version")).toBe("2.0.0");
    expect(btn?.textContent).toContain("Restart to update");
  });

  it("renders 'error' as a canonical secondary action (Retry)", () => {
    const host = mount(
      <UpdateIndicator externalState={{ kind: "error", message: "Bad credentials" }} />,
    );
    const btn = host.querySelector('[data-update-indicator-kind="error"]');
    expect(btn).not.toBeNull();
    expect(cls(btn)).toContain("btn");
    expect(cls(btn)).toContain("btn-secondary");
    expect(cls(btn)).toContain("update-indicator-error");
    expect(btn?.textContent).toContain("Retry");
  });
});

describe("Phase 113 — wave F3 MultiPaneHeader clear control", () => {
  it("renders the clear control as a canonical destructive compact icon button", () => {
    const host = mount(<MultiPaneHeader pane="A" title="Doc.pdf" pageCount={3} onClear={NOOP} />);
    const clear = host.querySelector("[data-pane-clear]");
    expect(clear).not.toBeNull();
    expect(clear?.tagName.toLowerCase()).toBe("button");
    expect(cls(clear)).toContain("btn");
    expect(cls(clear)).toContain("btn-danger");
    expect(cls(clear)).toContain("btn-icon");
    expect(cls(clear)).toContain("btn-compact");
    expect(cls(clear)).toContain("multi-pane-clear");
    expect(clear?.getAttribute("aria-label")).toBe("Clear pane A");
    expect(clear?.getAttribute("title")).toBe("Clear pane A");
  });
});

describe("Phase 113 — wave F3 RulerStrip native adopter", () => {
  it("renders a native page number that adopts the canonical tertiary compact axes", () => {
    const jumps: number[] = [];
    const host = mount(<RulerStrip pageCount={5} currentPage={1} onJump={(p) => jumps.push(p)} />);
    const page4 = host.querySelector<HTMLElement>('button[data-ruler-page="4"]');
    expect(page4).not.toBeNull();
    expect(page4?.tagName.toLowerCase()).toBe("button");
    expect(page4?.dataset.rulerPage).toBe("4");
    expect(cls(page4)).toContain("btn");
    expect(cls(page4)).toContain("btn-ghost");
    expect(cls(page4)).toContain("btn-compact");
    expect(cls(page4)).toContain("rail-ruler-page");
    expect(cls(page4)).not.toContain("rail-ruler-current");
    act((): void => {
      (page4 as HTMLElement).click();
    });
    expect(jumps).toEqual([4]);
  });

  it("keeps the current page marked with rail-ruler-current on the same axes", () => {
    const host = mount(<RulerStrip pageCount={5} currentPage={3} onJump={NOOP} />);
    const current = host.querySelector<HTMLElement>("button.rail-ruler-current");
    expect(current).not.toBeNull();
    expect(current?.dataset.rulerPage).toBe("3");
    expect(cls(current)).toContain("btn-ghost");
    expect(cls(current)).toContain("btn-compact");
    expect(cls(current)).toContain("rail-ruler-page");
  });
});
