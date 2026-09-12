# TFlex — Requirements

## Summary

TFlex is a modern desktop PDF studio for Windows — a fast, lightweight, single-user
alternative to Adobe Acrobat Pro for the things people actually do with PDFs: view them
beautifully, organize pages, annotate, fill forms, and sign.

It is an installable Windows desktop app. It should feel like a real commercial product from
the first launch: quick, fluid, polished, and clearly capable. It ships with sample documents
available from a welcome screen so every feature can be tried immediately.

TFlex is built to grow: licensing, user accounts, and a cloud-backed document database are
planned for a future version. Version 1 stays fully local with no login, but the architecture
must not paint us into a corner (see "Future-proofing" below).

## The product

### Application shell

- A modern desktop window: left rail (thumbnails / annotations / bookmarks), top toolbar,
  central document canvas, right properties panel that appears when relevant.
- Light mode and dark mode, switched by an always-available control. The choice persists.
- A welcome / start screen shown when no document is open: recent files, sample documents,
  and clear primary actions (Open, Merge).
- Smooth, purposeful motion: panel transitions, tab changes and list updates animate
  (roughly 150–250 ms). Nothing janky, nothing gratuitous.
- Multiple documents open in tabs within one window.

### Phase features

See "Phases and success criteria" for the buildable, gated feature list.

## Seed content

The installer ships with sample PDFs (a formatted report, a scanned-style document, a form,
and a long document of 100+ pages) registered on the welcome screen, so every feature is on
display from first launch. The set grows with the phases.

## High-level technical guidance

Just enough direction to keep things on track — specific library choices are left to the
Coding Agent unless stated here.

- **Electron** app written in **TypeScript**, with a **React** renderer and a documented
  build/start setup (npm scripts). Packaged for Windows with **electron-builder** (NSIS
  installer and a portable build).
- **PDF.js** for page rendering in the renderer process.
- **pdf-lib** for PDF manipulation (merge, split, rotate, annotations, forms, flatten) in the
  main process. Rendering and manipulation are separate concerns — keep them in separate
  modules behind clear interfaces.
- All file and PDF-engine work happens in the main process (or a worker), never on the UI
  thread. The UI must stay responsive while a 500-page file loads.
- Prefer **popular, well-supported libraries** over custom code. Keep the implementation
  simple and conventional.
- End-to-end tests drive the real packaged-style app via **Playwright** (Electron support).
- Unit tests accompany every phase, frontend and backend.

### Future-proofing (architecture constraints, not features)

Version 2 will add license verification, user login and a database. Therefore in v1:

- Keep a clean main/renderer boundary with typed IPC contracts in `src/shared/` — no renderer
  code reaching into Electron APIs directly.
- Isolate all persistence behind a single storage/service layer (e.g. app settings, recent
  files) that can later front a real database.
- Keep an obvious seam where licensing/auth gating would attach (an app-level gate before
  the main UI mounts), without building the gate itself.
- Do NOT build: login, accounts, licensing, sync, or any network dependency. v1 works
  fully offline.

## Performance budget

TFlex's identity is fast and lightweight. These are requirements, not aspirations:

- Cold start to interactive welcome screen: under 3 seconds on an ordinary Windows laptop.
- Opening a 500-page PDF: first page rendered and UI interactive within 3 seconds; the app
  never freezes during load (progressive rendering).
- Scrolling and zooming a document stay smooth (no visible blank-page stalls beyond brief
  tile rendering).
- Idle memory with one typical document open: under 400 MB for the whole app.
- Installer size: under 150 MB.

## Not in scope

Deliberately left out of v1. Do not build these:

- No in-place editing of existing PDF text or images (v2 candidate — it is the hardest
  feature in the category).
- No OCR, redaction, document compare, Bates numbering, preflight/print-production,
  digital certificate signing, or batch processing.
- No login, licensing, accounts, cloud sync, or any network features (v2).
- No bookmarks/outline editing (read the outline if present; editing is out of scope).
- No PDF creation from scratch or from other formats (docx, images) — v1 works on
  existing PDFs, except that merge/split/extract produce new PDFs.
- No macOS or Linux packaging — Windows only.

## Look and feel

Applies to the whole app:

