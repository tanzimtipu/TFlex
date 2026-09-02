// @vitest-environment jsdom
//
// DEF-133 — annotations / forms / signatures / stamps / text boxes
// drawn on a page AFTER an insert / delete / reorder landed on the
// WRONG engine page. DocumentView mapped the visible slot to a SOURCE
// page (`visibleToSourcePage`) and passed that single index into
// PageView as `pageNumber`; PageView handed it to every overlay as
// `page=`. The engine interprets the `page` field of every created
// entity against its CURRENT visible order, so a source index 3/4
// (after a reorder) silently created content on the wrong page.
//
// The fix threads BOTH page spaces into PageView: `page` (the VISIBLE
// index, used by every overlay) and `sourcePage` (the index into the
// pdf.js proxy, used ONLY by `doc.getPage`). We pin the wiring by
// scanning the component sources (same pattern as
// defDEF121_122_insertRefreshGuard.test.ts).
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const src = (rel: string): string =>
  fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "src", "renderer", rel),
    "utf8",
  );

describe("DEF-133 — DocumentView threads visible + source page into PageView", () => {
  it("mounts PageView with BOTH page={visiblePage} and sourcePage={sourcePage}", () => {
    const docView = src("components/DocumentView.tsx");
    expect(docView).toMatch(/<PageView/);
    expect(docView).toMatch(/page=\{visiblePage\}/);
    expect(docView).toMatch(/sourcePage=\{sourcePage\}/);
    // The old single-index leak must be gone.
    expect(docView).not.toMatch(/pageNumber=\{sourcePage\}/);
  });
});

describe("DEF-133 — PageView splits the two page spaces", () => {
  const pageView = src("components/PageView.tsx");

  it("declares both `page` and `sourcePage` props", () => {
    expect(pageView).toMatch(/interface PageViewProps \{/);
    expect(pageView).toMatch(/page: number;/);
    expect(pageView).toMatch(/sourcePage: number;/);
    expect(pageView).not.toMatch(/pageNumber: number/);
  });

  it("uses sourcePage ONLY for the pdf.js render (doc.getPage)", () => {
    expect(pageView).toMatch(/pageProxy = await doc\.getPage\(sourcePage\)/);
    // The text-item / text-layer work is on the same rendered page.
    expect(pageView).toMatch(/const pdfPageHeight = pageProxy\.view/);
  });

  it("uses the VISIBLE `page` for every overlay and the data-page marker", () => {
    expect(pageView).toMatch(/ref=\{\(el\) => \{[^}]*registerPage\?\.\(page, el\)/s);
    expect(pageView).toMatch(/data-page=\{page\}/);
    expect(pageView).toMatch(/<AnnotationOverlay\s+page=\{page\}/);
    expect(pageView).toMatch(/<FormsOverlay\s+page=\{page\}/);
    expect(pageView).toMatch(/<SignaturesOverlay\s+page=\{page\}/);
    expect(pageView).toMatch(/<StampOverlay\s+page=\{page\}/);
    expect(pageView).toMatch(/<EditOverlay\s+page=\{page\}/);
    // onPlaceSignature threads the VISIBLE page so the engine
    // registers the placement on the page the user sees.
    expect(pageView).toMatch(/onPlaceSignature\?\.\(id, page, r\)/);
    // The scroller's active-hit mapping is slot-based (visible).
    expect(pageView).toMatch(/onActiveHitTop\(page, rects\[0\]\.top\)/);
  });

  it("overlays never see the source index", () => {
    expect(pageView).not.toMatch(/page=\{sourcePage\}/);
    expect(pageView).not.toMatch(/\bpageNumber\b/);
  });
});