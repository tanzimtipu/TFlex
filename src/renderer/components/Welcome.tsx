import type { ReactElement } from "react";
import { File, FilePlus2, FolderOpen, Minus, Pencil, Plus, Sparkles, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RecentFile, SampleDocument } from "../../shared/types";
import { formatOpenedAt } from "../utils/recentPath";
import { toolById } from "../state/toolsRegistry";
import {
  DEFAULT_HOME_TOOLS,
  HOME_FIXED_TOOL_ID,
  HOME_TOOLS_MAX,
  addHomeTool,
  removeHomeTool,
} from "../state/homeTools";
import { BrandMark } from "./BrandMark";
import { BrandWordmark } from "./BrandWordmark";

/** DEF-410 — fallback home-picker box used before the portal is measured (or in
 *  jsdom, which reports zero-size rects). Only affects the viewport clamp. */
export const HOME_PICKER_W = 200;
export const HOME_PICKER_H = 168;

/**
 * DEF-410 — place the Home picker against the plus button's viewport box. The
 * portal lives on `document.body`, so the box is positioned with
 * `position: fixed` in VIEWPORT space: right edge aligned to the plus, opened
 * just below it, and clamped into the viewport (8px gutter). Pure and
 * viewport-agnostic so the geometry is unit-testable without a browser.
 */
export function placeHomePicker(
  anchor: { right: number; bottom: number },
  menuW: number,
  menuH: number,
  viewportW: number,
  viewportH: number,
  margin = 8,
): { left: number; top: number } {
  const left = Math.min(
    Math.max(margin, anchor.right - menuW),
    Math.max(margin, viewportW - menuW - margin),
  );
  const top = Math.min(
    Math.max(margin, anchor.bottom + 6),
    Math.max(margin, viewportH - menuH - margin),
  );
  return { left, top };
}

interface RecentDisplay {
  entry: RecentFile;
  meta: { name: string; dir: string; isSample: boolean };
}

interface WelcomeProps {
  recentFiles: RecentDisplay[];
  onOpenRecent: (entry: RecentFile) => void;
  onRemoveRecent: (entry: RecentFile) => void;
  onOpenFile: () => void;
  onSampleClick: (sample: SampleDocument) => void;
  onMergeClick?: () => void;
  /** Phase 9 — Create-from-images entry. Renders alongside the
   *  existing Open PDF / Merge PDFs buttons on the welcome hero.
   *  Optional: callers that don't yet wire the Phase 9 dialog can
   *  omit the prop and the button stays hidden. */
  onCreateFromImages?: () => void;
  /** Phase 58 (chunk 4) — the editable home tool row. Order of the REMOVABLE
   *  tiles (the fixed Open tile is always first). Absent uses the shipped row. */
  homeTools?: readonly string[];
  /** Registry ids the plus picker may offer (tools that run with no document
   *  open). The fixed Open id is filtered out defensively. */
  homeCandidates?: readonly string[];
  /** Run a home-tile tool by registry id (the host maps ids to its handlers). */
  onRunHomeTool?: (id: string) => void;
  /** Persist a new home-tool list (remove / add). */
  onSetHomeTools?: (ids: string[]) => void;
  samplesResolver: () => Promise<SampleDocument[]>;
}

