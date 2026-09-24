// DEF-337 — whether a single-row scroll container genuinely overflows.
//
// The responsive ladder's last rung offers left/right arrows to scroll a single
// tool row. Rendering the arrows whenever the rung is engaged is wrong: at
// widths where the row already fits (an icon-only dock, or the annotation
// flyout's always-fitting body) the arrows are dead - a clickable control that
// does nothing. The arrows must be gated on a real measurement, re-evaluated on
// resize.
//
// `enabled` is the ladder's arrows rung: until it is engaged there is no
// scroller and no overflow to measure.
//
// DEF-337 (reopened) — the measurement must not depend on the state it
// controls. The dock's scroll container used to collapse to `display: contents`
// whenever the arrows were hidden, so the hook's own "no overflow" verdict
// removed the box it had just measured: `clientWidth 0 -> overflow -> box ->
// fits -> no overflow -> no box -> clientWidth 0 ...`, a feedback loop whose
// settled state was timing-dependent (dead arrows at 640, flicker at 700). Two
// rules end it:
//
//   1. A container with NO box (clientWidth 0) is UNKNOWN, never "overflowing".
//      The state is kept until a real box is measured. When there is no
//      `ResizeObserver` at all (jsdom) no later measurement can ever arrive, so
//      the rung's controls mount rather than never existing.
//   2. Only a CHANGE in the measured box re-decides, so repeated observer
//      notifications cannot churn or oscillate the state.
//
// The CSS half keeps the dock's container a real box for the whole arrows lane
// (`data-dock-arrows-lane`), so a settled layout always supplies a real box;
// this hook guard is the belt-and-braces that makes the loop impossible even if
// a zero-width measurement is delivered first.
//
// `revision` re-runs the measurement when the row's CONTENTS change (labels
// appearing, verbs unpinned) without the container's own box changing, since a
// ResizeObserver only reports box-size changes.

import { useEffect, useState, type RefObject } from 'react';

export function useRowOverflow(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
  revision: unknown = null,
): boolean {
  const [overflows, setOverflows] = useState(false);

  useEffect((): (() => void) | undefined => {
    if (!enabled) {
      setOverflows(false);
      return undefined;
    }
    const el = ref.current;
    if (el === null) return undefined;
    // With no observer there is no later measurement to wait for (jsdom): a
    // rung that can never measure must still offer its controls.
    const canObserve = typeof ResizeObserver !== 'undefined';
    let lastClient = -1;
    let lastScroll = -1;
    const measure = (): void => {
      const client = el.clientWidth;
      const scroll = el.scrollWidth;
      if (client === 0) {
        // No box yet (`display: contents`, or a layout engine that never lays
        // out). Unknown, NOT overflowing - deciding here is the feedback loop.
        if (!canObserve) setOverflows(true);
        return;
      }
      if (client === lastClient && scroll === lastScroll) return;
      lastClient = client;
      lastScroll = scroll;
      setOverflows(scroll > client);
    };
    measure();
    if (!canObserve) return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return (): void => ro.disconnect();
  }, [ref, enabled, revision]);

  return enabled && overflows;
}
