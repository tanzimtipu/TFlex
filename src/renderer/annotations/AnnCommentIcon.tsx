// Phase 28 — the annotation COMMENT BADGE.
//
// Operator requirement: "put a small icon on the annotation element to
// let user know that there are comment for this element. If not comment,
// no icon should be there." So this badge is rendered ONLY for an
// annotation that has a thread, anchored to the annotation's top-right
// corner (Adobe-style marker).
//
// ICON BEHAVIOUR (Phase 28 spec): "the icon is an indicator only ... it
// must not intercept the annotation's own selection gestures." The badge
// therefore sets `pointer-events: none` (CSS, and inline for safety), so
// every press on the element — including one that lands exactly on the
// badge — falls through to the annotation's own surface and selects /
// drags it as usual. It carries no click handler by design.

import type { CSSProperties, ReactElement } from 'react';
import { MessageSquare } from 'lucide-react';
import { annotationBounds, overlayRectToCss } from './geometry';
import type { Annotation } from './model';

export interface AnnCommentIconProps {
  /** The annotated element the badge marks. */
  ann: Annotation;
  cssScale: number;
  /** Number of entries in the thread (shown when > 1). */
  count: number;
}

/** Badge box size in CSS px (matches the annotation note marker scale). */
const BADGE_PX = 16;

export default function AnnCommentIcon(props: AnnCommentIconProps): ReactElement {
  const { ann, cssScale, count } = props;
  const ring = overlayRectToCss(annotationBounds(ann), cssScale);
  const style: CSSProperties = {
    left: Math.max(0, ring.left + ring.width - BADGE_PX + 2),
    top: Math.max(0, ring.top - 6),
    // Inline as well as the stylesheet rule: a future cascade change
    // must not turn the indicator into a gesture blocker.
    pointerEvents: 'none',
  };
  return (
    <span
      className="ann-comment-icon"
      data-ann-comment-icon={ann.id}
      style={style}
      aria-hidden
    >
      <MessageSquare size={10} aria-hidden />
      {count > 1 && <span className="ann-comment-icon-count">{count}</span>}
    </span>
  );
}
