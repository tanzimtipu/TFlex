// Forms state model + reducer.
//
// The renderer keeps a per-tab copy of the active document's form fields so
// the form editors can read local state for instant typing feedback while
// the actual `fillFormField` engine call is debounced (500ms per field for
// text, immediate for choice fields). This mirrors the Phase 3 annotation
// pattern: the local state is the source of truth for the UI; the engine
// call syncs back into a fresh server state and re-seeds the local copy.
//
// Coordinate space: field rects are in PAGE POINTS with a TOP-LEFT origin
// (matching the rest of the renderer).

import type {
  FormField,
  FormFieldKind,
  FormFillReport,
  FormFillStatus,
} from "../../shared/types";

// ---------------------------------------------------------------------------
// Pure reducer helpers (DOM-free, unit-testable)

export interface FormsState {
  /** Stable field list returned by `engine.getFormFields`. The reducer
   *  replaces this wholesale when the engine returns a fresh list. */
  fields: FormField[];
  /** True once the engine has populated the list. The UI shows a "loading"
   *  placeholder until this flips; on a document with no form fields it
   *  is still true with an empty list (so the indicator doesn't sit on
   *  "loading" forever for non-form PDFs). */
  loaded: boolean;
  /** Phase 59 item 4 — the per-field outcome of the most recent native
   *  fill/save, mirrored from `EngineState.formFillReport`. Absent until a
   *  fill/save has produced a report. Content-compared (not identity) so a
   *  same-shape engine echo never churns the per-tab state (DEF-020). */
  report?: FormFillReport[];
}

export const initialFormsState: FormsState = {
  fields: [],
  loaded: false,
};

/** Update a single field's value, return a new state. The lookup is by
 *  field id (stable across the document's lifetime). Unknown ids return
 *  the state unchanged — defensive against a race between tab switch and
 *  an in-flight edit. */
export function setFieldValue(
  state: FormsState,
  id: string,
  value: string | string[],
): FormsState {
  let changed = false;
  const next = state.fields.map((f) => {
    if (f.id !== id) return f;
    if (sameValue(f.value, value)) return f;
    changed = true;
    return { ...f, value };
  });
  return changed ? { ...state, fields: next } : state;
}

/** Multi-select listbox toggle: if `value` is in the current selection,
 *  remove it; otherwise add it. Returns the same state object when the
 *  resulting selection matches the existing one. */
export function toggleListboxValue(
  state: FormsState,
  id: string,
  value: string,
): FormsState {
  let changed = false;
  const next = state.fields.map((f) => {
    if (f.id !== id || f.kind !== "listbox") return f;
    const current = Array.isArray(f.value) ? f.value : [];
    const idx = current.indexOf(value);
    let selection: string[];
    if (idx === -1) {
      selection = [...current, value];
    } else {
      selection = current.filter((_, i) => i !== idx);
    }
    if (sameValue(selection, current)) return f;
    changed = true;
    return { ...f, value: selection };
  });
  return changed ? { ...state, fields: next } : state;
}

/** Cheap content-equality check for two field lists. The engine echo
 *  builds a fresh `FormField[]` array on every `getState` call (different
 *  object identity each time even when the document state is unchanged),
 *  so a naive `===` or `length` check always looks like a churn and
 *  re-triggers the per-tab mirror useEffect in App.tsx. The mirror effect
 *  uses this gate to decide whether `replaceFields` actually needs to
 *  run; without it, a same-shape echo schedules a fresh `openTabs` on
 *  every engine round-trip, which after a `flattenForms` round-trip
 *  trips React-19's max-update-depth guard inside the tflexDiagnostics-
 *  driven useEffects (DEF-020).
 *
 *  Matches by id (since the engine and the local state both key fields
 *  by id, not position — `replaceFields` merges by id for the same
 *  reason). If ids + values + pages are equal, the reducer would have
 *  returned the same `FormsState` reference anyway, so calling this
 *  first lets the mirror effect skip the reducer call (and the new
 *  outer `OpenTab` object) entirely. */
export function sameFormFields(
  a: readonly FormField[],
  b: readonly FormField[],
): boolean {
  if (a.length !== b.length) return false;
  // Build an id -> index map on the side we expect the engine to mirror.
  // The engine's echo preserves the field order it returned from
  // `getFormFields`, so a positional comparison would normally be enough
  // — but the renderer's optimistic `setFieldValue` never reorders the
  // list, and matching by id avoids a false-positive churn if the
  // backend ever swaps ordering.
  const aMap = new Map<string, FormField>();
  for (const f of a) aMap.set(f.id, f);
  for (const f of b) {
    const x = aMap.get(f.id);
    if (x === undefined) return false;
    if (x.page !== f.page) return false;
    if (!sameValue(x.value, f.value)) return false;
  }
  return true;
}

/** Replace the entire field list (e.g. on engine round-trip after a
 *  fillFormField). When a fresh field list comes back, the local edits
 *  that match the new list survive; any field ids that disappeared are
 *  dropped. The reducer never invents fields, so a stale local state
 *  cannot resurrect fields the engine no longer knows about.
 *
 *  Returns the SAME state reference when nothing actually changed so
 *  the round-trip effect in App.tsx doesn't keep re-firing on every
 *  engine-state echo (each echo would otherwise produce a fresh
 *  `FormsState` object, even when the field values are identical,
 *  and React would schedule another effect that echoes the same
 *  data back — see "Maximum update depth exceeded" in the renderer
 *  after the first flattenForms round-trip, DEF-020). */
