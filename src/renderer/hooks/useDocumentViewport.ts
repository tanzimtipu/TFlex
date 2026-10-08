// Phase 119 (chunk B) — the ONE document-viewport measurement primitive.
//
// Adaptive Shell consumers (chunk C onward) need the real width of the
// `.workspace-main` scroller host, not the window width: the shell's columns
// and rails take the chrome out of the window, so the class must be resolved
// from the element the consumer passes. The hook measures that element with a
// ResizeObserver (mirroring the ActionDock measurement idiom) and re-measures
// on mount, on box resize and cleanly disconnects on unmount. Where no
// ResizeObserver exists (jsdom), the mount measurement is the single reading.

import { useEffect, useMemo, useState, type RefObject } from 'react';
import { classifyViewport, isCoarsePointer, type LayoutClass } from '../design/layout';

export interface DocumentViewport {
  /** Measured logical CSS width of the host element, 0 before first measure. */
  width: number;
  layoutClass: LayoutClass;
  /** True at `narrow` or below. */
  compact: boolean;
  /** True at `tight` or below. */
  tight: boolean;
  coarsePointer: boolean;
}

export function useDocumentViewport(ref: RefObject<HTMLElement | null>): DocumentViewport {
  const [width, setWidth] = useState(0);
  const coarsePointer = useMemo(() => isCoarsePointer(), []);

  useEffect((): (() => void) | undefined => {
    const el = ref.current;
    if (el === null) return undefined;
    const measure = (): void => {
      const measured = el.getBoundingClientRect().width;
      if (measured > 0) setWidth(measured);
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return (): void => ro.disconnect();
  }, [ref]);

  const layoutClass = classifyViewport(width);
  return {
    width,
    layoutClass,
    compact: layoutClass !== 'wide',
    tight: layoutClass === 'tight',
    coarsePointer,
  };
}
