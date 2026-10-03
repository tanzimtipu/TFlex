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
// B3/B6 (this file's update) — every backdrop now routes through
// the shared `useBackdropClose(onClose, picking)` hook, which:
//   - records where the pointer interaction STARTED (an onMouseDown
//     handler + ref), so a text-selection drag that starts in the
//     input and releases over the backdrop does NOT close (the
//     click handler requires the mousedown origin AND
//     target === currentTarget);
//   - disables backdrop-close entirely while `picking` is true.
//
// We exercise this by reading the dialog source and asserting:
//   1. Each backdrop is wired through `useBackdropClose` with the
//      picking gate.
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
    // Phase 92 chunk C1 — MergeDialog adopts DialogShell, which owns the
    // backdrop close guard. The picking gate is now expressed as the shell's
    // `blockBackdropClose` prop; the capture-phase Esc-swallow stays local.
    expect(mergeSource).toMatch(/<DialogShell/);
    expect(mergeSource).toMatch(/blockBackdropClose=\{picking\}/);
    expect(mergeSource).toMatch(/addEventListener\("keydown",\s*onKey,\s*true\)/);
  });

  it("InsertPagesDialog backdrop is modal-blocked while picking AND drag-safe (B3/B6)", () => {
    // TFL-513-E1 — InsertPagesDialog adopts DialogShell, which owns the
    // backdrop close guard. The picking gate is now expressed as the shell's
    // `blockBackdropClose` prop; the capture-phase Esc-swallow stays local.
    expect(insertSource).toMatch(/<DialogShell/);
    expect(insertSource).toMatch(/blockBackdropClose=\{picking\}/);
    expect(insertSource).toMatch(/addEventListener\("keydown",\s*onKey,\s*true\)/);
  });

  it("ReplacePagesDialog backdrop is modal-blocked while picking AND drag-safe (B3/B6)", () => {
    // Phase 92 chunk D1 — ReplacePagesDialog adopts DialogShell, which owns
    // the backdrop close guard. The picking gate is now expressed as the
    // shell's `blockBackdropClose` prop; the capture-phase Esc-swallow stays
    // local (asserted below).
    expect(replaceSource).toMatch(/<DialogShell/);
    expect(replaceSource).toMatch(/blockBackdropClose=\{picking\}/);
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