import {
  PDFDict,
  PDFDocument,
  PDFName,
  PDFNull,
  PDFNumber,
  PDFObject,
  PDFRef,
  PDFString,
} from '@cantoo/pdf-lib';
import { err, ok, type Result } from '../../shared/result';
import { countOutline, normalizeOutline, type OutlineEntry } from '../../shared/outline';
import type { CropEntry, EngineError, PageLabelEntry } from '../../shared/types';

// ---------------------------------------------------------------------------
// Phase 12 — residual page-organize helpers
//
// This module holds the catalog-level operations the engine exposes as the
// Phase 12 residual page-organize surface: outline (bookmark) carry with a
// page-ref remap, /PageLabels number-tree writes, and CropBox/TrimBox sets.
//
// Coordinate conventions:
//   - CropEntry.box and the renderer payloads use a TOP-LEFT origin (matching
//     AnnRect). PDF CropBox/TrimBox use a BOTTOM-LEFT origin, so cropPagesInDoc
//     converts top-left -> bottom-left before calling pdf-lib's setCropBox /
//     setTrimBox (which take (llx, lly, width, height)).
//   - PageLabelEntry.page is 1-based VISIBLE. applyPageLabels is called on the
//     serialized output document, whose pages are already in visible order, so
//     the number-tree key is just (page - 1).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Outline (bookmark) carry with page-ref remap
// ---------------------------------------------------------------------------

/**
 * Carry the document outline (bookmarks, catalog /Outlines) from one or more
 * source documents onto `dstDoc`, remapping every outline destination's page
 * reference through `pageRefMap`.
 *
 * `pageRefMap` maps a SOURCE page ref's tag (e.g. `"4 0 R"`) to the matching
 * DESTINATION page ref. Destinations whose page ref is not in the map (e.g. a
 * bookmark pointing at a page that was dropped) are left without a /Dest so
 * the outline entry survives but does not jump anywhere.
 *
 * The outline tree is deep-copied into `dstDoc`'s context: each node is
 * re-registered with a fresh ref, /Parent /First /Next /Last are rewired, and
 * /Dest (or an action /A./D) page refs are remapped. Multiple sources are
 * concatenated (source 1's top-level chain, then source 2's, ...).
 *
 * Best-effort: carries /Title, /Count, /C (color), /F (flags), /Dest, /A
 * (GoTo actions). Named destinations (/Dests) and exotic action types are
 * not remapped — a GoTo to a named dest is kept as-is.
 */
export function carryOutlines(
  dstDoc: PDFDocument,
  sources: Array<{ doc: PDFDocument; map: Map<string, PDFRef> }>,
): void {
  const chains: Array<{ first: PDFRef; last: PDFRef; count: number }> = [];
  for (const { doc: srcDoc, map } of sources) {
    try {
      const rootVal = srcDoc.catalog.get(PDFName.of('Outlines'));
      if (rootVal === undefined) continue;
      let rootDict: PDFDict | null = null;
      if (rootVal instanceof PDFDict) rootDict = rootVal;
      else if (rootVal instanceof PDFRef) {
        const looked = srcDoc.context.lookup(rootVal);
        if (looked instanceof PDFDict) rootDict = looked;
      }
      if (rootDict === null) continue;
      const firstRef = rootDict.get(PDFName.of('First'));
      if (firstRef === undefined) continue;
      const [first, last, count] = copyOutlineChain(
        srcDoc,
        dstDoc,
        firstRef,
        map,
        null,
      );      if (first !== null && last !== null) chains.push({ first, last, count });
    } catch {
      // A malformed outline on one source must not break the whole carry.
    }
  }
  if (chains.length === 0) return;

  // Build a merged root: /Type /Outlines, /First = first chain, /Last = last
  // chain, each chain's last.Next = the next chain's first.
  const root = dstDoc.context.obj({}) as PDFDict;
  let total = 0;
  for (let i = 0; i < chains.length; i++) {
    total += chains[i].count;
    if (i + 1 < chains.length && chains[i].last !== chains[i + 1].first) {
      const lastDict = dstDoc.context.lookup(chains[i].last);
      if (lastDict instanceof PDFDict) {
        lastDict.set(PDFName.of('Next'), chains[i + 1].first);
      }
    }
  }
  root.set(PDFName.of('Type'), PDFName.of('Outlines'));
  root.set(PDFName.of('First'), chains[0].first);
  root.set(PDFName.of('Last'), chains[chains.length - 1].last);
  root.set(PDFName.of('Count'), PDFNumber.of(Math.max(1, total)));
  const rootRef = dstDoc.context.register(root);
  // Fix the first chain's first node's /Parent (it was created with no parent).
  const firstDict = dstDoc.context.lookup(chains[0].first);
  if (firstDict instanceof PDFDict) {
    firstDict.set(PDFName.of('Parent'), rootRef);
  }
  dstDoc.catalog.set(PDFName.of('Outlines'), rootRef);
}

