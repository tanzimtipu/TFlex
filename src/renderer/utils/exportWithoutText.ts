// Phase 55 / DEF-390 — the text-free page list shared by every export surface.
//
// Criterion 8 requires an export of a document with an empty or image-only
// page to NAME the pages that carried no extractable content. The `.xlsx` and
// `.pptx` writers already report `pagesWithoutText` in their build result; the
// `.txt` and `.docx` surfaces derive the same list from the engine's existing
// `exportText(docId)` channel (the same source the text export already reads),
// so no new IPC is needed.
//
// The engine client's methods read `this.inner`, so `exportText` is always
// invoked as a MEMBER of the client object, never extracted into a local
// (DEF-106 / DEF-374 — that bug has been filed three times; not a fourth).

import type { Result } from "../../shared/result";
import type { EngineError, TextPage } from "../../shared/types";

/**
 * The one engine member the txt/docx surfaces read for the text-free page
 * list. Structural (not the full engine surface) so a dialog can be unit
 * tested with a small mock and the host can pass the real engine client.
 * `exportText` is optional to mirror the engine's optional Phase-9 channels.
 */
export interface TextFreePagesEngine {
  exportText?(docId: string): Promise<Result<TextPage[], EngineError>>;
}

/** 1-based page numbers whose extracted text is empty or whitespace-only,
 *  sorted ascending. The definition of "no extractable text" every export
 *  surface uses. */
export function textFreePageNumbers(pages: readonly TextPage[]): number[] {
  return pages
    .filter((p) => p.text.trim().length === 0)
    .map((p) => p.pageIndex)
    .sort((a, b) => a - b);
}

/**
 * Fetch the active document's text-free page numbers, or null when the list
 * cannot be produced. Null is a first-class result: a missing channel, a typed
 * engine failure or a thrown rejection all mean "no notice", never a broken
 * export (the export itself does not depend on this read). The call is a
 * MEMBER call on `engine` so `this` (and `this.inner`) survives.
 */
export async function fetchTextFreePageNumbers(
  engine: TextFreePagesEngine,
  docId: string,
): Promise<number[] | null> {
  if (engine.exportText === undefined) return null;
  try {
    const result = await engine.exportText(docId);
    if (!result.ok) return null;
    return textFreePageNumbers(result.value);
  } catch {
    return null;
  }
}

/** The wording shape every export surface shares. Kept in one place so qa's
 *  `[data-export-pages-without-text]` assertion cannot drift between surfaces. */
export function pagesWithoutTextMessage(pages: readonly number[]): string {
  return `Page${pages.length === 1 ? "" : "s"} with no extractable text: ${pages.join(", ")}. They were exported as page images.`;
}
