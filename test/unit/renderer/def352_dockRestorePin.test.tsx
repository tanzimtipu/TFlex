// @vitest-environment jsdom
//
// DEF-352 — restoring a removed STAGE-DEFAULT tool from the palette must not be
// refused by the dock's pin cap. A restore writes no explicit pin, so the cap
// does not apply; only a cross-stage pin consumes a slot. The old palette
// checked `canPinMore(dockPins)` before it knew whether the tool was a stage
// default, so with the cap reached it reported a false "Dock is full" and the
// tool stayed out of the dock. Phase 58 raised the cap to `DOCK_MAX_PINS`
// (200), so the refusal now bites only at that limit.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { ReactElement } from 'react';
import { CommandPalette, type CommandPaletteProps } from '../../../src/renderer/components/CommandPalette';
import { DOCK_MAX_PINS, palettePinAllowed, pinDockTool } from '../../../src/renderer/state/dockModel';
import { TOOL_REGISTRY } from '../../../src/renderer/state/toolsRegistry';

const FOUR_PINS = ['annotate', 'sign', 'stamp', 'watermark'];

/** A pin list that actually reaches `DOCK_MAX_PINS`. The registry holds fewer
 *  ids than the cap, so cycle it — validity is irrelevant here: the cap is a
 *  length check in `palettePinAllowed`. */
const FULL_PINS = Array.from(
  { length: DOCK_MAX_PINS },
  (_, i): string => TOOL_REGISTRY[i % TOOL_REGISTRY.length].id,
);

beforeEach((): void => {
  document.body.innerHTML = '';
});
afterEach((): void => {
  document.body.innerHTML = '';
});

describe('DEF-352 — a stage-default restore does not consume a pin slot', () => {
  it('palettePinAllowed always exempts a stage default and refuses a cross-stage pin only at DOCK_MAX_PINS', () => {
    expect(FULL_PINS.length).toBe(DOCK_MAX_PINS);
    // Restoring a removed stage default writes no explicit pin, so it is ALWAYS
    // allowed — at any pin count, including the cap.
    expect(palettePinAllowed({ pins: [], isStageDefault: true })).toBe(true);
    expect(palettePinAllowed({ pins: FOUR_PINS, isStageDefault: true })).toBe(true);
    expect(palettePinAllowed({ pins: FULL_PINS, isStageDefault: true })).toBe(true);
    // A cross-stage pin consumes a slot: still allowed well below the cap...
    expect(palettePinAllowed({ pins: FOUR_PINS, isStageDefault: false })).toBe(true);
    // ...and refused only once the list actually reaches DOCK_MAX_PINS.
    expect(palettePinAllowed({ pins: FULL_PINS, isStageDefault: false })).toBe(false);
  });

  it('pinDockTool writes a restore with no new explicit pin even when other pins are present', () => {
    const next = pinDockTool(
      { pins: FOUR_PINS, unpinned: ['merge'] },
      'merge',
      ['merge', 'rotate', 'delete'],
    );
    expect(next.pins).toEqual(FOUR_PINS);
    expect(next.unpinned).not.toContain('merge');
    expect(next.pins.length).toBe(FOUR_PINS.length);
  });

  it('the palette restores a removed stage default with other pins present instead of refusing', () => {
    const host = document.body.appendChild(document.createElement('div'));
    const root = createRoot(host);
    const onPinTool = vi.fn();
    const props: CommandPaletteProps = {
      open: true,
      onClose: vi.fn(),
      onRunTool: vi.fn(),
      onPinTool,
      onUnpinTool: vi.fn(),
      dockPins: FOUR_PINS,
      isToolPinned: (id): boolean => id !== 'merge',
      isStageDefault: (id): boolean => id === 'merge',
      recentFiles: [],
    };
    const view = (): ReactElement => <CommandPalette {...props} />;
    act((): void => {
      root.render(view());
    });
    try {
      const toggle = host.querySelector<HTMLButtonElement>(
        '[data-palette-tool-id="merge"] [data-palette-pin-toggle]',
      );
      expect(toggle).not.toBeNull();
      if (toggle === null) return;
      act((): void => {
        toggle.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
      expect(onPinTool).toHaveBeenCalledWith('merge');
      const notice = host.querySelector('[data-command-palette-notice]')?.textContent ?? '';
      expect(notice).not.toContain('Dock is full');
    } finally {
      act((): void => {
        root.unmount();
      });
      host.remove();
    }
  });
});
