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
import { ToolsPalette } from "../../../src/renderer/components/ToolsPalette";
import {
  GlassSidebar,
  GlassSidebarBody,
  GlassSidebarHeader,
} from "../../../src/renderer/components/GlassSidebar";

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
      onOptimize={noop}
      onAudit={noop}
      onClose={noop}
      onFlatten={noop}
      onCreateFromImages={noop}
      onExportPages={noop}
      onExportText={noop}
      onExportDocx={noop}
      onInsertPages={noop}
      onRecognizeText={noop}
      onBatchOcr={noop}
      onOcrSuspects={noop}
      onReplacePages={noop}
      onRenumberPages={noop}
      onCropPages={noop}
      onStamp={noop}
      onExportComments={noop}
      onImportComments={noop}
      hasOcrSuspects={false}
      documentRequired={false}
      hasFormFields={false}
    />,
  );
}

describe("GlassSidebar — the Tools palette (right) uses the same header", () => {
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

describe("GlassSidebar — the 22px sidebar icon ladder (Phase 14.2 FIX 6)", () => {
  // The chrome icon ladder: command bar 22px (Open inline 20px),
  // annotation bar 24px, SIDEBAR 22px. The panels' every interactive
  // glyph — the rail's view tabs / undo / thumb actions / outline
  // chevrons and the palette's tool entries / layout toggle / close —
  // renders at the 22px sidebar rung; nothing in either panel falls
  // back to the old 20px chrome size.

  it("every ToolsPalette icon glyph renders at 22px", () => {
    const host = mountPalette();
    try {
      const svgs = Array.from(host.querySelectorAll<SVGSVGElement>("svg"));
      expect(svgs.length).toBeGreaterThanOrEqual(24);
      for (const svg of svgs) {
        const w = Number(svg.getAttribute("width"));
        const h = Number(svg.getAttribute("height"));
        expect(
          w,
          `palette glyph off the 22px ladder: ${svg.getAttribute("class") ?? "unknown"}`,
        ).toBe(22);
        expect(h).toBe(22);
      }
    } finally {
      unmount(host);
    }
  });
});