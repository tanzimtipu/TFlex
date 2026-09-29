import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFStream,
  decodePDFRawStream,
  type PDFObject,
} from '@cantoo/pdf-lib';
import type {
  ValidationTarget,
  ValidationViolation,
} from '../../../shared/validation';

/**
 * Phase 54 feature D — the PDF/A rule set, plus the shared document-fact
 * collection used by BOTH the PDF/A and PDF/X rule sets.
 *
 * IMPORTANT SCOPE NOTE: this is a documented, bounded rule set. It is not a
 * colour-managed preflight and it never claims certification. Where a check
 * cannot be decided from the parsed data it is reported as a `warning` with the
 * text "could not be determined", never as a silent pass.
 *
 * Relaxations encoded here and stated in the rule `detail`:
 *  - PDF/A-2b and PDF/A-3b PERMIT transparency (PDF/A-1b does not).
 *  - JavaScript is forbidden at every level.
 *  - PDF/A-3b PERMITS embedded files; PDF/A-1b and PDF/A-2b do not.
 */

/** Output-intent detection result. */
export interface OutputIntentFact {
  /** An `/OutputIntents` entry exists at all. */
  present: boolean;
  /** At least one entry carries an embedded ICC destination profile. */
  hasEmbeddedProfile: boolean;
  /** Phase 54 (DEF-383) — the key exists but its value (or an entry) is the
   *  wrong type and could not be interpreted; the rule reports "could not be
   *  determined" instead of aborting the whole validation. */
  undetermined: boolean;
}

/** Font-embedding detection result. */
export interface FontEmbeddingFact {
  /** Total font dictionaries inspected. */
  total: number;
  /** How many of those lack any `FontFile`/`FontFile2`/`FontFile3` descriptor. */
  nonEmbedded: number;
  /** 1-based pages whose font resources could not be read. */
  undeterminedPages: number[];
}

/** Transparency detection result. */
export interface TransparencyFact {
  /** 1-based pages carrying a `/Group` with `/S /Transparency`. */
  groups: number[];
  /** 1-based pages whose `/ExtGState` in use carries a real `/SMask`. */
  smasks: number[];
  /** 1-based pages whose graphics resources could not be read. */
  undeterminedPages: number[];
}

/** Everything the pure rule sets need, read once from the parsed document. */
export interface DocumentFacts {
  encrypted: boolean;
  outputIntent: OutputIntentFact;
  fontEmbedding: FontEmbeddingFact;
  transparency: TransparencyFact;
  javascript: boolean;
  /** A launch/URI/GoToR/SubmitForm/ImportData action anywhere in the doc. */
  externalActions: boolean;
  /** An embedded file / file attachment (`/F` file spec). */
  fileSpecs: boolean;
  /** 1-based pages whose content stream invokes the `rg`/`RG` operators. */
  deviceRgbPages: number[];
  /** 1-based pages whose content stream could not be decoded for the scan. */
  undeterminedDeviceRgbPages: number[];
  /** Phase 54 (DEF-381) — 1-based pages whose decoded content exceeded the
   *  documented per-page scan cap; the check reports "could not be determined". */
  oversizedDeviceRgbPages: number[];
  /** Phase 54 (DEF-381) — true when the scan stopped at its time budget. */
  deviceRgbScanTimedOut: boolean;
}

/**
 * Phase 54 (DEF-381) — documented bounds on the device-RGB content scan.
 *
 * `content.split(/\s+/)` on a fully decoded page content materialised ~100
 * million substrings for a 200 MiB stream and OOM-killed the main process, and
 * even the surviving sizes blocked it for seconds. The scan now decodes
 * incrementally, stops at this per-page byte cap, walks tokens without
 * building an array, and stops entirely at the time budget. A scan that hits
 * either bound reports "could not be determined", never a silent pass.
 */
export const VALIDATION_CONTENT_SCAN_BYTES = 32 * 1024 * 1024;
export const VALIDATION_CONTENT_SCAN_BUDGET_MS = 2000;

const ALL_SCAN_CHUNK_BYTES = 64 * 1024;

/** Phase 54 (DEF-383) — tolerant typed lookup. `context.lookupMaybe(ref, T)`
 *  THROWS `UnexpectedObjectTypeError` when the object exists but is the wrong
 *  type; a validation must instead report "could not be determined". */
type InstanceCtor<T> = { readonly prototype: T };

