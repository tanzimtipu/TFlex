// Unified toolbar — the tabbed ribbon base that consolidates the
// formerly separate toolbars (annotation / edit / document) into one
// bar, MS Office ribbon style.
//
// The Annotate section carries its tool grid: the five most-used tools
// (Highlight, Comment, Text, Rect, Sign) are always visible, and a
// dashed More/Less pill reveals the remaining seven (Underline, Strike,
// Oval, Line, Arrow, Stamp, Erase). The Annotate buttons are inert
// until tool activation lands in a later chunk (keyed off the data-tool
// ids). The Edit section carries the same grid language: the five
// most-used tools (Move, Scale, Rotate, Crop, Delete) are always
// visible, and the More/Less pill reveals the remaining five (Text,
// Image, Link, Page #, Header). Edit buttons are live toggles — a click
// reports the armed / disarmed tool to the host through
// onEditModeChange (single-selection across both rows; the armed id is
// host-owned so it survives tab switches and re-renders). The Document
// section renders the same grid for the document actions: the five
// most-used tools (Save, Save As, Export, Print, Share) are always
// visible, and the More/Less pill reveals the remaining five (Merge,
// Split, Optimize, Flatten, Props). Each document button carries the
// action callback the host passes for its data-tool id; a button whose
// callback the host did not pass stays inert (the app has no
// print / share / properties action yet, so those three render
// without a handler).
// The component is presentational — the host owns the active-tab and
// armed-tool state and passes the document action handlers. App.tsx
// mounts the ribbon above the tab stage, only while a document is
// open.

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  ChevronDown,
  Circle,
  Combine,
  Crop,
  Download,
  Eraser,
  FileCheck,
  FileText,
  Hash,
  Highlighter,
  Image,
  LayoutTemplate,
  Link,
  Maximize,
  MessageSquare,
  Minus,
  Move,
  Printer,
  RotateCw,
  Save,
  // The pinned lucide-react (1.34.0) predates the save-pen -> save-as
  // rename, so SavePen is the SaveAs glyph in this version.
  SavePen,
  Scissors,
  Share2,
  Signature,
  Square,
  Stamp,
  Strikethrough,
  Trash2,
  Type,
  Underline,
  Zap,
} from "lucide-react";
import { useLiveReducedMotion } from "../hooks/useAnimations";
import { MOTION_DURATION } from "../hooks/motionTokens";

/** The three ribbon sections, in display order. */
export type ToolbarTab = "annotate" | "edit" | "document";

/** Module-level const so the strip renders a stable display order
 *  (annotate / edit / document) regardless of how the host composes
 *  the component. */
const TOOLBAR_TABS: ReadonlyArray<{ id: ToolbarTab; label: string }> = [
  { id: "annotate", label: "Annotate" },
  { id: "edit", label: "Edit" },
  { id: "document", label: "Document" },
];

/** One entry in a toolbar tool grid (annotate or edit). `id` is the DOM
 *  `data-tool` hook that e2e tests and the later action-wiring chunks
 *  key off. */
interface ToolbarTool {
  id: string;
  icon: LucideIcon;
  label: string;
}

/** Most-used tools — always visible on the first row. */
const MOST_USED_TOOLS: ReadonlyArray<ToolbarTool> = [
  { id: "highlight", icon: Highlighter, label: "Highlight" },
  { id: "comment", icon: MessageSquare, label: "Comment" },
  { id: "text", icon: Type, label: "Text" },
  { id: "rect", icon: Square, label: "Rect" },
  { id: "sign", icon: Signature, label: "Sign" },
];

/** Remaining tools — hidden until the More pill is pressed. */
const EXPANDED_TOOLS: ReadonlyArray<ToolbarTool> = [
  { id: "underline", icon: Underline, label: "Under" },
  { id: "strike", icon: Strikethrough, label: "Strike" },
  { id: "oval", icon: Circle, label: "Oval" },
  { id: "line", icon: Minus, label: "Line" },
  { id: "arrow", icon: ArrowRight, label: "Arrow" },
  { id: "stamp", icon: Stamp, label: "Stamp" },
  { id: "erase", icon: Eraser, label: "Erase" },
];

