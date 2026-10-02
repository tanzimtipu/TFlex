// Phase 85 (chunk C2) — the renderer-side outline / bookmark editor model.
//
// The tree contract itself lives in `src/shared/outline.ts` (owned by the
// backend IPC contract, TFL-390): `OutlineEntry`, the pure tree transforms
// (`insertEntry` / `renameEntry` / `retargetEntry` / `removeEntry` /
// `indentEntry` / `outdentEntry`) and `cloneOutline`. This module adds the
// parts only the renderer needs:
//   - seeding the model from pdf.js outline nodes (resolving destinations),
//   - path-based selection bookkeeping,
//   - validation + an outcome shape so an invalid edit makes NO engine call,
//   - the commit helper that calls `engine.setOutline` and reverts the model
//     when the engine refuses the edit.
//
// There is deliberately no React import here: this module is unit-testable on
// its own and carries no rendering concerns.

import {
  cloneOutline,
  indentEntry,
  outdentEntry,
  removeEntry,
  renameEntry,
  retargetEntry,
} from "../../shared/outline";
import type { OutlineEntry } from "../../shared/outline";
import type { Result } from "../../shared/result";
import type { EngineError } from "../../shared/types";
import type { EngineState } from "../engine/types";
import type { OutlineNode } from "../pdf/pdfjs";

export type { OutlineEntry };

/** Index path from the root list to a row: `[0, 2]` is the third child of
 *  the first top-level entry. `[]` addresses the root list itself. */
export type OutlinePath = number[];

/** The engine-client commit call. Optional-friendly: a pre-Phase-85 backend
 *  has no method, so a caller may pass `undefined` and the helper reports a
 *  friendly engine-error instead of throwing. */
export type SetOutlineFn = (
  docId: string,
  entries: OutlineEntry[],
) => Promise<Result<EngineState, EngineError> | undefined>;

/** The default title for a freshly added bookmark. Non-empty so the engine's
 *  `invalid-outline` guard never fires on an add. */
export const DEFAULT_NEW_TITLE = "New bookmark";

/** Deep copy of an entry tree. The editor never mutates its input. */
export function cloneEntries(entries: readonly OutlineEntry[]): OutlineEntry[] {
  return cloneOutline([...entries]);
}

/** Seed the editable model from a pdf.js outline, resolving each node's
 *  destination to a 1-based VISIBLE page through `resolvePage`. A node with
 *  no resolvable target carries `page: null` (the engine treats that as a
 *  bookmark without a destination). */
export async function seedOutlineEntries(
  nodes: readonly OutlineNode[],
  resolvePage: (dest: unknown) => Promise<number | null>,
): Promise<OutlineEntry[]> {
  const out: OutlineEntry[] = [];
  for (const node of nodes) {
    const page = await resolvePage(node.dest);
    out.push({
      title: typeof node.title === "string" ? node.title : "",
      page,
      children: await seedOutlineEntries(node.children, resolvePage),
    });
  }
  return out;
}

/** The entry at `path`, or null when the path no longer addresses a row. */
export function entryAt(
  entries: OutlineEntry[],
  path: OutlinePath,
): OutlineEntry | null {
  if (path.length === 0) return null;
  let list = entries;
  let node: OutlineEntry | undefined;
  for (const index of path) {
    node = list[index];
    if (node === undefined) return null;
    list = node.children;
  }
  return node ?? null;
}

/** The children array that holds the entry addressed by `path`. For `[]`
 *  this is the root list itself. Defensive: an out-of-range path returns the
 *  deepest reachable list rather than throwing. */
function listAt(entries: OutlineEntry[], path: OutlinePath): OutlineEntry[] {
  let list = entries;
  for (const index of path) {
    const node = list[index];
    if (node === undefined) return list;
    list = node.children;
  }
  return list;
}

/** The result of a computed edit. `apply` carries the next tree and the
 *  selection to show after the engine accepts it; `invalid` means no engine
 *  call is made and the model is untouched. */
export type OutlineEditOutcome =
  | { kind: "apply"; entries: OutlineEntry[]; selection: OutlinePath }
  | { kind: "invalid"; error: string };

// ---------------------------------------------------------------------------
// Edit operations

/** True when `path` addresses the first child of its parent (indent is not
 *  possible: there is no previous sibling to nest under). */
export function isFirstChild(path: OutlinePath): boolean {
  return path.length === 0 || path[path.length - 1] === 0;
}

/** True when `path` addresses a top-level row (outdent is not possible). */
export function isRootRow(path: OutlinePath): boolean {
  return path.length <= 1;
}

/** Add a sibling directly after the selected row, or the first root entry
 *  when the tree (or the selection) is empty. */
export function editAdd(
  entries: OutlineEntry[],
  selection: OutlinePath | null,
): OutlineEditOutcome {
  const next = cloneEntries(entries);
  const parentPath = selection === null ? [] : selection.slice(0, -1);
  const list = listAt(next, parentPath);
  const insertAt =
    selection === null || selection.length === 0
      ? list.length
      : selection[selection.length - 1] + 1;
  list.splice(insertAt, 0, {
    title: DEFAULT_NEW_TITLE,
    page: null,
    children: [],
  });
  return { kind: "apply", entries: next, selection: [...parentPath, insertAt] };
}

/** Rename the entry at `path`. An empty (or whitespace-only) title is
 *  rejected without touching the model, so the engine is never called. */
