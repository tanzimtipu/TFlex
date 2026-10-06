// Phase 34 (chunk 2) — the ONE composite tab Multi Mode shows.
//
// The operator's rule: while Multi Mode is on the tab strip must show ONE
// tab for the combined workspace, not one tab per open document. This is a
// PRESENTATION change over the existing two-session model — the tabs store,
// the engine sessions and the pane routing are untouched. App projects the
// pane documents into a single header entry through these pure helpers, and
// the composite close plan reuses the existing `collectModifiedTabIds`
// selection so the SAME per-document prompt walk covers both documents.

import { IDENTITY_PALETTE } from "./tabColour";

/** The synthetic id of the single workspace tab. It is not a tab-store id:
 *  nothing ever dispatches a tab action with it; the header close/activate
 *  handlers special-case it. */
export const COMPOSITE_TAB_ID = "tf-multi-workspace";

/** The label shown when Multi Mode is on but neither pane holds a document
 *  (both cleared): the workspace is still ONE tab, so the strip stays one
 *  entry rather than falling back to the hidden per-document tabs. */
export const COMPOSITE_EMPTY_LABEL = "Multi Mode";

/** Phase 105 (chunk B) — the composite workspace tab is not a real session, so
 *  it takes a fixed identity id (the first palette entry) rather than
 *  allocating one. This keeps the document rail painted in Multi Mode without
 *  ever consuming a real session's identity slot. */
export const COMPOSITE_TAB_COLOR_ID = IDENTITY_PALETTE[0];

/** One document the composite tab represents. */
export interface CompositeDocRef {
  id: string;
  title: string;
  modified: boolean;
}

/** The header tab shape AppHeader renders (`TabInput`). */
export interface CompositeHeaderTab {
  id: string;
  title: string;
  modified: boolean;
  /** Phase 105 (chunk B) — the composite workspace tab carries a fixed
   *  identity so the document rail still paints it while Multi Mode is on. */
  colorId: string;
}

/** The pane documents, left then right, resolved through `lookup`; an empty
 *  pane and an unknown tab id drop out. */
export function compositeDocRefs(
  paneA: string | null,
  paneB: string | null,
  lookup: (tabId: string) => CompositeDocRef | null,
): CompositeDocRef[] {
  const out: CompositeDocRef[] = [];
  for (const id of [paneA, paneB]) {
    if (id === null) continue;
    const doc = lookup(id);
    if (doc !== null) out.push(doc);
  }
  return out;
}

/** The single header entry: both names joined with " | " (the tab title's
 *  own ellipsis + tooltip handle the truncation), modified when EITHER
 *  document is modified. Never null — an empty workspace is still one tab. */
export function compositeHeaderTab(docs: readonly CompositeDocRef[]): CompositeHeaderTab {
  if (docs.length === 0) {
    return {
      id: COMPOSITE_TAB_ID,
      title: COMPOSITE_EMPTY_LABEL,
      modified: false,
      colorId: COMPOSITE_TAB_COLOR_ID,
    };
  }
  return {
    id: COMPOSITE_TAB_ID,
    title: docs.map((doc) => doc.title).join(" | "),
    modified: docs.some((doc) => doc.modified),
    colorId: COMPOSITE_TAB_COLOR_ID,
  };
}

/** Both pane document ids, left then right, skipping empty panes. */
export function compositeDocIds(
  paneA: string | null,
  paneB: string | null,
): string[] {
  const ids: string[] = [];
  if (paneA !== null) ids.push(paneA);
  if (paneB !== null) ids.push(paneB);
  return ids;
}

/** The composite tab's close plan. `ids` is BOTH documents (closed once the
 *  queue resolves); `promptIds` is the modified subset that must be walked
 *  through the existing per-document prompt, in pane order. Empty
 *  `promptIds` means the close can happen immediately. */
export interface CompositeClosePlan {
  ids: string[];
  promptIds: string[];
}

export function planCompositeClose(
  paneA: string | null,
  paneB: string | null,
  modifiedIds: readonly string[],
): CompositeClosePlan {
  const ids = compositeDocIds(paneA, paneB);
  return { ids, promptIds: ids.filter((id) => modifiedIds.includes(id)) };
}

/** Advance the composite close queue by one resolved document. `remaining`
 *  is the modified documents still to prompt; `next` is what is left after
 *  the current one resolved, and `done` is true when none remain — the
 *  caller then closes every document in the plan. `done` on an empty queue
 *  is true (nothing to prompt: close immediately). */
export function advanceCompositeQueue(remaining: readonly string[]): {
  next: string[];
  done: boolean;
} {
  const next = remaining.slice(1);
  return { next, done: next.length === 0 };
}