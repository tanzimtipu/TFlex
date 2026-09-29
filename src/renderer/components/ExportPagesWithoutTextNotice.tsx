// Phase 55 (feature D) / DEF-390 — the one text-free-page notice.
//
// Every export surface (txt, docx, xlsx, pptx) renders this block when the
// produced file has pages with no extractable text, so all four satisfy
// criterion 8 identically. The attribute and the wording shape are owned here
// and nowhere else, so qa's `[data-export-pages-without-text]` assertion and
// the copy cannot drift between surfaces.
//
// Docx honesty: the writer embeds an inline page image for EVERY text-free
// page (`_createDocxFromDocImpl` falls back to `{kind:'image'}` whenever the
// extracted text is empty, regardless of whether the page was a scan or fully
// blank), so the two cases do not differ in the file and the single
// image-fallback wording is accurate for both. A page with no raster entry is
// omitted rather than imaged, but the dialog always supplies one per selected
// page, so that case is unreachable from these surfaces.

import type { ReactElement } from "react";
import { pagesWithoutTextMessage } from "../utils/exportWithoutText";

export interface ExportPagesWithoutTextNoticeProps {
  /** 1-based text-free page numbers, or null while the list is unknown. */
  pages: number[] | null;
}

/** Renders the notice, or nothing when the list is unknown or empty. */
export function ExportPagesWithoutTextNotice(
  props: ExportPagesWithoutTextNoticeProps,
): ReactElement | null {
  const { pages } = props;
  if (pages === null || pages.length === 0) return null;
  return (
    <div
      className="modal-status export-progress"
      data-export-pages-without-text
      role="status"
    >
      <span>{pagesWithoutTextMessage(pages)}</span>
    </div>
  );
}
