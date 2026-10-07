import { vi, describe, it, expect, beforeEach } from 'vitest';
import { join } from 'node:path';
import type { AppSettings } from '../../../src/shared/types';

// ---------------------------------------------------------------------------
// vi.hoisted() — all shared mutable state for the mock
// ---------------------------------------------------------------------------

const { _windows, _getAllDisplays } = vi.hoisted(() => {
  const _windows: Array<Record<string, unknown>> = [];
  const _getAllDisplays = vi.fn().mockReturnValue([
    {
      workArea: { x: 0, y: 0, width: 1920, height: 1080 },
      bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    },
  ]);
  return { _windows, _getAllDisplays };
});

// Helper to get the most recently constructed mock window
function lastWindow(): Record<string, unknown> {
  return _windows[_windows.length - 1] as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Mock electron — BrowserWindow must be a real class so `new` works
// ---------------------------------------------------------------------------

vi.mock('electron', () => {
  class MockBrowserWindow {
    _opts: Record<string, unknown>;
    _listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
    on: ReturnType<typeof vi.fn>;
    once: ReturnType<typeof vi.fn>;
    maximize: ReturnType<typeof vi.fn>;
    show: ReturnType<typeof vi.fn>;
    isMaximized: ReturnType<typeof vi.fn>;
    isMinimized: ReturnType<typeof vi.fn>;
    isDestroyed: ReturnType<typeof vi.fn>;
    getNormalBounds: ReturnType<typeof vi.fn>;
    loadURL: ReturnType<typeof vi.fn>;
    loadFile: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    focus: ReturnType<typeof vi.fn>;
    restore: ReturnType<typeof vi.fn>;
    webContents: { send: ReturnType<typeof vi.fn> };

    constructor(opts: Record<string, unknown>) {
      this._opts = opts;
      this.on = vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        (this._listeners[event] ??= []).push(cb);
      });
      this.once = vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        (this._listeners[event] ??= []).push(cb);
      });
      this.maximize = vi.fn();
      this.show = vi.fn();
      this.isMaximized = vi.fn().mockReturnValue(false);
      this.isMinimized = vi.fn().mockReturnValue(false);
      this.isDestroyed = vi.fn().mockReturnValue(false);
      this.getNormalBounds = vi.fn().mockReturnValue({
        x: 100, y: 100, width: 1440, height: 900,
      });
      this.loadURL = vi.fn().mockResolvedValue(undefined);
      this.loadFile = vi.fn().mockResolvedValue(undefined);
      this.close = vi.fn();
      this.focus = vi.fn();
      this.restore = vi.fn();
      this.webContents = { send: vi.fn() };
      _windows.push(this as unknown as Record<string, unknown>);
    }

    /** Emit an event on this window (for tests) */
    _emit(event: string, ...args: unknown[]) {
      for (const cb of this._listeners[event] ?? []) {
        cb(...args);
      }
    }
  }

  return {
    app: { getAppPath: () => process.cwd() },
    BrowserWindow: MockBrowserWindow,
    screen: {
      getAllDisplays: _getAllDisplays,
    },
  };
});

import { createMainWindow, resolvePreloadPath } from '../../../src/main/window';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolvePreloadPath', () => {
  it('returns a path ending with preload/preload.cjs', () => {
    const p = resolvePreloadPath();
    expect(p).toBeTruthy();
    expect(p.replace(/\\/g, '/')).toMatch(/\/preload\/preload\.cjs$/);
  });
});