function lookupAs<T extends PDFObject>(
  context: PDFDocument['context'],
  ref: PDFObject | undefined,
  ctor: InstanceCtor<T>,
): T | undefined {
  if (ref === undefined) return undefined;
  const resolved = context.lookup(ref);
  if (resolved === undefined) return undefined;
  return resolved instanceof (ctor as unknown as new (...args: never[]) => T)
    ? resolved
    : undefined;
}

const EXTERNAL_ACTIONS = new Set([
  'Launch',
  'URI',
  'GoToR',
  'SubmitForm',
  'ImportData',
  'GoToE',
]);

function nameString(value: PDFObject | undefined): string | null {
  // `PDFName.asString()` keeps the leading '/'; `decodeText()` gives the bare
  // local name ('Transparency', 'URI', 'JavaScript').
  return value instanceof PDFName ? value.decodeText() : null;
}

/**
 * DEF-381 — decode a content stream to latin1 text with a hard byte cap.
 * Decoding stops at `VALIDATION_CONTENT_SCAN_BYTES`; `truncated` reports that
 * more data existed, so the caller reports "could not be determined" instead
 * of materialising an unbounded stream (a 200 MiB stream OOM-killed the app).
 */
function decodedStreamText(stream: PDFStream): { text: string; truncated: boolean } {
  const raw = PDFRawStream.of(
    stream.dict,
    stream.getContents(),
    stream instanceof PDFRawStream ? stream.transform : undefined,
  );
  const decoded = decodePDFRawStream(raw);
  const chunks: Array<Uint8Array | Uint8ClampedArray> = [];
  let total = 0;
  let truncated = false;
  for (;;) {
    if (total >= VALIDATION_CONTENT_SCAN_BYTES) {
      // The cap stopped us; only a stream with more data left is "truncated".
      truncated = decoded.peekByte() !== -1;
      break;
    }
    const want = Math.min(ALL_SCAN_CHUNK_BYTES, VALIDATION_CONTENT_SCAN_BYTES - total);
    const piece = decoded.getBytes(want);
    if (piece.length === 0) break;
    chunks.push(piece);
    total += piece.length;
  }
  const merged = new Uint8Array(total);
  let at = 0;
  for (const piece of chunks) {
    merged.set(piece, at);
    at += piece.length;
  }
  return { text: Buffer.from(merged).toString('latin1'), truncated };
}

function arrayItems(context: PDFDocument['context'], array: PDFArray | undefined): PDFObject[] {
  if (array === undefined) return [];
  const out: PDFObject[] = [];
  for (let i = 0; i < array.size(); i++) {
    out.push(context.lookup(array.get(i)) as PDFObject);
  }
  return out;
}

/** True when a dict has an embedded font file descriptor. */
function descriptorIsEmbedded(context: PDFDocument['context'], descriptor: PDFDict): boolean {
  return (
    lookupAs(context, descriptor.get(PDFName.of('FontFile')), PDFStream) !== undefined ||
    lookupAs(context, descriptor.get(PDFName.of('FontFile2')), PDFStream) !== undefined ||
    lookupAs(context, descriptor.get(PDFName.of('FontFile3')), PDFStream) !== undefined
  );
}

/** Resolve a font dictionary's descriptor, handling Type0 descendant fonts. */
function fontDescriptor(
  context: PDFDocument['context'],
  font: PDFDict,
): PDFDict | null {
  const direct = lookupAs(context, font.get(PDFName.of('FontDescriptor')), PDFDict);
  if (direct !== undefined) return direct;
  const descendants = lookupAs(context, font.get(PDFName.of('DescendantFonts')), PDFArray);
  if (descendants === undefined) return null;
  for (let i = 0; i < descendants.size(); i++) {
    const child = lookupAs(context, descendants.get(i), PDFDict);
    if (child === undefined) continue;
    const descriptor = lookupAs(context, child.get(PDFName.of('FontDescriptor')), PDFDict);
    if (descriptor !== undefined) return descriptor;
  }
  return null;
}

