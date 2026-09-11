// Phase 14 — Liquid Glass ambient surface state.
//
// Two pieces of app-wide "ambient" state the frosted glass theme needs,
// deliberately kept OUT of React state: they update at pointer-event /
// window-event frequency and must never re-render the App tree.
//
//   1. Window focus — a two-state machine ('focused' | 'blurred')
//      mirrored onto <html data-window-focus="..."> so the stylesheet
//      can retune the frosted blur intensity when the window defocuses
//      (the Phase-14 "focus/defocus blur" requirement). Standard DOM
//      window events — no Electron API involvement.
//
//   2. Background parallax — a small damped spring that follows the
//      pointer (normalized to the viewport center) and publishes the
//      smoothed offset as the CSS vars --tf-parallax-x / --tf-parallax-y
//      on the .tf-ambient layer. The layer translates by a few pixels,
//      compositor-only, so the glass backdrop drifts subtly instead of
//      sitting static. Disabled entirely under prefers-reduced-motion.
//
// Both behaviors are pure or injected-dependency functions here so the
// unit tests can drive them without a real window.

export type WindowFocusState = 'focused' | 'blurred';

/** The focus machine: the window starts focused (Electron shows the
 *  window focused; the first real 'blur' event is what defocuses the
 *  glass) and any 'focus' event re-focuses. Idempotent on repeats. */
export function reduceWindowFocus(
  _prev: WindowFocusState,
  event: 'focus' | 'blur',
): WindowFocusState {
  return event === 'blur' ? 'blurred' : 'focused';
}

/** Max ambient drift in px. A few px is enough to read as "alive"
 *  behind frosted glass without ever looking like the app is moving. */
export const PARALLAX_MAX_PX = 6;

/** Spring constants for the parallax follow. Slightly underdamped
 *  (zeta ~= 0.8) so the drift settles in ~300ms with a barely-there
 *  overshoot — the same fluid character as the panel springs, scaled
 *  down for a background layer. */
export const PARALLAX_STIFFNESS = 120;
export const PARALLAX_DAMPING = 18;

export interface SpringState {
  value: number;
  velocity: number;
}

/** One semi-implicit Euler integration step of a damped harmonic
 *  oscillator toward `target`. Frame-rate independent (dt in ms,
 *  clamped to 32ms so a long frame never explodes the integrator). */
export function stepSpring(
  state: SpringState,
  target: number,
  stiffness: number,
  damping: number,
  dtMs: number,
): SpringState {
  const dt = Math.min(Math.max(dtMs, 0), 32) / 1000;
  const acceleration = -stiffness * (state.value - target) - damping * state.velocity;
  const velocity = state.velocity + acceleration * dt;
  const value = state.value + velocity * dt;
  return { value, velocity };
}

/** Clamp a parallax offset to the +-max box so the scaled ambient
 *  layer never exposes an edge. */
export function clampParallax(
  x: number,
  y: number,
  max: number = PARALLAX_MAX_PX,
): { x: number; y: number } {
  const clamp = (v: number): number => Math.max(-max, Math.min(max, v));
  return { x: clamp(x), y: clamp(y) };
}

/** Normalized pointer position -> clamped px offset. The pointer maps
 *  to -1..1 from the viewport center on each axis, then scales to the
 *  drift budget. Injected viewport size keeps this pure for tests. */
export function pointerToParallax(
  clientX: number,
  clientY: number,
  viewportWidth: number,
  viewportHeight: number,
): { x: number; y: number } {
  const nx = viewportWidth > 0 ? (clientX / viewportWidth) * 2 - 1 : 0;
  const ny = viewportHeight > 0 ? (clientY / viewportHeight) * 2 - 1 : 0;
  return clampParallax(nx * PARALLAX_MAX_PX, ny * PARALLAX_MAX_PX);
}

/** Structural window surface the controller needs — the real `window`
 *  satisfies it; the unit tests pass a stub. */
export interface AmbientWindow {
  addEventListener(type: 'focus' | 'blur' | 'pointermove', fn: (e: Event) => void): void;
  removeEventListener(type: 'focus' | 'blur' | 'pointermove', fn: (e: Event) => void): void;
  matchMedia(query: string): { matches: boolean };
  innerWidth: number;
  innerHeight: number;
}

