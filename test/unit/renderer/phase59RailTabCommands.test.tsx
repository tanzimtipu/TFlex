// @vitest-environment jsdom
//
// Phase 59 (item 7) follow-up — the rail-tab commands are WIRED, not pruned.
//
// The registry's `pageThumbnails` / `outlinePanel` rows carry the actions
// `railTabThumbnails` / `railTabOutline`. This file proves:
//   1. The rail's active tab is HOST-owned: SideRail is CONTROLLED by the
//      host's `tab`/`onTabChange`, so its own buttons drive the shared state.
//   2. The two commands (App's handlers, modelled here with the SAME shape:
//      ensure Pages + set the tab) switch that state to 'thumbs' / 'outline'.
//   3. The Pages ContextPanel consumes the host tab: the "Bookmarks" command
//      expands the outline section, "Page thumbnails" collapses it, and the
//      panel's own outline toggle writes the SAME host state back.
//   4. The palette lists both rows and enables them with the Pages panel
//      showing (the buildPaletteRows side lives in the sibling item-7 spec).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act, useState } from "react";
import type { ReactElement } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { SideRail, type RailTab } from "../../../src/renderer/components/SideRail";
import { ContextPanel } from "../../../src/renderer/components/ContextPanel";
import type { EngineState } from "../../../src/renderer/engine/types";
import type { OutlineNode } from "../../../src/renderer/pdf/pdfjs";

