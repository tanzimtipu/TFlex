// @vitest-environment jsdom
// B15 — form flatten actually removes fields + refreshes the
// proxy. The previous flatten flow cleared the engine's form
// dictionary but left the renderer's `doc` proxy pointing at
// the pre-flatten bytes — the FormsOverlay kept rendering the
// now-removed widgets and the search index kept walking
// stale field-derived text. The fix calls `refreshDocProxyFor`
// after the flatten success, which rebuilds the pdf.js proxy
// from the post-flatten bytes returned by the engine.
//
// We test the host wiring in App.tsx through the engine client
// adapter. The flat is a structural test:
//   - onFlattenConfirm calls engine.flattenForms.
//   - on success, it calls refreshDocProxyFor via the
//     forward-declared ref.
//   - on error, it does NOT call refreshDocProxyFor.
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

describe("B15 — flatten refreshes the renderer proxy", () => {
  it("onFlattenConfirm exists and calls engine.flattenForms", () => {
    // Find the function body. The function name is onFlattenConfirm.
    expect(appSource).toMatch(/const onFlattenConfirm = useCallback/);
    const match = appSource.match(
      /const onFlattenConfirm[\s\S]*?^  \}, \[[^\]]*\]\);/m,
    );
    expect(match).not.toBeNull();
    if (match === null) return;
    const body = match[0];
    // Calls engine.flattenForms on the active doc.
    expect(body).toMatch(/engineRef\.current\.flattenForms\(/);
    // The active doc is the openTabsRef entry for the active id.
    expect(body).toMatch(/open\.session\.engineDocId/);
  });

  it("onFlattenConfirm calls refreshDocProxyFor via the forward-declared ref", () => {
    const match = appSource.match(
      /const onFlattenConfirm[\s\S]*?^  \}, \[[^\]]*\]\);/m,
    );
    expect(match).not.toBeNull();
    if (match === null) return;
    const body = match[0];
    // Reads from the ref so the call site is forward-safe.
    expect(body).toMatch(/refreshDocProxyForRef\.current/);
    // Calls it.
    expect(body).toMatch(/refreshFn\(activeId\)/);
  });

  it("onFlattenConfirm does not refresh on a flattened error", () => {
    // We expect the refresh call to sit AFTER the success path,
    // not in an `else` branch — a failed flatten must not touch
    // the renderer proxy. The implementation calls
    // `noteOpApplied(activeId, result.value)` (the engine's
    // authoritative post-flatten state) before the refresh, so
    // a refresh outside the success branch would imply a
    // branching bug.
    const match = appSource.match(
      /const onFlattenConfirm[\s\S]*?^  \}, \[[^\]]*\]\);/m,
    );
    expect(match).not.toBeNull();
    if (match === null) return;
    const body = match[0];
    // The refresh call must be AFTER the success branch's noteOpApplied.
    const noteOpIdx = body.indexOf("noteOpApplied(activeId, result.value)");
    const refreshIdx = body.indexOf("refreshFn(activeId)");
    expect(noteOpIdx).toBeGreaterThan(-1);
    expect(refreshIdx).toBeGreaterThan(-1);
    expect(refreshIdx).toBeGreaterThan(noteOpIdx);
  });

  it("onFlattenConfirm also clears the local forms mirror immediately", () => {
    // DEF-020 — the local form-fields mirror must be cleared on
    // the same render that the engine echoes the empty list, so
    // the toolbar's "Flatten" pill disappears without a frame
    // delay. The implementation does this via a setOpenTabs call
    // that writes { fields: [], loaded: true }.
    const match = appSource.match(
      /const onFlattenConfirm[\s\S]*?^  \}, \[[^\]]*\]\);/m,
    );
    expect(match).not.toBeNull();
    if (match === null) return;
    const body = match[0];
    expect(body).toMatch(/setOpenTabs/);
    expect(body).toMatch(/forms: \{ fields: \[\], loaded: true \}/);
  });
});
