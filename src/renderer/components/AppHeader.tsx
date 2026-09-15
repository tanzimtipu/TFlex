import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  Check,
  ChevronDown,
  Monitor,
  Moon,
  Plus,
  Settings,
  Sparkles,
  Sun,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { Theme } from "../state/theme";
import type { ThemeDefault } from "../state/preferences";
import type { TabInput } from "../state/tabMouseDown";
import { AnimatedTab } from "./AnimatedTab";
import { usePopAnimation } from "../hooks/useAnimations";

export type AppHeaderTab = TabInput;

interface AppHeaderProps {
  activeId: string | null;
  tabs: AppHeaderTab[];
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  theme: Theme;
  /** Saved theme preference — the picker's SELECTION state. When
   *  absent the header falls back to the concrete `theme` (legacy
   *  behaviour: the selection mirrors the applied theme). */
  themeDefault?: ThemeDefault;
  /** Phase-15 — the embedded theme picker. Receives the picker
   *  selection — one of the three explicit themes ('frosted' |
   *  'dark' | 'light') OR the 'system' meta-option — instead of a
   *  blind toggle, so the dropdown can persist any of the four
   *  values. The host resolves 'system' to the OS colour
   *  preference, applies the concrete theme live, and persists both
   *  `theme` (resolved) and `themeDefault` (the pick itself). */
  onThemeChange: (next: ThemeDefault) => void;
  /** Phase 14.1 — REMOVED: the Open button moved to the command bar
   *  (CommandBar's accent File group) per the Liquid Glass reference:
   *  the caption strip is logo | tabs | app controls | window controls,
   *  and document commands live in the command bar below it. */
  /** Phase 6 — "+ tab" affordance. Spawns a brand-new empty tab that
   *  the user can fill by opening a PDF. The host owns the empty-tab
   *  state (see App.tsx -> tabs.openEmpty). */
  onNewEmptyTab: () => void;
  /** Phase 13 — the Settings (gear) affordance. Opens the Preferences
   *  sheet (the same surface the Edit menu's "Preferences..." row and
   *  the Ctrl+, accelerator open). The gear gives the borderless
   *  title bar its always-visible settings entry point; the popover
   *  menu keeps the discoverable text path. */
  onOpenPreferences: () => void;
  /** DEF-077 — optional slot for the OTA update indicator. Renders
   *  inside `.header-actions`, just before the theme toggle. The host
   *  passes a fully-constructed `<UpdateIndicator />` (or null) so
   *  AppHeader stays presentational and doesn't need to know about
   *  the IPC channel shape. */
  updateIndicator?: ReactNode;
}

/** Phase-15 — the three themes the picker offers, in display order
 *  (frosted is the default, so it leads the list). Module-level const
 *  so the focus-on-open effect below has a stable reference.
 *  The 'system' meta-option follows the concrete themes: it is a
 *  preference (which theme to follow), not a theme itself, so it
 *  resolves to light/dark at pick time (the host owns that math). */
const THEME_OPTIONS: ReadonlyArray<{ value: ThemeDefault; label: string }> = [
  { value: "frosted", label: "Frosted Glass" },
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
  { value: "system", label: "System default" },
];

function themeIcon(value: ThemeDefault, size: number): ReactElement {
  const props = { size, "aria-hidden": true } as const;
  if (value === "dark") return <Moon {...props} />;
  if (value === "light") return <Sun {...props} />;
  if (value === "system") return <Monitor {...props} />;
  return <Sparkles {...props} />;
}

function themeLabel(value: ThemeDefault): string {
  return THEME_OPTIONS.find((o) => o.value === value)?.label ?? "Frosted Glass";
}

