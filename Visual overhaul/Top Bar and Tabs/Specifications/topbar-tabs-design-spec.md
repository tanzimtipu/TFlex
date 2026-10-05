# Jovrel: top bar and tabs — Document Rail

Status: proposed design, consistent with Quiet Precision. This is a design handoff, not a source-code implementation. Screenshots establish appearance and visible commands; they do not establish framework, command semantics, dirty state, or document capabilities.

## What the screenshots reveal

The current strip combines application identity, file operations, document navigation, utilities, theme, account, and Windows controls on one baseline. Tabs cycle through purple, pink, green and grey without a visible semantic rule. With many sessions, filenames collapse into tiny blocks. An active empty tab is hard to distinguish from a colored peer. Two adjacent save-like controls and the command-symbol glyph need a source-level command audit before relabeling.

## Recommended composition: Document Rail

Give application commands a 48 logical-pixel title row and documents a separate 40 logical-pixel rail. These are proposed tokens, not dimensions measured from the screenshot. Keep the document area unobstructed and offset it by the actual chrome height. Use one understated bottom divider, solid opaque surfaces, no glow, no blurred text, and no shadow beneath every tab. The distinctive detail is a saturated, individually colored active tab with a short inset contrast keyline. Every session receives its own stable color identity.

Title row, left to right: existing brand mark/name, File menu, Open, Save; flexible drag region; Search tools, Print when space permits, application menu; native Windows caption controls. File contains existing file actions. Save as remains clearly named in File; the second save-like control must be identified by its actual command before moving it. Search tools calls the existing command palette. Application menu groups Panels, Appearance, Settings, account and appropriate secondary commands; preserve every existing feature and meaningful menu state. Do not add account badges, notifications or fabricated functionality.

Document rail: Home only if it can use the existing start-page/session model, readable document tabs, New tab, All tabs with total count. If Home is itself currently a tab, preserve that model and give it the same appropriate tab treatment. The mock's separate Home anchor is a visual proposal, not authorization to refactor the document engine.

The alternate Compact Header saves vertical space but retains competition between commands and documents. It must use the same overflow rules. Prefer Document Rail for this editor's dense workflows and the many-tab case shown by the user.

## Color, typography and geometry

Use the existing Quiet Precision token source plus the additive topbar-tabs tokens. Light: canvas #F5F6F8, surface #FFFFFF, strong #232A38, regular #485164, muted #70798A, border #E1E4EB, accent #7050D6, soft #F0EBFC. Dark: canvas #171A21, surface #20232B, strong #EEF1F7, regular #B8C0D0, muted #929BAC, border #3B414E, accent #B9A4FF, soft #302740.

Every new session gets its own richer color from the curated identity palette. Inactive tabs retain clearly colored 20% tints; the active tab uses the full saturated color, contrasting text and a 2px inset contrast keyline. This supersedes the earlier neutral-only tab proposal. The rest of application chrome retains Quiet Precision violet and neutral surfaces. Tab identity colors never recolor panels, menus or primary actions.

Palette: violet, ocean, terracotta, jade, rose, indigo, ochre, olive, orchid, lagoon, raspberry and iris. Use the exact paired light/dark values in tab-identity.tokens.json. Each token has dark-mode counterparts and verified foreground contrast; use white active text in light mode and #171A21 active text in dark mode. Inactive foreground remains #232A38/#EEF1F7. The same identity swatch appears in the complete tab switcher. Color is decorative session identity, not an unsaved/error/status code; retain filenames and explicit state descriptions.

Assign colorId at session creation, persist it with that stable session ID and carry it through reorder, rename, overflow, restoration and selection. Allocate an unused palette identity among concurrent sessions first. When all base identities are occupied, use additional contrast-checked hue/lightness variants, with textual disambiguation always present. No finite palette guarantees perceptually unique colors for unlimited tabs. Do not recolor existing sessions to free a slot or derive color from current tab index. The demonstration cycles twelve base identities after exhaustion; production must use the extended allocation policy.

Segoe UI Variable/Segoe UI/system fallback; 13px filenames, weight 500 selected and 400 inactive; 12px supporting status; 14px application labels. Use 24-unit icon grid, 16px compact icons, 1.65 round-cap/round-join stroke from the shared icon family. Spacing follows a 4px unit; icon/label gap 6px. Tabs have 9px top corners; controls follow the Buttons category. Fine-pointer targets at least 32px including close; coarse-pointer targets 44px. The mock shows compact illustration-only close buttons; production target must meet these values. Normal filenames truncate at the end and expose the complete name on focus/hover. Disambiguate duplicate basenames through location or document identity in the tab switcher and accessible description, without putting full paths across the rail.

