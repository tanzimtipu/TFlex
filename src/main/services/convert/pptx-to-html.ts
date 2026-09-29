import type { ConvertWarning } from '../../../shared/convert';
import { OFFICE_PRINT_CSS } from './adapters/docx';

/**
 * Phase 55 feature C — the pure PPTX XML -> absolutely-positioned HTML mapper.
 *
 * No ZIP, no I/O and no Electron live here: the `.pptx` adapter reads the OPC
 * parts out of the package and hands this module their XML plus a `data:` media
 * map. Keeping the mapping pure makes slide order, run sizes, geometry, shapes,
 * notes inclusion and every degradation rule unit-testable directly.
 *
 * Rendering choice: ABSOLUTELY-POSITIONED HTML through the existing offscreen
 * print engine, with a composed `@page { size: Wpt Hpt; margin: 0 }` and
 * `preferCSSPageSize: true` (the same technique the SVG fallback uses). Each
 * slide becomes one `.slide` box of exactly the slide size, so the produced
 * page's media box equals the presentation's own aspect ratio. This reuses the
 * chunk-A office print shell (`OFFICE_PRINT_CSS`) and Chromium's text layout
 * rather than a second pdf-lib drawing path.
 */

/** 914400 EMU = 1 inch = 72 pt, so 12700 EMU = 1 pt. */
export const EMU_PER_PT = 12700;

/** EMU -> PDF points. */
export function emuToPt(emu: number): number {
  return emu / EMU_PER_PT;
}

/** A structural problem in a PPTX XML part. */
export class PptxParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PptxParseError';
  }
}

/** One OPC relationship as it matters here. */
export interface PptxRelationship {
  id: string;
  type: string;
  target: string;
}

const RELATIONSHIP_RE =
  /<Relationship\b[^>]*\bId="([^"]*)"[^>]*\bType="([^"]*)"[^>]*\bTarget="([^"]*)"[^>]*\/?>/g;

/** Parse a `.rels` part into `{ id, type, target }`, in document order. */
export function parseRelationships(xml: string): PptxRelationship[] {
  const out: PptxRelationship[] = [];
  for (const match of xml.matchAll(RELATIONSHIP_RE)) {
    out.push({ id: match[1] ?? '', type: match[2] ?? '', target: match[3] ?? '' });
  }
  return out;
}

/** What `presentation.xml` fixes: the slide size and the slide order. */
export interface PptxPresentationInfo {
  widthEmu: number;
  heightEmu: number;
  /** `r:id` values of `<p:sldId>` in `<p:sldIdLst>`, IN DOCUMENT ORDER. */
  slideRelIds: string[];
}

const SLD_SZ_RE = /<p:sldSz\b[^>]*\bcx="(\d+)"[^>]*\bcy="(\d+)"/;
const SLD_ID_RE = /<p:sldId\b[^>]*\br:id="([^"]*)"/g;

/**
 * Read the slide size and the slide ORDER. The order comes from
 * `<p:sldIdLst>` alone; the `slideN.xml` file names are never treated as the
 * deck order (their numbering is not required to match).
 */
export function parsePresentationXml(xml: string): PptxPresentationInfo {
  const size = SLD_SZ_RE.exec(xml);
  if (size === null) {
    throw new PptxParseError('presentation.xml has no slide size (<p:sldSz>).');
  }
  const widthEmu = Number(size[1]);
  const heightEmu = Number(size[2]);
  if (!Number.isFinite(widthEmu) || !Number.isFinite(heightEmu) || widthEmu <= 0 || heightEmu <= 0) {
    throw new PptxParseError('presentation.xml declares a non-positive slide size.');
  }
  const slideRelIds: string[] = [];
  for (const match of xml.matchAll(SLD_ID_RE)) slideRelIds.push(match[1] ?? '');
  return { widthEmu, heightEmu, slideRelIds };
}

/**
 * Resolve an OPC target against the directory of the part that named it.
 * `baseDir` is a package path without a trailing slash (e.g. `ppt/slides`);
 * a target of `../media/image1.png` and a base of `ppt/slides` yield
 * `ppt/media/image1.png`. Absolute targets (leading `/`) are package-rooted.
 */
