// @vitest-environment jsdom
//
// Phase 119 (chunk B) — the Adaptive Shell layout / breakpoint foundation.
//
// Pins the exact LAYOUT / BREAKPOINTS constants, the classifyViewport
// boundaries and the useDocumentViewport mount measurement. Setup/teardown
// mirrors sibling renderer specs (phase117_selectionPrimitives): react-dom/
// client + `act` (the repo does not ship @testing-library/react).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, it, vi } from "vitest";
import { act, useRef, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { BREAKPOINTS, LAYOUT, classifyViewport } from "../../../src/renderer/design/layout";
import { useDocumentViewport } from "../../../src/renderer/hooks/useDocumentViewport";

class StubResizeObserver {
  static instances: StubResizeObserver[] = [];
  readonly observe = vi.fn();
  readonly unobserve = vi.fn();
  readonly disconnect = vi.fn();

  constructor(public readonly cb: ResizeObserverCallback) {
    StubResizeObserver.instances.push(this);
  }
}

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
  vi.restoreAllMocks();
  StubResizeObserver.instances = [];
});

function Probe(): ReactElement {
  const ref = useRef<HTMLDivElement | null>(null);
  const vp = useDocumentViewport(ref);
  return (
    <div
      ref={ref}
      data-width={String(vp.width)}
      data-layout={vp.layoutClass}
      data-compact={String(vp.compact)}
      data-tight={String(vp.tight)}
    />
  );
}

describe("Phase 119 — LAYOUT / BREAKPOINTS", () => {
  it("pins the exact LAYOUT values", () => {
    expect(LAYOUT).toEqual({
      fineTargetPx: 32,
      coarseTargetPx: 44,
      controlRadiusPx: 9,
      surfaceRadiusPx: 14,
      motionMs: 140,
      railMinTabPx: 148,
      railOverflowMinTabs: 3,
      dockOverflowMinItems: 4,
      panelLeftMinPx: 240,
      panelLeftMaxPx: 420,
      panelRightMinPx: 260,
      panelRightMaxPx: 380,
    });
  });

  it("pins the exact BREAKPOINTS", () => {
    expect(BREAKPOINTS).toEqual({ narrow: 900, compact: 720, tight: 520 });
  });
});

describe("Phase 119 — classifyViewport", () => {
  it("resolves the inclusive breakpoint boundaries", () => {
    expect(classifyViewport(1200)).toBe("wide");
    expect(classifyViewport(900)).toBe("narrow");
    expect(classifyViewport(720)).toBe("compact");
    expect(classifyViewport(520)).toBe("tight");
  });
});

describe("Phase 119 — useDocumentViewport", () => {
  it("measures the host and maps it to layoutClass / compact / tight", () => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver = StubResizeObserver;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 860,
      height: 600,
      top: 0,
      left: 0,
      right: 860,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: (): Record<string, never> => ({}),
    } as DOMRect);
    const host = mount(<Probe />);
    const probe = host.firstElementChild as HTMLElement;
    expect(probe.getAttribute("data-width")).toBe("860");
    expect(probe.getAttribute("data-layout")).toBe("narrow");
    expect(probe.getAttribute("data-compact")).toBe("true");
    expect(probe.getAttribute("data-tight")).toBe("false");
  });
});
