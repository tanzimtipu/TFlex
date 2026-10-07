// @vitest-environment jsdom
//
// Phase 36 (chunk 6) — the File menu label + the title-bar Multi Mode toggle.
//
// The hamburger becomes an explicit "File" trigger; the popover, its groups
// and EVERY entry are unchanged (no menu item lost). The Multi Mode toggle
// gains its approved title-bar home (keeping the palette's registry route).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { TitleBar, type MenuGroup } from '../../../src/renderer/components/TitleBar';
import { AppHeader, MULTI_MODE_ACCESSIBLE_NAME } from '../../../src/renderer/components/AppHeader';
import type { MenuActionContext } from '../../../src/renderer/state/menuActions';
import { PALETTE_TOOL_IDS, toolById } from '../../../src/renderer/state/toolsRegistry';

interface TflexStub {
  minimizeWindow: ReturnType<typeof vi.fn>;
  maximizeWindow: ReturnType<typeof vi.fn>;
  closeWindow: ReturnType<typeof vi.fn>;
  menu: { onAction: ReturnType<typeof vi.fn> };
}

function setTflex(): TflexStub {
  const stub: TflexStub = {
    minimizeWindow: vi.fn(),
    maximizeWindow: vi.fn(),
    closeWindow: vi.fn(),
    menu: { onAction: vi.fn() },
  };
  (window as unknown as { tflex: TflexStub }).tflex = stub;
  return stub;
}

function noopContext(): MenuActionContext {
  return {
    open: (): void => undefined,
    merge: (): void => undefined,
    save: (): void => undefined,
    saveAs: (): void => undefined,
    closeTab: (): void => undefined,
    undo: (): void => undefined,
    redo: (): void => undefined,
    toggleTheme: (): void => undefined,
    showToolsPalette: (): void => undefined,
    about: (): void => undefined,
    preferences: (): void => undefined,
    optimize: (): void => undefined,
    auditSpace: (): void => undefined,
    createFromImages: (): void => undefined,
    exportPages: (): void => undefined,
    exportText: (): void => undefined,
    exportDocx: (): void => undefined,
    insertPages: (): void => undefined,
    recognizeText: (): void => undefined,
    checkForUpdate: (): void => undefined,
  };
}

/** The App's real menu groups, in order (src/renderer/App.tsx). */
const GROUPS: MenuGroup[] = [
  {
    id: 'file',
    label: 'File',
    entries: [
      { id: 'open', label: 'Open...', accelerator: 'Ctrl+O', action: 'open' },
      { id: 'merge', label: 'Merge...', accelerator: 'Ctrl+Shift+O', action: 'merge' },
      { id: 'save', label: 'Save', accelerator: 'Ctrl+S', action: 'save' },
      { id: 'saveAs', label: 'Save As...', accelerator: 'Ctrl+Shift+S', action: 'saveAs' },
      { id: 'closeTab', label: 'Close Tab', accelerator: 'Ctrl+W', action: 'closeTab' },
    ],
  },
  {
    id: 'edit',
    label: 'Edit',
    entries: [
      { id: 'undo', label: 'Undo', accelerator: 'Ctrl+Z', action: 'undo' },
      { id: 'redo', label: 'Redo', accelerator: 'Ctrl+Shift+Z', action: 'redo' },
      { id: 'prefs', label: 'Preferences...', accelerator: 'Ctrl+,', action: 'preferences' },
    ],
  },
  {
    id: 'view',
    label: 'View',
    entries: [
      { id: 'theme', label: 'Toggle Theme', accelerator: 'Ctrl+Shift+T', action: 'toggleTheme' },
      { id: 'tools', label: 'Command Palette...', accelerator: 'Ctrl+Shift+P', action: 'showToolsPalette' },
    ],
  },
  {
    id: 'tools',
    label: 'Tools',
    entries: [
      { id: 'ocr', label: 'Recognize Text...', accelerator: 'Ctrl+Shift+R', action: 'recognizeText' },
    ],
  },
  {
    id: 'help',
    label: 'Help',
    entries: [
      { id: 'check', label: 'Check for Update...', accelerator: 'Ctrl+Shift+U', action: 'checkForUpdate' },
      { id: 'about', label: 'About TFlex', action: 'about' },
    ],
  },
];

