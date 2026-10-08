// Phase 115 - Guided Fill shared field primitives.
//
// The one rendering + validation surface the Guided Fill panel builds on in the
// next chunk: a single field row (label, caller-supplied control, required
// marker, guidance, error), a required-field summary, and the PURE value
// validator. This module owns no panel, no dialog and no command wiring.
//
// Truthfulness guardrails:
//   - the required marker renders ONLY when `field.required === true`;
//   - `validateFieldValue` knows exactly one rule (required + empty) because
//     that is the only constraint the FormField contract carries today;
//   - label, guidance and error are associated with the control through
//     `htmlFor` + `aria-describedby`/`aria-invalid`, never colour alone.

import { AlertCircle } from "lucide-react";
import {
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import type { FormField } from "../../shared/types";
import { Icon } from "../icons/Icon";
import { fieldHasValue } from "./model";

/** Wire association attributes onto a caller-supplied control element. When the
 *  control is not a single element (e.g. a string), it is returned untouched. */
function associateControl(
  control: ReactNode,
  attrs: Record<string, unknown>,
): ReactNode {
  if (!isValidElement(control) || Object.keys(attrs).length === 0) return control;
  return cloneElement(
    control as ReactElement<Record<string, unknown>>,
    attrs,
  );
}

export interface FieldRowProps {
  /** The field this row edits. Its `name` is the label; `required` is the only
   *  rule the row asserts. */
  field: FormField;
  /** The DOM id the label points at; also the basis for the guidance/error ids. */
  controlId: string;
  /** The caller's value control (input / select / custom toggle). */
  control: ReactNode;
  /** Optional 12px helper text, wired into `aria-describedby`. */
  guidance?: string;
  /** Optional error text; when set, an error node is rendered and described. */
  error?: string | null;
  /** Override the derived `aria-describedby` string. */
  describedBy?: string;
  /** Override the derived error element id (`${controlId}-error`). */
  errorId?: string;
  /** Phase 115 E - when true the row carries `data-form-active="true"` so the
   *  host can highlight the row linked to the canvas-focused field. Highlight
   *  only: the row never moves focus itself. */
  active?: boolean;
  /** Phase 115 E - delegated focus hook. Fires when a control inside the row
   *  gains focus; the row reports it upward and never calls `.focus()`. */
  onFocusCapture?: (() => void) | undefined;
}

/** One field's row: 13px label, the caller's control slot, a required marker
 *  rendered only for a required field, optional guidance and an error node. */
export function FieldRow(props: FieldRowProps): ReactElement {
  const { field, controlId, control, guidance, error } = props;
  const required = field.required === true;
  const hasError = error !== undefined && error !== null && error !== "";

  const guidanceId = `${controlId}-guidance`;
  const resolvedErrorId = props.errorId ?? `${controlId}-error`;

  const describedParts: string[] = [];
  if (guidance !== undefined) describedParts.push(guidanceId);
  if (hasError) describedParts.push(resolvedErrorId);
  const describedBy =
    props.describedBy ??
    (describedParts.length > 0 ? describedParts.join(" ") : undefined);

  const attrs: Record<string, unknown> = {};
  const controlProps = isValidElement(control)
    ? (control.props as Record<string, unknown>)
    : undefined;
  if (controlProps?.id === undefined) attrs.id = controlId;
  if (describedBy !== undefined) attrs["aria-describedby"] = describedBy;
  if (required) attrs["aria-required"] = true;
  if (hasError) attrs["aria-invalid"] = true;

  const associatedControl = associateControl(control, attrs);

  return (
    <div
      className="guided-fill-row"
      data-form-field={field.id}
      data-form-active={props.active === true ? "true" : undefined}
      onFocusCapture={props.onFocusCapture}
    >
      <div className="guided-fill-row-head">
        <label className="guided-fill-label" htmlFor={controlId}>
          {field.name}
          {required ? (
            <span
              className="guided-fill-required"
              data-form-required="true"
              aria-hidden="true"
            >
              *
            </span>
          ) : null}
        </label>
      </div>
      <div className="guided-fill-control">{associatedControl}</div>
      {guidance !== undefined ? (
        <p className="guided-fill-guidance" id={guidanceId}>
          {guidance}
        </p>
      ) : null}
      {hasError ? (
        <p className="guided-fill-error" id={resolvedErrorId} data-form-error>
          <Icon icon={AlertCircle} size="xs" className="guided-fill-error-icon" />
          <span className="guided-fill-error-text">{error}</span>
        </p>
      ) : null}
    </div>
  );
}

export interface RequiredSummaryProps {
  /** The document's fields. Totals count only fields with `required === true`. */
  fields: readonly FormField[];
  /** When set, the page-scoped total is shown as a second labelled figure. */
  page?: number;
}

/** A small summary of required-field state. The DOCUMENT total and, when a page
 *  is given, the PAGE total are rendered as two separate labelled figures and
 *  are never merged into one count. */
export function RequiredSummary(props: RequiredSummaryProps): ReactElement {
  const { fields, page } = props;
  const requiredFields = fields.filter((f) => f.required === true);
  const documentCompleted = requiredFields.filter((f) => fieldHasValue(f)).length;

  const pageRequired =
    page === undefined ? [] : requiredFields.filter((f) => f.page === page);
  const pageCompleted = pageRequired.filter((f) => fieldHasValue(f)).length;

  return (
    <div className="guided-fill-summary" data-form-required-summary>
      <span className="guided-fill-summary-item" data-form-required-scope="document">
        <span className="guided-fill-summary-label">Document</span>
        <span
          className="guided-fill-summary-figure"
          data-form-required-completed={documentCompleted}
          data-form-required-total={requiredFields.length}
        >
          {documentCompleted} of {requiredFields.length}
        </span>
      </span>
      {page !== undefined ? (
        <span className="guided-fill-summary-item" data-form-required-scope="page">
          <span className="guided-fill-summary-label">{`Page ${page}`}</span>
          <span
            className="guided-fill-summary-figure"
            data-form-required-completed={pageCompleted}
            data-form-required-total={pageRequired.length}
          >
            {pageCompleted} of {pageRequired.length}
          </span>
        </span>
      ) : null}
    </div>
  );
}

export interface FieldValidation {
  valid: boolean;
  message: string | null;
}

/** The PURE value validator. The only constraint the FormField contract carries
 *  today is `required` (the /Ff Required flag) plus emptiness, so that is the
 *  only rule asserted here - never a fabricated maxLength / format / range. */
export function validateFieldValue(field: FormField): FieldValidation {
  if (field.required === true && !fieldHasValue(field)) {
    return { valid: false, message: "This field is required." };
  }
  return { valid: true, message: null };
}
