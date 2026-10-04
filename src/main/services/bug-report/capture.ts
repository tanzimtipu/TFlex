/**
 * Phase 101 - the capture core (main process only).
 *
 * `capture` is synchronous and in-memory: fingerprint -> redact -> collapse
 * hot-loop repeats into a bounded occurrence count -> enqueue. It returns the
 * queue depth without ever awaiting the network, so a capture point (an
 * uncaught exception, an IPC rejection, a renderer forward) never blocks.
 *
 * `flush` is single-flight, NEVER throws, and retries with exponential
 * backoff a bounded number of times. Rows are removed from the queue only
 * after the transport accepted them, so a failed flush loses nothing.
 */

import { randomUUID } from 'node:crypto';
import { release as osRelease } from 'node:os';
import type {
  BugReportCaptureResult,
  BugReportInput,
} from '../../../shared/bugReport';
import { fingerprintOf } from './fingerprint';
import { BreadcrumbRing, BugReportQueue } from './queue';
import { redactString, redactValue } from './redact';
import { BugReportTransportError, type BugReportRow, type BugReportTransport } from './types';

export interface BugReportServiceOptions {
  queue: BugReportQueue;
  transport: BugReportTransport | null;
  /** Resolves the signed-in user id, or null when signed out. May be async;
   *  the last known value is used so capture stays synchronous. */
  getSessionUserId?: () => string | null | Promise<string | null>;
  appVersion: string;
  build?: string | null;
  environment?: string;
  platform?: string;
  osVersion?: string | null;
  arch?: string | null;
  locale?: string | null;
  sessionId?: string;
  now?: () => string;
  debounceMs?: number;
  dedupWindowMs?: number;
  maxTries?: number;
  backoffBaseMs?: number;
  maxBackoffMs?: number;
  batchSize?: number;
  maxOccurrence?: number;
  maxTrackedFingerprints?: number;
  sleep?: (ms: number) => Promise<void>;
  breadcrumbMax?: number;
}

const DEFAULT_DEBOUNCE_MS = 2000;
const DEFAULT_DEDUP_WINDOW_MS = 5000;
const DEFAULT_MAX_TRIES = 5;
const DEFAULT_BACKOFF_BASE_MS = 500;
const DEFAULT_MAX_BACKOFF_MS = 30000;
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_MAX_OCCURRENCE = 1000;
const DEFAULT_MAX_TRACKED = 512;

/**
 * DEF-552: per-field caps so a single queued row can never approach the route's
 * 256 KB batch cap. The sum of all bounds is ~73 k chars, far below 256 KB.
 */
const MAX_MESSAGE_CHARS = 8000;
const MAX_ERROR_NAME_CHARS = 1000;
const MAX_STACK_TRACE_CHARS = 32000;
const MAX_CONTEXT_JSON_CHARS = 16000;
const MAX_BREADCRUMBS_JSON_CHARS = 16000;
const TRUNCATION_MARKER = '...[truncated]';

export class BugReportService {
  private readonly queue: BugReportQueue;
  private readonly transport: BugReportTransport | null;
  private readonly getSessionUserId: () => string | null | Promise<string | null>;
  private readonly appVersion: string;
  private readonly build: string | null;
  private readonly environment: string;
  private readonly platform: string;
  private readonly osVersion: string | null;
  private readonly arch: string | null;
  private readonly locale: string | null;
  private readonly sessionId: string;
  private readonly nowFn: () => string;
  private readonly debounceMs: number;
  private readonly dedupWindowMs: number;
  private readonly maxTries: number;
  private readonly backoffBaseMs: number;
  private readonly maxBackoffMs: number;
  private readonly batchSize: number;
  private readonly maxOccurrence: number;
  private readonly maxTracked: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly breadcrumbs: BreadcrumbRing;
  private readonly occurrences = new Map<string, { count: number; lastAt: number }>();
  private flushPromise: Promise<void> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private userId: string | null = null;

  constructor(options: BugReportServiceOptions) {
    this.queue = options.queue;
    this.transport = options.transport;
    this.getSessionUserId = options.getSessionUserId ?? (() => null);
    this.appVersion = options.appVersion;
    this.build = options.build ?? null;
    this.environment = options.environment ?? 'production';
    this.platform = options.platform ?? process.platform;
    this.osVersion = options.osVersion ?? safeOsRelease();
    this.arch = options.arch ?? process.arch;
    this.locale = options.locale ?? null;
    this.sessionId = options.sessionId ?? randomUUID();
    this.nowFn = options.now ?? (() => new Date().toISOString());
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.dedupWindowMs = options.dedupWindowMs ?? DEFAULT_DEDUP_WINDOW_MS;
    this.maxTries = options.maxTries ?? DEFAULT_MAX_TRIES;
    this.backoffBaseMs = options.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS;
    this.maxBackoffMs = options.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    this.batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    this.maxOccurrence = options.maxOccurrence ?? DEFAULT_MAX_OCCURRENCE;
    this.maxTracked = options.maxTrackedFingerprints ?? DEFAULT_MAX_TRACKED;
    this.sleep =
      options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
    this.breadcrumbs = new BreadcrumbRing(options.breadcrumbMax);
    void this.refreshUserId();
  }

  /** Record a failure. Synchronous and network-free; returns the queue depth. */
  capture(input: BugReportInput): BugReportCaptureResult {
    try {
      void this.refreshUserId();
      const fingerprint = fingerprintOf(input);
      const occurrence = this.bumpOccurrence(fingerprint);
      if (occurrence.collapsed) {
        this.queue.updateLatestCount(fingerprint, occurrence.count);
        return { ok: true, queued: this.queue.size() };
      }
      const context = redactContext(input.context);
      context.occurrence = occurrence.count;
      const row = this.buildRow(input, fingerprint, context);
      const queued = this.queue.enqueue(row);
      this.breadcrumbs.push({
        at: row.occurred_at,
        level: row.level,
        category: row.category,
        message: row.message,
      });
      this.scheduleFlush();
      return { ok: true, queued };
    } catch {
      return { ok: false, queued: this.queue.size() };
    }
  }

