import { describe, it, expect } from 'vitest';
import { planCaptionMaximize } from '../../../src/main/window-maximize';

// DEF-303 — the caption-maximize restore rule. `win.maximize()` on a still
// minimised window stacks restore + maximise (two DWM transitions); the rule
// picks the single-transition path whenever the window was maximised before
// being minimised.
describe('DEF-303 planCaptionMaximize', () => {
  it('minimised + previously maximised -> one restore(), no maximize()', () => {
    expect(
      planCaptionMaximize({ minimized: true, maximized: false, previouslyMaximized: true }),
    ).toEqual(['restore']);
  });

  it('minimised + previously normal -> restore() then maximize()', () => {
    expect(
      planCaptionMaximize({ minimized: true, maximized: false, previouslyMaximized: false }),
    ).toEqual(['restore', 'maximize']);
  });

  it('not minimised + not maximised -> the existing maximize() path', () => {
    expect(
      planCaptionMaximize({ minimized: false, maximized: false, previouslyMaximized: false }),
    ).toEqual(['maximize']);
  });

  it('not minimised + maximised -> the existing unmaximize() path', () => {
    expect(
      planCaptionMaximize({ minimized: false, maximized: true, previouslyMaximized: true }),
    ).toEqual(['unmaximize']);
  });

  it('a minimised window never emits a bare maximize() as its first step', () => {
    for (const previouslyMaximized of [true, false]) {
      const steps = planCaptionMaximize({ minimized: true, maximized: false, previouslyMaximized });
      expect(steps[0]).toBe('restore');
    }
  });
});