export function editRename(
  entries: OutlineEntry[],
  path: OutlinePath,
  rawTitle: string,
): OutlineEditOutcome {
  const title = rawTitle.trim();
  if (title === "") {
    return { kind: "invalid", error: "A bookmark needs a title." };
  }
  if (entryAt(entries, path) === null) {
    return { kind: "invalid", error: "The bookmark no longer exists." };
  }
  return {
    kind: "apply",
    entries: renameEntry(entries, path, title),
    selection: path.slice(),
  };
}

/** Point the entry at `path` at a 1-based VISIBLE page. A non-integer or
 *  out-of-range target is rejected without touching the model (the engine's
 *  `out-of-range` guard would refuse it anyway). */
export function editRetarget(
  entries: OutlineEntry[],
  path: OutlinePath,
  rawPage: number | string,
  visibleCount: number,
): OutlineEditOutcome {
  const page =
    typeof rawPage === "number" ? rawPage : Number.parseInt(String(rawPage), 10);
  if (!Number.isInteger(page) || page < 1 || page > visibleCount) {
    return {
      kind: "invalid",
      error: `Page target must be between 1 and ${Math.max(visibleCount, 0)}.`,
    };
  }
  if (entryAt(entries, path) === null) {
    return { kind: "invalid", error: "The bookmark no longer exists." };
  }
  return {
    kind: "apply",
    entries: retargetEntry(entries, path, page),
    selection: path.slice(),
  };
}

/** Nest the entry under its previous sibling. Invalid for the root list and
 *  for a first child (the row's indent verb is disabled there). */
export function editIndent(
  entries: OutlineEntry[],
  path: OutlinePath,
): OutlineEditOutcome {
  if (path.length === 0) {
    return { kind: "invalid", error: "Select a bookmark first." };
  }
  const index = path[path.length - 1];
  if (index === 0) {
    return { kind: "invalid", error: "The first bookmark cannot be indented." };
  }
  if (entryAt(entries, path) === null) {
    return { kind: "invalid", error: "The bookmark no longer exists." };
  }
  const parentPath = path.slice(0, -1);
  const previous = entryAt(entries, [...parentPath, index - 1]);
  const childCount = previous === null ? 0 : previous.children.length;
  return {
    kind: "apply",
    entries: indentEntry(entries, path),
    selection: [...parentPath, index - 1, childCount],
  };
}

/** Un-nest the entry to the level of its parent, directly after it. Invalid
 *  for a top-level row (the row's outdent verb is disabled there). */
export function editOutdent(
  entries: OutlineEntry[],
  path: OutlinePath,
): OutlineEditOutcome {
  if (path.length <= 1) {
    return { kind: "invalid", error: "The bookmark is already at the top level." };
  }
  if (entryAt(entries, path) === null) {
    return { kind: "invalid", error: "The bookmark no longer exists." };
  }
  const parentPath = path.slice(0, -1);
  const grandPath = parentPath.slice(0, -1);
  const parentIndex = parentPath[parentPath.length - 1];
  return {
    kind: "apply",
    entries: outdentEntry(entries, path),
    selection: [...grandPath, parentIndex + 1],
  };
}

/** Remove the entry and its whole subtree. */
export function editDelete(
  entries: OutlineEntry[],
  path: OutlinePath,
): OutlineEditOutcome {
  if (path.length === 0) {
    return { kind: "invalid", error: "Select a bookmark first." };
  }
  if (entryAt(entries, path) === null) {
    return { kind: "invalid", error: "The bookmark no longer exists." };
  }
  const next = removeEntry(entries, path);
  const parentPath = path.slice(0, -1);
  const siblings = listAt(next, parentPath);
  const index = path[path.length - 1];
  return {
    kind: "apply",
    entries: next,
    selection:
      siblings.length === 0
        ? parentPath
        : [...parentPath, Math.min(index, siblings.length - 1)],
  };
}

// ---------------------------------------------------------------------------
// Commit

export interface OutlineCommitResult {
  entries: OutlineEntry[];
  /** null on success; a readable message when the engine refused the edit. */
  error: string | null;
}

const PHASE_85_MISSING =
  "Outline editing requires the Phase 85 backend update.";

/** Commit an applied edit through `setOutline`. On success the model becomes
 *  the accepted tree; on a typed engine error (or a throw) it reverts to
 *  `current` and returns the message, so the panel never shows an edit the
 *  engine refused. An `invalid` outcome makes no engine call. */
export async function commitOutlineEdit(args: {
  docId: string;
  current: OutlineEntry[];
  outcome: OutlineEditOutcome;
  setOutline: SetOutlineFn;
}): Promise<OutlineCommitResult> {
  const { docId, current, outcome, setOutline } = args;
  if (outcome.kind === "invalid") {
    return { entries: current, error: outcome.error };
  }
  let result: Result<EngineState, EngineError> | undefined;
  try {
    result = await setOutline(docId, outcome.entries);
  } catch {
    return { entries: current, error: "Could not save the bookmark change." };
  }
  if (result === undefined) {
    return { entries: current, error: PHASE_85_MISSING };
  }
  if (!result.ok) {
    const message =
      typeof result.error.message === "string" && result.error.message !== ""
        ? result.error.message
        : "The engine rejected the bookmark change.";
    return { entries: current, error: message };
  }
  return { entries: outcome.entries, error: null };
}
