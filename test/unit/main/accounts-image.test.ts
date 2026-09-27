// Phase 44 chunk 5 - Neon Function signature-image transport tests.
//
// The SDK wrapper is exercised with a mocked low-level fetch, so no network
// is touched. Covers: the URL built from config (no literal), the injected
// Authorization header, the raw image body, the presigned download path
// (which must NOT carry the JWT), and the 401/403/413 mapping. Also covers
// the store's image-byte round trip and the engine's client-side cap.

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PostgrestSyncTransport } from '../../../src/main/services/accounts/transport';
import { SyncTransportError } from '../../../src/main/services/accounts/sync';
import { SignatureService } from '../../../src/main/services/signature-service';

const BASE = 'https://fn.example.test/';
const DATA_API = 'https://data.example.test/rest/v1';

interface Call {
  url: string;
  init: RequestInit | undefined;
  auth: string | null;
}

function mockFetch(
  handler: (call: Call, index: number) => Response | Promise<Response>,
): { impl: typeof globalThis.fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input);
    const headers = new Headers(init?.headers ?? undefined);
    const call: Call = { url, init, auth: headers.get('Authorization') };
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

function makeTransport(
  impl: typeof globalThis.fetch,
  functionApiUrl: string | null = BASE,
  token: string | null = 'jwt',
): PostgrestSyncTransport {
  return new PostgrestSyncTransport({
    dataApiUrl: DATA_API,
    functionApiUrl,
    getToken: async () => token,
    fetchImpl: impl,
  });
}