/**
 * Copy a single outline node (a PDFDict) from `srcDoc` into `dstDoc`,
 * remapping any /Dest (or GoTo action /D) page ref via `map`. Returns the new
 * ref. Structural links (/First, /Next, /Last) are NOT handled here — the
 * caller wires them via copyOutlineChain so /Next siblings share a parent.
 */
function copyOutlineNode(
  srcDoc: PDFDocument,
  dstDoc: PDFDocument,
  srcRefOrDict: PDFObject,
  map: Map<string, PDFRef>,
  parentRef: PDFRef | null,
): PDFRef {
  const dstDict = dstDoc.context.obj({}) as PDFDict;
  const dstRef = dstDoc.context.register(dstDict);

  let srcDict: PDFDict | null = null;
  if (srcRefOrDict instanceof PDFDict) srcDict = srcRefOrDict;
  else if (srcRefOrDict instanceof PDFRef) {
    const looked = srcDoc.context.lookup(srcRefOrDict);
    if (looked instanceof PDFDict) srcDict = looked;
  }
  if (srcDict === null) return dstRef;

  for (const [key, value] of srcDict.entries()) {
    const kn = key.toString();
    if (kn === '/Parent') {
      if (parentRef !== null) dstDict.set(key, parentRef);
      continue;
    }
    if (
      kn === '/First' ||
      kn === '/Next' ||
      kn === '/Last' ||
      kn === '/Prev'
    ) {
      // Handled by copyOutlineChain — do not duplicate nodes here. /Prev is
      // included because a copied /Prev would carry a SOURCE-document object
      // number; copyOutlineChain rewires /Prev to the OUTPUT previous sibling.
      continue;
    }
    if (kn === '/Dest') {
      const remapped = remapDest(value, srcDoc, dstDoc, map);
      if (remapped !== null) dstDict.set(key, remapped);
      continue;
    }
    if (kn === '/A') {
      const action = copyAction(value, srcDoc, dstDoc, map);
      if (action !== null) dstDict.set(key, action);
      continue;
    }
    // Primitives and color/flags/counts: recreate in the dst context.
    const cloned = clonePrimitive(value, dstDoc);
    if (cloned !== null) dstDict.set(key, cloned);
  }
  return dstRef;
}

/**
 * Copy a /Next sibling chain (or a /First child chain) starting at
 * `firstSrcRef`. Returns [firstDstRef, lastDstRef, count] where count is the
 * number of top-level nodes copied. Recurses into each node's /First to copy
 * its children (with that node as the parent), and walks /Next to copy
 * siblings (with the same parent).
 */
