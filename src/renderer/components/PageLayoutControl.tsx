// Phase 40 (item 7) — the single-view page-layout control.
//
// A three-option segmented control at the canvas's TOP-RIGHT: one page (the
// default), two pages side by side, and four pages in two rows. The active
// option is visibly marked AND carries `aria-pressed`, and every option has a
// distinct accessible name describing the layout it selects. Icons come from
// the project's Lucide set (no emoji): a single portrait page (one page), two
// side-by-side columns (two pages), and a 2x2 grid (four pages in two rows).
// Phase 43 (item 2) — each glyph is DISTINCT app-wide: `RectangleVertical`
// (one) and `Columns2` (two) do not collide with the Multi Mode toggle
// (`PanelsLeftRight`, header/toolbar/registry) or the annotation Rectangle
// tool (`Square`, registry).
//
// This component owns no state: the mode is a per-tab, session-scoped value in
// DocumentView (REQUIREMENTS.md Phase 40, Settings impact: none).

import { Columns2, Grid2x2, RectangleVertical } from "lucide-react";
import type { ReactElement } from "react";
import { Icon } from "../icons/Icon";
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
  { label: string; title: string; Icon: typeof Columns2 }
> = {
  one: { label: "One page", title: "One page", Icon: RectangleVertical },
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
        const { label, title, Icon: glyph } = OPTION_META[mode];
        const active = mode === value;
        return (
          <button
            key={mode}
            type="button"
            className={active ? "btn btn-toolbar btn-toggle tool-btn tool-btn-active" : "btn btn-toolbar btn-toggle tool-btn"}
            data-page-layout-option={mode}
            aria-pressed={active}
            aria-label={label}
            title={title}
            onClick={(): void => onChange(mode)}
          >
            <Icon icon={glyph} size="md" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}
