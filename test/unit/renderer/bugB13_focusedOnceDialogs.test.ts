// @vitest-environment jsdom
//
// B13 — focus stability for dropdown inputs in InsertPages /
// ReplacePages / DeletePage dialogs.
//
// History: the focus effect ran on every dependency change,
// including the parent's fresh `onClose` identity on every
// render. The focus call stole focus from any `<input>` the
// user was actively typing into — the user hovered the input,
// started typing, the parent re-rendered, the focus call fired
// and bounced focus back to the first interactive element.
//
// The fix: a `focusedOnceRef` gate runs the focus call exactly
// once per dialog open; the ref resets on close so the next
// open re-focuses. Microtask deferral so the focus call lands
// after React's commit phase and doesn't race the parent click
// that opened the dialog.
//
// We exercise the wiring by reading the source and asserting:
//   1. Each dialog declares a `focusedOnceRef` useRef.
//   2. The focus effect returns early when `focusedOnceRef.current`
//      is true (gate in place).
//   3. The effect resets the ref on close.
//   4. The focus call is deferred via `queueMicrotask`.
//   5. The dep array is `[open, onClose]` (not also `running`,
//      not also `mode`, not also `currentPage`, etc.) so a
//      state change after open doesn't re-run the focus call.
//   6. ReplacePagesDialog (Phase 92 chunk D1) no longer declares its own
//      gate: it delegates to DialogShell, which owns initial focus to the
//      action marked `default` once per open (deps [open]). This suite
//      asserts the delegation shape and the shell's focus contract instead.
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
const deletePath = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "renderer",
  "components",
  "DeletePageDialog.tsx",
);
const dialogShellPath = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "src",
  "renderer",
  "components",
  "DialogShell.tsx",
);
const insertSource = fs.readFileSync(insertPath, "utf8");
const replaceSource = fs.readFileSync(replacePath, "utf8");
const deleteSource = fs.readFileSync(deletePath, "utf8");
const dialogShellSource = fs.readFileSync(dialogShellPath, "utf8");

interface FileAssertions {
  label: string;
  source: string;
}

function assertFocusedOnceGate(file: FileAssertions): void {
  // The dialog declares a focusedOnceRef useRef.
  expect(file.source, `${file.label}: focusedOnceRef useRef exists`).toMatch(
    /focusedOnceRef\s*=\s*useRef<boolean>/,
  );
  // The focus effect returns early when the ref is true.
  expect(
    file.source,
    `${file.label}: focus effect returns early when focusedOnceRef.current is true`,
  ).toMatch(/if\s*\(\s*focusedOnceRef\.current\s*\)\s*return/);
  // The ref resets on close.
  expect(file.source, `${file.label}: ref resets on close`).toMatch(
    /focusedOnceRef\.current\s*=\s*false/,
  );
  // The focus call is deferred via queueMicrotask.
  expect(file.source, `${file.label}: focus call uses queueMicrotask`).toMatch(
    /queueMicrotask\([\s\S]*?(?:first\?\.focus|firstControlRef\.current\?\.focus)/,
  );
}

describe("B13 — focus stability (focused-once gate) for InsertPages / ReplacePages / DeletePage dialogs", () => {
  it("InsertPagesDialog delegates its once-per-open focus to DialogShell (TFL-513-E1)", () => {
    // TFL-513-E1 — InsertPagesDialog adopted DialogShell, which owns initial
    // focus to the action marked `default` once per open. The dialog no longer
    // declares its own focusedOnceRef gate, so this case asserts the delegation
    // shape; the shell carries the guarantee in the test below.
    expect(insertSource, "InsertPagesDialog renders through DialogShell").toMatch(
      /<DialogShell\b/,
    );
  });
  it("ReplacePagesDialog delegates its once-per-open focus to DialogShell (Phase 92 chunk D1)", () => {
    // Phase 92 chunk D1 — ReplacePagesDialog adopted DialogShell, which owns
    // initial focus to the action marked `default` once per open. The dialog
    // no longer declares its own focusedOnceRef gate, so this case asserts the
    // delegation shape; the shell carries the guarantee in the next test.
    expect(replaceSource, "ReplacePagesDialog renders through DialogShell").toMatch(
      /<DialogShell\b/,
    );
  });
  it("DeletePageDialog gates focus on a focusedOnceRef and defers via queueMicrotask", () => {
    assertFocusedOnceGate({ label: "DeletePageDialog", source: deleteSource });
  });
  it("DialogShell owns the once-per-open focus for its adopters", () => {
    // The delegated focus guarantee: the shell defers the focus call via
    // queueMicrotask to the `default` action, on the rising edge of `open`
    // only ([open] deps), so a parent re-render cannot steal focus.
    expect(
      dialogShellSource,
      "DialogShell defers focus to the default action via queueMicrotask",
    ).toMatch(
      /queueMicrotask\([\s\S]*?(?:defaultActionRef\.current\?\.focus\(\)|target\.focus\(\))/,
    );
    const m = dialogShellSource.match(
      /queueMicrotask\([\s\S]*?\},\s*\[([^\]]*)\]\)/,
    );
    expect(m, "DialogShell focus effect matched").not.toBeNull();
    if (m === null) return;
    expect(m[1]?.trim()).toBe("open");
  });

  it("InsertPagesDialog expresses its picking gate through DialogShell, not a local focus effect", () => {
    // TFL-513-E1 — the dialog no longer owns an [open, onClose]-keyed focus
    // effect; its backdrop block is the shell's `blockBackdropClose` prop.
    expect(insertSource).toMatch(/<DialogShell\b/);
    expect(insertSource).toMatch(/blockBackdropClose=\{picking\}/);
  });
});