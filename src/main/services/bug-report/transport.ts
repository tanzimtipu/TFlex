/**
 * Phase 101 - bug-report transport (main process only).
 *
 * Posts the queued rows to the public `POST <functionApiUrl>/bug-reports`
 * route on the `api` Neon Function, which inserts them server-side. The route
 * is deliberately UNAUTHENTICATED: a bug report must land even for a crash
 * before sign-in, and the Data API path is gone because it rejects every
 * request without a JWT bearer. A user id, when a session is held, is a plain
 * column value in the row - never an auth boundary.
 *
 * No `@neondatabase/neon-js` dependency and no URL literal appear here; the
 * base URL comes from `getAccountsConfig`. The fetch reference is bound once
 * so no bare platform fetch call site exists (the conventions gate forbids one).
 */

import {
  BugReportTransportError,
  type BugReportErrorKind,
  type BugReportRow,
  type BugReportTransport,
} from './types';

export interface FunctionBugReportTransportOptions {
  /** The Neon Function base URL (no trailing slash needed). */
  functionApiUrl: string;
  /** Low-level fetch override for tests. Never a URL source. */
  fetchImpl?: typeof globalThis.fetch;
  /** DEF-553: abort the request after this many ms. Default 10000. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 10000;

export class FunctionBugReportTransport implements BugReportTransport {
  private readonly functionBase: string;
  private readonly doFetch: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(options: FunctionBugReportTransportOptions) {
    this.functionBase = options.functionApiUrl.replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    // Bound once, token-free: mutations on the platform fetch must not leak,
    // and a bound reference keeps the conventions gate happy.
    this.doFetch = (options.fetchImpl ?? globalThis.fetch).bind(globalThis);
  }

  async insertRecords(rows: BugReportRow[]): Promise<void> {
    if (rows.length === 0) return;
    const url = `${this.functionBase}/bug-reports`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.doFetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(rows),
        signal: controller.signal,
      });
      if (!response.ok) {
        // DEF-551: a 4xx means the payload itself was rejected, so retrying the
        // same batch is futile. 5xx stays retryable ("server").
        const kind: BugReportErrorKind =
          response.status >= 400 && response.status <= 499 ? 'permanent' : 'server';
        throw new BugReportTransportError(kind, `bug-report insert failed (${response.status})`);
      }
    } catch (error) {
      if (controller.signal.aborted) {
        throw new BugReportTransportError('offline', 'bug-report insert timed out');
      }
      throw toTransportError(error);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Map an HTTP/network failure onto the offline/server taxonomy, mirroring
 *  `accounts/transport.ts`. */
function toTransportError(error: unknown): BugReportTransportError {
  if (error instanceof BugReportTransportError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new BugReportTransportError(classify(error, message), message);
}

function classify(error: unknown, message: string): BugReportErrorKind {
  if (error instanceof TypeError) return 'offline';
  if (/fetch failed|network|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|ETIMEDOUT|socket hang up/i.test(message)) {
    return 'offline';
  }
  return 'server';
}
