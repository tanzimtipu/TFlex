// Adversary supervisor: run a probe in a child process and kill it after a
// hard timeout, reporting elapsed, exit code and signal. Keeps dangerous probes
// (declared-max spreadsheet ranges) from wedging the shell.
const { spawn } = require('node:child_process');
const path = require('node:path');

const probe = process.argv[2];
const timeoutMs = Number(process.argv[3]);
const args = process.argv.slice(4);
const start = Date.now();
let peak = 0;
const child = spawn(process.execPath, [probe, ...args], {
  cwd: path.resolve(__dirname, '../../..'),
  env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
child.stdout.on('data', (d) => { out += d.toString(); });
child.stderr.on('data', (d) => { out += d.toString(); });
const sampler = setInterval(() => {
  // Best-effort RSS sampler from the child's own perspective is unavailable;
  // the child prints its own rss. Nothing to do here on Windows.
}, 500);
const timer = setTimeout(() => {
  clearInterval(sampler);
  child.kill('SIGKILL');
  process.stdout.write(out);
  process.stdout.write(`\n[supervisor] KILLED after ${Date.now() - start} ms (hard timeout ${timeoutMs} ms)\n`);
  process.exit(124);
}, timeoutMs);
child.on('exit', (code, signal) => {
  clearTimeout(timer);
  clearInterval(sampler);
  process.stdout.write(out);
  process.stdout.write(`\n[supervisor] exit code=${code} signal=${signal} elapsed=${Date.now() - start} ms\n`);
  process.exit(code === 0 ? 0 : (code ?? 1));
});
