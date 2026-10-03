// TFL-477 pure-service probe — LIGHT (no electron, no full build, no build lock).
// Bundles the SHIPPED src/main/services/sanitize.ts and runs catalog-level
// attack vectors on it. This is static/adversarial verification, not the e2e run.
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ROOT = path.resolve(__dirname, '..', '..');
const { PDFDocument, PDFArray, PDFDict, PDFName, PDFString } = require('@cantoo/pdf-lib');

async function bundle() {
  const esbuild = require('esbuild');
  const entry = path.join(os.tmpdir(), `adv88-pure-entry-${Date.now()}.ts`);
  fs.writeFileSync(
    entry,
    [
      "export { stripActiveContent } from '" + path.join(ROOT, 'src/main/services/sanitize').replace(/\\/g, '/') + "';",
      "export { collectJavaScript } from '" + path.join(ROOT, 'src/main/services/validation/pdfa').replace(/\\/g, '/') + "';",
      '',
    ].join('\n'),
  );
  const out = path.join(__dirname, '_adv88_pure.bundle.cjs');
  await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    outfile: out,
    // Keep pdf-lib EXTERNAL: the bundle lives in the repo, so it resolves the
    // SAME @cantoo/pdf-lib instance the probe uses. Bundling it in would create
    // a second class identity and break every `instanceof` inside the service.
    external: ['@cantoo/pdf-lib'],
    logLevel: 'silent',
  });
  return require(out);
}

const ALL = { javascript: true, launchActions: true, embeddedFiles: true, metadata: true };
const NONE = { javascript: false, launchActions: false, embeddedFiles: false, metadata: false };

function openActionS(doc) {
  const v = doc.catalog.get(PDFName.of('OpenAction'));
  if (v === undefined) return { present: false };
  const d = doc.context.lookupMaybe(v, PDFDict);
  return { present: true, hasFs: !!(d && d.has(PDFName.of('FS'))), s: d ? String(d.get(PDFName.of('S'))) : null };
}

function pageAaJs(doc) {
  const v = doc.getPage(0).node.get(PDFName.of('AA'));
  if (v === undefined) return false;
  const aa = doc.context.lookupMaybe(v, PDFDict);
  if (!aa) return false;
  for (const key of aa.keys()) {
    const act = doc.context.lookupMaybe(aa.get(key), PDFDict);
    if (!act) continue;
    const sv = act.get(PDFName.of('S'));
    const s = doc.context.lookupMaybe(sv, PDFName) || (sv instanceof PDFName ? sv : undefined);
    if (s && s.decodeText() === 'JavaScript') return true;
  }
  return false;
}

async function mk() {
  const d = await PDFDocument.create();
  d.addPage([612, 792]);
  return d;
}

(async () => {
  const M = await bundle();
  const out = {};

  // X1 direct /S page /AA
  {
    const d = await mk();
    d.getPage(0).node.set(PDFName.of('AA'), d.context.obj({ O: { S: 'JavaScript', JS: PDFString.of('a') } }));
    const r = M.stripActiveContent(d, ALL);
    out.direct_pageAA = { removedJs: r.report.removedByClass.javascript, aaJsAlive: pageAaJs(d), warnings: r.warnings };
  }
  // X2 INDIRECT /S page /AA
  {
    const d = await mk();
    const jsn = d.context.register(PDFName.of('JavaScript'));
    d.getPage(0).node.set(PDFName.of('AA'), d.context.obj({ O: { S: jsn, JS: PDFString.of('a') } }));
    const r = M.stripActiveContent(d, ALL);
    out.indirect_pageAA = { removedJs: r.report.removedByClass.javascript, aaJsAlive: pageAaJs(d), warnings: r.warnings };
  }
  // catalog OpenAction with no readable /S
  {
    const d = await mk();
    d.catalog.set(PDFName.of('Names'), d.context.obj({ JavaScript: { Names: [] } }));
    d.catalog.set(PDFName.of('OpenAction'), d.context.obj({ S: 42, JS: PDFString.of('a') }));
    const r = M.stripActiveContent(d, ALL);
    out.openAction_noS = { openAction: openActionS(d), removedJs: r.report.removedByClass.javascript, warnings: r.warnings };
  }
  // page /AA action with no readable /S
  {
    const d = await mk();
    d.getPage(0).node.set(PDFName.of('AA'), d.context.obj({ O: { S: 99, JS: PDFString.of('a') } }));
    const r = M.stripActiveContent(d, ALL);
    out.pageAA_noS = { warnings: r.warnings };
  }
  // annotation /A wrong type
  {
    const d = await mk();
    d.getPage(0).node.set(PDFName.of('Annots'), d.context.obj([{ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 10, 10], A: PDFString.of('x') }]));
    const r = M.stripActiveContent(d, ALL);
    out.annotA_wrongType = { warnings: r.warnings };
  }
  // wrong-typed /Names (control -> should warn)
  {
    const d = await mk();
    d.catalog.set(PDFName.of('Names'), d.context.obj(7));
    const r = M.stripActiveContent(d, ALL);
    out.names_wrongType = { warnings: r.warnings };
  }
  // case 10 Launch /FS
  {
    const a = await mk();
    a.catalog.set(PDFName.of('OpenAction'), a.context.obj({ S: 'Launch', FS: { Type: 'Filespec', F: 'a.txt' } }));
    const ra = M.stripActiveContent(a, { ...NONE, launchActions: true });
    const b = await mk();
    b.catalog.set(PDFName.of('OpenAction'), b.context.obj({ S: 'Launch', FS: { Type: 'Filespec', F: 'a.txt' } }));
    const rb = M.stripActiveContent(b, { ...NONE, embeddedFiles: true });
    out.launchFS = { launchOnly: { openAction: openActionS(a), removed: ra.report.removedByClass }, embedOnly: { openAction: openActionS(b), removed: rb.report.removedByClass } };
  }
  // GoTo survives
  {
    const d = await mk();
    d.catalog.set(PDFName.of('OpenAction'), d.context.obj({ S: 'GoTo', D: PDFString.of('x') }));
    const r = M.stripActiveContent(d, ALL);
    out.goto = { openAction: openActionS(d), removedLaunch: r.report.removedByClass.launchActions };
  }
  // idempotence
  {
    const d = await mk();
    d.catalog.set(PDFName.of('Names'), d.context.obj({ JavaScript: { Names: [] } }));
    const r1 = M.stripActiveContent(d, { ...NONE, javascript: true });
    const r2 = M.stripActiveContent(d, { ...NONE, javascript: true });
    out.idempotence = { first: r1.report.removedByClass, second: r2.report.removedByClass, warnings2: r2.warnings };
  }

  console.log(JSON.stringify(out, null, 2));
  fs.rmSync(path.join(__dirname, '_adv88_pure.bundle.cjs'), { force: true });
})().catch((e) => { console.error('PROBE ERROR', e); process.exit(1); });
