// Phase 88 (FEA-037) — main-process sanitize service.
//
// stripActiveContent mutates the working PDFDocument: it removes the selected
// active-content carriers from the catalog / page / annotation / form object
// graph and returns an honest per-class report plus a readable warning for
// every object it could not interpret. Detection reuses the validator's own
// predicates (collectJavaScript / collectExternalContent / EXTERNAL_ACTIONS in
// ./validation/pdfa) so the sanitizer and the PDF/A rule set never disagree.

import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  type PDFObject,
} from '@cantoo/pdf-lib';
import type {
  SanitizeClass,
  SanitizeFinding,
  SanitizeOptions,
  SanitizeReport,
} from '../../shared/sanitize';
import { summarizeSanitize } from '../../shared/sanitize';
import {
  EXTERNAL_ACTIONS,
  collectExternalContent,
  collectJavaScript,
} from './validation/pdfa';

type Ctx = PDFDocument['context'];

/** Resolve a possibly-indirect object to a PDFDict, else undefined. */
function resolveDict(ctx: Ctx, value: PDFObject | undefined): PDFDict | undefined {
  if (value === undefined) return undefined;
  const resolved = ctx.lookup(value);
  return resolved instanceof PDFDict ? resolved : undefined;
}

function nameString(value: PDFObject | undefined): string | null {
  return value instanceof PDFName ? value.decodeText() : null;
}

/**
 * Resolve a value to its name text through the document context, so an INDIRECT
 * `/S` reference (e.g. `/S 12 0 R`) is read as well as a direct PDFName.
 * Returns null when the value is absent or is neither a direct nor an indirect
 * PDFName (DEF-509); callers then report the action as unreadable (DEF-510).
 */
function resolvedNameString(ctx: Ctx, value: PDFObject | undefined): string | null {
  if (value === undefined) return null;
  const resolved = ctx.lookup(value);
  return resolved instanceof PDFName ? resolved.decodeText() : null;
}

/** Resolve an array entry-by-entry, tolerating indirect references. */
function resolveArray(ctx: Ctx, value: PDFObject | undefined): PDFObject[] {
  if (value === undefined) return [];
  const array = ctx.lookup(value);
  if (!(array instanceof PDFArray)) return [];
  const out: PDFObject[] = [];
  for (let i = 0; i < array.size(); i += 1) {
    const item = ctx.lookup(array.get(i));
    if (item !== undefined) out.push(item);
  }
  return out;
}

type AddFinding = (cls: SanitizeClass, where: string, detail: string) => void;

/**
 * Remove qualifying entries from a holder's `/AA` additional-actions dict.
 * `allowLaunch` gates the external-action removal: the brief scopes external
 * `/AA` removal to pages and annotations (catalog / AcroForm / field `/AA` is
 * JavaScript-only). An emptied `/AA` key is pruned. `apply` false makes this a
 * pure probe (DEF-511) that reports findings without mutating the document.
 */
function removeAdditionalActions(
  ctx: Ctx,
  holder: PDFDict,
  where: string,
  options: SanitizeOptions,
  allowLaunch: boolean,
  add: AddFinding,
  warnings: string[],
  apply: boolean,
): void {
  const raw = holder.get(PDFName.of('AA'));
  if (raw === undefined) return;
  const aa = resolveDict(ctx, raw);
  if (aa === undefined) {
    warnings.push(`${where} /AA is not a dictionary; additional actions could not be interpreted`);
    return;
  }
  for (const key of [...aa.keys()]) {
    const dict = resolveDict(ctx, aa.get(key));
    if (dict === undefined) {
      warnings.push(`${where} /AA ${key.decodeText()} is not an action dictionary; could not be interpreted`);
      continue;
    }
    const s = resolvedNameString(ctx, dict.get(PDFName.of('S')));
    if (s === null) {
      warnings.push(`${where} /AA ${key.decodeText()} has no readable /S action name; could not be interpreted`);
      continue;
    }
    if (options.javascript && s === 'JavaScript') {
      if (apply) aa.delete(key);
      add('javascript', `${where} /AA ${key.decodeText()}`, 'removed JavaScript additional action');
    } else if (allowLaunch && options.launchActions && EXTERNAL_ACTIONS.has(s)) {
      if (apply) aa.delete(key);
      add('launchActions', `${where} /AA ${key.decodeText()}`, `removed ${s} additional action`);
    }
  }
  if (apply && aa.keys().length === 0) holder.delete(PDFName.of('AA'));
}

