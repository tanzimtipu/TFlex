// @vitest-environment jsdom
//
// Phase 90 (TFL-509-C2) — the unified review list's EDIT path.
//
// C1 shipped the list with disabled edit controls; C2 wires them: a bates /
// watermark row's edit opens the owning dialog in UPDATE mode seeded from the
// row's record and emits its id so the host calls `engine.updateBates` /
// `engine.updateWatermark`. These tests pin the panel dispatch, the
// ContextPanel / Inspector forwarding, and both dialogs' update mode.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { ReviewElementsPanel } from '../../../src/renderer/components/ReviewElementsPanel';
import type { ReviewElementRef } from '../../../src/renderer/components/ReviewElementsPanel';
import { ContextPanel } from '../../../src/renderer/components/ContextPanel';
import { Inspector } from '../../../src/renderer/components/Inspector';
import { BatesDialog } from '../../../src/renderer/components/BatesDialog';
import { WatermarkDialog } from '../../../src/renderer/components/WatermarkDialog';
import type { EngineState } from '../../../src/renderer/engine/types';
import type {
  BatesDefaults,
  BatesInfo,
  BatesSettings,
  EditFont,
  WatermarkInfo,
  WatermarkSettings,
} from '../../../src/shared/types';

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
  pages: [2, 4],
};

const BATES_DEFAULTS: BatesDefaults = {
  prefix: '',
  suffix: '',
  startNumber: 1,
  padding: 6,
  position: 'bottom-right',
};

const DEFAULT_FONT: EditFont = 'Helvetica';

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

