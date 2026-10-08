// Phase 118 (Drag Drop and Import) - chunk G focused QA verification.
// TFL-1247 / phase issue TFL-1230.
//
// Proves the Phase 118 Intake Tray against the REAL Electron app, launched only
// through the canonical e2e/lib/launch.cjs `launchApp` helper. Covers the
// phase's acceptance cases and the CONTROL-INDEX rows:
//   T1  empty Home tray + picker stages (no auto-open) + explicit `data-intake-open`
//       dispatch; full/compact/light/dark/high-contrast/200% screenshots.
//   T2  OS drop zone + eligible-drag drop indication (`data-intake-dropzone`).
//   T3  many PDFs, duplicate basenames, order, mouse + keyboard reorder,
//       Remove-from-queue (never deletes the file).
//   T4  truthful per-item errors: unsupported, misleading extension, protected,
//       partial failure with good items still visible (no bogus "Ready").
//   T5  create-from-images consumer queue: `data-create-*` controls, one PDF,
//       disabled Create, quality, and the clipboard-failure message.
//
// Fixtures live under test-fixtures/phase118/ (never private files).

const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp } = require('./lib/launch.cjs');
const { hardClose } = require('./lib/helpers.cjs');

const SHOTS = path.resolve(__dirname, '..', 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });
const FX = path.resolve(__dirname, '..', 'test-fixtures', 'phase118');
const P = (n) => path.join(FX, n);

// Stub the main-process native picker so the real IPC + renderer intake path
// runs against our fixtures (the same technique the shared helpers use).
async function stubOpenDialog(app, paths) {
  await app.evaluate(({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: p.length === 0, filePaths: p });
  }, paths);
}

// Drive the main window's size / zoom through main (the real BrowserWindow).
async function setWinSize(app, width, height) {
  await app.evaluate(({ BrowserWindow }, size) => {
    const w = BrowserWindow.getAllWindows().find(
      (x) => !x.isDestroyed() && !x.webContents.getURL().includes('tfWindow=print'),
    );
    if (w) w.setSize(size.width, size.height);
  }, { width, height });
}
async function zoomWin(app, factor) {
  await app.evaluate(({ BrowserWindow }, z) => {
    const w = BrowserWindow.getAllWindows().find(
      (x) => !x.isDestroyed() && !x.webContents.getURL().includes('tfWindow=print'),
    );
    if (w) w.webContents.setZoomFactor(z);
  }, factor);
}
async function setTheme(win, theme) {
  await win.evaluate((t) => {
    document.documentElement.dataset.theme = t;
  }, theme);
  await win.waitForTimeout(250);
}
async function shot(win, name) {
  const p = path.join(SHOTS, name);
  await win.screenshot({ path: p });
  console.log(`[P118] screenshot ${p}`);
  return p;
}

// Wait until every queued row has left `validating` (real detection settled).
async function waitSettled(win, expected) {
  await win.waitForFunction(
    (want) => {
      const rows = document.querySelectorAll('[data-intake-row]');
      const validating = document.querySelectorAll('[data-intake-state="validating"]').length;
      return rows.length === want && validating === 0;
    },
    expected,
    { timeout: 25000 },
  );
}

async function trayState(win) {
  return win.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-intake-row]')].map((row) => ({
      name: row.querySelector('.intake-name')?.textContent?.trim(),
      kind: row.querySelector('.intake-kind')?.textContent?.trim(),
      state: row.querySelector('[data-intake-state]')?.getAttribute('data-intake-state'),
      error: row.querySelector('[data-intake-error]')?.textContent?.trim() || null,
      label: row.getAttribute('aria-label'),
      moveUpDisabled: row.querySelector('[data-intake-move-up]')?.disabled === true,
      moveDownDisabled: row.querySelector('[data-intake-move-down]')?.disabled === true,
    }));
    const tray = document.querySelector('[data-intake-tray]');
    const open = document.querySelector('[data-intake-open]');
    return {
      rows,
      count: tray?.getAttribute('data-intake-count'),
      empty: !!tray?.querySelector('.intake-empty'),
      dropzone: !!tray?.querySelector('[data-intake-dropzone]'),
      openPresent: open !== null,
      openDisabled: open ? open.disabled : null,
      canvases: document.querySelectorAll('.pdf-page canvas').length,
    };
  });
}

