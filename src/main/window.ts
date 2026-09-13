import { BrowserWindow, screen, type Rectangle } from 'electron';
import { join } from 'node:path';
import type { AppSettings, WindowGeometry } from '../shared/types';

interface WindowDeps {
  rendererHtml: string;
  rendererDevUrl?: string;
  onGeometryChanged: (geometry: WindowGeometry) => void;
  /** DEF-142 — invoked synchronously from the window's 'close' event so the
   *  caller can `event.preventDefault()` when the renderer has unsaved
   *  edits. The caller (index.ts) decides whether to abort the close and
   *  push `window:closeRequested` to the renderer; a no-op / omitted
   *  callback lets the window close immediately (the existing behavior for
   *  callers that do not wire the gate). The event shape is structural —
   *  only `preventDefault` is used; the real `Electron.Event` satisfies it. */
  onCloseRequested?: (win: BrowserWindow, event: { preventDefault(): void }) => void;
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

  // Phase 13 — frameless window. The renderer draws its own title bar
  // (the window-drag region is declared with CSS `-webkit-app-region: drag`
  // on the renderer's title element, and `-webkit-app-region: no-drag` on
  // any interactive children inside it) and its own caption buttons over
  // the existing window:minimize / window:maximize / window:close IPC.
  //
  // `frame: false` is the cleanest fully-frameless Windows path: it removes
  // the native title bar AND the native caption buttons, so there is no
  // double set of controls. We deliberately do NOT pair it with
  // `titleBarStyle: 'hidden'` + `titleBarOverlay` — that combination would
  // re-introduce native caption buttons that duplicate the renderer's
  // custom controls. `resizable` defaults to true; it is restated
  // explicitly so the OS edge resize handles survive the frameless switch
  // (`frame: false` still exposes the thin edge resize border on Windows).
  // Aero Snap (drag the `-webkit-app-region: drag` region to a screen edge
  // to maximize/snap) keeps working because the OS treats that region as a
  // caption area.
  // Phase 14 — transparent window so the desktop wallpaper shows through the
  // renderer's frosted-glass panels (`backdrop-filter: blur()` in CSS only blurs
  // what is *behind* the element *in the compositor*; with an opaque window that
  // is the app's own aurora background, not the wallpaper). `transparent: true`
  // removes the OS-supplied opaque backdrop so the wallpaper composites through
  // the renderer's translucent sheets — the sheets diffuse whatever the OS
  // composites behind the window, and the wallpaper supplies the glass tint
  // (the DEF-182 design contract).
  // No `backgroundMaterial` (no native acrylic/mica): the Windows 11 DWM
  // acrylic material re-renders its wallpaper blur on every mouse-move
  // invalidation (Chromium repaints hover states on each move), so the
  // wallpaper behind the glass flickered as the mouse moved. The CSS-only
  // effect is the intended one: `backdrop-filter` still blurs the
  // renderer-drawn content behind each chrome surface, and no DWM material is
  // re-sampled on mouse move. (Mica was rejected as the alternative: it is a
  // static monochrome tone, not see-through glass, and would break the
  // wallpaper-shows-through contract.)
  // `hasShadow: true` keeps the frameless window's drop shadow so it still
  // reads as a floating surface against the wallpaper. Frameless
  // (`frame: false`) remains compatible — transparency does not re-introduce
  // the native title bar or caption buttons, so the renderer's custom controls
  // stay the only set. `show: false` + `ready-to-show` (below) is retained
  // because a transparent window flashing its uninitialized background is more
  // visible than an opaque one; the show gate already hides that.
  const win = new BrowserWindow({
    width: geometry.width,
    height: geometry.height,
    x: visible ? geometry.x : undefined,
    y: visible ? geometry.y : undefined,
    minWidth: 640,
    minHeight: 480,
    frame: false,
    resizable: true,
    show: false,
    autoHideMenuBar: false,
    transparent: true,
    hasShadow: true,
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

  win.on('close', (event) => {
    if (debounce !== null) {
      clearTimeout(debounce);
    }
    reportGeometry();
    // DEF-142 — give the caller a chance to preventDefault when the
    // renderer has unsaved edits (the close/quit gate). The caller
    // (index.ts) decides whether to abort the close and push
    // window:closeRequested to the renderer so it can show the existing
    // CloseTabPromptDialog; a no-op / omitted callback lets the window
    // close immediately. The geometry report above already ran, so a
    // prevented close still persists the last window position.
    deps.onCloseRequested?.(win, event);
  });

  if (deps.rendererDevUrl !== undefined) {
    void win.loadURL(deps.rendererDevUrl);
  } else {
    void win.loadFile(deps.rendererHtml);
  }
  return win;
}
