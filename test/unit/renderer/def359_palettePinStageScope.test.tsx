// @vitest-environment jsdom
//
// DEF-359 — Phase 42's ONE-HOME pin rule (a pinned stage-native tool renders
// only in its own stage's dock) was applied in the Action Dock but not in the
// palette's pin marker, so with the operator's `dockPins: ["watermark"]` the
// EDIT dock showed no Watermark while the palette row still read pinned in all
// four stages (the DEF-353 invariant regressed; the toggle's notice named a
// dock that had not changed).
//
// The rule this suite pins: the palette's pin marker is scoped to the dock the
// user is LOOKING AT. A stage-native tool pinned outside its own stage renders
// as `pinned-elsewhere` and NAMES its home stage; its toggle removes it from
// that home and says so. The two surfaces can no longer disagree.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import {
  CommandPalette,
  type CommandPaletteProps,
} from '../../../src/renderer/components/CommandPalette';
import {
  buildPaletteRows,
  palettePinDockName,
  palettePinStateFor,
  type PaletteRow,
  type PaletteToolRow,
} from '../../../src/renderer/state/commandPalette';
import { isPinVisibleInStage, toolById } from '../../../src/renderer/state/toolsRegistry';

const NO_RECENTS: readonly { path: string; label: string }[] = [];

const toolRow = (rows: readonly PaletteRow[], id: string): PaletteToolRow => {
  const row = rows.find((candidate): candidate is PaletteToolRow =>
    candidate.kind === 'tool' && candidate.id === id,
  );
  if (row === undefined) throw new Error(`row ${id} missing`);
  return row;
};

// The operator's real settings: dockPins: ["watermark"]. The host's raw
// membership callback answers exactly what it did before this fix.
const OPERATOR_PINS = ['watermark'] as const;
const operatorPinned = (id: string): boolean => (OPERATOR_PINS as readonly string[]).includes(id);

describe('DEF-359 — palette pin marker is scoped to the current stage dock', () => {
  it('reports a stage-native pin as pinned-elsewhere and names its home stage', () => {
    const rows = buildPaletteRows({
      query: 'watermark',
      dockPins: OPERATOR_PINS,
      isToolPinned: operatorPinned,
      activeStage: 'edit',
    });
    const row = toolRow(rows, 'watermark');
    expect(row.pinned, 'not in the EDIT dock').toBe(false);
    expect(row.pinnedStage).toBe('review');
    expect(row.pinHomeStage).toBe('review');
    expect(palettePinStateFor(row)).toBe('pinned-elsewhere');
    expect(palettePinDockName(row)).toBe('Review');
  });

  it('agrees with the dock in every stage (no stage reports a filtered-out pin as docked)', () => {
    // The Phase-42 one-home rule the dock applies: a pin renders only when the
    // tool's own stage IS the active stage, or it is global.
    const watermark = toolById('watermark');
    if (watermark === undefined) throw new Error('watermark missing');
    for (const stage of ['pages', 'edit', 'review', 'deliver'] as const) {
      const rows = buildPaletteRows({
        query: 'watermark',
        dockPins: OPERATOR_PINS,
        isToolPinned: operatorPinned,
        activeStage: stage,
      });
      const row = toolRow(rows, 'watermark');
      const dockShowsIt = isPinVisibleInStage(watermark, stage);
      if (stage === 'review') {
        expect(row.pinned, 'REVIEW dock shows it').toBe(true);
        expect(dockShowsIt).toBe(true);
      } else {
        expect(row.pinned, `${stage} dock does NOT show it`).toBe(false);
        expect(row.pinnedStage, `${stage} names the home`).toBe('review');
        expect(dockShowsIt).toBe(false);
      }
    }
  });

  it('keeps a GLOBAL pin visible in every stage, unscoped', () => {
    for (const stage of ['pages', 'edit', 'review', 'deliver'] as const) {
      const rows = buildPaletteRows({
        query: 'undo',
        dockPins: ['undo'],
        isToolPinned: (id): boolean => id === 'undo',
        activeStage: stage,
      });
      const row = toolRow(rows, 'undo');
      expect(row.pinned, `undo is in the ${stage} dock`).toBe(true);
      expect(row.pinnedStage).toBeUndefined();
      expect(palettePinDockName(row)).toBeUndefined();
    }
  });

  it('leaves an unpinned stage-native tool unpinned without naming a home pin', () => {
    const rows = buildPaletteRows({ query: 'watermark', dockPins: [], activeStage: 'edit' });
    const row = toolRow(rows, 'watermark');
    expect(row.pinned).toBe(false);
    expect(row.pinnedStage).toBeUndefined();
    // It IS a foreign stage-native tool, so a pin's home is still named.
    expect(row.pinHomeStage).toBe('review');
    expect(palettePinDockName(row)).toBe('Review');
  });
});

/* -------------------------------------------------------------------------
 * Component — the row's rendered state and the toggle's notice copy
 * ---------------------------------------------------------------------- */

