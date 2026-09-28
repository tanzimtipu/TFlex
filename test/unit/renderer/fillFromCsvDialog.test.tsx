// @vitest-environment jsdom
//
// Phase 53 (feature G mode 2) — FillFromCsvDialog render contract.
//
// The dialog's contract:
//   - "Choose CSV file…" pops the OS picker and shows the chosen path.
//   - Confirm is disabled until a file is chosen.
//   - Confirm calls the host's runCsvFill with the CHOSEN path and, on
//     success, renders the filled count + all three field lists + every
//     warning, and reports `onApplied` exactly once.
//   - A failure renders the message inline (role=alert) and reports no
//     `onApplied` (no document state change).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  FillFromCsvDialog,
  type FillFromCsvApplied,
} from "../../../src/renderer/components/FillFromCsvDialog";
import type { CsvFieldMappingResult } from "../../../src/shared/convert";

interface RenderArgs {
  pickCsvFile?: () => Promise<string | null>;
  runCsvFill?: (
    path: string,
  ) => Promise<{ result: CsvFieldMappingResult } | { error: string }>;
  onApplied?: (applied: FillFromCsvApplied) => void;
  onClose?: () => void;
}

function renderDialog(args: RenderArgs = {}): {
  container: HTMLElement;
  cleanup: () => void;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root: Root = createRoot(container);
  act((): void => {
    root.render(
      <FillFromCsvDialog
        open={true}
        pickCsvFile={args.pickCsvFile ?? (async () => null)}
        runCsvFill={args.runCsvFill ?? (async () => ({ error: "unused" }))}
        onApplied={args.onApplied ?? ((): void => undefined)}
        onClose={args.onClose ?? ((): void => undefined)}
      />,
    );
  });
  return {
    container,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      container.remove();
    },
  };
}

async function chooseFile(container: HTMLElement): Promise<void> {
  const pick = container.querySelector<HTMLButtonElement>("[data-fill-csv-pick]");
  expect(pick).not.toBeNull();
  await act(async (): Promise<void> => {
    pick?.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function confirm(container: HTMLElement): Promise<void> {
  const btn = container.querySelector<HTMLButtonElement>("[data-fill-csv-confirm]");
  expect(btn).not.toBeNull();
  await act(async (): Promise<void> => {
    btn?.click();
    await Promise.resolve();
    await Promise.resolve();
  });
}

const RESULT: CsvFieldMappingResult = {
  matched: ["Name", "Email"],
  unmatchedHeaders: ["AGE"],
  missingFields: ["Phone"],
  filled: 2,
  warnings: [
    { code: "row-limit", message: "Only the first 1000 rows were read." },
    { code: "generic-fallback", message: "A column had no header.", detail: "col 4" },
  ],
};

describe("FillFromCsvDialog — render contract", () => {
  it("shows the chosen file name and enables confirm only after a pick", async () => {
    const pickCsvFile = vi.fn(async (): Promise<string> => "C:/data/people.csv");
    const { container, cleanup } = renderDialog({ pickCsvFile });

    const confirmBefore = container.querySelector<HTMLButtonElement>("[data-fill-csv-confirm]");
    expect(confirmBefore?.disabled).toBe(true);
    expect(container.querySelector("[data-fill-csv-file]")).toBeNull();

    await chooseFile(container);
    expect(pickCsvFile).toHaveBeenCalledTimes(1);
    expect(container.querySelector("[data-fill-csv-file]")?.textContent).toBe("C:/data/people.csv");
    expect(container.querySelector<HTMLButtonElement>("[data-fill-csv-confirm]")?.disabled).toBe(false);
    cleanup();
  });

  it("calls runCsvFill with the chosen path and renders the count + all three lists + warnings", async () => {
    const pickCsvFile = vi.fn(async (): Promise<string> => "C:/data/people.csv");
    const runCsvFill = vi.fn(async (path: string) => {
      void path;
      return { result: RESULT };
    });
    const onApplied = vi.fn();
    const { container, cleanup } = renderDialog({ pickCsvFile, runCsvFill, onApplied });

    await chooseFile(container);
    await confirm(container);

    expect(runCsvFill).toHaveBeenCalledTimes(1);
    expect(runCsvFill).toHaveBeenCalledWith("C:/data/people.csv");
    expect(container.querySelector("[data-fill-csv-filled]")?.textContent).toContain("2");
    expect(container.querySelectorAll("[data-testid='fill-csv-matched-item']")).toHaveLength(2);
    expect(container.querySelectorAll("[data-testid='fill-csv-unmatched-item']")).toHaveLength(1);
    expect(container.querySelector("[data-testid='fill-csv-unmatched-item']")?.textContent).toBe("AGE");
    expect(container.querySelectorAll("[data-testid='fill-csv-missing-item']")).toHaveLength(1);
    expect(container.querySelector("[data-testid='fill-csv-missing-item']")?.textContent).toBe("Phone");
    expect(container.querySelectorAll("[data-testid='fill-csv-warning']")).toHaveLength(2);
    expect(container.textContent).toContain("Only the first 1000 rows were read.");
    expect(container.textContent).toContain("col 4");
    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(onApplied).toHaveBeenCalledWith({ path: "C:/data/people.csv", filled: 2 });
    cleanup();
  });

  it("renders an empty list as 'None' rather than omitting it", async () => {
    const runCsvFill = vi.fn(async () => ({
      result: {
        matched: ["Name"],
        unmatchedHeaders: [],
        missingFields: [],
        filled: 1,
        warnings: [],
      } satisfies CsvFieldMappingResult,
    }));
    const { container, cleanup } = renderDialog({
      pickCsvFile: async (): Promise<string> => "C:/data/a.csv",
      runCsvFill,
    });
    await chooseFile(container);
    await confirm(container);
    expect(container.querySelector("[data-testid='fill-csv-unmatched-empty']")?.textContent).toBe("None");
    expect(container.querySelector("[data-testid='fill-csv-missing-empty']")?.textContent).toBe("None");
    cleanup();
  });

  it("shows a failure inline as an alert and reports no applied result", async () => {
    const pickCsvFile = vi.fn(async (): Promise<string> => "C:/data/bad.csv");
    const runCsvFill = vi.fn(async (): Promise<{ error: string }> => ({
      error: "The file could not be read.",
    }));
    const onApplied = vi.fn();
    const { container, cleanup } = renderDialog({ pickCsvFile, runCsvFill, onApplied });

    await chooseFile(container);
    await confirm(container);

    const alert = container.querySelector("[data-fill-csv-error][role='alert']");
    expect(alert?.textContent).toContain("The file could not be read.");
    expect(container.querySelector("[data-fill-csv-result]")).toBeNull();
    expect(onApplied).not.toHaveBeenCalled();
    cleanup();
  });

  it("cancelling the OS picker chooses nothing and leaves confirm disabled", async () => {
    const pickCsvFile = vi.fn(async (): Promise<null> => null);
    const { container, cleanup } = renderDialog({ pickCsvFile });
    await chooseFile(container);
    expect(container.querySelector("[data-fill-csv-file]")).toBeNull();
    expect(container.querySelector<HTMLButtonElement>("[data-fill-csv-confirm]")?.disabled).toBe(true);
    cleanup();
  });
});
