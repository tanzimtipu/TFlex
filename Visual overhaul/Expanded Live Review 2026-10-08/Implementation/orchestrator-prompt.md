# Orchestrator prompt — expanded Jovrel refinement pass

Review the installed Jovrel 1.51.0 live-audit package dated 8 October 2026. Implement ER01–ER24 with evidence-led prioritization. Read `../Specifications/live-audit.md` and `../Evidence/` first. This task fixes existing implementation and completes the specifically described refinements; do not conflate unfinished roadmap items with regressions. Preserve previous design decisions: a unique restrained logo-based identity, vivid individual tab colors, consistent outline icons, elegant shared surfaces and clear action hierarchy.

Inspect the current repository and its applicable instructions. Identify actual owners of the shell layout, command registry, dock model, inspector groups, Home resource/recents handling, dialogs and export validation. Match build/version to the audited installation before comparing results. Trace root causes; screenshots identify symptoms, not implementation technologies. Do not edit the installed application files directly.

## 1. Restore compact workflow access first

Fix ER01 before cosmetic work. Compact inspector expansion must open a usable drawer even when responsive logic normally auto-collapses it. Model viewport-driven presentation separately from explicit user intent; avoid an effect that immediately overwrites an open request. Preserve stage, selection, page, scroll anchor, zoom mode and remembered expanded panel widths across resize/maximize/restore. Navigator and inspector drawers need explicit close buttons, keyboard access and stable focus return. Test both keyboard and actual pointer targets, not just component state.

Address ER02/03 together through correct containment. Use shrinkable grid/flex children (`min-width: 0` where needed) and reflow formatting groups into complete rows. Do not solve horizontal overflow by clipping interactive controls. A 260-value inspector must contain all default formatting controls in a maximized window. Dock overflow must show complete items with predictable scroll stepping/visibility or a clearly named overflow list; avoid partial text fragments. More/Customize actions remain reachable at every supported size. Keep disabled user pins reversible and explain their unavailable state.

## 2. Derive shell and menu commands from the active context

Create or reuse a single capability resolver for active Home/empty tab/document/stage/selection state. Use it consistently in top bar, File menu, application menu, dock and palette. Home should offer Open, create PDF, merge into a new document where supported, Preferences and Help. Remove document Save/Save copy/Search-in-document/Print/edit commands from Home chrome according to the user's requirements. Keep app-wide palette accessible through its shortcut/menu where appropriate; do not confuse it with document search. An inactive document must never make Save a copy enabled on an empty active tab. Respect unsaved state and real handlers when returning to a document.

Menu placement must measure its anchor and available viewport, flip/shift inward and constrain width/height. No menu horizontal scrollbar. Wrap explanatory text, keep command titles readable, and fit shortcuts in stable tracks. Menus may scroll vertically with visible boundaries and keyboard focus kept in view. Test right-edge compact anchors, submenus, long labels and increased text size. Avoid disabled irrelevant Home rows when omission makes the menu clearer.

## 3. Complete Home presentation and resource integrity

Add a consistent brand inset to chrome. Remove the empty tab band only when there are genuinely no open tabs; an empty Home tab among documents still needs the tab strip. Keep per-tab color identity stable through reordering, active/inactive transitions and restore; do not replace the user's colorful-tab design with monochrome tabs.

Render recent rows on shared grid tracks: icon; flexible name/location; file type; availability; date; actions. Reserve empty cells so missing badges/actions do not shift metadata. At compact widths stack secondary location text and use a single labeled action menu rather than forcing horizontal scrolling. Distinguish real filesystem recents from bundled virtual fixture resources. Fix the false Missing state, and prevent development samples from polluting production recents. Gate Explore and fixtures to development/testing or remove them from the shipping Home as requested; clean sample-dependent intro copy. Preserve genuine user history.

Make the logo-derived arc/light motion visibly intentional: restrained colorful segment, modest opacity and slow transform/gradient travel confined to the illustration. Avoid full-screen flashing or constant expensive repainting. Honor reduced motion and a local “Pause background motion” setting without toggling global animation preferences. Use a static decorative state when paused. Give its control a visible label and correct accessible pressed/state semantics.

## 4. Make dock discovery and customization coherent

Keep the general command palette and a dedicated **Add to dock** picker separate. General palette may search commands and files. Add to dock lists only commands with real dock support and correct stage eligibility, excluding already-pinned items or indicating their state consistently. Both must derive eligibility from the same canonical command registry (stable id, label, stages, availability, pin support, execution handler); do not maintain incompatible ad-hoc catalogs.

Replace ambiguous More/Tools flows with explicit naming: for example More actions for stage commands and Customize dock for editing. In customization show a clear Done action, readable remove controls, ordering behavior and Add tool. Pin keyboard guidance must depend on whether the highlighted row is actually pinnable. Unsupported commands remain blocked. Do not claim all commands should be pinned or add dummy handlers to inflate the catalog. Clarify Book View versus comic/reading mode terminology based on actual feature distinctions.

