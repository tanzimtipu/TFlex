// @vitest-environment jsdom
//
// DEF-121 — inserting a blank page mid-document threw pdf.js "Invalid
// page request." twice during the post-insert proxy refresh. The
// engine commits its new pageOrder (page count) BEFORE the renderer's
// pdf.js `doc` proxy is rebuilt, so a mount for a source page the
// still-old proxy does not have rejects with "Invalid page request."
// (34-page doc, new pageOrder references source page 35 while
// doc.numPages is still 34 — the main canvas mount and the rail thumb
// for the slot right after page 1 both fire, hence twice; the append
// path never touches the new page in the visible window, hence no
// error there). The fix makes the render paths tolerate the stale
// index: they drop the attempt via `isInvalidPageRequest` and let the
// doc-identity swap in `refreshDocProxyFor` re-run the render effect
// with the full page count.
//
// DEF-122 — the Insert dialog's position value is the 1-based page
// number the new content BECOMES (rank semantics: 2 = after page 1,
// TotalPages+1 = append, "end" = append). Blank mode's rank slot maps
// to the engine's `afterIndex` — which is one less — inside
// onInsertPagesConfirm; the from-PDF mode consumes the slot directly.
// DEF-129 — slot 0 ("before page 1") is valid in blank mode too: it
// maps to the engine's afterIndex -2 PREPEND sentinel, so the new
// blank page becomes page 1 (pageOrder[0]).
//
// We exercise the shared helper directly and the wiring by scanning
// the renderer sources (same pattern as bugB19_proxyRefreshEveryMutation).
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { isInvalidPageRequest } from "../../../src/renderer/pdf/pdfjs";

const src = (rel: string): string =>
  fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "src", "renderer", rel),
    "utf8",
  );

describe("DEF-121 — isInvalidPageRequest helper", () => {
  it("recognizes pdf.js's out-of-range getPage rejection", () => {
    expect(isInvalidPageRequest(new Error("Invalid page request."))).toBe(true);
    expect(isInvalidPageRequest(new Error("invalid page request"))).toBe(true);
  });

  it("ignores every other failure so real corruption keeps surfacing", () => {
    expect(isInvalidPageRequest(new Error("RenderingCancelledException"))).toBe(false);
    expect(isInvalidPageRequest(new Error("Cannot use the same canvas during multiple render() operations"))).toBe(false);
    expect(isInvalidPageRequest(new Error("PasswordException"))).toBe(false);
    // Non-Error rejections (pdf.js can reject with arbitrary values).
    expect(isInvalidPageRequest(null)).toBe(false);
    expect(isInvalidPageRequest("Invalid page request.")).toBe(false);
    expect(isInvalidPageRequest(new TypeError("wat"))).toBe(false);
  });
});

describe("DEF-121 — render paths tolerate the stale page reference", () => {
  it("PageView.run guards its own getPage call and skips a stale index", () => {
    const source = src("components/PageView.tsx");
    // The main-canvas mount for the new page slot must guard the
    // getPage it awaits and route the stale-index rejection into a
    // clean skip (the doc-identity swap re-runs this effect).
    // DEF-133 — the render reads the SOURCE index, so the guard
    // sits on `doc.getPage(sourcePage)`; visible-page overlays use
    // the separate `page` prop.
    expect(source).toMatch(/pageProxy = await doc\.getPage\(sourcePage\)/);
    const runIdx = source.indexOf("const run = async (): Promise<void> =>");
    const guardIdx = source.indexOf("isInvalidPageRequest(error)");
    expect(runIdx, "PageView.run exists").toBeGreaterThan(-1);
    expect(guardIdx, "guard sits inside the page render effect").toBeGreaterThan(runIdx);
    // The stale attempt must return early without touching the canvas
    // bitmap or text layer (the placeholder stays until the swap).
    const guardBlock = source.slice(guardIdx, guardIdx + 220);
    expect(guardBlock).toMatch(/endRender\(\);/);
  });

  it("SideRail Thumb guards its getPage call and skips a stale index", () => {
    const source = src("components/SideRail.tsx");
    // The rail thumbnail for the new page slot is the second
    // "Invalid page request" source during a mid-document insert.
    expect(source).toMatch(/pdfPage = await doc\.getPage\(page\)/);
    const thumbIdx = source.indexOf("function Thumb(");
    const guardIdx = source.indexOf("isInvalidPageRequest(error)");
    expect(thumbIdx, "Thumb exists").toBeGreaterThan(-1);
    expect(guardIdx, "guard sits inside the Thumb effect").toBeGreaterThan(thumbIdx);
    // Both render paths must import the shared guard.
    expect(source).toMatch(/isInvalidPageRequest,?/);
  });

  it("PageView and SideRail import the shared guard from the pdf helper", () => {
    const pageView = src("components/PageView.tsx");
    const sideRail = src("components/SideRail.tsx");
    expect(pageView).toMatch(/import \{ isInvalidPageRequest \} from '\.\.\/pdf\/pdfjs';/);
    expect(sideRail).toMatch(/isInvalidPageRequest,/);
  });
});

