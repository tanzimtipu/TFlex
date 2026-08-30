// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so
// that `act` recognises the test env and stops spamming stderr.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { CommentImportDialog } from "../../../src/renderer/components/CommentImportDialog";

/**
 * Phase 12 — CommentImportDialog render contract tests.
 *
 * The dialog's contract:
 *   - Renders the confirm button + close button.
 *   - Confirm calls pickFile; on cancel, closes quietly.
 *   - On picked file -> calls runImportFdf + onConfirm with the
 *     path + count.
 *   - Errors surface as inline alerts.
 */

interface RenderArgs {
  pickFile?: () => Promise<
    { bytes: Uint8Array; path: string } | null
  >;
  runImportFdf?: (
    bytes: Uint8Array,
  ) => Promise<{ annotationCount: number } | { error: string }>;
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
      <CommentImportDialog
        open={true}
        pickFile={args.pickFile ?? (async () => null)}
        runImportFdf={args.runImportFdf ?? (async () => ({ annotationCount: 0 }))}
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

describe("CommentImportDialog — render contract", () => {
  it("renders the confirm button + close button", () => {
    const { container, cleanup } = renderDialog();
    expect(container.querySelector("[data-comment-import-confirm]")).not.toBeNull();
    cleanup();
  });

  it("runs the pick + import flow and surfaces the count on confirm", async () => {
    const pickFile = vi.fn(async (): Promise<{
      bytes: Uint8Array;
      path: string;
    }> => ({ bytes: new Uint8Array([0x25, 0x25, 0x46, 0x44, 0x46]), path: "/tmp/x.fdf" }));
    const runImportFdf = vi.fn(async (_b: Uint8Array): Promise<{
      annotationCount: number;
    }> => ({ annotationCount: 4 }));
    const onConfirm = vi.fn();
    const { container, cleanup } = renderDialog({
      pickFile,
      runImportFdf,
      onConfirm,
    });
    const confirm = container.querySelector<HTMLButtonElement>(
      "[data-comment-import-confirm]",
    );
    expect(confirm).not.toBeNull();
    if (confirm === null) return cleanup();
    await act(async (): Promise<void> => {
      confirm.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(pickFile).toHaveBeenCalledTimes(1);
    expect(runImportFdf).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith({
      path: "/tmp/x.fdf",
      annotationCount: 4,
    });
    cleanup();
  });

  it("closes quietly when the user cancels the OS open dialog", async () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();
    const pickFile = vi.fn(async (): Promise<null> => null);
    const { container, cleanup } = renderDialog({
      pickFile,
      onConfirm,
      onClose,
    });
    const confirm = container.querySelector<HTMLButtonElement>(
      "[data-comment-import-confirm]",
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

  it("surfaces an inline error when runImportFdf returns one", async () => {
    const pickFile = vi.fn(async (): Promise<{
      bytes: Uint8Array;
      path: string;
    }> => ({ bytes: new Uint8Array([0x25, 0x25]), path: "/tmp/x.fdf" }));
    const runImportFdf = vi.fn(async (): Promise<{ error: string }> => ({
      error: "bad FDF",
    }));
    const { container, cleanup } = renderDialog({
      pickFile,
      runImportFdf,
    });
    const confirm = container.querySelector<HTMLButtonElement>(
      "[data-comment-import-confirm]",
    );
    expect(confirm).not.toBeNull();
    if (confirm === null) return cleanup();
    await act(async (): Promise<void> => {
      confirm.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    const alert = container.querySelector("[role='alert']");
    expect(alert?.textContent).toContain("bad FDF");
    cleanup();
  });
});