function copyOutlineChain(
  srcDoc: PDFDocument,
  dstDoc: PDFDocument,
  firstSrcRef: PDFObject,
  map: Map<string, PDFRef>,
  parentRef: PDFRef | null,
): [PDFRef | null, PDFRef | null, number] {
  let firstDst: PDFRef | null = null;
  let prevDst: PDFRef | null = null;
  let count = 0;
  let curRef: PDFObject | null = firstSrcRef;
  // Guard against a cyclic /Next chain (malformed outlines). Key indirect
  // nodes on their ref tag (so a ref cycle is caught) and inline dicts on
  // object identity: two distinct inline siblings are distinct objects and
  // must both survive, whereas a shared `'inline'` tag would drop the second.
  const seen = new Set<unknown>();

  while (curRef !== null) {
    const key: unknown = curRef instanceof PDFRef ? curRef.tag : curRef;
    if (seen.has(key)) break;
    seen.add(key);

    let srcDict: PDFDict | null = null;
    if (curRef instanceof PDFDict) srcDict = curRef;
    else if (curRef instanceof PDFRef) {
      const looked: PDFObject | undefined = srcDoc.context.lookup(curRef);
      if (looked instanceof PDFDict) srcDict = looked;
    }
    if (srcDict === null) break;

    const dstRef = copyOutlineNode(srcDoc, dstDoc, curRef, map, parentRef);
    count += 1;

    // Children: this node's /First starts a child chain whose parent is dstRef.
    const childFirst = srcDict.get(PDFName.of('First'));
    if (childFirst !== undefined) {
      const [cFirst, cLast] = copyOutlineChain(
        srcDoc,
        dstDoc,
        childFirst,
        map,
        dstRef,
      );
      const dstNodeDict = dstDoc.context.lookup(dstRef);
      if (dstNodeDict instanceof PDFDict) {
        if (cFirst !== null) dstNodeDict.set(PDFName.of('First'), cFirst);
        if (cLast !== null) dstNodeDict.set(PDFName.of('Last'), cLast);
      }
    }

    // Wire /Next from the previous sibling to this node, and this node's
    // /Prev back to the previous sibling. The source /Prev is never copied
    // (see copyOutlineNode), so this is the only place /Prev is set and it
    // always targets an OUTPUT object, never a source object number.
    if (prevDst !== null) {
      const prevDict = dstDoc.context.lookup(prevDst);
      if (prevDict instanceof PDFDict) {
        prevDict.set(PDFName.of('Next'), dstRef);
      }
      const curDict = dstDoc.context.lookup(dstRef);
      if (curDict instanceof PDFDict) {
        curDict.set(PDFName.of('Prev'), prevDst);
      }
    } else {
      firstDst = dstRef;
    }
    prevDst = dstRef;

    // Advance to the next sibling.
    const nextRef: PDFObject | undefined = srcDict.get(PDFName.of('Next'));
    if (nextRef === undefined) break;
    curRef = nextRef;
  }

  return [firstDst, prevDst, count];
}

/**
 * Remap a /Dest value. /Dest may be:
 *   - an array [pageRef, /Fit | /XYZ x y zoom ...]  (the common form)
 *   - a name/string naming a destination              (kept as-is)
 * Returns a new PDFObject in dstDoc (a PDFArray with the page ref remapped,
 * or a kept named dest), or null if the page ref is not in the map.
 */
function remapDest(
  value: unknown,
  srcDoc: PDFDocument,
  dstDoc: PDFDocument,
  map: Map<string, PDFRef>,
): PDFObject | null {
  try {
    // DEF-498: a /Dest (or /A./D) may itself be an indirect ref to the dest
    // array. Resolve it in the SOURCE context first, then remap the resolved
    // value; only the source context can dereference the source ref.
    let resolved: unknown = value;
    if (resolved instanceof PDFRef) {
      resolved = srcDoc.context.lookup(resolved);
    }
    if (resolved === undefined || resolved === null) return null;
    const arr = resolved as { size(): number; get(i: number): unknown } | undefined;
    if (arr && typeof arr.size === 'function' && arr.size() > 0) {
      const firstEl = arr.get(0);
      if (firstEl instanceof PDFRef) {
        const remapped = map.get(firstEl.tag);
        if (remapped === undefined) return null;
        const out: Array<PDFObject> = [remapped];
        for (let i = 1; i < arr.size(); i++) {
          const el = arr.get(i);
          if (el instanceof PDFName) out.push(el);
          else if (el instanceof PDFNumber) out.push(PDFNumber.of(el.asNumber()));
          else if (el instanceof PDFString) out.push(PDFString.of(el.asString()));
          else if (el === PDFNull) out.push(PDFNull);
        }
        return dstDoc.context.obj(out);
      }
      return null;
    }
    if (resolved instanceof PDFName) return resolved;
    if (resolved instanceof PDFString) return PDFString.of(resolved.asString());
    return null;
  } catch {
    return null;
  }
}

/**
 * Copy a GoTo action dict (/A), remapping its /D page ref if it is an array
 * dest. Other action types are kept with their /S but an unmappable /D is
 * dropped. Returns a new registered dict ref, or null.
 */
function copyAction(
  value: unknown,
  srcDoc: PDFDocument,
  dstDoc: PDFDocument,
  map: Map<string, PDFRef>,
): PDFRef | null {
  try {
    let actionDict: PDFDict | null = null;
    if (value instanceof PDFDict) actionDict = value;
    else if (value instanceof PDFRef) {
      const looked = srcDoc.context.lookup(value);
      if (looked instanceof PDFDict) actionDict = looked;
    }
    if (actionDict === null) return null;
    const out = dstDoc.context.obj({}) as PDFDict;
    for (const [key, val] of actionDict.entries()) {
      const kn = key.toString();
      if (kn === '/D') {
        const remapped = remapDest(val, srcDoc, dstDoc, map);
        if (remapped !== null) out.set(key, remapped);
        continue;
      }
      const cloned = clonePrimitive(val, dstDoc);
      if (cloned !== null) out.set(key, cloned);
    }
    return dstDoc.context.register(out);
  } catch {
    return null;
  }
}

