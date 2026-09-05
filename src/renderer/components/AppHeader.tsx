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
  FolderOpen,
  Moon,
  Plus,
  Sparkles,
  Sun,
  X,
} from "lucide-react";
import type { Theme } from "../state/theme";
import { resolveTabMouseDown, type TabInput } from "../state/tabMouseDown";

export type AppHeaderTab = TabInput;

interface AppHeaderProps {
  activeId: string | null;
  tabs: AppHeaderTab[];
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  theme: Theme;
  /** Phase-15 — the embedded theme picker. Receives the EXPLICIT
   *  chosen theme ('frosted' | 'dark' | 'light') instead of a blind
   *  toggle, so the dropdown can persist any of the three values. */
  onThemeChange: (next: Theme) => void;
  onOpen: () => void;
  /** Phase 6 — "+ tab" affordance. Spawns a brand-new empty tab that
   *  the user can fill by opening a PDF. The host owns the empty-tab
   *  state (see App.tsx -> tabs.openEmpty). */
  onNewEmptyTab: () => void;
  /** DEF-077 — optional slot for the OTA update indicator. Renders
   *  inside `.header-actions`, just before the theme toggle. The host
   *  passes a fully-constructed `<UpdateIndicator />` (or null) so
   *  AppHeader stays presentational and doesn't need to know about
   *  the IPC channel shape. */
  updateIndicator?: ReactNode;
}

/** Phase-15 — the three themes the picker offers, in display order
 *  (frosted is the default, so it leads the list). Module-level const
 *  so the focus-on-open effect below has a stable reference. */
const THEME_OPTIONS: ReadonlyArray<{ value: Theme; label: string }> = [
  { value: "frosted", label: "Frosted Glass" },
  { value: "dark", label: "Dark" },
  { value: "light", label: "Light" },
];

function themeIcon(value: Theme, size: number): ReactElement {
  const props = { size, "aria-hidden": true } as const;
  if (value === "dark") return <Moon {...props} />;
  if (value === "light") return <Sun {...props} />;
  return <Sparkles {...props} />;
}

function themeLabel(value: Theme): string {
  return THEME_OPTIONS.find((o) => o.value === value)?.label ?? "Frosted Glass";
}

