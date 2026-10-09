# Orchestrator prompt — workflow and regression repairs

Review the attached `audit.md` and `Evidence/` before implementing. These findings were observed in the installed Jovrel **1.51.1** on 8 October 2026. Reproduce against the current source build and record any version differences. Implement the repairs below with the existing Jovrel visual system: neutral document workspace, restrained violet action emphasis, colorful document tabs, consistent icon strokes, typography, spacing and focus states. Preserve the logo-led Home design and its existing improvements.

Do not replace the whole interface or count unfinished design categories as regressions. Address the confirmed state defects first; capability gaps and visual refinements are explicitly identified in the audit. Investigate source causes rather than assuming the suggested architectural explanation is already established.

## 1. Correct crop initialization and page scope — WR01–04

Build crop configuration around a temporary model; cancel must discard it. Initialize each page from its existing CropBox (or the valid full page fallback), respecting MediaBox bounds and rotation. Do not invent a 10% inset when opening Crop. Disable Apply when the configuration has no actual change or has invalid values. Include Reset to full page and, where useful, Reset to original.

Separate **which pages change** from **how their rectangles are edited**. Provide Current page, Selected pages when applicable, Custom range and All pages. Then provide Same rectangle and Individual rectangles. Show the exact affected-page count beside Apply. Default to the explicit selection if one exists, otherwise Current page; switching to All must be intentional. Define how a common crop applies to differently sized/rotated pages and surface invalid combinations rather than silently clipping or scaling.

Create a fitted preview and synchronized numeric rectangle or margin fields with unit labels. Preserve dragging while adding keyboard-operable handles/controls and numeric precision. Validate nonzero dimensions and containment within supported bounds. Keep preview transforms separate from PDF coordinates and cover their conversion with meaningful tests.

Make page scope and numeric controls persist alongside the fitted preview at wide sizes. At compact sizes use a stacked layout with bounded scrolling, sticky actions and an accessible preview switch if necessary. The initial preview must show all crop handles. Explain which PDF boxes change; do not silently overwrite TrimBox unless that is an explicit supported contract or choice. Do not describe cropping as deletion/redaction. Commit once, integrate with Undo and preserve cancellation without dirtying the PDF.

Acceptance: opening Crop on an unmodified 612 × 792-point page is a no-op until changed; preview and numeric values agree; current/selected/range/all affect only their declared pages; mixed sizes and rotations validate correctly; Cancel leaves bytes/history unchanged; Apply can be undone.

## 2. Unify navigation and command capability state — WR05–06

Reuse the page-range parser/validation rules where appropriate, with a dedicated single-page input contract. Page input must reject empty, malformed, fractional and out-of-range values with clear inline feedback and an accessible announcement. Keep the actual page anchor unchanged on invalid submission. Distinguish the editing draft from the committed page number; on Escape restore the committed value, and define a consistent blur policy. Do not show 999 / 34 as if it were the current page.

Derive Undo, Redo, Save and document-dependent command availability from a shared active-document capability selector. Apply it to application/File menus, dock, context panel, command palette, shortcuts and handlers. A disabled item must be visibly disabled, exposed as disabled and guarded against execution. Account for empty tabs, document switching, loading, closed documents and independent histories.

Acceptance: fresh document has Undo/Redo disabled everywhere; a reversible edit enables Undo, undoing enables Redo, switching documents restores the correct per-document state. Page 999 in a 34-page document gives a precise error; valid 10 navigates and updates field, canvas and inspector consistently.

## 3. Make explicit Fit page recover the viewport — WR11

Reproduce compact editor page 10 → Book View → Next to 11 → close → Fit page. Preserve the passing page continuity. Use a single committed document/page anchor shared by book and editor, with view-specific presentation state. An explicit Fit page must recalculate scale and scroll alignment against the current usable canvas rectangle, including persistent header/footer and dock clearance. It must display the full current page with margins even if the scale was already the correct numeric value; do not early-return before realigning its scroll position.

Handle layout measurement after drawer changes, resize and view transitions. Avoid stale render callbacks replacing the current anchor. Preserve intentional manual scroll during ordinary reading; explicit Fit page is the recovery action. Keep all page-turn behavior governed by the existing animation setting. Do not introduce a new WebGL engine as part of this bounded repair.

