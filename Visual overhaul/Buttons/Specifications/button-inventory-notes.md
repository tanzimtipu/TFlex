# Button inventory — notes (Phase 113 chunk A)

Companion to `button-inventory.csv` (16 columns, one row per interactive control).
This chunk is RECORD ONLY: no source, style, test or doc file was changed.

## 1. How intent and density were derived for ambiguous controls

Intent is the action's role in its own surface, not its platform type:

- `primary` — the one decisive/next action of a surface or action group: Home
  "Open Files", a dialog's committing confirm (Encrypt/Export/Apply), a task's
  main commit.
- `secondary` — supporting task actions that are real but not the default
  (Create PDF from images, Merge, Apply label, per-dialog cancel/close).
- `tertiary` — chrome utilities and navigation: icon-only toolbar/rail controls,
  overflow disclosures, panel close, jump/locate, theme and update utilities.
- `destructive` — delete/remove/clear and the window close caption. Encrypt was
  deliberately classified `secondary`, not `destructive` (the design spec says
  security commands are ordinary until their semantics warrant otherwise).

Density follows the context table (`button-design-spec.md:40-54`), applied to the
effective target actually in the markup:

- `compact32` — title bar, rails, inline icon utilities, 32 px targets.
- `standard36` — panels, inspectors, dialogs, menus (36 px baseline).
- `prominent40` — Home hero actions and dock tiles (40 px / dock box).
- `coarse44` — window caption controls and coarse/touch-effective targets.

Where a control's meaning was unclear from the DOM, the handler and `aria-label`
were read; a value that genuinely could not be read from code is recorded as
`needs-handler-inspection` rather than guessed. `||` operators in predicate
expressions were written with the word `or` so no field contains a `|`.

## 2. Ambiguous controls resolved from handlers

| Control | Observation | Resolution / handler anchor |
| --- | --- | --- |
| Title-bar Save | Icon-only, `aria-label="Save"`, `Ctrl+S`, tinted + dot when modified | `AppHeader.tsx:279` -> `onSave` (`AppHeader.tsx:282`) -> `onHeaderSave` (`App.tsx:10256`) calling `onSave(activeId)`; command `save`. Disabled unless `saveModified && saveInPlaceEnabled`. |
| Title-bar Save As | Icon-only, observed label "Save a copy" (**preserved verbatim**), `aria-label="Save a copy"`, `title="Save a copy (Ctrl+Shift+S)"` | `AppHeader.tsx:294` -> `onSaveAs` (`AppHeader.tsx:297`) -> `onHeaderSaveAs` (`App.tsx:10260`); command `saveAs` (`menuActions.ts:112`). Disabled when `activeId === null`. |
| Save All | None exists | `SaveAll` is imported only as the Save-As glyph (`AppHeader.tsx:87`, used `:303`). There is no Save All command, button or menu row. Recorded as "no control". |
| Multi Mode | Relocated app-menu row, label `MULTI_MODE_ACCESSIBLE_NAME` | Authored `AppHeader.tsx:194` (id `multiMode`), handler `onMultiModeToggle` (`AppHeader.tsx:198`) -> `App.tsx:9911`. Availability is NOT a disabled predicate: with no active tab it pushes an error toast (`App.tsx:9917-9919`); it is independent of panel collapse and page spread. |
| Page-view mode | Exclusive segmented options | `ViewStrip.tsx:320` (layout one/two/four), each `aria-pressed`; `PageLayoutControl.tsx` mirrors them. In the narrow overflow menu the same options repeat at `ViewStrip.tsx:380`. Handler `onChangePageLayout` (`ViewStrip.tsx:332`). |
| Pages "Combine" | The only merge entry in the Pages panel | `ContextPanel.tsx:973`, `className="btn btn-secondary context-panel-combine"`, `aria-label="Combine with another PDF"`, handler `onMerge?.()` (`ContextPanel.tsx:976`) -> `onMergeClick` (`App.tsx:5410`); command id `merge`. There is no separate "Merge" control in the Pages panel; the label is "Combine". |
| Encrypt | Dock verb, not a dialog | Registry tool id `encrypt` / action `encryptDocument`, rendered as a dock tile at `ActionDock.tsx:1260`, handler -> `onRunTool` -> `onEncryptClick` (`App.tsx:5720`). The `EncryptDialog` confirm ("Encrypt") is a separate `primary` action at `DialogShell.tsx:292` (handler `submit`, `EncryptDialog.tsx:73`). |
| "Save a copy" | Label/command preserved wherever observed | Title-bar button `AppHeader.tsx:294` (`aria-label` + `title`); `SaveAsDialog.tsx:112` title "Save a copy"; tools registry label "Save a copy" (`toolsRegistry.ts:1100`). No label was renamed. |

