// Phase 88 (FEA-037) — pure sanitize class/option/report model.
//
// No fs, no Electron, no DOM, no pdf-lib: this module is the single source of
// truth for the four removable active-content classes, the option model and the
// per-class report maths. The main-process service and the renderer dialog both
// consume it, so the report is identical on either side of the IPC boundary.

/** The classes of active content the sanitizer can strip. */
export type SanitizeClass = 'javascript' | 'launchActions' | 'embeddedFiles' | 'metadata';

/** Ordered class list; the report's `selected` list follows this order. */
export const SANITIZE_CLASSES: readonly SanitizeClass[] = [
  'javascript',
  'launchActions',
  'embeddedFiles',
  'metadata',
];

/** Which classes the caller has selected. All four default to true (safe). */
export interface SanitizeOptions {
  javascript: boolean;
  launchActions: boolean;
  embeddedFiles: boolean;
  metadata: boolean;
}

/** The safe default: strip every class. */
export const DEFAULT_SANITIZE_OPTIONS: SanitizeOptions = {
  javascript: true,
  launchActions: true,
  embeddedFiles: true,
  metadata: true,
};

/**
 * Preserve-if-valid per key: a present boolean key is kept; a missing,
 * non-boolean or otherwise invalid key resolves to its default (true).
 */
export function normalizeSanitizeOptions(raw: unknown): SanitizeOptions {
  const out: SanitizeOptions = { ...DEFAULT_SANITIZE_OPTIONS };
  if (raw !== null && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>;
    for (const key of SANITIZE_CLASSES) {
      if (typeof obj[key] === 'boolean') out[key] = obj[key];
    }
  }
  return out;
}

/** One removed item: which class, a readable location, and a readable detail. */
export interface SanitizeFinding {
  class: SanitizeClass;
  where: string;
  detail: string;
}

/** The honest per-class report: what was selected, removed and never removed. */
export interface SanitizeReport {
  selected: SanitizeClass[];
  removedByClass: Record<SanitizeClass, number>;
  findings: SanitizeFinding[];
}

/**
 * Build the report from the removal findings and the caller's options.
 * `selected` is the true keys in `SANITIZE_CLASSES` order; `removedByClass`
 * counts findings per class (0 when none) and always carries all four keys;
 * `findings` is a copy of the input in its original order.
 */
export function summarizeSanitize(
  findings: readonly SanitizeFinding[],
  options: SanitizeOptions,
): SanitizeReport {
  const selected = SANITIZE_CLASSES.filter((cls) => options[cls]);
  const removedByClass: Record<SanitizeClass, number> = {
    javascript: 0,
    launchActions: 0,
    embeddedFiles: 0,
    metadata: 0,
  };
  for (const finding of findings) {
    removedByClass[finding.class] += 1;
  }
  return { selected, removedByClass, findings: [...findings] };
}
