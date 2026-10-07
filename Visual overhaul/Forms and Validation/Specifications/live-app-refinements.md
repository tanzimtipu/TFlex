# Live-app refinement — Forms and Validation

Inspected 5 October 2026 using the installed `C:\Program Files\Jovrel\Jovrel.exe` via native UI automation. This addendum takes precedence over illustrative layouts and generic implementation choices in the earlier handoff for the behaviors below. Shared Quiet Precision tokens and the user's colorful-tab requirement remain in force.

Opened bundled form.pdf: one page, inspector reports eight form fields. Canvas exposes three text inputs, checkboxes, radio choices, a dropdown and a list. Accessibility names are generic (“Text”, “Checkbox”, “Dropdown”), with radio choices labelled 0/1/2. Review exposes Forms, Flatten, CSV mapping, FDF/XFDF form-data import/export and PDF/A/PDF/X validation as distinct commands.

Keep all widget types and their actual export values, appearance, grouping, flags and order. Improve accessible labels from PDF field names/tooltips with a truthful fallback; do not infer required/email semantics from a screenshot. Guided Fill is a proposed helper, not an existing completion engine. Keep form-value validation distinct from document-conformance validation. Flatten must remain an explicit operation with its consequence flow. Keep CSV and FDF/XFDF actions discoverable in the form workflow. No values were edited and no save/reopen, field validation, CSV mapping or conformance scan was performed.
