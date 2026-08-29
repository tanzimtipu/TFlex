// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so
// that `act` recognises the test env and stops spamming stderr.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TextExportDialog } from "../../../src/renderer/components/TextExportDialog";

/**
 * Phase 9 — TextExportDialog render contract tests.
 *
 * The dialog's contract:
 *   - Renders page range + format radios + confirm.
 *   - Esc + backdrop + close button fire onClose (when not running).
 *   - Confirm is disabled while running.
 *
 * The actual export pipeline (runExport + blob download) is covered
 * by the e2e harness; jsdom can't render text into a Blob with the
 * same code path the production renderer uses.
 */

interface RenderArgs {
  totalPages?: number;
  runExport?: () => Promise<
    { pageIndex: number; text: string }[] | { error: string }
  >;
  onConfirm?: (c: {
    range: number[];
    format: "txt" | "rtf";
    text: string;
  }) => void;
  onClose?: () => void;
  sourceName?: string;
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
      <TextExportDialog
        open={true}
        totalPages={args.totalPages ?? 5}
        runExport={args.runExport ?? (async (): Promise<{ pageIndex: number; text: string }[]> => [])}
        onConfirm={args.onConfirm ?? ((): void => undefined)}
        sourceName={args.sourceName ?? "report.pdf"}
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

describe("TextExportDialog — render contract", () => {
  it("renders page range, format radios, and confirm", () => {
    const { container, cleanup } = renderDialog();
    expect(container.querySelector("[data-text-export-range]")).not.toBeNull();
    expect(
      container.querySelectorAll<HTMLInputElement>('input[name="text-export-format"]'),
    ).toHaveLength(2);
    expect(container.querySelector("[data-text-export-confirm]")).not.toBeNull();
    cleanup();
  });

  it("seeds range from totalPages on open", () => {
    const { container, cleanup } = renderDialog({ totalPages: 12 });
    const range = container.querySelector<HTMLInputElement>(
      "[data-text-export-range]",
    );
    expect(range?.value).toBe("1-12");
    cleanup();
  });

  it("renders nothing when open=false", () => {
    const { container, cleanup } = ((): {
      container: HTMLElement;
      cleanup: () => void;
    } => {
      const c = document.createElement("div");
      document.body.appendChild(c);
      const r = createRoot(c);
      act((): void => {
        r.render(
          <TextExportDialog
            open={false}
            totalPages={5}
            runExport={async (): Promise<{ pageIndex: number; text: string }[]> => []}
            onConfirm={(): void => undefined}
            sourceName="report.pdf"
            onClose={(): void => undefined}
          />,
        );
      });
      return {
        container: c,
        cleanup: (): void => {
          act((): void => {
            r.unmount();
          });
          c.remove();
        },
      };
    })();
    expect(container.querySelector("[data-text-export-dialog]")).toBeNull();
    cleanup();
  });
});

describe("TextExportDialog — close paths", () => {
  it("fires onClose when the backdrop is clicked", () => {
    const onClose = vi.fn();
    const { container, cleanup } = renderDialog({ onClose });
    const backdrop = container.querySelector<HTMLElement>(".modal-backdrop");
    expect(backdrop).not.toBeNull();
    if (backdrop === null) return cleanup();
    act((): void => {
      backdrop.click();
    });
    expect(onClose).toHaveBeenCalled();
    cleanup();
  });

  it("fires onClose when the close button is clicked", () => {
    const onClose = vi.fn();
    const { container, cleanup } = renderDialog({ onClose });
    const close = container.querySelector<HTMLButtonElement>(
      "button[aria-label='Close dialog']",
    );
    expect(close).not.toBeNull();
    if (close === null) return cleanup();
    act((): void => {
      close.click();
    });
    expect(onClose).toHaveBeenCalled();
    cleanup();
  });
});
