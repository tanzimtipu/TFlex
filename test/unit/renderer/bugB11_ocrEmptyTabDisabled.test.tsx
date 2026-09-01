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

  it("App passes documentRequired=false for an empty tab (the undefined !== null trap)", () => {
    // Read the App source for the exact wiring: the previous shape
    // `activeTab !== null` was TRUE for an empty tab (openTabs has
    // no entry, so activeTab is undefined). The fix gates on the
    // tab not being empty.
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    const appPath = path.join(__dirname, "..", "..", "..", "src", "renderer", "App.tsx");
    const source = fs.readFileSync(appPath, "utf8");
    expect(source).toMatch(/documentRequired=\{\s*tabs\.activeId\s*!==\s*null\s*&&\s*!activeIsEmpty\s*\}/);
    // The broken shape must be gone.
    expect(source).not.toMatch(/documentRequired=\{activeTab !== null\}/);
  });
});