// Phase 9 — picker for image inputs.
//
// The renderer doesn't have `fs` access. To get image bytes off disk
// without a custom IPC handler, we use the standard HTML5
// `<input type="file" accept="image/*" multiple>` pattern: the user
// picks files via the OS file dialog, and we get File objects
// directly. In Electron the File object also carries the local path
// under `webUtils.getPathForFile(file)` (or the legacy `(file as
// { path?: string }).path` shim), which we surface as the dialog's
// "path" key.
//
// Why not the existing `tflex.openFileDialog` IPC? That call returns
// a single path string and is PDF-flavoured; we'd need a parallel
// IPC for image bytes anyway. The input[type=file] approach stays in
// the renderer, doesn't grow the IPC contract, and works the same in
// development and production.
//
// Returns `{ files, paths }`. Either may be empty if the user
// cancelled the picker.
//
// DEF-046 — racy focus fallback. The original implementation listened
// for `window.focus` after the picker closed and resolved the Promise
// with empty arrays 200ms later as a "cancel" fallback. In automated
// environments (and sometimes in production under heavy focus
// transitions) the `focus` event fires on the window BEFORE the
// `change` event on the input, so the picker resolved with no files
// even though the user had picked some. The fix:
//   - Stop trusting the focus event alone. The fallback resolver now
//     runs a "wait then check input.files" poll: 800ms after focus,
//     if `input.files` is still empty the picker resolves empty; if
//     `input.files` has entries (the change event just hadn't been
//     delivered yet) the picker resolves with them.
//   - The change handler still wins race-wise: any change event that
//     arrives before the poll resolves cancels the fallback and
//     resolves immediately with the picked files. The poll is only
//     the safety net.
//   - The 800ms window comfortably exceeds any plausible event-loop
//     delay in production while keeping the cancel path fast for
//     users who dismiss the dialog.

export interface PickedImages {
  files: File[];
  paths: string[];
}

const ACCEPT = "image/png,image/jpeg,image/jpg";
const CANCEL_POLL_MS = 800;

/** Open the OS file picker for image files. Resolves to the user's
 *  selection or an empty object on cancel. The picker is reusable:
 *  every call creates a fresh `<input>` element so re-opening the
 *  dialog with the same picked files doesn't dedupe at the OS
 *  layer (the dialog might pre-select the last pick otherwise). */
export function pickImageFilesInRenderer(): Promise<PickedImages> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ACCEPT;
    input.multiple = true;
    input.style.position = "fixed";
    input.style.top = "-1000px";
    input.style.left = "-1000px";
    input.style.opacity = "0";
    input.style.pointerEvents = "none";
    let resolved = false;
    let cancelTimer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = (): void => {
      if (input.parentNode !== null) {
        input.parentNode.removeChild(input);
      }
      window.removeEventListener("focus", onFocusBack, true);
      if (cancelTimer !== null) {
        clearTimeout(cancelTimer);
        cancelTimer = null;
      }
    };
    const finish = (result: PickedImages): void => {
      if (resolved) return;
      resolved = true;
      cleanup();
      resolve(result);
    };
    const handleFiles = (files: FileList | null | undefined): void => {
      if (files === null || files === undefined || files.length === 0) {
        finish({ files: [], paths: [] });
        return;
      }
      const out: File[] = [];
      const paths: string[] = [];
      // Iterate via numeric index rather than `.item()`. jsdom's
      // FileList implementation doesn't expose `.item()` cleanly,
      // and real browsers accept either — the indexer is the
      // canonical DOM shape.
      for (let i = 0; i < files.length; i += 1) {
        const f = files[i];
        if (f === undefined) continue;
        out.push(f);
        const path = resolveFilePath(f);
        if (path !== null) paths.push(path);
      }
      finish({ files: out, paths });
    };
    input.addEventListener("change", (): void => {
      handleFiles(input.files);
    });
    // The OS picker is modal; when it closes the focus returns to
    // the window. We schedule a poll that, after CANCEL_POLL_MS,
    // checks the input's current files:
    //   - If `input.files` is non-empty by then, the change event
    //     hasn't fired yet (some renderers defer the event), so we
    //     resolve with those files. This is the regression guard
    //     from DEF-046 — without it, a slow change event would have
    //     lost the user's pick.
    //   - If `input.files` is still empty, the user cancelled and
    //     we resolve with no files.
    const onFocusBack = (): void => {
      if (resolved) return;
      if (cancelTimer !== null) return;
      cancelTimer = setTimeout((): void => {
        cancelTimer = null;
        if (resolved) return;
        handleFiles(input.files);
      }, CANCEL_POLL_MS);
    };
    window.addEventListener("focus", onFocusBack, true);
    document.body.appendChild(input);
    input.click();
  });
}

/** Resolve a File object to its local on-disk path when running
 *  under Electron. In a browser this returns null (File objects
 *  there don't carry paths). The renderer's Phase 9 flow runs in
 *  Electron, but tests run in jsdom where the shim returns null —
 *  tests can construct File objects directly and bypass the path. */
function resolveFilePath(file: File): string | null {
  // Electron's renderer exposes the path via `webUtils.getPathForFile`
  // since Electron 30. Older versions expose `file.path` directly;
  // newer ones require the webUtils shim.
  const webUtils = (window as unknown as { webUtils?: { getPathForFile?: (f: File) => string } }).webUtils;
  if (webUtils?.getPathForFile !== undefined) {
    try {
      const p = webUtils.getPathForFile(file);
      if (typeof p === "string" && p.length > 0) return p;
    } catch {
      // fall through to legacy shim
    }
  }
  const legacy = (file as unknown as { path?: unknown }).path;
  if (typeof legacy === "string" && legacy.length > 0) return legacy;
  return null;
}

/** Read a File's bytes as a Uint8Array. Thin wrapper around
 *  `File.arrayBuffer()` for symmetry with the rest of the engine
 *  layer. */
export async function readFileBytes(file: File): Promise<Uint8Array> {
  const buf = await file.arrayBuffer();
  return new Uint8Array(buf);
}
