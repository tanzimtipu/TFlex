# Jovrel — Thumbnails and Outline

Recommended direction: **Document Navigator**. Use a dedicated navigation panel with Pages and Outline views. Each receives the full available height rather than permanently compressing bookmarks beneath thumbnails. Offer **Split Navigator** as a persisted layout preference for people who use both at once.

## Findings from the installed application

Inspected the installed `C:\Program Files\Jovrel\Jovrel.exe` on 5 October 2026 using its bundled report.pdf, not private recent documents. The fixture contains 34 pages and eight flat bookmarks, with destinations at pages 2, 4, 6, 8, 10, 12, 14 and 16.

- Clicking thumbnail 2 navigated to page 2 and selected one page for batch operations. After rendering settled, canvas, page number and inspector agreed.
- The dock then exposed Rotate pages, Extract pages, Delete pages and Clear page selection. Preserve this useful contextual behavior.
- Clicking the second bookmark navigated to page 4 while the existing page-2 batch selection remained. The current-page indicator and batch-selection indicator are distinct states even in today's app.
- Thumbnails show three small actions over the upper edge of the PDF preview. Their accessibility tree nests action buttons beneath a page button. Replace the nested interactive structure with sibling controls.
- The narrow outline clips chapter names. Hovering its second row exposed Add bookmark, Rename, destination-related controls, Indent, Outdent and Delete bookmark. The expanded row produced horizontal scrolling. Outdent was disabled for the top-level item.
- Right-clicking that bookmark did not show a separate context menu in the observed state. A new More menu is a proposal, not an existing feature established by inspection.
- Cleared the temporary page selection. Save remained disabled with “Saved — no changes to save.” No pages or bookmarks were edited, rotated, extracted or deleted.

This fixture does not establish behavior for nested outlines, unsupported destination types, encrypted documents, huge files or page reordering. Audit those paths in source before migration; do not infer missing capabilities from this flat fixture.

## Visual composition

Use Quiet Precision tokens from the existing handoffs. Opaque white / charcoal navigation surface; hairline boundary toward the canvas; violet interaction accent; restrained neutral controls. Colorful document-tab identity stays in the document rail. Do not tint every thumbnail with a tab color or recolor the PDF pixels.

The panel defaults to **280 logical px**, resizes between 240 and 420 px and persists per user. A 44 px header contains “Navigator”, layout menu and collapse. A 40 px segmented selector shows **Pages · 34** and **Outline · 8**. Counts are real document data. Supporting text uses 12 px, page labels / bookmark titles 13 px, panel heading 16 px with 500 weight. Use Segoe UI Variable / Segoe UI consistently with the Typography handoff. Count numerals use tabular figures.

Pages use one column at normal width. At panel widths of at least 360 px, an optional two-column layout uses a minimum 152 px card width. Single-column previews are 120–144 px wide; preserve each page's actual crop-box aspect ratio and rotation. Cards use a quiet 10 px radius, 12 px internal spacing and a footer below the preview. Keep the PDF paper itself rectangular. Avoid a separate shadow on every control or card.

## Pages: reading and selection

**Current page** means the page driving the canvas and inspector. Show a violet 2 px leading marker and a visible “Viewing” label on its thumbnail. **Selected pages** means the batch-operation set. Use a real checkbox and a soft violet card fill with its checked state. A page can be both current and selected. Current page must never be inferred from the batch set.

Preserve today's single-click thumbnail behavior during the visual migration: activate the page and apply the existing selection policy. The sibling checkbox changes the batch set without navigating. Retain existing Ctrl / Shift selection semantics after auditing them; if absent, add explicit tested toggle/range selection as a separate implementation step. Do not let a checkbox click bubble into page navigation. Distinguish logical focus, current page, selected set and range anchor in state.

The card footer contains checkbox + page label on the left and a **32 × 32 px More button** on the right, enlarged to 44 px for coarse pointers. This replaces tiny controls over PDF text. More offers the existing Rotate clockwise, Extract this page and Delete this page commands. Only reveal supported commands. Keep Delete separated and use the shared danger styling and existing confirmation / undo policy. Hover may increase emphasis, but actions must remain discoverable and keyboard accessible without hover.

Show a compact selection summary above the scrolling list: “2 selected” and Clear. The existing contextual dock remains the owner of batch Rotate / Extract / Delete; do not duplicate a second full action toolbar inside the panel. Exiting Pages view does not silently drop the selection. Navigating via the outline does not change its membership.

Move Combine with another PDF and Remove blank pages into the panel's labeled More menu, with the latter in a clearly separated destructive section. Retain Undo last change in its existing global command location / command system; audit access before removing its panel shortcut. A collapsed panel leaves a labeled reopen control on the rail; preserve the active view and its scroll anchor.

## Outline: navigation and editing

Give bookmarks the same available height as Pages. Default rows are 44–52 px with up to two title lines. Allocate a fixed trailing 32 px destination column and a 32 px More target. Use ellipsis only after two lines; the accessible name and hover / focus tooltip retain the full title. No horizontal scrolling to reach actions. Keep headings sentence case.

