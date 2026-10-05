# Jovrel siderail — Workspace Rail

Dedicated proposal for the narrow navigation rail boxed in the user's screenshot. Earlier Icons resources defined its glyph family; Panels resources defined adjacent information. This category establishes rail layout, selection, accessibility and integration. Recommended: Workspace Rail. Expanded Navigator is an alternate layout to evaluate, not a requirement to ship two new modes.

## Diagnosis

Pages, Edit, Review and Deliver are recognizable, but the current rail is visually compressed. Different permanent icon colors compete with selected-state styling. Settings is isolated at the bottom; the File control appears inside the highlighted column visually but belongs to application chrome. The revised rail should read as one deliberate set of workspace destinations and a separate utility area.

## Layout and appearance

Use a 72 logical-pixel rail below the application title/tab chrome. Maintain its full available editor height, with a 1px neutral separator beside the left panel. Proposed item width 56px, minimum height 60px, horizontal inset 8px, 12px top padding, 8px inter-item gap. The four workflow items remain in existing order: Pages, Edit, Review, Deliver. Settings stays bottom-aligned inside a small utility group separated by a quiet divider, with adequate bottom inset; keep it above any actual window/status-bar safe area. Do not align it beneath or over the dock, hide it behind scrolling, or turn it into a document workspace.

Each destination uses a 22px shared line icon and an 11–12px visible label beneath it, 6px gap. Labels remain visible in the recommended layout. Apply 10px target corners. The active target has soft violet fill, violet icon/label and a 3px-wide, 20px-high inset leading marker. The shape, label and programmatic state accompany color, so selected state does not depend on hue alone. Inactive destinations use the same neutral foreground, with restrained neutral hover. Keep the existing 24-unit, 1.65 stroke icon construction; selected icons do not change stroke weight or jump in size. No glow, heavy rail shadow, decorative gradient or four unrelated category colors.

The user explicitly wants individual colorful document tabs. Those remain colorful. The rail's violet identifies the selected workspace consistently with the dock and panel selections; it does not inherit the active tab color. This preserves stable navigation meaning while allowing colorful document identity.

Use Quiet Precision surfaces/foregrounds/borders from siderail.tokens.json. Light accent #7050D6 on soft #F0EBFC; dark accent #B9A4FF on soft #302740. Inactive foreground #485164/#B8C0D0. Rail surface #FFFFFF/#20232B. Labels use Segoe UI Variable/Segoe UI/system, weight 500 selected and regular/medium according to shared controls. Retain visible native/framework focus indication independently of the selected marker. Optional hover/selection transitions use 140ms timing, immediate with reduced motion. Position marker within targets; do not move a large indicator through empty rail space.

Expanded Navigator alternate: 156px rail, 140 × 44px targets, icon and 12–14px label in one row, 12px gap. It aids scanning and long labels but consumes document width. Choose it only if user testing or product needs justify it; don't add another permanent expansion button merely to demonstrate an alternative. If the app already offers a compact/expanded preference, preserve and integrate it. The narrow chat preview stacks the adjacent panel for this alternate; production desktop navigation should use sensible width constraints and panel collapse, not copy preview stacking.

## Navigation and meaningful actions

The rail switches workspaces. It is not a progress wizard: users can visit any supported workspace without completing previous steps. Selecting Pages/Edit/Review/Deliver updates the existing left panel, matching dock tool group and context-sensitive inspector through the existing workspace controller. Re-selecting the active destination is idempotent and does not clear drafts, tools or selections. Workspace selection is distinct from a tool command: selecting Edit must not directly begin modifying page content, and selecting Deliver must not immediately export.

Panel collapse belongs in its header, as already proposed in Panels. Collapse hides the panel while keeping the active workspace visible in the rail. A different workspace may reopen its panel if consistent with established behavior; preserve an existing preference otherwise. Audit current repeated-click/panel-toggle behavior before changing it. Do not conflate current workspace, current canvas tool and panel visibility in one boolean.

Settings opens the existing settings/preferences UI and retains the document's current workspace. File stays in the top bar and opens the existing menu. Avoid adding duplicate File/Home/search/account/new-workspace destinations without an existing user need. Preserve any additional rail items not shown in this screenshot through a registry audit. Use stable workspace IDs, not labels or item positions, for state and bindings.

Do not add decorative counts or fabricated notification dots. A Review badge is justified only if a specific real state requires attention, its scope is clear and its accessible label describes the meaning; zero annotations is not an alert. Document-dependent destinations must reflect actual capabilities; “No editable content” does not mean the entire Edit workspace is unavailable, since OCR/add-text may still exist. In a start-page context, follow actual app policy for hiding or disabling document workspaces and provide understandable reasons. Never show enabled commands that fail silently because no document is open.

## State preservation and integration

Reuse current workspace/session state. Preserve selection, scroll position, page, undo history, tool options, drafts and document identity when moving between workspaces, according to existing transactional rules. If a current canvas draft needs resolution before workspace change, reuse the app's existing commit/cancel flow; don't silently discard or add blanket prompts. The design illustration uses static example data and status-only commands. Actual adjacent panel content must use the Panels specification and real model state.

Rail dimensions must feed document viewport measurements, panel widths, dock centering, overlay collision bounds and hit-testing offsets. Maintain alignment below the revised title/tab area. Collapse/reflow other surfaces deliberately when window width becomes constrained; avoid simply shrinking icons or pushing targets off-screen. At short window heights, the document-workspace list may scroll with Settings in an accessible fixed utility region; honor minimum targets and avoid overlapping groups. Do not use the vertical empty space to add filler tools or statistics.

## Accessibility and platform behavior

Use the framework's existing accessible workspace navigation pattern. If it operates as tabs, supply tablist/tab/tabpanel relationships, selected state and a coherent arrow-key policy. If it changes routes, use navigation/current-page semantics. Don't impose tab semantics on route navigation arbitrarily. Native focus order remains consistent, Enter/Space activate buttons where appropriate, labels have explicit accessible names, and icon-only supplementary controls have full tooltips on focus as well as hover. Preserve actual shortcuts; don't invent accelerator hints or intercept document-editing keys.

The recommended 56 × 60px targets exceed 44px pointer target guidance and stay usable on touch. Test high-contrast/forced-colors where soft fills may disappear: preserve selected shape/border and programmatic state using system colors as appropriate. Keyboard focus and selection are separate. Support Windows text scaling, 100/125/150/200% DPI, long translations, light/dark, reduced motion and supported short/narrow restored windows. Labels should widen or use the established expanded mode under translation/text scaling rather than being reduced below readable size.

## Acceptance

Every existing rail destination retains command access and stable state; selection matches panel/dock/inspector; active target is unambiguous in both themes and forced-colors; Settings retains workspace; File remains accessible in the top bar; switching doesn't alter document content or discard sessions; panel collapse remains separate; short-height layouts keep all destinations and Settings reachable; document/dock/overlay measurements account for the rail width. Verify empty/loaded/read-only/scanned documents, in-progress canvas edits, tab switching, window resize, scaling, keyboard and screen-reader behavior. Run relevant existing navigation checks and capture resulting application screenshots.
