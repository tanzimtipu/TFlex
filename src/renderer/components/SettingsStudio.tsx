// Phase 114 (TFL-1234, chunk B) — the Settings Studio primitives.
//
// Framework-native building blocks for the Phase 114 Settings Studio surface.
// Geometry comes from the category handoff
// ("Visual overhaul/Preferences and Themes/Specifications/design-decisions.md"):
// 720-880 logical px preferred width, 160-180 px section navigator, 24 px body
// padding, 20 px group gaps, 9 px control radius, 36-40 px row height with
// 44 px coarse targets and the 4 px spacing grid.
//
// These primitives are ADDITIVE: chunk B introduces them without migrating the
// shipped `PreferencesDialog`. Chunks C/D/E migrate the four real categories
// (General / Documents / Import & conversion / Storage) onto them. They own
// layout and accessibility wiring only — no store, no second preferences
// reducer, and no per-call-site visual override: every rule lives in the
// `.settings-*` section of src/renderer/styles.css and every colour is a shared
// light/dark semantic token.
//
// Reuse, never fork: navigator items are the shared `Button` (Phase 91/113),
// glyphs render through `Icon` (Phase 94), and the optional height tween is the
// shared `TfResize` (Phase 20/71). `DialogShell` (surface="sheet") hosts the
// whole surface at the call site.

import type {
  KeyboardEvent as ReactKeyboardEvent,
  ReactElement,
  ReactNode,
} from "react";
import { useRef } from "react";
import type { LucideIcon } from "lucide-react";
import { Icon } from "../icons/Icon";
import { Button } from "./Button";
import { TfResize, type ResizeAxes } from "./motion/TfResize";

/** One entry in the section navigator. */
export interface SettingsSectionDef {
  id: string;
  label: string;
  /** Optional leading glyph; rendered through the shared `Icon` wrapper. */
  icon?: LucideIcon;
  /** Optional explicit nav-item id; defaults to `settingsNavId(id)`. */
  navId?: string;
  /** Optional explicit panel id for `aria-controls`; defaults to `settingsPanelId(id)`. */
  panelId?: string;
  /** Extra legacy `data-*` hooks to keep on the nav button while a migrated
   *  surface still owes them (e.g. `data-prefs-category`). Spread last, so an
   *  explicit hook can override the generic one. */
  navDataAttrs?: Record<`data-${string}`, string>;
}

/** Stable id helpers so the navigator button and its panel always wire. */
export function settingsNavId(id: string): string {
  return `settings-nav-${id}`;
}

export function settingsPanelId(id: string): string {
  return `settings-panel-${id}`;
}

const ARROW_PREV: ReadonlySet<string> = new Set(["ArrowUp", "ArrowLeft"]);
const ARROW_NEXT: ReadonlySet<string> = new Set(["ArrowDown", "ArrowRight"]);

/** The section navigator. A vertical `role="tablist"` by default; arrow keys,
 *  Home and End move the selection with a roving tabindex (only the active
 *  section is tabbable), matching the shipped Preferences rail. */
export interface SettingsNavProps {
  sections: readonly SettingsSectionDef[];
  activeId: string;
  onSelect: (id: string) => void;
  /** Accessible name for the tablist. */
  ariaLabel?: string;
  /** The rendered axis, for `aria-orientation`. Default "vertical". */
  orientation?: "vertical" | "horizontal";
  className?: string;
}

export function SettingsNav(props: SettingsNavProps): ReactElement {
  const {
    sections,
    activeId,
    onSelect,
    ariaLabel = "Settings sections",
    orientation = "vertical",
    className,
  } = props;
  const itemRefs = useRef<Map<string, HTMLButtonElement | null>>(new Map());

  const move = (key: string): void => {
    const ids = sections.map((s): string => s.id);
    if (ids.length === 0) return;
    const at = ids.indexOf(activeId);
    let nextIndex: number | null = null;
    if (ARROW_NEXT.has(key)) nextIndex = (at + 1) % ids.length;
    else if (ARROW_PREV.has(key)) nextIndex = (at - 1 + ids.length) % ids.length;
    else if (key === "Home") nextIndex = 0;
    else if (key === "End") nextIndex = ids.length - 1;
    if (nextIndex === null) return;
    const nextId = ids[nextIndex];
    if (nextId === undefined) return;
    onSelect(nextId);
    itemRefs.current.get(nextId)?.focus();
  };

  const handleKeyDown = (e: ReactKeyboardEvent<HTMLElement>): void => {
    const handled =
      ARROW_NEXT.has(e.key) ||
      ARROW_PREV.has(e.key) ||
      e.key === "Home" ||
      e.key === "End";
    if (!handled) return;
    e.preventDefault();
    move(e.key);
  };

  return (
    <nav
      className={
        className === undefined
          ? "settings-studio-nav"
          : `settings-studio-nav ${className}`
      }
      role="tablist"
      aria-orientation={orientation}
      aria-label={ariaLabel}
      data-settings-nav
      onKeyDown={handleKeyDown}
    >
      {sections.map((section) => {
        const isActive = section.id === activeId;
        const SectionIcon = section.icon;
        return (
          <Button
            key={section.id}
            type="button"
            role="tab"
            id={section.navId ?? settingsNavId(section.id)}
            intent="secondary"
            kind="exclusive-selection"
            density="compact"
            className="settings-nav-item"
            aria-selected={isActive}
            aria-controls={section.panelId ?? settingsPanelId(section.id)}
            tabIndex={isActive ? 0 : -1}
            data-settings-nav-item={section.id}
            ref={(el): void => {
              itemRefs.current.set(section.id, el);
            }}
            onClick={(): void => onSelect(section.id)}
            {...section.navDataAttrs}
          >
            {SectionIcon !== undefined && (
              <Icon className="settings-nav-icon" icon={SectionIcon} size="sm" />
            )}
            <span className="settings-nav-label">{section.label}</span>
          </Button>
        );
      })}
    </nav>
  );
}

