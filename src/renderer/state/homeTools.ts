// Phase 58 (chunk 4) — the HOME tool row's model.
//
// The welcome screen's action row is editable: Open Files is a FIXED first tile,
// and the rest of the row is the persisted `homeTools` list of registry tool
// ids. This module owns the pure list algebra (sanitize / add / remove) and the
// two constants that pin the row's shape. It touches no React and no electron.
//
// The list holds ONLY the removable tiles; the fixed Open tile is never in it
// (its id is `HOME_FIXED_TOOL_ID`). The stored field lives in `AppSettings`
// (`homeTools`, validated main-side) and is mirrored here for the renderer's
// defensive re-validation on read.

import { toolById } from './toolsRegistry';

/** The home row's removable-tile cap. Mirrors the main process's
 *  `HOME_TOOLS_CAP = 14` in `src/main/services/settings.ts`; the two must move
 *  together so a saved list the renderer builds is never truncated silently on
 *  the next launch. */
export const HOME_TOOLS_MAX = 14;

/** The fixed first tile's registry id. It is ALWAYS rendered first and can
 *  never be added to or removed from the editable list. */
export const HOME_FIXED_TOOL_ID = 'open';

/** The shipped default row (used when the stored field is absent): the
 *  pre-Phase-58 welcome actions after the fixed Open tile. */
export const DEFAULT_HOME_TOOLS: readonly string[] = ['createFromImages', 'merge'];

/**
 * Coerce a stored value into a valid home-tool list.
 *
 * Keeps only strings that name a real registry tool, drops the fixed Open id
 * (it is fixed, never part of the list), dedupes first-wins, preserves order
 * and caps at `HOME_TOOLS_MAX`. A non-array reads as `[]`.
 */
export function sanitizeHomeTools(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const value of raw) {
    if (typeof value !== 'string') continue;
    if (value === HOME_FIXED_TOOL_ID) continue;
    if (toolById(value) === undefined) continue;
    if (out.includes(value)) continue;
    if (out.length >= HOME_TOOLS_MAX) break;
    out.push(value);
  }
  return out;
}

/**
 * Append `id` to the row. Refuses unknown ids, the fixed Open id and ids
 * already present; refuses at the cap. Every refusal returns the list
 * unchanged (never a silent partial write).
 */
export function addHomeTool(list: readonly string[], id: string): string[] {
  const current = sanitizeHomeTools(list);
  if (id === HOME_FIXED_TOOL_ID) return current;
  if (toolById(id) === undefined) return current;
  if (current.includes(id)) return current;
  if (current.length >= HOME_TOOLS_MAX) return current;
  return [...current, id];
}

/**
 * Drop `id` from the row. A no-op when it is absent; removing the fixed Open
 * id is always a no-op (it is not part of the list).
 */
export function removeHomeTool(list: readonly string[], id: string): string[] {
  const current = sanitizeHomeTools(list);
  if (id === HOME_FIXED_TOOL_ID) return current;
  if (!current.includes(id)) return current;
  return current.filter((entry) => entry !== id);
}
