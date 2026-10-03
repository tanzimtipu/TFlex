// @vitest-environment jsdom
// ADV TFL-442 probe — Phase 87 BlankPagesDialog checked-set pruning.
//
// Question: when the user LOWERS the ink threshold after a scan so a
// previously-candidate page is no longer a candidate (and therefore no longer
// rendered in the candidate list), does confirming still remove that hidden
// page?
//
// The dialog is mounted with measurements, then re-rendered with a lower
// threshold prop (as App does when the threshold setting changes) WITHOUT a
// new measurements array. The candidate row disappears; we then click the
// confirm button and record what the dialog hands the host.

import { describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import {
  BlankPagesDialog,
  type BlankPagesDialogProps,
} from '../../src/renderer/components/BlankPagesDialog';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(overrides: Partial<BlankPagesDialogProps>): {
  host: HTMLElement;
  rerender: (next: Partial<BlankPagesDialogProps>) => void;
  onConfirm: ReturnType<typeof vi.fn>;
  unmount: () => void;
} {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const onConfirm = vi.fn((): void => undefined);
  const base: BlankPagesDialogProps = {
    open: true,
    totalPages: 4,
    threshold: 0.005,
    running: false,
    progress: 0,
    measurements: null,
    report: null,
    onThresholdChange: (): void => undefined,
    onRun: (): void => undefined,
    onConfirm,
    onClose: (): void => undefined,
    ...overrides,
  };
  let current = base;
  act((): void => {
    root.render(<BlankPagesDialog {...current} />);
  });
  return {
    host,
    rerender: (next: Partial<BlankPagesDialogProps>): void => {
      current = { ...current, ...next };
      act((): void => {
        root.render(<BlankPagesDialog {...current} />);
      });
    },
    onConfirm,
    unmount: (): void => {
      act((): void => {
        root.unmount();
      });
      host.remove();
    },
  };
}

describe('ADV TFL-442 — threshold lowered after scan', () => {
  it('removes a page that is no longer shown as a candidate', () => {
    const { host, rerender, onConfirm, unmount } = mount({
      threshold: 0.005,
      measurements: [
        { page: 1, coverage: 0.004 },
        { page: 2, coverage: 0.5 },
      ],
    });

    // Default scan: page 1 is the only candidate, pre-checked.
    expect(host.querySelectorAll('[data-blank-candidate]').length).toBe(1);
    const confirm = (): HTMLButtonElement | null =>
      host.querySelector<HTMLButtonElement>('[data-blank-scan-confirm]');
    expect(confirm()?.disabled).toBe(false);
    expect(confirm()?.textContent).toContain('1');

    // User lowers the threshold below page 1's measured coverage. App
    // re-renders with the new threshold; measurements are unchanged.
    rerender({ threshold: 0.001 });

    // Page 1 is no longer a candidate and is NOT rendered in the list...
    expect(host.querySelectorAll('[data-blank-candidate]').length).toBe(0);
    // ...the report even says there are no blank pages...
    expect(host.querySelector('[data-blank-scan-report]')?.textContent).toContain(
      'No blank pages',
    );
    // ...yet the confirm button still claims one page is selected and is enabled.
    console.log('confirm text after lowering threshold:', confirm()?.textContent);
    console.log('confirm disabled after lowering threshold:', confirm()?.disabled);
    expect(confirm()?.disabled).toBe(false);

    act((): void => {
      confirm()?.click();
    });

    console.log('onConfirm payload:', JSON.stringify(onConfirm.mock.calls));
    // The host will delete page 1, which the user can no longer see selected.
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0]?.[0]).toEqual([1]);
    unmount();
  });
});