Render the real outline hierarchy. Show a 16 px disclosure chevron only on nodes with children, with 16 px indentation per depth. Deep nesting must fit through bounded indentation / wrapping, not endlessly shrinking titles. Use the appropriate tree semantics and implement its keyboard navigation with the project's accessibility primitives. Leaf items have no misleading disclosure icon. The inspected fixture remains flat; do not fabricate parent bookmarks.

Selecting a bookmark activates its real PDF destination, including available zoom / coordinates, rather than reducing every destination to a guessed page number. Keep destination objects and PDF action metadata intact. Expose “Page 4” as an accessible description, separate from the title. If a destination is external, unresolved or unsupported, show an appropriate label and affordance instead of inventing a page number. Reflect the selected bookmark explicitly; reading-position highlighting is optional and must follow resolved destinations, not text-title matching.

Outline header action: **Add bookmark**, enabled only when the document and permissions support it. Row More: Rename, Set destination to current view (if existing support is confirmed), Add child / sibling using the existing add flow, Indent, Outdent and Delete. Preserve depth restrictions and actual handler names. Map the observed generic Add bookmark behavior before deciding child / sibling placement. Move title editing into the shared popover / dialog primitive; do not expand every row into a horizontal toolbar. A local empty state says “No bookmarks” with Add bookmark, rather than showing an unused list.

Bookmark filtering is an optional subsequent feature, not required for the first visual migration. If added, preserve ancestor paths and expansion state, and label matches accurately. Do not add a permanently empty search field to small documents.

## Split Navigator alternative

Use Pages above Outline with a resizable separator, independent vertical scroll regions and a persisted ratio (initial 60 / 40). Both headers support collapse independently. Minimum expanded section height 180 px; when the window is too short, fall back to the full-height tabbed view instead of clipping controls. Provide keyboard resizing through the separator primitive. At typical 280 px width keep thumbnails in one column; the wider reference shows the optional two-column layout. Keep all semantics, actions and selection state identical between layouts.

## Rendering, state and performance

- Keys: stable document, page and bookmark identities; indexes are display positions only. Keep current-page ID, selected-page IDs, range anchor, focused item, active navigation view, expansion set and list scroll anchors separately.
- Virtualize long page lists; render visible thumbnails plus a small overscan, with placeholders that reserve the correct aspect ratio. Bound decode / renderer concurrency and release obsolete bitmap resources. Do not assert every page is loaded just because it is listed in the accessibility snapshot.
- Cache thumbnails by document revision + page identity + rotation / crop + raster size + device pixel ratio. Invalidate affected previews after edits; cancel stale tasks after closing / switching documents. Never let a stale render overwrite a newer revision.
- Outline virtualization, if needed, must preserve logical hierarchy, screen-reader position and keyboard movement. Do not virtualize eight rows merely to mirror thumbnail code.
- Preserve the visible scroll anchor after rerender and after page-list mutations. Reveal the current page on explicit navigation; avoid forcing list scroll on every canvas scroll tick or while the user browses another region.
- Reuse established page reorder and bookmark mutation APIs. Do not introduce drag behavior by changing DOM order alone. Any reorder must preserve page identity, selection, undo history and resolved bookmark destinations. If supported, add a restrained insertion line and an accessible Move to position command. If unsupported, keep it out of the first pass.
- Surface genuine loading, unavailable-preview and broken-destination states with a retry or repair action only when implemented. Counts, rotation, annotations and other badges come from document data; do not add decorative or fabricated metrics.

## Motion and accessibility

Use 140 ms color / emphasis transitions, no page-card bouncing or magnification. Honor reduced motion. Maintain full keyboard access to navigation, checkboxes, More menus, disclosure controls, rename and layout selection. Use the existing menu / dialog primitives for focus return and Escape. Never place buttons inside buttons. Add state announcements for selection-count changes without announcing every scroll tick. Pair color with checkbox / marker / label. Follow the application's high-contrast mode and 200% UI scaling; do not shrink target sizes to keep the panel narrow.

## Acceptance criteria

1. report.pdf shows 34 pages and eight original flat bookmark titles at their original destinations. No fabricated hierarchy.
2. Click page 2, navigate to chapter 2 at page 4: canvas / inspector current page is 4 and page 2 remains in the batch set. Clearing the set does not navigate away.
3. Checkbox toggles do not navigate. Navigating / switching navigation views does not silently alter the set. Range selection and existing modifiers are explicitly regression tested after auditing their semantics.
4. Actions remain reachable using keyboard, coarse pointers, small windows, dark theme and 200% scaling. No outline horizontal scrolling or title/action overlap.
5. Test real nested, long-title, empty, invalid / external-destination outlines. Rename / indent / outdent preserve all destinations, ordering and undo behavior. Permission restrictions are honored.
6. Test hundreds / thousands of mixed-size pages with delayed previews, rotation, crop, reorder, delete / undo and document switching. No stale thumbnails or unstable selection keys.
7. Existing dock commands and document keyboard shortcuts still work. Migration is complete only after every thumbnail and outline entry point uses the shared components.

The reference is an interaction prototype, not an implemented app patch. Its paper previews are schematic and its commands only demonstrate routing. Production uses the PDF renderer and real handlers.
