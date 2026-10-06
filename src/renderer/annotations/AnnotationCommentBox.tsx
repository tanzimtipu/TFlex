// Phase 28 — the annotation COMMENT BOX.
//
// Operator requirement: "Selecting the annotation element will only show
// this comment box." So this card is rendered by `AnnotationOverlay`
// whenever a committed annotation is SELECTED (not on hover, not on
// click-through), and it is the single place to read and write the
// thread. The small badge on the element itself (`data-ann-comment-icon`)
// is an indicator only.
//
// PLACEMENT: anchored to the selected annotation's rect and CLAMPED to
// the page view. Preferred position is just BELOW the selection action
// bar (Confirm | colour box | Delete), which itself sits 4px under the
// annotation — so the card never covers the annotation's own surface nor
// the bar. When the annotation is too close to the page bottom for a
// usable card below, the card is bottom-anchored just ABOVE the
// annotation's ring instead. Horizontally it is clamped to the page
// view's left/right edges. The placement math is a pure exported
// helper so it is unit-testable.

import { useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactElement } from 'react';
import { MessageSquare, Send } from 'lucide-react';
import { Icon } from '../icons/Icon';
import { Button } from '../components/Button';
import { annotationBounds, overlayRectToCss } from './geometry';
import { CONTROL_BAR_HEIGHT, placeControlNearAnchor } from '../components/controlPlacement';
import type { Annotation, PageRect } from './model';
import type { CommentEntry } from '../../shared/types';

/** Card width in CSS px (clamped against the page view). */
export const COMMENT_BOX_WIDTH = 288;
/** Minimum usable height below the action bar before the card flips
 *  above the annotation instead. */
export const COMMENT_BOX_MIN_BELOW = 160;
/** DEF-326 — the height the avoidance check assumes for the card (the
 *  empty-card height; a thread with entries can grow past it, but the
 *  rule only has to keep the un-selected annotations clear of the card's
 *  primary hit band). */
export const COMMENT_BOX_ESTIMATED_HEIGHT = 160;
/** Gap between the action bar's edge and the card. */
const ACTION_BAR_CLEARANCE = 8;
/** Gap between the card and the page view's edges. */
const EDGE_GAP = 8;

/** The selected-annotation action bar's assumed width in CSS px
 *  (Confirm + colour swatch + Cancel + Delete + gaps/padding). */
export const ANNOTATION_ACTION_BAR_WIDTH = 240;

/** A CSS-px box for the overlap test. */
export interface CssBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** True when two CSS boxes overlap (touching edges do not count). */
function boxesOverlap(a: CssBox, b: CssBox): boolean {
  return (
    a.left < b.left + b.width &&
    a.left + a.width > b.left &&
    a.top < b.top + b.height &&
    a.top + a.height > b.top
  );
}

/** DEF-366 - the action bar's ACTUAL page-view box for a selected
 *  annotation. This is the ONE shared placement step: the bar itself
 *  (`SelectedContentChrome`) and the comment card below both derive
 *  from this call, so the two can never disagree about which side of
 *  the annotation the bar sits on. Exported for unit tests. */
export function selectionActionBarBox(
  bounds: PageRect,
  cssScale: number,
  widthPt: number,
  heightPt: number,
): CssBox {
  const ring = overlayRectToCss(bounds, cssScale);
  const placed = placeControlNearAnchor({
    anchor: { left: ring.left, top: ring.top, bottom: ring.top + ring.height },
    size: { width: ANNOTATION_ACTION_BAR_WIDTH, height: CONTROL_BAR_HEIGHT },
    viewport: { width: widthPt * cssScale, height: heightPt * cssScale },
  });
  return {
    left: placed.left,
    top: placed.top,
    width: ANNOTATION_ACTION_BAR_WIDTH,
    height: CONTROL_BAR_HEIGHT,
  };
}

