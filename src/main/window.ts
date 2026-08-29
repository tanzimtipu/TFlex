import { BrowserWindow, screen, type Rectangle } from 'electron';
import { join } from 'node:path';
import type { AppSettings, WindowGeometry } from '../shared/types';

interface WindowDeps {
  rendererHtml: string;
  rendererDevUrl?: string;
  onGeometryChanged: (geometry: WindowGeometry) => void;
}

const GEOMETRY_DEBOUNCE_MS = 300;

function mainModuleDir(): string {
  return __dirname;
}

export function resolvePreloadPath(): string {
  return join(mainModuleDir(), '../preload/preload.cjs');
}

function rectOnSomeDisplay(geometry: WindowGeometry): boolean {
  const rect: Rectangle = {
    x: geometry.x,
    y: geometry.y,
    width: geometry.width,
    height: geometry.height,
  };
  return screen.getAllDisplays().some((display) => {
    const a = display.workArea;
    const overlapX = Math.min(a.x + a.width, rect.x + rect.width) - Math.max(a.x, rect.x);
    const overlapY = Math.min(a.y + a.height, rect.y + rect.height) - Math.max(a.y, rect.y);
    return overlapX > 50 && overlapY > 50;
  });
}

export function createMainWindow(settings: AppSettings, deps: WindowDeps): BrowserWindow {
  const geometry = settings.geometry;
  const visible = geometry.maximized || rectOnSomeDisplay(geometry);

  const win = new BrowserWindow({
    width: geometry.width,
    height: geometry.height,
    x: visible ? geometry.x : undefined,
    y: visible ? geometry.y : undefined,
    minWidth: 640,
    minHeight: 480,
    show: false,
    autoHideMenuBar: false,
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (geometry.maximized) {
    win.maximize();
  }
  win.once('ready-to-show', () => {
    win.show();
  });

  let debounce: NodeJS.Timeout | null = null;
  const reportGeometry = (): void => {
    const maximized = win.isMaximized();
    const bounds = win.getNormalBounds();
    if (bounds.width < 640 || bounds.height < 480) {
      return;
    }
    deps.onGeometryChanged({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      maximized,
    });
  };
  const scheduleReport = (): void => {
    if (debounce !== null) {
      clearTimeout(debounce);
    }
    debounce = setTimeout(reportGeometry, GEOMETRY_DEBOUNCE_MS);
  };
  win.on('move', scheduleReport);
  win.on('resize', scheduleReport);
  win.on('maximize', scheduleReport);
  win.on('unmaximize', scheduleReport);

  win.on('close', () => {
    if (debounce !== null) {
      clearTimeout(debounce);
    }
    reportGeometry();
  });

  if (deps.rendererDevUrl !== undefined) {
    void win.loadURL(deps.rendererDevUrl);
  } else {
    void win.loadFile(deps.rendererHtml);
  }
  return win;
}
