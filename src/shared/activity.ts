// Phase 1216 chunk C6 — shared Activity operation-capability + progress
// truthfulness contract. This is the single shared source of that truth; the
// renderer still owns its own copy today and a later frontend chunk migrates it.

/** The four Activity operation kinds. */
export type ActivityOperationKind = 'ocr' | 'convert' | 'search-index' | 'update';

/** Completion actions, exactly these four. An operation offers only the actions
 *  it explicitly declares. */
export type ActivityCompletionAction =
  | 'open-result'
  | 'show-in-folder'
  | 'view-details'
  | 'undo';

/** The declared capability of one Activity operation kind. */
export interface ActivityOperationCapability {
  readonly kind: ActivityOperationKind;
  readonly cancelable: boolean;
  readonly completionActions: readonly ActivityCompletionAction[];
}

/**
 * The declared capability truth per operation kind. `search-index` has NO
 * engine completion event and NO cancel channel; `update` download/install are
 * pre-completion decisions, not shelf completion actions, so it declares none.
 */
export const ACTIVITY_OPERATION_CAPABILITIES: Record<
  ActivityOperationKind,
  ActivityOperationCapability
> = {
  ocr: { kind: 'ocr', cancelable: true, completionActions: ['view-details'] },
  convert: {
    kind: 'convert',
    cancelable: true,
    completionActions: ['open-result', 'view-details'],
  },
  'search-index': {
    kind: 'search-index',
    cancelable: false,
    completionActions: [],
  },
  update: { kind: 'update', cancelable: false, completionActions: [] },
};

/** Truthful progress. Determinate carries a real total; indeterminate carries
 *  only phase text. Never a percentage or an ETA. */
export type TruthfulProgress =
  | {
      readonly kind: 'determinate';
      readonly done: number;
      readonly total: number;
      readonly unit: string;
    }
  | { readonly kind: 'indeterminate'; readonly phaseText: string };

/**
 * Build truthful progress. Determinate ONLY when `total` is a finite number
 * strictly greater than 0; `done` is clamped into [0, total] and a non-finite
 * `done` becomes 0. Otherwise indeterminate with `phaseText ?? 'Working'`.
 * Never produces a percentage or an ETA. Mirrors the renderer `makeProgress`.
 */
export function toTruthfulProgress(input: {
  done?: number;
  total?: number;
  unit?: string;
  phaseText?: string;
}): TruthfulProgress {
  const { done = 0, total, unit = 'items', phaseText } = input;
  if (typeof total === 'number' && Number.isFinite(total) && total > 0) {
    const safeDone = Number.isFinite(done)
      ? Math.max(0, Math.min(done, total))
      : 0;
    return { kind: 'determinate', done: safeDone, total, unit };
  }
  return { kind: 'indeterminate', phaseText: phaseText ?? 'Working' };
}

/** Return the capability entry for an operation kind. */
export function capabilityFor(
  kind: ActivityOperationKind,
): ActivityOperationCapability {
  return ACTIVITY_OPERATION_CAPABILITIES[kind];
}