export function resolvePackageTarget(baseDir: string, target: string): string {
  const cleaned = target.replace(/\\/g, '/');
  if (cleaned.startsWith('/')) return cleaned.replace(/^\/+/, '');
  const segments = (baseDir.length === 0 ? [] : baseDir.split('/')).concat(
    cleaned.split('/'),
  );
  const stack: string[] = [];
  for (const segment of segments) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') {
      stack.pop();
      continue;
    }
    stack.push(segment);
  }
  return stack.join('/');
}

/** Package paths for the slides, IN `sldIdLst` ORDER, resolved through the
 *  presentation relationships (`rId` -> `slides/slideN.xml`). */
export function resolveSlideTargets(
  slideRelIds: string[],
  relationships: PptxRelationship[],
): string[] {
  const byId = new Map(relationships.map((rel) => [rel.id, rel]));
  const out: string[] = [];
  for (const relId of slideRelIds) {
    const rel = byId.get(relId);
    if (rel === undefined) continue;
    out.push(resolvePackageTarget('ppt', rel.target));
  }
  return out;
}

/** The `.rels` part path for an OPC part (`ppt/slides/slide1.xml` ->
 *  `ppt/slides/_rels/slide1.xml.rels`). */
export function relsPathFor(part: string): string {
  const slash = part.lastIndexOf('/');
  const dir = slash === -1 ? '' : part.slice(0, slash);
  const file = slash === -1 ? part : part.slice(slash + 1);
return dir.length === 0 ? `_rels/${file}.rels` : `${dir}/_rels/${file}.rels`;
}

const DEFAULT_RUN_PT = 18;

/** One text run: the character size is already in points. */
export interface PptxRun {
  text: string;
  sizePt: number;
  bold: boolean;
  italic: boolean;
}

export interface PptxParagraph {
  runs: PptxRun[];
}

/** A shape/placeholder transform, still in EMU. */
export interface PptxXfrm {
  xEmu: number;
  yEmu: number;
  cxEmu: number;
  cyEmu: number;
}

/** One mapped element of a slide. */
export interface PptxElement {
  kind: 'text' | 'shape' | 'image';
  xfrm: PptxXfrm | null;
  /** The `prst` geometry when one was read (unknown ones are already folded to
   *  `rect`; the original name travels in `unsupportedPrst`). */
  prst: string | null;
  /** `#RRGGBB` fill, or null. */
  fill: string | null;
  paragraphs: PptxParagraph[];
  /** `data:` URI for an image element, else null. */
  dataUri: string | null;
}

export interface PptxSlideParse {
  elements: PptxElement[];
  /** `prst` values outside the supported set, in encounter order. */
  unsupportedPrst: string[];
}

/** The preset geometries this mapper renders as themselves. Anything else is
 *  drawn as a rectangle and named in a warning. */
export const SUPPORTED_PRST = ['rect', 'ellipse', 'roundRect', 'triangle', 'line'] as const;

function attrNumber(attrs: string, name: string): number | null {
  const match = new RegExp(`\\b${name}="(-?\\d+)"`).exec(attrs);
  return match === null ? null : Number(match[1]);
}

function parseXfrm(block: string): PptxXfrm | null {
  const xfrm = /<a:xfrm\b[^>]*>([\s\S]*?)<\/a:xfrm>/.exec(block)?.[1];
  if (xfrm === undefined) return null;
  const off = /<a:off\b([^>]*)\/?>/.exec(xfrm)?.[1];
  const ext = /<a:ext\b([^>]*)\/?>/.exec(xfrm)?.[1];
  if (off === undefined || ext === undefined) return null;
  const x = attrNumber(off, 'x');
  const y = attrNumber(off, 'y');
  const cx = attrNumber(ext, 'cx');
  const cy = attrNumber(ext, 'cy');
  if (x === null || y === null || cx === null || cy === null) return null;
  return { xEmu: x, yEmu: y, cxEmu: cx, cyEmu: cy };
}

function parseFill(block: string): string | null {
  const hex = /<a:solidFill>\s*<a:srgbClr\b[^>]*\bval="([0-9A-Fa-f]{6})"/.exec(block)?.[1];
  return hex === undefined ? null : `#${hex.toUpperCase()}`;
}