export function replaceFields(
  state: FormsState,
  fields: readonly FormField[],
): FormsState {
  const map = new Map<string, FormField>();
  for (const f of state.fields) map.set(f.id, f);
  let changed = fields.length !== state.fields.length;
  const merged: FormField[] = fields.map((f) => {
    const existing = map.get(f.id);
    if (existing === undefined) {
      changed = true;
      return f;
    }
    if (sameValue(existing.value, f.value)) {
      return f;
    }
    changed = true;
    return existing;
  });
  return changed ? { fields: merged, loaded: true, report: state.report } : state;
}

/** Compare two field values for equality (string or string[]). */
function sameValue(a: string | string[], b: string | string[]): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    // Order-stable comparison for multi-select.
    for (let i = 0; i < a.length; i += 1) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
  if (Array.isArray(a) || Array.isArray(b)) return false;
  return a === b;
}

// ---------------------------------------------------------------------------
// Grouping helpers

/** Group fields by 1-based page number. Pages with no fields are omitted
 *  from the result — the caller renders only the keys it sees. */
export function fieldsByPage(
  fields: readonly FormField[],
): Map<number, FormField[]> {
  const map = new Map<number, FormField[]>();
  for (const f of fields) {
    const list = map.get(f.page);
    if (list === undefined) {
      map.set(f.page, [f]);
    } else {
      list.push(f);
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Display helpers

/** Human label for a field kind (used in the fields panel + a11y labels). */
export function fieldKindLabel(kind: FormFieldKind): string {
  switch (kind) {
    case "text":
      return "Text";
    case "checkbox":
      return "Checkbox";
    case "radio":
      return "Radio";
    case "dropdown":
      return "Dropdown";
    case "listbox":
      return "List";
  }
}

// ---------------------------------------------------------------------------
// Phase 59 (ADV-123 / ADV-124) — field fillability
//
// The renderer must never mount an editable control for a field it cannot
// write. The backend exposes unfillable kinds (a digital-signature `/Sig`
// field, a page `/Widget` orphaned from the AcroForm `/Fields` tree); a fill
// against them silently no-ops, so the control would be an actionable-looking
// lie. `isFillableFieldKind` is an ALLOW-list: only the kinds the engine can
// actually write get an editor, so any kind the backend introduces later
// (signature, orphan, xfa, ...) falls through to the non-editable path by
// default instead of regressing into an input.

/** The field kinds the renderer can fill. */
const FILLABLE_FIELD_KINDS: ReadonlySet<string> = new Set([
  "text",
  "checkbox",
  "radio",
  "dropdown",
  "listbox",
]);

/** True when the kind maps to a control that can actually write a value.
 *  Compared against a widened string so a new/unlisted kind is non-fillable
 *  without a type change here. */
export function isFillableFieldKind(kind: string): boolean {
  return FILLABLE_FIELD_KINDS.has(kind);
}

/** The truthful, plain-language reason a non-fillable kind cannot be filled. */
export function nonFillableFieldReason(kind: string): string {
  switch (kind) {
    case "signature":
      return "Signature fields cannot be filled";
    case "orphan":
      return "Orphan widgets cannot be filled";
    default:
      return "This field cannot be filled";
  }
}

/** Whether a field has any user-visible value. The renderer uses this for
 *  the "filled" indicator and to decide whether a flattened PDF still
 *  shows a placeholder dot. */
export function fieldHasValue(f: FormField): boolean {
  if (Array.isArray(f.value)) return f.value.length > 0;
  return f.value.length > 0;
}

// ---------------------------------------------------------------------------
// Phase 59 item 4 — native-fill report helpers

/** Store a fresh `formFillReport` on the forms state. Returns the same state
 *  reference when the incoming report is content-equal to the current one so
 *  a same-shape engine echo never churns `openTabs` (DEF-020). */
export function setFormFillReport(
  state: FormsState,
  report: FormFillReport[] | undefined,
): FormsState {
  if (report === undefined) return state;
  if (sameFillReport(state.report, report)) return state;
  return { ...state, report };
}

/** Content-equality check for two fill reports. The engine rebuilds the
 *  report array on every `getState` (fresh identity, same content when
 *  nothing changed), so callers must compare by content — exactly the
 *  `sameFormFields` rationale (DEF-020). */
export function sameFillReport(
  a: readonly FormFillReport[] | undefined,
  b: readonly FormFillReport[] | undefined,
): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    if (
      x.name !== y.name ||
      x.page !== y.page ||
      x.kind !== y.kind ||
      x.status !== y.status ||
      x.detail !== y.detail
    ) {
      return false;
    }
  }
  return true;
}

/** Human reason for a non-`filled` report row. `fill` rows read "filled";
 *  every skip status maps to the plain-language reason the summary shows.
 *  `detail` (when the engine provides one) is appended by the UI. */
export function reportStatusReason(status: FormFillStatus): string {
  switch (status) {
    case "filled":
      return "filled";
    case "skipped-readonly":
      return "read-only";
    case "skipped-signature":
      return "signature";
    case "font-unavailable":
      return "font does not support the text";
    case "option-unknown":
      return "option not available";
    case "xfa":
      return "XFA";
    case "orphan-unfilled":
      return "orphan widget";
  }
}