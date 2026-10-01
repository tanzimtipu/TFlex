// Phase 51 gate (qa) - the 16 operator items, verified against the RUNNING dev
// build. Every launch goes through the canonical e2e/lib/launch.cjs launchApp
// helper. Raw [P51 ...] lines are the evidence.
//
//   A (1)  Google sign-in: the stale challenge cookies are cleared on every
//          flow start (auth host only; session_token untouched).
//   C (3)  the first thumbnail's PAINTED selection ring never reaches the Undo
//          row at normal / narrow / Multi-Mode widths (re-report).
//   D (4)  every context-panel annotation row keeps its delete control inside
//          the row/panel/list at normal and narrow widths (re-report).
//   E (5)  tab colours are the full-strength token; adjacent differ; contrast.
//   F (6,7,12,13,14,15,16) the edit-text cluster.
//   G (9,10) OCR cancel + the suspects view in the Inspector.
//   H (11) every text-box surface is thicker + rounded.
//   I (8)  the open-error message mapping is readable (never [object Object]).
const { test, expect } = require('@playwright/test');
const path = require('node:path');
const fs = require('node:fs');
const { launchApp, getSamplePath } = require('./lib/launch.cjs');
const { hardClose, gotoStage, ensurePanelExpanded, armAnnotationTool, runTool } = require('./lib/helpers.cjs');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
fs.mkdirSync(SHOTS, { recursive: true });

const AUTH_BASE = 'https://ep-fragrant-pond-b3gqd6cf.neonauth.c-4.ap-southeast-1.aws.neon.tech/neondb/auth';

let app = null;
let win = null;
test.setTimeout(300000);

test.afterEach(async () => {
  if (app) await hardClose(app, 'p51-gate');
  app = null;
  win = null;
});

async function launch() {
  app = await launchApp();
  win = await app.firstWindow();
  await win.waitForSelector('.sample-card', { timeout: 30000 });
  return win;
}

async function openViaDialog(absPath) {
  await app.evaluate(async ({ dialog }, p) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [p] });
  }, absPath);
  await win.locator('[data-toolbar-open]').click();
  await win.waitForTimeout(1600);
}

async function setTheme(theme) {
  await win.click('[data-theme-toggle]');
  await win.waitForSelector('.theme-toggle-popover', { timeout: 5000 });
  await win.click(`[data-theme-option="${theme}"]`);
  await win.waitForFunction((w) => document.documentElement.getAttribute('data-theme') === w, theme);
  await win.waitForTimeout(500);
}

// ---------------------------------------------------------------------------
// A (item 1) - the stale challenge cookies are cleared on every flow start.
// ---------------------------------------------------------------------------
test('P51-A item 1: starting a flow clears the challenge cookies, never the session token', async () => {
  await launch();

  // Seed the app session with a STALE challenge (both spellings) and a live
  // session token, exactly as an earlier failed attempt would leave them.
  await app.evaluate(async ({ session }, base) => {
    const jar = session.defaultSession.cookies;
    const common = { url: base, path: '/', secure: true, sameSite: 'no_restriction' };
    await jar.set({ ...common, name: '__Secure-neon-auth.session_challenge', value: 'stale-canonical' });
    await jar.set({ ...common, name: '__Secure-neon-auth.session_challange', value: 'stale-legacy' });
    await jar.set({ ...common, name: '__Secure-neon-auth.session_token', value: 'live-token' });
  }, AUTH_BASE);

  const before = await app.evaluate(async ({ session }, base) => {
    const all = await session.defaultSession.cookies.get({ url: base });
    return all.map((c) => c.name).sort();
  }, AUTH_BASE);
  console.log(`[P51-A before] ${JSON.stringify(before)}`);
  expect(before).toContain('__Secure-neon-auth.session_challenge');
  expect(before).toContain('__Secure-neon-auth.session_challange');
  expect(before).toContain('__Secure-neon-auth.session_token');

  // Start a flow through the real renderer API (main's controller clears first).
  const started = await win.evaluate(() => window.tflex.accounts.startOAuthCallback());
  console.log(`[P51-A started] ${JSON.stringify(started)}`);
  expect(started.callbackUrl).toMatch(/^http:\/\/(127\.0\.0\.1|localhost):\d+\/oauth\/callback\?token=/);

  const after = await app.evaluate(async ({ session }, base) => {
    const all = await session.defaultSession.cookies.get({ url: base });
    return all.map((c) => c.name).sort();
  }, AUTH_BASE);
  console.log(`[P51-A after] ${JSON.stringify(after)}`);
  expect(after, 'both stale challenge cookies are gone').not.toContain('__Secure-neon-auth.session_challenge');
  expect(after, 'both stale challenge cookies are gone').not.toContain('__Secure-neon-auth.session_challange');
  expect(after, 'the session token is NEVER touched (no sign-out)').toContain('__Secure-neon-auth.session_token');

  await win.evaluate(() => window.tflex.accounts.stopOAuthCallback());
});

// ---------------------------------------------------------------------------
// C (item 3) - the PAINTED ring vs the Undo row.
// ---------------------------------------------------------------------------
async function measureRingVsUndo() {
  return win.evaluate(() => {
    const undo = document.querySelector('button[aria-label="Undo last change"]');
    const scroller = document.querySelector('.thumb-scroller-inner');
    const thumb = document.querySelector('.thumb');
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
    };
    const rawShadow = thumb ? getComputedStyle(thumb).boxShadow : null;
    const spread = (el) => {
      if (!el) return 0;
      const bs = getComputedStyle(el).boxShadow;
      let max = 0;
      const re = /0(?:px)?\s+0(?:px)?\s+0(?:px)?\s+([\d.]+)px/g;
      let m;
      while ((m = re.exec(bs)) !== null) max = Math.max(max, Number(m[1]));
      return max;
    };
    const u = box(undo);
    const t = box(thumb);
    const s = box(scroller);
    const sp = spread(thumb);
    const painted = t ? { l: t.l - sp, t: t.t - sp, r: t.r + sp, b: t.b + sp } : null;
    let inter = null;
    if (u && painted) {
      const ix = Math.max(0, Math.min(u.r, painted.r) - Math.max(u.l, painted.l));
      const iy = Math.max(0, Math.min(u.b, painted.b) - Math.max(u.t, painted.t));
      inter = { w: ix, h: iy, area: ix * iy };
    }
    return {
      undo: u,
      thumb: t,
      scroller: s,
      spread: sp,
      rawShadow,
      painted,
      inter,
      clippedTop: painted && s ? painted.t < s.t - 0.5 : null,
      current: thumb ? thumb.classList.contains('thumb-current') : null,
    };
  });
}