- **Modern, calm, and designed on purpose.** Clean typography (a quality UI font such as
  Inter), generous spacing, a restrained neutral base (zinc/slate family) with ONE accent
  color used consistently for primary actions and selections — **`#2563eb` (blue 600)**.
- Dark mode is a first-class theme, equally considered — not an inverted afterthought. The
  document canvas adapts gracefully in dark mode (dimmed chrome around pages; page content
  itself is not color-inverted).
- Motion: fast, subtle transitions (150–250 ms, ease-out). Panels slide, hover states
  respond, tabs crossfade. No bouncy or slow animations.
- Avoid the tells of generated design: gradient hero backgrounds, purple-dominated themes,
  thin accent borders down one side of panels, oversized rounded corners on everything,
  emoji used as UI icons (use a proper icon set such as Lucide).
- Density: this is a productivity tool. Comfortable but information-dense — closer to
  VS Code / Linear than to a marketing site.
- Beyond these rules, layout and visual style are the Coding Agent's call.

## Phases and success criteria

Build in these phases, in order. **Do not start a phase until every success criterion of
the previous phase is demonstrably met** — each criterion must be something you can show
working, not just assert.

Every phase closes the same loop: its unit tests pass, its end-to-end tests pass against the
real running Electron app, and the new features have been used in the running app with
screenshots taken and inspected.

### Phase 1 — Viewer foundation and Windows packaging

**Features**

- Dev start with one documented command; production build produces a Windows installer
  (NSIS) and portable build via electron-builder.
- App shell: toolbar, left thumbnail rail, tab bar, welcome screen with recent files and
  samples; light/dark themes persisted.
- Open a PDF from disk; render pages with PDF.js; continuous scrolling, zoom (buttons,
  ctrl+wheel, fit-width / fit-page), page indicator and jump-to-page.
- Thumbnail rail with current-page highlight; text search within the document with hit
  highlighting and next/previous navigation; document outline (bookmarks) panel shown when
  the PDF has one.
- Recent files list, persisted. Window size/position/theme persisted.
- Sample PDFs bundled and listed on the welcome screen.
- The Playwright + Electron e2e harness runs against the real app.

**Success criteria**

1. One documented command starts the app in dev; a documented command produces an
   installable Windows build.
2. Opening the bundled sample report renders its pages crisply; zooming and fit modes work;
   scrolling stays smooth through 100+ pages.
3. The thumbnail rail tracks the current page; clicking a thumbnail jumps to it.
4. Searching for a known word in the sample report highlights all hits and next/previous
   cycles through them with the document scrolled to each.
5. Theme toggle restyles the whole app, and theme, recent files, and window geometry survive
   an app restart.
6. Cold start and 500-page-open meet the performance budget (timed and recorded).
7. Unit tests for document open, page model, search index and settings persistence pass.
8. At least one e2e test launches the real Electron app, opens a sample PDF, searches, and
   toggles the theme — and passes.

### Phase 2 — Page organization

**Features**

- Insert/merge: combine the open document with one or more other PDFs (choose position).
- Split by page range into a new file; extract selected pages to a new file.
- In the thumbnail rail: drag to reorder pages, rotate left/right, delete (with undo).
- Save and Save-As for the modified document.
- A clear modified-state indicator on the document tab.

**Success criteria**

1. Merging two sample PDFs produces a file whose pages are A-then-B in the expected order;
   the output opens correctly in an external reader (verified by re-opening it in TFlex with
   correct page count and text extraction).
2. Splitting pages 10–20 of the long sample produces an 11-page PDF that opens correctly.
3. Dragging a thumbnail reorders pages; rotate and delete apply correctly; undo restores.
4. Save-As writes a valid PDF; reopening it in TFlex shows the reorganized pages.
5. The tab shows modified state after any change and clears after save.
6. Unit tests for merge, split, reorder, rotate, delete and undo in the PDF engine pass.
7. E2e tests cover merging two documents and reordering pages via drag — and pass.

### Phase 3 — Annotation

**Features**

- Text markup: highlight, underline, strikethrough — applied by selecting text, with color
  choice.
- Freehand pen (color, width), text boxes, and shapes: rectangle, ellipse, arrow.
- Sticky-note comments attached to a page location, with an editable note.
- An annotations panel listing all annotations of the document; clicking one scrolls to it;
  annotations can be edited (color, content) and deleted.
