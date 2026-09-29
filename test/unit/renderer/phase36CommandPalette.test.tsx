// @vitest-environment jsdom
//
// Phase 36 (chunk 4) — the Command Palette component.
//
// Pins the contract the palette has to keep: it opens on `Ctrl+K` (with
// `Ctrl+Shift+P` as the legacy alias) and never on `Ctrl+P`; it lists every
// registry tool plus the recent files; the query fuzzy-narrows the list; the
// arrow keys move the highlight (skipping disabled rows), Enter runs the
// highlighted row through the host's handler and closes, `Ctrl+Enter` pins
// through the SAME `dockPins` path (with the dock's full-dock refusal), Esc
// and an outside mousedown close it, a disabled row is inert, and everything
// still works under reduced motion.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useEffect, useState } from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { ReactElement } from 'react';
import {
  CommandPalette,
  PALETTE_KEY_HINT,
  type CommandPaletteProps,
} from '../../../src/renderer/components/CommandPalette';
import {
  PALETTE_DOCK_FULL_MESSAGE,
  buildPaletteRows,
  firstActionableIndex,
  paletteChordFor,
} from '../../../src/renderer/state/commandPalette';
import { DOCK_MAX_PINS } from '../../../src/renderer/state/dockModel';
import { TOOL_REGISTRY, toolById } from '../../../src/renderer/state/toolsRegistry';
import {
  useCommandPaletteAnimation,
  type MotionVariantSet,
} from '../../../src/renderer/hooks/useAnimations';
import {
  MOTION_DURATION,
  MOTION_EASE,
  MOTION_SCALE,
  msToSeconds,
} from '../../../src/renderer/hooks/motionTokens';

const RECENTS = [{ path: 'C:/docs/quarterly.pdf', label: 'quarterly.pdf' }];

interface Harness {
  host: HTMLElement;
  onRunTool: ReturnType<typeof vi.fn>;
  onPinTool: ReturnType<typeof vi.fn>;
  onClose: ReturnType<typeof vi.fn>;
  onOpenRecent: ReturnType<typeof vi.fn>;
  rerender: (next: Partial<CommandPaletteProps>) => void;
  unmount: () => void;
}

/** Render a palette whose open state is owned by the wrapper, so a close
 *  really unmounts it exactly like the host's `commandPaletteOpen`. */