test('P51-C item 3: the painted ring never reaches the Undo row (normal/narrow/multi)', async () => {
  await launch();
  await openViaDialog(getSamplePath('report.pdf'));
  await ensurePanelExpanded(win);
  await win.waitForTimeout(700);

  // Select the FIRST page (the operator's view).
  await win.locator('.thumb').first().click();
  await win.waitForTimeout(700);

  const states = [];
  states.push(['normal', await measureRingVsUndo()]);
  await win.screenshot({ path: path.join(SHOTS, 'phase51-thumb-ring-undo.png') });

  // Narrow window.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(900, 720);
  });
  await win.waitForTimeout(900);
  states.push(['narrow', await measureRingVsUndo()]);

  // Multi Mode (the 150px strip).
  await win.locator('[data-header-multi-mode]').click();
  await win.waitForSelector('.tab-stage[data-multi-mode="true"]', { timeout: 15000 });
  await win.waitForTimeout(900);
  states.push(['multi', await measureRingVsUndo()]);

  for (const [name, m] of states) {
    console.log(`[P51-C ${name}] undo=${JSON.stringify(m.undo)} thumb=${JSON.stringify(m.thumb)} scroller=${JSON.stringify(m.scroller)} spread=${m.spread} shadow=${JSON.stringify(m.rawShadow)} painted=${JSON.stringify(m.painted)} inter=${JSON.stringify(m.inter)} clippedTop=${m.clippedTop} current=${m.current}`);
    expect(m.current, `${name}: the first thumb is the current page`).toBe(true);
    expect(m.spread, `${name}: the ring has a painted spread`).toBeGreaterThan(0);
    expect(m.inter.area, `${name}: zero intersection with the Undo row`).toBe(0);
    expect(m.clippedTop, `${name}: the painted ring top is inside the scroller (not clipped)`).toBe(false);
  }
});

// ---------------------------------------------------------------------------
// D (item 4) - every annotation row keeps its delete control inside the row.
// ---------------------------------------------------------------------------
const ANN_KINDS = [
  ['highlight', { kind: 'highlight', rects: [{ x: 50, y: 50, width: 100, height: 14 }], text: 'hl' }],
  ['underline', { kind: 'underline', rects: [{ x: 50, y: 80, width: 100, height: 14 }], text: 'ul' }],
  ['strikeout', { kind: 'strikeout', rects: [{ x: 50, y: 110, width: 100, height: 14 }], text: 'so' }],
  ['ink', { kind: 'ink', points: [{ x: 50, y: 150 }, { x: 120, y: 180 }], width: 2 }],
  ['textbox', { kind: 'textbox', rect: { x: 50, y: 210, width: 120, height: 40 }, text: 'tb' }],
  ['ellipse', { kind: 'ellipse', rect: { x: 50, y: 350, width: 100, height: 60 } }],
  ['arrow', { kind: 'arrow', from: { x: 50, y: 430 }, to: { x: 150, y: 470 } }],
  ['note', { kind: 'note', at: { x: 50, y: 500 }, text: 'note' }],
  ['callout', { kind: 'callout', rect: { x: 50, y: 560, width: 120, height: 50 }, at: { x: 60, y: 570 }, text: 'co' }],
];

/** Inject the non-rect kinds straight into the engine. The React mirror is
 *  refreshed by the UI-created rectangle below (onCreateAnnotation ->
 *  noteOpApplied mirrors the engine's FULL state, so every injected row
 *  renders). */
async function injectAnnotations() {
  const docId = await win.evaluate(() => window.tflexDiagnostics().engineDocId);
  const results = await win.evaluate(async ({ id, kinds }) => {
    const out = [];
    for (const [name, payload] of kinds) {
      const res = await window.tflex.engine.createAnnotation(id, {
        id: `p51-${name}`,
        page: 1,
        color: 'yellow',
        createdAt: '2026-09-28T00:00:00Z',
        ...payload,
      });
      out.push({ name, ok: res.ok, error: res.ok ? null : res.error });
    }
    return out;
  }, { id: docId, kinds: ANN_KINDS });
  return results;
}

/** Create the RECTANGLE through the real UI (the operator's re-report). This
 *  also refreshes the renderer's engine mirror so every injected row renders. */
async function createRectViaUi() {
  await gotoStage(win, 3);
  await armAnnotationTool(win, 'rect');
  const pg = await win.locator('.pdf-page[data-page="1"]').first().boundingBox();
  const x = Math.round(pg.x + pg.width * 0.35);
  const y = Math.round(pg.y + pg.height * 0.3);
  await win.mouse.move(x, y);
  await win.mouse.down();
  await win.mouse.move(x + 160, y + 90, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(900);
}

async function measureAnnRows() {
  return win.evaluate(() => {
    const panel = document.querySelector('[data-context-panel-annotations]');
    const list = document.querySelector('[data-annotation-panel]');
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { l: r.left, t: r.top, r: r.right, b: r.bottom, w: r.width, h: r.height };
    };
    const pb = box(panel);
    const lb = box(list);
    const rows = [...document.querySelectorAll('[data-annotation-row]')];
    return rows.map((row) => {
      const del = row.querySelector('.ann-panel-row-delete');
      const jump = row.querySelector('.ann-panel-row-jump');
      // Bring the row into the viewport so the elementFromPoint hit test is
      // meaningful (a row below the fold would otherwise report the section).
      row.scrollIntoView({ block: 'center' });
      void row.offsetHeight;
      const rb = box(row);
      const db = box(del);
      const jb = box(jump);
      let insideRow = null;
      let insidePanel = null;
      let insideList = null;
      let clickable = null;
      let hitTag = null;
      if (db && rb) {
        insideRow = db.l >= rb.l - 0.5 && db.r <= rb.r + 0.5 && db.t >= rb.t - 0.5 && db.b <= rb.b + 0.5;
        if (pb) insidePanel = db.l >= pb.l - 0.5 && db.r <= pb.r + 0.5;
        if (lb) insideList = db.l >= lb.l - 0.5 && db.r <= lb.r + 0.5;
        const cx = db.l + db.w / 2;
        const cy = db.t + db.h / 2;
        const hit = document.elementFromPoint(cx, cy);
        hitTag = hit ? `${hit.tagName.toLowerCase()}.${(hit.className || '').toString().split(' ')[0]}` : null;
        clickable = hit !== null && (hit === del || del.contains(hit));
      }
      return {
        id: row.getAttribute('data-annotation-row'),
        kind: row.querySelector('.ann-panel-row-kind')?.textContent ?? null,
        row: rb,
        del: db,
        jump: jb,
        insideRow,
        insidePanel,
        insideList,
        clickable,
        hitTag,
        rowOverflow: row.scrollWidth - row.clientWidth,
      };
    });
  });
}

