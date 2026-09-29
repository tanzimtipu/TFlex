import { BrowserWindow, screen, type Rectangle } from 'electron';
import { join } from 'node:path';
import type { AppSettings, WindowGeometry } from '../shared/types';
import type { OAuthTraceEvent } from '../shared/accounts';
import { cookieSummary, makeOAuthTrace, sanitizeUrlForTrace } from './services/accounts/oauth-trace';

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
  /** DEF-303 — renderer pause/resume signal driven from the window's
   *  'minimize' / 'restore' events. Chromium suspends a minimised window's
   *  frames regardless of the `backgroundThrottling` option (qa measured rAF
   *  at ~1 fps while minimised even with the option off), so the expensive
   *  PDF render/raster loop must be parked explicitly by this signal instead
   *  of waiting on Chromium's rAF cadence. `true` on minimize (pause),
   *  `false` on restore (resume). Optional so callers that do not wire the
   *  pause (tests) keep working. */
  onMinimizedChanged?: (minimized: boolean) => void;
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

/**
 * DEF-142 / DEF-415 — the ONE unsaved-changes close gate, shared by the main
 * window and every detached document window. The `'close'` event invokes
 * `onCloseRequested`; the caller (index.ts) uses it to `event.preventDefault()`
 * and push `window:closeRequested` until the renderer confirms via
 * `window:confirmClose`. `onBeforeClose` lets the main window flush its
 * geometry first; detached windows have no geometry to persist. An omitted
 * `onCloseRequested` keeps the pre-gate behaviour (close immediately).
 */
function installCloseGate(
  win: BrowserWindow,
  onCloseRequested?: (win: BrowserWindow, event: { preventDefault(): void }) => void,
  onBeforeClose?: () => void,
): void {
  win.on('close', (event) => {
    onBeforeClose?.();
    onCloseRequested?.(win, event);
  });
}

// ---------------------------------------------------------------------------
// Phase 44 - auth popup. The renderer's social sign-in (`signIn.social`)
// opens a provider page that must run in a REAL popup window sharing the
// app's session (so the resulting session cookie is visible to the app
// renderer), because a full-window navigation cannot complete in the app
// window. The rules below are deliberately narrow: ONLY https on the
// configured auth host may become a popup; everything else is denied.
// ---------------------------------------------------------------------------

/** Path prefix the auth host uses to hand control back to the app. */
const AUTH_CALLBACK_PATH = '/callback';

export type AuthPopupAction = 'allow' | 'deny';

/**
 * Phase 44 - pure decision for a renderer `window.open` request. `allow`
 * only when the URL parses, is `https:` and its hostname is exactly the
 * configured auth host. Every other case - a different https host, `http:`,
 * `javascript:`, `file:`, a malformed URL, or no configured host - is denied.
 * Exported for the unit tests.
 */
export function decideAuthPopup(url: string, authHost: string | null): AuthPopupAction {
  const host = (authHost ?? '').trim().toLowerCase();
  if (host.length === 0) return 'deny';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'deny';
  }
  if (parsed.protocol !== 'https:') return 'deny';
  if (parsed.hostname.toLowerCase() !== host) return 'deny';
  return 'allow';
}

/**
 * Parse the configured auth base URL down to a bare lowercase hostname.
 * Returns null when absent or unparseable. Exported for the unit tests.
 */
export function deriveAuthHost(authBaseUrl: string | null): string | null {
  if (authBaseUrl === null) return null;
  try {
    const parsed = new URL(authBaseUrl);
    const host = parsed.hostname.trim().toLowerCase();
    return host.length > 0 ? host : null;
  } catch {
    return null;
  }
}

/**
 * Phase 46 - true when `url` is the exact loopback callback URL a flow minted
 * (same scheme/host/port and pathname). The query string is deliberately
 * ignored: the provider appends the OAuth `code`/`state` and the flow's token
 * to the callback, so comparing the full URL would never match. Pure and
 * exported for the unit tests.
 */
export function isLoopbackCompletionUrl(url: string, loopbackUrl: string | null): boolean {
  if (loopbackUrl === null) return false;
  let target: URL;
  let loopback: URL;
  try {
    target = new URL(url);
    loopback = new URL(loopbackUrl);
  } catch {
    return false;
  }
  return target.origin === loopback.origin && target.pathname === loopback.pathname;
}

/**
 * Phase 44 - true when the popup has landed on the flow's completion URL:
 * the auth host's `/callback` path (any suffix), the app's own URL/origin, or
 * (Phase 46) the exact loopback callback URL this flow minted. Used to
 * auto-close the popup so no stray window is left behind. Exported for the
 * unit tests.
 */
