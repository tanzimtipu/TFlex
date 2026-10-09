// @vitest-environment jsdom
//
// TFL-1589 — the Action Dock's selection chip and primary verb group motion.
//
// The chip appears / dismisses through AnimatePresence (scale-fade) and its
// count crossfades on change; the primary verb group dissolves out before the
// next one blooms in. These tests pin those boundaries plus the reduced-motion
// collapse.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  ActionDock,
  type ActionDockProps,
  type DockBulkActions,
} from "../../../src/renderer/components/ActionDock";

function bulk(overrides: Partial<DockBulkActions> = {}): DockBulkActions {
  return { onRotate: vi.fn(), onExtract: vi.fn(), onDelete: vi.fn(), ...overrides };
}

interface FakeMql {
  matches: boolean;
  media: string;
  addEventListener(_type: string, listener: (ev: { matches: boolean }) => void): void;
  removeEventListener(_type: string, listener: (ev: { matches: boolean }) => void): void;
}

function installReducedMotionStub(matches: boolean): void {
  const listeners = new Set<(ev: { matches: boolean }) => void>();
  const mql: FakeMql = {
    matches,
    media: "(prefers-reduced-motion: reduce)",
    addEventListener: (_type, listener): void => {
      listeners.add(listener);
    },
    removeEventListener: (_type, listener): void => {
      listeners.delete(listener);
    },
  };
  (window as unknown as { matchMedia: (query: string) => FakeMql }).matchMedia = (query: string): FakeMql => {
    mql.media = query;
    return mql;
  };
}

const originalMatchMedia = window.matchMedia;

interface Harness {
  host: HTMLElement;
  rerender: (next: Partial<ActionDockProps>) => void;
  unmount: () => void;
}

function renderDock(options: Partial<ActionDockProps> = {}): Harness {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  let current: ActionDockProps = {
    activeStage: "pages",
    pageSelection: [],
    onClearPageSelection: vi.fn(),
    bulk: bulk(),
    dockPins: [],
    onPinTool: vi.fn(),
    onUnpinTool: vi.fn(),
    onRunTool: vi.fn(),
    canvasWidth: 1400,
    ...options,
  };
  const draw = (): void => {
    act((): void => {
      root.render(<ActionDock {...current} />);
    });
  };
  draw();
  return {
    host,
    rerender: (next): void => {
      current = { ...current, ...next };
      draw();
    },
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

async function flushFrame(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
}

beforeEach((): void => {
  installReducedMotionStub(false);
});

afterEach((): void => {
  if (originalMatchMedia === undefined) {
    Reflect.deleteProperty(window as unknown as Record<string, unknown>, "matchMedia");
  } else {
    window.matchMedia = originalMatchMedia;
  }
});

describe("TFL-1589 — dock selection chip animation", () => {
  it("mounts the chip as a motion.span when a page selection is active", () => {
    const { host, unmount } = renderDock({ activeStage: "pages", pageSelection: [2, 3] });
    try {
      const chip = host.querySelector<HTMLElement>("[data-dock-chip]");
      expect(chip).not.toBeNull();
      expect(chip?.tagName).toBe("SPAN");
      expect(chip?.hasAttribute("style")).toBe(true);
      expect(chip?.textContent).toBe("2 pages");
    } finally {
      unmount();
    }
  });

  it("holds the chip through its exit, then unmounts when the selection clears", async () => {
    const { host, rerender, unmount } = renderDock({ activeStage: "pages", pageSelection: [2, 3] });
    try {
      expect(host.querySelector("[data-dock-chip]")).not.toBeNull();
      rerender({ pageSelection: [] });
      expect(host.querySelector("[data-dock-chip]")).not.toBeNull();
      await flushFrame();
      expect(host.querySelector("[data-dock-chip]")).toBeNull();
    } finally {
      unmount();
    }
  });

  it("re-keys the chip count so a change crossfades instead of cutting", async () => {
    const { host, rerender, unmount } = renderDock({ activeStage: "pages", pageSelection: [2] });
    try {
      expect(host.querySelector("[data-dock-chip-count]")?.textContent).toBe("1 page");
      rerender({ pageSelection: [2, 3, 4] });
      await flushFrame();
      expect(host.querySelector("[data-dock-chip-count]")?.textContent).toBe("3 pages");
    } finally {
      unmount();
    }
  });

  it("swaps the primary verb group through AnimatePresence on stage -> selection", async () => {
    const { host, rerender, unmount } = renderDock({ activeStage: "pages", pageSelection: [] });
    try {
      const group = host.querySelector<HTMLElement>('[data-dock-group="primary"]');
      expect(group).not.toBeNull();
      expect(group?.classList.contains("action-dock-group")).toBe(true);
      // The motion group neutralises the legacy CSS keyframe.
      expect(group?.style.animation).toBe("none");
      // Stage state has no selection-only Clear verb.
      expect(group?.querySelector('[data-dock-verb="clearPageSelection"]')).toBeNull();
      rerender({ pageSelection: [2, 3] });
      await flushFrame();
      const swapped = host.querySelector<HTMLElement>('[data-dock-group="primary"]');
      // The next group bloomed in with the selection verbs.
      expect(swapped?.querySelector('[data-dock-verb="clearPageSelection"]')).not.toBeNull();
    } finally {
      unmount();
    }
  });

  it("collapses to instant under reduced motion (no scale transform on the chip)", () => {
    installReducedMotionStub(true);
    const { host, unmount } = renderDock({ activeStage: "pages", pageSelection: [2, 3] });
    try {
      const chip = host.querySelector<HTMLElement>("[data-dock-chip]");
      expect(chip).not.toBeNull();
      expect(chip?.style.transform).toBe("");
    } finally {
      unmount();
    }
  });
});