- Annotations are written into the PDF itself (standard PDF annotation objects) so they
  appear when the file is opened in other readers; saving persists them.

**Success criteria**

1. Each annotation type can be created on a page and renders correctly at every zoom level.
2. Text markup anchors to the selected text and stays aligned after zoom and scroll.
3. The annotations panel lists every annotation; selecting one navigates to it; editing and
   deleting work.
4. After Save-As, annotations survive: reopening the file in TFlex shows them, and they are
   present as real annotation objects in the saved file (verified by parsing, e.g. with
   pdf-lib, in a unit test).
5. Unit tests for annotation create/edit/delete and PDF serialization pass.
6. E2e tests cover highlighting text, adding a sticky note, saving and reopening — and pass.

### Phase 4 — Forms and signatures

**Features**

- AcroForm detection: form fields (text, checkbox, radio group, dropdown, list) become
  fillable in the viewer with appropriate editors.
- Filled forms save with values intact (still editable on reopen) and can optionally be
  flattened (values baked in, fields removed) on Save-As.
- Signatures: create by drawing (pointer) or typing (rendered in a script style); place,
  move, resize and delete a signature on any page; saved signatures list for reuse
  (stored locally).
- Signed documents save correctly; optionally flattened.

**Success criteria**

1. Opening the sample form shows every field as fillable with a type-appropriate editor;
   filling and saving preserves values on reopen.
2. Flattening produces a PDF with the values visible but no form fields (verified by
   parsing the saved file).
3. A drawn signature can be placed, moved, resized and saved; it appears in the output file
   as page content.
4. A saved signature can be reused on another page without redrawing.
5. Unit tests for form read/write, flatten, and signature placement pass.
6. E2e tests cover filling the sample form, signing it, saving and reopening — and pass.

### Phase 5 — Final quality gate

**Work**

- A look-and-feel pass over the whole app in both themes.
- The full unit and e2e suites, with coverage measured.
- A complete walkthrough of the running app with screenshots of every screen in both
  themes.
- An adversarial review of the finished product, including hostile PDFs from
  `test-fixtures/`.
- A packaged-build verification: install the produced installer (or run the portable
  build) and repeat the smoke walkthrough there.
- Performance re-verified against the budget and recorded.

**Success criteria**

1. Full unit suites pass with at least 80% statement coverage in `src/main` (PDF engine)
   and meaningful coverage in the renderer core logic, reported by the test command.
2. The full e2e suite passes against the real running app.
3. Every feature in this document has been exercised in the running app with inspected
   screenshots in both themes; no errors in the console during the walkthrough.
4. The adversarial review record exists; every finding is fixed or rejected with a written
   reason; all suites pass on the final build.
5. The packaged build passes the same smoke walkthrough.
6. Performance budget numbers are met and recorded in `PERFORMANCE.md`.

## Final success criteria

The project is complete, and the Coding Agent may stop, when **all** of the following are
true:

- A non-technical person can install TFlex on Windows from the produced installer (or run
  the portable build) and use it without instructions beyond the welcome screen.
- Viewing, search, tabs, themes; merge/split/reorder/rotate/delete/extract with undo; all
  annotation types with an annotations panel; and form filling, flattening and signatures —
  all work as described, and all changes save correctly to real PDF files that open in
  other readers.
- The performance budget is met and recorded.
- The look-and-feel rules are met in both themes and none of the avoid-list appears.
- All unit tests pass at the coverage target and the full e2e suite passes.
- The adversarial record exists, every finding is fixed or rejected with a written reason,
  and all suites pass on the final packaged build.
- **Most importantly: the product has been validated by using it end to end as a real user
  would — opening, organizing, annotating, filling and signing real PDFs, in both themes,
  on the packaged build, with every screen visually inspected. Passing tests is necessary
  but NOT sufficient.**

## Version numbering (Phase 6 onward)

From Phase 6 the semver series is active: **v1.1.x**. Retrospemptive naming of v1
deliverables: v1.0.0 for the original gate closure (Phases 1-5). From now on
`package.json.version` always matches the next tag. Tag names like `v1.1.0`,
`v1.1.1` etc; incrementing through included build metadata when needed.

## Phase 6 — Tab UX, tools palette, menus, color picker, OTA updates, auto-git-push

**Planned first; fixes to land before features are declared green:**