/** Pure placement math: where the comment card sits inside the page
 *  view for a given annotation. Exported for unit tests.
 *
 *  DEF-326 - `avoid` carries the OTHER committed annotations' page bounds.
 *  The card is first tried BELOW the selection (the Phase-28 home); when
 *  that box would cover another annotation's own hit surface (which would
 *  make that annotation unclickable behind the card, the reopened-note
 *  regression), the card flips ABOVE the selection instead. Only when
 *  neither band is clear does it fall back to the legacy below/above
 *  choice. The selected annotation itself is never in `avoid`.
 *
 *  DEF-366 - the card is measured against the action bar's ACTUAL box
 *  (`selectionActionBarBox`), not the pre-Phase-48 assumption that the
 *  bar always sits below the annotation. At the page's bottom edge the
 *  bar flips ABOVE the annotation; the card then goes ABOVE THE BAR, so
 *  the bar's Confirm / Cancel / Delete controls are never covered. The
 *  bar is the anchor the two placements share, so they cannot collide. */
export function commentBoxPlacement(
  bounds: PageRect,
  cssScale: number,
  widthPt: number,
  heightPt: number,
  avoid: readonly PageRect[] = [],
): CSSProperties {
  const pageW = widthPt * cssScale;
  const pageH = heightPt * cssScale;
  const ring = overlayRectToCss(bounds, cssScale);
  const bar = selectionActionBarBox(bounds, cssScale, widthPt, heightPt);
  // The bar flipped above the annotation when its top is above the
  // ring's top (at the bottom edge there is no room below).
  const barAbove = bar.top < ring.top;
  const left = Math.max(
    EDGE_GAP,
    Math.min(ring.left, Math.max(EDGE_GAP, pageW - COMMENT_BOX_WIDTH - EDGE_GAP)),
  );
  const avoidBoxes: CssBox[] = avoid.map((r) => {
    const box = overlayRectToCss(r, cssScale);
    return { left: box.left, top: box.top, width: box.width, height: box.height };
  });
  // The card's home is on the far side of the BAR (never between the
  // bar and the annotation). When the bar is below, that is below the
  // bar; when the bar flipped above, it is above the bar.
  const belowTop = bar.top + bar.height + ACTION_BAR_CLEARANCE;
  const roomBelow = pageH - belowTop >= COMMENT_BOX_MIN_BELOW;
  const belowBox: CssBox = {
    left,
    top: belowTop,
    width: COMMENT_BOX_WIDTH,
    height: COMMENT_BOX_ESTIMATED_HEIGHT,
  };
  const aboveCardBottom = barAbove ? bar.top - EDGE_GAP : ring.top - EDGE_GAP;
  const aboveBottom = Math.max(EDGE_GAP, pageH - aboveCardBottom);
  const aboveBox: CssBox = {
    left,
    top: aboveCardBottom - COMMENT_BOX_ESTIMATED_HEIGHT,
    width: COMMENT_BOX_WIDTH,
    height: COMMENT_BOX_ESTIMATED_HEIGHT,
  };
  const belowBlocked = avoidBoxes.some((box) => boxesOverlap(belowBox, box));
  const aboveBlocked = avoidBoxes.some((box) => boxesOverlap(aboveBox, box));

  // The bar flipped above (bottom edge): the card MUST stay on the
  // bar's far side so the bar's controls remain clickable - never
  // place it in the band between the bar and the annotation.
  if (barAbove) {
    return { left, bottom: aboveBottom, width: COMMENT_BOX_WIDTH };
  }
  if (roomBelow && !belowBlocked) {
    return { left, top: belowTop, width: COMMENT_BOX_WIDTH };
  }
  if (!aboveBlocked) {
    // Not enough room below, or the below band would cover another
    // annotation: bottom-anchor the card just above the ring.
    return { left, bottom: aboveBottom, width: COMMENT_BOX_WIDTH };
  }
  // Both bands collide: keep the legacy below/above room rule.
  return roomBelow
    ? { left, top: belowTop, width: COMMENT_BOX_WIDTH }
    : { left, bottom: aboveBottom, width: COMMENT_BOX_WIDTH };
}

/** Relative time for recent entries (under a week), absolute date
 *  otherwise. Deterministic given `now` so it is unit-testable. */