Window caption minimize/maximize/close (`TitleBar.tsx:309/319/329`) are recorded
`native-exception`: frameless-window caption controls whose platform geometry and
IPC behavior must be preserved, not forced into the shared primitive.

## 3. Legacy class / component -> target primitive mapping

Target `.btn` variants per `Button.tsx:11-18` and `styles.css:3441-3692`.
"migrated" means the class already composes a canonical `.btn` variant; otherwise
the class is a layout/e2e alias to keep.

| Legacy class / component | Where | Target primitive | Semantic kind | Intent |
| --- | --- | --- | --- | --- |
| `.tool-btn` | ViewStrip, rails, reader | `IconButton variant="toolbar"` (`.btn-toolbar`); active adds `.btn-toggle` | action / toggle | tertiary |
| `.toolbox-action-btn` (+ `--cancel/--confirm/--delete`) | selectableContent, annotation bars | `.btn` + secondary / primary / danger | action | secondary / primary / destructive |
| `.sig-action-btn` (+ `--cancel/--confirm/--delete`) | SignaturesOverlay, manager | `.btn` + secondary / primary / danger | action | secondary / primary / destructive |
| `.content-action-btn` | selectableContent (`:228/251/264/279`) | `.btn` + secondary / primary / danger | action | secondary / primary / destructive |
| `.edit-box-toolbar-btn` (+ `-danger`) | EditOverlay | `IconButton variant="toolbar"`; `-danger` -> `variant="danger"` | action | tertiary / destructive |
| `.edit-image-toolbar-btn` (+ `-active`, `-danger`) | EditOverlay | `IconButton variant="toolbar"/"toggle"`; `-danger` -> danger | toggle / destructive | tertiary / destructive |
| `.ann-textbox-action-btn` (+ `-cancel/-confirm/-delete`) | StampAnnotations, comment boxes | `.btn` + ghost / primary / danger | action | secondary / primary / destructive |
| `.titlebar-file-btn` (+ `-clean/-modified/-readonly`) | AppHeader (`:269/281/296`) | already `.btn btn-secondary` (keep aliases) | action | secondary |
| `.rail-action-btn` | DocumentRail, SideRail | `IconButton variant="ghost"` (`.btn-ghost .btn-icon`) | action | tertiary |
| `.rail-tab` / `.rail-tab-collapse` | DocumentRail, SideRail | exclusive-selection segmented item `.btn-toggle` | exclusive-selection | secondary |
| `.stage-rail-btn` (+ `-active`) | StageRail | `IconButton variant="toggle"` (`.btn-toggle`) | toggle | tertiary |
| `.text-props-btn` (+ `-active`, `-wide`, `-mini`, `-row`) | TextPropertiesPanel | `.btn-secondary` / `.btn-toolbar` / `.btn-toggle` | action / toggle | secondary / tertiary |
| `.context-panel-action` | ContextPanel, panel primitives | `.btn btn-secondary` | action | secondary |
| `.context-panel-combine` | ContextPanel (`:975`) | `.btn btn-secondary` | action | secondary |
| `.inspector-action` | Inspector | `.btn btn-secondary` | action | secondary |
| `.inspector-link` | Inspector | action-shaped link -> `.btn btn-ghost`; true navigation stays a link | action / disclosure | tertiary |
| `.outline-link` | Outline | navigation link only -> keep link (no primitive) | action | tertiary |
| `.tools-palette-close` | ToolsPalette | `IconButton variant="ghost"` | action | tertiary |
| `.action-dock-verb` / `-verb-primary` | ActionDock | dock tile (`.btn` box, prominent40); primary variant for the stage's main verb | action / toggle | primary / secondary |
| `.action-dock-menu-item` | ActionDock, ViewStrip overflow | `.btn btn-ghost` menu row | action / exclusive-selection | secondary |
| `.action-dock-plus` / `-arrow` / `-minus` / `-overflow` | ActionDock | `IconButton ghost` (minus -> `role=button` small control) | action / disclosure | tertiary |
| `.home-tool` / `.home-tool-fixed` | Welcome | `.btn-primary` (fixed Open) / `.btn-secondary` | action | primary / secondary |
| `.home-tools-plus` / `-edit` / `.home-tool-minus` | Welcome | `IconButton ghost` / `IconButton toggle` / destructive icon span | disclosure / toggle / destructive | tertiary / destructive |
| `.recent-row-open` / `.recent-row-action` | HomeRecentRow | already `.btn-ghost` / `.btn-ghost .btn-icon` | action / toggle | primary / tertiary |
| `.sample-card` | HomeSampleCard | already `.btn btn-ghost` | action | secondary |
| `.command-palette-row` / `-pin-toggle` | CommandPalette | `.btn-ghost` list row / `variant="toggle"` | exclusive-selection / toggle | secondary |
| `.ann-tool-btn` / `.ann-tool-menu-row` | AnnotationToolbar | `IconButton toolbar` / `.btn-ghost` menu row | toggle / action | tertiary |
| `.stamp-type-btn` (+ `-active`) | StampAnnotations | `.btn-toggle` | exclusive-selection | secondary |
| `.sig-tab` (+ `-active`) | SignatureManagerModal | `.btn-toggle` segmented item | exclusive-selection | secondary |
| `.modal-header-action` / `.modal-tabs` / `.modal-dialog-tool` | DialogShell, AccountsDialog | `IconButton ghost` / segmented `.btn-toggle` | action / exclusive-selection | tertiary / secondary |
| `.accounts-link` / `.accounts-mode-tab` | AccountsDialog, AccountMenu | link (navigate) / `.btn-toggle` | action / exclusive-selection | tertiary / secondary |
| `.about-row-value-link` | AboutDialog | navigation link -> keep link | action | tertiary |
| `.book-nav-button` / `.book-view-layout-button` | BookView | `.btn-toolbar` IconButton | action / toggle | tertiary |
| `.reading-nav-button` / `.reading-open-button` | ReadingView | `.btn-toolbar` / `.btn-secondary` | action | tertiary / secondary |
| `.search-replace-btn` | SearchBar | `.btn` + secondary / primary | action | secondary / primary |
| `.review-elements-row-edit/-delete/-select` | ReviewElementsPanel | `IconButton ghost` / danger / `.btn-toggle` | action / destructive / toggle | tertiary / destructive / secondary |
| `.ocr-suspects-entry-btn` | OcrSuspectsPanel | `.btn btn-ghost` | action | tertiary |
| `.prefs-action` | PreferencesDialog | `.btn btn-secondary` | action | secondary |
| `.redact-actions` (buttons) | RedactionOverlay | `.btn` + secondary / danger | action | secondary / destructive |
| `.update-prompt-actions` (buttons) | UpdatePromptDialog | `.btn` + secondary / primary | action | secondary / primary |
| `.outline-editor-toolbar` (buttons) | Outline editor | `IconButton toolbar` | action | tertiary |
| `.color-palette-add` / `.color-palette-actions` | ColorPalette | `.btn` + secondary / danger | action | secondary / destructive |
| `.ann-note-btn` | AnnotationCommentBox | `IconButton ghost` | action | tertiary |
| `.tf-panel-action` | panels/PanelPrimitives | `.btn btn-secondary` | action | secondary |
| `.form-listbox-row-on` / `.form-fill-report-row` actions | FormsOverlay | `.btn-toggle` / `.btn-ghost` | exclusive-selection / action | secondary / tertiary |
| `.print-row` / `.print-row-selects` | PrintPanel | layout row, not a button (controls excluded) | n/a | n/a |
| `.titlebar-menu-file` / `.titlebar-menu-button` | TitleBar (`:267`) | already `.btn btn-ghost` | disclosure | secondary |
| `.app-menu-trigger` | AppHeader (`:347`) | already `.btn btn-ghost .btn-icon` | disclosure | tertiary |
| `.view-strip-book` / `.view-strip-more-btn` | ViewStrip | `.btn-toolbar` / `.btn-ghost` menu | action / disclosure | secondary / tertiary |

Additional legacy classes inspected and mapped to the same families:
`.ann-note-editor-actions`, `.ann-panel-row-delete/jump`, `.committed-color-row`,
`.crop-summary-row`, `.create-image-row`, `.renumber-row`, `.print-row`,
`.form-list-row`, `.glass-sidebar-actions`, `.header-tool-search`,
`.titlebar-control` (native-exception), `.empty-state` (no controls).
`.empty-state`/EmptyState renders no interactive control, so it contributes zero
rows; notices that are display-only (ExportFidelityNotes,
ExportPagesWithoutTextNotice, Tooltip, PropertyPopover) likewise contribute none
beyond their real child controls.

## 4. Could not resolve

- Save All: no such control exists (glyph reuse only).
- `.content-action-btn` and `.context-panel-combine` are style aliases on already
  migrated `.btn` elements; recorded as `migrated`, not as separate controls.
- Runtime-length collections (home tiles, tabs, all-tabs rows, recents, samples,
  dock pinned verbs) are recorded as the data-driven template rows anchored at
  their real map render lines; individual runtime items are not enumerated.
