// Phase 6 — tools palette right panel.
//
// A right-side overlay panel listing the major document tools: merge,
// split, extract, rotate, delete, sign, forms. The user opens it via
// the Tools button on the toolbar (or Ctrl+Shift+P from the menu).
//
// Layout toggle: list (icon + label, dense, the default) and grid
// (icon-only tiles, faster to scan). The selection persists in
// AppSettings.toolsPaletteLayout, so the choice survives restart.
//
// Per the spec, every entry is a thin entry point that funnels into
// the same single-source handler the toolbar uses. The component
// does NOT contain action logic — it dispatches into the host App
// via callbacks, identical to how the toolbar works today.

import type { ReactElement } from 'react';
import {
  ArrowDownToLine,
  GitMerge,
  Layers,
  LayoutGrid,
  LayoutList,
  Pen,
  RotateCw,
  Scissors,
  Trash2,
} from 'lucide-react';

export type ToolsPaletteLayout = 'list' | 'grid';

interface ToolsPaletteProps {
  layout: ToolsPaletteLayout;
  onLayoutChange: (next: ToolsPaletteLayout) => void;
  onMerge: () => void;
  onSplit: () => void;
  onExtract: () => void;
  onRotate: () => void;
  onDelete: () => void;
  onSign: () => void;
  onForms: () => void;
  onClose: () => void;
  /** True when a real document is open. The palette always renders,
   *  but every entry EXCEPT Sign is greyed out when no doc is open
   *  (Sign opens the manager modal regardless). */
  documentRequired: boolean;
  /** Whether the active document has form fields. The Forms entry is
   *  disabled when false (Flatten would no-op). */
  hasFormFields: boolean;
}

interface ToolEntry {
  id: string;
  label: string;
  description: string;
  icon: ReactElement;
  shortcut: string;
  action: () => void;
}

export function ToolsPalette(props: ToolsPaletteProps): ReactElement {
  const {
    layout,
    onLayoutChange,
    onMerge,
    onSplit,
    onExtract,
    onRotate,
    onDelete,
    onSign,
    onForms,
    onClose,
    documentRequired,
    hasFormFields,
  } = props;

  const isEntryEnabled = (id: ToolEntry['id']): boolean => {
    if (!documentRequired) {
      // Without a document the only useful action is Sign, which opens
      // the signature manager modal regardless of doc state.
      return id === 'sign';
    }
    if (id === 'forms') return hasFormFields;
    return true;
  };

  const entries: ToolEntry[] = [
    {
      id: 'merge',
      label: 'Merge PDFs',
      description: 'Combine another PDF with the active document.',
      icon: <GitMerge size={16} aria-hidden />,
      shortcut: 'Ctrl+Shift+O',
      action: onMerge,
    },
    {
      id: 'split',
      label: 'Split pages',
      description: 'Split a range of pages into a new document.',
      icon: <Scissors size={16} aria-hidden />,
      shortcut: '',
      action: onSplit,
    },
    {
      id: 'extract',
      label: 'Extract pages',
      description: 'Pull specific pages into a new document.',
      icon: <ArrowDownToLine size={16} aria-hidden />,
      shortcut: '',
      action: onExtract,
    },
    {
      id: 'rotate',
      label: 'Rotate page',
      description: 'Rotate the selected page clockwise or counter-clockwise.',
      icon: <RotateCw size={16} aria-hidden />,
      shortcut: '',
      action: onRotate,
    },
    {
      id: 'delete',
      label: 'Delete page',
      description: 'Remove the selected page from the document.',
      icon: <Trash2 size={16} aria-hidden />,
      shortcut: '',
      action: onDelete,
    },
    {
      id: 'sign',
      label: 'Sign',
      description: 'Draw, type, or place a saved signature.',
      icon: <Pen size={16} aria-hidden />,
      shortcut: '',
      action: onSign,
    },
    {
      id: 'forms',
      label: 'Forms',
      description: 'Fill AcroForm fields. Flatten when finished.',
      icon: <Layers size={16} aria-hidden />,
      shortcut: '',
      action: onForms,
    },
  ];

  return (
    <aside
      className={layout === 'grid' ? 'tools-palette tools-palette-grid' : 'tools-palette tools-palette-list'}
      data-tools-palette
      data-layout={layout}
      role="complementary"
      aria-label="Tools"
    >
      <header className="tools-palette-header">
        <span className="tools-palette-title">Tools</span>
        <div className="tools-palette-toggle" role="group" aria-label="Layout">
          <button
            type="button"
            className={layout === 'list' ? 'tools-palette-toggle-btn tools-palette-toggle-active' : 'tools-palette-toggle-btn'}
            onClick={(): void => onLayoutChange('list')}
            aria-pressed={layout === 'list'}
            aria-label="List layout"
            title="List layout"
            data-tools-layout="list"
          >
            <LayoutList size={13} aria-hidden />
          </button>
          <button
            type="button"
            className={layout === 'grid' ? 'tools-palette-toggle-btn tools-palette-toggle-active' : 'tools-palette-toggle-btn'}
            onClick={(): void => onLayoutChange('grid')}
            aria-pressed={layout === 'grid'}
            aria-label="Grid layout"
            title="Grid layout"
            data-tools-layout="grid"
          >
            <LayoutGrid size={13} aria-hidden />
          </button>
        </div>
        <button
          type="button"
          className="tools-palette-close"
          onClick={onClose}
          aria-label="Close tools palette"
          title="Close"
        >
          ×
        </button>
      </header>
      <div className="tools-palette-body">
        {entries.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={
              layout === 'grid'
                ? 'tools-palette-entry tools-palette-entry-grid'
                : 'tools-palette-entry tools-palette-entry-list'
            }
            disabled={!isEntryEnabled(entry.id)}
            onClick={entry.action}
            aria-label={entry.label}
            title={entry.description}
            data-tool-id={entry.id}
          >
            <span className="tools-palette-entry-icon">{entry.icon}</span>
            <span className="tools-palette-entry-text">
              <span className="tools-palette-entry-label">{entry.label}</span>
              {layout === 'list' && (
                <span className="tools-palette-entry-desc">{entry.description}</span>
              )}
            </span>
            {layout === 'list' && entry.shortcut !== '' && (
              <span className="tools-palette-entry-shortcut">{entry.shortcut}</span>
            )}
          </button>
        ))}
      </div>
    </aside>
  );
}