/**
 * Regression test for the orchestrator guard. Run it after ANY edit to the
 * guard module in `~/.dsh/.agent-presets/tflex-orchestrator/`:
 *
 *   node .dsh/guard.selftest.mjs
 *
 * Update the URL below when the guard's `.vN` suffix is bumped - the two must
 * name the same file, or this test silently checks an older module.
 *
 * It imports the real module, drives its `tools/pre-execute` listener with a
 * fake context, and asserts each decision: the ledger allow-list, the
 * full-suite refusals, the filtered runs that must stay allowed, the polling
 * refusal, and the sub-agent and unknown-caller cases that must never be
 * blocked. Exits non-zero on any failure so it can gate a change.
 */
const url = 'file:///C:/Users/tanzi/.dsh/.agent-presets/tflex-orchestrator/orchestrator-guard.v8.js'
const mod = await import(url)

const ROOT = { id: 'root-orchestrator' }
const CHILD = { id: 'child-developer' }

/**
 * A shell that always reports a successful start. The model pre-flight fails
 * CLOSED when it cannot confirm the endpoint, so without this stub the
 * local-dispatch cases would depend on whether the real server happens to be
 * running - a flaky test. With it, they are deterministic either way: if the
 * endpoint answers, the pre-flight short-circuits; if not, this stub stands in.
 */
const SHELL_STUB = {
  resolve: request => ({
    command: request.command,
    workdir: request.workdir ?? '',
    timeoutMs: request.timeoutMs ?? 0,
    stdoutMaxBytes: 0,
    sandboxPolicy: undefined,
  }),
  run: async () => ({
    exitCode: 0,
    signal: null,
    timedOut: false,
    aborted: false,
    timeoutMs: 0,
    stdout: { text: '', truncated: false },
    stderr: { text: '', truncated: false },
  }),
}

let captured
const ctx = {
  get(name) {
    if (name === 'agents') return { roots: () => [ROOT] }
    if (name === 'shell') return SHELL_STUB
    return undefined
  },
  on(event, listener) {
    captured = listener
  },
}

mod.apply(ctx)
if (typeof captured !== 'function') throw new Error('guard did not register a tools/pre-execute listener')

const next = async () => ({ kind: 'allow' })
const NO_AGENT = Symbol('no-agent')
const decide = async (name, args, agent) => {
  const caller = agent === NO_AGENT ? undefined : (agent ?? ROOT)
  const decision = await captured({ name, arguments: args, agent: caller, signal: undefined }, next)
  return decision.kind === 'allow' ? 'allow' : decision.kind
}

