// @vitest-environment jsdom
//
// DEF-284 — the All Tools badge rendered TWICE in Multi Mode.
//
// Root cause: the badge lives in `DocumentView`, so Multi Mode mounted one per
// pane; the two identical badges stacked at the window's right edge and the
// covered one intercepted clicks meant for the pane below it. The fix renders
// the badge ONCE at the workspace level (`DocumentStage`'s `toolsBadge`) while
// Multi Mode is on, and suppresses every per-view copy via the `multiModeEnabled`
// flag that reaches each mounted view (panes AND any extra unpaned tab).
//
// These tests mount the REAL DocumentStage with REAL DocumentViews (the
// DEF-094 harness's doc/engine stub) and count the badge across the whole
// workspace, so a regression to a per-pane render fails the count.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { act, type ReactElement } from "react";
import { createRoot } from "react-dom/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { DocumentStage, type StageTab } from "../../../src/renderer/components/MultiPane";
import {
  DocumentView,
  type DocDiagnostics,
  type PersistedViewer,
} from "../../../src/renderer/components/DocumentView";
import { ToolsBadge } from "../../../src/renderer/components/ToolsBadge";
import type { MultiModeState } from "../../../src/renderer/state/multiMode";
import type { EngineState } from "../../../src/renderer/engine/types";

if (typeof globalThis.IntersectionObserver === "undefined") {
  class NoopIntersectionObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  (globalThis as { IntersectionObserver: typeof IntersectionObserver }).IntersectionObserver =
    NoopIntersectionObserver as unknown as typeof IntersectionObserver;
}
if (typeof globalThis.ResizeObserver === "undefined") {
  class NoopResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    NoopResizeObserver as unknown as typeof ResizeObserver;
}

const NOOP = (): void => undefined;

function makeDocStub(numPages: number): PDFDocumentProxy {
  return {
    numPages,
    async getPage(): Promise<unknown> {
      return {
        view: [0, 0, 612, 792],
        getViewport: (_args: { scale: number }): { width: number; height: number } => ({
          width: 612,
          height: 792,
        }),
        render: (_args: unknown): { promise: Promise<void> } => ({
          promise: Promise.resolve(),
        }),
        cleanup: async (): Promise<void> => undefined,
      };
    },
    destroy: async (): Promise<void> => undefined,
  } as unknown as PDFDocumentProxy;
}

function makeEngineState(pageCount: number): EngineState {
  return {
    pageCount,
    pageOrder: Array.from({ length: pageCount }, (_, i) => i),
    rotations: Array.from({ length: pageCount }, () => 0),
    deleted: Array.from({ length: pageCount }, () => false),
    modified: false,
    annotations: [],
  };
}

const INITIAL_VIEWER: PersistedViewer = {
  zoomMode: "fit-width",
  manualScale: 1,
  currentPage: 1,
  searchOpen: false,
  query: "",
  activeHitIndex: -1,
};

function paneDocument(
  multiOn: boolean,
  onToggle: () => void,
): ReactElement {
  return (
    <DocumentView
      doc={makeDocStub(3)}
      pageCount={3}
      outline={null}
      initial={INITIAL_VIEWER}
      onPersist={NOOP}
      onDiagnostics={(_d: DocDiagnostics): void => undefined}
      engineState={makeEngineState(3)}
      modified={false}
      canUndo={false}
      saveInPlaceEnabled={false}
      annotations={[]}
      formFields={[]}
      signatures={[]}
      savedSignatures={[]}
      stampAnnotations={[]}
      toolsPaletteOpen={false}
      onToolsPaletteToggle={onToggle}
      multiModeEnabled={multiOn}
    />
  );
}

const TABS: StageTab[] = [
  { id: "a", title: "Alpha.pdf", pageCount: 3 },
  { id: "b", title: "Beta.pdf", pageCount: 3 },
  { id: "c", title: "Gamma.pdf", pageCount: 3 },
];

const MULTI_AB: MultiModeState = { enabled: true, paneA: "a", paneB: "b", focused: "A" };
const MULTI_WITH_EXTRA: MultiModeState = { enabled: true, paneA: "a", paneB: "b", focused: "A" };
const SINGLE: MultiModeState = { enabled: false, paneA: null, paneB: null, focused: "A" };

