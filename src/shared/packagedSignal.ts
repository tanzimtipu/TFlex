/**
 * TFL-1148 - packaged-vs-dev runtime signal.
 *
 * The renderer needs to know whether it is running inside a PACKAGED build or
 * an unpackaged run (Playwright e2e harness, `npm run dev`, `electron .`), and
 * it needs the answer synchronously so its sample-fixture gate can stay a plain
 * read. Main's `app.isPackaged` is the single source of truth; main encodes it
 * into the preload-visible environment variable below before the first window
 * is constructed, and the sandboxed preload decodes it into a plain boolean on
 * the `window.tflex.app` bridge.
 *
 * Kept as pure functions so the encode/decode pair is unit-testable without
 * booting Electron.
 */

/** Environment variable main writes and the sandboxed preload reads. */
export const TFLEX_PACKAGED_ENV = 'TFLEX_PACKAGED';

/** Encode main's `app.isPackaged` into the environment carrier value. */
export function encodePackagedFlag(isPackaged: boolean): string {
  return isPackaged ? '1' : '0';
}

/** Decode the carrier value; anything but the packed marker means development. */
export function parsePackagedFlag(value: string | undefined): boolean {
  return value === '1';
}
