// Phase 46 - main-process Google sign-in exchange tests.
//
// The exchange is the piece that fixes the operator's stuck sign-in: the
// `file://` renderer cannot see the provider's `SameSite=Lax` session cookie,
// so MAIN reads the cookie and completes `/get-session` + `/token` through the
// session request helper. These tests pin:
//
//   - the happy path: cookie present -> get-session -> token -> vault write;
//   - the failure paths: 401/403 (provider message surfaced verbatim), a
//     missing cookie, a null session, an unreachable host, a vault failure;
//   - the trace shapes: no token / cookie value ever appears;
//   - that the function never throws.
//
// The request helper is a fake session, so no network is touched.

import { describe, expect, it } from 'vitest';
import {
  completeOAuthExchange,
  type OAuthExchangeSession,
} from '../../../src/main/services/accounts/oauth-exchange';
import type {
  OAuthTraceEvent,
  SetSessionPayload,
} from '../../../src/shared/accounts';

// The configured base already ends in `/auth`; the two endpoints hang off it.
const BASE = 'https://auth.example.test/neondb/auth';
const COOKIE_NAME = '__Secure-better-auth.session_token';
const SECRET_TOKEN = 'JWT-SUPER-SECRET-DO-NOT-LEAK';

const USER_BODY = {
  session: { id: 'sess-1', expiresAt: '2099-01-01T00:00:00.000Z' },
  user: {
    id: 'user-1',
    email: 'ada@example.test',
    emailVerified: true,
    name: 'Ada Lovelace',
    image: 'https://cdn.example.test/a.png',
  },
};

function jsonResponse(body: unknown, status = 200, statusText = 'OK'): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'content-type': 'application/json' },
  });
}

type Route = () => Response | Promise<Response>;

interface FakeSession extends OAuthExchangeSession {
  calls: string[];
  inits: ({ method?: string; headers?: Record<string, string> } | undefined)[];
  cookieCalls: number;
}

function makeSession(options: {
  cookies?: { name?: unknown; value?: string }[];
  cookieError?: boolean;
  routes?: Record<string, Route>;
}): FakeSession {
  const calls: string[] = [];
  const inits: ({ method?: string; headers?: Record<string, string> } | undefined)[] = [];
  const session: FakeSession = {
    calls,
    inits,
    cookieCalls: 0,
    cookies: {
      get: async (): Promise<{ name?: unknown }[]> => {
        session.cookieCalls += 1;
        if (options.cookieError === true) throw new Error('cookie store gone');
        return options.cookies ?? [];
      },
    },
    request: async (url, init): Promise<Response> => {
      calls.push(url);
      inits.push(init);
      const route = options.routes?.[url];
      if (route === undefined) throw new Error(`unexpected request: ${url}`);
      return route();
    },
  };
  return session;
}

function makeVault(
  stored: SetSessionPayload[],
  fail = false,
): { setSession(payload: SetSessionPayload): Promise<unknown> } {
  return {
    setSession: async (payload: SetSessionPayload): Promise<unknown> => {
      if (fail) throw new Error('vault unavailable');
      stored.push(payload);
      return { persisted: true, encryptionAvailable: true };
    },
  };
}

function collect(): { traces: OAuthTraceEvent[]; onTrace: (event: OAuthTraceEvent) => void } {
  const traces: OAuthTraceEvent[] = [];
  return { traces, onTrace: (event) => traces.push(event) };
}

const HAPPY_ROUTES: Record<string, Route> = {
  [`${BASE}/get-session`]: () => jsonResponse(USER_BODY),
  [`${BASE}/token`]: () => jsonResponse({ token: SECRET_TOKEN }),
};

