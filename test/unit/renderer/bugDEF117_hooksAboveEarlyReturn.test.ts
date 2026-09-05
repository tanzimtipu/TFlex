// @vitest-environment node
//
// DEF-117 — Rules-of-Hooks violation in the controlled dialogs.
//
// Every controlled dialog gates its render on `open`:
//
//     if (!open) return null;
//
// Hooks must be called unconditionally at the top of the component,
// BEFORE any such early return. When `useBackdropClose(...)` (or
// any other hook) was placed AFTER the guard, the hook count
// changed between the false and true renders of `open`, so React
// threw error #310 ("Rendered more hooks than during the previous
// render") the first time the dialog opened, unmounting the whole
// app to a black window (qa reproduced on Sign, Export-to-Word and
// a direct sign-button event).
//
// Phase C (motion migration) removed the `if (!open) return null;`
// guards entirely: each dialog now keeps an always-mounted
// `<AnimatePresence>` and moves the open gate into the JSX as
// `{open && ...}`, which is what produces the exit animation. The
// migration therefore STRENGTHENS the DEF-117 invariant — a
// component with no early return at all cannot put a hook after one —
// and this source-contract test pins the new shape:
//
//   - grep: no dialog may still use `if (!open) return null;`
//   - scan: within each dialog component's OWN function body, no
//     hook call (useBackdropClose / useState / useEffect / useRef /
//     useMemo / useCallback) appears after ANY `return` statement.
//
// The scan is:
//   - function-scoped — a hook call in a sibling sub-component
//     (DrawTab, CropEditor, StampPreview, ...) is a different
//     function whose hook counts cannot leak into the dialog, so it
//     is not a violation;
//   - brace-depth aware — an `if (!open) return;` inside an effect
//     or useMemo callback is a nested-body guard, not a
//     component-level early return;
//   - comment/string aware — `// ...` and `/* ... */` comments plus
//     string and template-literal contents are blanked before the
//     scan so copy mentioning hooks or unbalanced braces cannot
//     produce false positives.
import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const RENDERER_DIR = path.join(__dirname, "..", "..", "..", "src", "renderer");

const DIALOGS: ReadonlyArray<{ label: string; file: string }> = [
  { label: "SignatureManagerModal", file: "signatures/SignatureManagerModal.tsx" },
  { label: "DocxExportDialog", file: "components/DocxExportDialog.tsx" },
  { label: "CropPagesDialog", file: "components/CropPagesDialog.tsx" },
  { label: "InsertPagesDialog", file: "components/InsertPagesDialog.tsx" },
  { label: "OcrDialog", file: "components/OcrDialog.tsx" },
  { label: "SaveAsDialog", file: "components/SaveAsDialog.tsx" },
  { label: "OptimizeDialog", file: "components/OptimizeDialog.tsx" },
  { label: "MergeDialog", file: "components/MergeDialog.tsx" },
  { label: "SplitDialog", file: "components/SplitDialog.tsx" },
  { label: "StampDialog", file: "components/StampDialog.tsx" },
  { label: "FlattenConfirmDialog", file: "forms/FlattenConfirmDialog.tsx" },
  { label: "DeletePageDialog", file: "components/DeletePageDialog.tsx" },
  { label: "ReplacePagesDialog", file: "components/ReplacePagesDialog.tsx" },
  { label: "RenumberPagesDialog", file: "components/RenumberPagesDialog.tsx" },
  { label: "ExportDialog", file: "components/ExportDialog.tsx" },
  { label: "TextExportDialog", file: "components/TextExportDialog.tsx" },
  { label: "CreateFromImagesDialog", file: "components/CreateFromImagesDialog.tsx" },
  { label: "CommentImportDialog", file: "components/CommentImportDialog.tsx" },
  { label: "CommentExportDialog", file: "components/CommentExportDialog.tsx" },
  { label: "AuditSpaceDialog", file: "components/AuditSpaceDialog.tsx" },
  { label: "CloseTabPromptDialog", file: "components/CloseTabPromptDialog.tsx" },
  // Phase C — the three sheet dialogs migrated with the modals gain the
  // same unconditional-hooks contract (their guards were removed too).
  { label: "AboutDialog", file: "components/AboutDialog.tsx" },
  { label: "PreferencesDialog", file: "components/PreferencesDialog.tsx" },
  { label: "UpdatePromptDialog", file: "components/UpdatePromptDialog.tsx" },
];

