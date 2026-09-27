/**
 * Phase 44 - Neon Data API transport (main process only).
 *
 * The ONLY module that speaks HTTP. It uses the declared `@neondatabase/neon-js`
 * SDK (which wraps `@supabase/postgrest-js`); importing only
 * `NeonPostgrestClient` + `fetchWithToken` keeps the main bundle small (the
 * auth half of the SDK tree-shakes out). The SDK's fetch wrapper injects
 * `Authorization: Bearer <jwt>` lazily from the vault on every request, so no
 * token is ever held in this module.
 *
 * Endpoints come from `getAccountsConfig` - there is no URL literal here.
 * The client never sends a user id: RLS (`auth.user_id() = user_id`) is the
 * per-row boundary, and the DB default fills `user_id` on insert.
 */

import { NeonPostgrestClient, fetchWithToken } from '@neondatabase/neon-js';
import { SIGNATURE_IMAGE_MAX_BYTES } from '../../../shared/accounts';
import {
  SyncTransportError,
  type SettingsCloudRow,
  type SettingsPushRow,
  type SignatureCloudRow,
  type SignaturePushRow,
  type SyncErrorKind,
  type SyncTransport,
} from './sync';

const SETTINGS_COLUMNS = 'settings,revision,device_id,updated_at';
const SIGNATURE_COLUMNS =
  'id,label,kind,payload,storage_key,sort_order,deleted_at,updated_at';

export interface PostgrestTransportOptions {
  dataApiUrl: string;
  /** Phase 44 chunk 5 - the Neon Function base URL. Null disables image
   *  byte transfer (metadata still syncs) and is reported as a server error
   *  only if an image actually needs moving. */
  functionApiUrl: string | null;
  getToken: () => Promise<string | null>;
  /** Low-level fetch override for tests. Never a URL source; production
   *  leaves it undefined and the platform fetch is used. */
  fetchImpl?: typeof globalThis.fetch;
}

export class PostgrestSyncTransport implements SyncTransport {
  private readonly client: NeonPostgrestClient;
  /** SDK wrapper that injects `Authorization: Bearer <jwt>` lazily from the
   *  vault on every request; no token is ever held in this module. */
  private readonly send: ReturnType<typeof fetchWithToken>;
  /** Bare fetch for the presigned object URL - the JWT must not be attached
   *  to it (the URL carries its own signature). */
  private readonly plainFetch: typeof globalThis.fetch;
  private readonly functionBase: string | null;

  constructor(options: PostgrestTransportOptions) {
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const send = fetchWithToken(options.getToken, fetchImpl);
    this.send = send;
    this.plainFetch = fetchImpl;
    this.functionBase =
      options.functionApiUrl === null ? null : options.functionApiUrl.replace(/\/+$/, '');
    this.client = new NeonPostgrestClient({
      dataApiUrl: options.dataApiUrl,
      options: { global: { fetch: send } },
    });
  }

  async fetchSettingsRow(): Promise<SettingsCloudRow | null> {
    const { data, error } = await this.client
      .from('user_settings')
      .select(SETTINGS_COLUMNS)
      .maybeSingle();
    if (error !== null) throw toTransportError(error);
    return (data as SettingsCloudRow | null) ?? null;
  }

  async upsertSettingsRow(row: SettingsPushRow): Promise<SettingsCloudRow> {
    const { data, error } = await this.client
      .from('user_settings')
      .upsert(row, { onConflict: 'user_id' })
      .select(SETTINGS_COLUMNS)
      .maybeSingle();
    if (error !== null) throw toTransportError(error);
    if (data === null) throw new SyncTransportError('server', 'settings upsert returned no row');
    return data as SettingsCloudRow;
  }

  async fetchSignatureRows(): Promise<SignatureCloudRow[]> {
    const { data, error } = await this.client
      .from('user_signatures')
      .select(SIGNATURE_COLUMNS);
    if (error !== null) throw toTransportError(error);
    return (data as SignatureCloudRow[] | null) ?? [];
  }

  async upsertSignatureRows(rows: SignaturePushRow[]): Promise<void> {
    if (rows.length === 0) return;
    const { error } = await this.client
      .from('user_signatures')
      .upsert(rows, { onConflict: 'id' });
    if (error !== null) throw toTransportError(error);
  }

