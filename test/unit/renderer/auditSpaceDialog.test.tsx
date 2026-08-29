// @vitest-environment jsdom
// React 19 needs this flag set before importing react-dom/client so
// that `act` recognises the test env and stops spamming stderr.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { AuditSpaceDialog } from "../../../src/renderer/components/AuditSpaceDialog";
import type { SpaceAudit } from "../../../src/shared/types";

/**
 * Phase 8 — Audit Space dialog rendering tests. These pin the dialog's
 * contract: it auto-fetches the audit on open, renders per-category
 * bars with percentages that sum to ~100, and offers a Refresh button
 * to re-run the audit.
 */

interface RenderArgs {
  runAuditSpace?: () => Promise<SpaceAudit | { error: string }>;
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
  const audit: SpaceAudit = {
    totalBytes: 10_000,
    breakdown: {
      images: 4500,
      fonts: 1200,
      contentStreams: 3000,
      metadata: 500,
      other: 800,
    },
  };
  const run = args.runAuditSpace ?? (async (): Promise<SpaceAudit> => audit);
  act((): void => {
    root.render(
      <AuditSpaceDialog
        open={true}
        runAuditSpace={run}
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

describe("AuditSpaceDialog — per-category breakdown (Phase 8)", () => {
  it("renders five category rows", async () => {
    const { container, cleanup } = renderDialog();
    await act(async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const rows = container.querySelectorAll<HTMLElement>("[data-audit-category]");
    expect(rows.length).toBe(5);
    cleanup();
  });

  it("renders the total bytes once the audit completes", async () => {
    const { container, cleanup } = renderDialog();
    await act(async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const total = container.querySelector("[data-audit-total]");
    expect(total?.textContent).toContain("KB");
    cleanup();
  });

  it("renders percentages that sum to roughly 100", async () => {
    const { container, cleanup } = renderDialog();
    await act(async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
    });
    const pcts = Array.from(
      container.querySelectorAll<HTMLElement>("[data-audit-percent]"),
    ).map((el) => {
      const text = (el.textContent ?? "").replace("%", "").trim();
      return Number.parseFloat(text);
    });
    const sum = pcts.reduce((acc, n) => acc + n, 0);
    // Allow ±0.5 percentage points of rounding slack.
    expect(Math.abs(sum - 100)).toBeLessThanOrEqual(0.5);
    cleanup();
  });

  it("renders an error message when audit fails", async () => {
    const run = async (): Promise<{ error: string }> => ({ error: "engine-error" });
    const { container, cleanup } = renderDialog({ runAuditSpace: run });
    await act(async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Audit failed");
    cleanup();
  });

  it("refresh button re-runs the audit", async () => {
    const run = vi.fn(
      async (): Promise<SpaceAudit> => ({
        totalBytes: 1000,
        breakdown: {
          images: 500,
          fonts: 100,
          contentStreams: 200,
          metadata: 100,
          other: 100,
        },
      }),
    );
    const { container, cleanup } = renderDialog({ runAuditSpace: run });
    await act(async (): Promise<void> => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(run).toHaveBeenCalledTimes(1);
    const refresh = container.querySelector<HTMLButtonElement>(
      "[data-audit-refresh]",
    );
    expect(refresh).not.toBeNull();
    if (refresh === null) return cleanup();
    await act(async (): Promise<void> => {
      refresh.click();
      await Promise.resolve();
    });
    expect(run).toHaveBeenCalledTimes(2);
    cleanup();
  });

  it("onClose fires when the close button is clicked", () => {
    const onClose = vi.fn();
    const { container, cleanup } = renderDialog({ onClose });
    const close = container.querySelector<HTMLButtonElement>(".modal-close");
    expect(close).not.toBeNull();
    if (close === null) return cleanup();
    act((): void => {
      close.click();
    });
    expect(onClose).toHaveBeenCalled();
    cleanup();
  });
});
