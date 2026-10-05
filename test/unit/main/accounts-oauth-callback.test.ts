// Phase 46 - loopback OAuth callback listener tests.
//
// Uses a REAL ephemeral 127.0.0.1 listener (port 0) rather than a mock: the
// security properties under test are about an actual bound socket - the token
// gate, single-use shutdown, timeout, cancel cleanup, loopback-only bind and
// replacing on a second start. The only stubs are the token generator and the
// timeout, and the IPC wiring is tested against a fake ipcMain.

import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OAUTH_CALLBACK_HOST,
  OAUTH_CALLBACK_PATH,
  OAUTH_CALLBACK_PUBLIC_HOST,
  OAuthCallbackService,
} from '../../../src/main/services/accounts/oauth-callback';
import { registerOAuthCallbackIpc } from '../../../src/main/services/accounts/oauth-callback-ipc';
import { IPC } from '../../../src/shared/ipc';
import type { OAuthCallbackOutcome } from '../../../src/shared/accounts';

const services: OAuthCallbackService[] = [];

afterEach(() => {
  for (const service of services.splice(0)) service.dispose();
});

interface Recorder {
  onOutcome: (outcome: OAuthCallbackOutcome) => void;
  next: () => Promise<OAuthCallbackOutcome>;
  count: () => number;
}

/** Records outcomes in order so a test can await the next one or assert none. */
function recorder(): Recorder {
  const queue: OAuthCallbackOutcome[] = [];
  const waiters: ((outcome: OAuthCallbackOutcome) => void)[] = [];
  let seen = 0;
  return {
    onOutcome: (outcome: OAuthCallbackOutcome): void => {
      seen += 1;
      const waiter = waiters.shift();
      if (waiter) waiter(outcome);
      else queue.push(outcome);
    },
    next: (): Promise<OAuthCallbackOutcome> =>
      queue.length > 0 ? Promise.resolve(queue.shift()!) : new Promise((r) => waiters.push(r)),
    count: (): number => seen,
  };
}

async function start(
  options: ConstructorParameters<typeof OAuthCallbackService>[0] = {},
): Promise<{ service: OAuthCallbackService; rec: Recorder; url: string }> {
  const rec = recorder();
  const service = new OAuthCallbackService({ ...options, onOutcome: rec.onOutcome });
  services.push(service);
  const result = await service.start();
  return { service, rec, url: result.callbackUrl };
}

async function status(url: string, init?: RequestInit): Promise<number | null> {
  try {
    return (await fetch(url, init)).status;
  } catch {
    return null;
  }
}

function withoutQuery(url: string): string {
  const parsed = new URL(url);
  return `${parsed.origin}${parsed.pathname}`;
}

describe('OAuthCallbackService URL', () => {
  it('mints an absolute, ephemeral localhost callback URL with a random token', async () => {
    const { url } = await start();
    const parsed = new URL(url);
    expect(parsed.protocol).toBe('http:');
    // MINTED host: the provider branch trusts `localhost` but rejects 127.0.0.1.
    expect(OAUTH_CALLBACK_PUBLIC_HOST).toBe('localhost');
    expect(parsed.hostname).toBe(OAUTH_CALLBACK_PUBLIC_HOST);
    expect(parsed.pathname).toBe(OAUTH_CALLBACK_PATH);
    expect(parsed.port).not.toBe('');
    expect(Number(parsed.port)).toBeGreaterThan(0);
    const token = parsed.searchParams.get('token');
    // 32 random bytes as base64url is 43 characters and URL-safe.
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url).not.toContain('0.0.0.0');
    expect(url).not.toContain('127.0.0.1');
  });

  it('still binds 127.0.0.1 - the minted localhost URL reaches a 127.0.0.1 socket', async () => {
    const { rec, url } = await start();
    const parsed = new URL(url);
    // Same port / path / token, addressed to the bound loopback interface.
    const loopback = `http://${OAUTH_CALLBACK_HOST}:${parsed.port}${OAUTH_CALLBACK_PATH}${parsed.search}`;
    const response = await fetch(loopback);
    expect(response.status).toBe(200);
    expect(await rec.next()).toEqual({ ok: true });
  });

  it('binds a different ephemeral port per start', async () => {
    const first = await start();
    const second = await start();
    expect(new URL(first.url).port).not.toBe(new URL(second.url).port);
  });

  it('generates a fresh token on every start', async () => {
    const first = await start();
    const second = await start();
    const tokenOf = (u: string): string => new URL(u).searchParams.get('token') ?? '';
    expect(tokenOf(first.url)).not.toBe(tokenOf(second.url));
  });
});

