// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so
// that `act` recognises the test env and stops spamming stderr.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CommentExportDialog } from "../../../src/renderer/components/CommentExportDialog";

/**
 * Phase 12 — CommentExportDialog render contract tests.
 *
 * The dialog's contract:
 *   - Renders the annotation-count hint and confirm button.
 *   - Confirm calls runExportFdf, then saveFile.
 *   - Cancel calls onClose without touching the engine.
 *   - On saved path -> onConfirm is fired with the path + count.
 *   - On cancelled saveFile -> onClose is fired (no onConfirm).
 *   - Errors from runExportFdf surface as inline alerts.
 */

interface RenderArgs {
  annotationCount?: number;
  runExportFdf?: () => Promise<
    { bytes: ArrayBuffer; annotationCount: number } | { error: string }
  >;
  saveFile?: (bytes: ArrayBuffer, suggested: string) => Promise<string | null>;
  sourceName?: string;
  onConfirm?: (r: { path: string; annotationCount: number }) => void;
  onClose?: () => void;
}

function renderDialog(args: RenderArgs = {}): {
  root: Root;
  container: HTMLElement;
  cleanup: () => void;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(
      <CommentExportDialog
        open={true}
        annotationCount={args.annotationCount ?? 3}
        runExportFdf={args.runExportFdf ?? (async () => ({
          bytes: new ArrayBuffer(0),
          annotationCount: 3,
        }))}
        saveFile={args.saveFile ?? (async () => "/tmp/default.fdf")}
        sourceName={args.sourceName ?? "report.pdf"}
        onConfirm={args.onConfirm ?? ((): void => undefined)}
        onClose={args.onClose ?? ((): void => undefined)}
      />,
    );
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

describe("CommentExportDialog — render contract", () => {
  it("renders the confirm button + close button", () => {
    const { container, cleanup } = renderDialog();
    expect(container.querySelector("[data-comment-export-confirm]")).not.toBeNull();
    cleanup();
  });

  it("runs the export + save flow and surfaces the path on confirm", async () => {
    const runExportFdf = vi.fn(async (): Promise<{
      bytes: ArrayBuffer;
      annotationCount: number;
    }> => ({
      bytes: new Uint8Array([0x25, 0x25, 0x46, 0x44, 0x46]).buffer,
      annotationCount: 7,
    }));
    const saveFile = vi.fn(async (_b: ArrayBuffer, _s: string): Promise<string> =>
      "/tmp/x.fdf",
    );
    const onConfirm = vi.fn();
    const { container, cleanup } = renderDialog({
      runExportFdf,
      saveFile,
      onConfirm,
    });
    const confirm = container.querySelector<HTMLButtonElement>(
      "[data-comment-export-confirm]",
    );
    expect(confirm).not.toBeNull();
    if (confirm === null) return cleanup();
    await act(async (): Promise<void> => {
      confirm.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(runExportFdf).toHaveBeenCalledTimes(1);
    expect(saveFile).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({
      path: "/tmp/x.fdf",
      annotationCount: 7,
    });
    cleanup();
  });

  it("closes quietly when the user cancels the OS save dialog", async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    const saveFile = vi.fn(async (): Promise<null> => null);
    const { container, cleanup } = renderDialog({
      saveFile,
      onConfirm,
      onClose,
    });
    const confirm = container.querySelector<HTMLButtonElement>(
      "[data-comment-export-confirm]",
    );
    expect(confirm).not.toBeNull();
    if (confirm === null) return cleanup();
    await act(async (): Promise<void> => {
      confirm.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    cleanup();
  });

  it("surfaces an inline error when runExportFdf returns one", async () => {
    const runExportFdf = vi.fn(async (): Promise<{ error: string }> => ({
      error: "engine unavailable",
    }));
    const { container, cleanup } = renderDialog({ runExportFdf });
    const confirm = container.querySelector<HTMLButtonElement>(
      "[data-comment-export-confirm]",
    );
    expect(confirm).not.toBeNull();
    if (confirm === null) return cleanup();
    await act(async (): Promise<void> => {
      confirm.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const alert = container.querySelector("[role='alert']");
    expect(alert?.textContent).toContain("engine unavailable");
    cleanup();
  });
});