interface Harness {
  host: HTMLElement;
  onPinTool: ReturnType<typeof vi.fn>;
  onUnpinTool: ReturnType<typeof vi.fn>;
  unmount: () => void;
}

function renderPalette(options: Partial<CommandPaletteProps> = {}): Harness {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  const onPinTool = vi.fn();
  const onUnpinTool = vi.fn();
  const props: CommandPaletteProps = {
    open: true,
    onClose: vi.fn(),
    onRunTool: vi.fn(),
    onPinTool,
    onUnpinTool,
    recentFiles: NO_RECENTS,
    ...options,
  };
  act((): void => {
    root.render(<CommandPalette {...props} />);
  });
  return {
    host,
    onPinTool,
    onUnpinTool,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

const rowEl = (host: HTMLElement, id: string): HTMLElement => {
  const el = host.querySelector<HTMLElement>(`[data-palette-tool-id="${id}"]`);
  if (el === null) throw new Error(`row ${id} missing`);
  return el;
};

const toggleEl = (host: HTMLElement, id: string): HTMLButtonElement => {
  const el = rowEl(host, id).querySelector<HTMLButtonElement>('[data-palette-pin-toggle]');
  if (el === null) throw new Error(`toggle ${id} missing`);
  return el;
};

const click = (target: Element): void => {
  act((): void => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
};

const notice = (host: HTMLElement): string =>
  host.querySelector('[data-command-palette-notice]')?.textContent ?? '';

beforeEach((): void => {
  document.body.innerHTML = '';
});
afterEach((): void => {
  document.body.innerHTML = '';
});

describe('DEF-359 — the palette row and the toggle copy match the visible dock', () => {
  it('EDIT + operator pins: watermark reads pinned-elsewhere (Review), and the toggle unpins from Review', () => {
    const h = renderPalette({
      dockPins: [...OPERATOR_PINS],
      isToolPinned: operatorPinned,
      activeStage: 'edit',
    });
    try {
      const row = rowEl(h.host, 'watermark');
      expect(row.getAttribute('data-palette-pinned')).toBe('false');
      expect(row.getAttribute('data-palette-pin-stage')).toBe('review');
      const toggle = toggleEl(h.host, 'watermark');
      expect(toggle.getAttribute('data-palette-pin-state')).toBe('pinned-elsewhere');
      expect(toggle.getAttribute('aria-pressed')).toBe('true');
      expect(toggle.getAttribute('title')).toBe('Unpin Watermark from the Review dock');

      click(toggle);
      expect(h.onUnpinTool).toHaveBeenCalledWith('watermark');
      expect(h.onPinTool).not.toHaveBeenCalled();
      expect(notice(h.host)).toBe('Unpinned Watermark from the Review dock');
    } finally {
      h.unmount();
    }
  });

  it('EDIT + no pin: pinning names the Review dock it actually lands in', () => {
    const h = renderPalette({ dockPins: [], activeStage: 'edit' });
    try {
      const toggle = toggleEl(h.host, 'watermark');
      expect(toggle.getAttribute('data-palette-pin-state')).toBe('unpinned');
      expect(toggle.getAttribute('title')).toBe('Pin Watermark to the Review dock');
      click(toggle);
      expect(h.onPinTool).toHaveBeenCalledWith('watermark');
      expect(notice(h.host)).toBe('Pinned Watermark to the Review dock');
    } finally {
      h.unmount();
    }
  });

  it('REVIEW + operator pins: watermark reads pinned (in this dock) and unpins from "the dock"', () => {
    const h = renderPalette({
      dockPins: [...OPERATOR_PINS],
      isToolPinned: operatorPinned,
      activeStage: 'review',
    });
    try {
      const row = rowEl(h.host, 'watermark');
      expect(row.getAttribute('data-palette-pinned')).toBe('true');
      expect(row.getAttribute('data-palette-pin-stage')).toBeNull();
      const toggle = toggleEl(h.host, 'watermark');
      expect(toggle.getAttribute('data-palette-pin-state')).toBe('pinned');
      expect(toggle.getAttribute('aria-pressed')).toBe('true');
      click(toggle);
      expect(h.onUnpinTool).toHaveBeenCalledWith('watermark');
      expect(notice(h.host)).toBe('Unpinned Watermark from the dock');
    } finally {
      h.unmount();
    }
  });

  it('a global pin still reads pinned in a foreign stage with the plain copy', () => {
    const h = renderPalette({
      dockPins: ['undo'],
      isToolPinned: (id): boolean => id === 'undo',
      activeStage: 'edit',
    });
    try {
      const row = rowEl(h.host, 'undo');
      expect(row.getAttribute('data-palette-pinned')).toBe('true');
      expect(row.getAttribute('data-palette-pin-stage')).toBeNull();
      expect(toggleEl(h.host, 'undo').getAttribute('data-palette-pin-state')).toBe('pinned');
    } finally {
      h.unmount();
    }
  });
});

