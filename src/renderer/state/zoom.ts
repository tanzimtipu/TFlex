export type ZoomMode = 'fit-width' | 'fit-page' | 'manual';

/**
 * Discrete, pleasant zoom ladder. Buttons and ctrl+wheel both step through
 * these; fraction zooming only happens as a result of the fit modes.
 */
export const ZOOM_STEPS = [
  0.25, 1 / 3, 0.5, 2 / 3, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4,
];

export const MIN_ZOOM = ZOOM_STEPS[0];
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];

export interface ZoomState {
  mode: ZoomMode;
  /** Scale used whenever mode is 'manual'. Fit modes preserve it untouched. */
  manualScale: number;
}

const EPS = 1e-4;

export function clampZoom(scale: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

/** Step within the ladder; a fractional fit-derived scale snaps to it nicely. */
export function stepTowards(scale: number, direction: 1 | -1): number {
  if (direction === 1) {
    for (const step of ZOOM_STEPS) {
      if (step > scale + EPS) {
        return step;
      }
    }
    return MAX_ZOOM;
  }
  for (let i = ZOOM_STEPS.length - 1; i >= 0; i -= 1) {
    if (ZOOM_STEPS[i] < scale - EPS) {
      return ZOOM_STEPS[i];
    }
  }
  return MIN_ZOOM;
}

export type ZoomAction =
  | { type: 'set-manual-scale'; scale: number }
  | { type: 'set-mode'; mode: ZoomMode };

export function zoomReducer(state: ZoomState, action: ZoomAction): ZoomState {
  switch (action.type) {
    case 'set-manual-scale':
      return { mode: 'manual', manualScale: clampZoom(action.scale) };
    case 'set-mode':
      return { ...state, mode: action.mode };
  }
}

/**
 * Ctrl+wheel zoom accumulator. Raw wheel deltas accumulate across events;
 * every full +/-120 (one detent) consumed emits one ladder step. Up (negative
 * deltaY) zooms in. Pure so both the component and unit tests share the math.
 */
export const WHEEL_DETENT = 120;

export interface WheelZoomResult {
  remainder: number;
  steps: number; // signed: + zoom in, - zoom out
}

export function accumulateWheel(remainder: number, deltaY: number): WheelZoomResult {
  const total = remainder - deltaY;
  let steps = 0;
  let acc = total;
  while (Math.abs(acc) >= WHEEL_DETENT) {
    steps += Math.sign(acc);
    acc -= Math.sign(acc) * WHEEL_DETENT;
  }
  return { remainder: acc, steps };
}