/** Read the catalog `/OutputIntents` for an embedded ICC destination profile. */
export function collectOutputIntent(doc: PDFDocument): OutputIntentFact {
  // `get(name, true)` keeps a literal `/OutputIntents null` distinguishable
  // from a genuinely absent key, so null is reported as "could not be
  // determined" rather than "no OutputIntent" (DEF-383).
  const raw = doc.catalog.get(PDFName.of('OutputIntents'), true);
  if (raw === undefined) {
    return { present: false, hasEmbeddedProfile: false, undetermined: false };
  }
  const array = lookupAs(doc.context, raw, PDFArray);
  if (array === undefined) {
    return { present: false, hasEmbeddedProfile: false, undetermined: true };
  }
  if (array.size() === 0) {
    return { present: false, hasEmbeddedProfile: false, undetermined: false };
  }
  let hasEmbeddedProfile = false;
  let undetermined = false;
  for (const item of arrayItems(doc.context, array)) {
    const dict = item instanceof PDFDict ? item : lookupAs(doc.context, item, PDFDict);
    if (dict === undefined) {
      undetermined = true;
      continue;
    }
    const profile = dict.get(PDFName.of('DestOutputProfile'));
    if (profile === undefined) continue;
    if (lookupAs(doc.context, profile, PDFStream) !== undefined) {
      hasEmbeddedProfile = true;
      break;
    }
    undetermined = true;
  }
  return { present: true, hasEmbeddedProfile, undetermined };
}

/** Inspect every page's font resources for embedding. */
export function collectFontEmbedding(doc: PDFDocument): FontEmbeddingFact {
  let total = 0;
  let nonEmbedded = 0;
  const undeterminedPages: number[] = [];
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const resources = pages[i].node.Resources();
    if (resources === undefined) {
      undeterminedPages.push(i + 1);
      continue;
    }
    // A `/Font` that exists but is the wrong type is "could not be determined"
    // for this page, never a thrown error (DEF-383).
    const rawFonts = resources.get(PDFName.of('Font'), true);
    if (rawFonts === undefined) continue;
    const fonts = lookupAs(doc.context, rawFonts, PDFDict);
    if (fonts === undefined) {
      undeterminedPages.push(i + 1);
      continue;
    }
    for (const [, value] of fonts.entries()) {
      const font = lookupAs(doc.context, value, PDFDict);
      if (font === undefined) {
        undeterminedPages.push(i + 1);
        continue;
      }
      total += 1;
      const descriptor = fontDescriptor(doc.context, font);
      if (descriptor === null || !descriptorIsEmbedded(doc.context, descriptor)) {
        nonEmbedded += 1;
      }
    }
  }
  return { total, nonEmbedded, undeterminedPages: [...new Set(undeterminedPages)] };
}

/** Detect page transparency (page groups and in-use soft masks). */
export function collectTransparency(doc: PDFDocument): TransparencyFact {
  const groups: number[] = [];
  const smasks: number[] = [];
  const undeterminedPages: number[] = [];
  const pages = doc.getPages();
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    const group = lookupAs(doc.context, page.node.get(PDFName.of('Group')), PDFDict);
    if (group !== undefined && nameString(group.get(PDFName.of('S'))) === 'Transparency') {
      groups.push(i + 1);
    }
    const resources = page.node.Resources();
    if (resources === undefined) {
      undeterminedPages.push(i + 1);
      continue;
    }
    const rawGStates = resources.get(PDFName.of('ExtGState'), true);
    if (rawGStates === undefined) continue;
    const gstates = lookupAs(doc.context, rawGStates, PDFDict);
    if (gstates === undefined) {
      undeterminedPages.push(i + 1);
      continue;
    }
    for (const [, value] of gstates.entries()) {
      const gs = lookupAs(doc.context, value, PDFDict);
      if (gs === undefined) {
        undeterminedPages.push(i + 1);
        continue;
      }
      const smask = lookupAs(doc.context, gs.get(PDFName.of('SMask')), PDFDict);
      if (smask !== undefined) smasks.push(i + 1);
    }
  }
  return { groups, smasks, undeterminedPages: [...new Set(undeterminedPages)] };
}

/** Catalog JavaScript: `/Names /JavaScript` or a JavaScript `/OpenAction`. */
export function collectJavaScript(doc: PDFDocument): boolean {
  const names = lookupAs(doc.context, doc.catalog.get(PDFName.of('Names')), PDFDict);
  if (names !== undefined && names.has(PDFName.of('JavaScript'))) return true;
  const open = lookupAs(doc.context, doc.catalog.get(PDFName.of('OpenAction')), PDFDict);
  return open !== undefined && nameString(open.get(PDFName.of('S'))) === 'JavaScript';
}

interface ExternalFacts {
  externalActions: boolean;
  fileSpecs: boolean;
}

function actionIsExternal(context: PDFDocument['context'], action: PDFObject | undefined): boolean {
  const dict = lookupAs(context, action, PDFDict);
  if (dict === undefined) return false;
  const s = nameString(dict.get(PDFName.of('S')));
  return s !== null && EXTERNAL_ACTIONS.has(s);
}

