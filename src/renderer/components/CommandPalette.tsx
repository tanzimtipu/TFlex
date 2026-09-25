// Phase 36 (chunk 4) — the Command Palette.
//
// `Ctrl+K` (with `Ctrl+Shift+P` kept as the legacy All-tools alias) opens this
// modal surface: fuzzy search over EVERY registry tool, the recent files and
// the view actions, ranked by match quality and then by the persisted
// `toolUsage` frequency. `Enter` runs the highlighted result through the
// host's EXISTING handlers, `Ctrl+Enter` pins it to the Action Dock through
// the SAME `dockPins` writer the dock uses, and `Ctrl+P` is deliberately
// untouched — it stays the Print shortcut.
//
// Structure: a full-window LAYER (the dim film, `pointer-events: none`) plus
// the palette BOX at the top of the window. The layer never claims pointer
// events, so the rest of the app stays reachable while the palette is open;
// an outside mousedown simply closes it (a document listener that neither
// preventDefaults nor stops propagation, per the cross-bubbling rules). The
// box itself is `pointer-events: auto`.
//
// This component owns no command: every row's action resolves through the
// registry's `action` in the host's run map, and an entry with no command
// anywhere renders DISABLED with the reason copy the Action Dock already
// shows. Nothing here is a second implementation of anything.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, MouseEvent as ReactMouseEvent, ReactElement } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Pin, Search } from 'lucide-react';
import {
  PALETTE_DOCK_FULL_MESSAGE,
  STAGE_TAG_LABELS,
  buildPaletteRows,
  firstActionableIndex,
  isRowActionable,
  paletteNavFor,
  stepHighlightEnabled,
  type PaletteRecentFile,
  type PaletteRow,
} from '../state/commandPalette';
import { palettePinAllowed } from '../state/dockModel';
import type { ToolEntry } from '../state/toolsRegistry';
import { useBackdropFadeAnimation, useCommandPaletteAnimation } from '../hooks/useAnimations';

/** The footer hint the spec names verbatim. */
export const PALETTE_KEY_HINT = '\u2191\u2193 navigate \u00b7 \u21b5 run \u00b7 Ctrl+Enter pin to dock';

const LIST_ID = 'tflex-command-palette-list';

/** Stable empties: a fresh `[]` default would churn the memoised row list on
 *  every render (and re-anchor the highlight with it). */
const NO_PINS: readonly string[] = [];
const NO_RECENTS: readonly PaletteRecentFile[] = [];

export interface CommandPaletteProps {
  /** Mount/unmount switch (the host owns the open state). */
  open: boolean;
  onClose: () => void;
  /** Run a registry tool id. The host routes it through the SAME handlers the
   *  dock / toolbar / menu already use. */
  onRunTool: (id: string) => void;
  /** Pin a registry tool id to the dock (the host's `dockPins` writer). */
  onPinTool: (id: string) => void;
  /** Phase 40 (item 6) — unpin a registry tool id from the dock (the host's
   *  `dockUnpinned`/pin-removal writer). The row's pin affordance is a real
   *  TOGGLE, so the palette needs both directions of the same store. */
  onUnpinTool?: (id: string) => void;
  /** The persisted, registry-validated dock pins (max 4) — drives the pinned
   *  marker and the full-dock refusal. */
  dockPins?: readonly string[];
  /** DEF-352 — whether the id is part of the FOCUSED stage's default dock set.
   *  A restore of a removed stage default writes no explicit pin, so it is
   *  allowed even at the 4-pin cap; only a cross-stage pin consumes a slot. */
  isStageDefault?: (id: string) => boolean;
  /** Phase 40 (item 6) — the host's TRUE dock membership (explicit pin OR a
   *  focused-stage default the user has not un-pinned). Drives the pin
   *  toggle's icon/state; absent falls back to `dockPins` membership. */
  isToolPinned?: (id: string) => boolean;
  /** Live availability gate, same contract as the Action Dock. */
  isToolEnabled?: (entry: ToolEntry) => boolean;
  /** DEF-327 — the SAME live refusal copy the Action Dock shows, so a disabled
   *  row explains itself with the dock's reason ("Turn on Edit content first"). */
  disabledReasonFor?: (entry: ToolEntry) => string | undefined;
  /** Per-tool run counts — the frequency boost. */
  toolUsage?: Readonly<Record<string, number>> | undefined;
  /** The recent-file rows (the host's live Recents list). */
  recentFiles?: readonly PaletteRecentFile[];
  onOpenRecent?: (path: string) => void;
  /** The searchable corpus. Defaults to the single registry. */
  entries?: readonly ToolEntry[];
}

