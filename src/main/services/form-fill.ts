import {
  PDFArray,
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFObject,
  PDFOptionList,
  PDFRadioGroup,
  PDFRef,
  PDFSignature,
  PDFStream,
  PDFString,
  PDFTextField,
  type PDFFont,
} from '@cantoo/pdf-lib';
import type { FormFillReport, FormFillStatus } from '../../shared/types';
import {
  buttonGroupValue,
  findFieldPage,
  findOrphanWidgets,
  formFieldId,
  formFieldKind,
  formFieldReadOnly,
  formFieldWidgetCount,
  isSignatureField,
  setButtonGroupValue,
} from './forms';

/**
 * Phase 59 item 4 (part 1 of 3) — carry the source AcroForm across a rebuild.
 *
 * `serializeDoc`, `serializeDocOptimized` and `optimizePdf` all build a fresh
 * PDFDocument and copy the source pages into it. Page copying does NOT carry
 * the catalog's `/AcroForm` (pdf-lib's copier only follows the page tree), so
 * the old save path RECREATED each field with pdf-lib's
 * `createTextField`/`createCheckBox`/... + `addToPage` with no box. That had
 * three measured consequences on a real form:
 *
 *  - every widget got pdf-lib's default 200x50 box at (0,0), destroying the
 *    real geometry (the operator's file: 105 fields / 129 widget annotations in,
 *    105 / 105 out — 24 widget positions gone);
 *  - a button GROUP with N widgets collapsed to ONE widget, so all but one
 *    checkbox/radio option became unclickable;
 *  - the recreated widgets carried pdf-lib's default white fill + black border,
 *    which is the "layer of fields" the operator saw painted over the form.
 *
 * The carry below deep-copies the source `/AcroForm` (and everything it
 * references: `/Fields`, `/Kids`, widgets, `/DR`, `/DA`, `/Ff`, `/Opt`, `/AP`)
 * into the output with ONE copier that is pre-seeded with two mappings, so the
 * copied graph is wired to the objects the output document already owns:
 *
 *  - source page ref -> output page ref (from the serializer's `pageMap`), so a
 *    widget's `/P` back-reference is remapped to the NEW page instead of
 *    dragging the source page object into the output context;
 *  - source widget ref -> the output widget ref that `copyPages` already placed
 *    on the output page's `/Annots`, so the field tree and the page point at the
 *    SAME widget object. A second copy of a widget would make PDF.js render one
 *    object while reading values from another (the DEF-400 identity class of
 *    bug). Widget order on a page is preserved by `copyPages` and by
 *    `stripModeledAnnots` (which only removes TFlex-modeled subtypes, never
 *    `/Widget`), so pairing the page's widgets in order is exact.
 *
 * Anything the source graph references that is NOT a form object and NOT a page
 * (a page ref for a deleted page, an inherited `/Pages` node) resolves to
 * "dropped" rather than being cloned, so no orphan page tree is ever dragged
 * into the output.
 *
 * `/NeedAppearances` is copied exactly as the source had it — the carry never
 * forces it true or false. Field VALUES are the source's own `/V` entries; this
 * module does not fill anything (that is part 2).
 */

export interface AcroFormCarrySummary {
  /** Field dicts (a `/T` or `/FT`) carried into the output. */
  fieldCount: number;
  /** Widget dicts (`/Subtype /Widget`) carried into the output. */
  widgetCount: number;
  /** The same two counts measured on the source, so a caller can assert
   *  nothing was dropped. */
  sourceFieldCount: number;
  sourceWidgetCount: number;
}

const EMPTY_SUMMARY: AcroFormCarrySummary = {
  fieldCount: 0,
  widgetCount: 0,
  sourceFieldCount: 0,
  sourceWidgetCount: 0,
};

/**
 * Copy the source catalog's `/AcroForm` into `outDoc`, remapping every widget
 * `/P` to the matching output page. Returns the carried/source counts. Never
 * throws for a malformed form: a form that cannot be copied at all leaves the
 * output without one and reports zero carried counts.
 */