function renderTitleBar(): { container: HTMLElement; cleanup: () => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(<TitleBar menuGroups={GROUPS} menuContext={noopContext()} />);
  });
  return {
    container,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe('Phase 36 chunk 6 — the File menu label', () => {
  it('renders an explicit "File" trigger in place of the hamburger', () => {
    const stub = setTflex();
    const { container, cleanup } = renderTitleBar();
    try {
      const btn = container.querySelector<HTMLButtonElement>('[data-menu-button]');
      expect(btn).not.toBeNull();
      expect(btn?.textContent).toContain('File');
      expect(btn?.className).toContain('titlebar-menu-file');
      expect(btn?.getAttribute('aria-label')).toBe('File menu');
      // A chevron points at the popover (Lucide svg, not a text glyph).
      expect(btn?.querySelector('svg')).not.toBeNull();
    } finally {
      cleanup();
      void stub;
      (window as unknown as { tflex?: unknown }).tflex = undefined;
    }
  });

  it('keeps the popover and EVERY menu item intact', () => {
    const stub = setTflex();
    const { container, cleanup } = renderTitleBar();
    try {
      const btn = container.querySelector<HTMLButtonElement>('[data-menu-button]');
      act((): void => {
        btn?.click();
      });
      expect(container.querySelector('[data-menu-popover]')).not.toBeNull();
      const actions = [...container.querySelectorAll<HTMLElement>('[data-menu-action]')].map(
        (el) => el.getAttribute('data-menu-action'),
      );
      expect(actions).toEqual([
        'open',
        'merge',
        'save',
        'saveAs',
        'closeTab',
        'undo',
        'redo',
        'preferences',
        'toggleTheme',
        'showToolsPalette',
        'recognizeText',
        'checkForUpdate',
        'about',
      ]);
      // The five group headings still render.
      expect(container.querySelectorAll('.titlebar-menu-heading').length).toBe(5);
    } finally {
      cleanup();
      void stub;
      (window as unknown as { tflex?: unknown }).tflex = undefined;
    }
  });
});

/** Phase 105 (chunk C) — the application menu consumes the NON-File groups. */
const APP_MENU_GROUPS: MenuGroup[] = GROUPS.filter((g) => g.id !== 'file');

function renderHeader(props: {
  multiModeEnabled?: boolean;
  onMultiModeToggle?: () => void;
}): { container: HTMLElement; cleanup: () => void } {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  act((): void => {
    root.render(
      <AppHeader
        activeId={null}
        appMenuGroups={APP_MENU_GROUPS}
        menuContext={noopContext()}
        onPrint={(): void => undefined}
        onOpenFile={(): void => undefined}
        onSave={(): void => undefined}
        onSaveAs={(): void => undefined}
        updateIndicator={<span data-update-indicator />}
        onMultiModeToggle={props.onMultiModeToggle}
      />,
    );
  });
  return {
    container,
    cleanup: (): void => {
      act((): void => {
        root.unmount();
      });
      container.remove();
    },
  };
}

describe('Phase 36 chunk 6 — the application-menu Multi Mode command', () => {
  it('offers Multi Mode in the application menu and reports the toggle to the host', () => {
    const onMultiModeToggle = vi.fn();
    const { container, cleanup } = renderHeader({ onMultiModeToggle });
    try {
      const trigger = container.querySelector<HTMLButtonElement>('[data-app-menu]');
      expect(trigger).not.toBeNull();
      act((): void => {
        trigger?.click();
      });
      const row = document.querySelector<HTMLButtonElement>("[data-menu-action='multiMode']");
      expect(row).not.toBeNull();
      expect(row?.textContent).toContain(MULTI_MODE_ACCESSIBLE_NAME);
      act((): void => {
        row?.click();
      });
      expect(onMultiModeToggle).toHaveBeenCalledTimes(1);
    } finally {
      cleanup();
    }
  });

  it('keeps every existing title-row control', () => {
    const { container, cleanup } = renderHeader({
      onMultiModeToggle: (): void => undefined,
    });
    try {
      // The title row keeps all three quick file actions, print, the update
      // indicator and the application-menu trigger.
      expect(container.querySelector('[data-toolbar-open]')).not.toBeNull();
      expect(container.querySelector('[data-toolbar-save]')).not.toBeNull();
      expect(container.querySelector('[data-toolbar-save-as]')).not.toBeNull();
      expect(container.querySelector('[data-print]')).not.toBeNull();
      expect(container.querySelector('[data-update-indicator]')).not.toBeNull();
      expect(container.querySelector('[data-app-menu]')).not.toBeNull();
    } finally {
      cleanup();
    }
  });

  it('omits the Multi Mode row entirely when the host wires no handler', () => {
    const { container, cleanup } = renderHeader({});
    try {
      const trigger = container.querySelector<HTMLButtonElement>('[data-app-menu]');
      act((): void => {
        trigger?.click();
      });
      expect(container.querySelector("[data-menu-action='multiMode']")).toBeNull();
    } finally {
      cleanup();
    }
  });

  it('stays in the palette: the registry entry keeps its canonical route', () => {
    expect(PALETTE_TOOL_IDS).toContain('multi-mode');
    const entry = toolById('multi-mode');
    expect(entry?.action).toBe('multiModeToggle');
    expect(entry?.label).toBe('Multi Mode');
  });
});
