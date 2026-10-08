// Phase 115 F - Edit / Field properties surface.
//
// A read-only inspector of the focused field's REAL metadata. The engine
// exposes no API to rename, retype or mutate a field's flags, so this surface
// renders only what the document actually declares and states plainly that
// editing is unsupported. It contains no editable control and dispatches
// nothing: it is a truthful view, not an editor.

import type { ReactElement } from "react";
import type { FormField } from "../../shared/types";
import { fieldKindLabel } from "./model";

export interface FieldPropertiesProps {
  /** The field whose metadata is shown; `null` renders the empty state. */
  field: FormField | null;
}

/** The field kinds whose declared options are worth listing. */
const OPTION_KINDS: ReadonlySet<string> = new Set([
  "radio",
  "dropdown",
  "listbox",
]);

export function FieldProperties(props: FieldPropertiesProps): ReactElement {
  const { field } = props;

  if (field === null) {
    return (
      <div className="guided-fill-properties-empty" data-form-properties-empty>
        Select a field to see its properties.
      </div>
    );
  }

  const hasOptions =
    OPTION_KINDS.has(field.kind) &&
    field.options !== undefined &&
    field.options.length > 0;

  return (
    <div className="guided-fill-properties" data-form-properties>
      <dl className="guided-fill-properties-list">
        <div className="guided-fill-properties-row" data-form-property="name">
          <dt className="guided-fill-properties-term">Name</dt>
          <dd className="guided-fill-properties-value">{field.name}</dd>
        </div>
        <div className="guided-fill-properties-row" data-form-property="type">
          <dt className="guided-fill-properties-term">Type</dt>
          <dd className="guided-fill-properties-value">
            {fieldKindLabel(field.kind)}
          </dd>
        </div>
        <div className="guided-fill-properties-row" data-form-property="required">
          <dt className="guided-fill-properties-term">Required</dt>
          <dd className="guided-fill-properties-value">
            {field.required === true ? "Yes" : "No"}
          </dd>
        </div>
        <div className="guided-fill-properties-row" data-form-property="read-only">
          <dt className="guided-fill-properties-term">Read-only</dt>
          <dd className="guided-fill-properties-value">
            {field.readOnly === true ? "Yes" : "No"}
          </dd>
        </div>
        {typeof field.tooltip === "string" && field.tooltip.length > 0 ? (
          <div className="guided-fill-properties-row" data-form-property="tooltip">
            <dt className="guided-fill-properties-term">Tooltip</dt>
            <dd className="guided-fill-properties-value">{field.tooltip}</dd>
          </div>
        ) : null}
        {hasOptions ? (
          <div className="guided-fill-properties-row" data-form-property="options">
            <dt className="guided-fill-properties-term">Options</dt>
            <dd className="guided-fill-properties-value">
              {field.kind === "listbox" && field.multi === true ? (
                <span
                  className="guided-fill-properties-multi"
                  data-form-property-multi
                >
                  multiple selection
                </span>
              ) : null}
              <ul className="guided-fill-properties-options">
                {field.options?.map((option) => (
                  <li
                    key={option.value}
                    className="guided-fill-properties-option"
                    data-form-option-value={option.value}
                  >
                    <span className="guided-fill-properties-option-label">
                      {option.label}
                    </span>
                    <span className="guided-fill-properties-option-value">
                      {option.value}
                    </span>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        ) : null}
      </dl>
      <p className="guided-fill-properties-note" data-form-edit-unsupported>
        {"Editing a field's name, type or flags is not supported by the current engine."}
      </p>
    </div>
  );
}