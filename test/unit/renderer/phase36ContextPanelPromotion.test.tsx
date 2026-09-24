// @vitest-environment jsdom
//
// Phase 36 (chunk 6) — the ContextPanel is PROMOTED to the real left slot and
// the chunk-2 dev flag is retired.
//
// Single mode renders the STAGES panel where the rail used to sit; the rail's
// own thumbnails / outline / drag system are the same components re-parented,
// so `[data-context-panel]` replaces `[data-pane-strip]` and the collapse hook
// (`[data-rail-collapse]` / `[data-rail-ruler]`) is preserved. Multi Mode keeps
// its Phase 32-34 centred pane strips EXACTLY as before (the panel is single
// mode only). The dev flag and every dev marker are gone.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { DocumentView } from '../../../src/renderer/components/DocumentView';
import type { EngineState } from '../../../src/renderer/engine/types';

const ROOT = resolve(__dirname, '../../..');

function stubObservers(): void {
  const g = globalThis as unknown as { IntersectionObserver?: unknown; ResizeObserver?: unknown };
  if (g.IntersectionObserver === undefined) {
    class Noop {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    g.IntersectionObserver = Noop;
  }
  if (g.ResizeObserver === undefined) {
    class Noop {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    g.ResizeObserver = Noop;
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
        getViewport: (): { width: number; height: number } => ({ width: 612, height: 792 }),
        render: (): { promise: Promise<void> } => ({ promise: Promise.resolve() }),
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

async function mountView(props: {
  railSide?: 'left' | 'right';
  multiRail?: {
    pane: 'A' | 'B';
    tabId: string;
    title: string;
    documentCount: number;
    onFocusPane: () => void;
    onDrop: () => void;
  } | null;
  pagesPanelCollapsed?: boolean;
} = {}): Promise<HTMLElement> {
  stubObservers();
  const host = document.createElement('div');
  document.body.appendChild(host);
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
        onPersist: (): void => undefined,
        onDiagnostics: (): void => undefined,
        engineState: makeEngineState(3),
        canUndo: false,
        annotations: [],
        formFields: [],
        signatures: [],
        savedSignatures: [],
        stampAnnotations: [],
        railSide: props.railSide ?? 'left',
        multiRail: props.multiRail ?? null,
        pagesPanelCollapsed: props.pagesPanelCollapsed ?? false,
        onTogglePagesPanelCollapsed: (): void => undefined,
      }),
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  return host;
}

describe('Phase 36 chunk 6 — the promotion: single mode renders the panel', () => {
  it('mounts the STAGES ContextPanel in the left slot (no rail, no dev marker)', async () => {
    const host = await mountView();
    const workspace = host.querySelector('.workspace');
    expect(workspace?.getAttribute('data-rail-side')).toBe('left');
    const panel = host.querySelector('[data-context-panel]');
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute('data-context-panel')).toBe('pages');
    // The rail no longer occupies the single-mode slot...
    expect(host.querySelector('.side-rail')).toBeNull();
    expect(host.querySelector('[data-pane-strip]')).toBeNull();
    // ...and the dev scaffolding is gone.
    expect(host.querySelector('[data-context-panel-dev-mount]')).toBeNull();
    expect(host.querySelector('[data-context-panel-dev-badge]')).toBeNull();
    // The panel sits BEFORE the page area.
    const main = host.querySelector('.workspace-main');
    expect(panel?.compareDocumentPosition(main as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it('keeps the collapse affordance: the ruler strip renders when collapsed', async () => {
    const host = await mountView({ pagesPanelCollapsed: true });
    expect(host.querySelector('[data-rail-collapse]')).not.toBeNull();
    expect(host.querySelector('[data-rail-ruler]')).not.toBeNull();
  });

  it('leaves Multi Mode unchanged: the pane strip renders, the panel does not', async () => {
    const host = await mountView({
      railSide: 'right',
      multiRail: {
        pane: 'A',
        tabId: 'doc-a',
        title: 'Alpha.pdf',
        documentCount: 2,
        onFocusPane: (): void => undefined,
        onDrop: (): void => undefined,
      },
    });
    expect(host.querySelector('[data-context-panel]')).toBeNull();
    const strip = host.querySelector('[data-pane-strip]');
    expect(strip).not.toBeNull();
    // The strip still follows the page area (pane A's inner edge).
    const main = host.querySelector('.workspace-main');
    expect(main?.compareDocumentPosition(strip as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });
});

describe('Phase 36 chunk 6 — the dev flag is retired at the source', () => {
  const docView = readFileSync(
    resolve(ROOT, 'src/renderer/components/DocumentView.tsx'),
    'utf8',
  );
  const panel = readFileSync(resolve(ROOT, 'src/renderer/components/ContextPanel.tsx'), 'utf8');

  it('deletes the devFlags module', () => {
    expect(existsSync(resolve(ROOT, 'src/renderer/state/devFlags.ts'))).toBe(false);
  });

  it('no source reads the stage-panel dev flag any more', () => {
    expect(docView).not.toContain('currentStagePanelDevFlag');
    expect(docView).not.toContain('devFlags');
    expect(docView).not.toContain('tfStagePanel');
    expect(docView).not.toContain('data-context-panel-dev-mount');
    expect(panel).not.toContain('tfStagePanel');
    expect(panel).not.toContain('dev:');
  });
});
