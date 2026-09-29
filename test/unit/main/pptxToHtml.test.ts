import { describe, expect, it } from 'vitest';
import {
  EMU_PER_PT,
  PptxParseError,
  composeDeckPageRule,
  decodeXmlText,
  emuToPt,
  extractNotesText,
  parsePresentationXml,
  parseRelationships,
  parseSlideXml,
  parseTextBody,
  renderPptxDeckHtml,
  resolvePackageTarget,
  resolveSlideTargets,
  relsPathFor,
  type PptxRelationship,
  type PptxSlideInput,
} from '../../../src/main/services/convert/pptx-to-html';

/**
 * Phase 55 feature C — the pure PPTX XML -> HTML mapper. No ZIP and no
 * Electron: presentation/slide/notes XML is fed directly, so slide order, run
 * sizes, geometry, shapes and every degradation rule are asserted here.
 */

const PRESENTATION_XML = `<?xml version="1.0"?>
<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:sldIdLst>
    <p:sldId id="256" r:id="rId4"/>
    <p:sldId id="257" r:id="rId2"/>
  </p:sldIdLst>
  <p:sldSz cx="12192000" cy="6858000" type="screen16x9"/>
</p:presentation>`;

const PRESENTATION_RELS = `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/>
</Relationships>`;

function slideXml(body: string): string {
  return (
    '<?xml version="1.0"?>' +
    '<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" ' +
    'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<p:cSld><p:spTree>${body}</p:spTree></p:cSld></p:sld>`
  );
}

/** A text box at (100pt, 50pt) sized 200pt x 80pt with a bold 18pt run and an
 *  italic 24pt run. */
const TEXT_SP =
  '<p:sp><p:spPr><a:xfrm><a:off x="1270000" y="635000"/>' +
  '<a:ext cx="2540000" cy="1016000"/></a:xfrm></p:spPr>' +
  '<p:txBody><a:bodyPr/><a:p>' +
  '<a:r><a:rPr lang="en-US" sz="1800" b="1"/><a:t>Hello</a:t></a:r>' +
  '<a:r><a:rPr lang="en-US" sz="2400" i="1"/><a:t>World</a:t></a:r>' +
  '</a:p></p:txBody></p:sp>';

function shapeSp(prst: string, fill: string, size = '127000'): string {
  return (
    '<p:sp><p:spPr><a:xfrm><a:off x="0" y="0"/>' +
    `<a:ext cx="${size}" cy="${size}"/></a:xfrm>` +
    `<a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>` +
    `<a:solidFill><a:srgbClr val="${fill}"/></a:solidFill></p:spPr></p:sp>`
  );
}

const IMAGE_PIC =
  '<p:pic><p:nvPicPr><p:cNvPr id="2" name="Picture"/></p:nvPicPr>' +
  '<p:blipFill><a:blip r:embed="rId1"/></p:blipFill>' +
  '<p:spPr><a:xfrm><a:off x="127000" y="254000"/>' +
  '<a:ext cx="1270000" cy="1270000"/></a:xfrm></p:spPr></p:pic>';

const IMAGE_REL: PptxRelationship = {
  id: 'rId1',
  type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
  target: '../media/image1.png',
};

const MEDIA = new Map<string, string>([
  ['ppt/media/image1.png', 'data:image/png;base64,AAAA'],
]);

const NOTES_XML = `<?xml version="1.0"?>
<p:notes xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:spPr/><p:txBody><a:p><a:r><a:t>Speaker notes here</a:t></a:r></a:p></p:txBody></p:sp>
    <p:sp><p:spPr><p:ph type="sldNum"/></p:spPr><p:txBody><a:p><a:r><a:t>7</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:notes>`;

function deckSlide(number: number, body: string, notesText: string | null = null): PptxSlideInput {
  return {
    number,
    xml: slideXml(body),
    relationships: body.includes('r:embed') ? [IMAGE_REL] : [],
    baseDir: 'ppt/slides',
    notesText,
  };
}

describe('phase55 pptx slide order resolution', () => {
  it('reads sldSz and the sldIdLst order from presentation.xml', () => {
    const info = parsePresentationXml(PRESENTATION_XML);
    expect(info.widthEmu).toBe(12_192_000);
    expect(info.heightEmu).toBe(6_858_000);
    // The ids are NOT in numeric order: rId4 precedes rId2.
    expect(info.slideRelIds).toEqual(['rId4', 'rId2']);
  });

  it('resolves the order through the rels, never through the file names', () => {
    const rels = parseRelationships(PRESENTATION_RELS);
    const targets = resolveSlideTargets(['rId4', 'rId2'], rels);
    // rId4 -> slide2.xml, so slide2 comes FIRST.
    expect(targets).toEqual(['ppt/slides/slide2.xml', 'ppt/slides/slide1.xml']);
  });

  it('throws a typed parse error when there is no slide size', () => {
    expect(() => parsePresentationXml('<p:presentation/>')).toThrow(PptxParseError);
  });

  it('resolves OPC targets against the part directory', () => {
    expect(resolvePackageTarget('ppt/slides', '../media/image1.png')).toBe(
      'ppt/media/image1.png',
    );
    expect(resolvePackageTarget('ppt', 'slides/slide1.xml')).toBe('ppt/slides/slide1.xml');
    expect(resolvePackageTarget('ppt/slides', '/ppt/media/x.png')).toBe('ppt/media/x.png');
    expect(relsPathFor('ppt/slides/slide2.xml')).toBe('ppt/slides/_rels/slide2.xml.rels');
  });
});

