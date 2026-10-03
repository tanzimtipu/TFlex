import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  Check,
  ChevronDown,
  Command,
  FolderOpen,
  Monitor,
  Moon,
  PanelsLeftRight,
  Plus,
  Printer,
  Save,
  SaveAll,
  Search,
  Settings,
  Snowflake,
  Sun,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { AnimatePresence } from "motion/react";
import { Icon } from "../icons/Icon";
import type { Theme } from "../state/theme";
import type { ThemeDefault } from "../state/preferences";
import type { TabInput } from "../state/tabMouseDown";
import type { TabStyle } from "../../shared/types";
import { tabColourSlot } from "../state/tabColour";
import { AnimatedTab } from "./AnimatedTab";
import { BrandMark } from "./BrandMark";
import { BrandWordmark } from "./BrandWordmark";
import { TfMorph } from "./motion/TfMotion";
import { useMorphPreset } from "./motion/useMorphPreset";

export type AppHeaderTab = TabInput;

/** DEF-288 — the reason shown on the disabled "+" while Multi Mode is on. */
export const NEW_TAB_MULTI_MODE_REASON = "Turn off Multi Mode to create a new document";

/** Phase 40 (item 8) — the Multi Mode toggle's accessible name. The tooltip
 *  (title) carries the same "view/edit two documents side by side" wording, so
 *  the accessible name and the hover tooltip can never drift apart. */
export const MULTI_MODE_ACCESSIBLE_NAME =
  "Multi Mode: view/edit two documents side by side";

/** Phase 40 (item 5) — the Ctrl+K tool-search icon's accessible name. It
 *  names the shortcut AND the surface (the Command Palette), so the icon
 *  can never be confused with the Ctrl+F find icon beside it. */
export const TOOL_SEARCH_ACCESSIBLE_NAME = "Search tools and commands (Ctrl+K)";

/** Phase 40 (item 5) — the Ctrl+F find icon's accessible name. */
export const FIND_IN_DOCUMENT_ACCESSIBLE_NAME = "Find in document (Ctrl+F)";

/* -------------------------------------------------------------------------
 * Phase 72 (item 7) — tab-strip overflow: the pure planner.
 *
 * The Phase 59 item 10 STACK/OVERLAP regime is RETIRED. The strip keeps ONE
 * row by SHRINKING every tab uniformly: when the open tabs no longer fit,
 * every tab takes the same width down toward a floor. Tabs never stack and
 * never overlap (`overlap` is always 0 here and the per-tab overlap write
 * is gone from the DOM and the sheet). The plan is computed from the measured
 * available width vs the tabs' natural width and applied to the DOM through
 * the `--tf-tab-width` CSS custom property on `.tab-list` (consumed by `.tab`),
 * so the CSS `transition` animates the change with the shared motion tokens
 * (and the global reduced-motion / Animations-OFF catch-all makes it instant).
 *
 * Everything here is pure and unit-tested; the component only measures.
 * ------------------------------------------------------------------------- */

/** The tab-to-tab gap (px) that the base CSS draws between two tabs. It is
 *  the SAME value `.tab`'s `margin-right` falls back to. */
export const TAB_GAP = 2;
/** Phase 72 (item 8) — the colorful per-tab shrink floor: once the uniform
 *  fit width reaches this it may keep shrinking down to the hard floor below,
 *  so the strip always contains every tab in one row. */
export const MIN_TAB_WIDTH = 56;
/** Phase 72 (item 8) — the hard per-tab floor, kept as the compactness
 *  reference. TFL-213 (DEF-441) — it is NOT a lower bound on the fit any more:
 *  when even this width would overflow the strip, the uniform fit drops below
 *  it (down toward 0) so no tab ever leaves the bar and the strip never
 *  scrolls (the title elides; the close control stays the last child). */
export const HARD_MIN_TAB_WIDTH = 24;
/** TFL-248 (DEF-462) — the smallest tab that can still contain the 5px dirty
 *  dot (5px + its leading pixel of tab padding). When the normal gapped fit
 *  would drop below this, the plan re-runs with NO inter-tab gap so the tabs
 *  stay dot-safe without ever overflowing the strip. */
export const DOT_SAFE_TAB_WIDTH = 6;

export interface TabOverflowPlan {
  /** The width every tab takes in the overflow regime. */
  width: number;
  /** How far each tab over the first is pulled left. Always 0 — the Phase 59
   *  stack/overlap regime is retired (kept for the frozen contract shape). */
  overlap: number;
}

