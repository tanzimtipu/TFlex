import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFParser,
  PDFRef,
  type PDFField,
} from '@cantoo/pdf-lib';
import {
  findFieldPage,
  findOrphanWidgets,
  formFieldKind,
  getFormFields,
  nameToken,
  numberFrom,
  widgetOnValue,
} from '../../../src/main/services/forms';
import { readProtectionState } from '../../../src/main/services/encryption';

// ---------------------------------------------------------------------------
// Phase 74 chunk 1 — characterise the operator's REAL encrypted 956.pdf form.
//
// This is a diagnostic spec, not a fix. It loads the local byte copy (if it
// exists) through the actual engine and through a raw @cantoo/pdf-lib walk and
// prints ONE JSON facts block that the findings comment quotes verbatim.
//
// The copy is a local, gitignored artifact. When it is absent (CI) the whole
// suite skips cleanly so the pipeline stays green.
// ---------------------------------------------------------------------------

const COPY = join(process.cwd(), 'test-fixtures', 'tfl225', '956-real.pdf');
const ORIGINAL = 'C:\\Users\\tanzi\\OneDrive\\Desktop\\Parent visa\\956.pdf';

const COPY_PRESENT = existsSync(COPY);

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function bytesOf(path: string): Uint8Array {
  const buf = readFileSync(path);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface LoadOutcome {
  ok: boolean;
  error?: string;
  doc?: PDFDocument;
}

async function tryLoad(bytes: Uint8Array, options?: unknown): Promise<LoadOutcome> {
  try {
    const doc = options === undefined
      ? await PDFDocument.load(bytes)
      : await PDFDocument.load(bytes, options as never);
    return { ok: true, doc };
  } catch (error) {
    return { ok: false, error: messageOf(error) };
  }
}

/** Resolve a raw `/P` ref to a 0-based page index by comparing ref tags (the
 *  engine's `pageIndexByRef` is module-private; the brief says resolve here). */
function pageOfRef(doc: PDFDocument, ref: unknown): number {
  if (!ref || typeof (ref as { tag?: unknown }).tag !== 'string') return -1;
  const tag = (ref as { tag: string }).tag;
  for (let p = 0; p < doc.getPageCount(); p++) {
    if (doc.getPage(p).ref?.tag === tag) return p;
  }
  return -1;
}

/** Read `/V`, `/R`, `/CFM`, `/P`, `/Length` and `/Filter` from the raw trailer
 *  `/Encrypt` dict without ever decrypting (mirrors encryption.ts). */
async function readEncryptDict(bytes: Uint8Array): Promise<Record<string, unknown>> {
  try {
    const context = await PDFParser.forBytesWithOptions(bytes).parseDocument() as never as {
      trailerInfo: { Encrypt?: unknown };
      lookup: (ref: unknown, type: unknown) => PDFDict;
    };
    const encryptRef = context.trailerInfo?.Encrypt;
    if (encryptRef === undefined) return { present: false };
    const dict = context.lookup(encryptRef, PDFDict);
    const num = (name: string): number | undefined => {
      try {
        const value = dict.lookupMaybe(PDFName.of(name), PDFNumber);
        return value === undefined ? undefined : value.asNumber();
      } catch {
        return undefined;
      }
    };
    let cfm = '';
    try {
      const cf = dict.lookupMaybe(PDFName.of('CF'), PDFDict);
      const streamFilter = dict.lookupMaybe(PDFName.of('StmF'), PDFName);
      if (cf !== undefined && streamFilter !== undefined) {
        const handler = cf.lookupMaybe(streamFilter, PDFDict);
        const cfmName = handler?.lookupMaybe(PDFName.of('CFM'), PDFName);
        if (cfmName !== undefined) cfm = nameToken(cfmName);
      }
    } catch {
      // No crypt-filter dict (a /V 1-2 document) — leave cfm empty.
    }
    return {
      present: true,
      V: num('V'),
      R: num('R'),
      P: num('P'),
      Length: num('Length'),
      CFM: cfm,
      Filter: nameToken(dict.lookupMaybe(PDFName.of('Filter'), PDFName)),
    };
  } catch (error) {
    return { present: false, error: messageOf(error) };
  }
}

/** A raw widget annotation found in a page `/Annots` array. */
interface RawWidget {
  page: number;
  index: number;
  refTag: string;
  dict: PDFDict;
  name: string;
  fieldType: string;
  pPresent: boolean;
  pResolvesTo: number;
  parentPresent: boolean;
  rect: number[];
}

function rawWidgets(doc: PDFDocument): RawWidget[] {
  const out: RawWidget[] = [];
  for (let p = 0; p < doc.getPageCount(); p++) {
    try {
      const annots = doc.context.lookupMaybe(
        doc.getPage(p).node.get(PDFName.of('Annots')) as never,
        PDFArray,
      );
      if (annots === undefined) continue;
      for (let i = 0; i < annots.size(); i++) {
        const ref = annots.get(i);
        let dict: PDFDict | undefined;
        try {
          dict = doc.context.lookupMaybe(ref as never, PDFDict) ?? undefined;
        } catch {
          dict = undefined;
        }
        if (dict === undefined) continue;
        if (nameToken(dict.get(PDFName.of('Subtype'))) !== 'Widget') continue;
        const pRef = dict.get(PDFName.of('P'));
        const rectRaw = doc.context.lookupMaybe(dict.get(PDFName.of('Rect')) as never, PDFArray);
        const rect: number[] = [];
        if (rectRaw !== undefined) {
          for (let r = 0; r < Math.min(4, rectRaw.size()); r++) rect.push(numberFrom(rectRaw.get(r)));
        }
        out.push({
          page: p,
          index: i,
          refTag: ref instanceof PDFRef ? ref.tag : '',
          dict,
          name: nameToken(dict.get(PDFName.of('T'))),
          fieldType: nameToken(dict.get(PDFName.of('FT'))),
          pPresent: pRef !== undefined,
          pResolvesTo: pageOfRef(doc, pRef),
          parentPresent: dict.get(PDFName.of('Parent')) !== undefined,
          rect,
        });
      }
    } catch {
      // A malformed /Annots array on this page contributes nothing.
    }
  }
  return out;
}

type EngineField = ReturnType<typeof getFormFields>[number];

interface FieldFact {
  name: string;
  klass: string;
  kind: string;
  findFieldPage: number;
  enginePage: number;
  engineRect: unknown;
  engineWidgets: unknown;
  widgetCount: number;
  readOnly: boolean;
  pushButton: boolean;
  value: unknown;
  options: unknown;
  widgets: Array<Record<string, unknown>>;
}

function buildFieldFacts(doc: PDFDocument): { fields: FieldFact[]; widgetProblems: number; unresolvedWidgetNames: string[] } {
  const pdfFields = doc.getForm().getFields();
  const engineFields: EngineField[] = getFormFields(doc);
  const byName = new Map<string, EngineField[]>();
  for (const f of engineFields) {
    const list = byName.get(f.name) ?? [];
    list.push(f);
    byName.set(f.name, list);
  }

  const fields: FieldFact[] = [];
  const unresolvedWidgetNames: string[] = [];
  let widgetProblems = 0;

  for (const field of pdfFields) {
    let name = '';
    let kind = '';
    let klass = '';
    let directPage = -1;
    let widgetCount = 0;
    try { name = field.getName(); } catch { name = ''; }
    try { kind = formFieldKind(field); } catch { kind = ''; }
    try { klass = field.constructor?.name ?? ''; } catch { klass = ''; }
    try { directPage = findFieldPage(doc, field); } catch { directPage = -1; }

    let widgets: Array<{ dict: PDFDict; getRectangle?: () => { x: number; y: number; width: number; height: number } }> = [];
    try { widgets = field.acroField.getWidgets() as never; } catch { widgets = []; }
    widgetCount = widgets.length;

    const engineField = byName.get(name)?.[0];
    const fieldWidgetFacts: Array<Record<string, unknown>> = [];
    for (const widget of widgets) {
      const pRef = widget.dict.get(PDFName.of('P'));
      const resolves = pageOfRef(doc, pRef);
      if (pRef === undefined || resolves < 0) {
        widgetProblems += 1;
        if (!unresolvedWidgetNames.includes(name)) unresolvedWidgetNames.push(name);
      }
      let rect: unknown = null;
      try { rect = widget.getRectangle?.(); } catch { rect = null; }
      let onValue = '';
      try { onValue = widgetOnValue(widget as never); } catch { onValue = ''; }
      let asValue = '';
      try { asValue = nameToken(widget.dict.get(PDFName.of('AS'))); } catch { asValue = ''; }
      fieldWidgetFacts.push({
        pPresent: pRef !== undefined,
        pResolvesTo: resolves,
        apPresent: widget.dict.get(PDFName.of('AP')) !== undefined,
        as: asValue,
        ff: numberFrom(widget.dict.get(PDFName.of('Ff'))),
        onValue,
        rect,
      });
    }

    fields.push({
      name,
      klass,
      kind,
      findFieldPage: directPage,
      enginePage: engineField?.page ?? -1,
      engineRect: engineField?.rect ?? null,
      engineWidgets: engineField?.widgets ?? null,
      widgetCount,
      readOnly: engineField?.readOnly ?? false,
      pushButton: engineField?.pushButton ?? false,
      value: engineField?.value ?? null,
      options: engineField?.options ?? null,
      widgets: fieldWidgetFacts,
    });
  }
  return { fields, widgetProblems, unresolvedWidgetNames };
}

/** Pairwise /Rect overlap between widgets on the same page. */
function findOverlaps(doc: PDFDocument): Array<Record<string, unknown>> {
  interface Placed { name: string; page: number; x: number; y: number; w: number; h: number; }
  const placed: Placed[] = [];
  let pdfFields: PDFField[] = [];
  try { pdfFields = doc.getForm().getFields(); } catch { return []; }
  for (const field of pdfFields) {
    let name = '';
    try { name = field.getName(); } catch { name = ''; }
    let widgets: Array<{ dict: PDFDict; getRectangle?: () => { x: number; y: number; width: number; height: number } }> = [];
    try { widgets = field.acroField.getWidgets() as never; } catch { widgets = []; }
    let fallbackPage = 0;
    try { fallbackPage = findFieldPage(doc, field); } catch { fallbackPage = 0; }
    for (const widget of widgets) {
      const resolved = pageOfRef(doc, widget.dict.get(PDFName.of('P')));
      const page = resolved >= 0 ? resolved : fallbackPage;
      let r: { x: number; y: number; width: number; height: number };
      try {
        r = widget.getRectangle?.() ?? { x: 0, y: 0, width: 0, height: 0 };
      } catch {
        r = { x: 0, y: 0, width: 0, height: 0 };
      }
      if (r.width > 0 && r.height > 0) {
        placed.push({ name, page, x: r.x, y: r.y, w: r.width, h: r.height });
      }
    }
  }

  const overlaps: Array<Record<string, unknown>> = [];
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      const a = placed[i];
      const b = placed[j];
      if (a.page !== b.page) continue;
      const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
      const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
      if (ix > 0 && iy > 0) {
        overlaps.push({
          page: a.page,
          a: a.name,
          b: b.name,
          overlapArea: Number((ix * iy).toFixed(3)),
        });
      }
    }
  }
  return overlaps;
}