/** External content: embedded files/file specs and launch/URI-style actions. */
export function collectExternalContent(doc: PDFDocument): ExternalFacts {
  let externalActions = false;
  let fileSpecs = false;

  const names = lookupAs(doc.context, doc.catalog.get(PDFName.of('Names')), PDFDict);
  if (names !== undefined && names.has(PDFName.of('EmbeddedFiles'))) fileSpecs = true;

  if (actionIsExternal(doc.context, doc.catalog.get(PDFName.of('OpenAction')))) {
    externalActions = true;
  }
  const open = lookupAs(doc.context, doc.catalog.get(PDFName.of('OpenAction')), PDFDict);
  if (open !== undefined && open.has(PDFName.of('FS'))) fileSpecs = true;

  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (annots === undefined) continue;
    for (const item of arrayItems(doc.context, annots)) {
      const annot = item instanceof PDFDict ? item : lookupAs(doc.context, item, PDFDict);
      if (annot === undefined) continue;
      if (nameString(annot.get(PDFName.of('Subtype'))) === 'FileAttachment') fileSpecs = true;
      if (annot.has(PDFName.of('FS'))) fileSpecs = true;
      if (actionIsExternal(doc.context, annot.get(PDFName.of('A')))) externalActions = true;
    }
  }
  return { externalActions, fileSpecs };
}

/** Decode a page's content streams to text for the device-space operator scan.
 *  Returns null when a stream could not be decoded at all, and `truncated`
 *  when the documented byte cap stopped the decode (DEF-381). */
function pageContentText(
  doc: PDFDocument,
  pageIndex: number,
): { text: string; truncated: boolean } | null {
  try {
    const contents = doc.getPage(pageIndex).node.normalizedEntries().Contents;
    if (contents === undefined) return { text: '', truncated: false };
    const elements: PDFObject[] =
      contents instanceof PDFArray
        ? Array.from({ length: contents.size() }, (_, i) => contents.get(i))
        : [contents];
    let text = '';
    let truncated = false;
    for (const element of elements) {
      const stream = lookupAs(doc.context, element, PDFStream);
      if (stream === undefined) continue;
      const part = decodedStreamText(stream);
      text += part.text + '\n';
      if (part.truncated) {
        truncated = true;
        break;
      }
    }
    return { text, truncated };
  } catch {
    return null;
  }
}

/** True when a content stream invokes the `rg`/`RG` device-RGB operators.
 *  DEF-381 — a manual token walk: `split(/\s+/)` materialised an array of every
 *  token, which is the allocation that OOM-killed the process. */
export function contentUsesDeviceRgb(content: string): boolean {
  const length = content.length;
  let i = 0;
  while (i < length) {
    while (i < length && isPdfWhitespace(content.charCodeAt(i))) i += 1;
    const start = i;
    while (i < length && !isPdfWhitespace(content.charCodeAt(i))) i += 1;
    if (i - start === 2 && content.charCodeAt(start) === 0x72 /* r */) {
      const second = content.charCodeAt(start + 1);
      if (second === 0x67 /* g */ || second === 0x47 /* G */) return true;
    }
  }
  return false;
}

function isPdfWhitespace(code: number): boolean {
  return code === 0x00 || code === 0x09 || code === 0x0a || code === 0x0c || code === 0x0d || code === 0x20;
}

/** Scan every page's content stream for device-RGB operators, bounded by the
 *  documented per-page byte cap and overall time budget (DEF-381). */
export function collectDeviceRgbPages(doc: PDFDocument): {
  pages: number[];
  undetermined: number[];
  oversized: number[];
  timedOut: boolean;
} {
  const pages: number[] = [];
  const undetermined: number[] = [];
  const oversized: number[] = [];
  let timedOut = false;
  const count = doc.getPageCount();
  const started = Date.now();
  for (let i = 0; i < count; i++) {
    if (Date.now() - started > VALIDATION_CONTENT_SCAN_BUDGET_MS) {
      timedOut = true;
      for (let j = i; j < count; j += 1) undetermined.push(j + 1);
      break;
    }
    const scanned = pageContentText(doc, i);
    if (scanned === null) {
      undetermined.push(i + 1);
      continue;
    }
    if (scanned.truncated) {
      oversized.push(i + 1);
      continue;
    }
    if (contentUsesDeviceRgb(scanned.text)) pages.push(i + 1);
  }
  return { pages, undetermined, oversized, timedOut };
}