/** Edit section — most-used tools, always visible on the first row. */
const EDIT_MOST_USED_TOOLS: ReadonlyArray<ToolbarTool> = [
  { id: "move", icon: Move, label: "Move" },
  { id: "scale", icon: Maximize, label: "Scale" },
  { id: "rotate", icon: RotateCw, label: "Rotate" },
  { id: "crop", icon: Crop, label: "Crop" },
  { id: "delete", icon: Trash2, label: "Delete" },
];

/** Edit section — remaining tools, hidden until the More pill is pressed. */
const EDIT_EXPANDED_TOOLS: ReadonlyArray<ToolbarTool> = [
  { id: "insert-text", icon: Type, label: "Text" },
  { id: "insert-image", icon: Image, label: "Image" },
  { id: "insert-link", icon: Link, label: "Link" },
  { id: "page-numbers", icon: Hash, label: "Page #" },
  { id: "headers", icon: LayoutTemplate, label: "Header" },
];

/** Document section — most-used actions, always visible on the first row. */
const DOC_MOST_USED_TOOLS: ReadonlyArray<ToolbarTool> = [
  { id: "save", icon: Save, label: "Save" },
  { id: "saveas", icon: SavePen, label: "Save As" },
  { id: "export", icon: Download, label: "Export" },
  { id: "print", icon: Printer, label: "Print" },
  { id: "share", icon: Share2, label: "Share" },
];

/** Document section — remaining actions, hidden until the More pill is pressed. */
const DOC_EXPANDED_TOOLS: ReadonlyArray<ToolbarTool> = [
  { id: "merge", icon: Combine, label: "Merge" },
  { id: "split", icon: Scissors, label: "Split" },
  { id: "optimize", icon: Zap, label: "Optimize" },
  { id: "flatten", icon: FileCheck, label: "Flatten" },
  { id: "props", icon: FileText, label: "Props" },
];

export interface UnifiedToolbarProps {
  /** The section currently shown in the content panel. */
  activeTab: ToolbarTab;
  /** Fired when the user picks a different section tab. */
  onTabChange: (tab: ToolbarTab) => void;
  /** The Edit tool currently armed (a data-tool id), or null when no
   *  tool is armed. Host-owned so the armed selection survives tab
   *  switches and re-renders. */
  editMode?: string | null;
  /** Fired when an Edit tool toggles: the tool id on arm, null on
   *  disarm (re-clicking the armed tool). */
  onEditModeChange?: (mode: string | null) => void;
  /** Document-tab actions, keyed to the document grid's data-tool ids.
   *  Any callback the host omits leaves that button inert (no
   *  handler): the app has no print / share / properties action yet,
   *  so those three render handler-less by design. */
  onSave?: () => void;
  onSaveAs?: () => void;
  onExport?: () => void;
  onPrint?: () => void;
  onShare?: () => void;
  onMerge?: () => void;
  onSplit?: () => void;
  onOptimize?: () => void;
  onFlatten?: () => void;
  onProps?: () => void;
}

/** Expand/collapse lifecycle for a More/Less second row (shared by the
 *  Annotate, Edit and Document sections). `expanded` is the logical
 *  state (drives the pill label, aria-expanded and the chevron
 *  rotation); `mounted` keeps the row in the DOM; `collapsing`
 *  switches the row from the enter keyframes (.tools-row.expanded) to
 *  the exit keyframes (.tools-row.collapsing). The exit row is
 *  unmounted once the --motion-duration-fast band elapses — the same
 *  token the collapseRow keyframes run on, so the unmount lands on the
 *  animation's last frame. Under prefers-reduced-motion the deadline
 *  collapses to the reduced (0ms) token, matching the CSS. A pill
 *  click during the exit window is ignored until the row settles
 *  (restarting an in-flight exit would race on mid-animation class
 *  swaps). */
