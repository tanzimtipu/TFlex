// @vitest-environment jsdom
//
// TFL-1116 C11 (R16) — the compact stage/context launcher.
//
// R16: the compact context changed to a page-number rail even in Deliver,
// replacing output checks/actions with a truncated stage label. The fix gives
// non-Pages stages a LAUNCHER that opens the ACTIVE stage's context drawer;
// Pages keeps its page-number ruler. This suite pins that split (launcher vs
// ruler) and the drawer's close contract.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { ContextPanel } from '../../../src/renderer/components/ContextPanel';
import type { ContextPanelProps } from '../../../src/renderer/components/ContextPanel';
import type { EngineState } from '../../../src/renderer/engine/types';
import type { Stage } from '../../../src/renderer/state/stages';

const NOOP = (): void => undefined;

let roots: Root[] = [];
let hosts: HTMLElement[] = [];

function mount(ui: ReactElement): HTMLElement {
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  act((): void => {
    root.render(ui);
  });
  roots.push(root);
  hosts.push(host);
  return host;
}

beforeEach((): void => {
  roots = [];
  hosts = [];
  const g = globalThis as unknown as { ResizeObserver?: unknown };
  if (g.ResizeObserver === undefined) {
    class NoopResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    g.ResizeObserver = NoopResizeObserver;
  }
});

afterEach((): void => {
  const rs = roots;
  const hs = hosts;
  roots = [];
  hosts = [];
  for (const root of rs) act((): void => root.unmount());
  for (const h of hs) h.remove();
  document.body.innerHTML = '';
});

function docStub(numPages: number): PDFDocumentProxy {
  return {
    numPages,
    async getPage(n: number): Promise<unknown> {
      return {
        pageNumber: n,
        getViewport: (): { width: number; height: number } => ({ width: 612, height: 792 }),
        render: (): { promise: Promise<void>; cancel: () => void } => ({
          promise: Promise.resolve(),
          cancel: (): void => undefined,
        }),
        cleanup: async (): Promise<void> => undefined,
      };
    },
    destroy: async (): Promise<void> => undefined,
  } as unknown as PDFDocumentProxy;
}

function engineState(pageCount: number): EngineState {
  return {
    pageCount,
    pageOrder: Array.from({ length: pageCount }, (_, i) => i),
    rotations: new Array(pageCount).fill(0) as EngineState['rotations'],
    deleted: new Array(pageCount).fill(false),
    modified: false,
    annotations: [],
  };
}

function renderPanel(stage: Stage, extra: Partial<ContextPanelProps> = {}): HTMLElement {
  return mount(
    <ContextPanel
      stage={stage}
      doc={docStub(3)}
      currentPage={1}
      defaultWidthPt={612}
      defaultHeightPt={792}
      engineState={engineState(3)}
      canUndo={false}
      onJump={NOOP}
      outline={null}
      onUndo={NOOP}
      onOptimize={NOOP}
      onRecognizeText={NOOP}
      onOpenOcrSuspects={NOOP}
      onManageSignatures={NOOP}
      onCreateFromImages={NOOP}
      fileSize={2048}
      {...extra}
    />,
  );
}

describe('R16 — the compact stage launcher', () => {
  it('Pages collapsed keeps its page-number ruler (no launcher)', () => {
    const host = renderPanel('pages', { collapsed: true });
    expect(host.querySelector('[data-context-panel-ruler]')).not.toBeNull();
    expect(host.querySelector('[data-context-panel-launcher]')).toBeNull();
  });

  it.each(['edit', 'review', 'deliver'] as const)(
    'the %s stage collapsed shows ITS launcher, not a page rail',
    (stage) => {
      const host = renderPanel(stage, { collapsed: true });
      const launcher = host.querySelector('[data-context-panel-launcher]');
      expect(launcher).not.toBeNull();
      expect(launcher?.getAttribute('data-context-panel-launcher-stage')).toBe(stage);
      expect(host.querySelector('[data-context-panel-ruler]')).toBeNull();
    },
  );

  it('activating the launcher opens the active stage drawer (host toggle)', () => {
    const onToggleCollapsed = vi.fn();
    const host = renderPanel('deliver', { collapsed: true, onToggleCollapsed });
    act((): void => {
      (host.querySelector('[data-context-panel-launcher-open]') as HTMLElement).dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true }),
      );
    });
    expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
  });

  it('the drawer renders the active stage content (Deliver pre-flight), no launcher', () => {
    const host = renderPanel('deliver', { drawer: true, onClose: NOOP });
    expect(host.querySelector('[data-context-panel-drawer="true"]')).not.toBeNull();
    expect(host.querySelector('[data-context-panel-launcher]')).toBeNull();
    expect(host.querySelector('[data-context-panel-section="preflight"]')).not.toBeNull();
    expect(host.querySelector('[data-deliver-actions="new-document"]')).not.toBeNull();
  });

  it('Escape closes the drawer through the host onClose', () => {
    const onClose = vi.fn();
    renderPanel('review', { drawer: true, onClose });
    act((): void => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a wide collapsed Edit stage still offers the launcher (stage meaning survives)', () => {
    const host = renderPanel('edit', { collapsed: true });
    expect(host.querySelector('[data-context-panel-launcher-stage="edit"]')).not.toBeNull();
  });
});