const TFLEX = 'C:\\Users\\tanzi\\OneDrive\\App Development\\TFlex'
const cases = [
  ['write src file', 'write', { file_path: `${TFLEX}\\src\\renderer\\App.tsx` }, ROOT, 'deny'],
  ['edit src file via path', 'edit', { path: `${TFLEX}\\src\\main\\services\\engine.ts` }, ROOT, 'deny'],
  ['write package.json', 'write', { file_path: `${TFLEX}\\package.json` }, ROOT, 'deny'],
  ['write AGENTS.md', 'write', { file_path: `${TFLEX}\\AGENTS.md` }, ROOT, 'deny'],
  ['write DEFECTS.md', 'write', { file_path: `${TFLEX}\\DEFECTS.md` }, ROOT, 'allow'],
  ['edit ADVERSARIAL_REVIEW.md', 'edit', { file_path: `${TFLEX}\\ADVERSARIAL_REVIEW.md` }, ROOT, 'allow'],
  ['write docs/FEATURE-BACKLOG.md', 'write', { file_path: `${TFLEX}\\docs\\FEATURE-BACKLOG.md` }, ROOT, 'allow'],
  ['write AGENTS_NOTES.md', 'write', { file_path: `${TFLEX}\\AGENTS_NOTES.md` }, ROOT, 'allow'],
  ['write REQUIREMENTS.md relative', 'write', { file_path: 'REQUIREMENTS.md' }, ROOT, 'allow'],
  ['write FEATURE-BACKLOG from another repo', 'write', { file_path: 'C:\\other\\DEFECTS.md' }, ROOT, 'allow'],
  ['full unit suite', 'pwsh', { command: 'npm run test:unit' }, ROOT, 'deny'],
  ['full unit suite piped', 'pwsh', { command: 'npm run test:unit | Select-Object -Last 5' }, ROOT, 'deny'],
  ['verify:full', 'pwsh', { command: 'npm.cmd run verify:full' }, ROOT, 'deny'],
  ['bare playwright', 'pwsh', { command: 'npx playwright test' }, ROOT, 'deny'],
  ['filtered unit suite', 'pwsh', { command: 'npm run test:unit -- --grep "settings"' }, ROOT, 'allow'],
  ['typecheck', 'pwsh', { command: 'npm run typecheck' }, ROOT, 'allow'],
  ['one e2e spec', 'pwsh', { command: 'npm run test:e2e -- e2e/overlays.spec.ts' }, ROOT, 'allow'],
  ['git status', 'pwsh', { command: 'git status --short' }, ROOT, 'allow'],
  // Managing the local server is not using it: these must never be denied, and the
  // guard must not try to LOAD the model on a stop (that would load it just to unload).
  ['model stop is allowed', 'pwsh', { command: 'powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ninfer-model.ps1 stop' }, ROOT, 'allow'],
  ['model start is allowed', 'pwsh', { command: 'powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ninfer-model.ps1 start' }, ROOT, 'allow'],
  ['model status is allowed', 'pwsh', { command: 'powershell -NoProfile -ExecutionPolicy Bypass -File scripts/ninfer-model.ps1 status' }, ROOT, 'allow'],
  ['read tool', 'read', { file_path: `${TFLEX}\\src\\renderer\\App.tsx` }, ROOT, 'allow'],
  ['polling via list_agents', 'list_agents', {}, ROOT, 'deny'],
  ['resume via send_message', 'send_message', { agent_id: 'child-1', message: 'continue' }, ROOT, 'allow'],
  ['stop via interrupt_agent', 'interrupt_agent', { agent_id: 'child-1' }, ROOT, 'allow'],
  ['child polls list_agents', 'list_agents', {}, CHILD, 'allow'],
  // The four local dispatches must never be DENIED outright - a refusal here would
  // make a local role undispatchable. With the fake context there is no `shell`
  // service, so the model pre-flight is skipped and the call is allowed whichever
  // way the endpoint answers; that is exactly the property being locked in.
  ['local dispatch backend', 'dispatch_backend_dev', { description: 'x', prompt: 'y' }, ROOT, 'allow'],
  ['local dispatch frontend', 'dispatch_frontend_dev', { description: 'x', prompt: 'y' }, ROOT, 'allow'],
  ['local dispatch adversary', 'dispatch_adversary', { description: 'x', prompt: 'y' }, ROOT, 'allow'],
  ['local dispatch git-agent', 'dispatch_git_agent', { description: 'x', prompt: 'y' }, ROOT, 'allow'],
  ['qa dispatch (local)', 'dispatch_qa', { description: 'x', prompt: 'y' }, ROOT, 'allow'],
  // A developer dispatch must stay RESUMABLE: run_in_background false would make it
  // a one-shot run with no durable child id, so send_message could never resume it.
  ['developer opted out of resumable', 'dispatch_backend_dev', { description: 'x', prompt: 'y', run_in_background: false }, ROOT, 'deny'],
  ['frontend opted out of resumable', 'dispatch_frontend_dev', { description: 'x', prompt: 'y', run_in_background: false }, ROOT, 'deny'],
  ['qa opted out of resumable', 'dispatch_qa', { description: 'x', prompt: 'y', run_in_background: false }, ROOT, 'deny'],
  ['developer explicit background', 'dispatch_backend_dev', { description: 'x', prompt: 'y', run_in_background: true }, ROOT, 'allow'],
  // Every LOCAL role is resumable now, so the opt-out is refused on all five.
  ['adversary opted out of resumable', 'dispatch_adversary', { description: 'x', prompt: 'y', run_in_background: false }, ROOT, 'deny'],
  ['git-agent opted out of resumable', 'dispatch_git_agent', { description: 'x', prompt: 'y', run_in_background: false }, ROOT, 'deny'],
  // feature-scout is the only one-shot row left, so the flag is meaningless-but-harmless there.
  ['scout false is fine', 'dispatch_feature_scout', { description: 'x', prompt: 'y', run_in_background: false }, ROOT, 'allow'],
  ['scout explicit background', 'dispatch_feature_scout', { description: 'x', prompt: 'y', run_in_background: true }, ROOT, 'allow'],
  ['child writes src', 'write', { file_path: `${TFLEX}\\src\\renderer\\App.tsx` }, CHILD, 'allow'],
  ['child runs full suite', 'pwsh', { command: 'npm run test:unit' }, CHILD, 'allow'],
  ['unknown caller writes src', 'write', { file_path: `${TFLEX}\\src\\renderer\\App.tsx` }, NO_AGENT, 'allow'],
]

let failures = 0
for (const [label, name, args, agent, expected] of cases) {
  const actual = await decide(name, args, agent)
  const ok = actual === expected
  if (!ok) failures += 1
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(38)} ${actual}${ok ? '' : ` (expected ${expected})`}`)
}
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURE(S)`)
if (failures !== 0) process.exit(1)
