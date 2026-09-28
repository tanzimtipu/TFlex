// Phase 47 - oauth-trace.log shape, cap and redaction tests.
//
// The log is the operator's only view of a failed main-side exchange, so these
// tests pin the two properties that keep it safe and bounded: every entry is a
// single clipped line (a hostile provider message cannot forge a second entry)
// and the file keeps only the most recent lines.

import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendOAuthTraceLine,
  capTraceLines,
  MAX_TRACE_LINE_CHARS,
  OAUTH_TRACE_FILE_NAME,
  redactTraceLine,
} from '../../../src/main/services/accounts/oauth-trace-file';

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tflex-oauth-trace-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function readLines(dir: string): string[] {
  return readFileSync(join(dir, OAUTH_TRACE_FILE_NAME), 'utf8')
    .split('\n')
    .filter((line) => line.length > 0);
}

describe('redactTraceLine', () => {
  it('flattens newlines and control characters to a single space', () => {
    expect(redactTraceLine('first\nsecond\r\nthird\tfourth\u0000')).toBe('first second third fourth');
  });

  it('clips an over-long line', () => {
    const long = 'x'.repeat(MAX_TRACE_LINE_CHARS + 50);
    const result = redactTraceLine(long);
    expect(result.length).toBe(MAX_TRACE_LINE_CHARS + 3);
    expect(result.endsWith('...')).toBe(true);
  });
});

describe('capTraceLines', () => {
  it('keeps the most recent lines when over the cap', () => {
    expect(capTraceLines(['a', 'b', 'c', 'd'], 2)).toEqual(['c', 'd']);
  });

  it('returns a copy unchanged when under the cap', () => {
    expect(capTraceLines(['a', 'b'], 5)).toEqual(['a', 'b']);
  });

  it('drops everything for a non-positive cap', () => {
    expect(capTraceLines(['a', 'b'], 0)).toEqual([]);
  });
});

describe('appendOAuthTraceLine', () => {
  it('writes one timestamped, single-line entry per call', () => {
    const dir = tempDir();
    appendOAuthTraceLine({ dir, line: 'step=no-session status=200 cookies=none', now: 0 });
    // A provider message with a newline cannot forge a second entry.
    appendOAuthTraceLine({
      dir,
      line: 'step=session-rejected provider="bad\n2020-01-01 forged"',
      now: 1000,
    });
    const lines = readLines(dir);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('1970-01-01T00:00:00.000Z');
    expect(lines[0]).toContain('step=no-session');
    expect(lines[1]).toContain('step=session-rejected');
    expect(lines[1]).not.toContain('\n');
  });

  it('caps the file to the most recent lines', () => {
    const dir = tempDir();
    for (let i = 0; i < 7; i += 1) {
      appendOAuthTraceLine({ dir, line: `entry-${i}`, maxLines: 3, now: i });
    }
    const lines = readLines(dir);
    expect(lines).toHaveLength(3);
    expect(lines.map((line) => line.slice(-7))).toEqual(['entry-4', 'entry-5', 'entry-6']);
  });

  it('never throws when the directory cannot be created', () => {
    expect(() =>
      appendOAuthTraceLine({ dir: join(tempDir(), 'nested', '\u0000bad'), line: 'x' }),
    ).not.toThrow();
  });
});