function parsePrst(block: string): string | null {
  return /<a:prstGeom\b[^>]*\bprst="([^"]*)"/.exec(block)?.[1] ?? null;
}

/** Decode the small XML entity set the text atoms use. */
export function decodeXmlText(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

/** Parse one `<p:txBody>` into paragraphs and runs. `<a:br/>` becomes a
 *  newline run; `sz` is hundredths of a point. */
export function parseTextBody(txBody: string | null): PptxParagraph[] {
  if (txBody === null) return [];
  const paragraphs: PptxParagraph[] = [];
  for (const paragraph of txBody.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)) {
    const content = paragraph[1] ?? '';
    const runs: PptxRun[] = [];
    for (const token of content.matchAll(/<a:r>([\s\S]*?)<\/a:r>|<a:br\s*\/>/g)) {
      if (token[0].startsWith('<a:br')) {
        runs.push({ text: '\n', sizePt: DEFAULT_RUN_PT, bold: false, italic: false });
        continue;
      }
      const run = token[1] ?? '';
      const rPr = /<a:rPr\b([^>]*)\/?>/.exec(run)?.[1] ?? '';
      const text = /<a:t[^>]*>([\s\S]*?)<\/a:t>/.exec(run)?.[1];
      if (text === undefined) continue;
      const size = /\bsz="(\d+)"/.exec(rPr);
      runs.push({
        text: decodeXmlText(text),
        sizePt: size === null ? DEFAULT_RUN_PT : Number(size[1]) / 100,
        bold: /\bb="1"/.test(rPr),
        italic: /\bi="1"/.test(rPr),
      });
    }
    if (runs.length > 0) paragraphs.push({ runs });
  }
  return paragraphs;
}

/**
 * Map one slide part: `<p:sp>` text/shape elements and `<p:pic>` images, each
 * with its `a:xfrm` offset/extent. A malformed part throws `PptxParseError`; a
 * picture whose `r:embed` target is absent from `media` also throws, so the
 * caller degrades the whole slide to a placeholder (requirement 6).
 */
export function parseSlideXml(
  xml: string,
  relationships: PptxRelationship[],
  media: Map<string, string>,
  baseDir: string,
): PptxSlideParse {
  if (!/<p:sld\b/.test(xml) || !/<\/p:sld>/.test(xml)) {
    throw new PptxParseError('slide XML is not a well-formed <p:sld> part.');
  }
  const byId = new Map(relationships.map((rel) => [rel.id, rel]));
  const elements: PptxElement[] = [];
  const unsupportedPrst: string[] = [];

  for (const match of xml.matchAll(/<p:(sp|pic)\b[^>]*>([\s\S]*?)<\/p:\1>/g)) {
    const tag = match[1];
    const body = match[2] ?? '';
    const xfrm = parseXfrm(body);

    if (tag === 'pic') {
      const embedId = /<a:blip\b[^>]*\br:embed="([^"]*)"/.exec(body)?.[1];
      if (embedId === undefined) continue;
      const rel = byId.get(embedId);
      if (rel === undefined) {
        throw new PptxParseError(`slide references missing relationship ${embedId}.`);
      }
      const packagePath = resolvePackageTarget(baseDir, rel.target);
      const dataUri = media.get(packagePath);
      if (dataUri === undefined) {
        throw new PptxParseError(`slide references missing media ${packagePath}.`);
      }
      elements.push({ kind: 'image', xfrm, prst: null, fill: null, paragraphs: [], dataUri });
      continue;
    }

    const txBody = /<p:txBody>([\s\S]*?)<\/p:txBody>/.exec(body)?.[1] ?? null;
    const paragraphs = parseTextBody(txBody);
    const fill = parseFill(body);
    const hasText = paragraphs.some((paragraph) =>
      paragraph.runs.some((run) => run.text.trim().length > 0),
    );

    if (hasText) {
      elements.push({ kind: 'text', xfrm, prst: null, fill, paragraphs, dataUri: null });
      continue;
    }
    const prst = parsePrst(body);
    if (prst === null) continue;
    if (!(SUPPORTED_PRST as readonly string[]).includes(prst)) {
      unsupportedPrst.push(prst);
      elements.push({ kind: 'shape', xfrm, prst: 'rect', fill, paragraphs: [], dataUri: null });
      continue;
    }
    elements.push({ kind: 'shape', xfrm, prst, fill, paragraphs: [], dataUri: null });
  }

  return { elements, unsupportedPrst };
}

