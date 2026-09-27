/**
 * Phase 44 - accounts configuration accessor (main process only).
 *
 * The single place that resolves the Neon Auth base URL and the Data API
 * URL. URLs are NEVER hardcoded here: the conventions gate forbids URL
 * literals in product code, and the endpoints are operator configuration.
 *
 * Resolution order, per field:
 *   1. The environment variable (`TFLEX_AUTH_BASE_URL` / `TFLEX_DATA_API_URL`)
 *      - an operator/CI override that works without a rebuild.
 *   2. The `tflex` block in the app's `package.json`, read from `appRoot`
 *      (the caller passes `app.getAppPath()`). package.json is shipped inside
 *      the asar, so this is the path that works in a PACKAGED build.
 *
 * A field with neither source yields `null`; callers treat a null config as
 * "accounts transport not configured" and must not attempt a network call.
 * This accessor itself performs no network I/O.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface AccountsConfig {
  authBaseUrl: string | null;
  dataApiUrl: string | null;
  /** Phase 44 chunk 5 - the Neon Function base URL (the signature image
   *  storage API). Null when not configured. */
  functionApiUrl: string | null;
}

interface TflexBlock {
  neonAuthBaseUrl?: unknown;
  neonDataApiUrl?: unknown;
  neonFunctionApiUrl?: unknown;
}

/**
 * Read the configured accounts endpoints. Pure and cheap, safe to call on
 * demand. `appRoot` is optional: when omitted only the environment is
 * consulted (this keeps the accessor testable without a package.json).
 */
export function getAccountsConfig(
  env: NodeJS.ProcessEnv = process.env,
  appRoot?: string,
): AccountsConfig {
  const pkg = appRoot === undefined ? null : readTflexBlock(appRoot);
  return {
    authBaseUrl: readEnv(env.TFLEX_AUTH_BASE_URL) ?? readString(pkg?.neonAuthBaseUrl),
    dataApiUrl: readEnv(env.TFLEX_DATA_API_URL) ?? readString(pkg?.neonDataApiUrl),
    functionApiUrl: readEnv(env.TFLEX_FUNCTION_API_URL) ?? readString(pkg?.neonFunctionApiUrl),
  };
}

/** Read the `tflex` block from `<appRoot>/package.json`. Returns null when
 *  the file is missing, unreadable, not JSON, or has no block. Never throws:
 *  a broken package.json must not take the app down. */
function readTflexBlock(appRoot: string): TflexBlock | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(appRoot, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') return null;
  const block = (parsed as Record<string, unknown>).tflex;
  if (block === null || typeof block !== 'object') return null;
  return block as TflexBlock;
}

function readEnv(value: string | undefined): string | null {
  return readString(value);
}

function readString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
