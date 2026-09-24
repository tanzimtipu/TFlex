import { app, Menu, type MenuItemConstructorOptions } from 'electron';
import type { MenuEnabledState, MenuItemId } from '../shared/types';

/** DEF-065 — the set of menu item ids whose enabled state the renderer can
 *  toggle via `menu:setEnabled`. Kept here (next to the template that
 *  assigns them) so a new toggle-able item is added in both places at once.
 *  This must match `MenuItemId` in shared/types.ts exactly. */
export const TOGGLEABLE_MENU_IDS: readonly MenuItemId[] = [
  'menu.save',
  'menu.saveAs',
  'menu.print',
  'menu.closeTab',
  'menu.undo',
  'menu.redo',
];

interface MenuDeps {
  /** Called when a menu action needs the active window to send an IPC event. */
  sendToFocused(action: string, ...args: unknown[]): void;
  /** Phase 30 — File > Print / Ctrl+P. Fired on the dedicated
   *  `print:request` channel so the renderer opens its print dialog (the
   *  same one the title-bar Print icon opens). Separate from
   *  `sendToFocused` because it is not a `menu:action` payload. */
  sendPrintRequest(): void;
}

/**
 * Build and set the application menu.
 *
 * Menu actions send IPC events to the focused renderer window. The renderer
 * handles these events using the same handlers as toolbar/button interactions,
 * so the menu is a thin dispatch layer with no business logic.
 *
 * DEF-065: the Save / Save As / Close Tab / Undo / Redo items carry stable
 * `id` fields so `applyMenuEnabledState` can look them up via
 * `Menu.getApplicationMenu()?.getMenuItemById(id)` and flip `.enabled`.
 */
export function buildAppMenu(deps: MenuDeps): void {
  const isMac = process.platform === 'darwin';

  const send = (action: string): void => deps.sendToFocused('menu:action', { action });

  const template: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open...',
          accelerator: 'CmdOrCtrl+O',
          click: () => send('open'),
        },
        {
          label: 'Merge...',
          accelerator: 'CmdOrCtrl+Shift+O',
          click: () => send('merge'),
        },
        { type: 'separator' },
        {
          id: 'menu.save',
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => send('save'),
        },
        {
          id: 'menu.saveAs',
          label: 'Save As...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => send('saveAs'),
        },
        // Phase 30 — industry convention: Print sits between Save As and
        // Close (Ctrl+P). Fires the dedicated print:request event so the
        // renderer opens the same dialog as the title-bar Print icon.
        // DEF-271 — the id lets the renderer disable it via menu:setEnabled
        // when no document is open.
        {
          id: 'menu.print',
          label: 'Print...',
          accelerator: 'CmdOrCtrl+P',
          click: () => deps.sendPrintRequest(),
        },
        { type: 'separator' },
        {
          id: 'menu.closeTab',
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: () => send('closeTab'),
        },
        { type: 'separator' },
        {
          label: 'Exit',
          accelerator: isMac ? 'Cmd+Q' : 'Alt+F4',
          click: () => app.quit(),
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        {
          id: 'menu.undo',
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          click: () => send('undo'),
        },
        {
          id: 'menu.redo',
          label: 'Redo',
          accelerator: 'CmdOrCtrl+Shift+Z',
          click: () => send('redo'),
        },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
        { type: 'separator' },
        {
          label: 'Preferences...',
          accelerator: 'CmdOrCtrl+,',
          click: () => send('preferences'),
        },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle Theme',
          accelerator: 'CmdOrCtrl+Shift+T',
          click: () => send('toggleTheme'),
        },
        { type: 'separator' },
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+=',
          click: () => send('zoomIn'),
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: () => send('zoomOut'),
        },
        {
          label: 'Fit Width',
          accelerator: 'CmdOrCtrl+0',
          click: () => send('fitWidth'),
        },
        {
          label: 'Fit Page',
          accelerator: 'CmdOrCtrl+9',
          click: () => send('fitPage'),
        },
        { type: 'separator' },
        { role: 'toggleDevTools' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Tools',
      submenu: [
        {
          label: 'Command Palette...',
          accelerator: 'CmdOrCtrl+Shift+P',
          click: () => send('showToolsPalette'),
        },
        { type: 'separator' },
        {
          label: 'Recognize Text...',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => send('recognizeText'),
        },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { role: 'close' },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          // DEF-080 — manual re-check. Emits the `checkForUpdate`
          // action; the renderer's menu dispatcher routes it to
          // `ctx.checkForUpdate()`, which opens the UpdatePromptDialog
          // and calls `tflex.update.check()` -> the `update:check` IPC
          // -> `updateService.checkForUpdates()` (autoDownload=false,
          // same semantics as the start-path check). The accelerator
          // is CmdOrCtrl+Shift+U (U for Update) — free of collisions
          // with the File/Edit/View/Tools accelerators above.
          label: 'Check for Update...',
          accelerator: 'CmdOrCtrl+Shift+U',
          click: () => send('checkForUpdate'),
        },
        { type: 'separator' },
        {
          label: 'About TFlex',
          click: () => send('about'),
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

/**
 * DEF-065 — apply a partial `{ id -> enabled }` map to the current
 * application menu. Looks each id up via `getMenuItemById` and flips
 * `.enabled`. Ids that are absent from the map (or not present in the
 * menu) are left untouched. Safe to call when no menu is set: a null
 * `getApplicationMenu()` result is a no-op. Exported so the
 * `menu:setEnabled` IPC listener in main/index.ts is a one-liner and
 * the core logic is unit-testable without spinning up Electron.
 */
export function applyMenuEnabledState(state: MenuEnabledState): void {
  const menu = Menu.getApplicationMenu();
  if (menu === null) return;
  for (const key of Object.keys(state) as MenuItemId[]) {
    const item = menu.getMenuItemById(key);
    if (item !== undefined && item !== null) {
      item.enabled = Boolean(state[key]);
    }
  }
}