export function isAuthCompletionUrl(
  url: string,
  authHost: string | null,
  appUrl: string | null,
  loopbackUrl: string | null = null,
): boolean {
  if (isLoopbackCompletionUrl(url, loopbackUrl)) {
    return true;
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  const host = (authHost ?? '').trim().toLowerCase();
  if (
    host.length > 0 &&
    parsed.protocol === 'https:' &&
    parsed.hostname.toLowerCase() === host &&
    (parsed.pathname === AUTH_CALLBACK_PATH ||
      parsed.pathname.startsWith(`${AUTH_CALLBACK_PATH}/`))
  ) {
    return true;
  }
  if (appUrl !== null) {
    try {
      const app = new URL(appUrl);
      if (app.protocol === 'file:') {
        return parsed.protocol === 'file:' && parsed.pathname === app.pathname;
      }
      return parsed.origin === app.origin;
    } catch {
      return false;
    }
  }
  return false;
}

export interface AuthPopupDeps {
  /** Resolve the configured auth host at decision time; null denies all. */
  getAuthHost: () => string | null;
  /** The app's own renderer URL, used only for completion detection. */
  getAppUrl: () => string | null;
  /** Phase 46 - the absolute loopback URL the current flow minted, or null.
   *  Used only to recognise the flow's completion landing so the popup can be
   *  closed; never returned to the renderer and never allowed by the opener. */
  getLoopbackUrl?: () => string | null;
  /** DEF-365 - called when a popup closes, so the retained minted callback URL
   *  (which carries the flow's token) is dropped as soon as its popup is gone. */
  onPopupClosed?: () => void;
  /** Phase 46 - dev-oriented trace sink for the popup chain. Payload is
   *  redaction-safe (no token/code/cookie value). */
  onTrace?: (event: OAuthTraceEvent) => void;
}

/**
 * Phase 44 - wire the main window's `window.open` path to the auth popup
 * rules. `setWindowOpenHandler` decides allow/deny; `did-create-window`
 * attaches the close-on-completion listener and tracks the child so it can
 * never outlive the main window. The popup gets no node integration, keeps
 * context isolation and sandbox on, and is explicitly bound to the main
 * window's session, so the auth cookie it receives is visible to the app
 * renderer. Main never reads or forwards the token.
 */
export function installAuthPopupHandler(win: BrowserWindow, deps: AuthPopupDeps): void {
  const popups = new Set<BrowserWindow>();

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (decideAuthPopup(url, deps.getAuthHost()) === 'deny') {
      return { action: 'deny' };
    }
    deps.onTrace?.(
      makeOAuthTrace('popup-open', {
        url: sanitizeUrlForTrace(url),
        host: deps.getAuthHost() ?? undefined,
      }),
    );
    return {
      action: 'allow',
      overrideBrowserWindowOptions: {
        parent: win,
        autoHideMenuBar: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          session: win.webContents.session,
        },
      },
    };
  });

  win.webContents.on('did-create-window', (child) => {
    popups.add(child);
    // Capture the shared session now: after `closed` the child's webContents
    // is gone, but the cookie probe below still needs the session handle.
    const childSession = child.webContents.session;
    const authHost = deps.getAuthHost();

    child.on('closed', () => {
      popups.delete(child);
      deps.onTrace?.(makeOAuthTrace('popup-closed', { host: authHost ?? undefined }));
      // DEF-365 - the popup is gone, so the minted URL no longer needs to stay
      // matchable; drop it (the listener itself already shut down on the hit).
      deps.onPopupClosed?.();
      void probeAuthHostCookies(childSession, authHost, deps.onTrace);
    });
    // Observe only, never prevent: the auth host's callback response (which
    // carries the Set-Cookie) must be allowed to commit before we close.
    child.webContents.on('did-navigate', (_event, url) => {
      deps.onTrace?.(makeOAuthTrace('popup-navigate', { url: sanitizeUrlForTrace(url) }));
      if (
        isAuthCompletionUrl(url, authHost, deps.getAppUrl(), deps.getLoopbackUrl?.() ?? null) &&
        !child.isDestroyed()
      ) {
        deps.onTrace?.(makeOAuthTrace('popup-complete', { url: sanitizeUrlForTrace(url) }));
        child.close();
      }
    });
    child.webContents.on('will-redirect', (_event, url) => {
      deps.onTrace?.(makeOAuthTrace('popup-redirect', { url: sanitizeUrlForTrace(url) }));
    });
    child.webContents.on('did-redirect-navigation', (_event, url) => {
      deps.onTrace?.(makeOAuthTrace('popup-redirect', { url: sanitizeUrlForTrace(url) }));
    });
    child.webContents.on('did-navigate-in-page', (_event, url) => {
      deps.onTrace?.(makeOAuthTrace('popup-navigate-in-page', { url: sanitizeUrlForTrace(url) }));
    });
    child.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) return;
      deps.onTrace?.(
        makeOAuthTrace('popup-fail-load', {
          errorCode,
          errorDescription,
          url: sanitizeUrlForTrace(validatedURL),
        }),
      );
    });
  });

  // The popup must never outlive the app: closing the main window closes it.
  win.on('closed', () => {
    for (const popup of popups) {
      if (!popup.isDestroyed()) {
        popup.close();
      }
    }
    popups.clear();
  });
}

