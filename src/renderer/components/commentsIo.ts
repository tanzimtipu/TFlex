// Phase 12 — Comment export/import (FDF) helpers.
//
// FDF (Forms Data Format) is a PDF-associated text format for
// comment annotations. The engine exposes `exportFdf` (returns
// FDF bytes for the active doc's annotations) and `importFdf`
// (merges FDF comment bytes back into the annotation state). This
// module wraps those two IPC calls with the file-picker glue:
// `saveCommentsToFile` triggers an OS save dialog and writes the
// returned bytes; `loadCommentsFromFile` triggers an OS open
// dialog and reads the file's bytes.
//
// The dialogs themselves live in CommentExportDialog /
// CommentImportDialog — those own the user-visible flow. This
// module is the thin "host adapter" that the dialogs call back
// into so they can stay focused on UI shape.

/** Trigger an OS save dialog and write the supplied FDF bytes to
 *  the chosen file. Returns the saved file path, or null when the
 *  user cancelled. The dialog already validated that `bytes` is
 *  non-empty; this function surfaces IO failures as thrown errors
 *  so the dialog can toast them. */
export interface SaveCommentsResult {
  path: string;
}

/** Trigger an OS open dialog and read the chosen file's bytes.
 *  Returns the bytes + path, or null when the user cancelled. */
export interface LoadCommentsResult {
  bytes: Uint8Array;
  path: string;
}