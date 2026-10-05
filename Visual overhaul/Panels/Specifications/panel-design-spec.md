# Jovrel panels — Quiet Precision / Context Pair

Proposed 5 October 2026. Scope: red-boxed Recent and Sample document areas on Home, left workspace panels and right inspectors for Pages, Edit, Review and Deliver. Window chrome and the PDF engine are not part of this redesign.

Resource root: `C:\Users\tanzi\OneDrive\App Development\TFlex\Visual overhaul`.

## Diagnosis from the supplied screenshots

The panels look sparse because much of their content is either duplicated, a passive count or an empty message. The left panel is narrow enough that headings, commands and descriptions wrap prematurely. The inspector repeats document metadata under different workspaces and can show detailed formatting controls while no editable object is selected. Review repeats the same annotation list and empty state on both sides. Deliver exposes an empty Format value, little preparation guidance and a generic Export button.

Home's Recent list shows PDF alongside files with spreadsheet, word-processing and image extensions. This may reflect conversion to an internal PDF; it cannot be diagnosed as a data error from appearance alone. The design should distinguish the original/source format from the current working-document format. Sample cards use the same sparkle icon rather than previews or descriptions that communicate their purpose.

The form screenshots show one page, 8 fields, zero annotations, a 10.5 KB file and OCR not run. Page dimensions are unavailable. These are useful observed values for a reference state, not a license to fabricate missing metadata. The interactive concepts also contain explicitly marked illustrative text/annotation states; they do not claim the current editing engine can select or modify the displayed form text.

## Recommended architecture: Context Pair

Give the two panels complementary ownership:

- **Left = navigation and document-level workflow.** Find a page, bookmark, content object, field or comment; see document-level preparation checks and launch related actions.
- **Right = current scope, properties and configuration.** Inspect selected pages, text, images, annotations or form fields; configure the export being prepared.

Keep one authoritative object list. Selecting an item on the canvas or in the left navigator updates the same selection model and the right inspector. The dock remains a compact command launcher. It does not get copied as a long button list inside both panels.

The inspector header always states the current scope: Page 1, 3 pages selected, Text object, Image, Checkbox field, Annotation or Export document. If the selected object's scope differs from the visible page, make that distinction explicit. Nothing selected is a real state, not an empty Text object inspector with enabled inputs.

The visual character is precise and quiet: stable panel geometry, clear sentence-case sections, measured field alignment, small useful icons, restrained dividers and one violet selection cue. Avoid turning every property into a separate card or permanently color-coding workspaces.

## Alternative: Single Inspector

Collapse the left panel and expose its navigator as a drawer/section within a single right inspector. This increases document space in constrained windows. The alternative must share data, commands and selection state with Context Pair. Use mutually exclusive navigator/properties tabs in production if a disclosure becomes too long; keep context clear when switching.

Recommend Context Pair for normal desktop windows because navigating documents while inspecting selections is valuable. Use Single Inspector as an optional compact layout or responsive fallback rather than removing navigation capabilities.

## Shared visual specifications

| Property | Proposed baseline |
| --- | --- |
| Left panel | 240 px preferred, 220–320 px resizable range |
| Right inspector | 280 px preferred, 260–380 px resizable range |
| Panel header | 52 px preferred, content-driven with text scaling |
| Inner padding | 16 px |
| Section gap | 20 px |
| Property row | 32–36 px minimum where interactive |
| Field/input radius | 9 px |
| Header typography | 14 px, weight 500, sentence case |
| Secondary labels | 12 px, readable contrast |
| Editable content text | 14 px baseline; preserve platform text scaling |
| Icons | 16–20 px, prior 1.65-unit rounded outline grammar |
| Persistent panels | Opaque theme surface, one neutral boundary line, no floating-card shadow |
| Home list/sample surfaces | 14 px radius, restrained one-pixel border |
| Focus/selection | Separate focus indicator; violet soft selection surface |

All dimensions are logical px proposals, not measurements of the scaled screenshots. Use the existing Quiet Precision palette, 4 px spacing unit and 140 ms state transitions. Maintain compact graphite default text/icons; violet indicates selection and active settings; green only confirms actual success; red represents a real error or destructive action.

Panel widths must leave a usable document viewport. Resize/collapse behavior takes available center space into account rather than only screen width. Preserve and restore each user's panel widths and collapsed states. Splitter resizing needs keyboard support. Headers remain visible while long lists scroll in the real application; avoid nested scroll areas where possible. The conversation preview reflows vertically at small widths rather than reproducing full desktop scrolling/drawers.

## Home: Recent documents

Replace the wall of repeated paths with a structured, scannable recent list:

- Primary: file name, with recognizable source-type icon when verified.
- Secondary: a compact location breadcrumb; full path remains available in a tooltip or details action.
- Time: last opened, clearly distinct from file modification time. Use real recorded data and the user's locale/time zone.
- Optional useful metadata: known page count, source format, converted working format or unavailable-file status. Do not display guessed values or filler dashes on every row.
- Primary action: Open. Row/file-name activation uses the existing open flow.
- More actions: Pin/unpin if supported, Show in folder if available, Locate missing file and Remove from Recent. Removing a history entry must not delete the source file.