test('P51-D item 4: every annotation row keeps its delete control inside (normal + narrow)', async () => {
  await launch();
  await openViaDialog(getSamplePath('report.pdf'));
  await ensurePanelExpanded(win);
  await win.waitForTimeout(500);

  const injected = await injectAnnotations();
  console.log(`[P51-D injected] ${JSON.stringify(injected)}`);
  for (const r of injected) expect(r.ok, `createAnnotation ${r.name}`).toBe(true);

  // The rectangle is created through the real UI (the operator's re-report);
  // it also refreshes the renderer mirror so every injected row renders.
  await createRectViaUi();
  await ensurePanelExpanded(win);
  await win.waitForSelector('[data-annotation-row]', { timeout: 15000 });
  await win.waitForTimeout(700);

  const states = [];
  states.push(['normal', await measureAnnRows()]);

  // Screenshot with the rectangle row selected (the operator's re-report).
  const rectRow = win.locator('[data-annotation-row]').filter({ has: win.locator('.ann-panel-row-kind', { hasText: 'Rectangle' }) }).first();
  await rectRow.scrollIntoViewIfNeeded();
  await rectRow.locator('.ann-panel-row-jump').click();
  await win.waitForTimeout(700);
  await win.screenshot({ path: path.join(SHOTS, 'phase51-rect-delete.png') });

  // Narrow window.
  await app.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0].setSize(900, 720);
  });
  await win.waitForTimeout(900);
  states.push(['narrow', await measureAnnRows()]);

  for (const [name, rows] of states) {
    console.log(`[P51-D ${name}] rows=${rows.length}`);
    expect(rows.length, `${name}: all ten kinds rendered`).toBe(10);
    for (const r of rows) {
      console.log(`[P51-D ${name}] ${r.kind} row=${JSON.stringify(r.row)} del=${JSON.stringify(r.del)} insideRow=${r.insideRow} insidePanel=${r.insidePanel} insideList=${r.insideList} clickable=${r.clickable} hit=${r.hitTag} overflow=${r.rowOverflow}`);
      expect(r.insideRow, `${name}: ${r.kind} delete inside its row`).toBe(true);
      expect(r.insidePanel, `${name}: ${r.kind} delete inside the panel`).toBe(true);
      expect(r.insideList, `${name}: ${r.kind} delete inside the list`).toBe(true);
      expect(r.clickable, `${name}: ${r.kind} delete is the elementFromPoint hit`).toBe(true);
      expect(r.rowOverflow, `${name}: ${r.kind} row has no horizontal overflow`).toBeLessThanOrEqual(1);
    }
  }
});

// ---------------------------------------------------------------------------
// E (item 5) - full-strength tab colours.
// ---------------------------------------------------------------------------
async function readTabs() {
  return win.evaluate(() => {
    const parse = (c) => {
      if (!c) return null;
      let m = /rgba?\(([^)]+)\)/.exec(c);
      if (m) {
        const p = m[1].split(',').map(Number);
        return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
      }
      m = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/.exec(c);
      if (m) {
        return { r: Number(m[1]) * 255, g: Number(m[2]) * 255, b: Number(m[3]) * 255, a: m[4] === undefined ? 1 : Number(m[4]) };
      }
      return null;
    };
    const lum = (c) => {
      const f = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    };
    const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
    const comp = (el) => {
      const chain = []; let n = el;
      while (n && n.nodeType === 1) { chain.push(n); n = n.parentElement; }
      chain.reverse();
      let acc = { r: 255, g: 255, b: 255, a: 1 };
      for (const node of chain) {
        const bg = parse(getComputedStyle(node).backgroundColor);
        if (!bg || bg.a === 0) continue;
        acc = { r: bg.r * bg.a + acc.r * (1 - bg.a), g: bg.g * bg.a + acc.g * (1 - bg.a), b: bg.b * bg.a + acc.b * (1 - bg.a), a: 1 };
      }
      return acc;
    };
    return [...document.querySelectorAll('.tab')].map((t) => {
      const cs = getComputedStyle(t);
      const before = getComputedStyle(t, '::before');
      const chip = t.querySelector('.tab-colour-chip');
      const chipCs = chip ? getComputedStyle(chip) : null;
      const fg = parse(cs.color);
      const bg = comp(t);
      return {
        id: t.getAttribute('data-tab-id'),
        slot: t.getAttribute('data-tab-colour'),
        active: t.classList.contains('tab-active'),
        bg: cs.backgroundColor,
        color: cs.color,
        chip: chipCs ? chipCs.backgroundColor : null,
        // Phase 72 (ruling 4, item 3) — the `.tab-colour-chip` is RETIRED; the
        // only body-fill signal is the colorful `::before` mix (22% inactive /
        // 41% active) with its 1px border.
        chipCount: t.querySelectorAll('.tab-colour-chip').length,
        beforeBg: before.backgroundColor,
        beforeBorderWidth: before.borderTopWidth,
        contrast: fg ? +ratio(fg, bg).toFixed(2) : null,
      };
    });
  });
}

test('P51-E item 5: tab colours are full-strength, adjacent differ, contrast floors', async () => {
  await launch();
  await openViaDialog(getSamplePath('report.pdf'));
  await openViaDialog(getSamplePath('form.pdf'));
  await openViaDialog(getSamplePath('long.pdf'));
  await win.waitForTimeout(800);
  expect(await win.locator('.tab').count()).toBe(3);

  for (const theme of ['light', 'dark', 'frosted']) {
    await setTheme(theme);
    const tabs = await readTabs();
    console.log(`[P51-E ${theme}] ${JSON.stringify(tabs)}`);
    expect(tabs.length).toBe(3);
    // Phase 72 (ruling 4, item 3) SUPERSEDES the Phase 45/51 colour-identity
    // chip: `.tab-colour-chip` is deleted, `data-tab-colour` / `--tf-tab-accent`
    // remain, and the active cue is the brighter `::before` body fill (41% mix
    // vs the inactive 22%), not a chip or a per-tab text colour.
    expect(tabs[0].slot, `${theme}: tab0 vs tab1 slot`).not.toBe(tabs[1].slot);
    expect(tabs[1].slot, `${theme}: tab1 vs tab2 slot`).not.toBe(tabs[2].slot);
    for (const t of tabs) {
      expect(t.chipCount, `${theme}: ${t.id} paints no retired .tab-colour-chip`).toBe(0);
    }
    const active = tabs.filter((t) => t.active);
    expect(active.length, `${theme}: exactly one active tab`).toBe(1);
    const inactive = tabs.filter((t) => !t.active);
    expect(
      active[0].beforeBg,
      `${theme}: active ::before fill (41% mix) differs from inactive (22% mix)`,
    ).not.toBe(inactive[0].beforeBg);
    for (const t of tabs) {
      expect(t.beforeBorderWidth, `${theme}: ${t.id} ::before body border is 1px`).toBe('1px');
    }
    for (const t of tabs) {
      console.log(`[P51-E ${theme}] tab ${t.id} active=${t.active} bg=${t.bg} color=${t.color} contrast=${t.contrast}`);
      expect(t.contrast, `${theme}: tab ${t.id} contrast >= 4.5`).toBeGreaterThanOrEqual(4.5);
    }
  }
  await win.screenshot({ path: path.join(SHOTS, 'phase51-tab-colours.png') });
});