1. BUG — tab click frozen/unresponsive (React handler/state) — reproduce and fix source.

Features and success criteria:

1. Empty tabs: "+" control to create an empty tab; opening a PDF fills it; closing
   returns to the previous tab. Success: "+ tab->" stay alive in welcome/-empty tab and
   closed returns to prior tab as evidenced by e2e.
2. Tools palette right-side panel (icon+label list/grid toggle persisted) containing
   merge/split/extract/rotate/delete/sign/forms entries. Success: panel opens; modes
   persist across restart via settings; e2e verifies.
3. Standard app menu: File (Open/Merge/Save/SaveAs/Recent/Close-Tab-Exit), View, Edit,
   Tools, Window, Help/About with version badge, Preferences (theme default, recents
   limit, storage). Success: menu rendered with existing single-source handlers;
   accelerators work; About reports app version for OTA surface.
4. Annotation color UX: active-tool swatch as rounded square under the tool; opens
   color palette with preset+full picker (hex/RGB); persisted per theme. Applies to
   highlight/ink/underline/strikeout/note/shapes. Success: e2e picks custom color and
   persists.
5. OTA updates: electron-updater in main via updateService, IPC status/download/install,
   About+toolbar indicator; silent download+prompt restart; portable build explicitly
   no-auto-update (documented); private repo credentials not committed. Success: bump
   version then simulated/published release surfaces "Update available" in app.
6. Auto-push pipeline: after full green loop (build, unit+e2e, package checks) for a
   phase/fix batch, git-agent tags v1.x.x (`npm version <level> --no-git-tag-version`,
   commit bump, `git tag`, then push) and pushes. Success: tag lands only on green
   builds, and the pushed tag's `package.json` version matches the local working copy.

Repo-safety amendments:
- Prune duplicate reduntant e2e/unused harnesses before first commit; no new debug
  files under e2e/ or root.
