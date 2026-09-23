// Phase 36 (chunk 2) — temporary dev-mount flags.
//
// Chunk 2 builds the PAGES ContextPanel ALONGSIDE the existing SideRail so
// the two surfaces can be compared before the rail is retired (criterion 3).
// Mounting it must not disturb the default UX, so it is gated on an explicit
// dev flag that no shipped surface sets:
//
//   `?tfStagePanel=1`   the renderer's URL query string
//   `tfStagePanel` = "1"  in localStorage (same key)
//
// The localStorage half exists because the packaged/e2e renderer is loaded
// from a `file://` URL the spec cannot decorate: a spec enables the flag with
// `win.evaluate(() => localStorage.setItem('tfStagePanel', '1'))` + a reload,
// then removes it. Both sources are read by the pure `readStagePanelDevFlag`
// below, so the resolution order is unit-testable without a DOM.
//
// The flag is read ONCE per DocumentView mount. It is dev-only scaffolding
// and is deleted with the flag when the rail retires.

/** The dev flag's name in the query string AND in localStorage. */
export const STAGE_PANEL_DEV_KEY = 'tfStagePanel';

/** A dev-flag string value meaning "on": '1' or 'true'. Anything else (and
 *  absence) is off — a bare `?tfStagePanel` reads as ''. */
export function isDevFlagOn(value: string | null | undefined): boolean {
  return value === '1' || value === 'true';
}

/** Resolve the PAGES-panel dev flag from its two sources. localStorage wins
 *  (it is the one an e2e spec can always set); the query string is the
 *  human-facing switch. */
export function readStagePanelDevFlag(env: {
  search?: string;
  stored?: string | null;
}): boolean {
  if (isDevFlagOn(env.stored)) return true;
  if (env.search === undefined || env.search === '') return false;
  return isDevFlagOn(new URLSearchParams(env.search).get(STAGE_PANEL_DEV_KEY));
}

/** Read the flag off the live window. Storage access can throw (disabled
 *  storage, opaque origin), which must read as "off", never as a crash. */
export function currentStagePanelDevFlag(): boolean {
  if (typeof window === 'undefined') return false;
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(STAGE_PANEL_DEV_KEY);
  } catch {
    stored = null;
  }
  return readStagePanelDevFlag({ search: window.location.search, stored });
}