export function CommandPalette(props: CommandPaletteProps): ReactElement {
  const {
    open,
    onClose,
    onRunTool,
    onPinTool,
    onUnpinTool,
    dockPins = NO_PINS,
    isToolEnabled,
    disabledReasonFor,
    toolUsage,
    recentFiles = NO_RECENTS,
    onOpenRecent,
    isToolPinned,
    isStageDefault,
    entries,
  } = props;

  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  // The availability gate is read through a ref: the host rebuilds that
  // callback whenever any live App state it reads changes, and rebuilding the
  // row list on that churn would re-anchor the highlight under the user's
  // fingers. The gate itself is still consulted on every rebuild.
  const gateRef = useRef(isToolEnabled);
  gateRef.current = isToolEnabled;
  const reasonRef = useRef(disabledReasonFor);
  reasonRef.current = disabledReasonFor;

  // DEF-327 — `open` is a dependency: opening the palette must present the
  // CURRENT availability (an undo stack that filled up, Edit mode that went on,
  // an OCR run that finished). The gate itself is still read through a ref so
  // host-state churn cannot re-anchor the highlight mid-list.
  const rows = useMemo<PaletteRow[]>(
    () =>
      buildPaletteRows({
        query,
        recents: recentFiles,
        usage: toolUsage,
        dockPins,
        isToolPinned,
        isToolEnabled: (entry): boolean => gateRef.current?.(entry) ?? true,
        disabledReasonFor: (entry): string | undefined => reasonRef.current?.(entry),
        entries,
      }),
    [open, query, recentFiles, toolUsage, dockPins, isToolPinned, entries],
  );

  // Opening resets the surface: an empty query, the first runnable row
  // highlighted, no stale notice, and the input focused so the user can just
  // type. `rows` is read through a ref so this effect does not re-run (and
  // does not steal focus back) on every keystroke.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  useEffect((): void => {
    if (!open) return;
    setQuery('');
    setNotice(null);
    setHighlight(firstActionableIndex(rowsRef.current));
    const input = inputRef.current;
    if (input !== null) {
      input.focus();
      input.select();
    }
  }, [open]);

  // A new QUERY re-anchors the highlight on the first runnable row. Every
  // other row-list change (a completed pin flipping the pinned marker, a
  // usage bump) leaves the user's highlight where it was.
  useEffect((): void => {
    setHighlight(firstActionableIndex(rowsRef.current));
  }, [query]);

  // A shrinking list (the query narrowed it) can leave the index past the
  // end; clamp it so Enter never addresses a row that is not there.
  useEffect((): void => {
    if (highlight >= rows.length) setHighlight(Math.max(0, rows.length - 1));
  }, [rows.length, highlight]);

  const runRow = useCallback(
    (row: PaletteRow): void => {
      if (!isRowActionable(row)) return;
      if (row.kind === 'recent') {
        onOpenRecent?.(row.path);
        onClose();
        return;
      }
      onRunTool(row.id);
      onClose();
    },
    [onOpenRecent, onRunTool, onClose],
  );

  const pinRow = useCallback(
    (row: PaletteRow): void => {
      if (row.kind !== 'tool' || !row.enabled) return;
      if (row.pinned) {
        setNotice(`${row.entry.label} is already pinned`);
        return;
      }
      if (!palettePinAllowed({ pins: dockPins, isStageDefault: isStageDefault?.(row.id) ?? false })) {
        setNotice(PALETTE_DOCK_FULL_MESSAGE);
        return;
      }
      onPinTool(row.id);
      setNotice(`Pinned ${row.entry.label} to the dock`);
    },
    [dockPins, onPinTool, isStageDefault],
  );

  // Phase 40 (item 6) — the row's pin affordance is a real TOGGLE. The event is
  // stopped from reaching the row, so a pin click NEVER runs the tool and NEVER
  // closes the palette; it only flips the dock store. The cap applies on the
  // PIN direction only (removing a pin can never overflow). Both writers are the
  // host's existing `dockPins`/`dockUnpinned` path (`pinDockTool` /
  // `unpinDockTool`), so the state persists across a restart.
  const togglePinRow = useCallback(
    (row: PaletteRow, event: ReactMouseEvent<HTMLButtonElement>): void => {
      // Keep the click off the row's run handler and off the palette's
      // document-level outside-mousedown listener (the button is inside the
      // box, so the latter would not close anyway — this is the run guard).
      event.stopPropagation();
      if (row.kind !== 'tool' || !row.enabled) return;
      if (row.pinned) {
        if (onUnpinTool === undefined) {
          setNotice(`${row.entry.label} is pinned to the dock`);
          return;
        }
        onUnpinTool(row.id);
        setNotice(`Unpinned ${row.entry.label} from the dock`);
        return;
      }
      if (!palettePinAllowed({ pins: dockPins, isStageDefault: isStageDefault?.(row.id) ?? false })) {
        setNotice(PALETTE_DOCK_FULL_MESSAGE);
        return;
      }
      onPinTool(row.id);
      setNotice(`Pinned ${row.entry.label} to the dock`);
    },
    [dockPins, onPinTool, onUnpinTool, isStageDefault],
  );

  const runHighlighted = useCallback((): void => {
    const row = rowsRef.current[highlight];
    if (row !== undefined) runRow(row);
  }, [highlight, runRow]);

  const pinHighlighted = useCallback((): void => {
    const row = rowsRef.current[highlight];
    if (row !== undefined) pinRow(row);
  }, [highlight, pinRow]);

  // The keys the OPEN palette owns. `paletteNavFor` returns null for every
  // other key — including `Ctrl+P`, which must reach the print path untouched.
  //
  // DEF-331 — the palette is the TOP-most surface while it is open, so its
  // Escape is handled in the CAPTURE phase and stops there: a dialog left open
  // underneath (Stamp, Preferences, a confirm) must not receive the same press.
  // Both surfaces listen on `window`; the dialog is registered first, so a
  // bubble-phase handler would close the dialog and leave the palette. Capture
  // reaches the palette first, and `stopPropagation` keeps the press from
  // falling through — a SECOND Escape reaches the dialog.
  useEffect((): (() => void) | undefined => {
    if (!open) return undefined;
    const onKey = (event: KeyboardEvent): void => {
      const nav = paletteNavFor(event);
      if (nav === null) return;
      if (nav === 'close') {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      event.preventDefault();
      if (nav === 'next' || nav === 'prev') {
        setHighlight((current) =>
          stepHighlightEnabled(rowsRef.current, current, nav === 'next' ? 1 : -1),
        );
        return;
      }
      if (nav === 'run') runHighlighted();
      else pinHighlighted();
    };
    window.addEventListener('keydown', onKey, true);
    return (): void => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose, runHighlighted, pinHighlighted]);

  // Outside click closes. The listener is passive in the event sense: it never
  // calls preventDefault / stopPropagation, so the gesture still reaches its
  // own target (the cross-bubbling rule) and the palette never swallows a
  // click the user aimed at the app behind it.
  useEffect((): (() => void) | undefined => {
    if (!open) return undefined;
    const onMouseDown = (event: MouseEvent): void => {
      const box = boxRef.current;
      if (box !== null && event.target instanceof Node && box.contains(event.target)) return;
      onClose();
    };
    document.addEventListener('mousedown', onMouseDown);
    return (): void => document.removeEventListener('mousedown', onMouseDown);
  }, [open, onClose]);

  const pop = useCommandPaletteAnimation();
  const layerFade = useBackdropFadeAnimation();

  const activeRow = rows[highlight];
  const activeId =
    activeRow === undefined ? undefined : `${LIST_ID}-option-${activeRow.key}`;

  const onInputChange = useCallback((event: ChangeEvent<HTMLInputElement>): void => {
    setQuery(event.target.value);
    setNotice(null);
  }, []);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="command-palette-layer"
          data-command-palette-layer
          variants={layerFade}
          initial="initial"
          animate="animate"
          exit="exit"
        >
          <motion.div
            ref={boxRef}
            className="command-palette"
            data-command-palette
            data-command-palette-count={rows.length}
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            variants={pop}
            initial="initial"
            animate="animate"
            exit="exit"
          >
            <div className="command-palette-search">
              <Search size={15} aria-hidden />
              <input
                ref={inputRef}
                className="command-palette-input"
                data-command-palette-input
                type="text"
                role="combobox"
                aria-label="Search tools, recent files and view actions"
                aria-autocomplete="list"
                aria-expanded="true"
                aria-controls={LIST_ID}
                aria-activedescendant={activeId}
                placeholder="Search tools, files and actions..."
                value={query}
                onChange={onInputChange}
              />
            </div>
            <ul
              className="command-palette-list"
              id={LIST_ID}
              role="listbox"
              aria-label="Results"
            >
              {rows.length === 0 && (
                <li className="command-palette-empty" data-command-palette-empty>
                  No matching tools
                </li>
              )}
              {rows.map((row, index) => (
                <PaletteRowItem
                  key={row.key}
                  row={row}
                  index={index}
                  listId={LIST_ID}
                  highlighted={index === highlight}
                  onHover={setHighlight}
                  onRun={runRow}
                  onTogglePin={togglePinRow}
                />
              ))}
            </ul>
            <div className="command-palette-footer">
              <span className="command-palette-hint" data-command-palette-hint>
                {PALETTE_KEY_HINT}
              </span>
              {notice !== null ? (
                <span
                  className="command-palette-notice"
                  data-command-palette-notice
                  role="status"
                >
                  {notice}
                </span>
              ) : (
                <span className="command-palette-count">
                  {rows.length} {rows.length === 1 ? 'result' : 'results'}
                </span>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

interface PaletteRowItemProps {
  row: PaletteRow;
  index: number;
  listId: string;
  highlighted: boolean;
  onHover: (index: number) => void;
  onRun: (row: PaletteRow) => void;
  onTogglePin: (row: PaletteRow, event: ReactMouseEvent<HTMLButtonElement>) => void;
}

/** One row: the semantic icon + label, the right-aligned stage tag (tools),
 *  the shortcut text, and — Phase 40 (item 6) — the pin TOGGLE beside every
 *  tool. Disabled rows are rendered `aria-disabled` with the reason in `title`
 *  and carry no click handler, so a click on them is inert by construction
 *  rather than a silent no-op. */
function PaletteRowItem(props: PaletteRowItemProps): ReactElement {
  const { row, index, listId, highlighted, onHover, onRun, onTogglePin } = props;
  const actionable = isRowActionable(row);
  const id = `${listId}-option-${row.key}`;

  if (row.kind === 'recent') {
    return (
      <li
        id={id}
        className="command-palette-row"
        data-palette-row="recent"
        role="option"
        aria-selected={highlighted}
        onMouseEnter={(): void => onHover(index)}
        onClick={(): void => onRun(row)}
      >
        <span className="command-palette-row-label">{row.label}</span>
        <span className="command-palette-row-path">{row.path}</span>
        <span className="command-palette-tag" data-stage="recent">
          Recent
        </span>
      </li>
    );
  }

  const Icon = row.entry.icon;
  return (
    <li
      id={id}
      className={
        row.enabled ? 'command-palette-row' : 'command-palette-row command-palette-row-disabled'
      }
      data-palette-row="tool"
      data-palette-tool-id={row.id}
      data-stage={row.entry.stage}
      data-palette-pinned={row.pinned ? 'true' : 'false'}
      data-palette-disabled={row.enabled ? 'false' : 'true'}
      role="option"
      aria-selected={highlighted}
      aria-disabled={!row.enabled || undefined}
      title={row.reason ?? row.entry.description}
      onMouseEnter={(): void => onHover(index)}
      onClick={actionable ? (): void => onRun(row) : undefined}
    >
      <span className="command-palette-row-icon" aria-hidden>
        <Icon size={15} />
      </span>
      <span className="command-palette-row-label">{row.entry.label}</span>
      <span className="command-palette-row-desc">{row.reason ?? row.entry.description}</span>
      {/* Phase 40 (item 6) — the pin TOGGLE. Its glyph is a solid, upright pin
          when the tool is in the dock and an outline, 45deg-tilted pin when it
          is not, so the state reads by SHAPE as well as by colour. The click
          handler stops propagation, so a pin click never runs the row. */}
      <button
        type="button"
        className={
          row.pinned
            ? 'command-palette-pin-toggle command-palette-pin-toggle-on'
            : 'command-palette-pin-toggle'
        }
        data-palette-pin-toggle
        data-palette-pin-state={row.pinned ? 'pinned' : 'unpinned'}
        {...(row.pinned ? { 'data-palette-pin': 'true' } : {})}
        aria-pressed={row.pinned}
        aria-label={
          row.pinned
            ? `Unpin ${row.entry.label} from the dock`
            : `Pin ${row.entry.label} to the dock`
        }
        title={
          row.pinned
            ? `Unpin ${row.entry.label} from the dock`
            : `Pin ${row.entry.label} to the dock`
        }
        disabled={!row.enabled}
        onClick={(event): void => onTogglePin(row, event)}
      >
        <span className="command-palette-pin-glyph" data-pin-state={row.pinned ? 'pinned' : 'unpinned'}>
          <Pin
            size={13}
            fill={row.pinned ? 'currentColor' : 'none'}
            className={row.pinned ? 'pin-glyph-pinned' : 'pin-glyph-unpinned'}
            aria-hidden
          />
        </span>
      </button>
      {row.entry.shortcut.length > 0 && (
        <span className="command-palette-shortcut">{row.entry.shortcut}</span>
      )}
      <span className="command-palette-tag" data-stage={row.entry.stage}>
        {STAGE_TAG_LABELS[row.entry.stage]}
      </span>
    </li>
  );
}