Remove excessive idle opacity from enabled dock/footer contents. Keep readable icon/text foregrounds at rest. Hover/focus can emphasize container background/shadow; disabled content has its own intentional state. Confirm text/control contrast through computed colors, including primary button glyphs.

## 5. Make inspectors useful and forms truthful

Review left panel owns annotation navigation, filters, count and creation actions. Right panel owns selected annotation properties/comments or actionable selection guidance. Remove duplicated Bates/Watermarks/Signatures empty summaries; preserve access to their real commands and meaningful status. Do not implement a second copy of the same list. In Edit, show page/selection guidance when no object is selected. Crop information appears when crop is relevant, labeled in ordinary language with units, page scope and reset/apply semantics. Never expose CROPBOX / Box — as the sole default inspector content.

Check which text formatting controls affect tool defaults versus a selected text object. Label defaults explicitly, and disable selection-only operations when there is no selection. Do not disable legitimate defaults blindly. Preserve PDF edit functionality and undo behavior. Fix the text inspector's horizontal overflow before expanding its feature set.

## 6. Refine dialogs and output feedback

Image creation: content-driven initial modal size with a meaningful empty state and Add images/clipboard entry actions. If drag/drop exists, present its actual accepted formats and validation; do not advertise unsupported drop behavior. After selection use an ordered preview list with reorder/remove controls and output summary. Keep footer visible and body independently scrollable at compact heights. Preserve existing JPEG bounds and cancellation behavior.

Stamp: reconcile header instructions, selector helper, primary action and actual placement handler. If immediate centered placement is current behavior, say “Place at center of page N”; if interactive placement is supported, make it an explicit mode, explain the next click and Escape cancellation. Do not silently change placement semantics. Verify with a disposable fixture and Undo; never overwrite source PDFs.

Export: label page-range input “Pages to export” with associated help/error text. Parse range tokens centrally and return specific errors (out-of-bounds page, inverted interval, invalid token); show a valid selected-page count rather than echoing invalid text. New untouched fields use help, then validate after editing/blur or submission. Continue blocking invalid exports, preserving numeric bounds and correct All/current scope behavior.

Show the actual result contract: selected page count, format, one-file versus multi-file output, and filename/folder scheme. This must match the real export handler, including duplicate page/range ordering semantics. For all-pages PNG show the expected file count and naming example. Provide a real analysis action or clear unavailable explanation for Not analysed output checks; no invented success badges. Make Export icon inherit button foreground so label and glyph remain legible. Do not change the engine's output fidelity promises without validating output.

## Acceptance tests and evidence

Use disposable fixtures: empty Home; one-page PDF; 34-page text PDF; long 520-page PDF; scanned multi-page PDF; form PDF; mixed page sizes/orientation. Use existing tests where meaningful; add regression tests for capability resolution, menu bounds, compact drawer state, command pin eligibility and range parsing rather than screenshot-only checks.

Test full window, 1280×800, 1024×768 and provisional 960×640 **logical DIP**, with supported intermediate resize widths and 100/125/150/200% display scaling. Record actual DIP/client dimensions and build id. Every essential command must remain reachable, with no horizontal menu/inspector overflow. Verify tab activation and color stability, drawer open/close, focus return, dock keyboard navigation and fully visible tool items. Confirm no page/selection loss through resize; rerun earlier AR01–AR04 and book-view synchronization regressions.

Specific required scenarios:

1. Active empty tab with another document open: Save copy/Print and document actions follow the empty active tab; return to document restores legitimate commands.
2. Compact Home application menu at right edge: every title/shortcut visible, no horizontal scrollbar; Escape returns focus.
3. Edit text inspector at its normal width: all formatting controls fit. Compact Expand inspector actually opens and remains open until explicitly dismissed.
4. Add-to-dock lists only eligible tools, and palette pin guidance matches highlighted-row eligibility. Existing pins persist; no accidental pin changes.
5. Idle dock/footer remain readable; primary Export icon/text meet contrast targets. Measure rather than guessing from screenshots.
6. Invalid `1,999`, empty, nonnumeric and inverted ranges produce useful errors and block execution. Valid current/all/custom ranges show correct count and real filenames. Export copies to a test output folder and inspect the resulting files.
7. Image modal empty/populated/invalid-file states fit compact heights; cancel leaves no document mutation. Stamp placement matches copy and can be undone on a disposable fixture.
8. Production Home contains no fixture gallery/sample references or false Missing virtual-resource entries. Mixed recent rows share metadata columns.
9. Review with zero and populated annotations has distinct left/right responsibilities. Crop details only appear in a meaningful crop context.
10. Reduced motion and local Home motion pause are independent from global animation preference; instant page changes still work when animations are disabled.

Consider a 960×640 DIP minimum only after responsive fixes pass. Fit it to real work-area constraints and DPI scaling; document the final justified minimum. Do not increase the minimum to conceal broken panel drawers or overflow already present at maximized size.

Deliver implementation summary, issue-to-change mapping for ER01–ER24, test results and before/after evidence at full/compact sizes. Separate verified fixes from unresolved questions. Do not mark roadmap OCR/comments/print/import features complete without real functional tests. This review did not establish a crash, engine-output bug or measured rendering-performance regression.