async function rejection(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(() => null, (error: unknown) => error);
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------

describe('uploadSignatureImage', () => {
  it('POSTs the raw bytes to {config}/signatures with the JWT and returns the key', async () => {
    const { impl, calls } = mockFetch(() => jsonResponse({ key: 'signatures/user-1/abc.png' }));
    const key = await makeTransport(impl).uploadSignatureImage(new Uint8Array([1, 2, 3]));

    expect(key).toBe('signatures/user-1/abc.png');
    expect(calls).toHaveLength(1);
    // The trailing slash in the configured base is not doubled.
    expect(calls[0].url).toBe(`${BASE}signatures`);
    expect(calls[0].init?.method).toBe('POST');
    expect(calls[0].auth).toBe('Bearer jwt');
    const headers = new Headers(calls[0].init?.headers ?? undefined);
    expect(headers.get('content-type')).toBe('image/png');
    expect([...(calls[0].init?.body as Uint8Array)]).toEqual([1, 2, 3]);
  });

  it('builds the URL from whatever base the config supplies', async () => {
    const { impl, calls } = mockFetch(() => jsonResponse({ key: 'k' }));
    await makeTransport(impl, 'https://other.example.test/api').uploadSignatureImage(
      new Uint8Array([1]),
    );
    expect(calls[0].url).toBe('https://other.example.test/api/signatures');
  });

  it('is a server error when the function URL is not configured (no request)', async () => {
    const { impl, calls } = mockFetch(() => jsonResponse({ key: 'k' }));
    const error = await rejection(
      makeTransport(impl, null).uploadSignatureImage(new Uint8Array([1])),
    );
    expect(error).toBeInstanceOf(SyncTransportError);
    expect((error as SyncTransportError).kind).toBe('server');
    expect(calls).toHaveLength(0);
  });

  it('treats a 200 with no key as a server error', async () => {
    const { impl } = mockFetch(() => jsonResponse({}));
    const error = await rejection(makeTransport(impl).uploadSignatureImage(new Uint8Array([1])));
    expect((error as SyncTransportError).kind).toBe('server');
  });
});

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

describe('downloadSignatureImage', () => {
  it('resolves the key through the function then fetches the presigned URL without the JWT', async () => {
    const { impl, calls } = mockFetch((_call, index) =>
      index === 0
        ? jsonResponse({ url: 'https://s3.example.test/obj?sig=abc' })
        : new Response(new Uint8Array([7, 8, 9]) as BodyInit, { status: 200 }),
    );
    const bytes = await makeTransport(impl).downloadSignatureImage('signatures/user-1/abc.png');

    expect([...bytes]).toEqual([7, 8, 9]);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe(`${BASE}signatures/signatures%2Fuser-1%2Fabc.png`);
    expect(calls[0].auth).toBe('Bearer jwt');
    expect(calls[1].url).toBe('https://s3.example.test/obj?sig=abc');
    // The presigned URL carries its own signature; no Authorization header.
    expect(calls[1].auth).toBeNull();
  });

  it('is a server error when the function returns no url', async () => {
    const { impl } = mockFetch(() => jsonResponse({}));
    const error = await rejection(makeTransport(impl).downloadSignatureImage('signatures/u/a.png'));
    expect((error as SyncTransportError).kind).toBe('server');
  });
});

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

describe('image transport error mapping', () => {
  it('maps 401 to auth and never lets the raw error escape', async () => {
    const { impl } = mockFetch(() => jsonResponse({ error: 'unauthorized' }, 401));
    const error = await rejection(makeTransport(impl).uploadSignatureImage(new Uint8Array([1])));
    expect(error).toBeInstanceOf(SyncTransportError);
    expect((error as SyncTransportError).kind).toBe('auth');
  });

  it('maps 403 to auth on download', async () => {
    const { impl } = mockFetch(() => jsonResponse({ error: 'forbidden' }, 403));
    const error = await rejection(makeTransport(impl).downloadSignatureImage('signatures/other/a.png'));
    expect((error as SyncTransportError).kind).toBe('auth');
  });

  it('maps 413 to a server error with the 256 KB message', async () => {
    const { impl } = mockFetch(() => jsonResponse({ error: 'bad-size' }, 413));
    const error = await rejection(makeTransport(impl).uploadSignatureImage(new Uint8Array([1])));
    expect(error).toBeInstanceOf(SyncTransportError);
    expect((error as SyncTransportError).kind).toBe('server');
    expect((error as SyncTransportError).message).toContain('256 KB');
  });

  it('maps a network failure to an offline error (non-throwing)', async () => {
    const { impl } = mockFetch(() => {
      throw new TypeError('fetch failed');
    });
    const error = await rejection(makeTransport(impl).uploadSignatureImage(new Uint8Array([1])));
    expect(error).toBeInstanceOf(SyncTransportError);
    expect((error as SyncTransportError).kind).toBe('offline');
  });

  it('a non-ok presigned object response becomes a typed error, not a raw throw', async () => {
    const { impl } = mockFetch((_call, index) =>
      index === 0
        ? jsonResponse({ url: 'https://s3.example.test/obj' })
        : new Response('nope', { status: 404 }),
    );
    const error = await rejection(makeTransport(impl).downloadSignatureImage('signatures/u/a.png'));
    expect(error).toBeInstanceOf(SyncTransportError);
    expect((error as SyncTransportError).kind).toBe('server');
  });
});

// ---------------------------------------------------------------------------
// Phase 48 - hard delete via the Data API
// ---------------------------------------------------------------------------

describe('deleteSignature', () => {
  it('sends a DELETE filtered to the row id (no soft-delete update)', async () => {
    const { impl, calls } = mockFetch(() => new Response(null, { status: 204 }));
    await makeTransport(impl).deleteSignature('sig-1');

    expect(calls).toHaveLength(1);
    expect(calls[0].init?.method).toBe('DELETE');
    expect(calls[0].url).toContain('/user_signatures');
    expect(calls[0].url).toContain('id=eq.sig-1');
    expect(calls[0].auth).toBe('Bearer jwt');
  });

  it('maps a rejected delete to a typed server error', async () => {
    const { impl } = mockFetch(() => jsonResponse({ message: 'denied' }, 403));
    const error = await rejection(makeTransport(impl).deleteSignature('sig-1'));
    expect(error).toBeInstanceOf(SyncTransportError);
    expect((error as SyncTransportError).kind).toBe('server');
  });
});

// ---------------------------------------------------------------------------
// Local image store round trip
// ---------------------------------------------------------------------------

describe('SignatureService image store', () => {
  const dirs: string[] = [];
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
  });

  it('writes, reads, reports hasBytes, persists the key and survives a reload', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tflex-sig-img-'));
    dirs.push(dir);
    const file = join(dir, 'signatures.json');
    const service = new SignatureService(file);
    const bytes = new Uint8Array([10, 20, 30]);

    await service.writeImage('img-1', bytes);
    await service.applyImageSynced(
      [{ id: 'img-1', label: 'A', createdAt: '2026-09-27T00:00:00.000Z', width: 5, height: 4, storageKey: null }],
      [],
    );
    expect(await service.readImage('img-1')).toEqual(bytes);
    expect((await service.listImages())[0]).toMatchObject({ id: 'img-1', hasBytes: true });

    await service.setImageStorageKey('img-1', 'signatures/user-1/img-1.png');
    const reloaded = new SignatureService(file);
    expect((await reloaded.listImages())[0].storageKey).toBe('signatures/user-1/img-1.png');
    expect(await reloaded.readImage('img-1')).toEqual(bytes);
  });

  it('removes a soft-deleted image id and rejects a path-traversal id', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tflex-sig-img-'));
    dirs.push(dir);
    const service = new SignatureService(join(dir, 'signatures.json'));
    await service.writeImage('img-1', new Uint8Array([1]));
    await service.applyImageSynced(
      [{ id: 'img-1', label: 'A', createdAt: '2026-09-27T00:00:00.000Z', width: 1, height: 1, storageKey: 'k' }],
      [],
    );
    await service.applyImageSynced([], ['img-1']);
    expect(await service.listImages()).toEqual([]);
    // The soft-delete also drops the local bytes (no orphaned PNG).
    expect(await service.readImage('img-1')).toBeNull();

    expect(await service.readImage('../escape')).toBeNull();
    await expect(service.writeImage('../escape', new Uint8Array([1]))).rejects.toThrow();
  });
});