describe('completeOAuthExchange - happy path', () => {
  it('reads the cookie, fetches session + token, stores the user and JWT', async () => {
    const session = makeSession({ cookies: [{ name: COOKIE_NAME }], routes: HAPPY_ROUTES });
    const stored: SetSessionPayload[] = [];
    const { traces, onTrace } = collect();

    const outcome = await completeOAuthExchange({
      session,
      vault: makeVault(stored),
      authBaseUrl: BASE,
      onTrace,
    });

    expect(outcome).toEqual({ ok: true });
    // The exact verified paths, off the configured base.
    expect(session.calls).toEqual([`${BASE}/get-session`, `${BASE}/token`]);
    expect(stored).toHaveLength(1);
    expect(stored[0].user).toEqual({
      id: 'user-1',
      email: 'ada@example.test',
      emailVerified: true,
      name: 'Ada Lovelace',
      image: 'https://cdn.example.test/a.png',
    });
    expect(stored[0].token).toBe(SECRET_TOKEN);
    expect(traces.map((event) => event.kind)).toEqual([
      'exchange-cookies',
      'exchange-get-session',
      'exchange-token',
      'exchange-stored',
    ]);
    expect(traces.find((event) => event.kind === 'exchange-cookies')).toMatchObject({
      cookieNames: [COOKIE_NAME],
      cookieCount: 1,
    });
    expect(traces.find((event) => event.kind === 'exchange-get-session')?.status).toBe(200);
    expect(traces.find((event) => event.kind === 'exchange-token')?.status).toBe(200);
  });

  it('normalises a trailing slash on the configured base', async () => {
    const session = makeSession({ cookies: [{ name: COOKIE_NAME }], routes: HAPPY_ROUTES });
    const stored: SetSessionPayload[] = [];
    const outcome = await completeOAuthExchange({
      session,
      vault: makeVault(stored),
      authBaseUrl: `${BASE}/`,
    });
    expect(outcome).toEqual({ ok: true });
    expect(session.calls).toEqual([`${BASE}/get-session`, `${BASE}/token`]);
  });

  it('never leaks the token or cookie value into a trace', async () => {
    const session = makeSession({
      cookies: [{ name: COOKIE_NAME, value: 'COOKIE-SECRET' }],
      routes: HAPPY_ROUTES,
    });
    const { traces, onTrace } = collect();
    await completeOAuthExchange({
      session,
      vault: makeVault([]),
      authBaseUrl: BASE,
      onTrace,
    });
    const dump = JSON.stringify(traces);
    expect(dump).not.toContain(SECRET_TOKEN);
    expect(dump).not.toContain('COOKIE-SECRET');
  });
});