function click(host: HTMLElement, selector: string): void {
  const el = host.querySelector(selector);
  if (el === null) throw new Error(`missing ${selector}`);
  act((): void => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

async function clickAsync(host: HTMLElement, selector: string): Promise<void> {
  const el = host.querySelector<HTMLButtonElement>(selector);
  if (el === null) throw new Error(`missing ${selector}`);
  await act(async (): Promise<void> => {
    el.click();
  });
}

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

describe('Phase 90 C2 — ReviewElementsPanel dispatches edit', () => {
  it('enables the edit control and dispatches the row ref for a bates row', () => {
    const onEdit = vi.fn<(el: ReviewElementRef) => void>();
    const m = mount(
      <ReviewElementsPanel
        annotations={[]}
        bates={[BATES]}
        watermarks={[]}
        signatures={[]}
        onEdit={onEdit}
      />,
    );
    try {
      const edit = m.host.querySelector<HTMLButtonElement>(
        '[data-review-element-type="bates"] [data-review-element-edit]',
      );
      expect(edit).not.toBeNull();
      expect(edit?.disabled).toBe(false);
      click(m.host, '[data-review-element-type="bates"] [data-review-element-edit]');
      expect(onEdit).toHaveBeenCalledTimes(1);
      expect(onEdit.mock.calls[0]?.[0]).toMatchObject({
        type: 'bates',
        id: 'bates-1',
        page: 2,
        label: 'ABC000001 \u2013 ABC000002',
      });
    } finally {
      m.unmount();
    }
  });

  it('dispatches the watermark row ref on edit', () => {
    const onEdit = vi.fn<(el: ReviewElementRef) => void>();
    const m = mount(
      <ReviewElementsPanel
        annotations={[]}
        bates={[]}
        watermarks={[WATERMARK]}
        signatures={[]}
        onEdit={onEdit}
      />,
    );
    try {
      click(m.host, '[data-review-element-type="watermark"] [data-review-element-edit]');
      expect(onEdit).toHaveBeenCalledTimes(1);
      expect(onEdit.mock.calls[0]?.[0]).toMatchObject({
        type: 'watermark',
        id: 'wm-1',
        page: 2,
      });
    } finally {
      m.unmount();
    }
  });
});

describe('Phase 90 C2 — the panels forward onEditReviewElement', () => {
  it('ContextPanel stage="review" forwards the edit handler into the list', () => {
    const onEditReviewElement = vi.fn<(el: ReviewElementRef) => void>();
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
        bates={[BATES]}
        onEditReviewElement={onEditReviewElement}
      />,
    );
    try {
      click(m.host, '[data-review-element-type="bates"] [data-review-element-edit]');
      expect(onEditReviewElement).toHaveBeenCalledTimes(1);
      expect(onEditReviewElement.mock.calls[0]?.[0]).toMatchObject({
        type: 'bates',
        id: 'bates-1',
        page: 2,
      });
    } finally {
      m.unmount();
    }
  });

  it('Inspector stage="review" renders no document-wide rows (R20 one-location)', () => {
    // TFL-1116 C13 (R20) — the Inspector owns the SELECTED annotation scope
    // only; the document-wide Bates / watermark / signature rows (and their edit
    // actions) live in exactly ONE place, the LEFT review navigator, so the
    // Inspector no longer forwards a marks-row edit.
    const onEditReviewElement = vi.fn<(el: ReviewElementRef) => void>();
    const m = mount(
      <Inspector
        stage="review"
        bates={[BATES]}
        onEditReviewElement={onEditReviewElement}
      />,
    );
    try {
      expect(m.host.querySelector('[data-review-element-type="bates"]')).toBeNull();
      expect(m.host.querySelector('[data-review-element-edit]')).toBeNull();
      expect(onEditReviewElement).not.toHaveBeenCalled();
      expect(m.host.querySelector('[data-review-category="annotations"]')).not.toBeNull();
    } finally {
      m.unmount();
    }
  });
});

describe('Phase 90 C2 — BatesDialog update mode', () => {
  it('renders update mode, labels the update, and emits the target id', async () => {
    const onConfirm = vi.fn(
      (
        _settings: BatesSettings,
        _editId?: string,
      ): { stamped: number[]; labels: string[] } => ({
        stamped: [2, 3],
        labels: ['ABC000001', 'ABC000002'],
      }),
    );
    const m = mount(
      <BatesDialog
        open
        totalPages={5}
        currentPage={2}
        initialDefaults={BATES_DEFAULTS}
        defaultFont={DEFAULT_FONT}
        editTarget={BATES}
        onConfirm={onConfirm}
        onClose={(): void => undefined}
      />,
    );
    try {
      expect(m.host.querySelector('[data-bates-mode="update"]')).not.toBeNull();
      const apply = m.host.querySelector<HTMLButtonElement>('[data-bates-apply]');
      expect(apply?.textContent).toContain('Update numbering');
      await clickAsync(m.host, '[data-bates-apply]');
      expect(onConfirm).toHaveBeenCalledTimes(1);
      const settings = onConfirm.mock.calls[0]?.[0] as BatesSettings;
      expect(settings.prefix).toBe('ABC');
      expect(settings.suffix).toBe('');
      expect(settings.startNumber).toBe(1);
      expect(settings.padding).toBe(6);
      expect(settings.position).toBe('bottom-right');
      expect(onConfirm.mock.calls[0]?.[1]).toBe('bates-1');
    } finally {
      m.unmount();
    }
  });
});

describe('Phase 90 C2 — WatermarkDialog update mode', () => {
  it('renders update mode, seeds the page scope, and emits the target id', async () => {
    const onConfirm = vi.fn<(s: WatermarkSettings, editId?: string) => void>();
    const m = mount(
      <WatermarkDialog
        open
        totalPages={5}
        currentPage={1}
        editTarget={WATERMARK}
        onConfirm={onConfirm}
        onClose={(): void => undefined}
        watermarks={[]}
        onDeleteWatermark={(): void => undefined}
      />,
    );
    try {
      expect(m.host.querySelector('[data-watermark-mode="update"]')).not.toBeNull();
      const confirm = m.host.querySelector<HTMLButtonElement>('[data-watermark-confirm]');
      expect(confirm?.textContent).toContain('Update watermark');

      const rangeAll = m.host.querySelector<HTMLInputElement>('[data-watermark-range-all]');
      expect(rangeAll?.checked).toBe(false);
      expect(m.host.querySelector<HTMLInputElement>('[data-watermark-range-from]')?.value).toBe('2');
      expect(m.host.querySelector<HTMLInputElement>('[data-watermark-range-to]')?.value).toBe('4');

      await clickAsync(m.host, '[data-watermark-confirm]');
      expect(onConfirm).toHaveBeenCalledTimes(1);
      const settings = onConfirm.mock.calls[0]?.[0] as WatermarkSettings;
      expect(settings.text).toBe('DRAFT');
      expect(settings.range).toEqual([2, 4]);
      expect(onConfirm.mock.calls[0]?.[1]).toBe('wm-1');
    } finally {
      m.unmount();
    }
  });
});