Show original/source format and working PDF separately if the application converts imports. File extension alone is only a hint; prefer validated content type and the conversion record. A misleading filename should not override detected content. Keep recent lists bounded/paginated or virtualized when needed; do not discard older entries just because the concept shows four examples.

Meaningful empty state: No recent documents, with Open files. Missing-file state: last-known location plus Locate file/Remove from Recent. Loading and error states must be distinguishable. The existing global command search remains separate; add recent-file search only if list size warrants it.

## Home: Samples

Show actual first-page thumbnails when the sample renderer can provide them; use a distinct semantic document fallback if rendering is not available. Remove generic sparkle decoration unless a card genuinely represents an AI feature.

Give each sample a useful purpose label, verified from the fixture: Form fields / fill and inspect a form; Text recognition / try a scanned document; Long document / pages and outline; Technical report / document structure and properties. Keep the actual sample filename accessible and show page count only when known. Open sample is the primary action. Work from a copy/session so exploring a fixture follows existing sample handling; preserve existing behavior.

The preview thumbnails are schematic illustrative graphics, not actual rendered pages. Production must render the real fixtures and should not invent thumbnail content. Validate the fixture's actual capabilities before advertising what it demonstrates.

## Pages workspace

### Left: Document navigator

Use Pages and Outline as compact navigator modes. The page list shows real thumbnails, page index and optional page label. A selected thumbnail gets a thin violet boundary or rail plus a subtle surface, not a large glow. Multi-selection communicates both count and page range. Show page flags such as annotations or fields only when meaningful and verified; do not clutter every thumbnail with badges.

Keep Insert pages and a compact Page tools surface near the list header or selection tools. Page tools routes to the existing Rotate, Extract, Replace, Split, Crop, Merge and Delete commands as applicable. Combine versus Merge must be reconciled with actual command handlers rather than renamed blindly. Remove blank pages remains accessible through the existing command flow; do not claim blankness without the relevant detection result.

Outline mode shows the actual bookmark hierarchy and destination labels. No bookmarks is a compact empty state with Add bookmark when supported. Do not permanently reserve a second empty outline region below the page list. Preserve context actions, keyboard navigation, dragging/reordering, multi-select and undo support already present.

### Right: Page inspector

Show selected page(s), known dimensions with units, rotation and editable page label. Not available means unknown/unsupported; it is not zero. Do not substitute a guessed A4 size. Rotation maps to the existing page command and updates the same document state. Provide explicit label Apply/commit behavior where the existing command model requires it.

Show page-scoped annotations and form-field counts with View comments/Inspect fields actions when useful. Document totals must not be mislabeled as page totals. Multi-selection shows shared values or Mixed, with deliberate application to the selected pages. A collapsed Document details section holds filename, page count, file size and other relevant metadata; it need not dominate every inspector.

## Edit workspace

### Left: Content navigator

Expose Text, Images and Fields as actual object-navigation modes only when the engine can enumerate them. Counts must distinguish unknown from zero. Selecting a listed object selects/highlights its actual canvas counterpart. Preserve object/page scope; don't combine field widgets with editable page text.

Make empty states diagnostic: No selection, No editable text detected, Recognition not run, Unsupported editing and Permission restricted are different conditions. A page may visibly contain text while the editing backend cannot modify it. Do not call that page blank or scanned without evidence.

Offer Add text box when supported. Offer Recognize page only when OCR is a relevant supported path; recognition must not be advertised as a guaranteed remedy for all unsupported text editing. Show genuine OCR state/progress and provide Review suspects only when findings exist. Preserve batch OCR in an appropriate overflow/dock workflow. Do not automatically run OCR or claim confidence metrics without engine data.

### Right: Selection inspector

Without selection, show one concise explanation and a useful route to select/add content. Keep irrelevant formatting inputs hidden, rather than showing an apparently editable property sheet with no target.

For text: selected text/content; family and size in pt; style, color and alignment; paragraph controls; advanced character spacing/scaling under a disclosure. Font availability and substitution should be explained in user language where they affect output. Move implementation text about base-14 fonts/subsetting out of the default inspector.

For images: actual size/position, aspect-ratio preservation and replacement/crop controls only when available. For fields: actual field name/type, current value and relevant widget properties; use backend capabilities. Mixed selections show Mixed and only shared supported operations. Coordinate/size units must match the document engine and clearly distinguish PDF points from screen pixels.

Selection properties use actual engine state, not the new-text default font. When there is no selection, a separately scoped Default text style may configure subsequently created text; it must not imply a selected object has that font. Disabled controls show a useful reason when relevant.

## Review workspace

### Left: Review navigator

Own the single authoritative document comment/annotation list. Group by page and show annotation type, text excerpt and actual author/time if stored. Selecting an item jumps to/highlights its location and updates the inspector. Scope filters such as current page/all pages are useful if backed by the actual list; status filters require backend semantics and must not be invented.