function acroFormDict(doc: PDFDocument): PDFDict | undefined {
  try {
    const raw = doc.catalog.get(PDFName.of('AcroForm'));
    if (raw === undefined) return undefined;
    const resolved = doc.context.lookupMaybe(raw as never, PDFDict);
    return resolved ?? undefined;
  } catch {
    return undefined;
  }
}

function readNeedAppearances(doc: PDFDocument): unknown {
  const acro = acroFormDict(doc);
  if (acro === undefined) return null;
  const v = acro.get(PDFName.of('NeedAppearances'));
  try {
    const b = (v as { asBoolean?: () => boolean })?.asBoolean?.();
    if (typeof b === 'boolean') return b;
  } catch {
    // fall through
  }
  return nameToken(v) || (v === undefined ? null : String(v));
}

function rawFieldsCount(doc: PDFDocument): number {
  const acro = acroFormDict(doc);
  if (acro === undefined) return 0;
  try {
    const arr = doc.context.lookupMaybe(acro.get(PDFName.of('Fields')) as never, PDFArray);
    return arr === undefined ? 0 : arr.size();
  } catch {
    return 0;
  }
}

describe('Phase 74 chunk 1 — characterisation of the real encrypted 956.pdf', () => {
  it.skipIf(!COPY_PRESENT)('prints a single JSON facts block from the real engine', async () => {
    const copyBytes = bytesOf(COPY);
    const originalBytes = existsSync(ORIGINAL) ? bytesOf(ORIGINAL) : undefined;
    const shaCopy = sha256(copyBytes);
    const shaOriginal = originalBytes === undefined ? null : sha256(originalBytes);

    const encryptDict = await readEncryptDict(copyBytes);
    const protection = await readProtectionState(copyBytes);

    const noOpts = await tryLoad(copyBytes);
    const ignoreEncryption = await tryLoad(copyBytes, { ignoreEncryption: true });
    const emptyPassword = await tryLoad(copyBytes, { password: '' });

    const facts: Record<string, unknown> = {
      file: {
        originalPath: ORIGINAL,
        originalPresent: originalBytes !== undefined,
        originalBytes: originalBytes?.byteLength ?? null,
        copyPath: COPY,
        copyBytes: copyBytes.byteLength,
        sha256Original: shaOriginal,
        sha256Copy: shaCopy,
        sha256Equal: shaOriginal === null ? null : shaOriginal === shaCopy,
      },
      encryption: {
        ...encryptDict,
        protectionState: protection,
        loads: {
          noOptions: { ok: noOpts.ok, error: noOpts.error ?? null },
          ignoreEncryption: { ok: ignoreEncryption.ok, error: ignoreEncryption.error ?? null },
          emptyPassword: { ok: emptyPassword.ok, error: emptyPassword.error ?? null },
        },
      },
    };

    // A load can "succeed" structurally yet still be unwalkable: with
    // ignoreEncryption, objects held in (still-encrypted) object streams are
    // unreachable, so the catalog /Pages resolves to undefined and getPageCount
    // throws. Probe per load and pick the first page-walkable document.
    const loadReport: Record<string, unknown> = {};
    let doc: PDFDocument | undefined;
    let docSource: string | null = null;
    const candidates: Array<[string, LoadOutcome]> = [
      ['emptyPassword', emptyPassword],
      ['ignoreEncryption', ignoreEncryption],
      ['noOptions', noOpts],
    ];
    for (const [label, outcome] of candidates) {
      let pages: number | null = null;
      let walkError: string | null = null;
      if (outcome.ok && outcome.doc) {
        try {
          pages = outcome.doc.getPageCount();
        } catch (error) {
          walkError = messageOf(error);
        }
      }
      loadReport[label] = { ok: outcome.ok, error: outcome.error ?? null, pageCount: pages, walkError };
      if (doc === undefined && outcome.ok && outcome.doc !== undefined && walkError === null) {
        doc = outcome.doc;
        docSource = label;
      }
    }
    facts.loadReport = loadReport;
    facts.docSource = docSource;

    expect(shaCopy).toHaveLength(64);

    if (doc === undefined) {
      facts.pageCount = null;
      facts.note = 'no load path produced a page-walkable PDFDocument';
      console.log('PHASE74_REAL_FORM_FACTS ' + JSON.stringify(facts, null, 2));
      return;
    }

    try {
      facts.pageCount = doc.getPageCount();

      const raw = rawWidgets(doc);
      const built = buildFieldFacts(doc);
      const engineFields = built.fields;

      const reachableDicts = new Set<unknown>();
      let acroWidgetTotal = 0;
      try {
        for (const f of doc.getForm().getFields()) {
          for (const w of f.acroField.getWidgets()) {
            reachableDicts.add(w.dict);
            acroWidgetTotal += 1;
          }
        }
      } catch {
        // No readable AcroForm tree.
      }

      const missingFromTree = raw
        .filter((w) => !reachableDicts.has(w.dict))
        .map((w) => ({ page: w.page, name: w.name || `annot-${w.page}-${w.index}`, refTag: w.refTag }));

      const rawByPage: Record<string, number> = {};
      for (const w of raw) rawByPage[w.page] = (rawByPage[w.page] ?? 0) + 1;

      const engineByPage: Record<string, number> = {};
      for (const f of engineFields) {
        for (const w of f.widgets) {
          const page = Number((w as { pResolvesTo?: number }).pResolvesTo ?? -1);
          const assigned = page >= 0 ? page : f.findFieldPage;
          engineByPage[assigned] = (engineByPage[assigned] ?? 0) + 1;
        }
      }

      const layered = raw
        .filter((w) => w.pResolvesTo < 0 && w.page !== 0)
        .map((w) => ({ name: w.name || `annot-${w.page}-${w.index}`, rawPage: w.page, pPresent: w.pPresent }));

      const kindCounts: Record<string, number> = {};
      const findPageCounts: Record<string, number> = {};
      const enginePageCounts: Record<string, number> = {};
      for (const f of engineFields) {
        kindCounts[f.kind] = (kindCounts[f.kind] ?? 0) + 1;
        findPageCounts[f.findFieldPage] = (findPageCounts[f.findFieldPage] ?? 0) + 1;
        enginePageCounts[f.enginePage] = (enginePageCounts[f.enginePage] ?? 0) + 1;
      }

      facts.acroForm = {
        getFormFieldsLength: engineFields.length,
        rawFieldsArrayLength: rawFieldsCount(doc),
        totalWidgetsViaAcroField: acroWidgetTotal,
        kindCounts,
        findFieldPageCounts: findPageCounts,
        enginePageCounts,
        needAppearances: readNeedAppearances(doc),
      };
      facts.fields = engineFields;
      facts.widgetPRefs = {
        total: engineFields.reduce((n, f) => n + f.widgetCount, 0),
        absentOrUnresolved: built.widgetProblems,
        unresolvedFieldNames: built.unresolvedWidgetNames,
      };
      facts.rawAnnotsVsEngine = {
        rawTotal: raw.length,
        rawByPage,
        engineWidgetTotal: acroWidgetTotal,
        engineByPage,
        missingFromTree,
        layered,
      };
      facts.overlaps = findOverlaps(doc);
      facts.orphans = findOrphanWidgets(doc).map((o) => ({
        page: o.pageIndex,
        name: o.name,
        kind: o.kind,
        readOnly: o.readOnly,
      }));
      facts.cantooClasses = engineFields.map((f) => ({ name: f.name, klass: f.klass, kind: f.kind }));
    } catch (error) {
      facts.analysisError = messageOf(error);
    }

    console.log('PHASE74_REAL_FORM_FACTS ' + JSON.stringify(facts, null, 2));
  });
});

