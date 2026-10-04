// DEF-549 retest (TFL-764) - a bare provider API key with no `key=value`
// separator must be redacted before the row is queued/transmitted.
//
// Exact prior failure (TFL-762): the queued/transmitted row message was
//   `token sk-abc123 Authorization=[redacted] [redacted]`
// and the bare `sk-abc123` still reached the row. This spec drives the real
// application end to end through the renderer bridge
// (`window.tflex.bugReport.capture(...)`), then reads the persisted
// `{userData}/bug-reports-queue.json` - the exact payload the transport takes
// (`runFlush` sends `queue.peek(batchSize)`). It also re-confirms the already
// passing classes and the ordinary-hyphenated-word guard.
//
// Launched ONLY through the canonical e2e/lib/launch.cjs `launchApp`.
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { launchApp } = require('./lib/launch.cjs');

// The Paperclip/kimi harness exports ELECTRON_RUN_AS_NODE=1; launchApp spreads
// process.env, so Electron would otherwise exit as Node.
delete process.env.ELECTRON_RUN_AS_NODE;

const OUT_DIR = path.join(__dirname, '..', 'screenshots', 'phase101-qa');
const OUT_FILE = path.join(OUT_DIR, 'p101-qa-redaction.json');

const EXACT = 'token sk-abc123 Authorization=[redacted] [redacted]';
const CLASSES = 'jwt eyJx.y.z pw password=hunter2 key apiKey=SECRETKEY';
const HYPHENS = 'risk-assessment desk-lamp task-list';

test.setTimeout(120000);