const HOOK_NAMES = ["useBackdropClose", "useState", "useEffect", "useRef", "useMemo", "useCallback"];
const HOOK_SOURCE = /\b(?:useBackdropClose|useState|useEffect|useRef|useMemo|useCallback)\b(?:\s*<[^<>]*>)?\s*\(/g;
/** Legacy Phase-1 guard — must no longer exist (Phase C moved the
 *  gate into AnimatePresence, which is what enables the exit). */
const OPEN_GUARD_SOURCE = /if\s*\(\s*!open\s*\)\s*return\s+null/;
/** Any `return` at component-body depth. A hook after the FIRST one
 *  would change the hook count between renders. */
const RETURN_SOURCE = /\breturn\b/;
const ANIMATE_PRESENCE_SOURCE = /<AnimatePresence>/;
const FN_DECL_SOURCE = /^(?:export\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/;

/** Blank comments and string / template-literal contents, keeping
 *  line breaks and real code (including `${...}` interpolation code)
 *  intact, so brace-depth and hook scanning see only the program
 *  text. */
function stripCommentsAndStrings(source: string): string {
  const out: string[] = [];
  const n = source.length;
  let i = 0;
  while (i < n) {
    const ch = source[i] ?? "";
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      while (i < n && source[i] !== "\n") {
        out.push(" ");
        i += 1;
      }
      continue;
    }
    if (ch === "/" && next === "*") {
      out.push(" ", " ");
      i += 2;
      while (i < n) {
        if (source[i] === "*" && source[i + 1] === "/") {
          out.push(" ", " ");
          i += 2;
          break;
        }
        out.push(source[i] === "\n" ? "\n" : " ");
        i += 1;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      // A quoted string literal cannot span a raw newline in JS/TS.
      // If the closing quote is NOT on this same line, the char is a
      // contraction apostrophe in JSX text (e.g. "stamp's"), not a
      // string opener — emit it literally so it does not blank the
      // rest of the file.
      let j = i + 1;
      let closed = false;
      while (j < n && source[j] !== "\n") {
        if (source[j] === "\\") {
          j += 2;
          continue;
        }
        if (source[j] === ch) {
          closed = true;
          break;
        }
        j += 1;
      }
      if (!closed) {
        out.push(ch);
        i += 1;
        continue;
      }
      while (i <= j) {
        out.push(source[i] === "\n" ? "\n" : " ");
        i += 1;
      }
      continue;
    }
    if (ch === "`") {
      out.push(" ");
      i += 1;
      while (i < n) {
        const c = source[i];
        if (c === "\\") {
          out.push(" ", " ");
          i += 2;
          continue;
        }
        if (c === "$" && source[i + 1] === "{") {
          // `${...}` interpolation: keep the code (brace counted) so
          // depth tracking stays honest; blank the surrounding text.
          out.push(" ", "{");
          i += 2;
          let d = 1;
          while (i < n && d > 0) {
            const cc = source[i];
            if (cc === "\\") {
              out.push(cc, source[i + 1] ?? " ");
              i += 2;
              continue;
            }
if (cc === "{") d += 1;
        else if (cc === "}") {
          d -= 1;
          if (d === 0) {
            // Emit the closing brace so `${x}` stays balanced in the
            // blanked output (the `${` above already emitted an open).
            out.push("}");
            i += 1;
            continue;
          }
        }
            out.push(cc);
            i += 1;
          }
          continue;
        }
        if (c === "`") {
          out.push(" ");
          i += 1;
          break;
        }
        out.push(c === "\n" ? "\n" : " ");
        i += 1;
      }
      continue;
    }
    out.push(ch);
    i += 1;
  }
  return out.join("");
}

interface LineDepth {
  depthBefore: number;
  depthAfter: number;
}

function computeDepths(lines: string[]): LineDepth[] {
  const out: LineDepth[] = [];
  let depth = 0;
  for (const line of lines) {
    let d = depth;
    for (const ch of line) {
      if (ch === "{") d += 1;
      else if (ch === "}") d -= 1;
    }
    out.push({ depthBefore: depth, depthAfter: d });
    depth = d;
  }
  return out;
}

interface FnBody {
  name: string;
  /** Line (0-based) holding the body's opening `{`. */
  startLine: number;
  /** Line (0-based) holding the body's closing `}`. */
  endLine: number;
}

function topLevelFunctionBodies(lines: string[]): FnBody[] {
  const fns: FnBody[] = [];
  let depth = 0;
  let i = 0;
  while (i < lines.length) {
    const m = FN_DECL_SOURCE.exec(lines[i] ?? "");
    if (depth === 0 && m !== null) {
      const body = findBodyBounds(lines, i);
      if (body !== null) {
        fns.push({ name: m[1] ?? "", startLine: body.startLine, endLine: body.endLine });
        // The body is balanced, so the global depth is back to 0.
        i = body.endLine + 1;
        continue;
      }
    }
    for (const ch of lines[i] ?? "") {
      if (ch === "{") depth += 1;
      else if (ch === "}") depth -= 1;
    }
    i += 1;
  }
  return fns;
}

function findBodyBounds(
  lines: string[],
  declLine: number,
): { startLine: number; endLine: number } | null {
  // Track parens so an inline-destructured parameter list
  // (`function Dialog({ open, onClose }: Props) {`) does not
  // mislead the scan: the destructure's braces sit INSIDE the
  // parameter parens, while the body's `{` comes after the parens
  // close. Only a `{`/`}` seen at paren depth 0 counts as the body.
  let parens = 0;
  let depth = 0;
  let startLine = -1;
  let sawBodyOpen = false;
  for (let j = declLine; j < lines.length; j += 1) {
    for (const ch of lines[j] ?? "") {
      if (ch === "(") parens += 1;
      else if (ch === ")") parens -= 1;
      else if (parens === 0 && ch === "{") {
        depth += 1;
        if (!sawBodyOpen) {
          sawBodyOpen = true;
          startLine = j;
        }
      } else if (parens === 0 && ch === "}") {
        depth -= 1;
        if (sawBodyOpen && depth === 0) {
          return { startLine, endLine: j };
        }
      }
    }
  }
  return null;
}

/** Scan one dialog source. Returns the legacy guard count (must be
 *  zero after Phase C), the hook calls that land after a body-level
 *  `return`, and whether the dialog mounts its exit gate through
 *  `<AnimatePresence>`. */
function analyzeDialog(source: string): {
  guardCount: number;
  usesAnimatePresence: boolean;
  lateHooks: Array<{ line: number; hook: string; fn: string }>;
} {
  const lines = stripCommentsAndStrings(source).split("\n");
  const depths = computeDepths(lines);
  let guardCount = 0;
  const lateHooks: Array<{ line: number; hook: string; fn: string }> = [];
  for (const fn of topLevelFunctionBodies(lines)) {
    const bodyDepth = depths[fn.startLine]?.depthAfter ?? -1;
    if (bodyDepth < 0) continue;
    const guards: number[] = [];
    const hooksHere: Array<{ line: number; hook: string }> = [];
    let firstReturn = -1;
    for (let l = fn.startLine + 1; l < fn.endLine; l += 1) {
      if ((depths[l]?.depthBefore ?? -1) !== bodyDepth) continue;
      const text = lines[l] ?? "";
      if (OPEN_GUARD_SOURCE.test(text)) guards.push(l);
      if (firstReturn < 0 && RETURN_SOURCE.test(text)) firstReturn = l;
      const hookMatch = HOOK_SOURCE.exec(text);
      if (hookMatch !== null) {
        const hook =
          HOOK_NAMES.find((name) => hookMatch[0].startsWith(name)) ?? "hook";
        hooksHere.push({ line: l, hook });
      }
    }
    guardCount += guards.length;
    if (firstReturn >= 0) {
      for (const h of hooksHere) {
        if (h.line > firstReturn) {
          lateHooks.push({ line: h.line, hook: h.hook, fn: fn.name });
        }
      }
    }
  }
  const usesAnimatePresence = ANIMATE_PRESENCE_SOURCE.test(
    stripCommentsAndStrings(source),
  );
  return { guardCount, usesAnimatePresence, lateHooks };
}

describe("DEF-117 — every controlled dialog calls its hooks unconditionally", () => {
  for (const { label, file } of DIALOGS) {
    it(`${label} has no hook call after a return and no legacy \`if (!open) return null;\` guard`, () => {
      const source = fs.readFileSync(path.join(RENDERER_DIR, file), "utf8");
      const { guardCount, usesAnimatePresence, lateHooks } = analyzeDialog(source);
      // Phase C: the early-return guard is REMOVED — the open gate now
      // lives in `{open && ...}` inside AnimatePresence. The guard's
      // absence is what makes an exit animation possible.
      expect(
        guardCount,
        `${label}: the Phase-1 \`if (!open) return null;\` guard must be gone (Phase C gate), otherwise the exit animation cannot run`,
      ).toBe(0);
      expect(
        usesAnimatePresence,
        `${label}: the dialog gates through <AnimatePresence> so close animates out`,
      ).toBe(true);
      expect(lateHooks, `${label}: no hook call may appear after a return`).toEqual([]);
    });
  }

  it("the scanner flags a hook placed after the guard (regression self-check)", () => {
    const bad = `
import { useState } from "react";
export function Dialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [x, setX] = useState(0);
  if (!open) return null;
  const [y, setY] = useState(1);
  return <div onClick={onClose}>{x + y}</div>;
}
`;
    const { guardCount, lateHooks } = analyzeDialog(bad);
    expect(guardCount).toBe(1);
    expect(lateHooks).toHaveLength(1);
    expect(lateHooks[0]?.hook).toBe("useState");
  });

  it("the scanner accepts hooks above the return and ignores nested-body returns (regression self-check)", () => {
    const good = `
import { useEffect, useRef, useState } from "react";
import { AnimatePresence } from "motion/react";
export function Dialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [x, setX] = useState(0);
  useEffect(() => {
    if (!open) return;
    ref.current?.focus();
  }, [open]);
  return (
    <AnimatePresence>
      {open && <div ref={ref} onClick={onClose}>{x}</div>}
    </AnimatePresence>
  );
}
`;
    const { guardCount, usesAnimatePresence, lateHooks } = analyzeDialog(good);
    expect(guardCount).toBe(0);
    expect(usesAnimatePresence).toBe(true);
    expect(lateHooks).toEqual([]);
  });

  it("the scanner ignores hooks in sibling sub-components (regression self-check)", () => {
    const withSub = `
export function Dialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const backdrop = useBackdropClose(onClose);
  return <AnimatePresence>{open && <Child />}</AnimatePresence>;
}
function Child() {
  const [y, setY] = useState(0);
  return <span>{y}</span>;
}
`;
    const { guardCount, lateHooks } = analyzeDialog(withSub);
    expect(guardCount).toBe(0);
    expect(lateHooks).toEqual([]);
  });
});