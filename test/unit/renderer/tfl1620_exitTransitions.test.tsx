// @vitest-environment jsdom
//
// TFL-1620 — exit transitions for the enter-only CSS surfaces.
//
// The shared `useExitTransition` state machine holds a surface through one
// MICRO-band exit when its `active` flag clears, and collapses to instant under
// the Animations-OFF / reduced-motion path. Pinned here along with the two
// surfaces whose leaving flag is driven by that hook/pattern: the compact
// Inspector drawer and the Activity Shelf panel.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useExitTransition } from '../../../src/renderer/hooks/useExitTransition';
import { setAnimationsEnabledPreference } from '../../../src/renderer/hooks/motionPolicy';
import { MOTION_DURATION } from '../../../src/renderer/hooks/motionTokens';
import { Inspector, type InspectorProps } from '../../../src/renderer/components/Inspector';
import { ActivityShelfPanel } from '../../../src/renderer/components/ActivityShelf';
import { createOperation } from '../../../src/renderer/state/activity';

let roots: Root[] = [];
let hosts: HTMLElement[] = [];

function mount(ui: ReactElement): { host: HTMLElement; rerender: (next: ReactElement) => void } {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  act((): void => root.render(ui));
  roots.push(root);
  hosts.push(host);
  return {
    host,
    rerender: (next: ReactElement): void => {
      act((): void => root.render(next));
    },
  };
}

afterEach((): void => {
  const rs = roots;
  const hs = hosts;
  roots = [];
  hosts = [];
  for (const root of rs) act((): void => root.unmount());
  for (const h of hs) h.remove();
  document.body.innerHTML = '';
  setAnimationsEnabledPreference(true);
});

function HookProbe(props: { active: boolean; exitMs?: number }): ReactElement {
  const leaving = useExitTransition(props.active, props.exitMs ?? MOTION_DURATION.micro);
  return <div data-leaving={leaving ? 'true' : 'false'} />;
}

describe('TFL-1620 — useExitTransition', () => {
  it('holds the surface for the exit band when active clears, then releases', () => {
    vi.useFakeTimers();
    try {
      const view = mount(<HookProbe active />);
      expect(view.host.querySelector('[data-leaving]')?.getAttribute('data-leaving')).toBe('false');
      view.rerender(<HookProbe active={false} />);
      expect(view.host.querySelector('[data-leaving]')?.getAttribute('data-leaving')).toBe('true');
      act((): void => {
        vi.advanceTimersByTime(MOTION_DURATION.micro + 20);
      });
      expect(view.host.querySelector('[data-leaving]')?.getAttribute('data-leaving')).toBe('false');
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels the exit when the surface re-opens mid-animation', () => {
    vi.useFakeTimers();
    try {
      const view = mount(<HookProbe active />);
      view.rerender(<HookProbe active={false} />);
      expect(view.host.querySelector('[data-leaving]')?.getAttribute('data-leaving')).toBe('true');
      view.rerender(<HookProbe active />);
      expect(view.host.querySelector('[data-leaving]')?.getAttribute('data-leaving')).toBe('false');
    } finally {
      vi.useRealTimers();
    }
  });

  it('never holds a frame when the Animations setting is OFF (instant path)', () => {
    setAnimationsEnabledPreference(false);
    const view = mount(<HookProbe active />);
    view.rerender(<HookProbe active={false} />);
    expect(view.host.querySelector('[data-leaving]')?.getAttribute('data-leaving')).toBe('false');
  });
});

describe('TFL-1620 — the compact Inspector drawer exits through its keyframe', () => {
  it('plays the leaving pose before resolving to the collapsed strip', () => {
    vi.useFakeTimers();
    try {
      const base: InspectorProps = { stage: 'pages', drawer: true, onClose: vi.fn() };
      const view = mount(<Inspector {...base} />);
      view.rerender(
        <Inspector stage="pages" collapsed drawer={false} onClose={undefined} />,
      );
      expect(view.host.querySelector('.inspector-drawer--leaving')).not.toBeNull();
      expect(
        view.host.querySelector('[data-inspector-drawer]')?.getAttribute('data-inspector-drawer'),
      ).toBe('true');
      act((): void => {
        vi.advanceTimersByTime(MOTION_DURATION.micro + 20);
      });
      expect(view.host.querySelector('.inspector-drawer--leaving')).toBeNull();
      expect(view.host.querySelector('[data-inspector-collapsed-strip]')).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('TFL-1620 — the Activity Shelf panel exits before notifying the host', () => {
  it('applies the leaving class and defers onClose until the exit band ends', () => {
    vi.useFakeTimers();
    try {
      const onClose = vi.fn();
      const operation = createOperation({
        id: 'op-1',
        document: { docId: 'op-1', tabId: 'op-1', path: null, displayName: 'Intake' },
        task: { name: 'Import files', scope: '2 files' },
      });
      const view = mount(
        <ActivityShelfPanel
          operations={[operation]}
          onClose={onClose}
          onCancel={(): void => undefined}
          onAction={(): void => undefined}
        />,
      );
      act((): void => {
        (view.host.querySelector('[data-activity-shelf-close]') as HTMLButtonElement).click();
      });
      expect(onClose).not.toHaveBeenCalled();
      expect(view.host.querySelector('.activity-shelf-panel--leaving')).not.toBeNull();
      act((): void => {
        vi.advanceTimersByTime(MOTION_DURATION.micro + 20);
      });
      expect(onClose).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