// ---------------------------------------------------------------------------
// H (item 11) - every text-box surface is thicker + rounded.
// ---------------------------------------------------------------------------
async function measureBoxSurfaces() {
  return win.evaluate(() => {
    const read = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return {
        borderTopWidth: cs.borderTopWidth,
        borderLeftWidth: cs.borderLeftWidth,
        borderTopLeftRadius: cs.borderTopLeftRadius,
        borderTopRightRadius: cs.borderTopRightRadius,
        borderBottomLeftRadius: cs.borderBottomLeftRadius,
        borderBottomRightRadius: cs.borderBottomRightRadius,
        overflow: cs.overflow,
        scrollW: el.scrollWidth,
        clientW: el.clientWidth,
        scrollH: el.scrollHeight,
        clientH: el.clientHeight,
      };
    };
    return {
      annTextbox: read('.ann-textbox'),
      annCallout: read('.ann-callout'),
      editBox: read('.edit-box'),
      runEditor: read('.edit-run-editor'),
      annCommentBox: read('.ann-comment-box'),
      annEditor: read('.ann-editor'),
    };
  });
}

test('P51-H item 11: text-box surfaces are thicker + rounded, no clipping', async () => {
  await launch();
  await openViaDialog(getSamplePath('report.pdf'));
  await ensurePanelExpanded(win);
  await win.waitForTimeout(500);

  // A textbox + a callout annotation give the two annotation surfaces.
  const injected = await injectAnnotations();
  for (const r of injected) expect(r.ok, `createAnnotation ${r.name}`).toBe(true);
  // The UI-created rectangle refreshes the renderer mirror so the injected
  // textbox / callout surfaces actually render.
  await createRectViaUi();
  await win.waitForTimeout(900);

  // A canvas text box via the real EDIT tool: arm "Add a text box", click an
  // existing text run, then Confirm (the tool stays armed so `.edit-box`
  // renders).
  await win.keyboard.press('Escape');
  await gotoStage(win, 2);
  await win.waitForTimeout(500);
  await win.locator('[data-dock-verb="editTextBox"]').waitFor({ state: 'visible', timeout: 10000 });
  await win.locator('[data-dock-verb="editTextBox"]').click();
  await win.waitForTimeout(500);
  await win.waitForSelector('.textLayer span', { timeout: 15000 }).catch(() => {});
  const textSpan = await win.evaluate(() => {
    const span = document.querySelector('.textLayer span');
    if (!span) return null;
    const r = span.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  console.log(`[P51-H textSpan] ${JSON.stringify(textSpan)}`);
  expect(textSpan, 'a text run is present to box').not.toBeNull();
  await win.mouse.click(textSpan.x, textSpan.y);
  await win.waitForTimeout(900);
  const diag1 = await win.evaluate(() => ({
    eraser: !!document.querySelector('[data-edit-box-eraser]'),
    inlineEditor: !!document.querySelector('.edit-inline-editor'),
    editBox: !!document.querySelector('.edit-box'),
    pressed: document.querySelector('[data-dock-verb="editTextBox"]')?.getAttribute('aria-pressed'),
  }));
  console.log(`[P51-H after text click] ${JSON.stringify(diag1)}`);
  // `.edit-box` is the committed canvas text box surface; it is present while
  // the box editor is open. Measure the surfaces HERE.
  const surfaces = await measureBoxSurfaces();
  console.log(`[P51-H surfaces] ${JSON.stringify(surfaces)}`);
  for (const [name, s] of Object.entries(surfaces)) {
    if (s === null) { console.log(`[P51-H ${name}] absent in this state`); continue; }
    console.log(`[P51-H ${name}] border=${s.borderTopWidth}/${s.borderLeftWidth} radius=${s.borderTopLeftRadius} overflow=${s.overflow} scroll=${s.scrollW}x${s.scrollH} client=${s.clientW}x${s.clientH}`);
    expect(parseFloat(s.borderTopWidth), `${name}: border is thicker than 1px`).toBeGreaterThanOrEqual(2);
    expect(parseFloat(s.borderTopLeftRadius), `${name}: rounded corners`).toBeGreaterThanOrEqual(4);
  }
  expect(surfaces.annTextbox, 'the textbox annotation surface is present').not.toBeNull();
  expect(surfaces.annCallout, 'the callout annotation surface is present').not.toBeNull();
  expect(surfaces.editBox, 'the canvas text box surface is present').not.toBeNull();
  await win.screenshot({ path: path.join(SHOTS, 'phase51-textbox-borders.png') });

  const confirmBtn = win.locator('[aria-label="Confirm placement"], [data-edit-confirm="true"], button:has-text("Confirm")').first();
  if ((await confirmBtn.count()) > 0) {
    await confirmBtn.click();
    await win.waitForTimeout(1000);
  }
  const diag2 = await win.evaluate(() => ({
    eraser: !!document.querySelector('[data-edit-box-eraser]'),
    editBox: !!document.querySelector('.edit-box'),
    pressed: document.querySelector('[data-dock-verb="editTextBox"]')?.getAttribute('aria-pressed'),
  }));
  console.log(`[P51-H after confirm] ${JSON.stringify(diag2)}`);
});

// ---------------------------------------------------------------------------
// F (items 6,7,12,13,14,15,16) - the edit-text cluster.
// ---------------------------------------------------------------------------
async function armEditText() {
  await win.evaluate(() => { const el = document.activeElement; if (el instanceof HTMLElement) el.blur(); });
  await win.keyboard.press('Control+k');
  await win.waitForSelector('[data-command-palette-input]', { state: 'visible', timeout: 8000 });
  await win.locator('[data-command-palette-input]').fill('Edit text');
  await win.waitForTimeout(450);
  const row = win.locator('[data-palette-tool-id="editText"]').first();
  if ((await row.count()) > 0) { await row.click(); } else { await win.keyboard.press('Enter'); }
  await win.waitForTimeout(700);
}

async function selectRun(nearRect = null) {
  const pageLoc = win.locator('.tab-pane[aria-hidden="false"] .pdf-page[data-page="1"]');
  const pg = await (await pageLoc.count() ? pageLoc.first() : win.locator('.pdf-page[data-page="1"]').first()).boundingBox();
  const fracs = [[0.5, 0.1], [0.3, 0.12], [0.5, 0.16], [0.25, 0.22], [0.5, 0.3], [0.35, 0.42], [0.55, 0.5], [0.4, 0.62]];
  const points = fracs.map(([fx, fy]) => [Math.round(pg.x + pg.width * fx), Math.round(pg.y + pg.height * fy)]);
  // A moved run can be narrow and sit outside the fixed fractions (item 13);
  // when the caller knows the moved rect, click the text-layer spans inside
  // it first (the hit-test resolves the run from the span, not the rect).
  if (nearRect) {
    const spanPoints = await win.evaluate((r) => [...document.querySelectorAll('.textLayer span')].map((s) => {
      const b = s.getBoundingClientRect();
      return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2), w: b.width, h: b.height };
    }).filter((p) => p.w > 0 && p.h > 0 && p.x >= r.l && p.x <= r.l + r.w && p.y >= r.t && p.y <= r.t + r.h).map((p) => [p.x, p.y]), nearRect);
    points.unshift(...spanPoints);
  }
  for (const [x, y] of points) {
    await win.mouse.click(x, y);
    await win.waitForTimeout(550);
    const active = await win.evaluate(() => {
      const root = document.querySelector('.tab-pane[aria-hidden="false"]') || document;
      return root.querySelector('[data-textrun-selection]') !== null;
    });
    if (active) return true;
  }
  return false;
}