export function formatCommentTime(createdAt: number, now: number = Date.now()): string {
  if (!Number.isFinite(createdAt)) return '';
  const diff = now - createdAt;
  if (diff < 45_000) return 'just now';
  if (diff < 3_600_000) return `${Math.max(1, Math.round(diff / 60_000))}m ago`;
  if (diff < 86_400_000) return `${Math.max(1, Math.round(diff / 3_600_000))}h ago`;
  if (diff < 604_800_000) return `${Math.max(1, Math.round(diff / 86_400_000))}d ago`;
  const d = new Date(createdAt);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

export interface AnnotationCommentBoxProps {
  /** The selected annotation the card is anchored to. */
  ann: Annotation;
  /** The thread's entries, oldest first (empty when there is none yet). */
  entries: readonly CommentEntry[];
  /** Append a comment (first call) or a reply (later calls). */
  onAddComment: (text: string) => void;
  cssScale: number;
  widthPt: number;
  heightPt: number;
  /** DEF-326 — the other committed annotations on this page (their page
   *  bounds). Used only to keep the card OFF their hit surfaces so a
   *  neighbouring annotation (a reopened note, etc.) stays clickable
   *  while this one is selected. */
  avoid?: readonly PageRect[];
}

export default function AnnotationCommentBox(props: AnnotationCommentBoxProps): ReactElement {
  const { ann, entries, onAddComment, cssScale, widthPt, heightPt, avoid = [] } = props;
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const style = useMemo(
    () => commentBoxPlacement(annotationBounds(ann), cssScale, widthPt, heightPt, avoid),
    [ann, cssScale, widthPt, heightPt, avoid],
  );
  const canSubmit = draft.trim().length > 0;
  const submit = (): void => {
    if (!canSubmit) return;
    onAddComment(draft.trim());
    setDraft('');
    inputRef.current?.focus();
  };

  return (
    <div
      className="ann-comment-box"
      data-ann-comment-box={ann.id}
      style={style}
      role="dialog"
      aria-label="Annotation comments"
      // The card is a real hit surface inside the annotation layer: its
      // own presses must not reach the layer's pointerdown (which would
      // deselect the annotation the card belongs to). No
      // preventDefault — the textarea / button keep their native events.
      onPointerDown={(e): void => e.stopPropagation()}
      onClick={(e): void => e.stopPropagation()}
    >
      <div className="ann-comment-head">
          <Icon icon={MessageSquare} size="xs" />
        <span className="ann-comment-title">Comments</span>
        {entries.length > 0 && (
          <span className="ann-comment-count" data-comment-count>
            {entries.length}
          </span>
        )}
      </div>

      <div className="ann-comment-list" data-comment-list>
        {entries.length === 0 ? (
          <p className="ann-comment-empty" data-comment-empty>
            Add a comment
          </p>
        ) : (
          entries.map((entry, i) => (
            <div
              key={entry.id}
              className={
                i === 0 ? 'ann-comment-entry ann-comment-entry-original' : 'ann-comment-entry'
              }
              data-comment-entry
              data-comment-role={i === 0 ? 'original' : 'reply'}
            >
              <div className="ann-comment-meta">
                <span className="ann-comment-author">{entry.author}</span>
                <time className="ann-comment-time" dateTime={new Date(entry.createdAt).toISOString()}>
                  {formatCommentTime(entry.createdAt)}
                </time>
              </div>
              <p className="ann-comment-text">{entry.text}</p>
            </div>
          ))
        )}
      </div>

      <div className="ann-comment-form">
        <textarea
          ref={inputRef}
          className="ann-comment-input"
          data-comment-input
          rows={2}
          value={draft}
          placeholder={entries.length === 0 ? 'Write a comment' : 'Write a reply'}
          aria-label={entries.length === 0 ? 'Add a comment' : 'Add a reply'}
          onChange={(e): void => setDraft(e.target.value)}
          onKeyDown={(e): void => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <Button
          intent="primary"
          kind="action"
          density="compact"
          className="ann-comment-submit"
          data-comment-submit
          disabled={!canSubmit}
          title={entries.length === 0 ? 'Add comment' : 'Add reply'}
          aria-label={entries.length === 0 ? 'Add comment' : 'Add reply'}
          onClick={submit}
          icon={<Icon icon={Send} size="xs" />}
        >
          <span>{entries.length === 0 ? 'Comment' : 'Reply'}</span>
        </Button>
      </div>
    </div>
  );
}
