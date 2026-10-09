import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const lockPath = path.join(root, '.paperclip-build.lock');
const guardPath = path.join(root, '.paperclip-build.guard');
const action = process.argv[2];
const owner = process.env.PAPERCLIP_AGENT_ID;
const run = process.env.PAPERCLIP_RUN_ID;
const task = process.env.PAPERCLIP_TASK_ID;
function readLock() {
  try { return JSON.parse(fs.readFileSync(lockPath, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function fail(message, code = 1) { console.error(message); process.exitCode = code; }
let guarded = false;
try {
  if (action === 'status') console.log(JSON.stringify({ path: lockPath, lock: readLock() }));
  else if (!owner || !run) fail('PAPERCLIP_AGENT_ID and PAPERCLIP_RUN_ID are required.');
  else if (!['acquire', 'release'].includes(action)) fail('Usage: node scripts/paperclip-build-lock.mjs acquire|status|release');
  else {
    try { fs.mkdirSync(guardPath); guarded = true; fs.writeFileSync(path.join(guardPath, 'pid'), String(process.pid)); }
    catch (error) { if (error.code !== 'EEXIST') throw error; fail('Build lock operation or recovery is in progress; retry later.', 2); }
    if (guarded) {
      const current = readLock();
      if (action === 'release') {
        if (!current) console.log(JSON.stringify({ released: false, reason: 'absent' }));
        else if (current.owner !== owner || current.run !== run) fail('Lock belongs to another run; unchanged.', 2);
        else { fs.unlinkSync(lockPath); console.log(JSON.stringify({ released: true })); }
      } else if (current?.owner === owner && current?.run === run) {
        // Preserve an already-running legacy holder; do not demand a new identity mid-run.
        console.log(JSON.stringify({ acquired: true, reused: true, lock: current }));
      } else if (!task || !/^[a-f0-9-]{36}$/i.test(task)) {
        fail('A concrete PAPERCLIP_TASK_ID is required before acquiring a build lock. Use an assigned issue run; do not invent a task ID.');
      } else if (current) fail(JSON.stringify({ acquired: false, reason: 'busy', lock: current }), 2);
      else {
        const fd = fs.openSync(lockPath, 'wx');
        const lock = { owner, run, agent: process.env.PAPERCLIP_AGENT_NAME || owner, task, acquired_at: new Date().toISOString() };
        try { fs.writeFileSync(fd, JSON.stringify(lock) + '\n'); fs.fsyncSync(fd); }
        finally { fs.closeSync(fd); }
        console.log(JSON.stringify({ acquired: true, lock }));
      }
    }
  }
} catch (error) { fail(`Lock operation failed; existing lock preserved: ${error.message}`); }
finally { if (guarded) { fs.rmSync(path.join(guardPath, 'pid'), { force: true }); fs.rmdirSync(guardPath); } }