describe('phase55 pptx text mapping', () => {
  it('maps sz to points and bold/italic runs at the run level', () => {
    const paragraphs = parseTextBody('<p:txBody placeholder="x"><a:p>' +
      '<a:r><a:rPr sz="1800" b="1"/><a:t>Bold</a:t></a:r>' +
      '<a:r><a:rPr sz="2400" i="1"/><a:t>Italic</a:t></a:r></a:p></p:txBody>');
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]?.runs).toHaveLength(2);
    expect(paragraphs[0]?.runs[0]).toMatchObject({ text: 'Bold', sizePt: 18, bold: true, italic: false });
    expect(paragraphs[0]?.runs[1]).toMatchObject({ text: 'Italic', sizePt: 24, bold: false, italic: true });
  });

  it('renders both runs with their sizes and emphasis in the HTML', () => {
    const parsed = parseSlideXml(slideXml(TEXT_SP), [], MEDIA, 'ppt/slides');
    expect(parsed.elements).toHaveLength(1);
    const rendered = renderPptxDeckHtml({
      widthEmu: 12_192_000,
      heightEmu: 6_858_000,
      slides: [deckSlide(1, TEXT_SP)],
      media: MEDIA,
      includeNotes: false,
    });
    expect(rendered.html).toContain('font-size:18pt');
    expect(rendered.html).toContain('font-size:24pt');
    expect(rendered.html).toContain('<strong>');
    expect(rendered.html).toContain('Hello');
    expect(rendered.html).toContain('<em>');
    expect(rendered.html).toContain('World');
  });

  it('maps the xfrm offset and extent to points', () => {
    const rendered = renderPptxDeckHtml({
      widthEmu: 12_192_000,
      heightEmu: 6_858_000,
      slides: [deckSlide(1, TEXT_SP)],
      media: MEDIA,
      includeNotes: false,
    });
    expect(rendered.html).toContain(
      'left:100pt;top:50pt;width:200pt;height:80pt;',
    );
  });

  it('turns a br into a line break and escapes markup', () => {
    const paragraphs = parseTextBody(
      '<p:txBody><a:p><a:r><a:t>a&lt;b</a:t></a:r><a:br/><a:r><a:t>c</a:t></a:r></a:p></p:txBody>',
    );
    const runs = paragraphs[0]?.runs ?? [];
    expect(runs.map((run) => run.text)).toEqual(['a<b', '\n', 'c']);
    expect(decodeXmlText('&amp;&lt;&gt;')).toBe('&<>');
  });
});

describe('phase55 pptx shapes and images', () => {
  it('renders rect and ellipse with their fill colour', () => {
    const body = shapeSp('rect', 'FF0000') + shapeSp('ellipse', '00FF00');
    const parsed = parseSlideXml(slideXml(body), [], MEDIA, 'ppt/slides');
    expect(parsed.elements.map((el) => el.prst)).toEqual(['rect', 'ellipse']);
    expect(parsed.elements[0]?.fill).toBe('#FF0000');
    expect(parsed.elements[1]?.fill).toBe('#00FF00');

    const rendered = renderPptxDeckHtml({
      widthEmu: 12_192_000,
      heightEmu: 6_858_000,
      slides: [deckSlide(1, body)],
      media: MEDIA,
      includeNotes: false,
    });
    expect(rendered.html).toContain('class="shape rect"');
    expect(rendered.html).toContain('background:#FF0000;');
    expect(rendered.html).toContain('class="shape ellipse"');
    expect(rendered.html).toContain('border-radius:50%;');
  });

  it('degrades an unknown prst to a rectangle and warns', () => {
    const body = shapeSp('star5', '123456');
    const parsed = parseSlideXml(slideXml(body), [], MEDIA, 'ppt/slides');
    expect(parsed.unsupportedPrst).toEqual(['star5']);
    expect(parsed.elements[0]?.prst).toBe('rect');

    const rendered = renderPptxDeckHtml({
      widthEmu: 12_192_000,
      heightEmu: 6_858_000,
      slides: [deckSlide(3, body)],
      media: MEDIA,
      includeNotes: false,
    });
    const warning = rendered.warnings.find((entry) => entry.message.includes('star5'));
    expect(warning).toBeDefined();
    expect(warning?.message).toContain('slide 3');
    expect(warning?.code).toBe('generic-fallback');
  });

  it('embeds an image as a data URI at its xfrm position', () => {
    const parsed = parseSlideXml(
      slideXml(IMAGE_PIC),
      [IMAGE_REL],
      MEDIA,
      'ppt/slides',
    );
    expect(parsed.elements[0]?.kind).toBe('image');
    expect(parsed.elements[0]?.dataUri).toBe('data:image/png;base64,AAAA');

    const rendered = renderPptxDeckHtml({
      widthEmu: 12_192_000,
      heightEmu: 6_858_000,
      slides: [deckSlide(1, IMAGE_PIC)],
      media: MEDIA,
      includeNotes: false,
    });
    expect(rendered.html).toContain('src="data:image/png;base64,AAAA"');
    expect(rendered.html).toContain('left:10pt;top:20pt;width:100pt;height:100pt;');
  });

  it('throws when referenced media is missing, so the slide can be degraded', () => {
    expect(() =>
      parseSlideXml(slideXml(IMAGE_PIC), [IMAGE_REL], new Map(), 'ppt/slides'),
    ).toThrow(PptxParseError);
  });

  it('throws on a malformed slide part', () => {
    expect(() => parseSlideXml('<p:sld><p:cSld>', [], MEDIA, 'ppt/slides')).toThrow(
      PptxParseError,
    );
  });
});