function useExpandCollapse(): {
  expanded: boolean;
  mounted: boolean;
  collapsing: boolean;
  toggle: () => void;
} {
  const reduced = useLiveReducedMotion();
  const [expanded, setExpanded] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [collapsing, setCollapsing] = useState(false);
  const timerRef = useRef<number | null>(null);

  const settle = useCallback((): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setMounted(false);
    setCollapsing(false);
    setExpanded(false);
  }, []);

  const toggle = useCallback((): void => {
    if (expanded) {
      // Less: play the exit keyframes, unmount when the band elapses.
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
      }
      setCollapsing(true);
      const exitMs = reduced ? MOTION_DURATION.reduced : MOTION_DURATION.fast;
      timerRef.current = window.setTimeout(settle, exitMs);
    } else {
      // More: mount the row — the enter keyframes run on mount.
      setCollapsing(false);
      setMounted(true);
      setExpanded(true);
    }
  }, [expanded, reduced, settle]);

  // Unmount hygiene: a torn-down app never leaves a pending settle
  // timer behind.
  useEffect((): (() => void) => {
    return (): void => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  return { expanded, mounted, collapsing, toggle };
}

/** AnnotateTools — the Annotate section's tool grid. The most-used
 *  row is always present; the dashed More/Less pill toggles a second
 *  row with the remaining seven tools and rotates its chevron (the
 *  rotation rides --motion-duration-fast, see .expand-btn svg in
 *  styles.css). The row itself animates in/out over the shared
 *  .tools-row.expanded / .tools-row.collapsing motion (see
 *  useExpandCollapse above). Buttons are inert until a later chunk
 *  wires each data-tool id to tool activation. */
function AnnotateTools(): ReactElement {
  const { expanded, mounted, collapsing, toggle } = useExpandCollapse();
  return (
    <div className="annotation-tools" data-annotation-tools>
      <div className="tools-row">
        {MOST_USED_TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className="tool-btn"
            data-tool={tool.id}
            title={tool.label}
          >
            <tool.icon size={20} aria-hidden />
            <span>{tool.label}</span>
          </button>
        ))}
      </div>

      {mounted && (
        <div className={collapsing ? "tools-row collapsing" : "tools-row expanded"}>
          {EXPANDED_TOOLS.map((tool) => (
            <button
              key={tool.id}
              type="button"
              className="tool-btn"
              data-tool={tool.id}
              title={tool.label}
            >
              <tool.icon size={20} aria-hidden />
              <span>{tool.label}</span>
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        className="expand-btn"
        data-expand-toggle
        data-expanded={expanded}
        aria-expanded={expanded}
        onClick={toggle}
      >
        {expanded ? "Less" : "More"}
        <ChevronDown size={12} aria-hidden className={expanded ? "rotated" : ""} />
      </button>
    </div>
  );
}

/** UnifiedToolbar — the tabbed ribbon base. Renders the tab headers
 *  (role=tablist) plus the content panel (role=tabpanel) that holds
 *  the active section's tools. The panel's aria-labelledby tracks the
 *  active tab so the labelled-by association never dangles. The armed
 *  Edit tool id is host-owned (`editMode` / `onEditModeChange`), so a
 *  selection survives tab switches and App re-renders even though the
 *  panel content re-mounts on every section switch. */
export function UnifiedToolbar({
  activeTab,
  onTabChange,
  editMode = null,
  onEditModeChange,
  onSave,
  onSaveAs,
  onExport,
  onPrint,
  onShare,
  onMerge,
  onSplit,
  onOptimize,
  onFlatten,
  onProps,
}: UnifiedToolbarProps): ReactElement {
  const editExpand = useExpandCollapse();
  const docExpand = useExpandCollapse();
  /** data-tool id -> host action for the Document grid. A missing
   *  (or host-omitted) callback renders that button inert. */
  const docActions: Record<string, (() => void) | undefined> = {
    save: onSave,
    saveas: onSaveAs,
    export: onExport,
    print: onPrint,
    share: onShare,
    merge: onMerge,
    split: onSplit,
    optimize: onOptimize,
    flatten: onFlatten,
    props: onProps,
  };
  return (
    <div className="unified-toolbar" data-unified-toolbar>
      {/* Tab headers — mirror the AppHeader tab-strip design
        *  (transparent frame, shared hover wash, raised active
        *  surface, inset 2px accent underline). */}
      <div className="toolbar-tabs" role="tablist" aria-label="Toolbars">
        {TOOLBAR_TABS.map((tab) => {
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`unified-toolbar-tab-${tab.id}`}
              aria-selected={isActive}
              className={isActive ? "toolbar-tab toolbar-tab-active" : "toolbar-tab"}
              onClick={(): void => onTabChange(tab.id)}
              data-tab={tab.id}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content area — each section renders its tool grid
        *  (Annotate / Edit / Document). */}
      <div
        className="toolbar-content"
        role="tabpanel"
        aria-labelledby={`unified-toolbar-tab-${activeTab}`}
      >
        {activeTab === "annotate" ? (
          <AnnotateTools />
) : activeTab === "edit" ? (
          /* EditTools — the Edit section's tool grid: the five most-used
           *  tools (Move, Scale, Rotate, Crop, Delete) on the always-visible
           *  row, the dashed More/Less pill toggling the remaining five
           *  (Text, Image, Link, Page #, Header). Unlike the inert Annotate
           *  buttons, these are live toggles: a click reports the tool id to
           *  the host (accent fill via the .active class + aria-pressed), a
           *  repeat click reports null (disarm), and selection is single
           *  across both rows — the armed id lives on the host
           *  (`editMode`), so a tab switch never loses it. */
          <div className="edit-tools" data-edit-tools>
            <div className="tools-row">
              {EDIT_MOST_USED_TOOLS.map((tool) => (
                <button
                  key={tool.id}
                  type="button"
                  className={editMode === tool.id ? "tool-btn active" : "tool-btn"}
                  data-tool={tool.id}
                  title={tool.label}
                  aria-pressed={editMode === tool.id}
                  onClick={(): void =>
                    onEditModeChange?.(editMode === tool.id ? null : tool.id)
                  }
                >
                  <tool.icon size={20} aria-hidden />
                  <span>{tool.label}</span>
                </button>
              ))}
            </div>

            {editExpand.mounted && (
              <div className={editExpand.collapsing ? "tools-row collapsing" : "tools-row expanded"}>
                {EDIT_EXPANDED_TOOLS.map((tool) => (
                  <button
                    key={tool.id}
                    type="button"
                    className={editMode === tool.id ? "tool-btn active" : "tool-btn"}
                    data-tool={tool.id}
                    title={tool.label}
                    aria-pressed={editMode === tool.id}
                    onClick={(): void =>
                      onEditModeChange?.(editMode === tool.id ? null : tool.id)
                    }
                  >
                    <tool.icon size={20} aria-hidden />
                    <span>{tool.label}</span>
                  </button>
                ))}
              </div>
            )}

            <button
              type="button"
              className="expand-btn"
              data-expand-toggle
              data-expanded={editExpand.expanded}
              aria-expanded={editExpand.expanded}
              onClick={editExpand.toggle}
            >
              {editExpand.expanded ? "Less" : "More"}
              <ChevronDown size={12} aria-hidden className={editExpand.expanded ? "rotated" : ""} />
            </button>
          </div>
) : (
            /* DocumentTools — the Document section's action grid: the five
             *  most-used actions (Save, Save As, Export, Print, Share) on the
             *  always-visible row, the dashed More/Less pill toggling the
             *  remaining five (Merge, Split, Optimize, Flatten, Props). Each
             *  button calls the host action its data-tool id maps to;
             *  buttons the host did not wire (print / share / props — the
             *  app has no such action yet) stay inert. */
            <div className="document-tools" data-document-tools>
              <div className="tools-row">
                {DOC_MOST_USED_TOOLS.map((tool) => {
                  const action = docActions[tool.id];
                  return (
                    <button
                      key={tool.id}
                      type="button"
                      className="tool-btn"
                      data-tool={tool.id}
                      title={tool.label}
                      onClick={action === undefined ? undefined : (): void => action()}
                    >
                      <tool.icon size={20} aria-hidden />
                      <span>{tool.label}</span>
                    </button>
                  );
                })}
              </div>

              {docExpand.mounted && (
                <div className={docExpand.collapsing ? "tools-row collapsing" : "tools-row expanded"}>
                  {DOC_EXPANDED_TOOLS.map((tool) => {
                    const action = docActions[tool.id];
                    return (
                      <button
                        key={tool.id}
                        type="button"
                        className="tool-btn"
                        data-tool={tool.id}
                        title={tool.label}
                        onClick={action === undefined ? undefined : (): void => action()}
                      >
                        <tool.icon size={20} aria-hidden />
                        <span>{tool.label}</span>
                      </button>
                    );
                  })}
                </div>
              )}

              <button
                type="button"
                className="expand-btn"
                data-expand-toggle
                data-expanded={docExpand.expanded}
                aria-expanded={docExpand.expanded}
                onClick={docExpand.toggle}
              >
                {docExpand.expanded ? "Less" : "More"}
                <ChevronDown size={12} aria-hidden className={docExpand.expanded ? "rotated" : ""} />
              </button>
            </div>
          )}
      </div>
    </div>
  );
}