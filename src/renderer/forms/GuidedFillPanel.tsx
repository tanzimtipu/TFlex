// Phase 115 - the Guided Fill panel.
//
// A page-scoped form-fill surface built ONLY from the chunk-C primitives
// (FieldRow, RequiredSummary, validateFieldValue) and the shared
// FormFieldControl. It owns no forms store: it reads `fields` from props and
// reports edits through the same (id, value) / (id, option) callbacks the
// canvas overlay uses. Mounting it and wiring the `forms` command is the next
// chunk (D2); this module only declares its prop types.

import { useCallback, useMemo, useState, type KeyboardEvent, type ReactElement } from "react";
import { Button } from "../components/Button";
import type { FormField } from "../../shared/types";
import { isFillableFieldKind, nonFillableFieldReason } from "./model";
import { FieldRow, RequiredSummary, validateFieldValue } from "./GuidedFillPrimitives";
import { FormFieldControl } from "./FormFieldControl";
import { FieldProperties } from "./FieldProperties";

export interface GuidedFillPanelProps {
  fields: readonly FormField[];
  currentPage: number;
  totalPages: number;
  onValueChange: (id: string, value: string | string[]) => void;
  onToggleListbox: (id: string, option: string) => void;
  onClose: () => void;
  /** Phase 115 E - the field whose canvas control is focused, mirrored as a
   *  highlight on the matching row. `null` means no linked field. */
  focusedFieldId?: string | null;
  /** Phase 115 E - reports that a row control gained focus. The panel only
   *  records the id; it never moves DOM focus. */
  onFieldFocus?: (id: string) => void;
}

/** The stable DOM id of a field's control; also the focus target Validate uses. */
function controlId(field: FormField): string {
  return `guided-fill-${field.id}-control`;
}

function panelControlClass(field: FormField): string {
  switch (field.kind) {
    case "text":
      return field.rect.height >= 24 ? "guided-fill-textarea" : "guided-fill-input";
    case "checkbox":
      return "guided-fill-checkbox";
    case "radio":
      return "guided-fill-radio-group";
    case "dropdown":
      return "guided-fill-select";
    case "listbox":
      return "guided-fill-listbox";
  }
}

export function GuidedFillPanel(props: GuidedFillPanelProps): ReactElement {
  const {
    fields,
    currentPage,
    totalPages,
    onValueChange,
    onToggleListbox,
    onClose,
    focusedFieldId = null,
    onFieldFocus,
  } = props;
  const [errors, setErrors] = useState<Record<string, string>>({});

  const pageFields = useMemo(
    () => fields.filter((field) => field.page === currentPage),
    [fields, currentPage],
  );

  const focusedField = fields.find((f) => f.id === focusedFieldId) ?? null;

  const clearError = useCallback((id: string): void => {
    setErrors((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }, []);

  const handleValueChange = useCallback(
    (id: string, value: string | string[]): void => {
      clearError(id);
      onValueChange(id, value);
    },
    [clearError, onValueChange],
  );

  const handleToggleListbox = useCallback(
    (id: string, option: string): void => {
      clearError(id);
      onToggleListbox(id, option);
    },
    [clearError, onToggleListbox],
  );

  // Validate runs only on an explicit action; before it, no error node exists
  // and no focus moves.
  const handleValidate = useCallback((): void => {
    const next: Record<string, string> = {};
    let firstInvalid: string | null = null;
    for (const field of pageFields) {
      // A non-fillable kind has no editable control, so required-emptiness is
      // not a constraint the user can satisfy; it is never validated.
      if (!isFillableFieldKind(field.kind)) continue;
      const result = validateFieldValue(field);
      if (!result.valid && result.message !== null) {
        next[field.id] = result.message;
        if (firstInvalid === null) firstInvalid = controlId(field);
      }
    }
    setErrors(next);
    if (firstInvalid !== null) {
      document.getElementById(firstInvalid)?.focus();
    }
  }, [pageFields]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>): void => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onClose();
      }
    },
    [onClose],
  );

  return (
    <div
      className="guided-fill-surface guided-fill-panel"
      data-form-panel="true"
      onKeyDown={handleKeyDown}
    >
      <div className="guided-fill-panel-head">
        <div className="guided-fill-panel-scope" data-form-scope="true">
          <span className="guided-fill-panel-scope-figure" data-form-scope-figure="document">
            Document
          </span>
          <span
            className="guided-fill-panel-scope-figure"
            data-form-scope-figure="page"
            data-form-scope-page="true"
          >
            {`Page ${currentPage} of ${totalPages}`}
          </span>
        </div>
      </div>
      <div className="guided-fill-panel-summary">
        <RequiredSummary fields={fields} page={currentPage} />
      </div>
      <div className="guided-fill-panel-fields">
        {pageFields.map((field) => {
          const id = controlId(field);
          if (!isFillableFieldKind(field.kind)) {
            const reason = nonFillableFieldReason(field.kind);
            return (
              <FieldRow
                key={field.id}
                field={field}
                controlId={id}
                active={field.id === focusedFieldId}
                onFocusCapture={
                  onFieldFocus === undefined ? undefined : (): void => onFieldFocus(field.id)
                }
                control={
                  <span
                    className="guided-fill-nonfillable"
                    data-form-nonfillable="true"
                    title={reason}
                  >
                    {reason}
                  </span>
                }
              />
            );
          }
          return (
            <FieldRow
              key={field.id}
              field={field}
              controlId={id}
              active={field.id === focusedFieldId}
              onFocusCapture={
                onFieldFocus === undefined ? undefined : (): void => onFieldFocus(field.id)
              }
              error={errors[field.id] ?? null}
              control={
                <FormFieldControl
                  field={field}
                  id={id}
                  className={panelControlClass(field)}
                  onChange={handleValueChange}
                  onToggleListbox={handleToggleListbox}
                />
              }
            />
          );
        })}
      </div>
      <div className="guided-fill-panel-actions">
        <Button data-form-validate="true" intent="primary" onClick={handleValidate}>
          Validate
        </Button>
      </div>
      <section className="guided-fill-panel-properties" data-form-properties-section>
        <h3 className="guided-fill-panel-properties-heading">Field properties</h3>
        <FieldProperties field={focusedField} />
      </section>
    </div>
  );
}
