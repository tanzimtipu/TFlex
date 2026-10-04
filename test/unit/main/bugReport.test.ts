// Phase 101 chunk 1 - main-process bug capture core.
//
// Covers: fingerprint stability + sensitivity to the top frame, the redaction
// table (JWT / password= / Authorization: Bearer / apiKey / OS user name) and
// its no-mutation guarantee, the queue cap with drop-oldest and corruption
// tolerance, the breadcrumb ring bound, hot-loop dedup, and the single-flight
// never-throwing flush.

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fingerprintOf,
  normalizeFrame,
  normalizeMessage,
  topFrame,
} from '../../../src/main/services/bug-report/fingerprint';
import { redactString, redactValue } from '../../../src/main/services/bug-report/redact';
import {
  BreadcrumbRing,
  BugReportQueue,
  BUG_REPORT_QUEUE_MAX,
} from '../../../src/main/services/bug-report/queue';
import { BugReportService } from '../../../src/main/services/bug-report/capture';
import {
  BugReportTransportError,
  type BugReportRow,
  type BugReportTransport,
} from '../../../src/main/services/bug-report/types';
import type { BugReportInput } from '../../../src/shared/bugReport';

const STACK_A = 'Error: boom\n    at handler (C:\\proj\\src\\app.ts:10:5)\n    at other (C:\\proj\\src\\x.ts:2:1)';
const STACK_B = 'Error: boom\n    at handler (C:\\proj\\src\\app.ts:99:5)';

function input(overrides: Partial<BugReportInput> = {}): BugReportInput {
  return {
    level: 'error',
    category: 'uncaught-exception',
    component: 'main',
    message: 'boom',
    errorName: 'Error',
    stackTrace: STACK_A,
    ...overrides,
  };
}

describe('fingerprintOf', () => {
  it('is stable across identical inputs', () => {
    expect(fingerprintOf(input())).toBe(fingerprintOf(input()));
    expect(fingerprintOf(input())).toHaveLength(64);
  });

  it('changes when the top stack frame changes', () => {
    expect(fingerprintOf(input({ stackTrace: STACK_A }))).not.toBe(
      fingerprintOf(input({ stackTrace: STACK_B })),
    );
  });

  it('ignores machine-specific path prefixes (path-normalized frame)', () => {
    const one = input({ stackTrace: 'Error: x\n    at f (C:\\a\\src\\app.ts:10:5)' });
    const two = input({ stackTrace: 'Error: x\n    at f (D:\\other\\src\\app.ts:10:5)' });
    expect(fingerprintOf(one)).toBe(fingerprintOf(two));
  });

  it('normalizes whitespace-only message differences', () => {
    expect(fingerprintOf(input({ message: 'a  b\n c' }))).toBe(
      fingerprintOf(input({ message: 'a b c' })),
    );
  });

  it('exposes the normalized frame helpers', () => {
    expect(topFrame(STACK_A)).toBe('app.ts:10:5');
    expect(normalizeFrame('f (C:\\x\\y.ts:3:4)')).toBe('y.ts:3:4');
    expect(normalizeMessage('  a   b ')).toBe('a b');
  });
});

