// Phase 40 item 4 — Merge PDF from scratch (no document open).
//
// Pure routing/sequencing helper: the Welcome screen and File menu call
// `openMergeFlow`, which asks this module whether the merge starts from
// scratch (no active tab) and, if so, runs the multi-select picker ->
// open first -> merge rest sequence.
//
// These tests pin the two operator-visible behaviours from criterion 5:
//   - NO document open -> the multi-select picker is used and every
//     picked path reaches the merge call.
//   - cancel (empty array) -> NO operation at all.
import { describe, expect, it, vi } from "vitest";
import {
  runMergeFromScratch,
  mergeClickStartsFromScratch,
  type MergeFromScratchDeps,
} from "../../../src/renderer/utils/mergeFromScratch";

interface Harness {
  deps: MergeFromScratchDeps;
  pickPdfPaths: ReturnType<typeof vi.fn>;
  openSinglePdf: ReturnType<typeof vi.fn>;
  openFirstAsCombined: ReturnType<typeof vi.fn>;
  mergeRest: ReturnType<typeof vi.fn>;
  onError: ReturnType<typeof vi.fn>;
  onMerged: ReturnType<typeof vi.fn>;
}

function makeHarness(
  overrides: Partial<MergeFromScratchDeps> = {},
): Harness {
  const pickPdfPaths = vi.fn(overrides.pickPdfPaths ?? (async () => []));
  const openSinglePdf = vi.fn(overrides.openSinglePdf ?? (async () => null));
  const openFirstAsCombined = vi.fn(
    overrides.openFirstAsCombined ??
      (async () => ({ tabId: "tab-1", engineDocId: "doc-1" })),
  );
  const mergeRest = vi.fn(
    overrides.mergeRest ?? (async () => ({ ok: true })),
  );
  const onError = vi.fn(overrides.onError ?? (() => undefined));
  const onMerged = vi.fn(overrides.onMerged ?? (() => undefined));
  const deps: MergeFromScratchDeps = {
    pickPdfPaths,
    openSinglePdf,
    openFirstAsCombined,
    mergeRest,
    onError,
    onMerged,
  };
  return {
    deps,
    pickPdfPaths,
    openSinglePdf,
    openFirstAsCombined,
    mergeRest,
    onError,
    onMerged,
  };
}

describe("Phase 40 item 4 — runMergeFromScratch", () => {
  it("cancelled picker (empty array) performs NO operation", async () => {
    const h = makeHarness({ pickPdfPaths: async () => [] });
    await runMergeFromScratch(h.deps);
    expect(h.pickPdfPaths).toHaveBeenCalledWith();
    expect(h.openSinglePdf).not.toHaveBeenCalled();
    expect(h.openFirstAsCombined).not.toHaveBeenCalled();
    expect(h.mergeRest).not.toHaveBeenCalled();
    expect(h.onError).not.toHaveBeenCalled();
    expect(h.onMerged).not.toHaveBeenCalled();
  });

  it("no document open -> multi-picker -> first opens in memory -> rest merged by path", async () => {
    const picked = ["C:/a.pdf", "C:/b.pdf", "C:/c.pdf"];
    const h = makeHarness({
      pickPdfPaths: async () => picked,
      openFirstAsCombined: async () => ({ tabId: "tab-9", engineDocId: "doc-9" }),
      mergeRest: async () => ({ ok: true }),
    });
    await runMergeFromScratch(h.deps);

    expect(h.pickPdfPaths).toHaveBeenCalledTimes(1);
    // The first picked file opens as the combined document...
    expect(h.openFirstAsCombined).toHaveBeenCalledWith("C:/a.pdf", 3);
    // ...and the REST reach the merge call with the engine doc id.
    expect(h.mergeRest).toHaveBeenCalledTimes(1);
    expect(h.mergeRest).toHaveBeenCalledWith("tab-9", "doc-9", [
      "C:/b.pdf",
      "C:/c.pdf",
    ]);
    expect(h.onMerged).toHaveBeenCalledWith("tab-9", 3);
    expect(h.onError).not.toHaveBeenCalled();
    // The single-file open path is not used for a multi-pick.
    expect(h.openSinglePdf).not.toHaveBeenCalled();
  });

  it("a single picked file is a plain open (no merge)", async () => {
    const h = makeHarness({
      pickPdfPaths: async () => ["C:/only.pdf"],
    });
    await runMergeFromScratch(h.deps);
    expect(h.openSinglePdf).toHaveBeenCalledWith("C:/only.pdf");
    expect(h.openFirstAsCombined).not.toHaveBeenCalled();
    expect(h.mergeRest).not.toHaveBeenCalled();
    expect(h.onMerged).not.toHaveBeenCalled();
  });

  it("reports an error (no onMerged) when the merge fails", async () => {
    const h = makeHarness({
      pickPdfPaths: async () => ["C:/a.pdf", "C:/b.pdf"],
      mergeRest: async () => ({ ok: false, message: "engine merge failed" }),
    });
    await runMergeFromScratch(h.deps);
    expect(h.onMerged).not.toHaveBeenCalled();
    expect(h.onError).toHaveBeenCalledWith("engine merge failed");
  });

  it("stops without merging when the first file fails to open", async () => {
    const h = makeHarness({
      pickPdfPaths: async () => ["C:/a.pdf", "C:/b.pdf"],
      openFirstAsCombined: async () => null,
    });
    await runMergeFromScratch(h.deps);
    expect(h.mergeRest).not.toHaveBeenCalled();
    expect(h.onMerged).not.toHaveBeenCalled();
  });

  it("surfaces a thrown picker error without opening anything", async () => {
    const h = makeHarness({
      pickPdfPaths: async () => {
        throw new Error("picker exploded");
      },
    });
    await runMergeFromScratch(h.deps);
    expect(h.onError).toHaveBeenCalledWith(
      "Could not open the file picker: picker exploded",
    );
    expect(h.openFirstAsCombined).not.toHaveBeenCalled();
    expect(h.mergeRest).not.toHaveBeenCalled();
  });
});

describe("Phase 40 item 4 — mergeClickStartsFromScratch routing", () => {
  it("starts from scratch when no document is open", () => {
    expect(mergeClickStartsFromScratch(null)).toBe(true);
  });

  it("uses the doc-bound dialog when a document is active", () => {
    expect(mergeClickStartsFromScratch("tab-1")).toBe(false);
  });
});