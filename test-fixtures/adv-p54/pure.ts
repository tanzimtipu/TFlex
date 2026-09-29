// Phase 54 adversary pure-parser harness. Exercises the REAL source modules
// (parseSvg, generatePaintOps, readPngMeta, readJpegMeta, xmp) with hostile
// input, and prints what they return. Bundled with esbuild to pure.cjs and run
// under Node. Nothing here edits product code.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseSvg,
  parseViewBox,
  parseLengthPoints,
  resolveSvgSize,
} from '../../src/main/services/convert/svg/svg-parse';
import {
  generatePaintOps,
  parseTransform,
  parseColorToHex,
} from '../../src/main/services/convert/svg/svg-paint';
import {
  readPngMeta,
  readJpegMeta,
  readTiffIfdMeta,
  resolveDpi,
} from '../../src/main/services/convert/image-meta';
import {
  extractXmpPacket,
  extractXmpInfo,
  parsePdfaId,
} from '../../src/main/services/validation/xmp';
import { contentUsesDeviceRgb } from '../../src/main/services/validation/pdfa';

const DIR = __dirname;
const file = (n: string) => join(DIR, n);
const jline = (o: unknown) => JSON.stringify(o);

function timeIt(label: string, fn: () => unknown): unknown {
  const t0 = Date.now();
  const r = fn();
  process.stdout.write(`TIME ${label} ${Date.now() - t0}ms\n`);
  return r;
}

// ---- 1/2. image metadata (PNG pHYs, JPEG JFIF) --------------------------
for (const name of ['png-phys-zero.png', 'png-phys-max.png', 'png-1x1-100000dpi.png', 'png-2000-1dpi.png', 'png-20000-1dpi.png']) {
  const meta = readPngMeta(readFileSync(file(name)));
  const dpi = meta ? resolveDpi(meta) : null;
  const page = meta && dpi
    ? { w: (meta.widthPx / dpi.dpiX) * 72, h: (meta.heightPx / dpi.dpiY) * 72 }
    : null;
  process.stdout.write(`PNG ${name} ${jline({ meta, pagePt: page })}\n`);
}
for (const name of ['jpg-jfif-unit0.jpg', 'jpg-jfif-density0.jpg']) {
  const meta = readJpegMeta(readFileSync(file(name)));
  process.stdout.write(`JPEG ${name} ${jline(meta)} assumed=${meta ? resolveDpi(meta).assumed : 'n/a'}\n`);
}

// ---- 11. entities -------------------------------------------------------
{
  const billion = readFileSync(file('svg-billion-laughs.svg'), 'utf8');
  const parsed = timeIt('billion-parse', () => parseSvg(billion));
  const paint = timeIt('billion-paint', () => generatePaintOps(parsed));
  const text = JSON.stringify(parsed.root?.text ?? '');
  process.stdout.write(`BILLION diagnostics=${jline(parsed.diagnostics)} rootTextLen=${text.length} ops=${paint.ops.length} untranslated=${jline(paint.untranslated)}\n`);

  const ext = readFileSync(file('svg-external-entity.svg'), 'utf8');
  const p2 = parseSvg(ext);
  const paint2 = generatePaintOps(p2);
  const all = JSON.stringify(p2.root);
  process.stdout.write(`XXE rootContainsWinIniContent=${all.includes('[fonts]') || all.includes('for 16-bit app support')} diagnostics=${jline(p2.diagnostics)} ops=${paint2.ops.length} untranslated=${jline(paint2.untranslated)}\n`);
}

// ---- 12. deep nesting ---------------------------------------------------
for (const [name, label] of [['svg-deep-nest.svg', '2000'], ['svg-deep-nest-100k.svg', '100000']]) {
  try {
    const src = readFileSync(file(name), 'utf8');
    const parsed = timeIt(`deep-${label}-parse`, () => parseSvg(src));
    const paint = timeIt(`deep-${label}-paint`, () => generatePaintOps(parsed));
    process.stdout.write(`DEEP ${label} ok ops=${paint.ops.length} diag=${parsed.diagnostics.length}\n`);
  } catch (e) {
    process.stdout.write(`DEEP ${label} THREW ${e instanceof Error ? e.name + ': ' + e.message.slice(0, 120) : String(e)}\n`);
  }
}

// ---- 13. huge path ------------------------------------------------------
{
  const src = readFileSync(file('svg-huge-path.svg'), 'utf8');
  const parsed = timeIt('huge-path-parse', () => parseSvg(src));
  const paint = timeIt('huge-path-paint', () => generatePaintOps(parsed));
  process.stdout.write(`HUGEPATH ops=${paint.ops.length} dLen=${(paint.ops[0] as { d?: string })?.d?.length ?? 0}\n`);
}

