// @vitest-environment jsdom
//
// DEF-139 — inserting a blank page (or deleting/reordering) scrambled the
// live render: `EngineState.pageOrder` held pdf-lib ORIGINAL page indices,
// but the renderer used them verbatim as 1-based file-page indices into
// its pdf.js proxy. That only matches the ORIGINAL open bytes (identity
// file order); once `refreshDocProxyFor` rebuilds the proxy from
// `getDocumentBytes` bytes — which `serializeDoc` writes in the engine's
// VISIBLE order — `pageOrder[k]+1` points at the WRONG page (slot 2 showed
// the last page instead of the new blank). The fix carries a
// `proxyVisibleOrder` flag on the tab session and maps visible slot -> proxy
// page via `visibleToSourcePageForProxy`: identity on a rebuilt proxy,
// pageOrder translation on the original bytes.
//
// These tests pin the WIRING by scanning the component sources (same
// pattern as defDEF133_visibleVsSourcePage.test.ts / DEF-121 guard test).
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const src = (rel: string): string =>
  fs.readFileSync(
    path.join(__dirname, "..", "..", "..", "src", "renderer", rel),
    "utf8",
  );

describe("DEF-139 — DocumentView maps the slot via the proxy-family helper", () => {
  const docView = src("components/DocumentView.tsx");

  it("imports visibleToSourcePageForProxy and uses it for sourcePage", () => {
    expect(docView).toMatch(/visibleToSourcePageForProxy/);
    expect(docView).toMatch(/const sourcePage = visibleToSourcePageForProxy\(/);
  });

  it("declares + destructures the proxyVisibleOrder prop with a false default", () => {
    expect(docView).toMatch(/proxyVisibleOrder\?: boolean;/);
    expect(docView).toMatch(/proxyVisibleOrder = false,/);
  });

  it("threads proxyVisibleOrder into the SideRail", () => {
    expect(docView).toMatch(/proxyVisibleOrder=\{proxyVisibleOrder\}/);
  });
});

describe("DEF-139 — the live rail follows the same proxy-family rule", () => {
  const sideRail = src("components/SideRail.tsx");

  it("ThumbnailRail picks the identity page for a visible-order proxy", () => {
    expect(sideRail).toMatch(
      /const sourcePage = proxyVisibleOrder \? page : \(visibleToSource\.get\(page\) \?\? page\);/,
    );
  });

  it("threads proxyVisibleOrder into the live shared rail", () => {
    const contextPanel = src("components/ContextPanel.tsx");
    expect(contextPanel).toMatch(/proxyVisibleOrder=\{proxyVisibleOrder\}/);
  });
});

describe("DEF-139 — App owns the proxyVisibleOrder session lifecycle", () => {
  const app = src("App.tsx");

  it("seeds the session flag false on open (original bytes)", () => {
    expect(app).toMatch(/proxyVisibleOrder: false,/);
  });

  it("flips the flag true when refreshDocProxyFor swaps in a getDocumentBytes proxy", () => {
    expect(app).toMatch(/proxyVisibleOrder: true,/);
  });

  it("passes the flag into DocumentView", () => {
    expect(app).toMatch(/proxyVisibleOrder=\{open\.session\.proxyVisibleOrder\}/);
  });
});
