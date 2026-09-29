// Phase 57 (feature A) — the 3D limitation notice.
//
// A NON-dismissible slim bar rendered above the page area while the active
// document carries 3D annotations (which the app cannot render). It names the
// page and object of every entry so the omission is explicit; it never covers
// the canvas and never hides the page. The object name comes from
// Pdf3dContent.name, the page from Pdf3dContent.page (1-based visible).

import type { ReactElement } from 'react';
import { Cuboid } from 'lucide-react';
import type { Pdf3dContent } from '../../shared/types';

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
  if (entries.length === 0) return null;
  return (
    <div className="pdf3d-notice" role="status" data-testid="pdf3d-notice">
      <Cuboid size={14} aria-hidden />
      <span className="pdf3d-notice-text">{pdf3dNoticeText(entries)}</span>
    </div>
  );
}
