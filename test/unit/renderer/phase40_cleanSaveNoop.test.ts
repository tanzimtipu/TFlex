// Phase 40 post-gate — the Ctrl+S clean-document no-op.
//
// The toolbar Save is DISABLED on a clean document, but Ctrl+S (a main-process
// accelerator that sends the `save` action to the renderer) reached App's
// `onSave`, which called `engine.save` unconditionally and rewrote the file
// (the SHA changed). The accelerator only delivers the action; the write is
// renderer-side, so the fix is the renderer's `saveIntentFor` rule. These tests
// pin that rule: a clean on-disk document is a silent no-op.

import { describe, expect, it } from 'vitest';
import { saveIntentFor } from '../../../src/renderer/state/saveGuard';

describe('Phase 40 — Ctrl+S is a no-op on a clean document', () => {
  it('a clean on-disk document resolves to a silent no-op', () => {
    expect(saveIntentFor({ onDiskPath: 'C:/docs/report.pdf', modified: false })).toBe('clean');
  });

  it('a modified on-disk document still saves', () => {
    expect(saveIntentFor({ onDiskPath: 'C:/docs/report.pdf', modified: true })).toBe('save');
  });

  it('an unsaved generated document stays the read-only Save-As hint', () => {
    expect(saveIntentFor({ onDiskPath: null, modified: false })).toBe('readonly');
    expect(saveIntentFor({ onDiskPath: null, modified: true })).toBe('readonly');
  });
});