export interface AmbientControllerOptions {
  /** The element that receives data-window-focus (the <html> root). */
  root: HTMLElement;
  /** The .tf-ambient layer that receives the parallax vars. Null is
   *  allowed (focus tracking still works; parallax becomes a no-op). */
  layer: HTMLElement | null;
  win: AmbientWindow;
  /** Injectable frame scheduler (defaults to requestAnimationFrame).
   *  Tests drive frames by hand through this. */
  scheduleFrame?: (cb: (time: number) => void) => number;
  cancelFrame?: (handle: number) => void;
}

export interface AmbientController {
  destroy(): void;
}

const SETTLE_EPSILON = 0.05;

/** Wire the ambient surface behaviors and return a disposer. Never
 *  throws for a missing layer; the focus attribute is always applied. */
export function createAmbientController(options: AmbientControllerOptions): AmbientController {
  const { root, layer, win } = options;
  const scheduleFrame = options.scheduleFrame ?? ((cb: (time: number) => void): number =>
    requestAnimationFrame(cb));
  const cancelFrame = options.cancelFrame ?? ((handle: number): void => cancelAnimationFrame(handle));

  root.dataset.windowFocus = 'focused';

  const applyFocusEvent = (event: 'focus' | 'blur'): void => {
    root.dataset.windowFocus = reduceWindowFocus(
      root.dataset.windowFocus === 'blurred' ? 'blurred' : 'focused',
      event,
    );
  };
  const onFocus = (): void => applyFocusEvent('focus');
  const onBlur = (): void => applyFocusEvent('blur');
  win.addEventListener('focus', onFocus);
  win.addEventListener('blur', onBlur);

  let target: { x: number; y: number } = { x: 0, y: 0 };
  let springX: SpringState = { value: 0, velocity: 0 };
  let springY: SpringState = { value: 0, velocity: 0 };
  let frameHandle = 0;
  let lastTime = 0;
  let frameRunning = false;

  const paint = (): void => {
    if (layer === null) return;
    layer.style.setProperty('--tf-parallax-x', springX.value.toFixed(2));
    layer.style.setProperty('--tf-parallax-y', springY.value.toFixed(2));
  };

  const frame = (time: number): void => {
    const dt = lastTime === 0 ? 16 : time - lastTime;
    lastTime = time;
    springX = stepSpring(springX, target.x, PARALLAX_STIFFNESS, PARALLAX_DAMPING, dt);
    springY = stepSpring(springY, target.y, PARALLAX_STIFFNESS, PARALLAX_DAMPING, dt);
    paint();
    const settledX = Math.abs(springX.value - target.x) < SETTLE_EPSILON
      && Math.abs(springX.velocity) < SETTLE_EPSILON;
    const settledY = Math.abs(springY.value - target.y) < SETTLE_EPSILON
      && Math.abs(springY.velocity) < SETTLE_EPSILON;
    if (settledX && settledY) {
      springX = { value: target.x, velocity: 0 };
      springY = { value: target.y, velocity: 0 };
      paint();
      frameRunning = false;
      frameHandle = 0;
      lastTime = 0;
      return;
    }
    frameHandle = scheduleFrame(frame);
  };

  const onPointerMove = (event: Event): void => {
    if (layer === null) return;
    const e = event as PointerEvent;
    target = pointerToParallax(e.clientX, e.clientY, win.innerWidth, win.innerHeight);
    if (frameRunning) return;
    frameRunning = true;
    lastTime = 0;
    frameHandle = scheduleFrame(frame);
  };

  // Reduced motion: the glass stays still (the phase spec's own rule).
  // No pointer listener is attached, so no frame loop can ever start.
  const reduced = win.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reduced) {
    win.addEventListener('pointermove', onPointerMove);
  }

  return {
    destroy(): void {
      win.removeEventListener('focus', onFocus);
      win.removeEventListener('blur', onBlur);
      if (!reduced) {
        win.removeEventListener('pointermove', onPointerMove);
      }
      if (frameHandle !== 0) {
        cancelFrame(frameHandle);
        frameHandle = 0;
      }
      frameRunning = false;
    },
  };
}
