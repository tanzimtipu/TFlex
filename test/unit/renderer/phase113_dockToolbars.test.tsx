// @vitest-environment jsdom
// Phase 113 (Quiet Actions) — migration wave D: the dock, the view strip and
// the contextual toolbars.
//
// Pins the wave-D call sites onto the Phase 113 axes (`intent` / `kind` /
// `density`) via the chunk-B `Button` / `IconButton` primitive and the canonical
// class contract in docs/BUTTON-SYSTEM.md. Every assertion reads the shipped
// classes/ARIA the primitive emits; no behaviour (label, handler, data-* hook,
// disabled predicate, shortcut) is re-derived here.
//
// DELIBERATE EXCEPTION — the annotation colour swatch
// (`AnnotationToolbar.tsx`, `.ann-color-swatch-main`) carries a live colour fill
// the generic primitive cannot express, so it keeps its native markup and is
// asserted here as the documented surface exception.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { ReactElement } from "react";
import { ViewStrip, type ViewStripProps } from "../../../src/renderer/components/ViewStrip";
import { CommandBar } from "../../../src/renderer/components/CommandBar";
import {
  ActionDock,
  type ActionDockProps,
  type DockBulkActions,
} from "../../../src/renderer/components/ActionDock";
import { AnnotationToolbar } from "../../../src/renderer/annotations/AnnotationToolbar";
import type { ZoomMode } from "../../../src/renderer/state/zoom";

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
  // The annotation menu portals to document.body; clear any leftovers.
  document.body.innerHTML = "";
});

function bulk(): DockBulkActions {
  return { onRotate: NOOP, onExtract: NOOP, onDelete: NOOP };
}

function renderViewStrip(options: Partial<ViewStripProps> = {}): HTMLElement {
  return mount(
    <ViewStrip
      page={3}
      pageCount={10}
      zoomPercent={171}
      zoomMode="manual"
      pageLayout="one"
      onJump={NOOP}
      onZoomIn={NOOP}
      onZoomOut={NOOP}
      onFitWidth={NOOP}
      onFitPage={NOOP}
      onChangePageLayout={NOOP}
      {...options}
    />,
  );
}

function renderCommandBar(overrides: Record<string, unknown> = {}): HTMLElement {
  return mount(
    <CommandBar
      page={1}
      pageCount={34}
      zoomPercent={372}
      zoomMode={"fit-width" as ZoomMode}
      onJump={NOOP}
      onZoomIn={NOOP}
      onZoomOut={NOOP}
      onFitWidth={NOOP}
      onFitPage={NOOP}
      searchOpen={false}
      onToggleSearch={NOOP}
      onMerge={NOOP}
      onSplit={NOOP}
      signToolActive={false}
      onSignClick={NOOP}
      hasFormFields={false}
      onFlattenClick={NOOP}
      onOptimize={NOOP}
      onAuditSpace={NOOP}
      onRotateClockwise={NOOP}
      onRotateCounterClockwise={NOOP}
      onDeletePage={NOOP}
      canDeletePage
      {...overrides}
    />,
  );
}