- .gitignore additions: .env, test-results/, screenshots/, test-fixtures/*.pdf never
  pushing-kill exceptions (qa/adversary-authored README/MD inside those dirs still OK).
- Unused harnesses named harness.cjs/harness.js/retest_harness.cjs/retest_rework*
  purge as part of P6 gate.

Completion demands: all Phase-6 green; tag v1.x.x pushed; OTA verified by a version
bump against tanzimtipu/TFlex; thumbnails/screenshots included per gate; timing per
performance budget as RECheckWise for the new tab-switch/palette work.

### Phase-6 no-op remediation checklist (required to close Phase 6)

These bugs came out of the Phase-6 extension scope. qa files one DEF each (severity
tagged inline/in parentheses), frontend/backend:frontend-dev owns renderer fixes
(except #3 export and #2 sign where the backend path is implicated; coordinate via
shared contract). qa defines entry, developer fixes, qa verifies → CLOSED. Each of
these must be verified together with the CONTROL-INDEX per phase rule and a no-op
sweep + silence attack audit before Phase 7 is allowed to start:

1. The "+" for new tab visible on empty workload. It must only appear when at least
   one tab exists. — LOW.
2. Sign inside PDF returns "Item not found" — the promised new flow returns a
   failure at engine/driver level. HIGH.
3. Word export saves as an image (.docx containing a page rendered as picture); it
   must contain editable text. HIGH — backend chose wrong export path.
4. Click Edit then select text: the canvas goes blank. HIGH (silent canvas crash).
5. Left-pane page selection reverts to page 2 of the long PDF. HIGH.
6. Rotate page click: no-op. HIGH.
7. Delete page click: no-op. HIGH.
8. Highlight color default shows white; must be the accent blue (#2563eb). MEDIUM.
9. Crop function click: no-op. HIGH.
10. Stamp "place on page" click: no-op. HIGH.

## Phase 7 — Phase-6 fixes (must land before Phase 8 features)

**Fixes (target the source, not workarounds):**

1. Color palette: replace the hex/RGB text-input picker with a visual color picker —
   hue/saturation gradient pad, hue slider, optional swatch grid, and the current-color
   preview. Preset swatches remain as quick-picks; the custom picker appears inline
   (not as a dialog) when the user selects "Custom…" from the swatch row. Applies to
   all annotation tools. Persisted per theme.
2. "+" add-tab control: move from the far right of the tab bar to immediately after
   the rightmost open tab (always adjacent to the last tab). Clicking "+" opens an
   empty tab; the control re-attaches to the new rightmost tab.
3. App menu: the Phase-6 standard menu (File/View/Edit/Tools/Window/Help/About/
   Preferences) is not visible in the running app. Diagnose why (missing
   `Menu.setApplicationMenu`, wrong platform assumption, or registration missing in
   `start()`) and fix so the menu bar renders on Windows with all items functional.

**Success criteria:**

1. Palette: visual gradient picker picks a custom color and persists per theme; unit
   tests cover the picker state model; e2e exercises a custom-color round trip.
2. "+": adjacent placement verified visually (screenshot) and by e2e (open 3 tabs,
   verify control sits after tab 3).
3. Menu: menu bar renders on Windows; every menu item triggers its handler; e2e drives
   File→Open and Preferences→theme-default.
4. No regressions: full unit + e2e suites green.

**Settings impact:** none (reuse Phase-6 `annotationColors` and existing fields).

## Phase 8 — Optimize (file size reduction)

**Features**

- Reduce file size action: one-click "Reduce file size" (image downsample/recompress,
  font subsetting, discard objects, cleanup) with a quality preset choice
  (screen/ebook/printer/press).
- Audit space usage: dialog showing percentage breakdown of the file by element type
  (images, fonts, content streams, metadata).
- Fast web view (linearize) toggle on Save-As.

**Success criteria**

1. Reducing a 20MB sample PDF produces a measurably smaller file that re-opens
   correctly with identical page count and text extraction.
2. Audit dialog shows a plausible breakdown for a real file; numbers are reproducible.
3. Unit tests for optimizer pipeline round-trip; e2e covers reduce+audit+reopen.

**Settings impact:** `optimizePreset?: 'screen'|'ebook'|'printer'|'press'` (default
`'ebook'`; validation: preserve-if-valid enum, reject-if-invalid; transported via
AppSettings IPC; used by the optimizer action and saved per-document? No — global).

## Phase 9 — Create + Export

**Features**

- Create PDF from images (JPEG/PNG) and from clipboard content; insert resulting pages
  into open document or new tab.
- Export PDF pages to images (JPEG/PNG/TIFF) with resolution choice; export text to
  plain text/RTF; export whole PDF to Word (.docx) via a bundled converter (offline).
- Insert blank page; insert from another PDF at a chosen position.

**Success criteria**

1. Creating a PDF from 3 sample images produces a valid PDF that opens in TFlex with
   correct page count and dimensions.
2. Exporting a page to PNG at 150 DPI produces a viewable image; text export preserves
   reading order for the sample report.
3. Insert-blank and insert-from-PDF round-trip correctly in unit tests and e2e.

**Settings impact:** `exportImageFormat?: 'png'|'jpeg'|'tiff'` (default `'png'`);
`exportImageDpi?: number` (default 150, range 72–600); `createImageQuality?: number`
(default 85, range 10–100). All validated preserve-if-valid.

## Phase 10 — Edit content (text and images in place)

**Features**

- Edit existing text: click into a text run, change/replace/delete with font metrics
  preserved (font, size, color, baseline); reflow within the original bounding box.
- Add new text box on any page with font/size/color choice.
- Edit images: move/resize/replace/crop embedded images.

**Success criteria**

1. Editing a word in the sample report produces a PDF that opens in an external reader
   with the change visible and no layout shift.
2. Round-trip: edit → save → reopen shows the edit; text extraction reflects it.
3. Unit tests for text-run replacement and image crop; e2e for the full edit-save-reopen
   loop.

**Settings impact:** `editDefaultFont?: string` (default `'Helvetica'`; validation:
string from a bundled allowlist, preserve-if-valid).

## Phase 11 — OCR (recognize text)

**Features**

- Recognize Text action on a scanned PDF: searchable-image output (text layer behind
  the image) with language choice and downsample option.
- Batch OCR via the tools palette on multiple open documents.
- Fix OCR suspects: list low-confidence words with click-to-correct.

**Success criteria**

1. Running OCR on the scanned-style sample makes its text searchable (search finds a
   known word) and selectable; saved file re-opens with the text layer intact.
2. Batch OCR on two scanned files completes without UI freeze; progress is reported.
3. Unit tests for OCR engine integration; e2e for search-after-OCR.

**Settings impact:** `ocrLanguage?: string` (default `'eng'`; validation: ISO-639
code from a bundled allowlist, preserve-if-valid); `ocrDownsample?: number` (default
300, range 72–600).

## Phase 12 — Residual page-organize + annotate parity

**Features**

- Replace pages (swap pages from another file, retaining links/bookmarks); renumber
  pages (logical page labels, sections); crop pages (CropBox/TrimBox control).
- Callout text boxes; stamps (built-in palettes + custom stamp creation); comment
  import/export (FDF/XFDF local files).

**Success criteria**

1. Replace-pages on the sample report retains its outline and links; output opens
   correctly.
2. Crop a page and verify dimensions change in the saved file.
3. Stamps render at every zoom; comment export produces a valid FDF that re-imports.
4. Unit tests for replace/renumber/crop/stamp/FDF; e2e for the user-visible flows.

**Settings impact:** `defaultStampId?: string` (default `'APPROVED'`; validation:
string from a bundled allowlist, preserve-if-valid).
## Phase 13 — UX polish: borderless window + professional color

**Features**

1. Borderless app window (frame: false) with a custom title bar (drag region,
   window controls min/max/close wired through existing IPC), modern industry-
   standard styling, smooth animations (150-250ms ease-out per existing design
   rules).
2. Professional color: UI text and icons pop against the neutral base with
   intentional semantic color (info/success/warning/error, action accent,
   annotation colors) rather than a flat all-gray palette. Both themes equally
   considered.

**Success criteria**

1. App launches frameless with a custom title bar that drags and window controls
   that work; no OS chrome visible.
2. The installer window also appears borderless/modern (electron-builder NSIS
   appearance configured to the extent it supports; document limits).
3. Typography and icons are visibly more readable and colorful in both themes,
   while keeping the single accent color rule for primary actions; no emojis,
   proper icon set throughout.
4. Unit tests for the title bar state + any new renderer reducers; e2e covers
   frameless launch + window controls + theme colors; performance budget
   re-timed (cold start, long-doc open) and unchanged or improved.

**Settings impact:** none (theme already stored; this phase refines it).

## Phase 14 — Liquid Glass theme with frosted glass effects

**Features**

1. **Frosted glass theme**: Replace solid backgrounds with translucent frosted glass that reveals the desktop wallpaper behind the app window. Use CSS `backdrop-filter: blur()` with appropriate opacity and background colors.

2. **Tool descriptions restored**: Tools panel shows icon + title + description text for each tool (e.g., "Merge PDFs" / "Combine multiple PDFs..."). Never icon-only in this view.

3. **Dynamic panel sizing**: Tools panel width adjusts dynamically to accommodate full tool descriptions without truncation or congestion. Panel can be wider than current fixed width.

4. **iOS liquid glass animations**: Implement spring-based, fluid animations for:
   - Panel open/close transitions (spring physics, not linear)
   - Tool item hover states (subtle scale/glow)
   - Background parallax/subtle movement
   - Window focus/defocus blur intensity changes
   - Smooth 200-400ms transitions with ease-out-spring curves

5. **Visual polish**: Gradient background hints, subtle inner shadows, rounded corners on panels (16-20px), consistent frosted glass across title bar, side panels, and tool panels.

**Success criteria**

1. Desktop wallpaper shows through frosted glass backgrounds; blur intensity is pleasant and readable.
2. Tools panel displays icon + title + description for every tool; text is fully visible and not truncated.
3. Panel width accommodates content without congestion; user can see full descriptions.
4. Animations feel fluid and springy (iOS-style), not mechanical; all transitions complete smoothly.
5. Light/dark/frosted themes all implement glass effects appropriately.
6. Performance: no frame drops during animations; 60fps maintained.
7. Unit tests for animation state; e2e verifies glass theme renders and animations complete.

**Settings impact:** none (theme already stored; this phase enhances the frosted glass variant).

## Phase 14.1 — Liquid Glass CORRECTION (Visual Refinement)

**Purpose:** Correct the Phase 14 implementation to properly match the Liquid Glass reference image. The current implementation incorrectly interprets Liquid Glass as "blue + transparent." This correction establishes proper material design.

**CORRECTION PRIORITIES:**

### 1. TOP BAR HIERARCHY (Most Critical)
Create THREE horizontal surfaces with CONSISTENT design:
- **Title/Tab Bar**: Document tabs, new tab, window controls
- **Primary Command Bar**: Open, navigation, Save, zoom, primary actions
- **Context Toolbar**: Annotation tools (only when editing)

Requirements:
- Standardized heights using tokens: `TitleBarHeight`, `CommandBarHeight`, `ToolbarHeight`
- Consistent vertical centering across all bars
- Control groups with glass capsule backgrounds
- 8px-based spacing system
- NO arbitrary heights based on content
- NO misaligned controls

### 2. NEUTRAL FROSTED GLASS (Not Blue)
Primary glass material must be NEUTRAL:
- White/gray translucent base
- Subtle backdrop blur
- Restrained saturation
- 1px luminous edge highlight
- Soft inner highlight
- Blue is ACCENT ONLY for:
  - Selected states
  - Active tools
  - Focus indicators
  - Primary actions (Open button)

### 3. SHARED GLASS SIDEBAR COMPONENT
Create `GlassSidebar` component used by BOTH panels:

**Shared tokens:**
- `GlassSidebarBackground`
- `GlassSidebarBorder`
- `GlassSidebarBorderRadius` (14-18px)
- `GlassSidebarShadow`
- `GlassSidebarHeaderHeight`
- `GlassSidebarContentPadding`

**Pages Sidebar (Left):**
- "Pages" header with toggle
- Floating glass card with margins
- Thumbnails with rounded selection (not blue rectangle)
- Selection: thin accent outline + subtle glow
- Thumbnail content remains opaque (PDF accurate)

**Tools Sidebar (Right):**
- "Tools" header with view toggle
- Same glass material as Pages
- Tool rows: neutral glass, hover highlight, selected tint
- Icon colors preserved
- Full descriptions visible

### 4. FLOATING PANELS WITH MARGINS
Both sidebars must:
- Float above workspace with consistent margins (16px)
- NOT be flush to window edges
- Have outer rounded corners
- Cast soft elevation shadow
- Feel like inspector panels

### 5. TOOLBAR CONTROL GROUPING
Group related controls into glass capsules:

Example groups:
- Navigation: `[<] [1/34] [>]`
- Actions: `[Save] [Open]`
- Zoom: `[-] [307%] [+]`
- Tools: `[pointer|hand|text|box|image]`
- Document: `[Merge] [Split] [Sign] [More]`

Each group has subtle translucent background.
NO individual heavy buttons for every icon.

### 6. STANDARDIZED DIMENSIONS

**Spacing tokens (8px-based):**
- 4px = micro
- 8px = small
- 12px = control
- 16px = standard
- 24px = section
- 32px = major

**Corner radii:**
- Window: 18-22px
- Panels: 14-18px
- Control groups: 10-14px
- Buttons: 8-12px
- Pills: full

**Control sizes:**
- Visual height: 32-38px
- Hit target: 36-44px

### 7. MATERIAL HIERARCHY
Create material tokens:
- `GlassChrome` - Title/command bars
- `GlassSidebar` - Left/right panels
- `GlassControlGroup` - Toolbar capsules
- `GlassControlHover` - Interactive hover
- `GlassSelection` - Selected items

Each has:
- Blur amount
- Opacity
- Border intensity
- Shadow
- Highlight

### 8. EDGE CHARACTERISTICS
All glass surfaces need:
- Top-edge luminous highlight
- 1px translucent border
- Soft inner highlight
- Soft outer shadow
- NO obvious white outlines

### 9. PDF ISOLATION (Preserve)
- PDF canvas: completely opaque
- NO blur/opacity/tint on PDF
- PDF thumbnails: opaque
- Only UI gets glass treatment

### 10. DOCUMENT WORKSPACE
- Neutral, quiet background
- Low saturation
- Does not compete with PDF
- Subtle material variation only

**Success Criteria**

1. Three top bars with consistent heights and alignment
2. Glass is primarily neutral, not blue
3. Left and right sidebars match in material and treatment
4. Both panels float with 16px margins
5. Toolbar controls grouped in glass capsules
6. Spacing follows 8px system
7. Corner radii standardized per hierarchy
8. Material system with edge highlights
9. PDF remains completely opaque
10. Side-by-side comparison matches reference

**Settings impact:** none (visual correction only).