test('DEF-549 - bare provider key is redacted end to end', async () => {
  const userDataDir = path.join(os.tmpdir(), `tflex-def549-${Date.now()}`);
  fs.mkdirSync(userDataDir, { recursive: true });
  // A local stub recorder stands in for the public route so the test can read
  // the EXACT transmitted POST body (the prior TFL-762 retest used the same
  // technique), not only the queued row.
  const received = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (req.url === '/bug-reports') {
        received.push(body);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"inserted":0}');
      } else {
        res.writeHead(404);
        res.end();
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  process.env.TFLEX_FUNCTION_API_URL = `http://127.0.0.1:${server.address().port}`;
  const app = await launchApp([], userDataDir);
  const evidence = { issue: 'TFL-764', defect: 'DEF-549', at: new Date().toISOString(), vectors: {} };
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('.sample-card', { timeout: 30000 });

    const results = await page.evaluate(
      async (v) => {
        const r1 = await window.tflex.bugReport.capture({
          level: 'error', category: 'unknown', component: 'renderer', message: v.exact,
        });
        const r2 = await window.tflex.bugReport.capture({
          level: 'error', category: 'unknown', component: 'renderer',
          message: v.classes, context: { password: 'hunter2' },
        });
        const r3 = await window.tflex.bugReport.capture({
          level: 'error', category: 'unknown', component: 'renderer', message: v.hyphens,
        });
        return { r1, r2, r3 };
      },
      { exact: EXACT, classes: CLASSES, hyphens: HYPHENS },
    );

    // Read immediately: the debounced flush is 2000 ms, so the queued rows are
    // still present and are exactly what the transport would transmit. The
    // queue file is read from the host process at the app's own userData path.
    const resolvedUserData = await app.evaluate(({ app: electronApp }) => electronApp.getPath('userData'));
    const queueJson = fs.readFileSync(path.join(resolvedUserData, 'bug-reports-queue.json'), 'utf8');
    const rows = JSON.parse(queueJson);
    const exactRow = rows.find((r) => typeof r.message === 'string' && r.message.includes('token'));
    const classRow = rows.find((r) => typeof r.message === 'string' && r.message.includes('password='));
    const guardRow = rows.find((r) => typeof r.message === 'string' && r.message.includes('risk-assessment'));

    // Let the 2000 ms debounce fire; the stub recorder then holds the exact
    // POST body the app transmitted toward the public route.
    await page.waitForTimeout(3500);
    const transmitted = received.join('\n');

    evidence.userDataDir = resolvedUserData;
    evidence.captureResults = results;
    evidence.rows = rows;
    evidence.transmitted = {
      requests: received.length,
      bodies: received,
      skGone: !transmitted.includes('sk-abc123'),
      surroundingsInTact: transmitted.includes('token') && transmitted.includes('Authorization='),
      classesGone: !transmitted.includes('hunter2') && !transmitted.includes('SECRETKEY') && !transmitted.includes('eyJx.y.z'),
    };
    evidence.vectors = {
      bareKey: {
        input: EXACT,
        output: exactRow ? exactRow.message : null,
        skGone: exactRow ? !exactRow.message.includes('sk-abc123') : false,
        contextInTact: exactRow ? exactRow.message.includes('token') && exactRow.message.includes('Authorization=') : false,
      },
      jwt: { input: 'eyJx.y.z', output: classRow ? classRow.message : null, gone: classRow ? !classRow.message.includes('eyJx.y.z') : false },
      passwordEq: { input: 'password=hunter2', output: classRow ? classRow.message : null, gone: classRow ? !classRow.message.includes('hunter2') : false },
      apiKeyEq: { input: 'apiKey=SECRETKEY', output: classRow ? classRow.message : null, gone: classRow ? !classRow.message.includes('SECRETKEY') : false },
      contextPassword: { input: 'context.password=hunter2', output: classRow ? classRow.context.password : null, gone: classRow ? classRow.context.password === '[redacted]' : false },
      hyphenGuard: { input: HYPHENS, output: guardRow ? guardRow.message : null, intact: guardRow ? guardRow.message === HYPHENS : false },
    };
    evidence.queuedCount = rows.length;
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(OUT_FILE, JSON.stringify(evidence, null, 2), 'utf8');

    expect(results.r1.ok, 'exact-vector capture accepted').toBe(true);
    expect(results.r2.ok, 'class-vector capture accepted').toBe(true);
    expect(results.r3.ok, 'guard-vector capture accepted').toBe(true);
    expect(rows, 'all three captures queued').toHaveLength(3);

    expect(exactRow, 'exact DEF-549 row is present').toBeTruthy();
    expect(exactRow.message, 'bare sk-abc123 must be gone').not.toContain('sk-abc123');
    expect(exactRow.message, 'no sk- prefix may survive').not.toContain('sk-');
    expect(exactRow.message, 'surrounding text intact').toContain('token');
    expect(exactRow.message, 'Authorization= kept').toContain('Authorization=');
    expect(exactRow.message, 'redaction marker present').toContain('[redacted]');

    expect(classRow, 'class row is present').toBeTruthy();
    expect(classRow.message).not.toContain('eyJx.y.z');
    expect(classRow.message).not.toContain('hunter2');
    expect(classRow.message).not.toContain('SECRETKEY');
    expect(classRow.message).toContain('password=[redacted]');
    expect(classRow.message).toContain('apiKey=[redacted]');
    expect(classRow.context.password).toBe('[redacted]');

    expect(guardRow, 'hyphen-guard row is present').toBeTruthy();
    expect(guardRow.message, 'ordinary hyphenated words must not be redacted').toBe(HYPHENS);

    expect(received.length, 'at least one POST reached the stub route').toBeGreaterThanOrEqual(1);
    expect(transmitted, 'transmitted body must not contain sk-abc123').not.toContain('sk-abc123');
    expect(transmitted, 'transmitted body keeps surrounding text').toContain('Authorization=');
    expect(transmitted, 'transmitted body carries the redaction marker').toContain('[redacted]');
    expect(transmitted, 'transmitted body leaks no other secret class').not.toContain('hunter2');
    expect(transmitted).not.toContain('SECRETKEY');
    expect(transmitted).not.toContain('eyJx.y.z');
  } finally {
    if (app) await app.close().catch(() => undefined);
    await new Promise((resolve) => server.close(resolve));
  }
});
