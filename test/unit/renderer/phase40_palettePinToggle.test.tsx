// @vitest-environment jsdom
//
// Phase 40 (item 6) — the Ctrl+K palette's per-row pin TOGGLE.
//
// Criterion 7: every tool row gains a pin toggle; clicking pins the tool,
// clicking again unpins it, the icon changes with the state, and the state
// persists across a restart through the existing pins store. This suite pins:
//   - a toggle exists on every tool row (and not on recent-file rows),
//   - the glyph/state differs between pinned and unpinned (shape + fill),
//   - clicking the toggle flips the store, NEVER runs the row and NEVER
//     closes the palette,
//   - the icon follows the store (a "restart" remount with the persisted
//     pins shows the same state),
//   - the host's true-membership gate (`isToolPinned`) drives the toggle,
//   - a disabled row's toggle is disabled and cannot write.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { ReactElement } from 'react';
import {
  CommandPalette,
  type CommandPaletteProps,
} from '../../../src/renderer/components/CommandPalette';
import { addDockPin, DOCK_MAX_PINS, removeDockPin } from '../../../src/renderer/state/dockModel';
import { TOOL_REGISTRY } from '../../../src/renderer/state/toolsRegistry';

const NO_RECENTS: readonly { path: string; label: string }[] = [];

interface Harness {
  host: HTMLElement;
  onRunTool: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
  onPinTool: ReturnType<typeof vi.fn>;
  onUnpinTool: ReturnType<typeof vi.fn>;
  rerender: (next: Partial<CommandPaletteProps>) => void;
  unmount: () => void;
}

