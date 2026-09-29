// Phase 55 (feature D) — the ONE mandatory fidelity-warning block.
//
// Every export surface (txt, docx, xlsx, pptx) renders this block. The strings
// come straight from `EXPORT_FIDELITY_NOTES` in the shared contract — they are
// NOT retyped here, so the warning the user reads can never drift from the
// writers' own declared limits.
//
// The block is deliberately a WARNING, not decoration: it carries the same
// visual weight as the app's other informational notices (muted panel, border,
// small text) and a warning glyph. qa asserts the copy verbatim through the
// stable `data-export-fidelity-notes` / `data-export-fidelity-note` hooks.

import type { ReactElement } from "react";
import { TriangleAlert } from "lucide-react";
import { EXPORT_FIDELITY_NOTES, type ExportFormat } from "../../shared/export";

export interface ExportFidelityNotesProps {
  format: ExportFormat;
  /** Optional extra class for a host that wants spacing around the block. */
  className?: string;
}

/** Render EVERY fidelity statement for `format`, never just the first. */
export function ExportFidelityNotes(
  props: ExportFidelityNotesProps,
): ReactElement {
  const { format, className } = props;
  const notes = EXPORT_FIDELITY_NOTES[format];
  return (
    <section
      className={className === undefined ? "export-fidelity" : `export-fidelity ${className}`}
      data-export-fidelity-notes={format}
      aria-label="Export fidelity limits"
    >
      <div className="export-fidelity-head">
        <TriangleAlert size={14} aria-hidden />
        <span>Fidelity limits</span>
      </div>
      <ul className="export-fidelity-list">
        {notes.map((note) => (
          <li key={note} data-export-fidelity-note>
            {note}
          </li>
        ))}
      </ul>
    </section>
  );
}
