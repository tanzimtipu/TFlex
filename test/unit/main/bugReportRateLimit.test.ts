// TFL-761 - the public POST /bug-reports route's in-process IP rate limiter.
//
// Runs the real `hello.ts` handler locally with its external modules mocked, so
// no network and no database are touched. A rapid burst from one IP must be
// throttled (429) while a fresh window or a different IP still passes.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@neondatabase/serverless', () => ({
  neon: () => ({ query: async () => [] }),
}));
vi.mock('jose', () => ({
  createRemoteJWKSet: () => ({}),
  jwtVerify: async () => ({ payload: {} }),
}));
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class {},
  PutObjectCommand: class {},
  GetObjectCommand: class {},
}));
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: async () => 'https://signed.example.test/object',
}));

import handler from '../../../hello';

const ENDPOINT = 'https://fn.example.test/bug-reports';

function makeRow(message: string): Record<string, unknown> {
  return { level: 'error', category: 'uncaught-exception', component: 'main', message };
}

function post(ip: string | null, message: string): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (ip !== null) headers['x-forwarded-for'] = ip;
  return new Request(ENDPOINT, {
    method: 'POST',
    headers,
    body: JSON.stringify([makeRow(message)]),
  });
}

describe('POST /bug-reports rate limiter (TFL-761)', () => {
  beforeEach(() => {
    process.env.DATABASE_URL = 'postgres://test/test';
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-05T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('throttles a 10-request burst from one IP after the window allowance', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 10; i += 1) {
      statuses.push((await handler.fetch(post('203.0.113.7', `burst-${i}`))).status);
    }
    expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
    expect(statuses.slice(5)).toEqual([429, 429, 429, 429, 429]);
  });

  it('sends Retry-After on the throttled response with a generic body', async () => {
    for (let i = 0; i < 5; i += 1) await handler.fetch(post('203.0.113.8', `ok-${i}`));
    const res = await handler.fetch(post('203.0.113.8', 'over'));
    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toEqual({ error: 'rate-limited' });
    expect(res.headers.get('retry-after')).toBe('60');
  });

  it('keys the window per IP: a second IP still gets its own allowance', async () => {
    for (let i = 0; i < 5; i += 1) await handler.fetch(post('203.0.113.9', `a-${i}`));
    expect((await handler.fetch(post('203.0.113.9', 'a-over'))).status).toBe(429);
    expect((await handler.fetch(post('203.0.113.10', 'b-1'))).status).toBe(200);
  });

  it('resets the window once it elapses', async () => {
    for (let i = 0; i < 5; i += 1) await handler.fetch(post('203.0.113.11', `w-${i}`));
    expect((await handler.fetch(post('203.0.113.11', 'w-over'))).status).toBe(429);
    vi.setSystemTime(new Date('2026-10-05T00:01:00.000Z'));
    expect((await handler.fetch(post('203.0.113.11', 'w-next'))).status).toBe(200);
  });

  it('fails open when the runtime exposes no client IP header', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 10; i += 1) {
      statuses.push((await handler.fetch(post(null, `no-ip-${i}`))).status);
    }
    expect(statuses).toEqual(Array(10).fill(200));
  });

  it('rejects a non-POST with 405 without consuming the allowance', async () => {
    const get = new Request(ENDPOINT, {
      method: 'GET',
      headers: { 'x-forwarded-for': '203.0.113.12' },
    });
    expect((await handler.fetch(get)).status).toBe(405);
    for (let i = 0; i < 5; i += 1) {
      expect((await handler.fetch(post('203.0.113.12', `g-${i}`))).status).toBe(200);
    }
  });
});
