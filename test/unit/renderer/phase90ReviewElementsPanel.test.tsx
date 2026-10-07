// @vitest-environment jsdom
//
// Phase 90 (TFL-509-C1) — the unified review-element list.
//
// `ReviewElementsPanel` is the ONE renderer for the four review categories
// (Annotations, Bates numbering, Watermarks, Signatures). These tests pin the
// category order and hooks, the annotations re-parenting, the empty states,
// the select / delete dispatch and the row-level fail-loud error slot — then
// assert BOTH panels mount it (Ruling 6).

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { ReviewElementsPanel } from '../../../src/renderer/components/ReviewElementsPanel';
import type {
  ReviewElementRef,
  ReviewElementsPanelProps,
} from '../../../src/renderer/components/ReviewElementsPanel';
import { ContextPanel } from '../../../src/renderer/components/ContextPanel';
import { Inspector } from '../../../src/renderer/components/Inspector';
import type { EngineState } from '../../../src/renderer/engine/types';
import type { Annotation } from '../../../src/renderer/annotations/model';
import type {
  BatesInfo,
  SignaturePlacement,
  WatermarkInfo,
} from '../../../src/shared/types';

const ANNOTATION = {
  id: 'ann-1',
  kind: 'highlight',
  page: 1,
  rect: { x: 10, y: 10, width: 40, height: 10 },
  color: '#facc15',
  text: 'note',
  createdAt: '2026-09-01T00:00:00.000Z',
  updatedAt: '2026-09-01T00:00:00.000Z',
} as unknown as Annotation;

const BATES: BatesInfo = {
  id: 'bates-1',
  prefix: 'ABC',
  suffix: '',
  startNumber: 1,
  padding: 6,
  position: 'bottom-right',
  size: 10,
  pages: [2, 3],
  labels: ['ABC000001', 'ABC000002'],
};

const WATERMARK: WatermarkInfo = {
  id: 'wm-1',
  type: 'text',
  text: 'DRAFT',
  pages: [5],
};

const SIGNATURE: SignaturePlacement = {
  id: 'sig-place-1',
  signatureId: 'saved-1',
  page: 7,
  rect: { x: 0, y: 0, width: 10, height: 10 },
  pngBytes: new Uint8Array(),
};