  /** Drain the queue. Single-flight and never rejects. */
  flush(): Promise<void> {
    if (this.flushPromise !== null) return this.flushPromise;
    const run = this.runFlush().catch(() => undefined);
    this.flushPromise = run.finally(() => {
      this.flushPromise = null;
    });
    return this.flushPromise;
  }

  private buildRow(
    input: BugReportInput,
    fingerprint: string,
    context: Record<string, unknown>,
  ): BugReportRow {
    return {
      level: input.level,
      category: input.category,
      component: input.component,
      message: boundText(redactString(input.message), MAX_MESSAGE_CHARS),
      error_name: input.errorName
        ? boundText(redactString(input.errorName), MAX_ERROR_NAME_CHARS)
        : null,
      stack_trace: input.stackTrace
        ? boundText(redactString(input.stackTrace), MAX_STACK_TRACE_CHARS)
        : null,
      fingerprint,
      app_version: this.appVersion,
      build: this.build,
      environment: this.environment,
      platform: this.platform,
      os_version: this.osVersion,
      arch: this.arch,
      locale: this.locale,
      user_id: this.userId,
      session_id: this.sessionId,
      breadcrumbs: boundBreadcrumbs(redactBreadcrumbs(this.breadcrumbs.list())),
      context: boundContext(context),
      handled: input.handled ?? false,
      occurred_at: this.nowFn(),
    };
  }

  private bumpOccurrence(fingerprint: string): { count: number; collapsed: boolean } {
    const now = Date.now();
    const prev = this.occurrences.get(fingerprint);
    const collapsed = prev !== undefined && now - prev.lastAt <= this.dedupWindowMs;
    const count = prev === undefined ? 1 : Math.min(prev.count + 1, this.maxOccurrence);
    this.occurrences.set(fingerprint, { count, lastAt: now });
    if (this.occurrences.size > this.maxTracked) this.pruneOccurrences();
    return { count, collapsed };
  }

  private pruneOccurrences(): void {
    const excess = this.occurrences.size - this.maxTracked;
    let removed = 0;
    for (const key of this.occurrences.keys()) {
      this.occurrences.delete(key);
      removed += 1;
      if (removed >= excess) break;
    }
  }

  private async refreshUserId(): Promise<void> {
    try {
      const id = await this.getSessionUserId();
      this.userId = typeof id === 'string' && id.length > 0 ? id : null;
    } catch {
      // Keep the last known id; a vault read failure must not break capture.
    }
  }

  private scheduleFlush(): void {
    if (this.transport === null) return;
    if (this.debounceTimer !== null) return;
    if (this.debounceMs <= 0) {
      void this.flush();
      return;
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.flush();
    }, this.debounceMs);
  }

  private async runFlush(): Promise<void> {
    if (this.transport === null) return;
    let attempt = 0;
    for (;;) {
      const batch = this.queue.peek(this.batchSize);
      if (batch.length === 0) return;
      try {
        await this.transport.insertRecords(batch);
        this.queue.acknowledge(batch.length);
        attempt = 0;
      } catch (error) {
        if (error instanceof BugReportTransportError && error.kind === 'permanent') {
          // DEF-551: the server rejected this payload itself (4xx). Drop the
          // batch so it cannot poison the head of the queue; later rows still
          // flush. At-least-once retries stay reserved for 5xx/offline.
          this.queue.acknowledge(batch.length);
          attempt = 0;
          continue;
        }
        attempt += 1;
        if (attempt >= this.maxTries) return;
        await this.sleep(this.backoffDelay(attempt));
      }
    }
  }

  private backoffDelay(attempt: number): number {
    return Math.min(this.backoffBaseMs * 2 ** (attempt - 1), this.maxBackoffMs);
  }
}

function redactContext(context: Record<string, unknown> | undefined): Record<string, unknown> {
  if (context === undefined) return {};
  const redacted = redactValue(context);
  if (redacted !== null && typeof redacted === 'object' && !Array.isArray(redacted)) {
    return { ...(redacted as Record<string, unknown>) };
  }
  return {};
}

/** Truncate a string to `max` chars, ending with the truncation marker. */
function boundText(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, Math.max(0, max - TRUNCATION_MARKER.length)) + TRUNCATION_MARKER;
}

/** Deep-copy-redact every breadcrumb's text fields (DEF-549). */
function redactBreadcrumbs(items: unknown[]): unknown[] {
  const redacted = redactValue(items);
  return Array.isArray(redacted) ? redacted : [];
}

/** Keep context entries until the JSON budget is reached; drop the overflow. */
function boundContext(context: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(context)) {
    out[key] = value;
    if (jsonLength(out) > MAX_CONTEXT_JSON_CHARS) {
      delete out[key];
      break;
    }
  }
  return out;
}

/** Keep breadcrumbs until the JSON budget is reached; drop the overflow. */
function boundBreadcrumbs(items: unknown[]): unknown[] {
  const out: unknown[] = [];
  for (const item of items) {
    out.push(item);
    if (jsonLength(out) > MAX_BREADCRUMBS_JSON_CHARS) {
      out.pop();
      break;
    }
  }
  return out;
}

function jsonLength(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return Number.MAX_SAFE_INTEGER;
  }
}

function safeOsRelease(): string | null {
  try {
    return osRelease();
  } catch {
    return null;
  }
}
