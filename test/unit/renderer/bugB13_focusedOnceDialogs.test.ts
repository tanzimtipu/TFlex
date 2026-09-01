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
const insertSource = fs.readFileSync(insertPath, "utf8");
const replaceSource = fs.readFileSync(replacePath, "utf8");
const deleteSource = fs.readFileSync(deletePath, "utf8");

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
    /queueMicrotask\([\s\S]*?first\?\.focus/,
  );
}

describe("B13 — focus stability (focused-once gate) for InsertPages / ReplacePages / DeletePage dialogs", () => {
  it("InsertPagesDialog gates focus on a focusedOnceRef and defers via queueMicrotask", () => {
    assertFocusedOnceGate({ label: "InsertPagesDialog", source: insertSource });
  });
  it("ReplacePagesDialog gates focus on a focusedOnceRef and defers via queueMicrotask", () => {
    assertFocusedOnceGate({ label: "ReplacePagesDialog", source: replaceSource });
  });
  it("DeletePageDialog gates focus on a focusedOnceRef and defers via queueMicrotask", () => {
    assertFocusedOnceGate({ label: "DeletePageDialog", source: deleteSource });
  });

  it("InsertPagesDialog focus effect deps are [open, onClose] only", () => {
    // The focus effect's dep array must be exactly [open, onClose] —
    // not [open, onClose, picking, mode, ...] — so a state change
    // (picking=true, mode flip) doesn't re-run the focus call.
    // We locate the closing `}, [open, onClose]);` immediately
    // after the focus effect's return statement (which removes
    // the keydown listener).
    const m = insertSource.match(
      /window\.removeEventListener\("keydown",\s*onKey\);[\s\S]*?\},\s*\[([^\]]*)\]\)/,
    );
    expect(m, "focus effect matched").not.toBeNull();
    if (m === null) return;
    const deps = m[1]?.trim() ?? "";
    expect(deps).toBe("open, onClose");
  });
});