// @vitest-environment jsdom
//
// Phase 14.1 — the shared GlassSidebar material.
//
// ONE header/body system for BOTH floating panels so the left Pages
// rail and the right Tools panel can never drift apart again. These
// tests pin:
//   1. The GlassSidebar primitives render the shared structure
//      (header row: title left, actions right; body region).
//   2. SideRail (Pages, left) consumes it — with its legacy
//      .rail-header / .rail-tabs / .rail-content classes intact.
//   3. ToolsPalette (Tools, right) consumes the SAME header — material
//      parity between the two panels is structural, not just CSS.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import type { ReactElement } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { SideRail } from "../../../src/renderer/components/SideRail";
import { ToolsPalette } from "../../../src/renderer/components/ToolsPalette";
import {
  GlassSidebar,
  GlassSidebarBody,
  GlassSidebarHeader,
} from "../../../src/renderer/components/GlassSidebar";
import type { EngineState } from "../../../src/renderer/engine/types";

if (typeof globalThis.IntersectionObserver === "undefined") {
  class NoopIntersectionObserver {
    readonly root: unknown = null;
    readonly rootMargin = "";
    readonly thresholds: ReadonlyArray<number> = [];
    observe(): void {
      /* no-op */
    }
    unobserve(): void {
      /* no-op */
    }
    disconnect(): void {
      /* no-op */
    }
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  (globalThis as { IntersectionObserver: typeof IntersectionObserver }).IntersectionObserver =
    NoopIntersectionObserver as unknown as typeof IntersectionObserver;
}
if (typeof globalThis.ResizeObserver === "undefined") {
  class NoopResizeObserver {
    observe(): void {
      /* no-op */
    }
    unobserve(): void {
      /* no-op */
    }
    disconnect(): void {
      /* no-op */
    }
  }
  (globalThis as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    NoopResizeObserver as unknown as typeof ResizeObserver;
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

function unmount(host: HTMLElement): void {
  host.remove();
}

describe("GlassSidebar — the shared panel primitives", () => {
  it("GlassSidebarHeader renders title left + actions right in one row", () => {
    const host = mount(
      <GlassSidebarHeader
        title="Pages"
        actions={<button type="button">toggle</button>}
      />,
    );
    try {
      const header = host.querySelector<HTMLElement>(".glass-sidebar-header");
      expect(header).not.toBeNull();
      expect(header?.querySelector(".glass-sidebar-title")?.textContent).toBe("Pages");
      const actions = header?.querySelector(".glass-sidebar-actions");
      expect(actions).not.toBeNull();
      expect(actions?.querySelector("button")).not.toBeNull();
    } finally {
      unmount(host);
    }
  });

  it("the legacy class pass-through keeps existing CSS selectors resolving", () => {
    const host = mount(
      <GlassSidebarHeader title="Tools" className="tools-palette-header" />,
    );
    try {
      const header = host.querySelector<HTMLElement>(".tools-palette-header");
      expect(header).not.toBeNull();
      expect(header?.classList.contains("glass-sidebar-header")).toBe(true);
    } finally {
      unmount(host);
    }
  });

  it("GlassSidebar composes header + body (title prop renders the header)", () => {
    const host = mount(
      <GlassSidebar title="Tools">
        <GlassSidebarBody className="tools-palette-body">content</GlassSidebarBody>
      </GlassSidebar>,
    );
    try {
      const sidebar = host.querySelector<HTMLElement>(".glass-sidebar");
      expect(sidebar).not.toBeNull();
      expect(sidebar?.querySelector(".glass-sidebar-header")).not.toBeNull();
      expect(sidebar?.querySelector(".glass-sidebar-body")).not.toBeNull();
    } finally {
      unmount(host);
    }
  });
});

// ---------------------------------------------------------------------------
// SideRail (Pages, left) mounts with the same stub doc the DEF-058
// tests use — only the header/body structure is under test here.

function makeStubDoc(): PDFDocumentProxy {
  return {
    numPages: 3,
    async getPage(n: number): Promise<unknown> {
      return {
        pageNumber: n,
        view: [0, 0, 612, 792],
        getViewport: (_args: { scale: number }): { width: number; height: number } => ({
          width: 612,
          height: 792,
        }),
        render: (_args: unknown): { promise: Promise<void> } => ({
          promise: Promise.resolve(),
        }),
      };
    },
    destroy: async (): Promise<void> => undefined,
  } as unknown as PDFDocumentProxy;
}

function mountRail(): HTMLElement {
  const pageCount = 3;
  const engineState: EngineState = {
    pageCount,
    pageOrder: Array.from({ length: pageCount }, (_, i) => i),
    rotations: new Array(pageCount).fill(0) as EngineState["rotations"],
    deleted: Array.from({ length: pageCount }, () => false),
    modified: false,
    annotations: [],
  };
  return mount(
    <SideRail
      doc={makeStubDoc()}
      pageCount={pageCount}
      outline={null}
      currentPage={1}
      defaultWidthPt={612}
      defaultHeightPt={792}
      engineState={engineState}
      canUndo={false}
      onJump={(): void => undefined}
    />,
  );
}

describe("GlassSidebar — the Pages rail (left) uses it", () => {
  it("the rail header is the shared GlassSidebar header with the view tabs as its actions", () => {
    const host = mountRail();
    try {
      const header = host.querySelector<HTMLElement>(".glass-sidebar-header");
      expect(header).not.toBeNull();
      expect(header?.classList.contains("rail-header")).toBe(true);
      // The title is the active rail view ("Pages" on the thumbs tab).
      expect(header?.querySelector(".glass-sidebar-title")?.textContent).toBe("Pages");
      // The view toggle lives INSIDE .glass-sidebar-actions.
      const tabs = header?.querySelector(".rail-tabs");
      expect(tabs).not.toBeNull();
      expect(header?.querySelector(".glass-sidebar-actions")?.contains(tabs ?? null)).toBe(true);
      expect(tabs?.querySelectorAll("button.rail-tab").length).toBe(2);
    } finally {
      unmount(host);
    }
  });

  it("the rail body is the shared GlassSidebar body (legacy .rail-content kept)", () => {
    const host = mountRail();
    try {
      const body = host.querySelector<HTMLElement>(".glass-sidebar-body");
      expect(body).not.toBeNull();
      expect(body?.classList.contains("rail-content")).toBe(true);
      expect(body?.querySelector(".thumb-scroller")).not.toBeNull();
    } finally {
      unmount(host);
    }
  });
});

describe("GlassSidebar — the Tools palette (right) uses the same header", () => {
  const noop = (): void => undefined;

  function mountPalette(): HTMLElement {
    return mount(
      <ToolsPalette
        layout="list"
        onLayoutChange={noop}
        onMerge={noop}
        onSplit={noop}
        onExtract={noop}
        onRotate={noop}
        onDelete={noop}
        onSign={noop}
        onForms={noop}
        onOptimize={noop}
        onAudit={noop}
        onClose={noop}
        hasOcrSuspects={false}
        documentRequired={false}
        hasFormFields={false}
      />,
    );
  }

  it("renders the SAME GlassSidebar header as the Pages rail", () => {
    const host = mountPalette();
    try {
      const header = host.querySelector<HTMLElement>(".glass-sidebar-header");
      expect(header).not.toBeNull();
      expect(header?.classList.contains("tools-palette-header")).toBe(true);
      expect(header?.querySelector(".glass-sidebar-title")?.textContent).toBe("Tools");
      // Layout toggle + close live in the shared actions cluster.
      const actions = header?.querySelector(".glass-sidebar-actions");
      expect(actions?.querySelector(".tools-palette-toggle")).not.toBeNull();
      expect(actions?.querySelector(".tools-palette-close")).not.toBeNull();
    } finally {
      unmount(host);
    }
  });

  it("the palette body is the shared body region", () => {
    const host = mountPalette();
    try {
      const body = host.querySelector<HTMLElement>(".glass-sidebar-body");
      expect(body).not.toBeNull();
      expect(body?.classList.contains("tools-palette-body")).toBe(true);
      expect(body?.querySelector(".tools-palette-entry")).not.toBeNull();
    } finally {
      unmount(host);
    }
  });
});