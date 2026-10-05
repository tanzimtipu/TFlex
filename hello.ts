// TFlex API - JWT-gated signature image storage in the private `tflex` bucket,
// plus the public bug-report ingest route that writes to `public.bug_reports`.
import { createRemoteJWKSet, jwtVerify } from "jose";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { neon } from "@neondatabase/serverless";

const BUCKET = "tflex";
const MAX_BYTES = 256 * 1024;              // 256 KB cap per signature image
const MAX_REPORT_BYTES = 256 * 1024;       // 256 KB cap per bug-report batch
const REPORT_COLUMNS = [
  "level", "category", "component", "message", "error_name", "stack_trace",
  "fingerprint", "app_version", "build", "environment", "platform", "os_version",
  "arch", "locale", "user_id", "session_id", "breadcrumbs", "context", "handled",
  "occurred_at",
] as const;
const REPORT_REQUIRED_FIELDS = ["level", "category", "component", "message"] as const;
const REPORT_LEVELS = new Set(["fatal", "error", "warning", "info"]);
const MAX_REPORT_ROWS = 50;                // DEF-551: per-batch row cap

// TFL-761: DEF-550 deferred throughput rate limiting. A best-effort, in-process
// fixed-window limiter keyed by client IP. The Function runtime may run several
// warm instances, so this bounds abuse per instance rather than globally; it
// needs no server-side state and no new infrastructure.
const RATE_LIMIT_WINDOW_MS = 60_000;       // one fixed window per minute
const RATE_LIMIT_MAX = 5;                  // accepted requests per IP per window
const RATE_LIMIT_MAX_KEYS = 10_000;        // bound the in-process window map

const jwksUrl = process.env.NEON_AUTH_JWKS_URL;
const authBase = process.env.NEON_AUTH_BASE_URL;
const jwks = jwksUrl ? createRemoteJWKSet(new URL(jwksUrl)) : null;

const s3 = new S3Client({
  forcePathStyle: true,                    // Neon storage requires path-style addressing
  region: process.env.AWS_REGION,
  endpoint: process.env.AWS_ENDPOINT_URL_S3,
});

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

/** A jsonb-bound value is valid when a string parses as JSON, or any value
 *  stringifies without throwing (circular / bigint throw). */
const isJsonAssignable = (value: unknown): boolean => {
  if (typeof value === "string") {
    try {
      JSON.parse(value);
      return true;
    } catch {
      return false;
    }
  }
  try {
    JSON.stringify(value);
    return true;
  } catch {
    return false;
  }
};

/** The caller's IP from the runtime's proxy headers, or null when the runtime
 *  exposes none. A null IP fails the limiter OPEN: a missing header must never
 *  collapse every caller into one bucket and throttle the whole user base. */
function clientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return (
    request.headers.get("x-real-ip")?.trim() ||
    request.headers.get("cf-connecting-ip")?.trim() ||
    null
  );
}

interface RateWindow {
  count: number;
  windowStart: number;
}

const rateLimitWindows = new Map<string, RateWindow>();