Acceptance: pages 1, 10, 11 and final page remain correct through repeated editor/book transitions; Fit page shows the whole page at compact and maximized sizes; drawer toggling does not create blank or wrong-page states; animation off changes pages immediately.

## 4. Resolve effective theme and stabilize Preferences — WR07–08

Trace persisted theme loading, system theme resolution, renderer token application and separate-window initialization. The selected preference must truthfully represent the effective mode. A Dark selection must render dark tokens consistently in main chrome, settings, popovers and print UI; System should resolve from the OS without losing the chosen preference. Fix hydration and propagation, not only the label. Verify the next launch and open/close of secondary windows.

Use a stable responsive Preferences shell with fixed category/header placement and a scrollable content region. Category changes should not recenter the shell or move the close control. Maintain a usable minimum content area without forcing a huge dialog. Retain the corrected animation-helper wording and restore focus to the launcher on close.

Acceptance: Light/Dark/System are truthful immediately and after restart; secondary windows use the same effective theme; General/Documents/Import switching keeps navigation and close positions stable; small screens can reach all settings and actions.

## 5. Make print preview inspectable while configuring — WR09–10

Preserve the specific invalid-range messages, disabling behavior, count calculations and sticky action footer that passed this review. Separate scrolling settings from preview at adequate widths. Keep the preview fitted to the available viewport. At small/short sizes offer a deliberate Settings/Preview switch or compact summary instead of letting the preview disappear above a long settings form.

Add Previous/Next sheet controls and Sheet N of M. The preview must represent composed output sheets for N-up and orientation, with clear source-page and sheet counts. Define whether duplex counts physical sheets or sides and label consistently. Update deterministically when range, order, orientation, paper, margins or N-up change. Clamp the selected preview sheet when the sheet count decreases. Provide loading/error states and cancellation for preview work.

Acceptance: range 2–3 can inspect both one-up sheets; two-up yields the expected composed sheet and count; first/last navigation disables properly; changing settings keeps the preview available; invalid ranges cannot print. Verify a test PDF/virtual-printer output before declaring output correctness, and compare it with the preview. Do not send a physical print job without the user's authorization.

## 6. Integrate search layout with its pending design work — WR12

Preserve the passing search, match highlighting, no-results disabling and Escape behavior. Constrain query/replacement form widths and group count plus navigation next to the input. Use the shared field/button/focus tokens, clear current-document scope and progressive disclosure for Replace. Adapt gracefully at compact widths without horizontal scrolling or covering the active match. Do not implement unrelated command-palette features merely to satisfy this refinement.

## Regression matrix and completion evidence

Use installed-build screenshots for comparison, then capture the repaired application at the same states. Run the rebuilt app; tests alone do not prove the layout is correct. Wait for rendering to settle before reporting blank pages. Record version/build, viewport in DIPs/CSS pixels, Windows scale, fixture, steps and expected/actual results.

Cover maximized, 1280 × 800, 1024 × 768 and 960 × 640 DIPs, plus 800 × 600 as a stress case; short-height windows; 100%, 125%, 150% and 200% Windows scaling where available; Light/Dark/System; keyboard and pointer. Mark unavailable environments as untested rather than passed. Include a zero-document Home, active empty tab, fresh/dirty PDF, long PDF, mixed page sizes/rotations and rapid tab/view switching. Test menus and secondary windows near monitor edges and ensure no horizontal menu scroll.

Keep a provisional supported target of 960 × 640 DIPs until the layout budget is measured. Do not enforce a larger minimum to hide overflow. If enforcing a minimum, use Electron's supported window sizing mechanism in DIPs, account for available monitor work area and validate that the app remains recoverable when display scaling reduces space. Report the chosen minimum and evidence supporting it.

Protect these observed improvements: inset Home brand, removed zero-document tab band/sample gallery/save controls, aligned recents, correct fixture availability, All commands naming, compact drawers, bounded menu, resize page continuity, explicit animation helper, search no-match behavior, print range validation and book/editor page continuity.

Deliver changes in focused increments with meaningful tests for crop coordinate/scope logic, navigation drafts versus committed state, history capability selectors, theme persistence and print composition. Add targeted live evidence for the layout repairs. Supply a finding-to-change mapping (WR01–WR12), before/after captures, actual test results and remaining limitations. Do not declare older untested findings resolved. Avoid broad snapshot-only tests or a speculative redesign.