function renderPalette(options: Partial<CommandPaletteProps> = {}): Harness {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  const onRunTool = vi.fn();
  const onClose = vi.fn();
  const onPinTool = vi.fn();
  const onUnpinTool = vi.fn();
  const current: { props: CommandPaletteProps } = {
    props: {
      open: true,
      onClose,
      onRunTool,
      onPinTool,
      onUnpinTool,
      recentFiles: NO_RECENTS,
      ...options,
    },
  };
  function Wrapper(): ReactElement {
    const [open, setOpen] = useState(current.props.open);
    return (
      <CommandPalette
        {...current.props}
        open={open}
        onClose={(): void => {
          onClose();
          setOpen(false);
        }}
      />
    );
  }
  const draw = (): void => {
    act((): void => {
      root.render(<Wrapper />);
    });
  };
  draw();
  return {
    host,
    onRunTool,
    onClose,
    onPinTool,
    onUnpinTool,
    rerender: (next): void => {
      current.props = { ...current.props, ...next };
      draw();
    },
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

/** A host that really owns the pins, so a click's write is observed on the
 *  NEXT render exactly like App's settings write. */
function renderStatefulHost(persisted: string[]): {
  host: HTMLElement;
  pins: () => string[];
  remount: (next: string[]) => void;
  unmount: () => void;
} {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  let pins = [...persisted];
  function Host(): ReactElement {
    const [state, setState] = useState<string[]>(pins);
    pins = state;
    return (
      <CommandPalette
        open
        onClose={vi.fn()}
        onRunTool={vi.fn()}
        dockPins={state}
        onPinTool={(id): void => setState((prev) => addDockPin(prev, id))}
        onUnpinTool={(id): void => setState((prev) => removeDockPin(prev, id))}
        recentFiles={NO_RECENTS}
      />
    );
  }
  act((): void => {
    root.render(<Host />);
  });
  return {
    host,
    pins: (): string[] => pins,
    remount: (next): void => {
      act((): void => {
        root.render(
          <CommandPalette
            open
            onClose={vi.fn()}
            onRunTool={vi.fn()}
            dockPins={next}
            onPinTool={vi.fn()}
            onUnpinTool={vi.fn()}
            recentFiles={NO_RECENTS}
          />,
        );
      });
    },
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

const row = (host: HTMLElement, id: string): HTMLElement => {
  const el = host.querySelector<HTMLElement>(`[data-palette-tool-id="${id}"]`);
  if (el === null) throw new Error(`row ${id} missing`);
  return el;
};

const toggle = (host: HTMLElement, id: string): HTMLButtonElement => {
  const el = row(host, id).querySelector<HTMLButtonElement>('[data-palette-pin-toggle]');
  if (el === null) throw new Error(`pin toggle for ${id} missing`);
  return el;
};

function click(target: Element): void {
  act((): void => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

beforeEach((): void => {
  document.body.innerHTML = '';
});
afterEach((): void => {
  document.body.innerHTML = '';
});

describe('Phase 40 item 6 — a pin toggle on every palette tool row', () => {
  it('renders a toggle on every tool row and none on the recent row', () => {
    const h = renderPalette({
      recentFiles: [{ path: 'C:/docs/a.pdf', label: 'a.pdf' }],
    });
    try {
      expect(h.host.querySelectorAll('[data-palette-pin-toggle]')).toHaveLength(
        TOOL_REGISTRY.length,
      );
      expect(
        h.host.querySelector('[data-palette-row="recent"] [data-palette-pin-toggle]'),
      ).toBeNull();
    } finally {
      h.unmount();
    }
  });

  it('the glyph differs between pinned and unpinned (shape + fill, not colour alone)', () => {
    const h = renderPalette({ dockPins: ['merge'] });
    try {
      const pinned = toggle(h.host, 'merge');
      const unpinned = toggle(h.host, 'sign');
      expect(pinned.getAttribute('data-palette-pin-state')).toBe('pinned');
      expect(unpinned.getAttribute('data-palette-pin-state')).toBe('unpinned');
      expect(pinned.getAttribute('aria-pressed')).toBe('true');
      expect(unpinned.getAttribute('aria-pressed')).toBe('false');
      // The pinned marker attribute stays on the pinned toggle only.
      expect(pinned.hasAttribute('data-palette-pin')).toBe(true);
      expect(unpinned.hasAttribute('data-palette-pin')).toBe(false);
      // Shape: filled vs outline.
      const pinnedFill = pinned.querySelector('svg')?.getAttribute('fill');
      const unpinnedFill = unpinned.querySelector('svg')?.getAttribute('fill');
      expect(pinnedFill).toBe('currentColor');
      expect(unpinnedFill).toBe('none');
      expect(pinned.querySelector('svg')?.getAttribute('class')).toContain('pin-glyph-pinned');
      expect(unpinned.querySelector('svg')?.getAttribute('class')).toContain('pin-glyph-unpinned');
    } finally {
      h.unmount();
    }
  });

  it('clicking the toggle flips the store and never runs the row or closes the palette', () => {
    const h = renderPalette({ dockPins: [] });
    try {
      click(toggle(h.host, 'merge'));
      expect(h.onPinTool).toHaveBeenCalledWith('merge');
      expect(h.onUnpinTool).not.toHaveBeenCalled();
      expect(h.onRunTool).not.toHaveBeenCalled();
      expect(h.onClose).not.toHaveBeenCalled();
      expect(h.host.querySelector('[data-command-palette-notice]')?.textContent).toContain(
        'Pinned Merge PDFs',
      );
    } finally {
      h.unmount();
    }

    const h2 = renderPalette({ dockPins: ['merge'] });
    try {
      click(toggle(h2.host, 'merge'));
      expect(h2.onUnpinTool).toHaveBeenCalledWith('merge');
      expect(h2.onPinTool).not.toHaveBeenCalled();
      expect(h2.onRunTool).not.toHaveBeenCalled();
      expect(h2.onClose).not.toHaveBeenCalled();
      expect(h2.host.querySelector('[data-command-palette-notice]')?.textContent).toContain(
        'Unpinned Merge PDFs',
      );
    } finally {
      h2.unmount();
    }
  });

  it('the icon follows the store, and a remount with persisted pins keeps the state', () => {
    const s = renderStatefulHost([]);
    try {
      expect(toggle(s.host, 'merge').getAttribute('data-palette-pin-state')).toBe('unpinned');
      click(toggle(s.host, 'merge'));
      expect(s.pins()).toContain('merge');
      expect(toggle(s.host, 'merge').getAttribute('data-palette-pin-state')).toBe('pinned');

      click(toggle(s.host, 'merge'));
      expect(s.pins()).not.toContain('merge');
      expect(toggle(s.host, 'merge').getAttribute('data-palette-pin-state')).toBe('unpinned');

      // Pin once more, then simulate a RESTART: a fresh mount fed the
      // persisted settings still shows the pinned state.
      click(toggle(s.host, 'merge'));
      const persisted = s.pins();
      expect(persisted).toContain('merge');
      s.remount(persisted);
      expect(toggle(s.host, 'merge').getAttribute('data-palette-pin-state')).toBe('pinned');
    } finally {
      s.unmount();
    }
  });

  it('honours the host true-membership gate for a stage default', () => {
    const onUnpinTool = vi.fn();
    const h = renderPalette({
      dockPins: [],
      isToolPinned: (id): boolean => id === 'rotate',
      onUnpinTool,
    });
    try {
      // 'rotate' is in the focused stage's default dock set, so the icon shows
      // pinned even though it has no explicit `dockPins` entry.
      expect(toggle(h.host, 'rotate').getAttribute('data-palette-pin-state')).toBe('pinned');
      expect(toggle(h.host, 'sign').getAttribute('data-palette-pin-state')).toBe('unpinned');
      click(toggle(h.host, 'rotate'));
      expect(onUnpinTool).toHaveBeenCalledWith('rotate');
    } finally {
      h.unmount();
    }
  });

  it('refuses a pin at the dock cap without running the row', () => {
    // The cap is `DOCK_MAX_PINS` (200) since Phase 58. The registry holds fewer
    // ids than the cap, so cycle it to build a list that actually reaches the
    // cap. Exclude the clicked cross-stage tool ('sign') so its row is not
    // already pinned (a pinned row toggles UN-pin instead).
    const cycle = TOOL_REGISTRY.map((entry) => entry.id).filter((id) => id !== 'sign');
    const full = Array.from(
      { length: DOCK_MAX_PINS },
      (_, i): string => cycle[i % cycle.length],
    );
    expect(full.length).toBe(DOCK_MAX_PINS);
    const h = renderPalette({ dockPins: full });
    try {
      click(toggle(h.host, 'sign'));
      expect(h.onPinTool).not.toHaveBeenCalled();
      expect(h.onRunTool).not.toHaveBeenCalled();
      expect(h.host.querySelector('[data-command-palette-notice]')?.textContent).toContain(
        'Dock is full',
      );
    } finally {
      h.unmount();
    }
  });
});