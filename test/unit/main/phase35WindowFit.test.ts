import { vi, describe, it, expect } from 'vitest';

// The pure fit helpers live in window.ts, which imports electron at module
// scope. The helpers never touch electron, so a minimal screen mock is enough.
vi.mock('electron', () => ({
  BrowserWindow: class {},
  screen: { getAllDisplays: () => [] },
}));

import {
  fitGeometryToWorkArea,
  workAreaForGeometry,
  type WindowBounds,
} from '../../../src/main/window';

// Phase 35 — a restored window must live inside the display's WORK AREA
// (never the full bounds), so it can never sit over the taskbar strip or
// spill off the desktop. A 1080p monitor with a 40px taskbar is the
// reference: workArea height 1040, not 1080.

const PRIMARY = { x: 0, y: 0, width: 1920, height: 1040 };
const SECONDARY = { x: 1920, y: 0, width: 1920, height: 1040 };

function geo(x: number, y: number, width: number, height: number) {
  return { x, y, width, height, maximized: false };
}

describe('Phase 35 — fitGeometryToWorkArea', () => {
  it('keeps an in-work-area geometry unchanged', () => {
    expect(fitGeometryToWorkArea(geo(100, 100, 1440, 900), PRIMARY)).toEqual<WindowBounds>({
      x: 100,
      y: 100,
      width: 1440,
      height: 900,
    });
  });

  it('clamps a geometry larger than the work area down to the work area', () => {
    expect(fitGeometryToWorkArea(geo(0, 0, 2560, 1440), PRIMARY)).toEqual<WindowBounds>({
      x: 0,
      y: 0,
      width: 1920,
      height: 1040,
    });
  });

  it('clamps y up so the window never covers the taskbar strip', () => {
    // 1040-tall window placed at y=200 would end at 1240, past the 1040
    // work-area bottom (the taskbar zone).
    expect(fitGeometryToWorkArea(geo(0, 200, 1920, 1040), PRIMARY)).toEqual<WindowBounds>({
      x: 0,
      y: 0,
      width: 1920,
      height: 1040,
    });
  });

  it('clamps x left so the window stays on the desktop', () => {
    expect(fitGeometryToWorkArea(geo(5000, 100, 800, 600), PRIMARY)).toEqual<WindowBounds>({
      x: 1120,
      y: 100,
      width: 800,
      height: 600,
    });
  });

  it('clamps a negative secondary-monitor position into that work area', () => {
    const left = { x: -1920, y: 0, width: 1920, height: 1040 };
    expect(fitGeometryToWorkArea(geo(-1800, 100, 800, 600), left)).toEqual<WindowBounds>({
      x: -1800,
      y: 100,
      width: 800,
      height: 600,
    });
  });

  it('preserves the minimum size floor on a tiny work area', () => {
    expect(fitGeometryToWorkArea(geo(0, 0, 1440, 900), { x: 0, y: 0, width: 500, height: 400 })).toEqual<WindowBounds>({
      x: 0,
      y: 0,
      width: 640,
      height: 480,
    });
  });
});

describe('Phase 35 — workAreaForGeometry', () => {
  const displays = [{ workArea: PRIMARY }, { workArea: SECONDARY }];

  it('picks the display the geometry mostly overlaps', () => {
    expect(workAreaForGeometry(geo(2000, 100, 800, 600), displays)).toEqual(SECONDARY);
    expect(workAreaForGeometry(geo(200, 100, 800, 600), displays)).toEqual(PRIMARY);
  });

  it('falls back to the first display when the geometry is off every display', () => {
    expect(workAreaForGeometry(geo(9000, 9000, 800, 600), displays)).toEqual(PRIMARY);
  });

  it('falls back to a sane rectangle when no displays are reported', () => {
    expect(workAreaForGeometry(geo(0, 0, 800, 600), [])).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });
});
