/**
 * Phase 101 - stable fingerprint for a captured failure.
 *
 * The fingerprint is a sha256 over `error_name` + the whitespace-normalized
 * message + the TOP stack frame (path-normalized to `basename:line:col`) +
 * `component`. Two identical inputs always hash the same; a different top
 * frame (a different code path) changes the hash, so repeats group and
 * hot-loop amplification can be bounded.
 */

import { createHash } from 'node:crypto';
import type { BugReportInput } from '../../../shared/bugReport';

const FRAME_LINE = /^\s*at\s+(.+?)\s*$/;
const FRAME_LOCATION = /([^/\s():]+):(\d+):(\d+)\)?$/;

/** Stable, path-independent fingerprint of one capture input. */
export function fingerprintOf(input: BugReportInput): string {
  const material = [
    input.errorName ?? '',
    normalizeMessage(input.message),
    topFrame(input.stackTrace),
    input.component,
  ].join('\n');
  return createHash('sha256').update(material, 'utf8').digest('hex');
}

/** Collapse all whitespace runs so equivalent messages hash the same. */
export function normalizeMessage(message: string): string {
  return message.replace(/\s+/g, ' ').trim();
}

/** The first V8 stack frame line, path-normalized, or '' when absent. */
export function topFrame(stackTrace: string | undefined): string {
  if (stackTrace === undefined) return '';
  for (const line of stackTrace.split(/\r?\n/)) {
    const match = FRAME_LINE.exec(line);
    if (match !== null) return normalizeFrame(match[1]);
  }
  return '';
}

/** Drop machine-specific directories, keeping `file:line:col`. */
export function normalizeFrame(frame: string): string {
  const forward = frame.replace(/\\/g, '/');
  const match = FRAME_LOCATION.exec(forward);
  if (match !== null) return `${match[1]}:${match[2]}:${match[3]}`;
  return forward.replace(/\s+/g, ' ').trim();
}