/** One line of supporting text: the concise explanation under a setting label
 *  (used inside `SettingsRow`) or under a group title (used by
 *  `SettingsSection`). Standalone export so a call site can place it directly. */
export interface SettingsSupportProps {
  children: ReactNode;
  className?: string;
}

export function SettingsSupport(props: SettingsSupportProps): ReactElement {
  const { children, className } = props;
  return (
    <p
      className={
        className === undefined ? "settings-support" : `settings-support ${className}`
      }
    >
      {children}
    </p>
  );
}

/** A settings GROUP: an optional title and description over a stack of
 *  `SettingsRow`s. The group is labelled by its own title so assistive
 *  technology announces the grouping; it is NOT a boxed card. */
export interface SettingsSectionProps {
  title?: ReactNode;
  description?: ReactNode;
  /** Optional data hook for tests, e.g. "appearance". */
  id?: string;
  /** Extra legacy `data-*` hooks to keep on the group section while a migrated
   *  surface still owes them (e.g. `data-prefs-default-pdf-section`). */
  dataAttrs?: Record<`data-${string}`, string>;
  className?: string;
  children: ReactNode;
}

export function SettingsSection(props: SettingsSectionProps): ReactElement {
  const { title, description, id, dataAttrs, className, children } = props;
  const hasTitleId = id !== undefined && title !== undefined;
  const titleId = hasTitleId ? `settings-group-${id}-title` : undefined;
  return (
    <section
      className={
        className === undefined ? "settings-group" : `settings-group ${className}`
      }
      role="group"
      aria-labelledby={titleId}
      data-settings-group={id}
      {...dataAttrs}
    >
      {title !== undefined && (
        <h3 className="settings-group-title" id={titleId}>
          {title}
        </h3>
      )}
      {description !== undefined && <SettingsSupport>{description}</SettingsSupport>}
      <div className="settings-group-body">{children}</div>
    </section>
  );
}

/** A setting ROW: label (and optional support text) in the flexing text track,
 *  the native control in the bounded control track. `value` renders the actual
 *  current value when it is not self-evident from the control. */
export interface SettingsRowProps {
  label: ReactNode;
  /** Control id the label points at (`htmlFor`). Omit for a label-only row. */
  htmlFor?: string;
  /** Concise supporting explanation shown under the label. */
  hint?: ReactNode;
  /** The actual current value, when it is not obvious from the control. */
  value?: ReactNode;
  /** The native control; rendered in the second track. */
  control: ReactNode;
  /** Optional data hook for tests, e.g. "theme-default". */
  id?: string;
  className?: string;
}

export function SettingsRow(props: SettingsRowProps): ReactElement {
  const { label, htmlFor, hint, value, control, id, className } = props;
  return (
    <div
      className={className === undefined ? "settings-row" : `settings-row ${className}`}
      data-settings-row={id}
    >
      <div className="settings-row-text">
        {htmlFor !== undefined ? (
          <label className="settings-row-label" htmlFor={htmlFor}>
            {label}
          </label>
        ) : (
          <span className="settings-row-label">{label}</span>
        )}
        {hint !== undefined && <SettingsSupport>{hint}</SettingsSupport>}
      </div>
      <div className="settings-row-control">
        {value !== undefined && <span className="settings-row-value">{value}</span>}
        {control}
      </div>
    </div>
  );
}

/** The Settings Studio layout: the section navigator beside a scrolling body of
 *  settings groups. The category panels and their real handlers are supplied by
 *  the caller (chunks C/D/E); `resizeAxis` opts into the shared `TfResize`
 *  height tween used by the shipped Preferences sheet. */
export interface SettingsStudioProps {
  sections: readonly SettingsSectionDef[];
  activeId: string;
  onSelect: (id: string) => void;
  /** Accessible name for the navigator. */
  ariaLabel?: string;
  /** Wrap the group body in the shared TfResize frame; null disables it. */
  resizeAxis?: ResizeAxes | null;
  className?: string;
  children: ReactNode;
}

export function SettingsStudio(props: SettingsStudioProps): ReactElement {
  const {
    sections,
    activeId,
    onSelect,
    ariaLabel,
    resizeAxis = null,
    className,
    children,
  } = props;
  const groups = <div className="settings-studio-groups">{children}</div>;
  return (
    <div
      className={className === undefined ? "settings-studio" : `settings-studio ${className}`}
      data-settings-studio
    >
      <SettingsNav
        sections={sections}
        activeId={activeId}
        onSelect={onSelect}
        ariaLabel={ariaLabel}
      />
      <div className="settings-studio-body">
        {resizeAxis === null ? groups : <TfResize axes={resizeAxis}>{groups}</TfResize>}
      </div>
    </div>
  );
}
