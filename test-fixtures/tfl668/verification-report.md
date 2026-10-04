# TFL-668 — Focused verification: OAuth cookie-attachment change (TFL-667)

Verdict: PASS (all numbered items).

## Commands and results

1. `npm.cmd run test:unit -- test/unit/main/phase46OAuthExchange.test.ts`
   - Test Files 1 passed (1); Tests 23 passed (23); 0 failed. PASS.
2. `npm.cmd run test:unit -- test/unit/main/phase47OAuthCompletion.test.ts`
   - Test Files 1 passed (1); Tests 2 passed (2); 0 failed. PASS.
3. `npm.cmd run test:unit -- test/unit/main/accounts.test.ts test/unit/main/accounts-oauth-callback.test.ts test/unit/main/accounts-origin-header.test.ts test/unit/main/phase46OAuthTrace.test.ts test/unit/main/phase47OAuthTraceFile.test.ts`
   - Test Files 5 passed (5); Tests 88 passed (88); 0 failed. PASS (blast radius).
4. `npm.cmd run verify`
   - `conventions: clean (344 source file(s) scanned)`; `tsc --noEmit -p tsconfig.json` exit 0. PASS.

## Diff check

- `git diff --ignore-cr-at-eol -- src/main/services/accounts/oauth-exchange.ts`
  - Only: comment text, widened `request` init type (adds `credentials?: 'omit' | 'same-origin' | 'include'`),
    and `credentials: 'include'` on both `/get-session` and `/token` calls. PASS.
- `git diff --ignore-cr-at-eol -- test/unit/main/phase46OAuthExchange.test.ts`
  - Only: widened `inits` type on the `FakeSession` interface and the local `inits` array,
    plus the new `session.inits` assertion. PASS.
- Genuine oracle: PASS. Assertion text:
  `expect(session.inits).toEqual([{ method: 'GET', credentials: 'include' }, { method: 'GET', credentials: 'include' }])`
  Pre-change code passed `{ method: 'GET' }`, so this assertion would fail without the change.

## Line-ending churn (not fixed)

`git ls-files --eol` reports both files as `i/lf w/mixed`: the worktree files carry CRLF
churn, so plain `git diff` shows 328/317 and 16/5 line churn instead of the small real
deltas. `--ignore-cr-at-eol` isolates the real change. The phase-close commit should
normalize CRLF to LF on both files.

## Scope notes

No source/test files edited by QA. No live Google flow, no packaged-app launch, no
`verify:full`, no full unit suite (per task DO-NOTs).
