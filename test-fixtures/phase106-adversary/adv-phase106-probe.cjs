// Phase 106 (Orbit Desk) adversarial probe — TFL-931 diff-pass.
// Read-only DOM/CSS probes over the real Electron app. Never mutates documents.
// Usage: node adv-phase106-probe.cjs <recents|layout|silence|session|persist>
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { launchApp } = require('../../e2e/lib/launch.cjs');
const { hardClose } = require('../../e2e/lib/helpers.cjs');

const HERE = __dirname;
const OUT = process.env.ADV_OUT || HERE;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freshUserData(tag) {
  const dir = path.join(os.tmpdir(), `tflex-adv-p106-${tag}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function seedRecents(dir) {
  const seed = JSON.parse(fs.readFileSync(path.join(HERE, 'recents-seed.json'), 'utf8'));
  fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(seed, null, 2), 'utf8');
}

async function setTheme(win, theme) {
  await win.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
  await win.waitForFunction((t) => document.documentElement.getAttribute('data-theme') === t, theme, { timeout: 8000 });
  await sleep(150);
}

const recentsEval = () => {
  const q = (s) => document.querySelector(s);
  const rows = [...document.querySelectorAll('[data-recent-row]')].map((row) => {
    const open = row.querySelector('.recent-row-open');
    const name = row.querySelector('.doc-name');
    const dirEl = row.querySelector('.doc-path');
    const fmt = row.querySelector('.doc-format');
    const when = row.querySelector('.doc-when');
    const remove = row.querySelector('.recent-row-remove');
    const r = row.getBoundingClientRect();
    const list = row.parentElement.getBoundingClientRect();
    const openCs = open ? getComputedStyle(open) : null;
    return {
      name: name ? name.textContent : null,
      dir: dirEl ? dirEl.textContent : null,
      format: fmt ? fmt.textContent : null,
      formatKind: fmt ? fmt.getAttribute('data-source-format') : null,
      when: when ? when.textContent : null,
      aria: open ? open.getAttribute('aria-label') : null,
      title: open ? open.getAttribute('title') : null,
      removeAria: remove ? remove.getAttribute('aria-label') : null,
      right: Math.round(r.right),
      listRight: Math.round(list.right),
      overflowsRowBox: Math.round(r.right) > Math.round(list.right) + 1,
      openCols: openCs ? openCs.gridTemplateColumns : null,
    };
  });
  const list = q('.recent-list');
  const listCs = list ? getComputedStyle(list) : null;
  const lr = list ? list.getBoundingClientRect() : null;
  return {
    count: rows.length,
    rows,
    listOverflowX: listCs ? listCs.overflowX : null,
    listScrollClipped: list ? list.scrollWidth > list.clientWidth + 1 : false,
    listWidth: lr ? Math.round(lr.width) : null,
    samples: [...document.querySelectorAll('[data-sample-card]')].map((c) => ({
      name: c.querySelector('.sample-name')?.textContent ?? null,
      sub: c.querySelector('.sample-sub')?.textContent ?? null,
      task: c.getAttribute('data-sample-task'),
      fmt: c.querySelector('.sample-thumb')?.getAttribute('data-sample-format') ?? null,
    })),
    pageOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
  };
};

const layoutEval = () => {
  const q = (s) => document.querySelector(s);
  const box = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) };
  };
  const toggle = q('[data-orbit-motion-toggle]');
  const hero = q('.orbit-desk-header');
  const tr = toggle ? toggle.getBoundingClientRect() : null;
  const hit = tr ? document.elementFromPoint(tr.left + tr.width / 2, tr.top + tr.height / 2) : null;
  const cards = [...document.querySelectorAll('[data-sample-card]')];
  return {
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    docScrollW: document.documentElement.scrollWidth,
    bodyScrollW: document.body.scrollWidth,
    horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    inner: box(q('.orbit-desk-inner')),
    innerPaddingTop: q('.orbit-desk-inner') ? getComputedStyle(q('.orbit-desk-inner')).paddingTop : null,
    bodyCols: q('.welcome-body') ? getComputedStyle(q('.welcome-body')).gridTemplateColumns : null,
    toggle: box(toggle),
    togglePos: toggle ? getComputedStyle(toggle).position : null,
    hero: box(hero),
    hit: hit ? (hit === toggle || (toggle && toggle.contains(hit)) ? 'toggle' : `${hit.tagName}.${hit.className}`) : null,
    sampleCards: cards.length,
    sampleCardWidths: cards.map((c) => Math.round(c.getBoundingClientRect().width)),
    sampleGridOverflow: (() => {
      const g = q('.samples-grid');
      return g ? g.scrollWidth - g.clientWidth : null;
    })(),
    recentsRight: box(q('[data-home-recents]'))?.r ?? null,
    exploreRight: box(q('[data-home-explore]'))?.r ?? null,
    innerRight: box(q('.orbit-desk-inner'))?.r ?? null,
  };
};

async function contrastEval(win) {
  return win.evaluate(() => {
    function parse(c) {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(',').map((x) => parseFloat(x));
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    }
    function lum(c) {
      const f = (v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
      };
      return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    }
    function ratio(a, b) {
      const l1 = Math.max(a, b);
      const l2 = Math.min(a, b);
      return (l1 + 0.05) / (l2 + 0.05);
    }
    const chip = document.querySelector('[data-recent-row] .doc-format');
    const orbit = document.querySelector('.orbit-desk-orbit');
    const chipCs = chip ? getComputedStyle(chip) : null;
    const card = chip ? chip.closest('.recent-row') : null;
    const cardBg = card ? getComputedStyle(card).backgroundColor : null;
    let chipContrast = null;
    if (chipCs) {
      const fg = parse(chipCs.color);
      const bg = parse(chipCs.backgroundColor);
      if (fg && bg && bg.a > 0) chipContrast = Math.round(ratio(lum(fg), lum(bg)) * 100) / 100;
    }
    return {
      theme: document.documentElement.getAttribute('data-theme'),
      chipColor: chipCs ? chipCs.color : null,
      chipBg: chipCs ? chipCs.backgroundColor : null,
      chipFontSize: chipCs ? chipCs.fontSize : null,
      chipContrast,
      motifOpacity: orbit ? Number(getComputedStyle(orbit).opacity) : null,
      welcomeBg: document.querySelector('.welcome.orbit-desk') ? getComputedStyle(document.querySelector('.welcome.orbit-desk')).backgroundColor : null,
      rowBg: cardBg,
    };
  });
}

async function main() {
  const mode = process.argv[2] || 'recents';
  const userData = freshUserData(mode);
  let seeded = false;
  if (['recents', 'silence', 'session', 'persist', 'narrow', 'hammer'].includes(mode)) {
    seedRecents(userData);
    seeded = true;
  }
  const app = await launchApp([], userData);
  const win = await app.firstWindow();
  const pageErrors = [];
  win.on('pageerror', (e) => pageErrors.push(e.message));
  await win.waitForSelector('.welcome.orbit-desk', { timeout: 30000 });
  await win.waitForSelector('[data-orbit-motif]', { timeout: 30000 });
  await sleep(400);
  const result = { mode, seeded, userData };

  if (mode === 'recents') {
    result.recents = await win.evaluate(recentsEval);
    result.themes = [];
    for (const t of ['light', 'dark', 'frosted']) {
      await setTheme(win, t);
      result.themes.push(await contrastEval(win));
    }
    await setTheme(win, 'light');
    await win.screenshot({ path: path.join(OUT, 'adv-p106-recents-light.png'), fullPage: true }).catch(() => {});
    await setTheme(win, 'dark');
    await win.screenshot({ path: path.join(OUT, 'adv-p106-recents-dark.png'), fullPage: true }).catch(() => {});
  } else if (mode === 'layout') {
    result.sizes = [];
    for (const [w, h] of [[1440, 900], [1024, 768], [860, 900], [640, 480], [480, 900], [2560, 1440]]) {
      await app.evaluate(async ({ BrowserWindow }, size) => {
        const bw = BrowserWindow.getAllWindows()[0];
        if (!bw) return;
        if (bw.isMaximized()) bw.unmaximize();
        bw.setResizable(true);
        bw.setBounds({ x: 20, y: 20, width: size.w, height: size.h });
      }, { w, h });
      await sleep(350);
      const r = await win.evaluate(layoutEval);
      r.windowSet = { w, h };
      result.sizes.push(r);
    }
    await app.evaluate(async ({ BrowserWindow }) => {
      const bw = BrowserWindow.getAllWindows()[0];
      if (bw) bw.setSize(640, 480);
    });
    await sleep(350);
    await win.screenshot({ path: path.join(OUT, 'adv-p106-640x480.png') }).catch(() => {});
    await app.evaluate(async ({ BrowserWindow }) => {
      const bw = BrowserWindow.getAllWindows()[0];
      if (bw) bw.setSize(1440, 900);
    });
    await sleep(250);
  } else if (mode === 'silence') {
    // Enumerate every actionable Home element and click with a DOM/state diff.
    result.controls = [];
    const before = await win.evaluate(() => ({
      rows: document.querySelectorAll('[data-recent-row]').length,
      editPressed: document.querySelector('[data-home-edit-toggle]')?.getAttribute('aria-pressed'),
      bodyClass: document.querySelector('.welcome')?.className,
    }));
    result.before = before;
    const clickAndDiff = async (sel, label) => {
      const snap = () => win.evaluate(() => ({
        rows: document.querySelectorAll('[data-recent-row]').length,
        editPressed: document.querySelector('[data-home-edit-toggle]')?.getAttribute('aria-pressed'),
        toasts: document.querySelectorAll('.toast, [data-toast]').length,
        dialogs: document.querySelectorAll('[role="dialog"]').length,
        tabs: document.querySelectorAll('[role="tab"]').length,
      }));
      const b = await snap();
      let err = null;
      try {
        await win.click(sel, { timeout: 3000 });
      } catch (e) {
        err = String(e.message).split('\n')[0];
      }
      await sleep(350);
      const a = await snap();
      result.controls.push({ label, sel, err, diff: {
        rows: a.rows - b.rows, editPressed: a.editPressed !== b.editPressed,
        toasts: a.toasts - b.toasts, dialogs: a.dialogs - b.dialogs, tabs: a.tabs - b.tabs,
      }});
    };
    // Safe, non-navigating controls first.
    await clickAndDiff('[data-orbit-motion-toggle]', 'motion pause');
    await clickAndDiff('[data-orbit-motion-toggle]', 'motion resume');
    await clickAndDiff('[data-home-edit-toggle]', 'edit pen arm');
    await clickAndDiff('[data-home-edit-toggle]', 'edit pen disarm');
    // A recent row open for a missing file -> expect an error toast (still an effect).
    await clickAndDiff('[data-recent-row]:nth-child(1) .recent-row-open', 'open recent (missing)');
    // A recent remove -> row count drops.
    await clickAndDiff('[data-recent-row]:nth-child(1) .recent-row-remove', 'remove recent');
  } else if (mode === 'session') {
    // Open a sample (creates a tab), then add an empty tab (Home) and verify the
    // first session survives.
    await win.click('[data-sample-card]:nth-child(1)');
    await sleep(1500);
    const afterOpen = await win.evaluate(() => ({
      tabs: document.querySelectorAll('[role="tab"]').length,
      canvas: !!document.querySelector('.pdf-page, .page-canvas, canvas'),
      hasHome: !!document.querySelector('.welcome.orbit-desk'),
    }));
    await win.keyboard.press('Control+T').catch(() => {});
    await sleep(400);
    const newTabBtn = await win.$('[data-new-tab]');
    if (newTabBtn) await newTabBtn.click().catch(() => {});
    await sleep(1000);
    const afterNew = await win.evaluate(() => ({
      tabs: document.querySelectorAll('[role="tab"]').length,
      hasHome: !!document.querySelector('.welcome.orbit-desk'),
      tabTitles: [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent),
    }));
    // Return to the first document tab and confirm the session survived.
    const firstTab = await win.$('[role="tab"]');
    if (firstTab) await firstTab.click().catch(() => {});
    await sleep(900);
    const backToDoc = await win.evaluate(() => ({
      hasHome: !!document.querySelector('.welcome.orbit-desk'),
      canvas: !!document.querySelector('.pdf-page, .page-canvas, canvas'),
      tabs: document.querySelectorAll('[role="tab"]').length,
    }));
    result.afterOpen = afterOpen;
    result.afterNew = afterNew;
    result.backToDoc = backToDoc;
  } else if (mode === 'narrow') {
    // Hostile recents: a 300-char unbreakable token, a very long extension, a
    // name that is only dots, and a deeply nested duplicate.
    await win.evaluate(() => undefined); // no-op keep shape
    await app.evaluate(async ({ BrowserWindow }) => {
      const bw = BrowserWindow.getAllWindows()[0];
      if (!bw) return;
      if (bw.isMaximized()) bw.unmaximize();
      bw.setBounds({ x: 20, y: 20, width: 640, height: 480 });
    });
    await sleep(400);
    result.narrow = await win.evaluate(() => {
      const rows = [...document.querySelectorAll('[data-recent-row]')];
      return {
        windowW: window.innerWidth,
        rows: rows.map((r) => {
          const open = r.querySelector('.recent-row-open');
          const name = r.querySelector('.doc-name');
          const fmt = r.querySelector('.doc-format');
          const when = r.querySelector('.doc-when');
          const list = r.parentElement.getBoundingClientRect();
          const rr = r.getBoundingClientRect();
          const nr = name ? name.getBoundingClientRect() : null;
          const cr = fmt ? fmt.getBoundingClientRect() : null;
          const wr = when ? when.getBoundingClientRect() : null;
          return {
            name: name ? name.textContent.slice(0, 40) : null,
            format: fmt ? fmt.textContent : null,
            nameW: nr ? Math.round(nr.width) : null,
            nameVisible: nr ? nr.width > 4 : null,
            chipRight: cr ? Math.round(cr.right) : null,
            whenRight: wr ? Math.round(wr.right) : null,
            rowRight: Math.round(rr.right),
            listRight: Math.round(list.right),
            overflows: Math.round(rr.right) > Math.round(list.right) + 1,
          };
        }),
        docOverflowX: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    await win.screenshot({ path: path.join(OUT, 'adv-p106-narrow.png') }).catch(() => {});
  } else if (mode === 'leak') {
    // 25 Home mount/unmount cycles: open a new empty tab (Home) then close it.
    const heap = async () =>
      win.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize : -1));
    result.heap = [];
    result.heap.push({ cycle: 0, bytes: await heap() });
    for (let i = 1; i <= 25; i += 1) {
      const btn = await win.$('[data-new-tab]');
      if (btn) await btn.click().catch(() => {});
      await sleep(250);
      // close the empty tab: the active tab's close control
      const close = await win.$('[data-tab-id] [data-tab-close], [data-tab-close]');
      if (close) await close.click().catch(() => {});
      await sleep(250);
      if (i % 5 === 0) result.heap.push({ cycle: i, bytes: await heap() });
    }
    result.heapFinal = await heap();
  } else if (mode === 'hammer') {
    for (let i = 0; i < 15; i += 1) {
      await win.click('[data-orbit-motion-toggle]', { timeout: 2000 }).catch(() => {});
    }
    await sleep(500);
    result.hammerMotion = await win.evaluate(() => ({
      motion: document.querySelector('.orbit-desk-orbit')?.getAttribute('data-orbit-motion'),
      pressed: document.querySelector('[data-orbit-motion-toggle]')?.getAttribute('aria-pressed'),
      rootAnimations: document.documentElement.getAttribute('data-animations'),
    }));
    for (let i = 0; i < 15; i += 1) {
      await win.click('[data-home-edit-toggle]', { timeout: 2000 }).catch(() => {});
    }
    await sleep(300);
    result.hammerEdit = await win.evaluate(() => ({
      pressed: document.querySelector('[data-home-edit-toggle]')?.getAttribute('aria-pressed'),
      minusCount: document.querySelectorAll('[data-home-minus]').length,
      plus: !!document.querySelector('[data-home-plus]'),
    }));
  } else if (mode === 'persist') {
    // Toggle pause, quit, relaunch same userData, verify the setting survived
    // and the motif holds its static pose.
    await win.click('[data-orbit-motion-toggle]');
    await win.waitForFunction(() => document.querySelector('.orbit-desk-orbit')?.getAttribute('data-orbit-motion') === 'off', null, { timeout: 8000 });
    result.pausedState = await win.evaluate(() => ({
      motion: document.querySelector('.orbit-desk-orbit')?.getAttribute('data-orbit-motion'),
      rootAnimations: document.documentElement.getAttribute('data-animations'),
      pressed: document.querySelector('[data-orbit-motion-toggle]')?.getAttribute('aria-pressed'),
    }));
    await sleep(600);
    await hardClose(app);
    const app2 = await launchApp([], userData);
    const win2 = await app2.firstWindow();
    await win2.waitForSelector('.welcome.orbit-desk', { timeout: 30000 });
    await sleep(500);
    result.afterRestart = await win2.evaluate(() => ({
      motion: document.querySelector('.orbit-desk-orbit')?.getAttribute('data-orbit-motion'),
      rootAnimations: document.documentElement.getAttribute('data-animations'),
      pressed: document.querySelector('[data-orbit-motion-toggle]')?.getAttribute('aria-pressed'),
      label: document.querySelector('[data-orbit-motion-toggle]')?.getAttribute('aria-label'),
    }));
    result.pageErrors2 = [];
    win2.on('pageerror', (e) => result.pageErrors2.push(e.message));
    await hardClose(app2);
    result.pageErrors = pageErrors;
    result.path = userData;
    fs.writeFileSync(path.join(OUT, `adv-p106-${mode}.json`), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  result.pageErrors = pageErrors;
  fs.writeFileSync(path.join(OUT, `adv-p106-${mode}.json`), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  await hardClose(app);
}

main().catch((e) => {
  console.error('PROBE FAILED:', e && e.stack ? e.stack : e);
  process.exit(1);
});
