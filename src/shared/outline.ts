/**
 * Phase 85 — pure outline (bookmark) tree contract.
 *
 * Shared, environment-free model for an edited document outline. Imported by
 * the main-process engine write path, the shared IPC contract and the
 * renderer; it must never import node/electron/dom APIs.
 *
 * An entry's `page` is a 1-based VISIBLE page number, or null when the entry
 * has no target. `children` nest one level deeper.
 *
 * Paths address a node by descending `children`: `[]` is the root LIST, `[i]`
 * is `entries[i]` and `[i, j]` is `entries[i].children[j]`. Every helper is
 * pure and returns a NEW tree — the input is never mutated.
 *
 * `insertEntry` treats the path as the PARENT container: the new entry is
 * appended as the parent's last child (an empty path appends at the root).
 * `indentEntry` moves the node at `path` under its immediately preceding
 * sibling (a no-op for a first sibling); `outdentEntry` moves it up one level,
 * immediately after its parent (a no-op at the root). `removeEntry` drops the
 * node at `path` and its subtree.
 */

export interface OutlineEntry {
  title: string;
  page: number | null;
  children: OutlineEntry[];
}

/** Maximum nested levels (a top-level entry is level 1). Deeper levels are
 *  dropped by `normalizeOutline`. */
export const MAX_OUTLINE_DEPTH = 64;

/** Coerce an arbitrary page value to a 1-based positive integer or null. */
function normalizePage(page: unknown): number | null {
  return typeof page === 'number' && Number.isInteger(page) && page > 0
    ? page
    : null;
}

function normalizeList(raw: unknown, depth: number): OutlineEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: OutlineEntry[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== 'object') continue;
    const rec = item as { title?: unknown; page?: unknown; children?: unknown };
    const title = typeof rec.title === 'string' ? rec.title.trim() : '';
    if (title.length === 0) continue;
    const children = depth + 1 < MAX_OUTLINE_DEPTH
      ? normalizeList(rec.children, depth + 1)
      : [];
    out.push({ title, page: normalizePage(rec.page), children });
  }
  return out;
}

/**
 * Sanitize arbitrary input into a fresh outline tree. Non-array input yields
 * an empty tree; entries with a non-string or empty (after trim) title are
 * dropped; a non-integer/non-positive `page` is coerced to null; nesting is
 * clamped to `MAX_OUTLINE_DEPTH` levels.
 */
export function normalizeOutline(input: unknown): OutlineEntry[] {
  return normalizeList(input, 0);
}

function cloneEntry(entry: OutlineEntry): OutlineEntry {
  return {
    title: entry.title,
    page: entry.page,
    children: entry.children.map(cloneEntry),
  };
}

/** Deep-copy a tree so callers can hand out a value that shares no node with
 *  the input. */
export function cloneOutline(entries: OutlineEntry[]): OutlineEntry[] {
  return entries.map(cloneEntry);
}

/** Total number of entries in the tree, root and descendants alike. */
export function countOutline(entries: OutlineEntry[]): number {
  let total = 0;
  for (const entry of entries) {
    total += 1 + countOutline(entry.children);
  }
  return total;
}

/** The children array addressed by `path` on `root` (`[]` returns `root`), or
 *  null when the path does not resolve. The returned array belongs to the
 *  caller's already-cloned tree. */
function childListAt(root: OutlineEntry[], path: number[]): OutlineEntry[] | null {
  let list = root;
  for (const idx of path) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= list.length) return null;
    list = list[idx].children;
  }
  return list;
}

/** Rebuild the tree with the node at `path` replaced by `fn(node)`; a null
 *  return removes the node. Empty or unresolvable paths return a deep clone
 *  unchanged. */
function withNode(
  entries: OutlineEntry[],
  path: number[],
  fn: (node: OutlineEntry) => OutlineEntry | null,
): OutlineEntry[] {
  if (path.length === 0) return cloneOutline(entries);
  const [head, ...rest] = path;
  const out = cloneOutline(entries);
  if (!Number.isInteger(head) || head < 0 || head >= out.length) return out;
  if (rest.length === 0) {
    const replaced = fn(out[head]);
    if (replaced === null) out.splice(head, 1);
    else out[head] = replaced;
    return out;
  }
  out[head] = { ...out[head], children: withNode(out[head].children, rest, fn) };
  return out;
}

/**
 * Insert `entry` into the tree. The path names the PARENT: the entry is
 * appended as that node's last child; an empty path appends at the root.
 * `entry` is normalized first (an invalid/empty-title entry is a no-op).
 */
export function insertEntry(
  entries: OutlineEntry[],
  path: number[],
  entry: OutlineEntry,
): OutlineEntry[] {
  const clean = normalizeList([entry], 0)[0];
  if (clean === undefined) return cloneOutline(entries);
  if (path.length === 0) return [...cloneOutline(entries), clean];
  return withNode(entries, path, (node) => ({
    ...node,
    children: [...node.children, clean],
  }));
}

/** Rename the node at `path` (title is trimmed). A non-string title or an
 *  unresolvable path is a no-op. */
export function renameEntry(
  entries: OutlineEntry[],
  path: number[],
  title: string,
): OutlineEntry[] {
  if (typeof title !== 'string') return cloneOutline(entries);
  return withNode(entries, path, (node) => ({ ...node, title: title.trim() }));
}

/** Retarget the node at `path` to `page` (coerced like `normalizeOutline`). */
export function retargetEntry(
  entries: OutlineEntry[],
  path: number[],
  page: number | null,
): OutlineEntry[] {
  return withNode(entries, path, (node) => ({ ...node, page: normalizePage(page) }));
}

/** Remove the node at `path` and its subtree. An empty/unresolvable path is a
 *  no-op. */
export function removeEntry(
  entries: OutlineEntry[],
  path: number[],
): OutlineEntry[] {
  return withNode(entries, path, () => null);
}

/** Move the node at `path` under its immediately preceding sibling as that
 *  sibling's last child. A first sibling (or invalid path) is a no-op. */
export function indentEntry(
  entries: OutlineEntry[],
  path: number[],
): OutlineEntry[] {
  const out = cloneOutline(entries);
  if (path.length === 0) return out;
  const idx = path[path.length - 1];
  const parentList = childListAt(out, path.slice(0, -1));
  if (
    parentList === null ||
    !Number.isInteger(idx) ||
    idx <= 0 ||
    idx >= parentList.length
  ) {
    return out;
  }
  const [node] = parentList.splice(idx, 1);
  parentList[idx - 1].children = [...parentList[idx - 1].children, node];
  return out;
}

/** Move the node at `path` up one level, inserted immediately after its
 *  parent. A root-level node (or invalid path) is a no-op. */
export function outdentEntry(
  entries: OutlineEntry[],
  path: number[],
): OutlineEntry[] {
  const out = cloneOutline(entries);
  if (path.length < 2) return out;
  const idx = path[path.length - 1];
  const parentIdx = path[path.length - 2];
  const grandList = childListAt(out, path.slice(0, -2));
  if (
    grandList === null ||
    !Number.isInteger(parentIdx) ||
    parentIdx < 0 ||
    parentIdx >= grandList.length
  ) {
    return out;
  }
  const parent = grandList[parentIdx];
  if (!Number.isInteger(idx) || idx < 0 || idx >= parent.children.length) {
    return out;
  }
  const [node] = parent.children.splice(idx, 1);
  grandList.splice(parentIdx + 1, 0, node);
  return out;
}
