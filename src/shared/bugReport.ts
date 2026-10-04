/**
 * Phase 101 - always-on bug capture shared contract.
 *
 * The renderer forwards a `BugReportInput` over `bugReport:capture`; the main
 * process fingerprints, redacts and enqueues it, then opportunistically writes
 * it to `public.bug_reports` through the existing Neon Data API transport.
 *
 * `BugReportRecord` mirrors the FIXED table columns exactly (snake_case). The
 * client never sends `id`, `created_at` or `status`: those are server defaults.
 * No document bytes or file contents are ever part of this contract.
 */

export type BugReportLevel = 'fatal' | 'error' | 'warning' | 'info';

export type BugReportCategory =
  | 'uncaught-exception'
  | 'unhandled-rejection'
  | 'ipc-handler'
  | 'renderer-error'
  | 'renderer-rejection'
  | 'renderer-boundary'
  | 'unknown';

export type BugReportComponent = 'main' | 'renderer';

/** What a capture point (main or renderer) hands to the capture service. */
export interface BugReportInput {
  level: BugReportLevel;
  category: BugReportCategory;
  component: BugReportComponent;
  message: string;
  errorName?: string;
  stackTrace?: string;
  handled?: boolean;
  context?: Record<string, unknown>;
}

/** The exact row shape written to `public.bug_reports` (snake_case columns). */
export interface BugReportRecord {
  level: BugReportLevel;
  category: BugReportCategory;
  component: BugReportComponent;
  message: string;
  error_name: string | null;
  stack_trace: string | null;
  fingerprint: string;
  app_version: string;
  build: string | null;
  environment: string;
  platform: string;
  os_version: string | null;
  arch: string | null;
  locale: string | null;
  user_id: string | null;
  session_id: string;
  breadcrumbs: unknown[];
  context: Record<string, unknown>;
  handled: boolean;
  occurred_at: string;
}

/** Result of `bugReport.capture`: `queued` is the current queue depth. */
export interface BugReportCaptureResult {
  ok: boolean;
  queued: number;
}