async function runState() {
  return win.evaluate(() => {
    const root = document.querySelector('.tab-pane[aria-hidden="false"]') || document;
    const sel = root.querySelector('[data-textrun-selection]');
    const prev = root.querySelector('[data-edit-run-preview]');
    const eraser = root.querySelector('[data-edit-box-eraser]');
    const editor = root.querySelector('[data-edit-run-editor]');
    const field = document.querySelector('[data-inspector-text-panel] [data-txt-text]');
    const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
    const cs = sel ? getComputedStyle(sel) : null;
    return {
      selection: box(sel),
      selectionStyle: cs ? { border: cs.borderTopWidth + ' ' + cs.borderTopStyle + ' ' + cs.borderTopColor, bg: cs.backgroundColor, z: cs.zIndex, shadow: cs.boxShadow } : null,
      preview: box(prev),
      previewText: prev ? prev.textContent : null,
      eraser: box(eraser),
      editor: box(editor),
      editorText: editor ? editor.value : null,
      fieldValue: field ? field.value : null,
      fieldDisabled: field ? field.disabled : null,
      activeIsField: document.activeElement === field,
      activeTag: document.activeElement ? document.activeElement.tagName.toLowerCase() : null,
      activeOuter: document.activeElement ? document.activeElement.outerHTML.slice(0, 120) : null,
      fieldCount: document.querySelectorAll('[data-txt-text]').length,
      panelCount: document.querySelectorAll('[data-inspector-text-panel]').length,
      activeAttr: document.activeElement ? (document.activeElement.getAttribute('data-txt-text') !== null ? 'data-txt-text' : (document.activeElement.getAttribute('data-edit-run-editor') !== null ? 'data-edit-run-editor' : null)) : null,
      bold: document.querySelector('[data-txt-bold]')?.getAttribute('aria-pressed'),
      italic: document.querySelector('[data-txt-italic]')?.getAttribute('aria-pressed'),
      super: document.querySelector('[data-txt-super]')?.getAttribute('aria-pressed'),
      sub: document.querySelector('[data-txt-sub]')?.getAttribute('aria-pressed'),
      previewCount: root.querySelectorAll('[data-edit-run-preview]').length,
    };
  });
}

async function dragSelection(dx, dy) {
  const s = await runState();
  if (s.selection === null) throw new Error('no selection to drag');
  const cx = s.selection.l + s.selection.w / 2;
  const cy = s.selection.t + s.selection.h / 2;
  await win.mouse.move(cx, cy);
  await win.mouse.down();
  await win.mouse.move(cx + dx, cy + dy, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(600);
}

async function clickConfirm() {
  const btn = win.locator('[data-content-action="textrun-confirm"]').first();
  await btn.click();
  await win.waitForTimeout(900);
}

/** Wait until the pdf.js text layer carries a run whose centre falls inside
 *  `rect` (viewport px). A move's proxy refresh is async (DEF-155), so a
 *  click at the moved position must wait for the refreshed text layer rather
 *  than sampling the pre-refresh one. */
async function waitForTextLayerAt(rect) {
  await win.waitForFunction((r) => {
    const spans = [...document.querySelectorAll('.textLayer span')];
    return spans.some((s) => {
      const b = s.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) return false;
      const cx = b.left + b.width / 2;
      const cy = b.top + b.height / 2;
      return cx >= r.l - 2 && cx <= r.l + r.w + 2 && cy >= r.t - 2 && cy <= r.t + r.h + 2;
    });
  }, rect, { timeout: 15000 }).catch(() => {});
}

