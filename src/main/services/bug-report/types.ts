/**
 * Phase 101 - internal types for the bug-report service (main process only).
 */

import type { BugReportRecord } from '../../../shared/bugReport';

/** The persisted/inserted row is exactly the shared record shape. */
export type BugReportRow = BugReportRecord;

export type BugReportErrorKind = 'offline' | 'server' | 'permanent';

/** Thrown by the transport so the flush loop can tell "network unreachable"
 *  (offline) and "server rejected, retryable" (server) from "server rejected
 *  the payload itself" (permanent). Mirrors `SyncTransportError`. */
export class BugReportTransportError extends Error {
  constructor(
    public readonly kind: BugReportErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'BugReportTransportError';
  }
}

/** The one operation the capture core needs from a transport. */
export interface BugReportTransport {
  insertRecords(rows: BugReportRow[]): Promise<void>;
}