export function AppHeader(props: AppHeaderProps): ReactElement {
  const { activeId, tabs, onActivate, onClose, theme, onThemeChange, onOpen, onNewEmptyTab, updateIndicator = null } = props;
  // Phase-15 — the embedded theme dropdown. All hooks stay at the top
  // of the component (DEF-117 hook-order contract): no early returns.
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const themeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const themePopoverRef = useRef<HTMLDivElement | null>(null);
  const themeOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // When the menu opens, land focus on the currently-selected option
  // (the first one when the persisted value is somehow outside the
  // list). This is the keyboard-visible anchor for arrow navigation.
  useEffect(() => {
    if (!themeMenuOpen) return;
    const idx = THEME_OPTIONS.findIndex((o) => o.value === theme);
    const target = themeOptionRefs.current[idx >= 0 ? idx : 0];
    target?.focus();
  }, [themeMenuOpen, theme]);

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
    (next: Theme): void => {
      setThemeMenuOpen(false);
      if (next !== theme) onThemeChange(next);
      themeTriggerRef.current?.focus();
    },
    [onThemeChange, theme],
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
        const base = focused >= 0 ? focused : THEME_OPTIONS.findIndex((o) => o.value === theme);
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
    [theme, focusThemeOption, onThemeSelect],
  );

  // Single mousedown handler for the tab strip. We use mousedown (not
  // click) so the activate mutation lands synchronously and is not
  // dropped by a re-render that swaps the button element between
  // mousedown and mouseup (DEF-034: state-churn click loss). The
  // resolver classifies the hit as activate / close / no-op, so
  // padding, gap, and inner title clicks all flow through the same
  // path. Phase 7: the resolver walks up to `.tab` only, so a
  // mousedown that lands on the "+ tab" button (a sibling of `.tab`
  // inside `.tab-list`) cannot accidentally activate a tab.
  const onTabMouseDown = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>): void => {
      const action = resolveTabMouseDown(
        { target: e.target, button: e.button },
        tabs,
      );
      if (action === null) return;
      if (action.kind === "activate") {
        if (action.id === activeId) return;
        onActivate(action.id);
      } else {
        onClose(action.id);
      }
    },
    [tabs, activeId, onActivate, onClose],
  );

  // Close button stops mousedown from bubbling so the resolver above
  // sees the close-button hit and the tab-level mousedown doesn't
  // ALSO fire an activate. stopPropagation on mousedown is the right
  // level here — stopping click alone would let the outer mousedown
  // race past before click resolved.
  const onCloseMouseDown = useCallback((e: ReactMouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation();
  }, []);

  // "+ tab" button also stops mousedown so the tab strip's
  // onTabMouseDown handler never sees it — the resolver already
  // filters it out (no .tab ancestor) but stopping here is the
  // structural guarantee.
  const onNewTabMouseDown = useCallback((e: ReactMouseEvent<HTMLButtonElement>): void => {
    e.stopPropagation();
  }, []);

  const currentThemeLabel = themeLabel(theme);

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
          {tabs.length === 0 ? null : tabs.map((tab) => {
            const isActive = tab.id === activeId;
            return (
              <li key={tab.id}>
                <div
                  className={isActive ? "tab tab-active" : "tab"}
                  role="tab"
                  aria-selected={isActive}
                  data-tab-id={tab.id}
                  onMouseDown={onTabMouseDown}
                >
                  <span
                    className="tab-title"
                    title={tab.title}
                  >
                    <span
                      className={
                        tab.modified
                          ? "tab-modified-dot"
                          : "tab-modified-dot tab-modified-dot-hidden"
                      }
                      aria-hidden
                    />
                    {tab.title}
                  </span>
                  <button
                    type="button"
                    className="tab-close"
                    onMouseDown={onCloseMouseDown}
                    onClick={(e): void => {
                      e.stopPropagation();
                      onClose(tab.id);
                    }}
                    aria-label={`Close ${tab.title}`}
                  >
                    <X size={16} aria-hidden />
                  </button>
                </div>
              </li>
            );
          })}
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
            theme dropdown so the visual order (left-to-right) is
            [update | theme | open] — matching the spec's "next to
            the Tools/theme controls" placement. */}
        {updateIndicator}
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
            {themeIcon(theme, 14)}
            <span className="theme-toggle-label">{currentThemeLabel}</span>
            <ChevronDown size={12} aria-hidden />
          </button>
          {themeMenuOpen && (
            <div
              ref={themePopoverRef}
              className="theme-toggle-popover"
              role="menu"
              aria-label="Change theme"
              onKeyDown={onThemePopoverKeyDown}
            >
              {THEME_OPTIONS.map((opt, i) => {
                const selected = opt.value === theme;
                return (
                  <button
                    key={opt.value}
                    ref={(el): void => {
                      themeOptionRefs.current[i] = el;
                    }}
                    type="button"
                    role="menuitem"
                    aria-checked={selected}
                    className={selected ? "theme-toggle-option theme-toggle-option-selected" : "theme-toggle-option"}
                    data-theme-option={opt.value}
                    onClick={(): void => onThemeSelect(opt.value)}
                  >
                    <span className="theme-toggle-option-mark" aria-hidden>
                      {selected && <Check size={14} />}
                    </span>
                    <span className="theme-toggle-option-label">{opt.label}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onOpen}
          style={{ height: 28, padding: "0 10px", fontSize: 12 }}
        >
          <FolderOpen size={16} aria-hidden />
          Open
        </button>
      </div>
    </header>
  );
}