describe('OAuthCallbackService token gate', () => {
  it('answers 200 with the success page for the right token and reports ok', async () => {
    const { rec, url } = await start();
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    const body = await response.text();
    expect(body).toContain('Sign-in complete');
    // Phase 102 - the flow now lands in the in-app sign-in window: the copy
    // names the sign-in window and says the app finishes sign-in itself.
    expect(body).toContain('close this sign-in window');
    expect(body).toContain('Jovrel will finish signing you in');
    expect(body).not.toContain('close this window');
    // Static page only: no scripts and no external resources.
    expect(body).not.toContain('<script');
    expect(body).not.toContain('http');
    expect(await rec.next()).toEqual({ ok: true });
  });

  it('refuses a wrong token with 403 without consuming the flow', async () => {
    const { rec, url } = await start();
    const wrong = url.replace(/token=[^&]+/, 'token=not-the-token');
    expect(await status(wrong)).toBe(403);
    expect(rec.count()).toBe(0);
    // The real redirect can still arrive afterwards.
    expect(await status(url)).toBe(200);
    expect(await rec.next()).toEqual({ ok: true });
  });

  it('refuses a missing token with 403', async () => {
    const { rec, url } = await start();
    expect(await status(withoutQuery(url))).toBe(403);
    expect(rec.count()).toBe(0);
  });

  it('is single-use: a second request after the valid one is refused', async () => {
    const { rec, url } = await start();
    expect(await status(url)).toBe(200);
    expect(await rec.next()).toEqual({ ok: true });
    const after = await status(url);
    // The listener is shut down, so the second request is either refused at
    // the socket or answered 403 - never a second success.
    expect(after === null || after === 403).toBe(true);
  });

  it('answers 404 for a different path and 405 for a non-GET method', async () => {
    const { rec, url } = await start();
    expect(await status(`${new URL(url).origin}/other`)).toBe(404);
    expect(await status(url, { method: 'POST' })).toBe(405);
    expect(rec.count()).toBe(0);
  });
});