describe('createMainWindow', () => {
  const defaultSettings: AppSettings = {
    theme: 'dark',
    geometry: { x: 100, y: 100, width: 1440, height: 900, maximized: false },
    recentFiles: [],
  };

  beforeEach(() => {
    _windows.length = 0;
    _getAllDisplays.mockReturnValue([
      {
        workArea: { x: 0, y: 0, width: 1920, height: 1080 },
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      },
    ]);
  });

  it('creates a BrowserWindow with the geometry from settings', () => {
    createMainWindow(
      {
        ...defaultSettings,
        geometry: { x: 200, y: 300, width: 1200, height: 800, maximized: false },
      },
      { rendererHtml: '/app/renderer/index.html', onGeometryChanged: vi.fn() },
    );

    const win = lastWindow();
    // Phase 35 — y is clamped so the window bottom (300 + 800 = 1100) stays
    // inside the 1080-tall work area: 1080 - 800 = 280.
    expect(win._opts).toMatchObject({ width: 1200, height: 800, x: 200, y: 280 });
  });

  it('sets the shipped Jovrel app icon on the window', () => {
    createMainWindow(defaultSettings, {
      rendererHtml: '/app/renderer/index.html',
      onGeometryChanged: vi.fn(),
    });

    const opts = lastWindow()._opts as Record<string, unknown>;
    expect(opts.icon).toBe(join(process.cwd(), 'assets', 'brand', 'jovrel.ico'));
  });

  it('maximizes the window when geometry.maximized is true', () => {
    createMainWindow(
      {
        ...defaultSettings,
        geometry: { ...defaultSettings.geometry, maximized: true },
      },
      { rendererHtml: '/app/renderer/index.html', onGeometryChanged: vi.fn() },
    );

    expect(lastWindow().maximize).toHaveBeenCalled();
  });

  it('does not maximize the window when geometry.maximized is false', () => {
    createMainWindow(
      defaultSettings,
      { rendererHtml: '/app/renderer/index.html', onGeometryChanged: vi.fn() },
    );

    expect(lastWindow().maximize).not.toHaveBeenCalled();
  });

  // Phase 35 — the frontend reported getBackgroundColor() === '#000000'.
  // Verified against Electron 44: a window created WITHOUT `transparent` and
  // WITH `backgroundColor` returns that colour; only the retired
  // `transparent: true` build reported #000000 (alpha dropped). This guards
  // the opaque base + the absence of the transparency flag.
  it('sets the frosted base as an opaque backgroundColor and no transparent flag', () => {
    createMainWindow(defaultSettings, {
      rendererHtml: '/app/renderer/index.html',
      onGeometryChanged: vi.fn(),
    });

    const opts = lastWindow()._opts as Record<string, unknown>;
    expect(opts.backgroundColor).toBe('#eef1f5');
    expect('transparent' in opts).toBe(false);
    expect(opts.frame).toBe(false);
  });

  it('calls onGeometryChanged when the window moves or resizes', () => {
    vi.useFakeTimers();
    const onGeometryChanged = vi.fn();

    createMainWindow(defaultSettings, {
      rendererHtml: '/app/renderer/index.html',
      onGeometryChanged,
    });

    const win = lastWindow();
    (win.isMaximized as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (win.getNormalBounds as ReturnType<typeof vi.fn>).mockReturnValue({
      x: 50, y: 60, width: 1024, height: 768,
    });

    (win as any)._emit('resize');
    vi.advanceTimersByTime(350);

    expect(onGeometryChanged).toHaveBeenCalledWith({
      x: 50, y: 60, width: 1024, height: 768, maximized: false,
    });

    vi.useRealTimers();
  });

  it('reports maximized=true when isMaximized returns true', () => {
    vi.useFakeTimers();
    const onGeometryChanged = vi.fn();

    createMainWindow(defaultSettings, {
      rendererHtml: '/app/renderer/index.html',
      onGeometryChanged,
    });

    const win = lastWindow();
    (win.isMaximized as ReturnType<typeof vi.fn>).mockReturnValue(true);
    (win.getNormalBounds as ReturnType<typeof vi.fn>).mockReturnValue({
      x: 0, y: 0, width: 1920, height: 1040,
    });

    (win as any)._emit('maximize');
    vi.advanceTimersByTime(350);

    expect(onGeometryChanged).toHaveBeenCalledWith(
      expect.objectContaining({ maximized: true }),
    );

    vi.useRealTimers();
  });

  it('skips geometry report when bounds are below minimum', () => {
    vi.useFakeTimers();
    const onGeometryChanged = vi.fn();

    createMainWindow(defaultSettings, {
      rendererHtml: '/app/renderer/index.html',
      onGeometryChanged,
    });

    const win = lastWindow();
    (win.isMaximized as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (win.getNormalBounds as ReturnType<typeof vi.fn>).mockReturnValue({
      x: 0, y: 0, width: 100, height: 100,
    });

    (win as any)._emit('resize');
    vi.advanceTimersByTime(350);

    expect(onGeometryChanged).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('reports geometry on close without debounce', () => {
    const onGeometryChanged = vi.fn();

    createMainWindow(defaultSettings, {
      rendererHtml: '/app/renderer/index.html',
      onGeometryChanged,
    });

    const win = lastWindow();
    (win.isMaximized as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (win.getNormalBounds as ReturnType<typeof vi.fn>).mockReturnValue({
      x: 10, y: 20, width: 800, height: 600,
    });

    (win as any)._emit('close');

    expect(onGeometryChanged).toHaveBeenCalledWith({
      x: 10, y: 20, width: 800, height: 600, maximized: false,
    });
  });

  it('loads the dev URL when rendererDevUrl is provided', () => {
    createMainWindow(defaultSettings, {
      rendererHtml: '/app/renderer/index.html',
      rendererDevUrl: 'http://localhost:5173',
      onGeometryChanged: vi.fn(),
    });

    const win = lastWindow();
    expect(win.loadURL).toHaveBeenCalledWith('http://localhost:5173');
    expect(win.loadFile).not.toHaveBeenCalled();
  });

  it('loads the HTML file when rendererDevUrl is not provided', () => {
    createMainWindow(defaultSettings, {
      rendererHtml: '/app/renderer/index.html',
      onGeometryChanged: vi.fn(),
    });

    const win = lastWindow();
    expect(win.loadFile).toHaveBeenCalledWith('/app/renderer/index.html');
    expect(win.loadURL).not.toHaveBeenCalled();
  });

  it('shows the window on ready-to-show', () => {
    createMainWindow(defaultSettings, {
      rendererHtml: '/app/renderer/index.html',
      onGeometryChanged: vi.fn(),
    });

    const win = lastWindow();
    (win as any)._emit('ready-to-show');
    expect(win.show).toHaveBeenCalled();
  });

  it('passes undefined x/y when the window is off-screen', () => {
    _getAllDisplays.mockReturnValue([
      {
        workArea: { x: 0, y: 0, width: 800, height: 600 },
        bounds: { x: 0, y: 0, width: 800, height: 600 },
      },
    ]);

    createMainWindow(
      {
        ...defaultSettings,
        geometry: { x: 2000, y: 2000, width: 1440, height: 900, maximized: false },
      },
      { rendererHtml: '/app/renderer/index.html', onGeometryChanged: vi.fn() },
    );

    const win = lastWindow();
    const opts = win._opts as Record<string, unknown>;
    expect(opts.x).toBeUndefined();
    expect(opts.y).toBeUndefined();
  });

  it('passes x/y when window overlaps a display', () => {
    createMainWindow(defaultSettings, {
      rendererHtml: '/app/renderer/index.html',
      onGeometryChanged: vi.fn(),
    });

    const win = lastWindow();
    const opts = win._opts as Record<string, unknown>;
    expect(opts.x).toBe(100);
    expect(opts.y).toBe(100);
  });

  it('sets webPreferences for sandbox and contextIsolation', () => {
    createMainWindow(defaultSettings, {
      rendererHtml: '/app/renderer/index.html',
      onGeometryChanged: vi.fn(),
    });

    const win = lastWindow();
    const opts = win._opts as Record<string, unknown>;
    expect(opts.webPreferences).toMatchObject({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    });
  });

  // DEF-303 — `backgroundThrottling: false` was tried at creation to keep the
  // renderer's rAF loop alive while minimised, but qa measured that Chromium
  // still suspends a minimised window's frames (~1 rAF frame/s; ~62 timer
  // ticks/s of CPU cost) with no latency gain, so the option was reverted to
  // the default (absent). The explicit minimise/restore pause signal below is
  // the mechanism that parks the PDF work instead.
  it('does not disable backgroundThrottling at window creation', () => {
    createMainWindow(defaultSettings, {
      rendererHtml: '/app/renderer/index.html',
      onGeometryChanged: vi.fn(),
    });

    const opts = lastWindow()._opts as Record<string, unknown>;
    const webPreferences = opts.webPreferences as Record<string, unknown>;
    // Absent so Chromium's default (throttled) behaviour applies.
    expect('backgroundThrottling' in webPreferences).toBe(false);
    expect(webPreferences.backgroundThrottling).toBeUndefined();
    // The other webPreferences must be untouched.
    expect(webPreferences.contextIsolation).toBe(true);
    expect(webPreferences.nodeIntegration).toBe(false);
    expect(webPreferences.sandbox).toBe(true);
  });

  // DEF-303 — the pause/resume signal is driven from the main process's
  // 'minimize' / 'restore' events (not the renderer's visibilitychange, which
  // cannot be trusted to fire on a minimised window).
  describe('DEF-303 — minimise/restore pause signal', () => {
    it('emits minimized=true on minimize and minimized=false on restore', () => {
      const onMinimizedChanged = vi.fn();
      createMainWindow(defaultSettings, {
        rendererHtml: '/app/renderer/index.html',
        onGeometryChanged: vi.fn(),
        onMinimizedChanged,
      });
      const win = lastWindow();

      (win as any)._emit('minimize');
      expect(onMinimizedChanged).toHaveBeenCalledWith(true);
      (win as any)._emit('restore');
      expect(onMinimizedChanged).toHaveBeenCalledWith(false);
      expect(onMinimizedChanged).toHaveBeenCalledTimes(2);
    });

    it('does not throw when the pause callback is omitted', () => {
      createMainWindow(defaultSettings, {
        rendererHtml: '/app/renderer/index.html',
        onGeometryChanged: vi.fn(),
      });
      const win = lastWindow();

      expect(() => {
        (win as any)._emit('minimize');
        (win as any)._emit('restore');
      }).not.toThrow();
    });
  });

  // Phase 13 — frameless window. The renderer draws its own title bar
  // (drag region via CSS -webkit-app-region) and caption buttons (over the
  // existing window:minimize/maximize/close IPC). frame:false removes the
  // native title bar AND native caption buttons so the controls are not
  // doubled. resizable stays true so the OS edge resize handles survive.
  it('creates a frameless window (frame:false) and keeps resize handles', () => {
    createMainWindow(defaultSettings, {
      rendererHtml: '/app/renderer/index.html',
      onGeometryChanged: vi.fn(),
    });

    const win = lastWindow();
    const opts = win._opts as Record<string, unknown>;
    expect(opts.frame).toBe(false);
    expect(opts.resizable).toBe(true);
  });

  // Phase 35 — transparency REMOVED. `transparent: true` makes the window a
  // Windows layered (WS_EX_LAYERED) window; Electron documents that
  // transparent windows are not resizable ("setting resizable to true may
  // make the transparent window stop working") and layered windows are a
  // known cause of swallowed Aero Snap/maximize and auto-hide taskbar hover.
  // Behaviour wins over the Phase-14 wallpaper show-through: the frosted look
  // now diffuses the app's own ambient base (the backgroundColor below).
  it('does not use a transparent (layered) window', () => {
    createMainWindow(defaultSettings, {
      rendererHtml: '/app/renderer/index.html',
      onGeometryChanged: vi.fn(),
    });

    const win = lastWindow();
    const opts = win._opts as Record<string, unknown>;
    expect(opts.transparent ?? false).toBe(false);
    // An opaque base matching the frosted theme's --tf-bg so the app's own
    // ambient surface replaces the wallpaper show-through.
    expect(opts.backgroundColor).toBe('#eef1f5');
  });

  it('keeps the window resizable and maximizable (standard Windows gestures)', () => {
    createMainWindow(defaultSettings, {
      rendererHtml: '/app/renderer/index.html',
      onGeometryChanged: vi.fn(),
    });

    const win = lastWindow();
    const opts = win._opts as Record<string, unknown>;
    expect(opts.resizable).toBe(true);
    expect(opts.maximizable).toBe(true);
    expect(opts.minimizable).toBe(true);
  });

  it('fits the saved geometry inside the display work area', () => {
    _getAllDisplays.mockReturnValue([
      {
        workArea: { x: 0, y: 0, width: 1920, height: 1040 },
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      },
    ]);

    createMainWindow(
      {
        ...defaultSettings,
        geometry: { x: 100, y: 100, width: 2560, height: 1440, maximized: false },
      },
      { rendererHtml: '/app/renderer/index.html', onGeometryChanged: vi.fn() },
    );

    const opts = lastWindow()._opts as Record<string, unknown>;
    expect(opts).toMatchObject({ width: 1920, height: 1040, x: 0, y: 0 });
  });

  it('sets the provisional 960x640 minimum on a normal work area', () => {
    _getAllDisplays.mockReturnValue([
      {
        workArea: { x: 0, y: 0, width: 1920, height: 1040 },
        bounds: { x: 0, y: 0, width: 1920, height: 1080 },
      },
    ]);

    createMainWindow(defaultSettings, {
      rendererHtml: '/app/renderer/index.html',
      onGeometryChanged: vi.fn(),
    });

    const opts = lastWindow()._opts as Record<string, unknown>;
    expect(opts.minWidth).toBe(960);
    expect(opts.minHeight).toBe(640);
  });

  it('clamps the minimum down to a small work area (never larger than the screen)', () => {
    _getAllDisplays.mockReturnValue([
      {
        workArea: { x: 0, y: 0, width: 800, height: 560 },
        bounds: { x: 0, y: 0, width: 800, height: 600 },
      },
    ]);

    createMainWindow(defaultSettings, {
      rendererHtml: '/app/renderer/index.html',
      onGeometryChanged: vi.fn(),
    });

    const opts = lastWindow()._opts as Record<string, unknown>;
    expect(opts.minWidth).toBe(800);
    expect(opts.minHeight).toBe(560);
  });

  // No DWM background material must be requested: Windows 11 acrylic
  // re-renders its wallpaper blur on every mouse-move invalidation (Chromium
  // repaints hover states on each move), which made the wallpaper behind the
  // glass flicker as the mouse moved. The frosted effect is CSS-only
  // (translucent sheets + backdrop-filter). Mica was rejected: it is a static
  // monochrome tone, not see-through glass, and would break the
  // wallpaper-shows-through contract.
  it('does not request a DWM background material (acrylic flickers on mouse move)', () => {
    createMainWindow(defaultSettings, {
      rendererHtml: '/app/renderer/index.html',
      onGeometryChanged: vi.fn(),
    });

    const win = lastWindow();
    const opts = win._opts as Record<string, unknown>;
    expect(opts.backgroundMaterial).toBeUndefined();
  });

  it('keeps the frameless window drop shadow (hasShadow:true)', () => {
    createMainWindow(defaultSettings, {
      rendererHtml: '/app/renderer/index.html',
      onGeometryChanged: vi.fn(),
    });

    const win = lastWindow();
    const opts = win._opts as Record<string, unknown>;
    expect(opts.hasShadow).toBe(true);
  });

  it('stays frameless and opaque (no native caption duplication)', () => {
    createMainWindow(defaultSettings, {
      rendererHtml: '/app/renderer/index.html',
      onGeometryChanged: vi.fn(),
    });

    const win = lastWindow();
    const opts = win._opts as Record<string, unknown>;
    expect(opts.frame).toBe(false);
    expect(opts.transparent ?? false).toBe(false);
    expect(opts.titleBarOverlay ?? false).toBe(false);
  });

  it('does not enable titleBarOverlay (no native caption-button duplication)', () => {
    createMainWindow(defaultSettings, {
      rendererHtml: '/app/renderer/index.html',
      onGeometryChanged: vi.fn(),
    });

    const win = lastWindow();
    const opts = win._opts as Record<string, unknown>;
    // frame:false is the fully-frameless path; titleBarOverlay would
    // re-introduce native caption buttons that duplicate the renderer's
    // custom controls, so it must be absent (or false).
    expect(opts.titleBarOverlay ?? false).toBe(false);
  });

  it('clears previous debounce timer when a second event fires quickly', () => {
    vi.useFakeTimers();
    const onGeometryChanged = vi.fn();

    createMainWindow(defaultSettings, {
      rendererHtml: '/app/renderer/index.html',
      onGeometryChanged,
    });

    const win = lastWindow();
    (win.isMaximized as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (win.getNormalBounds as ReturnType<typeof vi.fn>).mockReturnValue({
      x: 10, y: 20, width: 800, height: 600,
    });

    // First resize: starts the debounce
    (win as any)._emit('resize');
    vi.advanceTimersByTime(100);

    // Second resize before debounce fires: clears the old timer
    (win as any)._emit('resize');
    vi.advanceTimersByTime(100);

    // Still not enough time for the second timer
    expect(onGeometryChanged).not.toHaveBeenCalled();

    // Fast forward past the full debounce
    vi.advanceTimersByTime(250);
    expect(onGeometryChanged).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  it('clears debounce timer on close before reporting geometry', () => {
    vi.useFakeTimers();
    const onGeometryChanged = vi.fn();

    createMainWindow(defaultSettings, {
      rendererHtml: '/app/renderer/index.html',
      onGeometryChanged,
    });

    const win = lastWindow();
    (win.isMaximized as ReturnType<typeof vi.fn>).mockReturnValue(false);
    (win.getNormalBounds as ReturnType<typeof vi.fn>).mockReturnValue({
      x: 10, y: 20, width: 800, height: 600,
    });

    // Start a debounce timer
    (win as any)._emit('resize');
    vi.advanceTimersByTime(100);

    // Close while debounce is pending — should clear timer and report immediately
    (win as any)._emit('close');

    // Geometry should be reported without waiting for debounce
    expect(onGeometryChanged).toHaveBeenCalledWith({
      x: 10, y: 20, width: 800, height: 600, maximized: false,
    });

    // Advance past the original debounce window — should NOT trigger again
    vi.advanceTimersByTime(250);
    expect(onGeometryChanged).toHaveBeenCalledTimes(1);

    vi.useRealTimers();
  });

  // DEF-142 — the window's 'close' event delegates to deps.onCloseRequested
  // so the caller (index.ts) can preventDefault when the renderer has unsaved
  // edits. The callback is optional; an omitted callback preserves the
  // existing close behavior (the existing tests above emit 'close' with no
  // event arg and no onCloseRequested, and still pass).
  describe('DEF-142 — close/quit gate delegation', () => {
    it('calls deps.onCloseRequested(win, event) on the close event', () => {
      const onCloseRequested = vi.fn();
      createMainWindow(defaultSettings, {
        rendererHtml: '/app/renderer/index.html',
        onGeometryChanged: vi.fn(),
        onCloseRequested,
      });

      const win = lastWindow();
      const mockEvent = { preventDefault: vi.fn() };
      (win as any)._emit('close', mockEvent);

      expect(onCloseRequested).toHaveBeenCalledTimes(1);
      expect(onCloseRequested).toHaveBeenCalledWith(win, mockEvent);
    });

    it('does not call onCloseRequested when the callback is omitted', () => {
      // The existing behavior: a caller that does not wire the gate lets
      // the window close immediately. Omitting onCloseRequested must not
      // throw (the optional `?.` short-circuits).
      createMainWindow(defaultSettings, {
        rendererHtml: '/app/renderer/index.html',
        onGeometryChanged: vi.fn(),
      });

      const win = lastWindow();
      expect(() => {
        (win as any)._emit('close', { preventDefault: vi.fn() });
      }).not.toThrow();
    });

    it('still reports geometry before delegating to onCloseRequested', () => {
      const onGeometryChanged = vi.fn();
      const onCloseRequested = vi.fn();
      createMainWindow(defaultSettings, {
        rendererHtml: '/app/renderer/index.html',
        onGeometryChanged,
        onCloseRequested,
      });

      const win = lastWindow();
      (win.isMaximized as ReturnType<typeof vi.fn>).mockReturnValue(false);
      (win.getNormalBounds as ReturnType<typeof vi.fn>).mockReturnValue({
        x: 5, y: 15, width: 700, height: 500,
      });
      (win as any)._emit('close', { preventDefault: vi.fn() });

      // Geometry is reported first (so a prevented close still persists
      // the last window position), then the gate callback fires.
      expect(onGeometryChanged).toHaveBeenCalledWith({
        x: 5, y: 15, width: 700, height: 500, maximized: false,
      });
      expect(onCloseRequested).toHaveBeenCalled();
    });
  });

  // DEF-303 — the window-state / caption update must not wait for the 300 ms
  // geometry debounce. `onWindowStateChanged` fires synchronously on
  // maximize / unmaximize / minimize / restore; `onGeometryChanged` keeps
  // persisting the geometry on the existing debounce (once per burst).
  describe('DEF-303 — immediate window-state emission', () => {
    function makeWindow() {
      const onGeometryChanged = vi.fn();
      const onWindowStateChanged = vi.fn();
      createMainWindow(defaultSettings, {
        rendererHtml: '/app/renderer/index.html',
        onGeometryChanged,
        onWindowStateChanged,
      });
      const win = lastWindow();
      (win.isMaximized as ReturnType<typeof vi.fn>).mockReturnValue(false);
      (win.getNormalBounds as ReturnType<typeof vi.fn>).mockReturnValue({
        x: 50, y: 60, width: 1024, height: 768,
      });
      return { win, onGeometryChanged, onWindowStateChanged };
    }

    it('emits maximize immediately, before the debounce fires', () => {
      vi.useFakeTimers();
      const { win, onGeometryChanged, onWindowStateChanged } = makeWindow();
      (win.isMaximized as ReturnType<typeof vi.fn>).mockReturnValue(true);

      (win as any)._emit('maximize');

      // Immediate: no timer advance at all.
      expect(onWindowStateChanged).toHaveBeenCalledTimes(1);
      expect(onWindowStateChanged).toHaveBeenCalledWith({
        x: 50, y: 60, width: 1024, height: 768, maximized: true,
      });
      // The persistence path is still debounced.
      expect(onGeometryChanged).not.toHaveBeenCalled();
      vi.advanceTimersByTime(350);
      expect(onGeometryChanged).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it('emits unmaximize immediately, before the debounce fires', () => {
      vi.useFakeTimers();
      const { win, onGeometryChanged, onWindowStateChanged } = makeWindow();

      (win as any)._emit('unmaximize');

      expect(onWindowStateChanged).toHaveBeenCalledTimes(1);
      expect(onWindowStateChanged).toHaveBeenCalledWith(
        expect.objectContaining({ maximized: false }),
      );
      expect(onGeometryChanged).not.toHaveBeenCalled();
      vi.advanceTimersByTime(350);
      expect(onGeometryChanged).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });

    it('emits minimize and restore immediately', () => {
      vi.useFakeTimers();
      const { win, onWindowStateChanged } = makeWindow();

      (win as any)._emit('minimize');
      expect(onWindowStateChanged).toHaveBeenCalledTimes(1);
      (win as any)._emit('restore');
      expect(onWindowStateChanged).toHaveBeenCalledTimes(2);

      // Neither state event needed a timer to emit.
      vi.advanceTimersByTime(0);
      expect(onWindowStateChanged).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    });

    it('a minimize -> restore -> maximize burst emits each state at once and persists the geometry once', () => {
      vi.useFakeTimers();
      const { win, onGeometryChanged, onWindowStateChanged } = makeWindow();
      (win.isMaximized as ReturnType<typeof vi.fn>).mockReturnValue(true);

      (win as any)._emit('minimize');
      (win as any)._emit('restore');
      (win as any)._emit('maximize');

      // Three immediate emissions, zero debounce waits.
      expect(onWindowStateChanged).toHaveBeenCalledTimes(3);
      expect(onWindowStateChanged).toHaveBeenLastCalledWith(
        expect.objectContaining({ maximized: true }),
      );
      // Nothing written yet: the burst shares the single debounce.
      expect(onGeometryChanged).not.toHaveBeenCalled();

      vi.advanceTimersByTime(350);
      expect(onGeometryChanged).toHaveBeenCalledTimes(1);
      expect(onGeometryChanged).toHaveBeenCalledWith(
        expect.objectContaining({ maximized: true }),
      );
      vi.useRealTimers();
    });

    it('does not emit state when the callback is omitted', () => {
      vi.useFakeTimers();
      const onGeometryChanged = vi.fn();
      createMainWindow(defaultSettings, {
        rendererHtml: '/app/renderer/index.html',
        onGeometryChanged,
      });
      const win = lastWindow();

      expect(() => {
        (win as any)._emit('minimize');
        (win as any)._emit('maximize');
      }).not.toThrow();
      vi.advanceTimersByTime(350);
      expect(onGeometryChanged).toHaveBeenCalledTimes(1);
      vi.useRealTimers();
    });
  });
});