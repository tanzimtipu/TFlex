// @vitest-environment jsdom
//
// DEF-328 — the EDIT panel's "Review suspects" entry was enabled before any OCR
// run and clicked through to nothing (`onOpenOcrSuspects` returns early until a
// run has completed). It is now gated exactly like the palette's `ocrSuspects`
// row — enabled only after a run — with the same refusal copy, so the control is
// never an enabled no-op.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { ContextPanel } from '../../../src/renderer/components/ContextPanel';
import type { ContextPanelProps } from '../../../src/renderer/components/ContextPanel';
import type { EngineState } from '../../../src/renderer/engine/types';

function makeDocStub(numPages: number): PDFDocumentProxy {
  return {
    numPages,
    async getPage(n: number): Promise<unknown> {
      return {
        pageNumber: n,
        view: [0, 0, 612, 792],
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

function makeEngineState(pageCount: number): EngineState {
  return {
    pageCount,
    pageOrder: Array.from({ length: pageCount }, (_, i) => i),
    rotations: new Array(pageCount).fill(0) as EngineState['rotations'],
    deleted: new Array(pageCount).fill(false),
    modified: false,
    annotations: [],
  };
}

function renderPanel(
  props: Partial<ContextPanelProps>,
): { host: HTMLElement; unmount: () => void } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(
      <ContextPanel
        stage="edit"
        doc={makeDocStub(3)}
        currentPage={1}
        defaultWidthPt={612}
        defaultHeightPt={792}
        pageSizes={null}
        engineState={makeEngineState(3)}
        proxyVisibleOrder={false}
        canUndo={false}
        onUndo={(): void => undefined}
        onJump={(): void => undefined}
        outline={null}
        {...props}
      />,
    );
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

const suspectsButton = (host: HTMLElement): HTMLButtonElement => {
  const el = host.querySelector<HTMLButtonElement>('[data-context-panel-action="suspects"]');
  if (el === null) throw new Error('the suspects entry is missing');
  return el;
};

describe('DEF-328 — the EDIT panel gates "Review suspects" on an OCR run', () => {
  it('is disabled with the palette row s copy before any run', () => {
    const onOpenOcrSuspects = vi.fn();
    const { host, unmount } = renderPanel({ ocrHasRun: false, onOpenOcrSuspects });
    try {
      const button = suspectsButton(host);
      expect(button.disabled).toBe(true);
      expect(button.getAttribute('title')).toBe('Run Recognize text first');
      act((): void => {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
      expect(onOpenOcrSuspects).not.toHaveBeenCalled();
    } finally {
      unmount();
    }
  });

  it('turns on after a run and calls the host s own opener', () => {
    const onOpenOcrSuspects = vi.fn();
    const { host, unmount } = renderPanel({
      ocrHasRun: true,
      ocrStatus: 'Recognized',
      ocrSuspectCount: 2,
      onOpenOcrSuspects,
    });
    try {
      const button = suspectsButton(host);
      expect(button.disabled).toBe(false);
      expect(button.getAttribute('title')).toBeNull();
      act((): void => {
        button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      });
      expect(onOpenOcrSuspects).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
    }
  });

  it('stays disabled when the host wires no opener at all', () => {
    const { host, unmount } = renderPanel({ ocrHasRun: true });
    try {
      expect(suspectsButton(host).disabled).toBe(true);
    } finally {
      unmount();
    }
  });
});