test('P51-F items 6,7,12,13,14,15,16: the edit-text cluster', async () => {
  await launch();
  await openViaDialog(getSamplePath('long.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);
  await gotoStage(win, 2);
  await armEditText();
  await win.evaluate(() => {
    window.__p51focus = [];
    document.addEventListener('focusin', (e) => {
      const t = e.target;
      window.__p51focus.push(`in:${t.tagName.toLowerCase()}${t.getAttribute && t.getAttribute('data-txt-text') !== null ? '[txt]' : ''}`);
    }, true);
    document.addEventListener('focusout', (e) => {
      const t = e.target;
      window.__p51focus.push(`out:${t.tagName.toLowerCase()}${t.getAttribute && t.getAttribute('data-txt-text') !== null ? '[txt]' : ''}`);
    }, true);
  });
  expect(await selectRun(), 'a text run is selectable').toBe(true);
  await win.waitForTimeout(600);
  const focusLog = await win.evaluate(() => window.__p51focus);
  console.log(`[P51-F focusLog] ${JSON.stringify(focusLog)}`);

  // (6) selecting a run focuses the Inspector Text field.
  const s6 = await runState();
  console.log(`[P51-F item6] activeIsField=${s6.activeIsField} activeTag=${s6.activeTag} activeAttr=${s6.activeAttr} activeOuter=${JSON.stringify(s6.activeOuter)} fieldCount=${s6.fieldCount} panelCount=${s6.panelCount} fieldValue=${JSON.stringify(s6.fieldValue)}`);
  if (!s6.activeIsField) {
    // User-facing consequence: with the field NOT focused, a keystroke must
    // not land in it.
    const before = s6.fieldValue;
    await win.keyboard.type('X');
    await win.waitForTimeout(400);
    const after = await runState();
    console.log(`[P51-F item6 typing] before=${JSON.stringify(before)} after=${JSON.stringify(after.fieldValue)}`);
    const probe = await win.evaluate(() => {
      const f = document.querySelector('[data-txt-text]');
      if (!f) return { focusable: false };
      f.focus();
      return { focusable: document.activeElement === f, tag: document.activeElement ? document.activeElement.tagName.toLowerCase() : null };
    });
    console.log(`[P51-F item6 probe] ${JSON.stringify(probe)}`);
  }
  // The item-6 assertion is deferred to the END of this test so the other
  // items still produce evidence when it fails (it is a real finding).

  // (7) the selection LOOKS selected.
  console.log(`[P51-F item7] selection=${JSON.stringify(s6.selection)} style=${JSON.stringify(s6.selectionStyle)}`);
  expect(s6.selection, 'item 7: the selection surface is present').not.toBeNull();
  expect(parseFloat(s6.selectionStyle.border.split(' ')[0]), 'item 7: a visible border').toBeGreaterThanOrEqual(1);
  expect(s6.selectionStyle.bg, 'item 7: a selection wash').not.toBe('rgba(0, 0, 0, 0)');
  expect(Number(s6.selectionStyle.z), 'item 7: ranked above the eraser').toBeGreaterThanOrEqual(1);
  await win.screenshot({ path: path.join(SHOTS, 'phase51-edittext-selected.png') });

  // (12) typing in the Inspector field updates the canvas.
  await win.locator('[data-inspector-text-panel] [data-txt-text]').fill('Inspector edit');
  await win.waitForTimeout(700);
  const s12a = await runState();
  console.log(`[P51-F item12 inspector->canvas] previewText=${JSON.stringify(s12a.previewText)}`);
  expect(s12a.previewText, 'item 12: the canvas preview follows the Inspector field').toContain('Inspector edit');

  // (12) the on-canvas editor shares the SAME session: open it, type, and the
  // Inspector field follows. (The dblclick's pointerdown re-selects the run and
  // re-seeds the session from the run's source text, which is fine here.)
  await win.evaluate(() => {
    const el = document.querySelector('[data-textrun-selection]');
    if (el) el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  });
  await win.waitForTimeout(600);
  const s12b = await runState();
  console.log(`[P51-F item12 editor] editor=${JSON.stringify(s12b.editor)} editorText=${JSON.stringify(s12b.editorText)} fieldValue=${JSON.stringify(s12b.fieldValue)}`);
  expect(s12b.editor, 'item 12: the on-canvas editor mounts').not.toBeNull();
  await win.locator('[data-edit-run-editor]').fill('Canvas edit');
  await win.waitForTimeout(700);
  const s12c = await runState();
  console.log(`[P51-F item12 canvas->inspector] fieldValue=${JSON.stringify(s12c.fieldValue)}`);
  expect(s12c.fieldValue, 'item 12: the Inspector field follows the canvas editor').toBe('Canvas edit');
  // Close the editor and deselect by clicking a blank page area.
  const pgBlank = await win.locator('.pdf-page[data-page="1"]').first().boundingBox();
  await win.mouse.click(Math.round(pgBlank.x + pgBlank.width * 0.9), Math.round(pgBlank.y + pgBlank.height * 0.9));
  await win.waitForTimeout(700);

  // (7) a drag MOVES the text (the preview follows the blue box).
  expect(await selectRun(), 'the run is re-selectable for the drag').toBe(true);
  await win.waitForTimeout(600);
  const beforeDrag = await runState();
  await dragSelection(60, 30);
  const afterDrag = await runState();
  console.log(`[P51-F item7 drag] before=${JSON.stringify(beforeDrag.preview)} after=${JSON.stringify(afterDrag.preview)} eraser=${JSON.stringify(afterDrag.eraser)}`);
  expect(afterDrag.preview.l, 'item 7: the text preview moved right').toBeGreaterThan(beforeDrag.preview.l + 20);
  expect(afterDrag.preview.t, 'item 7: the text preview moved down').toBeGreaterThan(beforeDrag.preview.t + 10);
  expect(afterDrag.eraser.l, 'item 7: the cover holds the OLD rect').toBe(beforeDrag.eraser.l);

  // (7) Confirm leaves exactly ONE copy. The white eraser cover is held
  // open until the async engine mask + pdf.js proxy refresh resolves
  // (DEF-155), so wait for the settled state before sampling it.
  await clickConfirm();
  await win.waitForSelector('[data-edit-box-eraser]', { state: 'detached', timeout: 15000 }).catch(() => {});
  const afterConfirm = await runState();
  console.log(`[P51-F item7 confirm] selection=${JSON.stringify(afterConfirm.selection)} preview=${JSON.stringify(afterConfirm.preview)} eraser=${JSON.stringify(afterConfirm.eraser)} previewCount=${afterConfirm.previewCount}`);
  expect(afterConfirm.selection, 'item 7: the selection closes on Confirm').toBeNull();
  expect(afterConfirm.preview, 'item 7: no residual preview copy').toBeNull();
  expect(afterConfirm.eraser, 'item 7: no residual cover').toBeNull();

  // (13) applying Bold after a move keeps the box where it was moved.
  expect(await selectRun(afterDrag.preview), 'the moved run is re-selectable').toBe(true);
  await win.waitForTimeout(600);
  const beforeBold = await runState();
  await win.locator('[data-txt-bold]').click();
  await win.waitForTimeout(800);
  const afterBold = await runState();
  console.log(`[P51-F item13] before=${JSON.stringify(beforeBold.selection)} after=${JSON.stringify(afterBold.selection)} bold=${afterBold.bold}`);
  expect(afterBold.bold, 'item 13: Bold is applied').toBe('true');
  expect(Math.abs(afterBold.selection.l - beforeBold.selection.l), 'item 13: the box did not jump back').toBeLessThanOrEqual(3);
  expect(Math.abs(afterBold.selection.t - beforeBold.selection.t), 'item 13: the box did not jump back').toBeLessThanOrEqual(3);

  // (14) with nothing selected no formatting control looks active.
  await win.keyboard.press('Escape');
  await win.waitForTimeout(600);
  const s14 = await runState();
  console.log(`[P51-F item14] selection=${JSON.stringify(s14.selection)} bold=${s14.bold} italic=${s14.italic} super=${s14.super} sub=${s14.sub}`);
  expect(s14.selection, 'item 14: nothing is selected').toBeNull();
  expect(s14.bold, 'item 14: Bold is not active').not.toBe('true');
  expect(s14.italic, 'item 14: Italic is not active').not.toBe('true');
  expect(s14.super, 'item 14: Superscript is not active').not.toBe('true');
  expect(s14.sub, 'item 14: Subscript is not active').not.toBe('true');

  // Item 6 (deferred): selecting a run must focus the Inspector Text field.
  expect(s6.activeIsField, 'item 6: the Inspector Text field is focused').toBe(true);
});

test('P51-F items 15,16: a second move leaves no copy; super shows one copy', async () => {
  await launch();
  await openViaDialog(getSamplePath('long.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1200);
  await gotoStage(win, 2);
  await armEditText();
  expect(await selectRun(), 'a text run is selectable').toBe(true);
  await win.waitForTimeout(600);

  // (15) move once, confirm, re-select, move again, confirm: no residual copy.
  const first = await runState();
  await dragSelection(50, 25);
  await clickConfirm();
  // The proxy refresh that bakes the move is async (DEF-155): wait for the
  // cover to release AND the refreshed text layer to carry the moved run
  // before re-selecting at the moved position.
  await win.waitForSelector('[data-edit-box-eraser]', { state: 'detached', timeout: 15000 }).catch(() => {});
  const moved = { l: first.selection.l + 50, t: first.selection.t + 25, w: first.selection.w, h: first.selection.h };
  await waitForTextLayerAt(moved);
  const afterFirst = await runState();
  console.log(`[P51-F item15 first] selection=${JSON.stringify(afterFirst.selection)} preview=${JSON.stringify(afterFirst.preview)}`);
  expect(afterFirst.preview, 'item 15: no residual copy after the first move').toBeNull();

  // Re-select at the moved position.
  await win.mouse.click(moved.l + moved.w / 2, moved.t + moved.h / 2);
  await win.waitForTimeout(600);
  const beforeSecond = await runState();
  console.log(`[P51-F item15 reselect] selection=${JSON.stringify(beforeSecond.selection)}`);
  expect(beforeSecond.selection, 'item 15: the run is re-selected at the moved position').not.toBeNull();
  await dragSelection(40, 20);
  const afterSecond = await runState();
  console.log(`[P51-F item15 second] before=${JSON.stringify(beforeSecond.preview)} after=${JSON.stringify(afterSecond.preview)} eraser=${JSON.stringify(afterSecond.eraser)}`);
  expect(afterSecond.preview.l, 'item 15: the second move moved the text').toBeGreaterThan(beforeSecond.preview.l + 10);
  expect(afterSecond.eraser.l, 'item 15: the cover holds the pre-move rect (no copy at the original)').toBe(beforeSecond.eraser.l);
  await clickConfirm();
  // The second confirm's proxy refresh is async (DEF-155): wait for the
  // cover to release and the refreshed text layer to carry the moved run
  // before re-selecting at the moved position (same as item 15).
  await win.waitForSelector('[data-edit-box-eraser]', { state: 'detached', timeout: 15000 }).catch(() => {});
  const moved2 = { l: moved.l + 40, t: moved.t + 20, w: moved.w, h: moved.h };
  await waitForTextLayerAt(moved2);
  const s15 = await runState();
  expect(s15.preview, 'item 15: no residual copy after the second move').toBeNull();

  // (16) superscript shows no second copy.
  await win.mouse.click(moved2.l + moved2.w / 2, moved2.t + moved2.h / 2);
  await win.waitForTimeout(600);
  expect((await runState()).selection, 'item 16: the run is re-selected').not.toBeNull();
  await win.locator('[data-txt-super]').click();
  await win.waitForTimeout(800);
  const s16 = await runState();
  console.log(`[P51-F item16] super=${s16.super} previewCount=${s16.previewCount} eraser=${JSON.stringify(s16.eraser)} preview=${JSON.stringify(s16.preview)}`);
  expect(s16.super, 'item 16: Superscript is applied').toBe('true');
  expect(s16.previewCount, 'item 16: exactly one preview (no second copy)').toBe(1);
  expect(s16.eraser.t, 'item 16: the cover follows the baseline shift upward').toBeLessThan(s16.preview.t + 1);
});

// ---------------------------------------------------------------------------
// G (items 9,10) - OCR cancel + the suspects view in the Inspector.
// ---------------------------------------------------------------------------
async function openOcrDialog() {
  await runTool(win, 'recognizeText');
  await win.waitForSelector('[data-ocr-confirm]', { timeout: 20000 });
  // Scope to the current page so the run is fast (one page, not six).
  await win.locator('[data-ocr-scope="currentPage"]').check().catch(() => {});
  await win.waitForTimeout(300);
}

test('P51-G item 9: cancelling OCR stops the run and leaves the document unchanged', async () => {
  await launch();
  await openViaDialog(getSamplePath('scanned.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1500);

  await openOcrDialog();
  await win.locator('[data-ocr-confirm]').click();
  // The run is in flight once Cancel is offered.
  await win.waitForSelector('[data-ocr-cancel]', { timeout: 60000 });
  await win.waitForTimeout(2000);

  await win.locator('[data-ocr-cancel]').click();
  await win.waitForTimeout(2000);
  const cancelled = await win.evaluate(() => ({
    cancelGone: document.querySelector('[data-ocr-cancel]') === null,
    cancelledNotice: document.querySelector('[data-ocr-cancelled]') !== null,
    error: document.querySelector('[data-ocr-error]') !== null,
    errorText: document.querySelector('[data-ocr-error]')?.textContent ?? null,
  }));
  console.log(`[P51-G item9 cancel] ${JSON.stringify(cancelled)}`);
  expect(cancelled.cancelGone, 'item 9: the running state ended').toBe(true);
  expect(cancelled.cancelledNotice, 'item 9: the truthful Cancelled notice is shown').toBe(true);
  expect(cancelled.error, 'item 9: no error state').toBe(false);

  // No error toast.
  const toasts = await win.evaluate(() => [...document.querySelectorAll('.toast, [data-toast], [role="alert"]')].map((t) => t.textContent).filter(Boolean));
  console.log(`[P51-G item9 toasts] ${JSON.stringify(toasts)}`);

  // The document is unchanged: not modified, no suspects recorded.
  const state = await win.evaluate(() => {
    const d = window.tflexDiagnostics();
    return { modified: d.modified, tabModified: d.tabModified };
  });
  console.log(`[P51-G item9 state] ${JSON.stringify(state)}`);
  expect(state.modified, 'item 9: the document is not modified').toBe(false);

  // Close the dialog and run again: a fresh run works.
  await win.locator('.modal-close').first().click().catch(() => {});
  await win.waitForTimeout(800);
  await openOcrDialog();
  await win.locator('[data-ocr-confirm]').click();
  // Wait for the run to finish (the dialog closes on success).
  await win.waitForSelector('[data-ocr-confirm]', { state: 'detached', timeout: 180000 }).catch(() => {});
  await win.waitForTimeout(1500);
  const after = await win.evaluate(() => {
    const d = window.tflexDiagnostics();
    return { modified: d.modified, dialogOpen: document.querySelector('[data-ocr-confirm]') !== null };
  });
  console.log(`[P51-G item9 fresh run] ${JSON.stringify(after)}`);
  expect(after.dialogOpen, 'item 9: the fresh run completed (dialog closed)').toBe(false);
  expect(after.modified, 'item 9: the fresh run applied (document modified)').toBe(true);
});

test('P51-G item 10: the suspects view lives in the Inspector, cleanly formatted', async () => {
  await launch();
  await openViaDialog(getSamplePath('scanned.pdf'));
  await win.waitForSelector('.pdf-page canvas', { timeout: 30000 });
  await win.waitForTimeout(1500);

  // Run OCR to completion so the suspects view has data.
  await openOcrDialog();
  await win.locator('[data-ocr-confirm]').click();
  await win.waitForSelector('[data-ocr-confirm]', { state: 'detached', timeout: 180000 }).catch(() => {});
  await win.waitForTimeout(2000);

  // The suspects view is an Inspector section.
  await win.waitForSelector('[data-inspector-section="ocr-suspects"]', { timeout: 20000 });
  const layout = await win.evaluate(() => {
    const insp = document.querySelector('[data-inspector]');
    const section = document.querySelector('[data-inspector-section="ocr-suspects"]');
    const panel = document.querySelector('[data-ocr-suspects-panel]');
    const ctx = document.querySelector('[data-context-panel]');
    const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }; };
    const rows = [...document.querySelectorAll('[data-ocr-suspect-word]')].map((btn) => {
      const wordEl = btn.querySelector('.ocr-suspects-word');
      const conf = btn.querySelector('.ocr-suspects-confidence');
      const wr = wordEl ? wordEl.getBoundingClientRect() : null;
      const cr = conf ? conf.getBoundingClientRect() : null;
      const wcs = wordEl ? getComputedStyle(wordEl) : null;
      const bcs = getComputedStyle(btn);
      return { word: wordEl ? wordEl.textContent : null, l: wr ? Math.round(wr.left) : null, r: wr ? Math.round(wr.right) : null, confL: cr ? Math.round(cr.left) : null, confR: cr ? Math.round(cr.right) : null, wDisplay: wcs ? wcs.display : null, wFlex: wcs ? wcs.flex : null, wMinW: wcs ? wcs.minWidth : null, wMaxW: wcs ? wcs.maxWidth : null, wOverflow: wcs ? wcs.overflow : null, bDisplay: bcs.display, bWidth: bcs.width, bJustify: bcs.justifyContent };
    });
    return {
      inInspector: insp !== null && insp.contains(section),
      panelInInspector: insp !== null && panel !== null && insp.contains(panel),
      panelInContext: ctx !== null && panel !== null && ctx.contains(panel),
      section: box(section),
      panel: box(panel),
      rows,
      opener: document.querySelector('[data-context-panel-action="suspects"]') !== null,
      openerDisabled: document.querySelector('[data-context-panel-action="suspects"]')?.disabled ?? null,
      contextSections: [...document.querySelectorAll('[data-context-panel-section]')].map((s) => s.getAttribute('data-context-panel-section')),
    };
  });
  console.log(`[P51-G item10 layout] inInspector=${layout.inInspector} panelInInspector=${layout.panelInInspector} panelInContext=${layout.panelInContext} section=${JSON.stringify(layout.section)} panel=${JSON.stringify(layout.panel)} opener=${layout.opener} openerDisabled=${layout.openerDisabled} contextSections=${JSON.stringify(layout.contextSections)} rowCount=${layout.rows.length}`);
  console.log(`[P51-G item10 firstRows] ${JSON.stringify(layout.rows.slice(0, 3))}`);
  expect(layout.inInspector, 'item 10: the suspects section is inside the Inspector').toBe(true);
  expect(layout.panelInInspector, 'item 10: the suspects panel is inside the Inspector').toBe(true);
  expect(layout.panelInContext, 'item 10: the suspects panel is NOT in the context panel').toBe(false);
  expect(layout.opener, 'item 10: the Review suspects opener is still reachable').toBe(true);
  // No overlap: each row's word and confidence are on one line, word left of
  // confidence, and the confidence stays inside the panel.
  const overlaps = layout.rows.filter((r) => r.confL === null || r.r > r.confL + 1 || r.confR > layout.panel.r + 1);
  console.log(`[P51-G item10 overlaps] count=${overlaps.length} sample=${JSON.stringify(overlaps.slice(0, 3))}`);
  expect(overlaps.length, 'item 10: no word/confidence overlap').toBe(0);
  await win.screenshot({ path: path.join(SHOTS, 'phase51-ocr-suspects-inspector.png') });
});

// ---------------------------------------------------------------------------
// I (item 8) - the open-error message mapping is readable.
// ---------------------------------------------------------------------------
test('P51-I item 8: an encrypted PDF produces a readable, specific message (never [object Object])', async () => {
  await launch();

  // The engine path: loadDocumentBytes with an /Encrypt document.
  const engineRes = await win.evaluate(async () => {
    const bytes = new TextEncoder().encode('%PDF-1.5\n1 0 obj\n<< /Encrypt 2 0 R >>\nendobj\nstartxref\n0\n%%EOF\n');
    const r = await window.tflex.engine.loadDocumentBytes('p51-encrypted-probe', bytes);
    return r;
  });
  console.log(`[P51-I engine] ${JSON.stringify(engineRes)}`);
  expect(engineRes.ok, 'item 8: the encrypted bytes fail to load').toBe(false);
  expect(engineRes.error.message, 'item 8: the engine message is readable').not.toContain('[object Object]');
  expect(engineRes.error.message, 'item 8: the engine message names the parse failure').toContain('could not parse PDF bytes');
});
