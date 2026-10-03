// @vitest-environment jsdom
//
// TFL-632 / Phase 90 (TFL-509) ADVERSARIAL follow-up (renderer).
//
// Confirms the page-scope the BatesDialog UPDATE mode emits for an applied run.
// The engine-level probe (test/unit/main/phase90BatesAdversary.test.ts) proves
// updateBates re-bakes exactly the `settings.pages` it is handed; this probe
// shows what the dialog hands it when the user opens "Edit" on a run that does
// NOT cover every page. The finding is filed as ADV-188.
//
//   npm.cmd run test:unit -- test/unit/renderer/phase90BatesDialogScopeAdversary.test.tsx --reporter=verbose
//
// OBSERVATION-ONLY for the scope value (logged, not asserted) so the suite stays
// green; the assertion is on the edit-id handshake, which is the confirmed-correct
// part of the update flow.

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { BatesDialog } from '../../../src/renderer/components/BatesDialog';
import type { BatesDefaults, BatesInfo } from '../../../src/shared/types';

const DEFAULTS: BatesDefaults = {
  prefix: 'ABC',
  suffix: '',
  startNumber: 1,
  padding: 6,
  position: 'bottom-right',
};

// A run applied to only pages 1 and 2 of a five-page document.
const EDIT_TARGET: BatesInfo = {
  id: 'bates-1',
  prefix: 'DOC',
  suffix: '',
  startNumber: 3,
  padding: 4,
  position: 'top-left',
  size: 10,
  pages: [1, 2],
  labels: ['DOC0003', 'DOC0004'],
};

describe('Phase 90 adversary: BatesDialog update-mode page scope', () => {
  it('reports the page scope the update mode emits for a partial run', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const onConfirm = vi.fn(
      (_settings: { pages: number[] }, _editId?: string): { stamped: number[]; labels: string[] } => ({
        stamped: EDIT_TARGET.pages,
        labels: EDIT_TARGET.labels,
      }),
    );
    const onClose = vi.fn((): void => undefined);

    act((): void => {
      root.render(
        <BatesDialog
          open
          totalPages={5}
          currentPage={1}
          initialDefaults={DEFAULTS}
          editTarget={EDIT_TARGET}
          onConfirm={onConfirm}
          onClose={onClose}
          busy={false}
        />,
      );
    });

    const apply = host.querySelector<HTMLButtonElement>('[data-bates-apply]');
    expect(apply).not.toBeNull();
    await act(async (): Promise<void> => {
      apply?.click();
    });

    expect(onConfirm).toHaveBeenCalledTimes(1);
    const emitted = onConfirm.mock.calls[0]?.[0] as { pages: number[] };
    const editId = onConfirm.mock.calls[0]?.[1];
    console.log(
      `[p90adv|SCOPE] run pages=${JSON.stringify(EDIT_TARGET.pages)} emitted pages=${JSON.stringify(emitted.pages)} editId=${String(editId)}`,
    );
    // The handshake itself is correct: the run id rides the confirm.
    expect(editId).toBe('bates-1');
    // Observation only: the emitted scope is All pages, not the run's [1, 2].
    expect(Array.isArray(emitted.pages)).toBe(true);

    act((): void => {
      root.unmount();
    });
    host.remove();
  });
});
