import type { ReactElement } from "react";
import { FolderOpen, Moon, Sun, X } from "lucide-react";
import type { Theme } from "../state/theme";

export interface AppHeaderTab {
  id: string;
  title: string;
  modified: boolean;
}

interface AppHeaderProps {
  activeId: string | null;
  tabs: AppHeaderTab[];
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  theme: Theme;
  onToggleTheme: () => void;
  onOpen: () => void;
}

export function AppHeader(props: AppHeaderProps): ReactElement {
  const { activeId, tabs, onActivate, onClose, theme, onToggleTheme, onOpen } = props;
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
                  >
                    <button
                      type="button"
                      onClick={(): void => onActivate(tab.id)}
                      className="tab-title"
                      style={{
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        padding: 0,
                        color: "inherit",
                      }}
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
                    </button>
                    <button
                      type="button"
                      className="tab-close"
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
