# Live-app refinement — Selection and Manipulation

Inspected 5 October 2026 using the installed `C:\Program Files\Jovrel\Jovrel.exe` via native UI automation. This addendum takes precedence over illustrative layouts and generic implementation choices in the earlier handoff for the behaviors below. Shared Quiet Precision tokens and the user's colorful-tab requirement remain in force.

This run observed editable form widgets and page-transfer affordance, but did not create annotations, text objects, selection handles or manipulation commits. Earlier supplied screenshots remain the evidence for contextual Confirm/Cancel/Delete controls.

Keep Inspector First as the proposed selection treatment. Bind to stable actual object IDs and preserve current draft/commit/cancel/undo semantics. Do not turn a form widget into an ordinary text object or conflate page transfer with object drag. Test transformed handles, contextual-toolbar collision and property Mixed states with purpose-built fixtures before shipping. No further live selection-specific behavior is asserted by this audit.
