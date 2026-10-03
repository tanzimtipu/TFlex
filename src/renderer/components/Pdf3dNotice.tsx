// Phase 57 (feature A) — the 3D limitation notice.
//
// A slim bar rendered above the page area while the active document carries 3D
// annotations (which the app cannot render). It names the page and object of
// every entry so the omission is explicit; it never covers the canvas and never
// hides the page. The object name comes from Pdf3dContent.name, the page from
// Pdf3dContent.page (1-based visible).
//
// Phase 67 (feature C) — the bar adopts the Phase 59 protection behaviour: it
// is a ROUNDED, ANIMATED box that auto-collapses after a short reading pause
// into a floating "i" (info) icon pinned at the canvas's top-left (its own
// fixed horizontal slot), and can be re-expanded / collapsed by the user, the
// dwell resetting on every expand. The bar stays non-dismissible: the collapsed
// icon is always available, so the omission is never hidden.

import type { ReactElement } from 'react';
import { ChevronUp, Cuboid, Info } from 'lucide-react';
import { Icon } from '../icons/Icon';
import type { Pdf3dContent } from '../../shared/types';
import { useNoticeCollapse } from '../hooks/useNoticeCollapse';

export interface Pdf3dNoticeProps {
  entries: readonly Pdf3dContent[];
}

/** One sentence per entry, e.g. `Page 2 contains 3D content ("Turbine")
 *  that cannot be rendered. The rest of the page is shown.` */
export function pdf3dNoticeText(entries: readonly Pdf3dContent[]): string {
  return entries
    .map(
      (entry) =>
        `Page ${entry.page} contains 3D content ("${entry.name}") that cannot be rendered. ` +
        'The rest of the page is shown.',
    )
    .join(' ');
}

export function Pdf3dNotice(props: Pdf3dNoticeProps): ReactElement | null {
  const { entries } = props;
  const { phase, collapse, expand } = useNoticeCollapse();
  if (entries.length === 0) return null;

  // Phase 78 (DEF-465) — `entering` is the icon-first frame: it renders the
  // collapsed "i" exactly like `collapsed`, then the hook commits `expanded`.
  if (phase === 'collapsed' || phase === 'entering') {
    return (
      <div className="pdf3d-notice-region" data-pdf3d-notice-state={phase}>
        <button
          type="button"
          className="pdf3d-notice-collapsed-toggle"
          onClick={expand}
          aria-label="Show 3D content notice"
          data-pdf3d-icon
        >
          <Icon icon={Info} size="sm" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={
        phase === 'closing' ? 'pdf3d-notice pdf3d-notice--leaving' : 'pdf3d-notice'
      }
      role="status"
      data-testid="pdf3d-notice"
      data-pdf3d-notice
      data-pdf3d-notice-state={phase}
    >
      <Icon icon={Cuboid} size="xs" />
      <span className="pdf3d-notice-text">{pdf3dNoticeText(entries)}</span>
      <button
        type="button"
        className="pdf3d-notice-collapse"
        onClick={collapse}
        aria-label="Collapse 3D content notice"
        data-pdf3d-collapse
      >
        <Icon icon={ChevronUp} size="xs" />
      </button>
    </div>
  );
}
