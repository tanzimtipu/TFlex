import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The location is derived from this helper, never from an agent's inherited cwd.
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const lockPath = path.join(root, '.paperclip-build.lock');
const action = process.argv[2];
const owner = process.env.PAPERCLIP_AGENT_ID;
const run = process.env.PAPERCLIP_RUN_ID;
function readLock() {
  try { return JSON.parse(fs.readFileSync(lockPath, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function fail(message, code = 1) { console.error(message); process.exitCode = code; }
try {
  if (action === 'status') {
    console.log(JSON.stringify({ path: lockPath, lock: readLock() }));
  } else if (!owner || !run) {
    fail('PAPERCLIP_AGENT_ID and PAPERCLIP_RUN_ID are required.');
  } else if (action === 'acquire') {
    let fd;
    try { fd = fs.openSync(lockPath, 'wx'); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const current = readLock();
      if (current?.owner === owner && current?.run === run) {
        console.log(JSON.stringify({ acquired: true, reused: true, lock: current }));
      } else {
        fail(JSON.stringify({ acquired: false, reason: 'busy', lock: current }), 2);
      }
    }
    if (fd !== undefined) {
      const lock = { owner, run, agent: process.env.PAPERCLIP_AGENT_NAME || owner,
        task: process.env.PAPERCLIP_TASK_ID || '', acquired_at: new Date().toISOString() };
      try { fs.writeFileSync(fd, JSON.stringify(lock) + '\n'); fs.fsyncSync(fd); }
      finally { fs.closeSync(fd); }
      console.log(JSON.stringify({ acquired: true, lock }));
    }
  } else if (action === 'release') {
    const current = readLock();
    if (!current) console.log(JSON.stringify({ released: false, reason: 'absent' }));
    else if (current.owner !== owner || current.run !== run) fail('Lock belongs to another run; unchanged.', 2);
    else { fs.unlinkSync(lockPath); console.log(JSON.stringify({ released: true })); }
  } else fail('Usage: node scripts/paperclip-build-lock.mjs acquire|status|release');
} catch (error) { fail(`Lock operation failed; existing lock preserved: ${error.message}`); }
