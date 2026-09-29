import type {
  ValidationTarget,
  ValidationViolation,
} from '../../../shared/validation';
import {
  VALIDATION_CONTENT_SCAN_BYTES,
  type DocumentFacts,
} from './pdfa';

/**
 * Phase 54 feature E — the PDF/X rule set.
 *
 * A documented, bounded rule set; not a colour-managed preflight and not a
 * certification. All three profiles require an OutputIntent with an embedded
 * ICC destination profile and embedded fonts.
 *
 * Relaxations encoded here and stated in the rule `detail`:
 *  - PDF/X-1a forbids device-RGB operators; PDF/X-3 and PDF/X-4 permit them.
 *  - PDF/X-1a and PDF/X-3 forbid transparency; PDF/X-4 permits it.
 *
 * No colour-space conversion is ever performed. An untagged device-RGB
 * document is refused (reported) rather than silently converted to CMYK.
 */

export function evaluatePdfX(
  target: ValidationTarget,
  facts: DocumentFacts,
): ValidationViolation[] {
  const out: ValidationViolation[] = [];

  if (facts.outputIntent.undetermined) {
    // DEF-383 — a wrong-typed /OutputIntents is undetermined, not a hard error.
    out.push({
      rule: 'pdfx.output-intent',
      detail:
        'The /OutputIntents entry could not be determined: it is not an array of output-intent dictionaries (it is missing, null or the wrong type).',
      severity: 'warning',
    });
  } else if (!facts.outputIntent.present) {
    out.push({
      rule: 'pdfx.output-intent',
      detail:
        'No /OutputIntents entry: PDF/X-1a, X-3 and X-4 all require an OutputIntent with an embedded ICC destination profile.',
      severity: 'error',
    });
  } else if (!facts.outputIntent.hasEmbeddedProfile) {
    out.push({
      rule: 'pdfx.output-intent',
      detail:
        'An /OutputIntents entry exists but carries no embedded ICC destination profile (/DestOutputProfile).',
      severity: 'error',
    });
  }

  if (facts.fontEmbedding.nonEmbedded > 0) {
    out.push({
      rule: 'pdfx.font-embedding',
      detail: `${facts.fontEmbedding.nonEmbedded} of ${facts.fontEmbedding.total} font(s) have no embedded FontFile/FontFile2/FontFile3 descriptor.`,
      severity: 'error',
    });
  }
  if (facts.fontEmbedding.undeterminedPages.length > 0) {
    out.push({
      rule: 'pdfx.font-embedding',
      detail: `Font embedding could not be determined for page(s) ${facts.fontEmbedding.undeterminedPages.join(', ')} (no readable resources).`,
      severity: 'warning',
    });
  }

  if (target === 'pdfx-1a') {
    if (facts.deviceRgbPages.length > 0) {
      out.push({
        rule: 'pdfx.device-rgb',
        detail: `Device-RGB operators (rg/RG) found on page(s) ${facts.deviceRgbPages.join(', ')}; PDF/X-1a is CMYK-only. This is a documented heuristic device-space scan of the content streams, not a colour-managed analysis. No colour conversion was performed.`,
        severity: 'error',
      });
    }
    if (facts.undeterminedDeviceRgbPages.length > 0) {
      out.push({
        rule: 'pdfx.device-rgb',
        detail: `The device-RGB scan could not be determined for page(s) ${facts.undeterminedDeviceRgbPages.join(', ')} (undecodable content stream).`,
        severity: 'warning',
      });
    }
    if (facts.oversizedDeviceRgbPages.length > 0) {
      out.push({
        rule: 'pdfx.device-rgb',
        detail: `The device-RGB scan could not be determined for page(s) ${facts.oversizedDeviceRgbPages.join(', ')}: the decoded content exceeds the documented ${Math.round(VALIDATION_CONTENT_SCAN_BYTES / (1024 * 1024))} MiB per-page scan cap.`,
        severity: 'warning',
      });
    }
    if (facts.deviceRgbScanTimedOut) {
      out.push({
        rule: 'pdfx.device-rgb',
        detail:
          'The device-RGB scan could not be determined within the documented time budget; the scan is incomplete and the result is not a pass.',
        severity: 'warning',
      });
    }
  }

  if (target === 'pdfx-1a' || target === 'pdfx-3') {
    const pages = [...new Set([...facts.transparency.groups, ...facts.transparency.smasks])].sort(
      (a, b) => a - b,
    );
    if (pages.length > 0) {
      out.push({
        rule: 'pdfx.transparency',
        detail: `Transparency is forbidden for PDF/X-${target === 'pdfx-1a' ? '1a' : '3'} (pages ${pages.join(', ')}); PDF/X-4 permits it.`,
        severity: 'error',
      });
    }
    if (facts.transparency.undeterminedPages.length > 0) {
      out.push({
        rule: 'pdfx.transparency',
        detail: `Transparency could not be determined for page(s) ${facts.transparency.undeterminedPages.join(', ')} (no readable resources).`,
        severity: 'warning',
      });
    }
  }

  return out;
}
