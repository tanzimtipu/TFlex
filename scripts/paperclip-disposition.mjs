#!/usr/bin/env node
// Canonical Paperclip board-write helper for every TFlex agent run.
//
// Why this exists: dispositions posted as comments ("Final Disposition: done")
// do NOT change issue state, and hand-written curl / Invoke-WebRequest calls
// keep failing (PowerShell quoting, npm.ps1 policy, and — worst — models
// hallucinating a cloud API host such as api.paperclip.dev, which does not
// exist). This script is the ONLY sanctioned way to write to the board.
//
// Usage (from any Paperclip agent run; env vars are already set by the harness):
//   node scripts/paperclip-disposition.mjs comment "<markdown report>"
//   node scripts/paperclip-disposition.mjs done "<one-line verdict + evidence>"
//   node scripts/paperclip-disposition.mjs cancelled "<reason>"
//   node scripts/paperclip-disposition.mjs in_review "<note>" --owner "<reviewer description>"
//   node scripts/paperclip-disposition.mjs blocked "<why>" --by ISSUE_ID[,ISSUE_ID...] --owner AGENT_ID --action "<concrete action>"
//
// Exits 0 and prints the server result on success; exits 1 with a plain-English
// error on failure. Never prints the API key.

const VALID_STATUSES = new Set(['done', 'cancelled', 'in_review', 'todo', 'blocked', 'in_progress']);

function fail(msg) {
  console.error(`paperclip-disposition: ERROR: ${msg}`);
  process.exit(1);
}

const [mode, ...rest] = process.argv.slice(2);
if (!mode) {
  console.error('usage: node scripts/paperclip-disposition.mjs <comment|done|cancelled|in_review|todo|blocked> "<text>" [--by IDS] [--owner ID] [--action TEXT]');
  process.exit(2);
}

// Parse trailing flags; positional first arg is the text.
let text = '';
const flags = { by: null, owner: null, action: null };
for (let i = 0; i < rest.length; i += 1) {
  const tok = rest[i];
  if (tok === '--by') flags.by = rest[++i];
  else if (tok === '--owner') flags.owner = rest[++i];
  else if (tok === '--action') flags.action = rest[++i];
  else if (!text) text = tok;
  else fail(`unexpected argument: ${tok}`);
}

const apiUrl = (process.env.PAPERCLIP_API_URL || '').trim();
const apiKey = (process.env.PAPERCLIP_API_KEY || '').trim();
const issueId = (process.env.PAPERCLIP_TASK_ID || '').trim();
const runId = (process.env.PAPERCLIP_RUN_ID || '').trim();
const agentId = (process.env.PAPERCLIP_AGENT_ID || '').trim();

if (!apiUrl) fail('PAPERCLIP_API_URL is not set. Only run this inside a Paperclip agent run.');
if (!apiKey) fail('PAPERCLIP_API_KEY is not set. Only run this inside a Paperclip agent run.');
if (!issueId) fail('PAPERCLIP_TASK_ID is not set. Only run this inside a Paperclip agent run.');
if (!/^https?:\/\/127\.0\.0\.1(:\d+)?(\/|$)/.test(apiUrl) && !/^https?:\/\/localhost(:\d+)?(\/|$)/.test(apiUrl)) {
  fail(`PAPERCLIP_API_URL points at "${new URL(apiUrl).host}" — the Paperclip control plane is local (127.0.0.1). Refusing to send the API key elsewhere.`);
}

const base = apiUrl.endsWith('/api') ? apiUrl : apiUrl.replace(/\/?$/, '/api');

async function call(method, path, body) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
      ...(runId ? { 'X-Paperclip-Run-Id': runId } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const textOut = await res.text();
  let parsed = null;
  try { parsed = JSON.parse(textOut); } catch { /* keep raw */ }
  return { status: res.status, ok: res.ok, parsed, raw: textOut.slice(0, 400) };
}

if (mode === 'comment') {
  if (!text) fail('comment mode requires the comment text as the first argument.');
  const r = await call('POST', `/issues/${issueId}/comments`, { body: text });
  if (!r.ok) fail(`comment POST failed: HTTP ${r.status} — ${r.raw}`);
  console.log(`paperclip-disposition: comment posted (HTTP ${r.status}).`);
  process.exit(0);
}

if (!VALID_STATUSES.has(mode)) fail(`unknown mode "${mode}". Valid: comment, ${[...VALID_STATUSES].join(', ')}.`);

const patch = { status: mode };
if (mode === 'blocked') {
  if (flags.by) {
    patch.blockedByIssueIds = flags.by.split(',').map((s) => s.trim()).filter(Boolean);
  }
  const owner = flags.owner || agentId;
  if (!owner) fail('blocked mode needs --owner <agentId> (or a run that sets PAPERCLIP_AGENT_ID).');
  if (!flags.action) fail('blocked mode needs --action "<concrete unblock action>".');
  patch.unblockDescriptor = { owner: { agentId: owner }, action: flags.action };
}

// Attach the explanatory comment to the same status change when provided.
if (text) patch.comment = text;

const r = await call('PATCH', `/issues/${issueId}`, patch);
if (!r.ok) {
  const detail = r.parsed && (r.parsed.error || (r.parsed.details ? JSON.stringify(r.parsed.details) : null));
  fail(`status PATCH failed: HTTP ${r.status} — ${detail || r.raw}`);
}
const ident = r.parsed && (r.parsed.identifier || r.parsed.id) ? (r.parsed.identifier || r.parsed.id) : issueId;
console.log(`paperclip-disposition: issue ${ident} is now "${mode}" (HTTP ${r.status}).`);
if (mode !== 'done' && mode !== 'cancelled') {
  console.log('paperclip-disposition: follow the recorded next action; the board wakes the owner when blockers resolve.');
}