  async softDeleteSignature(id: string, deletedAt: string): Promise<void> {
    const { error } = await this.client
      .from('user_signatures')
      .update({ deleted_at: deletedAt })
      .eq('id', id);
    if (error !== null) throw toTransportError(error);
  }

  // -----------------------------------------------------------------------
  // Phase 44 chunk 5 - signature image bytes through the Neon Function.
  // The Function verifies the JWT itself and prefixes every key with the
  // VERIFIED user id, so the app can never address another user's object.
  // The AWS credentials stay server-side; this client only ever sends its
  // user JWT.
  // -----------------------------------------------------------------------

  async uploadSignatureImage(bytes: Uint8Array): Promise<string> {
    const base = this.requireFunctionBase();
    try {
      const response = await this.send(`${base}/signatures`, {
        method: 'POST',
        headers: { 'content-type': 'image/png' },
        // A Uint8Array is a valid fetch body at runtime; the cast bridges the
        // DOM `BodyInit` type's ArrayBufferLike generic mismatch.
        body: bytes as BodyInit,
      });
      if (!response.ok) throw await imageError(response, 'upload');
      const body = (await response.json()) as { key?: unknown };
      if (typeof body.key !== 'string' || body.key.length === 0) {
        throw new SyncTransportError('server', 'signature upload returned no key');
      }
      return body.key;
    } catch (error) {
      throw toTransportError(error);
    }
  }

  async downloadSignatureImage(storageKey: string): Promise<Uint8Array> {
    const base = this.requireFunctionBase();
    try {
      const response = await this.send(
        `${base}/signatures/${encodeURIComponent(storageKey)}`,
        { method: 'GET' },
      );
      if (!response.ok) throw await imageError(response, 'download');
      const body = (await response.json()) as { url?: unknown };
      if (typeof body.url !== 'string' || body.url.length === 0) {
        throw new SyncTransportError('server', 'signature download returned no url');
      }
      // The presigned URL is scoped to the object and already carries its
      // signature; send it NO Authorization header.
      const objectResponse = await this.plainFetch(body.url);
      if (!objectResponse.ok) {
        throw new SyncTransportError(
          statusKind(objectResponse.status),
          `signature object download failed (${objectResponse.status})`,
        );
      }
      return new Uint8Array(await objectResponse.arrayBuffer());
    } catch (error) {
      throw toTransportError(error);
    }
  }

  private requireFunctionBase(): string {
    if (this.functionBase === null) {
      throw new SyncTransportError('server', 'signature image storage is not configured');
    }
    return this.functionBase;
  }
}

/** Map a Function HTTP status to the `auth`/`server` taxonomy, with a
 *  clear message for the documented failures (401/403/413). */
async function imageError(response: Response, op: string): Promise<SyncTransportError> {
  let detail = '';
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === 'string') detail = body.error;
  } catch {
    // A non-JSON error body simply leaves the status message.
  }
  if (response.status === 413) {
    return new SyncTransportError(
      'server',
      `Signature image is too large. The limit is ${Math.round(
        SIGNATURE_IMAGE_MAX_BYTES / 1024,
      )} KB.`,
    );
  }
  if (response.status === 401 || response.status === 403) {
    return new SyncTransportError('auth', detail || 'not authorized to store signature images');
  }
  return new SyncTransportError('server', detail || `signature ${op} failed (${response.status})`);
}

function statusKind(status: number): SyncErrorKind {
  return status === 401 || status === 403 ? 'auth' : 'server';
}

/** Map a PostgREST error or a thrown network error onto the engine's
 *  offline/server taxonomy. Anything that is not clearly a connectivity
 *  failure is treated as a server error. */
function toTransportError(error: unknown): SyncTransportError {
  if (error instanceof SyncTransportError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new SyncTransportError(classify(error, message), message);
}

function classify(error: unknown, message: string): 'offline' | 'server' {
  if (error instanceof TypeError) return 'offline';
  if (/fetch failed|network|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT|socket hang up/i.test(message)) {
    return 'offline';
  }
  return 'server';
}