describe("Phase 113 — ViewStrip call sites", () => {
  it("renders page nav as canonical compact toolbar actions, disabled at the ends", () => {
    const start = renderViewStrip({ page: 1, pageCount: 10 });
    const prev = start.querySelector('[aria-label="Previous page"]');
    expect(cls(prev)).toContain("btn");
    expect(cls(prev)).toContain("btn-toolbar");
    expect(cls(prev)).toContain("btn-compact");
    expect((prev as HTMLButtonElement).disabled).toBe(true);
    expect(
      (start.querySelector('[aria-label="Next page"]') as HTMLButtonElement).disabled,
    ).toBe(false);

    const end = renderViewStrip({ page: 10, pageCount: 10 });
    expect(
      (end.querySelector('[aria-label="Next page"]') as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("renders Fit width / Fit page as toolbar toggles whose aria-pressed reads zoomMode", () => {
    const host = renderViewStrip({ zoomMode: "fit-width" });
    const fitWidth = host.querySelector('[aria-label="Fit width"]');
    const fitPage = host.querySelector('[aria-label="Fit page"]');
    expect(cls(fitWidth)).toContain("btn-toggle");
    expect(fitWidth?.getAttribute("aria-pressed")).toBe("true");
    expect(cls(fitPage)).toContain("btn-toggle");
    expect(fitPage?.getAttribute("aria-pressed")).toBe("false");
  });

  it("renders each page-layout option as a canonical segmented item with aria-pressed", () => {
    const host = renderViewStrip({ pageLayout: "two" });
    const options = [...host.querySelectorAll("[data-page-layout-option]")];
    expect(options).toHaveLength(3);
    for (const option of options) {
      expect(cls(option)).toContain("btn-segmented-item");
      const active = option.getAttribute("data-page-layout-option") === "two";
      expect(option.getAttribute("aria-pressed")).toBe(active ? "true" : "false");
    }
  });

  it("renders More as a toolbar disclosure carrying aria-expanded", () => {
    const host = renderViewStrip();
    const more = host.querySelector("[data-view-strip-more-toggle]");
    expect(cls(more)).toContain("btn-disclosure");
    expect(more?.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("Phase 113 — CommandBar call sites", () => {
  it("renders rotate / optimize / audit as canonical toolbar actions", () => {
    const host = renderCommandBar();
    for (const sel of [
      "[data-toolbar-rotate-ccw]",
      "[data-toolbar-rotate-cw]",
      "[data-toolbar-optimize]",
      "[data-toolbar-audit]",
    ]) {
      const el = host.querySelector(sel);
      expect(cls(el), sel).toContain("btn");
      expect(cls(el), sel).toContain("btn-toolbar");
    }
  });

  it("renders multi / edit / hand as toolbar toggles with aria-pressed", () => {
    const host = renderCommandBar({
      multiModeEnabled: true,
      onMultiModeToggle: NOOP,
      editModeOpen: true,
      onEditModeToggle: NOOP,
      handActive: true,
      onHandToggle: NOOP,
    });
    for (const sel of [
      "[data-toolbar-multi-mode]",
      "[data-toolbar-edit-toggle]",
      "[data-hand-toggle]",
    ]) {
      const el = host.querySelector(sel);
      expect(cls(el), sel).toContain("btn-toggle");
      expect(el?.getAttribute("aria-pressed"), sel).toBe("true");
    }
  });

  it("renders Delete pages as a destructive control disabled by canDeletePage", () => {
    const open = renderCommandBar({ canDeletePage: false });
    const del = open.querySelector("[data-toolbar-delete-pages]");
    expect(cls(del)).toContain("btn-danger");
    expect((del as HTMLButtonElement).disabled).toBe(true);
    const allowed = renderCommandBar({ canDeletePage: true });
    expect(
      (allowed.querySelector("[data-toolbar-delete-pages]") as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});

function renderDock(options: Partial<ActionDockProps> = {}): HTMLElement {
  return mount(
    <ActionDock
      activeStage="pages"
      pageSelection={[]}
      onClearPageSelection={NOOP}
      bulk={bulk()}
      dockPins={[]}
      onPinTool={NOOP}
      onUnpinTool={NOOP}
      onRunTool={NOOP}
      canvasWidth={1400}
      {...options}
    />,
  );
}

describe("Phase 113 — ActionDock call sites", () => {
  it("renders the lead primary verb as a prominent primary toggle tile", () => {
    const host = renderDock({ activeStage: "pages" });
    const first = host.querySelector('[data-dock-group="primary"] [data-dock-verb]');
    expect(first).not.toBeNull();
    expect(cls(first)).toContain("btn-primary");
    expect(cls(first)).toContain("btn-prominent");
    expect(cls(first)).toContain("btn-toggle");
  });

  it("renders the delete verb as a destructive tile and Clear as tertiary", () => {
    const host = renderDock({ pageSelection: [2, 4] });
    const del = host.querySelector('[data-dock-verb="delete"]');
    const clear = host.querySelector('[data-dock-verb="clearPageSelection"]');
    expect(cls(del)).toContain("btn-danger");
    expect(cls(clear)).toContain("btn-ghost");
  });

  it("renders the More utility as a disclosure and Tools disabled without a handler", () => {
    const host = renderDock();
    expect(cls(host.querySelector("[data-dock-overflow]"))).toContain("btn-disclosure");
    expect((host.querySelector("[data-dock-tools]") as HTMLButtonElement).disabled).toBe(true);
    const enabled = renderDock({ onOpenTools: NOOP });
    expect(
      (enabled.querySelector("[data-dock-tools]") as HTMLButtonElement).disabled,
    ).toBe(false);
  });
});

function renderAnnotationToolbar(): HTMLElement {
  return mount(
    <AnnotationToolbar
      state={{ tool: "ink", color: "yellow", penWidth: 3 }}
      onAction={NOOP}
      annotationRecentTools={[]}
      onAnnotationRecentToolsChange={NOOP}
      editModeOpen={false}
    />,
  );
}

describe("Phase 113 — AnnotationToolbar call sites", () => {
  it("renders a visible MRU tool as a toolbar toggle and the dropdown as a disclosure", () => {
    const host = renderAnnotationToolbar();
    const tool = host.querySelector("[data-ann-tools-visible] [data-tool]");
    expect(tool).not.toBeNull();
    expect(cls(tool)).toContain("btn");
    expect(cls(tool)).toContain("btn-toolbar");
    expect(cls(tool)).toContain("btn-toggle");
    expect(cls(tool)).toContain("tool-btn");
    expect(cls(tool)).toContain("ann-tool-btn");
    const toggle = host.querySelector("[data-ann-dropdown-toggle]");
    expect(cls(toggle)).toContain("btn-disclosure");
    expect(toggle?.getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps the colour swatch as the documented native surface exception", () => {
    const host = renderAnnotationToolbar();
    const swatch = host.querySelector("[data-ann-color]");
    expect(swatch).not.toBeNull();
    expect(cls(swatch)).toContain("ann-color-swatch-main");
    expect(cls(swatch)).not.toContain("btn");
  });
});