describe('redactValue', () => {
  it('masks sensitive keys, tokens and the OS user name without mutating input', () => {
    const userName = userInfo().username;
    const original = {
      token: 'secret-token',
      password: 'hunter2',
      Authorization: 'Bearer a.b.c',
      apiKey: 'key-123',
      nested: { secret: 's3cr3t', ok: 'kept' },
      path: `C:\\Users\\${userName}\\doc.pdf`,
      list: ['plain', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig'],
    };
    const snapshot = JSON.parse(JSON.stringify(original));
    const out = redactValue(original) as Record<string, unknown>;

    expect(JSON.stringify(original)).toBe(JSON.stringify(snapshot));
    expect(out.token).toBe('[redacted]');
    expect(out.password).toBe('[redacted]');
    expect(out.Authorization).toBe('[redacted]');
    expect(out.apiKey).toBe('[redacted]');
    expect(out.nested).toEqual({ secret: '[redacted]', ok: 'kept' });
    expect(out.path).toContain('<user>');
    expect(JSON.stringify(out)).not.toContain('eyJhbGciOiJIUzI1NiJ9');
  });

  it('redacts the string secret classes', () => {
    expect(redactString('authorization header eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig')).not.toContain(
      'eyJhbGciOiJIUzI1NiJ9',
    );
    expect(redactString('password=hunter2')).toContain('[redacted]');
    expect(redactString('password=hunter2')).not.toContain('hunter2');
    expect(redactString('Authorization: Bearer abc.def.ghi')).not.toContain('abc.def.ghi');
    expect(redactString('apiKey=key-123')).not.toContain('key-123');
    expect(redactString('home C:\\Users\\someone', 'someone')).toContain('<user>');
  });

  it('redacts bare provider API keys with no key=value separator (DEF-549)', () => {
    const transmitted = 'token sk-abc123 Authorization=[redacted] [redacted]';
    const out = redactString(transmitted);
    expect(out).not.toContain('sk-abc123');
    expect(out).toContain('[redacted]');

    expect(redactString('sk-proj-abcdefghijklmnop')).not.toContain('sk-proj-abcdefghijklmnop');
    expect(redactString('sk_live_0123456789abcdef')).not.toContain('sk_live_0123456789abcdef');
    expect(redactString('ghp_0123456789abcdef')).not.toContain('ghp_0123456789abcdef');
    expect(redactString('xoxb-1234567890-abcdef')).not.toContain('xoxb-1234567890-abcdef');
    expect(redactString('AIzaSyD1234567890abcdefghijklmnopqrst')).not.toContain(
      'AIzaSyD1234567890abcdefghijklmnopqrst',
    );
    expect(redactString('AKIAIOSFODNN7EXAMPLE')).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(redactString('ya29.abcdefghijklmnopqrstuvwxyz0123456789')).not.toContain(
      'ya29.abcdefghijklmnopqrstuvwxyz0123456789',
    );
    expect(redactString('pypi-AgEIcHlwaS5vcmc0123456789')).not.toContain(
      'pypi-AgEIcHlwaS5vcmc0123456789',
    );
  });

  it('leaves ordinary hyphenated words intact (DEF-549 guard)', () => {
    const plain = 'risk-assessment desk-lamp task-list mask-image';
    expect(redactString(plain)).toBe(plain);
  });
});

let tempDirs: string[] = [];

async function tempQueuePath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tflex-bugq-'));
  tempDirs.push(dir);
  return join(dir, 'bug-reports-queue.json');
}

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

function row(message: string, fingerprint = 'fp'): BugReportRow {
  return {
    level: 'error',
    category: 'unknown',
    component: 'main',
    message,
    error_name: null,
    stack_trace: null,
    fingerprint,
    app_version: '1.0.0',
    build: null,
    environment: 'production',
    platform: 'win32',
    os_version: null,
    arch: 'x64',
    locale: null,
    user_id: null,
    session_id: 's',
    breadcrumbs: [],
    context: {},
    handled: false,
    occurred_at: '2026-10-05T00:00:00.000Z',
  };
}

describe('BugReportQueue', () => {
  it('caps at 200 entries with drop-oldest', async () => {
    const queue = new BugReportQueue({ filePath: await tempQueuePath() });
    for (let i = 0; i < BUG_REPORT_QUEUE_MAX + 5; i += 1) queue.enqueue(row(`m-${i}`));
    expect(queue.size()).toBe(BUG_REPORT_QUEUE_MAX);
    expect(queue.peek(1)[0].message).toBe('m-5');
  });

  it('persists and reloads, and tolerates a corrupt file', async () => {
    const filePath = await tempQueuePath();
    const queue = new BugReportQueue({ filePath });
    queue.enqueue(row('a'));
    queue.enqueue(row('b'));
    expect(new BugReportQueue({ filePath }).size()).toBe(2);

    await writeFile(filePath, '{ not json', 'utf8');
    expect(new BugReportQueue({ filePath }).size()).toBe(0);
  });

  it('acknowledges (removes) the oldest rows after a successful flush', async () => {
    const queue = new BugReportQueue({ filePath: await tempQueuePath() });
    queue.enqueue(row('a'));
    queue.enqueue(row('b'));
    queue.enqueue(row('c'));
    queue.acknowledge(2);
    expect(queue.size()).toBe(1);
    expect(queue.peek(1)[0].message).toBe('c');
  });

  it('bounds the breadcrumb ring to the last 50', () => {
    const ring = new BreadcrumbRing();
    for (let i = 0; i < 60; i += 1) ring.push(`b-${i}`);
    const items = ring.list();
    expect(items).toHaveLength(50);
    expect(items[0]).toBe('b-10');
  });
});

