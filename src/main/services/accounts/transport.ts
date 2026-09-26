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
import {
  SyncTransportError,
  type SettingsCloudRow,
  type SettingsPushRow,
  type SignatureCloudRow,
  type SignaturePushRow,
  type SyncTransport,
} from './sync';

const SETTINGS_COLUMNS = 'settings,revision,device_id,updated_at';
const SIGNATURE_COLUMNS =
  'id,label,kind,payload,storage_key,sort_order,deleted_at,updated_at';

export interface PostgrestTransportOptions {
  dataApiUrl: string;
  getToken: () => Promise<string | null>;
}

export class PostgrestSyncTransport implements SyncTransport {
  private readonly client: NeonPostgrestClient;

  constructor(options: PostgrestTransportOptions) {
    this.client = new NeonPostgrestClient({
      dataApiUrl: options.dataApiUrl,
      options: { global: { fetch: fetchWithToken(options.getToken) } },
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
