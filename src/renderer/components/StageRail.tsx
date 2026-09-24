// Phase 36 (chunk 1b) — the Stage Rail.
//
// The 44px vertical rail at the window's leading edge: four stage buttons
// (icon + a small uppercase label), the active stage marked with the
// accent-soft wash plus a 2px accent indicator on the leading edge, and the
// settings gear pinned at the rail's bottom (the title-bar gear stays).
// `Ctrl+1..4` switch stages, and below a 1100px window width the rail
// collapses to icons only.
//
// This component owns NO app state: the active stage and the handlers come
// from the host (App), which is also where the per-pane Multi Mode routing
// lives. Every visual value is an existing theme or motion token — the rail
// introduces no palette of its own (the four per-theme `--tf-stage-*` tokens
// arrive with the stage-panel chunk).
//
// Placement note (chunk 1b): the rail is mounted by App inside `.app-main`
// as a fixed, left-edge overlay so it disturbs none of the surfaces the
// later chunks re-home. It claims no grid track and reflows nothing; the
// panels are re-parented around it in their own chunk.

import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { BadgeCheck, FileOutput, Files, Pencil, Settings } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  STAGE_LABELS,
  STAGE_ORDER,
  stageForCtrlDigit,
  stageShortcutLabel,
  type Stage,
} from '../state/stages';

/** The rail is icon-only at or below this viewport width. */
export const STAGE_RAIL_COMPACT_WIDTH = 1100;

/** True when the rail renders icon-only at `width`. */
export function isStageRailCompact(width: number): boolean {
  return width < STAGE_RAIL_COMPACT_WIDTH;
}

/** True when the event target is a text-entry control: the rail must never
 *  steal `Ctrl+1..4` from a focused input (the same guard the other global
 *  key handlers use). */
export function isStageRailEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return (
    target.closest('input, textarea, select, [contenteditable="true"], [role="textbox"]') !== null
  );
}

/** Phase 37 (item 8) — the Stage Rail is a DOCUMENT surface: absent on the
 *  welcome (home) screen, present once a real document is open. This is the
 *  exact complement of the welcome condition App already uses (`no tabs`, or
 *  only the empty placeholder tab with Multi Mode off), exported so App keys
 *  the rail and the welcome pane off ONE source and the unit tests can pin
 *  the truth table. */
export function isStageRailVisible(
  tabCount: number,
  activeIsEmpty: boolean,
  multiModeEnabled: boolean,
): boolean {
  const showWelcome = tabCount === 0 || (activeIsEmpty && !multiModeEnabled);
  return !showWelcome;
}

const STAGE_ICONS: Record<Stage, LucideIcon> = {
  pages: Files,
  edit: Pencil,
  review: BadgeCheck,
  deliver: FileOutput,
};

export interface StageRailProps {
  /** The stage currently in force for the host's focused scope. */
  activeStage: Stage;
  /** Switch stage. The host decides which scope (single / focused pane) the
   *  switch applies to. */
  onStageChange: (stage: Stage) => void;
  /** The rail's bottom gear — the same Preferences sheet the title-bar gear
   *  opens. */
  onOpenPreferences: () => void;
  /** Host-supplied viewport width. When omitted the rail measures the window
   *  itself and re-renders on resize. */
  windowWidth?: number;
}

export function StageRail(props: StageRailProps): ReactElement {
  const { activeStage, onStageChange, onOpenPreferences, windowWidth } = props;

  const [measuredWidth, setMeasuredWidth] = useState<number>(() =>
    typeof window === 'undefined' ? STAGE_RAIL_COMPACT_WIDTH : window.innerWidth,
  );

  useEffect((): (() => void) | undefined => {
    if (windowWidth !== undefined) return undefined;
    const onResize = (): void => setMeasuredWidth(window.innerWidth);
    onResize();
    window.addEventListener('resize', onResize);
    return (): void => window.removeEventListener('resize', onResize);
  }, [windowWidth]);

  // Phase 36 — the `Ctrl+1..4` binding. Only the exact chord switches stage,
  // so the pre-existing document shortcuts stay untouched; a focused text
  // control keeps its own typing.
  useEffect((): (() => void) => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isStageRailEditableTarget(event.target)) return;
      const stage = stageForCtrlDigit(event);
      if (stage === null) return;
      event.preventDefault();
      onStageChange(stage);
    };
    window.addEventListener('keydown', onKeyDown);
    return (): void => window.removeEventListener('keydown', onKeyDown);
  }, [onStageChange]);

  const width = windowWidth ?? measuredWidth;
  const compact = isStageRailCompact(width);

  return (
    <nav
      className={compact ? 'stage-rail stage-rail-compact' : 'stage-rail'}
      aria-label="Work stages"
      data-stage-rail
      data-stage-rail-compact={compact ? 'true' : 'false'}
      data-active-stage={activeStage}
    >
      <div className="stage-rail-buttons">
        {STAGE_ORDER.map((stage) => {
          const Icon = STAGE_ICONS[stage];
          const active = stage === activeStage;
          return (
            <button
              key={stage}
              type="button"
              className={active ? 'stage-rail-btn stage-rail-btn-active' : 'stage-rail-btn'}
              onClick={(): void => onStageChange(stage)}
              aria-pressed={active}
              aria-label={`${STAGE_LABELS[stage]} stage`}
              title={`${STAGE_LABELS[stage]} (${stageShortcutLabel(stage)})`}
              data-stage={stage}
            >
              <span className="stage-rail-icon" aria-hidden>
                <Icon size={18} />
              </span>
              <span className="stage-rail-label" aria-hidden>
                {STAGE_LABELS[stage]}
              </span>
            </button>
          );
        })}
      </div>
      <div className="stage-rail-foot">
        <button
          type="button"
          className="stage-rail-btn stage-rail-gear"
          onClick={onOpenPreferences}
          aria-haspopup="dialog"
          aria-label="Open preferences"
          title="Preferences (Ctrl+,)"
          data-stage-rail-gear
        >
          <span className="stage-rail-icon" aria-hidden>
            <Settings size={18} />
          </span>
          <span className="stage-rail-label" aria-hidden>
            Settings
          </span>
        </button>
      </div>
    </nav>
  );
}