async function renderWorkspace(
  multi: MultiModeState,
  tabs: readonly StageTab[],
  onToggle: () => void,
): Promise<{ host: HTMLElement; unmount: () => void }> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async (): Promise<void> => {
    root.render(
      <DocumentStage
        tabs={tabs}
        activeId="a"
        showWelcome={false}
        welcomeKey="welcome"
        welcome={null}
        multiMode={multi}
        splitFraction={0.5}
        onSplitChange={NOOP}
        onFocusPane={NOOP}
        onClearPane={NOOP}
        onPickPane={NOOP}
        onOpenIntoPane={NOOP}
        renderDocument={(tabId: string, pane): ReactElement => (
          <div data-doc={tabId} data-doc-pane={pane ?? "single"}>
            {paneDocument(multi.enabled, onToggle)}
          </div>
        )}
        toolsBadge={
          multi.enabled ? <ToolsBadge open={false} onToggle={onToggle} /> : null
        }
      />,
    );
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
  return {
    host,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

describe("DEF-284 — exactly ONE All Tools badge in Multi Mode", () => {
  it("Multi Mode with both panes filled renders one workspace badge", async () => {
    const { host, unmount } = await renderWorkspace(MULTI_AB, TABS.slice(0, 2), NOOP);
    try {
      // Two panes mounted (the per-pane DocumentViews)...
      expect(host.querySelectorAll(".tab-pane[data-pane]").length).toBe(2);
      // ...but only ONE badge for the whole workspace (criterion 4b).
      expect(host.querySelectorAll("[data-tools-badge]").length).toBe(1);
      // The single badge is a workspace child, not inside a pane.
      const badge = host.querySelector("[data-tools-badge]");
      expect(badge?.closest(".tab-pane")).toBeNull();
    } finally {
      unmount();
    }
  });

  it("Multi Mode with a third unpaned tab still renders exactly one badge", async () => {
    const { host, unmount } = await renderWorkspace(MULTI_WITH_EXTRA, TABS, NOOP);
    try {
      // All three tabs mount a DocumentView (the extra one is hidden), so a
      // naive per-view rule would have produced THREE badges.
      expect(host.querySelectorAll("[data-doc]").length).toBe(3);
      expect(host.querySelectorAll("[data-tools-badge]").length).toBe(1);
    } finally {
      unmount();
    }
  });

  it("single mode keeps the badge on the document view (unchanged)", async () => {
    const { host, unmount } = await renderWorkspace(SINGLE, TABS.slice(0, 1), NOOP);
    try {
      expect(host.querySelectorAll("[data-tools-badge]").length).toBe(1);
      // In single mode the badge is still the view-owned one (no stage badge).
      const badge = host.querySelector("[data-tools-badge]");
      expect(badge?.closest("[data-doc]")).not.toBeNull();
    } finally {
      unmount();
    }
  });

  it("the single Multi Mode badge still toggles the palette", async () => {
    const onToggle = vi.fn();
    const { host, unmount } = await renderWorkspace(MULTI_AB, TABS.slice(0, 2), onToggle);
    try {
      const badge = host.querySelector<HTMLElement>("[data-tools-badge]");
      expect(badge).not.toBeNull();
      expect(badge?.getAttribute("aria-label")).toBe("Open tools palette");
      act((): void => {
        badge?.click();
      });
      expect(onToggle).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
    }
  });
});

// ---------------------------------------------------------------------------
// Static guard: the per-view copy must be gated on the Multi Mode flag. If the
// gate is removed (the DER-284 regression), a view remounts one badge per pane
// again even though the count tests above would still need the stage badge.

describe("DEF-284 — DocumentView gates its badge on multiModeEnabled", () => {
  const src = readFileSync(
    resolve(__dirname, "../../../src/renderer/components/DocumentView.tsx"),
    "utf8",
  );

  it("the badge is rendered only while Multi Mode is off", () => {
    // Find the badge render site (the ToolsBadge usage).
    const idx = src.indexOf("<ToolsBadge");
    expect(idx).toBeGreaterThan(-1);
    // The gate immediately before it must require multiModeEnabled !== true.
    const preceding = src.slice(Math.max(0, idx - 500), idx);
    expect(preceding).toMatch(/multiModeEnabled\s*!==\s*true/);
    expect(preceding).toMatch(/onToolsPaletteToggle\s*!==\s*undefined/);
  });
});