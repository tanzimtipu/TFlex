import { vi, describe, it, expect, beforeEach } from 'vitest';
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
    expect(win._opts).toMatchObject({ width: 1200, height: 800, x: 200, y: 300 });
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
});