/**
 * Clone a primitive PDF value (PDFName, PDFString, PDFNumber, PDFArray of
 * primitives) into `dstDoc`'s context. Returns null for values this does not
 * handle (PDFDict/PDFRef — those are handled by the callers above).
 *
 * DEF-496: a bare PDFRef is dropped (returns null) rather than copied
 * verbatim. Copying it would inject a SOURCE-document object number into the
 * output and alias an unrelated output object. A ref element inside an array
 * is dropped for the same reason.
 */
function clonePrimitive(
  value: unknown,
  dstDoc: PDFDocument,
): PDFObject | null {
  if (value instanceof PDFName) return value;
  if (value instanceof PDFString) return PDFString.of(value.asString());
  if (value instanceof PDFNumber) return PDFNumber.of(value.asNumber());
  if (value instanceof PDFRef) return null;
  if (Array.isArray(value)) {
    return dstDoc.context.obj(value as Array<PDFObject | number | string>);
  }
  const arr = value as { size(): number; get(i: number): unknown } | undefined;
  if (arr && typeof arr.size === 'function') {
    const out: Array<PDFObject | number | string> = [];
    for (let i = 0; i < arr.size(); i++) {
      const el = arr.get(i);
      if (el instanceof PDFName) out.push(el);
      else if (el instanceof PDFNumber) out.push(PDFNumber.of(el.asNumber()));
      else if (el instanceof PDFString) out.push(PDFString.of(el.asString()));
      else if (typeof el === 'number' || typeof el === 'string') out.push(el);
    }
    return dstDoc.context.obj(out);
  }
  return null;
}

// ---------------------------------------------------------------------------
// /PageLabels number tree
// ---------------------------------------------------------------------------

/**
 * Write logical page labels onto `doc`'s catalog as a /PageLabels number tree.
 * Each entry becomes a number-tree leaf `{ /P (label) }` keyed by the 0-based
 * page index, so a viewer shows `label` verbatim (no appended number — /S is
 * omitted). `labels` is in visible order; `doc` is expected to be the
 * serialized output whose pages are already in visible order, so the key is
 * simply (page - 1).
 *
 * Replaces any existing /PageLabels on the catalog.
 */
export function applyPageLabels(
  doc: PDFDocument,
  labels: PageLabelEntry[],
): void {
  if (!Array.isArray(labels) || labels.length === 0) return;
  const nums: PDFObject[] = [];
  for (const { page, label } of labels) {
    const idx = page - 1;
    if (!Number.isInteger(idx) || idx < 0) continue;
    if (typeof label !== 'string') continue;
    nums.push(PDFNumber.of(idx));
    nums.push(doc.context.obj({ P: PDFString.of(label) }));
  }
  if (nums.length === 0) return;
  const pageLabels = doc.context.obj({}) as PDFDict;
  pageLabels.set(PDFName.of('Nums'), doc.context.obj(nums));
  doc.catalog.set(PDFName.of('PageLabels'), pageLabels);
}

// ---------------------------------------------------------------------------
// CropBox + TrimBox
// ---------------------------------------------------------------------------

/**
 * Set each listed page's CropBox AND TrimBox to `box`. `page` is 1-based
 * VISIBLE; `box` is a TOP-LEFT origin rectangle (PDF points). The engine
 * converts to the bottom-left convention pdf-lib's setCropBox/setTrimBox use
 * (llx, lly, width, height) where lly = pageHeight - y - height.
 *
 * Mutates `pdfDoc` page nodes in place. The boxes survive a serialize round-
 * trip because pdf-lib's copyPages preserves /CropBox and /TrimBox (verified
 * in the Phase 12 feasibility probe).
 */
