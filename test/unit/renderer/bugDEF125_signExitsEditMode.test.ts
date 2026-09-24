// @vitest-environment node
//
// DEF-125 — arming the Sign tool must exit Edit mode. While Edit
// mode is open the `.edit-layer` (z-index 4) sits ABOVE the
// signatures layer (z-index 3), so a Sign placement click is
// swallowed by the edit overlay and the signature never lands on
// the page. The fix exits Edit mode at every Sign-arming entry
// point (the same cross-disarm pattern as Sign↔Stamp):
//
//   1. The toolbar's tflex:sign-button handler (App.tsx).
//   2. The Tools palette's Sign button (App.tsx render).
//   3. The signature-manager modal's apply/arm callback
//      (onSigManagerApply), so a modal-confirmed arm also exits
//      Edit mode even if the user opened Sign before reaching the
//      Edit toggle.
//
// App.tsx isn't mounted in unit tests (its App-shell deps are far
// too broad), so we pin the wiring with the established source-scan
// pattern (same as bugB8_closeTabSavePrompt's App-wiring describe):
// each arm site must call `setEditMode(false)` guarded by the
// `editModeOpenRef` check.
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

describe("DEF-125 — arming the Sign tool exits Edit mode", () => {
  it("the toolbar Sign handler (tflex:sign-button) calls setEditMode(false) guarded by editModeOpenRef", () => {
    const match = appSource.match(/const onSignButton = \(\): void => \{[\s\S]*?\n    \};/);
    expect(match).not.toBeNull();
    if (match === null) return;
    const body = match[0];
    expect(body).toMatch(/if \(editModeOpenRef\.current\) \{/);
    expect(body).toMatch(/setEditMode\(false\);/);
  });

  it("the signature-manager apply callback (onSigManagerApply) exits Edit mode before arming", () => {
    const match = appSource.match(/const onSigManagerApply = useCallback\([\s\S]*?\},\s*\[\]\);/);
    expect(match).not.toBeNull();
    if (match === null) return;
    const body = match[0];
    expect(body).toMatch(/if \(editModeOpenRef\.current\) \{/);
    expect(body).toMatch(/setEditMode\(false\);/);
    // The arm still happens (setArmedSignatureId is not dropped).
    expect(body).toMatch(/setArmedSignatureId\(signatureId\)/);
  });

  it("the REVIEW dock's sign verb exits Edit mode before opening the modal", () => {
    // Phase 36 STAGES retired the Tools palette's `onSign` prop. The sign
    // entry's current homes are the REVIEW Action Dock's `sign` verb (the
    // Command Palette runs this same dock action), the palette row, and the
    // panel's signature list. The palette row and the signature list both
    // reach the `onSigManagerApply` path pinned above; the dock verb is the
    // remaining App-level arm site and carries the SAME DEF-125 edit-mode
    // exit, so a REVIEW-dock Sign click while Edit is open still lands.
    const match = appSource.match(/sign: \(\): void => \{[\s\S]*?\n      \},/);
    expect(match).not.toBeNull();
    if (match === null) return;
    const body = match[0];
    expect(body).toMatch(/armedSignatureId !== null/);
    expect(body).toMatch(/editModeOpenRef\.current/);
    expect(body).toMatch(/setEditMode\(false\)/);
    expect(body).toMatch(/setSigModalOpen\(true\)/);
  });

  it("the dock sign toggle-off branch is inside the armed early-return (a toggle-off does not need it)", () => {
    // The toggle-off branch (already armed) must NOT call setEditMode —
    // Sign is already active there. The retired palette used an `} else {`
    // block; the dock verb uses an early `return`, so the toggle-off is
    // everything before that return.
    const match = appSource.match(/sign: \(\): void => \{[\s\S]*?\n      \},/);
    expect(match).not.toBeNull();
    if (match === null) return;
    const body = match[0];
    const toggleOff = body.slice(0, body.indexOf("return;"));
    expect(toggleOff).toMatch(/setArmedSignatureId\(null\)/);
    expect(toggleOff).not.toMatch(/setEditMode/);
  });
});