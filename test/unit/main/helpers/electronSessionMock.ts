/**
 * DEF-364 - the ONE electron `session` mock for tests that load
 * `src/main/index.ts`.
 *
 * `index.ts` start() uses the default session in three places:
 *   - `session.defaultSession.fetch`            (the main-process exchange),
 *   - `session.defaultSession.cookies`          (the exchange's cookie probe),
 *   - `session.defaultSession.webRequest.onBeforeSendHeaders`
 *                                               (the auth Origin header rule).
 * Every test that mocks 'electron' and imports index.ts must expose this whole
 * surface. Before this helper each such test carried its own copy, so adding a
 * new `session.*` call broke every copy that was not swept (DEF-364 is the
 * fourth instance of that class). Add new session members HERE, once, and both
 * call sites get them:
 *   - test/unit/main/index.test.ts
 *   - test/unit/main/def300OpenPathRouting.test.ts
 */
import { vi } from 'vitest';

export type MockFn = ReturnType<typeof vi.fn>;

export interface ElectronSessionMock {
  defaultSession: {
    webRequest: { onBeforeSendHeaders: MockFn };
    cookies: { get: MockFn };
    fetch: MockFn;
  };
}

/**
 * Build the `session` slice of the electron mock. `onBeforeSendHeaders` is
 * passed in so a test can assert on the auth Origin rule's listener; it
 * defaults to a fresh mock when a test does not care.
 */
export function createElectronSessionMock(
  onBeforeSendHeaders: MockFn = vi.fn(),
): ElectronSessionMock {
  return {
    defaultSession: {
      webRequest: { onBeforeSendHeaders },
      cookies: { get: vi.fn().mockResolvedValue([]) },
      fetch: vi.fn(),
    },
  };
}