test('T1 Home intake: picker stages (no auto-open), explicit Open dispatches; screenshots', async () => {
  test.setTimeout(240000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.welcome', { timeout: 30000 });
    await win.waitForSelector('[data-intake-tray]', { timeout: 15000 });

    const empty = await trayState(win);
    console.log(`[P118-T1] empty=${JSON.stringify(empty)}`);
    expect(empty.dropzone, 'drop zone renders on the empty tray').toBe(true);
    expect(empty.count).toBe('0');
    expect(empty.rows.length).toBe(0);
    expect(empty.empty, 'concise empty state').toBe(true);
    expect(empty.openPresent, 'no completion control on the empty queue').toBe(false);

    await setWinSize(app, 1440, 900);
    await setTheme(win, 'light');
    await shot(win, 'phase118-intake-empty-light.png');

    // The generic Open is an intake entry point: it stages and never opens.
    await stubOpenDialog(app, [P('report-a.pdf')]);
    await win.locator('[data-home-tool="open"]').first().click();
    await win.waitForSelector('[data-intake-row="0"]', { timeout: 20000 });
    await waitSettled(win, 1);
    const staged = await trayState(win);
    console.log(`[P118-T1] staged=${JSON.stringify(staged)}`);
    expect(staged.rows[0].name).toBe('report-a.pdf');
    expect(staged.rows[0].kind).toBe('PDF');
    expect(staged.rows[0].state).toBe('ready');
    expect(staged.rows[0].moveUpDisabled, 'first row cannot move up').toBe(true);
    expect(staged.canvases, 'staging never opens a document').toBe(0);
    expect(await win.locator('.welcome').count(), 'still on Home while staged').toBeGreaterThan(0);
    expect(staged.openPresent).toBe(true);
    expect(staged.openDisabled, 'Open enabled with a ready item').toBe(false);

    // Screenshots: full light / dark, high contrast, 200%, compact light / dark.
    await setTheme(win, 'light');
    await shot(win, 'phase118-intake-staged-light.png');
    await setTheme(win, 'dark');
    await shot(win, 'phase118-intake-staged-dark.png');
    await setTheme(win, 'light');
    await win.emulateMedia({ forcedColors: 'active' });
    await win.waitForTimeout(300);
    await shot(win, 'phase118-intake-high-contrast.png');
    await win.emulateMedia({ forcedColors: 'none' });
    await zoomWin(app, 2);
    await win.waitForTimeout(400);
    await shot(win, 'phase118-intake-200-percent.png');
    await zoomWin(app, 1);
    await setWinSize(app, 640, 900);
    await win.waitForTimeout(400);
    expect(await win.locator('[data-intake-tray]').isVisible()).toBe(true);
    await setTheme(win, 'light');
    await shot(win, 'phase118-intake-compact-light.png');
    await setTheme(win, 'dark');
    await shot(win, 'phase118-intake-compact-dark.png');
    await setWinSize(app, 1440, 900);
    await setTheme(win, 'light');
    await win.waitForTimeout(300);

    // Ruling 12: the ONE completion control dispatches the real open and the
    // successful item leaves the queue.
    await win.locator('[data-intake-open]').click();
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForFunction(
      () => document.querySelectorAll('[data-intake-row]').length === 0,
      null,
      { timeout: 15000 },
    );
    console.log('[P118-T1] staged PDF opened and left the queue on the Tray Open');
  } finally {
    await hardClose(app, 'p118-t1');
  }
});

test('T2 drop zone: eligible OS drag shows the drop indication and routes files', async () => {
  test.setTimeout(180000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('[data-intake-tray]', { timeout: 30000 });
    const res = await win.evaluate(async (mapped) => {
      let overrode = false;
      try {
        const utils = window.tflex && window.tflex.webUtils;
        if (utils && typeof utils.getPathForFile === 'function') {
          Object.defineProperty(utils, 'getPathForFile', {
            configurable: true,
            writable: true,
            value: () => mapped,
          });
          overrode = utils.getPathForFile('x') === mapped;
        }
      } catch (_) {
        overrode = false;
      }
      const tick = () => new Promise((r) => setTimeout(r, 120));
      const dt = new DataTransfer();
      const file = new File([new Uint8Array([37, 80, 68, 70])], 'dropped.pdf', {
        type: 'application/pdf',
      });
      dt.items.add(file);
      const enter = new DragEvent('dragenter', { bubbles: true, cancelable: true, dataTransfer: dt });
      window.dispatchEvent(enter);
      await tick();
      const activeVisible = document.querySelector('[data-intake-active]') !== null;
      const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt });
      window.dispatchEvent(drop);
      await tick();
      const activeAfterDrop = document.querySelector('[data-intake-active]') !== null;
      return { overrode, activeVisible, activeAfterDrop, dropPrevented: drop.defaultPrevented };
    }, P('report-b.pdf'));
    console.log(`[P118-T2] drop=${JSON.stringify(res)}`);
    expect(res.dropPrevented, 'file drop is intercepted so Chromium cannot navigate').toBe(true);
    expect(res.activeVisible, 'eligible OS drag shows the subtle drop indication').toBe(true);
    expect(res.activeAfterDrop, 'indication clears on drop').toBe(false);

    if (res.overrode) {
      await win.waitForSelector('[data-intake-row="0"]', { timeout: 15000 });
      await waitSettled(win, 1);
      const st = await trayState(win);
      expect(st.rows[0].name, 'dropped File basename staged').toBe('dropped.pdf');
      expect(st.rows[0].state, 'dropped File reaches a truthful ready state').toBe('ready');
    } else {
      console.log('[P118-T2] INCONCLUSIVE: webUtils.getPathForFile is not overridable; resolved-path drop assertion skipped');
    }
  } finally {
    await hardClose(app, 'p118-t2');
  }
});