/**
 * Phase 46 - report the auth-host cookies present in the shared session after
 * a flow, as NAMES and a COUNT only. A `session.cookies.get` call is never
 * rejected for a parseable URL; the catch is only for a destroyed session.
 */
async function probeAuthHostCookies(
  session: { cookies: { get(filter: { url: string }): Promise<{ name?: unknown }[]> } },
  authHost: string | null,
  onTrace: ((event: OAuthTraceEvent) => void) | undefined,
): Promise<void> {
  if (authHost === null || onTrace === undefined) return;
  try {
    const cookies = await session.cookies.get({ url: `https://${authHost}/` });
    onTrace(makeOAuthTrace('popup-cookies', { host: authHost, ...cookieSummary(cookies) }));
  } catch {
    // A session that is already gone has nothing to report.
  }
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
    // Phase 49 — the native window title (taskbar tooltip / Alt-Tab / the OS
    // window list) is the product name. The renderer's own document title
    // takes over once the page loads.
    title: 'Jovrel',
    hasShadow: true,
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // DEF-303 — `backgroundThrottling: false` was tried here to keep the
      // renderer's rAF loop alive while minimised, but qa measured that
      // Chromium still suspends a minimised window's frames (~1 rAF frame/s
      // with the option off, ~62 timer ticks/s) and the restore latency was
      // unchanged. It bought nothing for the latency and cost ~62 timer
      // ticks/s of CPU while minimised, so it was reverted to the default.
      // The explicit `onMinimizedChanged` pause signal below is what parks
      // the PDF render/raster work while minimised.
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
  win.on('minimize', () => {
    emitWindowState();
    deps.onMinimizedChanged?.(true);
  });
  win.on('restore', () => {
    emitWindowState();
    deps.onMinimizedChanged?.(false);
  });

  installCloseGate(
    win,
    deps.onCloseRequested,
    () => {
      if (debounce !== null) {
        clearTimeout(debounce);
      }
      reportGeometry();
    },
  );

  if (deps.rendererDevUrl !== undefined) {
    void win.loadURL(deps.rendererDevUrl);
  } else {
    void win.loadFile(deps.rendererHtml);
  }
  return win;
}

/**
 * Phase 58 — a detached document window. Same renderer bundle and the same
 * hardened webPreferences as `createMainWindow`, but a SEPARATE window: its
 * own default size offset from the cursor, no geometry persistence, no
 * main-window callbacks, and never held as THE main window. It is created by
 * the tab-windows service and closed by `tab:empty` (or the user).
 *
 * DEF-416 — it does NOT load the page itself. The caller attaches the adopt
 * `did-finish-load` listener first, then calls the returned `load()`, so the
 * event can never fire before the listener exists.
 *
 * DEF-415 — `onCloseRequested` is the SAME close gate the main window uses
 * (installCloseGate), so a detached window holding unsaved edits prompts
 * before it closes.
 */
export interface DetachedWindowHandle {
  window: BrowserWindow;
  load: () => void;
}

export function createDetachedWindow(deps: {
  rendererHtml: string;
  rendererDevUrl?: string;
  onCloseRequested?: (win: BrowserWindow, event: { preventDefault(): void }) => void;
}): DetachedWindowHandle {
  const cursor = screen.getCursorScreenPoint();
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    x: cursor.x + 40,
    y: cursor.y + 40,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    frame: false,
    resizable: true,
    maximizable: true,
    minimizable: true,
    show: false,
    autoHideMenuBar: false,
    backgroundColor: '#eef1f5',
    title: 'Jovrel',
    hasShadow: true,
    webPreferences: {
      preload: resolvePreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.once('ready-to-show', () => {
    win.show();
  });
  // DEF-415 — the detached window shares the main window's close gate.
  installCloseGate(win, deps.onCloseRequested);
  // Phase 58 — route the renderer's tear-out to "return to the origin
  // window" instead of "detach again" by tagging this window's load with the
  // hash `detached`. The main window's load stays hash-free.
  const load = (): void => {
    if (deps.rendererDevUrl !== undefined) {
      const detachedUrl = deps.rendererDevUrl.includes('#')
        ? deps.rendererDevUrl
        : `${deps.rendererDevUrl}#detached`;
      void win.loadURL(detachedUrl);
    } else {
      void win.loadFile(deps.rendererHtml, { hash: 'detached' });
    }
  };
  return { window: win, load };
}
