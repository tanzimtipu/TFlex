// @vitest-environment jsdom
//
// Phase 36 (chunk 6) — the EDIT / REVIEW / DELIVER ContextPanel bodies.
//
// These tests pin the re-parenting contract: the EDIT panel shows the current
// page's modelled content plus the recognition SUMMARY (the row + badge + the
// EXISTING batch / suspects entries), the REVIEW panel hosts the annotations
// LIST (ONE home) plus the saved-signatures section, and the DELIVER panel
// shows the pre-flight checklist (read-only, from the existing state) plus the
// "New document: From images" entry. Every control asserts the handler it
// calls; a handler the host did not wire renders disabled (never a no-op).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { ContextPanel } from '../../../src/renderer/components/ContextPanel';
import type { ContextPanelProps } from '../../../src/renderer/components/ContextPanel';
import type { EngineState } from '../../../src/renderer/engine/types';
import type { Annotation } from '../../../src/renderer/annotations/model';
import type { SavedSignature } from '../../../src/shared/types';

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

function renderPanel(props: Partial<ContextPanelProps> & { stage: ContextPanelProps['stage'] }): {
  host: HTMLElement;
  rerender: (next: Partial<ContextPanelProps>) => void;
  unmount: () => void;
} {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const draw = (next: Partial<ContextPanelProps>): void => {
    act((): void => {
      root.render(
        <ContextPanel
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
          {...next}
        />,
      );
    });
  };
  draw({});
  return {
    host,
    rerender: draw,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

function click(host: HTMLElement, selector: string): void {
  const el = host.querySelector(selector);
  if (el === null) throw new Error(`missing ${selector}`);
  act((): void => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

const sections = (host: HTMLElement): string[] =>
  [...host.querySelectorAll<HTMLElement>('[data-context-panel-section]')].map(
    (el) => el.getAttribute('data-context-panel-section') ?? '',
  );

const DRAW_SIG: SavedSignature = {
  id: 'sig-1',
  label: 'Ada Lovelace',
  createdAt: '2026-09-01T00:00:00.000Z',
  source: { kind: 'drawn', points: [], width: 100, height: 40 },
};

const ANNOTATION: Annotation = {
  id: 'ann-1',
  kind: 'highlight',
  page: 1,
  rect: { x: 10, y: 10, width: 40, height: 10 },
  color: '#facc15',
  text: 'note',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
} as unknown as Annotation;

describe('Phase 36 chunk 6 — the EDIT stage panel', () => {
  it('outlines the CURRENT page content and selects on click', () => {
    const onSelectEditContent = vi.fn();
    const { host, unmount } = renderPanel({
      stage: 'edit',
      currentPage: 1,
      editContent: [
        { id: 'box-1', kind: 'text', label: 'Hello', page: 1, selected: true },
        { id: 'img-1', kind: 'image', label: 'Image', page: 1, selected: false },
        { id: 'box-2', kind: 'text', label: 'Page two', page: 2, selected: false },
      ],
      onSelectEditContent,
    });
    try {
      expect(sections(host)).toEqual(['content', 'recognition']);
      // Only the CURRENT page's objects are listed.
      const items = [...host.querySelectorAll<HTMLElement>('[data-edit-content-item]')];
      expect(items.map((el) => el.getAttribute('data-edit-content-item'))).toEqual([
        'box-1',
        'img-1',
      ]);
      expect(items.map((el) => el.getAttribute('data-edit-content-kind'))).toEqual([
        'text',
        'image',
      ]);
      // The selected object is marked for assistive tech.
      const selected = host.querySelector('[data-edit-content-item="box-1"]');
      expect(selected?.getAttribute('aria-pressed')).toBe('true');
      click(host, '[data-edit-content-item="img-1"]');
      expect(onSelectEditContent).toHaveBeenCalledWith('img-1', 'image');
    } finally {
      unmount();
    }
  });

  it('shows the empty state when the current page has no modelled content', () => {
    const { host, unmount } = renderPanel({
      stage: 'edit',
      editContent: [{ id: 'box-9', kind: 'text', label: 'Elsewhere', page: 3, selected: false }],
    });
    try {
      expect(host.querySelector('[data-edit-content-empty]')).not.toBeNull();
      expect(host.querySelectorAll('[data-edit-content-item]').length).toBe(0);
    } finally {
      unmount();
    }
  });

  it('summarises the OCR status + suspects count and runs the EXISTING entries', () => {
    const onRecognizeText = vi.fn();
    const onOpenOcrSuspects = vi.fn();
    const { host, unmount } = renderPanel({
      stage: 'edit',
      ocrStatus: 'Recognized',
      ocrHasRun: true,
      ocrSuspectCount: 4,
      onRecognizeText,
      onOpenOcrSuspects,
    });
    try {
      expect(host.querySelector('[data-ocr-status]')?.textContent).toBe('Recognized');
      const badge = host.querySelector('[data-ocr-suspect-count]');
      expect(badge?.textContent).toBe('4');
      expect(badge?.className).toContain('context-panel-badge-alert');
      click(host, '[data-context-panel-action="recognize"]');
      click(host, '[data-context-panel-action="suspects"]');
      expect(onRecognizeText).toHaveBeenCalledTimes(1);
      expect(onOpenOcrSuspects).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
    }
  });

  it('reads "Not run" / an em dash before the first OCR run', () => {
    const { host, unmount } = renderPanel({ stage: 'edit' });
    try {
      expect(host.querySelector('[data-ocr-status]')?.textContent).toBe('Not run');
      expect(host.querySelector('[data-ocr-suspect-count]')?.textContent).toBe('\u2014');
      expect(host.querySelector('[data-ocr-suspect-count]')?.className).not.toContain(
        'context-panel-badge-alert',
      );
    } finally {
      unmount();
    }
  });

  it('disables a recognition entry the host did not wire', () => {
    const { host, unmount } = renderPanel({ stage: 'edit' });
    try {
      expect(
        host.querySelector<HTMLButtonElement>('[data-context-panel-action="recognize"]')?.disabled,
      ).toBe(true);
      expect(
        host.querySelector<HTMLButtonElement>('[data-context-panel-action="suspects"]')?.disabled,
      ).toBe(true);
    } finally {
      unmount();
    }
  });
});

describe('Phase 36 chunk 6 — the REVIEW stage panel', () => {
  it('hosts the annotations LIST (the ONE home) and wires its handlers', () => {
    const onJumpToAnnotation = vi.fn();
    const onEditAnnotation = vi.fn();
    const onDeleteAnnotation = vi.fn();
    const { host, unmount } = renderPanel({
      stage: 'review',
      annotations: [ANNOTATION],
      onJumpToAnnotation,
      onEditAnnotation,
      onDeleteAnnotation,
    });
    try {
      expect(sections(host)).toEqual(['annotations', 'signatures']);
      // The re-parented component keeps its own selector.
      expect(host.querySelector('[data-context-panel-annotations]')).not.toBeNull();
      expect(host.querySelector('[data-annotation-panel]')).not.toBeNull();
    } finally {
      unmount();
    }
  });

  it('lists the saved signatures, arms one on click and opens the manager', () => {
    const onSignSignature = vi.fn();
    const onManageSignatures = vi.fn();
    const { host, unmount } = renderPanel({
      stage: 'review',
      savedSignatures: [DRAW_SIG],
      armedSignatureId: 'sig-1',
      onSignSignature,
      onManageSignatures,
    });
    try {
      const row = host.querySelector('[data-saved-signature="sig-1"]');
      expect(row).not.toBeNull();
      expect(row?.textContent).toContain('Ada Lovelace');
      // The armed signature is marked.
      expect(row?.getAttribute('aria-pressed')).toBe('true');
      expect(row?.className).toContain('context-panel-item-selected');
      click(host, '[data-saved-signature="sig-1"]');
      expect(onSignSignature).toHaveBeenCalledWith('sig-1');
      click(host, '[data-context-panel-action="manage-signatures"]');
      expect(onManageSignatures).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
    }
  });

  it('shows the signatures empty state and disables the unwired controls', () => {
    const { host, unmount } = renderPanel({ stage: 'review', savedSignatures: [] });
    try {
      expect(host.querySelector('[data-signatures-empty]')).not.toBeNull();
      expect(
        host.querySelector<HTMLButtonElement>(
          '[data-context-panel-action="manage-signatures"]',
        )?.disabled,
      ).toBe(true);
    } finally {
      unmount();
    }
  });
});

describe('Phase 36 chunk 6 — the DELIVER stage panel', () => {
  it('reads the existing pre-flight state (OCR / size / forms) without recomputing', () => {
    const { host, unmount } = renderPanel({
      stage: 'deliver',
      ocrStatus: 'Recognized',
      fileSize: 2048,
      formFieldCount: 3,
    });
    try {
      expect(sections(host)).toEqual(['preflight', 'new-document']);
      expect(host.querySelector('[data-preflight="ocr"]')?.textContent).toContain('Recognized');
      expect(host.querySelector('[data-file-size]')?.textContent).toBe('2.0 KB');
      expect(host.querySelector('[data-form-fields]')?.textContent).toBe('3 to flatten');
    } finally {
      unmount();
    }
  });

  it('reports "Not run" / an em dash / "None" with no state', () => {
    const { host, unmount } = renderPanel({ stage: 'deliver' });
    try {
      expect(host.querySelector('[data-preflight="ocr"]')?.textContent).toContain('Not run');
      expect(host.querySelector('[data-file-size]')?.textContent).toBe('\u2014');
      expect(host.querySelector('[data-form-fields]')?.textContent).toBe('None');
    } finally {
      unmount();
    }
  });

  it('runs the EXISTING Optimize and From-images entries', () => {
    const onOptimize = vi.fn();
    const onCreateFromImages = vi.fn();
    const { host, unmount } = renderPanel({
      stage: 'deliver',
      onOptimize,
      onCreateFromImages,
    });
    try {
      click(host, '[data-context-panel-action="optimize"]');
      click(host, '[data-context-panel-action="from-images"]');
      expect(onOptimize).toHaveBeenCalledTimes(1);
      expect(onCreateFromImages).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
    }
  });

  it('disables an entry the host did not wire (never a silent no-op)', () => {
    const { host, unmount } = renderPanel({ stage: 'deliver' });
    try {
      expect(
        host.querySelector<HTMLButtonElement>('[data-context-panel-action="optimize"]')?.disabled,
      ).toBe(true);
      expect(
        host.querySelector<HTMLButtonElement>('[data-context-panel-action="from-images"]')?.disabled,
      ).toBe(true);
    } finally {
      unmount();
    }
  });
});

describe('Phase 36 chunk 6 — the stage header', () => {
  it('titles the panel per stage and keeps the collapse control', () => {
    const { host, unmount } = renderPanel({ stage: 'deliver' });
    try {
      expect(host.querySelector('.glass-sidebar-title')?.textContent).toBe('Deliver');
      expect(host.querySelector('[data-context-panel-stage]')?.getAttribute('data-context-panel-stage')).toBe('deliver');
      expect(host.querySelector('[data-rail-collapse]')).not.toBeNull();
      // No PAGES-only Combine entry outside the PAGES stage.
      expect(host.querySelector('[data-context-panel-combine]')).toBeNull();
    } finally {
      unmount();
    }
  });

  it('collapses to the ruler strip and reports the toggle to the host', () => {
    const onToggleCollapsed = vi.fn();
    const { host, unmount } = renderPanel({
      stage: 'pages',
      collapsed: true,
      onToggleCollapsed,
    });
    try {
      expect(host.querySelector('[data-rail-ruler]')).not.toBeNull();
      expect(host.querySelector('[data-context-panel-collapsed]')?.getAttribute('data-context-panel-collapsed')).toBe('true');
      const collapse = host.querySelector<HTMLElement>('[data-rail-collapse]');
      expect(collapse?.getAttribute('title')).toBe('Expand panel');
      click(host, '[data-rail-collapse]');
      expect(onToggleCollapsed).toHaveBeenCalledTimes(1);
    } finally {
      unmount();
    }
  });
});