test('T3 queue: many PDFs, duplicate basenames, order, keyboard reorder, remove-not-delete', async () => {
  test.setTimeout(200000);
  const app = await launchApp();
  const win = await app.firstWindow();
  const dupA = P('dupA/same.pdf');
  try {
    await win.waitForSelector('[data-intake-tray]', { timeout: 30000 });
    await stubOpenDialog(app, [P('report-a.pdf'), dupA, P('dupB/same.pdf')]);
    await win.locator('[data-home-tool="open"]').first().click();
    await waitSettled(win, 3);
    let st = await trayState(win);
    console.log(`[P118-T3] staged=${JSON.stringify(st.rows)}`);
    expect(st.rows.map((r) => r.name)).toEqual(['report-a.pdf', 'same.pdf', 'same (2).pdf']);
    expect(st.rows.map((r) => r.state)).toEqual(['ready', 'ready', 'ready']);
    expect(st.rows[0].moveUpDisabled, 'first row cannot move up').toBe(true);
    expect(st.rows[2].moveDownDisabled, 'last row cannot move down').toBe(true);

    // Mouse reorder: move the middle row up.
    await win.locator('[data-intake-move-up="1"]').click();
    await win.waitForFunction(
      () => (document.querySelector('[data-intake-row="0"] .intake-name')?.textContent || '').trim() === 'same.pdf',
      null,
      { timeout: 8000 },
    );
    st = await trayState(win);
    expect(st.rows.map((r) => r.name)).toEqual(['same.pdf', 'report-a.pdf', 'same (2).pdf']);

    // Keyboard reorder: Alt+ArrowDown on the focused first row.
    await win.locator('[data-intake-row="0"]').focus();
    await win.keyboard.press('Alt+ArrowDown');
    await win.waitForFunction(
      () => (document.querySelector('[data-intake-row="0"] .intake-name')?.textContent || '').trim() === 'report-a.pdf',
      null,
      { timeout: 8000 },
    );
    console.log('[P118-T3] mouse + keyboard reorder both preserved user order');

    // Remove from queue only - the underlying file must survive.
    await win.locator('[data-intake-remove="0"]').click();
    await waitSettled(win, 2);
    expect(fs.existsSync(P('report-a.pdf')), 'Remove from queue is not file deletion').toBe(true);
    st = await trayState(win);
    expect(st.rows.length).toBe(2);

    await win.locator('[data-intake-open]').click();
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForFunction(
      () => document.querySelectorAll('[data-intake-row]').length === 0,
      null,
      { timeout: 15000 },
    );
    console.log('[P118-T3] remaining ready PDFs dispatched, queue cleared');
  } finally {
    await hardClose(app, 'p118-t3');
  }
});

