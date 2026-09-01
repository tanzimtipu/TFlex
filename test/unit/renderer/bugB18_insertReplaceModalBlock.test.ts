// @vitest-environment jsdom
//
// B18 — Insert / Replace dialogs must be modal-blocked while
// the OS file picker is open (same pattern as MergeDialog).
//
// History: the Insert / Replace dialogs left the backdrop's
// `onClick={onClose}` handler live during `picking`. The
// pick button was disabled but the backdrop click still fired,
// dismissing the picker mid-pick. The same fix as MergeDialog:
// bind the backdrop to a no-op while `picking` is true and
// swallow Esc in the capture phase so the picker owns input.
//
// We exercise this by reading the dialog source and asserting:
//   1. The backdrop's onClick is `picking ? undefined : onClose`.
//   2. The dialog has a picking-state effect that swallows Esc
//      in the capture phase (so any other Esc listener can't
//      dismiss the dialog underneath the picker).
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const insertPath = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "renderer",
  "components",
  "InsertPagesDialog.tsx",
);
const replacePath = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "renderer",
  "components",
  "ReplacePagesDialog.tsx",
);
const mergePath = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "renderer",
  "components",
  "MergeDialog.tsx",
);
const insertSource = fs.readFileSync(insertPath, "utf8");
const replaceSource = fs.readFileSync(replacePath, "utf8");
const mergeSource = fs.readFileSync(mergePath, "utf8");

describe("B18 — Insert / Replace dialogs are modal-blocked while the OS file picker is open", () => {
  it("MergeDialog backdrop is modal-blocked while picking (regression guard)", () => {
    expect(mergeSource).toMatch(/onClick=\{picking\s*\?\s*undefined\s*:\s*onClose\}/);
    expect(mergeSource).toMatch(/addEventListener\("keydown",\s*onKey,\s*true\)/);
  });

  it("InsertPagesDialog backdrop is modal-blocked while picking", () => {
    expect(insertSource).toMatch(/onClick=\{picking\s*\?\s*undefined\s*:\s*onClose\}/);
    expect(insertSource).toMatch(/addEventListener\("keydown",\s*onKey,\s*true\)/);
  });

  it("ReplacePagesDialog backdrop is modal-blocked while picking", () => {
    expect(replaceSource).toMatch(/onClick=\{picking\s*\?\s*undefined\s*:\s*onClose\}/);
    expect(replaceSource).toMatch(/addEventListener\("keydown",\s*onKey,\s*true\)/);
  });

  it("the Esc-swallower stops propagation so the picker owns input", () => {
    // The capture-phase Esc listener must call e.stopPropagation
    // so any other Esc listener below it in the bubble phase
    // (the dialog's own Esc handler) doesn't dismiss the dialog
    // while the picker is open.
    expect(insertSource).toMatch(/e\.stopPropagation\(\)/);
    expect(replaceSource).toMatch(/e\.stopPropagation\(\)/);
  });
});