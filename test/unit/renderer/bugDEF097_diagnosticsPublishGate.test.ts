// @vitest-environment node
//
// DEF-097 — `tflexDiagnostics().activeTool` must stay `null` after
// the active tab is closed, even when the closing tab's DocumentView
// (or a late effect keyed to the closed id) publishes diagnostics
// during the close commit.
//
// Root cause traced: `performCloseTab` resets `activeTool: null` in
// the diagnostics mirror, but the diagnostics publish path
// (`onDiagnosticsFor`) wrote unconditionally — a publish from the
// closing tab (document-unmount effect / late async callback) that
// landed AFTER the reset re-spread the stale tool (e.g.
// "highlight") over it. The reset ran, but the overwrite won.
//
// Fix: every diagnostics publish is gated on the tab still being
// present in `openTabs` (`diagnosticsPublishAllowed`). Once a tab
// is closed its publishes are dropped, so the close reset is the
// final word regardless of publish order.
//
// Coverage (behavior): simulate the exact close sequence — reset the
// mirror, then route a late publish for the closed tab through the
// same gate the App uses, and assert the final mirror value is null.
import { describe, expect, it } from "vitest";
import { diagnosticsPublishAllowed } from "../../../src/renderer/diagnostics/resolve";

/** Mirror of the App's `onDiagnosticsFor` publish after the gate. */
function applyDiagnosticsPublish(
  openTabs: Record<string, unknown>,
  diagnostics: Record<string, unknown>,
  tabId: string,
  d: Record<string, unknown>,
): Record<string, unknown> {
  if (!diagnosticsPublishAllowed(openTabs, tabId)) {
    return diagnostics;
  }
  return { ...diagnostics, ...d, _activeTab: tabId };
}

describe("DEF-097 — closed-tab diagnostics publishes are dropped so the close reset wins", () => {
  it("a publish from a tab that is still open updates the mirror", () => {
    const openTabs: Record<string, unknown> = { a: { id: "a" }, b: { id: "b" } };
    const mirror = { currentPage: 1, activeTool: null };
    const next = applyDiagnosticsPublish(openTabs, mirror, "a", {
      currentPage: 3,
      activeTool: "highlight",
    });
    expect(next.activeTool).toBe("highlight");
    expect(next["_activeTab"]).toBe("a");
  });

  it("a publish from a CLOSED tab is dropped — the mirror keeps the close reset (null)", () => {
    // Simulate: tab "a" is closed -> performCloseTab reset the mirror
    // activeTool to null. A late DocumentView publish for "a" then
    // fires (the unmount race the defect reports). The gate must
    // drop it so the reset survives.
    const openTabs: Record<string, unknown> = { b: { id: "b" } }; // "a" gone
    let mirror: Record<string, unknown> = { currentPage: 1, activeTool: null };
    // performCloseTab reset:
    mirror = { ...mirror, activeTool: null };
    // Late publish from the closing tab (document body still holds
    // 'highlight'):
    mirror = applyDiagnosticsPublish(openTabs, mirror, "a", {
      currentPage: 1,
      activeTool: "highlight",
    });
    expect(mirror.activeTool).toBeNull();
    expect(mirror["_activeTab"]).toBeUndefined();
  });

  it("the reset runs AND the overwrite is impossible even when the late publish arrives after it", () => {
    // Orderings the defect worried about: the reset then the
    // publish (covered above). This pins the module-level contract
    // too: `diagnosticsPublishAllowed` is a pure decision — false
    // for a missing tab id, true for an open one.
    expect(diagnosticsPublishAllowed({ x: {} }, "x")).toBe(true);
    expect(diagnosticsPublishAllowed({}, "x")).toBe(false);
    expect(diagnosticsPublishAllowed({ x: {} }, "y")).toBe(false);
  });
});