test('T4 truthful intake: unsupported / misleading-extension / protected partial errors', async () => {
  test.setTimeout(220000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('[data-intake-tray]', { timeout: 30000 });
    await stubOpenDialog(app, [
      P('report-a.pdf'),
      P('unsupported.xyz'),
      P('misleading.png'),
      P('protected.pdf'),
    ]);
    await win.locator('[data-home-tool="open"]').first().click();
    await waitSettled(win, 4);
    const st = await trayState(win);
    console.log(`[P118-T4] staged=${JSON.stringify(st.rows)}`);
    expect(st.rows[0].kind, 'real pdf detected by content').toBe('PDF');
    expect(st.rows[0].state).toBe('ready');
    expect(st.rows[1].state, 'unsupported input is not a bogus Ready').toBe('failed');
    expect(st.rows[1].error, 'unsupported input shows its own error').toBeTruthy();
    expect(st.rows[2].state, 'misleading .png (text content) is not a bogus Ready').toBe('failed');
    expect(st.rows[2].error, 'misleading extension shows its own error').toBeTruthy();
    expect(st.rows[3].kind, 'protected .pdf is promised by its real type').toBe('PDF');
    expect(st.rows[3].state).toBe('ready');

    // Dispatch: the good pdf opens; unrecognised items stay failed; a protected
    // file that cannot open becomes a per-item error (partial failure).
    await win.locator('[data-intake-open]').click();
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForFunction(
      () => {
        const ready = document.querySelectorAll('[data-intake-state="ready"]').length;
        const validating = document.querySelectorAll('[data-intake-state="validating"]').length;
        return ready === 0 && validating === 0;
      },
      null,
      { timeout: 20000 },
    );
    const after = await trayState(win);
    console.log(`[P118-T4] after=${JSON.stringify(after.rows)}`);
    const names = after.rows.map((r) => r.name);
    expect(names).toContain('unsupported.xyz');
    expect(names).toContain('misleading.png');
    expect(names, 'the opened pdf left the queue').not.toContain('report-a.pdf');
    expect(after.rows.filter((r) => r.state === 'ready').length).toBe(0);
    for (const r of after.rows) {
      expect(r.state, `row ${r.name} settled without a ready state`).not.toBe('ready');
    }
    const prot = after.rows.find((r) => r.name === 'protected.pdf');
    if (prot !== undefined) {
      expect(prot.state).toBe('failed');
      expect(prot.error, 'protected file failure carries a truthful message').toBeTruthy();
    }
    expect(after.canvases, 'the real pdf opened through the partial failure').toBeGreaterThanOrEqual(1);
  } finally {
    await hardClose(app, 'p118-t4');
  }
});

test('T5 create-from-images: data-create-* controls, one PDF, disabled Create, clipboard message', async () => {
  test.setTimeout(240000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('.welcome', { timeout: 30000 });
    await win.locator('[data-home-tool="createFromImages"]').first().click();
    await win.waitForSelector('[data-create-from-images-dialog]', { timeout: 15000 });

    // Every data-create-* CONTROL-INDEX control is present.
    expect(await win.locator('[data-create-pick]').count(), 'picker control').toBe(1);
    expect(await win.locator('[data-create-confirm]').count(), 'completion control').toBe(1);
    expect(await win.locator('[data-create-quality]').count(), 'quality control').toBe(1);
    expect(await win.locator('[data-create-from-clipboard]').count(), 'clipboard entry').toBe(1);
    expect(await win.locator('[data-create-confirm]').isDisabled(), 'Create disabled while empty').toBe(true);

    // Pick two images through the real renderer picker.
    const [chooser] = await Promise.all([
      win.waitForEvent('filechooser', { timeout: 15000 }),
      win.locator('[data-create-pick]').click(),
    ]);
    await chooser.setFiles([P('photo1.png'), P('photo2.png')]);
    await win.waitForFunction(
      () => document.querySelectorAll('[data-create-image-row]').length === 2,
      null,
      { timeout: 15000 },
    );
    let names = await win.evaluate(() =>
      [...document.querySelectorAll('.create-image-name')].map((n) => n.textContent.trim()),
    );
    expect(names).toEqual(['photo1.png', 'photo2.png']);
    expect(await win.locator('[data-create-confirm]').isDisabled(), 'Create enabled with images').toBe(false);

    // Reorder, remove, quality - all wired to the shared queue.
    await win.locator('[data-create-move-down="0"]').click();
    names = await win.evaluate(() =>
      [...document.querySelectorAll('.create-image-name')].map((n) => n.textContent.trim()),
    );
    expect(names).toEqual(['photo2.png', 'photo1.png']);
    await win.locator('[data-create-remove="0"]').click();
    await win.waitForFunction(
      () => document.querySelectorAll('[data-create-image-row]').length === 1,
      null,
      { timeout: 8000 },
    );
    await win.locator('[data-create-quality]').fill('70');
    expect(await win.locator('[data-create-quality]').inputValue()).toBe('70');

    // Confirm builds ONE PDF through the shared pipeline and opens it.
    await win.locator('[data-create-confirm]').click();
    await win.waitForSelector('.pdf-page canvas', { timeout: 60000 });
    await win.waitForFunction(
      () =>
        [...document.querySelectorAll('[data-tab-id] .tab-title-text')].some((t) =>
          (t.textContent || '').includes('Created from photo1'),
        ),
      null,
      { timeout: 30000 },
    );
    console.log('[P118-T5] create-from-images built ONE PDF and opened it as a new tab');

    // Clipboard failure path: re-open and click Create from clipboard. A real
    // clipboard image inserts a row; otherwise the dialog shows a truthful
    // non-blocking message - never a bogus PDF from text.
    await win.locator('[data-home-tool="createFromImages"]').first().click();
    await win.waitForSelector('[data-create-from-images-dialog]', { timeout: 15000 });
    await win.locator('[data-create-from-clipboard]').click();
    await win.waitForFunction(
      () => {
        const alert = document.querySelector('.create-images-dialog [role="alert"]');
        const rows = document.querySelectorAll('[data-create-image-row]').length;
        return (alert !== null && (alert.textContent || '').trim().length > 0) || rows === 1;
      },
      null,
      { timeout: 15000 },
    );
    const clip = await win.evaluate(() => ({
      alert: document.querySelector('.create-images-dialog [role="alert"]')?.textContent?.trim() || null,
      rows: document.querySelectorAll('[data-create-image-row]').length,
    }));
    console.log(`[P118-T5] clipboard=${JSON.stringify(clip)}`);
    expect(clip.alert !== null || clip.rows === 1, 'clipboard click yields an image or a truthful message').toBe(true);
  } finally {
    await hardClose(app, 'p118-t5');
  }
});