describe('phase55 pptx notes and page composition', () => {
  it('extracts notes text and skips the slide-number placeholder', () => {
    expect(extractNotesText(NOTES_XML)).toBe('Speaker notes here');
    expect(extractNotesText('<p:notes/>')).toBeNull();
  });

  it('appends a notes page only when asked', () => {
    const off = renderPptxDeckHtml({
      widthEmu: 12_192_000,
      heightEmu: 6_858_000,
      slides: [deckSlide(1, TEXT_SP, 'Speaker notes here')],
      media: MEDIA,
      includeNotes: false,
    });
    expect(off.notesPages).toBe(0);
    expect(off.html).not.toContain('Speaker notes here');

    const on = renderPptxDeckHtml({
      widthEmu: 12_192_000,
      heightEmu: 6_858_000,
      slides: [deckSlide(1, TEXT_SP, 'Speaker notes here')],
      media: MEDIA,
      includeNotes: true,
    });
    expect(on.notesPages).toBe(1);
    expect(on.slidePages).toBe(1);
    expect(on.html).toContain('Speaker notes here');
  });

  it('does not add an empty notes page when the setting is on but there are no notes', () => {
    const rendered = renderPptxDeckHtml({
      widthEmu: 12_192_000,
      heightEmu: 6_858_000,
      slides: [deckSlide(1, TEXT_SP, null), deckSlide(2, shapeSp('rect', 'FF0000'))],
      media: MEDIA,
      includeNotes: true,
    });
    expect(rendered.slidePages).toBe(2);
    expect(rendered.notesPages).toBe(0);
    expect(rendered.html.match(/<section class="slide/g)).toHaveLength(2);
  });

  it('replaces a broken slide with a placeholder and keeps the other slides', () => {
    const rendered = renderPptxDeckHtml({
      widthEmu: 12_192_000,
      heightEmu: 6_858_000,
      slides: [
        deckSlide(1, TEXT_SP),
        { number: 2, xml: '<p:sld><p:cSld>', relationships: [], baseDir: 'ppt/slides', notesText: null },
        deckSlide(3, shapeSp('rect', 'FF0000')),
      ],
      media: MEDIA,
      includeNotes: false,
    });
    expect(rendered.slidePages).toBe(3);
    expect(rendered.html).toContain('Slide 2 could not be rendered');
    expect(rendered.html).toContain('Hello');
    const warning = rendered.warnings.find((entry) => entry.message.includes('Slide 2'));
    expect(warning).toBeDefined();
    expect(warning?.detail?.length).toBeGreaterThan(0);
  });
});

describe('phase55 pptx page-size rule', () => {
  it('carries the exact slide size for both aspect ratios', () => {
    expect(composeDeckPageRule(12_192_000, 6_858_000)).toBe(
      '@page { size: 960pt 540pt; margin: 0; }',
    );
    expect(composeDeckPageRule(9_144_000, 6_858_000)).toBe(
      '@page { size: 720pt 540pt; margin: 0; }',
    );
    expect(EMU_PER_PT).toBe(12_700);
    expect(emuToPt(12_192_000)).toBe(960);
  });

  it('emits the composed rule into the printed document', () => {
    const rendered = renderPptxDeckHtml({
      widthEmu: 9_144_000,
      heightEmu: 6_858_000,
      slides: [deckSlide(1, TEXT_SP)],
      media: MEDIA,
      includeNotes: false,
    });
    expect(rendered.html).toContain('@page { size: 720pt 540pt; margin: 0; }');
    expect(rendered.html).toContain('page-break-after: always');
  });
});