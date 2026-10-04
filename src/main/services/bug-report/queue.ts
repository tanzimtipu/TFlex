/**
 * Phase 101 - bounded, persisted bug-report queue (main process only).
 *
 * The queue lives at `{userData}/bug-reports-queue.json`, holds at most 200
 * rows and drops the OLDEST when full. A missing or corrupt file simply means
 * an empty queue; a failed write never throws. `peek`/`acknowledge` let the
 * flush loop remove rows only after the transport accepted them, so a failed
 * flush loses nothing.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { BugReportRow } from './types';

export interface BugReportQueueOptions {
  filePath: string;
  maxEntries?: number;
}

export const BUG_REPORT_QUEUE_MAX = 200;

export class BugReportQueue {
  private readonly filePath: string;
  private readonly maxEntries: number;
  private rows: BugReportRow[];

  constructor(options: BugReportQueueOptions) {
    this.filePath = options.filePath;
    this.maxEntries = options.maxEntries ?? BUG_REPORT_QUEUE_MAX;
    this.rows = this.load();
  }

  /** Append a row (dropping the oldest when over cap) and persist. Returns
   *  the new depth. */
  enqueue(row: BugReportRow): number {
    this.rows.push(row);
    this.trim();
    this.persist();
    return this.rows.length;
  }

  size(): number {
    return this.rows.length;
  }

  /** The oldest `limit` rows, without removing them. */
  peek(limit: number): BugReportRow[] {
    return this.rows.slice(0, Math.max(0, limit));
  }

  /** Remove the oldest `count` rows (they were accepted by the transport). */
  acknowledge(count: number): void {
    if (count <= 0) return;
    this.rows.splice(0, count);
    this.persist();
  }

  /** Update the occurrence count on the newest queued row for a fingerprint. */
  updateLatestCount(fingerprint: string, count: number): void {
    for (let i = this.rows.length - 1; i >= 0; i -= 1) {
      const row = this.rows[i];
      if (row.fingerprint !== fingerprint) continue;
      this.rows[i] = { ...row, context: { ...row.context, occurrence: count } };
      this.persist();
      return;
    }
  }

  private trim(): void {
    if (this.rows.length > this.maxEntries) {
      this.rows.splice(0, this.rows.length - this.maxEntries);
    }
  }

  private load(): BugReportRow[] {
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(isRow).slice(-this.maxEntries);
    } catch {
      return [];
    }
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      writeFileSync(this.filePath, JSON.stringify(this.rows), 'utf8');
    } catch {
      // A queue that cannot be written to disk must not take the app down.
    }
  }
}

function isRow(value: unknown): value is BugReportRow {
  if (value === null || typeof value !== 'object') return false;
  const row = value as Partial<BugReportRow>;
  return typeof row.fingerprint === 'string' && typeof row.message === 'string';
}

/** A bounded in-memory ring of the last `max` breadcrumbs (default 50). */
export class BreadcrumbRing {
  private readonly max: number;
  private items: unknown[] = [];

  constructor(max = 50) {
    this.max = max;
  }

  push(item: unknown): void {
    this.items.push(item);
    if (this.items.length > this.max) {
      this.items.splice(0, this.items.length - this.max);
    }
  }

  list(): unknown[] {
    return this.items.slice();
  }
}
