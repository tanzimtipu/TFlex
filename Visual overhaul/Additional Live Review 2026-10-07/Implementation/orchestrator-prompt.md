# Fix additional live Jovrel implementation defects

Inspect applicable repository instructions and the existing visual overhaul design system first. Implement the findings in the accompanying live audit, preserving the established typography, vivid document-tab identity, icon geometry and restrained surface styling. This is a targeted corrective pass before the remaining redesign categories, not authorization to rewrite the PDF engine or implement unrelated features. Supplement the earlier Implementation Review and Book View prompts; consolidate overlapping fixes into shared components.

Reproduce each finding in the packaged installed build and source build, record version and viewport/scaling, and identify the actual cause before changing code. Screenshots establish visible behavior, not a source-level explanation. Prioritize AR-01 through AR-04.

## 1. Preserve reading location across layout changes

Use a document-scoped canonical page and normalized in-page anchor. Before a resize, panel change or fit-mode recalculation, capture the focused/visible page and normalized point relative to that page; after layout/raster changes restore the equivalent document location. Do not reuse absolute scrollTop from the old page scale. Resolve restoration only against the current document and layout generation; discard stale asynchronous callbacks.

Keep requested navigation, rendered location and visible-page indication coherent. A bookmark may have a preparing state while its target loads, but once settled the page indicator, navigator, inspector and visible content must agree. Account for page gaps, mixed sizes, rotations and continuous scroll. Do not infer current page from a global constant-height approximation when dimensions differ.

Fit Page must fit and position the current canonical page within the usable canvas after shell chrome and footer. If Fit Page is already active, invoking it should still recenter/recover the current page rather than silently preserving a stale scroll offset. Fit Width and manual zoom should preserve their appropriate normalized anchor. ResizeObserver updates must be coalesced and generation-guarded, avoiding scroll/resize feedback loops.

Regression: report Chapter 5 page 10 at maximized size → restore near 981 × 641 → page 10 remains visible; Fit Page restores its full page; maximize → page 10 remains selected. Repeat on pages near the middle/end, mixed-size PDFs, continuous scroll and alternate layouts. Preserve existing navigation behavior that already works.

## 2. Make compact panels usable

Separate the user's requested panel state from the layout's effective presentation. At narrow widths present Navigator and Inspector as independently reachable overlay drawers instead of forcing them permanently collapsed. Expand must open a meaningful drawer without widening the canvas below its viable width. Closing returns focus to the triggering button. Escape closes the active drawer; pointer and keyboard paths must work. Outside-click behavior must not accidentally activate a PDF action underneath.

Remember the selected Pages/Outline view and panel widths across compact/wide transitions. Opening the navigator from a compact page rail must allow Outline, including its current bookmark selection. Do not substitute only page numbers for every work stage. Inspector drawer must contain the same contextual content as its wide version. Prefer one drawer at a time at compact widths, preserving separate requested state for wide layouts.

Use explicit expanded state, accurate accessible names/aria-expanded/controls, logical focus handling and synchronized CSS/event state. Audit whether responsive auto-collapse effects immediately override manual expansion. Also investigate stale element hit bounds after resizing; do not assume the accessibility automation result alone proves a normal mouse defect. Verify with real mouse coordinates and keyboard activation.

Regression: at approximately 960 × 640 and the observed 981 × 641, both Expand controls expose content; Outline can navigate; inspector fields and actions remain usable; resize while a drawer is open does not trap focus or lose reading position. Maximize restores the intended wide panels.

## 3. Correct bundled sample / Recent identity

Give bundled fixtures an explicit sample identity distinct from a real filesystem path. Do not persist virtual `samples/report.pdf` as though it were an ordinary disk file and then report it missing. Prefer excluding unsaved bundled sample copies from production Recents, consistent with the plan to remove Explore Jovrel from the release Home screen. If samples remain for development, route their reopening through the actual sample provider and display their source accurately.

Review/migrate only identifiable obsolete sample Recent records. Do not delete user files or unrelated real Recent entries. If a sample is saved by the user, its genuine saved document path may enter Recents normally. Availability checks must distinguish missing, inaccessible, pending and virtual sources; do not infer disk existence from a display label. Test relaunch, repeated sample opening, saved copies and missing real files separately.

## 4. Keep enabled controls readable at idle

Remove excessive idle opacity from dock icons/text and persistent page/zoom/navigation controls. Enabled, inactive, selected and disabled are distinct states. Inactivity may reduce a surface shadow or background prominence, but essential commands and current-page/zoom values must remain legible. Mouse proximity must not be required to discover whether a command is available.

Apply shared semantic foreground/surface/disabled tokens rather than per-widget opacity multipliers. Verify contrast against actual composited backgrounds in all supported themes; target 4.5:1 for normal text and 3:1 for meaningful non-text controls. Measure rather than claim compliance from screenshots. Keyboard focus must be fully visible without hovering, and disabled Comic View must not look identical to an available Extract action. Avoid removing controls solely to achieve a minimalist appearance.

## 5. Make page-range validation specific

Use one range parser that returns structured errors and a resolved ordered page selection. Distinguish empty input, syntax errors, reversed ranges according to the existing policy, out-of-bounds pages and duplicate normalization. For `999` in a 34-page PDF, report that page 999 is outside pages 1–34. Do not silently remove invalid tokens while acting on a valid subset. Keep Extract/Split disabled until the entire input is acceptable.

Display concise inline error text associated with the input, with an invalid state and accessible announcement. Preserve correct disabled behavior already observed. Changing document/page count invalidates any cached validation. Explain copy versus move consistently; never mutate the source from a validation-only action. Test empty, `0`, `999`, `1-999`, malformed tokens and mixed valid/invalid tokens, plus valid ranges. Do not execute destructive split operations merely to test the error message.

## 6. Align theme state and preference wording

Trace persisted theme preference, effective resolved theme, any active overrides and the shell/dialog token provider. If Theme default says it applies immediately, selecting Dark must change all app surfaces coherently and persist after relaunch. If a separate override exists, expose its relationship plainly rather than presenting two conflicting states. Preserve the user's setting during migration; do not reset it to conceal the discrepancy. Test Light, Dark and any system/theme variant through the actual supported paths.

Label the checkbox “Enable animations” and explain: “When off, menus, panels, dialogs and page changes appear without transition animations.” Honor reduced-motion and the separate Home decorative-motion setting as already specified. Do not change settings merely by opening Preferences. The user must be able to identify checked/unchecked behavior without interpreting negated helper text.

## 7. Window constraints and verification

Use 960 × 640 logical pixels as a provisional minimum only after the compact drawer and reader fixes pass. Establish the final bounds using the display work area and scaling; avoid a hard minimum larger than the available display. A minimum-size restriction is not a fix for anchor mismatch or inaccessible panels. Test compact, wide/short, maximized, repeated restore/maximize, panel toggles and 100/125/150/200% scaling on appropriate environments.

Run meaningful regression tests for anchor calculations, layout generations, manual drawer activation under compact auto-collapse, sample identity and range-parser error categories. Supplement with packaged-app screenshots showing idle and focused controls and the tested window sizes. Do not add tests that merely repeat CSS token values. Verify extraction and preference dialogs fit without horizontal scrolling; retain their observed working Escape dismissal and validation safety.

Deliver a reviewable change and a verification report mapping AR-01–AR-09 to files, reproduced cause, correction and evidence. State which tests remain unperformed. Keep source documents and user settings intact. Do not mark a visual defect resolved from one immediate animation-frame screenshot; inspect settled results as well as transitions.
