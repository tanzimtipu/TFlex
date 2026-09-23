import { BrowserWindow, screen, type Rectangle } from 'electron';
import { join } from 'node:path';
import type { AppSettings, WindowGeometry } from '../shared/types';

interface WindowDeps {
  rendererHtml: string;
  rendererDevUrl?: string;
  onGeometryChanged: (geometry: WindowGeometry) => void;
  /** DEF-303 — immediate window-state notification. Fires on
   *  maximize / unmaximize / minimize / restore, BEFORE (and independent of)
   *  the 300 ms geometry debounce, so the renderer's caption / controls can
   *  reflect the new state in single-digit milliseconds. This callback must
   *  NOT persist: the debounced `onGeometryChanged` below still writes the
   *  geometry exactly as before, once per burst. Optional so callers that do
   *  not care about the caption (tests) keep working. */
  onWindowStateChanged?: (geometry: WindowGeometry) => void;
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

/** Matches minWidth / minHeight below; the fit helper must not shrink past them. */
const MIN_WINDOW_WIDTH = 640;
const MIN_WINDOW_HEIGHT = 480;

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

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

/**
 * Phase 35 - pick the display whose WORK AREA the saved geometry mostly
 * overlaps (the monitor the window was last on), falling back to the
 * first display (primary) when the geometry sits off every monitor. Only
 * the work area is used, never the full bounds, so a restored window can
 * never be positioned over the taskbar strip.
 */
export function workAreaForGeometry(
  geometry: WindowGeometry,
  displays: readonly { workArea: Rectangle }[],
): Rectangle {
  const fallback: Rectangle = { x: 0, y: 0, width: 1920, height: 1080 };
  let best: Rectangle | null = null;
  let bestArea = 0;
  for (const display of displays) {
    const a = display.workArea;
    const overlapX = Math.min(a.x + a.width, geometry.x + geometry.width) - Math.max(a.x, geometry.x);
    const overlapY = Math.min(a.y + a.height, geometry.y + geometry.height) - Math.max(a.y, geometry.y);
    const area = Math.max(0, overlapX) * Math.max(0, overlapY);
    if (area > bestArea) {
      bestArea = area;
      best = a;
    }
  }
  return best ?? displays[0]?.workArea ?? fallback;
}

/**
 * Phase 35 - clamp a saved geometry into a display's work area: the
 * window may never be larger than the work area, nor positioned so it
 * hangs over the taskbar strip or off the desktop. The min-size floor is
 * preserved so a tiny work area cannot collapse the window below the
 * BrowserWindow minimum. Pure and exported for the unit tests.
 */
export function fitGeometryToWorkArea(
  geometry: WindowGeometry,
  workArea: Rectangle,
): WindowBounds {
  const width = Math.max(MIN_WINDOW_WIDTH, Math.min(geometry.width, workArea.width));
  const height = Math.max(MIN_WINDOW_HEIGHT, Math.min(geometry.height, workArea.height));
  const maxX = workArea.x + workArea.width - width;
  const maxY = workArea.y + workArea.height - height;
  const x = Math.min(Math.max(geometry.x, workArea.x), Math.max(workArea.x, maxX));
  const y = Math.min(Math.max(geometry.y, workArea.y), Math.max(workArea.y, maxY));
  return { x, y, width, height };
}

export function createMainWindow(settings: AppSettings, deps: WindowDeps): BrowserWindow {
  const geometry = settings.geometry;
  const visible = geometry.maximized || rectOnSomeDisplay(geometry);
  // Phase 35 - size and position inside the WORK AREA of the display the
  // window was last on (never the full bounds), so the default window can
  // never cover the taskbar strip or spill off the desktop. An off-screen
  // saved position keeps the existing "centre on the primary display"
  // behaviour (x/y undefined) while still clamping the size.
  const displays = screen.getAllDisplays();
  const workArea = workAreaForGeometry(geometry, displays);
  const bounds = fitGeometryToWorkArea(geometry, workArea);

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
  // custom controls. `resizable`, `maximizable` and `minimizable` are
  // restated explicitly so the OS edge resize handles and the caption
  // gestures survive the frameless switch (`frame: false` still exposes the
  // thin edge resize border on Windows). Aero Snap (drag the
  // `-webkit-app-region: drag` region to a screen edge to maximize/snap)
  // keeps working because the OS treats that region as a caption area.
  //
  // Phase 35 — TRANSPARENCY REMOVED (operator: "app doesn't have default
  // windows behaviour ... hidden taskbar doesn't pop-up on mouse hover").
  // `transparent: true` makes the window a Windows layered (WS_EX_LAYERED)
  // window; Electron documents that transparent windows are not resizable
  // ("setting resizable to true may make the transparent window stop
  // working") and layered windows are a known cause of swallowed Aero
  // Snap/maximize and auto-hide taskbar hover. Behaviour wins over the
  // Phase-14 wallpaper show-through: the frosted look now diffuses the
  // app's own `--tf-bg` ambient base (set as `backgroundColor` below)
  // instead of the desktop wallpaper, and the translucent chrome keeps its
  // CSS `backdrop-filter` blur. The trade-off is recorded in the Phase-35
  // report; the wallpaper-show-through contract (DEF-181/182) is retired.
  // No `backgroundMaterial` (no native acrylic/mica): the Windows 11 DWM
  // acrylic material re-renders its wallpaper blur on every mouse-move
  // invalidation (Chromium repaints hover states on each move), so the
  // wallpaper behind the glass flickered as the mouse moved.
  // `backgroundColor` matches the frosted theme's `--tf-bg` (#eef1f5) so
  // the opaque base reads as the app's own ambient surface and the
  // pre-paint frame is not a white flash. `hasShadow: true` keeps the
  // frameless drop shadow. `show: false` + `ready-to-show` (below) hides
  // the uninitialized frame.
  const win = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: visible ? bounds.x : undefined,
    y: visible ? bounds.y : undefined,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    frame: false,
    resizable: true,
    maximizable: true,
    minimizable: true,
    show: false,
    autoHideMenuBar: false,
    backgroundColor: '#eef1f5',
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
  const readGeometry = (): WindowGeometry | null => {
    const maximized = win.isMaximized();
    const bounds = win.getNormalBounds();
    if (bounds.width < 640 || bounds.height < 480) {
      return null;
    }
    return {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      maximized,
    };
  };
  const reportGeometry = (): void => {
    const geometry = readGeometry();
    if (geometry === null) {
      return;
    }
    deps.onGeometryChanged(geometry);
  };
  // DEF-303 — the state transition itself is emitted synchronously, with no
  // debounce, so the caption / controls update immediately. The 300 ms
  // debounce below is left to do exactly what it did before: persist the
  // geometry (position / size) once per burst.
  const emitWindowState = (): void => {
    const geometry = readGeometry();
    if (geometry === null) {
      return;
    }
    deps.onWindowStateChanged?.(geometry);
  };
  const scheduleReport = (): void => {
    if (debounce !== null) {
      clearTimeout(debounce);
    }
    debounce = setTimeout(reportGeometry, GEOMETRY_DEBOUNCE_MS);
  };
  win.on('move', scheduleReport);
  win.on('resize', scheduleReport);
  // DEF-303 — state events emit immediately AND (for maximize / unmaximize,
  // which change the persisted `maximized` flag) keep the existing debounced
  // geometry persist. A minimize -> restore -> maximize burst therefore
  // emits three immediate state updates and still writes the geometry once.
  win.on('maximize', () => {
    emitWindowState();
    scheduleReport();
  });
  win.on('unmaximize', () => {
    emitWindowState();
    scheduleReport();
  });
  win.on('minimize', emitWindowState);
  win.on('restore', emitWindowState);

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
