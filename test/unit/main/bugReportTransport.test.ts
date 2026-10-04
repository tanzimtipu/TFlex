// Phase 101 - Function bug-report transport call shape + error mapping.
//
// No network is touched: the transport's fetch is injected as a fake, so this
// asserts exactly `POST <functionApiUrl>/bug-reports` with a JSON array body,
// and the offline/server taxonomy on failure.

import { describe, expect, it, vi } from 'vitest';
import { FunctionBugReportTransport } from '../../../src/main/services/bug-report/transport';
import { BugReportTransportError } from '../../../src/main/services/bug-report/types';
import type { BugReportRecord } from '../../../src/shared/bugReport';

const BASE = 'https://fn.example.test/api';

const ROW: BugReportRecord = {
  level: 'error',
  category: 'uncaught-exception',
  component: 'main',
  message: 'boom',
  error_name: 'Error',
  stack_trace: 'Error: boom\n    at C:/proj/src/a.ts:1:2',
  fingerprint: 'fp-1',
  app_version: '1.49.0',
  build: null,
  environment: 'production',
  platform: 'win32',
  os_version: '10.0.0',
  arch: 'x64',
  locale: 'en-US',
  user_id: null,
  session_id: 'session-1',
  breadcrumbs: [],
  context: {},
  handled: false,
  occurred_at: '2026-10-05T00:00:00.000Z',
};

interface Call {
  url: string;
  init?: RequestInit;
}

function mockFetch(handler: (call: Call, index: number) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    const call: Call = { url, init };
    calls.push(call);
    return handler(call, calls.length - 1);
  });
  return { impl: fn as unknown as typeof globalThis.fetch, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeTransport(impl: typeof globalThis.fetch, base = BASE): FunctionBugReportTransport {
  return new FunctionBugReportTransport({ functionApiUrl: base, fetchImpl: impl });
}

describe('FunctionBugReportTransport', () => {
  it('POSTs the exact JSON row array to <base>/bug-reports with no token', async () => {
    const { impl, calls } = mockFetch(() => jsonResponse({ inserted: 1 }));
    await makeTransport(impl).insertRecords([ROW]);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(`${BASE}/bug-reports`);
    expect(calls[0].init?.method).toBe('POST');
    const headers = new Headers(calls[0].init?.headers ?? undefined);
    expect(headers.get('content-type')).toBe('application/json');
    expect(headers.get('authorization')).toBeNull();
    expect(calls[0].init?.body).toBe(JSON.stringify([ROW]));
  });

  it('does not double a trailing slash on the configured base', async () => {
    const { impl, calls } = mockFetch(() => jsonResponse({ inserted: 1 }));
    await makeTransport(impl, `${BASE}/`).insertRecords([ROW]);
    expect(calls[0].url).toBe(`${BASE}/bug-reports`);
  });

  it('does nothing (no request) for an empty batch', async () => {
    const { impl, calls } = mockFetch(() => jsonResponse({ inserted: 0 }));
    await makeTransport(impl).insertRecords([]);
    expect(calls).toHaveLength(0);
  });

  it('maps a non-2xx response to a server error', async () => {
    const { impl } = mockFetch(() => new Response('boom', { status: 500 }));
    await expect(makeTransport(impl).insertRecords([ROW])).rejects.toMatchObject({
      name: 'BugReportTransportError',
      kind: 'server',
    });
  });

  it('maps a network TypeError to an offline error', async () => {
    const { impl } = mockFetch(() => {
      throw new TypeError('fetch failed');
    });
    const error = makeTransport(impl).insertRecords([ROW]);
    await expect(error).rejects.toBeInstanceOf(BugReportTransportError);
    await expect(error).rejects.toMatchObject({ kind: 'offline' });
  });

  it('maps a 4xx rejection to a permanent error and a 5xx to a retryable server error (DEF-551)', async () => {
    const bad = mockFetch(() => new Response('bad', { status: 400 }));
    await expect(makeTransport(bad.impl).insertRecords([ROW])).rejects.toMatchObject({
      name: 'BugReportTransportError',
      kind: 'permanent',
    });

    const down = mockFetch(() => new Response('boom', { status: 503 }));
    await expect(makeTransport(down.impl).insertRecords([ROW])).rejects.toMatchObject({
      name: 'BugReportTransportError',
      kind: 'server',
    });
  });

  it('aborts after the injected timeout and throws an offline error (DEF-553)', async () => {
    const impl = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('This operation was aborted', 'AbortError'));
          });
        }),
    ) as unknown as typeof globalThis.fetch;
    const transport = new FunctionBugReportTransport({
      functionApiUrl: BASE,
      fetchImpl: impl,
      timeoutMs: 5,
    });

    await expect(transport.insertRecords([ROW])).rejects.toMatchObject({
      name: 'BugReportTransportError',
      kind: 'offline',
    });
    expect(impl).toHaveBeenCalledTimes(1);
  });
});