export function carryAcroForm(
  srcDoc: PDFDocument,
  outDoc: PDFDocument,
  pageMap: ReadonlyMap<number, number>,
): AcroFormCarrySummary {
  const srcAcroFormValue = srcDoc.catalog.get(PDFName.of('AcroForm'));
  if (srcAcroFormValue === undefined) return EMPTY_SUMMARY;
  const srcFormDict = srcDoc.context.lookupMaybe(srcAcroFormValue, PDFDict);
  if (srcFormDict === undefined) return EMPTY_SUMMARY;

  const source = countAcroFormGraph(srcDoc, srcFormDict);
  const failed: AcroFormCarrySummary = {
    ...EMPTY_SUMMARY,
    sourceFieldCount: source.fields,
    sourceWidgetCount: source.widgets,
  };

  let copier: FormGraphCopier;
  let copied: PDFObject | null;
  try {
    copier = new FormGraphCopier(srcDoc, outDoc, pageMap);
    copied = copier.copy(srcAcroFormValue);
  } catch {
    return failed;
  }
  if (copied === null) return failed;
  outDoc.catalog.set(PDFName.of('AcroForm'), copied);

const outFormDict = outDoc.context.lookupMaybe(copied, PDFDict);
  if (outFormDict === undefined) return failed;
  try {
    copier.remapWidgetPages(srcFormDict, outFormDict);
  } catch {
    // Best-effort; a malformed field tree must not undo the carry.
  }

  const carried = countAcroFormGraph(outDoc, outFormDict);
  if (carried.fields < source.fields || carried.widgets < source.widgets) {
    console.warn(
      `[tflex] AcroForm carry dropped content: fields ${source.fields} -> ${carried.fields}, ` +
        `widgets ${source.widgets} -> ${carried.widgets}`,
    );
  }
  return {
    fieldCount: carried.fields,
    widgetCount: carried.widgets,
    sourceFieldCount: source.fields,
    sourceWidgetCount: source.widgets,
  };
}

/**
 * ADV-121 / DEF-421 — carry a source document's `/AcroForm` into a document
 * that may ALREADY have one, merging the two `/Fields` arrays into a single
 * tree. This is the merge path's counterpart to `carryAcroForm` (which the save
 * paths use and which owns the catalog entry outright).
 *
 * The source graph is deep-copied with the same `FormGraphCopier`/page-map
 * mechanism, so every widget keeps its REAL `/Rect`, `/AP`, `/DR` and `/DA`
 * and its `/P` is remapped to the merged output page. The copied root fields
 * are APPENDED to the destination's `/Fields`; the destination's own objects
 * are left untouched.
 *
 * Name collisions: a field name is how the AcroForm tree links (`/T` is the
 * key, and a kid inherits the parent prefix). Two documents with the same
 * field name would make the merged tree ambiguous, so an incoming field whose
 * top-level `/T` already exists is renamed deterministically
 * (`name-merged-1`, `name-merged-2`, ...) together with every node in its
 * subtree that repeats that partial name (the merged field+widget dict and any
 * widget kids), so the field and its widgets stay ONE field. The originals are
 * returned in `collisions` and logged.
 */
export interface AcroFormMergeSummary extends AcroFormCarrySummary {
  /** Original names of incoming fields renamed because they collided. */
  collisions: string[];
}

function emptyMergeSummary(): AcroFormMergeSummary {
  return { ...EMPTY_SUMMARY, collisions: [] };
}

export function carryAcroFormInto(
  srcDoc: PDFDocument,
  outDoc: PDFDocument,
  pageMap: ReadonlyMap<number, number>,
): AcroFormMergeSummary {
  const srcAcroFormValue = srcDoc.catalog.get(PDFName.of('AcroForm'));
  if (srcAcroFormValue === undefined) return emptyMergeSummary();
  const srcFormDict = srcDoc.context.lookupMaybe(srcAcroFormValue, PDFDict);
  if (srcFormDict === undefined) return emptyMergeSummary();

  const source = countAcroFormGraph(srcDoc, srcFormDict);
  const failed: AcroFormMergeSummary = {
    ...EMPTY_SUMMARY,
    sourceFieldCount: source.fields,
    sourceWidgetCount: source.widgets,
    collisions: [],
  };

  let copier: FormGraphCopier;
  let copied: PDFObject | null;
  try {
    copier = new FormGraphCopier(srcDoc, outDoc, pageMap);
    copied = copier.copy(srcAcroFormValue);
  } catch {
    return failed;
  }
  if (copied === null) return failed;
  const copiedFormDict = outDoc.context.lookupMaybe(copied, PDFDict);
  if (copiedFormDict === undefined) return failed;
  try {
    copier.remapWidgetPages(srcFormDict, copiedFormDict);
  } catch {
    // Best-effort; a malformed field tree must not undo the carry.
  }

  const collisions: string[] = [];
  const existingValue = outDoc.catalog.get(PDFName.of('AcroForm'));
  const existingFormDict =
    existingValue === undefined
      ? undefined
      : outDoc.context.lookupMaybe(existingValue, PDFDict);

  let outFormDict: PDFDict;
  if (existingFormDict === undefined) {
    outDoc.catalog.set(PDFName.of('AcroForm'), copied);
    outFormDict = copiedFormDict;
  } else {
    outFormDict = existingFormDict;
    mergeFieldArrays(outDoc, existingFormDict, copiedFormDict, collisions);
    copyAcroFormLevelKeys(existingFormDict, copiedFormDict);
  }

  const carried = countAcroFormGraph(outDoc, outFormDict);
  if (collisions.length > 0) {
    console.warn(
      `[tflex] AcroForm merge renamed ${collisions.length} colliding field(s): ${collisions.join(', ')}`,
    );
  }
  if (carried.fields < source.fields || carried.widgets < source.widgets) {
    console.warn(
      `[tflex] AcroForm merge dropped content: fields ${source.fields} -> ${carried.fields}, ` +
        `widgets ${source.widgets} -> ${carried.widgets}`,
    );
  }
  return {
    fieldCount: carried.fields,
    widgetCount: carried.widgets,
    sourceFieldCount: source.fields,
    sourceWidgetCount: source.widgets,
    collisions,
  };
}

