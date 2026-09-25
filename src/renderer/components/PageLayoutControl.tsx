// Phase 40 (item 7) — the single-view page-layout control.
//
// A three-option segmented control at the canvas's TOP-RIGHT: one page (the
// default), two pages side by side, and four pages in two rows. The active
// option is visibly marked AND carries `aria-pressed`, and every option has a
// distinct accessible name describing the layout it selects. Icons come from
// the project's Lucide set (no emoji): a single square (one page), two side-by-
// side columns (two pages), and a 2x2 grid (four pages in two rows).
//
// This component owns no state: the mode is a per-tab, session-scoped value in
// DocumentView (REQUIREMENTS.md Phase 40, Settings impact: none).

import { Columns2, Grid2x2, Square } from "lucide-react";
import type { ReactElement } from "react";
import { PAGE_LAYOUT_MODES, type PageLayoutMode } from "./pageLayoutMode";

export interface PageLayoutControlProps {
  /** The layout in force for this tab. */
  value: PageLayoutMode;
  /** Select a layout. */
  onChange: (mode: PageLayoutMode) => void;
}

/** The per-option chrome: icon + accessible name + tooltip. */
const OPTION_META: Record<
  PageLayoutMode,
  { label: string; title: string; Icon: typeof Square }
> = {
  one: { label: "One page", title: "One page", Icon: Square },
  two: { label: "Two pages side by side", title: "Two pages side by side", Icon: Columns2 },
  four: { label: "Four pages in two rows", title: "Four pages in two rows", Icon: Grid2x2 },
};

export function PageLayoutControl(props: PageLayoutControlProps): ReactElement {
  const { value, onChange } = props;
  return (
    <div
      className="canvas-page-layout"
      data-page-layout-control
      data-page-layout-active={value}
      role="group"
      aria-label="Page layout"
    >
      {PAGE_LAYOUT_MODES.map((mode) => {
        const { label, title, Icon } = OPTION_META[mode];
        const active = mode === value;
        return (
          <button
            key={mode}
            type="button"
            className={active ? "tool-btn tool-btn-active" : "tool-btn"}
            data-page-layout-option={mode}
            aria-pressed={active}
            aria-label={label}
            title={title}
            onClick={(): void => onChange(mode)}
          >
            <Icon size={18} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