function formatPt(value: number): string {
  return Number(value.toFixed(4)).toString();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Collect the speaker-notes text from a notes slide: the `<a:t>` runs of every
 * text placeholder except the slide-number/date/footer fields. Returns null
 * when the notes part carries no usable text (so it never produces an empty
 * page).
 */
export function extractNotesText(xml: string): string | null {
  const lines: string[] = [];
  for (const sp of xml.matchAll(/<p:sp\b[^>]*>([\s\S]*?)<\/p:sp>/g)) {
    const body = sp[1] ?? '';
    const placeholder = /<p:ph\b[^>]*\btype="([^"]*)"/.exec(body)?.[1];
    if (placeholder === 'sldNum' || placeholder === 'dt' || placeholder === 'ftr') continue;
    const txBody = /<p:txBody>([\s\S]*?)<\/p:txBody>/.exec(body)?.[1] ?? null;
    for (const paragraph of parseTextBody(txBody)) {
      const line = paragraph.runs.map((run) => run.text).join('');
      if (line.trim().length > 0) lines.push(line);
    }
  }
  const text = lines.join('\n').trim();
  return text.length === 0 ? null : text;
}

/** One slide as the adapter reads it from the package. */
export interface PptxSlideInput {
  /** 1-based slide number, used in warnings. */
  number: number;
  /** Raw `slideN.xml`, or null when the part is absent. */
  xml: string | null;
  relationships: PptxRelationship[];
  /** Package directory of the slide part, e.g. `ppt/slides`. */
  baseDir: string;
  notesText: string | null;
}

export interface PptxDeckInput {
  widthEmu: number;
  heightEmu: number;
  slides: PptxSlideInput[];
  /** Package path (`ppt/media/image1.png`) -> `data:` URI. */
  media: Map<string, string>;
  includeNotes: boolean;
}

export interface PptxDeckRender {
  html: string;
  warnings: ConvertWarning[];
  /** Pages produced by slides (one per slide, placeholders included). */
  slidePages: number;
  /** Notes pages appended (0 when the setting is off or no slide has notes). */
  notesPages: number;
}

/** The composed `@page` rule carrying the presentation's own size. */
export function composeDeckPageRule(widthEmu: number, heightEmu: number): string {
  return `@page { size: ${formatPt(emuToPt(widthEmu))}pt ${formatPt(emuToPt(heightEmu))}pt; margin: 0; }`;
}

/** The deck stylesheet (without `OFFICE_PRINT_CSS`): page size plus the fixed
 *  one-page-per-`.slide` box and absolutely-positioned element rules. */
export function composeDeckCss(widthEmu: number, heightEmu: number): string {
  const widthPt = formatPt(emuToPt(widthEmu));
  const heightPt = formatPt(emuToPt(heightEmu));
  return `
${composeDeckPageRule(widthEmu, heightEmu)}
html, body { margin: 0; padding: 0; }
.slide { position: relative; width: ${widthPt}pt; height: ${heightPt}pt; box-sizing: border-box; overflow: hidden; page-break-after: always; break-after: page; background: #fff; }
.slide:last-child { page-break-after: auto; break-after: auto; }
.shape { position: absolute; box-sizing: border-box; overflow: hidden; }
.text { display: block; }
.text p { margin: 0; white-space: pre-wrap; }
.image { display: block; }
.placeholder { display: flex; align-items: center; justify-content: center; }
.slide-placeholder { font-family: Arial, Helvetica, sans-serif; font-size: 16pt; color: #666; }
.notes { padding: 24pt; }
.notes h2 { margin: 0 0 8pt; font-size: 16pt; }
.notes pre { margin: 0; white-space: pre-wrap; font-family: Arial, Helvetica, sans-serif; font-size: 12pt; color: #111; }
`.trim();
}

