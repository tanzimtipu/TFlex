// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so
// that `act` recognises the test env and stops spamming stderr.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AuditSpaceDialog } from "../../../src/renderer/components/AuditSpaceDialog";
import { OptimizeDialog } from "../../../src/renderer/components/OptimizeDialog";
import { OcrDialog } from "../../../src/renderer/components/OcrDialog";

/**
 * DEF-071 — dialog-based tools must mount and respond to the
 * generic `.dialog` selector.
 *
 * The defect: opening Audit Space / Reduce file size / Recognize
 * Text (OCR) caused Playwright's `waitForSelector('.sheet, .dialog')`
 * to time out, which Playwright reported as "Application exited".
 * Root cause: the dialogs rendered with `className="modal-dialog
 * audit-dialog"` etc. — a hyphenated single class name. CSS /
 * Playwright's `.dialog` selector matches elements with the EXACT
 * class "dialog", not any element whose class string contains
 * "dialog". The dialogs were never visible to the selector.
 *
 * The fix adds the bare `dialog` class to every modal dialog so
 * the generic `.dialog` selector (and any future selector-based
 * tool) finds them. The tests below pin the contract on the three
 * dialogs the defect report calls out.
 */

interface RenderHandle {
  root: Root;
  container: HTMLElement;
  cleanup: () => void;
}

function renderInto(node: React.ReactElement): RenderHandle {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(node);
  });
  return {
    root,
    container,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe("AuditSpaceDialog — DEF-071 class shell", () => {
  it("mounts with the `dialog` class when open so the .dialog selector finds it", () => {
    const { container, cleanup } = renderInto(
      <AuditSpaceDialog
        open={true}
        runAuditSpace={async () => ({ error: "engine-error" })}
        onClose={(): void => undefined}
      />,
    );
    const matched = container.querySelectorAll(".dialog");
    expect(matched.length).toBeGreaterThanOrEqual(1);
    // The Audit-specific class is still present for styling.
    expect(container.querySelector(".audit-dialog")).not.toBeNull();
    cleanup();
  });
});

describe("OptimizeDialog — DEF-071 class shell", () => {
  it("mounts with the `dialog` class when open", () => {
    const { container, cleanup } = renderInto(
      <OptimizeDialog
        open={true}
        initialPreset="compact"
        originalBytes={1000}
        runOptimize={async () => ({ error: "engine-error" })}
        onConfirm={(): void => undefined}
        onClose={(): void => undefined}
      />,
    );
    expect(container.querySelectorAll(".dialog").length).toBeGreaterThanOrEqual(1);
    expect(container.querySelector(".optimize-dialog")).not.toBeNull();
    cleanup();
  });
});

describe("OcrDialog — DEF-071 class shell", () => {
  it("mounts with the `dialog` class when open", () => {
    const { container, cleanup } = renderInto(
      <OcrDialog
        open={true}
        totalPages={3}
        currentPage={1}
        formFields={[]}
        initialLanguage="eng"
        initialDownsample={300}
        resolveActiveDoc={(): null => null}
        subscribeOcrProgress={(): (() => void) => (): void => undefined}
        runOcr={async () => ({ ok: true, suspects: [] })}
        onConfirm={(): void => undefined}
        onClose={(): void => undefined}
      />,
    );
    expect(container.querySelectorAll(".dialog").length).toBeGreaterThanOrEqual(1);
    expect(container.querySelector(".ocr-dialog")).not.toBeNull();
    cleanup();
  });
});