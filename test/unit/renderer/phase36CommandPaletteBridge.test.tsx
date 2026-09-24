// @vitest-environment jsdom
//
// Phase 36 (chunk 4) — the Command Palette's view-command bridge.
//
// The palette is mounted once by App, but the view-level verbs (the zoom
// presets, the page stepping, Find, pan, the edit / annotation tools) live in
// DocumentView. The view PUBLISHES the handlers it already owns — the same
// ones the CanvasPills and the Action Dock call — so the palette can run them
// without a second implementation. These tests pin that contract:
//
//   - the published map carries every view action the palette needs,
//   - the entries ARE the view's own handlers (a spy on the view's prop
//     fires when the published command runs),
//   - page stepping composes the view's own `jumpToPage` (observable through
//     onPersist),
//   - unmounting WITHDRAWS the map (`register(null)`) so a closed pane's
//     commands never linger in the host.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { DocumentView } from '../../../src/renderer/components/DocumentView';
import type { EngineState } from '../../../src/renderer/engine/types';

function stubObservers(): void {
  const g = globalThis as unknown as { IntersectionObserver?: unknown; ResizeObserver?: unknown };
  if (g.IntersectionObserver === undefined) {
    class NoopIntersectionObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    g.IntersectionObserver = NoopIntersectionObserver;
  }
  if (g.ResizeObserver === undefined) {
    class NoopResizeObserver {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    g.ResizeObserver = NoopResizeObserver;
  }
  const proto = Element.prototype as unknown as { scrollTo?: unknown };
  if (proto.scrollTo === undefined) {
    proto.scrollTo = (): void => undefined;
  }
}

function makeDocStub(numPages: number): PDFDocumentProxy {
  return {
    numPages,
    async getPage(): Promise<unknown> {
      return {
        view: [0, 0, 612, 792],
        getViewport: (_args: { scale: number }): { width: number; height: number } => ({
          width: 612,
          height: 792,
        }),
        render: (_args: unknown): { promise: Promise<void> } => ({
          promise: Promise.resolve(),
        }),
        cleanup: async (): Promise<void> => undefined,
      };
    },
    destroy: async (): Promise<void> => undefined,
  } as unknown as PDFDocumentProxy;
}

function makeEngineState(pageCount: number): EngineState {
  return {
    pageCount,
    pageOrder: Array.from({ length: pageCount }, (_, i) => i),
    rotations: Array.from({ length: pageCount }, () => 0),
    deleted: Array.from({ length: pageCount }, () => false),
    modified: false,
    annotations: [],
  };
}

interface Bridge {
  published: Record<string, () => void>[];
  withdrawn: number;
  persisted: ReturnType<typeof vi.fn>;
  onRotateCounterClockwise: ReturnType<typeof vi.fn>;
  unmount: () => void;
}

/** Mount DocumentView with the bridge prop wired and return the recordings. */
async function mountViewBridge(): Promise<Bridge> {
  stubObservers();
  const published: Record<string, () => void>[] = [];
  let withdrawn = 0;
  const persisted = vi.fn();
  const onRotateCounterClockwise = vi.fn();
  const host = document.body.appendChild(document.createElement('div'));
  const root = createRoot(host);
  await act(async (): Promise<void> => {
    root.render(
      createElement(DocumentView, {
        doc: makeDocStub(3),
        pageCount: 3,
        outline: null,
        initial: {
          zoomMode: 'fit-width',
          manualScale: 1,
          currentPage: 1,
          searchOpen: false,
          query: '',
          activeHitIndex: -1,
        },
        onPersist: persisted,
        onDiagnostics: (): void => undefined,
        engineState: makeEngineState(3),
        canUndo: false,
        saveInPlaceEnabled: false,
        annotations: [],
        formFields: [],
        signatures: [],
        savedSignatures: [],
        stampAnnotations: [],
        onRotateCounterClockwise,
        registerViewCommands: (commands): void => {
          if (commands === null) {
            withdrawn += 1;
            return;
          }
          published.push(commands);
        },
      }),
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  return {
    published,
    get withdrawn(): number {
      return withdrawn;
    },
    persisted,
    onRotateCounterClockwise,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

describe('Phase 36 — the palette view-command bridge', () => {
  it('publishes every view action the palette needs', async () => {
    const bridge = await mountViewBridge();
    try {
      const commands = bridge.published.at(-1);
      expect(commands).toBeDefined();
      for (const action of [
        'zoomIn',
        'zoomOut',
        'fitWidth',
        'fitPage',
        'find',
        'prevPage',
        'nextPage',
        'handToggle',
        'annotate',
        'editModeToggle',
        'editToolText',
        'rotateClockwise',
        'rotateCounterClockwise',
        'clearPageSelection',
        'annotationHighlight',
        'annotationInk',
      ]) {
        expect(typeof commands?.[action], `${action} not published`).toBe('function');
      }
    } finally {
      bridge.unmount();
    }
  });

  it('routes a published command to the view s OWN handler', async () => {
    const bridge = await mountViewBridge();
    try {
      const commands = bridge.published.at(-1) ?? {};
      act((): void => {
        commands.rotateCounterClockwise?.();
      });
      expect(bridge.onRotateCounterClockwise).toHaveBeenCalledTimes(1);
    } finally {
      bridge.unmount();
    }
  });

  it('composes page stepping from the view s own jumpToPage', async () => {
    const bridge = await mountViewBridge();
    try {
      const commands = bridge.published.at(-1) ?? {};
      act((): void => {
        commands.nextPage?.();
      });
      expect(bridge.persisted).toHaveBeenCalled();
      const last = bridge.persisted.mock.calls.at(-1)?.[0] as { currentPage?: number } | undefined;
      expect(last?.currentPage).toBe(2);

      // The clamp holds at the first page: stepping back from page 1 is a
      // no-op, never page 0.
      act((): void => {
        commands.prevPage?.();
      });
      const after = bridge.persisted.mock.calls.at(-1)?.[0] as { currentPage?: number } | undefined;
      expect(after?.currentPage).toBe(1);
    } finally {
      bridge.unmount();
    }
  });

  it('withdraws its commands on unmount so a closed pane lingers nowhere', async () => {
    const bridge = await mountViewBridge();
    expect(bridge.published.length).toBeGreaterThan(0);
    bridge.unmount();
    expect(bridge.withdrawn).toBeGreaterThan(0);
  });
});