/** Fixed-window check: the first `RATE_LIMIT_MAX` requests in each window pass. */
function checkRateLimit(ip: string, now: number): { allowed: boolean; retryAfterSeconds: number } {
  const entry = rateLimitWindows.get(ip);
  if (entry === undefined || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    rateLimitWindows.set(ip, { count: 1, windowStart: now });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  entry.count += 1;
  if (entry.count > RATE_LIMIT_MAX) {
    const remaining = entry.windowStart + RATE_LIMIT_WINDOW_MS - now;
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(remaining / 1000)) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

/** Drop expired windows once the map grows past the cap, then evict oldest. */
function pruneRateLimitWindows(now: number): void {
  if (rateLimitWindows.size <= RATE_LIMIT_MAX_KEYS) return;
  for (const [ip, entry] of rateLimitWindows) {
    if (now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) rateLimitWindows.delete(ip);
  }
  while (rateLimitWindows.size > RATE_LIMIT_MAX_KEYS) {
    const oldest = rateLimitWindows.keys().next().value;
    if (oldest === undefined) break;
    rateLimitWindows.delete(oldest);
  }
}

async function handleBugReports(request: Request): Promise<Response> {
  if (request.method !== "POST") return json({ error: "method-not-allowed" }, 405);

  // TFL-761: throttle before reading or validating the body.
  const now = Date.now();
  const ip = clientIp(request);
  if (ip !== null) {
    const limit = checkRateLimit(ip, now);
    if (!limit.allowed) {
      return new Response(JSON.stringify({ error: "rate-limited" }), {
        status: 429,
        headers: {
          "content-type": "application/json",
          "retry-after": String(limit.retryAfterSeconds),
        },
      });
    }
    pruneRateLimitWindows(now);
  }

  const body = new Uint8Array(await request.arrayBuffer());
  if (body.byteLength > MAX_REPORT_BYTES) return json({ error: "payload-too-large" }, 413);

  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(body));
  } catch {
    return json({ error: "invalid-json" }, 400);
  }
  if (!Array.isArray(parsed)) return json({ error: "expected-array" }, 400);
  if (parsed.length > MAX_REPORT_ROWS) return json({ error: "too-many-rows" }, 400);

  // DEF-551: validate EVERY row before touching the database so a bad row
  // inserts nothing.
  const rows: Record<string, unknown>[] = [];
  for (const row of parsed) {
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      return json({ error: "invalid-row" }, 400);
    }
    const record = row as Record<string, unknown>;
    for (const field of REPORT_REQUIRED_FIELDS) {
      if (!isNonEmptyString(record[field])) return json({ error: `missing-field:${field}` }, 400);
    }
    if (!REPORT_LEVELS.has(record.level as string)) return json({ error: "invalid-level" }, 400);
    if (Object.prototype.hasOwnProperty.call(record, "handled") && typeof record.handled !== "boolean") {
      return json({ error: "invalid-handled" }, 400);
    }
    for (const field of ["breadcrumbs", "context"] as const) {
      if (Object.prototype.hasOwnProperty.call(record, field) && record[field] !== undefined) {
        if (!isJsonAssignable(record[field])) return json({ error: "invalid-row" }, 400);
      }
    }
    rows.push(record);
  }

  if (rows.length === 0) return json({ inserted: 0 });

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return json({ error: "database-unavailable" }, 500);
  const sql = neon(connectionString);

  // DEF-551: one multi-row INSERT is a single atomic statement. Absent columns
  // fall back to the column DEFAULT so the table's defaults are preserved.
  try {
    const params: unknown[] = [];
    const tuples = rows.map((row) => {
      const cells = REPORT_COLUMNS.map((column) => {
        const value = row[column];
        if (!Object.prototype.hasOwnProperty.call(row, column) || value === undefined) {
          return "DEFAULT";
        }
        params.push(
          column === "breadcrumbs" || column === "context"
            ? typeof value === "string" ? value : JSON.stringify(value)
            : value,
        );
        return `$${params.length}`;
      });
      return `(${cells.join(", ")})`;
    });
    await sql.query(
      `insert into public.bug_reports (${REPORT_COLUMNS.join(", ")}) values ${tuples.join(", ")}`,
      params,
    );
  } catch {
    // Never leak the raw Postgres constraint name to an unauthenticated caller.
    return json({ error: "insert-failed" }, 500);
  }
  return json({ inserted: rows.length });
}

async function verifiedUserId(request: Request): Promise<string | null> {
  const auth = request.headers.get("authorization");
  if (!auth?.toLowerCase().startsWith("bearer ") || !jwks) return null;
  try {
    const { payload } = await jwtVerify(auth.slice(7), jwks, {
      issuer: authBase ? new URL(authBase).origin : undefined,
    });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/healthz") {
      return json({
        ok: true,
        authEnv: Boolean(jwksUrl && authBase),
        storageEnv: Boolean(
          process.env.AWS_ACCESS_KEY_ID && process.env.AWS_ENDPOINT_URL_S3 && process.env.AWS_REGION,
        ),
      });
    }

    if (url.pathname === "/bug-reports") {
      return handleBugReports(request);
    }

    const userId = await verifiedUserId(request);
    if (!userId) return json({ error: "unauthorized" }, 401);

    if (request.method === "POST" && url.pathname === "/signatures") {
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) return json({ error: "bad-size" }, 413);
      const key = `signatures/${userId}/${crypto.randomUUID()}.png`;
      await s3.send(new PutObjectCommand({
        Bucket: BUCKET, Key: key, Body: bytes,
        ContentType: request.headers.get("content-type") ?? "image/png",
      }));
      return json({ key });
    }

    if (request.method === "GET" && url.pathname.startsWith("/signatures/")) {
      const key = decodeURIComponent(url.pathname.slice("/signatures/".length));
      if (!key.startsWith(`signatures/${userId}/`)) return json({ error: "forbidden" }, 403);
      const signed = await getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), { expiresIn: 300 });
      return json({ url: signed });
    }

    return json({ error: "not-found" }, 404);
  },
};