// Phase 32 (chunk 2b) — the shared rail's wiring, source-scanned.
//
// The App composition itself is too large to mount in a unit test, so the
// wiring is asserted the same way the existing Phase-32 routing test does
// it: read the real sources and check the seams exist, in order, and that
// the rail reuses the existing Thumb rules instead of forking them.

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..", "..", "..");
function read(relative: string): string {
  return fs.readFileSync(path.join(ROOT, "src", "renderer", relative), "utf8");
}

describe("App wires the shared rail", () => {
  const app = read("App.tsx");

  it("builds one section per filled pane, pane A first", () => {
    expect(app).toMatch(/const panes: PaneId\[\] = \["A", "B"\];/);
    expect(app).toMatch(/const tabId = paneTabId\(multiMode, pane\);/);
    expect(app).toMatch(/railSections\.length > 0 \? \(/);
    expect(app).toMatch(/<MultiRail/);
  });

  it("threads the rail and its navigation seams into the stage and the panes", () => {
    expect(app).toMatch(/sharedRail=\{sharedRail\}/);
    expect(app).toMatch(/jumpRequest=\{railJump !== null && railJump\.tabId === meta\.id \? railJump : null\}/);
    expect(app).toMatch(/onPageSizesChange=\{\(sizes\): void => reportPageSizes\(meta\.id, sizes\)\}/);
    // Single mode still suppresses nothing: the per-pane rail returns.
    expect(app).toMatch(/showRail=\{!multiMode\.enabled\}/);
  });

  it("renders each section with the existing ThumbnailRail at the computed width", () => {
    expect(app).toMatch(/import \{ ThumbnailRail \} from "\.\/components\/SideRail";/);
    expect(app).toMatch(/thumbWidth=\{thumbWidth\}/);
    expect(app).toMatch(/onJump=\{onJump\}/);
  });
});

describe("DocumentStage reserves the rail's column", () => {
  const stage = read("components/MultiPane.tsx");

  it("renders the shared rail only in Multi Mode and marks the stage", () => {
    expect(stage).toMatch(/const railOn = multiOn && sharedRail !== null;/);
    expect(stage).toMatch(/\{railOn \? sharedRail : null\}/);
    expect(stage).toMatch(/data-shared-rail=\{railOn \? "true" : undefined\}/);
  });

  it("keeps the divider 1:1 by measuring the split across the pane region", () => {
    expect(stage).toMatch(/"--tf-split-frac": String\(splitFraction\)/);
    expect(stage).toMatch(/const usable = rect\.width - railWidth;/);
    expect(stage).toMatch(/\(clientX - rect\.left - railWidth\) \/ usable/);
  });
});

describe("DocumentView owns the external jump and the page-size report", () => {
  const view = read("components/DocumentView.tsx");

  it("lands a jump only on a NEW request (seq-guarded, never replayed)", () => {
    expect(view).toMatch(/if \(request\.seq === lastJumpSeqRef\.current\) return;/);
    expect(view).toMatch(/jumpToPage\(request\.page, true\);/);
  });

  it("reports per-page sizes once per new map", () => {
    expect(view).toMatch(/if \(reportedPageSizesRef\.current === pageSizes\) return;/);
    expect(view).toMatch(/onPageSizesChange\?\.\(pageSizes\);/);
  });
});

describe("the rail reuses the existing Thumb rules, changing only the width", () => {
  const rail = read("components/SideRail.tsx");

  it("threads the width through the Thumb, the wrap math and the slot math", () => {
    expect(rail).toMatch(/thumbWidth\?: number;/);
    expect(rail).toMatch(/const width = thumbWidth;/);
    expect(rail).toMatch(/thumbWrapHeightFor\(pageSize, aspectRatio, thumbWidth\)/);
    expect(rail).toMatch(/thumbSlotTops\(pageCount, sizeForPage, fallbackAspect, thumbWidth\)/);
  });

  it("keeps the DEF-274 offscreen swap and the DEF-222 unmount-only cleanup", () => {
    // Offscreen scratch render + atomic blit.
    expect(rail).toMatch(/const scratch = document\.createElement\('canvas'\);/);
    expect(rail).toMatch(/ctx\.drawImage\(scratch, 0, 0\);/);
    // Release the bitmap only on a true unmount.
    expect(rail).toMatch(/if \(!mountedRef\.current\) \{/);
    // The width still participates in the render effect's deps.
    expect(rail).toMatch(/\}, \[shouldRender, doc, page, width\]\);/);
  });
});