export function AppHeader(props: AppHeaderProps): ReactElement {
  const { activeId, tabs, onActivate, onClose, theme, themeDefault, onThemeChange, onNewEmptyTab, onOpenPreferences, updateIndicator = null } = props;
  // Phase-15 — the embedded theme dropdown. All hooks stay at the top
  // of the component (DEF-117 hook-order contract): no early returns.
  // The picker's selection is the SAVED preference (themeDefault) —
  // 'system' stays marked even though the live `theme` is the
  // resolved concrete value. When no preference is persisted yet
  // (first run), fall back to the concrete theme so the selection
  // mirrors the applied look, exactly like the legacy toggle did.
  const selected: ThemeDefault = themeDefault ?? theme;
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  // Cross-theme animation system — the theme picker popover plays Pop In
  // (scale + drop) on open and Pop Out on close, replacing the old
  // entrance-only CSS keyframe. Theme-independent travel/timing; the
  // menu surface itself stays a theme visual.
  const themePop = usePopAnimation();
  const themeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const themePopoverRef = useRef<HTMLDivElement | null>(null);
  const themeOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // When the menu opens, land focus on the currently-selected option
  // (the first one when the persisted value is somehow outside the
  // list). This is the keyboard-visible anchor for arrow navigation.
  useEffect(() => {
    if (!themeMenuOpen) return;
    const idx = THEME_OPTIONS.findIndex((o) => o.value === selected);
    const target = themeOptionRefs.current[idx >= 0 ? idx : 0];
    target?.focus();
  }, [themeMenuOpen, selected]);

  // Close on outside click / Escape (same pattern as the TitleBar's
  // menu popover). The pointerdown listener only closes — it never
  // preventDefaults or stops propagation, so interactive elements
  // under the pointer keep their normal click (cross-bubbling guard,
  // DEF-087/088/090).
  useEffect(() => {
    if (!themeMenuOpen) return;
    const onPointer = (e: PointerEvent): void => {
      const t = e.target as Node | null;
      if (t === null) return;
      if (themeTriggerRef.current?.contains(t)) return;
      if (themePopoverRef.current?.contains(t)) return;
      setThemeMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        setThemeMenuOpen(false);
        themeTriggerRef.current?.focus();
      } else if (e.key === "Tab") {
        // Tab walks out of the dropdown; an open menu with focus
        // elsewhere is a ghost. Close it so the next focus target is
        // discoverable.
        setThemeMenuOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onKey);
    return (): void => {
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [themeMenuOpen]);

  const focusThemeOption = useCallback((index: number): void => {
    const count = THEME_OPTIONS.length;
    if (count === 0) return;
    const clamped = ((index % count) + count) % count;
    themeOptionRefs.current[clamped]?.focus();
  }, []);

  const onThemeTriggerClick = useCallback((): void => {
    setThemeMenuOpen((v) => !v);
  }, []);

  const onThemeTriggerKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLButtonElement>): void => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        setThemeMenuOpen((v) => !v);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setThemeMenuOpen(true);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setThemeMenuOpen(true);
      }
    },
    [],
  );

  const onThemeSelect = useCallback(
    (next: ThemeDefault): void => {
      setThemeMenuOpen(false);
      if (next !== selected) onThemeChange(next);
      themeTriggerRef.current?.focus();
    },
    [onThemeChange, selected],
  );

  // Roving focus on the option list: arrows move, Home/End jump, and
  // Enter/Space activate the focused option. The options are real
  // <button role="menuitem"> elements (pointer clicks land normally),
  // but Enter/Space are ALSO handled here explicitly — that is the
  // ARIA menu pattern, it keeps keyboard activation deterministic,
  // and it survives environments without native button activation.
  // preventDefault stops the browser's own click-on-key from
  // double-firing (the option is unmounted by then anyway).
  const onThemePopoverKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLDivElement>): void => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const focused = themeOptionRefs.current.findIndex((el) => el === document.activeElement);
        const base = focused >= 0 ? focused : THEME_OPTIONS.findIndex((o) => o.value === selected);
        const dir = e.key === "ArrowDown" ? 1 : -1;
        focusThemeOption(base + dir);
      } else if (e.key === "Home") {
        e.preventDefault();
        focusThemeOption(0);
      } else if (e.key === "End") {
        e.preventDefault();
        focusThemeOption(THEME_OPTIONS.length - 1);
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const idx = themeOptionRefs.current.findIndex((el) => el === document.activeElement);
        const opt = THEME_OPTIONS[idx];
        if (opt !== undefined) onThemeSelect(opt.value);
      }
    },
    [selected, focusThemeOption, onThemeSelect],
  );

  // Tab strip interaction contract (DEF-034): activation resolves on
  // MOUSEDOWN via the shared resolveTabMouseDown classifier, so padding,
  // gap and inner-title hits all activate and the close button closes.
  // Phase 7: the resolver walks up to `.tab` only, so a mousedown that
  // lands on the "+ tab" button (a sibling of `.tab` inside
  // `.tab-list`) cannot accidentally activate a tab.
  //
  // Cross-theme animation system — the per-tab resolution now lives in
  // AnimatedTab (same classifier, fed one tab), so each tab owns its own
  // Tab Materialize / Tab Dissolve presence while the interaction
  // contract stays byte-identical.
  //
  // The "+ tab" button keeps its mousedown stopPropagation so a future
  // strip-level listener can never misread it as an activation hit.
  const onNewTabMouseDown = useCallback((e: ReactMouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation();
  }, []);

  const currentThemeLabel = themeLabel(selected);

  // Phase 7 — the "+ tab" button lives INSIDE the tab list as the
  // last <li>, so it renders immediately adjacent to the rightmost
  // tab (Phase 7 fix #2). The wrapper <li> keeps the button on the
  // same flex row as the tabs, with no gap-eating margin between
  // it and the last tab.
  return (
    <header className="app-header">
      <div className="brand">
        <span className="brand-mark" aria-hidden>TF</span>
        <span>TFlex</span>
      </div>
      <div className="tab-area" role="tablist" aria-label="Open documents">
        <ul className="tab-list">
          {/* Cross-theme animation system — one presence boundary owns
              every tab: new tabs play Tab Materialize (opacity in),
              closed tabs play Tab Dissolve (opacity out) before the li
              unmounts. `initial={false}` keeps the page-load tabs from
              animating — only tabs opened during the session
              materialize. */}
          <AnimatePresence initial={false}>
            {tabs.map((tab) => {
              const isActive = tab.id === activeId;
              return (
                <AnimatedTab
                  key={tab.id}
                  id={tab.id}
                  title={tab.title}
                  active={isActive}
                  modified={tab.modified}
                  onActivate={onActivate}
                  onClose={onClose}
                />
              );
            })}
          </AnimatePresence>
          {/* Phase 7 — the "+ tab" affordance now sits immediately
              after the rightmost tab.
              Rendered as its own <li> so it stays on the tab strip's
              flex row and inherits the strip's baseline alignment,
              but outside `.tab` so the mousedown resolver classifies
              it as a no-op.

              DEF-055 — the affordance is gated on `tabs.length >= 1`.
              On the welcome screen (zero tabs) the welcome pane is the
              user's primary entry point and a stray "+" button invites
              a useless empty tab. Only show "+" once at least one real
              tab is open, so the strip stays visually clean when the
              user is on the welcome pane. */}
          {tabs.length >= 1 && (
            <li className="tab-list-new">
              <button
                type="button"
                className="tab-new"
                onMouseDown={onNewTabMouseDown}
                onClick={onNewEmptyTab}
                aria-label="New empty tab"
                title="New empty tab"
                data-new-tab
              >
                <Plus size={16} aria-hidden />
              </button>
            </li>
          )}
        </ul>
      </div>
      <div className="header-actions">
        {/* DEF-077 — OTA update indicator slot. Rendered before the
            settings gear and theme dropdown so the visual order
            (left-to-right) is [update | gear | theme | open] — the
            settings affordance sits with the other app-level controls
            at the trailing edge of the title bar. */}
        {updateIndicator}
        {/* Phase 13 — Settings gear. Icon-only chrome control (the
            shared header a11y contract: aria-label + title tooltip);
            opens the Preferences sheet. */}
        <button
          type="button"
          className="header-gear"
          onClick={onOpenPreferences}
          aria-haspopup="dialog"
          aria-label="Open preferences"
          title="Preferences (Ctrl+,)"
          data-open-preferences
        >
          <Settings size={16} aria-hidden />
        </button>
        {/* Phase-15 — embedded borderless theme picker. Keeps the
            stable `.theme-toggle` class (+ a fresh `data-theme-toggle`
            attribute) so e2e selectors keep resolving; the control is
            now a labelled pill that opens an attached option list
            instead of blind-toggling. */}
        <div className="theme-toggle-wrap">
          <button
            ref={themeTriggerRef}
            type="button"
            className="theme-toggle theme-toggle-trigger"
            data-theme-toggle
            onClick={onThemeTriggerClick}
            onKeyDown={onThemeTriggerKeyDown}
            aria-haspopup="menu"
            aria-expanded={themeMenuOpen}
            aria-label="Change theme"
            title={`Change theme (current: ${currentThemeLabel})`}
          >
            {themeIcon(selected, 14)}
            <span className="theme-toggle-label">{currentThemeLabel}</span>
            <ChevronDown size={12} aria-hidden />
          </button>
          <AnimatePresence>
            {themeMenuOpen && (
              <motion.div
                ref={themePopoverRef}
                className="theme-toggle-popover"
                role="menu"
                aria-label="Change theme"
                onKeyDown={onThemePopoverKeyDown}
                variants={themePop}
                initial="initial"
                animate="animate"
                exit="exit"
              >
                {THEME_OPTIONS.map((opt, i) => {
                  const isSelected = opt.value === selected;
                  return (
                    <button
                      key={opt.value}
                      ref={(el): void => {
                        themeOptionRefs.current[i] = el;
                      }}
                      type="button"
                      role="menuitem"
                      aria-checked={isSelected}
                      className={isSelected ? "theme-toggle-option theme-toggle-option-selected" : "theme-toggle-option"}
                      data-theme-option={opt.value}
                      onClick={(): void => onThemeSelect(opt.value)}
                    >
                      <span className="theme-toggle-option-mark" aria-hidden>
                        {isSelected && <Check size={14} />}
                      </span>
                      <span className="theme-toggle-option-label">{opt.label}</span>
                    </button>
                  );
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        {/* Phase 14.1 — the Open button MOVED to the command bar
         *  (CommandBar's accent File group). The header-actions cluster
         *  is [update indicator | gear | theme] — the caption strip's
         *  app-level controls only. */}
      </div>
    </header>
  );
}