function mount(node: React.ReactElement): { host: HTMLElement; unmount: () => void } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  act((): void => {
    root.render(node);
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

function renderPanel(
  overrides: Partial<ReviewElementsPanelProps> = {},
): { host: HTMLElement; unmount: () => void } {
  const props: ReviewElementsPanelProps = {
    annotations: [],
    bates: [],
    watermarks: [],
    signatures: [],
    ...overrides,
  };
  return mount(<ReviewElementsPanel {...props} />);
}

const categories = (host: HTMLElement): string[] =>
  [...host.querySelectorAll<HTMLElement>('[data-review-category]')].map(
    (el) => el.getAttribute('data-review-category') ?? '',
  );

function click(host: HTMLElement, selector: string): void {
  const el = host.querySelector(selector);
  if (el === null) throw new Error(`missing ${selector}`);
  act((): void => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

describe('Phase 90 — ReviewElementsPanel categories and rows', () => {
  it('renders all four categories in the fixed order', () => {
    const m = renderPanel({
      annotations: [ANNOTATION],
      bates: [BATES],
      watermarks: [WATERMARK],
      signatures: [SIGNATURE],
    });
    try {
      expect(categories(m.host)).toEqual([
        'annotations',
        'bates',
        'watermarks',
        'signatures',
      ]);
    } finally {
      m.unmount();
    }
  });

  it('re-parents the real AnnotationsPanel in the annotations category', () => {
    const m = renderPanel({ annotations: [ANNOTATION] });
    try {
      const section = m.host.querySelector('[data-review-category="annotations"]');
      expect(section?.querySelector('[data-annotation-panel]')).not.toBeNull();
      expect(section?.querySelector('[data-context-panel-annotations]')).not.toBeNull();
    } finally {
      m.unmount();
    }
  });

  it('gives every bates / watermark / signature row its identity and controls', () => {
    const m = renderPanel({
      bates: [BATES],
      watermarks: [WATERMARK],
      signatures: [SIGNATURE],
    });
    try {
      const rows = [...m.host.querySelectorAll<HTMLElement>('[data-review-element-type]')];
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        expect(row.querySelector('[data-review-element-select]')).not.toBeNull();
        expect(row.querySelector('[data-review-element-delete]')).not.toBeNull();
        const edit = row.querySelector<HTMLButtonElement>('[data-review-element-edit]');
        expect(edit).not.toBeNull();
        // No `onEdit` from the host in C1: edit must be disabled, never an
        // enabled no-op.
        expect(edit?.disabled).toBe(true);
      }
      const batesRow = m.host.querySelector('[data-review-element-type="bates"]');
      expect(batesRow?.getAttribute('data-review-element-id')).toBe('bates-1');
      const wmRow = m.host.querySelector('[data-review-element-type="watermark"]');
      expect(wmRow?.getAttribute('data-review-element-id')).toBe('wm-1');
      const sigRow = m.host.querySelector('[data-review-element-type="signature"]');
      expect(sigRow?.getAttribute('data-review-element-id')).toBe('sig-place-1');
    } finally {
      m.unmount();
    }
  });

  it('renders a readable empty state for each empty non-annotation category', () => {
    const m = renderPanel({ annotations: [ANNOTATION] });
    try {
      expect(m.host.querySelectorAll('[data-review-empty]')).toHaveLength(3);
    } finally {
      m.unmount();
    }
  });

  it('dispatches the row page / id / type on select', () => {
    const onSelect = vi.fn<(el: ReviewElementRef) => void>();
    const m = renderPanel({ bates: [BATES], onSelect });
    try {
      click(m.host, '[data-review-element-type="bates"] [data-review-element-select]');
      expect(onSelect).toHaveBeenCalledTimes(1);
      expect(onSelect.mock.calls[0]?.[0]).toMatchObject({
        type: 'bates',
        id: 'bates-1',
        page: 2,
      });
    } finally {
      m.unmount();
    }
  });

  it('dispatches the row id / type on delete', () => {
    const onDelete = vi.fn<(el: ReviewElementRef) => void>();
    const m = renderPanel({ watermarks: [WATERMARK], onDelete });
    try {
      click(m.host, '[data-review-element-type="watermark"] [data-review-element-delete]');
      expect(onDelete).toHaveBeenCalledTimes(1);
      expect(onDelete.mock.calls[0]?.[0]).toMatchObject({
        type: 'watermark',
        id: 'wm-1',
        page: 5,
      });
    } finally {
      m.unmount();
    }
  });

  it('renders the host-supplied fail-loud error on the row', () => {
    const errorFor = vi.fn(
      (el: ReviewElementRef): string | null =>
        el.id === 'bates-1' ? 'This Bates run was applied by an older version.' : null,
    );
    const m = renderPanel({ bates: [BATES], errorFor });
    try {
      const slot = m.host.querySelector('[data-review-element-type="bates"] [data-review-element-error]');
      expect(slot).not.toBeNull();
      expect(slot?.textContent).toContain('older version');
      expect(m.host.querySelector('[data-review-element-type="watermark"] [data-review-element-error]')).toBeNull();
    } finally {
      m.unmount();
    }
  });
});

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

describe('Phase 90 — Ruling 6: both panels render the unified list', () => {
  it('mounts the panel in the Inspector REVIEW stage with the SELECTION scope only', () => {
    // TFL-1116 C13 (R20) — the Inspector keeps the shared annotations category
    // (the selected-annotation scope) but no longer repeats the document-wide
    // Bates / watermark / signature summaries; those have exactly one
    // authoritative home (the LEFT review navigator).
    const m = mount(
      <Inspector
        stage="review"
        annotations={[ANNOTATION]}
        bates={[BATES]}
        watermarks={[WATERMARK]}
        signatures={[SIGNATURE]}
      />,
    );
    try {
      expect(m.host.querySelector('[data-review-elements]')).not.toBeNull();
      expect(
        m.host.querySelector('[data-review-elements]')?.getAttribute('data-review-elements-scope'),
      ).toBe('selection');
      expect(categories(m.host)).toEqual(['annotations']);
      expect(m.host.querySelectorAll('[data-review-element-type]')).toHaveLength(0);
    } finally {
      m.unmount();
    }
  });

  it('mounts the panel in the ContextPanel REVIEW stage with the full DOCUMENT inventory', () => {
    const m = mount(
      <ContextPanel
        stage="review"
        doc={makeDocStub(3)}
        currentPage={1}
        defaultWidthPt={612}
        defaultHeightPt={792}
        engineState={makeEngineState(3)}
        canUndo={false}
        onUndo={(): void => undefined}
        onJump={(): void => undefined}
        outline={null}
        annotations={[ANNOTATION]}
        bates={[BATES]}
        watermarks={[WATERMARK]}
        signatures={[SIGNATURE]}
      />,
    );
    try {
      expect(m.host.querySelector('[data-review-elements]')).not.toBeNull();
      expect(
        m.host.querySelector('[data-review-elements]')?.getAttribute('data-review-elements-scope'),
      ).toBe('document');
      expect(categories(m.host)).toEqual([
        'annotations',
        'bates',
        'watermarks',
        'signatures',
      ]);
    } finally {
      m.unmount();
    }
  });
});