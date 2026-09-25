// @vitest-environment jsdom
//
// DEF-352 — restoring a removed STAGE-DEFAULT tool from the palette must not be
// refused by the 4-pin cap. A restore writes no explicit pin, so the cap does
// not apply; only a cross-stage pin consumes a slot. The old palette checked
// `canPinMore(dockPins)` before it knew whether the tool was a stage default, so
// with four explicit pins it reported a false "Dock is full (max 4 pins)" and
// the tool stayed out of the dock.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { ReactElement } from 'react';
import { CommandPalette, type CommandPaletteProps } from '../../../src/renderer/components/CommandPalette';
import { palettePinAllowed, pinDockTool } from '../../../src/renderer/state/dockModel';

const FOUR_PINS = ['annotate', 'sign', 'stamp', 'watermark'];

beforeEach((): void => {
  document.body.innerHTML = '';
});
afterEach((): void => {
  document.body.innerHTML = '';
});

describe('DEF-352 — a stage-default restore does not consume a pin slot', () => {
  it('palettePinAllowed exempts a stage default from the cap but not a cross-stage pin', () => {
    // At the cap, a cross-stage pin is refused...
    expect(palettePinAllowed({ pins: FOUR_PINS, isStageDefault: false })).toBe(false);
    // ...but restoring a removed stage default is allowed (no slot needed).
    expect(palettePinAllowed({ pins: FOUR_PINS, isStageDefault: true })).toBe(true);
  });

  it('pinDockTool writes a restore with no new explicit pin even when pins are full', () => {
    const next = pinDockTool(
      { pins: FOUR_PINS, unpinned: ['merge'] },
      'merge',
      ['merge', 'rotate', 'delete'],
    );
    expect(next.pins).toEqual(FOUR_PINS);
    expect(next.unpinned).not.toContain('merge');
    expect(next.pins.length).toBe(4);
  });

  it('the palette restores a removed stage default at the 4-pin cap instead of refusing', () => {
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
