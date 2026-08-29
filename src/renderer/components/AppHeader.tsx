import { useCallback, type ReactElement, type MouseEvent as ReactMouseEvent } from "react";
import { FolderOpen, Moon, Plus, Sun, X } from "lucide-react";
import type { Theme } from "../state/theme";
import { resolveTabMouseDown, type TabInput } from "../state/tabMouseDown";

export type AppHeaderTab = TabInput;

interface AppHeaderProps {
  activeId: string | null;
  tabs: AppHeaderTab[];
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  theme: Theme;
  onToggleTheme: () => void;
  onOpen: () => void;
  /** Phase 6 — "+ tab" affordance. Spawns a brand-new empty tab that
   *  the user can fill by opening a PDF. The host owns the empty-tab
   *  state (see App.tsx -> tabs.openEmpty). */
  onNewEmptyTab: () => void;
}

export function AppHeader(props: AppHeaderProps): ReactElement {
  const { activeId, tabs, onActivate, onClose, theme, onToggleTheme, onOpen, onNewEmptyTab } = props;
  // Single mousedown handler for the tab strip. We use mousedown (not
  // click) so the activate mutation lands synchronously and is not
  // dropped by a re-render that swaps the button element between
  // mousedown and mouseup (DEF-034: state-churn click loss). The
  // resolver classifies the hit as activate / close / no-op, so
  // padding, gap, and inner title clicks all flow through the same
  // path.
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

  return (
    <header className="app-header">
      <div className="brand">
        <span className="brand-mark" aria-hidden>TF</span>
        <span>TFlex</span>
      </div>
      <div className="tab-area" role="tablist" aria-label="Open documents">
        {tabs.length === 0 ? (
          <span style={{ color: "var(--fg-faint)", fontSize: 12, paddingLeft: 8 }}>
            No documents open
          </span>
        ) : (
          <ul className="tab-list">
            {tabs.map((tab) => {
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
                      <X size={12} aria-hidden />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {/* Phase 6 — "+ tab" affordance. Always visible (including when
            no tabs are open), always rendered as its own button so it
            doesn't accidentally get classified as a tab by the mousedown
            resolver. */}
        <button
          type="button"
          className="tab-new"
          onClick={onNewEmptyTab}
          aria-label="New empty tab"
          title="New empty tab"
          data-new-tab
        >
          <Plus size={14} aria-hidden />
        </button>
      </div>
      <div className="header-actions">
        <button
          type="button"
          className="theme-toggle"
          onClick={onToggleTheme}
          title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
          aria-label="Toggle theme"
        >
          {theme === "dark" ? <Sun size={14} aria-hidden /> : <Moon size={14} aria-hidden />}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onOpen}
          style={{ height: 28, padding: "0 10px", fontSize: 12 }}
        >
          <FolderOpen size={13} aria-hidden />
          Open
        </button>
      </div>
    </header>
  );
}