describe('completeOAuthExchange - provider rejections', () => {
  it('surfaces a 401 get-session with the provider message, and never calls /token', async () => {
    const session = makeSession({
      cookies: [{ name: COOKIE_NAME }],
      routes: {
        [`${BASE}/get-session`]: () =>
          jsonResponse({ message: 'Invalid session cookie' }, 401, 'Unauthorized'),
      },
    });
    const stored: SetSessionPayload[] = [];
    const { traces, onTrace } = collect();

    const outcome = await completeOAuthExchange({
      session,
      vault: makeVault(stored),
      authBaseUrl: BASE,
      onTrace,
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.reason).toBe('error');
    expect(outcome.message).toContain('401');
    expect(outcome.message).toContain('Invalid session cookie');
    expect(session.calls).toEqual([`${BASE}/get-session`]);
    expect(stored).toHaveLength(0);
    expect(traces.find((event) => event.kind === 'exchange-failed')?.reason).toBe('session-rejected');
  });

  it('surfaces a 403 token rejection with the provider message', async () => {
    const session = makeSession({
      cookies: [{ name: COOKIE_NAME }],
      routes: {
        [`${BASE}/get-session`]: () => jsonResponse(USER_BODY),
        [`${BASE}/token`]: () => jsonResponse({ message: 'Forbidden by policy' }, 403, 'Forbidden'),
      },
    });
    const stored: SetSessionPayload[] = [];
    const { traces, onTrace } = collect();

    const outcome = await completeOAuthExchange({
      session,
      vault: makeVault(stored),
      authBaseUrl: BASE,
      onTrace,
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.message).toContain('403');
    expect(outcome.message).toContain('Forbidden by policy');
    expect(stored).toHaveLength(0);
    expect(traces.find((event) => event.kind === 'exchange-failed')?.reason).toBe('token-rejected');
  });

  it('falls back to the HTTP status text when the body carries no message', async () => {
    const session = makeSession({
      cookies: [{ name: COOKIE_NAME }],
      routes: {
        [`${BASE}/get-session`]: () => new Response('not json', { status: 500, statusText: 'Internal Server Error' }),
      },
    });
    const outcome = await completeOAuthExchange({
      session,
      vault: makeVault([]),
      authBaseUrl: BASE,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.message).toContain('500');
    expect(outcome.message).toContain('Internal Server Error');
  });
});

describe('completeOAuthExchange - local failures', () => {
  it('fails clearly when no auth-host cookie is present, without calling the network', async () => {
    const session = makeSession({ cookies: [] });
    const stored: SetSessionPayload[] = [];
    const { traces, onTrace } = collect();

    const outcome = await completeOAuthExchange({
      session,
      vault: makeVault(stored),
      authBaseUrl: BASE,
      onTrace,
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.reason).toBe('error');
    expect(outcome.message).toContain('No Neon Auth session cookie');
    expect(session.calls).toEqual([]);
    expect(stored).toHaveLength(0);
    expect(traces.find((event) => event.kind === 'exchange-failed')?.reason).toBe('no-cookie');
  });

  it('fails when the provider answers 200 with a null session', async () => {
    const session = makeSession({
      cookies: [{ name: COOKIE_NAME }],
      routes: { [`${BASE}/get-session`]: () => jsonResponse(null) },
    });
    const outcome = await completeOAuthExchange({
      session,
      vault: makeVault([]),
      authBaseUrl: BASE,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.message).toContain('no usable session');
  });

  it('fails when the provider answers 200 with no token', async () => {
    const session = makeSession({
      cookies: [{ name: COOKIE_NAME }],
      routes: {
        [`${BASE}/get-session`]: () => jsonResponse(USER_BODY),
        [`${BASE}/token`]: () => jsonResponse({}),
      },
    });
    const outcome = await completeOAuthExchange({
      session,
      vault: makeVault([]),
      authBaseUrl: BASE,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.message).toContain('no session token');
  });

  it('reports an honest reachability failure when the request helper throws', async () => {
    const session = makeSession({
      cookies: [{ name: COOKIE_NAME }],
      routes: {
        [`${BASE}/get-session`]: () => {
          throw new TypeError('fetch failed');
        },
      },
    });
    const outcome = await completeOAuthExchange({
      session,
      vault: makeVault([]),
      authBaseUrl: BASE,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.message).toContain('Could not reach Neon Auth');
  });

  it('reports a vault failure instead of leaving the UI waiting', async () => {
    const session = makeSession({ cookies: [{ name: COOKIE_NAME }], routes: HAPPY_ROUTES });
    const stored: SetSessionPayload[] = [];
    const { traces, onTrace } = collect();
    const outcome = await completeOAuthExchange({
      session,
      vault: makeVault(stored, true),
      authBaseUrl: BASE,
      onTrace,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.message).toContain('could not be stored');
    expect(stored).toHaveLength(0);
    expect(traces.find((event) => event.kind === 'exchange-failed')?.reason).toBe('store');
  });

  it('reports a cookie-store read failure', async () => {
    const session = makeSession({ cookieError: true });
    const outcome = await completeOAuthExchange({
      session,
      vault: makeVault([]),
      authBaseUrl: BASE,
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(outcome.message).toContain('Could not read the auth-host cookies');
  });

  it('fails cleanly when accounts are not configured', async () => {
    const session = makeSession({ cookies: [{ name: COOKIE_NAME }] });
    for (const authBaseUrl of [null, '   '] as (string | null)[]) {
      const outcome = await completeOAuthExchange({ session, vault: makeVault([]), authBaseUrl });
      expect(outcome.ok).toBe(false);
      if (outcome.ok) throw new Error('unreachable');
      expect(outcome.message).toContain('not configured');
    }
    expect(session.calls).toEqual([]);
  });
});

describe('completeOAuthExchange - robustness', () => {
  it('never throws for any of the failure paths above', async () => {
    const cases = [
      makeSession({ cookies: [] }),
      makeSession({ cookieError: true }),
      makeSession({ cookies: [{ name: COOKIE_NAME }], routes: { [`${BASE}/get-session`]: () => jsonResponse(null) } }),
      makeSession({ cookies: [{ name: COOKIE_NAME }], routes: { [`${BASE}/get-session`]: () => jsonResponse(USER_BODY), [`${BASE}/token`]: () => jsonResponse({}) } }),
    ];
    for (const session of cases) {
      await expect(
        completeOAuthExchange({ session, vault: makeVault([]), authBaseUrl: BASE }),
      ).resolves.toMatchObject({ ok: false });
    }
  });

  it('the success outcome carries no token, only the coarse shape', async () => {
    const session = makeSession({ cookies: [{ name: COOKIE_NAME }], routes: HAPPY_ROUTES });
    const outcome = await completeOAuthExchange({
      session,
      vault: makeVault([]),
      authBaseUrl: BASE,
    });
    expect(JSON.stringify(outcome)).not.toContain(SECRET_TOKEN);
  });
});

// ---------------------------------------------------------------------------
// Phase 47 - Managed session-verifier flow.
// ---------------------------------------------------------------------------

const VERIFIER = 'verifier-one-time-secret';
const VERIFIER_ROUTES: Record<string, Route> = {
  [`${BASE}/get-session?neon_auth_session_verifier=${VERIFIER}`]: () => jsonResponse(USER_BODY),
  [`${BASE}/token`]: () => jsonResponse({ token: SECRET_TOKEN }),
};

describe('completeOAuthExchange - session verifier (Phase 47)', () => {
  it('presents the one-time verifier on /get-session when one was captured', async () => {
    const session = makeSession({ cookies: [{ name: COOKIE_NAME }], routes: VERIFIER_ROUTES });
    const stored: SetSessionPayload[] = [];
    const outcome = await completeOAuthExchange({
      session,
      vault: makeVault(stored),
      authBaseUrl: BASE,
      sessionVerifier: VERIFIER,
    });
    expect(outcome).toEqual({ ok: true });
    expect(session.calls).toEqual([
      `${BASE}/get-session?neon_auth_session_verifier=${VERIFIER}`,
      `${BASE}/token`,
    ]);
    expect(stored).toHaveLength(1);
  });

  it('calls the plain /get-session when no verifier was captured', async () => {
    const session = makeSession({ cookies: [{ name: COOKIE_NAME }], routes: HAPPY_ROUTES });
    const outcome = await completeOAuthExchange({
      session,
      vault: makeVault([]),
      authBaseUrl: BASE,
      sessionVerifier: null,
    });
    expect(outcome).toEqual({ ok: true });
    expect(session.calls[0]).toBe(`${BASE}/get-session`);
  });

  it('ignores an empty verifier string rather than sending an empty parameter', async () => {
    const session = makeSession({ cookies: [{ name: COOKIE_NAME }], routes: HAPPY_ROUTES });
    const outcome = await completeOAuthExchange({
      session,
      vault: makeVault([]),
      authBaseUrl: BASE,
      sessionVerifier: '   ',
    });
    expect(outcome).toEqual({ ok: true });
    expect(session.calls[0]).toBe(`${BASE}/get-session`);
  });

  it('does not hand-roll an Origin header; the installed webRequest rule supplies it', async () => {
    // The Electron probe (Phase 47) proves session.fetch passes through
    // onBeforeSendHeaders and receives the trusted Origin. The exchange
    // therefore sends no Origin of its own, so the rule stays the single
    // source of that header.
    const session = makeSession({ cookies: [{ name: COOKIE_NAME }], routes: VERIFIER_ROUTES });
    await completeOAuthExchange({
      session,
      vault: makeVault([]),
      authBaseUrl: BASE,
      sessionVerifier: VERIFIER,
    });
    for (const init of session.inits) {
      expect(init?.headers?.Origin).toBeUndefined();
      expect(init?.headers?.origin).toBeUndefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 47 - compact failure diagnostics.
// ---------------------------------------------------------------------------

describe('completeOAuthExchange - diagnostics (Phase 47)', () => {
  it('reports step, status, cookie names and verifier presence on a null session', async () => {
    const session = makeSession({
      cookies: [{ name: COOKIE_NAME, value: 'COOKIE-SECRET' }],
      routes: { [`${BASE}/get-session?neon_auth_session_verifier=${VERIFIER}`]: () => jsonResponse(null) },
    });
    const lines: string[] = [];
    const outcome = await completeOAuthExchange({
      session,
      vault: makeVault([]),
      authBaseUrl: BASE,
      sessionVerifier: VERIFIER,
      onDiagnostic: (detail) => lines.push(detail),
    });
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('unreachable');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('step=no-session');
    expect(lines[0]).toContain('status=200');
    expect(lines[0]).toContain(COOKIE_NAME);
    expect(lines[0]).toContain('verifier=present');
    // The UI message carries the same compact line.
    expect(outcome.message).toContain(lines[0]);
    // No secret ever appears.
    expect(lines[0]).not.toContain('COOKIE-SECRET');
    expect(lines[0]).not.toContain(SECRET_TOKEN);
    expect(lines[0]).not.toContain(VERIFIER);
    expect(outcome.message).not.toContain('COOKIE-SECRET');
    expect(outcome.message).not.toContain(VERIFIER);
  });

  it('reports verifier=absent when the flow set the session cookie directly', async () => {
    const session = makeSession({
      cookies: [{ name: COOKIE_NAME }],
      routes: { [`${BASE}/get-session`]: () => jsonResponse(null) },
    });
    const lines: string[] = [];
    await completeOAuthExchange({
      session,
      vault: makeVault([]),
      authBaseUrl: BASE,
      onDiagnostic: (detail) => lines.push(detail),
    });
    expect(lines[0]).toContain('verifier=absent');
    expect(lines[0]).toContain(`cookies=${COOKIE_NAME}`);
  });

  it('carries the clipped provider message into the diagnostic line', async () => {
    const session = makeSession({
      cookies: [{ name: COOKIE_NAME }],
      routes: {
        [`${BASE}/get-session`]: () =>
          jsonResponse({ message: 'Invalid\nsession cookie' }, 401, 'Unauthorized'),
      },
    });
    const lines: string[] = [];
    await completeOAuthExchange({
      session,
      vault: makeVault([]),
      authBaseUrl: BASE,
      onDiagnostic: (detail) => lines.push(detail),
    });
    expect(lines[0]).toContain('step=session-rejected');
    expect(lines[0]).toContain('status=401');
    expect(lines[0]).toContain('provider="Invalid session cookie"');
    // Flattened to one line: a hostile body cannot forge a second log entry.
    expect(lines[0]).not.toContain('\n');
  });

  it('never calls onDiagnostic on the happy path', async () => {
    const session = makeSession({ cookies: [{ name: COOKIE_NAME }], routes: HAPPY_ROUTES });
    let called = 0;
    await completeOAuthExchange({
      session,
      vault: makeVault([]),
      authBaseUrl: BASE,
      onDiagnostic: () => {
        called += 1;
      },
    });
    expect(called).toBe(0);
  });
});
