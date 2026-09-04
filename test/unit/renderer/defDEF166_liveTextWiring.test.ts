// @vitest-environment node
// DEF-166 — the renderer must track which annotation ids keep a LIVE
// overlay text (created / edited since the current page-canvas bytes
// were loaded) so the AnnotationOverlay suppresses the duplicated
// overlay text for parsed-from-file annotations on reopen. These
// wiring tests pin the App.tsx provenance tracking:
//   1. onCreateAnnotation marks the new id live.
//   2. onEditAnnotation marks the id live (the canvas still paints
//      the pre-edit baked appearance).
//   3. refreshDocProxyFor clears the tab's live set after swapping in
//      the engine's re-serialized bytes (which contain every current
//      annotation -> all of them are canvas-painted now).
//   4. performCloseTab drops the tab's live set.
//   5. annotationHandlers threads the live set to DocumentView.
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const appPath = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "renderer",
  "App.tsx",
);
const appSource = fs.readFileSync(appPath, "utf8");

function findHandler(name: string): string {
  // Find the useCallback for the named handler and extract its
  // body up to the closing `}, [<deps>]);` line.
  const re = new RegExp(
    `const ${name} = useCallback\\([\\s\\S]*?^  \\}, \\[[^\\]]*\\]\\);`,
    "m",
  );
  const m = appSource.match(re);
  if (m === null) return "";
  return m[0];
}

describe("DEF-166 — live overlay text provenance wiring", () => {
  it("onCreateAnnotation marks the new annotation id live before the engine call", () => {
    const body = findHandler("onCreateAnnotation");
    expect(body).not.toBe("");
    // The live mark sits at the top of the handler (before the IPC).
    const markIdx = body.indexOf("markAnnTextLive(tabId, ann.id)");
    const engineIdx = body.indexOf("createAnnotation(open.session.engineDocId, ann)");
    expect(markIdx).toBeGreaterThan(-1);
    expect(engineIdx).toBeGreaterThan(-1);
    expect(markIdx).toBeLessThan(engineIdx);
  });

  it("onEditAnnotation marks the edited id live before the engine call", () => {
    const body = findHandler("onEditAnnotation");
    expect(body).not.toBe("");
    const markIdx = body.indexOf("markAnnTextLive(tabId, id)");
    // The engine call spans multiple lines (id/patch args); match the
    // method name that follows the mark.
    const engineIdx = body.indexOf("editAnnotation(");
    expect(markIdx).toBeGreaterThan(-1);
    expect(engineIdx).toBeGreaterThan(-1);
    expect(markIdx).toBeLessThan(engineIdx);
  });

  it("refreshDocProxyFor clears the tab's live set after the proxy swap", () => {
    // The re-serialized bytes contain every current annotation, so
    // from the swap onwards ALL of them are canvas-painted and the
    // overlay text must be suppressed for every id.
    const refreshIdx = appSource.indexOf("const refreshDocProxyFor = useCallback");
    const clearIdx = appSource.indexOf("liveAnnTextIdsRef.current.delete(tabId)");
    // It sits inside the refresh callback (which ends with the
    // forward-declared ref assignment a few lines later).
    const refAssign = appSource.indexOf("refreshDocProxyForRef.current = refreshDocProxyFor");
    expect(refreshIdx).toBeGreaterThan(-1);
    expect(clearIdx).toBeGreaterThan(refreshIdx);
    expect(clearIdx).toBeLessThan(refAssign);
  });

  it("performCloseTab drops the tab's live set", () => {
    const body = findHandler("performCloseTab");
    expect(body).not.toBe("");
    expect(body).toMatch(/liveAnnTextIdsRef\.current\.delete\(id\)/);
  });

  it("annotationHandlers threads the live set to DocumentView", () => {
    expect(appSource).toMatch(/liveAnnTextIdsFor\(tabId\)/);
    // The per-tab annotation bundle carries the set and App passes it
    // to DocumentView next to `annotations`.
    expect(appSource).toMatch(/liveAnnTextIds: ReadonlySet<string>/);
    expect(appSource).toMatch(/liveAnnTextIds=\{ann\.liveAnnTextIds\}/);
  });
});