/** Read every fact the rule sets need from a parsed document. */
export function collectDocumentFacts(doc: PDFDocument): DocumentFacts {
  const external = collectExternalContent(doc);
  const rgb = collectDeviceRgbPages(doc);
  return {
    encrypted: doc.isEncrypted,
    outputIntent: collectOutputIntent(doc),
    fontEmbedding: collectFontEmbedding(doc),
    transparency: collectTransparency(doc),
    javascript: collectJavaScript(doc),
    externalActions: external.externalActions,
    fileSpecs: external.fileSpecs,
    deviceRgbPages: rgb.pages,
    undeterminedDeviceRgbPages: rgb.undetermined,
    oversizedDeviceRgbPages: rgb.oversized,
    deviceRgbScanTimedOut: rgb.timedOut,
  };
}

function pagesLabel(pages: number[]): string {
  return pages.length === 0 ? '' : ` (pages ${pages.join(', ')})`;
}

/** Evaluate the PDF/A rule set for `target` over collected facts. */
export function evaluatePdfA(
  target: ValidationTarget,
  facts: DocumentFacts,
): ValidationViolation[] {
  const out: ValidationViolation[] = [];

  if (facts.outputIntent.undetermined) {
    out.push({
      rule: 'pdfa.output-intent',
      detail:
        'The /OutputIntents entry could not be determined: it is not an array of output-intent dictionaries (it is missing, null or the wrong type).',
      severity: 'warning',
    });
  } else if (!facts.outputIntent.present) {
    out.push({
      rule: 'pdfa.output-intent',
      detail:
        'No /OutputIntents entry: a PDF/A target requires an OutputIntent with an embedded ICC destination profile.',
      severity: 'error',
    });
  } else if (!facts.outputIntent.hasEmbeddedProfile) {
    out.push({
      rule: 'pdfa.output-intent',
      detail:
        'An /OutputIntents entry exists but carries no embedded ICC destination profile (/DestOutputProfile).',
      severity: 'error',
    });
  }

  if (facts.fontEmbedding.nonEmbedded > 0) {
    out.push({
      rule: 'pdfa.font-embedding',
      detail: `${facts.fontEmbedding.nonEmbedded} of ${facts.fontEmbedding.total} font(s) have no embedded FontFile/FontFile2/FontFile3 descriptor.`,
      severity: 'error',
    });
  }
  if (facts.fontEmbedding.undeterminedPages.length > 0) {
    out.push({
      rule: 'pdfa.font-embedding',
      detail: `Font embedding could not be determined for page(s) ${facts.fontEmbedding.undeterminedPages.join(', ')} (no readable resources).`,
      severity: 'warning',
    });
  }

  if (facts.encrypted) {
    out.push({
      rule: 'pdfa.encryption',
      detail: 'The document is encrypted (/Encrypt in the trailer); encryption is forbidden at every PDF/A level.',
      severity: 'error',
    });
  }

  if (target === 'pdfa-1b') {
    const pages = [...new Set([...facts.transparency.groups, ...facts.transparency.smasks])].sort(
      (a, b) => a - b,
    );
    if (pages.length > 0) {
      out.push({
        rule: 'pdfa.transparency',
        detail: `Transparency is forbidden for PDF/A-1b${pagesLabel(pages)}; PDF/A-2b and PDF/A-3b permit it.`,
        severity: 'error',
      });
    }
    if (facts.transparency.undeterminedPages.length > 0) {
      out.push({
        rule: 'pdfa.transparency',
        detail: `Transparency could not be determined for page(s) ${facts.transparency.undeterminedPages.join(', ')} (no readable resources).`,
        severity: 'warning',
      });
    }
  }

  if (facts.javascript) {
    out.push({
      rule: 'pdfa.javascript',
      detail: 'The document carries JavaScript (/Names /JavaScript or a JavaScript /OpenAction); JavaScript is forbidden at every PDF/A level.',
      severity: 'error',
    });
  }

  if (facts.externalActions) {
    out.push({
      rule: 'pdfa.external-content',
      detail: 'The document has an external action (launch/URI/GoToR/SubmitForm/ImportData), which PDF/A forbids.',
      severity: 'error',
    });
  }
  if (facts.fileSpecs && target !== 'pdfa-3b') {
    out.push({
      rule: 'pdfa.external-content',
      detail: 'The document embeds a file spec/attachment; PDF/A-1b and PDF/A-2b forbid external content, while PDF/A-3b permits embedded files.',
      severity: 'error',
    });
  }

  return out;
}
