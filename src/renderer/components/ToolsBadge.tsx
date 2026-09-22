// Phase 33 / DEF-284 — the ONE floating "All Tools" affordance.
//
// The badge used to be inlined in `DocumentView`, so Multi Mode mounted one
// per pane (two identical badges stacked at the window's right edge; the
// covered one intercepted clicks meant for the pane below it). It is a
// workspace-chrome control, not a per-document control, so it now lives here
// and is rendered ONCE: by `DocumentView` in single mode (unchanged position
// and behaviour) and by `DocumentStage` in Multi Mode. The single element is
// `position: fixed`, so switching focus between panes cannot move it.
//
// Selector/aria contract kept verbatim (`data-tools-badge`,
// `data-tools-toggle`, aria-pressed, title, the ChevronLeft/Right glyph flip)
// so the existing e2e selectors and unit contracts keep resolving.

import type { ReactElement } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

export interface ToolsBadgeProps {
  /** The palette's open state — drives the slide token and the glyph. */
  open: boolean;
  /** Toggle the palette (App owns the state). */
  onToggle: () => void;
}

export function ToolsBadge({ open, onToggle }: ToolsBadgeProps): ReactElement {
  return (
    <button
      type="button"
      className={`tools-badge-tracker ${open ? "tools-badge-tracker-open" : ""}`}
      onClick={onToggle}
      aria-pressed={open}
      aria-label={open ? "Close tools palette" : "Open tools palette"}
      title={
        open
          ? "Close tools palette (Ctrl+Shift+P)"
          : "Open tools palette (Ctrl+Shift+P)"
      }
      data-tools-badge
      data-tools-toggle
    >
      <span className="tools-badge-chevron" aria-hidden="true">
        {open ? <ChevronRight size={12} aria-hidden /> : <ChevronLeft size={12} aria-hidden />}
      </span>
      <span className="tools-badge-label">All Tools</span>
    </button>
  );
}