export function cropPagesInDoc(
  pdfDoc: PDFDocument,
  order: number[],
  entries: CropEntry[],
): Result<void, EngineError> {
  if (!Array.isArray(entries) || entries.length === 0) {
    return err('empty-range', 'cropPages: no entries provided');
  }
  for (const entry of entries) {
    if (entry === null || typeof entry !== 'object') continue;
    const { page, box } = entry;
    if (!Number.isInteger(page) || page < 1 || page > order.length) {
      return err(
        'out-of-range',
        `crop page ${String(page)} out of range [1,${order.length}]`,
      );
    }
    if (
      box === null ||
      typeof box !== 'object' ||
      !Number.isFinite(box.x) ||
      !Number.isFinite(box.y) ||
      !Number.isFinite(box.width) ||
      !Number.isFinite(box.height) ||
      box.width <= 0 ||
      box.height <= 0
    ) {
      return err('engine-error', `crop box is invalid for page ${page}`);
    }
    const origIdx = order[page - 1];
    const p = pdfDoc.getPage(origIdx);
    const pageHeight = p.getSize().height;
    const llx = box.x;
    const lly = pageHeight - box.y - box.height;
    p.setCropBox(llx, lly, box.width, box.height);
    p.setTrimBox(llx, lly, box.width, box.height);
  }
  return ok(undefined);
}

// ---------------------------------------------------------------------------
// Phase 85 — outline write (replace catalog /Outlines from an edited tree)
// ---------------------------------------------------------------------------

/**
 * Replace `dstDoc`'s catalog `/Outlines` with the given `entries` tree.
 *
 * `entries` is normalized first (see `normalizeOutline`). Every node gets
 * `/Title`, `/Parent`, and — when it has children — `/First`, `/Last` and a
 * positive `/Count` (the open descendant count). Siblings are wired through
 * `/Next`. A node whose `page` is set and whose `pageRef` resolves gets
 * `/Dest = [pageRef /XYZ null null null]`; a null page or an unresolved ref
 * leaves the node without a `/Dest`. An empty tree removes the catalog key.
 *
 * `resolvePageRef(page)` maps a 1-based VISIBLE page number to that page's
 * PDFRef in `dstDoc`, or null when it cannot be resolved.
 */
export function writeOutline(
  dstDoc: PDFDocument,
  entries: OutlineEntry[],
  resolvePageRef: (page: number) => PDFRef | null,
): void {
  const ctx = dstDoc.context;
  const clean = normalizeOutline(entries);
  if (clean.length === 0) {
    dstDoc.catalog.delete(PDFName.of('Outlines'));
    return;
  }

  const root = ctx.obj({}) as PDFDict;
  const rootRef = ctx.register(root);

  // Build one chain of siblings under `parentRef`; returns [first, last, total]
  // where total is the number of nodes in the whole subtree.
  function buildChain(
    list: OutlineEntry[],
    parentRef: PDFRef,
  ): [PDFRef, PDFRef, number] {
    let first: PDFRef | null = null;
    let prev: PDFRef | null = null;
    let last: PDFRef | null = null;
    let total = 0;
    for (const entry of list) {
      const ref = buildNode(entry, parentRef);
      total += 1 + countOutline(entry.children);
      if (prev !== null) {
        const prevDict = ctx.lookup(prev);
        if (prevDict instanceof PDFDict) prevDict.set(PDFName.of('Next'), ref);
      } else {
        first = ref;
      }
      prev = ref;
      last = ref;
    }
    return [first as PDFRef, last as PDFRef, total];
  }

  function buildNode(entry: OutlineEntry, parentRef: PDFRef): PDFRef {
    const node = ctx.obj({}) as PDFDict;
    const ref = ctx.register(node);
    node.set(PDFName.of('Title'), PDFString.of(entry.title));
    node.set(PDFName.of('Parent'), parentRef);
    if (entry.page !== null) {
      const pageRef = resolvePageRef(entry.page);
      if (pageRef !== null) {
        node.set(
          PDFName.of('Dest'),
          ctx.obj([pageRef, PDFName.of('XYZ'), PDFNull, PDFNull, PDFNull]),
        );
      }
    }
    if (entry.children.length > 0) {
      const [first, last] = buildChain(entry.children, ref);
      node.set(PDFName.of('First'), first);
      node.set(PDFName.of('Last'), last);
      node.set(PDFName.of('Count'), PDFNumber.of(countOutline(entry.children)));
    }
    return ref;
  }

  const [first, last, total] = buildChain(clean, rootRef);
  root.set(PDFName.of('Type'), PDFName.of('Outlines'));
  root.set(PDFName.of('First'), first);
  root.set(PDFName.of('Last'), last);
  root.set(PDFName.of('Count'), PDFNumber.of(total));
  dstDoc.catalog.set(PDFName.of('Outlines'), rootRef);
}