describe('BugReportService', () => {
  it('captures synchronously and drains on flush', async () => {
    const queue = new BugReportQueue({ filePath: await tempQueuePath() });
    const calls: BugReportRow[][] = [];
    const transport: BugReportTransport = {
      insertRecords: vi.fn(async (rows: BugReportRow[]) => {
        calls.push(rows);
      }),
    };
    const service = new BugReportService({
      queue,
      transport,
      appVersion: '1.0.0',
      now: () => 'T',
      debounceMs: 0,
    });

    const result = service.capture(input());
    expect(result).toEqual({ ok: true, queued: 1 });
    await service.flush();
    expect(calls).toHaveLength(1);
    expect(calls[0][0].fingerprint).toBe(fingerprintOf(input()));
    expect(queue.size()).toBe(0);
  });

  it('flush is single-flight', async () => {
    const queue = new BugReportQueue({ filePath: await tempQueuePath() });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const insertRecords = vi.fn(async () => {
      await gate;
    });
    const service = new BugReportService({
      queue,
      transport: { insertRecords },
      appVersion: '1.0.0',
      debounceMs: 0,
    });
    service.capture(input());

    const first = service.flush();
    const second = service.flush();
    expect(first).toBe(second);
    release();
    await first;
    expect(insertRecords).toHaveBeenCalledTimes(1);
  });

  it('never throws on a rejected transport and keeps the rows', async () => {
    const queue = new BugReportQueue({ filePath: await tempQueuePath() });
    const transport: BugReportTransport = {
      insertRecords: vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    };
    const service = new BugReportService({
      queue,
      transport,
      appVersion: '1.0.0',
      debounceMs: 0,
      maxTries: 2,
      backoffBaseMs: 0,
      sleep: async () => undefined,
    });

    service.capture(input());
    await expect(service.flush()).resolves.toBeUndefined();
    expect(queue.size()).toBe(1);
  });

  it('collapses hot-loop repeats into a bounded occurrence count', async () => {
    const queue = new BugReportQueue({ filePath: await tempQueuePath() });
    const transport: BugReportTransport = {
      insertRecords: vi.fn(async () => {
        throw new Error('down');
      }),
    };
    const service = new BugReportService({
      queue,
      transport,
      appVersion: '1.0.0',
      debounceMs: 0,
      maxTries: 1,
      sleep: async () => undefined,
      dedupWindowMs: 60000,
    });

    service.capture(input());
    await service.flush();
    service.capture(input());
    await service.flush();
    expect(queue.size()).toBe(1);
    expect((queue.peek(1)[0].context as Record<string, unknown>).occurrence).toBe(2);
  });

  it('queues when no transport is configured and stamps user_id', async () => {
    const queue = new BugReportQueue({ filePath: await tempQueuePath() });
    const service = new BugReportService({
      queue,
      transport: null,
      appVersion: '1.0.0',
      getSessionUserId: () => 'user-9',
      debounceMs: 0,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    service.capture(input());
    await service.flush();
    expect(queue.size()).toBe(1);
    expect(queue.peek(1)[0].user_id).toBe('user-9');
    expect(queue.peek(1)[0].app_version).toBe('1.0.0');
  });

  it('redacts secrets in message, error_name, stack_trace and breadcrumbs (DEF-549)', async () => {
    const queue = new BugReportQueue({ filePath: await tempQueuePath() });
    const service = new BugReportService({
      queue,
      transport: null,
      appVersion: '1.0.0',
      debounceMs: 0,
      dedupWindowMs: 0,
      sessionId: 's',
    });
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig';

    service.capture(
      input({
        message: `boom password=hunter2 ${jwt}`,
        errorName: 'AuthError apiKey=key-123',
        stackTrace: `Error: boom\n    at f (a.ts:1:1) ${jwt}`,
      }),
    );
    service.capture(
      input({
        message: 'second secret=hunter2',
        errorName: 'Other',
        stackTrace: 'Error: other\n    at g (b.ts:2:2)',
      }),
    );

    const serialized = JSON.stringify(queue.peek(10));
    const all = queue.peek(10);
    expect(all).toHaveLength(2);
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('key-123');
    expect(serialized).not.toContain('eyJhbGciOiJIUzI1NiJ9');
    expect(all[0].message).toContain('[redacted]');
    expect(JSON.stringify(all[1].breadcrumbs)).not.toContain('hunter2');
    expect(JSON.stringify(all[1].breadcrumbs)).toContain('[redacted]');
  });

  it('strips bare provider keys from the exact DEF-549 transmitted row', async () => {
    const queue = new BugReportQueue({ filePath: await tempQueuePath() });
    const service = new BugReportService({
      queue,
      transport: null,
      appVersion: '1.0.0',
      debounceMs: 0,
      dedupWindowMs: 0,
      sessionId: 's',
    });

    service.capture(
      input({
        message: 'token sk-abc123 Authorization: Bearer eyJx.y.z',
        errorName: 'password=hunter2',
        stackTrace: 'apiKey=SECRETKEY ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      }),
    );

    const row = queue.peek(1)[0];
    const blob = `${row.message}\n${row.error_name}\n${row.stack_trace}`;
    for (const secret of [
      'sk-abc123',
      'eyJx.y.z',
      'hunter2',
      'SECRETKEY',
      'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ',
    ]) {
      expect(blob).not.toContain(secret);
    }
    expect(row.message).toContain('[redacted]');
    expect(redactString('Please retry the upload')).toBe('Please retry the upload');
  });

  it('bounds message, error_name, stack_trace and context to the route-safe caps (DEF-552)', async () => {
    const queue = new BugReportQueue({ filePath: await tempQueuePath() });
    const service = new BugReportService({
      queue,
      transport: null,
      appVersion: '1.0.0',
      debounceMs: 0,
    });

    service.capture(
      input({
        message: 'm'.repeat(9000),
        errorName: 'e'.repeat(2000),
        stackTrace: 's'.repeat(40000),
        context: { blob: 'c'.repeat(30000) },
      }),
    );

    const row = queue.peek(1)[0];
    expect(row.message.length).toBeLessThanOrEqual(8000);
    expect(row.message.endsWith('...[truncated]')).toBe(true);
    expect(row.error_name?.length).toBeLessThanOrEqual(1000);
    expect(row.stack_trace?.length).toBeLessThanOrEqual(32000);
    expect(row.stack_trace?.endsWith('...[truncated]')).toBe(true);
    expect(JSON.stringify(row.context).length).toBeLessThanOrEqual(16000);
    expect(JSON.stringify(row.breadcrumbs).length).toBeLessThanOrEqual(16000);
    expect(JSON.stringify(row).length).toBeLessThan(256 * 1024);
  });

  it('drops a batch on a permanent transport error instead of retrying (DEF-551)', async () => {
    const queue = new BugReportQueue({ filePath: await tempQueuePath() });
    const insertRecords = vi.fn(async () => {
      throw new BugReportTransportError('permanent', 'bad payload');
    });
    const service = new BugReportService({
      queue,
      transport: { insertRecords },
      appVersion: '1.0.0',
      debounceMs: 0,
      maxTries: 3,
      backoffBaseMs: 0,
      sleep: async () => undefined,
    });

    service.capture(input());
    await service.flush();
    expect(insertRecords).toHaveBeenCalledTimes(1);
    expect(queue.size()).toBe(0);
  });

  it('retries a server/offline transport error and keeps the batch (DEF-551)', async () => {
    const queue = new BugReportQueue({ filePath: await tempQueuePath() });
    const insertRecords = vi.fn(async () => {
      throw new BugReportTransportError('server', 'down');
    });
    const service = new BugReportService({
      queue,
      transport: { insertRecords },
      appVersion: '1.0.0',
      debounceMs: 0,
      maxTries: 3,
      backoffBaseMs: 0,
      sleep: async () => undefined,
    });

    service.capture(input());
    await service.flush();
    expect(insertRecords).toHaveBeenCalledTimes(3);
    expect(queue.size()).toBe(1);
  });
});

