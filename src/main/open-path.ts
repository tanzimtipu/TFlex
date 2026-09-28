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

import { extname } from 'node:path';
import { createDefaultRegistry } from './services/convert/registry';

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

/**
 * Phase 53 - the extension set the OS open flow must route: `pdf` plus every
 * extension the SHIPPED conversion registry can import. Derived from the
 * registry (the single source of truth) once at module load; never a second
 * hardcoded list, so a newly registered adapter is routed automatically.
 */
const OPENABLE_EXTENSIONS: ReadonlySet<string> = (() => {
  const set = new Set<string>(['.pdf']);
  for (const registration of createDefaultRegistry().listRegistrations()) {
    for (const extension of registration.extensions) {
      set.add(extension.toLowerCase());
    }
  }
  return set;
})();

/**
 * True for a path the OS open flow hands to the renderer: a PDF (validated as
 * before) or a convertible document (the renderer's conversion flow takes it).
 * A genuinely unsupported path stays false so the caller fails LOUD.
 */
export function looksLikeOpenablePath(path: string): boolean {
  const ext = extname(path.trim()).toLowerCase();
  return ext.length > 1 && OPENABLE_EXTENSIONS.has(ext);
}