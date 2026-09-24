// @vitest-environment jsdom
//
// B11 / DEF-102 — the OCR entries in the Tools palette must be
// DISABLED when no document is active (empty tab / welcome screen),
// and enabled when a real document is open.
//
// Root causes traced:
//   1. App passed `documentRequired={activeTab !== null}`. On an
//      empty tab there is NO `openTabs[id]` entry, so `activeTab`
//      is `undefined` — and `undefined !== null` is TRUE, making
//      the palette believe a document was active.
//   2. Inside the palette, `isEntryEnabled` evaluated
//      `ocrSuspects` / `batchOcr` BEFORE the `!documentRequired`
//      branch, so those two entries stayed enabled even when the
//      host passed the flag correctly.
//
// Fix: App now passes `tabs.activeId !== null && !activeIsEmpty`,
// and `isEntryEnabled` checks `!documentRequired` FIRST (only Sign
// stays usable without a document).
//
// Coverage (behavior):
//   1. documentRequired=false: Recognize Text, OCR suspects and
//      Batch OCR entries render with the `disabled` attribute and
//      clicking them does NOT fire their callbacks.
//   2. documentRequired=true with callbacks wired: the same entries
//      are enabled and clicking fires their callbacks.
import { describe, expect, it, vi } from "vitest";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { ToolsPalette } from "../../../src/renderer/components/ToolsPalette";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mountPalette(args: {
  documentRequired: boolean;
  onRecognizeText?: () => void;
  onBatchOcr?: () => void;
  onOcrSuspects?: () => void;
  hasOcrSuspects?: boolean;
}): {
  host: HTMLElement;
  root: ReturnType<typeof createRoot>;
  onRecognizeText: ReturnType<typeof vi.fn>;
  onBatchOcr: ReturnType<typeof vi.fn>;
  onOcrSuspects: ReturnType<typeof vi.fn>;
  cleanup: () => void;
} {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const onRecognizeText = vi.fn(args.onRecognizeText ?? ((): void => undefined));
  const onBatchOcr = vi.fn(args.onBatchOcr ?? ((): void => undefined));
  const onOcrSuspects = vi.fn(args.onOcrSuspects ?? ((): void => undefined));
  act((): void => {
    root.render(
      <ToolsPalette
        layout="list"
        onLayoutChange={(): void => undefined}
        onMerge={(): void => undefined}
        onSplit={(): void => undefined}
        onExtract={(): void => undefined}
        onRotate={(): void => undefined}
        onDelete={(): void => undefined}
        onSign={(): void => undefined}
        onForms={(): void => undefined}
        onOptimize={(): void => undefined}
        onAudit={(): void => undefined}
        onClose={(): void => undefined}
        onRecognizeText={onRecognizeText}
        onBatchOcr={onBatchOcr}
        onOcrSuspects={onOcrSuspects}
        hasOcrSuspects={args.hasOcrSuspects ?? true}
        documentRequired={args.documentRequired}
        hasFormFields={false}
      />,
    );
  });
  return {
    host,
    root,
    onRecognizeText,
    onBatchOcr,
    onOcrSuspects,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

describe("B11 / DEF-102 — OCR entries are disabled on a doc-less tab", () => {
  it("documentRequired=false: Recognize Text / OCR suspects / Batch OCR are disabled and clicks are no-ops", () => {
    const { host, onRecognizeText, onBatchOcr, onOcrSuspects, cleanup } = mountPalette({
      documentRequired: false,
    });
    try {
      const recognize = host.querySelector<HTMLButtonElement>(
        "[data-tool-id='recognizeText']",
      );
      const suspects = host.querySelector<HTMLButtonElement>(
        "[data-tool-id='ocrSuspects']",
      );
      const batch = host.querySelector<HTMLButtonElement>(
        "[data-tool-id='batchOcr']",
      );
      if (recognize === null || suspects === null || batch === null) {
        throw new Error("OCR entries not found");
      }
      // Disabled: HTML `disabled` attribute present.
      expect(recognize.disabled).toBe(true);
      expect(suspects.disabled).toBe(true);
      expect(batch.disabled).toBe(true);
      // Clicks on disabled buttons must not fire the callbacks.
      act((): void => {
        recognize.click();
      });
      act((): void => {
        suspects.click();
      });
      act((): void => {
        batch.click();
      });
      expect(onRecognizeText).not.toHaveBeenCalled();
      expect(onOcrSuspects).not.toHaveBeenCalled();
      expect(onBatchOcr).not.toHaveBeenCalled();
      // Sign stays available without a document.
      const sign = host.querySelector<HTMLButtonElement>("[data-tool-id='sign']");
      if (sign === null) throw new Error("sign entry not found");
      expect(sign.disabled).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("documentRequired=true: the same entries are enabled and clicking fires the callbacks", () => {
    const { host, onRecognizeText, onBatchOcr, onOcrSuspects, cleanup } = mountPalette({
      documentRequired: true,
      hasOcrSuspects: true,
    });
    try {
      const recognize = host.querySelector<HTMLButtonElement>(
        "[data-tool-id='recognizeText']",
      );
      const suspects = host.querySelector<HTMLButtonElement>(
        "[data-tool-id='ocrSuspects']",
      );
      const batch = host.querySelector<HTMLButtonElement>(
        "[data-tool-id='batchOcr']",
      );
      if (recognize === null || suspects === null || batch === null) {
        throw new Error("OCR entries not found");
      }
      expect(recognize.disabled).toBe(false);
      expect(suspects.disabled).toBe(false);
      expect(batch.disabled).toBe(false);
      act((): void => {
        recognize.click();
      });
      act((): void => {
        suspects.click();
      });
      expect(onRecognizeText).toHaveBeenCalledTimes(1);
      expect(onOcrSuspects).toHaveBeenCalledTimes(1);
      act((): void => {
        batch.click();
      });
      expect(onBatchOcr).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });

  it("App no longer passes the retired palette's documentRequired; the suspects entry routes through the gated handler", () => {
    // Phase 36 STAGES retired the Tools palette from App's render tree, so
    // App no longer passes a `documentRequired` prop to anything. The old
    // `activeTab !== null` trap is therefore unreachable by shape. The
    // doc-required gating now happens per-document: the EDIT ContextPanel
    // only renders inside a real tab's DocumentView, and its "Review
    // suspects" action is wired to App's gated `onOpenOcrSuspects` (which
    // requires a non-null active tab id AND an OCR run — pinned by
    // bugB11_ocrSuspectsEmptyTabGuard). The palette's own doc-less gate is
    // still pinned behaviourally by the two mount tests above.
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const appPath = path.join(__dirname, "..", "..", "..", "src", "renderer", "App.tsx");
    const source = fs.readFileSync(appPath, "utf8");
    // The retired palette prop is not wired anywhere in App.
    expect(source).not.toMatch(/documentRequired=/);
    // The EDIT panel's suspects action routes through the gated handler.
    expect(source).toMatch(/onOpenOcrSuspects=\{onOpenOcrSuspects\}/);
    // The broken `activeTab !== null` trap shape must stay gone.
    expect(source).not.toMatch(/documentRequired=\{activeTab !== null\}/);
  });
});