// XML-layer hostile fixtures (ODF / OOXML / PPTX) for Phase 55.
const fs = require('node:fs');
const path = require('node:path');
const { zipSync, strToU8 } = require('fflate');
const OUT = path.resolve(__dirname);
const F = (n) => path.join(OUT, n);

function writeOdt(name, contentXml, stylesXml) {
  fs.writeFileSync(
    F(name),
    Buffer.from(zipSync({
      'mimetype': strToU8('application/vnd.oasis.opendocument.text'),
      'content.xml': strToU8(contentXml),
      'styles.xml': strToU8(stylesXml || '<?xml version="1.0"?><office:document-styles/>'),
    }, { level: 6 })),
  );
}

const ODT_NS =
  '<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" ' +
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0">';
const ODT_BODY = '<office:body><office:text>';

// --- Billion laughs + external entity in content.xml ------------------------
{
  const laughs =
    '<?xml version="1.0"?><!DOCTYPE x [\n' +
    '<!ENTITY lol "lol">\n' +
    Array.from({ length: 9 }, (_, i) => `<!ENTITY lol${i + 1} "${`&lol${i};`.repeat(10)}">`).join('\n') +
    ']>\n' +
    ODT_NS + ODT_BODY + '<text:p>&lol9;</text:p></office:text></office:body></office:document-content>';
  writeOdt('odt-billion-laughs.odt', laughs);

  const ext =
    '<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///C:/Windows/win.ini">]>\n' +
    ODT_NS + ODT_BODY + '<text:p>BEFORE[&e;]AFTER</text:p></office:text></office:body></office:document-content>';
  writeOdt('odt-external-entity.odt', ext);
}

// --- 20,000-deep nesting ----------------------------------------------------
{
  const depth = 20000;
  const deep = ODT_NS + ODT_BODY + '<text:span>'.repeat(depth) + 'deep' + '</text:span>'.repeat(depth) +
    '</office:text></office:body></office:document-content>';
  writeOdt('odt-deep-nesting.odt', deep);
}

// --- Node-ceiling and text-ceiling content ---------------------------------
{
  const nodes = ODT_NS + ODT_BODY + '<text:p>x</text:p>'.repeat(300000) + '</office:text></office:body></office:document-content>';
  writeOdt('odt-node-ceiling.odt', nodes);

  const text = ODT_NS + ODT_BODY + '<text:p>' + 'A'.repeat(20 * 1024 * 1024) + '</text:p></office:text></office:body></office:document-content>';
  writeOdt('odt-text-ceiling.odt', text);
}

// --- PPTX package builder ---------------------------------------------------
function pptxFiles(slideXmls, presentationXml, slideRels) {
  const files = {
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/></Types>'),
    'ppt/presentation.xml': strToU8(presentationXml),
    'ppt/_rels/presentation.xml.rels': strToU8(
      '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      slideXmls.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join('') +
      '</Relationships>',
    ),
  };
  slideXmls.forEach((xml, i) => {
    files[`ppt/slides/slide${i + 1}.xml`] = strToU8(xml);
    if (slideRels && slideRels[i] !== undefined) files[`ppt/slides/_rels/slide${i + 1}.xml.rels`] = strToU8(slideRels[i]);
  });
  return files;
}

function sldIdLst(n) {
  return Array.from({ length: n }, (_, i) => `<p:sldId id="${256 + i}" r:id="rId${i + 1}"/>`).join('');
}

const PPT_NS = 'xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';

function deck(nSlides, opts = {}) {
  const pres =
    '<?xml version="1.0"?><p:presentation ' + PPT_NS + '><p:sldIdLst>' + sldIdLst(nSlides) + '</p:sldIdLst>' +
    `<p:sldSz cx="${opts.cx ?? 9144000}" cy="${opts.cy ?? 6858000}"/></p:presentation>`;
  const slides = Array.from({ length: nSlides }, (_, i) => {
    const sps = opts.shapes
      ? Array.from({ length: opts.shapes }, (_, s) =>
          `<p:sp><p:nvSpPr/><p:spPr><a:xfrm><a:off x="${s}" y="${s}"/><a:ext cx="100000" cy="100000"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>shape ${s}</a:t></a:r></a:p></p:txBody></p:sp>`).join('')
      : `<p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="100000" cy="100000"/></a:xfrm></p:spPr><p:txBody><a:p><a:r><a:t>slide ${i + 1}</a:t></a:r></a:p></p:txBody></p:sp>`;
    return '<?xml version="1.0"?><p:sld ' + PPT_NS + '>' + sps + '</p:sld>';
  });
  return pptxFiles(slides, pres, opts.rels);
}

function writePptx(name, nSlides, opts) {
  fs.writeFileSync(F(name), Buffer.from(zipSync(deck(nSlides, opts), { level: 6 })));
}

writePptx('pptx-10000-shapes.pptx', 1, { shapes: 10000 });
writePptx('pptx-sldsz-zero.pptx', 1, { cx: 0, cy: 0 });
writePptx('pptx-sldsz-huge.pptx', 1, { cx: '99999999999999999999', cy: '99999999999999999999' });

// Negative / non-numeric slide sizes cannot match the \d+ regex; craft raw.
{
  const files = deck(1);
  files['ppt/presentation.xml'] = strToU8('<?xml version="1.0"?><p:presentation ' + PPT_NS + '><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="-100" cy="-200"/></p:presentation>');
  fs.writeFileSync(F('pptx-sldsz-negative.pptx'), Buffer.from(zipSync(files, { level: 6 })));
  files['ppt/presentation.xml'] = strToU8('<?xml version="1.0"?><p:presentation ' + PPT_NS + '><p:sldIdLst><p:sldId id="256" r:id="rId1"/></p:sldIdLst><p:sldSz cx="NaN" cy="Infinity"/></p:presentation>');
  fs.writeFileSync(F('pptx-sldsz-nan.pptx'), Buffer.from(zipSync(files, { level: 6 })));
}

// Slide referencing a missing rel id
{
  const files = deck(1);
  files['ppt/slides/slide1.xml'] = strToU8('<?xml version="1.0"?><p:sld ' + PPT_NS + '><p:pic><p:blipFill><a:blip r:embed="rIdMISSING"/></p:blipFill></p:pic></p:sld>');
  fs.writeFileSync(F('pptx-missing-rel.pptx'), Buffer.from(zipSync(files, { level: 6 })));
}

// notesSlide with no parent slide + media that is not an image
{
  const files = deck(1);
  files['ppt/notesSlides/notesSlide1.xml'] = strToU8('<?xml version="1.0"?><p:notes ' + PPT_NS + '><p:cSld><p:spTree><p:sp><p:nvSpPr/><p:txBody><a:p><a:r><a:t>orphan note</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:notes>');
  files['ppt/media/image1.png'] = strToU8('%PDF-1.7 not really a png');
  files['ppt/media/image2.png'] = new Uint8Array(zipSync({ 'x.txt': strToU8('nested zip as media') }, { level: 0 }));
  files['ppt/slides/slide1.xml'] = strToU8('<?xml version="1.0"?><p:sld ' + PPT_NS + '><p:pic><p:blipFill><a:blip r:embed="rId9"/></p:blipFill></p:pic></p:sld>');
  files['ppt/slides/_rels/slide1.xml.rels'] = strToU8('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image1.png"/></Relationships>');
  fs.writeFileSync(F('pptx-media-not-image.pptx'), Buffer.from(zipSync(files, { level: 6 })));
}

console.log('XML fixtures written');
