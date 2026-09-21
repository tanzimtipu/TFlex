import { vi, describe, it, expect, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// vi.hoisted — shared mutable menu state so the electron mock factory can
// reference it. applyMenuEnabledState calls Menu.getApplicationMenu() and
// flips .enabled on the MenuItem returned by getMenuItemById, so we model
// the menu as a map of id -> { enabled: boolean }.
// ---------------------------------------------------------------------------

const { _menu, _setApplicationMenu, _buildFromTemplate, _app, _lastMenu } = vi.hoisted(() => {
  return {
    _menu: {
      items: new Map<string, { enabled: boolean }>(),
      getMenuItemById(id: string) {
        return this.items.get(id) ?? null;
      },
    },
    _setApplicationMenu: vi.fn(),
    _buildFromTemplate: vi.fn(),
    _app: { quit: vi.fn() },
    _lastMenu: { current: null as unknown },
  };
});

vi.mock('electron', () => ({
  app: _app,
  Menu: {
    setApplicationMenu: (m: unknown) => {
      _setApplicationMenu(m);
      _lastMenu.current = m;
    },
    getApplicationMenu: () => _lastMenu.current ?? null,
    buildFromTemplate: (t: unknown) => {
      _buildFromTemplate(t);
      return t;
    },
  },
}));

import { applyMenuEnabledState, buildAppMenu, TOGGLEABLE_MENU_IDS } from '../../../src/main/menu';
import type { MenuEnabledState } from '../../../src/shared/types';

describe('DEF-065: menu.ts', () => {
  beforeEach(() => {
    _lastMenu.current = null;
    _menu.items.clear();
    _setApplicationMenu.mockClear();
    _buildFromTemplate.mockClear();
    _app.quit.mockClear();
  });

  describe('TOGGLEABLE_MENU_IDS', () => {
    it('lists exactly the six contract ids', () => {
      expect(TOGGLEABLE_MENU_IDS).toEqual([
        'menu.save',
        'menu.saveAs',
        'menu.print',
        'menu.closeTab',
        'menu.undo',
        'menu.redo',
      ]);
    });
  });

  describe('buildAppMenu', () => {
    it('assigns stable ids to the Save / Save As / Close Tab / Undo / Redo items', () => {
      const send = vi.fn();
      buildAppMenu({ sendToFocused: send, sendPrintRequest: vi.fn() });

      // buildFromTemplate received the template; walk it to collect ids.
      const template = _buildFromTemplate.mock.calls[0][0] as Array<{
        submenu?: Array<{ id?: string; label?: string }>;
      }>;
      const allIds: string[] = [];
      for (const top of template) {
        for (const item of top.submenu ?? []) {
          if (item.id !== undefined) allIds.push(item.id);
        }
      }
      expect(allIds).toContain('menu.save');
      expect(allIds).toContain('menu.saveAs');
      expect(allIds).toContain('menu.print');
      expect(allIds).toContain('menu.closeTab');
      expect(allIds).toContain('menu.undo');
      expect(allIds).toContain('menu.redo');
    });

    it('setApplicationMenu is called with the built menu', () => {
      buildAppMenu({ sendToFocused: vi.fn(), sendPrintRequest: vi.fn() });
      expect(_setApplicationMenu).toHaveBeenCalledTimes(1);
    });
  });

  describe('applyMenuEnabledState', () => {
    function setMenuWith(ids: string[]): void {
      for (const id of ids) _menu.items.set(id, { enabled: true });
      _lastMenu.current = _menu;
    }

    it('disables the listed items', () => {
      setMenuWith(['menu.save', 'menu.saveAs', 'menu.closeTab', 'menu.undo', 'menu.redo']);
      const state: MenuEnabledState = {
        'menu.save': false,
        'menu.saveAs': false,
        'menu.closeTab': false,
      };
      applyMenuEnabledState(state);

      expect(_menu.items.get('menu.save')!.enabled).toBe(false);
      expect(_menu.items.get('menu.saveAs')!.enabled).toBe(false);
      expect(_menu.items.get('menu.closeTab')!.enabled).toBe(false);
      // Omitted ids keep their current state (true).
      expect(_menu.items.get('menu.undo')!.enabled).toBe(true);
      expect(_menu.items.get('menu.redo')!.enabled).toBe(true);
    });

    it('enables items that were previously disabled', () => {
      setMenuWith(['menu.save', 'menu.undo']);
      _menu.items.get('menu.save')!.enabled = false;
      _menu.items.get('menu.undo')!.enabled = false;

      applyMenuEnabledState({ 'menu.save': true, 'menu.undo': true });
      expect(_menu.items.get('menu.save')!.enabled).toBe(true);
      expect(_menu.items.get('menu.undo')!.enabled).toBe(true);
    });

    it('coerces truthy non-boolean values to enabled', () => {
      setMenuWith(['menu.save']);
      applyMenuEnabledState({ 'menu.save': 1 as unknown as boolean });
      expect(_menu.items.get('menu.save')!.enabled).toBe(true);
    });

    it('is a no-op when no application menu is set', () => {
      // _lastMenu is null (beforeEach reset). Must not throw.
      expect(() => applyMenuEnabledState({ 'menu.save': false })).not.toThrow();
    });

    it('ignores ids that are not present in the menu', () => {
      setMenuWith(['menu.save']); // only save exists
      expect(() =>
        applyMenuEnabledState({ 'menu.save': false, 'menu.redo': false }),
      ).not.toThrow();
      expect(_menu.items.get('menu.save')!.enabled).toBe(false);
    });

    it('empty state object touches nothing', () => {
      setMenuWith(['menu.save', 'menu.undo']);
      _menu.items.get('menu.save')!.enabled = false;
      applyMenuEnabledState({});
      expect(_menu.items.get('menu.save')!.enabled).toBe(false);
      expect(_menu.items.get('menu.undo')!.enabled).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // DEF-271 — File > Print carries a toggle-able id
  // -------------------------------------------------------------------------

  describe('DEF-271: File > Print id', () => {
    it('assigns id menu.print to the File > Print item', () => {
      buildAppMenu({ sendToFocused: vi.fn(), sendPrintRequest: vi.fn() });

      const template = _buildFromTemplate.mock.calls[0][0] as Array<{
        label?: string;
        submenu?: Array<{ id?: string; label?: string }>;
      }>;
      const file = template.find((t) => t.label === 'File');
      const printItem = file!.submenu!.find((i) => i.label === 'Print...');
      expect(printItem!.id).toBe('menu.print');
    });

    it('disables and re-enables menu.print via applyMenuEnabledState', () => {
      _menu.items.set('menu.print', { enabled: true });
      _lastMenu.current = _menu;
      applyMenuEnabledState({ 'menu.print': false });
      expect(_menu.items.get('menu.print')!.enabled).toBe(false);
      applyMenuEnabledState({ 'menu.print': true });
      expect(_menu.items.get('menu.print')!.enabled).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // DEF-080 — Help -> Check for Update menu item
  // -------------------------------------------------------------------------

  describe('DEF-080: Check for Update menu item', () => {
    beforeEach(() => {
      _lastMenu.current = null;
      _menu.items.clear();
      _setApplicationMenu.mockClear();
      _buildFromTemplate.mockClear();
      _app.quit.mockClear();
    });

    it('adds a Help -> Check for Update item with the CmdOrCtrl+Shift+U accelerator', () => {
      buildAppMenu({ sendToFocused: vi.fn(), sendPrintRequest: vi.fn() });

      const template = _buildFromTemplate.mock.calls[0][0] as Array<{
        label?: string;
        submenu?: Array<{
          label?: string;
          accelerator?: string;
          type?: string;
          click?: () => void;
        }>;
      }>;
      const help = template.find((t) => t.label === 'Help');
      expect(help).toBeDefined();
      const helpItems = help!.submenu ?? [];
      const checkItem = helpItems.find((i) => i.label === 'Check for Update...');
      expect(checkItem).toBeDefined();
      expect(checkItem!.accelerator).toBe('CmdOrCtrl+Shift+U');
    });

    it('emits the update.check action when clicked', () => {
      const send = vi.fn();
      buildAppMenu({ sendToFocused: send, sendPrintRequest: vi.fn() });

      const template = _buildFromTemplate.mock.calls[0][0] as Array<{
        label?: string;
        submenu?: Array<{
          label?: string;
          click?: () => void;
        }>;
      }>;
      const help = template.find((t) => t.label === 'Help');
      const checkItem = help!.submenu!.find((i) => i.label === 'Check for Update...');
      expect(typeof checkItem!.click).toBe('function');
      checkItem!.click!();

      // The menu's send() wraps the action as ('menu:action', { action }).
      expect(send).toHaveBeenCalledWith('menu:action', { action: 'checkForUpdate' });
    });

    it('keeps the About TFlex item in the Help menu', () => {
      buildAppMenu({ sendToFocused: vi.fn(), sendPrintRequest: vi.fn() });

      const template = _buildFromTemplate.mock.calls[0][0] as Array<{
        label?: string;
        submenu?: Array<{ label?: string }>;
      }>;
      const help = template.find((t) => t.label === 'Help');
      const helpItems = help!.submenu ?? [];
      expect(helpItems.some((i) => i.label === 'About TFlex')).toBe(true);
    });

    it('uses an accelerator that is free of collisions with the rest of the menu', () => {
      buildAppMenu({ sendToFocused: vi.fn(), sendPrintRequest: vi.fn() });

      const template = _buildFromTemplate.mock.calls[0][0] as Array<{
        submenu?: Array<{ accelerator?: string; type?: string }>;
      }>;
      const accelerators: string[] = [];
      for (const top of template) {
        for (const item of top.submenu ?? []) {
          if (item.type !== 'separator' && item.accelerator) {
            accelerators.push(item.accelerator);
          }
        }
      }
      // No duplicate accelerators across the whole menu.
      expect(new Set(accelerators).size).toBe(accelerators.length);
      expect(accelerators).toContain('CmdOrCtrl+Shift+U');
    });
  });
});