function renderPalette(options: Partial<CommandPaletteProps> = {}): Harness {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  const onRunTool = vi.fn();
  const onPinTool = vi.fn();
  const onClose = vi.fn();
  const onOpenRecent = vi.fn();
  const current: { props: CommandPaletteProps } = {
    props: {
      open: true,
      onClose,
      onRunTool,
      onPinTool,
      recentFiles: RECENTS,
      onOpenRecent,
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
    onPinTool,
    onClose,
    onOpenRecent,
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

/** The host's chord wiring (App's effect), reproduced here so the keys the
 *  palette claims — and the one it must NOT claim — are pinned. */
function renderChordHarness(): { host: HTMLElement; unmount: () => void } {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  function Wrapper(): ReactElement {
    const [open, setOpen] = useState(false);
    useEffect((): (() => void) => {
      const onKey = (event: KeyboardEvent): void => {
        const chord = paletteChordFor(event);
        if (chord === null) return;
        event.preventDefault();
        if (chord === 'legacy-open') {
          setOpen(true);
          return;
        }
        setOpen((value) => !value);
      };
      window.addEventListener('keydown', onKey);
      return (): void => window.removeEventListener('keydown', onKey);
    }, []);
    return (
      <CommandPalette
        open={open}
        onClose={(): void => setOpen(false)}
        onRunTool={vi.fn()}
        onPinTool={vi.fn()}
      />
    );
  }
  act((): void => {
    root.render(<Wrapper />);
  });
  return {
    host,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

const box = (host: HTMLElement): HTMLElement => {
  const el = host.querySelector<HTMLElement>('[data-command-palette]');
  if (el === null) throw new Error('palette box missing');
  return el;
};

const input = (host: HTMLElement): HTMLInputElement => {
  const el = host.querySelector<HTMLInputElement>('[data-command-palette-input]');
  if (el === null) throw new Error('palette input missing');
  return el;
};

const rows = (host: HTMLElement): HTMLElement[] => [
  ...host.querySelectorAll<HTMLElement>('[data-palette-row]'),
];

const rowIds = (host: HTMLElement): string[] =>
  rows(host).map((el) => el.getAttribute('data-palette-tool-id') ?? `recent`);

const row = (host: HTMLElement, toolId: string): HTMLElement => {
  const el = host.querySelector<HTMLElement>(`[data-palette-tool-id="${toolId}"]`);
  if (el === null) throw new Error(`row ${toolId} missing`);
  return el;
};

const activeRowIndex = (host: HTMLElement): number =>
  rows(host).findIndex((el) => el.getAttribute('aria-selected') === 'true');

const toolIdAt = (host: HTMLElement, index: number): string | null =>
  rows(host)[index]?.getAttribute('data-palette-tool-id') ?? null;

function type(inputEl: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set;
  act((): void => {
    setter?.call(inputEl, value);
    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
    inputEl.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function pressKey(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  act((): void => {
    window.dispatchEvent(event);
  });
  return event;
}

function click(target: Element): void {
  act((): void => {
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function mouseDown(target: EventTarget): void {
  act((): void => {
    target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  });
}

/** Let motion's skipAnimations exit complete so the presence boundary
 *  actually detaches the closed surface (jsdom resolves it on the next
 *  frame). */
async function flushExit(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 40));
  });
}

/** Controllable `prefers-reduced-motion` stub (the same shape
 *  useAnimations.test.tsx installs). A fresh function identity per install
 *  forces the hook module to build a fresh subscription. */
interface FakeMql {
  matches: boolean;
  media: string;
  addEventListener(_type: string, listener: (ev: { matches: boolean }) => void): void;
  removeEventListener(_type: string, listener: (ev: { matches: boolean }) => void): void;
}

function installReducedMotionStub(matches: boolean): FakeMql {
  const listeners = new Set<(ev: { matches: boolean }) => void>();
  const mql: FakeMql = {
    matches,
    media: '(prefers-reduced-motion: reduce)',
    addEventListener: (_type, listener): void => {
      listeners.add(listener);
    },
    removeEventListener: (_type, listener): void => {
      listeners.delete(listener);
    },
  };
  (window as unknown as { matchMedia: (query: string) => FakeMql }).matchMedia = (
    query: string,
  ): FakeMql => {
    mql.media = query;
    return mql;
  };
  return mql;
}

/** Mount a fresh probe for the palette animation hook and return the variants
 *  it resolved for the CURRENT reduced-motion stub. A fresh root per call is
 *  required: the hook reads the OS setting through a subscription built at
 *  mount, so re-rendering an existing root would keep the old value. */
function mountAnimationProbe(): MotionVariantSet {
  let snapshot: MotionVariantSet | null = null;
  function Probe(): null {
    snapshot = useCommandPaletteAnimation();
    return null;
  }
  const container = document.body.appendChild(document.createElement('div'));
  const root = createRoot(container);
  act((): void => {
    root.render(<Probe />);
  });
  if (snapshot === null) throw new Error('probe did not resolve');
  return snapshot;
}

beforeEach((): void => {
  document.body.innerHTML = '';
  installReducedMotionStub(false);
});afterEach((): void => {
  document.body.innerHTML = '';
});

describe('Phase 36 — the palette surface', () => {
  it('renders nothing while closed', () => {
    const h = renderPalette({ open: false });
    try {
      expect(h.host.querySelector('[data-command-palette]')).toBeNull();
      expect(h.host.querySelector('[data-command-palette-layer]')).toBeNull();
    } finally {
      h.unmount();
    }
  });

  it('is a labelled modal with a combobox input wired to the listbox', () => {
    const h = renderPalette();
    try {
      const dialog = box(h.host);
      expect(dialog.getAttribute('role')).toBe('dialog');
      expect(dialog.getAttribute('aria-modal')).toBe('true');
      expect(dialog.getAttribute('aria-label')).toBe('Command palette');

      const field = input(h.host);
      expect(field.getAttribute('role')).toBe('combobox');
      expect(field.getAttribute('aria-label')).toBe(
        'Search tools, recent files and view actions',
      );
      expect(field.getAttribute('aria-expanded')).toBe('true');
      const listId = field.getAttribute('aria-controls');
      expect(listId).not.toBeNull();
      expect(h.host.querySelector(`#${listId}`)?.getAttribute('role')).toBe('listbox');

      // The active-descendant points at the first RUNNABLE row (the recent
      // file leads the resting list).
      const first = rows(h.host)[0];
      expect(first?.getAttribute('aria-selected')).toBe('true');
      expect(first?.id).toBe(field.getAttribute('aria-activedescendant'));

      // The footer names the keys.
      expect(h.host.querySelector('[data-command-palette-hint]')?.textContent).toBe(
        PALETTE_KEY_HINT,
      );
      expect(PALETTE_KEY_HINT).toContain('Ctrl+Enter pin to dock');
    } finally {
      h.unmount();
    }
  });

  it('lists EVERY registry tool plus the recent files, each tool with a stage tag', () => {
    const h = renderPalette();
    try {
      const listed = rows(h.host);
      expect(listed).toHaveLength(TOOL_REGISTRY.length + 1);
      expect(listed.filter((el) => el.getAttribute('data-palette-row') === 'recent')).toHaveLength(1);
      // Every registry id is present exactly once.
      const ids = listed
        .map((el) => el.getAttribute('data-palette-tool-id'))
        .filter((id): id is string => id !== null);
      expect(new Set(ids).size).toBe(TOOL_REGISTRY.length);
      // The stage tag chip names the entry's stage.
      expect(row(h.host, 'merge').querySelector('.command-palette-tag')?.textContent).toBe('Pages');
      expect(row(h.host, 'optimize').querySelector('.command-palette-tag')?.textContent).toBe(
        'Deliver',
      );
      expect(row(h.host, 'save').querySelector('.command-palette-tag')?.textContent).toBe('Global');
    } finally {
      h.unmount();
    }
  });
});

describe('Phase 36 — fuzzy search', () => {
  it('narrows the list by label, by id and by description', () => {
    const h = renderPalette();
    try {
      type(input(h.host), 'bookmarks');
      expect(rowIds(h.host)).toEqual(['outlinePanel']);

      type(input(h.host), 'multi-mode');
      expect(rowIds(h.host)).toEqual(['multi-mode']);

      type(input(h.host), 'searchable text layer');
      expect(rowIds(h.host)).toEqual(['recognizeText']);
    } finally {
      h.unmount();
    }
  });

  it('keeps the recent file reachable and shows the empty state for gibberish', () => {
    const h = renderPalette();
    try {
      type(input(h.host), 'quarterly');
      expect(rowIds(h.host)).toEqual(['recent']);

      type(input(h.host), 'zzzqqq');
      expect(rows(h.host)).toHaveLength(0);
      expect(h.host.querySelector('[data-command-palette-empty]')).not.toBeNull();
    } finally {
      h.unmount();
    }
  });

  it('re-anchors the highlight on the first runnable row when the query changes', () => {
    const h = renderPalette();
    try {
      pressKey('ArrowDown');
      pressKey('ArrowDown');
      expect(activeRowIndex(h.host)).toBeGreaterThan(0);
      type(input(h.host), 'page');
      // The first "page" row is the command-less Page thumbnails entry, so the
      // anchor is the next runnable row.
      const expected = firstActionableIndex(
        buildPaletteRows({ query: 'page', recents: RECENTS }),
      );
      expect(rows(h.host).findIndex((el) => el.getAttribute('data-palette-disabled') === 'true')).toBe(0);
      expect(activeRowIndex(h.host)).toBe(expected);
    } finally {
      h.unmount();
    }
  });
});

describe('Phase 36 — the ^/v highlight and Enter', () => {
  it('moves the highlight with the arrow keys and wraps at the ends', () => {
    const h = renderPalette();
    try {
      const count = rows(h.host).length;
      expect(activeRowIndex(h.host)).toBe(0);
      pressKey('ArrowDown');
      expect(activeRowIndex(h.host)).toBe(1);
      pressKey('ArrowDown');
      expect(activeRowIndex(h.host)).toBe(2);
      pressKey('ArrowUp');
      expect(activeRowIndex(h.host)).toBe(1);
      pressKey('ArrowUp');
      expect(activeRowIndex(h.host)).toBe(0);
      pressKey('ArrowUp');
      expect(activeRowIndex(h.host)).toBe(count - 1);
    } finally {
      h.unmount();
    }
  });

  it('skips a disabled row while stepping', () => {
    // Seeded usage puts the command-less `dragPage` directly after the recent
    // row, so ↓ has to step over it.
    const h = renderPalette({ toolUsage: { dragPage: 5 } });
    try {
      expect(toolIdAt(h.host, 1)).toBe('dragPage');
      const disabled = row(h.host, 'dragPage');
      expect(disabled.getAttribute('data-palette-disabled')).toBe('true');
      pressKey('ArrowDown');
      expect(activeRowIndex(h.host)).toBe(2);
      expect(toolIdAt(h.host, 2)).toBe('merge');
    } finally {
      h.unmount();
    }
  });

  it('runs the highlighted row on Enter and closes the palette', () => {
    const h = renderPalette();
    try {
      type(input(h.host), 'merge pdfs');
      expect(rowIds(h.host)).toEqual(['merge']);
      pressKey('Enter');
      expect(h.onRunTool).toHaveBeenCalledWith('merge');
      expect(h.onRunTool).toHaveBeenCalledTimes(1);
      expect(h.onClose).toHaveBeenCalledTimes(1);
    } finally {
      h.unmount();
    }
  });
});

describe('Phase 36 — pinning through the dock path', () => {
  // Phase 58 — the cap is 200; a raw list at that length still refuses a
  // cross-stage pin (the palette checks the RAW `dockPins` length).
  const FULL_PINS = Array.from({ length: 200 }, (_, i) => `pin-${i}`);

  it('pins the highlighted row on Ctrl+Enter and keeps the palette open', () => {
    const h = renderPalette();
    try {
      type(input(h.host), 'merge');
      pressKey('Enter', { ctrlKey: true });
      expect(h.onPinTool).toHaveBeenCalledWith('merge');
      expect(h.onRunTool).not.toHaveBeenCalled();
      expect(h.onClose).not.toHaveBeenCalled();
      expect(h.host.querySelector('[data-command-palette-notice]')?.textContent).toBe(
        'Pinned Merge PDFs to the dock',
      );
    } finally {
      h.unmount();
    }
  });

  it('surfaces the dock refusal at the pin cap and never calls the writer', () => {
    expect(DOCK_MAX_PINS).toBe(200);
    const h = renderPalette({ dockPins: FULL_PINS });
    try {
      type(input(h.host), 'sign');
      pressKey('Enter', { ctrlKey: true });
      expect(h.onPinTool).not.toHaveBeenCalled();
      expect(h.host.querySelector('[data-command-palette-notice]')?.textContent).toBe(
        PALETTE_DOCK_FULL_MESSAGE,
      );
    } finally {
      h.unmount();
    }
  });

  it('marks an already-pinned row and refuses a second pin', () => {
    const h = renderPalette({ dockPins: ['merge'] });
    try {
      type(input(h.host), 'merge');
      const pinned = row(h.host, 'merge');
      expect(pinned.getAttribute('data-palette-pinned')).toBe('true');
      expect(pinned.querySelector('[data-palette-pin]')).not.toBeNull();
      pressKey('Enter', { ctrlKey: true });
      expect(h.onPinTool).not.toHaveBeenCalled();
      expect(h.host.querySelector('[data-command-palette-notice]')?.textContent).toContain(
        'already pinned',
      );
    } finally {
      h.unmount();
    }
  });

  it('reflects a completed pin on the next host render', () => {
    const h = renderPalette({ dockPins: [] });
    try {
      type(input(h.host), 'merge');
      expect(row(h.host, 'merge').getAttribute('data-palette-pinned')).toBe('false');
      h.rerender({ dockPins: ['merge'] });
      expect(row(h.host, 'merge').getAttribute('data-palette-pinned')).toBe('true');
    } finally {
      h.unmount();
    }
  });

  it('leaves the highlight where the user left it when the pin lands', () => {
    const h = renderPalette({ dockPins: [] });
    try {
      type(input(h.host), 'page');
      pressKey('ArrowDown');
      pressKey('ArrowDown');
      const before = activeRowIndex(h.host);
      expect(before).toBeGreaterThan(0);
      h.rerender({ dockPins: ['merge'] });
      expect(activeRowIndex(h.host)).toBe(before);
    } finally {
      h.unmount();
    }
  });
});

describe('Phase 36 — running, disabling and closing', () => {
  it('runs a clicked row and closes; the recent row opens that file', () => {
    const h = renderPalette();
    try {
      type(input(h.host), 'split');
      click(row(h.host, 'split'));
      expect(h.onRunTool).toHaveBeenCalledWith('split');
      expect(h.onClose).toHaveBeenCalledTimes(1);
    } finally {
      h.unmount();
    }

    const h2 = renderPalette();
    try {
      type(input(h2.host), 'quarterly');
      click(rows(h2.host)[0] as Element);
      expect(h2.onOpenRecent).toHaveBeenCalledWith('C:/docs/quarterly.pdf');
      expect(h2.onRunTool).not.toHaveBeenCalled();
      expect(h2.onClose).toHaveBeenCalledTimes(1);
    } finally {
      h2.unmount();
    }
  });

  it('keeps a command-less entry inert and explains why', () => {
    // A corpus of ONE command-less entry: nothing in the list can run, so
    // neither a click nor Enter may reach the host.
    const h = renderPalette({ entries: [toolById('dragPage')!], recentFiles: [] });
    try {
      const el = row(h.host, 'dragPage');
      expect(el.getAttribute('data-palette-disabled')).toBe('true');
      expect(el.getAttribute('aria-disabled')).toBe('true');
      expect(el.getAttribute('title')).toBe('Drag a page onto another pane');
      expect(el.getAttribute('data-palette-pin')).toBeNull();
      click(el);
      expect(h.onRunTool).not.toHaveBeenCalled();
      expect(h.onClose).not.toHaveBeenCalled();
      pressKey('Enter');
      expect(h.onRunTool).not.toHaveBeenCalled();
      pressKey('Enter', { ctrlKey: true });
      expect(h.onPinTool).not.toHaveBeenCalled();
    } finally {
      h.unmount();
    }
  });

  it('honours the host availability gate and shows the registry reason', () => {
    const h = renderPalette({ isToolEnabled: (entry): boolean => entry.id !== 'merge' });
    try {
      type(input(h.host), 'merge pdfs');
      const el = row(h.host, 'merge');
      expect(el.getAttribute('aria-disabled')).toBe('true');
      expect(el.getAttribute('title')).toBe('Open a document first');
      click(el);
      expect(h.onRunTool).not.toHaveBeenCalled();
    } finally {
      h.unmount();
    }
  });

  it('closes on Esc', () => {
    const h = renderPalette();
    try {
      pressKey('Escape');
      expect(h.onClose).toHaveBeenCalledTimes(1);
    } finally {
      h.unmount();
    }
  });

  it('closes on an outside mousedown and stays open for one inside the box', () => {
    const h = renderPalette();
    try {
      mouseDown(input(h.host));
      expect(h.onClose).not.toHaveBeenCalled();
      mouseDown(document.body);
      expect(h.onClose).toHaveBeenCalledTimes(1);
    } finally {
      h.unmount();
    }
  });
});

describe('Phase 36 — the host chords (Ctrl+K / Ctrl+Shift+P / Ctrl+P)', () => {
  it('opens on Ctrl+K, toggles closed on a second press', async () => {
    const h = renderChordHarness();
    try {
      expect(h.host.querySelector('[data-command-palette]')).toBeNull();
      const openEvent = pressKey('k', { ctrlKey: true });
      expect(openEvent.defaultPrevented).toBe(true);
      expect(h.host.querySelector('[data-command-palette]')).not.toBeNull();
      pressKey('k', { ctrlKey: true });
      await flushExit();
      expect(h.host.querySelector('[data-command-palette]')).toBeNull();
    } finally {
      h.unmount();
    }
  });

  it('opens on the legacy Ctrl+Shift+P alias', () => {
    const h = renderChordHarness();
    try {
      pressKey('p', { ctrlKey: true, shiftKey: true });
      expect(h.host.querySelector('[data-command-palette]')).not.toBeNull();
    } finally {
      h.unmount();
    }
  });

  it('NEVER intercepts Ctrl+P — it stays the Print shortcut', () => {
    const h = renderChordHarness();
    try {
      const printEvent = pressKey('p', { ctrlKey: true });
      expect(printEvent.defaultPrevented).toBe(false);
      expect(h.host.querySelector('[data-command-palette]')).toBeNull();

      pressKey('k', { ctrlKey: true });
      expect(h.host.querySelector('[data-command-palette]')).not.toBeNull();
      const printWhileOpen = pressKey('p', { ctrlKey: true });
      expect(printWhileOpen.defaultPrevented).toBe(false);
      expect(h.host.querySelector('[data-command-palette]')).not.toBeNull();
    } finally {
      h.unmount();
    }
  });
});

describe('Phase 36 — reduced motion', () => {
  it('still opens, lists and closes with prefers-reduced-motion: reduce', async () => {
    installReducedMotionStub(true);
    const h = renderPalette();
    try {
      expect(rows(h.host)).toHaveLength(TOOL_REGISTRY.length + 1);
      expect(activeRowIndex(h.host)).toBe(0);
      pressKey('ArrowDown');
      expect(activeRowIndex(h.host)).toBe(1);
      pressKey('Escape');
      expect(h.onClose).toHaveBeenCalledTimes(1);
      await flushExit();
    } finally {
      h.unmount();
    }
  });

  it('the palette animation is opacity-only under reduced motion', () => {
    installReducedMotionStub(true);
    const snapshot = mountAnimationProbe();
    expect(Object.keys(snapshot.initial)).toEqual(['opacity']);
    expect(snapshot.animate.scale).toBeUndefined();
    expect(snapshot.exit.scale).toBeUndefined();
  });

  it('and scale/opacity over the 140ms panel band otherwise', () => {
    installReducedMotionStub(false);
    const snapshot = mountAnimationProbe();
    expect(snapshot.initial).toMatchObject({ opacity: 0, scale: MOTION_SCALE.enter });
    expect(snapshot.animate).toMatchObject({
      opacity: 1,
      scale: 1,
      transition: {
        duration: msToSeconds(MOTION_DURATION.panel),
        ease: MOTION_EASE.enter,
      },
    });
    expect(MOTION_DURATION.panel).toBe(140);
  });
});


