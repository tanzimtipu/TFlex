// Phase 40 (item 7) — the single-view page-layout control.
//
// A three-option segmented control at the canvas's TOP-RIGHT: one page (the
// default), two pages side by side, and four pages in two rows. The active
// option is visibly marked AND carries `aria-pressed`, and every option has a
// distinct accessible name describing the layout it selects. Glyphs come from
// the Quiet Precision registry (no emoji): `layoutOnePage` (a single portrait
// page), `layoutTwoPage` (two side-by-side columns), and `layoutFourPage` (a
// 2x2 grid). The three command IDs are distinct app-wide and cannot collide
// with the Multi Mode verb (`multi-mode`) or the annotation Rectangle tool.
//
// This component owns no state: the mode is a per-tab, session-scoped value in
// DocumentView (REQUIREMENTS.md Phase 40, Settings impact: none).

import type { ReactElement } from "react";
import { Icon } from "../icons/Icon";
import { PAGE_LAYOUT_MODES, type PageLayoutMode } from "./pageLayoutMode";

export interface PageLayoutControlProps {
  /** The layout in force for this tab. */
  value: PageLayoutMode;
  /** Select a layout. */
  onChange: (mode: PageLayoutMode) => void;
}

/** The per-option chrome: registry glyph + accessible name + tooltip. */
const OPTION_META: Record<
  PageLayoutMode,
  { label: string; title: string; icon: ReactElement }
> = {
  one: {
    label: "One page",
    title: "One page",
    icon: <Icon name="layoutOnePage" size="md" aria-hidden />,
  },
  two: {
    label: "Two pages side by side",
    title: "Two pages side by side",
    icon: <Icon name="layoutTwoPage" size="md" aria-hidden />,
  },
  four: {
    label: "Four pages in two rows",
    title: "Four pages in two rows",
    icon: <Icon name="layoutFourPage" size="md" aria-hidden />,
  },
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
        const { label, title, icon } = OPTION_META[mode];
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
            {icon}
          </button>
        );
      })}
    </div>
  );
}
