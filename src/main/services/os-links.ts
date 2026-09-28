/**
 * Phase 50 - OS link opening (main process only).
 *
 * Two renderer-triggered OS calls, both returning a typed, never-throwing
 * result so the renderer can branch without a try/catch:
 *
 *  - `accounts:openAuthUrl` - open the provider sign-in URL in the OS DEFAULT
 *    BROWSER. The URL is validated BEFORE it is handed to the OS: `https:` only,
 *    host EXACTLY the configured auth host (derived from the accounts config by
 *    the wiring layer; never a literal). The same decision the auth popup rule
 *    uses (`decideAuthPopup`), so the two can never drift. Any other URL is
 *    refused and never opened.
 *  - `app:openDefaultAppsSettings` - open Windows' Default-apps settings via a
 *    fixed, non-user-supplied URI constant, so the user can make Jovrel the
 *    default PDF handler. Windows does not let an installer set that silently,
 *    and there is no documented, reliable deep link straight to the `.pdf`
 *    association, so the plain Default-apps page is opened.
 *
 * Both functions take the Electron `shell` by injection, so they are unit
 * testable without Electron and can never accidentally call a global.
 */

import type { OpenAuthUrlResult } from '../../shared/accounts';
import type { OpenDefaultAppsSettingsResult } from '../../shared/ipc';
import { decideAuthPopup } from '../window';

/**
 * Windows' Default-apps settings URI. Fixed, never user-supplied, so it needs
 * no validation beyond being this constant. `ms-settings:defaultapps` has no
 * documented, reliable per-file-type (`.pdf`) deep link form; the parameters
 * that exist on Windows 11 (`registeredAppUser` / `registeredAppMachine`)
 * target an APPLICATION's defaults page, not the `.pdf` association page, so
 * the plain page is what is opened.
 */
export const DEFAULT_APPS_SETTINGS_URI = 'ms-settings:defaultapps';

/** The slice of Electron's `shell` this module needs. */
export interface OpenExternalLike {
  openExternal(url: string): Promise<void>;
}

/**
 * True only when `url` is a string, parses, is `https:`, and its hostname is
 * exactly `authHost` (case-insensitive). Delegates to the auth popup decision
 * so there is a single validation rule. Pure; exported for the unit tests.
 */
export function isAllowedAuthUrl(url: unknown, authHost: string | null): boolean {
  if (typeof url !== 'string') return false;
  return decideAuthPopup(url, authHost) === 'allow';
}

/**
 * Open `url` in the OS default browser, or refuse it. Never throws: an
 * invalid URL resolves `{ ok: false, reason: 'invalid-url' }` and is NEVER
 * handed to `shell`; a rejected `openExternal` resolves
 * `{ ok: false, reason: 'failed' }`.
 */
export async function openAuthUrlExternally(
  url: unknown,
  authHost: string | null,
  shell: OpenExternalLike,
): Promise<OpenAuthUrlResult> {
  if (!isAllowedAuthUrl(url, authHost)) {
    return { ok: false, reason: 'invalid-url' };
  }
  try {
    await shell.openExternal(url as string);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}

/**
 * Open Windows' Default-apps settings. Never throws: a rejected
 * `openExternal` resolves `{ ok: false, reason: 'failed' }`.
 */
export async function openDefaultAppsSettings(
  shell: OpenExternalLike,
): Promise<OpenDefaultAppsSettingsResult> {
  try {
    await shell.openExternal(DEFAULT_APPS_SETTINGS_URI);
    return { ok: true };
  } catch {
    return { ok: false, reason: 'failed' };
  }
}
