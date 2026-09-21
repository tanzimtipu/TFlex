// Phase 32 (chunk 2d) — the shared cross-document drag state.
//
// A drag can start in one rail section or one canvas pane and land in
// another, so the source and the drop target cannot live inside a single
// component. This context is the ONE place both paths read and write the
// document-aware drag state:
//
//   source = { fromTabId, pages, anchorPage }
//   target = { toTabId, atIndex }            (-1 = append)
//
// The provider wraps the workspace in App. Single mode never begins a drag
// through it (its rail keeps the pre-Phase-32 local state), so its presence
// alone changes nothing. The hook is optional-safe so components that may be
// mounted outside the provider (unit tests, the single-mode rail) degrade to
// null instead of throwing.

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import type { PageDragSource, PageDropTarget } from "./pageDrag";

export interface PageDragApi {
  /** The active drag's origin, or null when nothing is being dragged. */
  source: PageDragSource | null;
  /** The current hovered drop slot, or null when the pointer is outside a
   *  valid target. */
  target: PageDropTarget | null;
  /** Start a drag from `source`. */
  begin: (source: PageDragSource) => void;
  /** Report the hovered drop slot (null clears it). Reference-stable: a
   *  repeat of the same slot does not re-render. */
  hover: (target: PageDropTarget | null) => void;
  /** End the drag and clear both halves. */
  end: () => void;
}

const PageDragContext = createContext<PageDragApi | null>(null);

export function PageDragProvider({ children }: { children: ReactNode }): ReactElement {
  const [source, setSource] = useState<PageDragSource | null>(null);
  const [target, setTarget] = useState<PageDropTarget | null>(null);

  const begin = useCallback((next: PageDragSource): void => {
    setSource(next);
    setTarget(null);
  }, []);

  const hover = useCallback((next: PageDropTarget | null): void => {
    setTarget((prev) => {
      if (prev === null && next === null) return prev;
      if (
        prev !== null &&
        next !== null &&
        prev.tabId === next.tabId &&
        prev.atIndex === next.atIndex &&
        prev.mode === next.mode
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  const end = useCallback((): void => {
    setSource(null);
    setTarget(null);
  }, []);

  const api = useMemo<PageDragApi>(
    () => ({ source, target, begin, hover, end }),
    [source, target, begin, hover, end],
  );

  return <PageDragContext.Provider value={api}>{children}</PageDragContext.Provider>;
}

/** The drag API, or null when no provider is mounted (optional-safe). */
export function usePageDragOptional(): PageDragApi | null {
  return useContext(PageDragContext);
}

/** The drag API; throws when no provider is mounted (components that always
 *  render inside the workspace provider). */
export function usePageDrag(): PageDragApi {
  const api = useContext(PageDragContext);
  if (api === null) {
    throw new Error("usePageDrag requires a PageDragProvider");
  }
  return api;
}