## Many tabs: never reduce them to colored blocks

Prefer a measured visible rail: ideal tab width 180–220px, minimum 136px, with approximately 150px used for capacity budgeting. Reserve room for stable New tab and All tabs controls before computing capacity. Keep the active session in the visible set and maintain canonical session order in the complete switcher. Do not let flex-shrink erode text and close controls below the minimum. Hidden documents remain open and retain their model, undo history, scroll location and unsaved changes. Count all sessions, not only visible tabs. The overflow button must exist and remain discoverable even when the active document is outside the first visible group.

Use an anchored, opaque, collision-aware switcher with complete names, current-document indication, actual unsaved state and duplicate-name context. For long lists, use a bounded native/accessible list with scrolling; optionally add search if the existing application supports it or session volume justifies it. The preview expands this list in normal flow solely to show every item. A platform-appropriate scrolling tab rail is also valid if it preserves minimum widths, active visibility, keyboard navigation and the complete switcher; do not combine multiple competing overflow affordances without a reason.

New tab creates an independent session using existing logic. Stable model IDs identify tabs; names or indices do not. Numbering blank sessions is optional display disambiguation. Never auto-close, merge, recycle, deduplicate, or discard empty sessions as a visual cleanup. Selecting Home must preserve open documents.

## Meaningful state and actions

Active state is separate from document status. Dirty state uses a small current-foreground dot and an accessible “Unsaved changes” description, derived from the model; it must not replace the close button or be inferred from a file extension. Loading, errors and read-only states use actual state and explicit descriptions; reserve red for real errors/destructive actions. Do not use green to suggest saving succeeded before it has. Save/Print availability follows active-document capabilities with a clear disabled reason. A clean document is not inherently incapable of Save as.

Selecting, closing, reordering and restoring sessions must retain the app's established behavior. On clean close, follow its existing adjacent/MRU selection policy. On dirty close, preserve its Save / Discard / Cancel flow; save errors and cancellation leave the tab open. The mock refuses to close its dirty example to demonstrate this boundary and does not simulate file persistence. Drag reorder uses stable IDs and has a keyboard alternative if supported. Do not re-create whole document subtrees when tabs reorder or resize.

## Windows integration and accessibility

Preserve the framework's native window controls, DWM integration, caption hit testing, draggable regions, system menu, double-click maximize, restored/maximized geometry, Windows Snap behavior, DPI scaling and full-screen behavior. Interactive regions must be excluded from drag hit testing. Never replace native captions with the disabled mock buttons, hide captions to solve overflow, or allow commands beneath the caption hit area. Size available content using the actual reserved caption region and safe framework APIs.

The small-width mock reflows controls and omits illustrative captions for readability inside chat. Real desktop chrome requires a platform-aware compact layout or sensible minimum window width; do not copy that preview-only breakpoint literally.

Use the framework's accessible tab primitive with tablist/tab/tabpanel relationships and a documented activation policy. Preserve current Windows keyboard shortcuts; use the real accelerator labels rather than a macOS command symbol. Verify Ctrl+Tab / Ctrl+Shift+Tab, Ctrl+W, Open, Save and command-palette shortcuts against existing bindings. Native focus indication remains visible; filename and dirty status are announced; close has an explicit accessible name and separate target. Menus close on Escape, return focus to the correct opener, and are operable by keyboard and pointer. Every tab remains reachable through keyboard and switcher. Reduced motion removes optional transitions; normal transitions use the existing 140ms timing without animating entire rows on every selection.

## Integration and acceptance

Audit the actual framework/components and handlers first. Create an inventory of every current top-bar item with old location, new location, command ID and availability rule. Reuse existing icon, button, menu and session components. Read Icons, Dock, Panels and Buttons specifications from the same Visual overhaul root; no isolated new palette or icon library.

Verify 1, 3, 12 and 30 sessions; long and duplicate filenames; many empty sessions; active tab beyond overflow; clean/dirty/read-only/loading/error states; Home; close cancellation/save failure; restored and maximized windows; 100/125/150/200% display scaling; narrow supported desktop width; keyboard and screen-reader navigation; light/dark and reduced motion. Check that no current command becomes inaccessible, native caption controls remain intact, document viewport math remains correct, and all session state survives switching/reorder/overflow. Use existing relevant tests and manual desktop checks, with screenshots for review.
