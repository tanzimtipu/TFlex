/**
 * Phase 35 - Windows OS file-open plumbing (main process, pure helpers).
 *
 * Electron hands a launched app its arguments through `process.argv`:
 *   packaged:  [ "<...>\\TFlex.exe", "C:\\docs\\report.pdf" ]
 *   dev:       [ "<...>\\electron.exe", ".", "C:\\docs\\report.pdf" ]
 * The leading entries are the executable and (in dev) the app directory,
 * so they are never treated as a document path. Chromium / Electron
 * switches (any token starting with "-") are skipped too, so a launch like
 * `TFlex.exe --foo C:\\docs\\report.pdf` still finds the document. The
 * first remaining positional argument is the OS-supplied file.
 *
 * The `second-instance` event carries an argv of the identical shape, so
 * the same parser handles both the initial launch and a second launch.
 */

/** Index of the first document argument once packaged (after the exe). */
const PACKAGED_ARG_START = 1;
/** Index of the first document argument in dev (after electron + app dir). */
const DEV_ARG_START = 2;

/**
 * Return the first positional (non-switch) argument the OS passed, or null
 * when the launch carries no file argument. The caller decides whether a
 * non-PDF path is a loud error (see `looksLikePdfPath`).
 */
export function extractFileArgument(
  argv: readonly string[],
  isPackaged: boolean,
): string | null {
  const start = isPackaged ? PACKAGED_ARG_START : DEV_ARG_START;
  for (let i = start; i < argv.length; i += 1) {
    const arg = argv[i];
    if (typeof arg !== 'string' || arg.length === 0) continue;
    if (arg.startsWith('-')) continue;
    return arg;
  }
  return null;
}

/** True when the argument names a PDF file (case-insensitive extension). */
export function looksLikePdfPath(path: string): boolean {
  return /\.pdf$/i.test(path.trim());
}