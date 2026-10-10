#!/usr/bin/env node
// Create a child issue under a parent via Paperclip API.

const apiUrl = (process.env.PAPERCLIP_API_URL || '').trim();
const apiKey = (process.env.PAPERCLIP_API_KEY || '').trim();
const runId = (process.env.PAPERCLIP_RUN_ID || '').trim();

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

// Ensure base ends with /api
const parentId = process.argv[2];
if (!parentId) {
  console.error('usage: node scripts/create-child-issue.mjs <parentId> <title> <description> <assigneeAgentId> <priority> <workMode>');
  process.exit(2);
}

const title = process.argv[3];
const description = process.argv[4];
const assigneeAgentId = process.argv[5];
const priority = process.argv[6];
const workMode = process.argv[7];

const body = {
  title,
  description,
  parentId,
  status: 'todo',
  assigneeAgentId,
  priority: priority || 'medium',
  workMode: workMode || 'standard',
};

const r = await call('POST', '/issues', body);
if (!r.ok) {
  console.error(`Failed to create child issue: HTTP ${r.status} — ${r.raw}`);
  process.exit(1);
}
console.log(r.parsed.id || r.parsed.identifier || 'unknown');
