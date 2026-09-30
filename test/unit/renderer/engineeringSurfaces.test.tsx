// @vitest-environment jsdom
//
// Phase 57 (feature A) — the engineering surfaces.
//
// Four halves:
//   1. The two registry entries: REVIEW stage, `document` precondition,
//      distinct action ids and app-wide-unique icons.
//   2. The Engineering layers panel: it lists every layer, a toggle calls
//      `setLayerVisibility` with the exact (index, nextVisible), applies the
//      echoed state, rebuilds the pdf.js proxy; a failed toggle toasts and
//      reverts; a layerless document renders the explicit empty state.
//   3. The Document info dialog: the three CAD lists render from a non-null
//      value, the no-CAD line renders for null.
//   4. The 3D limitation notice: it names every entry's page and object, and
//      is absent for an empty list.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import * as fs from "node:fs";
import * as path from "node:path";
import { EngineeringLayersPanel } from "../../../src/renderer/components/EngineeringLayersPanel";
import { DocumentInfoDialog } from "../../../src/renderer/components/DocumentInfoDialog";
import { Pdf3dNotice } from "../../../src/renderer/components/Pdf3dNotice";
import { TOOL_REGISTRY, toolById } from "../../../src/renderer/state/toolsRegistry";
import type { EngineState } from "../../../src/renderer/engine/types";
import type { PdfCadMetadata, Pdf3dContent, PdfLayer } from "../../../src/shared/types";

function state(): EngineState {
  return {
    pageCount: 3,
    pageOrder: [0, 1, 2],
    rotations: [0, 0, 0],
    deleted: [false, false, false],
    modified: true,
    annotations: [],
  };
}

interface Mounted {
  host: HTMLElement;
  root: ReturnType<typeof createRoot>;
  cleanup: () => void;
}

function mount(node: ReactElement): Mounted {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(node);
  });
  return {
    host,
    root,
    cleanup: (): void => {
      act((): void => root.unmount());
      host.remove();
    },
  };
}

const LAYERS: readonly PdfLayer[] = [
  { index: 0, name: "Walls", visible: true },
  { index: 1, name: "Roof", visible: false },
];