// ---- 14. hostile numbers ------------------------------------------------
{
  const src = readFileSync(file('svg-numeric-hostile.svg'), 'utf8');
  const parsed = parseSvg(src);
  const paint = generatePaintOps(parsed);
  process.stdout.write(`NUMERIC size=${jline(resolveSvgSize(parsed))} viewBox=${jline(parsed.viewBox)} ops=${jline(paint.ops.map((o) => o.kind))} diag=${jline(parsed.diagnostics.slice(0, 6))}\n`);
  const src2 = readFileSync(file('svg-numeric-hostile2.svg'), 'utf8');
  const p2 = parseSvg(src2);
  process.stdout.write(`NUMERIC2 size=${jline(resolveSvgSize(p2))} ops=${jline(generatePaintOps(p2).ops)}\n`);
  process.stdout.write(`TRANSFORM ${jline(parseTransform('translate(NaN, Infinity) scale(1e999) rotate(-1e999)'))}\n`);
  const diag: string[] = [];
  process.stdout.write(`COLOR ${jline(parseColorToHex('rgba(NaN,Infinity,-5)', diag))} ${jline(diag)}\n`);
}

// ---- 15. viewBox / size -------------------------------------------------
{
  for (const name of ['svg-zero-viewbox.svg', 'svg-negative-viewbox.svg', 'svg-zero-size.svg', 'svg-zero-size-vb.svg']) {
    const parsed = parseSvg(readFileSync(file(name), 'utf8'));
    process.stdout.write(`SIZE ${name} viewBox=${jline(parsed.viewBox)} w=${jline(parsed.width)} h=${jline(parsed.height)} resolved=${jline(resolveSvgSize(parsed))} diag=${jline(parsed.diagnostics)}\n`);
  }
  process.stdout.write(`VIEWBOX-direct ${jline(parseViewBox('0 0 0 0', []))} ${jline(parseViewBox('0 0 -1 -1', []))}\n`);
  process.stdout.write(`LEN 1e999=${jline(parseLengthPoints('1e999px'))} NaN=${jline(parseLengthPoints('NaN'))} neg=${jline(parseLengthPoints('-5'))}\n`);
}

// ---- 16. use loops ------------------------------------------------------
for (const name of ['svg-use-loop.svg', 'svg-use-500.svg']) {
  const parsed = parseSvg(readFileSync(file(name), 'utf8'));
  const paint = timeIt(`use-${name}`, () => generatePaintOps(parsed));
  process.stdout.write(`USE ${name} ops=${paint.ops.length} untranslated=${jline(paint.untranslated)}\n`);
}

// ---- 19. truncated SVGs -------------------------------------------------
for (const name of ['svg-truncated-25.svg', 'svg-truncated-50.svg', 'svg-truncated-75.svg', 'svg-truncated-90.svg']) {
  const parsed = parseSvg(readFileSync(file(name), 'utf8'));
  process.stdout.write(`TRUNC ${name} root=${parsed.root !== null} size=${jline(parsed.root ? resolveSvgSize(parsed) : null)} diag=${jline(parsed.diagnostics)}\n`);
}

// ---- 20/21. XMP identification -----------------------------------------
{
  for (const name of ['val-pdfa-part9.pdf', 'val-pdfa-unknown-conf.pdf']) {
    const bytes = readFileSync(file(name));
    const text = bytes.toString('latin1');
    const start = text.indexOf('<?xpacket');
    const pkt = start >= 0 ? text.slice(start) : null;
    process.stdout.write(`XMP ${name} ${jline(extractXmpInfo(pkt))}\n`);
  }
  const xmp = '<?xpacket?><x:xmpmeta><rdf:RDF><rdf:Description xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"><pdfaid:part>1</pdfaid:part><pdfaid:conformance>x</pdfaid:conformance></rdf:Description></rdf:RDF></x:xmpmeta>';
  process.stdout.write(`XMP synth ${jline(parsePdfaId(xmp))} packet=${jline(extractXmpPacket(Buffer.from(xmp, 'utf8'))?.slice(0, 40))}\n`);
}

// ---- content stream heuristic ------------------------------------------
process.stdout.write(`RGB-SCAN ${contentUsesDeviceRgb('0 0 0 0 k 0 0 0 0 k')} / ${contentUsesDeviceRgb('1 0 0 rg')}\n`);

process.stdout.write('PURE HARNESS DONE\n');