/**
 * Strip every selected active-content class from `doc` in place. Each removed
 * item appends a `SanitizeFinding`; each object that cannot be interpreted
 * appends one readable `warnings` entry. The returned report is built by the
 * pure `summarizeSanitize` so counts and the selected list are identical to the
 * renderer's model. `apply` false (DEF-511) computes the same report/warnings
 * WITHOUT mutating `doc`, so the engine can tell a real removal from a no-op
 * before deciding whether to snapshot and mark the document modified.
 */
export function stripActiveContent(
  doc: PDFDocument,
  options: SanitizeOptions,
  apply = true,
): { report: SanitizeReport; warnings: string[] } {
  const findings: SanitizeFinding[] = [];
  const warnings: string[] = [];
  const catalog = doc.catalog;
  const ctx = doc.context;
  const add: AddFinding = (cls, where, detail) => {
    findings.push({ class: cls, where, detail });
  };

  // Validator predicates are reused as cross-checks (never forked): if one
  // detects a class we could not remove, the caller hears about it.
  let hadJs = false;
  let external = { externalActions: false, fileSpecs: false };
  try {
    hadJs = collectJavaScript(doc);
    external = collectExternalContent(doc);
  } catch (e) {
    warnings.push(`validator predicates failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // --- metadata: the catalog /Metadata XMP packet -------------------------
  if (options.metadata && catalog.has(PDFName.of('Metadata'))) {
    if (apply) catalog.delete(PDFName.of('Metadata'));
    add('metadata', 'catalog /Metadata', 'removed XMP metadata packet');
  }

  // --- the catalog /Names name trees --------------------------------------
  if (options.javascript || options.embeddedFiles) {
    const raw = catalog.get(PDFName.of('Names'));
    if (raw !== undefined) {
      const names = resolveDict(ctx, raw);
      if (names === undefined) {
        warnings.push(
          'catalog /Names is not a dictionary; the JavaScript and embedded-file name trees could not be read',
        );
      } else {
        if (options.javascript && names.has(PDFName.of('JavaScript'))) {
          if (apply) names.delete(PDFName.of('JavaScript'));
          add('javascript', 'catalog /Names /JavaScript', 'removed JavaScript name tree');
        }
        if (options.embeddedFiles && names.has(PDFName.of('EmbeddedFiles'))) {
          if (apply) names.delete(PDFName.of('EmbeddedFiles'));
          add('embeddedFiles', 'catalog /Names /EmbeddedFiles', 'removed embedded-files name tree');
        }
        if (apply && names.keys().length === 0) catalog.delete(PDFName.of('Names'));
      }
    }
  }
  // --- catalog /OpenAction ------------------------------------------------
  if (options.javascript || options.launchActions || options.embeddedFiles) {
    const raw = catalog.get(PDFName.of('OpenAction'));
    if (raw !== undefined) {
      const open = resolveDict(ctx, raw);
      if (open === undefined) {
        warnings.push('catalog /OpenAction is not an action dictionary; it could not be interpreted');
      } else {
        const s = resolvedNameString(ctx, open.get(PDFName.of('S')));
        let removed = false;
        if (s === null) {
          warnings.push('catalog /OpenAction has no readable /S action name; it could not be interpreted');
        } else if (options.javascript && s === 'JavaScript') {
          if (apply) catalog.delete(PDFName.of('OpenAction'));
          add('javascript', 'catalog /OpenAction', 'removed JavaScript open action');
          removed = true;
        } else if (options.launchActions && EXTERNAL_ACTIONS.has(s)) {
          if (apply) catalog.delete(PDFName.of('OpenAction'));
          add('launchActions', 'catalog /OpenAction', `removed ${s} open action`);
          removed = true;
        }
        if (!removed && s !== null && options.embeddedFiles && s === 'Launch' && open.has(PDFName.of('FS'))) {
          if (apply) open.delete(PDFName.of('FS'));
          add('embeddedFiles', 'catalog /OpenAction /FS', 'removed file specification from launch action');
        }
      }
    }
  }

  // --- catalog /AA (JavaScript only) --------------------------------------
  if (options.javascript) {
    removeAdditionalActions(ctx, catalog, 'catalog', options, false, add, warnings, apply);
  }

  // --- pages: /AA, annotations /A /AA /FS --------------------------------
  const pages = doc.getPages();
  for (let p = 0; p < pages.length; p += 1) {
    const node = pages[p].node;
    removeAdditionalActions(ctx, node, `page ${p + 1}`, options, true, add, warnings, apply);

    let annotArray: PDFArray | undefined;
    let annots: PDFObject[] = [];
    try {
      const resolved = ctx.lookup(node.Annots());
      if (resolved instanceof PDFArray) {
        annotArray = resolved;
        annots = resolveArray(ctx, resolved);
      }
    } catch (e) {
      warnings.push(
        `page ${p + 1} annotations could not be read: ${e instanceof Error ? e.message : String(e)}`,
      );
      continue;
    }
    const removeIndices: number[] = [];
    for (let i = 0; i < annots.length; i += 1) {
      const annot = resolveDict(ctx, annots[i]);
      const where = `page ${p + 1} annotation ${i + 1}`;
      if (annot === undefined) {
        warnings.push(`${where} is not a dictionary; could not be interpreted`);
        continue;
      }
      if (options.launchActions) {
        const aRaw = annot.get(PDFName.of('A'));
        if (aRaw !== undefined) {
          const aDict = resolveDict(ctx, aRaw);
          if (aDict === undefined) {
            warnings.push(`${where} /A is not an action dictionary; could not be interpreted`);
          } else {
            const s = resolvedNameString(ctx, aDict.get(PDFName.of('S')));
            if (s === null) {
              warnings.push(`${where} /A has no readable /S action name; could not be interpreted`);
            } else if (EXTERNAL_ACTIONS.has(s)) {
              if (apply) annot.delete(PDFName.of('A'));
              add('launchActions', `${where} /A`, `removed ${s} action`);
            }
          }
        }
      }
      removeAdditionalActions(ctx, annot, where, options, true, add, warnings, apply);
      if (options.embeddedFiles) {
        if (nameString(annot.get(PDFName.of('Subtype'))) === 'FileAttachment') {
          // A /FileAttachment annotation IS a file spec; drop the whole
          // annotation so the validator no longer reports an embedded file.
          removeIndices.push(i);
          add('embeddedFiles', `${where} /FileAttachment`, 'removed file-attachment annotation');
        } else if (annot.has(PDFName.of('FS'))) {
          if (apply) annot.delete(PDFName.of('FS'));
          add('embeddedFiles', `${where} /FS`, 'removed attached file specification');
        }
      }
    }
    if (apply && annotArray !== undefined) {
      for (let k = removeIndices.length - 1; k >= 0; k -= 1) {
        annotArray.remove(removeIndices[k]);
      }
    }
  }

  // --- AcroForm /AA and field /AA (JavaScript only) -----------------------
  if (options.javascript) {
    const acroRaw = catalog.get(PDFName.of('AcroForm'));
    if (acroRaw !== undefined) {
      const acro = resolveDict(ctx, acroRaw);
      if (acro === undefined) {
        warnings.push('catalog /AcroForm is not a dictionary; form field additional actions could not be read');
      } else {
        removeAdditionalActions(ctx, acro, 'AcroForm', options, false, add, warnings, apply);
        const fields = resolveArray(ctx, acro.get(PDFName.of('Fields')));
        for (let f = 0; f < fields.length; f += 1) {
          const field = resolveDict(ctx, fields[f]);
          if (field === undefined) {
            warnings.push(`AcroForm field ${f + 1} is not a dictionary; could not be interpreted`);
            continue;
          }
          removeAdditionalActions(ctx, field, `AcroForm field ${f + 1}`, options, false, add, warnings, apply);
        }
      }
    }
  }

  // Cross-checks: a predicate that detected a class we removed nothing for is
  // reported, never silently swallowed.
  const removedCount = (cls: SanitizeClass): number =>
    findings.reduce((n, finding) => (finding.class === cls ? n + 1 : n), 0);
  if (options.javascript && hadJs && removedCount('javascript') === 0) {
    warnings.push('collectJavaScript detected JavaScript but no removable JavaScript carrier was found');
  }
  if (options.launchActions && external.externalActions && removedCount('launchActions') === 0) {
    warnings.push('collectExternalContent detected an external action but no removable carrier was found');
  }
  if (options.embeddedFiles && external.fileSpecs && removedCount('embeddedFiles') === 0) {
    warnings.push('collectExternalContent detected an embedded file but no removable carrier was found');
  }

  return { report: summarizeSanitize(findings, options), warnings };
}