/** Decode a `/T` (PDFString / PDFHexString / PDFName) to text. */
function decodeTextObject(value: unknown): string {
  if (value === undefined || value === null) return '';
  try {
    const text = (value as { decodeText?: () => string }).decodeText?.();
    if (typeof text === 'string') return text;
  } catch {
    // fall through
  }
  try {
    const token = (value as { asString?: () => string }).asString?.();
    if (typeof token === 'string') return token.replace(/^\//, '');
  } catch {
    // fall through
  }
  return '';
}

/** The top-level `/T` names present in a form's `/Fields` array. */
function existingTopLevelNames(doc: PDFDocument, formDict: PDFDict): Set<string> {
  const names = new Set<string>();
  const roots = doc.context.lookupMaybe(formDict.get(PDFName.of('Fields')), PDFArray);
  if (roots === undefined) return names;
  for (let i = 0; i < roots.size(); i++) {
    const dict = doc.context.lookupMaybe(roots.get(i), PDFDict);
    if (dict === undefined) continue;
    const name = decodeTextObject(dict.get(PDFName.of('T')));
    if (name !== '') names.add(name);
  }
  return names;
}

/** Deterministic unique name: `base-merged-1`, `base-merged-2`, ... */
function uniqueFieldName(name: string, used: ReadonlySet<string>): string {
  const base = `${name}-merged`;
  let n = 1;
  while (used.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/**
 * Rename the incoming field root AND every node in its subtree whose own `/T`
 * repeats the old partial name (a merged field+widget dict carries the same
 * `/T`; a genuine child with a different partial name is left alone, so its
 * fully qualified name keeps its own segment).
 */
function renameSubtree(
  node: PDFDict,
  oldName: string,
  newName: string,
  context: PDFDocument['context'],
  seen: Set<PDFObject> = new Set(),
): void {
  if (seen.has(node)) return;
  seen.add(node);
  if (decodeTextObject(node.get(PDFName.of('T'))) === oldName) {
    node.set(PDFName.of('T'), PDFString.of(newName));
  }
  const kids = context.lookupMaybe(node.get(PDFName.of('Kids')), PDFArray);
  if (kids === undefined) return;
  for (let i = 0; i < kids.size(); i++) {
    const kid = context.lookupMaybe(kids.get(i), PDFDict);
    if (kid !== undefined) renameSubtree(kid, oldName, newName, context, seen);
  }
}

/** Append the incoming form's root fields to the destination's `/Fields`. */
function mergeFieldArrays(
  doc: PDFDocument,
  dstForm: PDFDict,
  srcForm: PDFDict,
  collisions: string[],
): void {
  const srcRoots = doc.context.lookupMaybe(srcForm.get(PDFName.of('Fields')), PDFArray);
  if (srcRoots === undefined) return;
  let dstRoots = doc.context.lookupMaybe(dstForm.get(PDFName.of('Fields')), PDFArray);
  if (dstRoots === undefined) {
    dstRoots = doc.context.obj([]) as PDFArray;
    dstForm.set(PDFName.of('Fields'), dstRoots);
  }
  const used = existingTopLevelNames(doc, dstForm);
  for (let i = 0; i < srcRoots.size(); i++) {
    const entry = srcRoots.get(i) as PDFObject;
    const dict = doc.context.lookupMaybe(entry, PDFDict);
    if (dict === undefined) continue;
    const oldName = decodeTextObject(dict.get(PDFName.of('T')));
    if (oldName !== '' && used.has(oldName)) {
      const renamed = uniqueFieldName(oldName, used);
      renameSubtree(dict, oldName, renamed, doc.context);
      collisions.push(oldName);
      used.add(renamed);
    } else if (oldName !== '') {
      used.add(oldName);
    }
    dstRoots.push(entry);
  }
}

/** Copy form-level keys the destination is missing (DR, DA, flags, ...). */
function copyAcroFormLevelKeys(dstForm: PDFDict, srcForm: PDFDict): void {
  for (const key of ['DR', 'DA', 'Q', 'CO', 'SigFlags', 'NeedAppearances']) {
    const name = PDFName.of(key);
    if (!dstForm.has(name) && srcForm.has(name)) {
      dstForm.set(name, srcForm.get(name) as PDFObject);
    }
  }
}

/**
 * Count the field and widget dicts reachable from an AcroForm dictionary.
 *
 *  - field  = a dict carrying `/FT` (a fillable field). A non-terminal parent
 *             that only groups a dotted name (`customer` above `name`) is not
 *             counted, matching pdf-lib's own `getForm().getFields()` view;
 *  - widget = a dict carrying `/Subtype /Widget`. A merged field+widget counts
 *             once as a field and once as a widget.
 *
 * Deduplicated by object identity, so a widget shared by two fields or a
 * repeated `/Kids` entry is not double counted.
 */
function countAcroFormGraph(
  doc: PDFDocument,
  formDict: PDFDict,
): { fields: number; widgets: number } {
  const seen = new Set<PDFObject>();
  let fields = 0;
  let widgets = 0;

  const visit = (node: PDFDict): void => {
    if (seen.has(node)) return;
    seen.add(node);
    if (node.get(PDFName.of('Subtype'))?.toString() === '/Widget') widgets += 1;
    if (node.has(PDFName.of('FT'))) fields += 1;
    visitKids(node, doc.context, visit);
  };

  const roots = doc.context.lookupMaybe(formDict.get(PDFName.of('Fields')), PDFArray);
  if (roots !== undefined) {
    for (let i = 0; i < roots.size(); i++) {
      const root = doc.context.lookupMaybe(roots.get(i), PDFDict);
      if (root !== undefined) visit(root);
    }
  }
  return { fields, widgets };
}

/** Recurse into a field dict's `/Kids` entries, if any. */
function visitKids(
  node: PDFDict,
  context: PDFDocument['context'],
  visit: (kid: PDFDict) => void,
): void {
  const kids = context.lookupMaybe(node.get(PDFName.of('Kids')), PDFArray);
  if (kids === undefined) return;
  for (let i = 0; i < kids.size(); i++) {
    const kid = context.lookupMaybe(kids.get(i), PDFDict);
    if (kid !== undefined) visit(kid);
  }
}

/**
 * A PDFObjectCopier specialised for the AcroForm graph.
 *
 * It behaves like pdf-lib's own `PDFObjectCopier` for dictionaries, arrays,
 * streams and indirect refs (memoised by identity/tag so shared objects are
 * copied once and `/Parent` <-> `/Kids` cycles terminate), with two additions:
 *
 *  - refs can be PRE-SEEDED to an output object (page refs, existing widget
 *    refs), so the graph is wired to objects the output already owns; and
 *  - a ref that resolves to a source page object, or to a `/Pages` node, is
 *    DROPPED instead of cloned, so a `/P` for a page that did not survive the
 *    rebuild can never drag the source page tree into the output.
 */
class FormGraphCopier {
  private readonly srcDoc: PDFDocument;
private readonly outDoc: PDFDocument;
  /** Every source page leaf object, so a `/P` of any page is intercepted. */
  private readonly srcPageNodes = new Set<PDFObject>();
  /** Source page leaf object -> its canonical output ref (copied pages only). */
  private readonly srcPageNodeToOutRef = new Map<PDFObject, PDFRef>();
  /** Source ref tag -> output ref, or null when the ref must be dropped. */
  private readonly byRef = new Map<string, PDFRef | null>();
  /** Identity memo for direct (non-ref) dicts/arrays/streams. */
  private readonly byObj = new Map<PDFObject, PDFObject>();

  constructor(srcDoc: PDFDocument, outDoc: PDFDocument, pageMap: ReadonlyMap<number, number>) {
    this.srcDoc = srcDoc;
    this.outDoc = outDoc;
    for (const page of srcDoc.getPages()) this.srcPageNodes.add(page.node);
    this.seedPages(pageMap);
    this.seedWidgets(pageMap);
  }

  /** Seed the source page ref -> output page ref mapping the serializer needs. */
  private seedPages(pageMap: ReadonlyMap<number, number>): void {
    for (const [origIdx, outIdx] of pageMap) {
      try {
        const srcPage = this.srcDoc.getPage(origIdx);
        const outRef = this.outDoc.getPage(outIdx).ref;
        if (srcPage.ref !== undefined) this.byRef.set(srcPage.ref.tag, outRef);
        this.srcPageNodeToOutRef.set(srcPage.node, outRef);
      } catch {
        // Out-of-range index: the page did not survive; its `.getPage` throws.
      }
    }
  }

  /**
   * Seed source widget ref -> the output widget object `copyPages` already put
   * on the page's `/Annots`, pairing the widgets of each page in order.
   *
   * `/Widget` annotations are never stripped or reordered by
   * `serializeAnnotations` (only TFlex-modeled subtypes are), so the k-th
   * widget of the source page and the k-th widget of the output page are the
   * same annotation. When the counts disagree the page is left unseeded: the
   * field graph is still copied and `/P` still remapped, but a widget would
   * then be a second copy rather than the page's own object.
   */
  private seedWidgets(pageMap: ReadonlyMap<number, number>): void {
    for (const [origIdx, outIdx] of pageMap) {
      try {
        const srcPage = this.srcDoc.getPage(origIdx);
        const outPage = this.outDoc.getPage(outIdx);
        const srcWidgets = widgetEntries(srcPage.node, this.srcDoc);
        const outWidgets = widgetEntries(outPage.node, this.outDoc);
        if (srcWidgets.length !== outWidgets.length) continue;
        for (let i = 0; i < srcWidgets.length; i++) {
          const [srcRef, srcDict] = srcWidgets[i];
          const [outRef, outDict] = outWidgets[i];
          if (srcRef !== undefined && outRef !== undefined) this.byRef.set(srcRef.tag, outRef);
          if (srcDict !== undefined && outDict !== undefined) this.byObj.set(srcDict, outDict);
        }
      } catch {
        // A malformed page /Annots array must not block the carry.
      }
    }
  }

  /** Copy one object (or ref) into the output context. Null means "drop". */
  copy(object: PDFObject): PDFObject | null {
    if (this.srcPageNodes.has(object)) return null;
    if (object instanceof PDFRef) return this.copyRef(object);
    if (object instanceof PDFStream) return this.copyStream(object);
    if (object instanceof PDFDict) return this.copyDict(object);
    if (object instanceof PDFArray) return this.copyArray(object);
    return object.clone(this.outDoc.context);
  }

  private copyRef(ref: PDFRef): PDFRef | null {
    if (this.byRef.has(ref.tag)) return this.byRef.get(ref.tag) ?? null;
    const resolved = this.srcDoc.context.lookup(ref);
    if (resolved === undefined || this.srcPageNodes.has(resolved) || isPagesNode(resolved)) {
      this.byRef.set(ref.tag, null);
      return null;
    }
    const newRef = this.outDoc.context.nextRef();
    this.byRef.set(ref.tag, newRef);
    const copied = this.copy(resolved);
    if (copied === null) {
      this.byRef.set(ref.tag, null);
      return null;
    }
    this.outDoc.context.assign(newRef, copied);
    return newRef;
  }

  private copyDict(dict: PDFDict): PDFDict {
    const memo = this.byObj.get(dict);
    if (memo !== undefined) return memo as PDFDict;
    const cloned = dict.clone(this.outDoc.context) as PDFDict;
    this.byObj.set(dict, cloned);
    for (const [key, value] of dict.entries()) {
      const copied = this.copy(value);
      if (copied === null) cloned.delete(key);
      else cloned.set(key, copied);
    }
    return cloned;
  }

  private copyArray(array: PDFArray): PDFArray {
    const memo = this.byObj.get(array);
    if (memo !== undefined) return memo as PDFArray;
    const cloned = array.clone(this.outDoc.context) as PDFArray;
    this.byObj.set(array, cloned);
    for (let i = 0; i < array.size(); i++) {
      const copied = this.copy(array.get(i) as PDFObject);
      if (copied === null) cloned.remove(i);
      else cloned.set(i, copied);
    }
    return cloned;
  }

  private copyStream(stream: PDFStream): PDFStream {
    const memo = this.byObj.get(stream);
    if (memo !== undefined) return memo as PDFStream;
    const cloned = stream.clone(this.outDoc.context) as PDFStream;
    this.byObj.set(stream, cloned);
    for (const [key, value] of stream.dict.entries()) {
      const copied = this.copy(value);
      if (copied === null) cloned.dict.delete(key);
      else cloned.dict.set(key, copied);
    }
return cloned;
  }

  /**
   * Remap every widget `/P` in the carried field tree to the output page's
   * CANONICAL ref.
   *
   * Why this pass is required: pdf-lib's `copyPages` clones a page leaf through
   * a temporary clone, so the memo it uses for the page is keyed by that clone,
   * not by the source leaf. When the copier then follows a widget's `/P` back
   * to the source leaf, the memo misses and it mints a SECOND full page clone
   * for that ref. The `/P` therefore resolves to an orphan page object — a
   * different instance from the page in the output page tree (measured on a
   * real form: 47/47 widgets of one page pointed at such a clone). Walking the
   * SOURCE field tree and the copied field tree in lockstep lets the `/P` be
   * set from the source widget's own page through the serializer's page map:
   * mapped to `outDoc.getPage(outIdx).ref` when the page survived, deleted when
   * it did not (the widget's page was removed from the document).
   *
   * The walk is identity-based (a source page ref is resolved and matched
   * against the source page nodes), so a source whose pages are aliased by
   * several refs still remaps correctly. Both trees are walked in `/Kids`
   * order, which the copier preserves, and an output node is visited once.
   */
  remapWidgetPages(srcFormDict: PDFDict, outFormDict: PDFDict): void {
    const pageKey = PDFName.of('P');
    const kidsKey = PDFName.of('Kids');
    const seen = new Set<PDFObject>();

    const walk = (srcNode: PDFDict, outNode: PDFDict): void => {
      if (seen.has(outNode)) return;
      seen.add(outNode);
      const srcP = srcNode.get(pageKey);
      if (srcP instanceof PDFRef) {
        const mapped = this.mapSourcePageRef(srcP);
        if (mapped === null) outNode.delete(pageKey);
        else if (mapped !== undefined) outNode.set(pageKey, mapped);
      }
      const srcKids = this.srcDoc.context.lookupMaybe(srcNode.get(kidsKey), PDFArray);
      const outKids = this.outDoc.context.lookupMaybe(outNode.get(kidsKey), PDFArray);
      if (srcKids === undefined || outKids === undefined) return;
      const count = Math.min(srcKids.size(), outKids.size());
      for (let i = 0; i < count; i++) {
        const srcKid = this.srcDoc.context.lookupMaybe(srcKids.get(i), PDFDict);
        const outKid = this.outDoc.context.lookupMaybe(outKids.get(i), PDFDict);
        if (srcKid !== undefined && outKid !== undefined) walk(srcKid, outKid);
      }
    };

    const srcRoots = this.srcDoc.context.lookupMaybe(
      srcFormDict.get(PDFName.of('Fields')),
      PDFArray,
    );
    const outRoots = this.outDoc.context.lookupMaybe(
      outFormDict.get(PDFName.of('Fields')),
      PDFArray,
    );
    if (srcRoots === undefined || outRoots === undefined) return;
    const count = Math.min(srcRoots.size(), outRoots.size());
    for (let i = 0; i < count; i++) {
      const srcRoot = this.srcDoc.context.lookupMaybe(srcRoots.get(i), PDFDict);
      const outRoot = this.outDoc.context.lookupMaybe(outRoots.get(i), PDFDict);
      if (srcRoot !== undefined && outRoot !== undefined) walk(srcRoot, outRoot);
    }
  }

  /**
   * A source `/P` ref -> the canonical output page ref; null when the ref
   * points at a source page that did not survive the rebuild (drop the `/P`);
   * undefined when the ref does not resolve to a source page at all (leave the
   * copied value alone).
   */
  private mapSourcePageRef(ref: PDFRef): PDFRef | null | undefined {
    const resolved = this.srcDoc.context.lookup(ref);
    if (resolved === undefined) return null;
    if (!this.srcPageNodes.has(resolved)) return undefined;
    return this.srcPageNodeToOutRef.get(resolved) ?? null;
  }
}

/**
 * The `/Widget` entries of a page's `/Annots`, in array order, as
 * `[ref, dict]` pairs. `undefined` for a slot means that entry was a direct
 * dict with no ref (or a ref that did not resolve).
 */
function widgetEntries(
  pageNode: PDFDict,
  doc: PDFDocument,
): Array<[PDFRef | undefined, PDFDict | undefined]> {
  const result: Array<[PDFRef | undefined, PDFDict | undefined]> = [];
  const annots = doc.context.lookupMaybe(pageNode.get(PDFName.of('Annots')), PDFArray);
  if (annots === undefined) return result;
  for (let i = 0; i < annots.size(); i++) {
    const entry = annots.get(i);
    const dict = doc.context.lookupMaybe(entry as PDFObject, PDFDict);
    if (dict === undefined) continue;
    if (dict.get(PDFName.of('Subtype'))?.toString() !== '/Widget') continue;
    result.push([entry instanceof PDFRef ? entry : undefined, dict]);
  }
  return result;
}

/** True for a `/Type /Pages` tree node (never cloned into the output). */
function isPagesNode(object: PDFObject): boolean {
  if (!(object instanceof PDFDict)) return false;
  try {
    return object.get(PDFName.of('Type'))?.toString() === '/Pages';
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Phase 59 item 4 (part 2 of 3) - native fill
// ---------------------------------------------------------------------------

/** True when the font can encode every character of `text`. */
function fontCanEncode(font: PDFFont, text: string): boolean {
  if (text === '') return true;
  try {
    font.encodeText(text);
    return true;
  } catch {
    return false;
  }
}

function toText(value: string | string[]): string {
  return Array.isArray(value) ? value.join(', ') : value;
}

function safeFieldName(field: { getName?: () => string }): string {
  try {
    return field.getName?.() ?? 'field';
  } catch {
    return 'field';
  }
}

/** The value the caller supplied for this field, by id then by name. */
function lookupProvided(
  values: ReadonlyMap<string, string | string[]> | undefined,
  pdfDoc: PDFDocument,
  field: Parameters<typeof formFieldId>[1],
): string | string[] | undefined {
  if (values === undefined) return undefined;
  let id = '';
  try {
    id = formFieldId(pdfDoc, field);
  } catch {
    id = '';
  }
  if (id !== '' && values.has(id)) return values.get(id);
  const name = safeFieldName(field);
  if (values.has(name)) return values.get(name);
  return undefined;
}

/**
 * Apply one field's value natively. `provided === undefined` re-applies the
 * field's CURRENT value (used by the save-time pass, which must only
 * regenerate appearances on the values already carried). Returns the
 * outcome for the report.
 */
function applyFieldValue(
  pdfDoc: PDFDocument,
  field: Parameters<typeof formFieldId>[1],
  font: PDFFont,
  provided: string | string[] | undefined,
): { status: FormFillStatus; detail?: string } {
  if (field instanceof PDFTextField) {
    const next = provided === undefined ? (field.getText() ?? '') : toText(provided);
    if (!fontCanEncode(font, next)) {
      return {
        status: 'font-unavailable',
        detail: 'the embedded font cannot encode this value (left unchanged)',
      };
    }
    field.setText(next);
    return { status: 'filled' };
  }

  if (field instanceof PDFCheckBox) {
    if (formFieldWidgetCount(field) > 1) {
      const chosen = provided === undefined ? buttonGroupValue(field) : toText(provided);
      // DEF-471 — an untouched empty group has no value to set; report a
      // no-op, not a false "option not found: Off".
      if (provided === undefined && (chosen === '' || chosen === 'Off')) {
        return { status: 'filled' };
      }
      // ADV-126 / DEF-426 — an option that is not one of the widgets'
      // on-states changes nothing; report it instead of claiming a fill.
      if (!setButtonGroupValue(field, chosen)) {
        return { status: 'option-unknown', detail: `option not found: ${chosen}` };
      }
      try {
        pdfDoc.getForm().markFieldAsDirty(field.ref);
      } catch {
        // Dirty marking is an optimisation; /AS was set already.
      }
      return { status: 'filled' };
    }
    const wantTrue =
      provided === undefined
        ? field.isChecked()
        : Array.isArray(provided)
          ? provided[0] === 'true'
          : provided === 'true';
    if (wantTrue) field.check();
    else field.uncheck();
    return { status: 'filled' };
  }

  if (field instanceof PDFRadioGroup) {
    const chosen = provided === undefined ? (field.getSelected() ?? '') : toText(provided);
    if (chosen === '') {
      field.clear();
      return { status: 'filled' };
    }
    try {
      field.select(chosen);
    } catch {
      return { status: 'option-unknown', detail: `option not found: ${chosen}` };
    }
    return { status: 'filled' };
  }

  if (field instanceof PDFDropdown) {
    const chosen = provided === undefined ? (field.getSelected() ?? '') : toText(provided);
    if (chosen === '') {
      field.clear();
      return { status: 'filled' };
    }
    try {
      field.select(chosen);
    } catch {
      return { status: 'option-unknown', detail: `option not found: ${chosen}` };
    }
    return { status: 'filled' };
  }

  if (field instanceof PDFOptionList) {
    const selected = provided === undefined ? field.getSelected() : Array.isArray(provided) ? provided : [provided];
    field.clear();
    let applied = 0;
    for (const value of selected) {
      if (value) {
        try {
          field.select(value);
          applied += 1;
        } catch {
          // Option not found - leave the others selected.
        }
      }
    }
    if (selected.some((v) => v) && applied === 0) {
      return { status: 'option-unknown', detail: 'no option matched the field' };
    }
    return { status: 'filled' };
  }

  return { status: 'filled' };
}

/**
 * Phase 59 item 4 - fill every AcroForm field NATIVELY: set the field value
 * (/V) and regenerate each widget's appearance (/AP) with a Unicode-capable
 * font, then return one report row per field (plus rows for orphan widgets
 * and XFA-only forms).
 *
 * `values` maps a field id (as returned by getFormFields) or field name to
 * the value to write. When omitted, each field's CURRENT value is
 * re-applied - the save-time pass uses this to regenerate appearances on
 * the values already carried across the rebuild.
 *
 * The caller is responsible for saving with `updateFieldAppearances: false`
 * so pdf-lib does not immediately re-render appearances with its default
 * WinAnsi Helvetica (which would discard the Unicode font and could throw
 * on a non-WinAnsi value).
 */
export function fillFormNatively(
  pdfDoc: PDFDocument,
  font: PDFFont,
  values?: ReadonlyMap<string, string | string[]>,
): FormFillReport[] {
  const reports: FormFillReport[] = [];

  let form: ReturnType<PDFDocument['getForm']>;
  try {
    form = pdfDoc.getForm();
  } catch {
    return reports;
  }

  const fields = form.getFields();

  let widgetCount = 0;
  for (const field of fields) widgetCount += formFieldWidgetCount(field);

  // A form with XFA data and NO AcroForm widgets cannot be filled by pdf-lib
  // (it does not read or write XFA values). A form with both still fills the
  // AcroForm widgets below.
  let hasXfa = false;
  try {
    hasXfa = form.hasXFA();
  } catch {
    hasXfa = false;
  }
  if (hasXfa && widgetCount === 0) {
    reports.push({
      name: 'XFA form',
      page: null,
      kind: 'xfa',
      status: 'xfa',
      detail: 'the form has XFA data and no AcroForm widgets; pdf-lib cannot write XFA values',
    });
    return reports;
  }

  for (const field of fields) {
    const name = safeFieldName(field);
    let page = 0;
    try {
      page = findFieldPage(pdfDoc, field);
    } catch {
      page = 0;
    }
    const pageOne = page + 1;
    const kind = formFieldKind(field);

    if (isSignatureField(field) || field instanceof PDFSignature) {
      reports.push({
        name,
        page: pageOne,
        kind: 'signature',
        status: 'skipped-signature',
        detail: 'digital signature fields are not fillable',
      });
      continue;
    }

    if (formFieldReadOnly(field)) {
      reports.push({
        name,
        page: pageOne,
        kind,
        status: 'skipped-readonly',
        detail: 'the field is read-only',
      });
      continue;
    }

    const provided = lookupProvided(values, pdfDoc, field);
    try {
      const outcome = applyFieldValue(pdfDoc, field, font, provided);
      const row: FormFillReport = { name, page: pageOne, kind, status: outcome.status };
      if (outcome.detail !== undefined) row.detail = outcome.detail;
      reports.push(row);
    } catch (e) {
      reports.push({
        name,
        page: pageOne,
        kind,
        status: 'font-unavailable',
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // Orphan widgets (page /Annots widgets not reachable from /Fields) cannot
  // be written through the form API; report them rather than dropping them.
  try {
    for (const orphan of findOrphanWidgets(pdfDoc)) {
      reports.push({
        name: orphan.name,
        page: orphan.pageIndex + 1,
        kind: 'orphan',
        status: 'orphan-unfilled',
        detail: 'widget is not referenced by the AcroForm /Fields tree',
      });
    }
  } catch {
    // Best-effort diagnostics.
  }

  // Regenerate every widget appearance ONCE with the Unicode font. On a
  // failure (a pre-existing non-encodable value the guard above did not
  // cover) fall back to per-field best-effort so one bad field cannot block
  // the rest.
  try {
    form.updateFieldAppearances(font);
  } catch {
    for (const field of fields) {
      try {
        if (field.needsAppearancesUpdate()) field.defaultUpdateAppearances(font);
      } catch {
        // Leave the field's existing appearance in place.
      }
    }
  }

  return reports;
}
