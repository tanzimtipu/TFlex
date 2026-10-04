/**
 * Phase 101 - pure redaction of a capture's free-form context and strings.
 *
 * `redactValue` never mutates its input: it returns a deep copy with secrets
 * removed. It strips Bearer/JWT tokens, masks any object key matching
 * `token|password|secret|authorization|api[-_]?key`, masks `key=value` /
 * `key: value` pairs in strings, strips bare provider API keys (e.g. `sk-...`)
 * that appear with no `key=value` separator (DEF-549), and replaces the OS
 * user name with `<user>`.
 * Document bytes and file contents are never part of a capture, so they cannot
 * reach here.
 */

import { userInfo } from 'node:os';

const SENSITIVE_KEY = /token|password|secret|authorization|api[-_]?key/i;
const JWT = /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const KEY_VALUE =
  /(authorization|password|passwd|secret|token|api[-_]?key)\s*[=:]\s*("[^"]*"|'[^']*'|[^\s,;]+)/gi;
// DEF-549: bare provider API keys with no `key=value` separator. Curated
// prefixes so ordinary hyphenated words are not eaten (requires the separator
// for `sk`/`pk`/... , and a long opaque tail for the separator-less ones).
const PROVIDER_KEY =
  /\b(?:(?:sk|pk|rk|ghp|gho|ghs|ghu|ghr|glpat|npm|pypi|whsec|shpat|github_pat|xoxb|xoxp|xoxa|xoxr|xoxs)[-_][A-Za-z0-9_-]{6,}|AIza[A-Za-z0-9_-]{20,}|(?:AKIA|ASIA)[A-Z0-9]{12,}|ya29\.[A-Za-z0-9_-]{20,})\b/g;
const REDACTED = '[redacted]';

/** Return a redacted deep copy of `value`. The input is never modified. */
export function redactValue(value: unknown): unknown {
  return redact(value, currentUserName(), new WeakSet<object>());
}

function redact(value: unknown, userName: string | null, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return redactString(value, userName);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => redact(item, userName, seen));
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(key)) {
      out[key] = REDACTED;
      continue;
    }
    out[key] = redact(item, userName, seen);
  }
  return out;
}

/** Redact every secret class from a single string. */
export function redactString(text: string, userName: string | null = null): string {
  let out = text.replace(JWT, REDACTED).replace(BEARER, REDACTED);
  out = out.replace(PROVIDER_KEY, REDACTED);
  out = out.replace(KEY_VALUE, (_match, key: string) => `${key}=${REDACTED}`);
  const user = userName ?? currentUserName();
  if (user !== null && user.length > 0) out = out.split(user).join('<user>');
  return out;
}

let cachedUserName: string | null | undefined;

function currentUserName(): string | null {
  if (cachedUserName !== undefined) return cachedUserName;
  try {
    const name = userInfo().username;
    cachedUserName = name.length > 0 ? name : null;
  } catch {
    cachedUserName = null;
  }
  return cachedUserName;
}
