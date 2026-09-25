// Phase 40 (post-gate) — the Save shortcut's clean-document rule.
//
// The toolbar's Save control is DISABLED on a clean document, but the native
// Ctrl+S accelerator still delivered `save`, and App's `onSave` called
// `engine.save` unconditionally. On a clean single-file document that REWROTE
// the file (the SHA changed) even though the UI said Save was disabled — the UI
// and the accelerator disagreed. The accelerator is declared in the main
// process (src/main/menu.ts) but it only sends the `save` action; the handler
// that performs the write is renderer-side (`App.onSave`), so the no-op belongs
// here. This pure rule keeps that decision unit-testable.

export type SaveIntent = 'readonly' | 'clean' | 'save';

/**
 * Resolve what the Save shortcut / toolbar control should do for one document:
 *   - `readonly` — no on-disk origin (an unsaved generated doc): Save cannot
 *     write in place; the caller shows the "Use Save As" hint.
 *   - `clean` — the document has an on-disk origin but no unsaved changes:
 *     a silent no-op, exactly mirroring the disabled toolbar Save.
 *   - `save` — there is something to persist.
 */
export function saveIntentFor(args: {
  onDiskPath: string | null;
  modified: boolean;
}): SaveIntent {
  if (args.onDiskPath === null) return 'readonly';
  return args.modified ? 'save' : 'clean';
}
