// Adversary probe: exercise the SHIPPED ODF and PPTX pure parsers.
const fs = require('node:fs');
const path = require('node:path');
const M = require('./bundle.cjs');
const file = process.argv[2];
const mode = process.argv[3];
function rss() { return Math.round(process.memoryUsage().rss / (1024 * 1024)); }
const bytes = new Uint8Array(fs.readFileSync(file));
console.log(`[probe] file=${file} size=${bytes.length} mode=${mode} rss0=${rss()}MB`);
const t0 = Date.now();

try {
  const arch = M.openZip(bytes);
  if (mode === 'odt') {
    const content = arch.readText('content.xml');
    const styles = M.parseOfficeStyles(arch.readText('styles.xml') || '<?xml version="1.0"?><office:document-styles/>');
    const html = M.odfToHtml(content, styles, new Map());
    const lolCount = (html.match(/lol/g) || []).length;
    console.log(`[probe] odfToHtml OK in ${Date.now() - t0} ms; htmlLen=${html.length} lolOccurrences=${lolCount}`);
    console.log(`[probe] html sample: ${JSON.stringify(html.slice(0, 300))}`);
  } else {
    const pres = M.parsePresentationXml(arch.readText('ppt/presentation.xml'));
    console.log(`[probe] presentation: ${JSON.stringify(pres)}`);
    const rels = M.parseRelationships(arch.readText('ppt/_rels/presentation.xml.rels') || '');
    const slidePaths = M.resolveSlideTargets(pres.slideRelIds, rels);
    console.log(`[probe] slidePaths=${slidePaths.length}`);
    const media = new Map();
    for (const n of arch.names()) if (n.startsWith('ppt/media/')) media.set(n, 'data:image/png;base64,AAAA');
    const slides = slidePaths.map((sp, i) => {
      const slideRels = M.parseRelationships(arch.readText(`ppt/slides/_rels/slide${i + 1}.xml.rels`) || '');
      return { number: i + 1, xml: arch.readText(sp), relationships: slideRels, baseDir: 'ppt/slides', notesText: null };
    });
    const rendered = M.renderPptxDeckHtml({ widthEmu: pres.widthEmu, heightEmu: pres.heightEmu, slides, media, includeNotes: false });
    console.log(`[probe] renderPptxDeckHtml OK in ${Date.now() - t0} ms; htmlLen=${rendered.html.length} slidePages=${rendered.slidePages} warnings=${rendered.warnings.length}`);
    console.log(`[probe] first warnings: ${JSON.stringify(rendered.warnings.slice(0, 3))}`);
  }
} catch (e) {
  console.log(`[probe] THREW name=${e.name} msg=${e.message} after ${Date.now() - t0} ms; rss=${rss()}MB`);
}
console.log(`[probe] rss=${rss()}MB`);
console.log('[probe] COMPLETE');