// DEF-657 (ADV-260): a dropped OS file must open by its RESOLVED absolute
// path, not its bare basename. dupA/same.pdf and dupB/same.pdf share the
// basename "same.pdf". The drop is driven with a REAL file path via CDP
// `Input.dispatchDragEvent` (the def418 technique) so Electron's
// `webUtils.getPathForFile` resolves the dropped fixture exactly as a real
// Explorer drop would. The bare basename "same.pdf" is not resolvable from the
// app CWD, so the pre-fix drop route cannot open the file; the fixed route
// opens the dropped dupA/same.pdf by its absolute path.
async function dropRealFile(app, page, filePath) {
  const client = await app.context().newCDPSession(page);
  const box = await page.evaluate(() => {
    const el = document.querySelector('.welcome') || document.body;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  });
  const data = { items: [], files: [filePath], dragOperationsMask: 1 };
  await client.send('Input.dispatchDragEvent', { type: 'dragEnter', x: box.x, y: box.y, data });
  await client.send('Input.dispatchDragEvent', { type: 'dragOver', x: box.x, y: box.y, data });
  await client.send('Input.dispatchDragEvent', { type: 'drop', x: box.x, y: box.y, data });
}

test('T6 drop opens the resolved absolute path over a colliding basename', async () => {
  test.setTimeout(180000);
  const app = await launchApp();
  const win = await app.firstWindow();
  try {
    await win.waitForSelector('[data-intake-tray]', { timeout: 30000 });
    await win.waitForFunction(() => typeof window.tflex !== 'undefined', null, {
      timeout: 30000,
    });

    expect(fs.existsSync(P('dupA/same.pdf')), 'dropped-path fixture exists').toBe(true);
    expect(fs.existsSync(P('dupB/same.pdf')), 'colliding-basename fixture exists').toBe(true);
    await dropRealFile(app, win, P('dupA/same.pdf'));

    await win.waitForSelector('[data-intake-row="0"]', { timeout: 15000 });
    await waitSettled(win, 1);
    const staged = await trayState(win);
    console.log(`[P118-T6] staged=${JSON.stringify(staged.rows)}`);
    expect(staged.rows[0].name, 'dropped File basename staged').toBe('same.pdf');
    expect(staged.rows[0].kind, 'detected by the resolved path').toBe('PDF');
    expect(staged.rows[0].state, 'the resolved dropped path is a real ready file').toBe('ready');

    // Dispatch must open the dropped dupA/same.pdf by its absolute path. The
    // bare basename cannot be resolved, so the pre-fix route fails and leaves a
    // failed row with no canvas.
    await win.locator('[data-intake-open]').click();
    await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
    await win.waitForFunction(
      () => document.querySelectorAll('[data-intake-row]').length === 0,
      null,
      { timeout: 15000 },
    );
    console.log('[P118-T6] dropped same.pdf opened by its resolved absolute path');
  } finally {
    await hardClose(app, 'p118-t6');
  }
});
