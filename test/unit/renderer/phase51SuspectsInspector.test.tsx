// @vitest-environment jsdom
//
// Phase 51 (item 10 / feature G) — the OCR suspects view moved into the
// Inspector. The Inspector renders it as a section (word rows + the close
// control); the ContextPanel no longer hosts the view (only its Recognition
// summary + the "Review suspects" opener remain). App no longer mounts the
// top bar.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import type { ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Inspector } from "../../../src/renderer/components/Inspector";
import { ContextPanel } from "../../../src/renderer/components/ContextPanel";
import type { ContextPanelProps } from "../../../src/renderer/components/ContextPanel";
import type { EngineState } from "../../../src/renderer/engine/types";
import type { OcrSuspect } from "../../../src/shared/types";

const suspect: OcrSuspect = {
  word: "mispelled",
  page: 2,
  confidence: 41,
  rect: { x: 0, y: 0, width: 50, height: 12 },
};

function mount(node: ReactElement): { host: HTMLElement; unmount: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root: Root = createRoot(host);
  act((): void => {
    root.render(node);
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

function makeDocStub(numPages: number): PDFDocumentProxy {
  return {
    numPages,
    async getPage(n: number): Promise<unknown> {
      return {
        pageNumber: n,
        getViewport: () => ({ width: 612, height: 792 }),
        render: () => ({ promise: Promise.resolve(), cancel: (): void => undefined }),
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
    rotations: new Array(pageCount).fill(0) as EngineState["rotations"],
    deleted: new Array(pageCount).fill(false),
    modified: false,
    annotations: [],
  };
}

describe("Phase 51 item 10 — suspects view lives in the Inspector", () => {
  it("renders the section with the word rows and fires onNavigate", () => {
    const onNavigate = vi.fn();
    const onClose = vi.fn();
    const { host, unmount } = mount(
      <Inspector
        stage="edit"
        selection={{ kind: "none" }}
        ocrSuspects={{ suspects: [suspect], hasRun: true, onNavigate, onClose }}
      />,
    );
    try {
      expect(host.querySelector('[data-inspector-section="ocr-suspects"]')).not.toBeNull();
      const btn = host.querySelector<HTMLButtonElement>('[data-ocr-suspect-word="mispelled"]');
      expect(btn).not.toBeNull();
      act((): void => {
        btn?.click();
      });
      expect(onNavigate).toHaveBeenCalledWith(suspect);
      act((): void => {
        host.querySelector<HTMLButtonElement>(".ocr-suspects-close")?.click();
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
    }
  });

  it("renders no suspects section when the host has it closed", () => {
    const { host, unmount } = mount(
      <Inspector stage="edit" selection={{ kind: "none" }} ocrSuspects={null} />,
    );
    try {
      expect(host.querySelector('[data-inspector-section="ocr-suspects"]')).toBeNull();
      expect(host.querySelector("[data-ocr-suspect-word]")).toBeNull();
    } finally {
      unmount();
    }
  });

  it("the ContextPanel hosts no suspects view", () => {
    const overrides: Partial<ContextPanelProps> = {
      ocrStatus: "Recognized",
      ocrHasRun: true,
      ocrSuspectCount: 1,
    };
    const { host, unmount } = mount(
      <ContextPanel
        stage="edit"
        doc={makeDocStub(2)}
        currentPage={1}
        defaultWidthPt={612}
        defaultHeightPt={792}
        pageSizes={null}
        engineState={makeEngineState(2)}
        proxyVisibleOrder={false}
        canUndo={false}
        onUndo={(): void => undefined}
        onJump={(): void => undefined}
        outline={null}
        onRecognizeText={(): void => undefined}
        onOpenOcrSuspects={(): void => undefined}
        {...overrides}
      />,
    );
    try {
      expect(host.querySelector("[data-ocr-suspects-panel]")).toBeNull();
      expect(host.querySelector("[data-ocr-suspect-word]")).toBeNull();
      // The opener stays reachable.
      expect(host.querySelector('[data-context-panel-action="suspects"]')).not.toBeNull();
    } finally {
      unmount();
    }
  });

  it("App mounts the Inspector copy and no longer mounts the top bar", () => {
    const app = readFileSync(
      resolve(__dirname, "../../../src/renderer/App.tsx"),
      "utf8",
    );
    expect(app).toContain("ocrSuspects={");
    expect(app).not.toMatch(/<OcrSuspectsPanel\b/);
    expect(app).toMatch(/ocrSuspectsOpen\s*&&\s*activeTab\s*!=\s*null/);
  });
});