export function Welcome(props: WelcomeProps): ReactElement {
  const {
    recentFiles,
    onOpenRecent,
    onRemoveRecent,
    onOpenFile,
    onSampleClick,
    onMergeClick,
    onCreateFromImages,
    homeTools,
    homeCandidates,
    onRunHomeTool,
    onSetHomeTools,
    samplesResolver,
  } = props;
  const [samples, setSamples] = useState<SampleDocument[] | null>(null);
  /** Phase 58 (chunk 4) — the home row's EDIT mode: the pen arms it, every
   *  removable tile grows a minus affordance and the plus opens the picker. */
  const [editMode, setEditMode] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  /** DEF-410 — the plus button's viewport box captured at open time, and the
   *  clamped viewport position of the portaled picker. */
  const [pickerAnchor, setPickerAnchor] = useState<{ right: number; bottom: number } | null>(
    null,
  );
  const [pickerPos, setPickerPos] = useState<{ left: number; top: number } | null>(null);
  const plusRef = useRef<HTMLButtonElement | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void samplesResolver().then((list) => {
      if (!cancelled) setSamples(list);
    });
    return (): void => {
      cancelled = true;
    };
  }, [samplesResolver]);

  // Phase 58 / DEF-410 — Escape closes the picker FIRST when it is open and
  // leaves EDIT mode armed (a second Escape then exits EDIT mode). A targeted
  // document keydown while edit mode is on; it never swallows events otherwise.
  useEffect((): (() => void) | undefined => {
    if (!editMode) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (pickerOpen) {
        setPickerOpen(false);
        return;
      }
      setEditMode(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return (): void => document.removeEventListener("keydown", onKeyDown);
  }, [editMode, pickerOpen]);

  // DEF-410 — dismiss the picker on an outside pointerdown. The event is never
  // swallowed (cross-bubbling rules): an outside press still reaches its own
  // target, so closing the picker can never eat a click. A press on the plus is
  // left to the plus's own onClick toggle (so one press never closes-then-reopens).
  useEffect((): (() => void) | undefined => {
    if (!pickerOpen) return undefined;
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (pickerRef.current?.contains(target) === true) return;
      if (plusRef.current?.contains(target) === true) return;
      setPickerOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return (): void => document.removeEventListener("pointerdown", onPointerDown);
  }, [pickerOpen]);

  // DEF-410 — clamp the portaled picker into the viewport once it is measured.
  // A layout effect so the real box is measured BEFORE paint (the node renders
  // hidden until this first pass sets a position); the fallback box keeps the
  // clamp meaningful when the platform reports no layout (jsdom).
  useLayoutEffect((): void => {
    if (!pickerOpen || pickerAnchor === null) {
      setPickerPos(null);
      return;
    }
    const el = pickerRef.current;
    const w = el === null || el.offsetWidth === 0 ? HOME_PICKER_W : el.offsetWidth;
    const h = el === null || el.offsetHeight === 0 ? HOME_PICKER_H : el.offsetHeight;
    setPickerPos(
      placeHomePicker(pickerAnchor, w, h, window.innerWidth, window.innerHeight),
    );
  }, [pickerOpen, pickerAnchor]);

  const openPicker = (): void => {
    const r = plusRef.current?.getBoundingClientRect();
    setPickerAnchor({ right: r?.right ?? 0, bottom: r?.bottom ?? 0 });
    setPickerOpen(true);
  };
  const togglePicker = (): void => {
    if (pickerOpen) {
      setPickerOpen(false);
      return;
    }
    openPicker();
  };

  const tools: readonly string[] =
    homeTools === undefined ? DEFAULT_HOME_TOOLS : homeTools;
  const full = tools.length >= HOME_TOOLS_MAX;
  const shown = new Set(tools);
  const pickerEntries = (homeCandidates ?? [])
    .filter((id) => id !== HOME_FIXED_TOOL_ID && !shown.has(id))
    .flatMap((id) => {
      const entry = toolById(id);
      return entry === undefined ? [] : [entry];
    });

  const recentCount = recentFiles.length;
  const sampleCount = samples?.length ?? 0;

  // Phase 58 (chunk 4) — the fixed Open tile and each removable tile run the
  // host's registry-keyed handler. A legacy mount (no `onRunHomeTool`) keeps
  // the pre-row create/merge props working; any tile without a runner renders
  // disabled with a reason rather than a dead click.
  const legacyRuns: Record<string, (() => void) | undefined> = {
    createFromImages: onCreateFromImages,
    merge: onMergeClick,
  };
  const runnerFor = (id: string): (() => void) | undefined =>
    onRunHomeTool === undefined ? legacyRuns[id] : (): void => onRunHomeTool(id);
  const OpenIcon = toolById(HOME_FIXED_TOOL_ID)?.icon ?? FolderOpen;

  return (
    <div className="welcome">
      <div className="welcome-hero">
        <div className="welcome-brand">
          <BrandMark size={24} className="welcome-brand-mark" />
          <BrandWordmark className="welcome-brand-name" />
        </div>
        <h1 className="welcome-title">A modern PDF studio for Windows.</h1>
        <p className="welcome-sub">
          Open a document to begin, or pick one of the samples below to see Jovrel
          in action. Search and navigation are keyboard-driven; everything you
          need lives one click away.
        </p>
        {/* Phase 58 (chunk 4) — the editable home tool row. The first tile is
            the FIXED Open action (primary, never removable); the rest are the
            persisted `homeTools` ids. The pen arms EDIT mode: every removable
            tile grows a minus badge and the plus at the row's right opens the
            picker. Tiles keep the home box shape (`.btn`, 36px) and borrow the
            dock registry's icon/colour per id. */}
        <div
          className={editMode ? "welcome-actions home-tools anim-vibrate" : "welcome-actions home-tools"}
          data-home-tools
          data-home-edit={editMode ? "true" : "false"}
        >
          <button
            type="button"
            className="btn btn-primary home-tool home-tool-fixed"
            data-home-tool={HOME_FIXED_TOOL_ID}
            onClick={onOpenFile}
          >
            <OpenIcon size={16} aria-hidden /> Open PDF
            <span className="kbd" style={{ marginLeft: 8 }}>Ctrl O</span>
          </button>
          {tools.map((id) => {
            const entry = toolById(id);
            if (entry === undefined) return null;
            const Icon = entry.icon;
            const run = runnerFor(id);
            return (
              <button
                key={id}
                type="button"
                className="btn btn-secondary home-tool"
                data-home-tool={id}
                disabled={run === undefined}
                title={run === undefined ? "Not available on the Home screen" : entry.description}
                onClick={(): void => run?.()}
              >
                <Icon size={16} aria-hidden /> {entry.label}
                {editMode && (
                  <span
                    className="home-tool-minus"
                    role="button"
                    tabIndex={0}
                    aria-label={`Remove ${entry.label} from the home row`}
                    data-home-minus={id}
                    onClick={(e): void => {
                      e.stopPropagation();
                      e.preventDefault();
                      onSetHomeTools?.(removeHomeTool(tools, id));
                    }}
                    onKeyDown={(e): void => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        e.stopPropagation();
                        onSetHomeTools?.(removeHomeTool(tools, id));
                      }
                    }}
                  >
                    <Minus size={12} aria-hidden />
                  </span>
                )}
              </button>
            );
          })}
          {editMode && (
            <div className="home-tools-add">
              <button
                ref={plusRef}
                type="button"
                className="home-tools-plus"
                data-home-plus
                aria-haspopup="menu"
                aria-expanded={pickerOpen}
                aria-label="Add a tool to the home row"
                title={full ? "Home row is full (max 14 tools)" : "Add a tool to the home row"}
                disabled={full}
                onClick={togglePicker}
              >
                <Plus size={16} aria-hidden />
              </button>
              {/* DEF-410 — the picker is PORTALED to document.body. The row's
                  `anim-vibrate` sets `translate`, and a transformed ancestor is
                  the containing block for `position: fixed` descendants, so an
                  in-row fixed popover collapsed to a sliver against the 36px
                  row. On the body it is positioned against the viewport from the
                  plus's getBoundingClientRect() (same class of fix as the dock's
                  portaled Pin/Unpin menu). */}
              {pickerOpen &&
                !full &&
                createPortal(
                  <div
                    ref={pickerRef}
                    className="home-tools-picker anim-menu-pop"
                    role="menu"
                    aria-label="Add a tool to the home row"
                    data-home-picker
                    style={
                      pickerPos === null
                        ? { visibility: "hidden", left: 0, top: 0 }
                        : { left: pickerPos.left, top: pickerPos.top }
                    }
                  >
                    {pickerEntries.map((entry) => {
                      const Icon = entry.icon;
                      return (
                        <button
                          key={entry.id}
                          type="button"
                          role="menuitem"
                          className="action-dock-menu-item"
                          data-home-picker-item={entry.id}
                          onClick={(): void => {
                            setPickerOpen(false);
                            onSetHomeTools?.(addHomeTool(tools, entry.id));
                          }}
                        >
                          <Icon size={18} aria-hidden />
                          <span>{entry.label}</span>
                        </button>
                      );
                    })}
                  </div>,
                  document.body,
                )}
            </div>
          )}
          <button
            type="button"
            className="home-tools-edit"
            data-home-edit-toggle
            aria-pressed={editMode}
            aria-label="Edit home tools"
            title="Edit home tools"
            onClick={(): void => {
              setEditMode((v) => !v);
              setPickerOpen(false);
            }}
          >
            <Pencil size={14} aria-hidden />
          </button>
        </div>
        {editMode && full && (
          <p className="home-tools-hint" data-home-full-hint>
            Home row is full (max 14 tools)
          </p>
        )}
      </div>
      <div className="welcome-body">
        <section className="welcome-section">
          <h3>
            <span>Recent</span>
            <span className="count">{recentCount}</span>
          </h3>
          {recentCount === 0 ? (
            <div className="recent-list">
              <div className="recent-empty">
                <span>No recent files yet.</span>
                <span className="hint">Open a PDF and it will appear here.</span>
              </div>
            </div>
          ) : (
            <div className="recent-list">
              {recentFiles.map((row) => (
                <div
                  key={row.entry.path}
                  className="recent-row"
                  role="group"
                  title={row.entry.path}
                >
                  <button
                    type="button"
                    className="recent-row-open"
                    onClick={(): void => onOpenRecent(row.entry)}
                    title={`Open ${row.entry.path}`}
                  >
                    <span className="doc-icon" aria-hidden>
                      <File size={16} />
                    </span>
                    <span className="recent-row-text">
                      <div className="doc-name">{row.meta.name}</div>
                      <div className="doc-path">{row.meta.dir || "—"}</div>
                    </span>
                    <span className="doc-when">{formatOpenedAt(row.entry.openedAt)}</span>
                    <span className="doc-when">PDF</span>
                  </button>
                  <button
                    type="button"
                    className="recent-row-remove"
                    onClick={(): void => onRemoveRecent(row.entry)}
                    aria-label={`Remove ${row.entry.name} from Recents`}
                    title="Remove from Recents"
                  >
                    <X size={16} aria-hidden />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="welcome-section">
          <h3>
            <span>Sample documents</span>
            <span className="count">{sampleCount}</span>
          </h3>
          {samples === null ? (
            <div className="samples-grid">
              <div className="samples-empty">Loading samples…</div>
            </div>
          ) : samples.length === 0 ? (
            <div className="samples-grid">
              <div className="samples-empty">
                No bundled samples. Place PDF files in <code>assets/samples/</code> and rebuild.
              </div>
            </div>
          ) : (
            <div className="samples-grid">
              {samples.map((sample) => (
                <button
                  key={sample.path}
                  type="button"
                  className="sample-card"
                  onClick={(): void => onSampleClick(sample)}
                >
                  <div className="sample-thumb">
                    <Sparkles size={20} />
                  </div>
                  <div className="sample-name">{sample.name}</div>
                  <div className="sample-sub">Click to open · PDF</div>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
      <span hidden>
        <FilePlus2 />
      </span>
    </div>
  );
}