No comments gets Add note or Annotate as an actionable empty state. FDF import/export belongs to this document-level workflow/overflow. Maintain actual supported annotation types and never replace them with a comments-only model.

A compact Document marks section can show Bates numbering, watermark and signature state with links to the existing workflows. Absent, not analyzed and applied are separate values. Signatures need actual validation/trust semantics; a placed signature is not automatically a valid cryptographic signature. Do not imply verification that has not run.

### Right: Annotation inspector

Show selected annotation type, page/location, content and supported appearance properties. Provide Jump to annotation and contextual delete using existing behavior. Add reply/resolve only if the data model supports them. Do not fabricate resolution status or collaboration. Without a selected annotation, show a short selection hint rather than duplicating the list and its zero-count empty state.

The concept's Add note creates a local example only; production uses the existing annotation engine and coordinates. Document-wide FDF actions remain in the navigator/workflow, not duplicated across both panels.

## Deliver workspace

### Left: Output checks and preparation

Show factual observations that can guide output: OCR state, interactive form fields, known file size, permissions/encryption and relevant compatibility findings if supported. Label observations separately from blockers. OCR not run is not an error for normal PDF export; 8 interactive fields do not mean 8 problems or 8 fields that must be flattened.

Provide contextual actions to inspect fields, optimize, recognize text or review actual compatibility findings. Do not invent a readiness percentage or estimate file-size savings without a real analysis. A small file can simply show its actual size; optimization remains optional. Run checks deliberately or cheaply in the background according to the existing engine, with accurate pending/error states.

### Right: Export configuration

Show an actual format selection, applicable preset/options, page scope, output name and destination selection behavior. Clearly label All pages, Current page and Custom range. Validate ranges against the current document, normalize safely through the existing parser and keep error feedback close to the field. The concept's one-page range validator is demonstrative and must not be copied as the application's real range parser.

Use Export PDF, Export images or the actual selected format as the primary action. Only show supported format options. If a converter, license or backend is unavailable, provide the application's correct disabled/explanatory state; don't promise a DOCX/XLSX/PPTX converter because a screenshot contains its command.

Preserve interactive form fields by default where applicable. Flattening is an explicit supported output choice, not an automatic preparation requirement. Format-specific field preservation controls disappear or change wording for non-PDF formats. Encryption/password/security settings appear where relevant and use the existing backend. Do not display a dummy destination or claim encryption has occurred before completion.

Show real progress, failure and success from the export operation. Do not change the source document merely by configuring an export; retain existing undo, overwrite and confirmation behavior for the actual operation. Do not add unsolicited approval steps to this visual redesign.

## Data and action contract

Every visible item must answer one of three questions: What is the current scope/state? What can I change? What useful action can I take next?

For each item record: owning scope (document/page/selection/export), authoritative model source, loading/unknown/empty/unsupported/error behavior, action command ID, capability predicate and refresh dependencies. Document version and selection IDs prevent stale asynchronous analysis from updating another page/object. Never cache metadata only by a mutable filename.

Avoid conflating zero, unknown and not analyzed. Prefer a concise explicit status or omit optional unknown metadata. Retrieve expensive thumbnails/object enumeration/OCR/validation lazily and cancel stale jobs. Virtualize long page/object/comment lists; keep selection, expansion and scroll position stable as data loads. Backend detection must precede labels such as Blank, Scanned, Editable, Signed or Ready.

## Integration and accessibility

Use one shared panel shell, scoped header, section, property-row, empty-state and action-list pattern. Reuse the Quiet Precision icon registry and theme tokens, not a new icon family. Attached panels use neutral boundaries; floating surfaces inherit the dock's geometry.

Panel collapse/resize must feed the document viewport geometry used by the Focus Dock so its center and collision rules remain valid. Preserve document zoom and selection when layout changes. At smaller widths prefer a single active drawer/inspector; the conversation preview's stacking is an explanatory layout, not the required production behavior.

Keep visible labels, keyboard-accessible controls, correct list/tree/menu semantics, distinct focus/selected states, 44 px coarse-input targets, readable contrast and reduced-motion/high-contrast support. Don't add inaccessible drag-only behavior or keyboard semantics without implementing them. Editable property commits participate in the existing undo/redo model.

## Acceptance checks

Cover Home with zero/many/missing/conversion-history records; sample preview loading/failure; Pages with long lists/outline/multi-select/mixed values; Edit with no selection/native editable text/unsupported text/scanned content/fields/mixed selection; Review with no annotations/populated list/different types/imported FDF/signature states; Deliver with multiple formats/unknown analysis/invalid ranges/interactive forms/export failure and completion.

Verify both themes, high contrast, localization, user text scaling and Windows 100/125/150/200% DPI. Check panel resizing/collapse, dock placement, no clipped controls and actual document state synchronization. Run relevant existing build/tests. The concept preview is a design resource; it is not evidence that those engine capabilities or runtime behaviors are already implemented.