describe('OAuthCallbackService lifecycle', () => {
  it('times out after the configured window and reports timeout', async () => {
    const { rec, url } = await start({ timeoutMs: 40 });
    expect(await rec.next()).toEqual({ ok: false, reason: 'timeout' });
    const after = await status(url);
    expect(after === null || after === 403).toBe(true);
  });

  it('stop() cancels, reports cancelled, and cleans up the listener', async () => {
    const { service, rec, url } = await start();
    await service.stop();
    expect(await rec.next()).toEqual({ ok: false, reason: 'cancelled' });
    const after = await status(url);
    expect(after === null || after === 403).toBe(true);
  });

  it('start twice replaces the in-flight listener instead of leaking it', async () => {
    const rec = recorder();
    const service = new OAuthCallbackService({ onOutcome: rec.onOutcome });
    services.push(service);
    const first = await service.start();
    const second = await service.start();
    // The replaced flow is reported cancelled to its caller.
    expect(await rec.next()).toEqual({ ok: false, reason: 'cancelled' });
    expect(first.callbackUrl).not.toBe(second.callbackUrl);
    // The first listener is gone; the second is live and unconsumed.
    expect(await status(first.callbackUrl)).toBeNull();
    expect(await status(second.callbackUrl)).toBe(200);
    expect(await rec.next()).toEqual({ ok: true });
  });

  it('dispose() closes the listener without emitting an outcome', async () => {
    const { service, rec, url } = await start();
    service.dispose();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(rec.count()).toBe(0);
    expect(await status(url)).toBeNull();
  });

  it('never logs the callback URL, token or query string', async () => {
    const spies = (['log', 'info', 'warn', 'error'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    try {
      const { rec, url } = await start();
      const token = new URL(url).searchParams.get('token') ?? '';
      await fetch(url);
      await rec.next();
      for (const spy of spies) {
        expect(spy).not.toHaveBeenCalled();
        for (const call of spy.mock.calls) {
          expect(JSON.stringify(call)).not.toContain(token);
        }
      }
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});

describe('OAuthCallbackService completion URL retention (DEF-365)', () => {
  it('keeps the minted URL available after the valid hit so the popup can match it', async () => {
    const { service, rec, url } = await start();
    expect(await status(url)).toBe(200);
    expect(await rec.next()).toEqual({ ok: true });
    // The listener consumed the flow (single-use), but did-navigate fires after
    // the response, so the matcher must still see the minted URL.
    expect(service.currentCallbackUrl()).toBe(url);
  });

  it('clearCompletionUrl() drops the retained URL (popup closed)', async () => {
    const { service, rec, url } = await start();
    expect(await status(url)).toBe(200);
    await rec.next();
    service.clearCompletionUrl();
    expect(service.currentCallbackUrl()).toBeNull();
  });

  it('drops the retained URL after the grace window', async () => {
    const { service, rec, url } = await start({ completionUrlGraceMs: 25 });
    expect(await status(url)).toBe(200);
    await rec.next();
    expect(service.currentCallbackUrl()).toBe(url);
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(service.currentCallbackUrl()).toBeNull();
  });

  it('a new start supersedes the previous flow URL', async () => {
    const rec = recorder();
    const service = new OAuthCallbackService({ onOutcome: rec.onOutcome });
    services.push(service);
    const first = await service.start();
    expect(await status(first.callbackUrl)).toBe(200);
    await rec.next();
    expect(service.currentCallbackUrl()).toBe(first.callbackUrl);
    const second = await service.start();
    expect(service.currentCallbackUrl()).toBe(second.callbackUrl);
    expect(service.currentCallbackUrl()).not.toBe(first.callbackUrl);
  });

  it('clears the retained URL on timeout and on dispose', async () => {
    const timed = await start({ timeoutMs: 30 });
    expect(await timed.rec.next()).toEqual({ ok: false, reason: 'timeout' });
    expect(timed.service.currentCallbackUrl()).toBeNull();

    const disposed = await start();
    disposed.service.dispose();
    expect(disposed.service.currentCallbackUrl()).toBeNull();
  });
});

describe('registerOAuthCallbackIpc', () => {
  it('registers the two callback channels and delegates to the service', async () => {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const ipc = {
      handle(channel: string, fn: (event: unknown, ...args: unknown[]) => unknown): void {
        handlers.set(channel, fn);
      },
    };
    const start = vi.fn(async () => ({ callbackUrl: 'http://127.0.0.1:41234/oauth/callback?token=t' }));
    const stop = vi.fn(async () => undefined);
    registerOAuthCallbackIpc(ipc as never, { start, stop });

    expect([...handlers.keys()].sort()).toEqual(
      [IPC.accountsStartOAuthCallback, IPC.accountsStopOAuthCallback].sort(),
    );
    await expect(handlers.get(IPC.accountsStartOAuthCallback)!(null)).resolves.toEqual({
      callbackUrl: 'http://127.0.0.1:41234/oauth/callback?token=t',
    });
    await handlers.get(IPC.accountsStopOAuthCallback)!(null);
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Phase 47 - the one-time Managed session verifier.
// ---------------------------------------------------------------------------

describe('OAuthCallbackService session verifier (Phase 47)', () => {
  const VERIFIER = 'one-time-verifier-secret';

  it('captures the verifier from a valid landing and consumes it exactly once', async () => {
    const { service, rec, url } = await start();
    expect(await status(`${url}&neon_auth_session_verifier=${VERIFIER}`)).toBe(200);
    expect(await rec.next()).toEqual({ ok: true });
    expect(service.takeVerifier()).toBe(VERIFIER);
    // Consumed: a second read gets nothing, so the secret is not retained.
    expect(service.takeVerifier()).toBeNull();
  });

  it('returns null when the landing carried no verifier', async () => {
    const { service, rec, url } = await start();
    expect(await status(url)).toBe(200);
    expect(await rec.next()).toEqual({ ok: true });
    expect(service.takeVerifier()).toBeNull();
  });

  it('does not capture a verifier from a refused (wrong token) request', async () => {
    const { service, url } = await start();
    const wrong = url.replace(/token=[^&]+/, 'token=not-the-token');
    expect(await status(`${wrong}&neon_auth_session_verifier=${VERIFIER}`)).toBe(403);
    expect(service.takeVerifier()).toBeNull();
  });

  it('drops a previous flow verifier on a new start', async () => {
    const { service, rec, url } = await start();
    expect(await status(`${url}&neon_auth_session_verifier=${VERIFIER}`)).toBe(200);
    expect(await rec.next()).toEqual({ ok: true });
    // A new flow supersedes the old one before the verifier is consumed.
    await service.start();
    expect(service.takeVerifier()).toBeNull();
  });

  it('clears the verifier on dispose', async () => {
    const { service, rec, url } = await start();
    expect(await status(`${url}&neon_auth_session_verifier=${VERIFIER}`)).toBe(200);
    expect(await rec.next()).toEqual({ ok: true });
    service.dispose();
    expect(service.takeVerifier()).toBeNull();
  });
});