describe("DEF-122 — rank slot to afterIndex translation in App.tsx", () => {
  function findOnInsertPagesConfirm(): string {
    const app = src("App.tsx");
    const re = /const onInsertPagesConfirm = useCallback\([\s\S]*?\n\s*\}, \[[^\]]*\]\);/m;
    const m = app.match(re);
    expect(m, "onInsertPagesConfirm handler exists").not.toBeNull();
    return m === null ? "" : m[0];
  }

  it("blank branch maps the rank slot to the engine's afterIndex (slot 0 -> -2 prepend, else slot - 1)", () => {
    const body = findOnInsertPagesConfirm();
    expect(body).toMatch(
      /const afterIndex =\s+choice\.position === 0\s+\? -2\s+: choice\.position < 0\s+\? -1\s+: choice\.position - 1;/,
    );
    // The translated afterIndex feeds insertBlankPage...
    const blankCall = body.indexOf("engineRef.current.insertBlankPage(");
    const afterIdx = body.indexOf("afterIndex,");
    expect(blankCall, "blank branch calls insertBlankPage").toBeGreaterThan(-1);
    expect(afterIdx, "afterIndex passed to insertBlankPage").toBeGreaterThan(blankCall);
  });

  it("fromPdf branch passes the slot directly (insertFromPdf consumes it)", () => {
    const body = findOnInsertPagesConfirm();
    const fromPdfCall = body.indexOf("engineRef.current.insertFromPdf(");
    const slotIdx = body.indexOf("choice.position,");
    expect(fromPdfCall, "fromPdf branch calls insertFromPdf").toBeGreaterThan(-1);
    expect(slotIdx, "slot passed to insertFromPdf").toBeGreaterThan(fromPdfCall);
  });

  it("does not regress the DEF-114 append sentinel (end/empty -> -1)", () => {
    const body = findOnInsertPagesConfirm();
    // An append sentinel (-1) passes straight through as afterIndex -1
    // while slot 0 routes to the -2 prepend sentinel.
    expect(body).toMatch(/choice\.position < 0[\s\S]*?\? -1[\s\S]*?: choice\.position - 1/);
    expect(body).toMatch(/choice\.position === 0\s*\? -2/);
    const dialog = src("components/InsertPagesDialog.tsx");
    expect(dialog).toMatch(/return \{ position: -1, valid: true \};/);
  });

  it("dialog validation keeps 1 valid in blank mode (DEF-129): slot 0 becomes the -2 prepend, no error-toast guard", () => {
    const dialog = src("components/InsertPagesDialog.tsx");
    // The DEF-114-era special case (blank min is 2 on a non-empty
    // doc) is gone: min is 1 for every mode.
    expect(dialog).toMatch(/const min = 1;/);
    expect(dialog).toMatch(/n < min \|\| n > totalPages \+ 1/);
    // The DEF-129-era error-toast guard is gone: slot 0 is no longer
    // surfaced as an engine gap; it maps to the -2 PREPEND sentinel.
    const app = src("App.tsx");
    const insertConfirmRe = /const onInsertPagesConfirm = useCallback\([\s\S]*?\n\s*\}, \[[^\]]*\]\);/m;
    const m = app.match(insertConfirmRe);
    expect(m, "onInsertPagesConfirm handler exists").not.toBeNull();
    expect(m?.[0] ?? "").toMatch(/choice\.position === 0\s*\? -2/);
    expect(m?.[0] ?? "").not.toMatch(/cannot insert a blank page before page 1/);
  });
});