function geometryStyle(xfrm: PptxXfrm | null): string {
  if (xfrm === null) return '';
  return (
    `left:${formatPt(emuToPt(xfrm.xEmu))}pt;` +
    `top:${formatPt(emuToPt(xfrm.yEmu))}pt;` +
    `width:${formatPt(emuToPt(xfrm.cxEmu))}pt;` +
    `height:${formatPt(emuToPt(xfrm.cyEmu))}pt;`
  );
}

function renderParagraph(paragraph: PptxParagraph): string {
  const runs = paragraph.runs
    .map((run) => {
      const text = escapeHtml(run.text).replace(/\n/g, '<br>');
      let inner = `<span style="font-size:${formatPt(run.sizePt)}pt">${text}</span>`;
      if (run.italic) inner = `<em>${inner}</em>`;
      if (run.bold) inner = `<strong>${inner}</strong>`;
      return inner;
    })
    .join('');
  return `<p>${runs}</p>`;
}

function renderElement(element: PptxElement): string {
  const geometry = geometryStyle(element.xfrm);
  if (element.kind === 'image') {
    return `<img class="shape image" src="${element.dataUri ?? ''}" alt="" style="${geometry}object-fit:fill;">`;
  }
  if (element.kind === 'text') {
    const fill = element.fill === null ? '' : `background:${element.fill};`;
    const body = element.paragraphs.map(renderParagraph).join('');
    return `<div class="shape text" style="${geometry}${fill}">${body}</div>`;
  }
  const fill = element.fill === null ? '' : `background:${element.fill};`;
  let extra = '';
  if (element.prst === 'ellipse') extra = 'border-radius:50%;';
  else if (element.prst === 'roundRect') extra = 'border-radius:8pt;';
  else if (element.prst === 'triangle') {
    extra = 'clip-path:polygon(50% 0,100% 100%,0 100%);';
  }
  return `<div class="shape ${element.prst ?? 'rect'}" style="${geometry}${fill}${extra}"></div>`;
}

function placeholderSection(slideNumber: number): string {
  return (
    `<section class="slide placeholder">` +
    `<div class="slide-placeholder">Slide ${slideNumber} could not be rendered.</div>` +
    `</section>`
  );
}

/**
 * Render the whole deck: one `.slide` page per slide IN `input.slides` order
 * (already `sldIdLst`-resolved by the adapter), a notes page after a slide only
 * when the setting is on and the slide actually has notes text, and a
 * placeholder page plus a `generic-fallback` warning for any slide that could
 * not be parsed or whose media is missing.
 */
export function renderPptxDeckHtml(input: PptxDeckInput): PptxDeckRender {
  const sections: string[] = [];
  const warnings: ConvertWarning[] = [];
  let slidePages = 0;
  let notesPages = 0;

  for (const slide of input.slides) {
    let parsed: PptxSlideParse;
    try {
      if (slide.xml === null) {
        throw new PptxParseError('the slide part is missing from the package.');
      }
      parsed = parseSlideXml(slide.xml, slide.relationships, input.media, slide.baseDir);
    } catch (thrown) {
      const reason = thrown instanceof Error ? thrown.message : String(thrown);
      warnings.push({
        code: 'generic-fallback',
        message: `Slide ${slide.number} could not be rendered and was replaced with a placeholder.`,
        detail: reason,
      });
      sections.push(placeholderSection(slide.number));
      slidePages += 1;
      continue;
    }

    for (const prst of parsed.unsupportedPrst) {
      warnings.push({
        code: 'generic-fallback',
        message: `Unsupported shape "${prst}" on slide ${slide.number} was drawn as a rectangle.`,
        detail: 'The preset geometry has no mapping and falls back to a rectangle.',
      });
    }

    const body = parsed.elements.map(renderElement).join('');
    sections.push(`<section class="slide">${body}</section>`);
    slidePages += 1;

    if (input.includeNotes && slide.notesText !== null && slide.notesText.length > 0) {
      sections.push(
        `<section class="slide notes"><h2>Notes</h2><pre>${escapeHtml(slide.notesText)}</pre></section>`,
      );
      notesPages += 1;
    }
  }

  const html =
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<style>${OFFICE_PRINT_CSS}\n${composeDeckCss(input.widthEmu, input.heightEmu)}</style>` +
    `</head><body>${sections.join('')}</body></html>`;
  return { html, warnings, slidePages, notesPages };
}
