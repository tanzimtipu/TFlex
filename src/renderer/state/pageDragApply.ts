// Phase 32 (chunk 2d) — applying a resolved page drop.
//
// The orchestration both drag paths share: a same-document drop keeps the
// EXISTING reorder path; a cross-document drop is ONE engine call whose
// echoed states update BOTH documents, then BOTH pdf.js proxies refresh
// through the existing render-to-refresh hook, and the target pane reveals
// the inserted page. A failure surfaces the typed engine error and leaves
// both panes untouched.
//
// Kept dependency-injected and free of React so the sequence (one engine
// call, two refreshes, reveal on success / nothing on failure) is unit
// testable with the same seams App wires.

import type { MovePagesBetweenDocsOutcome } from "../engine/types";
import type { EngineError } from "../../shared/types";
import type { Result, ResultError } from "../../shared/result";
import { insertedStartPage, type PageDropOp } from "./pageDrag";

/** The engine surface this helper needs (a slice of EngineApi). */
export interface PageDropEngine {
  movePagesBetweenDocs(
    fromDocId: string,
    pages: number[],
    toDocId: string,
    atIndex: number,
    mode: "move" | "copy",
  ): Promise<Result<MovePagesBetweenDocsOutcome, EngineError>>;
}

export interface PageDropDeps {
  engine: PageDropEngine;
  /** The engine document id for a tab, or null when the tab is gone. */
  docIdFor: (tabId: string) => string | null;
  /** The existing intra-document reorder path (never the cross-document call). */
  onReorder: (tabId: string, fromIndex: number, toIndex: number) => void;
  /** Record the echoed post-op states (undo counters + engine mirrors). */
  onStates: (
    fromTabId: string,
    toTabId: string,
    from: MovePagesBetweenDocsOutcome["from"],
    to: MovePagesBetweenDocsOutcome["to"],
    mode: "move" | "copy",
  ) => void;
  /** The existing per-tab proxy refresh hook (render-to-refresh). */
  refresh: (tabId: string) => void;
  /** Navigate a pane to a page (the inserted page in the target). */
  reveal: (tabId: string, page: number) => void;
  /** The existing error-toast helper. */
  toast: (error: ResultError<EngineError>) => void;
}

/**
 * Apply one resolved drop.
 *
 * Same-document: delegates to `onReorder` and never calls the engine. A
 * same-document DROP through the cross-document path (sameDoc false but the
 * two ids equal) still reaches the engine and surfaces its typed
 * 'same-document' error - never a silent no-op.
 */
export async function applyPageDrop(op: PageDropOp, deps: PageDropDeps): Promise<void> {
  if (op.sameDoc) {
    deps.onReorder(op.fromTabId, op.pages[0], op.atIndex);
    return;
  }
  const fromDocId = deps.docIdFor(op.fromTabId);
  const toDocId = deps.docIdFor(op.toTabId);
  if (fromDocId === null || toDocId === null) return;

  const result = await deps.engine.movePagesBetweenDocs(
    fromDocId,
    op.pages,
    toDocId,
    op.atIndex,
    op.mode,
  );
  if (!result.ok) {
    // A same-document attempt through this path reaches the engine and its
    // typed 'same-document' error is surfaced — never a silent no-op.
    deps.toast(result.error);
    return;
  }
  deps.onStates(op.fromTabId, op.toTabId, result.value.from, result.value.to, op.mode);
  // BOTH documents changed in one round-trip (for a move) or the target did
  // (for a copy); refresh both proxies through the existing hook. The states
  // come back from the single call, so the panes never read stale bytes.
  deps.refresh(op.fromTabId);
  deps.refresh(op.toTabId);
  deps.reveal(op.toTabId, insertedStartPage(op, result.value.to.pageCount));
}