function clampTab(value: number, min: number, max: number): number {
  if (max < min) return min;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/**
 * Plan the uniform per-tab width for `count` tabs that want `naturalWidth`
 * each inside `availableWidth`.
 *
 *  - Fits: every tab keeps its natural width.
 *  - Overflow: the width shrinks uniformly to the LARGEST value that still
 *    satisfies `count * width + (count - 1) * gap <= availableWidth`. The
 *    `floor` is applied only while it still fits — if even the floor would
 *    overflow, the width drops below it (and below `HARD_MIN_TAB_WIDTH`, down
 *    to 0), so the strip always contains every tab in ONE row. Tabs NEVER
 *    stack and NEVER overlap (Phase 72 item 7 retired the Phase 59 overlap
 *    regime), so `overlap` is always 0.
 */
export function planTabOverflow(args: {
  count: number;
  naturalWidth: number;
  availableWidth: number;
  floor: number;
  gap?: number;
}): TabOverflowPlan {
  const count = Math.max(0, Math.floor(args.count));
  const natural = Math.max(0, args.naturalWidth);
  const floor = clampTab(Math.max(0, args.floor), 0, natural);
  const gap = args.gap ?? TAB_GAP;

  if (count <= 0) return { width: natural, overlap: 0 };

  const required = count * natural + (count - 1) * gap;
  if (required <= args.availableWidth) return { width: natural, overlap: 0 };

  // Shrink uniformly to the fit width; the compactness floor can only lift the
  // width while it still fits. TFL-213 (DEF-441) — the fit invariant wins, so
  // the width may legally fall below `floor` (and below HARD_MIN_TAB_WIDTH):
  // `count * width + (count - 1) * gap <= availableWidth` always holds.
  const fit = Math.max(0, (args.availableWidth - (count - 1) * gap) / count);
  const lower = floor <= fit ? floor : 0;
  return {
    width: clampTab(fit, lower, natural),
    overlap: 0,
  };
}

/**
 * Phase 72 (item 8) / TFL-209 — the width the uniform tab fit may actually
 * use, after the strip's padding, the "+" affordance and the TRAILING gap.
 *
 * `planTabOverflow` reserves `(count - 1) * gap` between the tabs, but the
 * base CSS (`styles.css` `.tab { margin-right: 2px }` and the colorful
 * override) draws `margin-right: TAB_GAP` on EVERY `.tab` — the last one
 * included. Because the "+" `<li>` follows the last tab, the rendered strip is
 * exactly ONE gap wider than the plan, which pushed `scrollWidth` to
 * `clientWidth + TAB_GAP`. Subtracting the trailing gap here makes the plan
 * account for the full rendered width, so `scrollWidth <= clientWidth` holds
 * on the nose (the Phase 72 item 8 invariant).
 */
export function tabFitAvailableWidth(args: {
  clientWidth: number;
  paddingLeft: number;
  paddingRight: number;
  plusWidth: number;
  gap?: number;
}): number {
  const gap = args.gap ?? TAB_GAP;
  return args.clientWidth - args.paddingLeft - args.paddingRight - args.plusWidth - gap;
}

/** Per-style natural width (the tab at rest) and shrink floor. The colorful
 *  set is a single uniform 180px width; Phase 72 (item 8) drops its floor to
 *  `MIN_TAB_WIDTH` so the strip always fits every tab. The standard set sizes
 *  to content, so its natural is the softer ceiling and its floor is smaller. */
export const TAB_OVERFLOW_METRICS: Readonly<Record<TabStyle, { natural: number; floor: number }>> = {
  colorful: { natural: 180, floor: MIN_TAB_WIDTH },
  standard: { natural: 168, floor: 96 },
};

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
   *  and document commands live in the command bar below it.
   *
   *  Phase 22 — SUPERSEDED: the operator moved Open / Save / Save As
   *  back into the caption strip, immediately right of the brand and
   *  left of the tab strip, as ONE grouped control. The CommandBar no
   *  longer renders them. These props carry the relocated actions; the
   *  host (App.tsx) threads the ACTIVE tab's save state + handlers. */
  onOpenFile?: () => void;
  onSave?: () => void;
  onSaveAs?: () => void;
  /** True when the active tab has unsaved engine changes. Drives the
   *  Save control's enabled state + modified dot. */
  saveModified?: boolean;
  /** False for read-only sources (samples): in-place Save is gated to
   *  Save-As only. Defaults to true so a harness that omits it still
   *  renders the standard behaviour. */
  saveInPlaceEnabled?: boolean;
  /** Phase 6 — "+ tab" affordance. Spawns a brand-new empty tab that
   *  the user can fill by opening a PDF. The host owns the empty-tab
   *  state (see App.tsx -> tabs.openEmpty). */
  onNewEmptyTab: () => void;
  /** DEF-288 — true while Multi Mode is on. The strip then shows ONE
   *  composite workspace tab, so a new empty tab would be a hidden state
   *  mutation that only surfaces after leaving the mode. The "+" is
   *  therefore visibly disabled with this reason (fail-loud rule: a control
   *  that cannot act is disabled and explains why). */
  multiModeEnabled?: boolean;
  /** Phase 13 — the Settings (gear) affordance. Opens the Preferences
   *  sheet (the same surface the Edit menu's "Preferences..." row and
   *  the Ctrl+, accelerator open). The gear gives the borderless
   *  title bar its always-visible settings entry point; the popover
   *  menu keeps the discoverable text path. */
  onOpenPreferences: () => void;
  /** Phase 30 — the Print affordance, placed immediately left of the
   *  preferences gear. Opens the print dialog (same surface as File >
   *  Print and Ctrl+P). */
  onPrint?: () => void;
  /** DEF-336 — whether the ACTIVE tab holds a printable document. An empty
   *  placeholder tab has no engine session, so the Print icon disables (with a
   *  reason in its tooltip) rather than accepting a click that does nothing. */
  printEnabled?: boolean;
  /** Phase 36 (chunk 6) — the Multi Mode toggle, moved into the title bar
   *  (approved placement; the Command Palette keeps its own route). Omitted
   *  means the control is not rendered (harnesses / pre-Phase-36 mounts), so
   *  it is never a silent no-op. */
  onMultiModeToggle?: () => void;
  /** DEF-077 — optional slot for the OTA update indicator. Renders
   *  inside `.header-actions`, just before the theme toggle. The host
   *  passes a fully-constructed `<UpdateIndicator />` (or null) so
   *  AppHeader stays presentational and doesn't need to know about
   *  the IPC channel shape. */
  updateIndicator?: ReactNode;
  /** Phase 40 (item 5) — the Ctrl+K tool-search icon. Opens the Command
   *  Palette, the SAME surface the Ctrl+K chord and the registry's
   *  "Browse all tools" row open. Omitted means the control is not
   *  rendered (harnesses / pre-Phase-40 mounts), never a silent no-op. */
  onOpenToolSearch?: () => void;
  /** Phase 40 (item 5) — the Ctrl+F find icon. Opens the focused pane's
   *  find bar, the SAME surface the Ctrl+F chord opens. */
  onOpenFind?: () => void;
  /** Phase 40 (item 5) — whether the find surface exists right now (a
   *  document is open). The find bar is per-document, so with none open
   *  the control disables with a reason instead of doing nothing. */
  findEnabled?: boolean;
  /** Phase 44 (operator amendment) — the account section. The host builds the
   *  full `<AccountMenu>` (sign-in entry / round avatar + anchored panel) and
   *  passes it here, so AppHeader stays presentational. Rendered at the
   *  trailing edge of the title bar (the true top-right). Omitted means the
   *  account section is not rendered (harnesses / pre-Phase-44 mounts). */
  accountSlot?: ReactNode;
  /** Phase 58 — the tab-strip style preference. 'colorful' paints each
   *  tab with its own flat colour and the operator's reference
   *  silhouette; 'standard' keeps the classic tab look. Rendered as
   *  `data-tab-style` on `.tab-area` so the CSS switch is declarative.
   *  Absent means the default ('colorful'). */
  tabStyle?: TabStyle;
  /** Phase 58 (chunk 5) — reorder a tab to a new strip index. Omitted
   *  means reordering is disabled (harnesses / pre-Phase-58 mounts) — the
   *  header never reorders without a handler, so the control is never a
   *  silent no-op. Multi Mode shows ONE composite tab, so reorder is also
   *  a no-op there. */
  onMoveTab?: (id: string, toIndex: number) => void;
  /** Phase 58 (chunk 6b) — tear a tab OUT into a new app window. Omitted
   *  means the tear-out gesture is not available (harnesses /
   *  pre-Phase-58 mounts); the header then treats every drag as a
   *  reorder, never a silent no-op. The host owns the actual detach IPC. */
  onDetachTab?: (id: string) => void;
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

/** The header's migrated glyphs. Declared with an `icon:` property so the
 *  Phase 43 icon-identity guard still attributes each glyph to this surface. */
const APP_HEADER_GLYPHS = {
  chevronDown: { icon: ChevronDown },
  command: { icon: Command },
  monitor: { icon: Monitor },
  moon: { icon: Moon },
  multiMode: { icon: PanelsLeftRight },
  printer: { icon: Printer },
  save: { icon: Save },
  saveAll: { icon: SaveAll },
  search: { icon: Search },
  settings: { icon: Settings },
  snowflake: { icon: Snowflake },
  sun: { icon: Sun },
} as const satisfies Record<string, { icon: LucideIcon }>;

function themeIcon(value: ThemeDefault): LucideIcon {
  if (value === "dark") return APP_HEADER_GLYPHS.moon.icon;
  if (value === "light") return APP_HEADER_GLYPHS.sun.icon;
  if (value === "system") return APP_HEADER_GLYPHS.monitor.icon;
  return APP_HEADER_GLYPHS.snowflake.icon;
}

function themeLabel(value: ThemeDefault): string {
  return THEME_OPTIONS.find((o) => o.value === value)?.label ?? "Frosted Glass";
}

/**
 * DEF-411 — decide whether committing a reorder must restore the
 * pre-drag active tab. The DEF-034 activation contract fires on the
 * pointerdown that arms the drag, so a background tab becomes active
 * before the reorder commits. The reducer's `move` preserves `activeId`,
 * but that separate activation path must be undone.
 *
 * Restore only when:
 *   - a tab was active before the drag (startActive !== null);
 *   - the dragged tab was NOT the active one (restoring it would be a
 *     pointless no-op and the reducer already preserves it);
 *   - the gesture actually reordered (target slot differs from the
 *     tab's origin index — a same-slot release is a no-op).
 */
export function shouldRestoreActiveOnReorder(
  startActive: string | null,
  draggingId: string,
  startIndex: number | null,
  targetIndex: number,
): boolean {
  if (startActive === null) return false;
  if (startActive === draggingId) return false;
  if (startIndex !== null && targetIndex === startIndex) return false;
  return true;
}

/**
 * Phase 58 (chunk 6b) — the tear-out decision for a finished tab drag.
 *
 * The gesture is ONE pointer drag. A release INSIDE (or horizontally
 * beyond) the strip is a reorder; a release more than `threshold` pixels
 * BELOW the strip's bottom edge is a tear-out into a new window. A
 * horizontal escape alone stays a reorder — only the vertical escape
 * detaches, so a user dragging a tab to the far left / right never
 * accidentally spawns a window.
 *
 * `hasDetach` gates the whole thing: when the host passed no
 * `onDetachTab`, every release is a reorder (never a silent no-op).
 */
export function tearOutDecision(args: {
  pointer: { x: number; y: number };
  strip: { left: number; right: number; top: number; bottom: number };
  hasDetach: boolean;
  threshold?: number;
}): "detach" | "reorder" {
  if (!args.hasDetach) return "reorder";
  const threshold = args.threshold ?? 24;
  if (args.pointer.y > args.strip.bottom + threshold) return "detach";
  return "reorder";
}

export function AppHeader(props: AppHeaderProps): ReactElement {
  const { activeId, tabs, onActivate, onClose, theme, themeDefault, onThemeChange, onNewEmptyTab, onOpenPreferences, onPrint, printEnabled = true, onMultiModeToggle, updateIndicator = null, onOpenFile, onSave, onSaveAs, saveModified = false, saveInPlaceEnabled = true, multiModeEnabled = false, onOpenToolSearch, onOpenFind, findEnabled = false, accountSlot = null, tabStyle = "colorful", onMoveTab, onDetachTab } = props;
  // Phase-15 — the embedded theme dropdown. All hooks stay at the top
  // of the component (DEF-117 hook-order contract): no early returns.
  // The picker's selection is the SAVED preference (themeDefault) —
  // 'system' stays marked even though the live `theme` is the
  // resolved concrete value. When no preference is persisted yet
  // (first run), fall back to the concrete theme so the selection
  // mirrors the applied look, exactly like the legacy toggle did.
  const selected: ThemeDefault = themeDefault ?? theme;
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  // Phase 20 — the theme picker popover MORPHS out of its trigger (the
  // pill): the surface is laid out right-aligned under the pill (CSS
  // placement, untouched) and the FLIP preset grows it out of the pill's
  // bottom-right corner, flush against it. The old Pop In variant set was
  // a detached scale/drop, which read as a second window (operator rule).
  const themeTriggerRef = useRef<HTMLButtonElement | null>(null);
  const themePopoverRef = useRef<HTMLDivElement | null>(null);
  const themeOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  // Phase 72 (item 8) — the tab strip (.tab-list). The measure effect below
  // reads it to size the uniform fit width; the strip is not a scroll container.
  const tabListRef = useRef<HTMLUListElement | null>(null);
  const themeMorph = useMorphPreset({
    open: themeMenuOpen,
    triggerRef: themeTriggerRef,
    surfaceRef: themePopoverRef,
    anchorCorner: "top-right",
  });

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

  // Phase 72 (item 8) — the overflow plan. Measure the strip's content width
  // and plan ONE uniform per-tab width from the style's natural width. The
  // plan is written to `.tab-list` as `--tf-tab-width`; the CSS transition
  // (shared motion token) animates the change, and the global reduced-motion /
  // Animations-OFF catch-all collapses it to instant. Nothing is applied while
  // the tabs fit, so the resting look (auto width) is untouched. `count` and
  // the style drive a re-plan; a ResizeObserver re-measures on width changes.
  // The strip is no longer a scroll container, so there is no scroll path.
  const overflowMetrics = TAB_OVERFLOW_METRICS[tabStyle] ?? TAB_OVERFLOW_METRICS.colorful;
  const [tabOverflow, setTabOverflow] = useState<TabOverflowPlan | null>(null);
  const [tabGap, setTabGap] = useState<number>(TAB_GAP);
  useEffect((): (() => void) | undefined => {
    const list = tabListRef.current;
    if (list === null) return undefined;
    const measure = (): void => {
      const computed = window.getComputedStyle(list);
      const paddingLeft = parseFloat(computed.paddingLeft) || 0;
      const paddingRight = parseFloat(computed.paddingRight) || 0;
      const padding = paddingLeft + paddingRight;
      // Phase 72 (item 8) — reserve the "+" new-tab button so it is never
      // clipped by the fit width.
      const plus =
        (list.querySelector(".tab-list-new") as HTMLElement | null)?.offsetWidth ?? 0;
      const available = list.clientWidth - padding;
      // jsdom / a zero-width strip: leave the resting layout alone.
      if (!(available > 0)) {
        setTabOverflow(null);
        return;
      }
      // TFL-209 — reserve the "+" AND the trailing `.tab` margin so the plan
      // matches the rendered `scrollWidth` (never `clientWidth + TAB_GAP`).
      const fitWidth = tabFitAvailableWidth({
        clientWidth: list.clientWidth,
        paddingLeft,
        paddingRight,
        plusWidth: plus,
      });
      let next = planTabOverflow({
        count: tabs.length,
        naturalWidth: overflowMetrics.natural,
        availableWidth: fitWidth,
        floor: overflowMetrics.floor,
      });
      // TFL-248 (DEF-462) — a tab narrower than DOT_SAFE_TAB_WIDTH cannot paint
      // or hit-test the 5px dirty dot. When the gapped fit drops below it,
      // re-plan with the inter-tab margin collapsed to 0 so every tab still
      // fits AND stays dot-safe. `.tab` reads the gap from `--tf-tab-gap`.
      let nextGap = TAB_GAP;
      if (next.width < DOT_SAFE_TAB_WIDTH) {
        const tightFit = tabFitAvailableWidth({
          clientWidth: list.clientWidth,
          paddingLeft,
          paddingRight,
          plusWidth: plus,
          gap: 0,
        });
        const tight = planTabOverflow({
          count: tabs.length,
          naturalWidth: overflowMetrics.natural,
          availableWidth: tightFit,
          floor: overflowMetrics.floor,
          gap: 0,
        });
        if (tight.width > next.width) {
          next = tight;
          nextGap = 0;
        }
      }
      setTabGap((prev) => (prev === nextGap ? prev : nextGap));
      setTabOverflow((prev) =>
        prev !== null && prev.width === next.width && prev.overlap === next.overlap ? prev : next,
      );
    };
    measure();
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver((): void => measure()) : null;
    observer?.observe(list);
    return (): void => {
      observer?.disconnect();
    };
  }, [tabs.length, tabStyle, overflowMetrics.natural, overflowMetrics.floor]);

  // Apply the fit width only when the tabs do NOT fit (a uniform shrink). While
  // they fit, `tabOverflow` may still be the "natural" plan — clearing the
  // custom property keeps the tabs' own auto sizing. The width rides
  // `--tf-tab-width` on `.tab-list` (the `.tab` rule consumes it). Phase 72
  // (item 7) retired the per-tab overlap write entirely: tabs never stack.
  const squeezing =
    tabOverflow !== null && tabOverflow.width < overflowMetrics.natural - 0.5;
  const tabOverflowStyle: CSSProperties | undefined =
    tabOverflow !== null && squeezing
      ? ({ "--tf-tab-width": `${tabOverflow.width}px`, "--tf-tab-gap": `${tabGap}px` } as CSSProperties)
      : undefined;

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

  // ==========================================================================
  // Phase 58 (chunk 5) — pointer-driven tab reorder.
  //
  // The gesture is deliberately NOT HTML5 drag: it would hijack the pointer
  // and could not arm from every point on the tab. Pointer events let us run
  // one gesture:
  //
  //   - `pointerdown` on a tab (target outside `.tab-close`) ARMS a pending
  //     drag from ANY point on the tab — padding, gap, colour chip and the
  //     title all arm it, so a tab can be dragged from any area;
  //   - the FIRST `pointermove` past a 6px threshold (total movement) begins
  //     the reorder;
  //   - while reordering, the target slot is computed from pointer X against
  //     the midpoints of the OTHER tabs; Phase 60 drives the feedback by direct
  //     manipulation: the dragged tab follows the pointer and the other tabs
  //     reflow to open the insertion gap (the static drop marker is retired);
  //   - `pointerup` commits via `onMoveTab`, `pointercancel` discards.
  //
  // Phase 59 (item 1) — the title is no longer selectable, so the old
  // DEF-413 text-selection guard (cancel the drag when a non-collapsed
  // selection sat inside the title) is gone: it can no longer trigger and
  // must never block a drag that starts on the title.
  //
  // No preventDefault / stopPropagation on these handlers (AGENTS.md
  // cross-bubbling rule): the DEF-034 mousedown activation contract and the
  // close button are untouched. The reducer carries activeId through, so a
  // reorder never changes the active document.
  // ==========================================================================
  // DEF-412 — the ARM gate must NOT require more than one tab: a freshly
  // detached window holds exactly one tab, and BOTH the tear-out (origin)
  // and the drag-back (detached) gestures must be armable there. The
  // tab-count guard now lives on the reorder COMMIT (see `finish`), so a
  // single-tab drag can still detach but can never commit a meaningless
  // reorder. `!multiModeEnabled` still disables the gesture entirely on the
  // single composite workspace tab.
  const dragGestureEnabled =
    (onMoveTab !== undefined || onDetachTab !== undefined) &&
    !multiModeEnabled;
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ index: number; left: number } | null>(null);
  // Phase 58 (chunk 6b) — true while the drag is past the tear-out
  // threshold (below the strip). Drives the `data-tab-tearout` affordance.
  const [tearOut, setTearOut] = useState(false);
  // Phase 60 — direct manipulation. `dragOffset` is the live pointer travel
  // from the grab point: the dragged tab's `.tab` box is translated by it so
  // the tab follows the pointer. `dragWidth` is the dragged tab's measured
  // width — the size of the gap the OTHER tabs open at the computed slot.
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [dragWidth, setDragWidth] = useState(0);
  // DEF-432 — the dragged tab's geometry captured ONCE at arm time, before any
  // drag transform is applied. While the tear-out arms the tab is floated OUT
  // of the `.tab-list`: AnimatedTab positions it absolutely against `.tab-area`
  // (the non-scrolling clip owner) at these coordinates, so the strip stays
  // `overflow: hidden`. `reserve*` keeps the dragged `<li>`
  // occupying its original slot so the non-dragged tabs cannot shift.
  const [dragRect, setDragRect] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
    reserveWidth: number;
    reserveHeight: number;
  } | null>(null);
  // Gesture source-of-truth refs: the window listeners are subscribed once
  // per gesture window and must read the LATEST values without resubscribing.
  const pendingDragRef = useRef<{ id: string; startX: number; startY: number; pointerId: number } | null>(null);
  const draggingIdRef = useRef<string | null>(null);
  const dropIndexRef = useRef<number | null>(null);
  // DEF-411 — the pre-drag active tab + the dragged tab's origin index,
  // captured at ARM time. The DEF-034 mousedown activation fires on the
  // pointerdown that arms the drag, so committing a reorder must restore
  // the tab that was active before the gesture (Phase 58 success
  // criterion 4: after a reorder the active document is unchanged).
  const dragStartActiveRef = useRef<string | null>(null);
  const dragStartIndexRef = useRef<number | null>(null);
  const onMoveTabRef = useRef(onMoveTab);
  useEffect(() => {
    onMoveTabRef.current = onMoveTab;
  }, [onMoveTab]);
  const onDetachTabRef = useRef(onDetachTab);
  useEffect(() => {
    onDetachTabRef.current = onDetachTab;
  }, [onDetachTab]);
  const onActivateRef = useRef(onActivate);
  useEffect(() => {
    onActivateRef.current = onActivate;
  }, [onActivate]);

  // Arm the pending drag. Delegated on `.tab-list`, so a hit on any tab's
  // padding / title / gap arms it, while `.tab-close` hits do not.
  const onTabListPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLUListElement>): void => {
      if (!dragGestureEnabled) return;
      if (e.button !== 0) return;
      const target = e.target as HTMLElement | null;
      if (target === null) return;
      if (target.closest(".tab-close") !== null) return;
      const tabEl = target.closest<HTMLElement>("[data-tab-id]");
      if (tabEl === null) return;
      const id = tabEl.dataset.tabId;
      if (id === undefined) return;
      // DEF-411 — snapshot the pre-drag active tab and the dragged tab's
      // origin index at the moment the drag is armed, so the commit can
      // restore the active document the DEF-034 mousedown activation
      // overwrote.
      const list = tabListRef.current;
      const siblings = list === null
        ? []
        : Array.from(list.querySelectorAll<HTMLElement>("[data-tab-id]"));
      dragStartIndexRef.current = siblings.findIndex((n) => n.dataset.tabId === id);
      dragStartActiveRef.current = activeId ?? null;
      pendingDragRef.current = { id, startX: e.clientX, startY: e.clientY, pointerId: e.pointerId };
    },
    [dragGestureEnabled, activeId],
  );

  useEffect(() => {
    if (!dragGestureEnabled) return;

    const clearDrag = (): void => {
      document.body.classList.remove("tab-reordering");
      const el = tabListRef.current;
      if (el !== null) el.removeAttribute("data-tab-drop");
      draggingIdRef.current = null;
      dropIndexRef.current = null;
      setDraggingId(null);
      setDrop(null);
      setTearOut(false);
      setDragOffset(null);
      setDragWidth(0);
      setDragRect(null);
    };

    // Insert position in the list WITHOUT the dragged tab: number of other
    // tabs whose midpoint the pointer has passed. This is exactly the
    // index `moveTab` inserts at after splicing the dragged tab out.
    const computeDrop = (x: number): { index: number; left: number } | null => {
      const el = tabListRef.current;
      if (el === null) return null;
      const dragging = draggingIdRef.current;
      const others = Array.from(el.querySelectorAll<HTMLElement>("[data-tab-id]")).filter(
        (n) => n.dataset.tabId !== dragging,
      );
      if (others.length === 0) return null;
      const listRect = el.getBoundingClientRect();
      let index = others.length;
      let boundaryX = others[others.length - 1].getBoundingClientRect().right;
      for (let i = 0; i < others.length; i += 1) {
        const r = others[i].getBoundingClientRect();
        if (x < r.left + r.width / 2) {
          index = i;
          boundaryX = r.left;
          break;
        }
      }
      return { index, left: boundaryX - listRect.left + el.scrollLeft };
    };

    const onMove = (e: PointerEvent): void => {
      const pending = pendingDragRef.current;
      if (pending === null || e.pointerId !== pending.pointerId) return;

      if (draggingIdRef.current === null) {
        // DEF-412 — arm on TOTAL movement, not horizontal only: the actual
        // tear-out gesture is a straight-downward drag (near-zero dx), so a
        // horizontal-only threshold could never arm it.
        const dx = e.clientX - pending.startX;
        const dy = e.clientY - pending.startY;
        if (Math.hypot(dx, dy) <= 6) return; // not yet a drag
        draggingIdRef.current = pending.id;
        setDraggingId(pending.id);
        // Phase 60 — measure the dragged tab ONCE at arm time. Its width is
        // the gap the other tabs must open at the insertion slot; the tab box
        // itself then follows the pointer (see the offset below).
        const list = tabListRef.current;
        const draggedEl =
          list === null
            ? undefined
            : Array.from(list.querySelectorAll<HTMLElement>("[data-tab-id]")).find(
                (n) => n.dataset.tabId === pending.id,
              );
        setDragWidth(draggedEl?.getBoundingClientRect().width ?? 0);
        // DEF-432 — snapshot the dragged tab's natural geometry (relative to
        // the `.tab-area` containing block) plus its `<li>` reserve size before
        // the first drag transform lands, so the tear-out float can be applied
        // without a jump and the origin slot stays occupied.
        const tabBox = draggedEl?.getBoundingClientRect();
        const areaBox = list?.closest(".tab-area")?.getBoundingClientRect();
        const liBox = draggedEl?.parentElement?.getBoundingClientRect();
        setDragRect(
          tabBox === undefined
            ? null
            : {
                left: tabBox.left - (areaBox?.left ?? 0),
                top: tabBox.top - (areaBox?.top ?? 0),
                width: tabBox.width,
                height: tabBox.height,
                reserveWidth: liBox?.width ?? tabBox.width,
                reserveHeight: liBox?.height ?? tabBox.height,
              },
        );
        document.body.classList.add("tab-reordering");
      }

      // Phase 60 — the dragged tab tracks the pointer live. This is the raw
      // pointer delta from the grab point, written as a transform on the tab
      // box so the committed order / slot math below is untouched.
      setDragOffset({ x: e.clientX - pending.startX, y: e.clientY - pending.startY });

      const next = computeDrop(e.clientX);
      // DEF-412 — with a single tab `computeDrop` returns null (there is no
      // other tab to insert beside), but the tear-out affordance and the
      // release decision are independent of the tab count, so the gesture
      // must still track it. Only the insertion gap / reflow is skipped in
      // that case.
      if (next !== null) {
        dropIndexRef.current = next.index;
        setDrop(next);
      }
      // Phase 58 (chunk 6b) — the tear-out affordance. The decision
      // mirrors `tearOutDecision` at release time so the highlight only
      // appears when a release would actually detach.
      const list = tabListRef.current;
      if (list !== null) {
        const r = list.getBoundingClientRect();
        setTearOut(
          tearOutDecision({
            pointer: { x: e.clientX, y: e.clientY },
            strip: { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
            hasDetach: onDetachTabRef.current !== undefined,
          }) === "detach",
        );
      }
    };

    const finish = (commit: boolean, x: number, y: number): void => {
      pendingDragRef.current = null;
      const dragging = draggingIdRef.current;
      const startActive = dragStartActiveRef.current;
      const startIndex = dragStartIndexRef.current;
      // Clear the DEF-411 snapshot on every pointerup / pointercancel
      // alongside the other gesture state.
      dragStartActiveRef.current = null;
      dragStartIndexRef.current = null;
      if (dragging === null) return;
      // Phase 58 (chunk 6b) — a release past the tear-out threshold below
      // the strip detaches the tab into a new window and SKIPS the reorder
      // commit (and its DEF-411 restore). Everything else keeps the exact
      // Chunk-5 reorder behaviour below.
      const detachHandler = onDetachTabRef.current;
      if (commit && detachHandler !== undefined) {
        const list = tabListRef.current;
        if (list !== null) {
          const r = list.getBoundingClientRect();
          const decision = tearOutDecision({
            pointer: { x, y },
            strip: { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
            hasDetach: true,
          });
          if (decision === "detach") {
            detachHandler(dragging);
            clearDrag();
            return;
          }
        }
      }
      const target = dropIndexRef.current;
      const handler = onMoveTabRef.current;
      // DEF-412 — the reorder COMMIT (not the arm) owns the tab-count guard:
      // `onMoveTab` only fires for a real multi-tab reorder to a DIFFERENT
      // slot. With exactly one tab `computeDrop` sees no other tabs and
      // leaves `target` null, so a non-tear-out release is a harmless no-op
      // (never a meaningless `onMoveTab` with a bogus index); a same-slot
      // release was already a reducer identity. A genuine multi-tab move is
      // unaffected, so the Phase 58 reorder behaviour is unchanged.
      if (
        commit &&
        handler !== undefined &&
        tabs.length > 1 &&
        target !== null &&
        target !== startIndex
      ) {
        handler(dragging, target);
        // DEF-411 — the DEF-034 activation fired on the arming
        // pointerdown, so restore the pre-drag active tab after the
        // reorder commits. A plain click / tap never reaches here
        // (dragging stays null), and a dragged active tab needs no
        // restore (the reducer carries activeId through).
        if (shouldRestoreActiveOnReorder(startActive, dragging, startIndex, target)) {
          onActivateRef.current(startActive as string);
        }
      }
      clearDrag();
    };

    const onUp = (e: PointerEvent): void => finish(true, e.clientX, e.clientY);
    const onCancel = (): void => finish(false, 0, 0);

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return (): void => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, [dragGestureEnabled, tabs.length]);

  const currentThemeLabel = themeLabel(selected);

  // Phase 22 — the relocated Save control's state ladder. Identical
  // semantics to the CommandBar Save button it replaces: warning tint
  // + dot mark unsaved changes, success marks clean, and a read-only
  // source keeps the warning tint but stays disabled (Save-As is the
  // escape hatch). Titles are carried over verbatim so the tooltips
  // (accelerator hints included) survive the move.
  //
  // DEF-246 — Save As is a COPY, not an in-place save: saving a copy of
  // an unmodified document is a legitimate action, so the relocated
  // button is enabled whenever a document is open and disabled only on
  // the welcome screen (no document). That matches the other two routes
  // exactly: File -> Save As is enabled from `hasActiveDoc` and
  // Ctrl+Shift+S is gated on `tabs.activeId !== null`. Save's in-place
  // rules below are untouched.
  const saveTitle = !saveModified
    ? "Saved — no changes to save"
    : saveInPlaceEnabled
      ? "Unsaved changes — Save now (Ctrl+S)"
      : "Read-only document — use Save As to save a copy";
  const saveClass = !saveModified
    ? "titlebar-file-btn titlebar-file-btn-clean"
    : saveInPlaceEnabled
      ? "titlebar-file-btn titlebar-file-btn-modified"
      : "titlebar-file-btn titlebar-file-btn-modified titlebar-file-btn-readonly";

  // Phase 60 — the dragged tab's origin index in the CURRENT strip order. The
  // reflow is a pure function of (origin index, computed drop slot, dragged
  // width): every non-dragged tab between the origin and the target slot
  // shifts by the dragged width to close the origin hole / open the target
  // gap, and the drop slot is still the ONE source of truth (`computeDrop`).
  const draggingIndex = draggingId === null ? -1 : tabs.findIndex((t) => t.id === draggingId);
  const reflowFor = (index: number): number => {
    if (draggingId === null || dragWidth <= 0 || drop === null) return 0;
    if (index === draggingIndex) return 0;
    // Index in the list WITHOUT the dragged tab (the same frame `drop.index`
    // is computed in, and the frame `moveTab` inserts at).
    const reduced = index < draggingIndex ? index : index - 1;
    if (drop.index > draggingIndex) {
      return reduced >= draggingIndex && reduced < drop.index ? -dragWidth : 0;
    }
    if (drop.index < draggingIndex) {
      return reduced >= drop.index && reduced < draggingIndex ? dragWidth : 0;
    }
    return 0;
  };

  // Phase 7 — the "+ tab" button lives INSIDE the tab list as the
  // last <li>, so it renders immediately adjacent to the rightmost
  // tab (Phase 7 fix #2). The wrapper <li> keeps the button on the
  // same flex row as the tabs, with no gap-eating margin between
  // it and the last tab.
  return (
    <header className="app-header">
      <div className="brand">
        <BrandMark size={18} className="brand-mark" />
        <BrandWordmark className="brand-name" />
      </div>
      {/* Phase 22 — the FILE-ACTION group. Open + Save + Save As moved
       *  out of the CommandBar into the caption strip, immediately to
       *  the right of the Jovrel brand and to the left of the tab strip,
       *  as ONE grouped capsule sized to the title-bar ladder (28px
       *  controls). The stable e2e hooks move with the controls:
       *  [data-toolbar-open] / [data-toolbar-save] /
       *  [data-toolbar-save-as], so every spec that addressed them keeps
       *  resolving; only specs asserting the old command-bar PLACEMENT
       *  need repointing. */}
      <div className="titlebar-file" role="group" aria-label="File actions">
        <button
          type="button"
          className="titlebar-file-btn titlebar-file-open"
          onClick={onOpenFile}
          aria-label="Open PDF document"
          title="Open PDF (Ctrl+O)"
          data-toolbar-open
        >
          <Icon icon={FolderOpen} size="md" aria-hidden />
          <span className="titlebar-file-label">Open</span>
        </button>
        <span className="titlebar-file-sep" aria-hidden />
        <button
          type="button"
          className={saveClass}
          onClick={onSave}
          disabled={!saveModified || !saveInPlaceEnabled}
          title={saveTitle}
          aria-label="Save"
          data-toolbar-save
        >
          <Icon icon={APP_HEADER_GLYPHS.save.icon} size="md" aria-hidden />
          {/* The modified dot rides the tab strip's semantics: reserved
              slot, hidden (not unmounted) when the document is clean. */}
          <span
            className={saveModified ? "titlebar-file-dot" : "titlebar-file-dot titlebar-file-dot-hidden"}
            aria-hidden
          />
        </button>
        <button
          type="button"
          className="titlebar-file-btn"
          onClick={onSaveAs}
          disabled={activeId === null}
          title="Save a copy (Ctrl+Shift+S)"
          aria-label="Save a copy"
          data-toolbar-save-as
        >
          <Icon icon={APP_HEADER_GLYPHS.saveAll.icon} size="md" aria-hidden />
        </button>
      </div>
      <div className="tab-area" role="tablist" aria-label="Open documents" data-tab-style={tabStyle} data-tab-tearout={tearOut ? "true" : undefined}>
        <ul
          className="tab-list"
          ref={tabListRef}
          data-reorder={dragGestureEnabled ? "true" : undefined}
          data-tab-drop={drop !== null ? String(drop.index) : undefined}
          data-tab-tearout={tearOut ? "true" : undefined}
          data-dragging-tab={draggingId ?? undefined}
          onPointerDown={dragGestureEnabled ? onTabListPointerDown : undefined}
          // Phase 58 (chunk 6b) — the tear-out affordance. Token-based
          // inline styling (the chunk's file scope excludes styles.css):
          // a dashed accent outline marks the strip as a "release here to
          // detach" target while the drag is past the threshold.
          style={{
            ...(tabOverflowStyle ?? {}),
            ...(tearOut
              ? {
                  outline: "2px dashed var(--accent)",
                  outlineOffset: "-2px",
                  transition:
                    "outline-color var(--motion-duration-fast, 200ms) var(--motion-ease-standard, ease)",
                }
              : {}),
          }}
        >
          {/* Cross-theme animation system — one presence boundary owns
              every tab: new tabs play Tab Materialize (opacity in),
              closed tabs play Tab Dissolve (opacity out) before the li
              unmounts. `initial={false}` keeps the page-load tabs from
              animating — only tabs opened during the session
              materialize. */}
          <AnimatePresence initial={false}>
            {tabs.map((tab, index) => {
              const isActive = tab.id === activeId;
              const isDragging = tab.id === draggingId;
              return (
                <AnimatedTab
                  key={tab.id}
                  id={tab.id}
                  title={tab.title}
                  active={isActive}
                  modified={tab.modified}
                  // Phase 45 (item 2) — the per-tab colour is the strip
                  // POSITION's palette slot, so the assignment is
                  // deterministic and neighbours can never collide.
                  colourSlot={tabColourSlot(index)}
                  // Phase 60 — direct manipulation: the dragged tab follows
                  // the pointer, every other tab opens the insertion gap.
                  dragging={isDragging}
                  dragOffset={isDragging ? dragOffset : null}
                  // DEF-432 — while torn out the dragged tab floats out of the
                  // `.tab-list` (absolute against `.tab-area`), which clips its
                  // own overflow (`overflow: hidden`) and keeps the strip from
                  // scrolling.
                  floating={isDragging && tearOut}
                  floatRect={isDragging ? dragRect : null}
                  reflowPx={reflowFor(index)}
                  onActivate={onActivate}
                  onClose={onClose}
                />
              );
            })}
          </AnimatePresence>
          {/* Phase 60 — the static `.tab-drop-marker` line is REPLACED by
              direct manipulation: the dragged tab rides the pointer and the
              other tabs reflow to open the insertion gap (see AnimatedTab).
              `data-tab-drop` on `.tab-list` still exposes the slot. */}
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
            <li
              className="tab-list-new"
              title={multiModeEnabled ? NEW_TAB_MULTI_MODE_REASON : undefined}
            >
              <button
                type="button"
                className="tab-new"
                onMouseDown={onNewTabMouseDown}
                onClick={onNewEmptyTab}
                // DEF-288 — while Multi Mode is on the strip shows ONE
                // composite workspace tab; a new empty tab could not be
                // seen until the mode was left, so the control is disabled
                // and carries the reason instead of mutating hidden state.
                disabled={multiModeEnabled}
                aria-label={multiModeEnabled ? NEW_TAB_MULTI_MODE_REASON : "New empty tab"}
                title={multiModeEnabled ? NEW_TAB_MULTI_MODE_REASON : "New empty tab"}
                data-new-tab
              >
                <Icon icon={Plus} size="md" aria-hidden />
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
        {/* Phase 40 (item 5) — the TWO distinct search affordances, leading
            the trailing chrome cluster. The Ctrl+K icon uses the command
            glyph (the command-palette symbol) and opens the SAME surface as
            the Ctrl+K chord; the Ctrl+F icon is a magnifier and opens the
            focused pane's find bar. Different glyph, different surface, and
            each accessible name names its shortcut so they cannot be
            confused. */}
        {onOpenToolSearch !== undefined && (
          <button
            type="button"
            className="header-tool-search"
            onClick={onOpenToolSearch}
            aria-haspopup="dialog"
            aria-label={TOOL_SEARCH_ACCESSIBLE_NAME}
            title="Search tools and commands (Ctrl+K)"
            data-header-tool-search
          >
            <Icon icon={APP_HEADER_GLYPHS.command.icon} size="md" aria-hidden />
          </button>
        )}
        {onOpenFind !== undefined && (
          <button
            type="button"
            className="header-find"
            onClick={onOpenFind}
            disabled={!findEnabled}
            aria-label={FIND_IN_DOCUMENT_ACCESSIBLE_NAME}
            title={findEnabled ? "Find in document (Ctrl+F)" : "Open a document to search it"}
            data-header-find
          >
            <Icon icon={APP_HEADER_GLYPHS.search.icon} size="md" aria-hidden />
          </button>
        )}
        {/* Phase 36 (chunk 6) — the Multi Mode toggle, moved into the title
            bar (its approved home; the palette keeps its own route through
            the registry's `multiModeToggle`). `data-multi-mode-active`
            mirrors the retired CommandBar control's hook. */}
        {onMultiModeToggle !== undefined && (
          <button
            type="button"
            className="header-multi-mode"
            onClick={onMultiModeToggle}
            aria-pressed={multiModeEnabled}
            // Phase 40 (item 8) — the tooltip and the accessible name both
            // name VIEW and EDIT: the mode is not read-only, each pane's
            // canvas keeps its edit surfaces.
            aria-label={MULTI_MODE_ACCESSIBLE_NAME}
            title={
              multiModeEnabled
                ? 'Multi Mode on — view/edit two documents side by side. Click to return to one document.'
                : 'Multi Mode: view/edit two documents side by side in one workspace'
            }
            data-header-multi-mode
            data-multi-mode-active={multiModeEnabled ? 'true' : 'false'}
          >
            <Icon icon={APP_HEADER_GLYPHS.multiMode.icon} size="md" aria-hidden />
          </button>
        )}
        {/* Phase 30 — Print, immediately left of the settings gear. Same
            surface as File > Print and Ctrl+P. Icon-only chrome control
            (aria-label + title tooltip), matching the shared header
            a11y contract. */}
        <button
          type="button"
          className="header-print"
          onClick={onPrint}
          disabled={activeId === null || !printEnabled}
          aria-haspopup="dialog"
          aria-label="Print"
          title={printEnabled ? "Print (Ctrl+P)" : "Open a document to print"}
          data-print
        >
            <Icon icon={APP_HEADER_GLYPHS.printer.icon} size="md" aria-hidden />
        </button>
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
          <Icon icon={APP_HEADER_GLYPHS.settings.icon} size="md" aria-hidden />
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
            <Icon icon={themeIcon(selected)} size="md" aria-hidden />
            <span className="theme-toggle-label">{currentThemeLabel}</span>
            <Icon icon={APP_HEADER_GLYPHS.chevronDown.icon} size="md" aria-hidden />
          </button>
          <AnimatePresence>
            {themeMenuOpen && (
              <TfMorph
                morph={themeMorph}
                ref={themePopoverRef}
                className="theme-toggle-popover"
                role="menu"
                aria-label="Change theme"
                onKeyDown={onThemePopoverKeyDown}
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
                        {isSelected && <Icon icon={Check} size="md" />}
                      </span>
                      <span className="theme-toggle-option-label">{opt.label}</span>
                    </button>
                  );
                })}
              </TfMorph>
            )}
          </AnimatePresence>
        </div>
        {/* Phase 44 (operator amendment) — the account section, at the true
         *  trailing edge (top-right). The host builds the whole AccountMenu
         *  (sign-in entry, or round avatar + anchored panel). */}
        {accountSlot}
        {/* Phase 14.1 — the Open button MOVED to the command bar
         *  (CommandBar's accent File group). The header-actions cluster
         *  is [update indicator | gear | theme | account] — the caption
         *  strip's app-level controls only. */}
      </div>
    </header>
  );
}