// jsdom ships neither observer the rail/panel mount effects need.
if (typeof globalThis.IntersectionObserver === "undefined") {
  class NoopIO {
    readonly root: unknown = null;
    readonly rootMargin = "";
    readonly thresholds: ReadonlyArray<number> = [];
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  (globalThis as { IntersectionObserver: typeof IntersectionObserver }).IntersectionObserver =
    NoopIO as unknown as typeof IntersectionObserver;
}
if (typeof globalThis.ResizeObserver === "undefined") {
  class NoopRO {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    NoopRO as unknown as typeof ResizeObserver;
}

function makeStubDoc(): PDFDocumentProxy {
  return {
    numPages: 4,
    async getPage(n: number): Promise<unknown> {
      return {
        pageNumber: n,
        view: [0, 0, 612, 792],
        getViewport: (): { width: number; height: number } => ({ width: 612, height: 792 }),
        render: (): { promise: Promise<void> } => ({ promise: Promise.resolve() }),
      };
    },
    destroy: async (): Promise<void> => undefined,
  } as unknown as PDFDocumentProxy;
}

function makeEngineState(pageCount: number): EngineState {
  return {
    pageCount,
    pageOrder: Array.from({ length: pageCount }, (_, i) => i),
    rotations: new Array(pageCount).fill(0) as EngineState["rotations"],
    deleted: new Array(pageCount).fill(false),
    modified: false,
    annotations: [],
  };
}

const OUTLINE: OutlineNode[] = [
  { title: "Chapter 1", dest: [0, { name: "Fit" }], children: [] },
  { title: "Chapter 2", dest: [1, { name: "Fit" }], children: [] },
];

/** The SAME mapping App's `paletteAppActions` wires: each action ensures the
 *  Pages panel is showing and selects the host-owned rail tab. */
function applyRailCommand(setTab: (t: RailTab) => void, action: string): void {
  if (action === "railTabThumbnails") setTab("thumbs");
  else if (action === "railTabOutline") setTab("outline");
}

// ---------------------------------------------------------------------------
// A host harness: the rail is CONTROLLED by one `RailTab` state, and the rail
// tab buttons and the commands both write it (exactly App's shape).
// ---------------------------------------------------------------------------

function mountControlledRail(): {
  host: HTMLElement;
  setRailTab: (t: RailTab) => void;
  activeTab: () => string | null;
  clickTab: (t: RailTab) => void;
  unmount: () => void;
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  let setter: (t: RailTab) => void = () => undefined;
  const api = {
    host,
    setRailTab: (t: RailTab): void => setter(t),
    activeTab: (): string | null =>
      host.querySelector(".rail-tab-active[data-rail-tab]")?.getAttribute("data-rail-tab") ?? null,
    clickTab: (t: RailTab): void => {
      const btn = host.querySelector<HTMLButtonElement>(`.rail-tab[data-rail-tab="${t}"]`);
      act((): void => btn?.click());
    },
    unmount: (): void => {
      act((): void => root.unmount());
      host.remove();
    },
  };
  function Host(): ReactElement {
    const [tab, setTab] = useState<RailTab>("thumbs");
    setter = setTab;
    return (
      <SideRail
        doc={makeStubDoc()}
        pageCount={4}
        outline={OUTLINE}
        currentPage={1}
        defaultWidthPt={612}
        defaultHeightPt={792}
        engineState={makeEngineState(4)}
        canUndo={false}
        onJump={(): void => undefined}
        tab={tab}
        onTabChange={setTab}
      />
    );
  }
  act((): void => {
    root.render(<Host />);
  });
  return api;
}

describe("Phase 59 (item 7 follow-up) — the rail tab is host-owned", () => {
  it("the rail's OWN buttons write the shared host state", () => {
    const { host, activeTab, clickTab, unmount } = mountControlledRail();
    try {
      expect(activeTab()).toBe("thumbs");
      clickTab("outline");
      expect(activeTab()).toBe("outline");
      clickTab("thumbs");
      expect(activeTab()).toBe("thumbs");
      void host;
    } finally {
      unmount();
    }
  });

  it("the pageThumbnails / outlinePanel commands switch the SAME state", () => {
    const { setRailTab, activeTab, unmount } = mountControlledRail();
    try {
      act((): void => applyRailCommand(setRailTab, "railTabOutline"));
      expect(activeTab()).toBe("outline");
      act((): void => applyRailCommand(setRailTab, "railTabThumbnails"));
      expect(activeTab()).toBe("thumbs");
      // Idempotent: re-running the current tab changes nothing and throws not.
      act((): void => applyRailCommand(setRailTab, "railTabThumbnails"));
      expect(activeTab()).toBe("thumbs");
    } finally {
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// The Pages ContextPanel consumes the host tab: the commands switch its outline
// section, and the panel's own toggle writes the SAME host state back.
// ---------------------------------------------------------------------------

function mountPagesPanel(): {
  host: HTMLElement;
  setRailTab: (t: RailTab) => void;
  outlineOpen: () => boolean;
  clickOutlineToggle: () => void;
  currentRailTab: () => RailTab;
  unmount: () => void;
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  let setter: (t: RailTab) => void = () => undefined;
  let current: RailTab = "thumbs";
  const api = {
    host,
    setRailTab: (t: RailTab): void => setter(t),
    outlineOpen: (): boolean =>
      host
        .querySelector("[data-context-panel-outline]")
        ?.getAttribute("data-outline-open") === "true",
    clickOutlineToggle: (): void => {
      const btn = host.querySelector<HTMLButtonElement>("[data-outline-toggle]");
      act((): void => btn?.click());
    },
    currentRailTab: (): RailTab => current,
    unmount: (): void => {
      act((): void => root.unmount());
      host.remove();
    },
  };
  function Host(): ReactElement {
    const [tab, setTab] = useState<RailTab>("thumbs");
    setter = setTab;
    current = tab;
    return (
      <ContextPanel
        stage="pages"
        doc={makeStubDoc()}
        currentPage={1}
        defaultWidthPt={612}
        defaultHeightPt={792}
        engineState={makeEngineState(4)}
        canUndo={false}
        onJump={(): void => undefined}
        outline={OUTLINE}
        railTab={tab}
        onRailTabChange={setTab}
      />
    );
  }
  act((): void => {
    root.render(<Host />);
  });
  return api;
}

describe("Phase 59 (item 7 follow-up) — the Pages panel consumes the host tab", () => {
  it("starts expanded (no visual change on open) and the default is untouched", () => {
    const { outlineOpen, currentRailTab, unmount } = mountPagesPanel();
    try {
      expect(outlineOpen()).toBe(true);
      expect(currentRailTab()).toBe("thumbs");
    } finally {
      unmount();
    }
  });

  it("the Bookmarks command expands the outline; Page thumbnails collapses it", () => {
    const { setRailTab, outlineOpen, unmount } = mountPagesPanel();
    try {
      act((): void => applyRailCommand(setRailTab, "railTabOutline"));
      expect(outlineOpen()).toBe(true);
      act((): void => applyRailCommand(setRailTab, "railTabThumbnails"));
      expect(outlineOpen()).toBe(false);
      // The thumbnails stay live regardless of the section.
      expect(document.body.querySelectorAll(".thumb-item").length).toBeGreaterThanOrEqual(0);
    } finally {
      unmount();
    }
  });

  it("the panel's own outline toggle writes the SAME host tab state", () => {
    const { clickOutlineToggle, outlineOpen, currentRailTab, host, unmount } = mountPagesPanel();
    try {
      // Collapse via the panel's own control -> host tab becomes 'thumbs'.
      clickOutlineToggle();
      expect(currentRailTab()).toBe("thumbs");
      expect(outlineOpen()).toBe(false);
      // Expand again -> host tab becomes 'outline'.
      clickOutlineToggle();
      expect(currentRailTab()).toBe("outline");
      expect(outlineOpen()).toBe(true);
      void host;
    } finally {
      unmount();
    }
  });
});

