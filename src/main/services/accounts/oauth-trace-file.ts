/**
 * Phase 47 - append-only, capped diagnosis log for the Google sign-in exchange.
 *
 * The operator is the only person who can run the real provider flow, so a
 * failure must leave a readable trace on disk. This module writes ONE compact,
 * secret-free line per exchange failure to `oauth-trace.log` in userData.
 *
 * Guarantees, each unit-tested without Electron:
 *  - `redactTraceLine` flattens every control character (including newlines) to
 *    spaces and clips the length, so a hostile provider body cannot inject a
 *    forged log line or grow the file unbounded;
 *  - the file keeps only the most recent `MAX_TRACE_LINES` lines;
 *  - it is best-effort only: a filesystem error never propagates into the
 *    sign-in, and no token, cookie value, OAuth code or verifier is accepted by
 *    this module's callers.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const OAUTH_TRACE_FILE_NAME = 'oauth-trace.log';
/** Longest single log line kept, matching the exchange message cap. */
export const MAX_TRACE_LINE_CHARS = 300;
/** Most recent lines retained; older lines are dropped on append. */
export const MAX_TRACE_LINES = 200;

/**
 * Flatten a line to a single clipped line: control characters (so a newline in
 * a provider message cannot forge an extra entry) become spaces, runs of
 * whitespace collapse, and the result is clipped.
 */
export function redactTraceLine(line: string): string {
  const flat = line
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > MAX_TRACE_LINE_CHARS ? `${flat.slice(0, MAX_TRACE_LINE_CHARS)}...` : flat;
}

/** Keep only the most recent `max` lines (the newest survive a cap). */
export function capTraceLines(lines: readonly string[], max: number = MAX_TRACE_LINES): string[] {
  if (max <= 0) return [];
  return lines.length > max ? lines.slice(lines.length - max) : [...lines];
}

export interface OAuthTraceFileOptions {
  /** userData directory (or any writable directory in tests). */
  dir: string;
  /** The compact diagnosis line; must already be secret-free. */
  line: string;
  now?: number;
  maxLines?: number;
}

/**
 * Append one timestamped diagnosis line and enforce the line cap. Never throws:
 * a diagnostic is a convenience, never a reason a sign-in fails.
 */
export function appendOAuthTraceLine(options: OAuthTraceFileOptions): void {
  try {
    const now = options.now ?? Date.now();
    const entry = `${new Date(now).toISOString()} ${redactTraceLine(options.line)}`;
    if (!existsSync(options.dir)) mkdirSync(options.dir, { recursive: true });
    const file = join(options.dir, OAUTH_TRACE_FILE_NAME);
    appendFileSync(file, `${entry}\n`, 'utf8');
    const max = options.maxLines ?? MAX_TRACE_LINES;
    const lines = readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line.length > 0);
    if (lines.length > max) {
      writeFileSync(file, `${capTraceLines(lines, max).join('\n')}\n`, 'utf8');
    }
  } catch {
    // Best effort only.
  }
}
