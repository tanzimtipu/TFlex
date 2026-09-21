// Phase 32 (chunk 2b) — the ONE shared thumbnail rail for Multi Mode.
//
// In Multi Mode the workspace has a single rail holding one labelled
// section per loaded document (pane A's document first, then pane B's).
// Each section owns its own scroll container and its own ThumbnailRail
// instance, so the sections scroll independently and each keeps its own
// visible+buffered window — two 34-page documents never raster every
// thumbnail at once.
//
// The rail also owns the DYNAMIC thumbnail width: it measures its own
// available width, counts the loaded documents, and asks the pure
// `computeThumbWidth` for the size. With one document that is today's
// 126px; with two it is the smaller multi-section width. Only the width
// differs — the Thumb render/cleanup/virtualization rules are the same
// code path the single-mode rail uses.

import { useEffect, useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { computeThumbWidth } from "./thumbGeometry";
import type { PaneId } from "../state/multiMode";
import { usePageDragOptional } from "../state/PageDragContext";

/** The rail's own width — the same 220px column the single-mode rail
 *  occupies at rest (--tf-rail-w). It is the measurement fallback and the
 *  value used in jsdom, where clientWidth is always 0. */
export const SHARED_RAIL_WIDTH_PX = 220;

/** One loaded document's section. */
export interface MultiRailSection {
  pane: PaneId;
  tabId: string;
  title: string;
  pageCount: number;
}

/** What the section body renderer receives. */
export interface MultiRailSectionRender {
  pane: PaneId;
  /** Phase 32 (chunk 2d) — this section's document id, so the body can wire
   *  its own document-aware drag source / drop target. */
  tabId: string;
  /** The computed width for this rail (single mode's 126, or smaller). */
  thumbWidth: number;
  /** Focus this section's pane (the section header does this too). */
  onFocusPane: () => void;
  /** Focus this section's pane and navigate it to `page`. */
  onJump: (page: number) => void;
}

export interface MultiRailProps {
  /** One entry per LOADED document, in pane order (A then B). */
  sections: readonly MultiRailSection[];
  /** The focused pane; its section is the visually active one. */
  activePane: PaneId;
  /** A section header click (and every thumbnail click) focuses the pane. */
  onFocusPane: (pane: PaneId) => void;
  /** A thumbnail click: navigate `pane` to `page` (focus is already
   *  reported through `onFocusPane`). */
  onJump: (pane: PaneId, page: number) => void;
  /** The section body — App builds the real `ThumbnailRail` here. */
  renderSection: (args: MultiRailSectionRender) => ReactNode;
}

export function MultiRail(props: MultiRailProps): ReactElement | null {
  const { sections, activePane, onFocusPane, onJump, renderSection } = props;
  const railRef = useRef<HTMLDivElement | null>(null);
  const [railWidth, setRailWidth] = useState(SHARED_RAIL_WIDTH_PX);
  // Phase 32 (chunk 2d) — the section a cross-document drag is hovering is
  // highlighted (the landing pane's section), matching the per-thumb slot
  // affordance. Read-only here; the bodies own the drag state.
  const drag = usePageDragOptional();
  const dropTargetDoc =
    drag !== null && drag.target !== null && drag.source !== null && drag.source.tabId !== drag.target.tabId
      ? drag.target.tabId
      : null;

  useEffect(() => {
    const el = railRef.current;
    if (el === null) return;
    const read = (): void => {
      const width = el.clientWidth;
      // jsdom (and a not-yet-laid-out rail) reports 0: keep the fallback
      // rather than collapsing every thumb to the minimum width.
      if (width > 0) setRailWidth((prev) => (prev === width ? prev : width));
    };
    read();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  if (sections.length === 0) return null;
  const thumbWidth = computeThumbWidth(railWidth, sections.length);

  return (
    <div className="multi-rail" data-multi-rail ref={railRef}>
      {sections.map((section) => {
        const active = section.pane === activePane;
        return (
          <section
            key={section.tabId}
            className="multi-rail-section"
            data-rail-section
            data-rail-section-doc={section.tabId}
            data-rail-section-pane={section.pane}
            data-rail-section-active={active ? "true" : "false"}
            data-rail-section-drop-target={
              dropTargetDoc === section.tabId ? "true" : undefined
            }
          >
            <button
              type="button"
              className="multi-rail-section-header"
              data-rail-section-header
              onClick={(): void => onFocusPane(section.pane)}
              aria-label={`Focus pane ${section.pane}: ${section.title}`}
              title={`Show ${section.title} in pane ${section.pane}`}
            >
              <span className="multi-pane-badge multi-rail-badge" aria-hidden>
                {section.pane}
              </span>
              <span className="multi-rail-section-title" title={section.title}>
                {section.title}
              </span>
              <span className="multi-rail-section-count">
                {section.pageCount} {section.pageCount === 1 ? "page" : "pages"}
              </span>
            </button>
            <div className="multi-rail-section-body" data-rail-section-body>
              {renderSection({
                pane: section.pane,
                tabId: section.tabId,
                thumbWidth,
                onFocusPane: (): void => onFocusPane(section.pane),
                onJump: (page: number): void => {
                  onFocusPane(section.pane);
                  onJump(section.pane, page);
                },
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
