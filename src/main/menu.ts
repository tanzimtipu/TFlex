import { app, Menu, type MenuItemConstructorOptions } from 'electron';

interface MenuDeps {
  /** Called when a menu action needs the active window to send an IPC event. */
  sendToFocused(action: string, ...args: unknown[]): void;
}

/**
 * Build and set the application menu.
 *
 * Menu actions send IPC events to the focused renderer window. The renderer
 * handles these events using the same handlers as toolbar/button interactions,
 * so the menu is a thin dispatch layer with no business logic.
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
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => send('save'),
        },
        {
          label: 'Save As...',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => send('saveAs'),
        },
        { type: 'separator' },
        {
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
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          click: () => send('undo'),
        },
        {
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
          label: 'Show Tools Palette',
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
          label: 'About TFlex',
          click: () => send('about'),
        },
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}