describe("Phase 57 feature A — registry contract", () => {
  it("registers both verbs on REVIEW with the shared document precondition", () => {
    for (const id of ["engineeringLayers", "documentInfo"] as const) {
      const entry = toolById(id);
      expect(entry, id).toBeDefined();
      expect(entry?.availability, id).toBe("document");
      expect(entry?.stage, id).toBe("review");
      expect(entry?.action, id).toBe(id);
    }
  });

  it("gives each verb a distinct, app-wide-unique icon", () => {
    const layersIcon = toolById("engineeringLayers")?.icon;
    const infoIcon = toolById("documentInfo")?.icon;
    expect(layersIcon).toBeDefined();
    expect(infoIcon).toBeDefined();
    expect(layersIcon).not.toBe(infoIcon);
    const icons = TOOL_REGISTRY.map((e) => e.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });
});

describe("Phase 57 feature A — Engineering layers panel", () => {
  it("lists every layer and reflects its visibility", () => {
    const view = mount(
      <EngineeringLayersPanel
        open={true}
        docId="doc1"
        layers={LAYERS}
        setLayerVisibility={vi.fn(async () => ({ ok: true as const, value: state() }))}
        onStateApplied={vi.fn()}
        refreshDocProxyFor={vi.fn(async () => true)}
        pushToast={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    try {
      const rows = view.host.querySelectorAll("[data-testid='layer-row']");
      expect(rows).toHaveLength(2);
      expect(view.host.textContent).toContain("Walls");
      expect(view.host.textContent).toContain("Roof");
      const toggles = view.host.querySelectorAll<HTMLInputElement>("[data-testid='layer-toggle']");
      expect(toggles[0].checked).toBe(true);
      expect(toggles[1].checked).toBe(false);
      expect(view.host.querySelector("[data-testid='layer-count']")?.textContent).toContain("2");
    } finally {
      view.cleanup();
    }
  });

  it("toggling calls setLayerVisibility with the exact (index, nextVisible), applies the state and refreshes the proxy", async () => {
    const next = state();
    const setLayerVisibility = vi.fn(async () => ({ ok: true as const, value: next }));
    const onStateApplied = vi.fn();
    const refreshDocProxyFor = vi.fn(async () => true);
    const pushToast = vi.fn();
    const view = mount(
      <EngineeringLayersPanel
        open={true}
        docId="doc1"
        layers={LAYERS}
        setLayerVisibility={setLayerVisibility}
        onStateApplied={onStateApplied}
        refreshDocProxyFor={refreshDocProxyFor}
        pushToast={pushToast}
        onClose={vi.fn()}
      />,
    );
    try {
      const toggles = view.host.querySelectorAll<HTMLInputElement>("[data-testid='layer-toggle']");
      await act(async (): Promise<void> => {
        toggles[0].click();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(setLayerVisibility).toHaveBeenCalledWith("doc1", 0, false);
      expect(onStateApplied).toHaveBeenCalledWith(next);
      expect(refreshDocProxyFor).toHaveBeenCalledTimes(1);
      expect(pushToast).not.toHaveBeenCalled();
    } finally {
      view.cleanup();
    }
  });

  it("a failed toggle toasts the mapped error and reverts the checkbox", async () => {
    const setLayerVisibility = vi.fn(async () => ({
      ok: false as const,
      error: { code: "engine-error" as const, message: "boom" },
    }));
    const pushToast = vi.fn();
    const refreshDocProxyFor = vi.fn(async () => true);
    const onStateApplied = vi.fn();
    const view = mount(
      <EngineeringLayersPanel
        open={true}
        docId="doc1"
        layers={LAYERS}
        setLayerVisibility={setLayerVisibility}
        onStateApplied={onStateApplied}
        refreshDocProxyFor={refreshDocProxyFor}
        pushToast={pushToast}
        onClose={vi.fn()}
      />,
    );
    try {
      const toggles = view.host.querySelectorAll<HTMLInputElement>("[data-testid='layer-toggle']");
      await act(async (): Promise<void> => {
        toggles[0].click();
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(pushToast).toHaveBeenCalledWith("error", "boom");
      expect(onStateApplied).not.toHaveBeenCalled();
      expect(refreshDocProxyFor).not.toHaveBeenCalled();
      // Reverted to the previous value.
      const after = view.host.querySelectorAll<HTMLInputElement>("[data-testid='layer-toggle']");
      expect(after[0].checked).toBe(true);
    } finally {
      view.cleanup();
    }
  });

  it("renders the explicit empty state for a layerless document", () => {
    const view = mount(
      <EngineeringLayersPanel
        open={true}
        docId="doc1"
        layers={[]}
        setLayerVisibility={vi.fn(async () => ({ ok: true as const, value: state() }))}
        onStateApplied={vi.fn()}
        refreshDocProxyFor={vi.fn(async () => true)}
        pushToast={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    try {
      const empty = view.host.querySelector("[data-testid='layer-empty']");
      expect(empty).not.toBeNull();
      expect(empty?.textContent).toContain("This document declares no layers.");
    } finally {
      view.cleanup();
    }
  });
});

describe("Phase 57 feature A — Document info dialog", () => {
  const CAD: PdfCadMetadata = {
    identification: [{ key: "Part", value: "Pump housing" }],
    measurement: [{ key: "Unit", value: "mm" }],
    geospatial: [{ key: "Projection", value: "EPSG:3857" }],
  };

  it("renders the three CAD lists from a non-null value", () => {
    const view = mount(
      <DocumentInfoDialog
        open={true}
        metadata={CAD}
        layerCount={2}
        content3dCount={1}
        onClose={vi.fn()}
      />,
    );
    try {
      for (const testId of [
        "doc-info-identification",
        "doc-info-measurement",
        "doc-info-geospatial",
      ]) {
        expect(view.host.querySelector(`[data-testid='${testId}']`), testId).not.toBeNull();
      }
      expect(view.host.querySelectorAll("[data-testid='doc-info-pair']")).toHaveLength(3);
      expect(view.host.textContent).toContain("Pump housing");
      expect(view.host.querySelector("[data-testid='doc-info-layer-count']")?.textContent).toContain("2");
      expect(view.host.querySelector("[data-testid='doc-info-3d-count']")?.textContent).toContain("1");
      expect(view.host.querySelector("[data-testid='doc-info-no-cad']")).toBeNull();
    } finally {
      view.cleanup();
    }
  });

  it("renders the explicit no-CAD line for null", () => {
    const view = mount(
      <DocumentInfoDialog
        open={true}
        metadata={null}
        layerCount={0}
        content3dCount={0}
        onClose={vi.fn()}
      />,
    );
    try {
      const line = view.host.querySelector("[data-testid='doc-info-no-cad']");
      expect(line).not.toBeNull();
      expect(line?.textContent).toContain("No PDF/E engineering metadata in this document.");
    } finally {
      view.cleanup();
    }
  });
});

describe("Phase 57 feature A — 3D limitation notice", () => {
  it("names every entry's page and object", () => {
    const entries: readonly Pdf3dContent[] = [
      { page: 2, name: "Turbine" },
      { page: 5, name: "Gearbox" },
    ];
    const view = mount(<Pdf3dNotice entries={entries} />);
    try {
      const notice = view.host.querySelector("[data-testid='pdf3d-notice']");
      expect(notice).not.toBeNull();
      expect(notice?.textContent).toContain('Page 2 contains 3D content ("Turbine")');
      expect(notice?.textContent).toContain('Page 5 contains 3D content ("Gearbox")');
      // Phase 67 (feature C): the bar is still non-dismissible — its only
      // control collapses it into the always-available "i" overlay.
      const buttons = notice?.querySelectorAll("button") ?? [];
      expect(buttons).toHaveLength(1);
      expect(buttons[0]?.hasAttribute("data-pdf3d-collapse")).toBe(true);
    } finally {
      view.cleanup();
    }
  });

  it("renders nothing for an empty list", () => {
    const view = mount(<Pdf3dNotice entries={[]} />);
    try {
      expect(view.host.querySelector("[data-testid='pdf3d-notice']")).toBeNull();
    } finally {
      view.cleanup();
    }
  });
});

// DEF-399 (DEF-106 / DEF-374 class): the engineering verbs, the engineering
// fetch and the form-data verbs must never be detached from their adapter
// receiver. `const f = client.getLayers; f(id)` loses `this`, and the real
// adapter's methods read `this.inner` — an unbound mock passes while the real
// object throws. This source contract reads App.tsx as text and fails on any
// bare `const <id> = <receiver>.<method>;` for the guarded methods.
describe("engineering / form-data surfaces — App binding source contract", () => {
  const appSource = fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "src", "renderer", "App.tsx"),
    "utf8",
  );

  const GUARDED = [
    "getLayers",
    "setLayerVisibility",
    "getCadMetadata",
    "get3dContent",
    "exportFormData",
    "importFormData",
  ] as const;

  // A bare detached binding: `const|let|var <id> = <receiver>.<method>;`.
  // The method name must be followed by `;` (optionally whitespace), so an
  // arrow wrapper (`=> client.getLayers!(id)`) or a receiver call
  // (`client.getLayers(id)`) can never match.
  const DETACHED =
    /\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*[\w.$]+\.(getLayers|setLayerVisibility|getCadMetadata|get3dContent|exportFormData|importFormData)\s*;/g;

  function stripComments(src: string): string {
    return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  }

  it("never binds a guarded adapter method to a bare identifier", () => {
    const code = stripComments(appSource);
    const offenders = [...code.matchAll(DETACHED)].map((m) => m[0].trim());
    expect(offenders).toEqual([]);
  });

  it("calls every guarded method through its receiver instance", () => {
    for (const method of GUARDED) {
      expect(appSource, method).toMatch(new RegExp(`\\.${method}\\(`));
    }
  });

  it("the guard cannot false-positive on an arrow wrapper", () => {
    const arrow = "const layersCall = (id: string) => client.getLayers!(id);";
    expect([...arrow.matchAll(DETACHED)]).toHaveLength(0);
    const bad = "const layersCall = client.getLayers;";
    expect([...bad.matchAll(DETACHED)]).toHaveLength(1);
  });
});
